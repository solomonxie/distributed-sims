import { createRun } from '../src';
import { doc, edge, node, testCatalog } from './fixtures';

const searchStale = (refreshMs: number) => {
  const d = doc([node('c', 'web-client'), node('es', 'search-index', { refreshMs })], [edge('c', 'es')], {
    sources: [{ id: 's', node: 'c', shape: { kind: 'constant', rps: 300 }, readRatio: 0.5 }],
  });
  const r = createRun(d, { catalog: testCatalog, seed: 1 });
  r.step(8000);
  return r.snapshot().anomalies['stale-read'] ?? 0;
};

test('search refresh window produces stale reads', () => {
  const slow = searchStale(5000);
  expect(slow).toBeGreaterThan(50);
  expect(searchStale(0)).toBe(0);
  expect(searchStale(200)).toBeLessThan(slow / 3);
});

test('search query latency grows with shard fan-out', () => {
  const p99 = (shards: number) => {
    const d = doc([node('c', 'web-client'), node('es', 'search-index', { shards, instances: 8 })], [edge('c', 'es')]);
    const r = createRun(d, { catalog: testCatalog, seed: 2 });
    r.step(6000);
    return r.snapshot().nodes.es.p99;
  };
  expect(p99(20)).toBeGreaterThan(p99(1) * 1.5);
});

test('object store throttles one hot prefix', () => {
  const d = doc([node('c', 'web-client'), node('s3', 'object-store', { getRpsPerPrefix: 500, putRpsPerPrefix: 500, slots: 512 })], [edge('c', 's3')], {
    sources: [{ id: 's', node: 'c', shape: { kind: 'constant', rps: 2000 }, keys: { kind: 'hot', hot: 0.6 } }],
  });
  const r = createRun(d, { catalog: testCatalog, seed: 3 });
  r.step(4000);
  const s = r.snapshot().nodes.s3;
  expect(s.gauges.throttledPrefixes).toBe(1);
  expect(s.gauges.hotPrefix).toBe(0);
  expect(r.series('s3').slice(-1)[0].errs['503']).toBeGreaterThan(300);
});

test('TSDB cardinality burst OOMs', () => {
  const d = doc([node('c', 'web-client'), node('tsdb', 'time-series-db', { cardinality: 200_000, memoryMb: 4096 })], [edge('c', 'tsdb')]);
  const r = createRun(d, { catalog: testCatalog, seed: 3 });
  r.step(2000);
  expect(r.snapshot().nodes.tsdb.up).toBe(true);
  r.fire({ kind: 'cardinality-burst', target: 'tsdb', params: { x: 10 } });
  r.step(3500);
  expect(r.snapshot().nodes.tsdb.up).toBe(false);
});

test('graph traversal cost grows with depth', () => {
  const p50 = (depth: number) => {
    const d = doc([node('c', 'web-client'), node('g', 'graph-db', { depth, slots: 256 })], [edge('c', 'g')], {
      sources: [{ id: 's', node: 'c', shape: { kind: 'constant', rps: 20 } }],
    });
    const r = createRun(d, { catalog: testCatalog, seed: 3 });
    r.step(5000);
    return r.snapshot().nodes.g.p50;
  };
  expect(p50(3)).toBeGreaterThan(p50(1) * 10);
});

const traceDoc = (sampling: string, ingestLimit = 50_000) =>
  doc(
    [node('c', 'web-client'), node('api'), node('db'), node('tc', 'trace-collector', { sampling, sampleRate: 0.1, ingestLimit })],
    [edge('c', 'api'), edge('api', 'db'), edge('api', 'tc', { mode: 'async' })],
  );

test('head sampling misses errors that tail sampling keeps', () => {
  const kept = (sampling: string) => {
    const r = createRun(traceDoc(sampling), { catalog: testCatalog, seed: 5 });
    r.step(1000);
    r.fire({ kind: 'bad-deploy', target: 'db', params: { errPct: 10 } });
    r.step(6000);
    return r.snapshot().nodes.tc.gauges;
  };
  const head = kept('head');
  const tail = kept('tail');
  expect(head.errorsKeptPct).toBeLessThan(20);
  expect(tail.errorsKeptPct).toBe(100);
  expect(head.keptPct).toBeLessThan(15);
});

test('collector drops telemetry on overload', () => {
  const r = createRun(traceDoc('head', 1000), { catalog: testCatalog, seed: 5 });
  r.step(2000);
  expect(r.snapshot().nodes.tc.gauges.droppedPct).toBe(0);
  r.fire({ kind: 'traffic', action: 'burst', params: { x: 20 }, durationSec: 5 });
  r.step(5000);
  expect(r.snapshot().nodes.tc.gauges.droppedPct).toBeGreaterThan(50);
  expect(r.snapshot().system.availability).toBeGreaterThan(95);
});

test('video uploads back up the transcoding pool', () => {
  const d = doc([node('c', 'web-client'), node('o', 'blob-cdn-origin', { transcoders: 4 })], [edge('c', 'o')]);
  const r = createRun(d, { catalog: testCatalog, seed: 5 });
  r.step(5000);
  expect(r.snapshot().nodes.o.gauges.transcodeBacklog).toBeGreaterThan(0);
});
