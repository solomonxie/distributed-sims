// ZooKeeper / etcd internals: an ensemble (Raft from raft.ts standing in for ZAB) plus the coordination
// layer on top — znodes/keys, one-shot watches, sessions/leases with ephemeral nodes, zxid/revision ordering —
// and clients running the leader-election recipe (lowest sequential znode wins).
// Protocol kinds: zk.connect / zk.create / zk.children / zk.exists / zk.ping (client → server rpc), zk.watch (server → client).
import type { NodeLogic, Req, SimNode } from '../node';
import type { Badge, Id, Msg, Reply } from '../types';
import { register } from './registry';
import { awake, consensusMember, groupOf, groupState, raftLeader } from './raft';

interface Session {
  client: Id;
  proc: number;
  server: Id;
  lastSeen: number;
  timeoutMs: number;
  expired: boolean;
  closing: boolean;
}

interface Ensemble {
  /** path → owning session for ephemerals (0 = persistent) */
  nodes: Map<string, { owner: number; zxid: number }>;
  seq: Map<string, number>;
  sessions: Map<number, Session>;
  nextSid: number;
  childWatches: Map<string, Set<number>>;
  dataWatches: Map<string, Set<number>>;
  epoch: number;
  counter: number;
  rev: number;
  lastWake: number;
  watchEvents: number;
  acting: Map<string, number>;
  logged: number;
}

const ensemble = (n: SimNode) =>
  groupState<Ensemble>(n.world, 'zk:' + groupOf(n), () => ({
    nodes: new Map(),
    seq: new Map(),
    sessions: new Map(),
    nextSid: 0,
    childWatches: new Map(),
    dataWatches: new Map(),
    epoch: 0,
    counter: 0,
    rev: 0,
    lastWake: 0,
    watchEvents: 0,
    acting: new Map(),
    logged: 0,
  }));

const isEtcd = (n: SimNode) => n.str('flavor', 'zookeeper') === 'etcd';
const pad = (x: number) => String(x).padStart(10, '0');
const parentOf = (path: string) => path.slice(0, path.lastIndexOf('/')) || '/';
/** zxid = epoch << 32 | counter (ZooKeeper); etcd uses one global revision */
const zxidNum = (e: Ensemble, etcd: boolean) => (etcd ? e.rev : e.epoch * 2 ** 32 + e.counter);
const zxidText = (z: number, etcd: boolean) => (etcd ? `rev ${z}` : `zxid 0x${Math.floor(z / 2 ** 32).toString(16)}${(z % 2 ** 32).toString(16).padStart(8, '0')}`);

