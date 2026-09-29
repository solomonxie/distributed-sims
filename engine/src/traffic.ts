import { COLD_KEYS, KEYS } from './data/keystore';
import type { World } from './world';
import type { TrafficEvent, TrafficSource } from './types';

interface Overlay {
  x: number;
  until: number;
  from?: number;
  ramp?: boolean;
  decay?: boolean;
}

/** Emits weighted request particles from a client node. */
export class TrafficGen {
  weight = 1;
  overlays: Overlay[] = [];
  extraRps = 0;
  extraUntil = 0;
  hotOverride?: { hot: number; until: number };
  herdUntil = 0;
  base: TrafficSource['shape'];
  paused = false;

  constructor(private world: World, readonly src: TrafficSource, private nSources: number) {
    this.base = src.shape;
    this.adapt();
    this.scheduleNext();
  }

  /** Current requested rate (req/s) including overlays. */
  rate(): number {
    const t = this.world.now / 1000;
    let r = baseRate(this.base, t);
    for (const o of this.overlays) {
      if (this.world.now >= o.until && !o.ramp) continue;
      if (o.ramp && o.from !== undefined) {
        const f = Math.min(1, (this.world.now - o.from) / (o.until - o.from));
        r *= 1 + (o.x - 1) * f;
      } else if (o.decay && o.from !== undefined) {
        const f = (this.world.now - o.from) / (o.until - o.from);
        r *= 1 + (o.x - 1) * Math.exp(-4 * f);
      } else r *= o.x;
    }
    if (this.world.now < this.extraUntil) r += this.extraRps;
    return Math.max(0, r);
  }

  adapt() {
    this.overlays = this.overlays.filter(o => o.until > this.world.now || o.ramp);
    const per = this.world.opts.budget / Math.max(1, this.nSources);
    this.weight = Math.max(1, Math.ceil(this.rate() / per));
  }

  /** Applies the event; returns how to undo it. durationSec 0 = until healed, undefined = the action's usual length. */
  apply(te: TrafficEvent): (() => void) | undefined {
    const p = te.params ?? {};
    const open = te.durationSec === 0;
    const now = this.world.now;
    const upto = (fallbackSec: number) => (open ? Infinity : now + (te.durationSec ?? fallbackSec) * 1000);
    let heal: (() => void) | undefined;
    const overlay = (o: Overlay) => {
      this.overlays.push(o);
      heal = () => {
        this.overlays = this.overlays.filter(x => x !== o);
        this.adapt();
      };
    };
    switch (te.action) {
      case 'burst':
        overlay({ x: p.x ?? 20, until: upto(5) });
        break;
      case 'flash-crowd':
        // decays by nature; open-ended keeps the tail until healed
        overlay({ x: p.x ?? 100, until: now + (te.durationSec || 20) * 1000, from: now, decay: true });
        break;
      case 'ramp':
        overlay({ x: p.x ?? 3, until: now + (te.durationSec || 30) * 1000, from: now, ramp: true });
        break;
      case 'set':
        if (p.rps !== undefined) this.base = { kind: 'constant', rps: p.rps };
        break;
      case 'hot-key': {
        const prev = this.hotOverride;
        this.hotOverride = { hot: p.hot ?? 0.4, until: upto(30) };
        heal = () => {
          this.hotOverride = prev;
        };
        break;
      }
      case 'bots':
        this.extraRps = p.rps ?? 5000;
        this.extraUntil = upto(15);
        heal = () => {
          this.extraUntil = 0;
          this.adapt();
        };
        break;
      case 'herd': {
        const until = open ? Infinity : now + (te.durationSec ? te.durationSec * 1000 : 1500);
        this.herdUntil = until;
        overlay({ x: p.x ?? 30, until });
        const drop = heal!;
        heal = () => {
          this.herdUntil = 0;
          drop();
        };
        break;
      }
    }
    this.adapt();
    return heal;
  }

  private scheduleNext() {
    const r = this.rate();
    const particlesPerSec = r / this.weight;
    // Exponential gaps are memoryless: if the next arrival is > 250ms away, wait 250ms and redraw
    // (keeps rate changes responsive without biasing the rate).
    const gap = particlesPerSec > 0 ? this.world.rng.exp(1000 / particlesPerSec) : Infinity;
    const wait = Math.min(gap, 250);
    this.world.kernel.after(wait, () => {
      if (gap <= 250 && !this.paused) this.emit();
      this.scheduleNext();
    });
  }

  private emit() {
    const w = this.world;
    const client = w.nodes.get(this.src.node);
    if (!client || !client.up) return;
    const traced = w.rng.chance(1 / w.opts.traceEvery);
    const msg = w.newMsg({
      from: client.id,
      to: client.id,
      weight: this.weight,
      op: w.rng.chance(this.src.readRatio ?? 0.9) ? 'read' : 'write',
      key: this.key(),
      tenant: this.tenant() ?? w.placement.get(client.id)?.tenant,
      size: this.src.payloadBytes ?? 1024,
      auth: w.rng.chance(this.src.expiredAuth ?? 0) ? 'expired' : 'ok',
      traceId: traced ? w.newTrace(client.id) : undefined,
    });
    if (msg.op === 'write') msg.value = w.rng.int(1e9);
    emitFromClient(w, client.id, msg);
  }

  private key(): number {
    const kd = this.src.keys ?? { kind: 'zipf', s: 0.9 };
    const n = Math.min(kd.keys ?? KEYS, KEYS - COLD_KEYS);
    const r = this.world.rng;
    const hot = this.hotOverride && this.hotOverride.until > this.world.now ? this.hotOverride.hot : kd.kind === 'hot' ? kd.hot ?? 0.4 : 0;
    if (hot && r.chance(hot)) return 0;
    if (kd.kind === 'uniform') return r.int(n);
    return r.zipf(n, kd.s ?? 0.9);
  }

  private tenant(): string | undefined {
    const t = this.src.tenants;
    if (!t) return undefined;
    const entries = Object.entries(t);
    const total = entries.reduce((a, [, v]) => a + v, 0);
    let x = this.world.rng.next() * total;
    for (const [k, v] of entries) {
      x -= v;
      if (x <= 0) return k;
    }
    return entries[entries.length - 1][0];
  }
}

export function baseRate(shape: TrafficSource['shape'], tSec: number): number {
  switch (shape.kind) {
    case 'constant':
      return shape.rps;
    case 'ramp':
      return shape.from + (shape.to - shape.from) * Math.min(1, tSec / Math.max(1, shape.overSec));
    case 'diurnal': {
      const ph = (tSec % shape.periodSec) / shape.periodSec;
      return shape.trough + (shape.peak - shape.trough) * (0.5 - 0.5 * Math.cos(2 * Math.PI * ph));
    }
    case 'spike-train': {
      const ph = tSec % shape.periodSec;
      return ph < shape.widthSec ? shape.base + shape.height : shape.base;
    }
  }
}

/** A client "sends" a request: the client node handles it as a request whose reply ends the trace. */
export function emitFromClient(w: World, _clientId: string, msg: import('./types').Msg) {
  w.deliver(msg, r => {
    if (msg.traceId !== undefined) {
      const tr = w.traces.get(msg.traceId);
      if (tr) {
        tr.end = w.now;
        tr.ok = r.ok;
      }
    }
  });
}
