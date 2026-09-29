// Airflow internals: scheduler loop over the metadata DB, executor (local/celery/kubernetes), workers, triggerer.
// All DagRun / task-instance state lives in the metadata DB node; schedulers and workers only change it via DB messages.
import type { NodeLogic, SimNode } from '../node';
import type { World } from '../world';
import type { Badge, Msg } from '../types';
import { register } from './registry';

export type TIState = 'none' | 'scheduled' | 'queued' | 'running' | 'success' | 'failed' | 'up_for_retry' | 'up_for_reschedule' | 'deferred';

interface DagRun {
  id: number;
  label: string;
  created: number;
  /** when the sensor's external condition becomes true */
  condAt: number;
  state: 'queued' | 'running' | 'success' | 'failed';
  tis: TI[];
}

interface TI {
  key: string;
  run: DagRun;
  idx: number;
  sensor: boolean;
  state: TIState;
  tries: number;
  hbAt: number;
  queuedAt: number;
  retryAt: number;
  lockedBy?: string;
  lockedAt: number;
  worker?: string;
  resumed?: boolean;
}

interface Db {
  runs: DagRun[];
  inited: boolean;
  nextRunAt: number;
  runSeq: number;
  tis: Map<string, TI>;
  done: number;
  failed: number;
  zombies: number;
  retries: number;
  runsDone: number;
  races: number;
}

interface DagCfg {
  tasks: number;
  sensor: 'none' | 'poke' | 'reschedule' | 'deferrable';
  sensorWaitMs: number;
  pokeMs: number;
  pokeEveryMs: number;
  p50: number;
  p99: number;
  failPct: number;
  idempotent: boolean;
  retries: number;
  retryDelayMs: number;
}

const dbs = new WeakMap<World, Map<string, Db>>();
export function airflowDb(w: World, id: string): Db {
  let m = dbs.get(w);
  if (!m) dbs.set(w, (m = new Map()));
  let d = m.get(id);
  if (!d) m.set(id, (d = { runs: [], inited: false, nextRunAt: 0, runSeq: 0, tis: new Map(), done: 0, failed: 0, zombies: 0, retries: 0, runsDone: 0, races: 0 }));
  return d;
}

/** side effects in the outside world (rows inserted, emails sent) per task instance */
const effects = new WeakMap<World, Map<string, number>>();

function linked(n: SimNode, type: string): string[] {
  const out = n.outEdges(e => n.world.nodes.get(e.to)?.type === type).map(e => e.to);
  if (out.length) return [...new Set(out)];
  return [...n.world.nodes.values()].filter(x => x.type === type).map(x => x.id);
}

function dagOf(n: SimNode): DagCfg {
  return {
    tasks: Math.max(1, Math.round(n.num('tasks', 3))),
    sensor: n.str('sensor', 'none'),
    sensorWaitMs: n.num('sensorWaitSec', 20) * 1000,
    pokeMs: n.num('pokeMs', 300),
    pokeEveryMs: n.num('pokeIntervalSec', 5) * 1000,
    p50: n.num('taskP50Ms', 2000),
    p99: n.num('taskP99Ms', 5000),
    failPct: n.num('failPct', 0),
    idempotent: n.bool('idempotent', true),
    retries: n.num('retries', 2),
    retryDelayMs: n.num('retryDelaySec', 5) * 1000,
  };
}

/** set a task-instance state; the first DagRun narrates every transition (lifecycle lesson) */
function mark(n: SimNode, ti: TI, s: TIState) {
  if (ti.state === s) return;
  if (ti.run.id === 1) n.log('info', `${ti.key}: ${ti.state} → ${s}`);
  ti.state = s;
}

function fail(n: SimNode, db: Db, ti: TI, retries: number, retryDelayMs: number, why: string) {
  if (ti.tries <= retries) {
    mark(n, ti, 'up_for_retry');
    ti.retryAt = n.now + retryDelayMs;
    db.retries++;
    n.log('info', `${ti.key} ${why} → up_for_retry (try ${ti.tries}/${retries + 1})`);
  } else {
    mark(n, ti, 'failed');
    db.failed++;
    n.log('info', `${ti.key} ${why} → failed`);
  }
}

// ---------- scheduler ----------

