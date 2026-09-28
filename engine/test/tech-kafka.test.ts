import { createRun } from '../src';
import { kafkaCluster } from '../src/behaviors/tech-kafka';
import { doc, edge, node, testCatalog } from './fixtures';

interface Opts {
  prod?: Record<string, unknown>;
  ctrl?: Record<string, unknown>;
  cons?: Record<string, unknown>;
  rps?: number;
}

const cluster = (o: Opts = {}) =>
  doc(
    [
      node('c', 'web-client'),
      node('prod', 'kafka-producer', o.prod ?? {}),
      node('b1', 'kafka-broker'),
      node('b2', 'kafka-broker'),
      node('b3', 'kafka-broker'),
      node('ctrl', 'kraft-controller', o.ctrl ?? {}),
      node('c1', 'kafka-consumer', { slots: 1, ...(o.cons ?? {}) }),
      node('c2', 'kafka-consumer', { slots: 1, ...(o.cons ?? {}) }),
    ],
    [edge('c', 'prod')],
    { sources: [{ id: 's', node: 'c', shape: { kind: 'constant', rps: o.rps ?? 1000 }, readRatio: 0 }] },
  );

const run = (o?: Opts, seed = 1) => createRun(cluster(o), { catalog: testCatalog, seed });
const logged = (r: ReturnType<typeof run>, s: string) => r.events().filter(e => e.text.includes(s)).length;

test('steady state: leaders spread, full ISR, HW advances, group assigned, protocol visible', () => {
  const r = run();
  r.step(6000, 1e9);
  const k = kafkaCluster(r.world)!;
  expect(k.parts.map(p => p.leader)).toEqual(['b1', 'b2', 'b3', 'b1', 'b2', 'b3']);
  expect(k.parts.every(p => p.isr.size === 3 && p.hw > 100)).toBe(true);
  const s = r.snapshot();
  expect(s.system.availability).toBeGreaterThan(99.5);
  expect(s.nodes.c1.gauges.processed + s.nodes.c2.gauges.processed).toBeGreaterThan(4000);
  expect(s.nodes.c1.gauges.lag).toBeLessThan(200);
  const kinds = new Set(r.protocol().map(p => p.kind));
  for (const kd of ['kafka.Produce', 'kafka.Fetch', 'kafka.Heartbeat', 'kafka.OffsetCommit', 'kafka.BrokerHeartbeat']) expect(kinds).toContain(kd);
  expect(logged(r, 'generation 1: c1→P0,P2,P4 · c2→P1,P3,P5')).toBe(1);
  expect(s.anomalyTotal).toBe(0);
});

test('kill a partition leader: controller elects from the ISR, acks=all loses nothing', () => {
  const r = run();
  r.step(4000, 1e9);
  r.fire({ kind: 'kill-leader', target: 'b1' });
  r.step(12000, 1e9);
  const k = kafkaCluster(r.world)!;
  expect(k.parts.every(p => p.leader && p.leader !== 'b1')).toBe(true);
  expect(logged(r, 'Elected leader P0')).toBe(1);
  expect(r.snapshot().anomalies['lost-write'] ?? 0).toBe(0);
  expect(r.snapshot().system.availability).toBeGreaterThan(99);
});

test('acks=1 with lagging followers: leader failover loses acknowledged records', () => {
  const r = run({ prod: { acks: '1' } });
  r.step(3000, 1e9);
  r.fire({ kind: 'replica-lag', target: 'b2', params: { ms: 1500 } });
  r.fire({ kind: 'replica-lag', target: 'b3', params: { ms: 1500 } });
  r.step(6000, 1e9);
  r.fire({ kind: 'kill', target: 'b1' });
  r.step(10000, 1e9);
  expect(r.snapshot().anomalies['lost-write']).toBeGreaterThan(50);
  expect(logged(r, 'acked records lost')).toBeGreaterThan(0);
});

