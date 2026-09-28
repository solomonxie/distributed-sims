import { createRun } from '../src';
import { doc, edge, node, testCatalog } from './fixtures';

const run = (d: ReturnType<typeof doc>, seed = 1) => createRun(d, { catalog: testCatalog, seed });
const anomaly = (r: ReturnType<typeof run>, k: string) => r.snapshot().anomalies[k] ?? 0;

const queueDoc = (worker: Record<string, unknown> = {}, q: Record<string, unknown> = {}) =>
  doc(
    [
      node('c', 'web-client'),
      node('q', 'queue', { visibilityMs: 1000, ...q }),
      node('w', 'worker', { batch: 10, p50Ms: 10, p99Ms: 20, ...worker }),
    ],
    [edge('c', 'q'), edge('q', 'w')],
  );

test('queue delivers to worker and drains', () => {
  const r = run(queueDoc());
  r.step(8000);
  const s = r.snapshot();
  expect(s.nodes.w.gauges.processed).toBeGreaterThan(1000);
  expect(s.nodes.q.gauges.depth).toBeLessThan(50);
  expect(s.anomalies.duplicate ?? 0).toBe(0);
  expect(s.anomalies['lost-write'] ?? 0).toBe(0);
  expect(s.anomalies['out-of-order']).toBeGreaterThan(0); // standard queue: best-effort order
});

test('consumer crash before ack → redelivery → duplicates', () => {
  const r = run(queueDoc());
  r.step(3000);
  r.fire({ kind: 'kill', target: 'w', durationSec: 2 });
  r.step(12000);
  expect(anomaly(r, 'duplicate')).toBeGreaterThan(0);
  expect(anomaly(r, 'lost-write')).toBe(0);
});

test('idempotent worker → no duplicates', () => {
  const r = run(queueDoc({ idempotent: true }));
  r.step(3000);
  r.fire({ kind: 'kill', target: 'w', durationSec: 2 });
  r.step(12000);
  expect(anomaly(r, 'duplicate')).toBe(0);
  expect(r.snapshot().nodes.w.gauges.deduped).toBeGreaterThan(0);
});

test('early ack + crash loses in-progress messages', () => {
  const r = run(queueDoc({ ackMode: 'early' }));
  r.step(3000);
  r.fire({ kind: 'kill', target: 'w', durationSec: 2 });
  r.step(8000);
  expect(anomaly(r, 'lost-write')).toBeGreaterThan(0);
});

test('poison message → retries → DLQ after maxReceives', () => {
  const d = doc(
    [
      node('c', 'web-client'),
      node('q', 'queue', { visibilityMs: 500, maxReceives: 3, nackRequeue: true }),
      node('w', 'worker'),
      node('dlq', 'queue'),
    ],
    [edge('c', 'q'), edge('q', 'w'), edge('q', 'dlq', { route: 'dlq' })],
  );
  const r = run(d);
  r.step(1000);
  r.fire({ kind: 'poison-message', target: 'q', params: { pct: 0.05 } });
  r.step(10000);
  const s = r.snapshot();
  expect(s.nodes.q.gauges.dlq).toBeGreaterThan(0);
  expect(s.nodes.dlq.gauges.depth).toBeGreaterThan(0);
  expect(s.nodes.w.gauges.processed).toBeGreaterThan(1000);
});

const streamDoc = (stream: Record<string, unknown>, worker: Record<string, unknown> = {}, rps = 400) =>
  doc(
    [node('c', 'web-client'), node('s', 'log-stream', { partitions: 4, ...stream }), node('w1', 'worker', worker), node('w2', 'worker', worker)],
    [edge('c', 's'), edge('s', 'w1', { route: 'g' }), edge('s', 'w2', { route: 'g' })],
    { sources: [{ id: 's', node: 'c', shape: { kind: 'constant', rps }, keys: { kind: 'uniform', keys: 4 } }] },
  );

test('per-key ordering holds with key partitioning, breaks with round-robin', () => {
  const w = { p50Ms: 5, p99Ms: 60 };
  const byKey = run(streamDoc({ partitionBy: 'key' }, w));
  byKey.step(10000);
  expect(byKey.snapshot().nodes.w1.gauges.processed).toBeGreaterThan(500);
  expect(byKey.snapshot().nodes.w2.gauges.processed).toBeGreaterThan(500);
  expect(anomaly(byKey, 'out-of-order')).toBe(0);
  const rr = run(streamDoc({ partitionBy: 'round-robin' }, w));
  rr.step(10000);
  expect(anomaly(rr, 'out-of-order')).toBeGreaterThan(0);
});

