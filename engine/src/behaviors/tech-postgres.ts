// Postgres internals: backend process per connection, shared buffers, WAL + fsync (group commit),
// MVCC dead tuples + autovacuum, checkpoints (IO + full-page writes), streaming replication, PgBouncer.
// Protocol kinds: pg.wal (primary → replica), pg.ack (replica → primary).
import type { NodeLogic, Req, SimNode } from '../node';
import type { Badge, Id, Msg, Reply } from '../types';
import { register } from './registry';
import { groupState } from './raft';

interface PgShared {
  /** WAL position of the last write per key (stale-read ground truth) */
  lastWrite: Float64Array;
}
const shared = (n: SimNode) => groupState<PgShared>(n.world, 'pg:' + n.str('cluster', 'pg'), () => ({ lastWrite: new Float64Array(1024) }));

function throttle(n: SimNode) {
  const last = new Map<string, number>();
  return (key: string, ms: number, text: string, kind: 'info' | 'protocol' = 'info') => {
    if (n.now - (last.get(key) ?? -Infinity) < ms) return;
    last.set(key, n.now);
    n.log(kind, text);
  };
}

const replicasOf = (n: SimNode): SimNode[] => {
  const out = n.outEdges().map(e => n.world.nodes.get(e.to)!).filter(x => x?.type === 'pg-replica');
  return out.length ? out : [...n.world.nodes.values()].filter(x => x.type === 'pg-replica' && x.str('cluster', 'pg') === n.str('cluster', 'pg'));
};

interface Waiter {
  lsn: number;
  w: number;
  cb: () => void;
}

