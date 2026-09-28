import './behaviors';
import { World, type Flight, type LogEvent, type Trace, type ProtoMsg } from './world';
import type { Badge, Catalog, ChaosEvent, Health, Id, SystemDoc, TrafficEvent } from './types';
import { label } from './chaos';
import { expandComposites, aggregateSnapshot, collapseFlights } from './composite';

export interface NodeSnap {
  id: Id;
  up: boolean;
  health: Health;
  rps: number;
  p50: number;
  p99: number;
  errRate: number;
  util: number;
  queue: number;
  memMb: number;
  badges: Badge[];
  label?: string;
  gauges: Record<string, number>;
  spark: number[];
  alerting: boolean;
  chaos: string[];
}

export interface EdgeSnap {
  id: Id;
  rps: number;
  errRate: number;
  breaker: 'closed' | 'open' | 'half';
  partitioned: boolean;
  degraded: boolean;
}

export interface Snapshot {
  t: number;
  nodes: Record<Id, NodeSnap>;
  edges: Record<Id, EdgeSnap>;
  flights: Flight[];
  alertsFiring: number;
  chaos: { id: number; kind: string; label: string; target?: Id; target2?: Id; remainingSec?: number }[];
  anomalies: Record<string, number>;
  anomalyTotal: number;
  system: { rps: number; availability: number; p99: number; errRate: number };
  costMonth: number;
  eventsPerSec: number;
}

export interface RunOptions {
  catalog: Catalog;
  seed?: number;
  budget?: number;
  traceEvery?: number;
  flightKeepMs?: number;
}

type Command = { t: number; ev: ChaosEvent | TrafficEvent } | { t: number; heal: number | 'all' } | { t: number; sendOne: Id; op?: 'read' | 'write' };

/**
 * A simulation run. Deterministic: same doc + seed + commands ⇒ same run.
 * Rewind = rebuild and fast-forward (commands are replayed at their times).
 */
export class Run {
  world: World;
  seed: number;
  private commands: Command[] = [];
  private lastEvents = 0;
  private lastEventsT = 0;
  private evRate = 0;

  constructor(readonly doc: SystemDoc, readonly opts: RunOptions) {
    this.seed = opts.seed ?? 1;
    this.world = this.build();
  }

  /** composite id → its inner node ids (technologies.md) */
  members: Record<string, string[]> = {};

  private build() {
    const ex = expandComposites(this.doc, this.opts.catalog);
    this.members = ex.members;
    return new World(ex.doc, { seed: this.seed, catalog: this.opts.catalog, budget: this.opts.budget, traceEvery: this.opts.traceEvery, flightKeepMs: this.opts.flightKeepMs });
  }

  get now() {
    return this.world.now;
  }

  get durationMs() {
    return (this.doc.scenario?.durationSec ?? 120) * 1000;
  }

  /** Advance virtual time to `until` ms, capped at maxEvents. Returns true if it reached `until`. */
  step(until: number, maxEvents = 50000): boolean {
    const w = this.world;
    const n = w.kernel.runUntil(until, maxEvents);
    const reached = n < maxEvents;
    if (w.now - this.lastEventsT >= 1000) {
      this.evRate = ((w.kernel.processed - this.lastEvents) * 1000) / (w.now - this.lastEventsT);
      this.lastEvents = w.kernel.processed;
      this.lastEventsT = w.now;
    }
    return reached;
  }

  fire(ev: ChaosEvent | TrafficEvent): number | undefined {
    this.commands.push({ t: this.world.now, ev });
    return this.world.fire(ev);
  }

  heal(id: number | 'all') {
    this.commands.push({ t: this.world.now, heal: id });
    if (id === 'all') this.world.healAll();
    else this.world.heal(id);
  }

  /** Fire exactly one traced request from a client. Returns trace id. */
  sendOne(clientId: Id, op: 'read' | 'write' = 'read'): number | undefined {
    this.commands.push({ t: this.world.now, sendOne: clientId, op });
    return this.doSendOne(clientId, op);
  }

  private doSendOne(clientId: Id, op: 'read' | 'write' = 'read'): number | undefined {
    const w = this.world;
    const c = w.nodes.get(clientId);
    if (!c) return undefined;
    const traceId = w.newTrace(clientId);
    const msg = w.newMsg({ from: clientId, to: clientId, weight: 1, op, key: w.rng.int(1024), traceId });
    if (op === 'write') msg.value = w.rng.int(1e9);
    w.deliver(msg, r => {
      const tr = w.traces.get(traceId!);
      if (tr) {
        tr.end = w.now;
        tr.ok = r.ok;
      }
    });
    return traceId;
  }

  /** Rebuild and replay to time t (ms). Chunked by caller via `stepReplay`. */
  rewindTo(t: number) {
    const cmds = this.commands.filter(c => c.t < t);
    this.commands = [];
    this.world = this.build();
    this.lastEvents = 0;
    this.lastEventsT = 0;
    const w = this.world;
    for (const c of cmds) {
      w.kernel.runUntil(c.t);
      if ('ev' in c) this.fire(c.ev);
      else if ('heal' in c) this.heal(c.heal);
      else this.commands.push(c), this.doSendOne(c.sendOne, c.op);
    }
    w.kernel.runUntil(t);
  }

