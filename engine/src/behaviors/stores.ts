// Specialised stores (search, TSDB, object store, graph, video origin) + observability collectors.
import type { NodeLogic, Req, SimNode } from '../node';
import type { Reply } from '../types';
import { register } from './registry';

// ---------- shared helpers ----------

/** Fixed 1s window counter: admits weight up to `limit` per second. */
export class RateWindow {
  private sec = -1;
  used = 0;
  last = 0;
  take(now: number, w: number, limit: number): boolean {
    this.roll(now);
    if (this.used + w > limit) return false;
    this.used += w;
    return true;
  }
  add(now: number, w: number) {
    this.roll(now);
    this.used += w;
  }
  private roll(now: number) {
    const s = Math.floor(now / 1000);
    if (s !== this.sec) {
      this.last = s === this.sec + 1 ? this.used : 0;
      this.sec = s;
      this.used = 0;
    }
  }
}

interface PoolJob {
  w: number;
  need: number;
  ms: number;
  enq: number;
  done: (ok: boolean, waitMs: number) => void;
}

/** A private slot pool inside a node (per shard, transcoder tier...). Mirrors SimNode.process. */
export class Pool {
  busy = 0;
  queuedW = 0;
  private q: PoolJob[] = [];
  constructor(private n: SimNode, private slots: () => number, private limit: () => number) {}

  run(w: number, ms: number, done: (ok: boolean, waitMs: number) => void) {
    const cap = Math.max(1, this.slots());
    const job = { w, need: Math.min(Math.max(1, Math.ceil(w)), cap), ms, enq: this.n.now, done };
    if (!this.q.length && this.busy + job.need <= cap) return this.start(job);
    if (this.queuedW + w > this.limit()) return done(false, 0);
    this.q.push(job);
    this.queuedW += w;
  }
  get util() {
    return this.busy / Math.max(1, this.slots());
  }
  reset() {
    this.busy = 0;
    this.q = [];
    this.queuedW = 0;
  }
  private start(j: PoolJob) {
    this.busy += j.need;
    const hold = (j.ms * j.w) / j.need;
    this.n.series.cur.busy += j.need * hold;
    this.n.timer(hold, () => {
      this.busy -= j.need;
      j.done(true, this.n.now - j.enq - hold);
      this.pump();
    });
  }
  private pump() {
    const cap = Math.max(1, this.slots());
    while (this.q.length) {
      const j = this.q[0];
      j.need = Math.min(j.need, cap);
      if (this.busy + j.need > cap) break;
      this.q.shift();
      this.queuedW -= j.w;
      this.start(j);
    }
  }
}

const busy: Reply = { ok: false, err: '503' };

/** Hot share from chaos params: `hot` (percent, chaos.yaml) or `pct` (fraction). */
export function hotShare(p: Record<string, any>, dflt = 0.4): number {
  const v = Number(p.hot ?? p.pct ?? dflt);
  return v > 1 ? v / 100 : v;
}

/** Largest of k lognormal samples: fan-out waits for the slowest shard. */
export function slowestOf(n: SimNode, k: number, p50: number, p99: number): number {
  let m = 0;
  for (let i = 0; i < Math.min(k, 64); i++) m = Math.max(m, n.rng.lognormal(p50, p99));
  return m * n.mods.slowX;
}

// ---------- search-index ----------

/** Shards × replicas; queries fan out to every shard; writes invisible until next refresh. */
export function searchIndex(n: SimNode): NodeLogic {
  const written = new Map<number, number>(); // key → write time
  let lastRefresh = 0;
  let pending = 0;
  let oldestPending = -1;
  const shards = () => Math.max(1, Math.round(n.num('shards', 5)));
  const replicas = () => Math.max(0, Math.round(n.num('replicas', 1)));
  return {
    onStart() {
      lastRefresh = n.now;
      const every = n.num('refreshMs', 1000);
      if (every > 0)
        n.every(every, () => {
          lastRefresh = n.now;
          // refresh writes a new segment; cost grows with pending docs
          if (pending) n.process(1, 1 + pending * 0.002, () => {});
          n.gauge('indexLagMs', oldestPending >= 0 ? Math.round(n.now - oldestPending) : 0);
          pending = 0;
          oldestPending = -1;
          n.gauge('unsearchable', 0);
        });
    },
    onRequest(req: Req) {
      const m = req.msg;
      const w = m.weight;
      if (m.op === 'write') {
        if (n.mods.diskFull) return req.reply({ ok: false, err: '5xx' });
        // primary + each replica indexes the doc
        n.process(w * (1 + replicas()), n.serviceTime('indexP50Ms', 'indexP99Ms', 3, 20), ok => {
          if (!ok) return req.reply(busy);
          if (m.key !== undefined) written.set(m.key, n.now);
          pending += w;
          if (oldestPending < 0) oldestPending = n.now;
          n.gauge('unsearchable', pending);
          req.reply({ ok: true });
        });
        return;
      }
      const k = shards();
      const ms = slowestOf(n, k, n.num('p50Ms', 4), n.num('p99Ms', 30));
      n.gauge('fanout', k);
      n.process((w * k) / (1 + replicas()), ms, ok => {
        if (!ok) return req.reply(busy);
        const at = m.key !== undefined ? written.get(m.key) : undefined;
        const refreshOn = n.num('refreshMs', 1000) > 0;
        if (at !== undefined && refreshOn && at > lastRefresh) {
          n.anomaly('stale-read', w);
          return req.reply({ ok: true, stale: true });
        }
        req.reply({ ok: true });
      });
    },
    onChaos(kind, _p, heal) {
      if (kind === 'rebalance') {
        n.mods.slowX *= heal ? 1 / 2.5 : 2.5;
        return true;
      }
      return false;
    },
    view() {
      return { badges: [{ text: `${shards()}×${replicas() + 1}`, tone: 'muted' }], label: pending ? `${Math.round(pending)} unsearchable` : undefined };
    },
  };
}