// ---------- primary ----------
register('pg-primary', n => {
  const st = shared(n);
  const say = throttle(n);
  let conns = 0;
  let active = 0;
  let warm = 1;
  let lsn = 0;
  /** WAL positions of writes by traced requests, to tag the stream that carries them */
  const tracedLsn: { lsn: number; id: number }[] = [];
  let flushed = 0;
  let walWait: Waiter[] = [];
  let unflushedAcked = 0;
  let fsyncing = false;
  let batches: number[] = [];
  let syncWait: Waiter[] = [];
  const standby = new Map<Id, { flush: number; replay: number; at: number }>();
  // MVCC
  let dead: { t: number; w: number }[] = [];
  let deadTotal = 0;
  let xminHeldSince: number | undefined;
  let vacuums = 0;
  // checkpoints
  let dirtyMb = 0;
  let walSinceMb = 0;
  let writesSinceCkpt = 0;
  let lastCkpt = 0;
  let ckpt: { mbps: number; left: number } | undefined;
  let ckpts = 0;
  let ckptReq = 0;
  let walMbps = 0;
  let walWin = 0;
  let recoveringUntil = 0;

  const cores = () => Math.max(1, n.num('slots', 4));
  const live = () => Math.max(1, n.num('liveRows', 10000));
  const bloat = () => deadTotal / live();
  // dead row versions bloat the table, so the same hot rows span more pages
  const hitRatio = () => Math.min(0.995, n.num('sharedBuffersMb', 1024) / Math.max(1, n.num('workingSetMb', 800) * (1 + bloat()))) * warm;
  const ioUtil = () => ((ckpt?.mbps ?? 0) + walMbps) / Math.max(1, n.num('diskMbps', 200));
  const ioX = () => 1 / (1 - Math.min(0.9, ioUtil()));
  const contentionX = () => Math.min(5, 1 + n.num('contention', 0.03) * Math.max(0, active / cores() - 1));
  const fpw = () => Math.exp(-writesSinceCkpt / Math.max(1, n.num('hotPages', 20000)));

  // ----- WAL flush with group commit -----
  const flush = () => {
    if (fsyncing || !n.up) return;
    if (!walWait.length && !unflushedAcked) return;
    fsyncing = true;
    const upto = lsn;
    n.timer(n.num('fsyncMs', 2) * ioX() * n.mods.slowX, () => {
      fsyncing = false;
      flushed = upto;
      unflushedAcked = 0;
      const done = walWait.filter(x => x.lsn <= upto);
      walWait = walWait.filter(x => x.lsn > upto);
      if (done.length) {
        batches.push(done.reduce((a, x) => a + x.w, 0));
        if (batches.length > 40) batches.shift();
      }
      const needSync = Math.min(n.num('syncReplicas', 0), replicasOf(n).length);
      for (const x of done) {
        if (!needSync) x.cb();
        else syncWait.push(x);
      }
      if (needSync) {
        ship(true);
        say('syncwait', 5000, `COMMIT waits for ${needSync} synchronous standby to flush the WAL`, 'protocol');
        releaseSync();
      }
      if (walWait.length) flush();
    });
  };

  const releaseSync = () => {
    const need = Math.min(n.num('syncReplicas', 0), replicasOf(n).length);
    if (!need) {
      syncWait.forEach(x => x.cb());
      syncWait = [];
      return;
    }
    const flushes = replicasOf(n)
      .map(r => standby.get(r.id)?.flush ?? 0)
      .sort((a, b) => b - a);
    const ok = flushes[need - 1] ?? 0;
    const ready = syncWait.filter(x => x.lsn <= ok);
    syncWait = syncWait.filter(x => x.lsn > ok);
    ready.forEach(x => x.cb());
  };

  const ship = (syncOnly = false) => {
    const rs = replicasOf(n);
    const need = n.num('syncReplicas', 0);
    rs.forEach((r, i) => {
      if (syncOnly && i >= need) return;
      const has = standby.get(r.id)?.flush ?? -1;
      if (has >= lsn) return;
      const traceId = tracedLsn.find(x => x.lsn > has && x.lsn <= lsn)?.id;
      n.send(r.id, { kind: 'pg.wal', traceId, data: { lsn } });
    });
  };

  // ----- autovacuum -----
  const vacuum = () => {
    const threshold = 50 + n.num('autovacuumScale', 0.2) * live();
    if (deadTotal < threshold) return;
    const horizon = xminHeldSince ?? Infinity;
    const budget = n.num('vacuumRowsPerSec', 5000);
    let left = budget;
    const keep: typeof dead = [];
    for (const d of dead) {
      if (d.t >= horizon || left <= 0) keep.push(d);
      else if (d.w <= left) left -= d.w;
      else {
        keep.push({ t: d.t, w: d.w - left });
        left = 0;
      }
    }
    const removed = budget - left;
    dead = keep;
    deadTotal = keep.reduce((a, d) => a + d.w, 0);
    vacuums++;
    const blocked = keep.filter(d => d.t >= horizon).reduce((a, d) => a + d.w, 0);
    if (xminHeldSince !== undefined && blocked > 0)
      say('vac', 4000, `autovacuum: removed ${Math.round(removed)} dead row versions; ${Math.round(blocked)} still visible to an open transaction (xmin held ${((n.now - xminHeldSince) / 1000).toFixed(0)}s)`);
    else if (vacuums <= 3 || vacuums % 10 === 0) n.log('protocol', `autovacuum: removed ${Math.round(removed)} dead row versions`);
  };

  // ----- checkpointer -----
  const checkpointer = (dtMs: number) => {
    const walMb = walWin;
    walWin = 0;
    walMbps = walMbps * 0.5 + (walMb / (dtMs / 1000)) * 0.5;
    if (ckpt) {
      const w = (ckpt.mbps * dtMs) / 1000;
      ckpt.left -= w;
      dirtyMb = Math.max(0, dirtyMb - w);
      if (ckpt.left <= 0) ckpt = undefined;
    }
    const timeout = n.num('checkpointTimeoutSec', 30) * 1000;
    const maxWal = n.num('maxWalMb', 64);
    const byWal = walSinceMb >= maxWal;
    if (!byWal && n.now - lastCkpt < timeout) return;
    const gap = n.now - lastCkpt;
    if (byWal) {
      ckptReq++;
      if (gap < n.num('checkpointWarningSec', 10) * 1000)
        say('ckptwarn', 5000, `LOG: checkpoints are occurring too frequently (${(gap / 1000).toFixed(1)}s apart) — consider increasing max_wal_size`);
    }
    // spread the writes over completion_target × expected interval
    const fill = walMbps > 0.01 ? (maxWal / walMbps) * 1000 : timeout;
    const dur = Math.max(200, n.num('completionTarget', 0.9) * Math.min(timeout, fill));
    const toWrite = dirtyMb;
    ckpt = { mbps: toWrite / (dur / 1000), left: toWrite };
    ckpts++;
    lastCkpt = n.now;
    walSinceMb = 0;
    writesSinceCkpt = 0;
    if (ckpts <= 2 || byWal) say('ckpt', 3000, `checkpoint starting (${byWal ? 'wal' : 'time'}): ${toWrite.toFixed(0)} MB dirty buffers over ${(dur / 1000).toFixed(1)}s`, 'protocol');
  };

  const gauges = () => {
    const avg = batches.length ? batches.reduce((a, b) => a + b, 0) / batches.length : 0;
    n.gauge('connections', conns);
    n.gauge('hitRatio', Math.round(hitRatio() * 1000) / 10);
    n.gauge('commitsPerFsync', Math.round(avg * 10) / 10);
    n.gauge('deadTuples', Math.round(deadTotal));
    n.gauge('bloatPct', Math.round(bloat() * 100));
    n.gauge('vacuums', vacuums);
    n.gauge('checkpoints', ckpts);
    n.gauge('checkpointsReq', ckptReq);
    n.gauge('ioUtil', Math.round(Math.min(1, ioUtil()) * 100));
    n.gauge('walMBps', Math.round(walMbps * 10) / 10);
    n.gauge('lsn', lsn);
    n.gauge('xminAgeSec', xminHeldSince === undefined ? 0 : Math.round((n.now - xminHeldSince) / 1000));
  };

  const write = (req: Req, done: (r: Reply) => void) => {
    const m = req.msg;
    const w = m.weight;
    if (n.mods.diskFull) {
      say('full', 5000, 'PANIC: could not write to file "pg_wal/…": No space left on device');
      return done({ ok: false, err: '5xx' });
    }
    lsn += w;
    const my = lsn;
    if (m.traceId !== undefined) {
      tracedLsn.push({ lsn: my, id: m.traceId });
      if (tracedLsn.length > 50) tracedLsn.shift();
    }
    st.lastWrite[(m.key ?? 0) % 1024] = my;
    // MVCC: an UPDATE leaves the old row version behind
    dead.push({ t: n.now, w });
    deadTotal += w;
    const f = fpw();
    writesSinceCkpt += w;
    const walMb = (w * (n.num('walBaseKb', 0.5) + 8 * f)) / 1024;
    walSinceMb += walMb;
    walWin += walMb;
    dirtyMb += (w * 8 * f) / 1024;
    if (n.str('synchronousCommit', 'on') === 'off') {
      unflushedAcked += w;
      return done({ ok: true, version: my });
    }
    walWait.push({ lsn: my, w, cb: () => done({ ok: true, version: my }) });
    flush();
  };

  const read = (req: Req, done: (r: Reply) => void) => {
    const w = req.msg.weight;
    const pages = n.num('pagesPerRead', 3) * (1 + bloat());
    const misses = pages * (1 - hitRatio());
    warm = Math.min(1, warm + w / n.num('warmupReads', 3000));
    const ioMs = misses * n.num('diskReadMs', 2) * ioX();
    const k = (req.msg.key ?? 0) % 1024;
    const reply = () => done({ ok: true, version: st.lastWrite[k] });
    if (ioMs < 0.05) reply();
    else n.timer(ioMs, reply);
  };

  return {
    onStart() {
      conns = 0;
      active = 0;
      walWait = [];
      syncWait = [];
      fsyncing = false;
      lastCkpt = n.now;
      n.every(250, () => checkpointer(250));
      n.every(1000, vacuum);
      n.every(n.num('walWriterDelayMs', 200), flush);
      n.every(n.num('walSendMs', 20), () => ship());
      n.every(1000, gauges);
    },
    onRequest(req: Req) {
      const m = req.msg;
      const w = m.weight;
      if (n.now < recoveringUntil) {
        say('recover', 3000, 'FATAL: the database system is starting up (replaying WAL since the last checkpoint)');
        return req.reply({ ok: false, err: 'unavailable' });
      }
      const pooled = !!m.data?.pooled;
      if (!pooled) {
        if (conns + w > n.num('maxConnections', 100)) {
          say('conns', 3000, `FATAL: sorry, too many clients already (max_connections ${n.num('maxConnections', 100)})`);
          return req.reply({ ok: false, err: 'refused' });
        }
        conns += w;
      }
      active += w;
      const done = (r: Reply) => {
        if (!pooled) conns -= w;
        req.reply(r);
      };
      const cpu =
        (m.op === 'write'
          ? n.serviceTime('writeCpuMs', 'writeCpuP99Ms', 0.8, 3)
          : n.serviceTime('p50Ms', 'p99Ms', 0.5, 2) * (1 + bloat())) *
          contentionX() +
        (pooled ? 0 : n.num('connectMs', 0));
      n.process(w, cpu, ok => {
        active -= w;
        if (!ok) return done({ ok: false, err: '503' });
        if (m.op === 'write') write(req, done);
        else read(req, done);
      });
    },
    onMessage(m: Msg) {
      if (m.kind !== 'pg.ack') return;
      standby.set(m.from, { flush: m.data.flush, replay: m.data.replay, at: n.now });
      releaseSync();
    },
    onKill() {
      if (unflushedAcked) {
        n.anomaly('lost-write', unflushedAcked);
        n.log('info', `${n.name} crashed: ${unflushedAcked} commits acknowledged with synchronous_commit=off were never flushed — lost`);
      }
      unflushedAcked = 0;
    },
    onRestart() {
      warm = 0;
      const ms = walSinceMb * n.num('recoveryMsPerMb', 50);
      recoveringUntil = n.now + ms;
      n.log('info', `${n.name} restarting: crash recovery replays ${walSinceMb.toFixed(0)} MB of WAL (${(ms / 1000).toFixed(1)}s); shared_buffers start cold`);
    },
    onChaos(kind, _p, heal) {
      if (kind !== 'long-txn') return false;
      if (heal) {
        n.log('info', `${n.name}: long transaction committed; vacuum can clean up again`);
        xminHeldSince = undefined;
      } else {
        xminHeldSince = n.now;
        n.log('info', `${n.name}: BEGIN; SELECT … then idle in transaction — its snapshot holds back the xmin horizon`);
      }
      return true;
    },
    view() {
      const b: Badge[] = [{ text: `${conns}/${n.num('maxConnections', 100)} conns`, tone: conns > n.num('maxConnections', 100) * 0.9 ? 'warn' : 'muted' }];
      if (bloat() > 0.5) b.push({ text: `bloat ${Math.round(bloat() * 100)}%`, tone: 'warn' });
      if (ckpt) b.push({ text: 'checkpoint', tone: ioUtil() > 0.6 ? 'warn' : 'protocol' });
      if (xminHeldSince !== undefined) b.push({ text: 'idle in txn', tone: 'warn' });
      return { badges: b };
    },
  };
});

