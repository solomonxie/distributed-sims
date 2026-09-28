import { createRun } from '../src';
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

describe('edge keepAlive', () => {
  const kaDoc = (cfg: object) =>
    doc(
      [node('c', 'web-client'), node('app', 'service', { p50Ms: 1, p99Ms: 2 }), node('api', 'service', { p50Ms: 1, p99Ms: 2 })],
      [edge('c', 'app', { latencyMs: 1 }), edge('app', 'api', { latencyMs: 20, ...cfg })],
    );
  const p50 = (cfg: object) => {
    const r = run(kaDoc(cfg));
    r.step(5000);
    const pts = r.series('app->api').slice(1);
    return pts.reduce((a, p) => a + p.p50, 0) / pts.length;
  };

  test('new connection per call pays handshake round trips', () => {
    const reuse = p50({});
    const fresh = p50({ keepAlive: false });
    const tls12 = p50({ keepAlive: false, handshakeRtts: 3 });
    expect(reuse).toBeGreaterThan(35);
    expect(reuse).toBeLessThan(60);
    expect(fresh - reuse).toBeGreaterThan(65);
    expect(fresh - reuse).toBeLessThan(100);
    expect(tls12 - fresh).toBeGreaterThan(30);
  });

  test('keepAlive default leaves runs unchanged', () => {
    const a = run(kaDoc({}));
    const b = run(kaDoc({ keepAlive: true }));
    a.step(3000);
    b.step(3000);
    expect(a.series('system')).toEqual(b.series('system'));
  });
});

describe('failover balancing (vpn-gateway)', () => {
  test('uses the first target only, then the next healthy one', () => {
    const d = doc(
      [
        node('c', 'web-client'),
        node('gw', 'vpn-gateway', { algorithm: 'failover', layer: 'L4', healthIntervalMs: 1000, unhealthyThreshold: 2 }),
        node('t1', 'vpn-tunnel'),
        node('t2', 'vpn-tunnel'),
      ],
      [edge('c', 'gw'), edge('gw', 't1', { timeoutMs: 500 }), edge('gw', 't2', { timeoutMs: 500 })],
    );
    const r = run(d);
    r.step(4000);
    expect(r.snapshot().nodes.t2.rps).toBe(0);
    expect(r.snapshot().nodes.t1.rps).toBeGreaterThan(150);
    r.fire({ kind: 'kill', target: 't1' });
    r.step(8000);
    expect(r.events().some(e => e.text.includes('t1 marked unhealthy'))).toBe(true);
    expect(r.snapshot().nodes.t2.rps).toBeGreaterThan(150);
    expect(r.snapshot().nodes.c.errRate).toBe(0);
  });
});

describe('nat-gateway', () => {
  const natDoc = (keepAlive: boolean) =>
    doc(
      [node('c', 'web-client'), node('app', 'service', { instances: 4 }), node('nat', 'nat-gateway', { portsPerDest: 1000, portHoldSec: 60 }), node('api', 'external-api', { quotaRps: 100000, availabilityPct: 100, p50Ms: 20, p99Ms: 40 })],
      [edge('c', 'app'), edge('app', 'nat', { keepAlive }), edge('nat', 'api')],
      { sources: [{ id: 's', node: 'c', shape: { kind: 'constant', rps: 500 } }] },
    );

  test('new connection per call exhausts ports; errors until ports free', () => {
    const r = run(natDoc(false));
    r.step(1500);
    expect(r.snapshot().nodes.nat.errRate).toBe(0);
    r.step(5000);
    const s = r.snapshot().nodes;
    expect(s.nat.gauges.portsUsed).toBe(1000);
    expect(s.nat.gauges.portErrors).toBeGreaterThan(300);
    expect(s.c.errRate).toBeGreaterThan(0.9);
    expect(r.events().some(e => e.text.includes('ErrorPortAllocation'))).toBe(true);
  });

  test('pooled callers hold ports only while in use', () => {
    const r = run(natDoc(true));
    r.step(6000);
    const s = r.snapshot().nodes;
    expect(s.nat.gauges.portsUsed).toBeLessThan(100);
    expect(s.c.errRate).toBe(0);
  });
});
