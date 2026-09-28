import { create } from 'zustand';
import { makeMutable } from 'react-native-reanimated';
import { createRun, type ChaosEvent, type Flight, type Msg, type Reply, type Run, type Snapshot, type Span, type SystemDoc, type Trace, type TrafficEvent } from '@dsims/engine';
import { catalog } from '@dsims/content';
import type { Layout } from '../canvas/layout';
import { useSettings } from './settings';
import { haptic } from '../lib/haptics';

export const simTime = makeMutable(0);
export const flightsSV = makeMutable<number[]>([]);
export const anchorsSV = makeMutable<number[]>([]);

/** Unit animation speed: every dot, in every design, travels this many canvas points per second at 1×. */
export const DOT_PT_PER_SEC = 140;
export const ANIM_SPEEDS = [0.1, 0.25, 0.5, 1, 2, 4, 10];
/** simulated time runs at this fraction of real time (× animation speed); dot speed never depends on it */
const SIM_PACE = 0.15;
/** challenges score a whole run, so their clock runs faster */
export const CHALLENGE_PACE = 0.5;
/** requests you fired that may travel at once */
const JOURNEYS = 4;
/** protocol dots (heartbeats, votes, replication) drawn at once */
const MAX_PROTO = 24;
const PROTO_TYPES = /consensus|paxos|gossip|zk-server|kraft|lock-service|txn-coordinator|crdt/;

/** One hop of a featured request's journey. */
export interface JourneyHop {
  from: string;
  to: string;
  reply: boolean;
  ok: boolean;
  err?: string;
  /** time spent inside the destination (sim ms) */
  spanMs: number;
  traceId: number;
  /** what was on the wire, when still recorded */
  msg?: Msg;
  res?: Reply;
  /** index of the matching request/response hop */
  pair: number;
  /** the destination called further components before answering (cache miss, proxy) */
  calls: boolean;
  /** time spent at `to` itself (queue + work), sim ms — shown as a pause at the node */
  wait?: boolean;
  /** last beat: the request is back at the user */
  done?: boolean;
  /** the call got no answer (component down, dropped); the caller gave up */
  ghost?: boolean;
  /** wait beats: the component it is waiting on, when it's waiting for an answer that never comes */
  peer?: string;
}

interface Journey {
  hops: JourneyHop[];
  start: number;
  traceId: number;
  /** cumulative end time (ms from start) of each hop — constant pt/s means longer hops take longer */
  ends: number[];
}

/** The view at one hop boundary of the followed request, for stepping back. */
interface Checkpoint {
  simT: number;
  speed: number;
  journeys: { hops: JourneyHop[]; traceId: number; ends: number[]; startOff: number }[];
  shown: number[];
}
const HISTORY = 60;

interface RunState {
  active: boolean;
  playing: boolean;
  /** animation speed the user controls (0.1×–10×) */
  speed: number;
  t: number;
  duration: number;
  snapshot: Snapshot | null;
  actualSpeed: number;
  overloaded: boolean;
  ended: boolean;
  rewinding: boolean;
  eventCount: number;
  seed: number;
  followTrace?: number;
  /** a step back is available */
  canBack: boolean;
  /** the request being narrated: its hops and which one is on screen */
  lead?: { hops: JourneyHop[]; i: number; traceId: number; total?: number; ok?: boolean };
  /** requests fired but still being resolved */
  pending: number;
  /** featured requests pick themselves (lessons); otherwise the user fires them */
  auto: boolean;
  /** configured background rate, to tell when a burst is on */
  baseRps: number;
}

export const useRun = create<RunState>(() => ({
  active: false,
  playing: false,
  speed: 1,
  t: 0,
  duration: 120000,
  snapshot: null,
  actualSpeed: 1,
  overloaded: false,
  ended: false,
  rewinding: false,
  eventCount: 0,
  seed: 1,
  canBack: false,
  pending: 0,
  auto: false,
  baseRps: 0,
}));

const OP: Record<string, number> = { read: 0, write: 1, proto: 2, reply: 3 };
const FRAME_BUDGET_MS = 7;

