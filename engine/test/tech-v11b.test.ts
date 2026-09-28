import * as fs from 'fs';
import { createRun } from '../src';
import '../src/behaviors/tech-cassandra';
import '../src/behaviors/tech-elasticsearch';
import '../src/behaviors/tech-dynamodb';
import '../src/behaviors/cache';

const yaml = require('js-yaml');
const ROOT = __dirname + '/../../content/';
const catalog: any = { groups: [], types: [], skins: [], containers: [] };
for (const f of fs.readdirSync(ROOT + 'catalog')) {
  const d: any = yaml.load(fs.readFileSync(ROOT + 'catalog/' + f, 'utf8'));
  catalog.groups.push(d.group);
  for (const t of d.types ?? []) catalog.types.push({ ...t, group: d.group.id });
  catalog.skins.push(...(d.skins ?? []));
}
const tpl = (slug: string) => JSON.parse(fs.readFileSync(`${ROOT}templates/${slug}.json`, 'utf8'));
const run = (doc: any, seed = 1) => createRun(typeof doc === 'string' ? tpl(doc) : doc, { catalog, seed });
const snap = (r: any, id: string) => r.snapshot().nodes[id];
const g = (r: any, id: string, k: string): number => snap(r, id).gauges[k] ?? 0;
const av = (r: any, id: string) => (1 - snap(r, id).errRate) * 100;
const has = (r: any, s: string) => r.events().some((e: any) => e.text.toLowerCase().includes(s.toLowerCase()));
const until = (r: any, ms: number) => {
  while (r.now < ms) r.step(Math.min(ms, r.now + 1000));
};

describe('cassandra', () => {
  test('ring serves traffic; LSM flushes and compacts; R+W ≤ RF allows stale reads', () => {
    const r = run('tech-cassandra-anatomy');
    until(r, 35_000);
    expect(r.snapshot().system.availability).toBeGreaterThan(99.5);
    expect(g(r, 'n1', 'flushes')).toBeGreaterThan(0);
    expect(has(r, 'compacting')).toBe(true);
    expect(r.protocol().some((p: any) => p.kind === 'cassandra.gossip')).toBe(true);
    expect(r.snapshot().anomalies['stale-read']).toBeGreaterThan(0);
  });

  test('node down: ALL fails, QUORUM and ONE keep serving; hints replay and read repair', () => {
    const r = run('tech-cassandra-cl');
    until(r, 5000);
    r.fire({ kind: 'kill', target: 'n1', durationSec: 20 } as any);
    until(r, 15_000);
    expect(av(r, 'app-all')).toBeLessThan(80);
    expect(av(r, 'app-quorum')).toBeGreaterThan(99);
    expect(av(r, 'app-one')).toBeGreaterThan(99);
    expect(has(r, 'marks n1 DOWN')).toBe(true);
    expect(has(r, 'max_hint_window')).toBe(true);
    until(r, 35_000);
    expect(has(r, 'replays')).toBe(true);
    expect(has(r, 'read repair: n1')).toBe(true);
    expect(av(r, 'app-all')).toBeGreaterThan(99);
  });

  test('write burst → compaction backlog → read p99 rises', () => {
    const r = run('tech-cassandra-compaction');
    until(r, 10_000);
    const before = snap(r, 'driver').p99;
    r.fire({ kind: 'traffic', action: 'burst', source: 'loader', params: { x: 40 }, durationSec: 40 } as any);
    let worst = 0;
    for (let t = 11_000; t <= 45_000; t += 1000) {
      until(r, t);
      worst = Math.max(worst, snap(r, 'driver').p99);
    }
    expect(worst).toBeGreaterThan(before * 2);
    expect(g(r, 'n1', 'pendingCompactionMb')).toBeGreaterThan(20);
  });

  test('tombstones slow reads, then TombstoneOverwhelmingException', () => {
    const r = run('tech-cassandra-tombstones');
    until(r, 30_000);
    expect(g(r, 'n1', 'tombstones') + g(r, 'n2', 'tombstones') + g(r, 'n4', 'tombstones')).toBeGreaterThan(10_000);
    expect(has(r, 'TombstoneOverwhelmingException')).toBe(true);
    expect(av(r, 'driver')).toBeLessThan(95);
  });

  test('DC partition: QUORUM unavailable, LOCAL_QUORUM unaffected; hints flow after heal', () => {
    const r = run('tech-cassandra-multidc');
    until(r, 5000);
    expect(snap(r, 'app-q').p99).toBeGreaterThan(snap(r, 'app-lq').p99 * 5);
    r.fire({ kind: 'partition', target: 'us', target2: 'eu', durationSec: 15 } as any);
    until(r, 15_000);
    expect(av(r, 'app-q')).toBeLessThan(10);
    expect(av(r, 'app-lq')).toBeGreaterThan(99);
    until(r, 25_000);
    expect(has(r, 'replays')).toBe(true);
    expect(av(r, 'app-q')).toBeGreaterThan(99);
  });
});

