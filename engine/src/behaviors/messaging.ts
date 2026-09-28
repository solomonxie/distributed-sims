// Messaging group: queue, log-stream, pub-sub, worker, outbox-relay.
// Brokers hand consumers a batch of records in msg.data ({mq, group, records}); a reply ok = ack.
import type { NodeLogic, Req, SimNode } from '../node';
import type { EdgeRt, World } from '../world';
import type { Badge, Msg, Reply } from '../types';
import { register } from './registry';

export interface Rec {
  /** stable across redeliveries */
  mid: string;
  /** node that assigned the per-key sequence */
  src: string;
  key: number;
  seq: number;
  w: number;
  poison?: boolean;
  traceId?: number;
}

export interface MqData {
  mq: true;
  group: string;
  records: Rec[];
}

// ---------- shared ground truth (as if persisted in the consumers' DB) ----------

interface Ledger {
  applied: Set<string>;
  lastSeq: Map<string, number>;
  /** acked/committed at the broker but not yet applied by a consumer */
  acked: Set<string>;
}
const ledgers = new WeakMap<World, Ledger>();
function ledger(w: World): Ledger {
  let l = ledgers.get(w);
  if (!l) ledgers.set(w, (l = { applied: new Set(), lastSeq: new Map(), acked: new Set() }));
  return l;
}
const APPLIED_CAP = 300_000;
function markApplied(l: Ledger, k: string) {
  l.applied.add(k);
  if (l.applied.size <= APPLIED_CAP) return;
  let drop = 50_000;
  for (const x of l.applied) {
    l.applied.delete(x);
    if (--drop <= 0) break;
  }
}

// ---------- helpers ----------

const sumW = (rs: { w: number }[]) => rs.reduce((a, r) => a + r.w, 0);
const nodeUp = (n: SimNode, id: string) => n.world.nodes.get(id)?.up ?? false;
const isMq = (m: Msg): m is Msg & { data: MqData } => !!m.data && (m.data as MqData).mq === true;

/** Turns an incoming produce request into records, assigning per-key sequence numbers. */
function recordMaker(n: SimNode) {
  const seqs = new Map<number, number>();
  let midSeq = 0;
  return (m: Msg, poisonPct: number): Rec[] => {
    if (isMq(m)) return (m.data as MqData).records.map((r: Rec) => ({ ...r }));
    const key = m.key ?? 0;
    const seq = (seqs.get(key) ?? 0) + 1;
    seqs.set(key, seq);
    const r: Rec = { mid: `${n.id}:${++midSeq}`, src: n.id, key, seq, w: m.weight, traceId: m.traceId };
    if (poisonPct && n.rng.chance(poisonPct)) r.poison = true;
    return [r];
  };
}

function batchMsg(n: SimNode, e: EdgeRt, recs: Rec[], group: string): Msg {
  const data: MqData = { mq: true, group, records: recs };
  return n.world.newMsg({
    from: n.id,
    to: e.to,
    kind: 'req',
    op: 'write',
    key: recs[0]?.key,
    weight: Math.max(1e-9, sumW(recs)),
    traceId: recs.length === 1 ? recs[0].traceId : undefined,
    data,
  });
}

/** Call over an edge with the broker's own timeout and no edge-level retries (broker redelivers). */
function callOnce(n: SimNode, e: EdgeRt, msg: Msg, timeoutMs: number, cb: (r: Reply) => void) {
  n.call({ ...e, cfg: { ...e.cfg, timeoutMs, retries: 0 } }, msg, r => cb(r));
}

function consumerCfg(n: SimNode, e: EdgeRt, key: string): number | undefined {
  const v = n.world.nodes.get(e.to)?.cfg[key];
  return typeof v === 'number' && isFinite(v) ? v : undefined;
}