class Controller {
  run: Run | null = null;
  /** id of the doc whose editor started this run */
  owner?: string;
  private raf = 0;
  private last = 0;
  private lastSnap = 0;
  private nodeIndex = new Map<string, number>();
  private alertsSeen = 0;
  private lastEventLen = 0;
  onEnd?: (run: Run) => void;
  onEvent?: (e: { kind: string; text: string; node?: string }) => void;

  start(doc: SystemDoc, layout: Layout, opts?: { seed?: number; speed?: number; autoplay?: boolean; owner?: string; pace?: number; auto?: boolean }) {
    this.stop();
    this.owner = opts?.owner ?? doc.id;
    this.pace = opts?.pace ?? SIM_PACE;
    const seed = opts?.seed ?? Math.floor(Math.random() * 1e6);
    const settings = useSettings.getState();
    const budget = settings.particles === 'low' ? 600 : settings.particles === 'high' ? 3000 : 1500;
    this.run = createRun(ensureScenario(doc), { catalog, seed, budget, traceEvery: settings.traceEvery, flightKeepMs: 15000 });
    this.showProto = doc.nodes.some(n => PROTO_TYPES.test(n.type));
    this.setLayout(layout);
    this.alertsSeen = 0;
    this.lastEventLen = 0;
    simTime.value = 0;
    flightsSV.value = [];
    useRun.setState({
      active: true,
      playing: opts?.autoplay ?? true,
      speed: opts?.speed ?? 1,
      t: 0,
      duration: this.run.durationMs,
      snapshot: this.run.snapshot(),
      ended: false,
      overloaded: false,
      actualSpeed: 1,
      eventCount: 0,
      seed,
      followTrace: undefined,
      canBack: false,
      lead: undefined,
      pending: 0,
      auto: !!opts?.auto,
      baseRps: (ensureScenario(doc).scenario?.sources ?? []).reduce((a, x) => a + (x.shape.kind === 'constant' ? x.shape.rps : x.shape.kind === 'ramp' ? x.shape.to : x.shape.kind === 'diurnal' ? x.shape.peak : x.shape.base), 0),
    });
    this.pending = [];
    this.lastEnd = 0;
    this.history = [];
    this.primaryKey = '';
    this.stepUntil = 0;
    this.journeys = [];
    this.shown = new Set();
    this.protoStart = new WeakMap();
    this.pausedAt = 0;
    this.last = performance.now();
    this.loop();
  }

  setLayout(layout: Layout) {
    this.nodeIndex.clear();
    const arr: number[] = [];
    Object.entries(layout.anchor).forEach(([id, a], i) => {
      this.nodeIndex.set(id, i);
      arr.push(a.x, a.y);
    });
    anchorsSV.value = arr;
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.run = null;
    flightsSV.value = [];
    useRun.setState({ active: false, playing: false, snapshot: null });
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const now = this.stepUntil ? Math.min(performance.now(), this.stepUntil) : performance.now();
    const dt = Math.min(100, now - this.last);
    this.last = now;
    const run = this.run;
    if (!run) return;
    const st = useRun.getState();
    if (st.playing && !st.ended && !st.rewinding) {
      this.resolvePending(run);
      const target = run.now + dt * this.simRate();
      const t0 = performance.now();
      let reached = false;
      while (performance.now() - t0 < FRAME_BUDGET_MS) {
        if (run.step(target, 1500)) {
          reached = true;
          break;
        }
      }
      if (run.now >= run.durationMs) {
        useRun.setState({ ended: true, playing: false });
        this.onEnd?.(run);
      }
      const overloaded = !reached;
      if (overloaded !== st.overloaded) useRun.setState({ overloaded });
    }
    if (st.playing) this.packFlights(now);
    if (st.playing && this.stepUntil && now >= this.stepUntil) {
      this.stepUntil = 0;
      this.pause(now);
    }
    if (now - this.lastSnap > 250 || !st.playing) {
      if (now - this.lastSnap > 250) this.publish();
    }
  };

  private journeys: Journey[] = [];
  private shown = new Set<number>();

  /** Dots for this frame, all at DOT_PT_PER_SEC × speed on one wall clock:
   *  featured requests replayed hop by hop, plus live protocol messages. */
  private packFlights(now: number, spawn = true) {
    const run = this.run!;
    const speed = useRun.getState().speed;
    const out = this.packJourneys(run, speed, now, spawn);
    if (this.showProto) this.packProto(run, speed, now, out);
    flightsSV.value = out;
    simTime.value = now;
    this.visible = out.length / 6;
  }

