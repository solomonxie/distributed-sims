// Compute group: service, monolith, serverless-fn, cron, container-group, cell-router + tenancy helpers.
import type { NodeLogic, Req, SimNode } from '../node';
import type { EdgeRt } from '../world';
import type { Badge, Id, Msg, Reply } from '../types';
import { hashString } from '../rng';
import { nodesIn } from '../model';
import { register } from './registry';

type Fanout = 'all' | 'one';
const fanoutOf = (n: SimNode): Fanout => (n.str<Fanout>('fanout', 'all') === 'one' ? 'one' : 'all');

// ---------- tenancy ----------

interface TenantStats {
  sec: number;
  cur: Map<string, number>;
  prev: Map<string, number>;
}
const tenantStats = new WeakMap<SimNode, TenantStats>();

/** Tenant of a request: explicit tag, else the tenant container the node sits in. */
export function tenantOf(n: SimNode, msg: Msg): string | undefined {
  return msg.tenant ?? n.world.placement.get(n.id)?.tenant;
}

/**
 * Noisy-neighbour accounting: records the request against its tenant and
 * returns that tenant's share (0..1) of this node's load over ~the last second.
 */
export function tenantShare(n: SimNode, msg: Msg): number {
  const t = tenantOf(n, msg);
  if (!t) return 0;
  if (!msg.tenant) msg.tenant = t;
  let s = tenantStats.get(n);
  const sec = Math.floor(n.now / 1000);
  if (!s) tenantStats.set(n, (s = { sec, cur: new Map(), prev: new Map() }));
  if (sec !== s.sec) {
    s.prev = sec === s.sec + 1 ? s.cur : new Map();
    s.cur = new Map();
    s.sec = sec;
  }
  s.cur.set(t, (s.cur.get(t) ?? 0) + msg.weight);
  let total = 0;
  let mine = 0;
  let top = 0;
  const merged = new Map<string, number>();
  for (const m of [s.prev, s.cur]) for (const [k, v] of m) merged.set(k, (merged.get(k) ?? 0) + v);
  for (const [k, v] of merged) {
    total += v;
    if (k === t) mine = v;
    if (v > top) top = v;
  }
  n.gauge('topTenantPct', total ? (top / total) * 100 : 0);
  n.gauge('tenants', merged.size);
  return total ? mine / total : 0;
}

/** Per-tenant quota in a pool: shed a tenant over its share while the node is saturated. */
function overTenantQuota(n: SimNode, msg: Msg): boolean {
  const share = tenantShare(n, msg);
  const quota = n.num('tenantQuotaPct', 0) / 100;
  if (!quota || share <= quota) return false;
  return n.queuedW > 0 || n.busy >= n.capacity * 0.9;
}

// ---------- autoscaler ----------

interface Scaler {
  on(): boolean;
  pending(): number;
  /** give up on k pending instances (e.g. unschedulable pods) */
  drop(k: number): void;
  evaluate(): void;
  badges(): Badge[];
}

/**
 * Target-utilisation autoscaler. `provision(add, ready)` decides how and when
 * new instances come up (boot delay, node capacity…); ready(k) adds k.
 */
function autoscaler(n: SimNode, provision: (add: number, ready: (k: number) => void) => void, on = false): Scaler {
  let pending = 0;
  let lastDown = -Infinity;
  let lastUp = -Infinity;
  const minI = () => Math.max(0, Math.round(n.num('minInstances', 1)));
  const maxI = () => Math.max(minI(), Math.round(n.num('maxInstances', 10)));
  const setInstances = (v: number) => {
    n.cfg.instances = v;
    n.series.setCapacity(n.capacity);
    n.drain();
  };
  const ready = (k: number) => {
    if (k <= 0) return;
    pending = Math.max(0, pending - k);
    lastUp = n.now;
    setInstances(n.instances + k);
    n.log('info', `${n.name} scaled up to ${n.instances}`);
  };
  const evaluate = () => {
    if (!n.bool('autoscale', on)) return;
    const pts = n.series.points.slice(-3);
    if (!pts.length) return;
    const util = pts.reduce((a, p) => a + p.util, 0) / pts.length;
    const queue = pts[pts.length - 1].queue;
    const load = util + queue / Math.max(1, n.capacity);
    const target = Math.max(0.05, n.num('targetUtil', 60) / 100);
    const inst = Math.max(1, n.instances);
    const desired = Math.min(maxI(), Math.max(minI(), Math.ceil((inst * load) / target)));
    const total = n.instances + pending;
    if (desired > total && n.now - lastUp >= 1000) {
      const add = desired - total;
      pending += add;
      lastUp = n.now;
      n.log('info', `${n.name} autoscaling +${add} (util ${Math.round(util * 100)}%)`);
      provision(add, ready);
    } else if (desired < n.instances && pending === 0 && n.now - Math.max(lastUp, lastDown) >= n.num('cooldownSec', 60) * 1000) {
      lastDown = n.now;
      setInstances(desired);
      n.log('info', `${n.name} scaled down to ${desired}`);
    }
    n.gauge('instances', n.instances);
    n.gauge('pending', pending);
  };
  return {
    on: () => n.bool('autoscale', on),
    pending: () => pending,
    drop: k => (pending = Math.max(0, pending - k)),
    evaluate,
    badges: () => {
      const b: Badge[] = [{ text: `×${n.instances}`, tone: 'muted' }];
      if (pending) b.push({ text: `+${pending} booting`, tone: 'warn' });
      return b;
    },
  };
}

