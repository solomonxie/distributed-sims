import * as fs from 'fs';
import { createRun } from '../src';
import '../src/behaviors/tech-airflow';
import '../src/behaviors/tech-celery';
import '../src/behaviors/tech-temporal';

const yaml = require('js-yaml');
const ROOT = __dirname + '/../../content/';
/** full content catalog (templates mix groups) */
const catalog: any = { groups: [], types: [], skins: [], containers: [] };
for (const f of fs.readdirSync(ROOT + 'catalog')) {
  const d: any = yaml.load(fs.readFileSync(ROOT + 'catalog/' + f, 'utf8'));
  catalog.groups.push(d.group);
  for (const t of d.types ?? []) catalog.types.push({ ...t, group: d.group.id });
  catalog.skins.push(...(d.skins ?? []));
}
const celeryCatalog = catalog;
const tpl = (slug: string) => JSON.parse(fs.readFileSync(`${ROOT}templates/${slug}.json`, 'utf8'));
const run = (slug: string, seed = 1) => createRun(tpl(slug), { catalog, seed });
const g = (r: any, id: string, k: string): number => r.snapshot().nodes[id].gauges[k] ?? 0;
const matchCount = (r: any, s: string) => r.events().filter((e: any) => e.text.includes(s)).length;

describe('celery', () => {
  test('happy path: tasks run, results stored, no anomalies', () => {
    const r = run('tech-celery-anatomy');
    r.step(30_000);
    expect(g(r, 'w1', 'done') + g(r, 'w2', 'done')).toBeGreaterThan(40);
    expect(g(r, 'results', 'results')).toBeGreaterThan(40);
    expect(g(r, 'beat', 'ticks')).toBeGreaterThanOrEqual(5);
    expect(r.snapshot().anomalyTotal).toBe(0);
    expect(r.protocol().some(p => p.kind === 'celery.deliver')).toBe(true);
  });

  test('worker crash: acks_late=False loses running tasks, acks_late=True redelivers them', () => {
    const early = run('tech-celery-crash-early');
    early.step(10_000);
    early.fire({ kind: 'kill', target: 'w1' });
    early.step(20_000);
    expect(early.snapshot().anomalies['lost-write']).toBeGreaterThan(0);

    const late = run('tech-celery-crash-late');
    late.step(10_000);
    late.fire({ kind: 'kill', target: 'w1' });
    late.step(20_000);
    expect(late.snapshot().anomalies['lost-write'] ?? 0).toBe(0);
    expect(g(late, 'broker', 'redelivered')).toBeGreaterThan(0);
  });

  test('prefetch hoarding: short tasks wait behind a long one; prefetch 1 + acks_late fixes it', () => {
    const stats = (slug: string) => {
      const r = run(slug);
      const xs: number[] = [];
      let hoarded = 0;
      for (let t = 1; t <= 60; t++) {
        r.step(t * 1000);
        xs.push(g(r, 'broker', 'waitP95'));
        hoarded = Math.max(hoarded, g(r, 'broker', 'hoarded'));
      }
      return { median: xs.sort((a, b) => a - b)[30], hoarded };
    };
    const hoard = stats('tech-celery-prefetch');
    const fair = stats('tech-celery-prefetch-fair');
    expect(hoard.hoarded).toBeGreaterThan(0);
    expect(fair.hoarded).toBe(0);
    expect(hoard.median).toBeGreaterThan(fair.median);
  });

  test('redis visibility timeout runs long tasks twice; rabbitmq does not', () => {
    const redis = run('tech-celery-visibility');
    redis.step(40_000);
    expect(redis.snapshot().anomalies.duplicate).toBeGreaterThan(0);
    const doc = tpl('tech-celery-visibility');
    doc.nodes.find((n: any) => n.id === 'broker').config.mode = 'rabbitmq';
    const rabbit = createRun(doc, { catalog: celeryCatalog as any, seed: 1 });
    rabbit.step(40_000);
    expect(rabbit.snapshot().anomalies.duplicate ?? 0).toBe(0);
  });

  test('beat running twice duplicates schedules (chaos or two beat nodes)', () => {
    const r = run('tech-celery-beat');
    r.step(10_000);
    expect(r.snapshot().anomalies.duplicate ?? 0).toBe(0);
    r.fire({ kind: 'split-brain', target: 'beat' });
    r.step(20_000);
    expect(r.snapshot().anomalies.duplicate).toBeGreaterThan(0);

    const doc = tpl('tech-celery-beat');
    const beat = doc.nodes.find((n: any) => n.id === 'beat');
    doc.nodes.push({ ...beat, id: 'beat2', name: 'beat (2nd)' });
    const two = createRun(doc, { catalog: celeryCatalog as any, seed: 1 });
    two.step(10_000);
    expect(two.snapshot().anomalies.duplicate).toBeGreaterThan(0);
  });

  test('result backend fills up, rejects writes; flush clears it', () => {
    const r = run('tech-celery-results');
    r.step(40_000);
    expect(r.events().some(e => e.text.includes('Result backend full'))).toBe(true);
    expect(g(r, 'w1', 'resultErrors') + g(r, 'w2', 'resultErrors')).toBeGreaterThan(0);
    r.fire({ kind: 'cache-flush', target: 'results' });
    expect(g(r, 'results', 'results')).toBe(0);
  });

  test('broker down fails .delay(); recovers after restart', () => {
    const r = run('tech-celery-anatomy');
    r.step(5000);
    r.fire({ kind: 'kill', target: 'broker', durationSec: 10 });
    r.step(12_000);
    expect(r.snapshot().system.availability).toBeLessThan(50);
    r.step(25_000);
    expect(r.snapshot().system.availability).toBeGreaterThan(99);
  });
});

