import { createRun } from '../src';
import type { Run } from '../src';
import { doc, edge, node, testCatalog } from './fixtures';

const run = (d: ReturnType<typeof doc>, seed = 1) => {
  const r = createRun(d, { catalog: testCatalog, seed });
  const step = r.step.bind(r);
  r.step = (until: number) => {
    while (!step(until));
    return true;
  };
  return r;
};
const sum = (r: Run, id: string, from: number, to: number, f: (p: any) => number = p => p.rps) =>
  r.series(id).filter(p => p.t >= from && p.t < to).reduce((a, p) => a + f(p), 0);

/** Deliver `count` single requests straight to `to` at time `at` (spread over `spreadMs`). */
function inject(r: Run, to: string, at: number, count: number, spreadMs: number, out: { ok: number; rej: number }, extra = {}) {
  const w = r.world;
  for (let i = 0; i < count; i++) {
    w.kernel.at(at + (spreadMs * i) / count, () =>
      w.deliver(w.newMsg({ from: 'c', to, op: 'read', key: i % 1024, ...extra }), rep => (rep.ok ? out.ok++ : rep.err === '429' && out.rej++)),
    );
  }
}

const noTraffic = { sources: [] };

describe('load-balancer', () => {
  const lbDoc = (algorithm: string, slow = false) =>
    doc(
      [
        node('c', 'web-client'),
        node('lb', 'load-balancer', { algorithm, healthIntervalMs: 1000, unhealthyThreshold: 2, instances: 2, slots: 1000 }),
        node('s1', 'service', { instances: 4, slots: 64 }),
        node('s2', 'service', { instances: 4, slots: 64 }),
        node('s3', 'service', slow ? { instances: 4, slots: 64, p50Ms: 200, p99Ms: 400 } : { instances: 4, slots: 64 }),
      ],
      [edge('c', 'lb'), edge('lb', 's1'), edge('lb', 's2'), edge('lb', 's3', { timeoutMs: 1000 })],
      { sources: [{ id: 's', node: 'c', shape: { kind: 'constant', rps: 300 } }] },
    );

  test('round-robin distributes evenly and skips a dead target after health checks', () => {
    const r = run(lbDoc('round-robin'));
    r.step(5000);
    const share = ['s1', 's2', 's3'].map(id => sum(r, id, 1, 5));
    for (const s of share) expect(s / share.reduce((a, b) => a + b)).toBeCloseTo(1 / 3, 1);
    r.fire({ kind: 'kill', target: 's3' });
    r.step(12_000);
    expect(r.snapshot().nodes.lb.badges.some(b => b.text === '2/3 healthy')).toBe(true);
    expect(sum(r, 's3', 8, 12)).toBe(0);
    const late = r.series('system').filter(p => p.t >= 8 && p.t < 12);
    expect(Math.max(...late.map(p => p.errRate))).toBeLessThan(0.01);
    expect(sum(r, 's1', 8, 12)).toBeGreaterThan(500);
  });

  test('least-conn sends less to a slow backend than round-robin', () => {
    const measure = (algo: string) => {
      const r = run(lbDoc(algo, true), 3);
      r.step(10_000);
      const slow = sum(r, 's3', 2, 10);
      const all = slow + sum(r, 's1', 2, 10) + sum(r, 's2', 2, 10);
      const p99 = r.series('system').filter(p => p.t >= 2).reduce((a, p) => a + p.p99, 0) / 8;
      return { share: slow / all, p99 };
    };
    const rr = measure('round-robin');
    const lc = measure('least-conn');
    expect(rr.share).toBeCloseTo(1 / 3, 1);
    expect(lc.share).toBeLessThan(rr.share / 2);
    expect(lc.p99).toBeLessThan(rr.p99);
  });
});

