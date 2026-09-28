// Coordination group: Raft (./raft), Paxos, lock service + fencing, id generators, SWIM gossip.
import type { NodeLogic, Req, SimNode } from '../node';
import type { Badge, Id, Msg } from '../types';
import type { World } from '../world';
import { register, registerKind } from './registry';
import { awake, groupOf, groupState, peersOf } from './raft';

export { raftLeader, raftState, groupState, awake, peersOf } from './raft';

// ---------- Paxos (single-decree per slot) ----------

interface PaxosGroup {
  chosen: Map<number, string>;
}
const paxosGroup = (n: SimNode) => groupState<PaxosGroup>(n.world, 'paxos:' + groupOf(n), () => ({ chosen: new Map() }));

const ballotText = (b: number) => `${Math.floor(b / 1000)}.${b % 1000}`;

export function paxosAcceptor(n: SimNode): NodeLogic {
  const slots = new Map<number, { promised: number; an: number; av?: string }>();
  const slot = (s: number) => {
    let st = slots.get(s);
    if (!st) slots.set(s, (st = { promised: 0, an: 0 }));
    return st;
  };
  let last = '';
  return {
    handles: k => k.startsWith('paxos.'),
    onMessage(msg) {
      awake(n, () => {
        const d = msg.data ?? {};
        const st = slot(d.slot);
        if (msg.kind === 'paxos.Prepare') {
          if (d.b > st.promised) {
            st.promised = d.b;
            n.send(msg.from, { kind: 'paxos.Promise', data: { slot: d.slot, b: d.b, an: st.an, av: st.av } });
          } else n.send(msg.from, { kind: 'paxos.Nack', data: { slot: d.slot, b: d.b, promised: st.promised } });
        } else if (msg.kind === 'paxos.Accept') {
          if (d.b >= st.promised) {
            st.promised = st.an = d.b;
            st.av = d.v;
            last = `${d.v}@${ballotText(d.b)}`;
            n.send(msg.from, { kind: 'paxos.Accepted', data: { slot: d.slot, b: d.b, v: d.v } });
          } else n.send(msg.from, { kind: 'paxos.Nack', data: { slot: d.slot, b: d.b, promised: st.promised } });
        }
      });
    },
    view: () => ({ badges: last ? [{ text: last, tone: 'protocol' }] : [], label: 'acceptor' }),
  };
}