// ---------- server ----------
register('zk-server', n => {
  const raft = consensusMember(n);
  const e = ensemble(n);
  const etcd = isEtcd(n);
  let wasLeader = false;
  const sessionWord = etcd ? 'lease' : 'session';

  const fire = (set: Set<number> | undefined, path: string, type: string, zxid: number) => {
    if (!set?.size) return 0;
    const sids = [...set];
    set.clear();
    for (const sid of sids) {
      const s = e.sessions.get(sid);
      const srv = s && n.world.nodes.get(s.server);
      if (!s || s.expired || !srv?.up) continue;
      srv.send(s.client, { kind: 'zk.watch', data: { proc: s.proc, path, type, zxid } });
    }
    e.watchEvents += sids.length;
    return sids.length;
  };

  const removeNode = (path: string, zxid: number) => {
    e.nodes.delete(path);
    return fire(e.childWatches.get(parentOf(path)), parentOf(path), 'NodeChildrenChanged', zxid) + fire(e.dataWatches.get(path), path, 'NodeDeleted', zxid);
  };

  /** Apply a committed transaction to the shared tree (every member applies the same log). */
  const apply = (op: string, d: any): Reply => {
    const term = raftLeader(n.world, groupOf(n))?.term ?? e.epoch;
    if (term !== e.epoch) {
      e.epoch = term;
      e.counter = 0;
    }
    e.counter++;
    e.rev++;
    const zxid = zxidNum(e, etcd);
    switch (op) {
      case 'session': {
        const sid = ++e.nextSid;
        e.sessions.set(sid, { client: d.client, proc: d.proc, server: n.id, lastSeen: n.now, timeoutMs: d.timeoutMs, expired: false, closing: false });
        return { ok: true, data: { sid, zxid } };
      }
      case 'create': {
        const parent: string = d.path;
        const seq = (e.seq.get(parent) ?? 0) + 1;
        e.seq.set(parent, seq);
        const name = `n_${pad(seq)}`;
        const path = `${parent}/${name}`;
        e.nodes.set(path, { owner: d.ephemeral ? d.sid : 0, zxid });
        const woke = fire(e.childWatches.get(parent), parent, 'NodeChildrenChanged', zxid) + fire(e.dataWatches.get(path), path, 'NodeCreated', zxid);
        if (woke) e.lastWake = woke;
        return { ok: true, data: { name, zxid } };
      }
      case 'close': {
        const s = e.sessions.get(d.sid);
        if (!s || s.expired) return { ok: true };
        s.expired = true;
        s.closing = false;
        const mine = [...e.nodes].filter(([, v]) => v.owner === d.sid).map(([p]) => p);
        let woke = 0;
        for (const p of mine) woke += removeNode(p, zxid);
        e.lastWake = woke;
        n.log(
          'protocol',
          `${sessionWord} 0x${d.sid.toString(16)} (${n.world.nodeName(s.client)}) expired after ${s.timeoutMs / 1000}s: ephemeral ${mine.join(', ') || '(none)'} deleted, ${woke} watcher(s) notified (${zxidText(zxid, etcd)})`,
        );
        return { ok: true };
      }
    }
    return { ok: false, err: '5xx' };
  };

  /** Replicate through the leader, then apply. */
  const commit = (op: string, d: any, key: number, cb: (r: Reply) => void, traceId?: number) => {
    const msg = n.world.newMsg({ from: n.id, to: n.id, kind: 'zk.txn', op: 'write', key: key % 1024, weight: 1, traceId });
    raft.onRequest!({ msg, at: n.now, reply: r => cb(r.ok ? apply(op, d) : { ok: false, err: r.err ?? 'unavailable' }) });
  };

  const expiry = () => {
    const leader = raftLeader(n.world, groupOf(n))?.id === n.id;
    // a new leader gives every session a fresh timeout
    if (leader && !wasLeader) for (const s of e.sessions.values()) s.lastSeen = n.now;
    wasLeader = leader;
    if (!leader || n.now < n.mods.pausedUntil) return;
    for (const [sid, s] of e.sessions) {
      if (s.expired || s.closing || n.now - s.lastSeen <= s.timeoutMs) continue;
      s.closing = true;
      commit('close', { sid }, sid, r => {
        if (!r.ok) s.closing = false;
      });
    }
  };

  const zk = (req: Req) => {
    const m = req.msg;
    const d = m.data ?? {};
    n.process(1, n.serviceTime('p50Ms', 'p99Ms', 1, 5), ok => {
      if (!ok) return req.reply({ ok: false, err: '503' });
      awake(n, () => {
        switch (m.kind) {
          case 'zk.connect':
            return commit('session', { client: m.from, proc: d.proc, timeoutMs: d.timeoutMs }, m.id, r => req.reply(r), m.traceId);
          case 'zk.create':
            return commit('create', d, m.id, r => req.reply(r), m.traceId);
          case 'zk.ping': {
            const s = e.sessions.get(d.sid);
            if (!s || s.expired) return req.reply({ ok: false, err: 'auth' });
            s.lastSeen = n.now;
            s.server = n.id;
            return req.reply({ ok: true });
          }
          case 'zk.children': {
            const prefix = d.path + '/';
            const children = [...e.nodes.keys()].filter(p => p.startsWith(prefix)).map(p => p.slice(prefix.length)).sort();
            if (d.watch) {
              if (!e.childWatches.has(d.path)) e.childWatches.set(d.path, new Set());
              e.childWatches.get(d.path)!.add(d.sid);
            }
            return req.reply({ ok: true, data: { children } });
          }
          case 'zk.exists': {
            const exists = e.nodes.has(d.path);
            if (d.watch && exists) {
              if (!e.dataWatches.has(d.path)) e.dataWatches.set(d.path, new Set());
              e.dataWatches.get(d.path)!.add(d.sid);
            }
            return req.reply({ ok: true, data: { exists } });
          }
        }
        req.reply({ ok: false, err: '5xx' });
      });
    });
  };

  return {
    handles: raft.handles,
    onStart() {
      raft.onStart?.();
      n.every(250, expiry);
      n.every(1000, () => {
        n.gauge('sessions', [...e.sessions.values()].filter(s => !s.expired).length);
        n.gauge('znodes', e.nodes.size);
        n.gauge('epoch', raftLeader(n.world, groupOf(n))?.term ?? e.epoch);
        n.gauge('zxid', e.counter);
        n.gauge('lastWake', e.lastWake);
        n.gauge('watchEvents', e.watchEvents);
      });
    },
    onRequest(req: Req) {
      if (req.msg.kind.startsWith('zk.')) zk(req);
      else raft.onRequest!(req);
    },
    onMessage: raft.onMessage,
    onKill: raft.onKill,
    onRestart: raft.onRestart,
    onChaos: raft.onChaos,
    view() {
      const v = raft.view!();
      const conn = [...e.sessions.values()].filter(s => !s.expired && s.server === n.id).length;
      return { badges: [...(v.badges ?? []), ...(conn ? [{ text: `${conn} sess`, tone: 'muted' as const }] : [])], label: v.label };
    },
  };
});

