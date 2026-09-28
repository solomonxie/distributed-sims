// Flink internals: JobManager (scheduler + checkpoint coordinator), TaskManagers with slots,
// a Kafka source topic, checkpoint storage and a sink. Pipeline per slot s (slot sharing):
// [Kafka source s → map] (chained, no network) ─keyBy→ [window s → sink writer s].
// Protocol kinds: flink.fetch (rpc), flink.records, flink.trigger, flink.ack, flink.snapshot (rpc),
// flink.heartbeat, flink.deploy, flink.cancel, flink.complete, flink.write, flink.commit, flink.restore.
import type { NodeLogic, Req, SimNode } from '../node';
import type { World } from '../world';
import type { Badge, Msg } from '../types';
import { register } from './registry';
import { clusterOf } from '../composite';

interface Rec {
  off: number;
  ts: number;
  key: number;
  w: number;
  trace?: string;
}

interface Result {
  id: string;
  key: number;
  win: number;
  count: number;
  late: boolean;
  at: number;
  trace?: string;
}

interface WinState {
  wins: [number, [number, number][]][];
  fires: [string, number][];
  fired: number[];
  purgedBefore: number;
}

interface Ckpt {
  k: number;
  offsets: number[];
  states: (WinState | undefined)[];
}

interface JobCfg {
  attempt: number;
  P: number;
  assign: string[];
  windowMs: number;
  boundMs: number;
  latenessMs: number;
  source: string;
  sink?: string;
  storage?: string;
  jm: string;
}

/** nodes of a type in the same Flink cluster (composite instance) as n */
const ofType = (n: SimNode, type: string) => [...n.world.nodes.values()].filter(x => x.type === type && clusterOf(x, 'flink') === clusterOf(n, 'flink'));
const sec = (ms: number) => (ms / 1000).toFixed(1) + 's';
const winLabel = (win: number, size: number) => `[${sec(win)}, ${sec(win + size)})`;

// ---------------- Kafka source topic ----------------
register('flink-source', n => {
  let logs: Rec[][] = [];
  let base: number[] = [];
  let pos: number[] = [];
  let traced = 0;
  const parts = () => Math.max(1, Math.round(n.num('partitions', 4)));
  const end = (p: number) => base[p] + logs[p].length;
  const reset = () => {
    logs = Array.from({ length: parts() }, () => []);
    base = logs.map(() => 0);
    pos = logs.map(() => 0);
  };
  return {
    handles: k => k.startsWith('flink.'),
    onStart() {
      if (!logs.length) reset();
      n.every(1000, () => {
        let lag = 0;
        for (let p = 0; p < logs.length; p++) lag += end(p) - pos[p];
        n.gauge('lag', Math.round(lag));
        n.gauge('endOffset', logs.reduce((a, _, p) => a + end(p), 0));
      });
    },
    onRequest(req: Req) {
      const m = req.msg;
      if (m.kind === 'flink.fetch') {
        const { p, from, max } = m.data;
        const lo = Math.max(from, base[p]);
        pos[p] = from;
        const recs = logs[p].slice(lo - base[p], lo - base[p] + max);
        return req.reply({ ok: true, data: { recs, next: lo + recs.length } });
      }
      if (m.kind === 'flink.trim') {
        const offs: number[] = m.data.offsets;
        for (let p = 0; p < logs.length; p++) {
          const drop = Math.max(0, Math.min(offs[p] ?? 0, end(p)) - base[p] - 5000);
          if (drop > 0) {
            logs[p] = logs[p].slice(drop);
            base[p] += drop;
          }
        }
        return req.reply({ ok: true });
      }
      n.process(m.weight, n.serviceTime('p50Ms', 'p99Ms', 1, 5), ok => {
        if (!ok) return req.reply({ ok: false, err: '503' });
        const keys = Math.max(1, Math.round(n.num('keys', 8)));
        const key = (m.key ?? 0) % keys;
        const p = key % logs.length;
        const sender = n.world.nodes.get(m.from);
        const delay = n.rng.lognormal(n.num('eventDelayMs', 150), n.num('eventDelayP99Ms', 600));
        const ts = Math.max(0, (sender ? sender.clock() : n.now) - delay);
        const rec: Rec = { off: end(p), ts, key, w: m.weight };
        if (traced < 1 && n.now > 1500) {
          rec.trace = `e${++traced}`;
          n.log('protocol', `${rec.trace} (key k${key}, event time ${sec(ts)}) appended to Kafka partition ${p} @ offset ${rec.off}`);
        }
        logs[p].push(rec);
        req.reply({ ok: true });
      });
    },
    view() {
      const lag = n.gaugesNow.lag ?? 0;
      return { badges: [{ text: `${logs.length} partitions`, tone: 'muted' }, ...(lag > 500 ? [{ text: `lag ${Math.round(lag)}`, tone: 'warn' as const }] : [])] as Badge[] };
    },
  };
});