describe('rate-limiter', () => {
  const rl = (cfg: Record<string, unknown>, withStore = false) =>
    doc(
      [node('c', 'web-client'), node('rl', 'rate-limiter', { slots: 10_000, ...cfg }), node('api', 'service', { instances: 10, slots: 100 }), ...(withStore ? [node('redis', 'cache')] : [])],
      [edge('c', 'rl'), edge('rl', 'api'), ...(withStore ? [edge('rl', 'redis')] : [])],
      noTraffic,
    );

  test('token bucket passes a burst up to the bucket size then 429s', () => {
    const r = run(rl({ algorithm: 'token-bucket', limit: 10, burst: 50 }));
    const out = { ok: 0, rej: 0 };
    inject(r, 'rl', 1000, 200, 10, out);
    r.step(3000);
    expect(out.ok).toBeGreaterThanOrEqual(50);
    expect(out.ok).toBeLessThanOrEqual(52);
    expect(out.rej).toBe(200 - out.ok);
    expect(r.snapshot().nodes.rl.badges.some(b => b.text.startsWith('token'))).toBe(true);
  });

  test('fixed window admits ~2x the limit across a window boundary; sliding log does not', () => {
    const admitted = (algorithm: string) => {
      const r = run(rl({ algorithm, limit: 100, windowMs: 1000 }));
      const out = { ok: 0, rej: 0 };
      inject(r, 'rl', 1800, 400, 400, out); // 1.8s .. 2.2s straddles the 2s boundary
      r.step(4000);
      return out.ok;
    };
    const fixed = admitted('fixed-window');
    const log = admitted('sliding-window-log');
    const counter = admitted('sliding-window-counter');
    expect(fixed).toBeGreaterThanOrEqual(190);
    expect(log).toBeLessThanOrEqual(101);
    expect(counter).toBeLessThan(fixed * 0.8);
  });

  test('local limiter with 3 instances over-admits vs a shared store', () => {
    const admitted = (store: string) => {
      const r = run(rl({ algorithm: 'fixed-window', limit: 100, instances: 3, store }, true));
      const out = { ok: 0, rej: 0 };
      inject(r, 'rl', 1000, 1000, 1000, out, { tenant: 'a' });
      r.step(4000);
      return out;
    };
    const local = admitted('local');
    const shared = admitted('shared');
    expect(shared.ok).toBeLessThanOrEqual(101);
    expect(local.ok).toBeGreaterThan(250);
  });
});

describe('cdn', () => {
  const cdnDoc = (cacheablePct: number) =>
    doc(
      [node('c', 'web-client'), node('cdn', 'cdn', { cacheablePct, ttlSec: 300, pops: 4, slots: 10_000 }), node('origin', 'service', { instances: 8, slots: 64 })],
      [edge('c', 'cdn'), edge('cdn', 'origin')],
      { sources: [{ id: 's', node: 'c', shape: { kind: 'constant', rps: 500 }, readRatio: 1 }] },
    );

  test('hit ratio cuts origin load and a cache flush spikes it', () => {
    const none = run(cdnDoc(0));
    none.step(10_000);
    const baseline = sum(none, 'origin', 6, 10) / 4;
    const r = run(cdnDoc(90));
    r.step(10_000);
    const warm = sum(r, 'origin', 6, 10) / 4;
    expect(baseline).toBeGreaterThan(400);
    expect(warm).toBeLessThan(baseline * 0.25);
    expect(r.snapshot().nodes.cdn.gauges.hitRatio).toBeGreaterThan(0.8);
    r.fire({ kind: 'cache-flush', target: 'cdn' });
    r.step(12_000);
    const spike = sum(r, 'origin', 10, 11);
    expect(spike).toBeGreaterThan(warm * 3);
  });
});