export function airflowScheduler(n: SimNode): NodeLogic {
  let loopMs = 0;
  let stalls = 0;
  const dbId = () => linked(n, 'airflow-metadata-db')[0];
  const execId = () => linked(n, 'airflow-executor')[0];

  function createRun(db: Db, dag: DagCfg, label: string) {
    const run: DagRun = { id: ++db.runSeq, label, created: n.now, condAt: n.now + dag.sensorWaitMs, state: 'queued', tis: [] };
    db.runs.push(run);
    return run;
  }

  function activate(db: Db, run: DagRun, dag: DagCfg) {
    run.state = 'running';
    run.condAt = n.now + dag.sensorWaitMs;
    const names = [...(dag.sensor !== 'none' ? ['wait_for_file'] : []), ...['extract', 'transform', 'load', 'report', 'notify', 'cleanup'].slice(0, dag.tasks)];
    while (names.length < dag.tasks + (dag.sensor !== 'none' ? 1 : 0)) names.push(`task_${names.length}`);
    run.tis = names.map((nm, idx) => {
      const ti: TI = { key: `${run.label}.${nm}`, run, idx, sensor: dag.sensor !== 'none' && idx === 0, state: 'none', tries: 0, hbAt: 0, queuedAt: 0, retryAt: 0, lockedAt: 0 };
      db.tis.set(ti.key, ti);
      return ti;
    });
  }

  /** everything the scheduler does inside one DB transaction; returns TIs it wants to queue */
  function plan(db: Db, dbNode: SimNode): TI[] {
    const dag = dagOf(n);
    const every = n.num('scheduleSec', 10) * 1000;
    if (!db.inited) {
      db.inited = true;
      const back = n.bool('catchup', false) ? Math.round(n.num('backfillRuns', 0)) : 0;
      for (let k = back; k >= 1; k--) createRun(db, dag, `run_${db.runSeq + 1}`);
      if (back) n.log('info', `catchup=True: created ${back} DagRuns for missed intervals at once`);
      db.nextRunAt = n.now;
    }
    while (every > 0 && n.now >= db.nextRunAt) {
      createRun(db, dag, `run_${db.runSeq + 1}`);
      db.nextRunAt += every;
    }
    let active = db.runs.filter(r => r.state === 'running').length;
    for (const r of db.runs) if (r.state === 'queued' && active < n.num('maxActiveRuns', 16)) (activate(db, r, dag), active++);
    const zombieMs = n.num('zombieSec', 10) * 1000;
    const queuedTimeout = n.num('queuedTimeoutSec', 30) * 1000;
    for (const r of db.runs) {
      if (r.state !== 'running') continue;
      for (const ti of r.tis) {
        if (ti.state === 'running' && n.now - ti.hbAt > zombieMs) {
          db.zombies++;
          n.log('info', `Zombie detected: ${ti.key} on ${n.world.nodeName(ti.worker ?? '?')} stopped heartbeating`);
          fail(n, db, ti, dag.retries, dag.retryDelayMs, 'zombie');
        } else if ((ti.state === 'up_for_retry' || ti.state === 'up_for_reschedule') && n.now >= ti.retryAt) mark(n, ti, 'scheduled');
        else if (ti.state === 'queued' && n.now - ti.queuedAt > queuedTimeout) {
          n.log('info', `${ti.key} stuck in queued ${queuedTimeout / 1000}s → rescheduled`);
          mark(n, ti, 'scheduled');
        } else if (ti.state === 'none' && (ti.idx === 0 || r.tis[ti.idx - 1].state === 'success')) mark(n, ti, 'scheduled');
      }
      if (r.tis.every(t => t.state === 'success')) {
        r.state = 'success';
        db.runsDone++;
        n.log('info', `DagRun ${r.label} success in ${((n.now - r.created) / 1000).toFixed(1)}s`);
      } else if (r.tis.some(t => t.state === 'failed')) {
        r.state = 'failed';
        n.log('info', `DagRun ${r.label} failed`);
      }
    }
    if (db.runs.length > 400) {
      const keep = (r: DagRun) => r.state === 'running' || r.state === 'queued' || n.now - r.created < 120_000;
      for (const r of db.runs) if (!keep(r)) for (const ti of r.tis) db.tis.delete(ti.key);
      db.runs = db.runs.filter(keep);
    }
    const skip = dbNode.bool('skipLocked', true);
    const busy = [...db.tis.values()].filter(t => t.state === 'queued' || t.state === 'running').length;
    const open = Math.max(0, Math.min(n.num('parallelism', 32), n.num('poolSlots', 128)) - busy);
    const cands: TI[] = [];
    for (const r of db.runs) {
      if (r.state !== 'running') continue;
      for (const ti of r.tis) {
        if (cands.length >= open) break;
        if (ti.state !== 'scheduled') continue;
        if (skip && ti.lockedBy && ti.lockedBy !== n.id && n.now - ti.lockedAt < 5000) continue;
        cands.push(ti);
      }
    }
    if (skip) for (const ti of cands) (ti.lockedBy = n.id, ti.lockedAt = n.now);
    return cands;
  }

  function apply(db: Db, dbNode: SimNode, chosen: TI[]) {
    const dag = dagOf(n);
    const skip = dbNode.bool('skipLocked', true);
    const ex = execId();
    for (const ti of chosen) {
      if (skip && ti.lockedBy !== n.id) continue;
      ti.lockedBy = undefined;
      if (ti.state !== 'scheduled') {
        if (skip) continue;
        db.races++;
        n.log('info', `Race: no row lock — ${ti.key} was already ${ti.state}, queued again by ${n.name}`);
      }
      mark(n, ti, 'queued');
      ti.queuedAt = n.now;
      if (!ex) continue;
      n.send(ex, {
        kind: 'airflow.task.queue',
        data: {
          key: ti.key, db: dbNode.id, sensor: ti.sensor, condAt: ti.run.condAt, mode: dag.sensor, resumed: !!ti.resumed,
          p50: dag.p50, p99: dag.p99, pokeMs: dag.pokeMs, pokeEveryMs: dag.pokeEveryMs, failPct: dag.failPct, idempotent: dag.idempotent,
          retries: dag.retries, retryDelayMs: dag.retryDelayMs,
        },
      });
    }
  }

  function gauges(db: Db) {
    const c: Record<string, number> = {};
    for (const ti of db.tis.values()) if (ti.run.state === 'running') c[ti.state] = (c[ti.state] ?? 0) + 1;
    n.gauge('runsActive', db.runs.filter(r => r.state === 'running').length);
    n.gauge('runsQueued', db.runs.filter(r => r.state === 'queued').length);
    n.gauge('scheduled', c.scheduled ?? 0);
    n.gauge('queued', c.queued ?? 0);
    n.gauge('running', c.running ?? 0);
    n.gauge('deferred', c.deferred ?? 0);
    n.gauge('sensorsRunning', [...db.tis.values()].filter(t => t.sensor && t.state === 'running').length);
    n.gauge('done', db.done);
    n.gauge('failed', db.failed);
    n.gauge('zombies', db.zombies);
    n.gauge('retries', db.retries);
    n.gauge('runsDone', db.runsDone);
    n.gauge('races', db.races);
    n.gauge('loopMs', Math.round(loopMs));
    n.gauge('stalls', stalls);
  }

  function loop() {
    const t0 = n.now;
    const every = n.num('loopMs', 1000);
    const next = () => n.timer(Math.max(1, every - (n.now - t0)), loop);
    const id = dbId();
    const dbNode = id ? n.world.nodes.get(id) : undefined;
    if (!id || !dbNode) return next();
    const timeout = n.num('dbTimeoutMs', 5000);
    n.rpc(id, { kind: 'airflow.db.query', data: 'SELECT … FOR UPDATE SKIP LOCKED' }, timeout, r => {
      const db = airflowDb(n.world, id);
      if (!r.ok) {
        stalls++;
        loopMs = n.now - t0;
        n.log('info', `Scheduler loop stalled: metadata DB ${r.err} after ${(loopMs / 1000).toFixed(1)}s`);
        gauges(db);
        return next();
      }
      const chosen = plan(db, dbNode);
      // python-side work inside the transaction (dependency checks, pool math) before COMMIT
      n.process(1, n.serviceTime('p50Ms', 'p99Ms', 40, 150), () =>
        n.rpc(id, { kind: 'airflow.db.commit', data: { queued: chosen.length } }, timeout, r2 => {
          if (r2.ok) apply(db, dbNode, chosen);
          else for (const ti of chosen) if (ti.lockedBy === n.id) ti.lockedBy = undefined;
          loopMs = n.now - t0;
          gauges(db);
          next();
        }),
      );
    });
  }

  return {
    onStart() {
      n.timer(n.rng.next() * 200, loop);
      let first = true;
      const parse = () => {
        const ms = n.num('dagFiles', 20) * n.num('parseMsPerFile', 5) * n.mods.slowX;
        n.process(1, ms, () => {
          n.gauge('parseMs', Math.round(ms));
          if (first) n.log('info', `${n.name}: parsed ${n.num('dagFiles', 20)} DAG files in ${Math.round(ms)}ms`);
          first = false;
        });
      };
      n.timer(50, parse);
      n.every(n.num('parseSec', 30) * 1000, parse);
    },
    onRequest(req) {
      // REST API: trigger a manual DagRun
      const id = dbId();
      if (!id) return req.reply({ ok: false, err: '503' });
      n.rpc(id, { kind: 'airflow.db.trigger', traceId: req.msg.traceId }, n.num('dbTimeoutMs', 5000), r => {
        if (r.ok) {
          const db = airflowDb(n.world, id);
          db.runs.push({ id: ++db.runSeq, label: `manual_${db.runSeq}`, created: n.now, condAt: n.now, state: 'queued', tis: [] });
        }
        req.reply(r.ok ? { ok: true } : r);
      });
    },
    view() {
      const badges: Badge[] = [];
      if (linked(n, 'airflow-scheduler').length > 1 || [...n.world.nodes.values()].filter(x => x.type === 'airflow-scheduler').length > 1) badges.push({ text: 'HA', tone: 'accent' });
      if (loopMs > 1000) badges.push({ text: `loop ${(loopMs / 1000).toFixed(1)}s`, tone: 'warn' });
      const g = n.gaugesNow;
      return { badges, label: `${g.runsActive ?? 0} runs · ${g.queued ?? 0} queued · ${g.running ?? 0} running` };
    },
  };
}

