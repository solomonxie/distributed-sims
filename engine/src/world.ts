import { Kernel } from './kernel';
import { Rng } from './rng';
import { Series } from './metrics';
import { SimNode, type CallCb, type Req } from './node';
import { behaviorFor, kindHandler } from './behaviors/registry';
import { resolveConfig, placementOf, type Placement } from './model';
import { TrafficGen } from './traffic';
import { applyChaos } from './chaos';
import type {
  AlertRule,
  Badge,
  Catalog,
  ChaosEvent,
  ContainerSpec,
  EdgeConfig,
  EdgeSpec,
  Id,
  Msg,
  Reply,
  ScheduledEvent,
  SystemDoc,
  TrafficEvent,
} from './types';

export interface EdgeRt {
  id: Id;
  spec: EdgeSpec;
  from: Id;
  to: Id;
  cfg: Required<Pick<EdgeConfig, 'timeoutMs' | 'retries' | 'backoffMs'>> & EdgeConfig;
  series: Series;
  breaker: { state: 'closed' | 'open' | 'half'; fails: number; openedAt: number; recent: number[] };
  extraLatencyMs: number;
  loss: number;
  jitterMs: number;
}

export interface Flight {
  from: Id;
  to: Id;
  t0: number;
  t1: number;
  op: 'read' | 'write' | 'proto' | 'reply';
  w: number;
  traced: boolean;
  err?: boolean;
  dropped?: boolean;
  /** the message this dot carries (for the tap-to-inspect panel) */
  msg?: Msg;
  /** for replies: what came back */
  reply?: Reply;
}

export interface LogEvent {
  t: number;
  kind: 'protocol' | 'info' | 'chaos' | 'alert' | 'traffic';
  text: string;
  node?: Id;
}

export interface Span {
  node: Id;
  /** the component that sent the request this span handled */
  from?: Id;
  start: number;
  end: number;
  ok: boolean;
  err?: string;
  queueMs?: number;
  async?: boolean;
}

export interface Trace {
  id: number;
  start: number;
  end?: number;
  ok?: boolean;
  spans: Span[];
  origin: Id;
}

export interface ProtoMsg {
  t: number;
  arrive: number;
  from: Id;
  to: Id;
  kind: string;
  dropped: boolean;
  data?: string;
}

export interface ActiveChaos {
  id: number;
  ev: ChaosEvent;
  since: number;
  until?: number;
  heal: () => void;
}

export interface WorldOptions {
  seed: number;
  catalog: Catalog;
  /** particle budget per second of virtual time (all sources) */
  budget?: number;
  traceEvery?: number;
  maxFlights?: number;
  /** keep flights this long after they start (for slowed-down visuals) */
  flightKeepMs?: number;
}

export class World {
  kernel = new Kernel();
  rng: Rng;
  nodes = new Map<Id, SimNode>();
  edges = new Map<Id, EdgeRt>();
  out = new Map<Id, EdgeRt[]>();
  containers = new Map<Id, ContainerSpec>();
  placement = new Map<Id, Placement>();
  flights: Flight[] = [];
  events: LogEvent[] = [];
  traces = new Map<number, Trace>();
  /** every message of each kept trace, so a request's whole journey can be replayed */
  traceFlights = new Map<number, Flight[]>();
  proto: ProtoMsg[] = [];
  anomalies: Record<string, number> = {};
  chaos: ActiveChaos[] = [];
  traffic: TrafficGen[] = [];
  alerts: AlertRule[];
  alertState = new Map<Id, { since: number; firing: boolean }>();
  firing = new Set<Id>();
  system = new Series();
  partitions: { a: Set<Id>; b: Set<Id>; oneWay: boolean; id: number }[] = [];
  clientTypes: Set<string>;
  private msgSeq = 1;
  private traceSeq = 1;
  private chaosSeq = 1;
  readonly opts: Required<WorldOptions>;

