// Analytics stores: columnar OLAP DB, cloud data warehouse, lakehouse (Delta on object storage + Spark).
import type { NodeLogic, Req, SimNode } from '../node';
import type { Badge, Reply } from '../types';
import { register } from './registry';

const busy: Reply = { ok: false, err: '503' };
const HOURS_PER_MONTH = 730;

/** Sliding average of a per-second sample (cost projections). */
class Avg {
  private xs: number[] = [];
  constructor(private size = 60) {}
  push(v: number) {
    this.xs.push(v);
    if (this.xs.length > this.size) this.xs.shift();
  }
  get value() {
    return this.xs.length ? this.xs.reduce((a, b) => a + b, 0) / this.xs.length : 0;
  }
}

/** Rolling mean of recent query latencies (arrival → reply) as gauge `queryMs`. */
function queryTimer(n: SimNode) {
  const a = new Avg(10);
  return (req: Req) => {
    a.push(n.now - req.at);
    n.gauge('queryMs', Math.round(a.value));
  };
}

const fmtMb = (mb: number) => (mb >= 1024 ? `${(mb / 1024).toFixed(mb >= 10240 ? 0 : 1)}GB` : `${Math.round(mb)}MB`);
const sec = (ms: number) => `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;

// ---------- columnar-db ----------

/**
 * ClickHouse-style cluster (or a row store, layout=row). Query cost ∝ bytes scanned:
 * rows × columns read × bytes/value ÷ compression, pruned by a time filter; spread over shards × threads.
 * Every insert becomes a part per shard; background merges fold parts; too many parts → inserts delayed, then 503.
 */
export function columnarDb(n: SimNode): NodeLogic {
  const shards = () => Math.max(1, Math.round(n.num('shards', 2)));
  const replicas = () => Math.max(1, Math.round(n.num('replicas', 1)));
  const cores = () => Math.max(1, Math.round(n.num('cores', 16)));
  // capacity = every core of every server
  n.cfg.instances = shards() * replicas();
  n.cfg.slots = cores();
  const row = () => n.str<'column' | 'row'>('layout', 'column') === 'row';

  let parts = 1;
  let buffer: { req: Req; w: number }[] = [];
  let merging = false;
  let rejected = 0;
  let lastThrowLog = -1e9;
  const timed = queryTimer(n);

  function scan() {
    const total = Math.max(1, n.num('columnsTotal', 100));
    const sel = Math.min(total, Math.max(1, n.num('avgColumnsSelected', 5)));
    const colFrac = row() ? 1 : sel / total;
    const kept = n.bool('timeFilter', false) ? Math.min(100, Math.max(0.01, n.num('timeRangePct', 3))) / 100 : 1;
    const rawMb = (n.num('rowsM', 100) * 1e6 * total * n.num('bytesPerValue', 8) * colFrac * kept) / 1e6;
    const diskMb = rawMb / Math.max(1, n.num('compression', 8));
    return { rawMb, diskMb, cols: row() ? total : sel, kept };
  }

  function queryMs(rawMb: number, diskMb: number, threads: number) {
    const rate = n.num('mbPerSecPerCore', 1000) * (n.bool('vectorized', true) ? 1 : n.num('rowAtATimeX', 0.15));
    const cpuMs = (rawMb / shards() / (threads * rate)) * 1000;
    const ioMs = (diskMb / shards() / Math.max(1, n.num('diskMBps', 2000))) * 1000;
    // each part is a separate set of files + marks to open
    const partMs = parts * n.num('perPartMs', 0.05);
    return (Math.max(cpuMs, ioMs) + partMs) * n.mods.slowX;
  }

  function addParts(k: number) {
    parts += k;
    n.gauge('parts', Math.round(parts));
  }

  function flush() {
    if (!buffer.length) return;
    const batch = buffer;
    buffer = [];
    addParts(1);
    const w = batch.reduce((a, b) => a + b.w, 0);
    n.process(shards(), n.serviceTime('insertP50Ms', 'insertP99Ms', 5, 30), ok => {
      for (const b of batch) b.req.reply(ok ? { ok: true } : busy);
    });
    n.gauge('lastBatchRows', Math.round(w * n.num('rowsPerInsert', 1)));
  }

  function mergeTick() {
    // background merges fold parts together; they also eat cores
    const floor = 1;
    if (parts <= floor + 1) {
      merging = false;
      n.gauge('mergesPerSec', 0);
      return;
    }
    merging = true;
    const folded = Math.min(parts - floor, n.num('mergePartsPerSec', 20) * 0.2);
    parts -= folded;
    n.gauge('parts', Math.round(parts));
    n.gauge('mergesPerSec', Math.round(folded * 5));
    const mergeCores = Math.max(1, Math.ceil(cores() * n.num('mergeCoreShare', 0.25))) * n.instances;
    n.process(mergeCores, 200, () => {});
  }

  return {
    onStart() {
      buffer = [];
      n.every(200, mergeTick);
      n.every(Math.max(50, n.num('flushMs', 1000)), () => {
        if (n.bool('batchInserts', true)) flush();
      });
      n.every(1000, () => {
        n.gauge('rejectedInserts', rejected);
        const s = scan();
        n.gauge('scannedMB', Math.round(s.diskMb));
        n.gauge('columnsRead', s.cols);
        n.gauge('prunedPct', Math.round((1 - s.kept) * 100));
      });
      n.gauge('parts', Math.round(parts));
    },
    onRequest(req) {
      const m = req.msg;
      const w = m.weight;
      if (m.op === 'write') {
        if (n.mods.diskFull) return req.reply({ ok: false, err: '5xx' });
        const throwAt = n.num('partsToThrowInsert', 300);
        if (parts >= throwAt) {
          rejected += w;
          if (n.now - lastThrowLog > 2000) {
            lastThrowLog = n.now;
            n.log('alert', `${n.name}: Too many parts (${Math.round(parts)}). Merges are processing significantly slower than inserts → insert rejected`);
          }
          return req.reply(busy);
        }
        if (n.bool('batchInserts', true)) {
          // async insert: buffered in memory, flushed as one part per shard, acked after the flush
          buffer.push({ req, w });
          return;
        }
        addParts(w);
        const delayAt = n.num('partsToDelayInsert', 150);
        // ClickHouse sleeps inserts (up to 1s) once parts pass parts_to_delay_insert
        const delay = parts > delayAt ? Math.min(1000, ((parts - delayAt) / Math.max(1, throwAt - delayAt)) * 1000) : 0;
        n.process(w * shards(), n.serviceTime('insertP50Ms', 'insertP99Ms', 5, 30), ok => {
          if (!ok) return req.reply(busy);
          if (!delay) return req.reply({ ok: true });
          n.gauge('insertDelayMs', Math.round(delay));
          n.timer(delay, () => req.reply({ ok: true }));
        });
        return;
      }
      const s = scan();
      const threads = Math.min(cores(), Math.max(1, Math.round(n.num('maxThreads', cores()))));
      const ms = queryMs(s.rawMb, s.diskMb, threads);
      const overhead = n.serviceTime('p50Ms', 'p99Ms', 5, 20);
      // one query occupies `threads` cores on every shard
      n.process(w * threads * shards(), ms, ok => {
        if (!ok) return req.reply(busy);
        n.timer(overhead, () => {
          timed(req);
          req.reply({ ok: true });
        });
      });
    },
    onKill() {
      buffer = [];
    },
    view() {
      const badges: Badge[] = [{ text: `${shards()}×${replicas()}`, tone: 'muted' }];
      if (row()) badges.push({ text: 'row store', tone: 'muted' });
      const delayAt = n.num('partsToDelayInsert', 150);
      if (parts > delayAt) badges.push({ text: `parts ${Math.round(parts)}`, tone: parts >= n.num('partsToThrowInsert', 300) ? 'fail' : 'warn' });
      else if (merging) badges.push({ text: 'merging', tone: 'muted' });
      return { badges, label: `${fmtMb(scan().diskMb)} / query` };
    },
  };
}

// ---------- data-warehouse ----------

export const WAREHOUSE_CREDITS: Record<string, number> = { XS: 1, S: 2, M: 4, L: 8, XL: 16, '2XL': 32, '3XL': 64, '4XL': 128 };

/**
 * Snowflake-style virtual warehouse on separate storage. Each cluster has `concurrency` slots; a query takes
 * slots ∝ its bytes and runs at credits × gbPerSecPerCredit. Excess queues; multi-cluster adds clusters.
 * Auto-suspend after idle; resume costs a delay and a cold local cache. Result cache answers repeats for free.
 */
export function dataWarehouse(n: SimNode): NodeLogic {
  const credits = () => WAREHOUSE_CREDITS[n.str('size', 'M')] ?? 4;
  const minC = () => Math.max(1, Math.round(n.num('minClusters', 1)));
  const maxC = () => Math.max(minC(), Math.round(n.num('maxClusters', 1)));
  const conc = () => Math.max(1, Math.round(n.num('concurrency', 8)));
  const pricing = () => n.str<'credits' | 'bytes' | 'fixed'>('pricing', 'credits');

  let clusters = 0;
  let starting = 0;
  let suspended = false;
  let resuming = false;
  let idleSince = 0;
  let lowSince = -1;
  let warm = 0;
  let lastWrite = -1;
  let running = 0;
  let pending: (() => void)[] = [];
  const results = new Map<number, number>();
  const clusterAvg = new Avg(60);
  const bytesAvg = new Avg(60);
  let win = { q: 0, hits: 0, gb: 0 };
  const timed = queryTimer(n);

  const setClusters = (c: number) => {
    clusters = c;
    n.cfg.instances = Math.max(1, c);
    n.cfg.slots = conc();
    n.gauge('clusters', c);
    n.drain();
  };

  function resume() {
    if (resuming) return;
    resuming = true;
    const ms = n.num('resumeMs', 1500);
    n.log('info', `${n.name}: resuming warehouse (${sec(ms)}) — local SSD cache is cold`);
    n.timer(ms, () => {
      resuming = false;
      suspended = false;
      idleSince = n.now;
      setClusters(minC());
      const list = pending;
      pending = [];
      list.forEach(f => f());
    });
  }

  function suspend(why: string) {
    if (suspended) return;
    suspended = true;
    warm = 0;
    setClusters(0);
    n.log('info', `${n.name}: suspended (${why}) — billing stops`);
  }

  function scanGb(adhoc: boolean) {
    if (adhoc) return n.num('adhocScanGB', 40);
    const sel = n.bool('clusteringKey', true) ? Math.min(100, n.num('filterSelectivityPct', 5)) / 100 : 1;
    return n.num('scanGB', 20) * sel;
  }

  function run(gb: number, done: (ok: boolean) => void, w: number) {
    const need = Math.min(conc(), Math.max(1, Math.ceil(gb / Math.max(0.01, n.num('gbPerSlot', 2.5)))));
    const cold = 1 + (n.num('coldCacheX', 3) - 1) * (1 - warm);
    const ms = (gb / (credits() * Math.max(0.001, n.num('gbPerSecPerCredit', 1)))) * 1000 * cold * n.mods.slowX;
    running += w;
    n.process(w * need, ms, ok => {
      running -= w;
      idleSince = n.now;
      if (ok) warm = Math.min(1, warm + w * n.num('warmPerQuery', 0.05));
      done(ok);
    });
  }

  function tick() {
    // multi-cluster autoscale (standard policy): add on queueing, remove after sustained low load
    const q = n.queuedW + pending.length;
    if (!suspended && !resuming) {
      if (n.queuedW > 0 && clusters + starting < maxC()) {
        starting++;
        n.log('info', `${n.name}: queries queued → starting cluster ${clusters + starting}/${maxC()}`);
        n.timer(n.num('resumeMs', 1500), () => {
          starting--;
          if (!suspended) setClusters(clusters + 1);
        });
      }
      if (clusters > minC() && n.busy <= (clusters - 1) * conc() && n.queuedW === 0) {
        if (lowSince < 0) lowSince = n.now;
        if (n.now - lowSince >= n.num('scaleDownSec', 10) * 1000) {
          setClusters(clusters - 1);
          lowSince = -1;
          n.log('info', `${n.name}: load dropped → cluster shut down (${clusters} running)`);
        }
      } else lowSince = -1;
      const idle = n.num('autoSuspendSec', 60);
      if (idle > 0 && n.busy === 0 && n.queuedW === 0 && n.now - idleSince >= idle * 1000) suspend(`idle ${idle}s`);
    }
    const billed = pricing() === 'credits' ? clusters : 0;
    clusterAvg.push(billed);
    bytesAvg.push(win.gb);
    let cost: number;
    if (pricing() === 'credits') cost = clusterAvg.value * credits() * n.num('creditPrice', 3) * HOURS_PER_MONTH;
    // bytes pricing: projected TiB/month at the recent scan rate
    else if (pricing() === 'bytes') cost = ((bytesAvg.value * 3600 * HOURS_PER_MONTH) / 1024) * n.num('pricePerTiB', 6.25);
    else cost = n.num('costMonth', 1600);
    n.gauge('costMonth', Math.round(cost));
    n.gauge('creditsPerHour', clusters * credits());
    n.gauge('queued', Math.round(q));
    n.gauge('running', Math.round(running));
    n.gauge('suspended', suspended ? 1 : 0);
    n.gauge('cacheWarmPct', Math.round(warm * 100));
    n.gauge('hitRatio', win.q ? Math.round((win.hits / win.q) * 100) : 0);
    n.gauge('scannedGB', Math.round(win.gb * 10) / 10);
    win = { q: 0, hits: 0, gb: 0 };
  }

  return {
    onStart() {
      pending = [];
      running = 0;
      starting = 0;
      resuming = false;
      idleSince = n.now;
      if (n.bool('startSuspended', false)) {
        suspended = true;
        setClusters(0);
      } else {
        suspended = false;
        warm = 1;
        setClusters(minC());
      }
      n.every(1000, tick);
    },
    onRequest(req) {
      const m = req.msg;
      const w = m.weight;
      const adhoc = m.tenant === 'adhoc';
      idleSince = n.now;
      if (m.op === 'write') {
        // DML changes the table → every cached result for it is invalid
        lastWrite = n.now;
        if (results.size) n.log('info', `${n.name}: write changed the table → ${results.size} cached results invalidated`);
        results.clear();
      } else {
        win.q += w;
        const at = m.key !== undefined && !adhoc ? results.get(m.key) : undefined;
        const ttl = n.num('resultCacheHours', 24) * 3600_000;
        if (n.bool('resultCache', true) && at !== undefined && n.now - at < ttl && at > lastWrite) {
          // served by the cloud-services layer: no warehouse, no credits
          win.hits += w;
          return void n.timer(n.rng.lognormal(20, 60), () => {
            timed(req);
            req.reply({ ok: true });
          });
        }
      }
      const gb = m.op === 'write' ? n.num('writeGB', 0.5) : scanGb(adhoc);
      const go = () =>
        run(gb, ok => {
          if (!ok) return req.reply(busy);
          win.gb += gb * w;
          if (m.op !== 'write' && !adhoc && m.key !== undefined) results.set(m.key, n.now);
          if (m.op !== 'write' && !adhoc) timed(req);
          req.reply({ ok: true });
        }, w);
      const overhead = n.serviceTime('p50Ms', 'p99Ms', 80, 400); // compile + optimize in cloud services
      if (suspended || resuming) {
        if (pending.length >= n.queueLimit) return req.reply(busy);
        pending.push(() => n.timer(overhead, go));
        resume();
        return;
      }
      n.timer(overhead, go);
    },
    onChaos(kind, p, heal) {
      if (kind === 'huge-query') {
        if (heal) return true;
        const secs = Number(p.sec ?? 30);
        if (suspended) resume();
        const start = () => {
          n.log('info', `${n.name}: ad-hoc query scanning ${Number(p.tb ?? 5)}TB takes all ${conc()} slots of a cluster for ${secs}s`);
          running++;
          n.process(conc(), secs * 1000, () => {
            running--;
            idleSince = n.now;
          });
        };
        if (suspended || resuming) pending.push(start);
        else start();
        return true;
      }
      if (kind === 'warehouse-suspend') {
        if (!heal) suspend('suspended by operator');
        return true;
      }
      if (kind === 'cache-flush') {
        if (!heal) {
          results.clear();
          warm = 0;
          n.log('info', `${n.name}: result cache and local disk cache invalidated`);
        }
        return true;
      }
      return false;
    },
    onKill() {
      pending = [];
      running = 0;
    },
    view() {
      const badges: Badge[] = [{ text: pricing() === 'fixed' ? `${n.num('nodes', 2)} nodes` : n.str('size', 'M'), tone: 'muted' }];
      if (suspended && !resuming) badges.push({ text: 'suspended', tone: 'muted' });
      else if (resuming) badges.push({ text: 'resuming', tone: 'warn' });
      else if (maxC() > 1) badges.push({ text: `${clusters}/${maxC()} clusters`, tone: clusters > 1 ? 'accent' : 'muted' });
      const q = n.queuedW + pending.length;
      if (q > 0) badges.push({ text: `queue ${Math.round(q)}`, tone: 'warn' });
      return { badges, label: `$${Math.round(n.gaugesNow.costMonth ?? 0).toLocaleString('en-US')}/mo` };
    },
  };
}

// ---------- lakehouse ----------

/**
 * Databricks-style: Delta tables (Parquet files + transaction log) on object storage, queried by an autoscaling
 * Spark cluster. Reads pay per-file overhead (small files hurt; OPTIMIZE compacts), Photon speeds compute,
 * streaming ingest commits a micro-batch of small files every interval, checkpointed so restarts resume.
 */
export function lakehouse(n: SimNode): NodeLogic {
  const cores = () => Math.max(1, Math.round(n.num('coresPerWorker', 8)));
  const minW = () => Math.max(1, Math.round(n.num('minWorkers', 2)));
  const maxW = () => Math.max(minW(), Math.round(n.num('maxWorkers', 8)));
  const startMs = () => n.num('workerStartSec', 15) * 1000;

  let state: 'running' | 'starting' | 'terminated' = 'terminated';
  let workers = 0;
  let adding = 0;
  let pending: (() => void)[] = [];
  let lowSince = -1;
  let idleSince = 0;
  let queriesRunning = 0;
  const inflight = new Set<{ w: number; need: number; hold: number; lost: boolean }>();
  // Delta table state survives cluster restarts (it lives in object storage)
  let version = 0;
  let smallFiles = 0;
  const history: { v: number; small: number }[] = [];
  let lastCheckpoint = 0;
  let batch = 0;
  let batchInFlight = false;
  let lostBatch = 0;
  let jobRunning = 0;
  let lostJob = false;
  let started = false;
  let optimizing = false;
  let retries = 0;
  let jobsDone = 0;
  let s3Throttled = 0;
  const upAvg = new Avg(60);
  const timed = queryTimer(n);

  const baseFiles = () => Math.max(1, Math.ceil((n.num('tableGB', 100) * 1024) / Math.max(1, n.num('targetFileMb', 1024))));
  const files = () => baseFiles() + smallFiles;
  const store = () => n.outEdges(e => n.world.nodes.get(e.to)?.type === 'object-store')[0];
  const photonX = () => (n.bool('photon', true) ? Math.max(1, n.num('photonX', 2.5)) : 1);

  const setWorkers = (k: number) => {
    workers = k;
    n.cfg.instances = Math.max(1, k);
    n.cfg.slots = cores();
    n.gauge('workers', k);
    n.drain();
  };

  function commit(addSmall: number, what: string) {
    version++;
    smallFiles += addSmall;
    history.push({ v: version, small: smallFiles });
    if (history.length > 200) history.shift();
    if (version - lastCheckpoint >= n.num('checkpointInterval', 10)) lastCheckpoint = version;
    n.gauge('version', version);
    n.gauge('files', files());
    if (what) n.log('info', what);
  }

  function startCluster(why: string) {
    if (state !== 'terminated') return;
    state = 'starting';
    n.log('info', `${n.name}: cluster starting (${why}) — ${minW()} workers ready in ${sec(startMs())}`);
    n.timer(startMs(), () => {
      state = 'running';
      idleSince = n.now;
      setWorkers(minW());
      n.log('info', `${n.name}: cluster running with ${minW()} workers`);
      const list = pending;
      pending = [];
      list.forEach(f => f());
    });
  }

  function whenUp(f: () => void, req?: Req) {
    if (state === 'running') return f();
    if (pending.length >= n.queueLimit) return req?.reply(busy);
    pending.push(f);
    startCluster('work arrived');
  }

  /** core-ms spread over up to all cores; lost spot workers make tasks retry. */
  function compute(w: number, coreMs: number, tasks: number, done: (ok: boolean) => void) {
    const need = Math.max(1, Math.min(tasks, workers * cores()));
    const hold = coreMs / need;
    const job = { w, need, hold, lost: false };
    inflight.add(job);
    const go = () =>
      n.process(w * need, hold * n.mods.slowX, ok => {
        if (ok && job.lost) {
          job.lost = false;
          return go();
        }
        inflight.delete(job);
        idleSince = n.now;
        done(ok);
      });
    go();
  }

  function readFiles(filesToRead: number, then: () => void) {
    const e = store();
    if (!e) return then();
    // one GET per file (footer + column chunks), split across prefixes
    const calls = Math.min(4, Math.max(1, Math.ceil(filesToRead)));
    let left = calls;
    let throttled = false;
    for (let i = 0; i < calls; i++) {
      const msg = n.world.newMsg({ from: n.id, to: e.to, weight: Math.max(1, Math.round(filesToRead / calls)), op: 'read', key: n.rng.int(1024), size: 1e6 });
      n.call(e, msg, r => {
        if (!r.ok) throttled = true;
        if (--left) return;
        if (throttled) {
          // S3 SlowDown / error → Spark retries the reads with backoff
          s3Throttled++;
          return void n.timer(500, then);
        }
        then();
      });
    }
  }

  function query(req: Req) {
    const tt = n.rng.chance(n.num('timeTravelPct', 0) / 100);
    let small = smallFiles;
    let replay = 0;
    if (tt) {
      // VERSION AS OF older snapshot: its file list (pre-OPTIMIZE small files too) + log replay
      const back = Math.max(1, Math.round(n.num('timeTravelVersions', 20)));
      const old = history.find(h => h.v >= version - back) ?? history[0];
      small = old?.small ?? smallFiles;
      replay = Math.max(0, (version - back) % Math.max(1, n.num('checkpointInterval', 10)));
    }
    const pct = Math.min(100, Math.max(0.1, n.num('scanPct', 10))) / 100;
    const fileCount = Math.max(1, Math.round((baseFiles() + small) * pct));
    const mb = n.num('tableGB', 100) * 1024 * pct;
    const coreMs = (mb / (n.num('mbPerSecPerCore', 150) * photonX())) * 1000 + fileCount * n.num('fileOpenMs', 20);
    const tasks = Math.max(1, Math.ceil(fileCount), Math.ceil(mb / 128));
    n.gauge('filesPerQuery', fileCount);
    const overhead = n.serviceTime('p50Ms', 'p99Ms', 300, 1200) + replay * n.num('logReplayMs', 50);
    queriesRunning++;
    readFiles(fileCount, () =>
      compute(req.msg.weight, coreMs, tasks, ok => {
        queriesRunning--;
        if (!ok) return req.reply(busy);
        n.timer(overhead, () => {
          timed(req);
          req.reply({ ok: true });
        });
      }),
    );
  }

  function microBatch() {
    if (!n.bool('streamIngest', false)) return;
    if (batchInFlight) return;
    const b = ++batch;
    batchInFlight = true;
    const f = Math.max(1, Math.round(n.num('filesPerBatch', 8)));
    whenUp(() => {
      const e = store();
      const finish = () =>
        compute(1, f * 100, f, ok => {
          batchInFlight = false;
          if (!ok || b !== batch) return;
          commit(f, '');
          n.gauge('batch', b);
        });
      if (!e) return finish();
      n.call(e, n.world.newMsg({ from: n.id, to: e.to, weight: f, op: 'write', key: n.rng.int(1024), size: 1e6 }), () => finish());
    });
  }

  function optimize() {
    if (optimizing || smallFiles < 2 || state !== 'running') return;
    optimizing = true;
    const small = smallFiles;
    const need = Math.max(1, Math.floor((workers * cores()) / 2));
    n.log('info', `${n.name}: OPTIMIZE compacting ${small} small files into ~${Math.max(1, Math.ceil(small / 1000))} large files`);
    // sequential rewrite: cheaper per file than a query's open + footer + plan
    compute(1, 2000 * need + small * n.num('fileOpenMs', 20) * 0.25, need, ok => {
      optimizing = false;
      if (!ok) return;
      smallFiles = Math.max(0, smallFiles - small);
      commit(0, `${n.name}: OPTIMIZE committed v${version + 1} — ${files()} files now`);
    });
  }

  function runJob() {
    const gb = n.num('jobGB', 50);
    whenUp(() => {
      const t0 = n.now;
      const mb = gb * 1024;
      const coreMs = (mb / (n.num('mbPerSecPerCore', 150) * photonX())) * 1000;
      n.log('info', `${n.name}: job started (${gb}GB)`);
      jobRunning++;
      compute(1, coreMs, Math.ceil(mb / 128), ok => {
        jobRunning--;
        if (!ok) return;
        jobsDone++;
        commit(Math.max(1, Math.round(n.num('filesPerBatch', 8))), `${n.name}: job done in ${sec(n.now - t0)} → committed v${version + 1}`);
      });
    });
  }

  function tick() {
    if (state === 'running') {
      const backlog = n.queuedW > 0;
      if (backlog && workers + adding < maxW()) {
        // optimized autoscaling: close half the gap to max per step
        const add = Math.max(1, Math.ceil((maxW() - workers - adding) / 2));
        adding += add;
        n.log('info', `${n.name}: backlog → requesting ${add} worker${add > 1 ? 's' : ''} (ready in ${sec(startMs())})`);
        n.timer(startMs(), () => {
          adding -= add;
          if (state === 'running') setWorkers(Math.min(maxW(), workers + add));
        });
      }
      if (workers > minW() && !backlog && n.busy <= (workers - 1) * cores() * 0.5) {
        if (lowSince < 0) lowSince = n.now;
        if (n.now - lowSince >= n.num('scaleDownSec', 10) * 1000) {
          setWorkers(workers - 1);
          lowSince = n.now;
        }
      } else lowSince = -1;
      const idle = n.num('autoTerminateSec', 120);
      const streaming = n.bool('streamIngest', false);
      if (idle > 0 && !streaming && n.busy === 0 && n.queuedW === 0 && !inflight.size && n.now - idleSince >= idle * 1000) {
        state = 'terminated';
        setWorkers(0);
        n.log('info', `${n.name}: cluster auto-terminated after ${idle}s idle`);
      }
    }
    const up = state === 'running' ? workers + 1 : 0;
    upAvg.push(up);
    const mode = n.str<'job' | 'all-purpose'>('clusterMode', 'all-purpose');
    const dbuPrice = n.num('dbuPrice', mode === 'job' ? 0.15 : 0.55) * (n.bool('photon', true) ? n.num('photonDbuX', 2) : 1);
    const perNodeHour = n.num('dbuPerNodeHour', 2) * dbuPrice + n.num('vmHourly', 0.5);
    n.gauge('costMonth', Math.round(upAvg.value * perNodeHour * HOURS_PER_MONTH));
    n.gauge('smallFiles', smallFiles);
    n.gauge('files', files());
    n.gauge('taskRetries', retries);
    n.gauge('jobsDone', jobsDone);
    n.gauge('s3Throttled', s3Throttled);
    n.gauge('queued', Math.round(n.queuedW + pending.length));
    n.gauge('running', queriesRunning);
    n.gauge('clusterUp', state === 'running' ? 1 : 0);
  }

  return {
    onStart() {
      pending = [];
      inflight.clear();
      adding = 0;
      queriesRunning = 0;
      batchInFlight = false;
      state = 'terminated';
      setWorkers(0);
      if (started && batch + lostBatch > 0)
        n.log('info', lostBatch
          ? `${n.name}: streaming query restarted from checkpoint — reprocessing batch ${lostBatch} (Delta commit is idempotent: no duplicates)`
          : `${n.name}: streaming query restarted from checkpoint after batch ${batch}`);
      lostBatch = 0;
      if (lostJob) {
        lostJob = false;
        n.log('info', `${n.name}: batch job rerun from the start (its half-written files were never committed)`);
        runJob();
      }
      if (!started) {
        // a fresh sim starts with the cluster already up
        state = 'running';
        idleSince = n.now;
        setWorkers(minW());
      } else startCluster('restart');
      started = true;
      if (!history.length) commit(0, '');
      n.every(1000, tick);
      const mb = n.num('microBatchSec', 5);
      if (mb > 0) n.every(mb * 1000, microBatch);
      const opt = n.num('optimizeEverySec', 0);
      if (opt > 0) n.every(opt * 1000, optimize);
      const job = n.num('jobEverySec', 0);
      if (job > 0) n.every(job * 1000, runJob);
    },
    onRequest(req) {
      const m = req.msg;
      idleSince = n.now;
      if (m.op === 'write') {
        // each write = one small append commit (one Parquet file + a log entry)
        return whenUp(() => {
          const e = store();
          const done = () => compute(m.weight, 50, 1, ok => {
            if (!ok) return req.reply(busy);
            commit(Math.max(1, Math.round(m.weight)), '');
            req.reply({ ok: true });
          });
          if (!e) return done();
          n.call(e, n.world.newMsg({ from: n.id, to: e.to, weight: m.weight, op: 'write', key: n.rng.int(1024), size: 1e6 }), () => done());
        }, req);
      }
      whenUp(() => query(req), req);
    },
    onChaos(kind, p, heal) {
      if (kind === 'spot-loss') {
        if (heal || state !== 'running') return true;
        const lost = Math.min(workers, Math.max(1, Math.round(Number(p.workers ?? 1))));
        const f = lost / Math.max(1, workers);
        let tasks = 0;
        for (const j of inflight)
          if (n.rng.chance(f) || f >= 1) {
            j.lost = true;
            tasks += j.need;
          }
        retries += tasks;
        setWorkers(workers - lost);
        n.log('info', `${n.name}: spot instance reclaimed — ${lost} worker${lost > 1 ? 's' : ''} lost, ${tasks} running tasks retried; replacement in ${sec(startMs())}`);
        adding += lost;
        n.timer(startMs(), () => {
          adding -= lost;
          if (state === 'running') {
            setWorkers(Math.min(maxW(), workers + lost));
            n.log('info', `${n.name}: replacement worker${lost > 1 ? 's' : ''} joined (${workers} workers)`);
          }
        });
        return true;
      }
      if (kind === 'small-files') {
        if (heal) return true;
        const k = Math.round(Number(p.files ?? 20000));
        commit(k, `${n.name}: ${k} tiny files landed (a streaming job with a 1s trigger and 200 partitions) → ${files()} files`);
        return true;
      }
      return false;
    },
    onKill() {
      if (jobRunning) lostJob = true;
      jobRunning = 0;
      if (batchInFlight) {
        n.log('info', `${n.name}: cluster lost mid-batch ${batch} — last checkpoint is batch ${batch - 1}`);
        lostBatch = batch--;
      }
      inflight.clear();
      pending = [];
      state = 'terminated';
    },
    view() {
      const badges: Badge[] = [];
      if (state === 'terminated') badges.push({ text: 'terminated', tone: 'muted' });
      else if (state === 'starting') badges.push({ text: 'starting', tone: 'warn' });
      else badges.push({ text: `${workers}${adding ? `+${adding}` : ''} workers`, tone: 'accent' });
      if (n.bool('photon', true)) badges.push({ text: 'photon', tone: 'muted' });
      if (smallFiles > baseFiles()) badges.push({ text: `${smallFiles} small files`, tone: 'warn' });
      if (optimizing) badges.push({ text: 'OPTIMIZE', tone: 'protocol' });
      return { badges, label: `v${version} · ${files()} files` };
    },
  };
}

register('columnar-db', columnarDb);
register('data-warehouse', dataWarehouse);
register('lakehouse', lakehouse);
