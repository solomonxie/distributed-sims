// Elasticsearch internals: master-eligible nodes (cluster state, quorum election), data nodes holding
// primary/replica shards, coordinating node (query then fetch, reduce), refresh / translog / flush,
// shard allocation after node loss (green/yellow/red), peer recovery, dynamic mapping updates.
// Protocol kinds: es.follower-check, es.query, es.fetch, es.index, es.replicate, es.put-mapping (rpc);
// es.publish-state, es.start-recovery, es.recovery-chunk (send).
import type { NodeLogic, Req, SimNode } from '../node';
import type { Badge, Id, Msg } from '../types';
import { register } from './registry';
import { keyOf, mix32 } from '../data/keystore';
import { callNode, members, perCluster, throttledLog } from './tech-cassandra';

interface Copy {
  node: Id;
  primary: boolean;
  started: boolean;
}

type Status = 'green' | 'yellow' | 'red';

interface EsState {
  init: boolean;
  master?: Id;
  term: number;
  nodes: Id[];
  shards: Copy[][];
  replicas: number;
  delayUntil: number;
  fields: number;
  isolated: Set<Id>;
  fails: Map<Id, number>;
  logAt: Map<string, number>;
  traced: Record<string, number>;
  lastStatus: Status;
}

const esState = perCluster<EsState>(() => ({
  init: false,
  term: 0,
  nodes: [],
  shards: [],
  replicas: 1,
  delayUntil: 0,
  fields: 0,
  isolated: new Set(),
  fails: new Map(),
  logAt: new Map(),
  traced: {},
  lastStatus: 'green',
}));

/** Cluster state, created on first use from the data nodes' index settings. */
function state(n: SimNode): EsState {
  const st = esState(n);
  if (st.init) return st;
  st.init = true;
  const data = members(n, 'es-data');
  st.nodes = data.map(d => d.id);
  const cfg = data[0];
  const P = Math.max(1, Math.round(cfg?.num('shards', 3) ?? 3));
  st.replicas = Math.max(0, Math.min(data.length - 1, Math.round(cfg?.num('replicas', 1) ?? 1)));
  st.fields = Math.round(cfg?.num('initialFields', 40) ?? 40);
  const D = Math.max(1, data.length);
  for (let s = 0; s < P; s++) {
    const copies: Copy[] = [];
    if (data.length) {
      copies.push({ node: st.nodes[s % D], primary: true, started: true });
      for (let r = 1; r <= st.replicas; r++) copies.push({ node: st.nodes[(s + r) % D], primary: false, started: true });
    }
    st.shards.push(copies);
  }
  const masters = members(n, 'es-master');
  if (masters.length) {
    st.master = masters[0].id;
    st.term = 1;
  }
  return st;
}

function status(st: EsState): Status {
  let s: Status = 'green';
  for (const copies of st.shards) {
    if (!copies.some(c => c.primary && c.started)) return 'red';
    if (copies.filter(c => c.started).length < 1 + st.replicas) s = 'yellow';
  }
  return s;
}

/** First `max` traced units of a kind get logged step by step. */
function traceOnce(st: EsState, kind: string, max: number): boolean {
  const c = st.traced[kind] ?? 0;
  if (c >= max) return false;
  st.traced[kind] = c + 1;
  return true;
}

const statusBadge = (s: Status): Badge => ({ text: s, tone: s === 'green' ? 'ok' : s === 'yellow' ? 'warn' : 'fail' });
const shardOf = (st: EsState, k: number) => mix32(keyOf(k) + 17) % Math.max(1, st.shards.length);
const up = (n: SimNode, id: Id) => !!n.world.nodes.get(id)?.up;

function noteStatus(n: SimNode, st: EsState) {
  const s = status(st);
  if (s === st.lastStatus) return;
  st.lastStatus = s;
  n.log('protocol', `cluster health: ${s.toUpperCase()}${s === 'yellow' ? ' (all primaries assigned, some replicas missing)' : s === 'red' ? ' (a primary shard has no copy)' : ''}`);
}

