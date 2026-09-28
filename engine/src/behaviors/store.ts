// Data core: relational-db, document-db (primary + replicas), kv-store (Dynamo-style quorum).
import { register } from './registry';
import type { NodeLogic, Req, SimNode } from '../node';
import type { Badge } from '../types';
import { KEYS, KeyStore, Replica, Truth, keyOf, mix32, registerTruth, type Rec } from '../data/keystore';
import { Pool } from '../data/pool';

type Flavor = 'sql' | 'doc';
type ReadSrc = { replica: number; extraMs: number };

/**
 * Primary with N replicas modelled inside one node. Replicas are FIFO copies
 * with lag; commit waits for `need` replica acks (async 0, semi-sync 1,
 * majority, sync all). Reads route by readFrom + consistency level.
 */
function primaryReplica(n: SimNode, flavor: Flavor): NodeLogic {
  const sql = flavor === 'sql';
  const count = Math.max(0, Math.round(n.num(sql ? 'replicas' : 'secondaries', 2)));
  let primary = new KeyStore();
  const replicas: Replica[] = Array.from({ length: count }, () => new Replica());
  const pools = replicas.map(() => new Pool(n, Math.max(1, Math.round(n.num('slots', 16)))));
  const truth = new Truth();
  const lastWrite = new Float64Array(KEYS);
  const locks = new Map<number, (() => void)[]>();
  let blocked: (() => void)[] = [];
  let seq = 0;
  let extraLagMs = 0;
  let primaryUp = true;
  let failoverToken = 0;
  let schemaLock = false;
  let lockWaitW = 0;
  let lostW = 0;
  // split brain: a replica cut off and promoted on the other side
  let rogue: { idx: number; keys: Set<number> } | undefined;

  const mode = sql ? n.str('replication', 'async') : n.str('writeConcern', 'w1') === 'majority' ? 'majority' : 'async';
  const readFrom = sql ? n.str('readFrom', 'primary') : docReadFrom(n.str('readPreference', 'primary'));
  const consistency = n.str('consistency', 'eventual');
  const isolation = n.str('isolation', 'read-committed');
  const rmw = n.bool('readModifyWrite', false);
  const failoverMs = n.num(sql ? 'failoverSec' : 'electionSec', sql ? 30 : 12) * 1000;

  const need = () => {
    if (mode === 'sync') return replicas.length;
    if (mode === 'semi-sync') return Math.min(1, replicas.length);
    if (mode === 'majority') return Math.floor((replicas.length + 1) / 2);
    return 0;
  };
  const lag = () => {
    const p50 = n.num('replicaLagMs', 30);
    return n.rng.lognormal(p50, n.num('replicaLagP99Ms', p50 * 5)) + extraLagMs;
  };
  const upReplicas = () => replicas.map((r, i) => (r.up ? i : -1)).filter(i => i >= 0);

  function pickSource(k: number): ReadSrc {
    if (consistency === 'linearizable') return { replica: -1, extraMs: n.num('leaseCheckMs', 2) };
    const ups = upReplicas();
    if (readFrom === 'primary' || !ups.length) return { replica: -1, extraMs: 0 };
    let i: number;
    if (consistency === 'monotonic') i = ups[k % ups.length];
    else if (readFrom === 'replicas') i = n.rng.pick(ups);
    else {
      const j = n.rng.int(ups.length + 1);
      i = j === ups.length ? -1 : ups[j];
    }
    // read-your-writes: session token = last written version; fall back to primary if the replica is behind it
    if (i >= 0 && consistency === 'read-your-writes') {
      replicas[i].catchUp(n.now);
      if (replicas[i].store.version(k) < lastWrite[k]) i = -1;
    }
    return { replica: i, extraMs: 0 };
  }

  function serve(req: Req, store: KeyStore, k: number) {
    const rec = store.get(k);
    const version = rec?.version ?? 0;
    const stale = truth.checkRead(n, k, version, req.msg.weight);
    req.reply({ ok: true, value: rec?.value, version, stale });
  }

  function read(req: Req) {
    const k = keyOf(req.msg.key);
    const w = req.msg.weight;
    const src = pickSource(k);
    if (src.replica < 0) {
      if (!primaryUp) return req.reply({ ok: false, err: 'unavailable' });
      const store = rogue && n.rng.chance(0.5) ? replicas[rogue.idx].store : primary;
      n.process(w, n.serviceTime() + src.extraMs, ok => (ok ? serve(req, store, k) : req.reply({ ok: false, err: '503' })));
      return;
    }
    const r = replicas[src.replica];
    pools[src.replica].run(w, n.serviceTime(), ok => {
      if (!ok) return req.reply({ ok: false, err: '503' });
      r.catchUp(n.now);
      const behind = consistency === 'read-your-writes' && r.store.version(k) < lastWrite[k];
      serve(req, behind && primaryUp ? primary : r.store, k);
    });
  }

  function release(k: number) {
    const q = locks.get(k);
    if (!q) return;
    const next = q.shift();
    if (next) next();
    else locks.delete(k);
  }

  function write(req: Req) {
    const k = keyOf(req.msg.key);
    const w = req.msg.weight;
    if (n.mods.diskFull) return req.reply({ ok: false, err: '5xx' });
    if (!primaryUp) return req.reply({ ok: false, err: 'unavailable' });
    if (schemaLock) {
      blocked.push(() => write(req));
      return;
    }
    if (rogue && n.rng.chance(0.5)) return rogueWrite(req, k, w);
    const go = () => commit(req, k, w);
    if (req.msg.data?.insert) return commit(req, -1, w); // new row: no lock contention
    const held = locks.get(k);
    if (!held) {
      locks.set(k, []);
      return go();
    }
    // row lock contended
    if (sql && (isolation === 'serializable' || (rmw && isolation === 'repeatable-read'))) return req.reply({ ok: false, err: 'conflict' });
    if (rmw && (!sql || isolation === 'read-committed')) n.anomaly('lost-update', w);
    if (lockWaitW + w > n.queueLimit) return req.reply({ ok: false, err: '503' });
    lockWaitW += w;
    held.push(() => {
      lockWaitW -= w;
      go();
    });
  }

  function commit(req: Req, lockKey: number, w: number) {
    const k = lockKey >= 0 ? lockKey : keyOf(req.msg.key);
    n.process(w, n.serviceTime('writeP50Ms', 'writeP99Ms', 3, 15), ok => {
      if (!ok || !primaryUp) {
        release(lockKey);
        return req.reply({ ok: false, err: ok ? 'unavailable' : '503' });
      }
      const version = ++seq;
      const rec: Rec = { value: req.msg.value ?? 0, version, writer: n.id, ts: n.now };
      primary.put(k, rec);
      const delays: number[] = [];
      for (const r of replicas) if (r.up) delays.push(r.enqueue(k, rec, version, n.now, lag()) - n.now);
      let k2 = need();
      if (k2 > delays.length) {
        if (mode === 'semi-sync') k2 = 0; // falls back to async
        else {
          release(lockKey);
          return req.reply({ ok: false, err: 'unavailable' });
        }
      }
      delays.sort((a, b) => a - b);
      const done = () => {
        release(lockKey);
        if (!primaryUp) return req.reply({ ok: false, err: 'unavailable' });
        truth.ack(k, version, w);
        lastWrite[k] = Math.max(lastWrite[k], version);
        req.reply({ ok: true, version, value: rec.value });
      };
      if (k2 > 0) n.timer(delays[k2 - 1], done);
      else done();
    });
  }

  function rogueWrite(req: Req, k: number, w: number) {
    if (mode === 'majority' || mode === 'sync') return req.reply({ ok: false, err: 'unavailable' }); // minority side can't get its acks
    n.process(w, n.serviceTime('writeP50Ms', 'writeP99Ms', 3, 15), ok => {
      if (!ok || !rogue) return req.reply({ ok: false, err: ok ? 'unavailable' : '503' });
      const version = ++seq;
      replicas[rogue.idx].store.put(k, { value: req.msg.value ?? 0, version, writer: `${n.id}#rogue`, ts: n.now });
      rogue.keys.add(k);
      truth.ack(k, version, w);
      req.reply({ ok: true, version });
    });
  }

  function splitBrain(heal: boolean) {
    if (!heal) {
      if (rogue) return true;
      const idx = replicas.findIndex(r => r.up);
      if (idx < 0) return false;
      const r = replicas[idx];
      r.catchUp(n.now);
      r.dropPending();
      r.up = false;
      rogue = { idx, keys: new Set() };
      n.log('protocol', `${n.name}: replica ${idx + 1} cut off and promoted — two primaries`);
      return true;
    }
    if (!rogue) return true;
    const r = replicas[rogue.idx];
    let div = 0;
    for (const k of rogue.keys) if (r.store.version(k) !== primary.version(k)) div++;
    const lost = truth.lostAfter(primary);
    if (div) n.anomaly('divergence', div);
    if (lost.keys) {
      lostW += lost.w;
      n.anomaly('lost-write', lost.w);
    }
    n.log('protocol', `${n.name}: split healed — ${div} keys diverged, ${lost.keys} acked writes on the rogue primary discarded`);
    r.resync(primary, seq);
    r.up = true;
    rogue = undefined;
    return true;
  }

  function killPrimary() {
    if (!primaryUp) return;
    primaryUp = false;
    for (const q of locks.values()) q.length = 0;
    locks.clear();
    lockWaitW = 0;
    // unshipped WAL / oplog dies with the primary
    for (const r of replicas) {
      r.catchUp(n.now);
      r.dropPending();
    }
    const tok = ++failoverToken;
    n.log('protocol', `${n.name}: primary lost — ${sql ? 'failover' : 'election'} in ${failoverMs / 1000}s`);
    n.timer(failoverMs, () => {
      if (tok === failoverToken && !primaryUp) promote();
    });
  }

  function promote() {
    const cands = replicas.filter(r => r.up);
    if (!cands.length) return n.log('protocol', `${n.name}: no replica to promote`);
    for (const r of cands) r.catchUp(n.now);
    const best = cands.reduce((a, b) => (b.applied > a.applied ? b : a));
    const old = primary;
    primary = best.store;
    best.dropPending();
    const lost = truth.lostAfter(primary);
    const i = replicas.indexOf(best);
    const demoted = new Replica(old);
    demoted.up = false;
    replicas[i] = demoted;
    for (const r of replicas) if (r !== demoted && r.up) r.resync(primary, best.applied);
    primaryUp = true;
    n.log('protocol', `${n.name}: replica ${i + 1} promoted`);
    if (lost.keys) {
      lostW += lost.w;
      n.anomaly('lost-write', lost.w);
      n.log('protocol', `${n.name}: ${lost.keys} acknowledged writes ${sql ? 'lost' : 'rolled back'} (not replicated before failover)`);
    }
  }

  function rejoin() {
    if (!primaryUp) {
      failoverToken++;
      primaryUp = true;
      return n.log('protocol', `${n.name}: primary recovered before failover`);
    }
    for (const r of replicas) if (!r.up) {
      r.resync(primary, seq);
      r.up = true;
    }
  }

  function maxLag() {
    return replicas.reduce((m, r) => (r.up ? Math.max(m, r.lagMs(n.now)) : m), 0);
  }

  return {
    onStart() {
      registerTruth(n.world, n.id, k => truth.acked[keyOf(k)]);
      n.every(1000, () => {
        n.gauge('replLagMs', Math.round(maxLag()));
        n.gauge('lockWaiters', lockWaitW);
        n.gauge('lostWrites', lostW);
      });
    },
    onRequest(req) {
      if (req.msg.op === 'write') write(req);
      else read(req);
    },
    onChaos(kind, p, heal) {
      switch (kind) {
        case 'kill-leader':
        case 'lost-write':
        case 'failover':
          heal ? rejoin() : killPrimary();
          return true;
        case 'replica-lag': {
          const ms = Number(p.ms ?? 5000);
          extraLagMs += heal ? -ms : ms;
          return true;
        }
        case 'schema-lock':
          schemaLock = !heal;
          if (heal) {
            const b = blocked;
            blocked = [];
            for (const f of b) f();
          }
          return true;
        case 'split-brain':
          return splitBrain(heal);
        case 'kill-member':
        case 'kill-replica': {
          const r = replicas[Number(p.member ?? 0)];
          if (!r) return false;
          if (heal) {
            r.resync(primary, seq);
            r.up = true;
          } else r.up = false;
          return true;
        }
      }
      return false;
    },
    onKill() {
      for (const pl of pools) pl.reset();
      locks.clear();
      lockWaitW = 0;
      blocked = [];
    },
    view() {
      const badges: Badge[] = [];
      badges.push(primaryUp ? { text: '👑 primary', tone: 'accent' } : { text: sql ? 'failover…' : 'electing…', tone: 'fail' });
      const ups = upReplicas().length;
      if (count) badges.push({ text: `R×${ups}${ups < count ? `/${count}` : ''}`, tone: ups < count ? 'warn' : 'muted' });
      const l = maxLag();
      if (count && l > 0) badges.push({ text: `lag ${l < 1000 ? Math.round(l) + 'ms' : (l / 1000).toFixed(1) + 's'}`, tone: l > 1000 ? 'warn' : 'muted' });
      if (!sql) badges.push({ text: mode === 'majority' ? 'w:majority' : 'w:1', tone: 'protocol' });
      else if (mode !== 'async') badges.push({ text: mode, tone: 'protocol' });
      if (schemaLock) badges.push({ text: 'schema lock', tone: 'fail' });
      if (rogue) badges.push({ text: '2 primaries', tone: 'fail' });
      return { badges };
    },
  };
}