describe('temporal', () => {
  test('workflows run end to end with full event histories and temporal.* protocol', () => {
    const r = createRun(tpl('tech-temporal-anatomy'), { catalog, seed: 1 });
    r.step(20_000);
    expect(g(r, 'history', 'completed')).toBeGreaterThan(10);
    expect(r.snapshot().system.availability).toBeGreaterThan(99);
    const db = (r.world.nodes.get('db')!.logic as any).db as Map<string, any>;
    const done = [...db.values()].find(w => w.status === 'completed')!;
    const types = done.events.map((e: any) => e.t);
    expect(types[0]).toBe('WorkflowExecutionStarted');
    expect(types.filter((t: string) => t === 'ActivityTaskCompleted')).toHaveLength(3);
    expect(types[types.length - 1]).toBe('WorkflowExecutionCompleted');
    const kinds = new Set(r.protocol().map(p => p.kind));
    for (const k of ['temporal.StartWorkflowExecution', 'temporal.persist', 'temporal.AddWorkflowTask', 'temporal.PollActivityTaskQueue', 'temporal.RespondWorkflowTaskCompleted'])
      expect(kinds.has(k)).toBe(true);
  });

  test('worker killed mid-workflow: activities retry and another worker replays; nothing lost', () => {
    const r = createRun(tpl('tech-temporal-worker-crash'), { catalog, seed: 2 });
    r.step(8000);
    r.fire({ kind: 'kill', target: 'worker-1' });
    r.step(40_000);
    expect(matchCount(r, 'start-to-close timeout')).toBeGreaterThan(0);
    expect(matchCount(r, 'replayed')).toBeGreaterThan(0);
    expect(g(r, 'history', 'replays')).toBeGreaterThan(0);
    const done = g(r, 'history', 'completed');
    r.step(60_000);
    expect(g(r, 'history', 'completed')).toBeGreaterThan(done);
    expect(r.snapshot().anomalyTotal).toBe(0);
    // every workflow started before the kill has finished
    const db = (r.world.nodes.get('db')!.logic as any).db as Map<string, any>;
    const early = [...db.values()].filter(w => w.events.length && Number(w.id.split('-').pop()) <= 10);
    expect(early.every(w => w.status === 'completed')).toBe(true);
  });

  test('non-deterministic deploy fails replay; rollback unsticks', () => {
    const r = createRun(tpl('tech-temporal-nondeterminism'), { catalog, seed: 3 });
    r.step(6000);
    const id = r.fire({ kind: 'bad-deploy', target: 'worker-1' })!;
    r.step(20_000);
    expect(g(r, 'history', 'stuck')).toBeGreaterThan(2);
    expect(matchCount(r, 'nondeterminism')).toBeGreaterThan(2);
    r.heal(id);
    r.step(35_000);
    expect(matchCount(r, 'unstuck')).toBeGreaterThan(0);
  });

  test('heartbeat timeout detects a dead worker in ~2s instead of start-to-close', () => {
    const r = createRun(tpl('tech-temporal-heartbeat'), { catalog, seed: 4 });
    let t = 0;
    do r.step((t += 250)); while (!(g(r, 'worker-1', 'actBusy') > 0) && t < 20000);
    expect(g(r, 'worker-1', 'actBusy')).toBeGreaterThan(0);
    r.fire({ kind: 'kill', target: 'worker-1' });
    r.step(t + 3000);
    expect(matchCount(r, 'heartbeat timeout')).toBeGreaterThan(0);
    expect(matchCount(r, 'start-to-close')).toBe(0);
  });

  test('durable timers fire with every worker and history restarted', () => {
    const r = createRun(tpl('tech-temporal-timer'), { catalog, seed: 5 });
    r.step(6000);
    r.fire({ kind: 'kill', target: 'worker-1' });
    r.fire({ kind: 'kill', target: 'worker-2' });
    r.fire({ kind: 'restart', target: 'history', params: { downSec: 2 } });
    r.step(30_000);
    expect(matchCount(r, 'reloaded')).toBe(1);
    const db = (r.world.nodes.get('db')!.logic as any).db as Map<string, any>;
    const fired = [...db.values()].filter(w => w.events.some((e: any) => e.t === 'TimerFired'));
    expect(fired.length).toBeGreaterThan(0);
    expect(g(r, 'matching', 'wfBacklog')).toBeGreaterThan(0);
    const before = g(r, 'history', 'completed');
    r.world.nodes.get('worker-1')!.restart();
    r.step(45_000);
    expect(g(r, 'history', 'completed')).toBeGreaterThan(before);
    expect(matchCount(r, 'replayed')).toBeGreaterThan(0);
  });

  test('saga compensates in reverse when an activity exhausts retries', () => {
    const r = createRun(tpl('tech-temporal-saga'), { catalog, seed: 6 });
    r.step(4000);
    r.fire({ kind: 'external-outage', target: 'shipping', durationSec: 15 });
    r.step(25_000);
    expect(g(r, 'history', 'compensated')).toBeGreaterThan(0);
    const db = (r.world.nodes.get('db')!.logic as any).db as Map<string, any>;
    const w = [...db.values()].find(x => x.status === 'compensated')!;
    const names = w.events.filter((e: any) => e.t === 'ActivityTaskScheduled').map((e: any) => e.name);
    expect(names).toEqual(['charge', 'reserve', 'ship', 'undo-reserve', 'undo-charge']);
  });

  test('persistence down stalls workflows without losing them', () => {
    const r = createRun(tpl('tech-temporal-anatomy'), { catalog, seed: 7 });
    r.step(5000);
    const id = r.fire({ kind: 'kill', target: 'db' })!;
    r.step(12_000);
    const stalled = g(r, 'history', 'completed');
    r.step(15_000);
    expect(g(r, 'history', 'completed')).toBe(stalled);
    r.heal(id);
    r.step(40_000);
    expect(g(r, 'history', 'completed')).toBeGreaterThan(stalled + 5);
    expect(r.snapshot().anomalyTotal).toBe(0);
  });
});

