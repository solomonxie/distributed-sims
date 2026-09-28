// Cassandra internals: token ring with vnodes, every node a coordinator, RF + consistency levels,
// gossip failure detector, hinted handoff, read repair, LSM write path (commitlog → memtable → SSTable),
// size-tiered / leveled compaction, tombstones.
// Protocol kinds: cassandra.gossip (send), cassandra.mutation / cassandra.read / cassandra.hints (rpc), cassandra.repair (send).
import type { NodeLogic, Req, SimNode } from '../node';
import type { World } from '../world';
import type { Badge, Id, Msg } from '../types';
import { register } from './registry';
import { KEYS, KeyStore, Truth, keyOf, mix32, registerTruth, type Rec } from '../data/keystore';

// ---------- shared helpers (also used by tech-elasticsearch / tech-dynamodb) ----------

/** Nodes of one logical cluster share state: composite prefix + `cluster` knob. */
export function clusterKey(n: SimNode): string {
  const i = n.id.lastIndexOf('/');
  return `${i >= 0 ? n.id.slice(0, i) : ''}|${n.str('cluster', 'main')}`;
}

/** Per-world, per-cluster shared state. */
export function perCluster<T>(init: (n: SimNode) => T): (n: SimNode) => T {
  const worlds = new WeakMap<World, Map<string, T>>();
  return n => {
    let m = worlds.get(n.world);
    if (!m) worlds.set(n.world, (m = new Map()));
    const k = clusterKey(n);
    let v = m.get(k);
    if (v === undefined) m.set(k, (v = init(n)));
    return v;
  };
}

/** Same-cluster nodes of a type, in document order. */
export function members(n: SimNode, type: string): SimNode[] {
  const ck = clusterKey(n);
  return [...n.world.nodes.values()].filter(x => x.type === type && clusterKey(x) === ck);
}

export function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

/** Log at most once per `ms` per key (cluster-wide). */
export function throttledLog(logAt: Map<string, number>, n: SimNode, key: string, ms: number, kind: 'protocol' | 'info', text: string) {
  const last = logAt.get(key);
  if (last !== undefined && n.now - last < ms) return;
  logAt.set(key, n.now);
  n.log(kind, text);
}

/** Call `to` over an out edge when one exists (edge metrics + particles), else a protocol rpc. */
export function callNode(n: SimNode, to: Id, msg: Partial<Msg>, timeoutMs: number, cb: (r: import('../types').Reply) => void) {
  const e = n.outEdges().find(x => x.to === to);
  if (!e) return n.rpc(to, msg, timeoutMs, r => cb(r));
  let done = false;
  const fin = (r: import('../types').Reply) => {
    if (done) return;
    done = true;
    cb(r);
  };
  n.call(e, n.world.newMsg({ weight: 1, ...msg, from: n.id, to }), fin);
  n.timer(timeoutMs, () => fin({ ok: false, err: 'timeout' }));
}

// ---------- cluster state ----------

type CL = 'ONE' | 'TWO' | 'LOCAL_ONE' | 'QUORUM' | 'LOCAL_QUORUM' | 'EACH_QUORUM' | 'ALL';

interface Cluster {
  truth: Truth;
  seq: number;
  tracedW: number;
  tracedR: number;
  nodes: SimNode[];
  tokens: { t: number; id: Id }[];
  replicas: (Id[] | undefined)[];
  status: Map<string, 'UP' | 'DOWN'>;
  logAt: Map<string, number>;
}

const cluster = perCluster<Cluster>(n => ({
  truth: new Truth(),
  seq: 0,
  tracedW: 0,
  tracedR: 0,
  nodes: [],
  tokens: [],
  replicas: new Array(KEYS),
  status: new Map(),
  logAt: new Map(),
}));

const dcOf = (x: SimNode) => x.str('dc', 'dc1');