  private protoStart = new WeakMap<Flight, number>();
  /** heartbeats / votes are drawn only where they are the point (consensus, coordination) */
  private showProto = false;

  /** wall-clock [t0, t1] of a protocol dot; t0 fixed when first seen */
  private protoSpan(f: Flight, run: Run, speed: number, now: number) {
    let t0 = this.protoStart.get(f);
    if (t0 === undefined) {
      t0 = now - Math.max(0, run.now - f.t0) / this.simRate();
      this.protoStart.set(f, t0);
    }
    return [t0, t0 + this.travelMs(f.from, f.to, speed)] as const;
  }

  private packProto(run: Run, speed: number, now: number, out: number[]) {
    const fl = run.world.flights;
    const horizon = run.now - 8000 * this.simRate();
    let n = 0;
    for (let i = fl.length - 1; i >= 0 && n < MAX_PROTO; i--) {
      const f = fl[i];
      if (f.op !== 'proto') continue;
      if (f.t0 < horizon) break;
      if (f.t0 > run.now) continue;
      const a = this.nodeIndex.get(f.from);
      const b = this.nodeIndex.get(f.to);
      if (a === undefined || b === undefined || a === b) continue;
      const [t0, t1] = this.protoSpan(f, run, speed, now);
      if (t1 < now) continue;
      out.push(a, b, t0, t1, f.err ? 4 : 2, f.dropped ? 2 : 0);
      n++;
    }
  }

  /** wall ms for a dot to cross from → to at the unit speed */
  private travelMs(from: string, to: string, speed: number) {
    const an = anchorsSV.value;
    const a = this.nodeIndex.get(from);
    const b = this.nodeIndex.get(to);
    if (a === undefined || b === undefined) return 400;
    const dist = Math.hypot(an[b * 2] - an[a * 2], an[b * 2 + 1] - an[a * 2 + 1]);
    return Math.max(250, (dist / DOT_PT_PER_SEC) * 1000) / Math.max(0.05, speed);
  }

  /** index of the active hop and its start/end (wall ms) */
  private hopAt(j: Journey, now: number) {
    const el = now - j.start;
    let i = 0;
    while (i < j.ends.length && j.ends[i] <= el) i++;
    if (i >= j.hops.length) return undefined;
    return { i, t0: j.start + (i ? j.ends[i - 1] : 0), t1: j.start + j.ends[i] };
  }

  private packJourneys(run: Run, speed: number, now: number, spawn: boolean) {
    const before = this.journeys.length;
    this.journeys = this.journeys.filter(j => now < j.start + j.ends[j.ends.length - 1]);
    if (this.journeys.length < before) this.lastEnd = now;
    const gap = 700 / Math.max(0.05, speed);
    // lessons: one featured request at a time, picking itself
    if (spawn && useRun.getState().auto && !this.journeys.length && now - this.lastEnd > gap) {
      const next = pickTrace(run, this.shown);
      if (next) this.feature(next, run, speed, now);
    }
    // fired by the user: start as soon as resolved, staggered
    if (spawn && this.ready.length && this.journeys.length < JOURNEYS) {
      const lastStart = this.journeys.reduce((m, j) => Math.max(m, j.start), 0);
      if (now - lastStart > gap) this.feature(this.ready.shift()!, run, speed, now);
    }
    const out: number[] = [];
    for (let ji = 0; ji < this.journeys.length; ji++) {
      const j = this.journeys[ji];
      const at = this.hopAt(j, now);
      if (!at) continue;
      const h = j.hops[at.i];
      const a = this.nodeIndex.get(h.from);
      const b = this.nodeIndex.get(h.to);
      if (a === undefined || b === undefined) continue;
      const op = h.done ? (h.ok ? 3 : 4) : h.reply ? (h.ok ? 3 : 4) : h.msg?.op === 'write' ? 1 : 0;
      out.push(a, b, at.t0, at.t1, op, 1 | (h.wait || h.done ? 64 : 0));
    }
    const lead = this.journeys[0];
    const leadAt = lead && this.hopAt(lead, now);
    const key = leadAt ? `${lead.traceId}:${leadAt.i}` : '';
    if (spawn && key && key !== this.primaryKey) this.checkpoint(now);
    if (key !== this.primaryKey) this.narrate(lead, leadAt?.i);
    this.primaryKey = key;
    return out;
  }

