// Cache: read-through in front of its out-edge store; write strategies, eviction, TTL, stampede.
import { register } from './registry';
import type { NodeLogic, Req, SimNode } from '../node';
import { pickWeighted } from '../node';
import type { Reply } from '../types';
import { ackedVersion, keyOf } from '../data/keystore';

interface Entry {
  value?: number;
  version: number;
  expires: number;
  used: number;
  freq: number;
}

/** Version marker for write-behind entries not yet flushed (newest by definition). */
const PENDING = Number.MAX_SAFE_INTEGER;

function cache(n: SimNode): NodeLogic {
  const strategy = n.str('strategy', 'cache-aside');
  const eviction = n.str('eviction', 'lru');
  const invalidation = n.str('invalidation', 'delete-on-write');
  const coalescing = n.bool('coalescing', false);
  const capacity = () => Math.max(1, Math.round(n.num('capacityKeys', 256) * Math.max(1, n.num('clusterShards', 1))));
  const ttlMs = n.num('ttlSec', 60) * 1000;
  const jitter = n.num('ttlJitterPct', 0) / 100;
  let entries = new Map<number, Entry>();
  const inflight = new Map<number, Req[]>();
  let dirty = new Map<number, { value: number; w: number; traceId?: number }>();
  let hits = 0;
  let misses = 0;
  let lastRatio = 0;
  let lostW = 0;

  const dbEdge = (op: 'read' | 'write') => {
    const es = n.syncOut(op);
    return pickWeighted(es, n.rng);
  };
  const expiry = () => (ttlMs > 0 ? n.now + ttlMs * (1 + (jitter ? (n.rng.next() * 2 - 1) * jitter : 0)) : Infinity);

  function evictOne() {
    let victim: number | undefined;
    if (eviction === 'lru') victim = entries.keys().next().value;
    else {
      let best = Infinity;
      for (const [k, e] of entries) {
        const score = eviction === 'lfu' ? e.freq : e.expires;
        if (score < best) {
          best = score;
          victim = k;
        }
      }
    }
    if (victim !== undefined) entries.delete(victim);
  }

  function set(k: number, value: number | undefined, version: number) {
    const prev = entries.get(k);
    entries.delete(k);
    if (!prev && entries.size >= capacity()) evictOne();
    entries.set(k, { value, version, expires: expiry(), used: n.now, freq: (prev?.freq ?? 0) + 1 });
  }

  function lookup(k: number): Entry | undefined {
    const e = entries.get(k);
    if (!e) return undefined;
    if (e.expires <= n.now && !dirty.has(k)) {
      entries.delete(k);
      return undefined;
    }
    e.used = n.now;
    e.freq++;
    if (eviction === 'lru') {
      entries.delete(k);
      entries.set(k, e);
    }
    return e;
  }

  function hit(req: Req, k: number, e: Entry) {
    hits += req.msg.weight;
    const e2 = dbEdge('read');
    const truth = e2 && e.version !== PENDING ? ackedVersion(n.world, e2.to, k) : undefined;
    const stale = truth !== undefined && e.version < truth;
    if (stale) n.anomaly('stale-read', req.msg.weight);
    req.reply({ ok: true, value: e.value, version: e.version === PENDING ? undefined : e.version, stale });
  }

  function miss(req: Req, k: number) {
    misses += req.msg.weight;
    const e = dbEdge('read');
    if (!e) {
      set(k, undefined, 0);
      return req.reply({ ok: true });
    }
    if (coalescing) {
      const waiting = inflight.get(k);
      if (waiting) return void waiting.push(req);
      inflight.set(k, [req]);
    }
    n.call(e, n.world.child(req.msg, n.id, e.to), r => {
      if (r.ok && !dirty.has(k)) set(k, r.value, r.version ?? 0);
      if (coalescing) {
        const list = inflight.get(k) ?? [];
        inflight.delete(k);
        for (const q of list) q.reply(r);
      } else req.reply(r);
    });
  }

  function read(req: Req) {
    const k = keyOf(req.msg.key);
    const e = lookup(k);
    if (e) hit(req, k, e);
    else miss(req, k);
  }

  function write(req: Req) {
    const k = keyOf(req.msg.key);
    const value = req.msg.value ?? 0;
    if (strategy === 'write-behind') {
      const d = dirty.get(k);
      dirty.set(k, { value, w: (d?.w ?? 0) + req.msg.weight, traceId: req.msg.traceId ?? d?.traceId });
      set(k, value, PENDING);
      return req.reply({ ok: true });
    }
    const e = dbEdge('write');
    if (!e) {
      set(k, value, 0);
      return req.reply({ ok: true });
    }
    n.call(e, n.world.child(req.msg, n.id, e.to), (r: Reply) => {
      if (r.ok) {
        if (strategy === 'write-through' || invalidation === 'update') set(k, value, r.version ?? 0);
        else if (invalidation === 'delete-on-write') entries.delete(k);
      }
      req.reply(r);
    });
  }

  function flush() {
    const e = dbEdge('write');
    if (!e || !dirty.size) return;
    const batch = dirty;
    dirty = new Map();
    for (const [k, d] of batch) {
      const msg = n.world.newMsg({ from: n.id, to: e.to, op: 'write', key: k, value: d.value, weight: d.w, traceId: d.traceId });
      n.call(e, msg, r => {
        const cur = entries.get(k);
        if (!r.ok) {
          // retry on next flush unless overwritten meanwhile
          if (!dirty.has(k)) dirty.set(k, d);
          return;
        }
        if (cur && cur.version === PENDING && cur.value === d.value && !dirty.has(k)) cur.version = r.version ?? 0;
      });
    }
  }

  return {
    onStart() {
      n.every(1000, () => {
        const tot = hits + misses;
        if (tot) lastRatio = hits / tot;
        n.gauge('hitRatio', Math.round(lastRatio * 100));
        n.gauge('keys', entries.size);
        n.gauge('dirty', dirty.size);
        n.gauge('lostWrites', lostW);
        hits = 0;
        misses = 0;
      });
      if (strategy === 'write-behind') n.every(n.num('flushMs', 1000), flush);
    },
    onRequest(req) {
      n.process(req.msg.weight, n.serviceTime('p50Ms', 'p99Ms', 0.3, 1.5), ok => {
        if (!ok) return req.reply({ ok: false, err: '503' });
        if (req.msg.op === 'write') write(req);
        else read(req);
      });
    },
    onChaos(kind, _p, heal) {
      if (kind !== 'cache-flush') return false;
      if (!heal) {
        for (const k of [...entries.keys()]) if (!dirty.has(k)) entries.delete(k);
        n.log('info', `${n.name}: flushed`);
      }
      return true;
    },
    onKill() {
      let w = 0;
      for (const d of dirty.values()) w += d.w;
      if (w) {
        lostW += w;
        n.anomaly('lost-write', w);
        n.log('protocol', `${n.name}: crashed with ${dirty.size} unflushed keys — acknowledged writes lost`);
      }
      entries = new Map();
      dirty = new Map();
      inflight.clear();
    },
    view() {
      const tag = strategy === 'write-behind' ? 'behind' : strategy === 'write-through' ? 'through' : 'aside';
      return {
        badges: [
          { text: `hit ${Math.round(lastRatio * 100)}%`, tone: lastRatio > 0.8 ? 'ok' : lastRatio > 0.5 ? 'muted' : 'warn' },
          { text: `${eviction.toUpperCase()} ${entries.size}/${capacity()}`, tone: 'muted' },
          { text: tag, tone: 'protocol' },
          ...(dirty.size ? [{ text: `dirty ${dirty.size}`, tone: 'warn' as const }] : []),
        ],
      };
    },
  };
}

register('cache', cache);
