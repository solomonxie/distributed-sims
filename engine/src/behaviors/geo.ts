// Geo: proximity index (geohash / quadtree / S2) and road routing engine.
import type { NodeLogic, Req, SimNode } from '../node';
import { register } from './registry';
import { Pool, hotShare } from './stores';

/** Approx geohash cell width (km) by precision 1..9. */
const GEOHASH_KM = [5000, 1250, 156, 39, 4.9, 1.2, 0.153, 0.038, 0.0048];

export interface NearbyCost {
  cells: number;
  items: number;
}

/** Cells touched and items scanned for one radius query. */
export function nearbyCost(mode: string, precision: number, radiusKm: number, density: number, leafCap = 64): NearbyCost {
  const inCircle = Math.PI * radiusKm * radiusKm * density;
  if (mode === 'quadtree') {
    // leaves adapt to density: ~leafCap items each, plus boundary leaves
    const cells = Math.ceil(inCircle / leafCap) + 4;
    return { cells, items: Math.max(inCircle * 1.3, cells * leafCap * 0.5) };
  }
  if (mode === 's2') {
    // region coverer: ~8 cells of mixed level hugging the circle
    return { cells: 8, items: inCircle * 1.5 };
  }
  const cellKm = GEOHASH_KM[Math.min(9, Math.max(1, Math.round(precision))) - 1];
  const side = Math.ceil((2 * radiusKm) / cellKm) + 1; // centre cell + neighbours
  const cells = side * side;
  return { cells, items: cells * cellKm * cellKm * density };
}

/** Radius search: cost ∝ cells touched + items scanned; keyspace split into shards, dense city = hot shard. */
export function geoIndex(n: SimNode): NodeLogic {
  const shardCount = () => Math.max(1, Math.round(n.num('shards', 4)));
  let pools: Pool[] = [];
  let hotPct = 0;
  let hotX = 1;
  const mkPools = () => {
    pools = Array.from({ length: shardCount() }, () => new Pool(n, () => Math.max(1, Math.floor(n.capacity / shardCount())), () => n.queueLimit / shardCount()));
  };
  return {
    onStart: mkPools,
    onRestart: mkPools,
    onRequest(req: Req) {
      const m = req.msg;
      const hot = hotPct > 0 && n.rng.chance(hotPct);
      const shard = hot ? 0 : (m.key ?? n.rng.int(1024)) % pools.length;
      const density = n.num('densityPerKm2', 50) * (hot ? hotX : 1);
      let ms: number;
      if (m.op === 'write') {
        // location update: re-bucket one point (quadtree may split a leaf)
        ms = n.serviceTime('writeP50Ms', 'writeP99Ms', 0.2, 1) * (n.str<string>('mode', 'geohash') === 'quadtree' ? 1.5 : 1);
      } else {
        const c = nearbyCost(n.str('mode', 'geohash'), n.num('precision', 6), n.num('radiusKm', 2), density);
        n.gauge('cellsTouched', c.cells);
        n.gauge('itemsScanned', Math.round(c.items));
        ms = (n.num('p50Ms', 0.5) + c.cells * n.num('msPerCell', 0.05) + (c.items * n.num('usPerItem', 2)) / 1000) * n.mods.slowX * n.rng.lognormal(1, 3);
      }
      pools[shard].run(m.weight, ms, ok => req.reply(ok ? { ok: true } : { ok: false, err: '503' }));
      if (shard === 0) n.gauge('hotShardUtil', Math.round(pools[0].util * 100));
    },
    onChaos(kind, p, heal) {
      if (kind !== 'hot-key' && kind !== 'hot-cell') return false;
      hotPct = heal ? 0 : hotShare(p, 0.5);
      hotX = heal ? 1 : Number(p.x ?? 20);
      return true;
    },
    onKill() {
      for (const p of pools) p.reset();
    },
    view() {
      return { badges: [{ text: `${n.str('mode', 'geohash')}${n.str('mode', 'geohash') === 'geohash' ? ':' + n.num('precision', 6) : ''}`, tone: 'muted' }] };
    },
  };
}

/** Nodes settled per route query. */
export function settledNodes(algo: string, graphNodes: number): number {
  if (algo === 'contraction-hierarchies' || algo === 'ch') return 50 * Math.log2(Math.max(2, graphNodes));
  if (algo === 'a-star') return graphNodes * 0.05;
  return graphNodes * 0.25; // dijkstra: explores a disc around the source
}

/** Route query cost by algorithm × graph size; CH needs re-preprocessing after a map update. */
export function routingEngine(n: SimNode): NodeLogic {
  let chReadyAt = 0;
  return {
    onRequest(req: Req) {
      const algo = n.str('algo', 'contraction-hierarchies');
      const effective = algo === 'contraction-hierarchies' && n.now < chReadyAt ? 'dijkstra' : algo;
      const settled = settledNodes(effective, n.num('graphNodes', 1_000_000));
      n.gauge('settled', Math.round(settled));
      const ms = n.serviceTime('p50Ms', 'p99Ms', 1, 5) + (settled * n.num('usPerNode', 0.2)) / 1000;
      n.process(req.msg.weight, ms, ok => req.reply(ok ? { ok: true } : { ok: false, err: '503' }));
    },
    onChaos(kind, _p, heal) {
      if (kind !== 'map-update') return false;
      if (!heal) {
        chReadyAt = n.now + (n.num('graphNodes', 1_000_000) / 1e6) * n.num('prepSecPerMillion', 30) * 1000;
        n.log('info', `${n.name} rebuilding contraction hierarchy`);
      }
      return true;
    },
    view() {
      return { badges: [{ text: n.now < chReadyAt ? 'CH rebuilding' : n.str('algo', 'contraction-hierarchies'), tone: n.now < chReadyAt ? 'warn' : 'muted' }] };
    },
  };
}

register('geo-index', geoIndex);
register('routing-engine', routingEngine);
