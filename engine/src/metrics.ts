import type { ErrKind } from './types';

/** Log-bucket latency histogram, ~5% resolution, 0.01ms .. ~10min. */
const BASE = 1.1;
const MIN = 0.01;
const NB = 190;

export class Histogram {
  counts = new Float64Array(NB);
  total = 0;

  add(ms: number, w = 1) {
    const i = ms <= MIN ? 0 : Math.min(NB - 1, Math.floor(Math.log(ms / MIN) / Math.log(BASE)) + 1);
    this.counts[i] += w;
    this.total += w;
  }

  quantile(q: number): number {
    if (this.total <= 0) return 0;
    const target = this.total * q;
    let acc = 0;
    for (let i = 0; i < NB; i++) {
      acc += this.counts[i];
      if (acc >= target) return i === 0 ? MIN : MIN * Math.pow(BASE, i - 0.5);
    }
    return MIN * Math.pow(BASE, NB);
  }

  merge(o: Histogram) {
    for (let i = 0; i < NB; i++) this.counts[i] += o.counts[i];
    this.total += o.total;
  }

  reset() {
    this.counts.fill(0);
    this.total = 0;
  }
}

export interface Bucket {
  t: number;
  inW: number;
  okW: number;
  errW: number;
  errs: Partial<Record<ErrKind, number>>;
  hist: Histogram;
  busy: number;
  queueMax: number;
  gauges: Record<string, number>;
}

function newBucket(t: number): Bucket {
  return { t, inW: 0, okW: 0, errW: 0, errs: {}, hist: new Histogram(), busy: 0, queueMax: 0, gauges: {} };
}

export interface Point {
  t: number;
  rps: number;
  errRate: number;
  p50: number;
  p99: number;
  util: number;
  queue: number;
  gauges: Record<string, number>;
  errs: Partial<Record<ErrKind, number>>;
}

/** Per-entity series of 1s buckets, ring of `keep` seconds. */
export class Series {
  points: Point[] = [];
  cur: Bucket;
  private capacity = 1;

  constructor(private keep = 600) {
    this.cur = newBucket(0);
  }

  setCapacity(c: number) {
    this.capacity = Math.max(1, c);
  }

  roll(tSec: number) {
    const b = this.cur;
    const secs = 1;
    const p: Point = {
      t: b.t,
      rps: b.inW / secs,
      errRate: b.okW + b.errW > 0 ? b.errW / (b.okW + b.errW) : 0,
      p50: b.hist.quantile(0.5),
      p99: b.hist.quantile(0.99),
      util: Math.min(1, b.busy / (this.capacity * 1000 * secs)),
      queue: b.queueMax,
      gauges: { ...b.gauges },
      errs: { ...b.errs },
    };
    this.points.push(p);
    if (this.points.length > this.keep) this.points.shift();
    this.cur = newBucket(tSec);
    this.cur.gauges = { ...b.gauges };
    return p;
  }

  last(): Point | undefined {
    return this.points[this.points.length - 1];
  }

  /** Aggregate over the last n points. */
  window(n: number): { rps: number; errRate: number; p99: number; util: number } {
    const pts = this.points.slice(-n);
    if (!pts.length) return { rps: 0, errRate: 0, p99: 0, util: 0 };
    const rps = pts.reduce((a, p) => a + p.rps, 0) / pts.length;
    const errRate = pts.reduce((a, p) => a + p.errRate, 0) / pts.length;
    const p99 = Math.max(...pts.map(p => p.p99));
    const util = pts.reduce((a, p) => a + p.util, 0) / pts.length;
    return { rps, errRate, p99, util };
  }
}
