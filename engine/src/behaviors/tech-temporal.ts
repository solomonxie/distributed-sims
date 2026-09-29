// Temporal internals: frontend, history (event history, timers, timeouts), matching (task queues,
// sticky), persistence (the source of truth) and workers (deterministic replay of workflow code).
import type { NodeLogic, Req, SimNode } from '../node';
import type { Badge, Id, Msg, Reply } from '../types';
import { hashString } from '../rng';
import { register } from './registry';

// ---------- shared model ----------

type EvType =
  | 'WorkflowExecutionStarted'
  | 'WorkflowTaskScheduled'
  | 'WorkflowTaskStarted'
  | 'WorkflowTaskCompleted'
  | 'ActivityTaskScheduled'
  | 'ActivityTaskStarted'
  | 'ActivityTaskCompleted'
  | 'ActivityTaskFailed'
  | 'ActivityTaskTimedOut'
  | 'TimerStarted'
  | 'TimerFired'
  | 'WorkflowExecutionSignaled'
  | 'WorkflowExecutionCompleted';

interface ActOpts {
  stcMs: number;
  hbMs: number;
  max: number;
}
interface Ev {
  t: EvType;
  aid?: number;
  name?: string;
  opts?: ActOpts;
  fireAt?: number;
  result?: string;
}
interface WfRec {
  id: string;
  shard: number;
  events: Ev[];
  status: 'running' | 'completed' | 'compensated' | 'failed';
  nextAid: number;
  sticky?: Id;
  stuck?: boolean;
}

type Cmd = { type: 'act'; name: string; opts: ActOpts } | { type: 'timer'; ms: number } | { type: 'complete'; result: WfRec['status'] };

const ACT_NAMES = ['charge', 'reserve', 'ship', 'email', 'audit', 'invoice'];
const isTemporal = (k: string) => k.startsWith('temporal.');

function find(n: SimNode, type: string): SimNode | undefined {
  for (const e of n.outEdges()) {
    const t = n.world.nodes.get(e.to);
    if (t?.type === type) return t;
  }
  for (const x of n.world.nodes.values()) if (x.type === type) return x;
  return undefined;
}

// ---------- frontend ----------

function frontend(n: SimNode): NodeLogic {
  let seq = 0;
  const relay = (req: Req, type: string, timeout: number) => {
    const to = find(n, type);
    if (!to) return req.reply({ ok: false, err: 'unavailable' });
    n.rpc(to.id, { kind: req.msg.kind, traceId: req.msg.traceId, data: req.msg.data }, timeout, r => req.reply(r));
  };
  return {
    handles: isTemporal,
    onRequest(req) {
      const k = req.msg.kind;
      if (k.startsWith('temporal.Poll')) return relay(req, 'temporal-matching', 70_000);
      if (isTemporal(k)) return relay(req, 'temporal-history', 5000);
      // client: read = StartWorkflowExecution, write = SignalWorkflowExecution
      n.process(req.msg.weight, n.serviceTime('p50Ms', 'p99Ms', 2, 10), ok => {
        if (!ok) return req.reply({ ok: false, err: '503' });
        const h = find(n, 'temporal-history');
        if (!h) return req.reply({ ok: false, err: 'unavailable' });
        const signal = req.msg.op === 'write';
        const kind = signal ? 'temporal.SignalWorkflowExecution' : 'temporal.StartWorkflowExecution';
        n.rpc(h.id, { kind, traceId: req.msg.traceId, data: signal ? {} : { wf: `wf-${n.id}-${++seq}` } }, 5000, r => req.reply(r));
      });
    },
  };
}

// ---------- persistence ----------

interface PersistLogic extends NodeLogic {
  db: Map<string, WfRec>;
}

function persistence(n: SimNode): PersistLogic {
  const db = new Map<string, WfRec>();
  return {
    db,
    handles: isTemporal,
    onRequest(req) {
      n.process(1, n.serviceTime('p50Ms', 'p99Ms', 3, 20), ok => {
        if (!ok) return req.reply({ ok: false, err: '503' });
        const d = req.msg.data as { wf: WfRec | string; events: Ev[] };
        if (typeof d.wf !== 'string') db.set(d.wf.id, d.wf);
        const rec = db.get(typeof d.wf === 'string' ? d.wf : d.wf.id);
        if (!rec) return req.reply({ ok: false, err: 'conflict' });
        rec.events.push(...d.events);
        n.gauge('workflows', db.size);
        n.gauge('events', (n.gaugesNow.events ?? 0) + d.events.length);
        req.reply({ ok: true });
      });
    },
    view: () => ({ label: `${db.size} histories` }),
  };
}