describe('elasticsearch', () => {
  test('query then fetch, refresh, green cluster', () => {
    const r = run('tech-es-anatomy');
    until(r, 10_000);
    expect(r.snapshot().system.availability).toBeGreaterThan(99.5);
    expect(has(r, 'fetch phase')).toBe(true);
    expect(has(r, 'searchable segment')).toBe(true);
    expect(snap(r, 'coord').badges.some((b: any) => b.text === 'green')).toBe(true);
  });

  test('master quorum: isolated master is replaced, never two masters', () => {
    const r = run('tech-es-anatomy');
    until(r, 3000);
    r.fire({ kind: 'split-brain', target: 'm1', durationSec: 10 } as any);
    until(r, 6000);
    const masters = ['m1', 'm2', 'm3'].filter(id => snap(r, id).badges.some((b: any) => b.text.startsWith('👑')));
    expect(masters).toEqual(['m2']);
    expect(g(r, 'm2', 'term')).toBe(2);
  });

  test('data node loss: replica promoted (yellow), re-replication, green again', () => {
    const r = run('tech-es-node-loss');
    until(r, 5000);
    r.fire({ kind: 'kill', target: 'd2' } as any);
    until(r, 10_000);
    expect(has(r, 'promoted to primary')).toBe(true);
    expect(snap(r, 'coord').badges[0].text).toBe('yellow');
    until(r, 15_000);
    expect(g(r, 'd1', 'recoveryMbps') + g(r, 'd3', 'recoveryMbps')).toBeGreaterThan(0);
    until(r, 25_000);
    expect(snap(r, 'coord').badges[0].text).toBe('green');
    expect(r.snapshot().system.availability).toBeGreaterThan(99);
  });

  test('refresh 1s rejects bulk load that refresh 30s absorbs', () => {
    const r = run('tech-es-refresh');
    let a = 0;
    let b = 0;
    for (let t = 2000; t <= 30_000; t += 1000) {
      until(r, t);
      a += av(r, 'coord-a');
      b += av(r, 'coord-b');
    }
    expect(a / 29).toBeLessThan(99);
    expect(b / 29).toBeGreaterThan(99.5);
  });

  test('heavy aggregations slow searches and trip the breaker', () => {
    const r = run('tech-es-aggregation');
    const worst = (from: number, to: number) => {
      let m = 0;
      for (let t = from; t <= to; t += 1000) {
        until(r, t);
        m = Math.max(m, snap(r, 'app').p99);
      }
      return m;
    };
    const before = worst(2000, 8000);
    r.fire({ kind: 'traffic', action: 'set', source: 's-kibana', params: { rps: 30 } } as any);
    expect(worst(9000, 15_000)).toBeGreaterThan(before * 1.5);
    expect(has(r, 'circuit_breaking_exception')).toBe(true);
  });

  test('mapping explosion hits the total fields limit', () => {
    const r = run('tech-es-mapping');
    until(r, 3000);
    r.fire({ kind: 'cardinality-burst', target: 'app', params: { x: 20 }, durationSec: 120 } as any);
    until(r, 50_000);
    expect(g(r, 'm1', 'fields')).toBe(1000);
    expect(has(r, 'Limit of total fields [1000]')).toBe(true);
  });
});

