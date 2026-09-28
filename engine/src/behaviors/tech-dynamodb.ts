// DynamoDB internals: request router (auth, partition map, capacity, throttling, adaptive capacity,
// split for heat, on-demand ramp, transactions), storage nodes (partition leader + 2 AZ replicas),
// global secondary index (async propagation, own capacity, back-pressure). DAX is a `cache` skin.
// Protocol kinds: dynamo.get / dynamo.put / dynamo.prepare / dynamo.query (rpc), dynamo.gsi-put (send).
import type { NodeLogic, Req, SimNode } from '../node';
import type { Badge, Id, Msg } from '../types';
import { register } from './registry';
import { KEYS, KeyStore, Replica, Truth, keyOf, mix32, registerTruth, type Rec } from '../data/keystore';
import { callNode, members, perCluster, throttledLog } from './tech-cassandra';

interface Part {
  id: string;
  lo: number;
  hi: number;
  node: Id;
  r: number;
  w: number;
  keys: Map<number, number>;
  hotFor: number;
  stuck: boolean;
}

interface Copies {
  leader: KeyStore;
  reps: Replica[];
}

interface Table {
  init: boolean;
  parts: Part[];
  truth: Truth;
  seq: number;
  stores: Map<Id, Copies>;
  locks: Map<number, number>;
  gsiBacklog: number;
  logAt: Map<string, number>;
  traced: Record<string, number>;
  nextId: number;
}

const table = perCluster<Table>(() => ({
  init: false,
  parts: [],
  truth: new Truth(),
  seq: 0,
  stores: new Map(),
  locks: new Map(),
  gsiBacklog: 0,
  logAt: new Map(),
  traced: {},
  nextId: 0,
}));

const hashOf = (k: number) => mix32((Math.imul(keyOf(k) + 1, 0x9e3779b1) >>> 0) ^ 0x2545f491) / 2 ** 32;
const partOf = (t: Table, k: number) => {
  const h = hashOf(k);
  return t.parts.find(p => h >= p.lo && h < p.hi) ?? t.parts[t.parts.length - 1];
};
const traceOnce = (t: Table, kind: string, max = 2) => {
  const c = t.traced[kind] ?? 0;
  if (c >= max) return false;
  t.traced[kind] = c + 1;
  return true;
};

function copiesOf(t: Table, id: Id): Copies {
  let c = t.stores.get(id);
  if (!c) t.stores.set(id, (c = { leader: new KeyStore(), reps: [new Replica(), new Replica()] }));
  return c;
}

// ---------- request router ----------

