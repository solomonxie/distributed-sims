import { createRun } from '../src';
import type { KeyDist } from '../src/types';
import { doc, edge, node, testCatalog } from './fixtures';

const one = (type: string, cfg: Record<string, unknown>, rps = 300, readRatio = 0.5, keys?: KeyDist) =>
  doc([node('c', 'web-client'), node('db', type, cfg)], [edge('c', 'db', { timeoutMs: 5000 })], {
    sources: [{ id: 's', node: 'c', shape: { kind: 'constant', rps }, readRatio, keys }],
  });

const p50 = (r: ReturnType<typeof createRun>, id: string) => {
  const pts = r.series(id).slice(-5);
  return pts.reduce((a, p) => a + p.p50, 0) / pts.length;
};
const p99 = (r: ReturnType<typeof createRun>, id: string) => Math.max(...r.series(id).slice(-5).map(p => p.p99));

test('async replicas give stale reads; sync gives none but slower writes', () => {
  const stale = (replication: string) => {
    const r = createRun(one('relational-db', { replication, readFrom: 'replicas', replicaLagMs: 50 }), { catalog: testCatalog, seed: 3 });
    r.step(10_000);
    return r.snapshot().anomalies['stale-read'] ?? 0;
  };
  expect(stale('async')).toBeGreaterThan(0);
  expect(stale('sync')).toBe(0);

  const writeP50 = (replication: string) => {
    const r = createRun(one('relational-db', { replication, replicaLagMs: 20 }, 200, 0), { catalog: testCatalog, seed: 3 });
    r.step(8000);
    return p50(r, 'db');
  };
  expect(writeP50('sync')).toBeGreaterThan(writeP50('async') * 3);
});

test('read-your-writes and linearizable remove stale reads', () => {
  const stale = (consistency: string) => {
    const r = createRun(one('relational-db', { readFrom: 'replicas', replicaLagMs: 50, consistency }), { catalog: testCatalog, seed: 4 });
    r.step(8000);
    return r.snapshot().anomalies['stale-read'] ?? 0;
  };
  expect(stale('eventual')).toBeGreaterThan(0);
  expect(stale('read-your-writes')).toBe(0);
  expect(stale('linearizable')).toBe(0);
});

test('quorum R+W>N has no stale reads under partition; R=W=1 does', () => {
  const stale = (cl: string) => {
    const r = createRun(one('kv-store', { members: 3, replicationFactor: 3, readConsistency: cl, writeConsistency: cl }), { catalog: testCatalog, seed: 5 });
    r.step(3000);
    r.fire({ kind: 'split-brain', target: 'db', durationSec: 5 });
    r.step(12_000);
    const s = r.snapshot();
    return { stale: s.anomalies['stale-read'] ?? 0, div: s.anomalies['divergence'] ?? 0, badges: s.nodes.db.badges.map(b => b.text) };
  };
  const q = stale('quorum');
  expect(q.stale).toBe(0);
  expect(q.badges).toContain('R+W>N');
  const o = stale('one');
  expect(o.stale).toBeGreaterThan(0);
  expect(o.badges).toContain('R+W≤N');
  expect(o.div).toBeGreaterThan(0);
  expect(q.div).toBe(0);
});

test('primary failover with async replication loses acknowledged writes; sync does not', () => {
  const lost = (replication: string) => {
    const r = createRun(one('relational-db', { replication, replicaLagMs: 200, failoverSec: 3 }), { catalog: testCatalog, seed: 6 });
    r.step(5000);
    r.fire({ kind: 'kill-leader', target: 'db' });
    r.step(12_000);
    const s = r.snapshot();
    expect(s.nodes.db.badges[0].text).toContain('primary');
    return s.anomalies['lost-write'] ?? 0;
  };
  expect(lost('async')).toBeGreaterThan(0);
  expect(lost('sync')).toBe(0);
});

test('document-db w:1 rolls back on election; w:majority keeps writes', () => {
  const lost = (writeConcern: string) => {
    const r = createRun(one('document-db', { writeConcern, replicaLagMs: 100, electionSec: 2 }), { catalog: testCatalog, seed: 7 });
    r.step(4000);
    r.fire({ kind: 'kill-leader', target: 'db' });
    r.step(9000);
    return r.snapshot().anomalies['lost-write'] ?? 0;
  };
  expect(lost('w1')).toBeGreaterThan(0);
  expect(lost('majority')).toBe(0);
});

test('hot key row-lock contention raises p99', () => {
  const run = (keys: KeyDist) => {
    const r = createRun(one('relational-db', { replicas: 0 }, 250, 0, keys), { catalog: testCatalog, seed: 8 });
    r.step(8000);
    return p99(r, 'db');
  };
  expect(run({ kind: 'hot', hot: 0.9 })).toBeGreaterThan(run({ kind: 'uniform' }) * 3);
});

test('serializable aborts contended writes with conflict', () => {
  const r = createRun(one('relational-db', { replicas: 0, isolation: 'serializable' }, 250, 0, { kind: 'hot', hot: 0.9 }), { catalog: testCatalog, seed: 9 });
  r.step(6000);
  expect(r.series('db').slice(-3).some(p => (p.errs.conflict ?? 0) > 0)).toBe(true);
});

test('disk-full fails writes; schema-lock blocks them', () => {
  const r = createRun(one('relational-db', {}, 200, 0), { catalog: testCatalog, seed: 10 });
  r.step(2000);
  const id = r.fire({ kind: 'disk-full', target: 'db' })!;
  r.step(4000);
  expect(r.snapshot().nodes.db.errRate).toBeGreaterThan(0.9);
  r.heal(id);
  r.fire({ kind: 'schema-lock', target: 'db', durationSec: 3 });
  r.step(6000);
  expect(r.snapshot().nodes.db.rps).toBeGreaterThan(0);
  expect(r.series('db').slice(-1)[0].p50).toBe(0); // nothing completes while locked
  r.step(10_000);
  expect(r.snapshot().nodes.db.errRate).toBe(0);
});

test('monotonic reads stop replicas going back in time', () => {
  const ooo = (consistency: string) => {
    const r = createRun(one('relational-db', { readFrom: 'any', replicaLagMs: 80, consistency }), { catalog: testCatalog, seed: 11 });
    r.step(8000);
    return r.snapshot().anomalies['out-of-order'] ?? 0;
  };
  expect(ooo('eventual')).toBeGreaterThan(0);
  expect(ooo('monotonic')).toBe(0);
});

test('split brain on async primary diverges and discards the rogue side', () => {
  const r = createRun(one('relational-db', { replicas: 2 }), { catalog: testCatalog, seed: 12 });
  r.step(3000);
  r.fire({ kind: 'split-brain', target: 'db', durationSec: 4 });
  r.step(5000);
  expect(r.snapshot().nodes.db.badges.map(b => b.text)).toContain('2 primaries');
  r.step(9000);
  const a = r.snapshot().anomalies;
  expect(a['divergence']).toBeGreaterThan(0);
  expect(a['lost-write']).toBeGreaterThan(0);
  expect(a['stale-read']).toBeGreaterThan(0);
});