function ring(n: SimNode): Cluster {
  const c = cluster(n);
  if (c.nodes.length) return c;
  c.nodes = members(n, 'cassandra-node');
  for (const m of c.nodes) {
    const v = Math.max(1, Math.round(m.num('vnodes', 16)));
    for (let i = 0; i < v; i++) c.tokens.push({ t: mix32(hashStr(m.id) ^ mix32(i * 7919 + 1)), id: m.id });
  }
  c.tokens.sort((a, b) => a.t - b.t);
  return c;
}

export const keyToken = (k: number) => mix32((Math.imul(k + 1, 0x9e3779b1) >>> 0) ^ 0x5bd1e995);

/** NetworkTopologyStrategy: walk the ring clockwise from the key's token; RF distinct nodes per DC. */
function replicasOf(n: SimNode, k: number): Id[] {
  const c = ring(n);
  const cached = c.replicas[k];
  if (cached) return cached;
  const rf = Math.max(1, Math.round(c.nodes[0]?.num('replicationFactor', 3) ?? 3));
  const byId = new Map(c.nodes.map(x => [x.id, x]));
  const dcs = new Set(c.nodes.map(dcOf));
  const want = new Map([...dcs].map(d => [d, Math.min(rf, c.nodes.filter(x => dcOf(x) === d).length)]));
  const t = keyToken(k);
  let i = c.tokens.findIndex(x => x.t >= t);
  if (i < 0) i = 0;
  const out: Id[] = [];
  for (let j = 0; j < c.tokens.length && out.length < [...want.values()].reduce((a, b) => a + b, 0); j++) {
    const id = c.tokens[(i + j) % c.tokens.length].id;
    const d = dcOf(byId.get(id)!);
    if (out.includes(id) || (want.get(d) ?? 0) <= out.filter(x => dcOf(byId.get(x)!) === d).length) continue;
    out.push(id);
  }
  c.replicas[k] = out;
  return out;
}

/** Do the `acked` replicas satisfy the consistency level? */
function enough(n: SimNode, cl: CL, reps: Id[], acked: Id[], localDc: string): boolean {
  const dc = (id: Id) => dcOf(n.world.nodes.get(id)!);
  const q = (xs: Id[]) => Math.floor(xs.length / 2) + 1;
  const local = (xs: Id[]) => xs.filter(x => dc(x) === localDc);
  switch (cl) {
    case 'ONE':
      return acked.length >= 1;
    case 'TWO':
      return acked.length >= Math.min(2, reps.length);
    case 'LOCAL_ONE':
      return local(acked).length >= 1;
    case 'QUORUM':
      return acked.length >= q(reps);
    case 'LOCAL_QUORUM':
      return local(acked).length >= q(local(reps));
    case 'EACH_QUORUM':
      return [...new Set(reps.map(dc))].every(d => acked.filter(x => dc(x) === d).length >= q(reps.filter(x => dc(x) === d)));
    case 'ALL':
      return acked.length >= reps.length;
  }
}

const TOMBSTONE = -1;

// ---------- driver (client library: token-aware routing, CL per query) ----------

register('cassandra-driver', n => {
  let rr = 0;
  const targets = () => n.outEdges().filter(e => n.world.nodes.get(e.to)?.type === 'cassandra-node');
  return {
    onRequest(req: Req) {
      n.process(req.msg.weight, n.serviceTime('p50Ms', 'p99Ms', 0.2, 1), ok => {
        if (!ok) return req.reply({ ok: false, err: '503' });
        const localDc = n.str('localDc', '');
        const all = targets().filter(e => n.world.nodes.get(e.to)!.up);
        const local = localDc ? all.filter(e => dcOf(n.world.nodes.get(e.to)!) === localDc) : all;
        const pool = local.length ? local : all;
        if (!pool.length) return req.reply({ ok: false, err: 'unavailable' });
        const k = keyOf(req.msg.key);
        let e = pool[rr++ % pool.length];
        if (n.bool('tokenAware', true)) {
          const reps = replicasOf(n.world.nodes.get(pool[0].to)!, k);
          const owners = pool.filter(x => reps.includes(x.to));
          if (owners.length) e = owners[rr % owners.length];
        }
        const write = req.msg.op === 'write';
        const del = write && n.rng.chance(n.num('deletePct', 0) / 100);
        const msg = n.world.child(req.msg, n.id, e.to);
        msg.data = { cl: n.str(write ? 'writeCL' : 'readCL', write ? 'QUORUM' : 'ONE'), localDc: localDc || undefined, del };
        n.call(e, msg, r => req.reply(r));
      });
    },
    view() {
      return { badges: [{ text: `W ${n.str('writeCL', 'QUORUM')} · R ${n.str('readCL', 'ONE')}`, tone: 'protocol' }] as Badge[] };
    },
  };
});

