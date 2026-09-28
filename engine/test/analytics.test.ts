import * as fs from 'fs';
import { createRun } from '../src';
import '../src/behaviors/analytics';
import { doc, edge, node } from './fixtures';

const yaml = require('js-yaml');
const ROOT = __dirname + '/../../content/';
const y: any = yaml.load(fs.readFileSync(ROOT + 'catalog/analytics.yaml', 'utf8'));
const s3: any = yaml.load(fs.readFileSync(ROOT + 'catalog/stores.yaml', 'utf8'));
const client = (type: string) => ({ type, group: 'clients', label: type, description: '', icon: 'globe', knobs: [], client: true });
const catalog: any = {
  groups: [y.group],
  types: [client('web-client'), client('iot-device'), ...y.types.map((t: any) => ({ ...t, group: 'analytics' })), ...s3.types.map((t: any) => ({ ...t, group: 'data' }))],
  skins: [...y.skins, ...s3.skins],
  containers: [],
};
const tpl = (slug: string) => JSON.parse(fs.readFileSync(`${ROOT}templates/${slug}.json`, 'utf8'));
const run = (d: any, seed = 1) => createRun(d, { catalog, seed });
const g = (r: any, id: string, k: string): number => r.snapshot().nodes[id].gauges[k] ?? 0;
const count = (r: any, s: string) => r.events().filter((e: any) => e.text.includes(s)).length;

describe('columnar-db', () => {
  test('row store reads every column; column store reads only selected ones', () => {
    const r = run(tpl('analytics-row-vs-columnar'));
    r.step(20_000);
    expect(g(r, 'pg', 'columnsRead')).toBe(100);
    expect(g(r, 'ch', 'columnsRead')).toBe(5);
    expect(g(r, 'pg', 'scannedMB')).toBeGreaterThan(100 * g(r, 'ch', 'scannedMB'));
    expect(g(r, 'pg', 'queryMs')).toBeGreaterThan(50 * g(r, 'ch', 'queryMs'));
  });

  test('a time filter prunes partitions and cuts latency', () => {
    const d = (timeFilter: boolean) =>
      doc([node('c', 'web-client'), node('ch', 'columnar-db', { rowsM: 1000, timeFilter, timeRangePct: 3 }, { skin: 'clickhouse' })], [edge('c', 'ch', { timeoutMs: 30000 })], {
        sources: [{ id: 's', node: 'c', shape: { kind: 'constant', rps: 0.5 }, readRatio: 1 }],
      });
    const full = run(d(false));
    const day = run(d(true));
    full.step(20_000);
    day.step(20_000);
    expect(g(day, 'ch', 'prunedPct')).toBe(97);
    expect(g(full, 'ch', 'scannedMB') / g(day, 'ch', 'scannedMB')).toBeCloseTo(33, 0);
    expect(g(full, 'ch', 'queryMs')).toBeGreaterThan(5 * g(day, 'ch', 'queryMs'));
  });

  test('single-row inserts pile up parts until "Too many parts"; batching does not', () => {
    const d = (batchInserts: boolean) =>
      doc([node('c', 'iot-device'), node('ch', 'columnar-db', { batchInserts }, { skin: 'clickhouse' })], [edge('c', 'ch', { timeoutMs: 5000 })], {
        sources: [{ id: 's', node: 'c', shape: { kind: 'constant', rps: 100 }, readRatio: 0 }],
      });
    const rows = run(d(false));
    rows.step(15_000);
    expect(count(rows, 'Too many parts')).toBeGreaterThan(0);
    expect(g(rows, 'ch', 'rejectedInserts')).toBeGreaterThan(0);
    const batched = run(d(true));
    batched.step(15_000);
    expect(g(batched, 'ch', 'parts')).toBeLessThanOrEqual(3);
    expect(count(batched, 'Too many parts')).toBe(0);
  });
});

