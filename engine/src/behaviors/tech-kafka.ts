// Kafka internals (technologies.md → Kafka): brokers lead/follow partitions (log append,
// follower fetch, ISR, high watermark), KRaft controller elects leaders, producer batches
// with acks/idempotence, consumers run the group protocol and commit offsets.
import type { NodeLogic, Req, SimNode } from '../node';
import type { Badge, Id, Msg, Reply } from '../types';
import type { World } from '../world';
import { register } from './registry';
import { clusterOf, touchEdge } from '../composite';
import { hashString } from '../rng';

// ---------- shared cluster metadata (the replicated metadata log) ----------

interface Waiter {
  off: number;
  done: (r: Reply) => void;
}

interface Part {
  p: number;
  replicas: Id[];
  leader?: Id;
  isr: Set<Id>;
  epoch: number;
  /** log end offset per replica (records) */
  leo: Map<Id, number>;
  /** leader's view of each follower's fetch offset */
  fetchOff: Map<Id, number>;
  caughtAt: Map<Id, number>;
  leoAtResp: Map<Id, number>;
  hw: number;
  /** highest offset acknowledged to a producer */
  acked: number;
  waiters: Waiter[];
  seqs: Map<string, { seq: number; off: number }>;
  altering: boolean;
  /** end offsets of records produced by traced requests (newest last) */
  traced?: { off: number; id: number }[];
}

/** Trace id of a traced record in (from, to], if any. */
function tracedIn(part: Part, from: number, to: number): number | undefined {
  for (const t of part.traced ?? []) if (t.off > from && t.off <= to) return t.id;
  return undefined;
}

interface Member {
  last: number;
  sessionMs: number;
  pollMs: number;
}

interface Group {
  id: string;
  gen: number;
  members: Map<Id, Member>;
  assign: Map<Id, number[]>;
  committed: Map<number, number>;
  rebalancing: boolean;
  joined: Map<Id, Req>;
  rebalances: number;
  minUntil: number;
  coordinator?: Id;
  token: number;
}

interface KCluster {
  id: string;
  parts: Part[];
  brokers: Id[];
  controllers: Id[];
  active?: Id;
  fenced: Set<Id>;
  lastHb: Map<Id, number>;
  groups: Map<string, Group>;
  minIsr: number;
  unclean: boolean;
  elections: number;
  lostRecords: number;
}

const clusters = new WeakMap<World, Map<string, KCluster>>();

const byType = (w: World, type: string, id: string) =>
  [...w.nodes.values()].filter(x => x.type === type && clusterOf(x, 'k1') === id).sort((a, b) => a.id.localeCompare(b.id));

function clusterFor(n: SimNode): KCluster {
  const w = n.world;
  let m = clusters.get(w);
  if (!m) clusters.set(w, (m = new Map()));
  const id = clusterOf(n, 'k1');
  let c = m.get(id);
  if (c) return c;
  const brokers = byType(w, 'kafka-broker', id);
  const ctrls = byType(w, 'kraft-controller', id);
  const cfg = ctrls[0] ?? brokers[0] ?? n;
  const P = Math.max(1, Math.round(cfg.num('partitions', 6)));
  const rf = Math.max(1, Math.min(brokers.length || 1, Math.round(cfg.num('replicationFactor', 3))));
  const ids = brokers.map(b => b.id);
  const parts: Part[] = [];
  for (let p = 0; p < P; p++) {
    const replicas = ids.length ? Array.from({ length: rf }, (_, i) => ids[(p + i) % ids.length]) : [];
    parts.push({
      p,
      replicas,
      leader: replicas[0],
      isr: new Set(replicas),
      epoch: 0,
      leo: new Map(replicas.map(r => [r, 0])),
      fetchOff: new Map(),
      caughtAt: new Map(),
      leoAtResp: new Map(),
      hw: 0,
      acked: 0,
      waiters: [],
      seqs: new Map(),
      altering: false,
    });
  }
  c = {
    id,
    parts,
    brokers: ids,
    controllers: ctrls.map(x => x.id),
    active: ctrls[0]?.id,
    fenced: new Set(),
    lastHb: new Map(),
    groups: new Map(),
    minIsr: Math.max(1, Math.round(cfg.num('minInsyncReplicas', 2))),
    unclean: cfg.bool('uncleanElection', false),
    elections: 0,
    lostRecords: 0,
  };
  m.set(id, c);
  return c;
}

/** Inspect a Kafka cluster (tests, panels). */
export function kafkaCluster(w: World, id = 'k1'): KCluster | undefined {
  return clusters.get(w)?.get(id);
}

const leoOf = (part: Part, id?: Id) => (id ? part.leo.get(id) ?? 0 : 0);
const isUp = (w: World, id?: Id) => !!id && !!w.nodes.get(id)?.up;
const pname = (p: number) => `P${p}`;

function groupOf(c: KCluster, gid: string): Group {
  let g = c.groups.get(gid);
  if (!g)
    c.groups.set(
      gid,
      (g = { id: gid, gen: 0, members: new Map(), assign: new Map(), committed: new Map(), rebalancing: false, joined: new Map(), rebalances: 0, minUntil: 0, token: 0 }),
    );
  return g;
}

/** FindCoordinator: hash(group) picks a broker; skip fenced ones. */
function coordinatorFor(c: KCluster, gid: string): Id | undefined {
  const B = c.brokers;
  if (!B.length) return undefined;
  const start = hashString(gid) % B.length;
  for (let i = 0; i < B.length; i++) {
    const b = B[(start + i) % B.length];
    if (!c.fenced.has(b)) return b;
  }
  return undefined;
}