function startScaler(n: SimNode, s: Scaler) {
  const min = Math.round(n.num('minInstances', 1));
  if (s.on() && n.instances < min) {
    n.cfg.instances = min;
    n.series.setCapacity(n.capacity);
  }
  n.every(n.num('autoscaleEvalSec', 5) * 1000, s.evaluate);
}

// ---------- GC pauses (Java / JVM skins) ----------

function startGc(n: SimNode) {
  if (!n.bool('gcPauses', false)) return;
  n.every(
    n.num('gcEverySec', 8) * 1000,
    () => {
      const ms = n.rng.lognormal(n.num('gcPauseMs', 80), n.num('gcPauseMs', 80) * 4);
      n.mods.pausedUntil = Math.max(n.mods.pausedUntil, n.now + ms);
      n.timer(ms, () => n.drain());
      n.gauge('gcPauseMs', ms);
    },
    0.3,
  );
}

// ---------- service ----------

/** Handle a request: tenant accounting, capacity, work, sync fan-out, async publish. */
function serve(n: SimNode, req: Req, callOut?: (req: Req, edges: EdgeRt[], done: (r: Reply) => void) => void) {
  if (overTenantQuota(n, req.msg)) return req.reply({ ok: false, err: '429' });
  n.process(req.msg.weight, n.serviceTime(), ok => {
    if (!ok) return req.reply({ ok: false, err: '503' });
    const edges = n.syncOut(req.msg.op);
    const done = (r: Reply) => {
      if (r.ok) n.publish(req);
      req.reply(r);
    };
    if (callOut && edges.length) callOut(req, edges, done);
    else n.forward(req, edges, fanoutOf(n), done);
  });
}

export function service(n: SimNode): NodeLogic {
  const scaler = autoscaler(n, (add, ready) => n.timer(n.num('scaleUpDelaySec', 30) * 1000, () => ready(add)));
  return {
    onStart() {
      startScaler(n, scaler);
      startGc(n);
    },
    onRequest: req => serve(n, req),
    view: () => ({ badges: scaler.on() || n.instances > 1 ? scaler.badges() : [] }),
  };
}

// ---------- monolith: one deployable, one shared DB connection pool ----------

export function monolith(n: SimNode): NodeLogic {
  const scaler = autoscaler(n, (add, ready) => n.timer(n.num('scaleUpDelaySec', 60) * 1000, () => ready(add)));
  let inUse = 0;
  let waiters: { need: number; go: () => void; epoch: number }[] = [];
  const poolSize = () => Math.max(1, Math.round(n.num('dbPool', 20)));
  const wake = () => {
    while (waiters.length && inUse + waiters[0].need <= poolSize()) {
      const w = waiters.shift()!;
      inUse += w.need;
      w.go();
    }
    n.gauge('poolInUse', inUse);
    n.gauge('poolWaiting', waiters.length);
  };
  const withConn = (req: Req, edges: EdgeRt[], done: (r: Reply) => void) => {
    const need = Math.min(poolSize(), Math.max(1, Math.ceil(req.msg.weight)));
    let granted = false;
    let timedOut = false;
    const go = () => {
      if (timedOut) {
        inUse -= need;
        return wake();
      }
      granted = true;
      n.forward(req, edges, fanoutOf(n), r => {
        inUse -= need;
        wake();
        done(r);
      });
    };
    if (inUse + need <= poolSize() && !waiters.length) {
      inUse += need;
      go();
      n.gauge('poolInUse', inUse);
      return;
    }
    waiters.push({ need, go, epoch: n.epoch });
    n.gauge('poolWaiting', waiters.length);
    n.timer(n.num('poolTimeoutMs', 1000), () => {
      if (granted) return;
      timedOut = true;
      waiters = waiters.filter(w => w.go !== go);
      done({ ok: false, err: '503' });
    });
  };
  const modules = () => n.str('modules', '').split(',').map(s => s.trim()).filter(Boolean);
  return {
    onStart() {
      startScaler(n, scaler);
      startGc(n);
    },
    onKill() {
      inUse = 0;
      waiters = [];
    },
    onRequest: req => serve(n, req, withConn),
    view: () => {
      const b = scaler.badges();
      b.push({ text: `pool ${inUse}/${poolSize()}`, tone: inUse >= poolSize() ? 'warn' : 'muted' });
      const m = modules();
      return { badges: b, label: m.length ? `${m.length} modules` : undefined };
    },
  };
}