// ---------- metadata DB ----------

export function airflowMetadataDb(n: SimNode): NodeLogic {
  const cost = () => n.serviceTime('p50Ms', 'p99Ms', 10, 40);
  function applyTi(d: any) {
    const db = airflowDb(n.world, n.id);
    const ti = db.tis.get(d.key);
    if (!ti) return;
    if (d.state === 'running') {
      mark(n, ti, 'running');
      ti.tries++;
      ti.hbAt = n.now;
      ti.worker = d.worker;
    } else if (ti.state === 'running' || ti.state === 'deferred' || ti.state === 'queued') {
      if (d.state === 'failed') fail(n, db, ti, d.retries, d.retryDelayMs, 'failed');
      else {
        mark(n, ti, d.state);
        if (d.state === 'success') db.done++;
        if (d.state === 'up_for_reschedule') ti.retryAt = n.now + d.pokeEveryMs;
        if (d.state === 'scheduled') ti.resumed = true;
      }
    }
  }
  return {
    onRequest(req) {
      const k = req.msg.kind;
      if (n.mods.diskFull && k !== 'airflow.db.query') return req.reply({ ok: false, err: '5xx' });
      const ms = k === 'airflow.db.query' ? cost() * n.num('queryCost', 8) : cost();
      n.process(1, ms, ok => req.reply(ok ? { ok: true } : { ok: false, err: '503' }));
    },
    onMessage(m: Msg) {
      n.process(1, cost() * 0.5, ok => {
        if (!ok) return;
        const db = airflowDb(n.world, n.id);
        if (m.kind === 'airflow.db.heartbeat') {
          for (const key of m.data?.keys ?? []) {
            const ti = db.tis.get(key);
            if (ti && ti.state === 'running') ti.hbAt = n.now;
          }
        } else if (m.kind === 'airflow.db.ti') applyTi(m.data);
      });
    },
    view() {
      const db = airflowDb(n.world, n.id);
      return {
        badges: [{ text: n.bool('skipLocked', true) ? 'row locks' : 'no locks', tone: n.bool('skipLocked', true) ? 'muted' : 'warn' }],
        label: `${db.tis.size} task instances`,
      };
    },
  };
}