/** Leader: advance HW to the min offset of the ISR and release acks=all waiters. */
function updateHw(n: SimNode, part: Part) {
  if (part.leader !== n.id) return;
  let hw = leoOf(part, n.id);
  for (const f of part.isr) if (f !== n.id) hw = Math.min(hw, part.fetchOff.get(f) ?? 0);
  if (hw <= part.hw) return;
  part.hw = hw;
  const ready = part.waiters.filter(x => x.off <= hw);
  if (!ready.length) return;
  part.waiters = part.waiters.filter(x => x.off > hw);
  for (const x of ready) {
    part.acked = Math.max(part.acked, x.off);
    x.done({ ok: true });
  }
}

function throttled(n: SimNode) {
  const last = new Map<string, number>();
  return (key: string, text: string, kind: 'protocol' | 'info' = 'protocol', everyMs = 3000) => {
    const t = last.get(key) ?? -Infinity;
    if (n.now - t < everyMs) return;
    last.set(key, n.now);
    n.log(kind, text);
  };
}

const notLeader: Reply = { ok: false, err: 'unavailable', data: 'NOT_LEADER' };

// ---------- broker ----------

export function kafkaBroker(n: SimNode): NodeLogic {
  let c: KCluster;
  const say = throttled(n);
  let parked = new Map<Id, { parts: number[]; respond: () => void }>();
  /** leader → trace id of traced records just fetched from it, to confirm on the next fetch */
  const confirm = new Map<Id, number>();
  let fetchDelayMs = 0;

  const led = () => c.parts.filter(p => p.leader === n.id);
  const controller = () => (c.active && isUp(n.world, c.active) ? c.active : undefined);

  function append(msg: Msg, reply?: (r: Reply) => void) {
    const d = msg.data ?? {};
    const part = c.parts[d.p];
    const r = reply ?? (() => {});
    if (!part || part.leader !== n.id) return r(notLeader);
    if (d.acks === 'all' && part.isr.size < c.minIsr) {
      say('nemr' + d.p, `${pname(d.p)} ISR ${part.isr.size} < min.insync.replicas ${c.minIsr} → NOT_ENOUGH_REPLICAS`);
      return r({ ok: false, err: 'unavailable', data: 'NOT_ENOUGH_REPLICAS' });
    }
    n.process(msg.weight, n.serviceTime('p50Ms', 'p99Ms', 0.2, 1), ok => {
      if (!ok) return r({ ok: false, err: '503' });
      if (part.leader !== n.id) return r(notLeader);
      const key = `${d.pid}:${d.seq}`;
      const prev = part.seqs.get(key);
      if (prev) {
        if (d.idem) {
          say('dedupe', `${pname(d.p)} duplicate batch seq ${d.seq} dropped (idempotent producer)`);
          if (d.acks === 'all' && prev.off > part.hw) part.waiters.push({ off: prev.off, done: r });
          else r({ ok: true });
          return;
        }
        n.anomaly('duplicate', msg.weight);
        say('dup', `${pname(d.p)} retried batch appended twice (idempotence off) → duplicate records`, 'info');
      }
      const off = leoOf(part, n.id) + msg.weight;
      part.leo.set(n.id, off);
      if (msg.traceId !== undefined) {
        (part.traced ??= []).push({ off, id: msg.traceId });
        if (part.traced.length > 50) part.traced.shift();
      }
      part.seqs.set(key, { seq: d.seq, off });
      if (part.seqs.size > 2000) part.seqs.delete(part.seqs.keys().next().value!);
      wake(d.p);
      if (d.acks !== 'all') {
        part.acked = Math.max(part.acked, off);
        r({ ok: true });
      } else {
        part.waiters.push({ off, done: r });
        updateHw(n, part);
      }
    });
  }

  function wake(p: number) {
    for (const [f, x] of [...parked]) if (x.parts.includes(p)) x.respond();
  }

  /** Follower fetch at the leader: long-poll until new data or fetchMaxWaitMs. */
  function onReplicaFetch(req: Req) {
    const f = req.msg.from;
    const offs: Record<number, number> = req.msg.data?.offs ?? {};
    const ps: number[] = [];
    let hasData = false;
    for (const k of Object.keys(offs)) {
      const part = c.parts[+k];
      if (!part || part.leader !== n.id) continue;
      ps.push(part.p);
      const off = offs[+k];
      const mine = leoOf(part, n.id);
      part.fetchOff.set(f, Math.min(off, mine));
      if (off >= (part.leoAtResp.get(f) ?? 0) || off >= mine) part.caughtAt.set(f, n.now);
      if (mine !== off) hasData = true;
      updateHw(n, part);
    }
    let done = false;
    const respond = () => {
      if (done) return;
      done = true;
      parked.delete(f);
      const out: Record<number, [number, number]> = {};
      let traceId: number | undefined;
      for (const p of ps) {
        const part = c.parts[p];
        if (part.leader !== n.id) continue;
        const mine = leoOf(part, n.id);
        traceId ??= tracedIn(part, part.fetchOff.get(f) ?? 0, mine);
        part.leoAtResp.set(f, mine);
        out[p] = [mine, part.hw];
      }
      req.reply({ ok: true, data: out, traceId } as Reply);
    };
    if (hasData || !ps.length) return respond();
    parked.get(f)?.respond();
    parked.set(f, { parts: ps, respond });
    n.timer(n.num('fetchMaxWaitMs', 500), respond);
  }

  /** Replica fetcher thread: one long-poll loop per leader broker. */
  function fetchLoop(leader: Id) {
    const mine = c.parts.filter(p => p.leader === leader && p.replicas.includes(n.id) && leader !== n.id);
    if (!mine.length || !isUp(n.world, leader)) return n.timer(200, () => fetchLoop(leader));
    const offs: Record<number, number> = {};
    for (const p of mine) offs[p.p] = leoOf(p, n.id);
    // the fetch after receiving traced records is what tells the leader this replica has them
    const traceId = confirm.get(leader);
    confirm.delete(leader);
    n.rpc(leader, { kind: 'kafka.Fetch', traceId, data: { offs, replica: true } }, 2000, r => {
      if (!r.ok) return n.timer(200, () => fetchLoop(leader));
      const tr = (r as Reply & { traceId?: number }).traceId;
      if (tr !== undefined) confirm.set(leader, tr);
      let w = 0;
      for (const [k, v] of Object.entries(r.data ?? {}) as [string, [number, number]][]) {
        const part = c.parts[+k];
        if (part.leader !== leader) continue;
        const before = leoOf(part, n.id);
        if (before > v[0]) say('trunc' + k, `${n.name} truncates ${pname(+k)} to leader's log (${Math.round(before - v[0])} records dropped)`);
        part.leo.set(n.id, v[0]);
        w += Math.max(0, v[0] - before);
      }
      if (w > 0) touchEdge(n, leader, w);
      n.timer(Math.max(n.num('replicaFetchWaitMs', 3), fetchDelayMs) * n.mods.slowX, () => fetchLoop(leader));
    });
  }

  function isrCheck() {
    const lagMax = n.num('replicaLagMaxMs', 2000);
    for (const part of led()) {
      if (part.altering) continue;
      const isr = new Set(part.isr);
      let why = '';
      for (const f of part.isr) {
        if (f === n.id) continue;
        if (n.now - (part.caughtAt.get(f) ?? 0) > lagMax) {
          isr.delete(f);
          why = `${n.world.nodeName(f)} fell behind > ${lagMax}ms`;
        }
      }
      for (const f of part.replicas) {
        if (f === n.id || isr.has(f) || c.fenced.has(f)) continue;
        const off = part.fetchOff.get(f);
        if (off !== undefined && off >= part.hw && n.now - (part.caughtAt.get(f) ?? 0) < lagMax) {
          isr.add(f);
          why = `${n.world.nodeName(f)} caught up`;
        }
      }
      if (isr.size === part.isr.size && [...isr].every(x => part.isr.has(x))) continue;
      const ctrl = controller();
      if (!ctrl) {
        say('noctrl', `AlterPartition ${pname(part.p)} failed: no active controller (ISR frozen)`);
        continue;
      }
      part.altering = true;
      const want = [...isr];
      n.rpc(ctrl, { kind: 'kafka.AlterPartition', data: { p: part.p, isr: want, epoch: part.epoch, why } }, 1000, r => {
        part.altering = false;
        if (r.ok) updateHw(n, part);
      });
    }
  }

  // ----- group coordinator -----
  function own(g: Group) {
    if (g.coordinator === n.id) return;
    g.coordinator = n.id;
    g.rebalancing = false;
    g.joined.clear();
  }

  function startRebalance(g: Group, why: string) {
    const tok = ++g.token;
    if (!g.rebalancing) {
      g.rebalancing = true;
      g.rebalances++;
      n.log('protocol', `Group ${g.id} rebalance #${g.rebalances}: ${why} — all members stop consuming`);
    }
    g.minUntil = n.now + n.num('rebalanceDelayMs', 300);
    n.timer(n.num('rebalanceDelayMs', 300), () => tryComplete(g));
    const timeout = Math.max(1000, ...[...g.members.values()].map(m => m.pollMs));
    n.timer(timeout, () => g.token === tok && complete(g, true));
  }

  function tryComplete(g: Group) {
    if (!g.rebalancing || n.now < g.minUntil) return;
    if ([...g.members.keys()].every(m => g.joined.has(m))) complete(g, false);
  }

  function complete(g: Group, force: boolean) {
    if (!g.rebalancing) return;
    for (const m of [...g.members.keys()]) if (!g.joined.has(m)) {
      g.members.delete(m);
      if (force) n.log('protocol', `Group ${g.id}: ${n.world.nodeName(m)} didn't rejoin in time → kicked`);
    }
    g.gen++;
    g.token++;
    g.rebalancing = false;
    const ms = [...g.members.keys()].sort();
    g.assign = new Map(ms.map(m => [m, [] as number[]]));
    c.parts.forEach((_, p) => ms.length && g.assign.get(ms[p % ms.length])!.push(p));
    const txt = ms.map(m => `${n.world.nodeName(m)}→${g.assign.get(m)!.map(pname).join(',') || '∅'}`).join(' · ');
    n.log('protocol', `Group ${g.id} generation ${g.gen}: ${txt}`);
    const offsets = Object.fromEntries(g.committed);
    for (const [m, req] of g.joined) req.reply({ ok: true, data: { gen: g.gen, parts: g.assign.get(m) ?? [], offsets } });
    g.joined.clear();
  }

  function onGroup(req: Req) {
    const d = req.msg.data ?? {};
    const g = groupOf(c, d.group ?? 'g1');
    own(g);
    const m = req.msg.from;
    switch (req.msg.kind) {
      case 'kafka.JoinGroup': {
        const known = g.members.has(m);
        g.members.set(m, { last: n.now, sessionMs: d.sessionMs ?? 3000, pollMs: d.pollMs ?? 5000 });
        g.joined.set(m, req);
        if (!g.rebalancing) startRebalance(g, known ? `${n.world.nodeName(m)} rejoined` : `${n.world.nodeName(m)} joined`);
        return tryComplete(g);
      }
      case 'kafka.Heartbeat': {
        const mem = g.members.get(m);
        if (!mem) return req.reply({ ok: false, err: 'conflict', data: 'UNKNOWN_MEMBER_ID' });
        mem.last = n.now;
        return req.reply({ ok: true, data: { rebalance: g.rebalancing || d.gen !== g.gen } });
      }
      case 'kafka.LeaveGroup': {
        g.members.delete(m);
        g.joined.delete(m);
        req.reply({ ok: true });
        if (g.members.size) startRebalance(g, `${n.world.nodeName(m)} left`);
        return tryComplete(g);
      }
      case 'kafka.OffsetCommit': {
        if (d.gen !== g.gen || !g.members.has(m)) return req.reply({ ok: false, err: 'conflict', data: 'ILLEGAL_GENERATION' });
        for (const [p, off] of Object.entries(d.offs ?? {})) g.committed.set(+p, Math.max(g.committed.get(+p) ?? 0, off as number));
        return req.reply({ ok: true });
      }
    }
  }

  function sessionCheck() {
    for (const g of c.groups.values()) {
      if (g.coordinator !== n.id) continue;
      for (const [m, mem] of [...g.members]) {
        if (n.now - mem.last <= mem.sessionMs) continue;
        g.members.delete(m);
        g.joined.delete(m);
        startRebalance(g, `${n.world.nodeName(m)} session expired`);
      }
      tryComplete(g);
    }
  }

  return {
    handles: k => k.startsWith('kafka.'),
    onStart() {
      c = clusterFor(n);
      parked = new Map();
      for (const b of c.brokers) if (b !== n.id) fetchLoop(b);
      n.every(n.num('heartbeatMs', 250), () => {
        const ctrl = controller();
        if (ctrl) n.send(ctrl, { kind: 'kafka.BrokerHeartbeat' });
      });
      n.every(250, () => {
        isrCheck();
        sessionCheck();
      });
      n.every(500, () => {
        const L = led();
        n.gauge('leaders', L.length);
        n.gauge('underReplicated', L.filter(p => p.isr.size < p.replicas.length).length);
        n.gauge('isrMin', L.length ? Math.min(...L.map(p => p.isr.size)) : 0);
        n.gauge('hw', L.reduce((a, p) => a + p.hw, 0));
        n.gauge('waiting', L.reduce((a, p) => a + p.waiters.length, 0));
      });
    },
    onKill() {
      parked = new Map();
    },
    onRequest(req: Req) {
      const k = req.msg.kind;
      if (k === 'kafka.Produce') return append(req.msg, r => req.reply(r));
      if (k === 'kafka.Fetch') {
        if (req.msg.data?.replica) return onReplicaFetch(req);
        const out: Record<number, number> = {};
        for (const p of (req.msg.data?.parts ?? []) as number[]) if (c.parts[p]?.leader === n.id) out[p] = c.parts[p].hw;
        return n.process(req.msg.weight, n.serviceTime('p50Ms', 'p99Ms', 0.2, 1) * 0.2, () => req.reply({ ok: true, data: out }));
      }
      if (k.startsWith('kafka.') && /Group|Heartbeat|OffsetCommit/.test(k)) return onGroup(req);
      // plain request landing on a broker: acts as an embedded produce to partition leader
      n.process(req.msg.weight, n.serviceTime('p50Ms', 'p99Ms', 0.2, 1), ok => req.reply(ok ? { ok: true } : { ok: false, err: '503' }));
    },
    onMessage(msg: Msg) {
      if (msg.kind === 'kafka.Produce') append(msg);
    },
    onChaos(kind, params, heal) {
      if (kind === 'replica-lag' || kind === 'slow-follower') {
        fetchDelayMs = heal ? 0 : Number(params.ms ?? 5000);
        if (!heal) n.log('chaos', `${n.name} follower fetches every ${fetchDelayMs}ms (slow disk)`);
        return true;
      }
      if (kind === 'kill-leader') {
        const lead = led();
        n.log('chaos', `Kill partition leader ${n.name} (leads ${lead.map(p => pname(p.p)).join(',') || 'nothing'})`);
        if (!heal) n.kill();
        else n.restart();
        return true;
      }
      return false;
    },
    view() {
      if (!c) return {};
      const L = led();
      const badges: Badge[] = [];
      if (c.fenced.has(n.id)) badges.push({ text: 'fenced', tone: 'fail' });
      if (L.length) badges.push({ text: `👑 ${L.map(p => pname(p.p)).join(' ')}`, tone: 'accent' });
      const under = L.filter(p => p.isr.size < p.replicas.length);
      if (under.length) badges.push({ text: `ISR ${Math.min(...under.map(p => p.isr.size))}/${under[0].replicas.length}`, tone: under.some(p => p.isr.size < c.minIsr) ? 'fail' : 'warn' });
      const coord = [...c.groups.values()].filter(g => g.coordinator === n.id);
      if (coord.length) badges.push({ text: `coord ${coord.map(g => g.id).join(',')}`, tone: 'protocol' });
      return { badges };
    },
  };
}