// ---------- streaming replica (hot standby) ----------
register('pg-replica', n => {
  const st = shared(n);
  const say = throttle(n);
  let received = 0;
  let replayed = 0;
  let extraLagMs = 0;
  let samples: { t: number; lsn: number }[] = [];
  const rate = () => Math.max(1, n.num('replayPerSec', 2000));
  const lagMs = () => ((received - replayed) / rate()) * 1000 + extraLagMs;

  const replay = (dtMs: number) => {
    const cutoff = n.now - extraLagMs;
    let target = 0;
    for (const s of samples) if (s.t <= cutoff) target = s.lsn;
    samples = samples.filter(s => s.t > cutoff || s.lsn === target);
    replayed = Math.min(Math.max(replayed, 0) + (rate() * dtMs) / 1000 / n.mods.slowX, target);
    n.gauge('lagMs', Math.round(lagMs()));
    n.gauge('replayLsn', replayed);
    if (lagMs() > 2000) say('lag', 5000, `${n.name}: replay lag ${(lagMs() / 1000).toFixed(1)}s — reads here are stale`);
  };

  return {
    onStart() {
      samples = [];
      n.every(50, () => replay(50));
    },
    onMessage(m: Msg) {
      if (m.kind !== 'pg.wal') return;
      if (m.data.lsn > received) {
        received = m.data.lsn;
        samples.push({ t: n.now, lsn: received });
      }
      // synchronous standby: acknowledge the flush right away
      n.send(m.from, { kind: 'pg.ack', traceId: m.traceId, data: { flush: received, replay: replayed } });
    },
    onRequest(req: Req) {
      if (req.msg.op === 'write') {
        say('ro', 5000, 'ERROR: cannot execute UPDATE in a read-only transaction');
        return req.reply({ ok: false, err: 'refused' });
      }
      n.process(req.msg.weight, n.serviceTime('p50Ms', 'p99Ms', 0.5, 2), ok => {
        if (!ok) return req.reply({ ok: false, err: '503' });
        const k = (req.msg.key ?? 0) % 1024;
        const stale = st.lastWrite[k] > replayed;
        if (stale) n.anomaly('stale-read', req.msg.weight);
        req.reply({ ok: true, version: Math.min(st.lastWrite[k], replayed), stale });
      });
    },
    onChaos(kind, p, heal) {
      if (kind !== 'replica-lag') return false;
      extraLagMs = heal ? 0 : p.ms ?? 5000;
      return true;
    },
    view() {
      const lag = lagMs();
      return { badges: [{ text: 'R', tone: 'muted' }, { text: `lag ${lag < 1000 ? Math.round(lag) + 'ms' : (lag / 1000).toFixed(1) + 's'}`, tone: lag > 1000 ? 'warn' : 'muted' }] as Badge[] };
    },
  };
});

