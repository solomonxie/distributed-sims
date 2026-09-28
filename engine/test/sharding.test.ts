import { createRun } from '../src';
import { movedFraction } from '../src/behaviors/sharding';
import { doc, edge, node, testCatalog } from './fixtures';

const S = ['s1', 's2', 's3', 's4'];
const sharded = (cfg: Record<string, unknown>, readRatio = 0, shardCfg: Record<string, Record<string, unknown>> = {}, extra = S) =>
  doc(
    [node('c', 'web-client'), node('r', 'shard-router', cfg), ...extra.map(id => node(id, 'kv-store', shardCfg[id] ?? {}))],
    [edge('c', 'r', { timeoutMs: 5000 }), ...extra.map(id => edge('r', id, { timeoutMs: 5000 }))],
    { sources: [{ id: 's', node: 'c', shape: { kind: 'constant', rps: 400 }, readRatio, keys: { kind: 'uniform' } }] },
  );

const hotPct = (cfg: Record<string, unknown>) => {
  const r = createRun(sharded({ ...cfg, keyPattern: 'sequential' }), { catalog: testCatalog, seed: 1 });
  r.step(6000);
  return r.snapshot().nodes.r.gauges.hotShardPct;
};

test('sequential keys: range map makes one hot shard, hash spreads', () => {
  expect(hotPct({ shardBy: 'range' })).toBeGreaterThan(90);
  expect(hotPct({ shardBy: 'hash' })).toBeLessThan(50);
});

test('consistent hashing moves ~1/N keys on add; mod-hash moves most', () => {
  const ring = movedFraction('consistent-hash', 4, 128);
  expect(ring).toBeGreaterThan(0.1);
  expect(ring).toBeLessThan(0.32);
  expect(movedFraction('hash', 4)).toBeGreaterThan(0.6);

  const r = createRun(sharded({ shardBy: 'consistent-hash', vnodes: 128, activeShards: 4 }, 0.5, {}, [...S, 's5']), { catalog: testCatalog, seed: 2 });
  r.step(2000);
  expect(r.snapshot().edges['r->s5'].rps).toBe(0);
  r.fire({ kind: 'add-shard', target: 'r' });
  r.step(5000);
  const s = r.snapshot();
  expect(s.nodes.r.gauges.movedKeys).toBeGreaterThan(1024 * 0.1);
  expect(s.nodes.r.gauges.movedKeys).toBeLessThan(1024 * 0.32);
  expect(s.edges['r->s5'].rps).toBeGreaterThan(0);
});

test('scatter-gather waits for the slowest shard', () => {
  const run = (slow: boolean) => {
    const r = createRun(sharded({ shardBy: 'hash', scatterPct: 100 }, 1, slow ? { s4: { p50Ms: 80, p99Ms: 120 } } : {}), { catalog: testCatalog, seed: 3 });
    r.step(5000);
    return r.snapshot();
  };
  const fast = run(false);
  const slow = run(true);
  expect(fast.nodes.s1.rps).toBeGreaterThan(300); // every shard sees every query
  expect(slow.nodes.r.p50).toBeGreaterThan(fast.nodes.r.p50 + 60);
});

test('rebalance moves keys from the hot shard over time', () => {
  const r = createRun(sharded({ shardBy: 'range' }, 0.5), { catalog: testCatalog, seed: 4 });
  r.step(3000);
  r.fire({ kind: 'rebalance', target: 'r', params: { sec: 2 } });
  r.step(4000);
  expect(r.snapshot().nodes.r.badges.map(b => b.text)).toContain('rebalancing');
  r.step(9000);
  expect(r.snapshot().nodes.r.gauges.movedKeys).toBeGreaterThan(100);
  expect(r.snapshot().system.availability).toBeGreaterThan(99);
});
