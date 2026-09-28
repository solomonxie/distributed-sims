import * as fs from 'fs';
import * as path from 'path';
import { createRun } from '../src';
import { raftLeader, raftState } from '../src/behaviors/coordination';
import type { Catalog, ChaosEvent, NodeSpec } from '../src/types';
import type { Run } from '../src/run';
import { doc, edge, node, testCatalog } from './fixtures';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const yaml = require('js-yaml');
const group = yaml.load(fs.readFileSync(path.join(__dirname, '../../content/catalog/coordination.yaml'), 'utf8'));
const catalog: Catalog = {
  ...testCatalog,
  types: [...testCatalog.types, ...group.types.map((t: any) => ({ ...t, group: 'coordination' }))],
  skins: group.skins,
};

const members = (k: number, cfg: Record<string, unknown> = {}) =>
  Array.from({ length: k }, (_, i) => node(`m${i + 1}`, 'consensus-member', cfg));

/** client → api (one of the members per request) */
function raftDoc(k: number, cfg: Record<string, unknown> = {}, rps = 100) {
  const ms = members(k, cfg);
  return doc(
    [node('c', 'web-client'), node('api', 'service', { fanout: 'one' }), ...ms],
    [edge('c', 'api'), ...ms.map(m => edge('api', m.id, { timeoutMs: 3000 }))],
    { sources: [{ id: 's', node: 'c', shape: { kind: 'constant', rps }, readRatio: 0.5 }] },
  );
}

/** step in chunks (Run.step caps events per call) */
function advance(r: Run, until: number) {
  while (!r.step(until)) {}
}

const leaders = (r: Run, ids: string[]) => ids.filter(id => raftState(r.world, id)?.role === 'leader' && r.world.nodes.get(id)!.up);
const ids5 = ['m1', 'm2', 'm3', 'm4', 'm5'];

test('5 members elect exactly one leader and commit writes', () => {
  const r = createRun(raftDoc(5), { catalog, seed: 11 });
  advance(r, 3000);
  expect(leaders(r, ids5)).toHaveLength(1);
  const terms = new Set(ids5.map(id => raftState(r.world, id)!.term));
  expect(terms.size).toBe(1);
  expect(r.protocol().some(p => p.kind === 'raft.RequestVote')).toBe(true);
  advance(r, 8000);
  const l = raftLeader(r.world)!;
  expect(l.commit).toBeGreaterThan(200);
  expect(r.snapshot().system.availability).toBeGreaterThan(98);
  expect(r.protocol().some(p => p.kind === 'raft.AppendEntries')).toBe(true);
  expect(r.events().some(e => /elected leader, term/.test(e.text))).toBe(true);
  expect(r.snapshot().nodes[l.id].badges.some(b => b.text === '👑')).toBe(true);
});

test('kill leader → new leader with higher term within ~2× election timeout', () => {
  const r = createRun(raftDoc(5), { catalog, seed: 3 });
  advance(r, 3000);
  const old = raftLeader(r.world)!;
  r.fire({ kind: 'kill-leader', target: 'm1' });
  expect(r.world.nodes.get(old.id)!.up).toBe(false);
  const t0 = r.now;
  let t = t0;
  while (t < t0 + 5000) {
    t += 10;
    advance(r, t);
    const l = raftLeader(r.world);
    if (l && l.id !== old.id) break;
  }
  const nl = raftLeader(r.world)!;
  expect(nl.id).not.toBe(old.id);
  expect(nl.term).toBeGreaterThan(old.term);
  expect(t - t0).toBeLessThanOrEqual(2 * 300 + 50);
});

test('partition 3|2: minority cannot commit, majority can; heal → minority catches up', () => {
  const r = createRun(raftDoc(5), { catalog, seed: 5 });
  advance(r, 3000);
  const L = raftLeader(r.world)!.id;
  const minority = [L, ids5.find(i => i !== L)!];
  const majority = ids5.filter(i => !minority.includes(i));
  const heals: number[] = [];
  for (const a of minority) for (const b of majority) heals.push(r.fire({ kind: 'partition', target: a, target2: b } as ChaosEvent)!);
  const minCommit0 = raftState(r.world, L)!.commit;
  advance(r, 8000);
  // old leader in minority keeps thinking it leads but cannot commit
  expect(raftState(r.world, L)!.commit).toBe(minCommit0);
  const ml = leaders(r, majority);
  expect(ml).toHaveLength(1);
  const newL = raftState(r.world, ml[0])!;
  expect(newL.term).toBeGreaterThan(raftState(r.world, L)!.term - 1);
  expect(newL.commit).toBeGreaterThan(minCommit0 + 50);
  expect(raftState(r.world, L)!.lastIndex).toBeGreaterThan(minCommit0); // uncommitted writes piled up
  for (const h of heals) r.heal(h);
  advance(r, 12000);
  const l = raftLeader(r.world)!;
  expect(majority).toContain(l.id);
  for (const id of minority) {
    const s = raftState(r.world, id)!;
    expect(s.commit).toBeGreaterThan(newL.commit);
    // logs match the leader up to the follower's commit
    const lead = raftState(r.world, l.id)!;
    for (let i = 1; i <= s.commit; i++) expect(s.log[i].term).toBe(lead.log[i].term);
  }
});

