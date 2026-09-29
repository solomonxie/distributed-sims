import { createRun } from '../src';
import type { KeyDist } from '../src/types';
import { doc, edge, node, testCatalog } from './fixtures';

const cached = (cfg: Record<string, unknown>, rps = 400, readRatio = 0.9, keys?: KeyDist, dbCfg: Record<string, unknown> = {}) =>
  doc(
    [node('c', 'web-client'), node('cache', 'cache', cfg), node('db', 'relational-db', { replicas: 0, slots: 200, queueLimit: 100000, ...dbCfg })],
    [edge('c', 'cache', { timeoutMs: 5000 }), edge('cache', 'db', { timeoutMs: 5000 })],
    { sources: [{ id: 's', node: 'c', shape: { kind: 'constant', rps }, readRatio, keys }] },
  );

const dbLoad = (r: ReturnType<typeof createRun>) => r.series('db').reduce((a, p) => a + p.rps, 0);

test('hit ratio climbs from cold and DB load falls', () => {
  const r = createRun(cached({ capacityKeys: 512 }), { catalog: testCatalog, seed: 1 });
  r.step(1500);
  const early = r.series('cache')[0].gauges.hitRatio;
  const earlyDb = r.series('db')[0].rps;
  r.step(15_000);
  const late = r.snapshot().nodes.cache.gauges.hitRatio;
  expect(late).toBeGreaterThan(early + 10);
  expect(late).toBeGreaterThan(70);
  expect(r.snapshot().nodes.db.rps).toBeLessThan(earlyDb);
});

test('stampede: hot key expiry hammers the DB without coalescing', () => {
  const load = (coalescing: boolean) => {
    const r = createRun(cached({ ttlSec: 2, coalescing }, 1500, 1, { kind: 'hot', hot: 1 }, { p50Ms: 100, p99Ms: 150 }), { catalog: testCatalog, seed: 2 });
    r.step(12_000);
    return dbLoad(r);
  };
  expect(load(false)).toBeGreaterThan(load(true) * 20);
});

test('write-behind crash loses acknowledged writes; write-through does not', () => {
  const lost = (strategy: string) => {
    const r = createRun(cached({ strategy, flushMs: 5000 }, 300, 0.5), { catalog: testCatalog, seed: 3 });
    r.step(3500);
    r.fire({ kind: 'kill', target: 'cache' });
    r.step(5000);
    return r.snapshot().anomalies['lost-write'] ?? 0;
  };
  expect(lost('write-behind')).toBeGreaterThan(0);
  expect(lost('write-through')).toBe(0);
});

test('no invalidation serves stale reads; delete-on-write mostly fixes it', () => {
  const stale = (invalidation: string) => {
    const r = createRun(cached({ invalidation, ttlSec: 300 }, 400, 0.8), { catalog: testCatalog, seed: 4 });
    r.step(10_000);
    return r.snapshot().anomalies['stale-read'] ?? 0;
  };
  const none = stale('none');
  expect(none).toBeGreaterThan(0);
  expect(none).toBeGreaterThan(stale('delete-on-write') * 5);
});

test('LRU evicts under capacity; cache-flush empties it', () => {
  const r = createRun(cached({ capacityKeys: 64, eviction: 'lru' }, 400, 1, { kind: 'uniform' }), { catalog: testCatalog, seed: 5 });
  r.step(5000);
  expect(r.snapshot().nodes.cache.gauges.keys).toBe(64);
  expect(r.snapshot().nodes.cache.gauges.hitRatio).toBeLessThan(15);
  r.fire({ kind: 'cache-flush', target: 'cache' });
  expect(r.snapshot().nodes.cache.badges[1].text).toBe('LRU 0/64');
});

test('cache-aside: the service takes the miss, reads the store and fills the cache; the cache never calls the store', () => {
  const d = doc(
    [node('c', 'web-client'), node('api', 'service'), node('cache', 'cache', { capacityKeys: 512, ttlSec: 300 }), node('db', 'relational-db', { replicas: 0, slots: 200, queueLimit: 100000 })],
    [edge('c', 'api', { timeoutMs: 5000 }), edge('api', 'cache', { timeoutMs: 5000 }), edge('api', 'db', { timeoutMs: 5000 })],
    { sources: [{ id: 's', node: 'c', shape: { kind: 'constant', rps: 300 }, readRatio: 0.9, keys: { kind: 'zipf', s: 0.9 } }] },
  );
  const r = createRun(d, { catalog: testCatalog, seed: 7 });
  r.step(1500);
  const earlyDb = r.series('db')[0].rps;
  r.step(15_000);
  expect(r.snapshot().nodes.cache.gauges.hitRatio).toBeGreaterThan(70);
  expect(r.snapshot().nodes.db.rps).toBeLessThan(earlyDb);
  // a traced read that missed: api → cache (miss) → api → db → api → cache (SET), never cache → db
  const tr = r.traces().find(t => t.end !== undefined && t.spans.some(s => s.node === 'db'));
  expect(tr).toBeDefined();
  const fl = r.world.traceFlights.get(tr!.id) ?? [];
  expect(fl.some(f => f.from === 'cache' && f.to === 'db')).toBe(false);
  expect(fl.some(f => f.from === 'api' && f.to === 'db')).toBe(true);
  expect(fl.some(f => f.from === 'api' && f.to === 'cache' && f.msg?.op === 'write')).toBe(true);
});