  private pending: number[] = [];
  private ready: Trace[] = [];
  private lastEnd = 0;

  /** Fire one request from `client`; it plays once its fate is known. */
  send(client: string, op: 'read' | 'write' = 'read') {
    const run = this.run;
    if (!run || useRun.getState().ended) return;
    const id = run.sendOne(client, op);
    if (id === undefined) return;
    this.pending.push(id);
    useRun.setState({ pending: this.pending.length });
    if (!useRun.getState().playing) this.play();
  }

  /** Run the sim ahead until fired requests finish, so their journey can play. */
  private resolvePending(run: Run) {
    if (!this.pending.length) return;
    const t0 = performance.now();
    while (performance.now() - t0 < FRAME_BUDGET_MS * 2) {
      const open = this.pending.filter(id => run.trace(id)?.end === undefined && run.trace(id));
      if (!open.length) break;
      run.step(run.now + 50, 20000);
    }
    const done = this.pending.filter(id => run.trace(id)?.end !== undefined || !run.trace(id));
    if (!done.length) return;
    for (const id of done) {
      const tr = run.trace(id);
      if (tr) this.ready.push(tr);
    }
    this.pending = this.pending.filter(id => !done.includes(id));
    useRun.setState({ pending: this.pending.length });
  }

  private feature(tr: Trace, run: Run, speed: number, now: number) {
    const hops = journeyOf(tr, run);
    if (!hops.length) return;
    let acc = 0;
    const ends = hops.map(h => (acc += this.beatMs(h, speed)));
    this.journeys.push({ hops, start: now, traceId: tr.id, ends });
    this.shown.add(tr.id);
    if (this.shown.size > 500) this.shown = new Set([...this.shown].slice(-200));
  }

  /** wall ms of one beat: travel at the unit speed, or a pause while the request waits inside */
  private beatMs(h: JourneyHop, speed: number) {
    const sp = Math.max(0.05, speed);
    if (h.done) return 1600 / sp;
    if (h.wait) return Math.min(2400, 500 + 600 * Math.log10(Math.max(1, h.spanMs / 5))) / sp;
    return this.travelMs(h.from, h.to, speed);
  }

  private narrate(j: Journey | undefined, i: number | undefined) {
    if (!j || i === undefined) {
      if (useRun.getState().lead && !this.journeys.length) return;
      useRun.setState({ lead: undefined });
      return;
    }
    const tr = this.run?.trace(j.traceId);
    useRun.setState({ lead: { hops: j.hops, i, traceId: j.traceId, total: tr?.end !== undefined ? tr.end - tr.start : undefined, ok: tr?.ok } });
  }

  // ---------- stepping: one hop of the followed request at a time ----------
  private history: Checkpoint[] = [];
  private primaryKey = '';
  private stepUntil = 0;

  private checkpoint(now: number) {
    const run = this.run;
    if (!run) return;
    this.history.push({
      simT: run.now,
      speed: useRun.getState().speed,
      journeys: this.journeys.map(j => ({ hops: j.hops, traceId: j.traceId, ends: [...j.ends], startOff: j.start - now })),
      shown: [...this.shown],
    });
    if (this.history.length > HISTORY) this.history.shift();
    if (!useRun.getState().canBack) useRun.setState({ canBack: true });
  }

  /** Play until the followed request reaches its next component, then pause. */
  stepForward() {
    const st = useRun.getState();
    if (!this.run || st.ended || st.rewinding) return;
    if (!st.playing) this.play();
    const now = performance.now();
    const lead = this.journeys[0];
    const at = lead && this.hopAt(lead, now);
    this.stepUntil = at && at.t1 > now + 30 ? at.t1 : now + (lead ? 30 : 1500 / Math.max(0.05, st.speed));
  }

