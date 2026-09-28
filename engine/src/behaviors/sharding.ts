// Sharding: 'shard-router' routes msg.key to one of its out-edges (each edge = a shard).
import { register } from './registry';
import type { NodeLogic, Req, SimNode } from '../node';
import type { Reply } from '../types';
import type { EdgeRt } from '../world';
import { KEYS, ackedVersion, keyOf, mix32, registerTruth } from '../data/keystore';
import { hashString } from '../rng';

export type ShardMap = 'hash' | 'range' | 'consistent-hash' | 'directory';

export interface Ring {
  points: number[];
  owners: number[];
}

/** Consistent-hash ring: `vnodes` points per shard, shard ids stable by index. */
export function buildRing(shards: number, vnodes: number): Ring {
  const pts: { p: number; s: number }[] = [];
  for (let s = 0; s < shards; s++) for (let v = 0; v < vnodes; v++) pts.push({ p: hashString(`shard-${s}#${v}`), s });
  pts.sort((a, b) => a.p - b.p);
  return { points: pts.map(x => x.p), owners: pts.map(x => x.s) };
}

export function ringOwner(ring: Ring, k: number): number {
  const h = mix32(k + 0x9e37);
  let lo = 0;
  let hi = ring.points.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ring.points[mid] < h) lo = mid + 1;
    else hi = mid;
  }
  return ring.owners[lo % ring.points.length];
}

/** Owner shard of key k under a map (directory falls back to range). */
export function ownerOf(kind: ShardMap, k: number, shards: number, ring?: Ring, keys = KEYS): number {
  if (shards <= 1) return 0;
  switch (kind) {
    case 'hash':
      return mix32(k + 1) % shards;
    case 'consistent-hash':
      return ringOwner(ring ?? buildRing(shards, 64), k);
    default:
      return Math.min(shards - 1, Math.floor((keyOf(k, keys) * shards) / keys));
  }
}

/** Fraction of keys whose owner changes when going from s to s+1 shards. */
export function movedFraction(kind: ShardMap, s: number, vnodes = 64, keys = KEYS): number {
  const a = buildRing(s, vnodes);
  const b = buildRing(s + 1, vnodes);
  let moved = 0;
  for (let k = 0; k < keys; k++) if (ownerOf(kind, k, s, a, keys) !== ownerOf(kind, k, s + 1, b, keys)) moved++;
  return moved / keys;
}

