// Spark internals: driver (DAG scheduler + task scheduler), executors (cores, memory, shuffle blocks).
// One request (or cron tick) = one job = `stages` stages split at shuffle boundaries, one task per partition.
import type { NodeLogic, Req, SimNode } from '../node';
import type { Badge, Reply } from '../types';
import { register } from './registry';

interface Job {
  id: number;
  req?: Req;
  stages: number;
  parts: number;
  /** out[s][p] = executor holding the shuffle output ('driver' for result-stage partitions) */
  out: (string | undefined)[][];
  durs: number[][];
  started: number;
  stage: number;
}

interface Task {
  id: number;
  job: Job;
  stage: number;
  part: number;
  exec: string;
  start: number;
  spec: boolean;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};
const sec = (ms: number) => (ms / 1000).toFixed(1) + 's';

function nodesOfType(n: SimNode, type: string): string[] {
  const linked = n.outEdges(e => n.world.nodes.get(e.to)?.type === type).map(e => e.to);
  if (linked.length) return [...new Set(linked)];
  return [...n.world.nodes.values()].filter(x => x.type === type).map(x => x.id);
}

export function sparkDriver(n: SimNode): NodeLogic {
  let seq = 0;
  let jobSeq = 0;
  let execs: string[] = [];
  const alive = new Set<string>();
  const active = new Set<string>();
  const readyAt = new Map<string, number>();
  const lastHb = new Map<string, number>();
  const busy = new Map<string, number>();
  const idleSince = new Map<string, number>();
  let running = new Map<number, Task>();
  let queue: Job[] = [];
  let job: Job | undefined;
  let hot = 0;
  let backlogSince = -1;
  let reqStep = 1;
  // survive driver restarts (shown as history)
  let jobsDone = 0;
  let jobsLost = 0;
  let recomputed = 0;
  let spillMb = 0;
  let specLaunched = 0;

  const slots = (x: string) => n.world.nodes.get(x)?.num('slots', 4) ?? 4;
  const ready = (x: string) => alive.has(x) && active.has(x) && (readyAt.get(x) ?? 0) <= n.now;
  const free = (x: string) => (ready(x) ? slots(x) - (busy.get(x) ?? 0) : 0);
  const name = (x: string) => n.world.nodeName(x);

  function partMb(j: Job, s: number, p: number): number {
    const input = n.num('inputMb', 2048);
    const skew = Math.max(1, n.num('skew', 1));
    // skew appears after a shuffle (records grouped by key); stage 0 reads even input splits
    if (s === 0 || (hot <= 0 && skew <= 1)) return input / j.parts;
    const share = hot > 0 ? hot : Math.min(0.95, skew / (skew + j.parts - 1));
    return p === 0 ? input * share : (input * (1 - share)) / (j.parts - 1);
  }

  function currentStage(j: Job): number {
    for (let s = 0; s < j.stages; s++) if (j.out[s].some(x => x === undefined)) return s;
    return -1;
  }

  function enqueue(req?: Req) {
    if (queue.length >= n.num('queueLimit', 20)) return req?.reply({ ok: false, err: '503' });
    const stages = Math.max(1, Math.round(n.num('stages', 3)));
    const parts = Math.max(1, Math.round(n.num('partitions', 16)));
    queue.push({
      id: ++jobSeq,
      req,
      stages,
      parts,
      out: Array.from({ length: stages }, () => new Array(parts).fill(undefined)),
      durs: Array.from({ length: stages }, () => []),
      started: 0,
      stage: -1,
    });
    schedule();
  }

  function schedule() {
    if (!job) {
      job = queue.shift();
      if (!job) return;
      job.started = n.now;
      n.log('info', `Job ${job.id} submitted: DAG → ${job.stages} stages (${job.stages - 1} shuffle boundaries) × ${job.parts} partitions`);
    }
    const j = job;
    const s = currentStage(j);
    if (s < 0) return finishJob(j);
    if (s !== j.stage) {
      const recompute = s < j.stage;
      j.stage = s;
      const missing = j.out[s].filter(x => x === undefined).length;
      n.log('info', recompute
        ? `Job ${j.id}: resubmitting stage ${s + 1}/${j.stages} — ${missing} lost partitions recomputed from lineage`
        : `Job ${j.id}: stage ${s + 1}/${j.stages} ${s === 0 ? 'reads input' : 'shuffle read'} → ${missing} tasks`);
    }
    for (let p = 0; p < j.parts; p++) {
      if (j.out[s][p] !== undefined || [...running.values()].some(t => t.job === j && t.stage === s && t.part === p)) continue;
      const x = pickExec();
      if (!x) break;
      launch(j, s, p, x, false);
    }
  }

  function pickExec(not?: string): string | undefined {
    let best: string | undefined;
    for (const x of execs) if (x !== not && free(x) > 0 && (!best || free(x) > free(best))) best = x;
    return best;
  }

  function launch(j: Job, s: number, p: number, x: string, spec: boolean) {
    const t: Task = { id: ++seq, job: j, stage: s, part: p, exec: x, start: n.now, spec };
    running.set(t.id, t);
    busy.set(x, (busy.get(x) ?? 0) + 1);
    idleSince.delete(x);
    const mb = partMb(j, s, p);
    const ms = mb * n.num('msPerMb', 10) + n.num('taskOverheadMs', 50);
    const from = s > 0 ? [...new Set(j.out[s - 1].filter((e): e is string => !!e))] : [];
    const data = { job: j.id, stage: s, part: p, mb: Math.round(mb), ms, from, result: s === j.stages - 1, spec };
    n.rpc(x, { kind: 'spark.task', data }, 600_000, r => taskEnded(t, r));
  }

  function release(t: Task) {
    running.delete(t.id);
    busy.set(t.exec, Math.max(0, (busy.get(t.exec) ?? 0) - 1));
    if (!busy.get(t.exec)) idleSince.set(t.exec, n.now);
  }

  function taskEnded(t: Task, r: Reply) {
    if (!running.has(t.id)) return;
    release(t);
    const j = t.job;
    if (j !== job) return schedule();
    if (r.ok) {
      spillMb += r.data?.spill ?? 0;
      if (j.out[t.stage][t.part] === undefined) {
        j.out[t.stage][t.part] = t.stage === j.stages - 1 ? 'driver' : t.exec;
        j.durs[t.stage].push(n.now - t.start);
        if (t.spec) n.log('info', `Speculative copy of task ${t.part} won on ${name(t.exec)} (${sec(n.now - t.start)})`);
      }
    } else if (r.data?.fetchFailed) {
      n.log('info', `FetchFailed: task ${t.part} of stage ${t.stage + 1} could not read shuffle blocks from ${name(r.data.fetchFailed)}`);
      executorLost(r.data.fetchFailed, 'shuffle fetch failed');
    }
    schedule();
  }

  function executorLost(x: string, why: string) {
    if (!alive.has(x)) return;
    alive.delete(x);
    busy.set(x, 0);
    let tasks = 0;
    for (const t of [...running.values()]) if (t.exec === x) (running.delete(t.id), tasks++);
    let blocks = 0;
    if (job) {
      for (let s = 0; s < job.stages - 1; s++)
        for (let p = 0; p < job.parts; p++)
          if (job.out[s][p] === x) (job.out[s][p] = undefined, blocks++);
      recomputed += blocks;
    }
    n.log('info', `${name(x)} lost (${why}): ${tasks} running tasks rescheduled, ${blocks} shuffle outputs gone${blocks ? ' → recompute via lineage' : ''}`);
    schedule();
  }

  function finishJob(j: Job) {
    jobsDone++;
    n.log('info', `Job ${j.id} done in ${sec(n.now - j.started)} (${j.stages} stages, ${j.stages * j.parts} tasks)`);
    j.req?.reply({ ok: true });
    job = undefined;
    schedule();
  }

  function speculate(j: Job, s: number) {
    const done = j.out[s].filter(x => x !== undefined).length;
    const med = median(j.durs[s]);
    if (!med || done < n.num('speculationQuantile', 0.75) * j.parts) return;
    for (const t of [...running.values()]) {
      if (t.job !== j || t.stage !== s || t.spec) continue;
      const el = n.now - t.start;
      if (el < n.num('speculationMultiplier', 1.5) * med) continue;
      if ([...running.values()].some(u => u.spec && u.job === j && u.stage === s && u.part === t.part)) continue;
      const x = pickExec(t.exec);
      if (!x) return;
      specLaunched++;
      n.log('info', `Speculation: task ${t.part} running ${sec(el)} (median ${sec(med)}) → copy on ${name(x)}`);
      launch(j, s, t.part, x, true);
    }
  }

  function allocate(j: Job | undefined) {
    const min = Math.max(1, Math.round(n.num('minExecutors', 1)));
    const pending = j ? j.out[Math.max(0, currentStage(j))].filter(x => x === undefined).length - [...running.values()].filter(t => t.job === j).length : 0;
    const freeSlots = execs.reduce((a, x) => a + free(x), 0);
    if (pending > freeSlots) {
      if (backlogSince < 0) backlogSince = n.now;
      const idle = execs.filter(x => alive.has(x) && !active.has(x));
      if (n.now - backlogSince >= n.num('backlogTimeoutMs', 1000) && idle.length) {
        const add = idle.slice(0, reqStep);
        for (const x of add) {
          active.add(x);
          readyAt.set(x, n.now + n.num('executorStartMs', 2000));
          lastHb.set(x, n.now + n.num('executorStartMs', 2000));
          idleSince.set(x, n.now + n.num('executorStartMs', 2000));
          n.send(x, { kind: 'spark.executor.launch' });
          n.timer(n.num('executorStartMs', 2000) + 1, schedule);
        }
        n.log('info', `Dynamic allocation: ${pending} pending tasks → requesting ${add.length} executor${add.length > 1 ? 's' : ''}`);
        reqStep *= 2;
        backlogSince = n.now;
      }
    } else {
      backlogSince = -1;
      reqStep = 1;
    }
    const idleMs = n.num('executorIdleSec', 10) * 1000;
    for (const x of [...execs].reverse()) {
      if (!active.has(x) || active.size <= min || busy.get(x)) continue;
      if (n.now - (idleSince.get(x) ?? n.now) >= idleMs) {
        active.delete(x);
        n.send(x, { kind: 'spark.executor.release' });
        n.log('info', `Dynamic allocation: ${name(x)} idle ${idleMs / 1000}s → released`);
      }
    }
  }

  function tick() {
    const hbTimeout = n.num('executorTimeoutMs', 4000);
    for (const x of [...alive]) if (active.has(x) && n.now - (lastHb.get(x) ?? n.now) > hbTimeout) executorLost(x, 'no heartbeat');
    const j = job;
    const s = j ? currentStage(j) : -1;
    if (j && s >= 0 && n.bool('speculation', false)) speculate(j, s);
    if (n.bool('dynamicAllocation', false)) allocate(j);
    const med = j && s >= 0 ? median(j.durs[s]) : 0;
    const stragglers = med ? [...running.values()].filter(t => t.job === j && t.stage === s && n.now - t.start > 2 * med).length : 0;
    n.gauge('stage', j && s >= 0 ? s + 1 : 0);
    n.gauge('stages', j?.stages ?? n.num('stages', 3));
    n.gauge('tasksDone', j && s >= 0 ? j.out[s].filter(x => x !== undefined).length : 0);
    n.gauge('tasksTotal', j?.parts ?? n.num('partitions', 16));
    n.gauge('running', running.size);
    n.gauge('stragglers', stragglers);
    n.gauge('jobsDone', jobsDone);
    n.gauge('jobsLost', jobsLost);
    n.gauge('jobsQueued', queue.length);
    n.gauge('recomputed', recomputed);
    n.gauge('spillMB', Math.round(spillMb));
    n.gauge('speculative', specLaunched);
    n.gauge('executors', execs.filter(ready).length);
    n.gauge('slots', execs.reduce((a, x) => a + (ready(x) ? slots(x) : 0), 0));
  }

  return {
    onStart() {
      execs = nodesOfType(n, 'spark-executor');
      running = new Map();
      queue = [];
      job = undefined;
      backlogSince = -1;
      reqStep = 1;
      const dyn = n.bool('dynamicAllocation', false);
      const min = Math.max(1, Math.round(n.num('minExecutors', 1)));
      alive.clear();
      active.clear();
      execs.forEach((x, i) => {
        alive.add(x);
        lastHb.set(x, n.now);
        busy.set(x, 0);
        idleSince.set(x, n.now);
        readyAt.set(x, 0);
        if (!dyn || i < min) active.add(x);
        n.send(x, { kind: dyn && i >= min ? 'spark.executor.release' : 'spark.executor.launch' });
      });
      n.every(500, tick);
      const cron = n.num('cronSec', 0);
      if (cron > 0) {
        n.timer(1000, () => enqueue());
        n.every(cron * 1000, () => enqueue());
      }
    },
    onRequest(req) {
      if (req.msg.kind !== 'req') return req.reply({ ok: false, err: '5xx' });
      enqueue(req);
    },
    onMessage(m) {
      if (m.kind !== 'spark.heartbeat') return;
      lastHb.set(m.from, n.now);
      if (!alive.has(m.from) && execs.includes(m.from)) {
        alive.add(m.from);
        busy.set(m.from, 0);
        idleSince.set(m.from, n.now);
        n.log('info', `${name(m.from)} registered with the driver`);
        schedule();
      }
    },
    onChaos(kind, p, heal) {
      if (kind !== 'hot-key') return false;
      const h = Number(p.hot ?? 0.4);
      hot = heal ? 0 : h > 1 ? h / 100 : h;
      if (!heal) n.log('info', `Data skew: one key holds ${Math.round(hot * 100)}% of rows → after the shuffle partition 0 is ${Math.round(hot * (job?.parts ?? n.num('partitions', 16)) / (1 - hot) * 10) / 10}× the others`);
      return true;
    },
    onKill() {
      if (job || queue.length) {
        jobsLost += (job ? 1 : 0) + queue.length;
        const s = job ? Math.max(0, currentStage(job)) : 0;
        n.log('info', `Driver died: job lost${job ? ` at stage ${s + 1}/${job.stages}` : ''} (+${queue.length} queued) — DAG and shuffle map live only in the driver`);
      }
      n.gauge('jobsLost', jobsLost);
    },
    view() {
      const j = job;
      const s = j ? currentStage(j) : -1;
      const badges: Badge[] = [];
      if (j && s >= 0) badges.push({ text: `S${s + 1}/${j.stages}`, tone: 'accent' });
      const strag = n.gaugesNow.stragglers ?? 0;
      if (strag) badges.push({ text: `🐢 ${strag}`, tone: 'warn' });
      if (hot > 0) badges.push({ text: 'skew', tone: 'warn' });
      return {
        badges,
        label: j && s >= 0 ? `Job ${j.id} · stage ${s + 1}/${j.stages} · ${j.out[s].filter(x => x !== undefined).length}/${j.parts}` : `${jobsDone} jobs done`,
      };
    },
  };
}