  /** Back to the previous hop boundary: the engine replays to that moment. */
  async stepBack() {
    const run = this.run;
    if (!run || useRun.getState().rewinding) return;
    if (useRun.getState().playing) this.pause();
    this.stepUntil = 0;
    let cp = this.history.pop();
    while (cp && cp.simT >= run.now - 1e-6 && this.history.length) cp = this.history.pop();
    if (!cp || cp.simT > run.now) return;
    useRun.setState({ rewinding: true });
    await new Promise<void>(r => setTimeout(r, 16));
    run.rewindTo(cp.simT);
    const now = performance.now();
    const k = cp.speed / useRun.getState().speed;
    this.journeys = cp.journeys.map(j => ({ hops: j.hops, traceId: j.traceId, start: now + j.startOff * k, ends: j.ends.map(e => e * k) }));
    this.ready = [];
    this.shown = new Set(cp.shown);
    this.protoStart = new WeakMap();
    this.pausedAt = now;
    this.last = now;
    this.packFlights(now, false);
    this.primaryKey = '';
    const lead = this.journeys[0];
    const at = lead && this.hopAt(lead, now);
    if (at) this.primaryKey = `${lead.traceId}:${at.i}`;
    this.history.push(cp);
    useRun.setState({ rewinding: false, ended: false, canBack: this.history.length > 1 });
    this.publish();
  }

  /** The featured-journey hop drawn nearest to (x, y), paced mode. */
  pickJourney(x: number, y: number, radius = 20): JourneyHop | undefined {
    const now = this.pausedAt || performance.now();
    const an = anchorsSV.value;
    let best: { h: JourneyHop; d: number } | undefined;
    for (const j of this.journeys) {
      const at = this.hopAt(j, now);
      if (!at) continue;
      const h = j.hops[at.i];
      const a = this.nodeIndex.get(h.from);
      const b = this.nodeIndex.get(h.to);
      if (a === undefined || b === undefined) continue;
      const k = (now - at.t0) / (at.t1 - at.t0);
      const ax = an[a * 2], ay = an[a * 2 + 1], bx = an[b * 2], by = an[b * 2 + 1];
      const dx = bx - ax, dy = by - ay;
      const len = Math.hypot(dx, dy) || 1;
      const px = ax + dx * k - (dy / len) * 5;
      const py = ay + dy * k + (dx / len) * 5;
      const d = Math.hypot(px - x, py - y);
      if (d < radius && (!best || d < best.d)) best = { h, d };
    }
    return best?.h;
  }

  /** The protocol dot drawn nearest to (x, y), within `radius`. */
  pickDot(x: number, y: number, radius = 18): Flight | undefined {
    const run = this.run;
    if (!run) return undefined;
    const now = this.pausedAt || performance.now();
    const an = anchorsSV.value;
    let best: { f: Flight; d: number } | undefined;
    for (const f of run.world.flights) {
      const t0 = this.protoStart.get(f);
      if (t0 === undefined || t0 > now) continue;
      const t1 = t0 + this.travelMs(f.from, f.to, useRun.getState().speed);
      if (t1 < now) continue;
      const a = this.nodeIndex.get(f.from);
      const b = this.nodeIndex.get(f.to);
      if (a === undefined || b === undefined || a === b) continue;
      const k = (now - t0) / (t1 - t0);
      const ax = an[a * 2], ay = an[a * 2 + 1], bx = an[b * 2], by = an[b * 2 + 1];
      const dx = bx - ax, dy = by - ay;
      const len = Math.hypot(dx, dy) || 1;
      const px = ax + dx * k - (dy / len) * 5;
      const py = ay + dy * k + (dx / len) * 5;
      const d = Math.hypot(px - x, py - y);
      if (d < radius && (!best || d < best.d)) best = { f, d };
    }
    return best?.f;
  }

  publish() {
    const run = this.run;
    if (!run) return;
    this.lastSnap = performance.now();
    const snap = run.snapshot();
    const events = run.events();
    const alerts = events.filter(e => e.kind === 'alert').length;
    if (alerts > this.alertsSeen) haptic('warning');
    this.alertsSeen = alerts;
    if (events.length > this.lastEventLen) {
      for (const e of events.slice(Math.max(this.lastEventLen, events.length - 3))) this.onEvent?.(e);
    }
    this.lastEventLen = events.length;
    const wallSpeed = useRun.getState().speed;
    useRun.setState({
      snapshot: snap,
      t: run.now,
      eventCount: events.length,
      actualSpeed: wallSpeed,
    });
  }