// ---------- KRaft controller ----------

export function kraftController(n: SimNode): NodeLogic {
  let c: KCluster;
  let electing = false;

  const active = () => c.active === n.id;

  function sendLeaderAndIsr(changed: Part[]) {
    if (!changed.length) return;
    for (const b of c.brokers) {
      if (c.fenced.has(b)) continue;
      n.send(b, { kind: 'kafka.LeaderAndIsr', data: changed.map(p => `${pname(p.p)}:${p.leader ? n.world.nodeName(p.leader) : '-'}@${p.epoch}`).join(' ') });
      touchEdge(n, b, 1);
    }
  }

  function setLeader(part: Part, to: Id | undefined, why: string) {
    for (const x of part.waiters.splice(0)) x.done(notLeader);
    part.leader = to;
    part.epoch++;
    c.elections++;
    if (!to) {
      n.log('protocol', `${pname(part.p)} OFFLINE — no eligible replica (${why})`);
      return;
    }
    const newLeo = leoOf(part, to);
    const lost = part.acked - newLeo;
    if (lost > 0) {
      n.anomaly('lost-write', lost);
      c.lostRecords += lost;
    }
    part.acked = Math.min(part.acked, newLeo);
    for (const [k, v] of [...part.seqs]) if (v.off > newLeo) part.seqs.delete(k);
    part.hw = Math.min(part.hw, newLeo);
    for (const f of part.isr) if (f !== to) part.caughtAt.set(f, n.now);
    part.fetchOff.clear();
    n.log(
      'protocol',
      `Elected leader ${pname(part.p)} → ${n.world.nodeName(to)} (epoch ${part.epoch}, ${why})` +
        (lost > 0 ? ` · ${Math.round(lost)} acked records lost` : ''),
    );
  }

  function elect(part: Part, why: string): boolean {
    const clean = part.replicas.find(r => part.isr.has(r) && !c.fenced.has(r));
    if (clean) {
      setLeader(part, clean, why);
      return true;
    }
    if (c.unclean) {
      const any = part.replicas.find(r => !c.fenced.has(r));
      if (any) {
        n.log('protocol', `UNCLEAN election for ${pname(part.p)}: out-of-sync ${n.world.nodeName(any)} becomes leader`);
        part.isr = new Set([any]);
        setLeader(part, any, 'unclean');
        return true;
      }
    }
    if (part.leader) setLeader(part, undefined, why);
    return false;
  }

  function fence(b: Id) {
    c.fenced.add(b);
    n.log('protocol', `${n.world.nodeName(b)} missed heartbeats → fenced`);
    const changed: Part[] = [];
    for (const part of c.parts) {
      if (!part.replicas.includes(b)) continue;
      const wasLeader = part.leader === b;
      if (part.isr.size > 1 || !wasLeader) part.isr.delete(b);
      if (wasLeader) {
        elect(part, `${n.world.nodeName(b)} lost`);
        changed.push(part);
      }
    }
    sendLeaderAndIsr(changed);
  }

  function unfence(b: Id) {
    c.fenced.delete(b);
    n.log('protocol', `${n.world.nodeName(b)} back → unfenced; catches up as follower`);
    const changed: Part[] = [];
    for (const part of c.parts) if (!part.leader && part.replicas.includes(b) && elect(part, 'replica returned')) changed.push(part);
    sendLeaderAndIsr(changed);
  }

  function tick() {
    if (!c.active || !isUp(n.world, c.active)) return maybeElect();
    if (!active()) return;
    const sessionMs = n.num('brokerSessionMs', 1500);
    for (const b of c.brokers) {
      const last = c.lastHb.get(b) ?? n.now;
      if (!c.lastHb.has(b)) c.lastHb.set(b, n.now);
      if (!c.fenced.has(b) && n.now - last > sessionMs) fence(b);
    }
    for (const part of c.parts) if (!part.leader) {
      if (elect(part, 'retry')) sendLeaderAndIsr([part]);
    }
    n.gauge('offline', c.parts.filter(p => !p.leader).length);
    n.gauge('elections', c.elections);
  }

  let lastRebalance = 0;
  function preferred() {
    if (!active() || !n.bool('autoLeaderRebalance', true) || n.now - lastRebalance < 10000) return;
    lastRebalance = n.now;
    const changed: Part[] = [];
    for (const part of c.parts) {
      const pref = part.replicas[0];
      if (part.leader !== pref && part.isr.has(pref) && !c.fenced.has(pref) && isUp(n.world, pref)) {
        setLeader(part, pref, 'preferred leader');
        changed.push(part);
      }
    }
    sendLeaderAndIsr(changed);
  }

  function maybeElect() {
    if (electing) return;
    const live = c.controllers.filter(x => isUp(n.world, x));
    if (live[0] !== n.id) return;
    const need = Math.floor(c.controllers.length / 2) + 1;
    electing = true;
    n.timer(n.num('electionMs', 1000), () => {
      electing = false;
      const now = c.controllers.filter(x => isUp(n.world, x));
      for (const x of now) if (x !== n.id) n.send(x, { kind: 'kafka.Vote', data: 'VoteRequest' });
      if (now.length < need) {
        n.log('protocol', `No controller quorum (${now.length}/${c.controllers.length} alive) — metadata frozen`);
        return;
      }
      c.active = n.id;
      c.lastHb = new Map(c.brokers.map(b => [b, n.now]));
      n.log('protocol', `${n.name} elected active controller (quorum ${now.length}/${c.controllers.length})`);
    });
  }

  return {
    handles: k => k.startsWith('kafka.'),
    onStart() {
      c = clusterFor(n);
      if (active()) c.lastHb = new Map(c.brokers.map(b => [b, n.now]));
      n.every(250, tick);
      n.every(1000, preferred);
    },
    onMessage(msg: Msg) {
      if (msg.kind !== 'kafka.BrokerHeartbeat' || !active()) return;
      c.lastHb.set(msg.from, n.now);
      if (c.fenced.has(msg.from)) unfence(msg.from);
    },
    onRequest(req: Req) {
      if (req.msg.kind !== 'kafka.AlterPartition' || !active()) return req.reply({ ok: false, err: 'unavailable', data: 'NOT_CONTROLLER' });
      const d = req.msg.data;
      const part = c.parts[d.p];
      if (!part || part.epoch !== d.epoch || part.leader !== req.msg.from) return req.reply({ ok: false, err: 'conflict', data: 'FENCED_LEADER_EPOCH' });
      const before = part.isr.size;
      part.isr = new Set(d.isr as Id[]);
      const names = [...part.isr].map(x => n.world.nodeName(x)).join(',');
      n.log('protocol', `ISR ${pname(part.p)} ${part.isr.size < before ? 'shrank' : 'expanded'} → {${names}} (${d.why})`);
      req.reply({ ok: true });
    },
    onChaos(kind, _p, heal) {
      if (kind !== 'kill-leader' && kind !== 'kill-coordinator') return false;
      if (!heal) n.kill();
      else n.restart();
      return true;
    },
    view() {
      if (!c) return {};
      const badges: Badge[] = [];
      if (active()) badges.push({ text: '👑 active', tone: 'accent' });
      else badges.push({ text: 'standby', tone: 'muted' });
      const off = c.parts.filter(p => !p.leader).length;
      if (off) badges.push({ text: `${off} offline`, tone: 'fail' });
      return { badges };
    },
  };
}

