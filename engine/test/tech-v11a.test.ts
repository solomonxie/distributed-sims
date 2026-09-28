import * as fs from 'fs';
import { createRun } from '../src';
import '../src/behaviors/tech-flink';
import '../src/behaviors/tech-rabbitmq';
import '../src/behaviors/tech-redis-cluster';
import { topicMatch } from '../src/behaviors/tech-rabbitmq';
import { crc16, keySlot } from '../src/behaviors/tech-redis-cluster';

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
const g = (r: any, id: string, k: string): number => r.snapshot().nodes[id].gauges[k] ?? 0;
const has = (r: any, s: string) => r.events().some((e: any) => e.text.toLowerCase().includes(s.toLowerCase()));
/** step in small increments (run.step may stop early) */
const until = (r: any, ms: number) => {
  while (r.now < ms) r.step(Math.min(ms, r.now + 1000));
};

describe('flink', () => {
  test('job runs: checkpoints complete, windows fire, exactly-once sink commits', () => {
    const r = run('tech-flink-anatomy');
    until(r, 20_000);
    expect(g(r, 'jm', 'checkpoints')).toBeGreaterThanOrEqual(3);
    expect(g(r, 'sink', 'visible')).toBeGreaterThan(0);
    expect(r.snapshot().anomalyTotal).toBe(0);
    expect(r.protocol().some((p: any) => p.kind === 'flink.trigger')).toBe(true);
    expect(has(r, 'committed in txn')).toBe(true);
  });

  test('TaskManager lost: restore from checkpoint + replay; exactly-once no duplicates, at-least-once duplicates', () => {
    const eo = run('tech-flink-anatomy');
    until(eo, 12_000);
    eo.fire({ kind: 'kill', target: 'tm2' });
    until(eo, 30_000);
    expect(has(eo, 'offsets rewound')).toBe(true);
    expect(g(eo, 'jm', 'restarts')).toBe(1);
    expect(g(eo, 'jm', 'running')).toBe(1);
    expect(eo.snapshot().anomalies.duplicate ?? 0).toBe(0);

    const alo = run('tech-flink-at-least-once');
    until(alo, 12_000);
    alo.fire({ kind: 'kill', target: 'tm2' });
    until(alo, 30_000);
    expect(alo.snapshot().anomalies.duplicate).toBeGreaterThan(0);
  });

  test('not enough slots: the job waits for a TaskManager', () => {
    const r = run('tech-flink-anatomy');
    until(r, 6000);
    r.fire({ kind: 'kill', target: 'tm1' });
    r.fire({ kind: 'kill', target: 'tm2' });
    until(r, 15_000);
    expect(has(r, 'not enough task slots')).toBe(true);
    expect(g(r, 'jm', 'running')).toBe(0);
  });

  test('backpressure: slow subtask delays barriers until checkpoints expire', () => {
    const r = run('tech-flink-backpressure');
    until(r, 8000);
    const before = g(r, 'jm', 'checkpointMs');
    r.fire({ kind: 'slow', target: 'tm2', params: { x: 10 } });
    until(r, 40_000);
    expect(before).toBeLessThan(1000);
    expect(g(r, 'jm', 'alignMs')).toBeGreaterThan(2000);
    expect(g(r, 'jm', 'failedCheckpoints')).toBeGreaterThan(0);
    expect(g(r, 'kafka', 'lag')).toBeGreaterThan(1000);
  });

  test('late events are dropped once the watermark passed their window', () => {
    const r = run('tech-flink-late-data');
    until(r, 10_000);
    const base = g(r, 'tm1', 'lateDropped');
    r.fire({ kind: 'clock-skew', target: 'phones', params: { ms: -4000 } });
    until(r, 20_000);
    expect(g(r, 'tm1', 'lateDropped') - base).toBeGreaterThan(50);
  });
});