  private pausedAt = 0;
  play() {
    const st = useRun.getState();
    if (st.ended && this.run) return;
    this.stepUntil = 0;
    if (this.pausedAt) {
      const d = performance.now() - this.pausedAt;
      for (const j of this.journeys) j.start += d;
      for (const f of this.run?.world.flights ?? []) {
        const t0 = this.protoStart.get(f);
        if (t0 !== undefined) this.protoStart.set(f, t0 + d);
      }
      this.pausedAt = 0;
    }
    useRun.setState({ playing: true });
  }
  pause(at = performance.now()) {
    this.pausedAt = at;
    this.stepUntil = 0;
    useRun.setState({ playing: false });
    this.publish();
  }
  setSpeed(speed: number) {
    const old = useRun.getState().speed;
    const now = performance.now();
    const k = old / speed;
    for (const j of this.journeys) {
      const el = now - j.start;
      j.ends = j.ends.map(e => el + (e - el) * k);
    }
    for (const f of this.run?.world.flights ?? []) {
      const t0 = this.protoStart.get(f);
      if (t0 !== undefined) this.protoStart.set(f, now - (now - t0) * k);
    }
    useRun.setState({ speed });
  }
  /** dots visible last frame — when none, idle time is skipped */
  private visible = 0;
  /** sim ms per wall ms */
  private pace = SIM_PACE;
  simRate() {
    return this.pace * useRun.getState().speed;
  }
  stepBy(ms: number) {
    if (!this.run) return;
    this.run.step(this.run.now + ms, 200000);
    simTime.value = this.run.now;
    this.publish();
  }
  fire(ev: ChaosEvent | TrafficEvent) {
    if (!this.run) return undefined;
    const id = this.run.fire(ev);
    haptic(ev.kind === 'traffic' ? 'medium' : 'heavy');
    this.publish();
    return id;
  }
  heal(id: number | 'all') {
    this.run?.heal(id);
    this.publish();
  }
  sendOne(client: string) {
    const id = this.run?.sendOne(client);
    useRun.setState({ followTrace: id });
    return id;
  }
  async rewind(t: number) {
    if (!this.run) return;
    useRun.setState({ rewinding: true });
    await new Promise<void>(r => setTimeout(r, 16));
    this.run.rewindTo(Math.max(0, t));
    const now = performance.now();
    this.journeys = [];
    this.history = [];
    this.primaryKey = '';
    this.stepUntil = 0;
    this.protoStart = new WeakMap();
    this.pausedAt = now;
    this.packFlights(now, false);
    useRun.setState({ rewinding: false, playing: false, ended: false, canBack: false });
    this.publish();
  }
  replay() {
    if (!this.run) return;
    this.rewind(0).then(() => this.play());
  }
}

export const controller = new Controller();

/** Give a doc default traffic if it has none: 100 rps on every client. */
export function ensureScenario(doc: SystemDoc): SystemDoc {
  const clients = doc.nodes.filter(n => catalog.types.find(t => t.type === n.type)?.client || /client|device|bot$/.test(n.type));
  const sc = doc.scenario ?? { sources: [], events: [] };
  if (sc.sources.length || !clients.length) return { ...doc, scenario: sc };
  return {
    ...doc,
    scenario: { ...sc, sources: clients.map(cl => ({ id: `src-${cl.id}`, node: cl.id, shape: { kind: 'constant' as const, rps: 100 } })) },
  };
}

export function hasTrafficOrigin(doc: SystemDoc) {
  return doc.nodes.some(n => catalog.types.find(t => t.type === n.type)?.client || /client|device|bot$/.test(n.type) || n.type === 'cron');
}

/** Most recent finished traced request that hasn't been featured yet. */
function pickTrace(run: Run, shown: Set<number>): Trace | undefined {
  const all = run.traces();
  for (let i = all.length - 1; i >= 0; i--) {
    const t = all[i];
    if (t.end !== undefined && !shown.has(t.id) && t.spans.length > 1) return t;
  }
  return undefined;
}

type SpanX = Span & { ghost?: boolean; waitMs?: number };

/** Turn a trace into beats: down each call, a pause where it waits inside, and back.
 *  Calls that never got an answer (component down, packet dropped) end in a red return. */
