import { createRun } from '../src';
import { cellIndex } from '../src/behaviors/compute';
import { doc, edge, node, testCatalog } from './fixtures';

const runTo = (r: ReturnType<typeof createRun>, t: number) => {
  while (!r.step(t, 200_000));
};

const p99Over = (r: ReturnType<typeof createRun>, id: string, from: number, to: number) =>
  Math.max(...r.series(id).filter(p => p.t >= from && p.t < to).map(p => p.p99));

test('autoscale adds instances under load and p99 recovers', () => {
  const api = { instances: 1, slots: 4, p50Ms: 20, p99Ms: 40, queueLimit: 5000, autoscale: true, targetUtil: 60, minInstances: 1, maxInstances: 12, scaleUpDelaySec: 5, autoscaleEvalSec: 2, cooldownSec: 120 };
  const d = doc([node('c', 'web-client'), node('api', 'service', api)], [edge('c', 'api', { timeoutMs: 30000 })], {
    sources: [{ id: 's', node: 'c', shape: { kind: 'constant', rps: 400 } }],
  });
  const r = createRun(d, { catalog: testCatalog, seed: 4 });
  runTo(r, 6000);
  const early = p99Over(r, 'api', 2, 6);
  runTo(r, 60_000);
  expect(r.world.nodes.get('api')!.instances).toBeGreaterThanOrEqual(4);
  const late = p99Over(r, 'api', 50, 60);
  expect(early).toBeGreaterThan(200);
  expect(late).toBeLessThan(100);

  const fixed = createRun({ ...d, nodes: d.nodes.map(n => (n.id === 'api' ? { ...n, config: { ...api, autoscale: false } } : n)) }, { catalog: testCatalog, seed: 4 });
  runTo(fixed, 60_000);
  expect(fixed.world.nodes.get('api')!.instances).toBe(1);
  expect(p99Over(fixed, 'api', 50, 60)).toBeGreaterThan(late * 5);
});

test('java GC pauses stretch the tail', () => {
  const mk = (gc: boolean) =>
    doc([node('c', 'web-client'), node('api', 'service', { p50Ms: 5, p99Ms: 10, gcPauses: gc, gcEverySec: 2, gcPauseMs: 150 })], [edge('c', 'api')]);
  const p99 = (gc: boolean) => {
    const r = createRun(mk(gc), { catalog: testCatalog, seed: 2 });
    runTo(r, 20_000);
    return p99Over(r, 'api', 5, 20);
  };
  expect(p99(true)).toBeGreaterThan(p99(false) * 3);
});

test('serverless cold starts show in p99 and concurrency limit throttles', () => {
  const fn = { p50Ms: 20, p99Ms: 40, coldStartMs: 600, idleSec: 2, concurrency: 1000 };
  const d = doc([node('c', 'web-client'), node('fn', 'serverless-fn', fn)], [edge('c', 'fn')], {
    sources: [{ id: 's', node: 'c', shape: { kind: 'spike-train', base: 5, height: 200, periodSec: 6, widthSec: 1 } }],
  });
  const r = createRun(d, { catalog: testCatalog, seed: 3 });
  runTo(r, 30_000);
  const pts = r.series('fn');
  expect(Math.max(...pts.map(p => p.p99))).toBeGreaterThan(400);
  expect(Math.max(...pts.map(p => p.gauges.coldStarts ?? 0))).toBeGreaterThan(10);
  expect(Math.min(...pts.slice(5).map(p => p.p50 || Infinity))).toBeLessThan(100);

  const lim = doc([node('c', 'web-client'), node('fn', 'serverless-fn', { ...fn, p50Ms: 200, p99Ms: 300, concurrency: 5 })], [edge('c', 'fn')], {
    sources: [{ id: 's', node: 'c', shape: { kind: 'constant', rps: 200 } }],
  });
  const r2 = createRun(lim, { catalog: testCatalog, seed: 3 });
  runTo(r2, 10_000);
  const errs = r2.series('fn').reduce((a, p) => a + (p.errs['429'] ?? 0), 0);
  expect(errs).toBeGreaterThan(500);
  expect(r2.world.nodes.get('fn')!.instances).toBeLessThanOrEqual(5);
});

test('serverless scale-out storms a DB connection limit', () => {
  const d = doc(
    [node('c', 'web-client'), node('fn', 'serverless-fn', { p50Ms: 50, p99Ms: 80, coldStartMs: 300, connsPerInstance: 2 }), node('db', 'service', { maxConnections: 20, p50Ms: 1, p99Ms: 3 })],
    [edge('c', 'fn'), edge('fn', 'db')],
    { sources: [{ id: 's', node: 'c', shape: { kind: 'constant', rps: 600 } }] },
  );
  const r = createRun(d, { catalog: testCatalog, seed: 1 });
  runTo(r, 10_000);
  const refused = r.series('fn').reduce((a, p) => a + (p.errs.refused ?? 0), 0);
  expect(refused).toBeGreaterThan(100);
});