register('dynamodb-router', n => {
  const mode = () => n.str<'provisioned' | 'on-demand'>('mode', 'provisioned');
  const partMaxR = () => n.num('partitionMaxRcu', 3000);
  const partMaxW = () => n.num('partitionMaxWcu', 1000);
  let peakR = n.num('peakRcu', 3000);
  let peakW = n.num('peakWcu', 1000);
  let usedR = 0;
  let usedW = 0;
  let demandR = 0;
  let demandW = 0;
  let bankR = 0;
  let bankW = 0;
  let throttled = 0;
  let conflicts = 0;
  let lastThrottled = 0;
  let lastConflicts = 0;

  const tableCap = (rw: 'r' | 'w') => {
    if (mode() === 'on-demand') return 2 * (rw === 'r' ? peakR : peakW);
    return rw === 'r' ? n.num('rcu', 3000) : n.num('wcu', 3000);
  };

  const init = (): Table => {
    const t = table(n);
    if (t.init) return t;
    t.init = true;
    const nodes = members(n, 'dynamodb-storage').map(x => x.id);
    const byTput = mode() === 'on-demand' ? (2 * peakR) / 3000 + (2 * peakW) / 1000 : n.num('rcu', 3000) / 3000 + n.num('wcu', 3000) / 1000;
    const P = Math.max(1, Math.round(n.num('minPartitions', 1)), Math.ceil(byTput), Math.ceil(n.num('sizeGb', 10) / 10));
    for (let i = 0; i < P; i++) t.parts.push({ id: `P${t.nextId++}`, lo: i / P, hi: (i + 1) / P, node: nodes[i % Math.max(1, nodes.length)], r: 0, w: 0, keys: new Map(), hotFor: 0, stuck: false });
    return t;
  };

  /** Token-bucket style admission for this second: partition hard limit, table capacity (+ adaptive / burst). */
  const admit = (t: Table, p: Part, rw: 'r' | 'w', units: number, k: number): boolean => {
    if (rw === 'r') demandR += units;
    else demandW += units;
    p.keys.set(k, (p.keys.get(k) ?? 0) + units * (rw === 'w' ? 3 : 1));
    const pUsed = rw === 'r' ? p.r : p.w;
    const pMax = rw === 'r' ? partMaxR() : partMaxW();
    const share = tableCap(rw) / t.parts.length;
    const pLimit = n.bool('adaptiveCapacity', true) || mode() === 'on-demand' ? pMax : Math.min(pMax, share);
    const tUsed = rw === 'r' ? usedR : usedW;
    const bank = rw === 'r' ? bankR : bankW;
    const tLimit = tableCap(rw) + (mode() === 'provisioned' ? bank : 0);
    if (pUsed + units > pLimit || tUsed + units > tLimit) {
      throttled += units;
      const why = pUsed + units > pLimit ? `partition ${p.id} at its ${pLimit} ${rw === 'r' ? 'RCU' : 'WCU'} limit` : `table at ${Math.round(tLimit)} ${rw === 'r' ? 'RCU' : 'WCU'}${mode() === 'on-demand' ? ' (2× previous peak)' : ''}`;
      throttledLog(t.logAt, n, `thr:${rw}:${why}`, 4000, 'protocol', `${n.name}: ${mode() === 'on-demand' ? 'ThrottlingException' : 'ProvisionedThroughputExceededException'} (429) — ${why}`);
      return false;
    }
    if (rw === 'r') {
      p.r += units;
      usedR += units;
    } else {
      p.w += units;
      usedW += units;
    }
    if (pUsed + units > share && n.bool('adaptiveCapacity', true) && mode() === 'provisioned') {
      throttledLog(t.logAt, n, `adaptive:${p.id}`, 30000, 'protocol', `adaptive capacity: hot partition ${p.id} borrows unused table throughput beyond its ${Math.round(share)}-unit share (up to ${pMax})`);
    }
    return true;
  };

  const second = () => {
    const t = init();
    // burst bank: up to 300s of unused provisioned capacity
    if (mode() === 'provisioned') {
      bankR = Math.min(300 * n.num('rcu', 3000), bankR + Math.max(0, n.num('rcu', 3000) - usedR));
      bankW = Math.min(300 * n.num('wcu', 3000), bankW + Math.max(0, n.num('wcu', 3000) - usedW));
      bankR = Math.max(0, bankR - Math.max(0, usedR - n.num('rcu', 3000)));
      bankW = Math.max(0, bankW - Math.max(0, usedW - n.num('wcu', 3000)));
      if (!n.bool('burstCapacity', true)) bankR = bankW = 0;
    } else {
      // on-demand: the "previous peak" ramps toward sustained demand, doubling at most every rampSec
      const g = Math.pow(2, 1 / Math.max(1, n.num('rampSec', 10)));
      const pr = peakR;
      const pw = peakW;
      if (demandR > peakR) peakR = Math.min(demandR, peakR * g);
      if (demandW > peakW) peakW = Math.min(demandW, peakW * g);
      if (peakW > pw * 1.3 || peakR > pr * 1.3 || (Math.floor(n.now / 5000) !== Math.floor((n.now - 1000) / 5000) && (demandW > 2 * pw || demandR > 2 * pr)))
        throttledLog(t.logAt, n, 'ramp', 5000, 'protocol', `on-demand scaling: previous peak now ${Math.round(peakW)} WCU / ${Math.round(peakR)} RCU → instant capacity ${Math.round(2 * peakW)} WCU`);
    }
    splitForHeat(t);
    n.gauge('throttled', Math.round(throttled - lastThrottled));
    n.gauge('conflicts', Math.round(conflicts - lastConflicts));
    lastThrottled = throttled;
    lastConflicts = conflicts;
    n.gauge('usedWcu', Math.round(usedW));
    n.gauge('usedRcu', Math.round(usedR));
    n.gauge('capWcu', Math.round(tableCap('w')));
    n.gauge('partitions', t.parts.length);
    n.gauge('hotPartitionWcu', Math.round(Math.max(0, ...t.parts.map(p => p.w))));
    n.gauge('gsiBacklog', Math.round(t.gsiBacklog));
    for (const p of t.parts) {
      p.r = 0;
      p.w = 0;
      p.keys.clear();
    }
    usedR = usedW = demandR = demandW = 0;
  };

  const splitForHeat = (t: Table) => {
    const need = n.num('splitSec', 10);
    for (const p of [...t.parts]) {
      const heat = Math.max(p.r / partMaxR(), p.w / partMaxW());
      const hot = heat >= 0.8;
      p.hotFor = hot ? p.hotFor + 1 : 0;
      if (!hot || p.hotFor < need || p.stuck) continue;
      const total = [...p.keys.values()].reduce((x, y) => x + y, 0);
      const ranked = [...p.keys.entries()].sort((x, y) => y[1] - x[1]);
      if (!ranked.length) continue;
      const [topKey, topUnits] = ranked[0];
      const h = hashOf(topKey);
      const others = ranked.slice(1).map(([k]) => hashOf(k));
      const below = others.filter(x => x < h);
      const above = others.filter(x => x > h).sort((x, y) => x - y);
      let mid: number;
      if (topUnits / total <= 0.5) mid = [...others, h].sort((x, y) => x - y)[Math.floor(others.length / 2)];
      else if (below.length) mid = h;
      else if (above.length) mid = (h + above[0]) / 2;
      else mid = NaN;
      // split so the hottest key ends up alone; one key can't be split further
      if (!(mid > p.lo && mid < p.hi)) {
        p.stuck = true;
        n.log('protocol', `split for heat can't help ${p.id}: it holds one partition key (#${topKey}) — a single key tops out at ${partMaxW()} WCU / ${partMaxR()} RCU`);
        continue;
      }
      const fleet = members(n, 'dynamodb-storage').map(x => x.id);
      const load = (id: Id) => t.parts.filter(x => x.node === id).length;
      const dest = [...fleet].sort((a, b) => load(a) - load(b))[0] ?? p.node;
      const a: Part = { ...p, id: `P${t.nextId++}`, hi: mid, keys: new Map(), hotFor: 0, stuck: false };
      const b: Part = { ...p, id: `P${t.nextId++}`, lo: mid, node: dest, keys: new Map(), hotFor: 0, stuck: false };
      // move the upper half's items to its new storage node
      const src = copiesOf(t, p.node);
      const dst = copiesOf(t, dest);
      if (dest !== p.node)
        for (let k = 0; k < KEYS; k++) {
          const hk = hashOf(k);
          if (hk < mid || hk >= p.hi) continue;
          const rec = src.leader.get(k);
          if (!rec) continue;
          dst.leader.put(k, rec);
          for (const r of dst.reps) r.store.put(k, rec);
        }
      t.parts.splice(t.parts.indexOf(p), 1, a, b);
      n.log('protocol', `split for heat: ${p.id} → ${a.id} (${n.world.nodeName(a.node)}) + ${b.id} (${n.world.nodeName(b.node)})`);
    }
  };

  const rcuOf = (w: number, consistent: boolean) => w * Math.ceil(n.num('itemKb', 1) / 4) * (consistent ? 1 : 0.5);
  const wcuOf = (w: number) => w * Math.ceil(n.num('itemKb', 1));

  const read = (req: Req, t: Table, k: number) => {
    const w = req.msg.weight;
    const gsis = members(n, 'dynamodb-gsi');
    if (gsis.length && n.rng.chance(n.num('gsiReadPct', 0) / 100)) {
      const g = gsis[0];
      if (traceOnce(t, 'gsi')) n.log('protocol', `${n.name}: Query on GSI '${g.name}' — always eventually consistent`);
      return callNode(n, g.id, { kind: 'dynamo.query', weight: w, data: { k } }, 1000, r => {
        if (!r.ok) return req.reply(r);
        const stale = t.truth.checkRead(n, k, r.version ?? 0, w);
        req.reply({ ok: true, version: r.version, value: r.value, stale });
      });
    }
    const consistent = n.rng.chance(n.num('strongReadPct', 0) / 100);
    const p = partOf(t, k);
    if (!admit(t, p, 'r', rcuOf(w, consistent), k)) return req.reply({ ok: false, err: '429' });
    const trace = req.msg.traceId !== undefined && traceOnce(t, 'get');
    if (trace) n.log('protocol', `${n.name}: GetItem key ${k} → partition ${p.id} on ${n.world.nodeName(p.node)}, ${consistent ? 'strongly consistent (leader, 1 RCU)' : 'eventually consistent (any replica, 0.5 RCU)'}`);
    callNode(n, p.node, { kind: 'dynamo.get', weight: w, data: { k, consistent, trace } }, 1000, r => {
      if (!r.ok) return req.reply(r);
      const stale = t.truth.checkRead(n, k, r.version ?? 0, w);
      req.reply({ ok: true, version: r.version, value: r.value, stale });
    });
  };

  const put = (t: Table, k: number, value: number, w: number, trace: boolean, cb: (r: import('../types').Reply) => void) => {
    const p = partOf(t, k);
    if (trace) n.log('protocol', `${n.name}: PutItem key ${k} — authenticated, hash → partition ${p.id} on ${n.world.nodeName(p.node)}`);
    callNode(n, p.node, { kind: 'dynamo.put', weight: w, data: { k, value, trace } }, 1000, r => {
      if (r.ok) t.truth.ack(k, r.version ?? 0, w);
      cb(r);
    });
  };

  const write = (req: Req, t: Table, k: number) => {
    const w = req.msg.weight;
    const gsiLimit = n.num('gsiBacklogLimit', 2000);
    if (members(n, 'dynamodb-gsi').length && t.gsiBacklog > gsiLimit) {
      throttled += w;
      throttledLog(t.logAt, n, 'gsi-bp', 4000, 'protocol', `${n.name}: base-table writes throttled (429) — GSI back-pressure: ${Math.round(t.gsiBacklog)} index updates waiting for GSI write capacity`);
      return req.reply({ ok: false, err: '429' });
    }
    if (n.rng.chance(n.num('txnPct', 0) / 100)) return transact(req, t, k);
    if ((t.locks.get(k) ?? 0) > n.now) {
      conflicts += w;
      throttledLog(t.logAt, n, 'txc', 4000, 'protocol', `${n.name}: TransactionConflictException — PutItem on key ${k} while a transaction holds it`);
      return req.reply({ ok: false, err: 'conflict' });
    }
    const p = partOf(t, k);
    if (!admit(t, p, 'w', wcuOf(w), k)) return req.reply({ ok: false, err: '429' });
    put(t, k, req.msg.value ?? 0, w, req.msg.traceId !== undefined && traceOnce(t, 'put'), r => req.reply(r));
  };

  /** TransactWriteItems on two items: prepare both (2× WCU), then commit; overlapping transactions cancel. */
  const transact = (req: Req, t: Table, k: number) => {
    const w = req.msg.weight;
    const k2 = keyOf(KEYS / 2 + n.rng.int(KEYS / 4));
    const items = k2 === k ? [k] : [k, k2];
    const busy = items.find(i => (t.locks.get(i) ?? 0) > n.now);
    if (busy !== undefined) {
      conflicts += w;
      throttledLog(t.logAt, n, 'txcancel', 3000, 'protocol', `${n.name}: TransactionCanceledException [TransactionConflict] — key ${busy} is in another transaction`);
      return req.reply({ ok: false, err: 'conflict' });
    }
    for (const i of items) if (!admit(t, partOf(t, i), 'w', 2 * wcuOf(w), i)) return req.reply({ ok: false, err: '429' });
    const hold = n.now + 1000;
    for (const i of items) t.locks.set(i, hold);
    const trace = req.msg.traceId !== undefined && traceOnce(t, 'txn');
    if (trace) n.log('protocol', `${n.name}: TransactWriteItems keys ${items.join(' + ')} — prepare on each partition leader`);
    let left = items.length;
    let ok = true;
    const unlock = () => {
      for (const i of items) if (t.locks.get(i) === hold) t.locks.delete(i);
    };
    for (const i of items)
      callNode(n, partOf(t, i).node, { kind: 'dynamo.prepare', weight: w, data: { k: i } }, 1000, r => {
        ok = ok && r.ok;
        if (--left) return;
        if (!ok) {
          unlock();
          return req.reply({ ok: false, err: 'conflict' });
        }
        let c = items.length;
        for (const j of items)
          put(t, j, req.msg.value ?? 0, w, false, () => {
            if (--c) return;
            unlock();
            if (trace) n.log('protocol', `${n.name}: transaction committed on both items`);
            req.reply({ ok: true });
          });
      });
  };

  return {
    onStart() {
      const t = init();
      registerTruth(n.world, n.id, k => t.truth.acked[keyOf(k)]);
      n.every(1000, second);
    },
    onRequest(req: Req) {
      n.process(req.msg.weight, n.serviceTime('p50Ms', 'p99Ms', 1, 4), ok => {
        if (!ok) return req.reply({ ok: false, err: '503' });
        const t = init();
        const k = keyOf(req.msg.key);
        if (req.msg.op === 'write') write(req, t, k);
        else read(req, t, k);
      });
    },
    view() {
      const t = init();
      const badges: Badge[] = [
        { text: mode() === 'on-demand' ? `on-demand ≤${Math.round(tableCap('w'))} WCU` : `${n.num('rcu', 3000)} RCU · ${n.num('wcu', 3000)} WCU`, tone: 'protocol' },
        { text: `${t.parts.length} partitions`, tone: 'muted' },
      ];
      if (n.gaugesNow.throttled) badges.push({ text: `429 × ${n.gaugesNow.throttled}/s`, tone: 'fail' });
      if (n.gaugesNow.conflicts) badges.push({ text: `txn conflicts ${n.gaugesNow.conflicts}/s`, tone: 'warn' });
      return { badges };
    },
  };
});