describe('rabbitmq', () => {
  test('topic matching', () => {
    expect(topicMatch('order.*', 'order.paid')).toBe(true);
    expect(topicMatch('order.*', 'order.paid.eu')).toBe(false);
    expect(topicMatch('#', 'a.b.c')).toBe(true);
    expect(topicMatch('order.#', 'order')).toBe(true);
    expect(topicMatch('*.signup', 'user.signup')).toBe(true);
    expect(topicMatch('user.signup', 'order.paid')).toBe(false);
  });

  test('bindings route copies; consumers ack; no anomalies', () => {
    const r = run('tech-rabbitmq-anatomy');
    until(r, 10_000);
    expect(g(r, 'audit', 'published')).toBeGreaterThan(g(r, 'billing', 'published'));
    expect(g(r, 'mailer', 'published')).toBeGreaterThan(0);
    expect(g(r, 'c-billing', 'processed')).toBeGreaterThan(500);
    expect(r.snapshot().anomalyTotal).toBe(0);
    expect(r.snapshot().system.availability).toBeGreaterThan(99);
  });

  test('node loss: quorum queue keeps messages, unsynchronised mirror loses them; no majority → unavailable', () => {
    const r = run('tech-rabbitmq-node-loss');
    until(r, 10_000);
    r.fire({ kind: 'restart', target: 'rmq2', params: { downSec: 5 } });
    until(r, 18_000);
    r.fire({ kind: 'kill', target: 'rmq1' });
    until(r, 24_000);
    expect(g(r, 'qq', 'lost')).toBe(0);
    expect(g(r, 'qq', 'term')).toBe(2);
    expect(g(r, 'mq', 'lost')).toBeGreaterThan(100);
    r.fire({ kind: 'kill', target: 'rmq2' });
    until(r, 28_000);
    expect(g(r, 'qq', 'available')).toBe(0);
  });

  test('forgotten acks stall at prefetch, consumer_timeout redelivers (duplicates); poison → DLQ via delivery-limit', () => {
    const r = run('tech-rabbitmq-acks');
    until(r, 8000);
    r.fire({ kind: 'bad-deploy', target: 'w1' });
    until(r, 12_000);
    const stuck = g(r, 'w1', 'processed');
    until(r, 20_000);
    expect(g(r, 'w1', 'processed')).toBe(stuck);
    until(r, 26_000);
    expect(r.snapshot().anomalies.duplicate).toBeGreaterThan(0);
    r.fire({ kind: 'poison-message', target: 'jobs', params: { pct: 0.05 } });
    until(r, 40_000);
    expect(g(r, 'dlq', 'ready')).toBeGreaterThan(0);
  });

  test('unroutable: silently dropped without mandatory, returned with it', () => {
    const r = run('tech-rabbitmq-unroutable');
    until(r, 5000);
    r.fire({ kind: 'bad-deploy', target: 'pub-a' });
    r.fire({ kind: 'bad-deploy', target: 'pub-b' });
    until(r, 12_000);
    const s = r.snapshot();
    expect(s.anomalies['lost-write']).toBeGreaterThan(0);
    expect(g(r, 'pub-b', 'returned')).toBeGreaterThan(0);
    expect(1 - s.nodes['users-a'].errRate).toBeGreaterThan(0.99);
    expect(1 - s.nodes['users-b'].errRate).toBeLessThan(0.1);
  });

  test('memory alarm blocks publishers until the backlog drains', () => {
    const r = run('tech-rabbitmq-memory');
    until(r, 5000);
    r.fire({ kind: 'kill', target: 'c', durationSec: 25 });
    until(r, 26_000);
    expect(g(r, 'rmq1', 'alarm')).toBe(1);
    expect(g(r, 'pub', 'blocked')).toBe(1);
    expect(r.snapshot().system.availability).toBeLessThan(50);
    until(r, 50_000);
    expect(g(r, 'rmq1', 'alarm')).toBe(0);
    expect(r.snapshot().system.availability).toBeGreaterThan(99);
  });
});