// ---------- time-series-db ----------

export function timeSeriesDb(n: SimNode): NodeLogic {
  const ingest = new RateWindow();
  let cardX = 1;
  const memMb = () => (n.num('cardinality', 100_000) * cardX * n.num('bytesPerSeries', 4096)) / 1e6;
  const checkMem = () => {
    n.memMb = memMb();
    n.gauge('memMb', Math.round(n.memMb));
    n.gauge('series', n.num('cardinality', 100_000) * cardX);
    if (n.memMb > n.num('memoryMb', 8192)) {
      n.log('alert', `${n.name} OOM: ${Math.round(n.memMb)}MB of series in memory`);
      n.kill();
      n.world.kernel.after(5000, () => n.restart());
    }
  };
  return {
    onStart() {
      checkMem();
      n.every(1000, checkMem);
    },
    onRequest(req: Req) {
      const w = req.msg.weight;
      if (req.msg.op === 'write') {
        // each write = one batch of samples
        const samples = w * n.num('samplesPerWrite', 100);
        if (!ingest.take(n.now, samples, n.num('ingestLimit', 1_000_000))) return req.reply({ ok: false, err: '429' });
        n.gauge('ingestPerSec', ingest.used);
        return n.process(w, n.serviceTime('writeP50Ms', 'writeP99Ms', 1, 8), ok => req.reply(ok ? { ok: true } : busy));
      }
      // query cost grows with range and matched series
      const rangeX = Math.max(1, n.num('queryRangeHours', 1));
      n.process(w, n.serviceTime() * Math.sqrt(rangeX) * Math.sqrt(cardX), ok => req.reply(ok ? { ok: true } : busy));
    },
    onChaos(kind, p, heal) {
      if (kind === 'cardinality-burst' || kind === 'hot-key') {
        cardX = heal ? 1 : Number(p.x ?? 20);
        return true;
      }
      return false;
    },
    view() {
      return { label: `${Math.round(memMb())}MB series` };
    },
  };
}

// ---------- object-store ----------

/** GET/PUT latency by size; per-prefix request rate limits → 503 SlowDown. */
export function objectStore(n: SimNode): NodeLogic {
  const prefixes = new Map<number, RateWindow>();
  const hot = new Set<number>();
  return {
    onRequest(req: Req) {
      const m = req.msg;
      const put = m.op === 'write';
      const nPrefix = Math.max(1, Math.round(n.num('prefixes', 16)));
      const prefix = (m.key ?? n.rng.int(1024)) % nPrefix;
      let win = prefixes.get(prefix);
      if (!win) prefixes.set(prefix, (win = new RateWindow()));
      const limit = put ? n.num('putRpsPerPrefix', 3500) : n.num('getRpsPerPrefix', 5500);
      if (!win.take(n.now, m.weight, limit)) {
        hot.add(prefix);
        n.gauge('throttledPrefixes', hot.size);
        n.gauge('hotPrefix', prefix);
        return req.reply({ ok: false, err: '503' });
      }
      if (put && n.mods.diskFull) return req.reply({ ok: false, err: '5xx' });
      const base = put ? n.serviceTime('putP50Ms', 'putP99Ms', 30, 150) : n.serviceTime('p50Ms', 'p99Ms', 15, 80);
      const xferMs = (m.size / 1e6 / Math.max(1, n.num('mbPerSec', 90))) * 1000;
      n.process(m.weight, base + xferMs, ok => req.reply(ok ? { ok: true } : busy));
    },
    onStart() {
      n.every(5000, () => {
        hot.clear();
        n.gauge('throttledPrefixes', 0);
      });
    },
  };
}

// ---------- graph-db ----------