// ---------- workers (also used by the local executor) ----------

function taskRunner(n: SimNode) {
  const queue: any[] = [];
  const running = new Map<number, any>();
  let uid = 0;
  const slots = () => Math.max(1, Math.round(n.num('slots', 8) * n.mods.capacityX));

  function pump() {
    while (running.size < slots() && queue.length) start(queue.shift());
    n.gauge('running', running.size);
    n.gauge('waiting', queue.length);
    n.gauge('sensorSlots', [...running.values()].filter(d => d.sensor).length);
  }

  function start(d: any) {
    const id = ++uid;
    running.set(id, d);
    n.send(d.db, { kind: 'airflow.db.ti', data: { key: d.key, state: 'running', worker: n.id } });
    const done = (state: string, extra: object = {}) => {
      if (running.get(id) !== d) return;
      running.delete(id);
      n.send(d.db, { kind: 'airflow.db.ti', data: { key: d.key, state, retries: d.retries, retryDelayMs: d.retryDelayMs, pokeEveryMs: d.pokeEveryMs, ...extra } });
      pump();
    };
    if (d.sensor) {
      const met = n.now >= d.condAt;
      if (met || d.resumed) return n.timer(d.pokeMs, () => done('success'));
      if (d.mode === 'poke') return n.timer(Math.max(d.pokeMs, d.condAt - n.now), () => done('success'));
      const trig = linked(n, 'airflow-triggerer')[0] ?? [...n.world.nodes.values()].find(x => x.type === 'airflow-triggerer')?.id;
      if (d.mode === 'deferrable' && trig)
        return n.timer(d.pokeMs, () => {
          if (running.get(id) !== d) return;
          n.send(trig, { kind: 'airflow.trigger.defer', data: { key: d.key, db: d.db, at: d.condAt } });
          done('deferred');
        });
      return n.timer(d.pokeMs, () => done('up_for_reschedule'));
    }
    const ms = n.rng.lognormal(d.p50, d.p99) * n.mods.slowX;
    n.series.cur.busy += ms;
    n.timer(ms / 2, () => {
      if (running.get(id) !== d) return;
      const fx = effects.get(n.world) ?? new Map<string, number>();
      effects.set(n.world, fx);
      const c = (fx.get(d.key) ?? 0) + 1;
      fx.set(d.key, c);
      if (c > 1 && !d.idempotent) {
        n.anomaly('duplicate');
        n.log('info', `Duplicate side effect: ${d.key} ran its INSERT again (task is not idempotent)`);
      }
    });
    n.timer(ms, () => done(n.rng.chance(d.failPct / 100) ? 'failed' : 'success'));
  }

  return {
    reset() {
      queue.length = 0;
      running.clear();
      n.every(n.num('heartbeatMs', 1000), () => {
        if (running.size) n.send([...running.values()][0].db, { kind: 'airflow.db.heartbeat', data: { keys: [...running.values()].map(x => x.key) } });
        pump();
      });
    },
    accept(d: any) {
      queue.push(d);
      pump();
    },
    running,
    queue,
    slots,
  };
}