// ---------- serverless function ----------

export function serverless(n: SimNode): NodeLogic {
  let idle: { k: number; since: number }[] = [];
  let busy = 0;
  let coldSec = 0;
  let coldLast = 0;
  let throttled = 0;
  let invSec = 0;
  let durSec = 0;
  let storm = false;
  const idleCount = () => idle.reduce((a, c) => a + c.k, 0);
  const total = () => idleCount() + busy;
  const conns = () => total() * n.num('connsPerInstance', 1);

  const takeWarm = (w: number): number => {
    let got = 0;
    while (got < w && idle.length) {
      const c = idle[idle.length - 1];
      const t = Math.min(c.k, w - got);
      c.k -= t;
      got += t;
      if (!c.k) idle.pop();
    }
    return got;
  };

  /** Each instance holds its own DB connections: a scale-out storm can exceed the DB's limit. */
  const refusedByDb = (edges: EdgeRt[]): boolean => {
    const c = conns();
    for (const e of edges) {
      const t = n.world.nodes.get(e.to);
      const max = t ? t.num('maxConnections', t.num('maxConns', 0)) : 0;
      if (max > 0 && c > max && n.rng.chance(1 - max / c)) {
        if (!storm) n.log('info', `${n.name}: ${Math.round(c)} connections > ${t!.name} limit ${max}`);
        storm = true;
        return true;
      }
    }
    return false;
  };

  const tickSec = () => {
    const ttl = n.num('idleSec', 300) * 1000;
    idle = idle.filter(c => n.now - c.since < ttl);
    n.cfg.instances = total();
    n.series.setCapacity(n.capacity);
    const avgDur = invSec ? durSec / invSec / 1000 : 0;
    const perInv = n.num('costPerMillion', 0.2) / 1e6 + n.num('gbSecondPrice', 0.0000166667) * (n.num('memoryMb', 512) / 1024) * avgDur;
    const month = invSec * 2.628e6 * perInv;
    n.cfg.costMonth = month / Math.max(1, n.instances);
    n.gauge('costMonth', month);
    n.gauge('warm', idleCount());
    n.gauge('busy', busy);
    n.gauge('coldStarts', coldSec);
    n.gauge('throttled', throttled);
    n.gauge('dbConns', conns());
    coldLast = coldSec;
    coldSec = 0;
    throttled = 0;
    invSec = 0;
    durSec = 0;
    storm = false;
  };

  return {
    onStart() {
      n.cfg.instances = 0;
      n.every(1000, tickSec);
    },
    onKill() {
      idle = [];
      busy = 0;
    },
    onRequest(req) {
      const w = Math.max(1, Math.ceil(req.msg.weight));
      if (busy + w > n.num('concurrency', 1000)) {
        throttled += w;
        return req.reply({ ok: false, err: '429' });
      }
      tenantShare(n, req.msg);
      const warm = takeWarm(w);
      const cold = w - warm;
      coldSec += cold;
      busy += w;
      n.cfg.instances = total();
      const isCold = cold > 0 && n.rng.chance(cold / w);
      const startMs = isCold ? n.num('coldStartMs', 400) * (0.7 + n.rng.next() * 0.6) + n.num('connectMs', 0) : 0;
      const execMs = n.serviceTime();
      const t0 = n.now;
      const epoch = n.epoch;
      let finished = false;
      const release = () => {
        if (finished || epoch !== n.epoch) return;
        finished = true;
        busy -= w;
        idle.push({ k: w, since: n.now });
        const dur = n.now - t0;
        invSec += w;
        durSec += dur * w;
        n.series.cur.busy += w * dur;
      };
      n.timer(n.num('timeoutMs', 15000), () => {
        if (finished) return;
        release();
        req.reply({ ok: false, err: 'timeout' });
      });
      n.timer(startMs + execMs, () => {
        const edges = n.syncOut(req.msg.op);
        if (refusedByDb(edges)) {
          release();
          return req.reply({ ok: false, err: 'refused' });
        }
        n.forward(req, edges, fanoutOf(n), r => {
          if (finished) return;
          release();
          if (r.ok) n.publish(req);
          req.reply(r);
        });
      });
    },
    view: () => ({
      badges: [
        { text: `warm ${idleCount() + busy}`, tone: 'muted' },
        ...(coldLast ? [{ text: `cold ${coldLast}/s`, tone: 'warn' as const }] : []),
      ],
    }),
  };
}