// ---------------- Checkpoint storage (S3 / HDFS) ----------------
register('flink-checkpoint-storage', n => ({
  handles: k => k.startsWith('flink.'),
  onStart() {
    n.every(1000, () => n.gauge('snapshots', n.gaugesNow.snapshots ?? 0));
  },
  onRequest(req: Req) {
    const kb = Number(req.msg.data?.kb ?? 16);
    const ms = n.serviceTime('p50Ms', 'p99Ms', 30, 150) + (kb / Math.max(1, n.num('mbps', 200)) / 1024) * 1000 * n.mods.slowX;
    n.process(1, ms, ok => {
      if (!ok) return req.reply({ ok: false, err: '503' });
      n.gauge('snapshots', (n.gaugesNow.snapshots ?? 0) + 1);
      req.reply({ ok: true });
    });
  },
}));

// ---------------- Sink (external system: Kafka topic / DB) ----------------
interface SinkLedger {
  visible: Map<string, number>;
}
const sinkLedgers = new WeakMap<World, SinkLedger>();

register('flink-sink', n => {
  const txns = new Map<string, { att: number; sub: number; epoch: number; results: Result[] }>();
  let minAtt = 0;
  let visible = 0;
  let dups = 0;
  let aborted = 0;
  let lagSum = 0;
  let lagN = 0;
  const ledger = () => {
    let l = sinkLedgers.get(n.world);
    if (!l) sinkLedgers.set(n.world, (l = { visible: new Map() }));
    return l;
  };
  const show = (rs: Result[], how: string) => {
    const l = ledger();
    for (const r of rs) {
      const c = (l.visible.get(r.id) ?? 0) + 1;
      l.visible.set(r.id, c);
      visible++;
      lagSum += n.now - r.at;
      lagN++;
      n.series.cur.inW += 1;
      n.series.cur.okW += 1;
      if (c > 1) {
        dups++;
        n.anomaly('duplicate', 1);
        if (dups <= 3) n.log('info', `Duplicate output: window ${r.id} (count ${r.count}) written again after replay`);
      }
      if (r.trace) n.log('protocol', `${r.trace}: result k${r.key} ${how} → visible to downstream readers`);
    }
  };
  const commit = (id: string) => {
    const t = txns.get(id);
    if (!t) return;
    txns.delete(id);
    show(t.results, `committed in txn ${id}`);
  };
  return {
    handles: k => k.startsWith('flink.'),
    onStart() {
      n.every(1000, () => {
        n.gauge('visible', visible);
        n.gauge('pending', [...txns.values()].reduce((a, t) => a + t.results.length, 0));
        n.gauge('duplicates', dups);
        n.gauge('aborted', aborted);
        if (lagN) n.gauge('visibleLagMs', Math.round(lagSum / lagN));
        lagSum = 0;
        lagN = 0;
      });
    },
    onMessage(m: Msg) {
      const d = m.data;
      if (m.kind === 'flink.write') {
        if (!d.tx) return show(d.results, 'written (at-least-once, no transaction)');
        if (d.att < minAtt) return; // producer fenced by the restarted job
        let t = txns.get(d.tx);
        if (!t) txns.set(d.tx, (t = { att: d.att, sub: d.sub, epoch: d.epoch, results: [] }));
        t.results.push(...d.results);
        for (const r of d.results as Result[]) if (r.trace) n.log('protocol', `${r.trace}: result k${r.key} written into open txn ${d.tx} (uncommitted, invisible)`);
      } else if (m.kind === 'flink.commit') {
        const subs = new Set<number>(d.subs);
        for (const [id, t] of [...txns]) if (t.att === d.att && subs.has(t.sub) && t.epoch <= d.k) commit(id);
      } else if (m.kind === 'flink.restore') {
        // recover: commit txns covered by the restored checkpoint, abort the rest
        minAtt = Math.max(minAtt, d.att);
        let ab = 0;
        for (const [id, t] of [...txns]) {
          if (t.epoch <= d.k) commit(id);
          else {
            ab += t.results.length;
            txns.delete(id);
          }
        }
        aborted += ab;
        if (ab) n.log('protocol', `Sink: aborted ${ab} uncommitted result(s) written after checkpoint ${d.k}`);
      }
    },
    view() {
      const mode = n.str('delivery', 'exactly-once');
      return { badges: [{ text: mode === 'exactly-once' ? '2PC' : 'at-least-once', tone: mode === 'exactly-once' ? 'ok' : 'warn' }] as Badge[] };
    },
  };
});