  constructor(readonly doc: SystemDoc, opts: WorldOptions) {
    this.opts = {
      ...opts,
      budget: opts.budget ?? 3000,
      traceEvery: opts.traceEvery ?? 50,
      maxFlights: opts.maxFlights ?? 1500,
      flightKeepMs: opts.flightKeepMs ?? 0,
    };
    this.rng = new Rng(opts.seed);
    const flagged = opts.catalog.types.filter(t => t.client).map(t => t.type);
    this.clientTypes = new Set(flagged.length ? flagged : ['web-client', 'mobile-client', 'iot-device', 'bot']);
    for (const c of doc.containers) this.containers.set(c.id, c);
    for (const n of doc.nodes) {
      const cfg = resolveConfig(n, opts.catalog);
      const node = new SimNode(n, this, cfg, this.rng.fork('node:' + n.id));
      this.nodes.set(n.id, node);
      this.placement.set(n.id, placementOf(n, this.containers));
    }
    for (const e of doc.edges) {
      if (!this.nodes.has(e.from) || !this.nodes.has(e.to)) continue;
      const rt: EdgeRt = {
        id: e.id,
        spec: e,
        from: e.from,
        to: e.to,
        cfg: { timeoutMs: 2000, retries: 0, backoffMs: 50, mode: 'sync', ...(e.config ?? {}) },
        series: new Series(),
        breaker: { state: 'closed', fails: 0, openedAt: 0, recent: [] },
        extraLatencyMs: 0,
        loss: 0,
        jitterMs: 0,
      };
      this.edges.set(e.id, rt);
      if (!this.out.has(e.from)) this.out.set(e.from, []);
      this.out.get(e.from)!.push(rt);
    }
    for (const node of this.nodes.values()) {
      node.logic = behaviorFor(node.type, node.skin)(node);
      node.series.setCapacity(node.capacity);
    }
    for (const node of this.nodes.values()) node.logic.onStart?.();

    this.alerts = doc.alerts ?? [];
    const sc = doc.scenario;
    const sources = sc?.sources ?? [];
    for (const s of sources) {
      if (this.nodes.has(s.node)) this.traffic.push(new TrafficGen(this, s, sources.length));
    }
    for (const ev of sc?.events ?? []) this.schedule(ev);
    this.kernel.at(1000, () => this.tick());
  }

  get now() {
    return this.kernel.now;
  }

  // ---------- messaging ----------
  newMsg(partial: Partial<Msg> & { from: Id; to: Id }): Msg {
    return { id: this.msgSeq++, kind: 'req', weight: 1, size: 1024, born: this.now, hops: 0, ...partial };
  }

  /** Derive a downstream request from an incoming one. */
  child(m: Msg, from: Id, to: Id): Msg {
    return { ...m, id: this.msgSeq++, from, to, hops: m.hops + 1 };
  }

  /** traces a user asked for (sendOne): never evicted, so step mode can replay them under heavy traffic */
  pinned = new Set<number>();

  newTrace(origin: Id, pin = false): number | undefined {
    const id = this.traceSeq++;
    this.traces.set(id, { id, start: this.now, spans: [], origin });
    if (pin) this.pinned.add(id);
    if (this.traces.size > 300 + this.pinned.size) {
      for (const k of this.traces.keys()) {
        if (this.pinned.has(k)) continue;
        this.traces.delete(k);
        this.traceFlights.delete(k);
        break;
      }
    }
    return id;
  }

  linkLatency(from: Id, to: Id, edge?: EdgeRt): number {
    const base = edge?.cfg.latencyMs ?? this.placementLatency(from, to);
    const extra = edge ? edge.extraLatencyMs + (edge.jitterMs ? this.rng.next() * edge.jitterMs : 0) : 0;
    return base * (0.85 + this.rng.next() * 0.3) + extra;
  }

  placementLatency(a: Id, b: Id): number {
    const pa = this.placement.get(a);
    const pb = this.placement.get(b);
    const na = this.nodes.get(a);
    const nb = this.nodes.get(b);
    const clientish = this.isClient(na?.type) || this.isClient(nb?.type);
    let lat = clientish ? 25 : 0.4;
    if (pa?.region && pb?.region && pa.region !== pb.region) lat += regionLatency(pa.region, pb.region);
    else if (pa?.az && pb?.az && pa.az !== pb.az) lat += 0.8;
    return lat;
  }