describe('dynamodb', () => {
  test('anatomy: DAX hits, partitions, GSI propagation', () => {
    const r = run('tech-dynamodb-anatomy');
    until(r, 10_000);
    expect(r.snapshot().system.availability).toBeGreaterThan(99.5);
    expect(g(r, 'dax', 'hitRatio')).toBeGreaterThan(60);
    expect(g(r, 'router', 'partitions')).toBe(3);
    expect(has(r, '2 of 3 copies durable')).toBe(true);
    expect(r.protocol().some((p: any) => p.kind === 'dynamo.gsi-put')).toBe(true);
  });

  test('hot key: adaptive capacity, 429 at the partition limit, split for heat, then stuck', () => {
    const r = run('tech-dynamodb-hot-partition');
    until(r, 5000);
    expect(g(r, 'router', 'throttled')).toBe(0);
    r.fire({ kind: 'traffic', action: 'hot-key', params: { hot: 0.6 }, durationSec: 90 } as any);
    until(r, 8000);
    expect(g(r, 'router', 'throttled')).toBeGreaterThan(0);
    expect(g(r, 'router', 'hotPartitionWcu')).toBe(1000);
    expect(has(r, 'adaptive capacity')).toBe(true);
    until(r, 45_000);
    expect(has(r, 'split for heat:')).toBe(true);
    expect(has(r, "can't help")).toBe(true);
    expect(g(r, 'router', 'throttled')).toBeGreaterThan(0);
  });

  test('GSI back-pressure throttles base writes and GSI reads go stale', () => {
    const r = run('tech-dynamodb-gsi');
    until(r, 5000);
    r.fire({ kind: 'traffic', action: 'burst', params: { x: 3 }, durationSec: 30 } as any);
    until(r, 20_000);
    expect(g(r, 'gsi', 'lagMs')).toBeGreaterThan(2000);
    expect(has(r, 'GSI back-pressure')).toBe(true);
    expect(av(r, 'router')).toBeLessThan(95);
    expect(r.snapshot().anomalies['stale-read']).toBeGreaterThan(0);
  });

  test('on-demand: burst over 2× peak throttles until the peak ramps', () => {
    const r = run('tech-dynamodb-on-demand');
    until(r, 5000);
    r.fire({ kind: 'traffic', action: 'burst', params: { x: 4 }, durationSec: 40 } as any);
    until(r, 7000);
    expect(av(r, 'router')).toBeLessThan(90);
    until(r, 25_000);
    expect(av(r, 'router')).toBeGreaterThan(99);
    expect(g(r, 'router', 'capWcu')).toBeGreaterThan(2000);
  });

  test('transactions conflict on a hot item', () => {
    const r = run('tech-dynamodb-txn');
    until(r, 5000);
    const base = g(r, 'router', 'conflicts');
    r.fire({ kind: 'traffic', action: 'hot-key', params: { hot: 0.5 }, durationSec: 40 } as any);
    until(r, 10_000);
    expect(g(r, 'router', 'conflicts')).toBeGreaterThan(Math.max(30, base * 4));
    expect(has(r, 'TransactionCanceledException')).toBe(true);
  });
});

describe('composite skins expand and run', () => {
  const doc = (skin: string, type: string) => ({
    schemaVersion: 1,
    id: 'c',
    name: 'c',
    nodes: [
      { id: 'users', type: 'web-client', name: 'u', pos: { x: 0, y: 0 } },
      { id: 'x', type, skin, name: skin, pos: { x: 0, y: 100 } },
    ],
    edges: [{ id: 'e', from: 'users', to: 'x' }],
    containers: [],
    scenario: { durationSec: 30, sources: [{ id: 's', node: 'users', shape: { kind: 'constant', rps: 300 }, readRatio: 0.7 }], events: [] },
  });
  test.each([
    ['cassandra-ring', 'kv-store', 'x/n1', 'commitlogOps'],
    ['elasticsearch-cluster', 'search-index', 'x/d1', 'refreshes'],
    ['dynamodb-table', 'kv-store', 'x/router', 'usedWcu'],
  ])('%s', (skin, type, inner, gauge) => {
    const r = run(doc(skin, type));
    until(r, 15_000);
    expect(r.snapshot().system.availability).toBeGreaterThan(99);
    expect(g(r, inner, gauge)).toBeGreaterThan(0);
  });
});