describe('data-warehouse', () => {
  test('ad-hoc scans queue dashboards on one cluster; multi-cluster scales out, then in', () => {
    const r = run(tpl('analytics-snowflake-warehouse'));
    r.step(20_000);
    r.fire({ kind: 'huge-query', target: 'wh-single', params: { sec: 20 } });
    r.fire({ kind: 'huge-query', target: 'wh-multi', params: { sec: 20 } });
    r.step(30_000);
    expect(g(r, 'wh-single', 'queued')).toBeGreaterThan(5);
    expect(g(r, 'wh-multi', 'clusters')).toBeGreaterThanOrEqual(2);
    expect(g(r, 'wh-multi', 'queued')).toBe(0);
    r.step(90_000);
    expect(count(r, 'cluster shut down')).toBeGreaterThan(0);
  });

  test('bigger warehouse = faster queries and higher credit burn', () => {
    const m = (size: string) => {
      const d = doc([node('c', 'web-client'), node('wh', 'data-warehouse', { size, resultCache: false, autoSuspendSec: 0 }, { skin: 'snowflake' })], [edge('c', 'wh', { timeoutMs: 60000 })], {
        sources: [{ id: 's', node: 'c', shape: { kind: 'constant', rps: 1 }, readRatio: 1 }],
      });
      const r = run(d);
      r.step(20_000);
      return { ms: g(r, 'wh', 'queryMs'), cost: g(r, 'wh', 'costMonth') };
    };
    const xs = m('XS');
    const l = m('L');
    expect(xs.ms).toBeGreaterThan(3 * l.ms);
    expect(l.cost).toBe(8 * xs.cost);
  });

  test('auto-suspend, result cache while suspended, resume with cold cache, writes invalidate', () => {
    const r = run(tpl('analytics-warehouse-suspend'));
    r.step(9_000);
    expect(g(r, 'wh', 'hitRatio')).toBeGreaterThan(0);
    r.step(25_000);
    expect(g(r, 'wh', 'suspended')).toBe(1);
    expect(g(r, 'wh', 'creditsPerHour')).toBe(0);
    r.step(55_000);
    expect(count(r, 'resuming warehouse')).toBeGreaterThan(0);
    r.fire({ kind: 'traffic', source: 'load', action: 'set', params: { rps: 0.5 } });
    r.step(65_000);
    expect(count(r, 'cached results invalidated')).toBeGreaterThan(0);
  });

  test('BigQuery skin bills bytes scanned, not uptime', () => {
    const d = (rps: number) =>
      doc([node('c', 'web-client'), node('bq', 'data-warehouse', { resultCache: false }, { skin: 'bigquery' })], [edge('c', 'bq', { timeoutMs: 60000 })], {
        sources: [{ id: 's', node: 'c', shape: { kind: 'constant', rps }, readRatio: 1 }],
      });
    const idle = run(d(0));
    const busy = run(d(2));
    idle.step(10_000);
    busy.step(10_000);
    expect(g(idle, 'bq', 'costMonth')).toBe(0);
    expect(g(busy, 'bq', 'costMonth')).toBeGreaterThan(0);
  });
});

describe('lakehouse', () => {
  test('small files slow reads and hit S3 harder; OPTIMIZE compacts them', () => {
    const r = run(tpl('analytics-lakehouse'));
    r.step(10_000);
    const before = g(r, 'lake', 'filesPerQuery');
    r.fire({ kind: 'small-files', target: 'lake', params: { files: 20000 } });
    r.step(20_000);
    expect(g(r, 'lake', 'filesPerQuery')).toBeGreaterThan(100 * before);
    r.step(50_000);
    expect(count(r, 'OPTIMIZE committed')).toBeGreaterThan(0);
    expect(g(r, 'lake', 'filesPerQuery')).toBeLessThan(50);
  });

  test('backlog autoscales workers after the start-up delay', () => {
    const r = run(tpl('analytics-lakehouse'));
    r.step(40_000);
    expect(count(r, 'requesting')).toBeGreaterThan(0);
    expect(g(r, 'lake', 'workers')).toBeGreaterThan(2);
  });

  test('spot loss retries tasks and replaces workers; restart resumes from checkpoint', () => {
    const r = run(tpl('analytics-lakehouse'));
    r.step(5_000);
    const w = g(r, 'lake', 'workers');
    r.fire({ kind: 'spot-loss', target: 'lake', params: { workers: 1 } });
    r.step(5_100);
    expect(g(r, 'lake', 'workers')).toBe(w - 1);
    r.step(15_000);
    expect(count(r, 'replacement worker')).toBe(1);
    const v = g(r, 'lake', 'version');
    r.fire({ kind: 'restart', target: 'lake', params: { downSec: 2 } });
    r.step(40_000);
    expect(count(r, 'restarted from checkpoint')).toBe(1);
    expect(count(r, 'cluster running with')).toBe(1);
    expect(g(r, 'lake', 'version')).toBeGreaterThan(v);
  });

  test('Photon speeds up scans', () => {
    const ms = (photon: boolean) => {
      const d = doc([node('c', 'web-client'), node('lake', 'lakehouse', { photon, minWorkers: 8, maxWorkers: 8 }, { skin: 'databricks' })], [edge('c', 'lake', { timeoutMs: 60000 })], {
        sources: [{ id: 's', node: 'c', shape: { kind: 'constant', rps: 0.2 }, readRatio: 1 }],
      });
      const r = run(d);
      r.step(30_000);
      return g(r, 'lake', 'queryMs');
    };
    expect(ms(false)).toBeGreaterThan(1.5 * ms(true));
  });
});
