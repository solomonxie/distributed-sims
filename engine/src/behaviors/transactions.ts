// Transactions group: 2PC/3PC participants + coordinator, sagas, idempotency, inventory.
import type { NodeLogic, Req, SimNode } from '../node';
import type { World } from '../world';
import type { Badge, Id, Msg, Reply } from '../types';
import { register, registerKind } from './registry';

// ---------- participant lock table ----------

interface Lock {
  txn: string;
  since: number;
}
interface Prepared {
  keys: number[];
  state: 'prepared' | 'precommitted';
  /** 3PC: decide alone after this time */
  deadline: number;
}

const lockTables = new WeakMap<SimNode, Map<number, Lock>>();
const preparedTables = new WeakMap<SimNode, Map<string, Prepared>>();
// Finished txns: a late prepare (after an early abort overtook it) must not lock.
const finishedTables = new WeakMap<SimNode, Map<string, 'commit' | 'abort'>>();

function finishedOf(n: SimNode): Map<string, 'commit' | 'abort'> {
  let m = finishedTables.get(n);
  if (!m) finishedTables.set(n, (m = new Map()));
  return m;
}

function locksOf(n: SimNode): Map<number, Lock> {
  let m = lockTables.get(n);
  if (!m) lockTables.set(n, (m = new Map()));
  return m;
}
function preparedOf(n: SimNode): Map<string, Prepared> {
  let m = preparedTables.get(n);
  if (!m) preparedTables.set(n, (m = new Map()));
  return m;
}

/** True if `key` is held by an in-doubt/prepared transaction on this node. */
export function isLocked(n: SimNode, key?: number): boolean {
  return key !== undefined && locksOf(n).has(key);
}

/** Snapshot of txn locks on a node: key → holding txn id. */
export function locksHeld(n: SimNode): Map<number, string> {
  return new Map([...locksOf(n)].map(([k, l]) => [k, l.txn]));
}

function lockGauges(n: SimNode) {
  const locks = locksOf(n);
  let oldest = 0;
  for (const l of locks.values()) oldest = Math.max(oldest, n.now - l.since);
  n.gauge('lockedKeys', locks.size);
  n.gauge('lockAgeMs', Math.round(oldest));
}

// Per-world record of each txn's participant outcomes, to detect divergence (3PC under partition).
const outcomes = new WeakMap<World, Map<string, 'commit' | 'abort' | 'mixed'>>();

function recordOutcome(n: SimNode, txn: string, outcome: 'commit' | 'abort') {
  let m = outcomes.get(n.world);
  if (!m) outcomes.set(n.world, (m = new Map()));
  const prev = m.get(txn);
  if (!prev) {
    m.set(txn, outcome);
    if (m.size > 5000) m.delete(m.keys().next().value!);
  } else if (prev !== outcome && prev !== 'mixed') {
    m.set(txn, 'mixed');
    n.anomaly('divergence', 1);
    n.log('protocol', `${txn}: ${n.name} ${outcome}ed but another participant ${prev}ed`);
  }
}

function release(n: SimNode, txn: string, outcome: 'commit' | 'abort') {
  const fin = finishedOf(n);
  if (!fin.has(txn)) {
    fin.set(txn, outcome);
    if (fin.size > 5000) fin.delete(fin.keys().next().value!);
  }
  const p = preparedOf(n).get(txn);
  if (!p) return;
  preparedOf(n).delete(txn);
  const locks = locksOf(n);
  for (const k of p.keys) if (locks.get(k)?.txn === txn) locks.delete(k);
  recordOutcome(n, txn, outcome);
  lockGauges(n);
}

