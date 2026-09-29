import { createRun } from '../src';
import { isLocked, locksHeld } from '../src/behaviors/transactions';
import { doc, edge, node, testCatalog } from './fixtures';

const cat = testCatalog;
const writes = (rps: number, keys = 1024) => ({
  sources: [{ id: 's', node: 'c', shape: { kind: 'constant' as const, rps }, readRatio: 0, keys: { kind: 'uniform' as const, keys } }],
});

const txnDoc = (cfg: Record<string, unknown>, rps = 50, partCfg: Record<string, unknown> = {}) =>
  doc(
    [node('c', 'web-client'), node('coord', 'txn-coordinator', cfg), node('p1', 'service', partCfg), node('p2', 'service', partCfg), node('p3', 'service', partCfg)],
    [edge('c', 'coord', { timeoutMs: 5000 }), edge('coord', 'p1'), edge('coord', 'p2'), edge('coord', 'p3')],
    writes(rps),
  );

test('2PC commits across 3 participants', () => {
  const r = createRun(txnDoc({ protocol: '2pc' }), { catalog: cat, seed: 1 });
  r.step(5000);
  const s = r.snapshot();
  expect(s.nodes.coord.gauges.committed).toBeGreaterThan(150);
  expect(s.nodes.coord.gauges.aborted ?? 0).toBeLessThan(s.nodes.coord.gauges.committed * 0.1);
  expect(s.system.availability).toBeGreaterThan(90);
  const kinds = new Set(r.protocol().map(p => p.kind));
  for (const k of ['txn.prepare', 'txn.prepare.reply', 'txn.commit']) expect(kinds.has(k)).toBe(true);
  expect(r.protocol().filter(p => p.kind === 'txn.prepare').map(p => p.to)).toEqual(expect.arrayContaining(['p1', 'p2', 'p3']));
});

test('coordinator killed after prepare blocks participants until restart', () => {
  const r = createRun(txnDoc({ protocol: '2pc' }, 20), { catalog: cat, seed: 2 });
  r.step(2000);
  const id = r.fire({ kind: 'kill-coordinator', target: 'coord' })!;
  r.step(3000);
  expect(r.snapshot().nodes.coord.up).toBe(false);
  const p1 = r.world.nodes.get('p1')!;
  const stuck = locksHeld(p1);
  expect(stuck.size).toBeGreaterThan(0);
  r.step(8000);
  expect(r.snapshot().nodes.p1.gauges.lockedKeys).toBeGreaterThan(0);
  for (const k of stuck.keys()) expect(isLocked(p1, k)).toBe(true);
  r.heal(id);
  r.step(10_000);
  expect(r.snapshot().nodes.coord.up).toBe(true);
  const after = locksHeld(p1);
  for (const [k, txn] of stuck) expect(after.get(k)).not.toBe(txn);
  expect(r.events().some(e => /presumed abort/.test(e.text))).toBe(true);
});

test('3PC participants time out instead of blocking', () => {
  const r = createRun(txnDoc({ protocol: '3pc', participantTimeoutMs: 1000 }, 20), { catalog: cat, seed: 2 });
  r.step(2000);
  r.fire({ kind: 'kill-coordinator', target: 'coord' });
  r.step(3000);
  const p1 = r.world.nodes.get('p1')!;
  expect(locksHeld(p1).size).toBeGreaterThan(0);
  r.step(5000);
  expect(locksHeld(p1).size).toBe(0);
});

test('saga compensates completed steps on failure', () => {
  const d = doc(
    [node('c', 'web-client'), node('orch', 'txn-coordinator', { protocol: 'saga-orchestrated' }), node('order'), node('pay'), node('inv', 'service', { sagaFailPct: 100 })],
    [edge('c', 'orch', { timeoutMs: 5000 }), edge('orch', 'order'), edge('orch', 'pay'), edge('orch', 'inv')],
    writes(40),
  );
  const r = createRun(d, { catalog: cat, seed: 3 });
  r.step(5000);
  const g = r.snapshot().nodes.orch.gauges;
  expect(g.compensated).toBeGreaterThan(50);
  expect(g.committed ?? 0).toBe(0);
  // each failed saga completed 2 steps (order, pay) → 2 compensations each
  expect(g.compensations).toBe(2 * g.compensated);
  expect(r.snapshot().nodes.order.gauges.compensations).toBe(g.compensated);
  expect(r.protocol().some(p => p.kind === 'saga.compensate')).toBe(true);
});

