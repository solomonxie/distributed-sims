import { create } from 'zustand';
import { makeMutable } from 'react-native-reanimated';
import { createRun, type SendOpts, type ChaosEvent, type Flight, type Msg, type Reply, type Run, type Snapshot, type Span, type SystemDoc, type Trace, type TrafficEvent } from '@dsims/engine';
import { catalog } from '@dsims/content';
import { NODE_H, NODE_W } from './doc';
import type { Layout } from '../canvas/layout';
import { useSettings } from './settings';
import { haptic } from '../lib/haptics';


/** Burst sizes offered wherever a client can send. */
export const SEND_BURSTS = [5, 20, 100];
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
/** protocol dots (heartbeats, votes, replication) drawn at once */
const MAX_PROTO = 24;
/** protocol messages travel slower than requests so each round reads */
const PROTO_SLOW = 0.6;
const PROTO_TYPES = /consensus|paxos|gossip|zk-server|kraft|lock-service|crdt/;

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
  /** a protocol message the component sent while handling this request (2PC prepare, commit) */
  proto?: string;
  /** a TCP handshake segment opening the connection before the call */
  tcp?: 'SYN' | 'SYN-ACK' | 'ACK';
  /** set off by the request after the user already had the answer */
  async?: boolean;
  /** sim ms since the request started when this hop reaches its destination */
  at?: number;
}

interface Journey {
  hops: JourneyHop[];
  start: number;
  traceId: number;
  /** cumulative end time (ms from start) of each hop — constant pt/s means longer hops take longer */
  ends: number[];
  /** fired by the user (not picked by a lesson) */
  user: boolean;
}

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
  /** the followed request stops at every step until Next; off = it plays through */
  stepping: boolean;
  /** what the next Send / Next step fires: from which client, read or write, how many */
  sender?: string;
  sendOp: 'read' | 'write';
  sendCount: number;
  sendKey: 'cached' | 'uncached';
  /** the request being narrated: its hops and which one is on screen */
  lead?: { hops: JourneyHop[]; i: number; traceId: number; total?: number; ok?: boolean };
  /** requests fired but still being resolved */
  pending: number;
  /** featured requests pick themselves (lessons); otherwise the user fires them */
  auto: boolean;
  /** configured background rate, to tell when a burst is on */
  baseRps: number;
  /** the followed dot is stopped halfway along its hop */
  midway: boolean;
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
  stepping: true,
  sendOp: 'read',
  sendCount: 1,
  sendKey: 'cached',
  pending: 0,
  auto: false,
  baseRps: 0,
  midway: false,
}));