test('consumer lag grows under burst, then drains', () => {
  const d = doc(
    [node('c', 'web-client'), node('s', 'log-stream', { partitions: 3 }), node('w', 'worker', { instances: 1, slots: 2, p50Ms: 5, p99Ms: 10 })],
    [edge('c', 's'), edge('s', 'w')],
    { sources: [{ id: 's', node: 'c', shape: { kind: 'constant', rps: 100 } }] },
  );
  const r = run(d);
  r.step(2000);
  r.fire({ kind: 'traffic', action: 'burst', params: { x: 10 }, durationSec: 3 });
  r.step(5000);
  expect(r.snapshot().nodes.s.gauges.lag).toBeGreaterThan(200);
  r.step(30000);
  expect(r.snapshot().nodes.s.gauges.lag).toBeLessThan(20);
});

test('auto-commit before processing + crash loses messages; after → duplicates instead', () => {
  const mk = (commit: string) => {
    const r = run(streamDoc({ commit }, { p50Ms: 20, p99Ms: 40 }, 200));
    r.step(3000);
    r.fire({ kind: 'kill', target: 'w1', durationSec: 3 });
    r.step(10000);
    return r;
  };
  const before = mk('before');
  expect(anomaly(before, 'lost-write')).toBeGreaterThan(0);
  const after = mk('after');
  expect(anomaly(after, 'lost-write')).toBe(0);
  expect(anomaly(after, 'duplicate')).toBeGreaterThan(0);
});

test('replay from earliest reprocesses → duplicates unless idempotent', () => {
  const mk = (idempotent: boolean) => {
    const r = run(streamDoc({ startFrom: 'earliest' }, { idempotent }, 100));
    r.step(3000);
    r.fire({ kind: 'replay', target: 's' });
    r.step(6000);
    return anomaly(r, 'duplicate');
  };
  expect(mk(false)).toBeGreaterThan(100);
  expect(mk(true)).toBe(0);
});

test('acks=1 loses unreplicated tail on leader kill; acks=all does not', () => {
  const mk = (acks: string) => {
    const r = run(streamDoc({ acks, replicaLagMs: 200 }));
    r.step(3000);
    r.fire({ kind: 'kill-leader', target: 's' });
    r.step(6000);
    return anomaly(r, 'lost-write');
  };
  expect(mk('1')).toBeGreaterThan(0);
  expect(mk('all')).toBe(0);
});

test('pub-sub fans out; a slow subscriber does not block others', () => {
  const d = doc(
    [node('c', 'web-client'), node('t', 'pub-sub'), node('fast', 'worker'), node('slow', 'worker', { instances: 1, slots: 1, p50Ms: 50, p99Ms: 80 })],
    [edge('c', 't'), edge('t', 'fast'), edge('t', 'slow')],
  );
  const r = run(d);
  r.step(8000);
  const s = r.snapshot();
  expect(s.nodes.fast.gauges.processed).toBeGreaterThan(1200);
  expect(s.nodes.slow.gauges.processed).toBeLessThan(s.nodes.fast.gauges.processed / 2);
  expect(s.system.availability).toBeGreaterThan(99);
});

test('outbox relay survives broker outage; dual-write loses events', () => {
  const mk = (mode: string) => {
    const d = doc(
      [node('c', 'web-client'), node('o', 'outbox-relay', { mode, pollMs: 200 }), node('q', 'queue', { visibilityMs: 1000 }), node('w', 'worker')],
      [edge('c', 'o'), edge('o', 'q', { timeoutMs: 300 }), edge('q', 'w')],
    );
    const r = run(d);
    r.step(2000);
    r.fire({ kind: 'kill', target: 'q', durationSec: 2 });
    r.step(12000);
    return r;
  };
  const dual = mk('dual-write');
  expect(anomaly(dual, 'lost-write')).toBeGreaterThan(0);
  const outbox = mk('outbox');
  expect(anomaly(outbox, 'lost-write')).toBe(0);
  expect(outbox.snapshot().nodes.o.gauges.pending).toBeLessThan(50);
});

test('FIFO queue keeps per-key order even across redeliveries', () => {
  const r = run(queueDoc({ batch: 1 }, { ordering: 'fifo' }));
  r.step(3000);
  r.fire({ kind: 'kill', target: 'w', durationSec: 1 });
  r.step(10000);
  expect(anomaly(r, 'out-of-order')).toBe(0);
  expect(r.snapshot().nodes.w.gauges.processed).toBeGreaterThan(1000);
});