// ---------- cron ----------

export function cron(n: SimNode): NodeLogic {
  let running = 0;
  let runs = 0;
  let skipped = 0;
  let nextAt = 0;
  const runJob = () => {
    nextAt = n.now + n.num('scheduleSec', 60) * 1000;
    if (running && n.str<string>('concurrencyPolicy', 'allow') === 'forbid') {
      skipped++;
      n.log('info', `${n.name}: previous run still active, skipped`);
      return;
    }
    runs++;
    running++;
    n.gauge('runs', runs);
    const msg = n.world.newMsg({
      from: n.id,
      to: n.id,
      weight: Math.max(1, Math.round(n.num('batch', 1))),
      op: n.str<'read' | 'write'>('op', 'write'),
      key: n.rng.int(1024),
    });
    n.world.deliver(msg, () => {
      running--;
    });
  };
  return {
    onStart() {
      running = 0;
      nextAt = n.now + n.num('scheduleSec', 60) * 1000;
      n.every(n.num('scheduleSec', 60) * 1000, runJob, n.num('jitterPct', 5) / 100);
    },
    onRequest(req) {
      n.process(req.msg.weight, n.serviceTime(), ok => {
        if (!ok) return req.reply({ ok: false, err: '503' });
        n.forward(req, n.outEdges(e => e.cfg.mode !== 'async'), fanoutOf(n), r => {
          if (r.ok) n.publish(req);
          req.reply(r);
        });
      });
    },
    view: () => ({
      badges: [
        { text: `runs ${runs}`, tone: 'muted' },
        { text: `next ${Math.max(0, Math.round((nextAt - n.now) / 1000))}s`, tone: 'muted' },
        ...(skipped ? [{ text: `skipped ${skipped}`, tone: 'warn' as const }] : []),
      ],
    }),
  };
}

// ---------- container group (Kubernetes / ECS) ----------

export function containerGroup(n: SimNode): NodeLogic {
  let clusterNodes = Math.max(1, Math.round(n.num('clusterNodes', 3)));
  let nodesPending = 0;
  let booting = 0; // pods placed on a node, starting
  let waiting = 0; // pods waiting for a new node
  let neverFit = 0;
  const podsPerNode = () => Math.max(1, Math.round(n.num('podsPerNode', 4)));
  const podDelay = () => (n.num('schedulingDelaySec', 2) + n.num('podStartSec', 8)) * 1000;
  const unschedulable = () => waiting + neverFit;
  let scaler!: Scaler;
  let ready!: (k: number) => void;
  const place = (k: number) => {
    if (k <= 0) return;
    booting += k;
    n.timer(podDelay(), () => {
      booting -= k;
      ready(k);
    });
  };
  const provision = (add: number, r: (k: number) => void) => {
    ready = r;
    const room = Math.max(0, clusterNodes * podsPerNode() - n.instances - booting);
    const fit = Math.min(add, room);
    place(fit);
    let rest = add - fit;
    const futureRoom = Math.max(0, nodesPending * podsPerNode() - waiting);
    const onPending = Math.min(rest, futureRoom);
    waiting += onPending;
    rest -= onPending;
    const maxNodes = Math.round(n.num('maxClusterNodes', 10));
    const extra = rest && n.bool('clusterAutoscaler', true) ? Math.max(0, Math.min(Math.ceil(rest / podsPerNode()), maxNodes - clusterNodes - nodesPending)) : 0;
    if (extra) {
      const k = Math.min(rest, extra * podsPerNode());
      waiting += k;
      rest -= k;
      nodesPending += extra;
      n.log('info', `${n.name}: ${waiting} pods pending, adding ${extra} node(s)`);
      n.timer(n.num('nodeProvisionSec', 90) * 1000, () => {
        nodesPending -= extra;
        clusterNodes += extra;
        n.gauge('clusterNodes', clusterNodes);
        const k2 = Math.min(waiting, Math.max(0, clusterNodes * podsPerNode() - n.instances - booting));
        waiting -= k2;
        place(k2);
        n.gauge('unschedulable', unschedulable());
      });
    }
    neverFit = rest;
    if (rest > 0) scaler.drop(rest);
    n.gauge('unschedulable', unschedulable());
  };
  scaler = autoscaler(n, provision, true);
  return {
    onStart() {
      startScaler(n, scaler);
      startGc(n);
      n.gauge('clusterNodes', clusterNodes);
    },
    onRequest: req => serve(n, req),
    view: () => {
      const b = scaler.badges();
      b[0] = { text: `${n.instances} pods`, tone: 'muted' };
      b.push({ text: `${clusterNodes} nodes`, tone: 'muted' });
      if (unschedulable()) b.push({ text: `${unschedulable()} unschedulable`, tone: 'warn' });
      return { badges: b };
    },
  };
}

