import type { Badge, Config, EdgeConfig, ErrKind, Id, Msg, NodeSpec, Op, Reply } from './types';
import type { Rng } from './rng';
import { Series } from './metrics';
import type { World, EdgeRt } from './world';

export interface Req {
  msg: Msg;
  reply(r: Reply): void;
  /** time the request arrived at this node */
  at: number;
}

export interface NodeLogic {
  onStart?(): void;
  /** claim non-'req' message kinds this logic handles itself (else registered kind handlers run) */
  handles?(kind: string): boolean;
  onRequest?(req: Req): void;
  /** one-way / protocol messages (no reply expected) */
  onMessage?(msg: Msg): void;
  /** behaviour-specific chaos; return true if handled */
  onChaos?(kind: string, params: Record<string, any>, heal: boolean): boolean;
  onKill?(): void;
  onRestart?(): void;
  /** extra UI info */
  view?(): { badges?: Badge[]; label?: string };
}

export type CallCb = (r: Reply, latencyMs: number) => void;

interface Waiting {
  w: number;
  need: number;
  serviceMs: number;
  enq: number;
  done: (ok: boolean, waitMs: number) => void;
  epoch: number;
}

export interface Mods {
  slowX: number;
  capacityX: number;
  errRate: number;
  pausedUntil: number;
  clockOffsetMs: number;
  diskFull: boolean;
  dnsFail: boolean;
  certExpired: boolean;
  memLeakMbPerSec: number;
}

export class SimNode {
  readonly id: Id;
  readonly type: string;
  readonly skin?: string;
  name: string;
  cfg: Config;
  rng: Rng;
  series = new Series();
  logic: NodeLogic = {};
  up = true;
  epoch = 0;
  busy = 0;
  queue: Waiting[] = [];
  queuedW = 0;
  memMb = 0;
  downSince = 0;
  mods: Mods = {
    slowX: 1,
    capacityX: 1,
    errRate: 0,
    pausedUntil: 0,
    clockOffsetMs: 0,
    diskFull: false,
    dnsFail: false,
    certExpired: false,
    memLeakMbPerSec: 0,
  };
  badges: Badge[] = [];
  label?: string;
  gaugesNow: Record<string, number> = {};

  constructor(readonly spec: NodeSpec, readonly world: World, cfg: Config, rng: Rng) {
    this.id = spec.id;
    this.type = spec.type;
    this.skin = spec.skin;
    this.name = spec.name;
    this.cfg = cfg;
    this.rng = rng;
    this.series.setCapacity(this.capacity);
  }

  // ----- config helpers -----
  num(key: string, dflt: number): number {
    const v = this.cfg[key];
    return typeof v === 'number' && isFinite(v) ? v : dflt;
  }
  str<T extends string = string>(key: string, dflt: NoInfer<T>): T {
    const v = this.cfg[key];
    return (typeof v === 'string' ? v : dflt) as T;
  }
  bool(key: string, dflt: boolean): boolean {
    const v = this.cfg[key];
    return typeof v === 'boolean' ? v : dflt;
  }

  get now(): number {
    return this.world.kernel.now;
  }
  /** node-local wall clock (affected by clock skew chaos) */
  clock(): number {
    return this.now + this.mods.clockOffsetMs;
  }
  get instances(): number {
    return Math.max(0, Math.round(this.num('instances', 1)));
  }
  get capacity(): number {
    return Math.max(1, Math.round(this.instances * this.num('slots', 16) * this.mods.capacityX));
  }
  get queueLimit(): number {
    return this.num('queueLimit', 1000);
  }

  /** Default service time from p50/p99 config, with chaos slowdowns. */
  serviceTime(p50Key = 'p50Ms', p99Key = 'p99Ms', d50 = 5, d99 = 25): number {
    return this.rng.lognormal(this.num(p50Key, d50), this.num(p99Key, d99)) * this.mods.slowX;
  }

  // ----- resource model -----
  /** Acquire capacity for `w` requests for `serviceMs` each. done(ok, waitMs). */
  process(w: number, serviceMs: number, done: (ok: boolean, waitMs: number) => void) {
    if (!this.up) return;
    const need = Math.min(Math.max(1, Math.ceil(w)), this.capacity);
    if (this.queue.length === 0 && this.busy + need <= this.capacity && this.now >= this.mods.pausedUntil) {
      this.start({ w, need, serviceMs, enq: this.now, done, epoch: this.epoch });
      return;
    }
    if (this.queuedW + w > this.queueLimit) {
      done(false, 0);
      return;
    }
    this.queue.push({ w, need, serviceMs, enq: this.now, done, epoch: this.epoch });
    this.queuedW += w;
    if (this.queuedW > this.series.cur.queueMax) this.series.cur.queueMax = this.queuedW;
    if (this.now < this.mods.pausedUntil) this.world.kernel.at(this.mods.pausedUntil, () => this.drain());
  }

  private start(job: Waiting) {
    this.busy += job.need;
    const hold = (job.serviceMs * job.w) / job.need;
    this.series.cur.busy += job.need * hold;
    const epoch = this.epoch;
    this.world.kernel.after(hold, () => {
      if (epoch !== this.epoch) return;
      this.busy -= job.need;
      job.done(true, this.now - job.enq - hold);
      this.drain();
    });
  }