describe('airflow', () => {
  const states = (r: any, key: string) =>
    r.events().filter((e: any) => e.text.startsWith(key + ':')).map((e: any) => e.text.split('→')[1].trim());

  test('task instance lifecycle: scheduled → queued → running → success, DagRun success', () => {
    const r = run('tech-airflow-lifecycle');
    r.step(15_000);
    expect(states(r, 'run_1.extract')).toEqual(['scheduled', 'queued', 'running', 'success']);
    expect(matchCount(r, 'DagRun run_1 success')).toBe(1);
    expect(r.protocol().some((p: any) => p.kind === 'airflow.db.query')).toBe(true);
    expect(r.protocol().some((p: any) => p.kind === 'airflow.task.run')).toBe(true);
  });

  test('slow metadata DB stretches every scheduler loop', () => {
    const r = run('tech-airflow-db-slow');
    r.step(10_000);
    expect(g(r, 'scheduler', 'loopMs')).toBeLessThan(600);
    r.fire({ kind: 'slow', target: 'meta-db', params: { x: 20 } });
    r.step(18_000);
    expect(g(r, 'scheduler', 'loopMs')).toBeGreaterThan(1500);
  });

  test('killed worker → zombie detection → retry on the other worker', () => {
    const r = run('tech-airflow-zombie');
    r.step(8_000);
    expect(g(r, 'worker-1', 'running')).toBeGreaterThan(0);
    r.fire({ kind: 'kill', target: 'worker-1' });
    r.step(30_000);
    expect(g(r, 'scheduler', 'zombies')).toBeGreaterThan(0);
    expect(matchCount(r, 'zombie → up_for_retry')).toBeGreaterThan(0);
    const before = g(r, 'scheduler', 'runsDone');
    r.step(45_000);
    expect(g(r, 'scheduler', 'runsDone')).toBeGreaterThan(before);
  });

  test('catchup=True floods: max_active_runs caps running runs, the rest queue', () => {
    const r = run('tech-airflow-catchup');
    r.step(3_000);
    expect(g(r, 'scheduler', 'runsActive')).toBe(16);
    expect(g(r, 'scheduler', 'runsQueued')).toBeGreaterThanOrEqual(20);
    expect(g(r, 'scheduler', 'queued')).toBeGreaterThan(0);
  });

  test('poke sensors hold every slot; deferrable sensors hold none', () => {
    const poke = run('tech-airflow-sensors-poke');
    poke.step(28_000);
    expect(g(poke, 'scheduler', 'sensorsRunning')).toBe(8);
    expect(g(poke, 'scheduler', 'queued')).toBeGreaterThan(0);
    const def = run('tech-airflow-sensors-deferrable');
    def.step(28_000);
    expect(g(def, 'scheduler', 'sensorsRunning')).toBe(0);
    expect(g(def, 'triggerer', 'triggers')).toBeGreaterThan(5);
    def.step(50_000);
    expect(g(def, 'scheduler', 'runsDone')).toBeGreaterThan(0);
  });

  test('non-idempotent retries duplicate side effects; idempotent ones do not', () => {
    const r = run('tech-airflow-retry');
    r.step(40_000);
    expect(g(r, 'scheduler', 'retries')).toBeGreaterThan(0);
    expect(r.snapshot().anomalies.duplicate).toBeGreaterThan(0);
    const d = tpl('tech-airflow-retry');
    d.nodes.find((n: any) => n.id === 'scheduler').config.idempotent = true;
    const ok = createRun(d, { catalog, seed: 1 });
    ok.step(40_000);
    expect(ok.snapshot().anomalies.duplicate ?? 0).toBe(0);
  });

  test('two schedulers: no row locks → same task queued twice; SKIP LOCKED → never', () => {
    const r = run('tech-airflow-ha');
    r.step(40_000);
    expect(g(r, 'scheduler-1', 'races')).toBeGreaterThan(0);
    expect(r.snapshot().anomalies.duplicate).toBeGreaterThan(0);
    const d = tpl('tech-airflow-ha');
    const db = d.nodes.find((n: any) => n.id === 'meta-db');
    db.skin = 'airflow-postgres-db';
    db.config.skipLocked = true;
    const safe = createRun(d, { catalog, seed: 1 });
    safe.step(40_000);
    expect(g(safe, 'scheduler-1', 'races')).toBe(0);
    expect(safe.snapshot().anomalies.duplicate ?? 0).toBe(0);
    expect(g(safe, 'scheduler-1', 'runsDone')).toBeGreaterThan(5);
  });

  test('kubernetes executor adds pod start latency; local executor runs in-process', () => {
    const d = tpl('tech-airflow-lifecycle');
    const t = (mode: string) => {
      const x = JSON.parse(JSON.stringify(d));
      x.nodes.find((n: any) => n.id === 'executor').config = { mode };
      const r = createRun(x, { catalog, seed: 2 });
      r.step(30_000);
      return r.events().find((e: any) => e.text.includes('DagRun run_1 success'))?.t ?? Infinity;
    };
    expect(t('kubernetes')).toBeGreaterThan(t('celery') + 5000);
    expect(t('local')).toBeLessThan(Infinity);
  });
});