// ---------- master-eligible node ----------

register('es-master', n => {
  const masters = () => members(n, 'es-master');
  const reach = (a: Id, b: Id) => {
    if (a === b) return true;
    const st = esState(n);
    return up(n, b) && !n.world.blocked(a, b) && !n.world.blocked(b, a) && !st.isolated.has(a) && !st.isolated.has(b);
  };
  const reachData = (id: Id) => up(n, id) && !n.world.blocked(n.id, id) && !n.world.blocked(id, n.id);

  const removeNode = (st: EsState, id: Id) => {
    st.nodes = st.nodes.filter(x => x !== id);
    st.fails.delete(id);
    n.log('protocol', `master ${n.name}: node ${n.world.nodeName(id)} left the cluster (${n.num('followerRetries', 3)} follower checks failed)`);
    st.shards.forEach((copies, s) => {
      const lost = copies.filter(c => c.node === id);
      if (!lost.length) return;
      st.shards[s] = copies.filter(c => c.node !== id);
      if (lost.some(c => c.primary)) {
        const rep = st.shards[s].find(c => c.started);
        if (rep) {
          rep.primary = true;
          n.log('protocol', `primary of shard [${s}] lost → replica on ${n.world.nodeName(rep.node)} promoted to primary`);
        } else n.log('protocol', `shard [${s}] has no copy left: RED`);
      }
    });
    st.delayUntil = n.now + n.num('delayedTimeoutSec', 5) * 1000;
    noteStatus(n, st);
    if (st.replicas) n.log('protocol', `replica allocation delayed ${n.num('delayedTimeoutSec', 5)}s (index.unassigned.node_left.delayed_timeout) in case the node comes back`);
    publish(st);
  };

  const allocate = (st: EsState) => {
    st.shards.forEach((copies, s) => {
      while (copies.length < 1 + st.replicas) {
        const primary = copies.find(c => c.primary && c.started);
        if (!primary) return;
        const count = (id: Id) => st.shards.reduce((a, cs) => a + cs.filter(c => c.node === id).length, 0);
        const cand = st.nodes.filter(id => up(n, id) && !copies.some(c => c.node === id)).sort((a, b) => count(a) - count(b))[0];
        if (!cand) return;
        copies.push({ node: cand, primary: false, started: false });
        n.log('protocol', `allocating replica of shard [${s}] on ${n.world.nodeName(cand)} — peer recovery from ${n.world.nodeName(primary.node)}`);
        n.send(cand, { kind: 'es.start-recovery', data: { shard: s, source: primary.node } });
      }
    });
    noteStatus(n, st);
  };

  const publish = (st: EsState) => {
    for (const id of [...st.nodes, ...members(n, 'es-coord').map(x => x.id)]) n.send(id, { kind: 'es.publish-state', data: { term: st.term, fields: st.fields } });
  };

  const duties = () => {
    const st = state(n);
    for (const d of members(n, 'es-data')) {
      const inCluster = st.nodes.includes(d.id);
      if (!inCluster && !reachData(d.id)) continue;
      n.rpc(d.id, { kind: 'es.follower-check' }, n.num('followerTimeoutMs', 500), r => {
        if (st.master !== n.id) return;
        if (r.ok) {
          st.fails.set(d.id, 0);
          if (!st.nodes.includes(d.id)) {
            st.nodes.push(d.id);
            n.log('protocol', `master ${n.name}: node ${d.name} joined the cluster`);
            allocate(st);
            publish(st);
          }
          return;
        }
        if (!st.nodes.includes(d.id)) return;
        const f = (st.fails.get(d.id) ?? 0) + 1;
        st.fails.set(d.id, f);
        if (f >= n.num('followerRetries', 3)) removeNode(st, d.id);
      });
    }
    if (n.now >= st.delayUntil) allocate(st);
  };

  const elect = () => {
    const st = state(n);
    const ms = masters();
    const q = Math.floor(ms.length / 2) + 1;
    const reachable = ms.filter(m => reach(n.id, m.id)).map(m => m.id);
    const quorum = reachable.length >= q;
    if (st.master === n.id) {
      if (!quorum) {
        st.master = undefined;
        n.log('protocol', `${n.name} sees only ${reachable.length}/${ms.length} master-eligible nodes — below quorum ${q}, steps down`);
      }
      return;
    }
    const cur = st.master;
    const curOk = cur !== undefined && reach(n.id, cur);
    if (curOk || !quorum) return;
    if ([...reachable].sort()[0] !== n.id) return;
    const old = cur ? n.world.nodeName(cur) : undefined;
    st.master = n.id;
    st.term++;
    st.fails.clear();
    n.log('protocol', `${n.name} elected master (term ${st.term}) with votes from ${reachable.map(x => n.world.nodeName(x)).join(', ')}${old ? `; ${old} is cut off from a majority` : ''}`);
    publish(st);
  };

  return {
    onStart() {
      state(n);
      n.every(500, elect, 0.1);
      n.every(n.num('followerCheckMs', 1000), () => {
        const st = state(n);
        if (st.master === n.id) duties();
        n.gauge('fields', st.fields);
        n.gauge('term', st.term);
        n.gauge('nodes', st.nodes.length);
        n.gauge('status', status(st) === 'green' ? 0 : status(st) === 'yellow' ? 1 : 2);
        n.memMb = 50 + st.fields * 0.05;
      });
    },
    onRequest(req: Req) {
      if (req.msg.kind !== 'es.put-mapping') return req.reply({ ok: false, err: '5xx' });
      const st = state(n);
      if (st.master !== n.id) return req.reply({ ok: false, err: 'unavailable' });
      const add = Number(req.msg.data?.fields ?? 1);
      const limit = n.num('totalFieldsLimit', 1000);
      if (st.fields + add > limit) return req.reply({ ok: false, err: '5xx' });
      // cluster state updates are applied one at a time; bigger mappings take longer to publish
      n.process(1, (n.num('mappingUpdateMs', 5) + st.fields * n.num('perFieldMs', 0.05)) * n.mods.slowX, ok => {
        if (!ok) return req.reply({ ok: false, err: '429' });
        if (st.fields + add > limit) return req.reply({ ok: false, err: '5xx' });
        st.fields += add;
        publish(st);
        req.reply({ ok: true });
      });
    },
    onChaos(kind, _p, heal) {
      if (kind !== 'split-brain') return false;
      const st = esState(n);
      if (heal) st.isolated.delete(n.id);
      else st.isolated.add(n.id);
      n.log('protocol', heal ? `${n.name} can reach the other master-eligible nodes again` : `${n.name} is cut off from the other master-eligible nodes`);
      return true;
    },
    view() {
      const st = state(n);
      const badges: Badge[] = [];
      if (st.master === n.id) badges.push({ text: `👑 master · term ${st.term}`, tone: 'accent' }, statusBadge(status(st)));
      else badges.push({ text: 'eligible', tone: 'muted' });
      if (st.master === n.id && st.fields > n.num('totalFieldsLimit', 1000) * 0.5) badges.push({ text: `${st.fields} fields`, tone: 'warn' });
      return { badges };
    },
  };
});

