import type { Id } from '../types';
import type { World } from '../world';
import type { SimNode } from '../node';

/** Sampled keyspace size (engine.md → Data model). */
export const KEYS = 1024;
/** top of the key space, never used by background traffic: user "cold key" sends rotate through it */
export const COLD_KEYS = 64;

export function keyOf(k: number | undefined, size = KEYS): number {
  const x = Math.floor(k ?? 0) % size;
  return x < 0 ? x + size : x;
}

/** 32-bit integer mix (stable key/shard hashing). */
export function mix32(x: number): number {
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

export interface Rec {
  value: number;
  version: number;
  writer: string;
  ts: number;
}

/** One copy of the keyspace. Last-writer-wins by version. */
export class KeyStore {
  recs: (Rec | undefined)[];

  constructor(readonly size = KEYS) {
    this.recs = new Array(size);
  }

  get(k: number): Rec | undefined {
    return this.recs[keyOf(k, this.size)];
  }

  version(k: number): number {
    return this.get(k)?.version ?? 0;
  }

  /** Apply if newer; returns true if applied. */
  put(k: number, r: Rec): boolean {
    const i = keyOf(k, this.size);
    const cur = this.recs[i];
    if (cur && cur.version >= r.version) return false;
    this.recs[i] = r;
    return true;
  }

  copyFrom(o: KeyStore) {
    this.recs = o.recs.slice();
  }
}

interface Pending {
  k: number;
  rec: Rec;
  seq: number;
  enq: number;
  at: number;
}

/** A copy fed by a FIFO replication stream with lag. */
export class Replica {
  up = true;
  applied = 0;
  private q: Pending[] = [];
  private head = 0;
  private lastAt = 0;

  constructor(public store = new KeyStore()) {}

  /** Ship a write; returns the time it will be applied (FIFO: never before earlier writes). */
  enqueue(k: number, rec: Rec, seq: number, now: number, lagMs: number): number {
    const at = Math.max(this.lastAt, now + lagMs);
    this.lastAt = at;
    this.q.push({ k, rec, seq, enq: now, at });
    return at;
  }

  catchUp(now: number) {
    while (this.head < this.q.length && this.q[this.head].at <= now) {
      const p = this.q[this.head++];
      this.store.put(p.k, p.rec);
      this.applied = p.seq;
    }
    if (this.head > 512) {
      this.q = this.q.slice(this.head);
      this.head = 0;
    }
  }

  get pending(): number {
    return this.q.length - this.head;
  }

  /** Age of the oldest unapplied write. */
  lagMs(now: number): number {
    this.catchUp(now);
    return this.pending ? now - this.q[this.head].enq : 0;
  }

  /** Discard everything not yet applied (in-flight on a dead link). */
  dropPending() {
    this.q = [];
    this.head = 0;
    this.lastAt = 0;
  }

  resync(from: KeyStore, seq: number) {
    this.store.copyFrom(from);
    this.dropPending();
    this.applied = seq;
  }
}

/**
 * Ground truth for anomaly detection: the latest version acknowledged to a
 * client per key, and the latest version each key was read at.
 */
export class Truth {
  acked: Float64Array;
  ackedW: Float64Array;
  lastRead: Float64Array;

  constructor(readonly size = KEYS) {
    this.acked = new Float64Array(size);
    this.ackedW = new Float64Array(size);
    this.lastRead = new Float64Array(size);
  }

  ack(k: number, version: number, w: number) {
    const i = keyOf(k, this.size);
    if (version >= this.acked[i]) {
      this.acked[i] = version;
      this.ackedW[i] = w;
    }
  }

  /** stale = older than the latest acked write; out-of-order = older than a previous read (non-monotonic). */
  checkRead(n: SimNode, k: number, version: number, w: number): boolean {
    const i = keyOf(k, this.size);
    const stale = version < this.acked[i];
    if (stale) n.anomaly('stale-read', w);
    if (version < this.lastRead[i]) n.anomaly('out-of-order', w);
    else this.lastRead[i] = version;
    return stale;
  }

  /** After failover to `store`: acked writes it doesn't have are lost. Resets truth to the survivor. */
  lostAfter(store: KeyStore): { keys: number; w: number } {
    let keys = 0;
    let w = 0;
    for (let i = 0; i < this.size; i++) {
      const v = store.version(i);
      if (this.acked[i] > v) {
        keys++;
        w += this.ackedW[i] || 1;
        this.acked[i] = v;
      }
      if (this.lastRead[i] > v) this.lastRead[i] = v;
    }
    return { keys, w };
  }
}

/** Keys where two copies disagree (both written, different versions). */
export function divergence(a: KeyStore, b: KeyStore): number {
  let d = 0;
  for (let i = 0; i < a.size; i++) {
    const x = a.recs[i];
    const y = b.recs[i];
    if (x && y && x.version !== y.version) d++;
  }
  return d;
}

// ---- cross-node lookup: caches / routers ask a store for the acked version ----

type AckedFn = (k: number) => number;
const registry = new WeakMap<World, Map<Id, AckedFn>>();

export function registerTruth(world: World, id: Id, fn: AckedFn) {
  if (!registry.has(world)) registry.set(world, new Map());
  registry.get(world)!.set(id, fn);
}

/** Latest acked version of key k at store `id`, or undefined if `id` isn't a versioned store. */
export function ackedVersion(world: World, id: Id, k: number): number | undefined {
  return registry.get(world)?.get(id)?.(k);
}