export function paxosProposer(n: SimNode): NodeLogic {
  const group = paxosGroup(n);
  let acceptors: SimNode[] = [];
  const proposers = () => peersOf(n, 'paxos-proposer');
  const myIdx = () => Math.max(0, proposers().findIndex(p => p.id === n.id)) + 1;
  const majority = () => Math.floor(acceptors.length / 2) + 1;
  let maxRound = 0;
  let decided = 0;

  interface Attempt {
    slot: number;
    b: number;
    value: string;
    phase: 1 | 2;
    promises: Map<Id, { an: number; av?: string }>;
    accepted: Set<Id>;
    done: (chosen: string) => void;
    tries: number;
  }
  let cur: Attempt | undefined;
  const queue: { value: string; done: (ok: boolean) => void }[] = [];

  function nextSlot() {
    let s = 1;
    while (group.chosen.has(s)) s++;
    return s;
  }

  function begin(a: Omit<Attempt, 'b' | 'phase' | 'promises' | 'accepted'>) {
    maxRound++;
    const at: Attempt = { ...a, b: maxRound * 1000 + myIdx(), phase: 1, promises: new Map(), accepted: new Set() };
    cur = at;
    for (const acc of acceptors) n.send(acc.id, { kind: 'paxos.Prepare', data: { slot: at.slot, b: at.b } });
    n.timer(n.num('phaseTimeoutMs', 300), () => cur === at && retry(at));
  }

  function retry(a: Attempt) {
    if (cur !== a) return;
    cur = undefined;
    if (group.chosen.has(a.slot)) return a.done(group.chosen.get(a.slot)!);
    if (a.tries >= n.num('maxTries', 20)) return a.done('');
    const backoff = n.num('backoffMs', 40) * n.rng.next();
    n.timer(backoff, () => awake(n, () => begin({ ...a, tries: a.tries + 1 })));
  }

  function propose(value: string, done: (ok: boolean) => void) {
    if (cur) return queue.push({ value, done });
    const slot = nextSlot();
    begin({
      slot,
      value,
      tries: 0,
      done: chosen => {
        done(chosen === value);
        const q = queue.shift();
        if (q) propose(q.value, q.done);
      },
    });
  }

  function chosenNow(a: Attempt, v: string) {
    cur = undefined;
    const prev = group.chosen.get(a.slot);
    if (prev === undefined) {
      group.chosen.set(a.slot, v);
      n.log('protocol', `Paxos slot ${a.slot}: value "${v}" chosen (ballot ${ballotText(a.b)} by ${n.name})`);
    } else if (prev !== v) n.anomaly('divergence');
    decided++;
    a.done(v);
  }

  return {
    handles: k => k.startsWith('paxos.'),
    onStart() {
      acceptors = peersOf(n, 'paxos-acceptor');
      const delay = n.num('startDelayMs', 200) + n.rng.next() * n.num('startJitterMs', 5);
      if (n.bool('autoPropose', true)) n.timer(delay, () => propose(n.str('value', n.name), () => {}));
    },
    onRequest(req) {
      n.process(req.msg.weight, n.serviceTime('p50Ms', 'p99Ms', 1, 5), ok => {
        if (!ok) return req.reply({ ok: false, err: '503' });
        propose(`${n.name}#${req.msg.id}`, won => req.reply(won ? { ok: true } : { ok: false, err: 'conflict' }));
      });
    },
    onMessage(msg) {
      awake(n, () => {
        const d = msg.data ?? {};
        maxRound = Math.max(maxRound, Math.floor((d.promised ?? d.b ?? 0) / 1000));
        const a = cur;
        if (!a || d.slot !== a.slot || d.b !== a.b) return;
        if (msg.kind === 'paxos.Nack') return retry(a);
        if (msg.kind === 'paxos.Promise' && a.phase === 1) {
          a.promises.set(msg.from, { an: d.an, av: d.av });
          if (a.promises.size < majority()) return;
          let best: { an: number; av?: string } = { an: 0 };
          for (const p of a.promises.values()) if (p.an > best.an) best = p;
          const v = best.av ?? a.value;
          a.phase = 2;
          for (const acc of acceptors) n.send(acc.id, { kind: 'paxos.Accept', data: { slot: a.slot, b: a.b, v } });
        } else if (msg.kind === 'paxos.Accepted' && a.phase === 2) {
          a.accepted.add(msg.from);
          if (a.accepted.size >= majority()) chosenNow(a, d.v);
        }
      });
    },
    view: () => ({ badges: decided ? [{ text: `✓${decided}`, tone: 'ok' }] : cur ? [{ text: `b${ballotText(cur.b)}`, tone: 'protocol' }] : [], label: 'proposer' }),
  };
}

// ---------- Lock service (lease + fencing tokens) ----------

interface LockGrant {
  holder: Id;
  token: number;
  expiresAt: number;
}
interface LockRegistry {
  /** lockNodeId|resource → current grant */
  grants: Map<string, LockGrant>;
  /** storeId|resource → highest fencing token accepted */
  fences: Map<string, number>;
}
const lockRegistry = (w: World) => groupState<LockRegistry>(w, 'locks', () => ({ grants: new Map(), fences: new Map() }));

/** Fencing check for data stores: false if `token` is older than one already accepted for `resource`. */
export function checkFence(store: SimNode, resource: string | number, token: number): boolean {
  const reg = lockRegistry(store.world);
  const k = `${store.id}|${resource}`;
  const max = reg.fences.get(k) ?? 0;
  if (token < max) return false;
  reg.fences.set(k, token);
  return true;
}