  blocked(from: Id, to: Id): boolean {
    for (const p of this.partitions) {
      if (p.a.has(from) && p.b.has(to)) return true;
      if (!p.oneWay && p.b.has(from) && p.a.has(to)) return true;
    }
    const tn = this.nodes.get(to);
    if (tn?.mods.dnsFail || tn?.mods.certExpired) return true;
    return false;
  }

  private flight(f: Flight) {
    this.flights.push(f);
    const tid = f.msg?.traceId;
    if (tid !== undefined && this.traces.has(tid)) {
      const list = this.traceFlights.get(tid);
      if (list) list.push(f);
      else this.traceFlights.set(tid, [f]);
    }
    if (this.flights.length > this.opts.maxFlights * 2) this.pruneFlights();
  }

  pruneFlights() {
    const now = this.now;
    const keep = this.opts.flightKeepMs;
    this.flights = this.flights.filter(f => f.t1 >= now - 50 || f.t0 >= now - keep);
    if (this.flights.length > this.opts.maxFlights) this.flights = this.flights.slice(-this.opts.maxFlights);
  }

  /** Transmit a message over the wire; `arrive` runs at the destination unless dropped. */
  transmit(from: Id, to: Id, msg: Msg, edge: EdgeRt | undefined, kind: Flight['op'], arrive: () => void, reply?: Reply) {
    const lat = this.linkLatency(from, to, edge);
    const dropped = this.blocked(from, to) || (edge ? this.rng.chance(edge.loss) : false);
    const traced = msg.traceId !== undefined;
    // keep the old sampling draw so seeded runs stay identical; every message is now drawn as a dot
    if (!traced && !msg.proto) this.rng.chance(0.35);
    {
      this.flight({ from, to, t0: this.now, t1: this.now + lat, op: kind, w: msg.weight, traced, dropped, msg, reply, err: reply ? !reply.ok : undefined });
    }
    if (dropped) return;
    this.kernel.after(lat, arrive);
  }

  /** Deliver a request to a node's logic; reply callback travels back. */
  deliver(msg: Msg, onReply: (r: Reply) => void) {
    const node = this.nodes.get(msg.to);
    if (!node || !node.up) return;
    const at = this.now;
    node.series.cur.inW += msg.weight;
    let replied = false;
    const epoch = node.epoch;
    const req: Req = {
      msg,
      at,
      reply: (r: Reply) => {
        if (replied || epoch !== node.epoch) return;
        replied = true;
        const lat = this.now - at;
        const b = node.series.cur;
        if (r.ok) {
          b.okW += msg.weight;
          b.hist.add(lat, msg.weight);
        } else {
          b.errW += msg.weight;
          b.errs[r.err ?? '5xx'] = (b.errs[r.err ?? '5xx'] ?? 0) + msg.weight;
        }
        if (msg.traceId !== undefined) {
          this.traces.get(msg.traceId)?.spans.push({ node: node.id, from: msg.from, start: at, end: this.now, ok: r.ok, err: r.err });
        }
        onReply(r);
      },
    };
    if (node.mods.errRate && node.rng.chance(node.mods.errRate)) {
      node.process(msg.weight, node.serviceTime(), () => req.reply({ ok: false, err: '5xx' }));
      return;
    }
    const kh = kindHandler(msg.kind);
    if (kh && !node.logic.handles?.(msg.kind)) return kh(node, req);
    if (node.logic.onRequest) node.logic.onRequest(req);
    else node.process(msg.weight, node.serviceTime(), ok => req.reply(ok ? { ok: true } : { ok: false, err: '503' }));
  }