// ---------------- TaskManager ----------------
interface Chan {
  next: number;
  buf: Map<number, any>;
  wm: number;
  barrier: number;
}

interface Sub {
  s: number;
  job: JobCfg;
  // source side (source → map chained)
  pos: number;
  fetching: boolean;
  srcMaxTs: number;
  outSeq: number[];
  pendingBarrier: number;
  // window side
  chans: Chan[];
  wm: number;
  wins: Map<number, Map<number, number>>;
  fires: Map<string, number>;
  fired: Set<number>;
  purgedBefore: number;
  aligning: number;
  alignStart: number;
  epoch: number;
  srcBusy: number;
  winBusy: number;
}

register('flink-taskmanager', n => {
  let subs = new Map<number, Sub>();
  let lateDropped = 0;
  let lateUpdates = 0;
  let fired = 0;
  let bpMs = 0;
  let lastAlign = 0;
  let lastLateLog = -1e9;
  const slots = () => Math.max(1, Math.round(n.num('slots', 2)));
  const recUs = () => n.num('recordUs', 100);
  const peer = (id: string) => n.world.nodes.get(id);
  const tmLogic = (id: string) => peer(id)?.logic as any;
  const sinkMode = (j: JobCfg) => (j.sink ? peer(j.sink)?.str('delivery', 'exactly-once') : 'at-least-once') ?? 'at-least-once';

  const backlog = (t: number) => {
    const x = subs.get(t);
    if (!x) return 0;
    let r = 0;
    for (const c of x.chans) for (const b of c.buf.values()) r += b.w ?? 0;
    return r;
  };

  /** each subtask is its own thread; returns when this piece of work finishes */
  function occupy(x: Sub, side: 'srcBusy' | 'winBusy', ms: number): number {
    x[side] = Math.max(n.now, x[side]) + ms;
    n.series.cur.busy += ms;
    return x[side] - n.now;
  }

  // ---- source side ----
  function fetch(x: Sub) {
    const j = x.job;
    if (x.fetching || subs.get(x.s) !== x) return;
    if (x.pendingBarrier) return injectBarrier(x);
    // credit-based flow control: a full downstream buffer stops the source
    const full = j.assign.some((tm, t) => (tmLogic(tm)?.backlog?.(t) ?? 0) > n.num('bufferRecords', 2000));
    if (full) {
      bpMs += n.num('fetchMs', 200);
      return;
    }
    x.fetching = true;
    n.rpc(j.source, { kind: 'flink.fetch', data: { p: x.s % Math.max(1, peer(j.source)?.num('partitions', 4) ?? 4), from: x.pos, max: n.num('fetchMax', 500) } }, 2000, r => {
      if (subs.get(x.s) !== x) return;
      if (!r.ok) {
        x.fetching = false;
        return;
      }
      const recs: Rec[] = r.data.recs;
      const w = recs.reduce((a, b) => a + b.w, 0);
      n.timer(occupy(x, 'srcBusy', (w * recUs() * n.num('mapCost', 0.3) * n.mods.slowX) / 1000), () => {
        x.fetching = false;
        if (subs.get(x.s) !== x) return;
        x.pos = r.data.next;
        for (const rec of recs) x.srcMaxTs = Math.max(x.srcMaxTs, rec.ts);
        const wm = x.srcMaxTs - j.boundMs;
        const by: Rec[][] = Array.from({ length: j.P }, () => []);
        for (const rec of recs) {
          by[rec.key % j.P].push(rec);
          if (rec.trace) n.log('protocol', `${rec.trace} read by source[${x.s}] on ${n.name}; map chained in the same thread; keyBy → window[${rec.key % j.P}] on ${n.world.nodeName(j.assign[rec.key % j.P])}`);
        }
        for (let t = 0; t < j.P; t++) emitTo(x, t, by[t], wm, 0);
        if (x.pendingBarrier) injectBarrier(x);
      });
    });
  }

  function emitTo(x: Sub, t: number, recs: Rec[], wm: number, barrier: number) {
    const j = x.job;
    n.send(j.assign[t], { kind: 'flink.records', data: { att: j.attempt, ch: x.s, sub: t, seq: x.outSeq[t]++, recs, wm, barrier, w: recs.reduce((a, b) => a + b.w, 0) } });
  }

  function injectBarrier(x: Sub) {
    const k = x.pendingBarrier;
    x.pendingBarrier = 0;
    const wm = x.srcMaxTs - x.job.boundMs;
    for (let t = 0; t < x.job.P; t++) emitTo(x, t, [], wm, k);
    n.send(x.job.jm, { kind: 'flink.ack', data: { att: x.job.attempt, k, part: 'source', s: x.s, offset: x.pos } });
  }

  // ---- window side ----
  function pump(x: Sub) {
    if (subs.get(x.s) !== x || n.now < x.winBusy) return;
    for (let i = 0; i < x.chans.length; i++) {
      const c = x.chans[i];
      if (c.barrier && x.aligning) continue; // aligned checkpoint: channel blocked until all barriers arrive
      const item = c.buf.get(c.next);
      if (!item) continue;
      c.buf.delete(c.next);
      c.next++;
      n.timer(occupy(x, 'winBusy', (item.w * recUs() * n.mods.slowX) / 1000), () => {
        if (subs.get(x.s) !== x) return;
        for (const r of item.recs as Rec[]) apply(x, r);
        c.wm = Math.max(c.wm, item.wm);
        advance(x);
        if (item.barrier) onBarrier(x, c, item.barrier);
        pump(x);
      });
      return;
    }
  }

  function winOf(x: Sub, ts: number) {
    return Math.floor(ts / x.job.windowMs) * x.job.windowMs;
  }

  function apply(x: Sub, r: Rec) {
    const j = x.job;
    const win = winOf(x, r.ts);
    const endT = win + j.windowMs;
    if (endT <= x.wm) {
      if (endT + j.latenessMs <= x.wm || win < x.purgedBefore) {
        lateDropped += r.w;
        if (n.now - lastLateLog > 3000) {
          lastLateLog = n.now;
          n.log('info', `Late event dropped on window[${x.s}]: event time ${sec(r.ts)} is behind watermark ${sec(x.wm)}`);
        }
        return;
      }
      const m = x.wins.get(win) ?? new Map();
      x.wins.set(win, m);
      m.set(r.key, (m.get(r.key) ?? 0) + r.w);
      lateUpdates += r.w;
      emit(x, [result(x, win, r.key, true)]);
      return;
    }
    const m = x.wins.get(win) ?? new Map<number, number>();
    x.wins.set(win, m);
    m.set(r.key, (m.get(r.key) ?? 0) + r.w);
    if (r.trace) {
      n.log('protocol', `${r.trace} counted in window ${winLabel(win, j.windowMs)} for k${r.key} on window[${x.s}] (waits for watermark ≥ ${sec(endT)})`);
      traces.set(`${r.key}@${win}`, r.trace);
    }
  }
  const traces = new Map<string, string>();

  function result(x: Sub, win: number, key: number, late: boolean): Result {
    const base = `k${key}@${win}`;
    const f = x.fires.get(base) ?? 0;
    x.fires.set(base, f + 1);
    const tr = traces.get(`${key}@${win}`);
    if (tr) traces.delete(`${key}@${win}`);
    return { id: `${base}#${f}`, key, win, count: x.wins.get(win)?.get(key) ?? 0, late, at: n.now, trace: tr };
  }

  function advance(x: Sub) {
    const j = x.job;
    const wm = Math.min(...x.chans.map(c => c.wm));
    if (wm <= x.wm) return;
    x.wm = wm;
    const out: Result[] = [];
    for (const win of [...x.wins.keys()].sort((a, b) => a - b)) {
      const endT = win + j.windowMs;
      if (endT <= wm && !x.fired.has(win)) {
        x.fired.add(win);
        fired++;
        for (const key of x.wins.get(win)!.keys()) {
          const r = result(x, win, key, false);
          if (r.trace) n.log('protocol', `${r.trace}: watermark ${sec(wm)} passed window end → window ${winLabel(win, j.windowMs)} fires, k${key} count = ${r.count}`);
          out.push(r);
        }
      }
      if (endT + j.latenessMs <= wm) {
        x.wins.delete(win);
        x.fired.delete(win);
        x.purgedBefore = Math.max(x.purgedBefore, endT);
      }
    }
    if (out.length) emit(x, out);
  }

  function emit(x: Sub, rs: Result[]) {
    const j = x.job;
    if (!j.sink) return;
    const eo = sinkMode(j) === 'exactly-once';
    n.send(j.sink, { kind: 'flink.write', data: { tx: eo ? `${j.attempt}:${x.s}.${x.epoch + 1}` : undefined, att: j.attempt, sub: x.s, epoch: x.epoch + 1, results: rs } });
  }

  function onBarrier(x: Sub, c: Chan, k: number) {
    c.barrier = k;
    if (!x.aligning) {
      x.aligning = k;
      x.alignStart = n.now;
    }
    if (x.chans.some(ch => ch.barrier !== k)) return;
    // aligned: snapshot state, forward barrier (pre-commit sink txn), unblock inputs
    const align = n.now - x.alignStart;
    lastAlign = align;
    const state: WinState = {
      wins: [...x.wins].map(([w, m]) => [w, [...m]]),
      fires: [...x.fires],
      fired: [...x.fired],
      purgedBefore: x.purgedBefore,
    };
    x.epoch = k;
    for (const ch of x.chans) ch.barrier = 0;
    x.aligning = 0;
    const j = x.job;
    const keys = state.wins.reduce((a, [, m]) => a + m.length, 0);
    const kb = 8 + keys * n.num('stateKbPerKey', 0.5);
    if (x.s === 0 && k <= 2) n.log('protocol', `window[0] aligned barrier ${k} from ${x.chans.length} inputs in ${Math.round(align)}ms; async snapshot (${Math.round(kb)} KB) → checkpoint storage`);
    const done = () => n.send(j.jm, { kind: 'flink.ack', data: { att: j.attempt, k, part: 'window', s: x.s, state, align } });
    if (j.storage) n.rpc(j.storage, { kind: 'flink.snapshot', data: { k, sub: x.s, kb } }, 60_000, r => r.ok && subs.get(x.s) === x && done());
    else done();
    pump(x);
  }

  function deploy(d: any) {
    const j: JobCfg = d.job;
    const st: WinState | undefined = d.state;
    const x: Sub = {
      s: d.s,
      job: j,
      pos: d.offset ?? 0,
      fetching: false,
      srcMaxTs: -Infinity,
      outSeq: Array(j.P).fill(0),
      pendingBarrier: 0,
      chans: Array.from({ length: j.P }, () => ({ next: 0, buf: new Map(), wm: -Infinity, barrier: 0 })),
      wm: -Infinity,
      wins: new Map((st?.wins ?? []).map(([w, m]) => [w, new Map(m)])),
      fires: new Map(st?.fires ?? []),
      fired: new Set(st?.fired ?? []),
      purgedBefore: st?.purgedBefore ?? -Infinity,
      aligning: 0,
      alignStart: 0,
      epoch: d.k ?? 0,
      srcBusy: n.now,
      winBusy: n.now,
    };
    subs.set(d.s, x);
  }

  const gauges = () => {
    n.gauge('slotsUsed', subs.size);
    let bl = 0;
    let wmLag = 0;
    for (const x of subs.values()) {
      bl += backlog(x.s);
      if (isFinite(x.wm)) wmLag = Math.max(wmLag, n.now - x.wm);
    }
    n.gauge('backlog', Math.round(bl));
    n.gauge('lateDropped', Math.round(lateDropped));
    n.gauge('lateUpdates', Math.round(lateUpdates));
    n.gauge('windowsFired', fired);
    n.gauge('backpressure', Math.min(100, Math.round((bpMs / Math.max(1, subs.size * 1000)) * 100)));
    n.gauge('watermarkLagMs', Math.round(wmLag));
    n.gauge('alignMs', Math.round(lastAlign));
    bpMs = 0;
  };

  return {
    handles: k => k.startsWith('flink.'),
    onStart() {
      subs = new Map();
      const hb = () => {
        const jm = ofType(n, 'flink-jobmanager')[0];
        if (jm) n.send(jm.id, { kind: 'flink.heartbeat', data: { slots: slots(), running: [...subs.values()].map(x => `${x.job.attempt}:${x.s}`) } });
      };
      hb();
      n.every(n.num('heartbeatMs', 1000), hb);
      n.every(n.num('fetchMs', 200), () => {
        for (const x of subs.values()) fetch(x);
      });
      n.every(1000, gauges);
    },
    onMessage(m: Msg) {
      const d = m.data;
      if (m.kind === 'flink.deploy') deploy(d);
      else if (m.kind === 'flink.cancel') {
        for (const [s, x] of [...subs]) if (x.job.attempt < d.attempt) subs.delete(s);
      } else if (m.kind === 'flink.trigger') {
        const x = subs.get(d.s);
        if (x && x.job.attempt === d.att) {
          x.pendingBarrier = d.k;
          if (!x.fetching) injectBarrier(x);
        }
      } else if (m.kind === 'flink.records') {
        const x = subs.get(d.sub);
        if (!x || x.job.attempt !== d.att) return;
        x.chans[d.ch].buf.set(d.seq, d);
        pump(x);
      } else if (m.kind === 'flink.complete') {
        // notifyCheckpointComplete: commit this slot's pre-committed sink txns
        const mine = [...subs.values()].filter(x => x.job.attempt === d.att);
        const j = mine[0]?.job;
        if (j?.sink && sinkMode(j) === 'exactly-once') n.send(j.sink, { kind: 'flink.commit', data: { att: d.att, subs: mine.map(x => x.s), k: d.k } });
      }
    },
    onKill() {
      if (subs.size) n.log('info', `${n.name} died with ${subs.size} running slot(s); their in-memory window state is gone`);
      subs = new Map();
      gauges();
    },
    view() {
      const bp = n.gaugesNow.backpressure ?? 0;
      return {
        badges: [
          { text: `${subs.size}/${slots()} slots`, tone: subs.size ? 'accent' : 'muted' },
          ...(bp > 20 ? [{ text: 'backpressured', tone: 'warn' as const }] : []),
        ] as Badge[],
      };
    },
    ...({ backlog } as object),
  };
});