/** Generic 2PC/3PC participant for any node receiving 'txn.*'. */
function txnParticipant(n: SimNode, req: Req) {
  const m = req.msg;
  const d = m.data ?? {};
  const txn: string = d.txn;
  switch (m.kind) {
    case 'txn.prepare':
      return n.process(1, n.serviceTime(), ok => {
        if (!ok) return req.reply({ ok: false, err: '503' });
        if (n.mods.diskFull) return req.reply({ ok: false, err: '5xx' });
        if (finishedOf(n).has(txn)) return req.reply({ ok: false, err: 'conflict' });
        const keys: number[] = d.keys ?? [];
        const locks = locksOf(n);
        if (keys.some(k => locks.has(k) && locks.get(k)!.txn !== txn)) return req.reply({ ok: false, err: 'conflict' });
        if (n.rng.chance(n.num('txnFailPct', 0) / 100)) return req.reply({ ok: false, err: '5xx' });
        for (const k of keys) locks.set(k, { txn, since: n.now });
        const waitMs = d.waitMs ?? n.num('participantTimeoutMs', 1500);
        preparedOf(n).set(txn, { keys, state: 'prepared', deadline: n.now + waitMs });
        lockGauges(n);
        if (d.proto === '3pc') n.timer(waitMs, () => threePcTimeout(n, txn));
        req.reply({ ok: true });
      });
    case 'txn.precommit': {
      const p = preparedOf(n).get(txn);
      if (!p) return req.reply({ ok: false, err: 'conflict' });
      p.state = 'precommitted';
      const waitMs = d.waitMs ?? n.num('participantTimeoutMs', 1500);
      p.deadline = n.now + waitMs;
      if (d.proto === '3pc') n.timer(waitMs, () => threePcTimeout(n, txn));
      return req.reply({ ok: true });
    }
    case 'txn.commit':
      release(n, txn, 'commit');
      return req.reply({ ok: true });
    case 'txn.abort':
      release(n, txn, 'abort');
      return req.reply({ ok: true });
    default:
      return req.reply({ ok: true });
  }
}

/** 3PC: a participant that hears nothing decides on its own (non-blocking, unsafe under partition). */
function threePcTimeout(n: SimNode, txn: string) {
  const p = preparedOf(n).get(txn);
  if (!p || n.now < p.deadline) return;
  const outcome = p.state === 'precommitted' ? 'commit' : 'abort';
  n.log('protocol', `${n.name}: ${txn} timed out → unilateral ${outcome}`);
  release(n, txn, outcome);
}

// ---------- saga participant ----------

const sagaStats = new WeakMap<SimNode, { steps: number; compensations: number }>();

function sagaParticipant(n: SimNode, req: Req) {
  const m = req.msg;
  let st = sagaStats.get(n);
  if (!st) sagaStats.set(n, (st = { steps: 0, compensations: 0 }));
  const s = st;
  n.process(m.weight, n.serviceTime(), ok => {
    if (!ok) return req.reply({ ok: false, err: '503' });
    if (m.kind === 'saga.compensate') {
      s.compensations += m.weight;
      n.gauge('compensations', s.compensations);
      return req.reply({ ok: true });
    }
    if (m.kind === 'saga.step') {
      if (n.mods.diskFull || n.rng.chance(n.num('sagaFailPct', 0) / 100)) return req.reply({ ok: false, err: '5xx' });
      s.steps += m.weight;
      n.gauge('sagaSteps', s.steps);
    }
    // 'saga.event' (choreography) and others: just do the work
    req.reply({ ok: true });
  });
}

registerKind('txn.', txnParticipant);
registerKind('saga.', sagaParticipant);

// ---------- coordinator ----------

type Protocol = '2pc' | '3pc' | 'saga-orchestrated';

interface TxnRecord {
  id: string;
  parts: Id[];
  keys: number[];
  w: number;
  saga: boolean;
  decision?: 'commit' | 'abort';
  acked: Set<Id>;
  /** saga: participants whose step may have run (compensate in reverse) */
  done: Id[];
  req?: Req;
}