/** Traversal cost ∝ degree^depth (capped); supernodes blow it up. */
export function graphDb(n: SimNode): NodeLogic {
  let superPct = 0;
  return {
    onRequest(req: Req) {
      const m = req.msg;
      if (m.op === 'write') return n.process(m.weight, n.serviceTime('writeP50Ms', 'writeP99Ms', 3, 20), ok => req.reply(ok ? { ok: true } : busy));
      const depth = Math.max(1, Math.round(n.num('depth', 2)));
      let degree = n.num('avgDegree', 20);
      if (superPct && n.rng.chance(superPct)) degree *= 100;
      const touched = Math.min(n.num('maxVisited', 1e6), Math.pow(degree, depth));
      n.gauge('visited', Math.round(touched));
      const ms = n.serviceTime('p50Ms', 'p99Ms', 1, 5) + touched * n.num('usPerVisit', 10) / 1000;
      n.process(m.weight, ms, ok => req.reply(ok ? { ok: true } : busy));
    },
    onChaos(kind, p, heal) {
      if (kind !== 'hot-key') return false;
      superPct = heal ? 0 : hotShare(p, 0.2);
      return true;
    },
  };
}

// ---------- blob-cdn-origin ----------

/** Video origin: segment GETs by size; uploads go through a transcoding worker pool. */
export function blobOrigin(n: SimNode): NodeLogic {
  const transcode = new Pool(n, () => n.num('transcoders', 8), () => n.num('transcodeQueue', 200));
  const tick = () => {
    n.gauge('transcodeBacklog', Math.round(transcode.queuedW));
    n.gauge('transcoderUtil', Math.round(transcode.util * 100));
  };
  return {
    onStart() {
      n.every(1000, tick);
    },
    onRequest(req: Req) {
      const m = req.msg;
      if (m.op === 'write') {
        // job length = video minutes × renditions × sec per rendition-minute
        const jobMs = n.num('videoMin', 5) * n.num('renditions', 4) * n.num('transcodeSecPerMin', 6) * 1000;
        let answered = false;
        transcode.run(m.weight, jobMs, (ok, wait) => {
          n.gauge('transcodeWaitSec', Math.round(wait / 1000));
          if (!ok && !answered) {
            answered = true;
            req.reply(busy);
          }
        });
        if (!answered) {
          answered = true;
          n.process(m.weight, n.serviceTime('putP50Ms', 'putP99Ms', 40, 200), ok => req.reply(ok ? { ok: true } : busy));
        }
        return;
      }
      const xferMs = (n.num('segmentMb', 2) / Math.max(1, n.num('mbPerSec', 100))) * 1000;
      n.process(m.weight, n.serviceTime() + xferMs, ok => req.reply(ok ? { ok: true } : busy));
    },
    onKill() {
      transcode.reset();
    },
  };
}

// ---------- observability collectors ----------

/**
 * Telemetry collector: ingest cap per second, drop on overload (never errors the caller).
 * trace-collector adds sampling: head (random at ingest) vs tail (keep all errors, sample the rest).
 */
export function collector(n: SimNode): NodeLogic {
  const win = new RateWindow();
  const acc = { in: 0, dropped: 0, kept: 0, errIn: 0, errKept: 0 };
  const flush = () => {
    const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);
    n.gauge('droppedPct', pct(acc.dropped, acc.in));
    n.gauge('keptPct', pct(acc.kept, acc.in));
    if (n.type === 'trace-collector') n.gauge('errorsKeptPct', acc.errIn > 0 ? pct(acc.errKept, acc.errIn) : 100);
    acc.in = acc.dropped = acc.kept = acc.errIn = acc.errKept = 0;
  };
  return {
    onStart() {
      n.every(1000, flush);
    },
    onRequest(req: Req) {
      const w = req.msg.weight;
      acc.in += w;
      // error share of incoming spans ≈ system error rate right now (unless the span says)
      const errRate = req.msg.data?.err !== undefined ? (req.msg.data.err ? 1 : 0) : n.world.system.last()?.errRate ?? 0;
      const errW = w * errRate;
      acc.errIn += errW;
      if (!n.up || !win.take(n.now, w, n.num('ingestLimit', 50_000))) {
        acc.dropped += w;
        return req.reply({ ok: true });
      }
      let keptW = w;
      let errKept = errW;
      if (n.type === 'trace-collector') {
        const rate = n.num('sampleRate', 0.1);
        const mode = n.str<'head' | 'tail' | 'none'>('sampling', 'head');
        if (mode === 'head') {
          keptW = w * rate;
          errKept = errW * rate;
        } else if (mode === 'tail') {
          keptW = errW + (w - errW) * rate;
          errKept = errW;
        }
      }
      acc.kept += keptW;
      acc.errKept += errKept;
      // tail sampling buffers whole traces before deciding → more work per span
      const tailX = n.type === 'trace-collector' && n.str<string>('sampling', 'head') === 'tail' ? 2 : 1;
      n.process(w, n.serviceTime('p50Ms', 'p99Ms', 0.5, 3) * tailX, ok => {
        if (!ok) acc.dropped += w;
        req.reply({ ok: true });
      });
    },
  };
}

register('search-index', searchIndex);
register('time-series-db', timeSeriesDb);
register('object-store', objectStore);
register('graph-db', graphDb);
register('blob-cdn-origin', blobOrigin);
register('metrics-collector', collector);
register('log-pipeline', collector);
register('trace-collector', collector);