export function airflowWorker(n: SimNode): NodeLogic {
  const r = taskRunner(n);
  return {
    onStart: () => r.reset(),
    onMessage(m) {
      if (m.kind === 'airflow.task.run') r.accept(m.data);
    },
    view() {
      const sensors = [...r.running.values()].filter(d => d.sensor).length;
      const badges: Badge[] = [{ text: `${r.running.size}/${r.slots()} slots`, tone: r.running.size >= r.slots() ? 'warn' : 'muted' }];
      if (sensors) badges.push({ text: `${sensors} sensors`, tone: 'warn' });
      return { badges, label: r.queue.length ? `${r.queue.length} waiting` : undefined };
    },
  };
}

export function airflowExecutor(n: SimNode): NodeLogic {
  const local = taskRunner(n);
  let rr = 0;
  const mode = () => n.str<'local' | 'celery' | 'kubernetes'>('mode', 'celery');
  return {
    onStart: () => local.reset(),
    onMessage(m) {
      if (m.kind !== 'airflow.task.queue') return;
      if (mode() === 'local') return local.accept(m.data);
      const workers = linked(n, 'airflow-worker').filter(id => n.world.nodes.get(id)?.up);
      if (!workers.length) return;
      const w = workers[rr++ % workers.length];
      const delay = mode() === 'kubernetes' ? n.num('podStartMs', 3000) : n.num('brokerMs', 5);
      n.timer(delay, () => n.send(w, { kind: 'airflow.task.run', data: m.data }));
    },
    view() {
      return { badges: [{ text: mode(), tone: 'muted' }], label: mode() === 'local' ? `${local.running.size}/${local.slots()} local slots` : undefined };
    },
  };
}

export function airflowTriggerer(n: SimNode): NodeLogic {
  const pending = new Map<string, number>();
  function arm(key: string, dbId: string, at: number) {
    pending.set(key, at);
    n.timer(Math.max(0, at - n.now), () => {
      if (!pending.delete(key)) return;
      n.send(dbId, { kind: 'airflow.db.ti', data: { key, state: 'scheduled' } });
    });
  }
  return {
    onStart() {
      pending.clear();
      // triggers are persisted: re-arm deferred tasks from the DB after a restart
      for (const id of linked(n, 'airflow-metadata-db'))
        for (const ti of airflowDb(n.world, id).tis.values()) if (ti.state === 'deferred') arm(ti.key, id, ti.run.condAt);
      n.every(1000, () => n.gauge('triggers', pending.size));
    },
    onMessage(m) {
      if (m.kind === 'airflow.trigger.defer') arm(m.data.key, m.data.db, m.data.at);
    },
    view: () => ({ badges: [{ text: `${pending.size} triggers`, tone: 'protocol' }] }),
  };
}

register('airflow-scheduler', airflowScheduler);
register('airflow-metadata-db', airflowMetadataDb);
register('airflow-executor', airflowExecutor);
register('airflow-worker', airflowWorker);
register('airflow-triggerer', airflowTriggerer);