// ---------------- JobManager ----------------
register('flink-jobmanager', n => {
  const lastHb = new Map<string, number>();
  const tmSlots = new Map<string, number>();
  let job: JobCfg | undefined;
  let attempt = 0;
  let running = false;
  let restartAt = 0;
  let waitingLogged = false;
  let ckSeq = 0;
  let pending: { k: number; t0: number; att: number; src: Map<number, number>; win: Map<number, WinState>; align: number } | undefined;
  let last: Ckpt | undefined;
  let completed = 0;
  let failed = 0;
  let restarts = 0;
  let lastMs = 0;
  let lastAlign = 0;

  const P = () => Math.max(1, Math.round(n.num('parallelism', 4)));
  let deployedAt = 0;
  const liveTms = () => [...lastHb.keys()].filter(id => n.now - (lastHb.get(id) ?? 0) <= n.num('heartbeatTimeoutMs', 4000));
  const first = (type: string) => ofType(n, type)[0]?.id;

  function deploy() {
    const tms = liveTms().sort();
    const free = tms.reduce((a, t) => a + (tmSlots.get(t) ?? 0), 0);
    if (free < P()) {
      if (!waitingLogged) n.log('info', `Not enough task slots: job needs ${P()}, ${free} available; waiting for a TaskManager`);
      waitingLogged = true;
      return;
    }
    waitingLogged = false;
    attempt++;
    // spread subtasks over TaskManagers (cluster.evenly-spread-out-slots)
    const used = new Map<string, number>();
    const assign: string[] = [];
    for (let s = 0; s < P(); s++) {
      const tm = tms.filter(t => (used.get(t) ?? 0) < (tmSlots.get(t) ?? 0)).sort((a, b) => (used.get(a) ?? 0) - (used.get(b) ?? 0))[0];
      assign.push(tm);
      used.set(tm, (used.get(tm) ?? 0) + 1);
    }
    job = {
      attempt,
      P: P(),
      assign,
      windowMs: n.num('windowMs', 5000),
      boundMs: n.num('boundMs', 1000),
      latenessMs: n.num('allowedLatenessMs', 0),
      source: first('flink-source')!,
      sink: first('flink-sink'),
      storage: first('flink-checkpoint-storage'),
      jm: n.id,
    };
    for (const t of tms) n.send(t, { kind: 'flink.cancel', data: { attempt } });
    if (job.sink) n.send(job.sink, { kind: 'flink.restore', data: { k: last?.k ?? 0, att: attempt } });
    deployedAt = n.now;
    for (let s = 0; s < P(); s++) n.send(assign[s], { kind: 'flink.deploy', data: { s, job, offset: last?.offsets[s] ?? 0, state: last?.states[s], k: last?.k ?? 0 } });
    running = true;
    n.log('protocol', last ? `Job restarted (attempt ${attempt}) from checkpoint ${last.k}: state restored, Kafka offsets rewound to [${last.offsets.join(', ')}] → replay` : `Job deployed: ${P()} subtasks on ${new Set(assign).size} TaskManagers (source→map chained, keyBy → window→sink)`);
  }

  function failover(why: string) {
    running = false;
    restarts++;
    pending = undefined;
    attempt++;
    for (const t of liveTms()) n.send(t, { kind: 'flink.cancel', data: { attempt } });
    n.log('protocol', `${why} → cancel all tasks, restart from ${last ? `checkpoint ${last.k}` : 'the beginning (no checkpoint yet)'}`);
    restartAt = n.now + n.num('restartDelayMs', 1000);
  }

  function trigger() {
    if (!running || pending || !job) return;
    const k = ++ckSeq;
    pending = { k, t0: n.now, att: job.attempt, src: new Map(), win: new Map(), align: 0 };
    if (k <= 2) n.log('protocol', `Checkpoint ${k} triggered: barrier ${k} injected into each source`);
    for (let s = 0; s < job.P; s++) n.send(job.assign[s], { kind: 'flink.trigger', data: { k, s, att: job.attempt } });
  }

  function maybeComplete() {
    if (!pending || !job) return;
    if (pending.src.size < job.P || pending.win.size < job.P) return;
    const p = pending;
    pending = undefined;
    last = { k: p.k, offsets: [...Array(job.P).keys()].map(s => p.src.get(s)!), states: [...Array(job.P).keys()].map(s => p.win.get(s)) };
    completed++;
    lastMs = n.now - p.t0;
    lastAlign = p.align;
    n.log('protocol', `Checkpoint ${p.k} complete in ${Math.round(lastMs)}ms (max alignment ${Math.round(p.align)}ms); notify tasks → sink transactions commit`);
    for (const t of new Set(job.assign)) n.send(t, { kind: 'flink.complete', data: { k: p.k, att: job.attempt } });
    n.rpc(job.source, { kind: 'flink.trim', data: { offsets: last.offsets } }, 2000, () => {});
  }

  return {
    handles: k => k.startsWith('flink.'),
    onStart() {
      restartAt = n.now + 500;
      n.every(250, () => {
        for (const [tm, t] of [...lastHb]) {
          const node = n.world.nodes.get(tm);
          if (n.now - t > n.num('heartbeatTimeoutMs', 4000)) {
            lastHb.delete(tm);
            const hosted = job?.assign.includes(tm);
            n.log('info', `TaskManager ${node?.name ?? tm} lost: no heartbeat for ${sec(n.num('heartbeatTimeoutMs', 4000))}`);
            if (running && hosted) failover(`${node?.name ?? tm} hosted running subtasks`);
          }
        }
        if (!running && restartAt && n.now >= restartAt) deploy();
        if (pending && n.now - pending.t0 > n.num('checkpointTimeoutMs', 20000)) {
          failed++;
          n.log('info', `Checkpoint ${pending.k} expired after ${sec(n.now - pending.t0)}: barriers stuck behind backpressure`);
          pending = undefined;
        }
      });
      n.every(n.num('checkpointMs', 5000), trigger);
      n.every(1000, () => {
        n.gauge('checkpoints', completed);
        n.gauge('lastCheckpoint', last?.k ?? 0);
        n.gauge('checkpointMs', Math.round(pending ? Math.max(lastMs, n.now - pending.t0) : lastMs));
        n.gauge('alignMs', Math.round(lastAlign));
        n.gauge('failedCheckpoints', failed);
        n.gauge('restarts', restarts);
        n.gauge('running', running ? 1 : 0);
        n.gauge('slotsTotal', liveTms().reduce((a, t) => a + (tmSlots.get(t) ?? 0), 0));
      });
    },
    onMessage(m: Msg) {
      const d = m.data;
      if (m.kind === 'flink.heartbeat') {
        if (!lastHb.has(m.from)) n.log('info', `TaskManager ${n.world.nodeName(m.from)} registered with ${d.slots} slots`);
        lastHb.set(m.from, n.now);
        tmSlots.set(m.from, d.slots);
        // a TaskManager that restarted quickly reports its subtasks missing
        if (running && job && n.now - deployedAt > 3000) {
          const have = new Set<string>(d.running);
          const missing = job.assign.map((tm, s) => (tm === m.from && !have.has(`${job!.attempt}:${s}`) ? s : -1)).filter(s => s >= 0);
          if (missing.length) failover(`Subtasks ${missing.join(', ')} on ${n.world.nodeName(m.from)} failed`);
        }
      } else if (m.kind === 'flink.ack') {
        if (!pending || d.k !== pending.k || d.att !== pending.att) return;
        if (d.part === 'source') pending.src.set(d.s, d.offset);
        else {
          pending.win.set(d.s, d.state);
          pending.align = Math.max(pending.align, d.align ?? 0);
        }
        maybeComplete();
      }
    },
    view() {
      return {
        badges: [
          { text: running ? 'RUNNING' : 'RESTARTING', tone: running ? 'ok' : 'fail' },
          ...(last ? [{ text: `ckpt ${last.k}`, tone: 'protocol' as const }] : []),
        ] as Badge[],
      };
    },
  };
});

export {};