/** Generic store-side handler for fenced writes (any node receiving 'fenced.write'). */
registerKind('fenced.', (n, req) => {
  const d = req.msg.data ?? {};
  n.process(req.msg.weight, n.serviceTime(), ok => {
    if (!ok) return req.reply({ ok: false, err: '503' });
    if (d.fence && !checkFence(n, d.resource, d.token)) {
      n.log('protocol', `${n.name} rejected stale token ${d.token} on ${d.resource} (fenced)`);
      return req.reply({ ok: false, err: 'conflict' });
    }
    const g = lockRegistry(n.world).grants.get(`${d.lock}|${d.resource}`);
    if (!d.fence && g && g.token !== d.token) {
      n.anomaly('double-holder', req.msg.weight);
      n.anomaly('lost-update', req.msg.weight);
      n.log('alert', `${n.world.nodeName(req.msg.from)} wrote ${d.resource} with expired lease (token ${d.token}, current ${g.token})`);
    }
    req.reply({ ok: true });
  });
});

export function lockService(n: SimNode): NodeLogic {
  const reg = lockRegistry(n.world);
  let tokenSeq = 0;
  const key = (r: unknown) => `${n.id}|${r}`;

  function acquire(from: Id, resource: string, ttl: number) {
    const g = reg.grants.get(key(resource));
    const now = n.clock();
    if (g && g.holder !== from && now < g.expiresAt) return undefined;
    if (g && g.holder !== from) n.log('protocol', `Lease on ${resource} expired (${n.world.nodeName(g.holder)})`);
    const grant = { holder: from, token: ++tokenSeq, expiresAt: now + ttl };
    reg.grants.set(key(resource), grant);
    n.log('protocol', `${n.world.nodeName(from)} holds ${resource}, token ${grant.token}`);
    return grant;
  }

  return {
    handles: k => k.startsWith('lock.'),
    onRequest(req) {
      const m = req.msg;
      n.process(m.weight, n.serviceTime('p50Ms', 'p99Ms', 2, 10), ok => {
        if (!ok) return req.reply({ ok: false, err: '503' });
        const d = m.data ?? {};
        const resource = String(d.resource ?? m.key ?? 'r');
        const ttl = n.num('leaseTtlMs', 3000);
        const fence = n.bool('fencing', true);
        if (m.kind === 'lock.release') {
          const g = reg.grants.get(key(resource));
          if (g && g.holder === m.from && g.token === d.token) reg.grants.delete(key(resource));
          return req.reply({ ok: true });
        }
        if (m.kind === 'lock.renew') {
          const g = reg.grants.get(key(resource));
          if (!g || g.holder !== m.from || g.token !== d.token || n.clock() >= g.expiresAt) return req.reply({ ok: false, err: 'conflict' });
          g.expiresAt = n.clock() + ttl;
          return req.reply({ ok: true });
        }
        const g = acquire(m.from, resource, ttl);
        if (!g) return req.reply({ ok: false, err: 'conflict' });
        // plain traffic: acquire-and-release (critical section check)
        if (m.kind === 'req') reg.grants.delete(key(resource));
        req.reply({ ok: true, data: { token: g.token, ttl, fence }, version: g.token });
      });
    },
    view() {
      let held = 0;
      const now = n.clock();
      for (const [k, g] of reg.grants) if (k.startsWith(n.id + '|') && now < g.expiresAt) held++;
      n.gauge('locksHeld', held);
      return { badges: [{ text: `🔒${held}`, tone: 'protocol' }, { text: `tok ${tokenSeq}`, tone: 'muted' }] };
    },
  };
}