function txnCoordinator(n: SimNode): NodeLogic {
  // Decision log is durable: it survives kill/restart (closure outlives epochs).
  const log = new Map<string, TxnRecord>();
  let seq = 0;
  let killArmed = false;
  let phase = 'idle';
  const stats = { committed: 0, aborted: 0, compensated: 0, compensations: 0, inflight: 0 };

  const protocol = () => n.str<Protocol>('protocol', '2pc');
  const timeoutMs = () => n.num('timeoutMs', 500);
  const retryMs = () => n.num('retryMs', 500);
  const participants = () => [...new Set(n.outEdges().map(e => e.to))];

  const gauges = () => {
    for (const [k, v] of Object.entries(stats)) n.gauge(k, v);
    n.gauge('inDoubt', [...log.values()].filter(t => !t.decision).length);
  };

  const finish = (t: TxnRecord, r: Reply) => {
    stats.inflight = Math.max(0, stats.inflight - t.w);
    t.req?.reply(r);
    t.req = undefined;
    gauges();
  };

  const deliverDecision = (t: TxnRecord, p: Id) => {
    n.rpc(p, { kind: 'txn.' + t.decision, data: { txn: t.id } }, timeoutMs(), r => {
      if (!r.ok) return void n.timer(retryMs(), () => deliverDecision(t, p));
      t.acked.add(p);
      if (t.acked.size >= t.parts.length) log.delete(t.id);
      gauges();
    });
  };

  const decide = (t: TxnRecord, decision: 'commit' | 'abort') => {
    t.decision = decision;
    phase = decision;
    if (decision === 'commit') stats.committed += t.w;
    else stats.aborted += t.w;
    for (const p of t.parts) deliverDecision(t, p);
    finish(t, decision === 'commit' ? { ok: true } : { ok: false, err: 'conflict' });
  };

  /** Send `kind` to every participant; cb(allOk) after all replied or on first failure. */
  const round = (t: TxnRecord, kind: string, cb: (allOk: boolean) => void) => {
    let pending = t.parts.length;
    let settled = false;
    for (const p of t.parts) {
      n.rpc(p, { kind, data: { txn: t.id, keys: t.keys, proto: protocol(), waitMs: n.num('participantTimeoutMs', 1500) } }, timeoutMs(), r => {
        if (settled) return;
        if (!r.ok) {
          settled = true;
          return cb(false);
        }
        if (--pending === 0) {
          settled = true;
          cb(true);
        }
      });
    }
  };

  const runAtomic = (t: TxnRecord) => {
    phase = 'prepare';
    round(t, 'txn.prepare', yes => {
      if (!yes) return decide(t, 'abort');
      if (killArmed) {
        killArmed = false;
        n.log('protocol', `${n.name} crashed after prepare of ${t.id} — participants blocked holding locks`);
        n.kill();
        return;
      }
      if (protocol() !== '3pc') return decide(t, 'commit');
      phase = 'pre-commit';
      round(t, 'txn.precommit', acked => decide(t, acked ? 'commit' : 'abort'));
    });
  };

  const compensate = (t: TxnRecord, j: number) => {
    if (j < 0) {
      log.delete(t.id);
      stats.compensated += t.w;
      return finish(t, { ok: false, err: 'conflict' });
    }
    phase = 'compensate';
    n.rpc(t.done[j], { kind: 'saga.compensate', data: { saga: t.id, step: j }, weight: t.w }, timeoutMs(), r => {
      if (!r.ok) return void n.timer(retryMs(), () => compensate(t, j));
      stats.compensations += t.w;
      compensate(t, j - 1);
    });
  };

  const sagaStep = (t: TxnRecord, i: number) => {
    if (i >= t.parts.length) {
      t.decision = 'commit';
      log.delete(t.id);
      phase = 'done';
      stats.committed += t.w;
      return finish(t, { ok: true });
    }
    phase = `step ${i + 1}/${t.parts.length}`;
    const p = t.parts[i];
    n.rpc(p, { kind: 'saga.step', data: { saga: t.id, step: i }, weight: t.w }, timeoutMs(), r => {
      if (r.ok || r.err === 'timeout') t.done.push(p); // a timed-out step may have run: compensate it too
      if (r.ok) return sagaStep(t, i + 1);
      t.decision = 'abort';
      n.log('protocol', `${t.id}: step ${i + 1} failed → compensating ${t.done.length} step(s)`);
      compensate(t, t.done.length - 1);
    });
  };

  const recover = () => {
    phase = 'recovering';
    for (const t of log.values()) {
      if (t.saga) {
        if (t.decision !== 'commit') compensate(t, t.done.length - 1);
        continue;
      }
      if (!t.decision) {
        n.log('protocol', `${n.name} recovered: ${t.id} in doubt → presumed abort`);
        t.decision = 'abort';
        stats.aborted += t.w;
      }
      for (const p of t.parts) if (!t.acked.has(p)) deliverDecision(t, p);
    }
    gauges();
  };

  return {
    onStart() {
      n.every(1000, gauges);
    },
    onRequest(req) {
      n.process(req.msg.weight, n.serviceTime('p50Ms', 'p99Ms', 1, 5), ok => {
        if (!ok) return req.reply({ ok: false, err: '503' });
        const parts = participants();
        if (!parts.length) return req.reply({ ok: true });
        const saga = protocol() === 'saga-orchestrated';
        const t: TxnRecord = {
          id: `${n.name}#${++seq}`,
          parts,
          keys: [req.msg.key ?? 0],
          w: req.msg.weight,
          saga,
          acked: new Set(),
          done: [],
          req,
        };
        log.set(t.id, t);
        stats.inflight += t.w;
        if (saga) sagaStep(t, 0);
        else runAtomic(t);
      });
    },
    onChaos(kind, params, heal) {
      if (kind !== 'kill-coordinator') return false;
      if (heal) {
        killArmed = false;
        n.restart();
        return true;
      }
      killArmed = true;
      if (params.downSec) n.world.kernel.after(params.downSec * 1000, () => n.restart());
      return true;
    },
    onKill() {
      stats.inflight = 0;
      phase = 'down';
      for (const t of log.values()) t.req = undefined;
    },
    onRestart() {
      recover();
    },
    view() {
      const proto = protocol();
      const badges: Badge[] = [
        { text: proto === 'saga-orchestrated' ? 'saga' : proto.toUpperCase(), tone: 'protocol' },
        { text: phase, tone: phase === 'down' ? 'fail' : phase === 'abort' || phase === 'compensate' || phase === 'recovering' ? 'warn' : 'muted' },
      ];
      if (killArmed) badges.push({ text: 'crash armed', tone: 'fail' });
      return { badges };
    },
  };
}