describe('api-gateway', () => {
  const gw = (withIdp: boolean) =>
    doc(
      [node('c', 'web-client'), node('gw', 'api-gateway', { slots: 1000 }), node('api', 'service'), ...(withIdp ? [node('idp', 'identity-provider')] : [])],
      [edge('c', 'gw'), edge('gw', 'api'), ...(withIdp ? [edge('gw', 'idp')] : [])],
      { sources: [{ id: 's', node: 'c', shape: { kind: 'constant', rps: 200 }, expiredAuth: 0.3 }] },
    );

  test('rejects expired auth unless an IdP is wired in', () => {
    const errs = (withIdp: boolean) => {
      const r = run(gw(withIdp));
      r.step(6000);
      const auth = sum(r, 'gw', 1, 6, p => p.errs.auth ?? 0);
      const total = sum(r, 'gw', 1, 6);
      return auth / total;
    };
    expect(errs(false)).toBeGreaterThan(0.2);
    expect(errs(false)).toBeLessThan(0.4);
    expect(errs(true)).toBe(0);
  });

  test('built-in rate limit returns 429 and single instance is a SPOF', () => {
    const d = gw(false);
    d.nodes[1].config = { slots: 1000, rateLimitRps: 50, authCheck: false };
    const r = run(d);
    r.step(5000);
    expect(sum(r, 'gw', 2, 5, p => p.errs['429'] ?? 0)).toBeGreaterThan(300);
    expect(r.snapshot().nodes.gw.badges.some(b => b.text === 'SPOF')).toBe(true);
  });
});

describe('dns', () => {
  test('failover waits for health checks and TTL before moving traffic', () => {
    const d = doc(
      [
        node('c', 'web-client'),
        node('dns', 'dns', { routing: 'failover', ttlSec: 10, healthIntervalMs: 1000, unhealthyThreshold: 3, slots: 1000 }),
        node('primary', 'service'),
        node('secondary', 'service'),
      ],
      [edge('c', 'dns'), edge('dns', 'primary', { timeoutMs: 500 }), edge('dns', 'secondary')],
    );
    const r = run(d);
    r.step(5000);
    expect(sum(r, 'secondary', 1, 5)).toBe(0);
    r.fire({ kind: 'kill', target: 'primary' });
    r.step(30_000);
    // still failing a few seconds after the kill (cached answer), recovered after TTL
    expect(r.series('system').find(p => p.t === 7)!.errRate).toBeGreaterThan(0.5);
    expect(r.series('system').slice(-3).every(p => p.errRate < 0.01)).toBe(true);
    expect(sum(r, 'secondary', 25, 30)).toBeGreaterThan(500);
  });

  test('dns-failure only hurts once cached answers expire', () => {
    const d = doc(
      [node('c', 'web-client'), node('dns', 'dns', { ttlSec: 5, slots: 1000 }), node('api')],
      [edge('c', 'dns'), edge('dns', 'api')],
    );
    const r = run(d);
    r.step(3000);
    r.fire({ kind: 'dns-failure', target: 'dns', durationSec: 20 });
    r.step(12_000);
    expect(r.series('system').find(p => p.t === 3)!.errRate).toBeLessThan(0.01);
    expect(r.snapshot().nodes.dns.badges.some(b => b.text === 'SERVFAIL')).toBe(true);
    expect(r.series('system').slice(-2).every(p => p.errRate > 0.9)).toBe(true);
  });
});

describe('waf + sidecar', () => {
  test('waf blocks at its block rate with 403', () => {
    const d = doc([node('c', 'web-client'), node('waf', 'waf', { blockPct: 10, slots: 1000 }), node('api')], [edge('c', 'waf'), edge('waf', 'api')]);
    const r = run(d);
    r.step(6000);
    const frac = sum(r, 'waf', 1, 6, p => p.errs.auth ?? 0) / sum(r, 'waf', 1, 6);
    expect(frac).toBeGreaterThan(0.05);
    expect(frac).toBeLessThan(0.15);
  });

  test('sidecar retries and ejects a failing endpoint', () => {
    const d = doc(
      [node('c', 'web-client'), node('sc', 'service-mesh-sidecar', { slots: 1000, retries: 2 }), node('a'), node('b')],
      [edge('c', 'sc'), edge('sc', 'a'), edge('sc', 'b')],
    );
    const r = run(d);
    r.step(2000);
    r.fire({ kind: 'bad-deploy', target: 'b', params: { errPct: 100 } });
    r.step(8000);
    expect(r.snapshot().nodes.sc.badges.some(b => b.text.includes('ejected'))).toBe(true);
    expect(r.series('system').slice(-3).every(p => p.errRate < 0.01)).toBe(true);
    expect(sum(r, 'b', 5, 8)).toBeLessThan(10);
  });
});