/** Worker that loops: acquire lock → work → write protected resource with token → release. */
export function lockClient(n: SimNode): NodeLogic {
  let holding: { token: number; fence: boolean } | undefined;
  let busy = false;
  const lockEdge = () => n.outEdges(e => n.world.nodes.get(e.to)?.type === 'lock-service')[0];
  const storeEdge = () => n.outEdges(e => n.world.nodes.get(e.to)?.type !== 'lock-service')[0];

  function cycle(done: (ok: boolean) => void) {
    const le = lockEdge();
    if (!le || busy) return done(false);
    busy = true;
    const resource = n.str('resource', 'r1');
    const finish = (ok: boolean) => {
      busy = false;
      holding = undefined;
      done(ok);
    };
    n.rpc(le.to, { kind: 'lock.acquire', data: { resource } }, 1000, r => {
      if (!r.ok) return finish(false);
      const { token, fence } = r.data ?? {};
      holding = { token, fence };
      n.timer(n.num('holdMs', 200), () =>
        awake(n, () => {
          const se = storeEdge();
          const release = (ok: boolean) => {
            n.rpc(le.to, { kind: 'lock.release', data: { resource, token } }, 1000, () => {});
            finish(ok);
          };
          if (!se) return release(true);
          n.rpc(se.to, { kind: 'fenced.write', op: 'write', data: { resource, token, fence, lock: le.to } }, 1000, w => release(w.ok));
        }),
      );
    });
  }

  return {
    onStart() {
      const every = n.num('everyMs', 500);
      if (every > 0) n.every(every, () => awake(n, () => cycle(() => {})), 0.3);
    },
    onRequest(req: Req) {
      cycle(ok => req.reply(ok ? { ok: true } : { ok: false, err: 'conflict' }));
    },
    view: () => ({ badges: holding ? [{ text: `🔑${holding.token}`, tone: 'accent' }] : [] }),
  };
}

// ---------- ID generators ----------

interface IdRegistry {
  /** workerId → ts → highest seq issued */
  issued: Map<number, Map<number, number>>;
}

export function idGenerator(n: SimNode): NodeLogic {
  const reg = groupState<IdRegistry>(n.world, 'ids', () => ({ issued: new Map() }));
  const scheme = () => n.str('scheme', 'snowflake');
  let lastTs = -1;
  let seq = 0;
  let counter = 0;
  let issuedCount = 0;

  function snowflake(req: Req) {
    const w = Math.max(1, Math.round(req.msg.weight));
    const worker = n.num('workerId', 1);
    const ts = Math.floor(n.clock());
    if (ts < lastTs) {
      const policy = n.str<string>('onClockBackwards', 'ignore');
      if (policy === 'refuse') return req.reply({ ok: false, err: 'unavailable' });
      if (policy === 'wait') {
        n.timer(lastTs - ts + 1, () => snowflake(req));
        return;
      }
    }
    if (ts === lastTs) {
      if (seq + w > 4096) {
        n.timer(1, () => snowflake(req));
        return;
      }
    } else seq = 0;
    const first = seq;
    seq += w;
    let book = reg.issued.get(worker);
    if (!book) reg.issued.set(worker, (book = new Map()));
    if (ts < lastTs) {
      n.anomaly('out-of-order', w);
      const max = book.get(ts);
      if (max !== undefined && first <= max) n.anomaly('duplicate', Math.min(w, max - first + 1));
    }
    book.set(ts, Math.max(book.get(ts) ?? -1, seq - 1));
    if (book.size > 20000) for (const k of book.keys()) if (k < ts - 10000) book.delete(k);
    lastTs = Math.max(lastTs, ts);
    issuedCount += w;
    req.reply({ ok: true, value: ts * 4194304 + worker * 4096 + first });
  }

  return {
    onRequest(req) {
      n.process(req.msg.weight, n.serviceTime('p50Ms', 'p99Ms', 0.2, 1), ok => {
        if (!ok) return req.reply({ ok: false, err: '503' });
        const s = scheme();
        if (s === 'snowflake') return snowflake(req);
        issuedCount += req.msg.weight;
        if (s === 'ticket') {
          counter += req.msg.weight;
          return req.reply({ ok: true, value: counter });
        }
        req.reply({ ok: true, value: n.rng.nextU32() });
      });
    },
    view() {
      n.gauge('idsIssued', issuedCount);
      return { badges: [{ text: scheme(), tone: 'muted' }], label: scheme() === 'snowflake' ? `w${n.num('workerId', 1)}` : undefined };
    },
  };
}