describe('redis cluster', () => {
  test('CRC16 / hash slots match Redis', () => {
    expect(crc16('123456789')).toBe(0x31c3);
    expect(keySlot('foo')).toBe(12182);
    expect(keySlot('{user1000}.following')).toBe(keySlot('{user1000}.followers'));
    expect(keySlot('foo{}{bar}')).toBe(crc16('foo{}{bar}') % 16384);
    expect(keySlot('foo{bar}{zap}')).toBe(keySlot('bar'));
  });

  test('steady state: one hop, replicas follow, no anomalies', () => {
    const r = run('tech-rediscluster-anatomy');
    until(r, 10_000);
    expect(g(r, 'app', 'moved')).toBe(0);
    expect(g(r, 'rc4', 'offset')).toBeGreaterThan(0);
    expect(r.snapshot().anomalyTotal).toBe(0);
    expect(r.snapshot().system.availability).toBeGreaterThan(99.9);
  });

  test('resharding: slots move with MOVED/ASK redirects and no errors', () => {
    const r = run('tech-rediscluster-reshard');
    until(r, 5000);
    r.fire({ kind: 'rebalance', target: 'rc7', params: { sec: 20 } });
    until(r, 30_000);
    expect(g(r, 'rc7', 'slots')).toBeGreaterThan(4000);
    expect(g(r, 'app', 'moved')).toBeGreaterThan(20);
    expect(g(r, 'app', 'ask')).toBeGreaterThan(0);
    expect(g(r, 'app', 'errors')).toBe(0);
  });

  test('primary killed: PFAIL → FAIL → replica promoted; availability recovers', () => {
    const r = run('tech-rediscluster-anatomy');
    until(r, 8000);
    r.fire({ kind: 'kill', target: 'rc1' });
    until(r, 10_000);
    expect(r.snapshot().system.availability).toBeLessThan(90);
    until(r, 20_000);
    expect(has(r, 'rc-4 won the election')).toBe(true);
    expect(g(r, 'rc4', 'primary')).toBe(1);
    expect(g(r, 'rc4', 'slots')).toBe(5461);
    expect(r.snapshot().system.availability).toBeGreaterThan(99);
  });

  test('minority primary keeps taking writes, which are lost after heal', () => {
    const r = run('tech-rediscluster-split');
    until(r, 5000);
    r.fire({ kind: 'partition', target: 'az-a', target2: 'az-b', durationSec: 15 });
    until(r, 19_000);
    expect(g(r, 'rc4', 'primary')).toBe(1);
    expect(r.snapshot().anomalies['lost-write'] ?? 0).toBe(0);
    until(r, 25_000);
    expect(r.snapshot().anomalies['lost-write']).toBeGreaterThan(0);
    expect(g(r, 'rc1', 'primary')).toBe(0);
  });

  test('CROSSSLOT without hash tags; hot key saturates one node', () => {
    const r = run('tech-rediscluster-keys');
    until(r, 8000);
    const s = r.snapshot();
    expect(g(r, 'app-a', 'crossSlot')).toBeGreaterThan(0);
    expect(g(r, 'app-b', 'crossSlot')).toBe(0);
    expect(1 - s.nodes['app-b'].errRate).toBeGreaterThan(0.99);
    r.fire({ kind: 'traffic', action: 'hot-key', params: { hot: 0.7 }, durationSec: 30 } as any);
    until(r, 14_000);
    const h = r.snapshot();
    expect(h.nodes.rc3.util).toBeGreaterThan(0.9);
    expect(h.nodes.rc1.util).toBeLessThan(0.5);
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
    scenario: { durationSec: 30, sources: [{ id: 's', node: 'users', shape: { kind: 'constant', rps: 200 }, readRatio: 0.5 }], events: [] },
  });
  test.each([
    ['flink', 'flink-source', 'x/jm', 'checkpoints'],
    ['rabbitmq-cluster', 'rabbitmq-exchange', 'x/c-orders', 'processed'],
    ['redis-cluster', 'redis-cluster-client', 'x/rc1', 'opsPerSec'],
  ])('%s', (skin, type, inner, gauge) => {
    const r = run(doc(skin, type));
    until(r, 15_000);
    expect(r.snapshot().system.availability).toBeGreaterThan(99);
    expect(g(r, inner, gauge)).toBeGreaterThan(0);
  });
});
