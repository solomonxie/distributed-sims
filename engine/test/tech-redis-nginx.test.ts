import { createRun } from '../src';
import '../src/behaviors/tech-redis';
import '../src/behaviors/tech-nginx';
import { doc, edge, node, testCatalog } from './fixtures';

const redis = (cfg: Record<string, unknown> = {}, o: { replica?: boolean; rps?: number; read?: number } = {}) =>
  createRun(
    doc(
      [
        node('c', 'web-client'),
        node('app', 'service', { instances: 4, slots: 256, p50Ms: 0.2, p99Ms: 1 }),
        node('r1', 'redis-server', cfg),
        ...(o.replica ? [node('r2', 'redis-server', { role: 'replica' })] : []),
      ],
      [edge('c', 'app'), edge('app', 'r1', { timeoutMs: 3000 })],
      { sources: [{ id: 's', node: 'c', shape: { kind: 'constant', rps: o.rps ?? 20000 }, readRatio: o.read ?? 0.8 }] },
    ),
    { catalog: testCatalog, seed: 1 },
  );

const logged = (r: { events(): { text: string }[] }, s: string) => r.events().filter(e => e.text.includes(s)).length;

describe('redis-server', () => {
  test('one thread serves 20k ops/s at sub-ms latency', () => {
    const r = redis();
    r.step(5000, 1e9);
    const s = r.snapshot().nodes.r1;
    expect(s.rps).toBeGreaterThan(18000);
    expect(s.p99).toBeLessThan(1);
    expect(s.util).toBeGreaterThan(0.05);
    expect(s.util).toBeLessThan(0.4);
  });

  test('io-threads raise the ceiling only for the read/parse share', () => {
    const util = (ioThreads: number, mix = 'get-set') => {
      const r = redis({ ioThreads, mix });
      r.step(4000, 1e9);
      return r.snapshot().nodes.r1.util;
    };
    expect(util(4)).toBeLessThan(util(1) * 0.6);
    // heavy commands: exec dominates, io-threads barely help
    expect(util(4, 'lists') / util(1, 'lists')).toBeGreaterThan(0.6);
  });

  test('KEYS * blocks every client behind it', () => {
    const r = redis();
    r.step(3000, 1e9);
    r.fire({ kind: 'slow-command', target: 'r1', durationSec: 20 });
    r.step(5000, 1e9);
    expect(r.snapshot().nodes.r1.p99).toBeGreaterThan(500);
    expect(logged(r, 'KEYS *')).toBeGreaterThan(0);
  });

  test('BGSAVE on a big dataset: fork() stalls the loop, COW copies pages', () => {
    const r = redis({ datasetGb: 50 }, { read: 0.5 });
    r.step(3000, 1e9);
    r.fire({ kind: 'bgsave', target: 'r1' });
    r.step(4000, 1e9);
    expect(r.snapshot().nodes.r1.p99).toBeGreaterThan(300);
    r.step(8000, 1e9);
    expect(r.snapshot().nodes.r1.gauges.cowMb).toBeGreaterThan(50);
  });

  test('appendfsync always pays an fsync per loop pass; a slow disk hurts everyone', () => {
    const r = redis({ appendonly: true, appendfsync: 'always' }, { read: 0.5 });
    r.step(3000, 1e9);
    const before = r.snapshot().nodes.r1.p99;
    r.fire({ kind: 'slow-disk', target: 'r1', params: { x: 20 } });
    r.step(6000, 1e9);
    expect(r.snapshot().nodes.r1.p99).toBeGreaterThan(before * 5);
  });

  test('everysec loses up to a second of writes on crash; always loses none', () => {
    const lost = (appendfsync: string) => {
      const r = redis({ appendonly: true, appendfsync }, { read: 0.5 });
      r.step(3500, 1e9);
      r.fire({ kind: 'kill', target: 'r1' });
      return r.snapshot().anomalies['lost-write'] ?? 0;
    };
    expect(lost('everysec')).toBeGreaterThan(1000);
    expect(lost('always')).toBe(0);
  });

  test('primary dies before replicating → Sentinel promotes the replica, lagging writes lost', () => {
    const r = redis({}, { replica: true, read: 0.5 });
    r.step(2000, 1e9);
    r.fire({ kind: 'replica-lag', target: 'r1', params: { ms: 3000 } });
    r.step(5000, 1e9);
    r.fire({ kind: 'kill', target: 'r1' });
    r.step(10000, 1e9);
    expect(r.snapshot().nodes.r2.badges.some(b => b.text.includes('primary'))).toBe(true);
    expect(r.snapshot().anomalies['lost-write']).toBeGreaterThan(10000);
  });
});