class Deque<T> {
  private a: T[] = [];
  private h = 0;
  get length() {
    return this.a.length - this.h;
  }
  push(x: T) {
    this.a.push(x);
  }
  at(i: number): T {
    return this.a[this.h + i];
  }
  shift(): T {
    const x = this.a[this.h];
    (this.a as (T | undefined)[])[this.h++] = undefined;
    if (this.h > 1024 && this.h * 2 > this.a.length) {
      this.a = this.a.slice(this.h);
      this.h = 0;
    }
    return x;
  }
  /** remove item i (0 = head) by swapping it to the head */
  take(i: number): T {
    if (i > 0) {
      const j = this.h + i;
      [this.a[this.h], this.a[j]] = [this.a[j], this.a[this.h]];
    }
    return this.shift();
  }
}

function fmt(v: number): string {
  return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`;
}

function poisonChaos(kind: string, params: Record<string, any>, heal: boolean, set: (p: number) => void): boolean {
  if (kind !== 'poison-message') return false;
  set(heal ? 0 : Number(params.pct ?? params.fraction ?? 0.02));
  return true;
}

// ---------- queue (SQS / RabbitMQ) ----------

interface QEntry {
  rec: Rec;
  enq: number;
  receives: number;
}

export function queue(n: SimNode): NodeLogic {
  const makeRecs = recordMaker(n);
  const std = new Deque<QEntry>();
  const byKey = new Map<number, QEntry[]>();
  const availKeys = new Deque<number>();
  const locked = new Set<number>();
  const inflight = new Map<number, { entries: QEntry[]; edge: string; to: string }>();
  const perEdge = new Map<string, number>();
  let readyW = 0;
  let inflightW = 0;
  let dlqW = 0;
  let lostW = 0;
  let tok = 0;
  let rr = 0;
  let poisonPct = 0;
  let dlqLogged = 0;

  const ordering = () => n.str<'standard' | 'ordered' | 'fifo'>('ordering', 'standard');
  const consumers = () => n.outEdges(e => e.cfg.route !== 'dlq');
  const credit = (e: EdgeRt) => {
    const c = n.world.nodes.get(e.to);
    const pf = consumerCfg(n, e, 'prefetch') ?? n.num('prefetch', 1);
    return Math.max(1, Math.round(pf * (c?.capacity ?? 1)));
  };
  const batchFor = (e: EdgeRt) => Math.max(1, Math.round(consumerCfg(n, e, 'batch') ?? n.num('batch', 1)));

  function enqueue(en: QEntry, front = false) {
    readyW += en.rec.w;
    if (ordering() !== 'fifo') return std.push(en);
    let q = byKey.get(en.rec.key);
    if (!q) byKey.set(en.rec.key, (q = []));
    const wasEmpty = q.length === 0;
    if (front) q.unshift(en);
    else q.push(en);
    if (wasEmpty && !locked.has(en.rec.key)) availKeys.push(en.rec.key);
  }

  function takeBatch(max: number): QEntry[] {
    const out: QEntry[] = [];
    if (ordering() === 'fifo') {
      while (availKeys.length) {
        const k = availKeys.shift();
        const q = byKey.get(k);
        if (!q?.length || locked.has(k)) continue;
        while (q.length && out.length < max) out.push(q.shift()!);
        locked.add(k);
        break;
      }
    } else {
      const shuffle = ordering() === 'standard';
      while (std.length && out.length < max) {
        const i = shuffle && std.length > 1 ? n.rng.int(Math.min(std.length, 6)) : 0;
        out.push(std.take(i));
      }
    }
    for (const en of out) readyW -= en.rec.w;
    return out;
  }

  function pump() {
    if (!n.up) return;
    const cs = consumers().filter(e => nodeUp(n, e.to));
    if (!cs.length) return;
    let progress = true;
    while (progress && readyW > 1e-9) {
      progress = false;
      for (let i = 0; i < cs.length; i++) {
        const e = cs[(rr + i) % cs.length];
        if ((perEdge.get(e.id) ?? 0) >= credit(e)) continue;
        const batch = takeBatch(batchFor(e));
        if (!batch.length) return;
        deliver(e, batch);
        progress = true;
      }
      rr++;
    }
  }

  function deliver(e: EdgeRt, entries: QEntry[]) {
    const t = ++tok;
    for (const en of entries) en.receives++;
    inflight.set(t, { entries, edge: e.id, to: e.to });
    perEdge.set(e.id, (perEdge.get(e.id) ?? 0) + 1);
    inflightW += sumW(entries.map(x => x.rec));
    const vis = n.num('visibilityMs', 30000);
    callOnce(n, e, batchMsg(n, e, entries.map(x => x.rec), n.id), vis, r => {
      if (!inflight.has(t)) return;
      if (r.ok) settle(t, true);
      else if (r.err !== 'timeout' && n.bool('nackRequeue', false)) settle(t, false);
      // otherwise stays invisible until the visibility timeout
    });
    n.timer(vis, () => {
      if (inflight.has(t)) settle(t, false);
    });
  }

  function settle(t: number, acked: boolean, dlqCheck = true) {
    const d = inflight.get(t)!;
    inflight.delete(t);
    perEdge.set(d.edge, (perEdge.get(d.edge) ?? 1) - 1);
    inflightW -= sumW(d.entries.map(x => x.rec));
    for (const en of d.entries) locked.delete(en.rec.key);
    if (!acked) {
      const back = [...d.entries].reverse();
      for (const en of back) {
        if (dlqCheck && en.receives >= n.num('maxReceives', 5)) toDlq(en);
        else enqueue(en, true);
      }
    }
    if (ordering() === 'fifo') {
      for (const en of d.entries) {
        const k = en.rec.key;
        if (!locked.has(k) && byKey.get(k)?.length) availKeys.push(k);
      }
    }
    pump();
  }

  function toDlq(en: QEntry) {
    dlqW += en.rec.w;
    if (dlqLogged++ < 3) n.log('info', `${n.name}: message moved to DLQ after ${en.receives} receives`);
    for (const e of n.outEdges(x => x.cfg.route === 'dlq')) {
      n.call(e, batchMsg(n, e, [en.rec], n.id), () => {});
    }
  }

  function tick() {
    // RabbitMQ-style: closed consumer connection → immediate requeue
    if (n.bool('nackRequeue', false)) {
      for (const [t, d] of [...inflight]) if (!nodeUp(n, d.to)) settle(t, false, false);
    }
    const cutoff = n.now - n.num('retentionSec', 345600) * 1000;
    let oldest = n.now;
    if (ordering() === 'fifo') {
      for (const q of byKey.values()) {
        while (q.length && q[0].enq < cutoff) expire(q.shift()!);
        if (q.length) oldest = Math.min(oldest, q[0].enq);
      }
    } else {
      while (std.length && std.at(0).enq < cutoff) expire(std.shift());
      for (let i = 0; i < Math.min(std.length, 8); i++) oldest = Math.min(oldest, std.at(i).enq);
    }
    for (const d of inflight.values()) for (const en of d.entries) oldest = Math.min(oldest, en.enq);
    n.gauge('depth', readyW);
    n.gauge('inflight', inflightW);
    n.gauge('oldestAgeSec', (n.now - oldest) / 1000);
    n.gauge('dlq', dlqW);
    if (lostW) n.gauge('expired', lostW);
    pump();
  }

  function expire(en: QEntry) {
    readyW -= en.rec.w;
    lostW += en.rec.w;
    n.anomaly('lost-write', en.rec.w);
  }

  return {
    onStart() {
      n.every(250, tick);
      pump();
    },
    onRequest(req: Req) {
      n.process(req.msg.weight, n.serviceTime('p50Ms', 'p99Ms', 5, 20), ok => {
        if (!ok || readyW + inflightW + req.msg.weight > n.num('maxDepth', 1e7)) return req.reply({ ok: false, err: '503' });
        for (const rec of makeRecs(req.msg, poisonPct)) enqueue({ rec, enq: n.now, receives: 0 });
        req.reply({ ok: true });
        pump();
      });
    },
    onKill() {
      // durable: in-flight messages become visible again after restart
      for (const t of [...inflight.keys()]) settle(t, false, false);
    },
    onChaos: (kind, p, heal) => poisonChaos(kind, p, heal, v => (poisonPct = v)),
    view() {
      const badges: Badge[] = [{ text: `${fmt(readyW)} msgs`, tone: readyW > 1000 ? 'warn' : 'muted' }];
      if (ordering() === 'fifo') badges.push({ text: 'FIFO', tone: 'accent' });
      if (dlqW > 0) badges.push({ text: `DLQ ${fmt(dlqW)}`, tone: 'fail' });
      return { badges };
    },
  };
}

// ---------- log-stream (Kafka / Kinesis) ----------

interface LEntry {
  rec: Rec;
  t: number;
  /** cumulative weight before this entry */
  cum: number;
}
interface Partition {
  base: number;
  log: LEntry[];
  totalW: number;
}
interface PState {
  committed: number;
  pos: number;
  inflight: number;
  owner?: string;
  retryAt: number;
}

export function logStream(n: SimNode): NodeLogic {
  const makeRecs = recordMaker(n);
  const P = Math.max(1, Math.round(n.num('partitions', 3)));
  const parts: Partition[] = Array.from({ length: P }, () => ({ base: 0, log: [], totalW: 0 }));
  const groups = new Map<string, PState[]>();
  const assignSig = new Map<string, string>();
  let tok = 0;
  let rrPart = 0;
  let poisonPct = 0;
  let unavailableUntil = 0;
  let pausedUntil = 0;
  let pumpQueued = false;

  const end = (p: Partition) => p.base + p.log.length;
  const cumAt = (p: Partition, off: number) => (off >= end(p) ? p.totalW : p.log[Math.max(0, off - p.base)]?.cum ?? p.totalW);
  const groupOf = (e: EdgeRt) => {
    const g = n.world.nodes.get(e.to)?.cfg.group;
    return e.cfg.route || (typeof g === 'string' && g) || e.to;
  };
  const acks = () => String(n.cfg.acks ?? 'all');

  function partitionFor(r: Rec): number {
    if (n.str<string>('partitionBy', 'key') === 'round-robin') return rrPart++ % P;
    return (Math.imul(r.key + 1, 2654435761) >>> 0) % P;
  }

  function append(r: Rec) {
    const p = parts[partitionFor(r)];
    p.log.push({ rec: r, t: n.now, cum: p.totalW });
    p.totalW += r.w;
  }

  function state(g: string): PState[] {
    let s = groups.get(g);
    if (!s) {
      const start = n.str<string>('startFrom', 'latest') === 'earliest';
      groups.set(g, (s = parts.map(p => ({ committed: start ? p.base : end(p), pos: start ? p.base : end(p), inflight: 0, retryAt: 0 }))));
    }
    return s;
  }

  function schedulePump() {
    if (pumpQueued) return;
    pumpQueued = true;
    n.timer(0, () => {
      pumpQueued = false;
      pump();
    });
  }

  function pump() {
    if (!n.up || n.now < pausedUntil) return;
    const byGroup = new Map<string, EdgeRt[]>();
    for (const e of n.outEdges(x => x.cfg.route !== 'dlq')) {
      const g = groupOf(e);
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g)!.push(e);
    }
    for (const [g, edges] of byGroup) {
      const st = state(g);
      const members = edges.filter(e => nodeUp(n, e.to)).sort((a, b) => (a.id < b.id ? -1 : 1));
      const sig = members.map(e => e.id).join(',');
      if (assignSig.has(g) && assignSig.get(g) !== sig) n.log('protocol', `${n.name}: rebalance of group ${g} (${members.length} members)`);
      assignSig.set(g, sig);
      for (let i = 0; i < P; i++) {
        const s = st[i];
        const owner = members.length ? members[i % members.length] : undefined;
        if (s.owner !== owner?.id) {
          // ownership moved: uncommitted work is redelivered to the new owner
          s.owner = owner?.id;
          s.inflight = 0;
          s.pos = s.committed;
        }
        if (owner) fetch(g, i, s, owner);
      }
    }
  }

  function fetch(g: string, i: number, s: PState, e: EdgeRt) {
    const p = parts[i];
    if (s.inflight || n.now < s.retryAt) return;
    if (s.pos < p.base) {
      // retention deleted records the group never read
      const lost = cumAt(p, p.base) - cumAt(p, s.pos);
      if (lost > 0) n.anomaly('lost-write', lost);
      s.pos = Math.max(s.pos, p.base);
      s.committed = Math.max(s.committed, p.base);
    }
    if (s.pos >= end(p)) return;
    const max = Math.max(1, Math.round(n.num('fetchBatch', 10)));
    const from = s.pos;
    const to = Math.min(end(p), from + max);
    const recs = p.log.slice(from - p.base, to - p.base).map(x => x.rec);
    const t = ++tok;
    s.inflight = t;
    s.pos = to;
    const before = n.str<string>('commit', 'after') === 'before';
    const L = ledger(n.world);
    if (before) {
      s.committed = to;
      for (const r of recs) if (!L.applied.has(g + '|' + r.mid)) L.acked.add(g + '|' + r.mid);
    }
    callOnce(n, e, batchMsg(n, e, recs, g), n.num('pollTimeoutMs', 5000), r => {
      if (s.inflight !== t) return;
      s.inflight = 0;
      if (r.ok) s.committed = Math.max(s.committed, to);
      else {
        if (!before) s.pos = s.committed;
        else if (r.err !== 'timeout') {
          // auto-committed before processing: a failed batch is simply gone
          for (const x of recs) {
            const k = g + '|' + x.mid;
            if (L.acked.delete(k)) n.anomaly('lost-write', x.w);
          }
        }
        s.retryAt = n.now + n.num('retryBackoffMs', 200);
        n.timer(n.num('retryBackoffMs', 200) + 1, pump);
      }
      schedulePump();
    });
  }

  /** Leader loss: with acks<all, records not yet on followers vanish. */
  function truncateTail() {
    if (acks() === 'all') return;
    const lagMs = n.num('replicaLagMs', 100);
    let lostW = 0;
    for (const p of parts) {
      let k = p.log.length;
      while (k > 0 && p.log[k - 1].t > n.now - lagMs) k--;
      const cut = p.log.splice(k);
      const w = sumW(cut.map(x => x.rec));
      p.totalW -= w;
      lostW += w;
    }
    if (lostW > 0) {
      n.anomaly('lost-write', lostW);
      n.log('protocol', `${n.name}: leader failover truncated ${fmt(lostW)} unreplicated records (acks=${acks()})`);
    }
    for (const st of groups.values())
      for (let i = 0; i < P; i++) {
        const e = end(parts[i]);
        st[i].pos = Math.min(st[i].pos, e);
        st[i].committed = Math.min(st[i].committed, e);
      }
  }

  function resetAll() {
    for (const st of groups.values())
      for (const s of st) {
        s.inflight = 0;
        s.pos = s.committed;
      }
  }

  function tick() {
    const cutoff = n.now - n.num('retentionSec', 604800) * 1000;
    const cap = n.num('maxRecordsPerPartition', 20000);
    for (const p of parts) {
      let k = 0;
      while (k < p.log.length && (p.log[k].t < cutoff || p.log.length - k > cap)) k++;
      if (k) {
        p.log.splice(0, k);
        p.base += k;
      }
    }
    let lag = 0;
    for (const [g, st] of groups) {
      let gl = 0;
      for (let i = 0; i < P; i++) gl += parts[i].totalW - cumAt(parts[i], st[i].committed);
      n.gauge(`lag:${g}`, gl);
      lag = Math.max(lag, gl);
    }
    n.gauge('lag', lag);
    n.gauge('records', parts.reduce((a, p) => a + p.log.length, 0));
    pump();
  }

  return {
    onStart() {
      n.every(250, tick);
    },
    onRequest(req: Req) {
      if (n.now < unavailableUntil) return req.reply({ ok: false, err: 'unavailable' });
      const a = acks();
      if (a === '0') req.reply({ ok: true });
      n.process(req.msg.weight, n.serviceTime('p50Ms', 'p99Ms', 2, 10), ok => {
        if (!ok) return a === '0' ? undefined : req.reply({ ok: false, err: '503' });
        for (const r of makeRecs(req.msg, poisonPct)) append(r);
        schedulePump();
        if (a === '1') req.reply({ ok: true });
        else if (a === 'all') n.timer(n.rng.lognormal(n.num('replicaMs', 2), n.num('replicaP99Ms', 10)), () => req.reply({ ok: true }));
      });
    },
    onKill() {
      pumpQueued = false;
      truncateTail();
      resetAll();
    },
    onChaos(kind, p, heal) {
      if (poisonChaos(kind, p, heal, v => (poisonPct = v))) return true;
      if (heal) return ['kill-leader', 'rebalance', 'replay'].includes(kind);
      switch (kind) {
        case 'kill-leader':
          truncateTail();
          resetAll();
          unavailableUntil = n.now + n.num('electionMs', 1500);
          pausedUntil = unavailableUntil;
          n.timer(n.num('electionMs', 1500) + 1, pump);
          return true;
        case 'rebalance':
          resetAll();
          pausedUntil = n.now + Number(p.pauseMs ?? n.num('rebalanceMs', 3000));
          n.timer(pausedUntil - n.now + 1, pump);
          return true;
        case 'replay': {
          const sec = p.sec !== undefined ? Number(p.sec) : undefined;
          for (const [g, st] of groups) {
            if (p.group && p.group !== g) continue;
            for (let i = 0; i < P; i++) {
              const part = parts[i];
              let off = part.base;
              if (sec !== undefined) {
                const idx = part.log.findIndex(x => x.t >= n.now - sec * 1000);
                off = idx < 0 ? end(part) : part.base + idx;
              }
              st[i].committed = st[i].pos = off;
              st[i].inflight = 0;
            }
          }
          n.log('protocol', `${n.name}: offsets reset${sec !== undefined ? ` to ${sec}s ago` : ' to earliest'}`);
          pump();
          return true;
        }
      }
      return false;
    },
    view() {
      const lag = n.gaugesNow.lag ?? 0;
      return { badges: [{ text: `P×${P}`, tone: 'muted' }, { text: `lag ${fmt(lag)}`, tone: lag > 1000 ? 'warn' : 'muted' }] };
    },
  };
}

// ---------- pub-sub (SNS / Google Pub/Sub) ----------

export function pubSub(n: SimNode): NodeLogic {
  const makeRecs = recordMaker(n);
  const backlog = new Map<string, number>();
  let poisonPct = 0;
  let droppedW = 0;

  function deliverTo(e: EdgeRt, recs: Rec[], attempt: number, done?: (ok: boolean) => void) {
    const w = sumW(recs);
    if (attempt === 1) backlog.set(e.id, (backlog.get(e.id) ?? 0) + w);
    const group = `${n.id}/${e.to}`;
    callOnce(n, e, batchMsg(n, e, recs, group), n.num('ackDeadlineMs', 10000), r => {
      if (r.ok || attempt >= n.num('maxAttempts', 5)) {
        backlog.set(e.id, (backlog.get(e.id) ?? w) - w);
        if (!r.ok) {
          droppedW += w;
          n.anomaly('lost-write', w);
        }
        return done?.(r.ok);
      }
      n.timer(n.num('retryBackoffMs', 100) * Math.pow(2, attempt - 1), () => deliverTo(e, recs, attempt + 1, done));
    });
  }

  return {
    onStart() {
      n.every(250, () => {
        let total = 0;
        for (const v of backlog.values()) total += v;
        n.gauge('backlog', total);
        n.gauge('dropped', droppedW);
      });
    },
    onRequest(req: Req) {
      n.process(req.msg.weight, n.serviceTime('p50Ms', 'p99Ms', 10, 50), ok => {
        if (!ok) return req.reply({ ok: false, err: '503' });
        const recs = makeRecs(req.msg, poisonPct);
        const subs = n.outEdges().filter(e => n.rng.chance(e.cfg.ratio ?? 1));
        if (n.str<string>('delivery', 'async') !== 'sync') {
          req.reply({ ok: true });
          for (const e of subs) deliverTo(e, recs, 1);
          return;
        }
        // sync: publisher waits for the slowest subscriber
        let left = subs.length;
        let allOk = true;
        if (!left) return req.reply({ ok: true });
        for (const e of subs)
          deliverTo(e, recs, 1, ok2 => {
            allOk &&= ok2;
            if (--left === 0) req.reply(allOk ? { ok: true } : { ok: false, err: '5xx' });
          });
      });
    },
    onChaos: (kind, p, heal) => poisonChaos(kind, p, heal, v => (poisonPct = v)),
    view() {
      const b = n.gaugesNow.backlog ?? 0;
      return { badges: [{ text: `→${n.outEdges().length}`, tone: 'muted' }, ...(b > 100 ? [{ text: `backlog ${fmt(b)}`, tone: 'warn' as const }] : [])] };
    },
  };
}

// ---------- worker (Celery / Sidekiq) ----------

export function worker(n: SimNode): NodeLogic {
  const held = new Map<number, { group: string; recs: Set<Rec> }>();
  let job = 0;
  let processedW = 0;
  let dedupedW = 0;

  function lose(group: string, recs: Iterable<Rec>) {
    const L = ledger(n.world);
    for (const r of recs) if (L.acked.delete(group + '|' + r.mid)) n.anomaly('lost-write', r.w);
  }

  return {
    onStart() {
      n.every(250, () => {
        let w = 0;
        for (const h of held.values()) for (const r of h.recs) w += r.w;
        n.gauge('inflight', w);
        n.gauge('processed', processedW);
        n.gauge('deduped', dedupedW);
      });
    },
    onRequest(req: Req) {
      const m = req.msg;
      const group = isMq(m) ? m.data.group : n.id;
      const recs: Rec[] = isMq(m)
        ? m.data.records
        : [{ mid: `${m.from}:${m.idem ?? m.id}`, src: m.from, key: m.key ?? 0, seq: 0, w: m.weight, traceId: m.traceId }];
      const L = ledger(n.world);
      const early = n.str<string>('ackMode', 'late') === 'early';
      const idem = n.bool('idempotent', false);
      const t = ++job;
      const h = { group, recs: new Set(recs) };
      held.set(t, h);
      if (early) {
        for (const r of recs) if (!L.applied.has(group + '|' + r.mid)) L.acked.add(group + '|' + r.mid);
        req.reply({ ok: true });
      }
      const fail = (err: Reply['err']) => {
        held.delete(t);
        if (early) lose(group, h.recs);
        else req.reply({ ok: false, err });
      };
      let i = 0;
      const next = (): void => {
        if (i >= recs.length) {
          held.delete(t);
          n.publish(req);
          if (!early) {
            const ackMs = n.num('ackMs', 2);
            if (ackMs > 0) n.timer(ackMs, () => req.reply({ ok: true }));
            else req.reply({ ok: true });
          }
          return;
        }
        const r = recs[i++];
        const k = group + '|' + r.mid;
        if (idem && L.applied.has(k)) {
          dedupedW += r.w;
          h.recs.delete(r);
          return next();
        }
        n.process(r.w, n.serviceTime(), ok => {
          if (!ok) return fail('503');
          if (r.poison) return fail('5xx');
          const apply = () => {
            if (L.applied.has(k)) {
              if (idem) dedupedW += r.w;
              else n.anomaly('duplicate', r.w);
            } else {
              markApplied(L, k);
              if (r.seq) {
                const ok2 = `${group}|${r.src}|${r.key}`;
                const last = L.lastSeq.get(ok2) ?? 0;
                if (r.seq < last) n.anomaly('out-of-order', r.w);
                else L.lastSeq.set(ok2, r.seq);
              }
            }
            L.acked.delete(k);
            h.recs.delete(r);
            processedW += r.w;
            next();
          };
          const out = n.syncOut('write');
          if (!out.length) return apply();
          const base = n.world.newMsg({ from: n.id, to: n.id, op: 'write', key: r.key, weight: r.w, traceId: r.traceId });
          n.forward({ msg: base, at: n.now, reply: () => {} }, out, 'all', res => (res.ok ? apply() : fail(res.err ?? '5xx')));
        });
      };
      next();
    },
    onKill() {
      for (const h of held.values()) lose(h.group, h.recs);
      held.clear();
    },
    view() {
      const badges: Badge[] = [{ text: n.str<string>('ackMode', 'late') === 'early' ? 'ack early' : 'ack late', tone: 'muted' }];
      if (n.bool('idempotent', false)) badges.push({ text: 'idempotent', tone: 'ok' });
      return { badges };
    },
  };
}

// ---------- outbox-relay (Debezium / polling publisher) ----------

export function outboxRelay(n: SimNode): NodeLogic {
  const makeRecs = recordMaker(n);
  // outbox rows live in the DB: they survive relay restarts
  const pending: { rec: Rec; t: number }[] = [];
  let sending = false;
  let relayedW = 0;

  function send(recs: Rec[], cb: (ok: boolean) => void) {
    const outs = n.outEdges();
    if (!outs.length) return cb(true);
    let left = outs.length;
    let allOk = true;
    for (const e of outs) {
      n.call(e, batchMsg(n, e, recs, n.id), r => {
        allOk &&= r.ok;
        if (--left === 0) cb(allOk);
      });
    }
  }

  function poll() {
    if (sending || !pending.length) return;
    const batch = pending.slice(0, Math.max(1, Math.round(n.num('batch', 100))));
    sending = true;
    const epoch = n.epoch;
    send(
      batch.map(x => x.rec),
      ok => {
        if (epoch !== n.epoch) return;
        sending = false;
        if (!ok) return;
        pending.splice(0, batch.length);
        relayedW += sumW(batch.map(x => x.rec));
        if (pending.length) poll();
      },
    );
  }

  return {
    onStart() {
      sending = false;
      n.every(n.num('pollMs', 500), poll);
      n.every(250, () => {
        n.gauge('pending', sumW(pending.map(x => x.rec)));
        n.gauge('relayLagMs', pending.length ? n.now - pending[0].t : 0);
        n.gauge('relayed', relayedW);
      });
    },
    onRequest(req: Req) {
      n.process(req.msg.weight, n.serviceTime('p50Ms', 'p99Ms', 1, 5), ok => {
        if (!ok) return req.reply({ ok: false, err: '503' });
        const recs = makeRecs(req.msg, 0);
        if (n.str<string>('mode', 'outbox') === 'dual-write') {
          // DB write already committed; the broker publish is best-effort
          req.reply({ ok: true });
          send(recs, ok2 => {
            if (ok2) relayedW += sumW(recs);
            else n.anomaly('lost-write', sumW(recs));
          });
          return;
        }
        for (const rec of recs) pending.push({ rec, t: n.now });
        req.reply({ ok: true });
      });
    },
    view() {
      const p = n.gaugesNow.pending ?? 0;
      return { badges: [{ text: n.str<string>('mode', 'outbox') === 'dual-write' ? 'dual-write' : `outbox ${fmt(p)}`, tone: p > 1000 ? 'warn' : 'muted' }] };
    },
  };
}

register('queue', queue);
register('log-stream', logStream);
register('pub-sub', pubSub);
register('worker', worker);
register('outbox-relay', outboxRelay);