// ---------- data node ----------

register('es-data', n => {
  const buffer = new Map<number, number>();
  const segments = new Map<number, number>();
  let translogOps = 0;
  let recovering = 0;
  let recoveryMbps = 0;
  let refreshes = 0;
  let flushes = 0;
  const docKb = () => n.num('docKb', 1);
  const myShards = () => {
    const st = state(n);
    return st.shards.map((cs, s) => ({ s, c: cs.find(c => c.node === n.id) })).filter(x => x.c) as { s: number; c: Copy }[];
  };

  const index = (shard: number, w: number) => {
    translogOps += w;
    buffer.set(shard, (buffer.get(shard) ?? 0) + w);
    if ((translogOps * docKb()) / 1024 >= n.num('flushThresholdMb', 512)) {
      throttledLog(state(n).logAt, n, `flush:${n.id}`, 3000, 'protocol', `${n.name}: flush — Lucene commit fsyncs segments, translog (${((translogOps * docKb()) / 1024).toFixed(0)} MB) trimmed`);
      translogOps = 0;
      flushes++;
      n.process(1, n.num('flushCostMs', 50), () => {});
    }
  };

  const refresh = () => {
    for (const [s, docs] of buffer) {
      if (!docs) continue;
      buffer.set(s, 0);
      refreshes++;
      const segs = (segments.get(s) ?? 0) + 1;
      segments.set(s, segs);
      n.process(1, n.num('refreshCostMs', 100), () => {});
      if (segs >= 10) {
        segments.set(s, segs - 9);
        n.process(1, n.num('mergeCostMs', 400), () => {});
      }
      const st = state(n);
      if (traceOnce(st, 'refresh', 4)) {
        n.log('protocol', `${n.name}: refresh — ${Math.round(docs)} buffered docs of shard [${s}] become a searchable segment`);
      }
    }
  };

  const costX = () => (recovering ? 1.3 : 1) * (1 + 0.03 * Math.max(0, ...segments.values()));

  return {
    onStart() {
      buffer.clear();
      recovering = 0;
      n.every(Math.max(50, n.num('refreshMs', 1000)), refresh);
      n.every(1000, () => {
        n.gauge('shards', myShards().length);
        n.gauge('segments', [...segments.values()].reduce((a, b) => a + b, 0));
        n.gauge('unrefreshed', Math.round([...buffer.values()].reduce((a, b) => a + b, 0)));
        n.gauge('translogMb', Math.round((translogOps * docKb()) / 1024));
        n.gauge('recoveryMbps', recoveryMbps);
        n.gauge('refreshes', refreshes);
        n.gauge('flushes', flushes);
      });
    },
    onRequest(req: Req) {
      const d = req.msg.data ?? {};
      const w = req.msg.weight;
      switch (req.msg.kind) {
        case 'es.follower-check':
          return req.reply({ ok: true });
        case 'es.query': {
          const ms = (n.serviceTime('p50Ms', 'p99Ms', 3, 15) + (d.agg ? n.rng.lognormal(n.num('aggShardMs', 80), n.num('aggShardMs', 80) * 3) : 0)) * costX();
          return n.process(w, ms, ok => req.reply(ok ? { ok: true } : { ok: false, err: '429' }));
        }
        case 'es.fetch':
          return n.process(w, n.serviceTime('fetchP50Ms', 'fetchP99Ms', 1, 5), ok => req.reply(ok ? { ok: true } : { ok: false, err: '429' }));
        case 'es.index':
        case 'es.replicate': {
          if (n.mods.diskFull) return req.reply({ ok: false, err: '5xx' });
          const ms = n.serviceTime('indexP50Ms', 'indexP99Ms', 1, 5) * costX();
          return n.process(w, ms, ok => {
            if (!ok) return req.reply({ ok: false, err: '429' });
            index(d.shard, w);
            if (d.trace) n.log('protocol', `${n.name}: ${req.msg.kind === 'es.index' ? 'primary' : 'replica'} of shard [${d.shard}] indexed doc into the in-memory buffer + translog`);
            if (req.msg.kind === 'es.replicate') return req.reply({ ok: true });
            const st = state(n);
            const reps = (st.shards[d.shard] ?? []).filter(c => !c.primary);
            let left = reps.length;
            if (!left) return req.reply({ ok: true });
            for (const r of reps)
              n.rpc(r.node, { kind: 'es.replicate', weight: w, traceId: req.msg.traceId, data: { shard: d.shard, trace: d.trace } }, n.num('replicaTimeoutMs', 1000), () => {
                if (--left === 0) req.reply({ ok: true });
              });
          });
        }
      }
      req.reply({ ok: false, err: '5xx' });
    },
    onMessage(m: Msg) {
      if (m.kind === 'es.start-recovery') {
        // this node is the target: ask the source to stream the shard
        recovering++;
        n.send(m.data.source, { kind: 'es.recovery-chunk', data: { shard: m.data.shard, target: n.id, sent: 0, request: true } });
        return;
      }
      if (m.kind === 'es.recovery-chunk') {
        const d = m.data;
        const total = n.num('shardMb', 200);
        const rate = Math.max(1, n.num('recoveryMbps', 40));
        if (d.request) {
          // source side: stream file chunks every 500ms
          recovering++;
          recoveryMbps = rate;
          let sent = 0;
          const tick = () => {
            if (!up(n, d.target)) {
              recovering = Math.max(0, recovering - 1);
              recoveryMbps = 0;
              return;
            }
            sent = Math.min(total, sent + rate * 0.5);
            n.send(d.target, { kind: 'es.recovery-chunk', data: { shard: d.shard, sent, total } });
            if (sent < total) n.timer(500, tick);
            else {
              recovering = Math.max(0, recovering - 1);
              if (!recovering) recoveryMbps = 0;
            }
          };
          n.timer(10, tick);
          return;
        }
        recoveryMbps = rate;
        if (d.sent >= d.total) {
          recovering = Math.max(0, recovering - 1);
          if (!recovering) recoveryMbps = 0;
          const st = state(n);
          const c = st.shards[d.shard]?.find(x => x.node === n.id);
          if (c) c.started = true;
          n.log('protocol', `replica of shard [${d.shard}] recovered on ${n.name} (${d.total} MB copied)`);
          noteStatus(n, st);
        }
      }
    },
    onKill() {
      recovering = 0;
      recoveryMbps = 0;
      const lost = [...buffer.values()].reduce((a, b) => a + b, 0);
      if (lost) n.log('info', `${n.name}: ${Math.round(lost)} unrefreshed docs rebuilt from the translog on restart`);
    },
    view() {
      const mine = myShards();
      const badges: Badge[] = [{ text: mine.map(x => (x.c.primary ? 'P' : 'R') + x.s + (x.c.started ? '' : '…')).join(' ') || 'no shards', tone: 'protocol' }];
      if (recovering) badges.push({ text: `recovery ${recoveryMbps} MB/s`, tone: 'warn' });
      const segs = [...segments.values()].reduce((a, b) => a + b, 0);
      if (segs) badges.push({ text: `${segs} seg`, tone: 'muted' });
      return { badges };
    },
  };
});