// ---------- producer ----------

interface Batch {
  p: number;
  w: number;
  reqs: Req[];
  seq: number;
  born: number;
  timer?: boolean;
}

export function kafkaProducer(n: SimNode): NodeLogic {
  let c: KCluster;
  const open = new Map<number, Batch>();
  let seq = 0;
  let rr = 0;
  let sentBatches = 0;
  let sentW = 0;
  let retries = 0;
  const say = throttled(n);
  const pid = n.id;

  const acks = () => n.str<string>('acks', 'all');

  function partitionOf(msg: Msg): number {
    const P = c.parts.length;
    if (msg.key === undefined || n.str('partitioner', 'key') !== 'key') return rr++ % P;
    return msg.key % P;
  }

  function flush(b: Batch) {
    if (open.get(b.p) === b) open.delete(b.p);
    sentBatches++;
    sentW += b.w;
    b.seq = seq++;
    send(b, 1);
  }

  function finish(b: Batch, r: Reply) {
    for (const q of b.reqs) q.reply(r);
  }

  function send(b: Batch, attempt: number) {
    const part = c.parts[b.p];
    const a = acks();
    const retry = (why: string) => {
      if (n.now - b.born + n.num('retryBackoffMs', 100) > n.num('deliveryTimeoutMs', 5000)) {
        say('expire', `Batch for ${pname(b.p)} expired after delivery.timeout (${why})`, 'info');
        return finish(b, { ok: false, err: why === 'timeout' ? 'timeout' : 'unavailable' });
      }
      retries++;
      const backoff = Math.min(n.num('retryBackoffMaxMs', 1000), n.num('retryBackoffMs', 100) * 2 ** (attempt - 1));
      n.timer(backoff, () => send(b, attempt + 1));
    };
    if (!part.leader) return retry('offline');
    const data = { p: b.p, seq: b.seq, pid, acks: a, idem: n.bool('idempotence', true) && a === 'all' };
    const traceId = b.reqs.find(q => q.msg.traceId !== undefined)?.msg.traceId;
    touchEdge(n, part.leader, b.w);
    if (a === '0') {
      n.send(part.leader, { kind: 'kafka.Produce', weight: b.w, traceId, data });
      return finish(b, { ok: true });
    }
    n.rpc(part.leader, { kind: 'kafka.Produce', weight: b.w, traceId, data }, n.num('requestTimeoutMs', 1000), r => {
      if (r.ok) return finish(b, r);
      if (r.data === 'NOT_ENOUGH_REPLICAS') say('nemr', `${pname(b.p)} NOT_ENOUGH_REPLICAS → retrying`);
      retry(r.err ?? 'unavailable');
    });
  }

  return {
    onStart() {
      c = clusterFor(n);
      n.every(1000, () => {
        n.gauge('batchAvg', sentBatches ? sentW / sentBatches : 0);
        n.gauge('batchesPerSec', sentBatches);
        n.gauge('retries', retries);
        sentBatches = 0;
        sentW = 0;
      });
    },
    onRequest(req: Req) {
      if (!c.parts.length) return req.reply({ ok: false, err: 'unavailable' });
      const p = partitionOf(req.msg);
      let b = open.get(p);
      if (!b) open.set(p, (b = { p, w: 0, reqs: [], seq: -1, born: n.now }));
      b.w += req.msg.weight;
      b.reqs.push(req);
      if (b.w >= n.num('batchRecords', 16)) return flush(b);
      if (!b.timer) {
        b.timer = true;
        const bb = b;
        n.timer(n.num('lingerMs', 5), () => open.get(bb.p) === bb && flush(bb));
      }
    },
    view() {
      const a = acks();
      const badges: Badge[] = [{ text: `acks=${a}`, tone: a === 'all' ? 'ok' : 'warn' }];
      if (n.bool('idempotence', true) && a === 'all') badges.push({ text: 'idempotent', tone: 'muted' });
      return { badges };
    },
  };
}