test('split votes: tight equal timeouts repeat elections, randomized timeouts do not', () => {
  const elections = (cfg: Record<string, unknown>) => {
    const r = createRun(doc(members(4, cfg), [], { sources: [] }), { catalog, seed: 9 });
    advance(r, 3000);
    return { terms: raftState(r.world, 'm1')!.term, leaders: leaders(r, ['m1', 'm2', 'm3', 'm4']).length };
  };
  const tight = elections({ electionMinMs: 150, electionMaxMs: 150 });
  const rand = elections({ electionMinMs: 150, electionMaxMs: 300 });
  expect(tight.terms).toBeGreaterThan(10);
  expect(tight.leaders).toBe(0);
  expect(rand.terms).toBeLessThanOrEqual(3);
  expect(rand.leaders).toBe(1);
});

test('stale follower reads → stale-read anomaly; linearizable reads → none', () => {
  const run = (reads: string) => {
    const r = createRun(raftDoc(3, { reads }, 300), { catalog, seed: 4 });
    advance(r, 6000);
    return r.snapshot().anomalies['stale-read'] ?? 0;
  };
  expect(run('stale')).toBeGreaterThan(0);
  expect(run('linearizable')).toBe(0);
  expect(run('lease')).toBe(0);
});

test('lease reads: stale leader with clock skewed back serves stale reads', () => {
  const run = (skew: boolean) => {
    const r = createRun(raftDoc(5, { reads: 'lease' }, 300), { catalog, seed: 5 });
    advance(r, 3000);
    const L = raftLeader(r.world)!.id;
    const rest = ids5.filter(i => i !== L);
    if (skew) r.fire({ kind: 'clock-skew', target: L, params: { ms: -5000 } });
    for (const b of rest) r.fire({ kind: 'partition', target: L, target2: b });
    advance(r, 6000);
    return r.snapshot().anomalies['stale-read'] ?? 0;
  };
  expect(run(false)).toBe(0);
  expect(run(true)).toBeGreaterThan(0);
});

test('drop-votes stalls elections after leader dies', () => {
  const r = createRun(raftDoc(3), { catalog, seed: 2 });
  advance(r, 2000);
  r.fire({ kind: 'drop-votes', target: 'm1' });
  r.fire({ kind: 'kill-leader', target: 'm1' });
  advance(r, 5000);
  expect(raftLeader(r.world)).toBeUndefined();
});

function lockDoc(fencing: boolean) {
  return doc(
    [
      node('a', 'lock-client', { everyMs: 400, holdMs: 200 }),
      node('b', 'lock-client', { everyMs: 400, holdMs: 200 }),
      node('lock', 'lock-service', { leaseTtlMs: 1000, fencing }),
      node('db'),
    ],
    [edge('a', 'lock'), edge('a', 'db'), edge('b', 'lock'), edge('b', 'db')],
    { sources: [] },
  );
}

test('lease lock + GC pause: no fencing → double-holder anomaly; fencing → none', () => {
  const run = (fencing: boolean) => {
    const r = createRun(lockDoc(fencing), { catalog, seed: 8 });
    advance(r, 2000);
    // pause whichever client currently holds the lock
    for (let i = 0; i < 400; i++) {
      const s = r.snapshot();
      const holder = ['a', 'b'].find(id => s.nodes[id].badges.some(b => b.text.startsWith('🔑')));
      if (holder) {
        r.fire({ kind: 'gc-pause', target: holder, params: { sec: 3 } });
        break;
      }
      advance(r, r.now + 5);
    }
    advance(r, 10000);
    return { anomalies: r.snapshot().anomalies['double-holder'] ?? 0, fenced: r.events().some(e => /fenced/.test(e.text)) };
  };
  const unfenced = run(false);
  const fenced = run(true);
  expect(unfenced.anomalies).toBeGreaterThan(0);
  expect(fenced.anomalies).toBe(0);
  expect(fenced.fenced).toBe(true);
});