test('retries double-charge a non-idempotent payment; idempotent dedupes', () => {
  const run = (type: string) => {
    const d = doc(
      [node('c', 'web-client'), node('api'), node('pay', type, { p50Ms: 60, p99Ms: 150 })],
      [edge('c', 'api', { timeoutMs: 5000 }), edge('api', 'pay', { timeoutMs: 70, retries: 2, backoffMs: 10 })],
      writes(100),
    );
    const r = createRun(d, { catalog: cat, seed: 4 });
    r.step(5000);
    return r;
  };
  const bad = run('payment');
  expect(bad.snapshot().anomalies.duplicate).toBeGreaterThan(20);
  const good = run('idempotent-service');
  expect(good.snapshot().anomalies.duplicate ?? 0).toBe(0);
  expect(good.snapshot().nodes.pay.gauges.deduped).toBeGreaterThan(0);
});

test('naive inventory double-sells under a flash crowd; pessimistic does not', () => {
  const run = (mode: string) => {
    const d = doc(
      [node('c', 'web-client'), node('inv', 'inventory', { mode, seatsPerKey: 200, slots: 64 })],
      [edge('c', 'inv', { timeoutMs: 3000 })],
      { ...writes(100, 4), events: [{ atSec: 1, event: { kind: 'traffic', action: 'flash-crowd', params: { x: 20 }, durationSec: 5 } }] },
    );
    const r = createRun(d, { catalog: cat, seed: 5 });
    r.step(6000);
    return r.snapshot();
  };
  const naive = run('naive');
  expect(naive.anomalies['double-sell']).toBeGreaterThan(0);
  expect(naive.nodes.inv.gauges.oversold).toBeGreaterThan(0);
  for (const mode of ['pessimistic', 'optimistic', 'reservation']) {
    const s = run(mode);
    expect(s.anomalies['double-sell'] ?? 0).toBe(0);
    expect(s.nodes.inv.gauges.sold).toBeGreaterThan(0);
  }
});

test('txn templates run with the group catalog', () => {
  const { readFileSync, readdirSync } = require('fs');
  const { load } = require('js-yaml');
  const root = __dirname + '/../../content/';
  const y: any = load(readFileSync(root + 'catalog/transactions.yaml', 'utf8'));
  const catalog = { ...cat, types: [...cat.types, ...y.types.map((t: any) => ({ ...t, group: 'transactions' }))], skins: y.skins };
  const files: string[] = readdirSync(root + 'templates').filter((f: string) => f.startsWith('txn-'));
  expect(files.length).toBe(5);
  for (const f of files) {
    const r = createRun(JSON.parse(readFileSync(root + 'templates/' + f, 'utf8')), { catalog, seed: 1 });
    r.step(20_000);
    if (f === 'txn-ticket-booking.json') expect(r.snapshot().anomalies['double-sell']).toBeGreaterThan(0);
    if (f === 'txn-idempotency.json') expect(r.snapshot().nodes.stripe.gauges.duplicates).toBe(0);
  }
});

test('2PC messages belong to the request that started the transaction', () => {
  const r = createRun(txnDoc({}, 1), { catalog: cat, seed: 3 });
  r.step(500, 1e9);
  const id = r.sendOne('c', 'write')!;
  r.step(r.now + 3000, 1e9);
  const kinds = (r.world.traceFlights.get(id) ?? []).filter(f => f.op === 'proto').map(f => f.msg?.kind);
  expect(kinds.filter(k => k === 'txn.prepare')).toHaveLength(3);
  expect(kinds.filter(k => k === 'txn.prepare.reply')).toHaveLength(3);
  expect(kinds.filter(k => k === 'txn.commit')).toHaveLength(3);
});