test('cron emits on schedule', () => {
  const d = doc([node('job', 'cron', { scheduleSec: 5, jitterPct: 0, batch: 3, p50Ms: 1, p99Ms: 2 }), node('db')], [edge('job', 'db')], { sources: [] });
  const r = createRun(d, { catalog: testCatalog, seed: 1 });
  runTo(r, 31_000);
  const hits = r.series('db').map(p => p.rps);
  expect(hits.reduce((a, b) => a + b, 0)).toBe(18);
  expect(hits.filter(h => h > 0).length).toBe(6);
});

test('container group: pods beyond node capacity wait for a new node', () => {
  const pods = { instances: 1, slots: 4, p50Ms: 20, p99Ms: 40, queueLimit: 5000, autoscale: true, maxInstances: 12, autoscaleEvalSec: 2, clusterNodes: 1, podsPerNode: 2, maxClusterNodes: 5, nodeProvisionSec: 20, schedulingDelaySec: 1, podStartSec: 2 };
  const d = doc([node('c', 'web-client'), node('k8s', 'container-group', pods)], [edge('c', 'k8s', { timeoutMs: 30000 })], {
    sources: [{ id: 's', node: 'c', shape: { kind: 'constant', rps: 600 } }],
  });
  const r = createRun(d, { catalog: testCatalog, seed: 5 });
  runTo(r, 10_000);
  expect(r.world.nodes.get('k8s')!.instances).toBe(2);
  expect(r.snapshot().nodes.k8s.gauges.unschedulable).toBeGreaterThan(0);
  runTo(r, 45_000);
  expect(r.world.nodes.get('k8s')!.instances).toBeGreaterThan(4);
});

test('cell router isolates a dead cell', () => {
  const tenants = ['acme', 'globex', 'initech', 'umbrella', 'hooli', 'stark'];
  const nodes = [node('c', 'web-client'), node('router', 'cell-router')];
  const edges = [edge('c', 'router')];
  for (const cell of ['a', 'b', 'c']) {
    nodes.push(node(`api-${cell}`, 'service', {}, { parent: `cell-${cell}` }), node(`db-${cell}`, 'service', {}, { parent: `cell-${cell}` }));
    edges.push(edge('router', `api-${cell}`), edge(`api-${cell}`, `db-${cell}`));
  }
  const d = doc(nodes, edges, { sources: [{ id: 's', node: 'c', shape: { kind: 'constant', rps: 300 }, tenants: Object.fromEntries(tenants.map(t => [t, 1])) }] }, {
    containers: ['a', 'b', 'c'].map(c => ({ id: `cell-${c}`, kind: 'cell' as const, name: `Cell ${c}` })),
  });
  const r = createRun(d, { catalog: testCatalog, seed: 8 });
  runTo(r, 3000);
  r.fire({ kind: 'kill', target: 'db-a' });
  runTo(r, 12_000);
  const g = r.snapshot().nodes.router.gauges;
  expect(Math.round(g.blastRadiusPct)).toBe(33);
  const inA = tenants.filter(t => cellIndex(t, 3) === 0);
  const others = tenants.filter(t => cellIndex(t, 3) !== 0);
  expect(inA.length).toBeGreaterThan(0);
  expect(others.length).toBeGreaterThan(0);
  for (const t of inA) expect(g[`tenantErrPct:${t}`]).toBeGreaterThan(90);
  for (const t of others) expect(g[`tenantErrPct:${t}`]).toBe(0);
  expect(r.snapshot().system.availability).toBeGreaterThan(20);
});

test('pool tenant quota protects quiet tenants from a noisy one', () => {
  const mk = (quota: number) =>
    doc([node('c', 'web-client'), node('api', 'service', { instances: 1, slots: 4, p50Ms: 20, p99Ms: 40, queueLimit: 400, tenantQuotaPct: quota })], [edge('c', 'api', { timeoutMs: 10000 })], {
      sources: [{ id: 's', node: 'c', shape: { kind: 'constant', rps: 400 }, tenants: { noisy: 8, quiet: 1 } }],
    });
  const r = createRun(mk(40), { catalog: testCatalog, seed: 6 });
  runTo(r, 10_000);
  const pts = r.series('api').slice(3);
  expect(pts.reduce((a, p) => a + (p.errs['429'] ?? 0), 0)).toBeGreaterThan(100);
  expect(r.snapshot().nodes.api.gauges.topTenantPct).toBeGreaterThan(80);
});