  drain() {
    if (this.now < this.mods.pausedUntil) return;
    while (this.queue.length) {
      const head = this.queue[0];
      if (head.epoch !== this.epoch) {
        this.queue.shift();
        this.queuedW -= head.w;
        continue;
      }
      const need = Math.min(head.need, this.capacity);
      if (this.busy + need > this.capacity) break;
      this.queue.shift();
      this.queuedW -= head.w;
      head.need = need;
      this.start(head);
    }
  }

  // ----- messaging -----
  outEdges(filter?: (e: EdgeRt) => boolean): EdgeRt[] {
    const list = this.world.out.get(this.id) ?? [];
    return filter ? list.filter(filter) : list;
  }
  syncOut(op?: Op): EdgeRt[] {
    return this.outEdges(e => e.cfg.mode !== 'async' && edgeAllowsOp(e.cfg, op));
  }
  asyncOut(op?: Op): EdgeRt[] {
    return this.outEdges(e => e.cfg.mode === 'async' && edgeAllowsOp(e.cfg, op));
  }

  /** Request/response over an edge with timeout, retries, breaker. */
  call(edge: EdgeRt, msg: Msg, cb: CallCb) {
    this.world.call(this, edge, msg, cb);
  }

  /** Request/response directly to a node (protocols; no edge needed). */
  rpc(to: Id, msg: Partial<Msg>, timeoutMs: number, cb: CallCb) {
    this.world.rpc(this, to, msg, timeoutMs, cb);
  }

  /** One-way message to a node (protocol or async). */
  send(to: Id, msg: Partial<Msg>) {
    this.world.send(this, to, msg);
  }

  timer(ms: number, fn: () => void) {
    const epoch = this.epoch;
    return this.world.kernel.after(ms, () => {
      if (epoch === this.epoch && this.up) fn();
    });
  }

  /** Repeating timer with optional jitter fraction. */
  every(ms: number, fn: () => void, jitter = 0) {
    const tick = () => {
      fn();
      this.timer(ms * (1 + (jitter ? (this.rng.next() * 2 - 1) * jitter : 0)), tick);
    };
    this.timer(ms * (1 + (jitter ? this.rng.next() * jitter : 0)), tick);
  }

  /**
   * Forward a request downstream. mode 'all' = call every edge in order
   * (respecting ratio), 'one' = pick one edge (by ratio weights).
   */
  forward(req: Req, edges: EdgeRt[], mode: 'all' | 'one', after?: (r: Reply) => void) {
    const finish = after ?? ((r: Reply) => req.reply(r));
    const chosen = mode === 'one' ? pickWeighted(edges, this.rng) : edges.filter(e => this.rng.chance(e.cfg.ratio ?? 1));
    if (!chosen || (Array.isArray(chosen) && !chosen.length)) return finish({ ok: true });
    const list = Array.isArray(chosen) ? chosen : [chosen];
    let i = 0;
    let last: Reply = { ok: true };
    const nextCall = () => {
      if (i >= list.length) return finish(last);
      const e = list[i++];
      this.call(e, this.world.child(req.msg, this.id, e.to), r => {
        last = r.ok ? { ...last, ...r, ok: true } : r;
        if (!r.ok) return finish(r);
        nextCall();
      });
    };
    nextCall();
  }

  /** Fire-and-forget on async edges. */
  publish(req: Req) {
    for (const e of this.asyncOut(req.msg.op)) {
      if (!this.rng.chance(e.cfg.ratio ?? 1)) continue;
      this.call(e, this.world.child(req.msg, this.id, e.to), () => {});
    }
  }

  gauge(key: string, v: number) {
    this.series.cur.gauges[key] = v;
    this.gaugesNow[key] = v;
  }
  anomaly(kind: string, w = 1) {
    this.world.anomaly(kind, w, this.id);
  }
  log(kind: 'protocol' | 'info' | 'chaos' | 'alert', text: string) {
    this.world.log(kind, text, this.id);
  }

  // ----- lifecycle -----
  kill() {
    if (!this.up) return;
    this.up = false;
    this.downSince = this.now;
    this.epoch++;
    this.busy = 0;
    this.queue = [];
    this.queuedW = 0;
    this.memMb = 0;
    this.logic.onKill?.();
  }
  restart() {
    if (this.up) return;
    this.up = true;
    this.epoch++;
    this.logic.onRestart?.();
    this.logic.onStart?.();
  }
}

export function edgeAllowsOp(cfg: EdgeConfig, op?: Op): boolean {
  return !cfg.op || cfg.op === 'any' || !op || cfg.op === op;
}

export function pickWeighted(edges: EdgeRt[], rng: Rng): EdgeRt | undefined {
  if (!edges.length) return undefined;
  const total = edges.reduce((a, e) => a + (e.cfg.ratio ?? 1), 0);
  let r = rng.next() * total;
  for (const e of edges) {
    r -= e.cfg.ratio ?? 1;
    if (r <= 0) return e;
  }
  return edges[edges.length - 1];
}

export function errOf(kind: ErrKind): Reply {
  return { ok: false, err: kind };
}