// ---------- history ----------

interface ActRt {
  state: 'queued' | 'started' | 'backoff';
  since: number;
  attempt: number;
  lastHb: number;
  retryAt: number;
  worker?: Id;
  opts: ActOpts;
  name: string;
}
interface WfRt {
  wfTask?: { state: 'persisting' | 'queued' | 'started'; since: number; tok: number };
  needWf: boolean;
  acts: Map<number, ActRt>;
  firing: Set<number>;
}

function history(n: SimNode): NodeLogic {
  let rt = new Map<string, WfRt>();
  let tok = 0;
  let pendingWrites = 0;
  const totals = { completed: 0, compensated: 0, failed: 0, replays: 0 };
  const shards = () => Math.max(1, n.num('shards', 512));
  const store = () => (find(n, 'temporal-persistence')?.logic as PersistLogic | undefined)?.db;
  const rec = (wf: string) => store()?.get(wf);

  /** Append events durably (retries until persistence acks), then continue. */
  /** workflow id → the traced request that started or signalled it */
  const wfTrace = new Map<string, number>();
  const traceOf = (wf: WfRec | string) => wfTrace.get(typeof wf === 'string' ? wf : wf.id);
  const persist = (wf: WfRec | string, events: Ev[], then: () => void) => {
    const p = find(n, 'temporal-persistence');
    pendingWrites++;
    const traceId = traceOf(wf);
    const attempt = () => {
      if (!p) return;
      n.rpc(p.id, { kind: 'temporal.persist', traceId, data: { wf, events } }, 3000, r => {
        if (!r.ok) return void n.timer(500, attempt);
        pendingWrites--;
        then();
      });
    };
    attempt();
  };

  const matching = () => find(n, 'temporal-matching');
  const addTask = (task: Record<string, unknown>) => {
    const m = matching();
    const traceId = traceOf(task.wf as string);
    if (m) n.send(m.id, { kind: task.act !== undefined ? 'temporal.AddActivityTask' : 'temporal.AddWorkflowTask', traceId, data: { ...task, traceId } });
  };

  const scheduleWfTask = (wf: string) => {
    const r = rt.get(wf);
    const w = rec(wf);
    if (!r || !w || w.status !== 'running') return;
    if (r.wfTask) return void (r.needWf = true);
    const t = ++tok;
    r.wfTask = { state: 'persisting', since: n.now, tok: t };
    persist(wf, [{ t: 'WorkflowTaskScheduled' }], () => {
      if (r.wfTask?.tok !== t) return;
      r.wfTask.state = 'queued';
      r.wfTask.since = n.now;
      addTask({ wf, tok: t, sticky: w.sticky });
    });
  };

  const dispatchAct = (wf: string, aid: number, a: ActRt) => {
    a.state = 'queued';
    a.since = n.now;
    addTask({ wf, act: aid, attempt: a.attempt, name: a.name });
  };

  const actEnded = (wf: string, aid: number, a: ActRt, ok: boolean, why: string) => {
    const r = rt.get(wf);
    if (!r) return;
    if (!ok && a.attempt < a.opts.max) {
      a.attempt++;
      a.state = 'backoff';
      a.retryAt = n.now + Math.min(10_000, 1000 * 2 ** (a.attempt - 2));
      n.log('protocol', `${wf}: activity ${a.name} ${why} → retry #${a.attempt} on any worker`);
      return;
    }
    r.acts.delete(aid);
    const done: EvType = ok ? 'ActivityTaskCompleted' : why === 'failed' ? 'ActivityTaskFailed' : 'ActivityTaskTimedOut';
    if (!ok) n.log('protocol', `${wf}: activity ${a.name} ${why} after ${a.attempt} attempts`);
    persist(wf, [{ t: 'ActivityTaskStarted', aid }, { t: done, aid }], () => scheduleWfTask(wf));
  };

  const close = (w: WfRec, result: WfRec['status']) => {
    w.status = result;
    rt.delete(w.id);
    if (result === 'completed') totals.completed++;
    else if (result === 'compensated') totals.compensated++;
    else totals.failed++;
    if (result !== 'completed') n.log('protocol', `${w.id} ${result === 'compensated' ? 'compensated (saga rolled back)' : 'failed'}`);
  };

  const onStarted = (req: Req) => {
    const d = req.msg.data as { wf: string; tok?: number; act?: number; attempt?: number; worker: Id };
    const r = rt.get(d.wf);
    const w = rec(d.wf);
    if (!r || !w) return req.reply({ ok: false, err: 'conflict' });
    if (d.act === undefined) {
      const wt = r.wfTask;
      if (!wt || wt.tok !== d.tok || wt.state !== 'queued') return req.reply({ ok: false, err: 'conflict' });
      wt.state = 'started';
      wt.since = n.now;
      persist(d.wf, [{ t: 'WorkflowTaskStarted' }], () => req.reply({ ok: true, data: { events: w.events.slice() } }));
      return;
    }
    const a = r.acts.get(d.act);
    if (!a || a.state !== 'queued' || a.attempt !== d.attempt) return req.reply({ ok: false, err: 'conflict' });
    a.state = 'started';
    a.since = a.lastHb = n.now;
    a.worker = d.worker;
    req.reply({ ok: true, data: { opts: a.opts } });
  };

  const onWfDone = (req: Req, failed: boolean) => {
    const d = req.msg.data as { wf: string; tok: number; worker: Id; commands?: Cmd[]; replayed?: number; error?: string };
    const r = rt.get(d.wf);
    const w = rec(d.wf);
    if (!r || !w || r.wfTask?.tok !== d.tok) return req.reply({ ok: false, err: 'conflict' });
    req.reply({ ok: true });
    if (d.replayed) totals.replays++;
    if (failed) {
      r.wfTask = undefined;
      if (!w.stuck) n.log('protocol', `${d.wf}: nondeterminism error on ${n.world.nodeName(d.worker)} — ${d.error}; workflow task retrying`);
      w.stuck = true;
      n.timer(2000, () => scheduleWfTask(d.wf));
      return;
    }
    if (w.stuck) n.log('protocol', `${d.wf}: replay succeeds again, workflow unstuck`);
    w.stuck = false;
    w.sticky = d.worker;
    const evs: Ev[] = [{ t: 'WorkflowTaskCompleted' }];
    const acts: [number, ActRt][] = [];
    let result: WfRec['status'] | undefined;
    for (const c of d.commands ?? []) {
      if (c.type === 'act') {
        const aid = w.nextAid++;
        evs.push({ t: 'ActivityTaskScheduled', aid, name: c.name, opts: c.opts });
        acts.push([aid, { state: 'queued', since: n.now, attempt: 1, lastHb: 0, retryAt: 0, opts: c.opts, name: c.name }]);
      } else if (c.type === 'timer') evs.push({ t: 'TimerStarted', aid: w.nextAid++, fireAt: n.now + c.ms });
      else result = c.result;
    }
    if (result) evs.push({ t: 'WorkflowExecutionCompleted', result });
    persist(d.wf, evs, () => {
      r.wfTask = undefined;
      for (const [aid, a] of acts) {
        r.acts.set(aid, a);
        dispatchAct(d.wf, aid, a);
      }
      if (result) return close(w, result);
      if (r.needWf) {
        r.needWf = false;
        scheduleWfTask(d.wf);
      }
    });
  };

  const onActDone = (req: Req, ok: boolean) => {
    const d = req.msg.data as { wf: string; act: number; attempt: number };
    const a = rt.get(d.wf)?.acts.get(d.act);
    if (!a || a.state !== 'started' || a.attempt !== d.attempt) return req.reply({ ok: false, err: 'conflict' });
    req.reply({ ok: true });
    actEnded(d.wf, d.act, a, ok, 'failed');
  };

  /** Everything time-based derives from persisted state: durable timers, timeouts, retries, lost tasks. */
  const watchdog = () => {
    const db = store();
    const wfTimeout = n.num('wfTaskTimeoutSec', 10) * 1000;
    for (const [wf, r] of rt) {
      const w = db?.get(wf);
      if (!w) continue;
      const wt = r.wfTask;
      if (wt && ((wt.state === 'started' && n.now - wt.since > wfTimeout) || (wt.state === 'queued' && n.now - wt.since > 15_000))) {
        n.log('protocol', `${wf}: workflow task timed out on ${wt.state === 'started' ? 'a dead worker' : 'the queue'} → rescheduled`);
        r.wfTask = undefined;
        scheduleWfTask(wf);
      }
      for (const [aid, a] of r.acts) {
        if (a.state === 'backoff' && n.now >= a.retryAt) dispatchAct(wf, aid, a);
        else if (a.state === 'queued' && n.now - a.since > 15_000) dispatchAct(wf, aid, a);
        else if (a.state === 'started' && a.opts.hbMs > 0 && n.now - a.lastHb > a.opts.hbMs) actEnded(wf, aid, a, false, 'heartbeat timeout');
        else if (a.state === 'started' && n.now - a.since > a.opts.stcMs) actEnded(wf, aid, a, false, 'start-to-close timeout');
      }
      for (const e of w.events) {
        if (e.t !== 'TimerStarted' || e.fireAt! > n.now || r.firing.has(e.aid!)) continue;
        if (w.events.some(x => x.t === 'TimerFired' && x.aid === e.aid)) continue;
        r.firing.add(e.aid!);
        persist(wf, [{ t: 'TimerFired', aid: e.aid }], () => scheduleWfTask(wf));
      }
    }
    let running = 0;
    let stuck = 0;
    for (const w of db?.values() ?? []) if (w.status === 'running') (running++, w.stuck && stuck++);
    n.gauge('running', running);
    n.gauge('stuck', stuck);
    n.gauge('completed', totals.completed);
    n.gauge('compensated', totals.compensated);
    n.gauge('failed', totals.failed);
    n.gauge('replays', totals.replays);
    n.gauge('pendingWrites', pendingWrites);
    n.gauge('shards', shards());
  };

  return {
    handles: isTemporal,
    onStart() {
      rt = new Map();
      pendingWrites = 0;
      // (re)load open workflows from persistence: timers and activities resume where history left them
      let loaded = 0;
      for (const w of store()?.values() ?? []) {
        if (w.status !== 'running') continue;
        const r: WfRt = { needWf: false, acts: new Map(), firing: new Set() };
        rt.set(w.id, r);
        const closed = new Set(w.events.filter(e => /^ActivityTask(Completed|Failed|TimedOut)$/.test(e.t)).map(e => e.aid));
        for (const e of w.events)
          if (e.t === 'ActivityTaskScheduled' && !closed.has(e.aid)) {
            const a: ActRt = { state: 'queued', since: n.now, attempt: 1, lastHb: 0, retryAt: 0, opts: e.opts!, name: e.name! };
            r.acts.set(e.aid!, a);
            dispatchAct(w.id, e.aid!, a);
          }
        scheduleWfTask(w.id);
        loaded++;
      }
      if (loaded) n.log('protocol', `${n.name} reloaded ${loaded} open workflows from persistence`);
      n.every(250, watchdog);
    },
    onRequest(req) {
      const k = req.msg.kind;
      if (k === 'temporal.StartWorkflowExecution') {
        const wf = (req.msg.data as { wf: string }).wf;
        if (req.msg.traceId !== undefined) wfTrace.set(wf, req.msg.traceId);
        const w: WfRec = { id: wf, shard: hashString(wf) % shards(), events: [], status: 'running', nextAid: 1 };
        rt.set(wf, { needWf: false, acts: new Map(), firing: new Set() });
        persist(w, [{ t: 'WorkflowExecutionStarted' }], () => {
          req.reply({ ok: true });
          scheduleWfTask(wf);
        });
      } else if (k === 'temporal.SignalWorkflowExecution') {
        const w = [...rt.keys()].map(rec).find(x => x && !x.events.some(e => e.t === 'WorkflowExecutionSignaled'));
        if (!w) return req.reply({ ok: true });
        if (req.msg.traceId !== undefined) wfTrace.set(w.id, req.msg.traceId);
        persist(w.id, [{ t: 'WorkflowExecutionSignaled' }], () => {
          req.reply({ ok: true });
          scheduleWfTask(w.id);
        });
      } else if (k === 'temporal.RecordTaskStarted') onStarted(req);
      else if (k === 'temporal.RespondWorkflowTaskCompleted') onWfDone(req, false);
      else if (k === 'temporal.RespondWorkflowTaskFailed') onWfDone(req, true);
      else if (k === 'temporal.RespondActivityTaskCompleted') onActDone(req, true);
      else if (k === 'temporal.RespondActivityTaskFailed') onActDone(req, false);
      else if (k === 'temporal.RecordActivityTaskHeartbeat') {
        const d = req.msg.data as { wf: string; act: number; attempt: number };
        const a = rt.get(d.wf)?.acts.get(d.act);
        if (a && a.attempt === d.attempt) a.lastHb = n.now;
        req.reply({ ok: !!a });
      } else req.reply({ ok: false, err: '5xx' });
    },
    view: () => ({ badges: [{ text: `${shards()} shards`, tone: 'muted' }], label: `${n.gaugesNow.running ?? 0} running · ${totals.completed} done` }),
  };
}