export function journeyOf(tr: Trace, run: Run): JourneyHop[] {
  const w = run.world;
  const fl = w.traceFlights.get(tr.id) ?? [];
  const spans: SpanX[] = [...tr.spans];
  const same = (a: number, b: number) => Math.abs(a - b) < 1e-6;
  for (const f of fl) {
    if (f.op === 'reply' || f.op === 'proto' || f.from === f.to) continue;
    if (spans.some(sp => sp.node === f.to && same(sp.start, f.t1))) continue;
    const edge = [...w.edges.values()].find(e => e.from === f.from && e.to === f.to);
    spans.push({ node: f.to, start: f.t1, end: f.t1, ok: false, err: 'timeout', ghost: true, waitMs: edge?.cfg.timeoutMs ?? 3000 });
  }
  spans.sort((a, b) => a.start - b.start || b.end - a.end);
  const root: SpanX = spans.find(sp => sp.node === tr.origin) ?? { node: tr.origin, start: tr.start, end: tr.end ?? tr.start, ok: !!tr.ok };
  const kids = new Map<SpanX, SpanX[]>();
  for (const sp of spans) {
    if (sp === root) continue;
    let parent: SpanX | undefined;
    for (const p of spans) {
      if (p === sp || p.ghost || p.start > sp.start || (p.end < sp.start && !sp.ghost)) continue;
      if (!(w.out.get(p.node) ?? []).some(e => e.to === sp.node)) continue;
      if (!parent || p.start >= parent.start) parent = p;
    }
    const par = parent ?? root;
    if (!kids.has(par)) kids.set(par, []);
    kids.get(par)!.push(sp);
  }
  const reqFlight = (from: string, sp: SpanX) => fl.find(f => f.op !== 'reply' && f.from === from && f.to === sp.node && same(f.t1, sp.start));
  const resFlight = (to: string, sp: SpanX) => fl.find(f => f.op === 'reply' && f.from === sp.node && f.to === to && same(f.t0, sp.end));
  const hops: JourneyHop[] = [];
  const walk = (p: SpanX, depth: number) => {
    if (depth > 12) return;
    for (const ch of (kids.get(p) ?? []).sort((a, b) => a.start - b.start)) {
      const sub = kids.get(ch) ?? [];
      const calls = sub.length > 0;
      const msg = reqFlight(p.node, ch)?.msg;
      const i = hops.length;
      hops.push({ from: p.node, to: ch.node, reply: false, ok: true, spanMs: ch.end - ch.start, traceId: tr.id, msg, pair: -1, calls, ghost: ch.ghost });
      if (ch.ghost) {
        const res = { ok: false, err: 'timeout' as const };
        hops[i].res = res;
        hops.push({ from: p.node, to: p.node, reply: false, ok: false, spanMs: ch.waitMs ?? 0, traceId: tr.id, msg, pair: -1, calls: false, wait: true, peer: ch.node });
        hops[i].pair = hops.length;
        hops.push({ from: ch.node, to: p.node, reply: true, ok: false, err: 'timeout', spanMs: ch.waitMs ?? 0, traceId: tr.id, msg, res, pair: i, calls: false, ghost: true });
        continue;
      }
      const self = ch.end - ch.start - sub.filter(k => !k.ghost).reduce((a, k) => a + (k.end - k.start), 0) - sub.filter(k => k.ghost).reduce((a, k) => a + (k.waitMs ?? 0), 0);
      if (self >= 5) hops.push({ from: ch.node, to: ch.node, reply: false, ok: true, spanMs: self, traceId: tr.id, msg, pair: -1, calls, wait: true });
      walk(ch, depth + 1);
      const back = resFlight(p.node, ch);
      const res = back?.reply ?? { ok: ch.ok, err: ch.err as Reply['err'] };
      hops[i].res = res;
      hops[i].pair = hops.length;
      hops.push({ from: ch.node, to: p.node, reply: true, ok: ch.ok, err: ch.err, spanMs: ch.end - ch.start, traceId: tr.id, msg: back?.msg ?? msg, res, pair: i, calls });
    }
  };
  walk(root, 0);
  if (!hops.length) return hops;
  const out = hops.slice(0, 48);
  out.push({ from: tr.origin, to: tr.origin, reply: true, ok: !!tr.ok, spanMs: (tr.end ?? tr.start) - tr.start, traceId: tr.id, pair: -1, calls: false, done: true });
  return out;
}