// ---------- coordinating node ----------

register('es-coord', n => {
  const ewma = new Map<Id, number>();
  let aggMb = 0;
  let fields = 0;

  /** Adaptive replica selection: fewest queued + fastest recent response. */
  const rank = (copies: Copy[]) =>
    copies
      .filter(c => c.started)
      .map(c => ({ c, s: (n.world.nodes.get(c.node)?.queuedW ?? 0) * 5 + (ewma.get(c.node) ?? 5) + n.rng.next() }))
      .sort((a, b) => a.s - b.s)
      .map(x => x.c.node);

  const shardCall = (nodes: Id[], kind: string, data: any, w: number, done: (ok: boolean, ms: number, node?: Id) => void, traceId?: number) => {
    const t0 = n.now;
    const next = (i: number) => {
      if (i >= nodes.length) return done(false, n.now - t0);
      callNode(n, nodes[i], { kind, weight: w, traceId, data }, n.num('shardTimeoutMs', 1000), r => {
        ewma.set(nodes[i], (ewma.get(nodes[i]) ?? 5) * 0.8 + (n.now - t0) * 0.2);
        if (r.ok) done(true, n.now - t0, nodes[i]);
        else if (r.err === '429') done(false, n.now - t0);
        else next(i + 1);
      });
    };
    next(0);
  };

  const search = (req: Req) => {
    const st = state(n);
    const w = req.msg.weight;
    const agg = !!req.msg.data?.agg;
    const trace = req.msg.traceId !== undefined && !agg && traceOnce(st, 'search', 2);
    if (agg) {
      const mb = n.num('aggMb', 60);
      if (aggMb + mb > n.num('breakerMb', 400)) {
        throttledLog(st.logAt, n, 'breaker', 3000, 'protocol', `${n.name}: circuit_breaking_exception — [parent] data too large (${aggMb} MB of aggregation buckets in flight)`);
        return req.reply({ ok: false, err: '429' });
      }
      aggMb += mb;
    }
    const release = () => {
      if (agg) aggMb -= n.num('aggMb', 60);
    };
    const P = st.shards.length;
    if (trace) {
      n.log('protocol', `${n.name}: query phase → one copy of each of ${P} shards`);
    }
    let left = P;
    let failed = 0;
    let slowest = { ms: 0, node: '' as Id, s: 0 };
    st.shards.forEach((copies, s) => {
      shardCall(rank(copies), 'es.query', { shard: s, agg }, w, (ok, ms, node) => {
        if (!ok) failed++;
        else if (ms > slowest.ms) slowest = { ms, node: node!, s };
        if (--left) return;
        if (failed && (failed === P || !n.bool('allowPartial', true))) {
          release();
          return req.reply({ ok: false, err: 'unavailable' });
        }
        if (failed) throttledLog(st.logAt, n, 'partial', 3000, 'protocol', `${n.name}: partial results — ${failed}/${P} shards failed`);
        if (trace) n.log('protocol', `${n.name}: all shards answered; slowest was shard [${slowest.s}] on ${n.world.nodeName(slowest.node)} (${slowest.ms.toFixed(1)} ms)`);
        const reduceMs = n.serviceTime('p50Ms', 'p99Ms', 0.5, 3) + (agg ? n.num('aggReduceMs', 30) * P : 0);
        n.process(w, reduceMs, ok2 => {
          if (!ok2) {
            release();
            return req.reply({ ok: false, err: '429' });
          }
          release();
          if (agg) return req.reply({ ok: true });
          // fetch phase: only shards holding the top hits
          const hits = st.shards.map((_, i) => i).slice(0, Math.min(P, n.num('fetchShards', 2)));
          if (trace) n.log('protocol', `${n.name}: fetch phase → ${hits.length} shards holding the top 10 hits`);
          let f = hits.length;
          for (const s of hits)
            shardCall(
              rank(st.shards[s]),
              'es.fetch',
              { shard: s },
              w,
              () => {
                if (--f) return;
                if (trace) n.log('protocol', `${n.name}: search done, hits returned to client`);
                req.reply({ ok: true });
              },
              req.msg.traceId,
            );
        });
      }, req.msg.traceId);
    });
  };

  const write = (req: Req) => {
    const st = state(n);
    const w = req.msg.weight;
    const masters = members(n, 'es-master');
    if (masters.length && (!st.master || !up(n, st.master))) {
      throttledLog(st.logAt, n, 'nomaster', 3000, 'protocol', `${n.name}: cluster_block_exception — no master, writes blocked`);
      return req.reply({ ok: false, err: 'unavailable' });
    }
    const k = keyOf(req.msg.key);
    const s = shardOf(st, k);
    const primary = st.shards[s]?.find(c => c.primary && c.started);
    if (!primary) return req.reply({ ok: false, err: 'unavailable' });
    const trace = req.msg.traceId !== undefined && traceOnce(st, 'write', 2);
    if (trace) {
      n.log('protocol', `${n.name}: index doc ${k} → hash(_id) % ${st.shards.length} = shard [${s}], primary on ${n.world.nodeName(primary.node)}`);
    }
    const go = () =>
      callNode(n, primary.node, { kind: 'es.index', weight: w, traceId: req.msg.traceId, data: { shard: s, trace } }, n.num('indexTimeoutMs', 1000), r => {
        if (trace && r.ok) n.log('protocol', `${n.name}: primary + replicas acked; doc searchable after the next refresh`);
        req.reply(r.ok ? { ok: true } : { ok: false, err: r.err === '429' ? '429' : r.err ?? '5xx' });
      });
    const newFields = Number(req.msg.data?.newFields ?? 0);
    if (!newFields || !masters.length) return go();
    // dynamic mapping: a new field needs a cluster-state update on the master first
    n.rpc(st.master!, { kind: 'es.put-mapping', traceId: req.msg.traceId, data: { fields: newFields } }, n.num('mappingTimeoutMs', 3000), r => {
      if (r.ok) return go();
      if (r.err === '5xx')
        throttledLog(st.logAt, n, 'fields', 3000, 'protocol', `${n.name}: illegal_argument_exception — Limit of total fields [${n.world.nodes.get(st.master!)?.num('totalFieldsLimit', 1000) ?? 1000}] has been exceeded`);
      else throttledLog(st.logAt, n, 'mapping', 3000, 'protocol', `${n.name}: put-mapping ${r.err === 'timeout' ? 'timed out' : 'failed'} — master's pending cluster-state tasks are backed up`);
      req.reply({ ok: false, err: r.err === '5xx' ? '5xx' : r.err ?? '5xx' });
    });
  };

  return {
    onStart() {
      state(n);
      n.every(1000, () => {
        n.gauge('aggMb', aggMb);
        n.gauge('fields', fields || state(n).fields);
        const s = status(state(n));
        n.gauge('status', s === 'green' ? 0 : s === 'yellow' ? 1 : 2);
      });
    },
    onRequest(req: Req) {
      n.process(req.msg.weight, n.num('routeMs', 0.1), ok => {
        if (!ok) return req.reply({ ok: false, err: '429' });
        if (req.msg.op === 'write') write(req);
        else search(req);
      });
    },
    onMessage(m: Msg) {
      if (m.kind === 'es.publish-state') fields = m.data.fields;
    },
    view() {
      return { badges: [statusBadge(status(state(n)))] };
    },
  };
});