// ---------- client running the leader-election recipe ----------
type ProcState = 'connecting' | 'electing' | 'waiting' | 'leader';
interface Proc {
  i: number;
  gen: number;
  state: ProcState;
  sid?: number;
  me?: string;
  server: number;
  lastPing: number;
  lastWork: number;
  lastZxid: number;
  wakeups: number;
}

register('zk-app', n => {
  let procs: Proc[] = [];
  let say = new Map<string, number>();
  const e = () => {
    const s = servers()[0];
    return s ? ensemble(s) : undefined;
  };
  /** every ensemble member, the ones this client has edges to first */
  const servers = (): SimNode[] => {
    const all = [...n.world.nodes.values()].filter(x => x.type === 'zk-server');
    const out = new Set(n.outEdges().map(x => x.to));
    return [...all.filter(x => out.has(x.id)), ...all.filter(x => !out.has(x.id))];
  };
  const etcd = () => !!servers()[0] && isEtcd(servers()[0]);
  const timeoutMs = () => n.num('sessionTimeoutMs', 4000);
  const herd = () => n.str('recipe', 'predecessor') === 'herd';
  const nameOf = (p: Proc) => (n.num('procs', 1) > 1 ? `${n.name}#${p.i + 1}` : n.name);
  const paused = () => n.now < n.mods.pausedUntil;
  const once = (key: string, ms: number, kind: 'info' | 'protocol', text: string) => {
    if (n.now - (say.get(key) ?? -Infinity) < ms) return;
    say.set(key, n.now);
    n.log(kind, text);
  };
  const logFew = (text: string) => {
    const en = e();
    if (en && en.logged++ < 40) n.log('protocol', text);
  };

  const call = (p: Proc, kind: string, data: Record<string, unknown>, cb: (r: Reply) => void) => {
    const g = p.gen;
    const srv = servers()[p.server % Math.max(1, servers().length)];
    if (!srv) return;
    n.rpc(srv.id, { kind, data: { ...data, sid: p.sid, proc: p.i } }, n.num('opTimeoutMs', 1000), r =>
      awake(n, () => {
        if (p.gen !== g) return;
        const z = r.data?.zxid;
        if (typeof z === 'number') {
          if (z < p.lastZxid) n.anomaly('out-of-order');
          p.lastZxid = Math.max(p.lastZxid, z);
        }
        cb(r);
      }),
    );
  };

  const retry = (p: Proc, fn: () => void) => {
    const g = p.gen;
    n.timer(500, () => p.gen === g && fn());
  };

  const failover = (p: Proc, why: string) => {
    const list = servers();
    p.server = (p.server + 1) % Math.max(1, list.length);
    once('conn:' + p.i, 2000, 'info', `${nameOf(p)}: ${why} → reconnecting to ${list[p.server]?.name ?? '?'} (${etcd() ? 'lease' : 'session'} kept if back within ${timeoutMs() / 1000}s)`);
  };

  const connect = (p: Proc) => {
    p.state = 'connecting';
    call(p, 'zk.connect', { timeoutMs: timeoutMs() }, r => {
      if (!r.ok) {
        if (r.err === 'timeout') failover(p, 'no answer');
        return retry(p, () => connect(p));
      }
      p.sid = r.data.sid;
      p.lastPing = n.now;
      elect(p);
    });
  };

  const elect = (p: Proc) => {
    p.state = 'electing';
    call(p, 'zk.create', { path: '/election', ephemeral: true }, r => {
      if (!r.ok) return retry(p, () => elect(p));
      p.me = r.data.name;
      logFew(`${nameOf(p)} created ephemeral sequential /election/${p.me} (${zxidText(r.data.zxid, etcd())})`);
      check(p);
    });
  };

  const check = (p: Proc) => {
    call(p, 'zk.children', { path: '/election', watch: herd() }, r => {
      if (!r.ok) return retry(p, () => check(p));
      const kids: string[] = r.data.children;
      const idx = kids.indexOf(p.me!);
      if (idx < 0) return;
      if (idx === 0) {
        if (p.state !== 'leader') {
          p.state = 'leader';
          p.lastWork = n.now;
          n.log('protocol', `👑 ${nameOf(p)} is leader (lowest znode /election/${p.me})`);
        }
        return;
      }
      p.state = 'waiting';
      if (herd()) return;
      const pred = kids[idx - 1];
      call(p, 'zk.exists', { path: `/election/${pred}`, watch: true }, r2 => {
        if (!r2.ok) return retry(p, () => check(p));
        if (!r2.data.exists) check(p);
      });
    });
  };

  const expired = (p: Proc) => {
    if (p.state === 'leader') n.log('protocol', `${nameOf(p)}: ${etcd() ? 'lease' : 'session'} expired — it is NOT the leader any more; re-joining the election`);
    p.gen++;
    p.sid = undefined;
    p.me = undefined;
    connect(p);
  };

  const tick = () => {
    if (paused()) return;
    const en = e();
    for (const p of procs) {
      // a paused process resumes mid-work: it acts before it learns anything new
      if (p.state === 'leader' && en && n.now - p.lastWork >= n.num('workMs', 500)) {
        p.lastWork = n.now;
        const me = n.id + '#' + p.i;
        en.acting.set(me, n.now);
        const others = [...en.acting].filter(([k, t]) => k !== me && n.now - t < n.num('workMs', 500) * 1.5);
        if (others.length) {
          n.anomaly('double-holder');
          const other = n.world.nodeName(others[0][0].split('#')[0]);
          once('dbl', 3000, 'info', `Two leaders at once: ${nameOf(p)} and ${other} both act as leader (fence writes with the znode's zxid)`);
        }
      }
      if (p.sid !== undefined && n.now - p.lastPing >= timeoutMs() / 3) {
        p.lastPing = n.now;
        call(p, 'zk.ping', {}, r => {
          if (r.ok) return;
          if (r.err === 'auth') expired(p);
          else if (r.err === 'timeout') failover(p, 'connection loss');
        });
      }
    }
    n.gauge('leaders', procs.filter(p => p.state === 'leader').length);
    n.gauge('wakeups', procs.reduce((a, p) => a + p.wakeups, 0));
  };

  return {
    onStart() {
      say = new Map();
      const k = Math.max(1, Math.round(n.num('procs', 1)));
      procs = Array.from({ length: k }, (_, i) => ({ i, gen: 0, state: 'connecting' as ProcState, server: i, lastPing: 0, lastWork: 0, lastZxid: 0, wakeups: 0 }));
      if (n.bool('elect', true)) n.timer(n.num('startDelayMs', 500), () => procs.forEach(p => connect(p)));
      n.every(100, tick);
    },
    // app traffic: plain reads/writes through the server this client is connected to
    onRequest(req: Req) {
      const p = procs[0];
      const srv = p && servers()[p.server % Math.max(1, servers().length)];
      if (!srv) return req.reply({ ok: false, err: 'unavailable' });
      const m = req.msg;
      n.rpc(srv.id, { kind: 'req', op: m.op, key: m.key, value: m.value, weight: m.weight, traceId: m.traceId }, n.num('opTimeoutMs', 1000), r => {
        // reads are answered locally, so a read timeout means the server itself is gone
        if (!r.ok && r.err === 'timeout' && m.op !== 'write' && servers()[p.server % servers().length] === srv) failover(p, 'no answer');
        req.reply(r);
      });
    },
    onMessage(m: Msg) {
      if (m.kind !== 'zk.watch') return;
      const p = procs[m.data.proc];
      if (!p) return;
      awake(n, () => {
        p.wakeups++;
        // also when a getChildren reply is still in flight: the one-shot watch is already used up
        if (p.me && p.state !== 'leader') {
          if (p.i === 0 || !herd()) logFew(`${nameOf(p)} woke up: ${m.data.type} ${m.data.path}`);
          check(p);
        }
      });
    },
    onKill() {
      procs.forEach(p => p.gen++);
    },
    view() {
      const lead = procs.filter(p => p.state === 'leader').length;
      const b: Badge[] = [];
      if (lead) b.push({ text: '👑', tone: 'accent' });
      if (procs.length > 1) b.push({ text: `×${procs.length}`, tone: 'muted' });
      const me = procs[0]?.me;
      if (procs.length === 1 && me) b.push({ text: me.replace(/^n_0+/, 'n_'), tone: 'protocol' });
      return { badges: b, label: lead ? 'leader' : procs.some(p => p.state === 'waiting') ? 'standby' : 'joining' };
    },
  };
});

export {};