test('slow follower leaves the ISR; with min.insync.replicas=3 acks=all writes fail', () => {
  const r = run({ ctrl: { minInsyncReplicas: 3 } });
  r.step(3000, 1e9);
  r.fire({ kind: 'replica-lag', target: 'b3', params: { ms: 5000 } });
  r.step(11000, 1e9);
  expect(logged(r, 'shrank')).toBeGreaterThan(0);
  expect(logged(r, 'NOT_ENOUGH_REPLICAS')).toBeGreaterThan(0);
  expect(r.snapshot().system.availability).toBeLessThan(80);
});

test('controller loss: data plane keeps going until a broker dies — then nobody elects', () => {
  const r = run();
  r.step(3000, 1e9);
  r.fire({ kind: 'kill', target: 'ctrl' });
  r.step(6000, 1e9);
  expect(r.snapshot().system.availability).toBeGreaterThan(99);
  r.fire({ kind: 'kill', target: 'b2' });
  r.step(11000, 1e9);
  const k = kafkaCluster(r.world)!;
  expect(k.parts[1].leader).toBe('b2');
  expect(r.snapshot().system.availability).toBeLessThan(20);
  r.world.nodes.get('ctrl')!.restart();
  r.step(16000, 1e9);
  expect(k.parts[1].leader).not.toBe('b2');
});

test('unclean election trades acked records for availability', () => {
  const mk = (unclean: boolean) => {
    const r = run({ ctrl: { uncleanElection: unclean, minInsyncReplicas: 1 } });
    r.step(3000, 1e9);
    r.fire({ kind: 'replica-lag', target: 'b2', params: { ms: 8000 } });
    r.fire({ kind: 'replica-lag', target: 'b3', params: { ms: 8000 } });
    r.step(8000, 1e9);
    r.fire({ kind: 'kill', target: 'b1' });
    r.step(12000, 1e9);
    return r;
  };
  const clean = mk(false);
  expect(clean.events().some(e => e.text.includes('P0 OFFLINE'))).toBe(true);
  expect(clean.snapshot().anomalies['lost-write'] ?? 0).toBe(0);
  const dirty = mk(true);
  expect(logged(dirty, 'UNCLEAN')).toBeGreaterThan(0);
  expect(dirty.snapshot().anomalies['lost-write']).toBeGreaterThan(0);
});

test('commit before processing loses records on crash; after processing duplicates them', () => {
  const crash = (commit: string) => {
    const r = run({ cons: { commit, p50Ms: 1.5, p99Ms: 4 } }, 2);
    r.step(5000, 1e9);
    r.fire({ kind: 'kill', target: 'c2' });
    r.step(12000, 1e9);
    return r.snapshot().anomalies;
  };
  const before = crash('before');
  expect(before['lost-write']).toBeGreaterThan(0);
  const after = crash('after');
  expect(after['duplicate']).toBeGreaterThan(0);
  expect(after['lost-write'] ?? 0).toBe(0);
});

test('slow consumer exceeds max.poll.interval → rebalance storm with re-reads', () => {
  const r = run();
  r.step(3000, 1e9);
  r.fire({ kind: 'slow', target: 'c2', params: { x: 10 } });
  r.step(40000, 1e9);
  expect(r.snapshot().nodes.c1.gauges.rebalances).toBeGreaterThanOrEqual(4);
  expect(logged(r, 'max.poll.interval')).toBeGreaterThan(0);
  expect(r.snapshot().anomalies['duplicate']).toBeGreaterThan(0);
});

test('hot key → hot partition: one consumer lags, the other idles', () => {
  const r = run({ rps: 3000, cons: { p50Ms: 0.4, p99Ms: 1.5 } });
  r.step(4000, 1e9);
  r.fire({ kind: 'traffic', action: 'hot-key', params: { hot: 0.6 }, durationSec: 30 });
  r.step(20000, 1e9);
  const s = r.snapshot();
  expect(s.nodes.c1.gauges.lag).toBeGreaterThan(1000);
  expect(s.nodes.c2.gauges.lag).toBeLessThan(200);
});

test('idempotent producer dedupes retried batches', () => {
  const r = run();
  r.step(3000, 1e9);
  r.fire({ kind: 'kill', target: 'b1' });
  r.step(9000, 1e9);
  expect(logged(r, 'duplicate batch')).toBeGreaterThan(0);
  expect(logged(r, 'appended twice')).toBe(0);
});