test('snowflake + clock skew backwards → duplicate / out-of-order anomalies', () => {
  const mk = (cfg: Record<string, unknown>) =>
    doc([node('c', 'web-client'), node('ids', 'id-generator', cfg)], [edge('c', 'ids')], {
      sources: [{ id: 's', node: 'c', shape: { kind: 'constant', rps: 500 } }],
    });
  const run = (cfg: Record<string, unknown>) => {
    const r = createRun(mk(cfg), { catalog, seed: 1 });
    advance(r, 2000);
    r.fire({ kind: 'clock-skew', target: 'ids', params: { ms: -800 } });
    advance(r, 5000);
    return r.snapshot();
  };
  const bad = run({ scheme: 'snowflake' });
  expect(bad.anomalies['out-of-order']).toBeGreaterThan(0);
  expect(bad.anomalies['duplicate']).toBeGreaterThan(0);
  const safe = run({ scheme: 'snowflake', onClockBackwards: 'wait' });
  expect(safe.anomalies['duplicate'] ?? 0).toBe(0);
  expect(safe.anomalies['out-of-order'] ?? 0).toBe(0);
});

test('paxos: racing proposers choose exactly one value', () => {
  const ns: NodeSpec[] = [
    node('p1', 'paxos-proposer', { value: 'A' }),
    node('p2', 'paxos-proposer', { value: 'B' }),
    node('a1', 'paxos-acceptor'),
    node('a2', 'paxos-acceptor'),
    node('a3', 'paxos-acceptor'),
  ];
  const r = createRun(doc(ns, [], { sources: [] }), { catalog, seed: 6 });
  advance(r, 3000);
  const chosen = r.events().filter(e => /Paxos slot 1: value/.test(e.text));
  expect(chosen).toHaveLength(1);
  const kinds = new Set(r.protocol().map(p => p.kind));
  for (const k of ['paxos.Prepare', 'paxos.Promise', 'paxos.Accept', 'paxos.Accepted']) expect(kinds.has(k)).toBe(true);
  expect(r.snapshot().anomalies['divergence'] ?? 0).toBe(0);
});

test('gossip: killed member detected dead and view converges', () => {
  const ns = Array.from({ length: 6 }, (_, i) => node(`g${i + 1}`, 'gossip-member'));
  const r = createRun(doc(ns, [], { sources: [] }), { catalog, seed: 4 });
  advance(r, 3000);
  r.fire({ kind: 'kill', target: 'g3' });
  advance(r, 15000);
  const s = r.snapshot();
  for (const id of ['g1', 'g2', 'g4', 'g5', 'g6']) expect(s.nodes[id].gauges.membersAlive).toBe(5);
  expect(r.events().some(e => /converged/.test(e.text))).toBe(true);
  expect(r.protocol().some(p => p.kind === 'gossip.Ping')).toBe(true);
});

describe('templates', () => {
  const load = (slug: string) => JSON.parse(fs.readFileSync(path.join(__dirname, `../../content/templates/${slug}.json`), 'utf8'));

  test('consensus-raft-5: elects, survives leader kill and zone partition', () => {
    const r = createRun(load('consensus-raft-5'), { catalog, seed: 1 });
    advance(r, 70_000);
    expect(r.events().filter(e => /elected leader/.test(e.text)).length).toBeGreaterThanOrEqual(2);
    expect(raftLeader(r.world)).toBeDefined();
    expect(r.snapshot().system.availability).toBeGreaterThan(95);
  });

  test('consensus-split-vote: no leader', () => {
    const r = createRun(load('consensus-split-vote'), { catalog, seed: 1 });
    advance(r, 5000);
    expect(raftLeader(r.world)).toBeUndefined();
    expect(raftState(r.world, 'm1')!.term).toBeGreaterThan(10);
  });

  test('consensus-lock: redlock double holder, chubby fenced', () => {
    const d = load('consensus-lock');
    const r = createRun(d, { catalog, seed: 1 });
    advance(r, 45_000);
    expect(r.snapshot().anomalies['double-holder']).toBeGreaterThan(0);
    d.nodes.find((n: NodeSpec) => n.id === 'lock').skin = 'chubby-lock';
    const f = createRun(d, { catalog, seed: 1 });
    advance(f, 45_000);
    expect(f.snapshot().anomalies['double-holder'] ?? 0).toBe(0);
  });
});