  call(src: SimNode, edge: EdgeRt, msg: Msg, cb: CallCb) {
    const start = this.now;
    const br = edge.breaker;
    if (edge.cfg.circuitBreaker) {
      if (br.state === 'open') {
        if (this.now - br.openedAt > 5000) br.state = 'half';
        else {
          edge.series.cur.errW += msg.weight;
          return cb({ ok: false, err: 'unavailable' }, 0);
        }
      }
    }
    let attempt = 0;
    let done = false;
    const srcEpoch = src.epoch;
    msg.idem ??= msg.id;
    const finish = (r: Reply) => {
      if (done || src.epoch !== srcEpoch) return;
      done = true;
      const b = edge.series.cur;
      b.inW += msg.weight;
      if (r.ok) {
        b.okW += msg.weight;
        b.hist.add(this.now - start, msg.weight);
      } else {
        b.errW += msg.weight;
        b.errs[r.err ?? '5xx'] = (b.errs[r.err ?? '5xx'] ?? 0) + msg.weight;
      }
      if (edge.cfg.circuitBreaker) this.breakerUpdate(edge, r.ok);
      cb(r, this.now - start);
    };
    const tryOnce = () => {
      const my = ++attempt;
      let answered = false;
      const m = my === 1 ? msg : { ...msg, id: this.msgSeq++ };
      const op = m.op ?? 'read';
      const send = () => this.transmit(src.id, edge.to, m, edge, op, () =>
        this.deliver(m, r => {
          this.transmit(edge.to, src.id, m, edge, 'reply', () => {
            if (answered || my !== attempt) return;
            answered = true;
            if (!r.ok && r.err !== '429' && r.err !== 'auth' && r.err !== 'conflict' && attempt <= edge.cfg.retries) {
              this.kernel.after(backoff(edge, attempt, this.rng), tryOnce);
              return;
            }
            finish(r);
          }, r);
        }),
      );
      if (edge.cfg.keepAlive === false) this.kernel.after(this.handshakeMs(src.id, edge), send);
      else send();
      this.kernel.after(edge.cfg.timeoutMs, () => {
        if (answered || my !== attempt || done) return;
        answered = true;
        if (attempt <= edge.cfg.retries) this.kernel.after(backoff(edge, attempt, this.rng), tryOnce);
        else finish({ ok: false, err: 'timeout' });
      });
    };
    tryOnce();
  }

  /** New connection: TCP + TLS round trips before the request can go out. */
  private handshakeMs(from: Id, edge: EdgeRt): number {
    let ms = 0;
    for (let i = 0; i < (edge.cfg.handshakeRtts ?? 2); i++) ms += this.linkLatency(from, edge.to, edge) + this.linkLatency(edge.to, from, edge);
    return ms;
  }

  private breakerUpdate(edge: EdgeRt, ok: boolean) {
    const br = edge.breaker;
    if (br.state === 'half') {
      if (ok) {
        br.state = 'closed';
        br.fails = 0;
        br.recent = [];
      } else {
        br.state = 'open';
        br.openedAt = this.now;
      }
      return;
    }
    br.recent.push(ok ? 0 : 1);
    if (br.recent.length > 20) br.recent.shift();
    const fails = br.recent.reduce((a, b) => a + b, 0);
    if (br.recent.length >= 10 && fails / br.recent.length >= 0.5) {
      br.state = 'open';
      br.openedAt = this.now;
      this.log('info', `Circuit breaker opened on ${this.nodeName(edge.from)} → ${this.nodeName(edge.to)}`, edge.from);
    }
  }

  rpc(src: SimNode, to: Id, partial: Partial<Msg>, timeoutMs: number, cb: CallCb) {
    const msg = this.newMsg({ proto: true, kind: 'rpc', ...partial, from: src.id, to });
    const start = this.now;
    let done = false;
    const epoch = src.epoch;
    this.protoRecord(src.id, to, msg);
    this.transmit(src.id, to, msg, undefined, 'proto', () =>
      this.deliver(msg, r => {
        // a reply may name its own trace (a long-poll answered with traced data), or none
        const traceId = 'traceId' in r ? (r as Reply & { traceId?: number }).traceId : msg.traceId;
        const back = this.newMsg({ proto: true, kind: msg.kind + '.reply', from: to, to: src.id, traceId });
        this.protoRecord(to, src.id, back, r.ok ? 'ok' : r.err);
        this.transmit(to, src.id, back, undefined, 'proto', () => {
          if (done || epoch !== src.epoch) return;
          done = true;
          cb(r, this.now - start);
        });
      }),
    );
    this.kernel.after(timeoutMs, () => {
      if (done || epoch !== src.epoch) return;
      done = true;
      cb({ ok: false, err: 'timeout' }, this.now - start);
    });
  }

