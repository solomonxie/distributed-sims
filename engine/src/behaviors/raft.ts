// Raft consensus member (etcd / ZooKeeper / Consul skins).
import type { Scheduled } from '../kernel';
import type { NodeLogic, Req, SimNode } from '../node';
import type { Badge, Id, Msg } from '../types';
import type { World } from '../world';
import { register } from './registry';

// ---------- shared helpers for coordination behaviours ----------

const shared = new WeakMap<World, Map<string, unknown>>();

/** Per-world shared state (group registries, ground truth for anomaly checks). */
export function groupState<T>(w: World, key: string, init: () => T): T {
  let m = shared.get(w);
  if (!m) shared.set(w, (m = new Map()));
  if (!m.has(key)) m.set(key, init());
  return m.get(key) as T;
}

/** Run fn now, or when the node's GC pause ends. */
export function awake(n: SimNode, fn: () => void) {
  const wait = n.mods.pausedUntil - n.now;
  if (wait > 0) n.timer(wait, () => awake(n, fn));
  else fn();
}

export function groupOf(n: SimNode) {
  return n.str('group', 'g1');
}

/** All nodes of `type` in the same `group` as n (including n). */
export function peersOf(n: SimNode, type: string): SimNode[] {
  const g = groupOf(n);
  return [...n.world.nodes.values()].filter(x => x.type === type && groupOf(x) === g);
}

// ---------- Raft ----------

export type Role = 'follower' | 'candidate' | 'leader';

export interface Entry {
  term: number;
  w: number;
  key?: number;
  value?: number;
  noop?: boolean;
  /** the traced request that wrote it */
  traceId?: number;
}

interface RaftMsg extends Msg {
  entries?: Entry[];
}

export interface RaftView {
  id: Id;
  role: Role;
  term: number;
  commit: number;
  lastIndex: number;
  log: Entry[];
  up: boolean;
}

interface RaftGroup {
  /** latest committed log index per key (for stale-read detection) */
  truth: Map<number, number>;
  leaderOfTerm: Map<number, Id>;
  members: Map<Id, () => RaftView>;
  elections: number;
  dropVotes: boolean;
}

const raftGroup = (n: SimNode) =>
  groupState<RaftGroup>(n.world, 'raft:' + groupOf(n), () => ({
    truth: new Map(),
    leaderOfTerm: new Map(),
    members: new Map(),
    elections: 0,
    dropVotes: false,
  }));

/** Inspect a member's Raft state (tests, UI panels). */
export function raftState(w: World, id: Id): RaftView | undefined {
  const n = w.nodes.get(id);
  if (!n) return undefined;
  return groupState<RaftGroup | undefined>(w, 'raft:' + groupOf(n), () => undefined)?.members.get(id)?.();
}

/** Current leader of a group (highest-term live leader). */
export function raftLeader(w: World, group = 'g1'): RaftView | undefined {
  const g = groupState<RaftGroup | undefined>(w, 'raft:' + group, () => undefined);
  let best: RaftView | undefined;
  for (const f of g?.members.values() ?? []) {
    const v = f();
    if (v.up && v.role === 'leader' && (!best || v.term > best.term)) best = v;
  }
  return best;
}

interface Pending {
  req: Req;
  at: number;
}