register('txn-coordinator', txnCoordinator);

// ---------- idempotency ----------

/** Dedupe key: explicit idem, else the logical request (retries keep from/born/key/value). */
export function idemKey(msg: Msg): string {
  return msg.idem !== undefined ? `i${msg.idem}` : `${msg.from}|${msg.born}|${msg.key}|${msg.value}|${msg.traceId}`;
}

interface IdemEntry {
  at: number;
  reply?: Reply;
  waiters: ((r: Reply) => void)[];
}

/** TTL store of request outcomes keyed by idempotency key. */
export class IdemStore {
  private m = new Map<string, IdemEntry>();
  constructor(private ttlMs: number) {}
  /** Returns the existing entry (duplicate) or undefined after reserving the key. */
  begin(key: string, now: number): IdemEntry | undefined {
    const e = this.m.get(key);
    if (e && now - e.at <= this.ttlMs) return e;
    this.m.set(key, { at: now, waiters: [] });
    return undefined;
  }
  complete(key: string, r: Reply) {
    const e = this.m.get(key);
    if (!e) return;
    if (r.ok) e.reply = r;
    else this.m.delete(key); // failed: let a retry run it again
    for (const w of e.waiters) w(r);
    e.waiters = [];
  }
  prune(now: number) {
    for (const [k, e] of this.m) if (now - e.at > this.ttlMs && e.reply) this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
  get size() {
    return this.m.size;
  }
}

/** Side-effecting service (payments): dedupe on idempotency key, or charge again on every retry. */
function idempotentService(dedupeDefault: boolean) {
  return (n: SimNode): NodeLogic => {
    const ttl = () => n.num('idemTtlMs', 60_000);
    const store = new IdemStore(ttl());
    const executed = new Map<string, number>();
    let charges = 0;
    let duplicates = 0;
    let deduped = 0;
    const gauges = () => {
      n.gauge('charges', charges);
      n.gauge('duplicates', duplicates);
      n.gauge('deduped', deduped);
    };
    return {
      onStart() {
        n.every(1000, () => {
          store.prune(n.now);
          for (const [k, at] of executed) if (n.now - at > ttl()) executed.delete(k);
          gauges();
        });
      },
      onRequest(req) {
        const key = idemKey(req.msg);
        const w = req.msg.weight;
        const dedupe = n.bool('dedupe', dedupeDefault);
        if (dedupe) {
          const e = store.begin(key, n.now);
          if (e) {
            deduped += w;
            if (e.reply) return req.reply(e.reply);
            e.waiters.push(r => req.reply(r));
            return;
          }
        }
        n.process(w, n.serviceTime(), ok => {
          if (!ok) {
            const r: Reply = { ok: false, err: '503' };
            if (dedupe) store.complete(key, r);
            return req.reply(r);
          }
          charges += w;
          if (executed.has(key)) {
            duplicates += w;
            n.anomaly('duplicate', w);
          }
          executed.set(key, n.now);
          n.forward(req, n.syncOut(req.msg.op), 'all', r => {
            if (dedupe) store.complete(key, r);
            gauges();
            req.reply(r);
          });
        });
      },
      onKill() {
        if (!n.bool('durableStore', true)) store.clear();
      },
      view() {
        return { badges: [{ text: n.bool('dedupe', dedupeDefault) ? 'idem ✓' : 'no idem', tone: n.bool('dedupe', dedupeDefault) ? 'ok' : 'warn' }] };
      },
    };
  };
}

register('idempotent-service', idempotentService(true));
register('payment', idempotentService(false));

// ---------- inventory / booking ----------

type InvMode = 'naive' | 'pessimistic' | 'optimistic' | 'reservation';

interface Waiter {
  run: () => void;
  dead: boolean;
}

function inventory(n: SimNode): NodeLogic {
  const stock = new Map<number, number>();
  const version = new Map<number, number>();
  const sold = new Map<number, number>();
  const held = new Map<number, number>();
  const rowLocks = new Map<number, Waiter[]>();
  const st = { sold: 0, oversold: 0, conflicts: 0, holds: 0, expiredHolds: 0, soldOut: 0, lockWaiters: 0 };

  const seats = () => n.num('seatsPerKey', 100);
  const avail = (k: number) => stock.get(k) ?? seats();
  const mode = () => n.str<InvMode>('mode', 'naive');
  const gauges = () => {
    for (const [k, v] of Object.entries(st)) n.gauge(k, v);
  };

  const sell = (k: number, w: number) => {
    const s = (sold.get(k) ?? 0) + w;
    sold.set(k, s);
    st.sold += w;
    const over = Math.min(w, s - seats());
    if (over > 0) {
      st.oversold += over;
      n.anomaly('double-sell', over);
    }
  };

  /** read → check → write, each a service time; atomic only if caller serialises. */
  const readCheckWrite = (req: Req, k: number, w: number, done: (r: Reply) => void) => {
    n.process(w, n.serviceTime(), ok => {
      if (!ok) return done({ ok: false, err: '503' });
      const seen = avail(k);
      const ver = version.get(k) ?? 0;
      n.process(w, n.serviceTime(), ok2 => {
        if (!ok2) return done({ ok: false, err: '503' });
        if (seen < w) {
          st.soldOut += w;
          return done({ ok: false, err: 'conflict' });
        }
        if (mode() === 'optimistic' && (version.get(k) ?? 0) !== ver) {
          st.conflicts += w;
          return done({ ok: false, err: 'conflict', data: 'version' });
        }
        stock.set(k, seen - w);
        version.set(k, ver + 1);
        sell(k, w);
        done({ ok: true, value: seen - w, version: ver + 1 });
      });
    });
  };

  const acquire = (k: number, run: () => void, fail: () => void) => {
    const q = rowLocks.get(k);
    if (!q) {
      rowLocks.set(k, []);
      return run();
    }
    const wt: Waiter = { run, dead: false };
    q.push(wt);
    st.lockWaiters++;
    n.timer(n.num('lockWaitMs', 1000), () => {
      if (wt.dead) return;
      wt.dead = true;
      st.lockWaiters--;
      fail();
    });
  };
  const releaseRow = (k: number) => {
    const q = rowLocks.get(k);
    if (!q) return;
    let next: Waiter | undefined;
    while ((next = q.shift()) && next.dead);
    if (!next) return void rowLocks.delete(k);
    next.dead = true;
    st.lockWaiters--;
    next.run();
  };

  const reserve = (req: Req, k: number, w: number) => {
    n.process(w, n.serviceTime(), ok => {
      if (!ok) return req.reply({ ok: false, err: '503' });
      const h = held.get(k) ?? 0;
      if (avail(k) - h < w) {
        st.soldOut += w;
        return req.reply({ ok: false, err: 'conflict' });
      }
      held.set(k, h + w);
      st.holds += w;
      req.reply({ ok: true, data: 'held' });
      const ttl = n.num('holdTtlMs', 5000);
      const payAt = n.rng.exp(n.num('confirmMs', 2000));
      const pays = n.rng.chance(n.num('confirmPct', 70) / 100) && payAt < ttl;
      const unhold = () => {
        held.set(k, Math.max(0, (held.get(k) ?? 0) - w));
        st.holds = Math.max(0, st.holds - w);
      };
      n.timer(pays ? payAt : ttl, () => {
        unhold();
        if (!pays) {
          st.expiredHolds += w;
          return gauges();
        }
        stock.set(k, avail(k) - w);
        version.set(k, (version.get(k) ?? 0) + 1);
        sell(k, w);
        gauges();
      });
    });
  };

  return {
    onStart() {
      n.every(1000, gauges);
      const restock = n.num('restockSec', 0);
      if (restock > 0)
        n.every(restock * 1000, () => {
          stock.clear();
          sold.clear();
          for (const [k, v] of version) version.set(k, v + 1);
        });
    },
    onRequest(req) {
      const k = req.msg.key ?? 0;
      const w = req.msg.weight;
      if (req.msg.op === 'read') {
        return n.process(w, n.serviceTime(), ok => req.reply(ok ? { ok: true, value: avail(k) - (held.get(k) ?? 0) } : { ok: false, err: '503' }));
      }
      if (isLocked(n, k)) return req.reply({ ok: false, err: 'conflict' });
      switch (mode()) {
        case 'pessimistic':
          return acquire(
            k,
            () =>
              readCheckWrite(req, k, w, r => {
                releaseRow(k);
                req.reply(r);
              }),
            () => req.reply({ ok: false, err: 'timeout' }),
          );
        case 'optimistic': {
          const maxRetries = n.num('maxRetries', 3);
          const attempt = (i: number) =>
            readCheckWrite(req, k, w, r => {
              if (!r.ok && r.data === 'version' && i < maxRetries) return attempt(i + 1);
              req.reply(r);
            });
          return attempt(0);
        }
        case 'reservation':
          return reserve(req, k, w);
        default:
          return readCheckWrite(req, k, w, r => req.reply(r));
      }
    },
    onKill() {
      rowLocks.clear();
      held.clear();
      st.holds = 0;
      st.lockWaiters = 0;
    },
    view() {
      const m = mode();
      return { badges: [{ text: m, tone: m === 'naive' ? 'warn' : 'muted' }, ...(st.oversold ? [{ text: `oversold ${st.oversold}`, tone: 'fail' as const }] : [])] };
    },
  };
}

register('inventory', inventory);
