// Edge group: dns, cdn, waf, load-balancer, api-gateway, rate-limiter, service-mesh-sidecar.
import type { NodeLogic, Req, SimNode } from '../node';
import { pickWeighted } from '../node';
import type { EdgeRt, World } from '../world';
import { regionLatency } from '../world';
import type { Rng } from '../rng';
import { hashString } from '../rng';
import type { Badge, ErrKind, Msg, Reply } from '../types';
import { register } from './registry';

// ---------- shared helpers ----------

const fail = (err: ErrKind): Reply => ({ ok: false, err });
const RETRIABLE = new Set<string>(['5xx', '503', 'timeout', 'unavailable', 'refused']);

function typeOf(n: SimNode, id: string): string {
  return n.world.nodes.get(id)?.type ?? '';
}

/** Out-edge to a counter store (cache / kv) or marked route: 'store'. */
function isStoreEdge(n: SimNode, e: EdgeRt): boolean {
  if (e.cfg.route === 'store') return true;
  const t = n.world.nodes.get(e.to);
  return !!t && /cache|kv/.test(t.type);
}

function isIdpEdge(n: SimNode, e: EdgeRt): boolean {
  return /identity-provider|idp/.test(typeOf(n, e.to));
}

/** Per-second counters flushed into gauges. */
function meter(n: SimNode) {
  let cur: Record<string, number> = {};
  const keys = new Set<string>();
  const last: Record<string, number> = {};
  const total: Record<string, number> = {};
  return {
    last,
    total,
    add(k: string, w = 1) {
      cur[k] = (cur[k] ?? 0) + w;
      total[k] = (total[k] ?? 0) + w;
      keys.add(k);
    },
    start(extra?: () => void) {
      n.every(1000, () => {
        for (const k of keys) {
          last[k] = cur[k] ?? 0;
          n.gauge(k, last[k]);
        }
        cur = {};
        extra?.();
      });
    },
  };
}