export function consensusMember(n: SimNode): NodeLogic {
  const group = raftGroup(n);
  let members: SimNode[] = [];
  let others: SimNode[] = [];
  const majority = () => Math.floor(members.length / 2) + 1;

  // persistent
  let term = 0;
  let votedFor: Id | undefined;
  const log: Entry[] = [{ term: 0, w: 0, noop: true }];
  // volatile
  let commit = 0;
  let applied = 0;
  const kv = new Map<number, { value?: number; ver: number }>();
  let role: Role = 'follower';
  let leader: Id | undefined;
  let votes = new Set<Id>();
  let electionTimer: Scheduled | undefined;
  let electionGen = 0;
  // leader
  const next = new Map<Id, number>();
  const match = new Map<Id, number>();
  const acked = new Map<Id, number>();
  const sentUpTo = new Map<Id, number>();
  const roundAt = new Map<number, number>();
  let round = 0;
  let leaseUntil = -Infinity;
  let flushPending = false;
  const waitingWrites = new Map<number, Pending[]>();
  let waitingReads: (Pending & { round: number; index: number })[] = [];
  let killedLeader: SimNode | undefined;

  const lastIdx = () => log.length - 1;
  const heartbeatMs = () => n.num('heartbeatMs', 50);
  const electionMin = () => n.num('electionMinMs', 150);
  const electionMax = () => Math.max(electionMin(), n.num('electionMaxMs', 300));
  const pendingTimeout = () => n.num('commitTimeoutMs', 2000);

  group.members.set(n.id, () => ({ id: n.id, role, term, commit, lastIndex: lastIdx(), log, up: n.up }));

  function resetElection() {
    if (electionTimer) electionTimer.cancelled = true;
    const gen = ++electionGen;
    const t = electionMin() + n.rng.next() * (electionMax() - electionMin());
    electionTimer = n.timer(t, () => awake(n, () => gen === electionGen && startElection()));
  }

  function stopElectionTimer() {
    electionGen++;
    if (electionTimer) electionTimer.cancelled = true;
  }

  function startElection() {
    if (role === 'leader') return;
    term++;
    role = 'candidate';
    votedFor = n.id;
    votes = new Set([n.id]);
    leader = undefined;
    group.elections++;
    n.log('protocol', `${n.name} starts election, term ${term}`);
    resetElection();
    if (votes.size >= majority()) return becomeLeader();
    for (const p of others) n.send(p.id, { kind: 'raft.RequestVote', data: { term, lastIdx: lastIdx(), lastTerm: log[lastIdx()].term } });
  }

  function becomeLeader() {
    role = 'leader';
    leader = n.id;
    stopElectionTimer();
    const prev = group.leaderOfTerm.get(term);
    if (prev && prev !== n.id) n.anomaly('divergence');
    group.leaderOfTerm.set(term, n.id);
    n.log('protocol', `${n.name} elected leader, term ${term}`);
    for (const p of others) {
      next.set(p.id, lastIdx() + 1);
      match.set(p.id, 0);
      acked.set(p.id, 0);
    }
    roundAt.clear();
    leaseUntil = -Infinity;
    log.push({ term, w: 0, noop: true });
    broadcast();
  }

  function stepDown(newTerm: number) {
    const wasLeader = role === 'leader';
    term = newTerm;
    votedFor = undefined;
    role = 'follower';
    leader = undefined;
    if (wasLeader) {
      n.log('protocol', `${n.name} steps down, term ${newTerm}`);
      failPending();
      resetElection();
    }
  }

  function failPending() {
    for (const list of waitingWrites.values()) for (const p of list) p.req.reply({ ok: false, err: 'unavailable' });
    waitingWrites.clear();
    for (const p of waitingReads) p.req.reply({ ok: false, err: 'unavailable' });
    waitingReads = [];
  }

  function upToDate(lastTerm: number, idx: number) {
    const myTerm = log[lastIdx()].term;
    return lastTerm > myTerm || (lastTerm === myTerm && idx >= lastIdx());
  }

  function broadcast() {
    if (role !== 'leader') return;
    round++;
    roundAt.set(round, n.clock());
    if (roundAt.size > 64) roundAt.delete(roundAt.keys().next().value!);
    for (const p of others) sendAppend(p.id);
    if (!others.length) advanceCommit();
  }

  function sendAppend(to: Id) {
    const ni = next.get(to) ?? lastIdx() + 1;
    const prev = ni - 1;
    const entries = log.slice(ni, ni + n.num('maxBatch', 256));
    sentUpTo.set(to, prev + entries.length);
    n.send(to, {
      kind: 'raft.AppendEntries',
      traceId: entries.find(e => e.traceId !== undefined)?.traceId,
      data: { term, prev, n: entries.length, commit, pt: log[prev].term, round },
      entries,
    } as Partial<RaftMsg>);
  }

  function flush() {
    if (flushPending) return;
    flushPending = true;
    n.timer(n.num('batchMs', 1), () => {
      flushPending = false;
      broadcast();
    });
  }

  function advanceCommit() {
    for (let i = lastIdx(); i > commit; i--) {
      if (log[i].term !== term) break;
      let count = 1;
      for (const p of others) if ((match.get(p.id) ?? 0) >= i) count++;
      if (count >= majority()) {
        commit = i;
        apply();
        break;
      }
    }
  }

  function apply() {
    while (applied < commit) {
      applied++;
      const e = log[applied];
      if (e.key !== undefined) {
        kv.set(e.key, { value: e.value, ver: applied });
        if ((group.truth.get(e.key) ?? 0) < applied) group.truth.set(e.key, applied);
      }
      const list = waitingWrites.get(applied);
      if (list) {
        waitingWrites.delete(applied);
        for (const p of list) p.req.reply({ ok: true, version: applied, value: e.value });
      }
    }
  }

  /** Highest broadcast round acknowledged by a majority (leader counts itself). */
  function majorityRound() {
    const rs = [round, ...others.map(p => acked.get(p.id) ?? 0)].sort((a, b) => b - a);
    return rs[majority() - 1] ?? 0;
  }

  function onAcked() {
    const r = majorityRound();
    const sentAt = roundAt.get(r);
    if (sentAt !== undefined) leaseUntil = Math.max(leaseUntil, sentAt + electionMin() * n.num('leaseRatio', 0.9));
    const now = n.now;
    const ready = log[commit].term === term;
    waitingReads = waitingReads.filter(p => {
      if (now - p.at > pendingTimeout()) return false;
      if (!ready || r < p.round || applied < p.index) return true;
      replyRead(p.req);
      return false;
    });
  }

  function replyRead(req: Req) {
    const k = req.msg.key ?? 0;
    const v = kv.get(k);
    const ver = v?.ver ?? 0;
    const stale = ver < (group.truth.get(k) ?? 0);
    if (stale) n.anomaly('stale-read', req.msg.weight);
    req.reply({ ok: true, value: v?.value, version: ver, stale });
  }

  function handle(msg: RaftMsg) {
    const d = msg.data ?? {};
    const isVote = msg.kind === 'raft.RequestVote' || msg.kind === 'raft.RequestVoteReply';
    if (isVote && group.dropVotes) return;
    if (typeof d.term === 'number' && d.term > term) stepDown(d.term);
    switch (msg.kind) {
      case 'raft.RequestVote': {
        const granted = d.term === term && (!votedFor || votedFor === msg.from) && upToDate(d.lastTerm, d.lastIdx);
        if (granted) {
          votedFor = msg.from;
          resetElection();
        }
        n.send(msg.from, { kind: 'raft.RequestVoteReply', data: { term, granted } });
        return;
      }
      case 'raft.RequestVoteReply': {
        if (role !== 'candidate' || d.term !== term || !d.granted) return;
        votes.add(msg.from);
        if (votes.size >= majority()) becomeLeader();
        return;
      }
      case 'raft.AppendEntries': {
        if (d.term < term) {
          n.send(msg.from, { kind: 'raft.AppendEntriesReply', data: { term, ok: false, match: 0, hint: lastIdx(), round: d.round } });
          return;
        }
        if (role !== 'follower') {
          if (role === 'leader') failPending();
          role = 'follower';
        }
        if (leader !== msg.from) {
          leader = msg.from;
          n.log('info', `${n.name} follows ${n.world.nodeName(msg.from)}, term ${term}`);
        }
        resetElection();
        const prev: number = d.prev;
        if (prev > lastIdx() || log[prev].term !== d.pt) {
          let hint = Math.min(lastIdx(), prev - 1);
          if (prev <= lastIdx()) {
            const ct = log[prev].term;
            let i = prev;
            while (i > 1 && log[i - 1].term === ct) i--;
            hint = Math.max(0, i - 1);
          }
          n.send(msg.from, { kind: 'raft.AppendEntriesReply', data: { term, ok: false, hint, round: d.round } });
          return;
        }
        const entries = msg.entries ?? [];
        for (let j = 0; j < entries.length; j++) {
          const idx = prev + 1 + j;
          if (idx <= lastIdx() && log[idx].term !== entries[j].term) {
            if (idx <= commit) n.anomaly('divergence');
            log.length = idx;
          }
          if (idx > lastIdx()) log.push(entries[j]);
        }
        const lastNew = prev + entries.length;
        if (d.commit > commit) {
          commit = Math.max(commit, Math.min(d.commit, lastNew));
          apply();
        }
        n.send(msg.from, { kind: 'raft.AppendEntriesReply', traceId: msg.traceId, data: { term, ok: true, match: lastNew, round: d.round } });
        return;
      }
      case 'raft.AppendEntriesReply': {
        if (role !== 'leader' || d.term !== term) return;
        const from = msg.from;
        acked.set(from, Math.max(acked.get(from) ?? 0, d.round ?? 0));
        if (d.ok) {
          const m = Math.max(match.get(from) ?? 0, d.match);
          match.set(from, m);
          next.set(from, m + 1);
          advanceCommit();
          if (m < lastIdx() && (sentUpTo.get(from) ?? 0) <= m) sendAppend(from);
        } else {
          const ni = next.get(from) ?? lastIdx() + 1;
          next.set(from, Math.max(1, Math.min(ni - 1, (d.hint ?? 0) + 1)));
          sendAppend(from);
        }
        onAcked();
        return;
      }
    }
  }

  function forward(req: Req) {
    const hops = req.msg.data?.fwd ?? 0;
    if (!leader || leader === n.id || hops >= 2) return req.reply({ ok: false, err: 'unavailable' });
    const m = req.msg;
    n.rpc(
      leader,
      { kind: 'raft.Forward', op: m.op, key: m.key, value: m.value, weight: m.weight, traceId: m.traceId, data: { op: m.op, key: m.key, fwd: hops + 1 } },
      n.num('forwardTimeoutMs', pendingTimeout()),
      r => req.reply(r),
    );
  }

  function serve(req: Req) {
    const m = req.msg;
    const pend = (): Pending => {
      n.timer(pendingTimeout(), () => req.reply({ ok: false, err: 'timeout' }));
      return { req, at: n.now };
    };
    if (m.op === 'write') {
      if (role !== 'leader') return forward(req);
      log.push({ term, w: m.weight, key: m.key ?? 0, value: m.value ?? m.id, traceId: m.traceId });
      const idx = lastIdx();
      const list = waitingWrites.get(idx) ?? [];
      list.push(pend());
      waitingWrites.set(idx, list);
      flush();
      return;
    }
    const mode = n.str<string>('reads', 'linearizable');
    if (mode === 'stale') return replyRead(req);
    if (role !== 'leader') return forward(req);
    if (mode === 'lease' && n.clock() < leaseUntil && log[commit].term === term) return replyRead(req);
    waitingReads.push({ ...pend(), round: round + 1, index: commit });
    flush();
  }

  return {
    handles: kind => kind.startsWith('raft.'),
    onStart() {
      members = peersOf(n, n.type);
      others = members.filter(p => p.id !== n.id);
      resetElection();
      n.every(heartbeatMs(), () => {
        if (role === 'leader' && n.now >= n.mods.pausedUntil) broadcast();
      });
      n.every(1000, () => {
        n.gauge('term', term);
        n.gauge('commitIndex', commit);
        n.gauge('logLen', lastIdx());
        n.gauge('isLeader', role === 'leader' ? 1 : 0);
        n.gauge('elections', group.elections);
      });
    },
    onRequest(req) {
      n.process(req.msg.weight, n.serviceTime('p50Ms', 'p99Ms', 1, 5), ok => {
        if (!ok) return req.reply({ ok: false, err: '503' });
        serve(req);
      });
    },
    onMessage(msg) {
      awake(n, () => handle(msg as RaftMsg));
    },
    onKill() {
      waitingWrites.clear();
      waitingReads = [];
    },
    onRestart() {
      role = 'follower';
      leader = undefined;
      votes = new Set();
      flushPending = false;
    },
    onChaos(kind, _p, heal) {
      if (kind === 'kill-leader') {
        if (heal) {
          killedLeader?.restart();
          killedLeader = undefined;
          return true;
        }
        const l = raftLeader(n.world, groupOf(n));
        if (l) {
          killedLeader = n.world.nodes.get(l.id);
          killedLeader?.kill();
          n.log('protocol', `Leader ${n.world.nodeName(l.id)} killed (term ${l.term})`);
        } else n.log('protocol', `No leader to kill in group ${groupOf(n)}`);
        return true;
      }
      if (kind === 'drop-votes') {
        group.dropVotes = !heal;
        return true;
      }
      return false;
    },
    view() {
      const badges: Badge[] = [];
      if (role === 'leader') badges.push({ text: '👑', tone: 'accent' });
      badges.push({ text: `T${term}`, tone: 'protocol' });
      badges.push({ text: `c${commit}`, tone: 'muted' });
      return { badges, label: role };
    },
  };
}

register('consensus-member', consensusMember);