function docReadFrom(pref: string): string {
  if (pref === 'secondary' || pref === 'secondaryPreferred') return 'replicas';
  if (pref === 'nearest') return 'any';
  return 'primary';
}

/**
 * Dynamo-style store: `members` virtual nodes, each key on N of them
 * (preference list); reads/writes wait for R/W acks. Hinted handoff,
 * sloppy quorum and read repair are knobs; members can be killed or split.
 */
function kvStore(n: SimNode): NodeLogic {
  const M = Math.max(1, Math.round(n.num('members', 3)));
  const N = Math.max(1, Math.min(M, Math.round(n.num('replicationFactor', 3))));
  const lvl = (s: string) => (s === 'all' ? N : s === 'quorum' ? Math.floor(N / 2) + 1 : 1);
  const R = lvl(n.str('readConsistency', 'quorum'));
  const W = lvl(n.str('writeConsistency', 'quorum'));
  const hinted = n.bool('hintedHandoff', true);
  const sloppy = n.bool('sloppyQuorum', false);
  const readRepair = n.bool('readRepair', true);
  const members = Array.from({ length: M }, () => new Replica());
  const side = new Array<number>(M).fill(0);
  // latest hinted write per (member, key)
  const hints = new Map<number, { m: number; k: number; rec: Rec }>();
  const splitWrites = [new Set<number>(), new Set<number>()];
  let split = false;
  let seq = 0;
  const truth = new Truth();

  const pref = (k: number) => {
    const s = mix32(k + 1) % M;
    return Array.from({ length: N }, (_, i) => (s + i) % M);
  };
  const delay = () => n.rng.lognormal(n.num('memberP50Ms', 1), n.num('memberP99Ms', 8)) * n.mods.slowX;
  const coordinator = () => {
    const ups = members.map((m, i) => (m.up ? i : -1)).filter(i => i >= 0);
    return ups.length ? n.rng.pick(ups) : -1;
  };
  const reach = (c: number, m: number) => members[m].up && side[m] === side[c];

  function write(req: Req, c: number, k: number) {
    const w = req.msg.weight;
    const version = ++seq;
    const rec: Rec = { value: req.msg.value ?? 0, version, writer: `${n.id}#${c}`, ts: n.now };
    const pl = pref(k);
    const acks: number[] = [];
    for (const m of pl) {
      if (reach(c, m)) acks.push(members[m].enqueue(k, rec, version, n.now, delay()) - n.now);
      else if (hinted) hints.set(m * KEYS + k, { m, k, rec });
    }
    if (sloppy && acks.length < W) {
      for (let m = 0; m < M && acks.length < W; m++) if (!pl.includes(m) && reach(c, m)) acks.push(delay());
    }
    if (acks.length < W) return req.reply({ ok: false, err: 'unavailable' });
    if (split) splitWrites[side[c]].add(k);
    acks.sort((a, b) => a - b);
    n.timer(acks[W - 1], () => {
      truth.ack(k, version, w);
      req.reply({ ok: true, version, value: rec.value });
    });
  }

  function read(req: Req, c: number, k: number) {
    const avail = pref(k).filter(m => reach(c, m));
    if (avail.length < R) return req.reply({ ok: false, err: 'unavailable' });
    const chosen = avail.map(m => ({ m, r: n.rng.next() })).sort((a, b) => a.r - b.r).slice(0, R).map(x => x.m);
    const lat = Math.max(...chosen.map(() => delay()));
    n.timer(lat, () => {
      let best: Rec | undefined;
      for (const m of chosen) {
        members[m].catchUp(n.now);
        const r = members[m].store.get(k);
        if (r && (!best || r.version > best.version)) best = r;
      }
      if (best && readRepair) for (const m of chosen) members[m].store.put(k, best);
      const version = best?.version ?? 0;
      const stale = truth.checkRead(n, k, version, req.msg.weight);
      req.reply({ ok: true, value: best?.value, version, stale });
    });
  }

  function deliverHints() {
    for (const [id, h] of hints) {
      if (!members[h.m].up || side[h.m] !== 0) continue;
      members[h.m].store.put(h.k, h.rec);
      hints.delete(id);
    }
  }

  function heal() {
    if (!split) return;
    split = false;
    let div = 0;
    for (const k of splitWrites[0]) if (splitWrites[1].has(k)) div++;
    splitWrites[0].clear();
    splitWrites[1].clear();
    side.fill(0);
    if (div) {
      n.anomaly('divergence', div);
      n.anomaly('lost-update', div);
      n.log('protocol', `${n.name}: split healed — ${div} keys diverged, last-writer-wins drops one side`);
    }
    deliverHints();
  }

  return {
    onStart() {
      registerTruth(n.world, n.id, k => truth.acked[keyOf(k)]);
      n.every(1000, () => {
        n.gauge('membersUp', members.filter(m => m.up).length);
        n.gauge('hints', hints.size);
      });
    },
    onRequest(req) {
      const k = keyOf(req.msg.key);
      n.process(req.msg.weight, n.serviceTime(), ok => {
        if (!ok) return req.reply({ ok: false, err: '503' });
        const c = coordinator();
        if (c < 0) return req.reply({ ok: false, err: 'unavailable' });
        if (req.msg.op === 'write') {
          if (n.mods.diskFull) return req.reply({ ok: false, err: '5xx' });
          write(req, c, k);
        } else read(req, c, k);
      });
    },
    onChaos(kind, p, isHeal) {
      switch (kind) {
        case 'split-brain':
        case 'partition-members': {
          if (isHeal) return heal(), true;
          const minority = Math.max(1, Math.min(M - 1, Number(p.minority ?? Math.floor(M / 2))));
          if (M < 2) return false;
          for (let i = 0; i < M; i++) side[i] = i >= M - minority ? 1 : 0;
          split = true;
          n.log('protocol', `${n.name}: members split ${M - minority} | ${minority}`);
          return true;
        }
        case 'kill-member':
        case 'kill-leader': {
          const i = Math.max(0, Math.min(M - 1, Number(p.member ?? M - 1)));
          if (isHeal) {
            members[i].up = true;
            if (hinted) deliverHints();
          } else {
            members[i].up = false;
            members[i].dropPending();
          }
          return true;
        }
      }
      return false;
    },
    view() {
      const up = members.filter(m => m.up).length;
      const badges: Badge[] = [
        { text: `N${N} R${R} W${W}`, tone: 'protocol' },
        R + W > N ? { text: 'R+W>N', tone: 'ok' } : { text: 'R+W≤N', tone: 'warn' },
      ];
      if (up < M) badges.push({ text: `${up}/${M} up`, tone: 'warn' });
      if (split) badges.push({ text: 'split', tone: 'fail' });
      if (hints.size) badges.push({ text: `hints ${hints.size}`, tone: 'muted' });
      return { badges };
    },
  };
}

register('relational-db', n => primaryReplica(n, 'sql'));
register('document-db', n => primaryReplica(n, 'doc'));
register('kv-store', kvStore);