const web = (ng: Record<string, unknown>, ap: Record<string, unknown> = {}, o: { proxy?: boolean; rps?: number } = {}) =>
  createRun(
    doc(
      [
        node('ua', 'web-client'),
        node('ub', 'web-client'),
        node('nginx', 'nginx-server', ng),
        node('apache', 'apache-prefork', ap),
        node('app', 'service', { instances: 4, slots: 64, p50Ms: 5, p99Ms: 20 }),
      ],
      [edge('ua', 'nginx', { timeoutMs: 3000 }), edge('ub', 'apache', { timeoutMs: 3000 }), ...(o.proxy ? [edge('nginx', 'app')] : [])],
      {
        sources: [
          { id: 'a', node: 'ua', shape: { kind: 'constant', rps: o.rps ?? 5000 } },
          { id: 'b', node: 'ub', shape: { kind: 'constant', rps: o.rps ?? 5000 } },
        ],
      },
    ),
    { catalog: testCatalog, seed: 1 },
  );

describe('nginx vs apache prefork', () => {
  test('10k open connections: nginx cheap and fine, prefork runs out of processes', () => {
    const r = web({ clients: 10000, workerConnections: 4096 }, { clients: 10000 });
    r.step(8000, 1e9);
    const s = r.snapshot();
    expect(s.nodes.ua.errRate).toBe(0);
    expect(s.nodes.ub.errRate).toBeGreaterThan(0.5);
    expect(s.nodes.nginx.gauges.memMb).toBeLessThan(100);
    expect(s.nodes.apache.gauges.memMb).toBeGreaterThan(5000);
    expect(s.nodes.apache.gauges.ctxSwitches).toBeGreaterThan(s.nodes.nginx.gauges.ctxSwitches * 20);
  });

  test('sendfile keeps static serving cheap', () => {
    const util = (sendfile: boolean) => {
      const r = web({ sendfile, fileKb: 200 }, {}, { rps: 20000 });
      r.step(3000, 1e9);
      return r.snapshot().nodes.nginx.util;
    };
    expect(util(false)).toBeGreaterThan(util(true) * 5);
  });

  test('a blocking call stalls one worker: ~1/workers of requests fail', () => {
    const r = web({});
    r.step(3000, 1e9);
    r.fire({ kind: 'blocking-call', target: 'nginx' });
    r.step(6000, 1e9);
    const e = r.snapshot().nodes.ua.errRate;
    expect(e).toBeGreaterThan(0.1);
    expect(e).toBeLessThan(0.4);
  });

  test('slowloris: nginx with enough worker_connections shrugs, prefork dies', () => {
    const r = web({ workerConnections: 10240, clients: 100 }, { clients: 100 });
    r.step(3000, 1e9);
    expect(r.snapshot().nodes.ub.errRate).toBe(0);
    r.fire({ kind: 'slowloris', target: 'nginx' });
    r.fire({ kind: 'slowloris', target: 'apache' });
    r.step(6000, 1e9);
    expect(r.snapshot().nodes.ua.errRate).toBe(0);
    expect(r.snapshot().nodes.ub.errRate).toBeGreaterThan(0.9);
  });

  test('upstream without keepalive exhausts ephemeral ports', () => {
    const r = web({ upstreamKeepalive: false }, {}, { proxy: true, rps: 2000 });
    r.step(20000, 1e9);
    expect(r.snapshot().nodes.nginx.gauges.timeWait).toBeGreaterThan(28000);
    expect(r.snapshot().nodes.ua.errRate).toBeGreaterThan(0.5);
    expect(logged(r, 'ephemeral ports')).toBeGreaterThan(0);
  });

  test('graceful reload drops nothing', () => {
    const r = web({}, {}, { proxy: true, rps: 2000 });
    r.step(3000, 1e9);
    r.fire({ kind: 'config-push', target: 'nginx' });
    r.step(6000, 1e9);
    expect(r.series('ua').slice(-4).every(p => p.errRate === 0)).toBe(true);
    expect(logged(r, 'old workers stop accepting')).toBe(1);
  });
});