// ---------- storage node: partition leaders, each with 2 replicas in other AZs ----------

register('dynamodb-storage', n => {
  const lag = () => n.rng.lognormal(n.num('replicaLagMs', 2), n.num('replicaLagP99Ms', 20));
  return {
    onStart() {
      n.every(1000, () => {
        const t = table(n);
        const mine = t.parts.filter(p => p.node === n.id);
        n.gauge('partitions', mine.length);
        n.gauge('hotWcu', Math.round(Math.max(0, ...mine.map(p => p.w))));
      });
    },
    onRequest(req: Req) {
      const t = table(n);
      const c = copiesOf(t, n.id);
      const d = req.msg.data ?? {};
      const w = req.msg.weight;
      switch (req.msg.kind) {
        case 'dynamo.get':
          return n.process(w, n.serviceTime('p50Ms', 'p99Ms', 1.5, 6), ok => {
            if (!ok) return req.reply({ ok: false, err: '503' });
            let store = c.leader;
            if (!d.consistent) {
              const i = n.rng.int(3);
              if (i > 0) {
                c.reps[i - 1].catchUp(n.now);
                store = c.reps[i - 1].store;
              }
            }
            const rec = store.get(d.k);
            req.reply({ ok: true, version: rec?.version ?? 0, value: rec?.value });
          });
        case 'dynamo.prepare':
          return n.process(w, n.serviceTime('writeP50Ms', 'writeP99Ms', 3, 10), ok => req.reply(ok ? { ok: true } : { ok: false, err: '503' }));
        case 'dynamo.put':
          if (n.mods.diskFull) return req.reply({ ok: false, err: '5xx' });
          return n.process(w, n.serviceTime('writeP50Ms', 'writeP99Ms', 3, 10), ok => {
            if (!ok) return req.reply({ ok: false, err: '503' });
            const version = ++t.seq;
            const rec: Rec = { value: d.value ?? 0, version, writer: n.id, ts: n.now };
            c.leader.put(d.k, rec);
            const acks = c.reps.map(r => r.enqueue(d.k, rec, version, n.now, lag()) - n.now).sort((a, b) => a - b);
            if (d.trace) n.log('protocol', `${n.name}: leader of the partition logged key ${d.k}; replicating to 2 other AZs`);
            // durable on 2 of 3 AZ copies → ack
            n.timer(acks[0], () => {
              if (d.trace) n.log('protocol', `${n.name}: 2 of 3 copies durable → PutItem acknowledged`);
              req.reply({ ok: true, version, value: rec.value });
            });
            for (const g of members(n, 'dynamodb-gsi')) {
              t.gsiBacklog += w;
              n.send(g.id, { kind: 'dynamo.gsi-put', weight: w, data: { k: d.k, rec, trace: d.trace } });
            }
          });
      }
      req.reply({ ok: false, err: '5xx' });
    },
    view() {
      const t = table(n);
      const mine = t.parts.filter(p => p.node === n.id).map(p => p.id);
      return { badges: [{ text: mine.join(' ') || 'no partitions', tone: 'protocol' }] as Badge[] };
    },
  };
});