// ---------- application using the REST client ----------

register('es-app', n => {
  let rr = 0;
  let newFieldPct = 0;
  return {
    onRequest(req: Req) {
      const coords = n.outEdges().filter(e => n.world.nodes.get(e.to)?.up);
      if (!coords.length) return req.reply({ ok: false, err: 'unavailable' });
      const e = coords[rr++ % coords.length];
      const msg = n.world.child(req.msg, n.id, e.to);
      const pct = Math.max(newFieldPct, n.num('newFieldPct', 0));
      msg.data = { agg: n.str('query', 'match') === 'terms-agg', newFields: req.msg.op === 'write' && n.rng.chance(pct / 100) ? 1 : 0 };
      n.call(e, msg, r => req.reply(r));
    },
    onChaos(kind, p, heal) {
      if (kind !== 'cardinality-burst') return false;
      newFieldPct = heal ? 0 : Math.min(100, Number(p.x ?? 20));
      n.log('info', heal ? `${n.name}: documents back to a fixed schema` : `${n.name}: ${newFieldPct}% of documents now carry a never-seen field name (e.g. user ids as keys)`);
      return true;
    },
    view() {
      const q = n.str('query', 'match');
      return { badges: [{ text: q === 'terms-agg' ? 'terms agg' : 'match query', tone: 'protocol' }] as Badge[] };
    },
  };
});

export {};