// ---------- node: coordinator + replica + gossip + LSM storage ----------

interface Hint {
  rec: Rec;
  w: number;
  del: boolean;
}

register('cassandra-node', n => {
  const store = new KeyStore();
  const tomb = new Float64Array(KEYS);
  const tombAt = new Float64Array(KEYS);
  const hints = new Map<Id, Map<number, Hint>>();
  const view = new Map<Id, { hb: number; seen: number }>();
  const upView = new Map<Id, boolean>();
  const downSince = new Map<Id, number>();
  let hb = 0;
  let memtableMb = 0;
  let memtableRows = 0;
  let commitlog = 0;
  let sstables: number[] = [];
  let sstSeq = 0;
  let compactions = 0;
  let pendingMb = 0;
  let hintsReplayed = 0;
  let readRepairs = 0;
  let flushes = 0;
  const myDc = dcOf(n);
  const rowKb = () => n.num('rowKb', 1);
  const lcs = () => n.str('compaction', 'STCS') === 'LCS';
  const c = () => ring(n);

  const isUp = (id: Id) => id === n.id || upView.get(id) !== false;

  // ---- LSM storage ----
  const flush = () => {
    if (memtableMb <= 0) return;
    const size = memtableMb;
    sstables.push(size);
    sstSeq++;
    flushes++;
    throttledLog(c().logAt, n, `flush:${n.id}`, 3000, 'protocol', `${n.name}: memtable flushed → SSTable-${sstSeq} (${size.toFixed(1)} MB, ${memtableRows} rows); commitlog segment recycled`);
    memtableMb = 0;
    memtableRows = 0;
    commitlog = 0;
    maybeCompact();
  };

  const maybeCompact = () => {
    if (compactions >= Math.max(1, n.num('concurrentCompactors', 1))) return;
    let pick: number[] = [];
    const minT = Math.max(2, n.num('minThreshold', 4));
    if (lcs()) {
      // L0 → L1: every flush is merged into the level below (more IO, fewer SSTables per read)
      if (sstables.length >= 2) pick = sstables.map((_, i) => i);
    } else {
      // size-tiered: merge ≥ minThreshold SSTables of similar size
      const idx = sstables.map((s, i) => ({ s, i })).sort((a, b) => a.s - b.s);
      for (let a = 0; a < idx.length && !pick.length; a++) {
        const bucket = idx.filter(x => x.s >= idx[a].s * 0.5 && x.s <= idx[a].s * 1.5);
        if (bucket.length >= minT) pick = bucket.slice(0, 32).map(x => x.i);
      }
    }
    pendingMb = sstables.length >= minT ? sstables.reduce((a, b) => a + b, 0) : 0;
    if (!pick.length) return;
    const set = new Set(pick);
    const sizes = sstables.filter((_, i) => set.has(i));
    sstables = sstables.filter((_, i) => !set.has(i));
    const mb = sizes.reduce((a, b) => a + b, 0) * (lcs() ? 3 : 1);
    const ms = (mb / Math.max(0.1, n.num('compactionMbps', 16))) * 1000;
    compactions++;
    throttledLog(c().logAt, n, `compact:${n.id}`, 3000, 'protocol', `${n.name}: compacting ${sizes.length} SSTables (${mb.toFixed(0)} MB, ~${(ms / 1000).toFixed(1)}s)`);
    n.timer(ms, () => {
      compactions--;
      const merged = sizes.reduce((a, b) => a + b, 0) * 0.9;
      sstables.push(merged);
      // tombstones older than gc_grace_seconds are purged by compaction
      const grace = n.num('gcGraceSec', 864000) * 1000;
      for (let k = 0; k < KEYS; k++) if (tomb[k] && n.now - tombAt[k] > grace) tomb[k] = 0;
      maybeCompact();
    });
  };

  const readCostMs = (k: number) => {
    const perSst = n.num('sstableReadMs', 0.4) * (lcs() ? 0.25 : 0.6);
    let ms = n.serviceTime('p50Ms', 'p99Ms', 0.5, 3) + perSst * Math.max(1, sstables.length) + tomb[k] * n.num('tombstoneScanMs', 0.005);
    if (compactions) ms *= n.num('compactionReadX', 2);
    return ms;
  };

  // ---- replica side ----
  const applyWrite = (k: number, rec: Rec, w: number, del: boolean) => {
    commitlog += w;
    store.put(k, rec);
    if (del) {
      tomb[k] += w;
      tombAt[k] = n.now;
    }
    memtableMb += (w * rowKb()) / 1024;
    memtableRows += w;
    if (memtableMb >= n.num('memtableMb', 2)) flush();
  };

  const replicaWrite = (req: Req) => {
    const d = req.msg.data;
    if (n.mods.diskFull) return req.reply({ ok: false, err: '5xx' });
    n.process(req.msg.weight, n.serviceTime('writeP50Ms', 'writeP99Ms', 0.3, 2), ok => {
      if (!ok) return req.reply({ ok: false, err: '503' });
      applyWrite(d.k, d.rec, req.msg.weight, !!d.del);
      if (d.trace) n.log('protocol', `${n.name}: commitlog append → memtable (key ${d.k})`);
      req.reply({ ok: true });
    });
  };

  const replicaRead = (req: Req) => {
    const k: number = req.msg.data.k;
    const scanned = tomb[k];
    if (scanned > n.num('tombstoneFail', 100000)) {
      throttledLog(c().logAt, n, `tombfail:${n.id}`, 3000, 'info', `${n.name}: TombstoneOverwhelmingException — read of key ${k} scanned ${Math.round(scanned)} tombstones`);
      return n.process(req.msg.weight, n.num('tombstoneFail', 100000) * n.num('tombstoneScanMs', 0.005), () => req.reply({ ok: false, err: '5xx' }));
    }
    if (scanned > n.num('tombstoneWarn', 1000))
      throttledLog(c().logAt, n, 'tombwarn', 5000, 'info', `${n.name}: read of key ${k} scanned ${Math.round(scanned)} tombstones (warn threshold ${n.num('tombstoneWarn', 1000)})`);
    n.process(req.msg.weight, readCostMs(k), ok => {
      if (!ok) return req.reply({ ok: false, err: '503' });
      const r = store.get(k);
      req.reply({ ok: true, version: r?.version ?? 0, value: r?.value });
    });
  };

  // ---- hints ----
  const hintCount = () => [...hints.values()].reduce((a, m) => a + m.size, 0);
  const storeHint = (peer: Id, k: number, h: Hint) => {
    if (!n.bool('hintedHandoff', true)) return;
    const since = downSince.get(peer) ?? n.now;
    const win = n.num('hintWindowSec', 10800) * 1000;
    if (n.now - since > win) {
      throttledLog(c().logAt, n, `window:${peer}`, 30000, 'protocol', `${n.world.nodeName(peer)} down longer than max_hint_window (${win / 1000}s): coordinators stop storing hints — later writes need read repair or nodetool repair`);
      return;
    }
    let m = hints.get(peer);
    if (!m) hints.set(peer, (m = new Map()));
    const prev = m.get(k);
    m.set(k, { ...h, w: h.w + (prev?.w ?? 0) });
  };
  const replayHints = (peer: Id) => {
    const m = hints.get(peer);
    if (!m?.size) return;
    hints.delete(peer);
    const recs = [...m.entries()].map(([k, h]) => ({ k, ...h }));
    hintsReplayed += recs.length;
    n.log('protocol', `hinted handoff: ${n.name} replays ${recs.length} hints to ${n.world.nodeName(peer)}`);
    n.rpc(peer, { kind: 'cassandra.hints', data: { count: recs.length, recs } }, 5000, r => {
      if (!r.ok) for (const h of recs) storeHint(peer, h.k, h);
    });
  };

  // ---- gossip + failure detector ----
  const evaluate = () => {
    const conv = n.num('convictMs', 5000);
    for (const p of c().nodes) {
      if (p.id === n.id) continue;
      const v = view.get(p.id);
      const up = !!v && n.now - v.seen < conv;
      if (upView.get(p.id) === up) continue;
      upView.set(p.id, up);
      const st = c().status;
      const sk = `${myDc}>${p.id}`;
      if (!up) {
        downSince.set(p.id, n.now);
        if (st.get(sk) !== 'DOWN') {
          st.set(sk, 'DOWN');
          n.log('protocol', `gossip: ${n.name} marks ${p.name} DOWN (no heartbeat for ${(conv / 1000).toFixed(0)}s)`);
        }
      } else {
        downSince.delete(p.id);
        if (st.get(sk) === 'DOWN') {
          st.set(sk, 'UP');
          n.log('protocol', `gossip: ${p.name} is UP again`);
        }
        replayHints(p.id);
      }
    }
  };
  const gossip = () => {
    hb++;
    const peers = c().nodes.filter(p => p.id !== n.id);
    if (!peers.length) return;
    // [endpoint, heartbeat, time it was generated]: second-hand news never looks fresher than it is
    const state: [Id, number, number][] = [[n.id, hb, n.now], ...[...view.entries()].map(([id, v]) => [id, v.hb, v.seen] as [Id, number, number])];
    // gossip to live peers; now and then probe one we think is down
    const live = peers.filter(p => isUp(p.id));
    const down = peers.filter(p => !isUp(p.id));
    const fanout = Math.min(live.length, Math.max(1, n.num('gossipFanout', 2)));
    const chosen = new Set<SimNode>();
    const sameDc = live.filter(p => dcOf(p) === myDc);
    if (sameDc.length) chosen.add(n.rng.pick(sameDc));
    while (chosen.size < fanout) chosen.add(n.rng.pick(live));
    if (down.length && n.rng.chance(0.5)) chosen.add(n.rng.pick(down));
    for (const p of chosen) n.send(p.id, { kind: 'cassandra.gossip', data: { hb: state } });
    evaluate();
  };

  // ---- coordinator ----
  const coordinate = (req: Req) => {
    const k = keyOf(req.msg.key);
    const d = req.msg.data ?? {};
    const cl = (d.cl ?? 'ONE') as CL;
    const localDc: string = d.localDc ?? myDc;
    const reps = replicasOf(n, k);
    const live = reps.filter(isUp);
    const cc = c();
    if (!enough(n, cl, reps, live, localDc)) {
      throttledLog(cc.logAt, n, `unavail:${cl}`, 3000, 'protocol', `${n.name}: UnavailableException — CL ${cl} needs more replicas than the ${live.length}/${reps.length} it sees alive`);
      return req.reply({ ok: false, err: 'unavailable' });
    }
    if (req.msg.op === 'write') coordWrite(req, k, cl, localDc, reps, live, !!d.del);
    else coordRead(req, k, cl, localDc, reps, live);
  };

  const coordWrite = (req: Req, k: number, cl: CL, localDc: string, reps: Id[], live: Id[], del: boolean) => {
    const cc = c();
    const w = req.msg.weight;
    const version = ++cc.seq;
    const rec: Rec = { value: del ? TOMBSTONE : req.msg.value ?? 0, version, writer: n.id, ts: n.now };
    const trace = req.msg.traceId !== undefined && cc.tracedW < 3;
    if (trace) {
      cc.tracedW++;
      n.log('protocol', `${n.name} coordinates ${del ? 'DELETE' : 'write'} of key ${k} at CL ${cl} → replicas ${reps.map(x => n.world.nodeName(x)).join(', ')}`);
    }
    const acked: Id[] = [];
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      if (!ok) return req.reply({ ok: false, err: 'timeout' });
      cc.truth.ack(k, version, w);
      if (trace) n.log('protocol', `${n.name}: ${acked.length}/${reps.length} replicas acked → CL ${cl} met, success to client`);
      req.reply({ ok: true, version, value: rec.value });
    };
    const timeout = n.num('writeTimeoutMs', 1000);
    for (const r of reps) {
      const h: Hint = { rec, w, del };
      if (!live.includes(r)) {
        storeHint(r, k, h);
        continue;
      }
      n.rpc(r, { kind: 'cassandra.mutation', weight: w, data: { k, rec, del, trace } }, timeout, res => {
        if (!res.ok) return storeHint(r, k, h);
        acked.push(r);
        if (enough(n, cl, reps, acked, localDc)) finish(true);
      });
    }
    n.timer(timeout, () => finish(false));
  };

  const coordRead = (req: Req, k: number, cl: CL, localDc: string, reps: Id[], live: Id[]) => {
    const cc = c();
    const w = req.msg.weight;
    const dcNode = (id: Id) => dcOf(n.world.nodes.get(id)!);
    // dynamic snitch: self, then local DC, then least busy
    const order = [...live].sort((a, b) => {
      const s = (id: Id) => (id === n.id ? 0 : 1) + (dcNode(id) === localDc ? 0 : 10) + (n.world.nodes.get(id)!.queuedW > 0 ? 1 : 0);
      return s(a) - s(b);
    });
    const localOnly = cl === 'LOCAL_ONE' || cl === 'LOCAL_QUORUM';
    const pool = localOnly ? order.filter(x => dcNode(x) === localDc) : order;
    const chosen: Id[] = [];
    for (const r of pool) {
      if (enough(n, cl, reps, chosen, localDc)) break;
      chosen.push(r);
    }
    const trace = req.msg.traceId !== undefined && cc.tracedR < 3;
    if (trace) {
      cc.tracedR++;
      n.log('protocol', `${n.name} coordinates read of key ${k} at CL ${cl} → asks ${chosen.map(x => n.world.nodeName(x)).join(', ')}`);
    }
    const answers = new Map<Id, { version: number; value?: number }>();
    let done = false;
    const asked = new Set<Id>();
    const finish = () => {
      if (done) return;
      done = true;
      let best: { version: number; value?: number } = { version: 0 };
      for (const a of answers.values()) if (a.version > best.version) best = a;
      const stale = [...answers.entries()].filter(([, a]) => a.version < best.version).map(([id]) => id);
      if (stale.length && best.version > 0) {
        const rec: Rec = { value: best.value ?? 0, version: best.version, writer: n.id, ts: n.now };
        readRepairs += stale.length;
        for (const id of stale) n.send(id, { kind: 'cassandra.repair', data: { k, rec } });
        throttledLog(cc.logAt, n, `rr:${n.id}`, 2000, 'protocol', `read repair: ${stale.map(x => n.world.nodeName(x)).join(', ')} had stale key ${k} (v${Math.max(0, ...stale.map(id => answers.get(id)!.version))} < v${best.version}) → fixed by ${n.name}`);
      }
      const isStale = cc.truth.checkRead(n, k, best.version, w);
      if (trace) n.log('protocol', `${n.name}: ${answers.size} replica(s) answered, newest v${best.version} returned`);
      req.reply({ ok: true, version: best.version, value: best.value === TOMBSTONE ? undefined : best.value, stale: isStale });
    };
    const ask = (r: Id) => {
      asked.add(r);
      n.rpc(r, { kind: 'cassandra.read', weight: w, data: { k } }, n.num('readTimeoutMs', 1000), res => {
        if (done || !res.ok) return;
        answers.set(r, { version: res.version ?? 0, value: res.value });
        if (enough(n, cl, reps, [...answers.keys()], localDc)) finish();
      });
    };
    for (const r of chosen) ask(r);
    // rapid read protection: ask one more replica if a chosen one is slow
    n.timer(n.num('speculativeRetryMs', 50), () => {
      if (done) return;
      const spare = pool.find(x => !asked.has(x));
      if (spare) ask(spare);
    });
    n.timer(n.num('readTimeoutMs', 1000), () => {
      if (done) return;
      done = true;
      req.reply({ ok: false, err: 'timeout' });
    });
  };

  const gauges = () => {
    n.gauge('sstables', sstables.length);
    n.gauge('compactions', compactions);
    n.gauge('pendingCompactionMb', Math.round(pendingMb));
    n.gauge('memtableMb', Math.round(memtableMb * 10) / 10);
    n.gauge('commitlogOps', commitlog);
    n.gauge('flushes', flushes);
    n.gauge('hints', hintCount());
    n.gauge('hintsReplayed', hintsReplayed);
    n.gauge('readRepairs', readRepairs);
    n.gauge('tombstones', Math.round(tomb.reduce((a, b) => Math.max(a, b), 0)));
    n.gauge('peersDown', [...upView.values()].filter(x => !x).length);
  };

  return {
    onStart() {
      const cc = ring(n);
      registerTruth(n.world, n.id, k => cc.truth.acked[keyOf(k)]);
      view.clear();
      upView.clear();
      downSince.clear();
      for (const p of cc.nodes) if (p.id !== n.id) view.set(p.id, { hb: 0, seen: n.now });
      if (commitlog > 0) {
        n.log('protocol', `${n.name}: commitlog replay — ${commitlog} mutations rebuilt into the memtable`);
      }
      n.every(n.num('gossipMs', 1000), gossip, 0.2);
      n.every(1000, gauges);
      gauges();
    },
    onRequest(req: Req) {
      switch (req.msg.kind) {
        case 'cassandra.mutation':
          return replicaWrite(req);
        case 'cassandra.read':
          return replicaRead(req);
        case 'cassandra.hints':
          for (const h of req.msg.data.recs as ({ k: number } & Hint)[]) applyWrite(h.k, h.rec, h.w, h.del);
          return req.reply({ ok: true });
        default:
          n.process(req.msg.weight, n.serviceTime('coordP50Ms', 'coordP99Ms', 0.1, 0.5), ok => (ok ? coordinate(req) : req.reply({ ok: false, err: '503' })));
      }
    },
    onMessage(m: Msg) {
      if (m.kind === 'cassandra.gossip') {
        for (const [id, h, t] of m.data.hb as [Id, number, number][]) {
          if (id === n.id) continue;
          const v = view.get(id);
          if (!v || h > v.hb) view.set(id, { hb: h, seen: Math.max(v?.seen ?? 0, t) });
        }
        evaluate();
      } else if (m.kind === 'cassandra.repair') {
        store.put(m.data.k, m.data.rec);
      }
    },
    onKill() {
      compactions = 0;
      n.gauge('compactions', 0);
    },
    view() {
      const badges: Badge[] = [{ text: `${Math.round(n.num('vnodes', 16))} vnodes`, tone: 'muted' }];
      if (c().nodes.some(x => dcOf(x) !== myDc)) badges.push({ text: myDc, tone: 'muted' });
      badges.push({ text: `SST ${sstables.length}`, tone: sstables.length > 12 ? 'warn' : 'muted' });
      if (compactions) badges.push({ text: 'compacting', tone: 'warn' });
      const hc = hintCount();
      if (hc) badges.push({ text: `hints ${hc}`, tone: 'protocol' });
      const down = [...upView.values()].filter(x => !x).length;
      if (down) badges.push({ text: `${down} peer${down > 1 ? 's' : ''} DN`, tone: 'fail' });
      const t = tomb.reduce((a, b) => Math.max(a, b), 0);
      if (t > n.num('tombstoneWarn', 1000)) badges.push({ text: `🪦 ${t >= 1000 ? (t / 1000).toFixed(0) + 'k' : Math.round(t)}`, tone: 'warn' });
      return { badges };
    },
  };
});

export {};