const OP: Record<string, number> = { read: 0, write: 1, proto: 2, reply: 3 };
const FRAME_BUDGET_MS = 7;
/** wall ms a parked dot sits inside its hop */
const HOP_EPS = 1;
/** a finished request's async tail is over once nothing it caused moved for this long (sim ms) */
const ASYNC_QUIET_MS = 1500;
const ASYNC_MAX_MS = 8000;

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
    this.netLesson = isNetLesson(doc);
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
      midway: false,
      pending: 0,
      auto: !!opts?.auto,
      sendOp: 'read',
      sendKey: 'cached',
      sendCount: 1,
      baseRps: (ensureScenario(doc).scenario?.sources ?? []).reduce((a, x) => a + (x.shape.kind === 'constant' ? x.shape.rps : x.shape.kind === 'ramp' ? x.shape.to : x.shape.kind === 'diurnal' ? x.shape.peak : x.shape.base), 0),
    });
    this.pending = [];
    this.ready = [];
    this.lastEnd = 0;
    this.primaryKey = '';
    this.journeys = [];
    this.jFrozen = false;
    this.advanceSpawn = false;
    this.opened = new Set();
    this.shown = new Set();
    this.protoStart = new WeakMap();
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
    const now = performance.now();
    const wallDt = now - this.last;
    const dt = Math.min(100, wallDt);
    this.last = now;
    const run = this.run;
    if (!run) return;
    const st = useRun.getState();
    if (!st.rewinding) this.resolvePending(run);
    if (st.playing && !st.ended && !st.rewinding) {
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
    // the followed request has its own clock: frozen between steps, the sim keeps running
    const moving = !this.jFrozen && (st.playing || st.stepping);
    if (!moving) for (const j of this.journeys) j.start += wallDt;
    if (!st.rewinding) this.packFlights(now, !st.ended, st.playing ? 0 : wallDt);
    if (now - this.lastSnap > 250 || !st.playing) {
      if (now - this.lastSnap > 250) this.publish();
    }
  };

  private journeys: Journey[] = [];
  private shown = new Set<number>();

  /** Dots for this frame, all at DOT_PT_PER_SEC × speed on one wall clock:
   *  featured requests replayed hop by hop, plus live protocol messages. */
  private packFlights(now: number, spawn = true, pausedDt = 0) {
    const run = this.run!;
    const speed = useRun.getState().speed;
    const out = this.packJourneys(run, speed, now, spawn);
    // stepping = focus on one request: background heartbeats, fetch loops and votes stay hidden
    if (this.showProto && !useRun.getState().stepping) this.packProto(run, speed, now, out, pausedDt);
    flightsSV.value = out;
    simTime.value = now;
    this.visible = out.length / 6;
  }

  private protoStart = new WeakMap<Flight, number>();
  /** heartbeats / votes are drawn only where they are the point (consensus, coordination) */
  private showProto = false;

  private protoMs(f: Flight, speed: number) {
    return this.travelMs(f.from, f.to, speed * PROTO_SLOW);
  }

  /** One protocol dot per connection at a time, each drawn whole from the moment it starts. */
  private packProto(run: Run, speed: number, now: number, out: number[], pausedDt: number) {
    const fl = run.world.flights;
    const horizon = run.now - 8000 * this.simRate();
    const busy = new Set<string>();
    const idle: Flight[] = [];
    let n = 0;
    const draw = (f: Flight, t0: number) => {
      out.push(this.nodeIndex.get(f.from)!, this.nodeIndex.get(f.to)!, t0, t0 + this.protoMs(f, speed), f.err ? 4 : 2, f.dropped ? 2 : 0);
      busy.add(`${f.from}>${f.to}`);
      n++;
    };
    for (let i = fl.length - 1; i >= 0; i--) {
      const f = fl[i];
      if (f.op !== 'proto') continue;
      if (f.t0 < horizon) break;
      if (f.t0 > run.now) continue;
      const a = this.nodeIndex.get(f.from);
      const b = this.nodeIndex.get(f.to);
      if (a === undefined || b === undefined || a === b) continue;
      let t0 = this.protoStart.get(f);
      if (t0 !== undefined && pausedDt) this.protoStart.set(f, (t0 += pausedDt));
      if (t0 === undefined) idle.push(f);
      else if (t0 + this.protoMs(f, speed) >= now && n < MAX_PROTO) draw(f, t0);
    }
    if (pausedDt) return;
    const fresh = run.now - 2000 * this.simRate();
    for (let i = idle.length - 1; i >= 0 && n < MAX_PROTO; i--) {
      const f = idle[i];
      if (f.t0 < fresh || busy.has(`${f.from}>${f.to}`)) continue;
      this.protoStart.set(f, now);
      draw(f, now);
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
    // one request on screen at a time; yours take over from one a lesson picked
    if (spawn && this.ready.length && (!this.journeys.length || !this.journeys[0].user)) {
      this.journeys = [];
      this.feature(this.ready.shift()!, run, speed, now, true);
    }
    if (spawn && useRun.getState().auto && !this.journeys.length && now - this.lastEnd > gap) {
      const next = pickTrace(run, this.shown);
      if (next) this.feature(next, run, speed, now, false);
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
    if (key && leadAt && key !== this.primaryKey) {
      if (this.advanceSpawn) this.advanceSpawn = false;
      else if (useRun.getState().stepping) {
        // park just inside the hop: exactly on the boundary, float error can read as the previous hop
        lead.start = now - (leadAt.i ? lead.ends[leadAt.i - 1] : 0) - HOP_EPS;
        this.jFrozen = true;
      }
    }
    // stepping: a travelling dot also stops halfway, so it can be tapped; the next Next carries it to the target
    if (leadAt && key && !this.jFrozen && useRun.getState().stepping && this.midKey !== key) {
      const h = lead.hops[leadAt.i];
      const mid = (leadAt.t0 + leadAt.t1) / 2;
      if (!h.wait && !h.done && h.from !== h.to && now >= mid) {
        lead.start += now - mid;
        this.jFrozen = true;
        this.midKey = key;
        useRun.setState({ midway: true, canBack: true });
      }
    }
    if (key !== this.primaryKey) this.narrate(lead, leadAt?.i);
    this.primaryKey = key;
    return out;
  }

  private pending: number[] = [];
  private ready: Trace[] = [];
  private lastEnd = 0;

  /** Fire one request from `client`; it plays once its fate is known. */
  /** the user's chosen request shape (client sheet) */
  sendOpts(): SendOpts {
    return { key: useRun.getState().sendKey === 'cached' ? 'hot' : 'cold' };
  }

  send(client: string, op: 'read' | 'write' = 'read') {
    const run = this.run;
    if (!run || useRun.getState().ended) return;
    const id = run.sendOne(client, op, this.sendOpts());
    if (id === undefined) return;
    this.pending.push(id);
    useRun.setState({ pending: this.pending.length });
  }

  burst(client: string, op: 'read' | 'write', n: number) {
    for (let k = 0; k < n; k++) this.send(client, op);
  }

  /** Run the sim ahead until fired requests finish — and their async follow-ups (replication,
   *  consumers, commits) go quiet — so the whole journey can play. */
  private resolvePending(run: Run) {
    if (!this.pending.length) return;
    const t0 = performance.now();
    const settled = (id: number) => {
      const tr = run.trace(id);
      if (!tr) return true;
      if (tr.end === undefined) return false;
      const fl = run.world.traceFlights.get(id) ?? [];
      const last = fl.reduce((a, f) => Math.max(a, f.t1), tr.end);
      return run.now - last >= ASYNC_QUIET_MS || run.now - tr.end >= ASYNC_MAX_MS;
    };
    while (performance.now() - t0 < FRAME_BUDGET_MS * 2) {
      if (this.pending.every(settled)) break;
      run.step(run.now + 50, 20000);
    }
    const done = this.pending.filter(settled);
    if (!done.length) return;
    for (const id of done) {
      const tr = run.trace(id);
      if (tr) this.ready.push(tr);
    }
    this.pending = this.pending.filter(id => !done.includes(id));
    useRun.setState({ pending: this.pending.length });
  }

  private feature(tr: Trace, run: Run, speed: number, now: number, user: boolean) {
    const hops = journeyOf(tr, run, this.opened, this.netLesson);
    if (!hops.length) return;
    let acc = 0;
    const ends = hops.map(h => (acc += this.beatMs(h, speed)));
    this.advanceSpawn = !useRun.getState().stepping || user || this.advanceSpawn;
    this.jFrozen = false;
    this.journeys.push({ hops, start: now, traceId: tr.id, ends, user });
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
    useRun.setState({ lead: { hops: j.hops, i, traceId: j.traceId, total: tr?.end !== undefined ? tr.end - tr.start : undefined, ok: tr?.ok }, canBack: i > 0 });
  }

  // ---------- stepping: one step of the followed request at a time ----------
  private primaryKey = '';
  /** hop whose halfway stop has already happened */
  private midKey = '';
  /** the followed request is held at the start of a step */
  private jFrozen = false;
  /** the next request to appear plays its first step instead of waiting */
  private advanceSpawn = false;
  /** connections already opened with a TCP handshake in this run */
  private opened = new Set<string>();
  private netLesson = false;

  /** Play the current step of the followed request, then hold at the next one. */
  nextStep(sender?: string, op: 'read' | 'write' = 'read', n = 1) {
    const st = useRun.getState();
    if (!this.run || st.ended || st.rewinding) return;
    if (!this.journeys.length) {
      // nothing on screen: the next step is a new request (or a burst; the first one is followed)
      if (!this.pending.length && !this.ready.length && sender) this.burst(sender, op, Math.max(1, n));
      this.advanceSpawn = true;
    }
    this.jFrozen = false;
    if (st.midway) useRun.setState({ midway: false });
  }

  /** a request is on screen or on its way */
  get busy() {
    return this.journeys.length > 0 || this.pending.length > 0 || this.ready.length > 0;
  }

  /** Back to the start of the current step, or the previous one when already there. */
  prevStep() {
    const lead = this.journeys[0];
    if (!lead) return;
    const now = performance.now();
    const at = this.hopAt(lead, now);
    const i = at ? at.i : lead.hops.length - 1;
    // parked halfway: Back returns to the start of this hop, however short the hop is
    const atStart = !useRun.getState().midway && (!at || now - at.t0 < 60);
    const target = Math.max(0, atStart ? i - 1 : i);
    lead.start = now - (target ? lead.ends[target - 1] : 0) - HOP_EPS;
    this.jFrozen = true;
    this.primaryKey = `${lead.traceId}:${target}`;
    this.midKey = '';
    useRun.setState({ midway: false });
    this.narrate(lead, target);
    this.packFlights(now, false);
  }

  setStepping(stepping: boolean) {
    useRun.setState({ stepping });
    if (!stepping) this.jFrozen = false;
  }

  /** The featured-journey hop drawn nearest to (x, y), paced mode. */
  pickJourney(x: number, y: number, radius = 20): JourneyHop | undefined {
    const now = performance.now();
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
      const ux = dx / len;
      const uy = dy / len;
      // same path as the canvas: box edge to box edge, one lane to the right
      const clip = Math.min(len / 2, Math.min((NODE_W / 2 + 4) / Math.max(1e-6, Math.abs(ux)), (NODE_H / 2 + 4) / Math.max(1e-6, Math.abs(uy))));
      const span = Math.max(0, len - 2 * clip);
      const px = ax + ux * (clip + span * k) - uy * 5;
      const py = ay + uy * (clip + span * k) + ux * 5;
      const d = Math.hypot(px - x, py - y);
      if (d < radius && (!best || d < best.d)) best = { h, d };
    }
    return best?.h;
  }

  /** The protocol dot drawn nearest to (x, y), within `radius`. */
  pickDot(x: number, y: number, radius = 18): Flight | undefined {
    const run = this.run;
    if (!run) return undefined;
    const now = performance.now();
    const an = anchorsSV.value;
    let best: { f: Flight; d: number } | undefined;
    for (const f of run.world.flights) {
      const t0 = this.protoStart.get(f);
      if (t0 === undefined || t0 > now) continue;
      const t1 = t0 + this.protoMs(f, useRun.getState().speed);
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

  play() {
    const st = useRun.getState();
    if (st.ended && this.run) return;
    useRun.setState({ playing: true });
  }
  pause() {
    useRun.setState({ playing: false });
    this.publish();
  }
  /** Hold the followed request where it is (tapping it to read the details). */
  hold() {
    if (!useRun.getState().stepping) useRun.setState({ stepping: true });
    this.jFrozen = true;
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
    this.ready = [];
    this.primaryKey = '';
    this.midKey = '';
    this.jFrozen = false;
    this.protoStart = new WeakMap();
    this.packFlights(now, false);
    useRun.setState({ rewinding: false, playing: false, ended: false, canBack: false, midway: false });
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

export const isClient = (type: string) => !!catalog.types.find(t => t.type === type)?.client || /client|device|bot$/.test(type);
/** components that start work on their own timers, no client needed */
const SELF_DRIVEN = new Set(['cron', 'airflow-scheduler', 'spark-driver', 'zk-app', 'celery-beat', 'celery-producer', 'kafka-producer']);

export function hasTrafficOrigin(doc: SystemDoc) {
  return doc.nodes.some(n => isClient(n.type) || SELF_DRIVEN.has(n.type));
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
/** Only network lessons show transport detail (TCP handshakes, packet layers). */
export const isNetLesson = (doc?: SystemDoc | null) => !!doc && /^lesson-network-/.test(doc.id);

export function journeyOf(tr: Trace, run: Run, opened = new Set<string>(), tcp = false): JourneyHop[] {
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
  /** calls made by a component with no span of its own in this trace (a Kafka consumer, a worker): async, after the reply */
  const orphans: SpanX[] = [];
  for (const sp of spans) {
    if (sp === root) continue;
    let parent: SpanX | undefined;
    if (sp.from && sp.from !== root.node) {
      for (const p of spans) if (p !== sp && !p.ghost && p.node === sp.from && p.start <= sp.start && (!parent || p.start >= parent.start)) parent = p;
      if (!parent) {
        orphans.push(sp);
        continue;
      }
    }
    if (!parent) for (const p of spans) {
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
  const protos = fl.filter(f => f.op === 'proto' && f.from !== f.to).sort((a, b) => a.t0 - b.t0);
  const used = new Set<Flight>();
  /** protocol messages `node` exchanged while handling the request (2PC prepare / votes / commit) */
  const protoHops = (node: string, from: number) => {
    const mine = protos.filter(f => !used.has(f) && (f.from === node || f.to === node) && f.t0 >= from - 1e-6);
    for (const f of mine) {
      used.add(f);
      const kind = f.msg?.kind ?? 'message';
      hops.push({ from: f.from, to: f.to, reply: kind.endsWith('.reply'), ok: !f.err && !f.dropped, spanMs: f.t1 - f.t0, traceId: tr.id, msg: f.msg, pair: -1, calls: false, proto: kind, at: f.t1 - tr.start });
    }
    return mine.length;
  };
  const handshake = (a: string, b: string, at: number) => {
    if (!tcp) return;
    const edge = [...w.edges.values()].find(e => e.from === a && e.to === b);
    const link = `${a}>${b}`;
    if (edge?.cfg.keepAlive !== false && opened.has(link)) return;
    opened.add(link);
    const seg = (from: string, to: string, tcp: JourneyHop['tcp']) => hops.push({ from, to, reply: false, ok: true, spanMs: 0, traceId: tr.id, pair: -1, calls: false, tcp, at });
    seg(a, b, 'SYN');
    seg(b, a, 'SYN-ACK');
    seg(a, b, 'ACK');
  };
  const walk = (p: SpanX, depth: number) => {
    if (depth > 12) return;
    for (const ch of (kids.get(p) ?? []).sort((a, b) => a.start - b.start)) {
      const sub = kids.get(ch) ?? [];
      const calls = sub.length > 0;
      const msg = reqFlight(p.node, ch)?.msg;
      const t0 = ch.start - tr.start;
      if (!ch.ghost) handshake(p.node, ch.node, t0);
      const i = hops.length;
      hops.push({ from: p.node, to: ch.node, reply: false, ok: true, spanMs: ch.end - ch.start, traceId: tr.id, msg, pair: -1, calls, ghost: ch.ghost, at: t0 });
      if (ch.ghost) {
        const res = { ok: false, err: 'timeout' as const };
        hops[i].res = res;
        hops.push({ from: p.node, to: p.node, reply: false, ok: false, spanMs: ch.waitMs ?? 0, traceId: tr.id, msg, pair: -1, calls: false, wait: true, peer: ch.node, at: t0 });
        hops[i].pair = hops.length;
        hops.push({ from: ch.node, to: p.node, reply: true, ok: false, err: 'timeout', spanMs: ch.waitMs ?? 0, traceId: tr.id, msg, res, pair: i, calls: false, ghost: true, at: t0 + (ch.waitMs ?? 0) });
        continue;
      }
      const self = ch.end - ch.start - sub.filter(k => !k.ghost).reduce((a, k) => a + (k.end - k.start), 0) - sub.filter(k => k.ghost).reduce((a, k) => a + (k.waitMs ?? 0), 0);
      if (!protoHops(ch.node, ch.start) && self >= 5) hops.push({ from: ch.node, to: ch.node, reply: false, ok: true, spanMs: self, traceId: tr.id, msg, pair: -1, calls, wait: true, at: t0 });
      walk(ch, depth + 1);
      const back = resFlight(p.node, ch);
      const res = back?.reply ?? { ok: ch.ok, err: ch.err as Reply['err'] };
      hops[i].res = res;
      hops[i].pair = hops.length;
      hops.push({ from: ch.node, to: p.node, reply: true, ok: ch.ok, err: ch.err, spanMs: ch.end - ch.start, traceId: tr.id, msg: back?.msg ?? msg, res, pair: i, calls, at: ch.end - tr.start });
    }
  };
  walk(root, 0);
  if (!hops.length) return hops;
  const out = hops.slice(0, 64);
  out.push({ from: tr.origin, to: tr.origin, reply: true, ok: !!tr.ok, spanMs: (tr.end ?? tr.start) - tr.start, traceId: tr.id, pair: -1, calls: false, done: true, at: (tr.end ?? tr.start) - tr.start });
  // what the request set off that the user didn't wait for: calls by consumers / workers, replication, commits
  for (const sp of orphans.sort((a, b) => a.start - b.start)) {
    if (out.length >= 94) break;
    const msg = reqFlight(sp.from!, sp)?.msg;
    const back = resFlight(sp.from!, sp);
    out.push({ from: sp.from!, to: sp.node, reply: false, ok: true, spanMs: sp.end - sp.start, traceId: tr.id, msg, pair: out.length + 1, calls: false, async: true, at: sp.start - tr.start });
    out.push({ from: sp.node, to: sp.from!, reply: true, ok: sp.ok, err: sp.err, spanMs: sp.end - sp.start, traceId: tr.id, msg: back?.msg ?? msg, res: back?.reply ?? { ok: sp.ok, err: sp.err as Reply['err'] }, pair: out.length - 1, calls: false, async: true, at: sp.end - tr.start });
  }
  for (const f of protos) {
    if (used.has(f) || out.length >= 96) continue;
    const kind = f.msg?.kind ?? 'message';
    out.push({ from: f.from, to: f.to, reply: kind.endsWith('.reply'), ok: !f.err && !f.dropped, spanMs: f.t1 - f.t0, traceId: tr.id, msg: f.msg, pair: -1, calls: false, proto: kind, async: true, at: f.t1 - tr.start });
  }
  return out;
}