// ---------- matching ----------

interface Task {
  wf: string;
  tok?: number;
  act?: number;
  attempt?: number;
  name?: string;
  sticky?: Id;
  stickyUntil: number;
  /** the traced request behind this workflow */
  traceId?: number;
}
interface Poll {
  wfQ: boolean;
  worker: Id;
  epoch: number;
  req: Req;
}

function matching(n: SimNode): NodeLogic {
  let wfQ: Task[] = [];
  let actQ: Task[] = [];
  let polls: Poll[] = [];
  const alive = (p: Poll) => {
    const w = n.world.nodes.get(p.worker);
    return !!w && w.up && w.epoch === p.epoch;
  };
  const give = (p: Poll, t: Task) => {
    const h = find(n, 'temporal-history');
    if (!h) return p.req.reply({ ok: true });
    // the poll was parked before the task existed: its answer belongs to the task's trace
    n.rpc(h.id, { kind: 'temporal.RecordTaskStarted', traceId: t.traceId, data: { ...t, worker: p.worker } }, 3000, r =>
      p.req.reply((r.ok ? { ok: true, data: { task: t, ...(r.data ?? {}) }, traceId: t.traceId } : { ok: true }) as Reply),
    );
  };
  const match = () => {
    polls = polls.filter(alive);
    for (const [q, isWf] of [[wfQ, true], [actQ, false]] as const) {
      for (let i = 0; i < q.length; i++) {
        const t = q[i];
        const sticky = isWf && t.sticky && n.now < t.stickyUntil;
        const pi = polls.findIndex(p => p.wfQ === isWf && (!sticky || p.worker === t.sticky));
        if (pi < 0) continue;
        const [p] = polls.splice(pi, 1);
        q.splice(i--, 1);
        give(p, t);
      }
    }
    n.gauge('wfBacklog', wfQ.length);
    n.gauge('actBacklog', actQ.length);
    n.gauge('pollers', polls.length);
  };
  return {
    handles: isTemporal,
    onStart() {
      wfQ = [];
      actQ = [];
      polls = [];
    },
    onMessage(m: Msg) {
      const d = m.data as Task;
      const t: Task = { ...d, stickyUntil: n.now + n.num('stickyTimeoutSec', 5) * 1000 };
      if (m.kind === 'temporal.AddWorkflowTask') wfQ.push(t);
      else actQ.push(t);
      if (t.sticky) n.timer(n.num('stickyTimeoutSec', 5) * 1000 + 1, match);
      match();
    },
    onRequest(req) {
      const d = req.msg.data as { worker: Id; epoch: number };
      const p: Poll = { wfQ: req.msg.kind === 'temporal.PollWorkflowTaskQueue', worker: d.worker, epoch: d.epoch, req };
      polls.push(p);
      n.timer(n.num('pollSec', 60) * 1000, () => {
        const i = polls.indexOf(p);
        if (i >= 0) polls.splice(i, 1), req.reply({ ok: true });
      });
      match();
    },
    view: () => ({ label: `wf ${wfQ.length} · act ${actQ.length} queued` }),
  };
}

