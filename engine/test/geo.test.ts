import { createRun } from '../src';
import { nearbyCost, settledNodes } from '../src/behaviors/geo';
import { doc, edge, node, testCatalog } from './fixtures';

test('geohash precision trades cells touched vs items scanned', () => {
  const coarse = nearbyCost('geohash', 5, 2, 50);
  const fine = nearbyCost('geohash', 7, 2, 50);
  expect(fine.cells).toBeGreaterThan(coarse.cells * 10);
  expect(coarse.items).toBeGreaterThan(fine.items * 3);
  expect(nearbyCost('quadtree', 6, 2, 5000).cells).toBeGreaterThan(nearbyCost('quadtree', 6, 2, 50).cells);
});

test('dense city saturates the hot geo shard', () => {
  const d = doc([node('c', 'web-client'), node('geo', 'geo-index', { shards: 8, instances: 2, slots: 16 })], [edge('c', 'geo')], {
    sources: [{ id: 's', node: 'c', shape: { kind: 'constant', rps: 1000 } }],
  });
  const r = createRun(d, { catalog: testCatalog, seed: 2 });
  r.step(3000);
  const calm = r.snapshot().nodes.geo;
  expect(calm.errRate).toBe(0);
  r.fire({ kind: 'hot-key', target: 'geo', params: { pct: 0.5, x: 20 } });
  r.step(8000);
  const hot = r.snapshot().nodes.geo;
  expect(hot.gauges.hotShardUtil).toBeGreaterThan(90);
  expect(hot.p99).toBeGreaterThan(calm.p99 * 5);
});

test('routing algorithm cost: CH << A* << Dijkstra', () => {
  expect(settledNodes('contraction-hierarchies', 1e6)).toBeLessThan(settledNodes('a-star', 1e6) / 10);
  expect(settledNodes('a-star', 1e6)).toBeLessThan(settledNodes('dijkstra', 1e6));
  const p50 = (algo: string) => {
    const d = doc([node('c', 'web-client'), node('r', 'routing-engine', { algo, slots: 512 })], [edge('c', 'r')], {
      sources: [{ id: 's', node: 'c', shape: { kind: 'constant', rps: 20 } }],
    });
    const r = createRun(d, { catalog: testCatalog, seed: 1 });
    r.step(4000);
    return r.snapshot().nodes.r.p50;
  };
  expect(p50('dijkstra')).toBeGreaterThan(p50('contraction-hierarchies') * 5);
});

// special.ts
test('CRDT counters diverge under partition and converge after heal', () => {
  const d = doc(
    [node('c1', 'web-client'), node('c2', 'web-client'), node('a', 'crdt-counter'), node('b', 'crdt-counter')],
    [edge('c1', 'a'), edge('c2', 'b')],
    {
      sources: [
        { id: 's1', node: 'c1', shape: { kind: 'constant', rps: 100 }, readRatio: 0.3 },
        { id: 's2', node: 'c2', shape: { kind: 'constant', rps: 100 }, readRatio: 0.3 },
      ],
    },
  );
  const r = createRun(d, { catalog: testCatalog, seed: 9 });
  r.step(2000);
  const id = r.fire({ kind: 'partition', target: 'a', target2: 'b' })!;
  r.step(7000);
  expect(r.snapshot().nodes.a.gauges.divergence).toBeGreaterThan(50);
  r.heal(id);
  r.fire({ kind: 'traffic', action: 'set', params: { rps: 0 } });
  r.step(10_000);
  const s = r.snapshot();
  expect(s.nodes.a.gauges.divergence).toBe(0);
  expect(s.nodes.a.gauges.value).toBe(s.nodes.b.gauges.value);
  expect(s.anomalyTotal).toBe(0);
});

test('external API quota returns 429', () => {
  const d = doc([node('c', 'web-client'), node('api'), node('stripe', 'external-api', { quotaRps: 50, slots: 512 })], [edge('c', 'api'), edge('api', 'stripe')]);
  const r = createRun(d, { catalog: testCatalog, seed: 1 });
  r.step(4000);
  expect(r.series('stripe').slice(-1)[0].errs['429']).toBeGreaterThan(100);
});
