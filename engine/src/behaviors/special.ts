// Special: third-party APIs, anti-corruption layer, CRDT counters.
import type { Msg } from '../types';
import type { NodeLogic, Req, SimNode } from '../node';
import { register } from './registry';
import { RateWindow } from './stores';

/** Third-party API: SLA latency, error budget, per-account quota (429). Outage = engine 'external-outage'. */
export function externalApi(n: SimNode): NodeLogic {
  const quota = new RateWindow();
  return {
    onRequest(req: Req) {
      const w = req.msg.weight;
      if (!quota.take(n.now, w, n.num('quotaRps', 100))) return req.reply({ ok: false, err: '429' });
      n.process(w, n.serviceTime('p50Ms', 'p99Ms', 200, 1200), ok => {
        if (!ok) return req.reply({ ok: false, err: '503' });
        if (n.rng.chance(1 - n.num('availabilityPct', 99.9) / 100)) return req.reply({ ok: false, err: '5xx' });
        req.reply({ ok: true });
      });
    },
  };
}

/** Translates between models, then passes through to downstream sync edges. */
export function antiCorruptionLayer(n: SimNode): NodeLogic {
  return {
    onRequest(req: Req) {
      n.process(req.msg.weight, n.serviceTime('p50Ms', 'p99Ms', 1, 5), ok => {
        if (!ok) return req.reply({ ok: false, err: '503' });
        if (n.rng.chance(n.num('mappingErrPct', 0) / 100)) return req.reply({ ok: false, err: '5xx' });
        n.forward(req, n.syncOut(req.msg.op), 'one');
      });
    },
  };
}

// ---------- CRDT counter ----------

type Vec = Record<string, number>;
interface Crdt {
  p: Vec;
  n: Vec;
}
const crdts = new WeakMap<SimNode, Crdt>();

const sum = (v: Vec) => Object.values(v).reduce((a, b) => a + b, 0);
export const crdtValue = (c: Crdt) => sum(c.p) - sum(c.n);

/** Element-wise max: commutative, associative, idempotent → replicas converge. */
export function mergeVec(into: Vec, from: Vec) {
  for (const k in from) into[k] = Math.max(into[k] ?? 0, from[k]);
}

function peers(n: SimNode): SimNode[] {
  const cluster = n.str('cluster', 'default');
  return [...n.world.nodes.values()].filter(x => x !== n && x.type === 'crdt-counter' && x.str('cluster', 'default') === cluster);
}

/**
 * G-/PN-counter replica. Writes increment the local slot (PN: some decrement);
 * anti-entropy pushes state to a random peer every antiEntropyMs; merge = max per slot.
 * Gauge 'divergence' = spread of values across replicas (god view); no conflicts ever.
 */
export function crdtCounter(n: SimNode): NodeLogic {
  const c: Crdt = { p: {}, n: {} };
  crdts.set(n, c);
  const divergence = () => {
    const vals = [n, ...peers(n)].map(x => crdts.get(x)).filter(Boolean).map(x => crdtValue(x!));
    return vals.length ? Math.max(...vals) - Math.min(...vals) : 0;
  };
  return {
    handles: kind => kind === 'crdt.merge',
    onStart() {
      n.every(
        n.num('antiEntropyMs', 500),
        () => {
          const ps = peers(n);
          if (ps.length) n.send(n.rng.pick(ps).id, { kind: 'crdt.merge', data: { p: { ...c.p }, n: { ...c.n } } });
          n.gauge('value', crdtValue(c));
          n.gauge('divergence', divergence());
        },
        0.2,
      );
    },
    onMessage(msg: Msg) {
      if (msg.kind !== 'crdt.merge' || !msg.data) return;
      mergeVec(c.p, msg.data.p);
      mergeVec(c.n, msg.data.n);
    },
    onRequest(req: Req) {
      const m = req.msg;
      n.process(m.weight, n.serviceTime('p50Ms', 'p99Ms', 0.5, 3), ok => {
        if (!ok) return req.reply({ ok: false, err: '503' });
        if (m.op === 'write') {
          const dec = n.str('counter', 'pn') === 'pn' && n.rng.chance(n.num('decrementPct', 20) / 100);
          const v = dec ? c.n : c.p;
          v[n.id] = (v[n.id] ?? 0) + m.weight;
        }
        req.reply({ ok: true, value: crdtValue(c) });
      });
    },
    view() {
      return { label: `= ${crdtValue(c)}` };
    },
  };
}

register('external-api', externalApi);
register('anti-corruption-layer', antiCorruptionLayer);
register('crdt-counter', crdtCounter);