/** Pick one sync out-edge (by ratio) and proxy the request; reply ok if none. */
function proxy(n: SimNode, req: Req, edges: EdgeRt[], after?: (r: Reply) => void) {
  const done = after ?? ((r: Reply) => req.reply(r));
  const e = pickWeighted(edges, n.rng);
  if (!e) return done({ ok: true });
  n.call(e, n.world.child(req.msg, n.id, e.to), r => {
    if (r.ok) n.publish(req);
    done(r);
  });
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

// ---------- rate limiting core ----------

export type RlAlgo = 'token-bucket' | 'leaky-bucket' | 'fixed-window' | 'sliding-window-log' | 'sliding-window-counter';

interface RlState {
  tokens: number;
  level: number;
  last: number;
  win: number;
  count: number;
  prev: number;
  log: [number, number][];
  logSum: number;
}

/** Keyed rate limiter. `limit` requests per `windowMs`; `burst` = bucket size. */
export class Limiter {
  private states = new Map<string, RlState>();
  constructor(
    readonly algo: RlAlgo,
    readonly limit: number,
    readonly windowMs: number,
    readonly burst: number,
  ) {}

  private state(key: string, now: number): RlState {
    let s = this.states.get(key);
    if (!s) {
      s = { tokens: this.burst, level: 0, last: now, win: Math.floor(now / this.windowMs), count: 0, prev: 0, log: [], logSum: 0 };
      this.states.set(key, s);
    }
    return s;
  }

  /** Room left for `key` right now (after refills / window rolls). */
  private room(s: RlState, now: number): number {
    const rate = this.limit / this.windowMs;
    const win = Math.floor(now / this.windowMs);
    switch (this.algo) {
      case 'token-bucket':
        s.tokens = Math.min(this.burst, s.tokens + (now - s.last) * rate);
        s.last = now;
        return s.tokens;
      case 'leaky-bucket':
        s.level = Math.max(0, s.level - (now - s.last) * rate);
        s.last = now;
        return this.burst - s.level;
      case 'fixed-window':
        if (win !== s.win) {
          s.win = win;
          s.count = 0;
        }
        return this.limit - s.count;
      case 'sliding-window-log': {
        const cut = now - this.windowMs;
        let i = 0;
        while (i < s.log.length && s.log[i][0] <= cut) s.logSum -= s.log[i++][1];
        if (i) s.log.splice(0, i);
        return this.limit - s.logSum;
      }
      case 'sliding-window-counter': {
        if (win === s.win + 1) {
          s.prev = s.count;
          s.count = 0;
        } else if (win > s.win + 1) {
          s.prev = 0;
          s.count = 0;
        }
        s.win = win;
        const frac = (now % this.windowMs) / this.windowMs;
        return this.limit - (s.prev * (1 - frac) + s.count);
      }
    }
  }

  private consume(s: RlState, x: number, now: number) {
    switch (this.algo) {
      case 'token-bucket':
        s.tokens -= x;
        break;
      case 'leaky-bucket':
        s.level += x;
        break;
      case 'fixed-window':
      case 'sliding-window-counter':
        s.count += x;
        break;
      case 'sliding-window-log':
        s.log.push([now, x]);
        s.logSum += x;
        break;
    }
  }

  /**
   * Admit a particle of weight w. Partial room admits with probability room/w
   * (expected admitted weight = room). delayMs > 0 for leaky-bucket queueing.
   */
  admit(key: string, w: number, now: number, rng: Rng): { ok: boolean; delayMs: number } {
    const s = this.state(key, now);
    const room = Math.max(0, this.room(s, now));
    const before = s.level;
    let ok: boolean;
    if (room >= w) {
      this.consume(s, w, now);
      ok = true;
    } else {
      ok = room > 0 && rng.chance(room / w);
      if (room > 0) this.consume(s, room, now);
    }
    const delayMs = ok && this.algo === 'leaky-bucket' ? before / (this.limit / this.windowMs) : 0;
    return { ok, delayMs };
  }
}

function scopeKey(scope: string, m: Msg): string {
  if (scope === 'per-tenant') return 't:' + (m.tenant ?? '-');
  if (scope === 'per-key') return 'k:' + (m.key ?? 0);
  return 'g';
}

// Shared limiters live "in" the store node: one per (world, store, config).
const sharedLimiters = new WeakMap<World, Map<string, Limiter>>();
function sharedLimiter(w: World, storeId: string, algo: RlAlgo, limit: number, windowMs: number, burst: number): Limiter {
  let m = sharedLimiters.get(w);
  if (!m) sharedLimiters.set(w, (m = new Map()));
  const k = [storeId, algo, limit, windowMs, burst].join('|');
  let l = m.get(k);
  if (!l) m.set(k, (l = new Limiter(algo, limit, windowMs, burst)));
  return l;
}

const ALGO_SHORT: Record<string, string> = {
  'token-bucket': 'token',
  'leaky-bucket': 'leaky',
  'fixed-window': 'fixed win',
  'sliding-window-log': 'slide log',
  'sliding-window-counter': 'slide ctr',
  'round-robin': 'RR',
  'least-conn': 'least-conn',
  p2c: 'P2C',
  hash: 'hash',
  weighted: 'weighted',
  random: 'random',
  failover: 'failover',
};

// ---------- rate-limiter ----------

export function rateLimiter(n: SimNode): NodeLogic {
  const algo = n.str<RlAlgo>('algorithm', 'token-bucket');
  const limit = n.num('limit', 100);
  const windowMs = n.num('windowMs', 1000);
  const burst = n.num('burst', limit);
  const scope = n.str<string>('scope', 'global');
  const store = n.str<string>('store', 'local');
  const failOpen = n.bool('failOpen', true);
  const k = Math.max(1, n.instances);
  const locals = Array.from({ length: k }, () => new Limiter(algo, limit, windowMs, burst));
  const m = meter(n);

  const storeEdge = () => n.syncOut().find(e => isStoreEdge(n, e));
  const downstream = (req: Req) => n.syncOut(req.msg.op).filter(e => !isStoreEdge(n, e));

  const decide = (req: Req, d: { ok: boolean; delayMs: number }) => {
    const w = req.msg.weight;
    if (!d.ok) {
      m.add('rejected', w);
      return req.reply(fail('429'));
    }
    m.add('allowed', w);
    const go = () => proxy(n, req, downstream(req));
    if (d.delayMs > 0.01) n.timer(d.delayMs, go);
    else go();
  };

  return {
    onStart() {
      m.start();
    },
    onRequest(req) {
      n.process(req.msg.weight, n.serviceTime('p50Ms', 'p99Ms', 0.2, 1), ok => {
        if (!ok) return req.reply(fail('503'));
        const key = scopeKey(scope, req.msg);
        const se = store === 'shared' ? storeEdge() : undefined;
        if (!se) return decide(req, locals[n.rng.int(k)].admit(key, req.msg.weight, n.now, n.rng));
        // counter check (INCR) is atomic in the store; the decision waits for the round-trip
        const d = sharedLimiter(n.world, se.to, algo, limit, windowMs, burst).admit(key, req.msg.weight, n.now, n.rng);
        const check = n.world.child(req.msg, n.id, se.to);
        check.op = 'write';
        check.key = hashString(key) % 1024;
        n.call(se, check, r => {
          if (!r.ok && !failOpen) return req.reply(fail('503'));
          if (!r.ok) m.add('failOpen', req.msg.weight);
          decide(req, r.ok ? d : { ok: true, delayMs: 0 });
        });
      });
    },
    view() {
      const shared = store === 'shared' && !!storeEdge();
      const badges: Badge[] = [
        { text: `${ALGO_SHORT[algo] ?? algo} ${limit}/${windowMs >= 1000 ? windowMs / 1000 + 's' : windowMs + 'ms'}`, tone: 'accent' },
        { text: shared ? 'shared' : k > 1 ? `local ×${k}` : 'local', tone: !shared && k > 1 ? 'warn' : 'muted' },
      ];
      if (store === 'shared' && !shared) badges.push({ text: 'no store', tone: 'fail' });
      if (m.last.rejected) badges.push({ text: `429 ${Math.round(m.last.rejected)}/s`, tone: 'warn' });
      return { badges };
    },
  };
}

// ---------- load balancing core ----------

export type LbAlgo = 'round-robin' | 'least-conn' | 'p2c' | 'hash' | 'weighted' | 'random' | 'failover';

/** Target picker with in-flight tracking; shared by LB, sidecar. */
export function balancer(n: SimNode, algo: LbAlgo) {
  const inflight = new Map<string, number>();
  let rr = 0;
  const swrr = new Map<string, number>();
  let ring: { ids: string; points: [number, EdgeRt][] } = { ids: '', points: [] };
  const load = (e: EdgeRt) => inflight.get(e.id) ?? 0;

  const minBy = (list: EdgeRt[]) => {
    let best: EdgeRt[] = [];
    let bv = Infinity;
    for (const e of list) {
      const v = load(e);
      if (v < bv) (bv = v), (best = [e]);
      else if (v === bv) best.push(e);
    }
    return n.rng.pick(best);
  };

  const hashPick = (list: EdgeRt[], key: string) => {
    const ids = list.map(e => e.id).join(',');
    if (ring.ids !== ids) {
      const points: [number, EdgeRt][] = [];
      for (const e of list) for (let v = 0; v < 64; v++) points.push([hashString(e.id + '#' + v), e]);
      points.sort((a, b) => a[0] - b[0]);
      ring = { ids, points };
    }
    const h = hashString(key);
    const p = ring.points.find(x => x[0] >= h) ?? ring.points[0];
    return p[1];
  };

  return {
    inflight,
    load,
    pick(list: EdgeRt[], m: Msg): EdgeRt | undefined {
      if (!list.length) return undefined;
      if (list.length === 1) return list[0];
      switch (algo) {
        case 'round-robin':
          return list[rr++ % list.length];
        case 'least-conn':
          return minBy(list);
        case 'p2c': {
          const a = n.rng.int(list.length);
          let b = n.rng.int(list.length - 1);
          if (b >= a) b++;
          return minBy([list[a], list[b]]);
        }
        case 'hash':
          return hashPick(list, String(m.key ?? m.tenant ?? m.from));
        case 'weighted': {
          // nginx smooth weighted round-robin; weight = edge ratio
          let total = 0;
          let best: EdgeRt | undefined;
          for (const e of list) {
            const wt = e.cfg.ratio ?? 1;
            total += wt;
            const cw = (swrr.get(e.id) ?? 0) + wt;
            swrr.set(e.id, cw);
            if (!best || cw > swrr.get(best.id)!) best = e;
          }
          swrr.set(best!.id, swrr.get(best!.id)! - total);
          return best;
        }
        case 'failover':
          return list[0];
        default:
          return n.rng.pick(list);
      }
    },
    begin(e: EdgeRt, w: number) {
      inflight.set(e.id, load(e) + w);
    },
    end(e: EdgeRt, w: number) {
      inflight.set(e.id, Math.max(0, load(e) - w));
    },
  };
}

interface TargetHealth {
  healthy: boolean;
  fails: number;
  oks: number;
  consecErr: number;
  ejectedUntil: number;
}

/** Target reachability as a health probe would see it. */
function probe(n: SimNode, to: string): boolean {
  const t = n.world.nodes.get(to);
  return !!t && t.up && !n.world.blocked(n.id, to) && !n.world.blocked(to, n.id) && t.now >= t.mods.pausedUntil && t.mods.errRate < 0.5;
}

/** Active health checks (every interval; unhealthy/healthy thresholds). */
function healthChecker(n: SimNode, targets: () => EdgeRt[], intervalKey: string, dInterval: number, dUnhealthy: number, dHealthy: number) {
  const h = new Map<string, TargetHealth>();
  const get = (e: EdgeRt) => {
    let s = h.get(e.id);
    if (!s) h.set(e.id, (s = { healthy: true, fails: 0, oks: 0, consecErr: 0, ejectedUntil: 0 }));
    return s;
  };
  const unhealthyAfter = n.num('unhealthyThreshold', dUnhealthy);
  const healthyAfter = n.num('healthyThreshold', dHealthy);
  return {
    get,
    healthy: (e: EdgeRt) => get(e).healthy && get(e).ejectedUntil <= n.now,
    start() {
      n.every(n.num(intervalKey, dInterval), () => {
        for (const e of targets()) {
          const s = get(e);
          if (probe(n, e.to)) {
            s.fails = 0;
            if (!s.healthy && ++s.oks >= healthyAfter) {
              s.healthy = true;
              n.log('protocol', `${n.name}: ${n.world.nodeName(e.to)} healthy`);
            }
          } else {
            s.oks = 0;
            if (s.healthy && ++s.fails >= unhealthyAfter) {
              s.healthy = false;
              n.log('protocol', `${n.name}: ${n.world.nodeName(e.to)} marked unhealthy`);
            }
          }
        }
      });
    },
  };
}

// ---------- load-balancer ----------

export function loadBalancer(n: SimNode): NodeLogic {
  const algo = n.str<LbAlgo>('algorithm', 'round-robin');
  const layer = n.str<string>('layer', 'L7');
  const checks = n.bool('healthChecks', true);
  const sticky = n.bool('sticky', false);
  const bal = balancer(n, algo);
  const targets = (op?: Msg['op']) => n.syncOut(op);
  const hc = healthChecker(n, () => targets(), 'healthIntervalMs', 5000, 2, 2);
  const stick = new Map<string, string>();
  const m = meter(n);

  const candidates = (msg: Msg) => {
    let list = targets(msg.op);
    if (layer === 'L7' && msg.route) {
      const routed = list.filter(e => e.cfg.route === msg.route);
      if (routed.length) list = routed;
    }
    return checks ? list.filter(e => hc.healthy(e)) : list;
  };

  return {
    onStart() {
      m.start(() => {
        const all = targets();
        n.gauge('healthy', all.filter(e => !checks || hc.healthy(e)).length);
        n.gauge('targets', all.length);
      });
      if (checks) hc.start();
    },
    onRequest(req) {
      const w = req.msg.weight;
      n.process(w, n.serviceTime('p50Ms', 'p99Ms', layer === 'L4' ? 0.05 : 0.5, layer === 'L4' ? 0.3 : 3), ok => {
        if (!ok) return req.reply(fail('503'));
        const list = candidates(req.msg);
        let e: EdgeRt | undefined;
        const sk = sticky ? String(req.msg.tenant ?? req.msg.key ?? req.msg.from) : '';
        if (sticky) e = list.find(x => x.id === stick.get(sk));
        e ??= bal.pick(list, req.msg);
        if (!e) {
          m.add('noTarget', w);
          return req.reply(fail('503'));
        }
        if (sticky) stick.set(sk, e.id);
        const edge = e;
        bal.begin(edge, w);
        n.call(edge, n.world.child(req.msg, n.id, edge.to), r => {
          bal.end(edge, w);
          req.reply(r);
        });
      });
    },
    view() {
      const all = targets();
      const up = checks ? all.filter(e => hc.healthy(e)).length : all.length;
      const badges: Badge[] = [
        { text: `${layer} ${ALGO_SHORT[algo] ?? algo}`, tone: 'accent' },
        { text: `${up}/${all.length} healthy`, tone: up < all.length ? 'warn' : 'ok' },
      ];
      if (sticky) badges.push({ text: 'sticky', tone: 'muted' });
      return { badges };
    },
  };
}

// ---------- dns ----------

export function dns(n: SimNode): NodeLogic {
  const ttlMs = n.num('ttlSec', 60) * 1000;
  const routing = n.str<string>('routing', 'simple');
  const checks = n.bool('healthChecks', true);
  const serveStale = n.bool('serveStale', false);
  const targets = () => n.syncOut();
  const hc = healthChecker(n, targets, 'healthIntervalMs', 10000, 3, 3);
  // resolver caches keyed by caller region: answer = candidate edge ids
  const cache = new Map<string, { ids: string[]; exp: number }>();
  let failing = false;
  const m = meter(n);

  const regionOf = (id: string) => n.world.placement.get(id)?.region;
  const callerKey = (from: string) => regionOf(from) ?? 'global';

  const resolve = (from: string): EdgeRt[] => {
    const all = targets();
    const healthy = checks ? all.filter(e => hc.healthy(e)) : all;
    const pool = healthy.length ? healthy : all; // all unhealthy → answer everything
    if (!pool.length) return [];
    switch (routing) {
      case 'failover':
        return [pool[0]];
      case 'geo': {
        const r = regionOf(from);
        const same = r ? pool.filter(e => regionOf(e.to) === r) : [];
        if (same.length) return same;
        if (!r) return pool;
        const dist = (e: EdgeRt) => (regionOf(e.to) ? regionLatency(r, regionOf(e.to)!) : 1000);
        const best = Math.min(...pool.map(dist));
        return pool.filter(e => dist(e) === best);
      }
      case 'latency': {
        const lat = (e: EdgeRt) => n.world.placementLatency(from, e.to) + (e.series.last()?.p50 ?? 0);
        const best = pool.reduce((a, b) => (lat(b) < lat(a) ? b : a));
        return [best];
      }
      default:
        return pool;
    }
  };

  const connect = (req: Req, ids: string[]) => {
    const edges = targets().filter(e => ids.includes(e.id));
    proxy(n, req, edges);
  };

  return {
    onStart() {
      m.start(() => {
        const t = (m.last.hit ?? 0) + (m.last.miss ?? 0);
        n.gauge('cacheHitRatio', t ? (m.last.hit ?? 0) / t : 0);
      });
      if (checks) hc.start();
    },
    onRequest(req) {
      const key = callerKey(req.msg.from);
      const c = cache.get(key);
      if (c && c.exp > n.now) {
        m.add('hit', req.msg.weight);
        return connect(req, c.ids);
      }
      m.add('miss', req.msg.weight);
      if (failing) {
        if (serveStale && c) return connect(req, c.ids);
        m.add('servfail', req.msg.weight);
        return req.reply(fail('unavailable'));
      }
      n.process(req.msg.weight, n.serviceTime('p50Ms', 'p99Ms', 20, 80), ok => {
        if (!ok) return req.reply(fail('503'));
        const ids = resolve(req.msg.from).map(e => e.id);
        if (!ids.length) return req.reply(fail('unavailable'));
        const prev = cache.get(key);
        if (prev && prev.ids.join() !== ids.join()) n.log('protocol', `${n.name}: ${key} now resolves to ${ids.map(id => n.world.nodeName(n.world.edges.get(id)!.to)).join(', ')}`);
        cache.set(key, { ids, exp: n.now + ttlMs });
        connect(req, ids);
      });
    },
    onChaos(kind, _p, heal) {
      if (kind !== 'dns-failure') return false;
      failing = !heal;
      return true;
    },
    view() {
      const badges: Badge[] = [
        { text: routing, tone: 'accent' },
        { text: `TTL ${ttlMs / 1000}s`, tone: 'muted' },
      ];
      if (failing) badges.push({ text: 'SERVFAIL', tone: 'fail' });
      const down = checks ? targets().filter(e => !hc.healthy(e)).length : 0;
      if (down) badges.push({ text: `${down} unhealthy`, tone: 'warn' });
      return { badges };
    },
  };
}

// ---------- cdn ----------

export function cdn(n: SimNode): NodeLogic {
  const cacheable = n.num('cacheablePct', 90) / 100;
  const ttlMs = n.num('ttlSec', 300) * 1000;
  const pops = Math.max(1, Math.round(n.num('pops', 4)));
  const shield = n.bool('originShield', false);
  const shieldMs = n.num('shieldMs', 15);
  const popCache = Array.from({ length: pops }, () => new Map<number, number>());
  const shieldCache = new Map<number, number>();
  const pending = new Map<number, ((r: Reply) => void)[]>();
  const m = meter(n);

  const fresh = (c: Map<number, number>, k: number) => (c.get(k) ?? 0) > n.now;
  const origins = (req: Req) => n.syncOut(req.msg.op);

  const toOrigin = (req: Req, after: (r: Reply) => void) => {
    m.add('origin', req.msg.weight);
    proxy(n, req, origins(req), after);
  };

  const flush = () => {
    for (const c of popCache) c.clear();
    shieldCache.clear();
  };

  return {
    onStart() {
      // production CDNs run warm: prefill with staggered expiries
      if (n.bool('warmStart', true)) for (const c of popCache) for (let k = 0; k < 1024; k++) c.set(k, n.now + n.rng.next() * ttlMs);
      m.start(() => {
        const hit = m.last.hit ?? 0;
        const total = hit + (m.last.miss ?? 0) + (m.last.pass ?? 0);
        n.gauge('hitRatio', total ? hit / total : 0);
      });
    },
    onRequest(req) {
      const msg = req.msg;
      const w = msg.weight;
      n.process(w, n.serviceTime('p50Ms', 'p99Ms', 1, 5), ok => {
        if (!ok) return req.reply(fail('503'));
        if (msg.op === 'write' || !n.rng.chance(cacheable)) {
          m.add('pass', w);
          return toOrigin(req, r => req.reply(r));
        }
        const key = msg.key ?? 0;
        const pop = popCache[n.rng.int(pops)];
        if (fresh(pop, key)) {
          m.add('hit', w);
          return req.reply({ ok: true });
        }
        m.add('miss', w);
        const fill = (r: Reply) => {
          if (r.ok) pop.set(key, n.now + ttlMs);
          req.reply(r);
        };
        if (!shield) return toOrigin(req, fill);
        if (fresh(shieldCache, key)) {
          m.add('shieldHit', w);
          return n.timer(shieldMs, () => fill({ ok: true }));
        }
        // shield collapses concurrent misses for a key into one origin fetch
        const waiting = pending.get(key);
        if (waiting) return void waiting.push(fill);
        pending.set(key, [fill]);
        n.timer(shieldMs, () =>
          toOrigin(req, r => {
            if (r.ok) shieldCache.set(key, n.now + ttlMs);
            const cbs = pending.get(key) ?? [];
            pending.delete(key);
            for (const cb of cbs) cb(r);
          }),
        );
      });
    },
    onChaos(kind, _p, heal) {
      if (kind !== 'cache-flush' && kind !== 'purge') return false;
      if (!heal) flush();
      return true;
    },
    onKill() {
      flush();
      pending.clear();
    },
    view() {
      const hit = m.last.hit ?? 0;
      const total = hit + (m.last.miss ?? 0) + (m.last.pass ?? 0);
      const badges: Badge[] = [{ text: `hit ${total ? pct(hit / total) : '—'}`, tone: 'accent' }];
      if (shield) badges.push({ text: 'shield', tone: 'muted' });
      return { badges };
    },
  };
}

// ---------- waf ----------

export function waf(n: SimNode): NodeLogic {
  const rules = n.num('rules', 50);
  const ruleCostUs = n.num('ruleCostUs', 5);
  const blockRate = n.num('blockPct', 1) / 100;
  const botBlockRate = n.num('botBlockPct', 90) / 100;
  const m = meter(n);
  return {
    onStart() {
      m.start();
    },
    onRequest(req) {
      const w = req.msg.weight;
      const cost = n.serviceTime('p50Ms', 'p99Ms', 0.3, 1.5) + (rules * ruleCostUs) / 1000;
      n.process(w, cost, ok => {
        if (!ok) return req.reply(fail('503'));
        const bot = typeOf(n, req.msg.from) === 'bot';
        if (n.rng.chance(blockRate) || (bot && n.rng.chance(botBlockRate))) {
          m.add('blocked', w);
          return req.reply(fail('auth'));
        }
        m.add('allowed', w);
        proxy(n, req, n.syncOut(req.msg.op));
      });
    },
    view() {
      return { badges: [{ text: `${rules} rules`, tone: 'accent' }, ...(m.last.blocked ? [{ text: `403 ${Math.round(m.last.blocked)}/s`, tone: 'warn' as const }] : [])] };
    },
  };
}

// ---------- api-gateway ----------

export function apiGateway(n: SimNode): NodeLogic {
  const authCheck = n.bool('authCheck', true);
  const rlRps = n.num('rateLimitRps', 0);
  const limiter = rlRps > 0 ? new Limiter('token-bucket', rlRps, 1000, n.num('rateLimitBurst', 0) || rlRps) : undefined;
  const timeoutMs = n.num('timeoutMs', 29000);
  const m = meter(n);
  const idp = () => n.syncOut().find(e => isIdpEdge(n, e));
  const backends = (msg: Msg) => n.syncOut(msg.op).filter(e => !isIdpEdge(n, e) && !isStoreEdge(n, e));

  const route = (req: Req) => {
    const all = backends(req.msg);
    let list: EdgeRt[];
    if (req.msg.route) {
      list = all.filter(e => e.cfg.route === req.msg.route);
      if (!list.length) return req.reply(fail('refused'));
    } else {
      const plain = all.filter(e => !e.cfg.route);
      list = plain.length ? plain : all;
    }
    let done = false;
    const t = n.timer(timeoutMs, () => {
      if (done) return;
      done = true;
      m.add('timeout', req.msg.weight);
      req.reply(fail('timeout'));
    });
    proxy(n, req, list, r => {
      if (done) return;
      done = true;
      t.cancelled = true;
      req.reply(r);
    });
  };

  return {
    onStart() {
      m.start();
    },
    onRequest(req) {
      const w = req.msg.weight;
      n.process(w, n.serviceTime('p50Ms', 'p99Ms', 2, 10), ok => {
        if (!ok) return req.reply(fail('503'));
        if (limiter && !limiter.admit('g', w, n.now, n.rng).ok) {
          m.add('throttled', w);
          return req.reply(fail('429'));
        }
        if (authCheck && (req.msg.auth === 'expired' || req.msg.auth === 'none')) {
          const e = idp();
          if (!e) {
            m.add('authRejected', w);
            return req.reply(fail('auth'));
          }
          // token refresh / introspection against the IdP
          return n.call(e, n.world.child(req.msg, n.id, e.to), r => {
            if (!r.ok) {
              m.add('authRejected', w);
              return req.reply(r.err === 'auth' ? r : fail('auth'));
            }
            route(req);
          });
        }
        route(req);
      });
    },
    view() {
      const badges: Badge[] = [];
      const routes = new Set(backends({} as Msg).map(e => e.cfg.route).filter(Boolean));
      if (routes.size) badges.push({ text: `${routes.size} routes`, tone: 'accent' });
      if (limiter) badges.push({ text: `${rlRps} rps`, tone: 'muted' });
      if (authCheck) badges.push({ text: idp() ? 'auth+IdP' : 'auth', tone: 'muted' });
      if (n.instances <= 1) badges.push({ text: 'SPOF', tone: 'warn' });
      return { badges };
    },
  };
}

// ---------- service-mesh-sidecar ----------

export function sidecar(n: SimNode): NodeLogic {
  const mtls = n.bool('mtls', true);
  const mtlsCostMs = n.num('mtlsCostMs', 0.05);
  const handshakeMs = n.num('handshakeMs', 2);
  const connReuse = n.num('connReusePct', 99) / 100;
  const retries = n.num('retries', 2);
  const consec5xx = n.num('consecutive5xx', 5);
  const ejectMs = n.num('baseEjectionMs', 30000);
  const maxEjectPct = n.num('maxEjectionPct', 50);
  const maxRequests = n.num('maxRequests', 1024);
  const bal = balancer(n, n.str<LbAlgo>('algorithm', 'round-robin'));
  const ejected = new Map<string, { until: number; count: number; consec: number }>();
  let inflight = 0;
  const m = meter(n);

  const state = (e: EdgeRt) => {
    let s = ejected.get(e.id);
    if (!s) ejected.set(e.id, (s = { until: 0, count: 0, consec: 0 }));
    return s;
  };
  const live = (list: EdgeRt[]) => {
    const ok = list.filter(e => state(e).until <= n.now);
    const maxOut = Math.floor((list.length * maxEjectPct) / 100);
    if (list.length - ok.length <= maxOut) return ok.length ? ok : list;
    return list; // ejection cap exceeded: panic mode, use all
  };
  const record = (e: EdgeRt, r: Reply) => {
    const s = state(e);
    if (r.ok || !RETRIABLE.has(r.err ?? '5xx')) {
      s.consec = 0;
      return;
    }
    if (++s.consec >= consec5xx && s.until <= n.now) {
      s.count++;
      s.until = n.now + ejectMs * s.count;
      s.consec = 0;
      m.add('ejections');
      n.log('protocol', `${n.name}: ejected ${n.world.nodeName(e.to)} for ${(ejectMs * s.count) / 1000}s`);
    }
  };

  const attempt = (req: Req, i: number, tried: Set<string>) => {
    const all = live(n.syncOut(req.msg.op));
    if (!all.length) {
      inflight -= req.msg.weight;
      return req.reply({ ok: true });
    }
    const fresh = all.filter(e => !tried.has(e.id));
    const e = bal.pick(fresh.length ? fresh : all, req.msg)!;
    tried.add(e.id);
    const w = req.msg.weight;
    bal.begin(e, w);
    n.call(e, n.world.child(req.msg, n.id, e.to), r => {
      bal.end(e, w);
      record(e, r);
      if (!r.ok && RETRIABLE.has(r.err ?? '5xx') && i < retries) {
        m.add('retries', w);
        return attempt(req, i + 1, tried);
      }
      if (r.ok) n.publish(req);
      inflight -= w;
      req.reply(r);
    });
  };

  return {
    onStart() {
      m.start(() => n.gauge('inflight', inflight));
    },
    onRequest(req) {
      const w = req.msg.weight;
      let cost = n.serviceTime('p50Ms', 'p99Ms', 0.3, 1.5);
      if (mtls) cost += mtlsCostMs + (n.rng.chance(1 - connReuse) ? handshakeMs : 0);
      n.process(w, cost, ok => {
        if (!ok) return req.reply(fail('503'));
        if (inflight + w > maxRequests) {
          m.add('overflow', w);
          return req.reply(fail('503'));
        }
        inflight += w;
        attempt(req, 0, new Set());
      });
    },
    onKill() {
      inflight = 0;
    },
    view() {
      const out = [...ejected.values()].filter(s => s.until > n.now).length;
      const badges: Badge[] = [];
      if (mtls) badges.push({ text: 'mTLS', tone: 'protocol' });
      if (retries) badges.push({ text: `retry ×${retries}`, tone: 'muted' });
      if (out) badges.push({ text: `${out} ejected`, tone: 'warn' });
      return { badges };
    },
  };
}

// ---------- nat-gateway ----------

/**
 * Source NAT: every outbound connection holds one source port per destination.
 * Callers with keepAlive:false open a connection per request and the port stays
 * held portHoldSec after close; pooled callers hold ports only while in use.
 */
export function natGateway(n: SimNode): NodeLogic {
  const used = new Map<string, number>();
  const m = meter(n);
  let lastLog = -Infinity;
  const ports = () => Math.max(1, Math.round(n.num('portsPerDest', 55000)));
  const peak = () => Math.max(0, ...used.values());
  const pooled = (from: string) => (n.world.out.get(from) ?? []).find(e => e.to === n.id)?.cfg.keepAlive !== false;
  return {
    onStart() {
      m.start(() => n.gauge('portsUsed', Math.round(peak())));
    },
    onKill() {
      used.clear();
    },
    onRequest(req) {
      const w = req.msg.weight;
      n.process(w, n.serviceTime('p50Ms', 'p99Ms', 0.1, 0.5), ok => {
        if (!ok) return req.reply(fail('503'));
        const e = pickWeighted(n.syncOut(req.msg.op), n.rng);
        if (!e) return req.reply({ ok: true });
        const dest = e.to;
        if ((used.get(dest) ?? 0) + w > ports()) {
          m.add('portErrors', w);
          if (n.now - lastLog > 3000) {
            lastLog = n.now;
            n.log('info', `${n.name}: ErrorPortAllocation, all ${ports()} ports to ${n.world.nodeName(dest)} in use`);
          }
          return req.reply(fail('refused'));
        }
        used.set(dest, (used.get(dest) ?? 0) + w);
        const release = () => used.set(dest, Math.max(0, (used.get(dest) ?? 0) - w));
        const reuse = pooled(req.msg.from);
        n.call(e, n.world.child(req.msg, n.id, dest), r => {
          if (reuse) release();
          else n.timer(n.num('portHoldSec', 60) * 1000, release);
          req.reply(r);
        });
      });
    },
    view() {
      const p = peak();
      const tone = p >= ports() ? 'fail' : p > ports() * 0.8 ? 'warn' : 'muted';
      const k = (x: number) => (x >= 1000 ? `${Math.round(x / 1000)}k` : `${Math.round(x)}`);
      return { badges: [{ text: `ports ${k(p)}/${k(ports())}`, tone }] };
    },
  };
}

register('nat-gateway', natGateway);
register('vpn-gateway', loadBalancer);
register('dns', dns);
register('cdn', cdn);
register('waf', waf);
register('load-balancer', loadBalancer);
register('api-gateway', apiGateway);
register('rate-limiter', rateLimiter);
register('service-mesh-sidecar', sidecar);