export function sparkExecutor(n: SimNode): NodeLogic {
  let released = false;
  let blocks = 0;
  let spill = 0;
  let running = 0;
  let driver: string | undefined;

  function compute(req: Req, d: any) {
    const memPerTask = (n.num('memoryMb', 4096) * n.num('memoryFraction', 0.6)) / Math.max(1, n.num('slots', 4));
    const over = Math.max(0, d.mb - memPerTask);
    const ms = d.ms * (0.9 + 0.2 * n.rng.next()) * n.mods.slowX * (1 + (over / Math.max(1, d.mb)) * n.num('spillPenalty', 1.5));
    n.process(1, ms, ok => {
      running--;
      if (!ok) return req.reply({ ok: false, err: '503' });
      if (!d.result) blocks++;
      spill += over;
      n.gauge('spillMB', Math.round(spill));
      req.reply({ ok: true, data: { spill: Math.round(over) } });
    });
  }

  return {
    onStart() {
      blocks = 0;
      running = 0;
      released = false;
      driver = [...n.world.nodes.values()].find(x => x.type === 'spark-driver' && x.outEdges(e => e.to === n.id).length)?.id
        ?? [...n.world.nodes.values()].find(x => x.type === 'spark-driver')?.id;
      n.every(n.num('heartbeatMs', 1000), () => {
        if (driver && !released) n.send(driver, { kind: 'spark.heartbeat' });
        n.gauge('running', running);
        n.gauge('blocks', blocks);
      });
    },
    onRequest(req) {
      const d = req.msg.data ?? {};
      if (req.msg.kind === 'spark.shuffle.fetch') return req.reply({ ok: true });
      if (req.msg.kind !== 'spark.task') return req.reply({ ok: false, err: '5xx' });
      running++;
      const peers: string[] = (d.from ?? []).filter((x: string) => x !== n.id);
      if (!peers.length) return compute(req, d);
      let left = peers.length;
      let failed: string | undefined;
      for (const x of peers)
        n.rpc(x, { kind: 'spark.shuffle.fetch', data: { job: d.job, stage: d.stage } }, n.num('fetchTimeoutMs', 1500), r => {
          if (!r.ok) failed ??= x;
          if (--left) return;
          if (failed) {
            running--;
            return req.reply({ ok: false, err: 'unavailable', data: { fetchFailed: failed } });
          }
          compute(req, d);
        });
    },
    onMessage(m) {
      if (m.kind === 'spark.executor.release') released = true;
      if (m.kind === 'spark.executor.launch') released = false;
    },
    onKill() {
      blocks = 0;
      spill = 0;
    },
    view() {
      const badges: Badge[] = [];
      if (released) badges.push({ text: 'released', tone: 'muted' });
      else badges.push({ text: `${Math.min(running, n.num('slots', 4))}/${n.num('slots', 4)} cores`, tone: running ? 'accent' : 'muted' });
      if (spill > 0) badges.push({ text: `spill ${Math.round(spill)}MB`, tone: 'warn' });
      return { badges, label: released ? 'released' : `${blocks} shuffle blocks` };
    },
  };
}

register('spark-driver', sparkDriver);
register('spark-executor', sparkExecutor);
