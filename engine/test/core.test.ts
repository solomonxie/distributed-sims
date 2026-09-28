import { createRun } from '../src';
import { doc, edge, node, testCatalog } from './fixtures';

const basic = (extra = {}) =>
  doc([node('c', 'web-client'), node('api'), node('db', 'service', { p50Ms: 2, p99Ms: 10 })], [edge('c', 'api'), edge('api', 'db')], extra);

test('runs traffic end to end with high availability', () => {
  const r = createRun(basic(), { catalog: testCatalog, seed: 7 });
  r.step(10_000);
  const s = r.snapshot();
  expect(s.system.rps).toBeGreaterThan(150);
  expect(s.system.availability).toBeGreaterThan(99);
  expect(s.nodes.db.rps).toBeGreaterThan(150);
  expect(s.system.p99).toBeGreaterThan(20); // includes 25ms client link each way
});

test('deterministic for the same seed', () => {
  const a = createRun(basic(), { catalog: testCatalog, seed: 42 });
  const b = createRun(basic(), { catalog: testCatalog, seed: 42 });
  a.step(5000);
  b.step(5000);
  expect(a.world.kernel.processed).toBe(b.world.kernel.processed);
  expect(JSON.stringify(a.snapshot().system)).toBe(JSON.stringify(b.snapshot().system));
});

test('saturation builds a queue and latency', () => {
  const d = doc([node('c', 'web-client'), node('api', 'service', { instances: 1, slots: 2, p50Ms: 20, p99Ms: 40 })], [edge('c', 'api')], {
    sources: [{ id: 's', node: 'c', shape: { kind: 'constant', rps: 300 } }],
  });
  const r = createRun(d, { catalog: testCatalog, seed: 1 });
  r.step(8000);
  const s = r.snapshot();
  expect(s.nodes.api.util).toBeGreaterThan(0.9);
  expect(s.nodes.api.errRate + s.system.errRate).toBeGreaterThan(0);
});

test('kill makes callers time out, heal recovers', () => {
  const r = createRun(basic(), { catalog: testCatalog, seed: 3 });
  r.step(3000);
  const id = r.fire({ kind: 'kill', target: 'db' })!;
  r.step(8000);
  expect(r.snapshot().nodes.db.up).toBe(false);
  expect(r.snapshot().system.availability).toBeLessThan(50);
  r.heal(id);
  r.step(14000);
  expect(r.snapshot().system.availability).toBeGreaterThan(95);
});

test('partition drops traffic between two nodes', () => {
  const r = createRun(basic(), { catalog: testCatalog, seed: 3 });
  r.step(2000);
  r.fire({ kind: 'partition', target: 'api', target2: 'db', durationSec: 5 });
  r.step(6000);
  expect(r.snapshot().edges['api->db'].partitioned).toBe(true);
  expect(r.snapshot().system.availability).toBeLessThan(50);
  r.step(12000);
  expect(r.snapshot().edges['api->db'].partitioned).toBe(false);
});

test('retries amplify load on a failing dependency', () => {
  const mk = (retries: number) =>
    doc([node('c', 'web-client'), node('api'), node('db')], [edge('c', 'api'), edge('api', 'db', { retries, timeoutMs: 200, backoffMs: 10 })]);
  const count = (retries: number) => {
    const r = createRun(mk(retries), { catalog: testCatalog, seed: 5 });
    r.step(1000);
    r.fire({ kind: 'bad-deploy', target: 'db', params: { errPct: 100 } });
    r.step(6000);
    return r.series('db').slice(-3).reduce((a, p) => a + p.rps, 0);
  };
  expect(count(3)).toBeGreaterThan(count(0) * 3);
});

test('circuit breaker opens on failures', () => {
  const d = doc([node('c', 'web-client'), node('api'), node('db')], [edge('c', 'api'), edge('api', 'db', { circuitBreaker: true, timeoutMs: 100 })]);
  const r = createRun(d, { catalog: testCatalog, seed: 5 });
  r.step(1000);
  r.fire({ kind: 'kill', target: 'db' });
  r.step(4000);
  expect(r.snapshot().edges['api->db'].breaker).toBe('open');
});

test('alerts fire and resolve', () => {
  const d = basic({});
  d.alerts = [{ id: 'a1', target: 'system', metric: 'availability', op: '<', threshold: 90 }];
  const r = createRun(d, { catalog: testCatalog, seed: 9 });
  r.step(2000);
  const id = r.fire({ kind: 'kill', target: 'api' })!;
  r.step(6000);
  expect(r.snapshot().alertsFiring).toBe(1);
  expect(r.events().some(e => e.kind === 'alert')).toBe(true);
  r.heal(id);
  r.step(12000);
  expect(r.snapshot().alertsFiring).toBe(0);
});

test('rewind replays deterministically', () => {
  const r = createRun(basic(), { catalog: testCatalog, seed: 11 });
  r.step(2000);
  r.fire({ kind: 'slow', target: 'db', params: { x: 10 } });
  r.step(6000);
  const before = JSON.stringify(r.snapshot().system);
  r.step(9000);
  r.rewindTo(6000);
  expect(JSON.stringify(r.snapshot().system)).toBe(before);
});

test('burst multiplies traffic and weight adapts', () => {
  const r = createRun(basic(), { catalog: testCatalog, seed: 2 });
  r.step(2000);
  r.fire({ kind: 'traffic', action: 'burst', params: { x: 20 }, durationSec: 4 });
  r.step(4000);
  expect(r.snapshot().system.rps).toBeGreaterThan(2000);
});

test('send one produces a full trace', () => {
  const r = createRun(basic(), { catalog: testCatalog, seed: 2 });
  r.step(1000);
  const id = r.sendOne('c')!;
  r.step(2000);
  const tr = r.trace(id)!;
  expect(tr.ok).toBe(true);
  expect(tr.spans.map(s => s.node).sort()).toEqual(['api', 'c', 'db']);
});