// ---------- PgBouncer ----------
register('pgbouncer', n => {
  const say = throttle(n);
  let active = 0;
  let waiting: { req: Req; at: number }[] = [];
  const pool = () => Math.max(1, n.num('poolSize', 20));

  const start = (req: Req) => {
    const e = n.syncOut(req.msg.op)[0] ?? n.outEdges()[0];
    if (!e) return req.reply({ ok: false, err: '5xx' });
    active++;
    const msg = n.world.child(req.msg, n.id, e.to);
    msg.data = { ...(msg.data ?? {}), pooled: true };
    n.call(e, msg, r => {
      req.reply(r);
      // session mode: the client keeps its server connection while it is idle between queries
      const hold = n.str('poolMode', 'transaction') === 'session' ? n.num('clientIdleMs', 50) : 0;
      if (hold) n.timer(hold, release);
      else release();
    });
  };
  const release = () => {
    active--;
    const now = n.now;
    while (waiting.length && active < pool()) {
      const w = waiting.shift()!;
      if (now - w.at > n.num('queryWaitTimeoutMs', 2000)) {
        w.req.reply({ ok: false, err: 'timeout' });
        continue;
      }
      start(w.req);
    }
  };

  return {
    onStart() {
      active = 0;
      waiting = [];
      n.every(1000, () => {
        n.gauge('serverConns', active);
        n.gauge('clientsWaiting', waiting.length);
      });
    },
    onRequest(req: Req) {
      if (active + waiting.length >= n.num('maxClientConn', 10000)) {
        say('max', 3000, 'pgbouncer: no more connections allowed (max_client_conn)');
        return req.reply({ ok: false, err: 'refused' });
      }
      if (active < pool()) start(req);
      else waiting.push({ req, at: n.now });
    },
    view() {
      return { badges: [{ text: `${active}/${pool()} server`, tone: active >= pool() ? 'warn' : 'muted' }, ...(waiting.length ? [{ text: `${waiting.length} waiting`, tone: 'protocol' as const }] : [])] };
    },
  };
});

export {};
