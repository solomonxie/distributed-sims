import * as fs from 'fs';
import { createRun } from '../src';
import '../src/behaviors/tech-spark';

const yaml = require('js-yaml');
const ROOT = __dirname + '/../../content/';
const y: any = yaml.load(fs.readFileSync(ROOT + 'catalog/tech-spark.yaml', 'utf8'));
const catalog: any = {
  groups: [y.group],
  types: [{ type: 'web-client', group: 'clients', label: 'Web', description: '', icon: 'globe', knobs: [], client: true }, ...y.types.map((t: any) => ({ ...t, group: 'tech' }))],
  skins: y.skins,
  containers: [],
};
const tpl = (slug: string) => JSON.parse(fs.readFileSync(`${ROOT}templates/${slug}.json`, 'utf8'));
const run = (slug: string, seed = 1, patch?: (d: any) => void) => {
  const d = tpl(slug);
  patch?.(d);
  return createRun(d, { catalog, seed });
};
const g = (r: any, id: string, k: string): number => r.snapshot().nodes[id].gauges[k] ?? 0;
const count = (r: any, s: string) => r.events().filter((e: any) => e.text.includes(s)).length;
const jobTimes = (r: any) => r.events().map((e: any) => /done in ([\d.]+)s/.exec(e.text)?.[1]).filter(Boolean).map(Number);

test('a job splits into stages at shuffle boundaries, one task per partition', () => {
  const r = run('tech-spark-anatomy');
  r.step(10_000);
  expect(g(r, 'driver', 'jobsDone')).toBe(1);
  expect(count(r, 'stage 1/3 reads input → 16 tasks')).toBe(1);
  expect(count(r, 'stage 3/3 shuffle read')).toBe(1);
  const tasks = r.protocol().filter((p: any) => p.kind === 'spark.task').length;
  expect(tasks).toBe(48);
  expect(r.protocol().some((p: any) => p.kind === 'spark.shuffle.fetch')).toBe(true);
  expect(r.protocol().some((p: any) => p.kind === 'spark.heartbeat')).toBe(true);
  expect(g(r, 'exec-1', 'blocks')).toBeGreaterThan(0);
});

test('requests trigger jobs and get replied when the job completes', () => {
  const r = run('tech-spark-anatomy', 1, d => {
    d.nodes.unshift({ id: 'nb', type: 'web-client', name: 'Notebook', pos: { x: 0, y: 0 } });
    d.edges.push({ id: 'nb-d', from: 'nb', to: 'driver', config: { timeoutMs: 60000 } });
    d.nodes.find((n: any) => n.id === 'driver').config.cronSec = 0;
    d.scenario.sources = [{ id: 's', node: 'nb', shape: { kind: 'constant', rps: 0.2 } }];
  });
  r.step(40_000);
  expect(g(r, 'driver', 'jobsDone')).toBeGreaterThan(1);
  expect(r.snapshot().system.availability).toBe(100);
});

test('data skew: one partition becomes a straggler, spills, and slows the job', () => {
  const r = run('tech-spark-skew');
  r.step(10_000);
  r.fire({ kind: 'hot-key', target: 'driver', params: { hot: 0.4 } });
  r.step(22_000);
  expect(g(r, 'driver', 'stragglers')).toBe(1);
  r.step(45_000);
  expect(g(r, 'driver', 'spillMB')).toBeGreaterThan(0);
  const [base, skewed] = jobTimes(r);
  expect(skewed).toBeGreaterThan(base * 2);
});

test('executor lost: only its partitions are recomputed from lineage, job completes', () => {
  const r = run('tech-spark-executor-lost');
  r.step(9_000);
  const lostBlocks = g(r, 'exec-2', 'blocks');
  expect(lostBlocks).toBeGreaterThan(0);
  r.fire({ kind: 'kill', target: 'exec-2' });
  r.step(40_000);
  expect(count(r, 'Executor 2 lost')).toBe(1);
  expect(count(r, 'recomputed from lineage')).toBeGreaterThan(0);
  expect(g(r, 'driver', 'recomputed')).toBeGreaterThan(0);
  expect(g(r, 'driver', 'recomputed')).toBeLessThan(16 * 3);
  expect(g(r, 'driver', 'jobsDone')).toBeGreaterThan(0);
  expect(g(r, 'driver', 'jobsLost')).toBe(0);
});

test('executor restart re-registers with the driver', () => {
  const r = run('tech-spark-executor-lost');
  r.step(5_000);
  const id = r.fire({ kind: 'kill', target: 'exec-3' })!;
  r.step(12_000);
  expect(g(r, 'driver', 'executors')).toBe(2);
  r.heal(id);
  r.step(16_000);
  expect(g(r, 'driver', 'executors')).toBe(3);
  expect(count(r, 'registered with the driver')).toBe(1);
});

test('speculation: a slow executor gets its stragglers copied; copies win', () => {
  const r = run('tech-spark-speculation');
  r.step(9_000);
  r.fire({ kind: 'slow', target: 'exec-3', params: { x: 6 } });
  r.step(30_000);
  expect(g(r, 'driver', 'speculative')).toBeGreaterThan(0);
  expect(count(r, 'Speculative copy of task')).toBeGreaterThan(0);
  const off = run('tech-spark-speculation', 1, d => (d.nodes.find((n: any) => n.id === 'driver').config.speculation = false));
  off.step(9_000);
  off.fire({ kind: 'slow', target: 'exec-3', params: { x: 6 } });
  off.step(50_000);
  expect(g(off, 'driver', 'speculative')).toBe(0);
  expect(jobTimes(off)[1]).toBeGreaterThan(jobTimes(r)[1]);
});

test('driver death loses the running job even though executors are healthy', () => {
  const r = run('tech-spark-driver-death');
  r.step(4_000);
  r.fire({ kind: 'kill', target: 'driver', durationSec: 5 });
  r.step(10_000);
  expect(count(r, 'Driver died: job lost')).toBe(1);
  expect(g(r, 'driver', 'jobsLost')).toBeGreaterThan(0);
  r.step(40_000);
  expect(g(r, 'driver', 'jobsDone')).toBeGreaterThan(0);
});

test('dynamic allocation scales executors out on backlog and releases idle ones', () => {
  const r = run('tech-spark-dynamic');
  r.step(800);
  expect(g(r, 'driver', 'executors')).toBe(1);
  r.step(6_000);
  expect(g(r, 'driver', 'executors')).toBe(4);
  expect(count(r, 'requesting')).toBeGreaterThan(0);
  r.step(25_000);
  expect(count(r, 'released')).toBeGreaterThan(0);
  expect(g(r, 'driver', 'executors')).toBe(1);
});

test('spark-cluster composite skin carries internals and a port', () => {
  const s = catalog.skins.find((x: any) => x.name === 'spark-cluster');
  expect(s.ports.in).toBe('driver');
  expect(s.internals.nodes.map((n: any) => n.type)).toContain('spark-executor');
  const r = createRun({ ...s.internals, scenario: { sources: [], events: [] } }, { catalog, seed: 1 });
  r.step(5000);
  expect(g(r, 'driver', 'executors')).toBe(3);
});