  events(): LogEvent[] {
    return this.world.events;
  }
  trace(id: number): Trace | undefined {
    return this.world.traces.get(id);
  }
  traces(): Trace[] {
    return [...this.world.traces.values()];
  }
  protocol(): ProtoMsg[] {
    return this.world.proto;
  }
  series(id: Id | 'system') {
    const w = this.world;
    if (id === 'system') return w.system.points;
    return (w.nodes.get(id)?.series ?? w.edges.get(id)?.series)?.points ?? [];
  }

  snapshot(): Snapshot {
    const w = this.world;
    const nodes: Record<Id, NodeSnap> = {};
    const firingTargets = new Set([...w.firing].map(id => w.alerts.find(a => a.id === id)?.target));
    const chaosByTarget = new Map<Id, string[]>();
    for (const c of w.chaos) {
      for (const t of [c.ev.target, c.ev.target2]) {
        if (!t) continue;
        if (!chaosByTarget.has(t)) chaosByTarget.set(t, []);
        chaosByTarget.get(t)!.push(c.ev.kind);
      }
    }
    let cost = 0;
    for (const n of w.nodes.values()) {
      const pts = n.series.points;
      const last = pts[pts.length - 1] ?? partialPoint(n.series.cur, w.now);
      const recent = n.series.window(3);
      const alerting = firingTargets.has(n.id);
      const health: Health = !n.up
        ? 'down'
        : alerting || recent.errRate > 0.05
          ? 'fail'
          : recent.util > 0.8 || recent.errRate > 0.01
            ? 'warn'
            : 'ok';
      const v = n.logic.view?.();
      nodes[n.id] = {
        id: n.id,
        up: n.up,
        health,
        rps: last?.rps ?? 0,
        p50: last?.p50 ?? 0,
        p99: last?.p99 ?? 0,
        errRate: last?.errRate ?? 0,
        util: last?.util ?? 0,
        queue: n.queuedW,
        memMb: n.memMb,
        badges: n.up ? [...(v?.badges ?? []), ...n.badges] : [],
        label: v?.label ?? n.label,
        gauges: { ...n.gaugesNow },
        spark: pts.slice(-12).map(p => p.rps),
        alerting,
        chaos: chaosByTarget.get(n.id) ?? [],
      };
      cost += n.gaugesNow.costMonth ?? n.num('costMonth', 0) * Math.max(1, n.instances);
    }
    const partitioned = (a: Id, b: Id) => w.partitions.some(p => (p.a.has(a) && p.b.has(b)) || (p.b.has(a) && p.a.has(b)));
    const edges: Record<Id, EdgeSnap> = {};
    for (const e of w.edges.values()) {
      const last = e.series.last();
      edges[e.id] = {
        id: e.id,
        rps: last?.rps ?? 0,
        errRate: last?.errRate ?? 0,
        breaker: e.breaker.state,
        partitioned: partitioned(e.from, e.to),
        degraded: e.extraLatencyMs > 0 || e.loss > 0 || e.jitterMs > 0,
      };
    }
    const sys = w.system.last();
    const anomalyTotal = Object.values(w.anomalies).reduce((a, b) => a + b, 0);
    const snap: Snapshot = {
      t: w.now,
      nodes,
      edges,
      flights: w.flights.filter(f => f.t1 >= w.now && f.t0 <= w.now),
      alertsFiring: w.firing.size,
      chaos: w.chaos.map(c => ({
        id: c.id,
        kind: c.ev.kind,
        label: label(c.ev.kind),
        target: c.ev.target,
        target2: c.ev.target2,
        remainingSec: c.until ? Math.max(0, (c.until - w.now) / 1000) : undefined,
      })),
      anomalies: { ...w.anomalies },
      anomalyTotal,
      system: {
        rps: sys?.rps ?? 0,
        availability: sys ? (1 - sys.errRate) * 100 : 100,
        p99: sys?.p99 ?? 0,
        errRate: sys?.errRate ?? 0,
      },
      costMonth: cost,
      eventsPerSec: this.evRate,
    };
    if (!Object.keys(this.members).length) return snap;
    const agg = aggregateSnapshot(snap, this.members);
    agg.flights = collapseFlights(agg.flights, this.members);
    return agg;
  }
}

export function createRun(doc: SystemDoc, opts: RunOptions) {
  return new Run(doc, opts);
}

/** Before the first 1s bucket closes (slow speeds), estimate from the open bucket. */
function partialPoint(b: import('./metrics').Bucket, now: number) {
  const secs = Math.max(0.001, (now - b.t * 1000) / 1000);
  const done = b.okW + b.errW;
  return {
    t: b.t,
    rps: b.inW / secs,
    errRate: done > 0 ? b.errW / done : 0,
    p50: b.hist.quantile(0.5),
    p99: b.hist.quantile(0.99),
    util: 0,
    queue: b.queueMax,
    gauges: b.gauges,
    errs: b.errs,
  };
}