// ---------- SWIM-lite gossip ----------

type MState = 'alive' | 'suspect' | 'dead';
interface Update {
  id: Id;
  state: MState;
  inc: number;
  left: number;
}
interface GossipGroup {
  views: Map<Id, () => Map<Id, { state: MState; inc: number }>>;
  changeAt?: number;
}

export function gossipMember(n: SimNode): NodeLogic {
  const group = groupState<GossipGroup>(n.world, 'gossip:' + groupOf(n), () => ({ views: new Map() }));
  let peers: SimNode[] = [];
  const view = new Map<Id, { state: MState; inc: number }>();
  let updates: Update[] = [];
  let inc = 0;
  let seq = 0;
  let order: Id[] = [];
  const acks = new Set<number>();
  const suspectTimers = new Map<Id, number>();
  group.views.set(n.id, () => view);

  const short = (id: Id) => n.world.nodeName(id);
  const retransmits = () => 3 * Math.ceil(Math.log2(peers.length + 1));

  function enqueue(id: Id, state: MState, i: number) {
    updates = updates.filter(u => u.id !== id);
    updates.push({ id, state, inc: i, left: retransmits() });
  }

  function piggyback(): Update[] {
    const out = updates.slice(-n.num('piggyback', 6));
    for (const u of out) u.left--;
    updates = updates.filter(u => u.left > 0);
    return out.map(u => ({ ...u }));
  }

  function merge(list: Update[] | undefined) {
    for (const u of list ?? []) apply(u.id, u.state, u.inc);
  }

  function apply(id: Id, state: MState, i: number) {
    if (id === n.id) {
      if (state !== 'alive' && i >= inc) {
        inc = i + 1;
        enqueue(n.id, 'alive', inc);
      }
      return;
    }
    const cur = view.get(id) ?? { state: 'dead' as MState, inc: -1 };
    const rank = { alive: 0, suspect: 1, dead: 2 };
    const newer = i > cur.inc || (i === cur.inc && rank[state] > rank[cur.state]);
    if (!newer || (cur.state === 'dead' && state !== 'alive' && i <= cur.inc)) return;
    if (cur.state === state && cur.inc === i) return;
    view.set(id, { state, inc: i });
    enqueue(id, state, i);
    if (state === 'suspect') {
      const t = n.now;
      suspectTimers.set(id, t);
      n.timer(n.num('suspicionMs', 3000), () => {
        const v = view.get(id);
        if (suspectTimers.get(id) === t && v?.state === 'suspect' && v.inc === i) {
          view.set(id, { state: 'dead', inc: i });
          enqueue(id, 'dead', i);
          n.log('protocol', `${n.name} declares ${short(id)} dead`);
          changed();
        }
      });
    } else suspectTimers.delete(id);
    changed();
  }

  function changed() {
    let alive = 1;
    for (const v of view.values()) if (v.state !== 'dead') alive++;
    n.gauge('membersAlive', alive);
    checkConverged();
  }

  function checkConverged() {
    if (group.changeAt === undefined) return;
    for (const p of peers) {
      if (!p.up) continue;
      const v = group.views.get(p.id)?.();
      if (!v) return;
      for (const q of peers) {
        if (q.id === p.id) continue;
        const s = v.get(q.id)?.state ?? 'dead';
        if (q.up ? s !== 'alive' : s !== 'dead') return;
      }
    }
    const ms = n.now - group.changeAt;
    group.changeAt = undefined;
    n.gauge('convergenceMs', ms);
    n.log('protocol', `Gossip membership converged in ${ms < 1000 ? Math.round(ms) + 'ms' : (ms / 1000).toFixed(1) + 's'}`);
  }

  function nextTarget(): Id | undefined {
    if (!order.length) {
      order = peers.filter(p => p.id !== n.id && view.get(p.id)?.state !== 'dead').map(p => p.id);
      for (let i = order.length - 1; i > 0; i--) {
        const j = n.rng.int(i + 1);
        [order[i], order[j]] = [order[j], order[i]];
      }
    }
    return order.shift();
  }

  function sendG(to: Id, kind: string, data: Record<string, unknown>) {
    const u = piggyback();
    n.send(to, { kind, data: { ...data, u: u.map(x => `${short(x.id)}:${x.state}`) }, updates: u } as Partial<Msg>);
  }

  function probe() {
    if (n.now < n.mods.pausedUntil) return;
    const target = nextTarget();
    if (!target) return;
    const s = ++seq;
    sendG(target, 'gossip.Ping', { seq: s });
    n.timer(n.num('pingTimeoutMs', 200), () => {
      if (acks.has(s)) return;
      const helpers = peers.filter(p => p.id !== n.id && p.id !== target && view.get(p.id)?.state === 'alive');
      for (let k = 0; k < n.num('indirectK', 3) && helpers.length; k++) {
        const h = helpers.splice(n.rng.int(helpers.length), 1)[0];
        sendG(h.id, 'gossip.PingReq', { seq: s, target });
      }
    });
    n.timer(n.num('periodMs', 1000) * 0.9, () => {
      if (acks.delete(s)) return;
      const v = view.get(target);
      if (v?.state === 'alive') {
        n.log('protocol', `${n.name} suspects ${short(target)}`);
        apply(target, 'suspect', v.inc);
      }
    });
  }

  return {
    handles: k => k.startsWith('gossip.'),
    onStart() {
      peers = peersOf(n, n.type);
      for (const p of peers) if (p.id !== n.id && !view.has(p.id)) view.set(p.id, { state: 'alive', inc: 0 });
      changed();
      n.every(n.num('periodMs', 1000), probe, 0.1);
    },
    onKill() {
      group.changeAt ??= n.now;
    },
    onRestart() {
      group.changeAt ??= n.now;
      inc++;
      enqueue(n.id, 'alive', inc);
      for (const p of peers) if (p.id !== n.id) sendG(p.id, 'gossip.Join', { inc });
    },
    onMessage(msg) {
      awake(n, () => {
        const d = msg.data ?? {};
        merge((msg as Msg & { updates?: Update[] }).updates);
        const sender = view.get(msg.from);
        if (!sender || sender.state === 'dead') {
          if (msg.kind === 'gossip.Join' || msg.kind === 'gossip.Ping') apply(msg.from, 'alive', d.inc ?? (sender?.inc ?? 0) + 1);
        }
        switch (msg.kind) {
          case 'gossip.Ping':
            sendG(msg.from, 'gossip.Ack', { seq: d.seq, relay: d.relay });
            break;
          case 'gossip.Ack':
            if (d.relay) sendG(d.relay, 'gossip.Ack', { seq: d.seq });
            else acks.add(d.seq);
            break;
          case 'gossip.PingReq':
            sendG(d.target, 'gossip.Ping', { seq: d.seq, relay: msg.from });
            break;
        }
      });
    },
    view() {
      let alive = 1;
      let suspect = 0;
      for (const v of view.values()) {
        if (v.state !== 'dead') alive++;
        if (v.state === 'suspect') suspect++;
      }
      const badges: Badge[] = [{ text: `${alive}/${peers.length}`, tone: 'protocol' }];
      if (suspect) badges.push({ text: `?${suspect}`, tone: 'warn' });
      return { badges };
    },
  };
}

register('paxos-proposer', paxosProposer);
register('paxos-acceptor', paxosAcceptor);
register('lock-service', lockService);
register('lock-client', lockClient);
register('id-generator', idGenerator);
register('gossip-member', gossipMember);