function shardRouter(n: SimNode): NodeLogic {
  const kind = n.str<ShardMap>('shardBy', 'hash');
  const vnodes = Math.max(1, Math.round(n.num('vnodes', 64)));
  const sequential = n.str('keyPattern', 'as-is') === 'sequential';
  let shards: EdgeRt[] = [];
  let active = 0;
  let ring: Ring = { points: [], owners: [] };
  // directory overrides (rebalance moves / directory map); -1 = use map
  const dir = new Int16Array(KEYS).fill(-1);
  const dualUntil = new Float64Array(KEYS);
  const prevOwner = new Int16Array(KEYS).fill(-1);
  let counts: number[] = [];
  let movedKeys = 0;
  let rebalancing = false;

  const mapOwner = (k: number) => ownerOf(kind, k, active, ring);
  const owner = (k: number) => (dir[k] >= 0 && dir[k] < active ? dir[k] : mapOwner(k));

  function setActive(s: number) {
    const before = Array.from({ length: KEYS }, (_, k) => owner(k));
    active = Math.max(1, Math.min(shards.length, s));
    ring = buildRing(active, vnodes);
    if (kind !== 'directory') dir.fill(-1);
    let moved = 0;
    for (let k = 0; k < KEYS; k++) if (before[k] !== owner(k)) moved++;
    return moved;
  }

  function call(req: Req, e: EdgeRt, cb: (r: Reply) => void) {
    n.call(e, n.world.child(req.msg, n.id, e.to), r => cb(r));
  }

  function scatter(req: Req) {
    const list = shards.slice(0, active);
    let left = list.length;
    let fail: Reply | undefined;
    for (const e of list)
      call(req, e, r => {
        if (!r.ok) fail ??= r;
        if (--left === 0) req.reply(fail ?? { ok: true });
      });
  }

  function route(req: Req) {
    const m = req.msg;
    if (sequential && m.op === 'write') {
      m.key = Math.floor((n.now / 1000) * n.num('insertKeysPerSec', 8)) % KEYS;
      m.data = { ...m.data, insert: true };
    }
    const k = keyOf(m.key);
    const s = owner(k);
    counts[s] = (counts[s] ?? 0) + m.weight;
    const e = shards[s];
    if (!e) return req.reply({ ok: false, err: 'unavailable' });
    const old = prevOwner[k];
    if (n.now < dualUntil[k] && old >= 0 && old !== s && shards[old]) {
      // dual-read/dual-write window: both shards, wait for both
      let left = 2;
      let res: Reply = { ok: true };
      const both = (r: Reply, primary: boolean) => {
        if (primary) res = r;
        if (--left === 0) req.reply(res);
      };
      call(req, e, r => both(r, true));
      call(req, shards[old], r => both(r, false));
      return;
    }
    call(req, e, r => req.reply(r));
  }

  function rebalance(sec: number) {
    if (active < 2) return;
    const total = counts.slice(0, active);
    const hot = total.indexOf(Math.max(...total.map(x => x ?? 0)));
    const cold = total.indexOf(Math.min(...total.map(x => x ?? 0)));
    const from = hot >= 0 ? hot : 0;
    const to = cold >= 0 && cold !== from ? cold : (from + 1) % active;
    const keys: number[] = [];
    for (let k = 0; k < KEYS; k++) if (owner(k) === from) keys.push(k);
    const moving = keys.slice(0, Math.ceil(keys.length / 2));
    const chunks = Math.max(1, Math.round(sec * 2));
    const per = Math.ceil(moving.length / chunks);
    const dual = n.num('dualReadMs', 2000);
    rebalancing = true;
    n.log('protocol', `${n.name}: moving ${moving.length} keys shard ${from + 1} → ${to + 1}`);
    for (let c = 0; c < chunks; c++) {
      n.timer(c * 500, () => {
        for (const k of moving.slice(c * per, (c + 1) * per)) {
          prevOwner[k] = owner(k);
          dir[k] = to;
          dualUntil[k] = n.now + dual;
          movedKeys++;
        }
        if (c === chunks - 1) n.timer(dual, () => (rebalancing = false));
      });
    }
  }

  return {
    onStart() {
      shards = n.syncOut();
      const want = Math.round(n.num('activeShards', 0));
      active = 0;
      setActive(want > 0 ? want : shards.length);
      // cost of the most recent shard add under this map
      movedKeys = active > 1 ? Math.round(movedFraction(kind, active - 1, vnodes) * KEYS) : 0;
      counts = new Array(shards.length).fill(0);
      registerTruth(n.world, n.id, k => {
        const e = shards[owner(keyOf(k))];
        return e ? ackedVersion(n.world, e.to, k) ?? 0 : 0;
      });
      n.every(1000, () => {
        const tot = counts.reduce((a, b) => a + b, 0);
        n.gauge('hotShardPct', tot ? Math.round((Math.max(...counts) / tot) * 100) : 0);
        n.gauge('movedKeys', movedKeys);
        n.gauge('shards', active);
        counts = new Array(shards.length).fill(0);
      });
    },
    onRequest(req) {
      n.process(req.msg.weight, n.serviceTime('p50Ms', 'p99Ms', 0.5, 3), ok => {
        if (!ok) return req.reply({ ok: false, err: '503' });
        const scan = req.msg.data?.query === 'scatter' || req.msg.data?.op === 'scan';
        if (scan || (req.msg.op !== 'write' && n.rng.chance(n.num('scatterPct', 0) / 100))) scatter(req);
        else route(req);
      });
    },
    onChaos(kindC, p, heal) {
      if (kindC === 'add-shard') {
        if (heal) return true;
        const moved = setActive(active + 1);
        movedKeys = moved;
        n.log('protocol', `${n.name}: shard added (${active}), ${moved} of ${KEYS} keys move`);
        return true;
      }
      if (kindC === 'rebalance') {
        if (!heal) rebalance(Number(p.sec ?? 5));
        return true;
      }
      return false;
    },
    view() {
      const label = kind === 'consistent-hash' ? 'ring' : kind;
      return {
        badges: [
          { text: `${label} ×${active}`, tone: 'protocol' },
          ...(rebalancing ? [{ text: 'rebalancing', tone: 'warn' as const }] : []),
        ],
      };
    },
  };
}

register('shard-router', shardRouter);