// ---------- consumer ----------

interface Work {
  batch: { p: number; from: number; to: number }[];
  /** a traced record is in this batch */
  traceId?: number;
  w: number;
  gen: number;
  start: number;
  expectMs: number;
  committed: boolean;
}

export function kafkaConsumer(n: SimNode): NodeLogic {
  let c: KCluster;
  let gid = 'g1';
  let gen = -1;
  let parts: number[] = [];
  let pos = new Map<number, number>();
  let phase: 'joining' | 'stable' | 'left' = 'joining';
  let coord: Id | undefined;
  let busy: Work | undefined;
  let needRejoin = false;
  let rr = 0;
  let processedW = 0;
  let joinTok = 0;
  let joinAt = 0;
  let lastCommit = 0;
  /** a processed traced record whose offset hasn't been committed yet */
  let uncommittedTrace: number | undefined;
  const say = throttled(n);

  const commitMode = () => n.str<string>('commit', 'after');

  function join() {
    phase = 'joining';
    needRejoin = false;
    const tok = ++joinTok;
    joinAt = n.now;
    coord = coordinatorFor(c, gid);
    if (!coord) return n.timer(500, () => tok === joinTok && join());
    const pollMs = n.num('maxPollIntervalMs', 5000);
    n.rpc(coord, { kind: 'kafka.JoinGroup', data: { group: gid, sessionMs: n.num('sessionTimeoutMs', 3000), pollMs } }, pollMs + 1000, r => {
      if (phase !== 'joining' || tok !== joinTok) return;
      if (!r.ok) return n.timer(300, join);
      gen = r.data.gen;
      parts = r.data.parts;
      const offs = r.data.offsets ?? {};
      pos = new Map(parts.map(p => [p, offs[p] ?? (n.str('startFrom', 'latest') === 'earliest' ? 0 : c.parts[p].hw)]));
      phase = 'stable';
      poll();
    });
  }

  function rejoin(why: string) {
    if (phase === 'joining') return;
    if (why) say('rejoin', `${n.name}: ${why} → rejoining group`);
    if (busy) needRejoin = true;
    else join();
  }

  function heartbeat() {
    // connection refused by a dead coordinator: find another one
    if (phase === 'joining' && !busy && coord && !isUp(n.world, coord) && n.now - joinAt > 1000) return join();
    if (phase !== 'stable' || !coord) return;
    n.rpc(coord, { kind: 'kafka.Heartbeat', data: { group: gid, gen } }, 1000, r => {
      if (phase !== 'stable') return;
      if (!r.ok) return rejoin(r.err === 'timeout' ? 'coordinator unreachable' : String(r.data ?? r.err));
      if (r.data?.rebalance) rejoin('');
    });
  }

  function poll() {
    if (phase !== 'stable' || busy) return;
    const max = n.num('maxPollRecords', 500);
    const batch: Work['batch'] = [];
    let w = 0;
    for (let i = 0; i < parts.length && w < max; i++) {
      const p = parts[(rr + i) % parts.length];
      const part = c.parts[p];
      if (!part.leader) continue;
      const from = pos.get(p) ?? part.hw;
      const take = Math.min(part.hw - from, max - w);
      if (take <= 0) continue;
      batch.push({ p, from, to: from + take });
      w += take;
    }
    rr++;
    if (!batch.length) return n.timer(n.num('pollIdleMs', 50), poll);
    // one Fetch per partition leader
    const byLeader = new Map<Id, number[]>();
    for (const b of batch) {
      const L = c.parts[b.p].leader!;
      byLeader.set(L, [...(byLeader.get(L) ?? []), b.p]);
    }
    let pending = byLeader.size;
    const myGen = gen;
    const traced = (b: Work['batch'][number]) => tracedIn(c.parts[b.p], b.from, b.to);
    busy = { batch, w, gen, start: n.now, expectMs: 0, committed: false, traceId: batch.map(traced).find(x => x !== undefined) };
    const me = busy;
    for (const [L, ps] of byLeader) {
      touchEdge(n, L, batch.filter(b => ps.includes(b.p)).reduce((a, b) => a + b.to - b.from, 0));
      const traceId = batch.filter(b => ps.includes(b.p)).map(traced).find(x => x !== undefined);
      n.rpc(L, { kind: 'kafka.Fetch', traceId, data: { parts: ps } }, 1000, () => {
        if (--pending === 0 && busy === me && gen === myGen) handle(me);
      });
    }
  }

  function commit(offs: Record<number, number>, g: number, cb: (ok: boolean, why?: string) => void, traceId?: number) {
    if (!coord) return cb(false, 'no coordinator');
    lastCommit = n.now;
    const tid = traceId ?? uncommittedTrace;
    uncommittedTrace = undefined;
    n.rpc(coord, { kind: 'kafka.OffsetCommit', traceId: tid, data: { group: gid, gen: g, offs } }, 1000, r => cb(r.ok, String(r.data ?? r.err)));
  }

  /** processed but not yet committed (re-read after a crash or failed commit) */
  function uncommitted(): number {
    const cm = c.groups.get(gid)?.committed;
    let w = 0;
    for (const p of parts) w += Math.max(0, (pos.get(p) ?? 0) - (cm?.get(p) ?? 0));
    return w;
  }

  function handle(work: Work) {
    const pollMs = n.num('maxPollIntervalMs', 5000);
    n.timer(pollMs, () => {
      if (busy !== work) return;
      n.log('protocol', `${n.name} exceeded max.poll.interval.ms (${pollMs}ms) → leaves group`);
      if (coord) n.rpc(coord, { kind: 'kafka.LeaveGroup', data: { group: gid } }, 1000, () => {});
      phase = 'left';
      needRejoin = true;
    });
    if (commitMode() === 'before')
      commit(
        Object.fromEntries(work.batch.map(b => [b.p, b.to])),
        work.gen,
        ok => {
          if (busy !== work) return;
          if (!ok) return done(work, false);
          work.committed = true;
          doWork(work);
        },
        work.traceId,
      );
    else doWork(work);
  }

  function doWork(work: Work) {
    work.start = n.now;
    const outs = n.outEdges();
    if (outs.length) {
      work.expectMs = 0;
      const msg = n.world.newMsg({ from: n.id, to: n.id, weight: work.w, op: 'write', traceId: work.traceId, data: { records: work.w } });
      let left = outs.length;
      let ok = true;
      for (const e of outs)
        n.call(e, n.world.child(msg, n.id, e.to), r => {
          ok = ok && r.ok;
          if (--left === 0) ok ? done(work, true) : n.timer(n.num('retryBackoffMs', 200), () => busy === work && doWork(work));
        });
      return;
    }
    const cap = Math.min(n.capacity, Math.max(1, Math.ceil(work.w)));
    const svc = n.serviceTime('p50Ms', 'p99Ms', 1, 5);
    work.expectMs = (svc * work.w) / cap;
    n.process(work.w, svc, ok => (ok ? done(work, true) : n.timer(50, () => busy === work && doWork(work))));
  }

  function done(work: Work, processed: boolean) {
    if (busy !== work) return;
    busy = undefined;
    if (processed) {
      processedW += work.w;
      const b = n.series.cur;
      b.inW += work.w;
      b.okW += work.w;
      b.hist.add(n.now - work.start, work.w);
      if (work.gen === gen) for (const b of work.batch) if (parts.includes(b.p)) pos.set(b.p, Math.max(pos.get(b.p) ?? 0, b.to));
      if (work.traceId !== undefined && !work.committed) uncommittedTrace = work.traceId;
      if (commitMode() === 'after' && n.now - lastCommit >= n.num('commitIntervalMs', 1000)) {
        const offs = Object.fromEntries(parts.map(p => [p, pos.get(p) ?? 0]));
        const g = gen;
        commit(offs, work.gen, (ok, why) => {
          if (ok || g !== gen) return;
          const w = uncommitted();
          n.anomaly('duplicate', w);
          say('cfail', `${n.name}: commit failed (${why}) → ${Math.round(w)} processed records will be re-read`);
        });
      }
    }
    if (needRejoin || phase !== 'stable') join();
    else poll();
  }

  return {
    handles: k => k.startsWith('kafka.'),
    onStart() {
      c = clusterFor(n);
      gid = n.str('group', 'g1');
      busy = undefined;
      gen = -1;
      parts = [];
      join();
      n.every(n.num('heartbeatMs', 300), heartbeat);
      n.every(500, () => {
        let lag = 0;
        for (const p of parts) lag += Math.max(0, c.parts[p].hw - (pos.get(p) ?? c.parts[p].hw));
        n.gauge('lag', phase === 'stable' ? lag : n.gaugesNow.lag ?? 0);
        const g = c.groups.get(gid);
        let glag = 0;
        if (g) for (const part of c.parts) glag += Math.max(0, part.hw - (g.committed.get(part.p) ?? part.hw));
        n.gauge('groupLag', glag);
        n.gauge('rebalances', g?.rebalances ?? 0);
        n.gauge('generation', gen);
        n.gauge('processed', processedW);
      });
    },
    onKill() {
      const b = busy;
      busy = undefined;
      phase = 'joining';
      const doneW = b ? b.w * (b.expectMs > 0 ? Math.min(1, (n.now - b.start) / b.expectMs) : 0.5) : 0;
      if (commitMode() === 'before') {
        if (!b?.committed) return;
        n.anomaly('lost-write', b.w - doneW);
        n.log('info', `${n.name} died mid-batch: offsets were committed first → ${Math.round(b.w - doneW)} records never processed`);
        return;
      }
      const w = uncommitted() + doneW;
      if (w <= 0) return;
      n.anomaly('duplicate', w);
      n.log('info', `${n.name} died: ${Math.round(w)} records processed since the last commit will be re-read`);
    },
    onRequest(req: Req) {
      // a consumer isn't a request target; pass through to its outputs
      n.forward(req, n.syncOut(req.msg.op), 'all');
    },
    view() {
      const badges: Badge[] = [];
      if (phase !== 'stable') badges.push({ text: phase === 'left' ? 'left group' : 'rebalancing', tone: 'warn' });
      else badges.push({ text: parts.length ? parts.map(pname).join(',') : 'idle', tone: parts.length ? 'accent' : 'muted' });
      if (gen >= 0) badges.push({ text: `gen ${gen}`, tone: 'muted' });
      return { badges };
    },
  };
}

register('kafka-broker', kafkaBroker);
register('kraft-controller', kraftController);
register('kafka-producer', kafkaProducer);
register('kafka-consumer', kafkaConsumer);