describe('compare: what survives a worker crash', () => {
  test('celery (early ack) loses tasks, airflow reruns zombies, temporal replays with nothing lost', () => {
    const r = run('tech-compare-worker-crash', 3);
    r.step(15_000);
    r.fire({ kind: 'kill', target: 'c-w1' });
    r.fire({ kind: 'kill', target: 'af-w1' });
    r.fire({ kind: 'kill', target: 't-w1' });
    r.step(45_000);
    const s = r.snapshot();
    expect(s.anomalies['lost-write']).toBeGreaterThan(0);
    expect(g(r, 'af-scheduler', 'zombies')).toBeGreaterThan(0);
    expect(matchCount(r, 'replayed')).toBeGreaterThan(0);
    expect(s.anomalies.duplicate ?? 0).toBe(0);
    expect(g(r, 't-history', 'completed')).toBeGreaterThan(20);
  });
});

test('every tech template runs with the content catalog', () => {
  const files = fs.readdirSync(ROOT + 'templates').filter(f => /^tech-(airflow|celery|temporal|compare)-/.test(f));
  expect(files.length).toBeGreaterThanOrEqual(20);
  for (const f of files) {
    const r = createRun(tpl(f.replace('.json', '')), { catalog, seed: 1 });
    expect(r.step(15_000, 2_000_000)).toBe(true);
  }
});