// ---------- cell router ----------

/** Stable cell index for a tenant (or key when untagged). */
export function cellIndex(by: string | number, cells: number): number {
  if (cells <= 0) return -1;
  const h = typeof by === 'string' ? hashString(by) : hashString('k' + by);
  return h % cells;
}

export function cellRouter(n: SimNode): NodeLogic {
  let cells: { id: Id; edges: EdgeRt[]; members: Id[] }[] = [];
  let perTenant = new Map<string, { ok: number; err: number }>();
  let down = 0;
  const cellOf = (id: Id) => n.world.placement.get(id)?.cell;
  const mine = cellOf(n.id);
  const isDown = (c: (typeof cells)[number]) => c.members.some(id => !n.world.nodes.get(id)?.up);
  const refresh = () => {
    down = cells.filter(isDown).length;
    n.gauge('cellsDown', down);
    n.gauge('blastRadiusPct', cells.length ? (down / cells.length) * 100 : 0);
    for (const [t, s] of perTenant) n.gauge(`tenantErrPct:${t}`, s.ok + s.err ? (s.err / (s.ok + s.err)) * 100 : 0);
    perTenant = new Map();
  };
  return {
    onStart() {
      const by = new Map<Id, EdgeRt[]>();
      for (const e of n.syncOut()) {
        const c = cellOf(e.to);
        if (!c || c === mine) continue;
        if (!by.has(c)) by.set(c, []);
        by.get(c)!.push(e);
      }
      cells = [...by.keys()].sort().map(id => ({ id, edges: by.get(id)!, members: nodesIn(id, n.world.doc.nodes, n.world.containers) }));
      n.every(1000, refresh);
    },
    onRequest(req) {
      if (!cells.length) return req.reply({ ok: false, err: 'unavailable' });
      const t = tenantOf(n, req.msg);
      if (t && !req.msg.tenant) req.msg.tenant = t;
      const byTenant = n.str<string>('routeBy', 'tenant') === 'tenant' && t !== undefined;
      let i = cellIndex(byTenant ? t! : req.msg.key ?? 0, cells.length);
      if (n.bool('failover', false)) {
        for (let k = 0; k < cells.length && isDown(cells[i]); k++) i = (i + 1) % cells.length;
      }
      const cell = cells[i];
      n.process(req.msg.weight, n.serviceTime('p50Ms', 'p99Ms', 0.3, 2), ok => {
        if (!ok) return req.reply({ ok: false, err: '503' });
        n.forward(req, cell.edges, 'one', r => {
          if (t) {
            const s = perTenant.get(t) ?? { ok: 0, err: 0 };
            if (r.ok) s.ok += req.msg.weight;
            else s.err += req.msg.weight;
            perTenant.set(t, s);
          }
          req.reply(r);
        });
      });
    },
    view: () => ({
      badges: [
        { text: `cells ${cells.length - down}/${cells.length}`, tone: down ? 'fail' : 'ok' },
        ...(down ? [{ text: `blast ${Math.round((down / cells.length) * 100)}%`, tone: 'fail' as const }] : []),
      ],
    }),
  };
}

register('service', service);
register('monolith', monolith);
register('serverless-fn', serverless);
register('cron', cron);
register('container-group', containerGroup);
register('cell-router', cellRouter);