  send(src: SimNode, to: Id, partial: Partial<Msg>) {
    const msg = this.newMsg({ proto: true, kind: 'msg', ...partial, from: src.id, to });
    this.protoRecord(src.id, to, msg);
    this.transmit(src.id, to, msg, undefined, 'proto', () => {
      const node = this.nodes.get(to);
      if (!node || !node.up) return;
      node.logic.onMessage?.(msg);
    });
  }

  private protoRecord(from: Id, to: Id, msg: Msg, data?: string) {
    const blocked = this.blocked(from, to);
    this.proto.push({
      t: this.now,
      arrive: this.now + this.placementLatency(from, to),
      from,
      to,
      kind: msg.kind,
      dropped: blocked || !this.nodes.get(to)?.up,
      data: data ?? (msg.data !== undefined ? summarize(msg.data) : undefined),
    });
    if (this.proto.length > 60000) this.proto.splice(0, 15000);
  }

  // ---------- bookkeeping ----------
  anomaly(kind: string, w: number, node?: Id) {
    this.anomalies[kind] = (this.anomalies[kind] ?? 0) + w;
    if (node) {
      const n = this.nodes.get(node);
      if (n) n.series.cur.gauges['anomalies'] = (n.series.cur.gauges['anomalies'] ?? 0) + w;
    }
  }

  log(kind: LogEvent['kind'], text: string, node?: Id) {
    this.events.push({ t: this.now, kind, text, node });
    if (this.events.length > 2000) this.events.splice(0, 500);
  }

  isClient(type?: string) {
    return !!type && this.clientTypes.has(type);
  }

  nodeName(id: Id) {
    return this.nodes.get(id)?.name ?? id;
  }

  // ---------- scheduling & chaos ----------
  schedule(ev: ScheduledEvent) {
    this.kernel.at(ev.atSec * 1000, () => this.fire(ev.event));
  }

  fire(ev: ChaosEvent | TrafficEvent): number | undefined {
    if (ev.kind === 'traffic') {
      const te = ev as TrafficEvent;
      for (const g of this.traffic) if (!te.source || te.source === g.src.id) g.apply(te);
      this.log('traffic', trafficText(te));
      return undefined;
    }
    const ce = ev as ChaosEvent;
    const heal = applyChaos(this, ce);
    if (!heal) return undefined;
    const id = this.chaosSeq++;
    const until = ce.durationSec ? this.now + ce.durationSec * 1000 : undefined;
    this.chaos.push({ id, ev: ce, since: this.now, until, heal });
    if (until) this.kernel.at(until, () => this.heal(id));
    return id;
  }

  heal(id: number) {
    const i = this.chaos.findIndex(c => c.id === id);
    if (i < 0) return;
    const [c] = this.chaos.splice(i, 1);
    c.heal();
  }

  healAll() {
    for (const c of [...this.chaos]) this.heal(c.id);
  }

  // ---------- periodic ----------
  private tick() {
    const tSec = Math.round(this.now / 1000);
    let sysIn = 0;
    let sysOk = 0;
    let sysErr = 0;
    const sysHist = this.system.cur.hist;
    for (const n of this.nodes.values()) {
      if (n.mods.memLeakMbPerSec && n.up) {
        n.memMb += n.mods.memLeakMbPerSec;
        const limit = n.num('memoryMb', 2048);
        n.gauge('memMb', n.memMb);
        if (n.memMb >= limit) {
          this.log('chaos', `${n.name} OOM-killed`, n.id);
          n.kill();
          this.kernel.after(3000, () => n.restart());
        }
      }
      if (this.isClient(n.type)) {
        const b = n.series.cur;
        sysIn += b.inW;
        sysOk += b.okW;
        sysErr += b.errW;
        sysHist.merge(b.hist);
      }
      n.series.setCapacity(n.capacity);
      n.series.roll(tSec);
    }
    for (const e of this.edges.values()) e.series.roll(tSec);
    this.system.cur.inW = sysIn;
    this.system.cur.okW = sysOk;
    this.system.cur.errW = sysErr;
    this.system.roll(tSec);
    for (const g of this.traffic) g.adapt();
    this.evalAlerts();
    this.pruneFlights();
    this.kernel.at(this.now + 1000, () => this.tick());
  }