// ---------- global secondary index ----------

register('dynamodb-gsi', n => {
  const store = new KeyStore();
  let queue: { k: number; rec: Rec; w: number; at: number; trace?: boolean }[] = [];
  let backlog = 0;
  let lagMs = 0;
  const apply = () => {
    const t = table(n);
    let budget = (n.str('mode', 'provisioned') === 'on-demand' ? Infinity : n.num('wcu', 1000)) / 10;
    while (queue.length && budget >= queue[0].w) {
      const u = queue.shift()!;
      budget -= u.w;
      backlog -= u.w;
      t.gsiBacklog = Math.max(0, t.gsiBacklog - u.w);
      store.put(u.k, u.rec);
      if (u.trace) n.log('protocol', `${n.name}: index entry for key ${u.k} updated ${Math.round(n.now - u.at)} ms after the base write`);
    }
    lagMs = queue.length ? n.now - queue[0].at : 0;
  };
  return {
    onStart() {
      n.every(100, apply);
      n.every(1000, () => {
        n.gauge('backlog', Math.round(backlog));
        n.gauge('lagMs', Math.round(lagMs));
      });
    },
    onMessage(m: Msg) {
      if (m.kind !== 'dynamo.gsi-put') return;
      queue.push({ k: m.data.k, rec: m.data.rec, w: m.weight, at: n.now, trace: m.data.trace });
      backlog += m.weight;
    },
    onRequest(req: Req) {
      n.process(req.msg.weight, n.serviceTime('p50Ms', 'p99Ms', 2, 8), ok => {
        if (!ok) return req.reply({ ok: false, err: '503' });
        const rec = store.get(req.msg.data?.k ?? 0);
        req.reply({ ok: true, version: rec?.version ?? 0, value: rec?.value });
      });
    },
    onKill() {
      const t = table(n);
      t.gsiBacklog = Math.max(0, t.gsiBacklog - backlog);
      queue = [];
      backlog = 0;
    },
    view() {
      const badges: Badge[] = [{ text: n.str('mode', 'provisioned') === 'on-demand' ? 'on-demand' : `${n.num('wcu', 1000)} WCU`, tone: 'protocol' }];
      if (lagMs > 1000) badges.push({ text: `lag ${(lagMs / 1000).toFixed(1)}s`, tone: 'warn' });
      return { badges };
    },
  };
});

export {};