// ---------- worker ----------

type Step = { kind: 'act'; name: string } | { kind: 'timer' } | { kind: 'signal' };

function worker(n: SimNode): NodeLogic {
  let version = 1;
  let cache = new Map<string, number>();
  let busy = { wf: 0, act: 0 };
  let replays = 0;

  const program = (): Step[] => {
    const acts = ACT_NAMES.slice(0, Math.max(1, Math.min(ACT_NAMES.length, n.num('activities', 3))));
    const steps: Step[] = acts.map(name => ({ kind: 'act', name }));
    const extra: Step[] = [];
    if (n.num('timerSec', 0) > 0) extra.push({ kind: 'timer' });
    if (n.bool('awaitSignal', false)) extra.push({ kind: 'signal' });
    steps.splice(1, 0, ...extra);
    // v2 = a non-deterministic change: a new activity inserted before the old first one
    if (version !== n.num('codeVersion', 1)) steps.unshift({ kind: 'act', name: 'fraudCheck' });
    return steps;
  };
  const opts = (): ActOpts => ({
    stcMs: n.num('startToCloseSec', 30) * 1000,
    hbMs: n.num('heartbeatSec', 0) * 1000,
    max: Math.max(1, n.num('maxAttempts', 3)),
  });

  /** Deterministic replay of the workflow code against its history. */
  const replay = (events: Ev[]): { commands: Cmd[]; at: string } | { error: string } => {
    const cmds = events.filter(e => e.t === 'ActivityTaskScheduled' || e.t === 'TimerStarted');
    const outcome = (aid: number) => events.find(e => e.aid === aid && /Completed|Failed|TimedOut|TimerFired/.test(e.t));
    let ci = 0;
    const done: string[] = [];
    let steps = program();
    let failed = false;
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      if (s.kind === 'signal') {
        if (!events.some(e => e.t === 'WorkflowExecutionSignaled')) return { commands: [], at: 'await signal' };
        continue;
      }
      const ev = cmds[ci];
      const label = s.kind === 'act' ? s.name : 'sleep';
      if (!ev) return { commands: [s.kind === 'act' ? { type: 'act', name: s.name, opts: opts() } : { type: 'timer', ms: n.num('timerSec', 0) * 1000 }], at: label };
      const same = s.kind === 'act' ? ev.t === 'ActivityTaskScheduled' && ev.name === s.name : ev.t === 'TimerStarted';
      if (!same) return { error: `history has ${ev.name ?? 'a timer'} where code now runs ${label}` };
      ci++;
      const out = outcome(ev.aid!);
      if (!out) return { commands: [], at: label };
      if (s.kind !== 'act') continue;
      if (out.t === 'ActivityTaskCompleted') done.push(s.name);
      else if (!failed && n.bool('saga', false)) {
        // saga: compensate completed steps in reverse
        failed = true;
        steps = [...steps.slice(0, i + 1), ...done.reverse().map(x => ({ kind: 'act' as const, name: 'undo-' + x }))];
      } else if (!failed) return { commands: [{ type: 'complete', result: 'failed' }], at: 'failed' };
    }
    if (ci < cmds.length) return { error: 'history has more commands than the code produces' };
    return { commands: [{ type: 'complete', result: failed ? 'compensated' : 'completed' }], at: 'complete' };
  };

  const fe = () => find(n, 'temporal-frontend');
  const call = (kind: string, data: unknown, traceId?: number) => {
    const f = fe();
    if (f) n.rpc(f.id, { kind, traceId, data }, 5000, () => {});
  };

  const runWfTask = (task: Task, events: Ev[], next: () => void) => {
    const hit = cache.has(task.wf);
    const res = replay(events);
    const full = !hit && events.some(e => e.t === 'ActivityTaskScheduled' || e.t === 'TimerStarted');
    n.process(1, (hit ? 3 : 3 + events.length * 0.3) * n.mods.slowX, () => {
      if ('error' in res) {
        cache.delete(task.wf);
        call('temporal.RespondWorkflowTaskFailed', { wf: task.wf, tok: task.tok, worker: n.id, error: res.error }, task.traceId);
        return next();
      }
      if (full) {
        replays++;
        n.log('protocol', `${n.name} replayed ${events.length} events of ${task.wf}, resuming at ${res.at}`);
      }
      cache.set(task.wf, events.length);
      if (res.commands.some(c => c.type === 'complete')) cache.delete(task.wf);
      call('temporal.RespondWorkflowTaskCompleted', { wf: task.wf, tok: task.tok, worker: n.id, commands: res.commands, replayed: full ? 1 : 0 }, task.traceId);
      next();
    });
  };

  const runActivity = (task: Task, o: ActOpts, next: () => void) => {
    const base = { wf: task.wf, act: task.act, attempt: task.attempt };
    const epoch = n.epoch;
    let running = true;
    if (o.hbMs > 0) {
      const beat = () => {
        if (!running) return;
        call('temporal.RecordActivityTaskHeartbeat', base, task.traceId);
        n.timer(o.hbMs * 0.4, beat);
      };
      n.timer(o.hbMs * 0.4, beat);
    }
    const finish = (ok: boolean) => {
      running = false;
      if (epoch !== n.epoch) return;
      call(ok ? 'temporal.RespondActivityTaskCompleted' : 'temporal.RespondActivityTaskFailed', base, task.traceId);
      next();
    };
    const ms = n.serviceTime('actP50Ms', 'actP99Ms', 800, 2500);
    n.timer(ms, () => {
      if (n.rng.chance(n.num('activityFailPct', 0) / 100)) return finish(false);
      // an activity calls the downstream edge routed to its name (undo-x → x)
      const name = (task.name ?? '').replace(/^undo-/, '');
      const e = n.syncOut().find(x => x.cfg.route === name);
      if (!e) return finish(true);
      n.call(e, n.world.newMsg({ from: n.id, to: e.to, op: 'write', key: task.act, traceId: task.traceId }), r => finish(r.ok));
    });
  };

  const poll = (isWf: boolean) => {
    const f = fe();
    const again = (ms: number) => n.timer(ms, () => poll(isWf));
    if (!f) return void again(1000);
    const kind = isWf ? 'temporal.PollWorkflowTaskQueue' : 'temporal.PollActivityTaskQueue';
    n.rpc(f.id, { kind, data: { worker: n.id, epoch: n.epoch } }, 70_000, r => {
      const d = r.data as { task?: Task; events?: Ev[]; opts?: ActOpts } | undefined;
      if (!r.ok || !d?.task) return void again(r.ok ? 5 : 1000);
      const slot = isWf ? 'wf' : 'act';
      busy[slot]++;
      const next = () => {
        busy[slot]--;
        poll(isWf);
      };
      if (isWf) runWfTask(d.task, d.events ?? [], next);
      else runActivity(d.task, d.opts ?? opts(), next);
    });
  };

  return {
    handles: isTemporal,
    onStart() {
      cache = new Map();
      busy = { wf: 0, act: 0 };
      for (let i = 0; i < n.num('wfSlots', 2); i++) poll(true);
      for (let i = 0; i < n.num('actSlots', 8); i++) poll(false);
      n.every(500, () => {
        n.gauge('wfBusy', busy.wf);
        n.gauge('actBusy', busy.act);
        n.gauge('cached', cache.size);
        n.gauge('replays', replays);
      });
    },
    onChaos(kind, _p, heal) {
      if (kind !== 'bad-deploy') return false;
      version = heal ? n.num('codeVersion', 1) : n.num('codeVersion', 1) + 1;
      cache = new Map();
      n.log('info', heal ? `${n.name} rolled back to v${version}` : `${n.name} deployed v${version}: new fraudCheck activity before charge (non-deterministic)`);
      return true;
    },
    view: () => {
      const badges: Badge[] = [{ text: `v${version}`, tone: version !== n.num('codeVersion', 1) ? 'warn' : 'muted' }];
      return { badges, label: `wf ${busy.wf}/${n.num('wfSlots', 2)} · act ${busy.act}/${n.num('actSlots', 8)}` };
    },
  };
}

register('temporal-frontend', frontend);
register('temporal-history', history);
register('temporal-matching', matching);
register('temporal-persistence', persistence);
register('temporal-worker', worker);

export type { WfRec as TemporalWorkflow };