  private evalAlerts() {
    for (const a of this.alerts) {
      if (a.enabled === false) continue;
      const v = this.metricValue(a.target, a.metric);
      const breach = v !== undefined && (a.op === '>' ? v > a.threshold : v < a.threshold);
      const st = this.alertState.get(a.id) ?? { since: this.now, firing: false };
      if (breach) {
        if (!st.firing && this.now - st.since >= (a.forSec ?? 0) * 1000) {
          st.firing = true;
          this.firing.add(a.id);
          this.log('alert', `${a.target === 'system' ? 'System' : this.nodeName(a.target)} ${a.metric} ${a.op} ${a.threshold}`, a.target === 'system' ? undefined : a.target);
        }
      } else {
        st.since = this.now;
        if (st.firing) {
          st.firing = false;
          this.firing.delete(a.id);
          this.log('info', `Resolved: ${a.target === 'system' ? 'System' : this.nodeName(a.target)} ${a.metric}`, a.target === 'system' ? undefined : a.target);
        }
      }
      this.alertState.set(a.id, st);
    }
  }

  metricValue(target: Id | 'system', metric: string): number | undefined {
    const s = target === 'system' ? this.system : this.nodes.get(target)?.series ?? this.edges.get(target)?.series;
    const p = s?.last();
    if (!p) return undefined;
    switch (metric) {
      case 'p50':
        return p.p50;
      case 'p99':
        return p.p99;
      case 'rps':
        return p.rps;
      case 'errRate':
        return p.errRate * 100;
      case 'availability':
        return (1 - p.errRate) * 100;
      case 'util':
        return p.util * 100;
      case 'queue':
        return p.queue;
      default:
        return p.gauges[metric];
    }
  }

  nodeBadges(n: SimNode): Badge[] {
    const v = n.logic.view?.();
    return [...(v?.badges ?? []), ...n.badges];
  }
}

function backoff(edge: EdgeRt, attempt: number, rng: Rng) {
  const b = edge.cfg.backoffMs * Math.pow(2, attempt - 1);
  return edge.cfg.jitter === false ? b : b * (0.5 + rng.next());
}

const REGION_MS: Record<string, number> = {
  'us|us': 60,
  'us|eu': 80,
  'eu|us': 80,
  'us|ap': 150,
  'ap|us': 150,
  'eu|ap': 200,
  'ap|eu': 200,
  'eu|eu': 20,
  'ap|ap': 60,
};

export function regionLatency(a: string, b: string): number {
  const ka = a.slice(0, 2);
  const kb = b.slice(0, 2);
  return REGION_MS[`${ka}|${kb}`] ?? 100;
}

function summarize(d: unknown): string {
  if (d == null) return '';
  if (typeof d !== 'object') return String(d);
  try {
    return JSON.stringify(d).slice(0, 60);
  } catch {
    return '';
  }
}

function trafficText(te: TrafficEvent) {
  const p = te.params ?? {};
  switch (te.action) {
    case 'burst':
      return `Burst ×${p.x ?? 20} for ${te.durationSec ?? 5}s`;
    case 'flash-crowd':
      return `Flash crowd ×${p.x ?? 100}`;
    case 'hot-key':
      return `Hot key ${Math.round((p.hot ?? 0.4) * 100)}%`;
    case 'bots':
      return `Bot traffic +${p.rps ?? 5000} rps`;
    case 'herd':
      return 'Thundering herd';
    case 'ramp':
      return `Ramp ×${p.x ?? 3} over ${te.durationSec ?? 30}s`;
    default:
      return `Traffic set ${p.rps ?? ''} rps`;
  }
}
