// Kubernetes internals: API server (the only etcd client), scheduler, controller manager
// (Deployment rollout, node lifecycle, HPA), kubelets (pods + probes), Service / kube-proxy endpoints.
// etcd members are consensus-member nodes (raft.ts). Protocol kinds: k8s.* (rpc to the API server).
import type { NodeLogic, Req, SimNode } from '../node';
import type { Badge, Id } from '../types';
import { register } from './registry';
import { groupOf, groupState, raftLeader } from './raft';

type Phase = 'Pending' | 'ContainerCreating' | 'Running' | 'CrashLoopBackOff';

interface Pod {
  name: string;
  rev: number;
  node?: Id;
  phase: Phase;
  ready: boolean;
  restarts: number;
  born: number;
  cpu: number;
}

interface NodeRec {
  ready: boolean;
  beat: number;
  cpu: number;
  notReadySince: number;
}

interface Cluster {
  pods: Map<string, Pod>;
  nodes: Map<Id, NodeRec>;
  /** Deployment spec.replicas (HPA writes it) */
  replicas: number;
  /** pod template revision; a rollout bumps it */
  rev: number;
  badRevs: Set<number>;
  seq: number;
  /** resourceVersion = number of etcd writes */
  rv: number;
  apiUpSince: number;
}

const clusterName = (n: SimNode) => n.str('cluster', 'k8s');
const cluster = (n: SimNode) =>
  groupState<Cluster>(n.world, 'k8s:' + clusterName(n), () => ({
    pods: new Map(),
    nodes: new Map(),
    replicas: -1,
    rev: 1,
    badRevs: new Set(),
    seq: 0,
    rv: 0,
    apiUpSince: 0,
  }));

function ofType(n: SimNode, type: string): SimNode[] {
  return [...n.world.nodes.values()].filter(x => x.type === type && clusterName(x) === clusterName(n));
}

function apiNode(n: SimNode): SimNode | undefined {
  return ofType(n, 'k8s-api-server')[0];
}

function apiReachable(n: SimNode): boolean {
  const api = apiNode(n);
  return !!api && api.up && !n.world.blocked(n.id, api.id) && !n.world.blocked(api.id, n.id);
}

function apiCall(n: SimNode, kind: string, data: Record<string, unknown>, cb: (ok: boolean) => void) {
  const api = apiNode(n);
  if (!api) return cb(false);
  n.rpc(api.id, { kind, data }, n.num('apiTimeoutMs', 1000), r => cb(r.ok));
}

/** Log at most once per `ms` per key. */
function throttle(n: SimNode) {
  const last = new Map<string, number>();
  return (key: string, ms: number, kind: 'protocol' | 'info', text: string) => {
    if (n.now - (last.get(key) ?? -Infinity) < ms) return;
    last.set(key, n.now);
    n.log(kind, text);
  };
}

const podsOn = (c: Cluster, node: Id) => [...c.pods.values()].filter(p => p.node === node);

// ---------- API server ----------
register('k8s-api-server', n => {
  const c = cluster(n);
  const say = throttle(n);
  let etcdErrors = 0;

  const etcdMembers = () => {
    const out = n.outEdges().map(e => n.world.nodes.get(e.to)!).filter(x => x?.type === 'consensus-member');
    return out.length ? out : [...n.world.nodes.values()].filter(x => x.type === 'consensus-member');
  };

  /** Every change is a write to etcd first; only a committed write changes cluster state. */
  const persist = (key: number, cb: (ok: boolean) => void) => {
    const ms = etcdMembers();
    if (!ms.length) return cb(true);
    const leader = raftLeader(n.world, groupOf(ms[0]));
    const to = leader && ms.some(m => m.id === leader.id) ? leader.id : (ms.find(m => m.up) ?? ms[0]).id;
    n.rpc(to, { kind: 'etcd.put', op: 'write', key, weight: 1 }, n.num('etcdTimeoutMs', 1000), r => cb(r.ok));
  };

  const apply = (kind: string, d: any) => {
    const p = d.name ? c.pods.get(d.name) : undefined;
    switch (kind) {
      case 'k8s.create':
        c.pods.set(d.name, { name: d.name, rev: d.rev, phase: 'Pending', ready: false, restarts: 0, born: n.now, cpu: d.cpu });
        return;
      case 'k8s.delete':
        c.pods.delete(d.name);
        return;
      case 'k8s.bind':
        if (p && !p.node) p.node = d.node;
        return;
      case 'k8s.status':
        if (p) Object.assign(p, { phase: d.phase, ready: d.ready, restarts: d.restarts });
        return;
      case 'k8s.scale':
        c.replicas = d.replicas;
        return;
      case 'k8s.rollout':
        c.rev = d.rev;
        if (d.bad) c.badRevs.add(d.rev);
        return;
      case 'k8s.node': {
        const r = c.nodes.get(d.node);
        if (!r) return;
        r.ready = d.ready;
        if (!d.ready) {
          r.notReadySince = n.now;
          for (const q of podsOn(c, d.node)) q.ready = false;
        }
        return;
      }
    }
  };

  return {
    onStart() {
      c.apiUpSince = n.now;
      n.every(1000, () => {
        n.gauge('resourceVersion', c.rv);
        n.gauge('pods', c.pods.size);
        n.gauge('etcdErrors', etcdErrors);
      });
    },
    onRequest(req: Req) {
      const { kind } = req.msg;
      const d = req.msg.data ?? {};
      if (kind === 'k8s.lease') {
        // node heartbeat (Lease object); kept in the API server's cache here
        const r = c.nodes.get(d.node);
        if (r) r.beat = n.now;
        else c.nodes.set(d.node, { ready: true, beat: n.now, cpu: d.cpu, notReadySince: 0 });
        return req.reply({ ok: true });
      }
      if (!kind.startsWith('k8s.')) return req.reply({ ok: false, err: '5xx' });
      n.process(1, n.serviceTime('p50Ms', 'p99Ms', 1, 5), ok => {
        if (!ok) return req.reply({ ok: false, err: '503' });
        persist(req.msg.id % 1024, stored => {
          if (!stored) {
            etcdErrors++;
            say('etcd', 3000, 'info', `API server: etcd write failed (no quorum?) → ${kind.slice(4)} rejected`);
            return req.reply({ ok: false, err: 'unavailable' });
          }
          apply(kind, d);
          c.rv++;
          req.reply({ ok: true });
        });
      });
    },
    view() {
      return { badges: [{ text: `rv ${c.rv}`, tone: 'protocol' }] as Badge[] };
    },
  };
});

// ---------- scheduler ----------
register('k8s-scheduler', n => {
  const c = cluster(n);
  const say = throttle(n);
  const binding = new Map<string, Id>();
  let scheduled = 0;

  const loop = () => {
    const pending = [...c.pods.values()].filter(p => !p.node).sort((a, b) => a.born - b.born);
    n.gauge('pending', pending.length);
    n.gauge('scheduled', scheduled);
    if (!apiReachable(n)) return;
    for (const pod of pending) {
      if (binding.has(pod.name)) continue;
      let best: Id | undefined;
      let bestFree = -1;
      for (const [id, rec] of c.nodes) {
        if (!rec.ready) continue;
        const used = podsOn(c, id).reduce((a, p) => a + p.cpu, 0) + [...binding].filter(([, to]) => to === id).length * pod.cpu;
        const free = rec.cpu - used;
        if (free >= pod.cpu && free > bestFree) {
          best = id;
          bestFree = free;
        }
      }
      if (!best) {
        say('fit:' + pod.name, 10000, 'info', `${pod.name} Pending: 0/${c.nodes.size} nodes available (insufficient cpu)`);
        continue;
      }
      const to = best;
      binding.set(pod.name, to);
      apiCall(n, 'k8s.bind', { name: pod.name, node: to }, ok => {
        binding.delete(pod.name);
        if (!ok) return;
        scheduled++;
        n.log('protocol', `Scheduled ${pod.name} → ${n.world.nodeName(to)} (${bestFree}m cpu free)`);
      });
    }
  };

  return {
    onStart() {
      binding.clear();
      n.every(n.num('loopMs', 200), loop);
    },
    view() {
      const p = [...c.pods.values()].filter(x => !x.node).length;
      return { badges: p ? [{ text: `${p} pending`, tone: 'warn' }] : [] };
    },
  };
});

// ---------- controller manager: Deployment/ReplicaSet, node lifecycle, HPA ----------
register('k8s-controller-manager', n => {
  const c = cluster(n);
  const say = throttle(n);
  const creating = new Set<string>();
  const deleting = new Set<string>();
  let nodeWrites = new Set<Id>();
  let rolloutAt = -1;
  let deadlineLogged = false;
  let scaling = false;
  let recs: { t: number; r: number }[] = [];

  const surgeUnavail = (desired: number) => {
    let surge = Math.ceil((desired * n.num('maxSurgePct', 25)) / 100);
    const unavail = Math.floor((desired * n.num('maxUnavailablePct', 25)) / 100);
    if (!surge && !unavail) surge = 1;
    return { surge, unavail };
  };

  const create = (k: number) => {
    for (let i = 0; i < k; i++) {
      const name = `web-v${c.rev}-${(++c.seq).toString(36)}`;
      creating.add(name);
      apiCall(n, 'k8s.create', { name, rev: c.rev, cpu: n.num('podCpuMillis', 500) }, ok => {
        creating.delete(name);
        if (ok && c.seq <= 12) n.log('protocol', `ReplicaSet web-v${c.rev}: created pod ${name}`);
      });
    }
  };

  const remove = (p: Pod, why: string) => {
    if (deleting.has(p.name)) return;
    deleting.add(p.name);
    apiCall(n, 'k8s.delete', { name: p.name }, ok => {
      deleting.delete(p.name);
      if (ok && why) n.log('protocol', `${why}: deleted ${p.name}`);
    });
  };

  const reconcileDeployment = () => {
    const pods = [...c.pods.values()].filter(p => !deleting.has(p.name));
    const desired = c.replicas;
    const inflight = creating.size;
    const fresh = pods.filter(p => p.rev === c.rev);
    const old = pods.filter(p => p.rev !== c.rev);
    if (!old.length) {
      if (fresh.length + inflight < desired) create(desired - fresh.length - inflight);
      else if (fresh.length > desired) {
        const extra = [...fresh].sort((a, b) => Number(a.ready) - Number(b.ready) || b.born - a.born).slice(0, fresh.length - desired);
        for (const p of extra) remove(p, 'Scale down');
      }
      if (rolloutAt >= 0 && fresh.length === desired && fresh.every(p => p.ready)) {
        n.log('info', `Deployment web: rollout to revision ${c.rev} complete`);
        rolloutAt = -1;
      }
      return;
    }
    const { surge, unavail } = surgeUnavail(desired);
    const canCreate = Math.min(desired + surge - pods.length - inflight, desired - fresh.length - inflight);
    if (canCreate > 0) create(canCreate);
    const available = pods.filter(p => p.ready).length;
    let removable = Math.max(0, available - (desired - unavail));
    for (const p of [...old].sort((a, b) => Number(a.ready) - Number(b.ready))) {
      if (!p.ready) remove(p, 'Rolling update (old pod not ready)');
      else if (removable > 0) {
        removable--;
        remove(p, `Rolling update (maxUnavailable ${unavail})`);
      }
    }
    if (rolloutAt >= 0 && !deadlineLogged && n.now - rolloutAt > n.num('progressDeadlineSec', 20) * 1000) {
      deadlineLogged = true;
      n.log('info', `Deployment web: ProgressDeadlineExceeded — revision ${c.rev} pods never became Ready; rollout stalled, old pods keep serving`);
    }
  };

  const nodeLifecycle = () => {
    const grace = n.num('nodeGraceSec', 5) * 1000;
    if (n.now - c.apiUpSince < grace) return;
    for (const [id, rec] of c.nodes) {
      const stale = n.now - rec.beat > grace;
      if (stale === rec.ready && !nodeWrites.has(id)) {
        nodeWrites.add(id);
        apiCall(n, 'k8s.node', { node: id, ready: !stale }, ok => {
          nodeWrites.delete(id);
          if (!ok) return;
          n.log(
            'protocol',
            stale
              ? `${n.world.nodeName(id)} NotReady (no heartbeat for ${grace / 1000}s): its pods marked not Ready`
              : `${n.world.nodeName(id)} Ready again`,
          );
        });
      }
      if (!rec.ready && n.now - rec.notReadySince > n.num('evictionSec', 10) * 1000) {
        const victims = podsOn(c, id).filter(p => !deleting.has(p.name));
        if (victims.length) {
          n.log('protocol', `Evicting ${victims.length} pod(s) from ${n.world.nodeName(id)} (NotReady > ${n.num('evictionSec', 10)}s)`);
          for (const p of victims) remove(p, '');
        }
      }
    }
  };

  const hpa = () => {
    if (!n.bool('hpa', false) || scaling) return;
    let busy = 0;
    let pods = 0;
    for (const k of ofType(n, 'k8s-kubelet')) {
      const ready = podsOn(c, k.id).filter(p => p.ready).length;
      if (!ready || !k.up) continue;
      busy += k.series.window(3).util * ready;
      pods += ready;
    }
    if (!pods) return;
    const util = busy / pods;
    const target = n.num('hpaTargetPct', 60) / 100;
    n.gauge('cpuPct', Math.round(util * 100));
    const cur = c.replicas;
    let want = Math.abs(util / target - 1) <= 0.1 ? cur : Math.ceil(pods * (util / target));
    want = Math.max(n.num('hpaMin', 2), Math.min(n.num('hpaMax', 10), want));
    recs.push({ t: n.now, r: want });
    recs = recs.filter(x => n.now - x.t <= n.num('hpaDownWindowSec', 15) * 1000);
    if (want < cur) want = Math.max(...recs.map(x => x.r));
    if (want === cur) return;
    if (!apiReachable(n)) {
      say('hpa', 5000, 'info', `HPA wants ${want} replicas but the API server is unreachable: no change possible`);
      return;
    }
    scaling = true;
    apiCall(n, 'k8s.scale', { replicas: want }, ok => {
      scaling = false;
      if (ok) n.log('protocol', `HPA: cpu ${Math.round(util * 100)}% (target ${Math.round(target * 100)}%) → replicas ${cur} → ${want}`);
    });
  };

  const rollout = (bad: boolean) => {
    if (!apiReachable(n)) {
      n.log('info', 'kubectl apply: connection refused (API server down)');
      return;
    }
    const rev = c.rev + 1;
    apiCall(n, 'k8s.rollout', { rev, bad }, ok => {
      if (!ok) return n.log('info', 'kubectl apply failed: API server could not persist the change');
      rolloutAt = n.now;
      deadlineLogged = false;
      const { surge, unavail } = surgeUnavail(c.replicas);
      n.log('protocol', `Rolling update web → revision ${rev} (maxSurge ${surge}, maxUnavailable ${unavail})${bad ? '; its readiness probe fails' : ''}`);
    });
  };

  return {
    onStart() {
      creating.clear();
      deleting.clear();
      nodeWrites = new Set();
      scaling = false;
      if (c.replicas < 0) c.replicas = Math.round(n.num('replicas', 3));
      n.every(n.num('loopMs', 500), () => {
        const ready = [...c.pods.values()].filter(p => p.ready).length;
        n.gauge('replicas', c.replicas);
        n.gauge('readyPods', ready);
        n.gauge('revision', c.rev);
        n.gauge('pods', c.pods.size);
        if (!apiReachable(n)) {
          say('api', 10000, 'info', 'Controller manager: API server unreachable, reconcile loops paused (nothing can change)');
          return;
        }
        nodeLifecycle();
        reconcileDeployment();
      });
      n.every(n.num('hpaSyncSec', 3) * 1000, hpa);
    },
    onChaos(kind, _p, heal) {
      if (kind === 'config-push') {
        if (!heal) rollout(false);
        return true;
      }
      if (kind === 'bad-deploy') {
        if (heal) {
          n.log('info', 'kubectl rollout undo');
          rollout(false);
        } else rollout(true);
        return true;
      }
      return false;
    },
    view() {
      const ready = [...c.pods.values()].filter(p => p.ready).length;
      const b: Badge[] = [{ text: `${ready}/${c.replicas} ready`, tone: ready < c.replicas ? 'warn' : 'ok' }, { text: `rev ${c.rev}`, tone: 'protocol' }];
      if (n.bool('hpa', false)) b.push({ text: 'HPA', tone: 'muted' });
      return { badges: b };
    },
  };
});

// ---------- kubelet (one per worker node) ----------
interface Container {
  state: 'creating' | 'running' | 'backoff' | 'terminating';
  ready: boolean;
  restarts: number;
  startedAt: number;
  sending: boolean;
}

register('k8s-kubelet', n => {
  const c = cluster(n);
  const say = throttle(n);
  let local = new Map<string, Container>();
  let crashing = false;
  const podSlots = () => Math.max(1, n.num('podSlots', 4));

  const phaseOf = (s: Container): Phase => (s.state === 'creating' ? 'ContainerCreating' : s.state === 'backoff' ? 'CrashLoopBackOff' : 'Running');
  const serving = (s?: Container) => s?.state === 'running' || s?.state === 'terminating';

  const report = (name: string, s: Container) => {
    const p = c.pods.get(name);
    if (!p || s.sending) return;
    const phase = phaseOf(s);
    const ready = s.state === 'running' && s.ready;
    if (p.phase === phase && p.ready === ready && p.restarts === s.restarts) return;
    s.sending = true;
    apiCall(n, 'k8s.status', { name, phase, ready, restarts: s.restarts }, () => (s.sending = false));
  };

  const crash = (name: string, s: Container) => {
    s.state = 'backoff';
    s.ready = false;
    s.restarts++;
    const delay = Math.min(n.num('backoffMaxMs', 16000), n.num('backoffMs', 1000) * 2 ** (s.restarts - 1));
    n.log('protocol', `${name} CrashLoopBackOff: container exited (restart ${s.restarts}), back-off ${delay / 1000}s`);
    report(name, s);
    n.timer(delay, () => {
      if (local.get(name) !== s) return;
      run(name, s);
    });
  };

  const run = (name: string, s: Container) => {
    s.state = 'running';
    s.startedAt = n.now;
    report(name, s);
    if (crashing) n.timer(n.num('crashAfterMs', 800), () => crashing && local.get(name) === s && s.state === 'running' && crash(name, s));
  };

  const sync = () => {
    const mine = podsOn(c, n.id);
    for (const p of mine) {
      if (local.has(p.name)) continue;
      const s: Container = { state: 'creating', ready: false, restarts: 0, startedAt: 0, sending: false };
      local.set(p.name, s);
      if (c.seq <= 12) n.log('protocol', `${n.name}: pulling image, starting ${p.name}`);
      report(p.name, s);
      n.timer(n.num('podStartMs', 2000), () => local.get(p.name) === s && run(p.name, s));
    }
    const names = new Set(mine.map(p => p.name));
    // deleted pods get SIGTERM and finish in-flight requests during the grace period
    for (const [name, s] of local) {
      if (names.has(name) || s.state === 'terminating') continue;
      if (s.state !== 'running') {
        local.delete(name);
        continue;
      }
      s.state = 'terminating';
      s.ready = false;
      n.timer(n.num('terminationGraceMs', 1500), () => local.get(name) === s && local.delete(name));
    }
    for (const [name, s] of local) report(name, s);
    const running = [...local.values()].filter(serving).length;
    n.cfg.slots = Math.max(1, running * podSlots());
    n.gauge('pods', [...local.values()].filter(s => s.state !== 'terminating').length);
    n.gauge('ready', [...local.values()].filter(s => s.ready).length);
    n.gauge('restarts', [...local.values()].reduce((a, s) => a + s.restarts, 0));
  };

  const probe = () => {
    for (const [name, s] of local) {
      if (s.state !== 'running') continue;
      const p = c.pods.get(name);
      const ok = !!p && !c.badRevs.has(p.rev) && n.now - s.startedAt >= n.num('readinessDelayMs', 1000);
      if (ok && !s.ready && c.seq <= 12) n.log('protocol', `${n.name}: readiness probe passed for ${name} → Ready`);
      if (!ok && p && c.badRevs.has(p.rev)) say('probe:' + name, 30000, 'info', `${n.name}: readiness probe failed for ${name} (HTTP 500 on /healthz)`);
      s.ready = ok;
      report(name, s);
    }
  };

  return {
    onStart() {
      local = new Map();
      const beat = () => apiCall(n, 'k8s.lease', { node: n.id, cpu: n.num('cpuMillis', 2000) }, () => {});
      beat();
      n.every(n.num('heartbeatMs', 1000), beat);
      n.every(250, sync);
      n.every(n.num('probePeriodMs', 500), probe);
    },
    onRequest(req: Req) {
      if (!serving(local.get(req.msg.data?.pod))) return req.reply({ ok: false, err: 'refused' });
      n.process(req.msg.weight, n.serviceTime('p50Ms', 'p99Ms', 20, 60), ok => req.reply(ok ? { ok: true } : { ok: false, err: '503' }));
    },
    onChaos(kind, _p, heal) {
      if (kind !== 'crash-loop') return false;
      crashing = !heal;
      if (crashing) {
        n.log('info', `${n.name}: new container image exits on start`);
        for (const [name, s] of local) if (s.state === 'running') crash(name, s);
      }
      return true;
    },
    view() {
      const live = [...local.values()].filter(s => s.state !== 'terminating');
      const ready = live.filter(s => s.ready).length;
      const loop = [...local.values()].filter(s => s.state === 'backoff').length;
      const b: Badge[] = [{ text: `${ready}/${live.length} pods`, tone: ready < live.length ? 'warn' : 'muted' }];
      if (loop) b.push({ text: 'CrashLoop', tone: 'fail' });
      if (c.nodes.get(n.id)?.ready === false) b.push({ text: 'NotReady', tone: 'fail' });
      return { badges: b };
    },
  };
});

// ---------- Service (kube-proxy endpoints) ----------
register('k8s-service', n => {
  const c = cluster(n);
  const say = throttle(n);
  let endpoints: { pod: string; node: Id }[] = [];
  let rr = 0;

  const refresh = () => {
    // kube-proxy watches EndpointSlices through the API server; without it the last list stays
    if (!apiReachable(n)) return;
    const next = [...c.pods.values()].filter(p => p.ready && p.node).map(p => ({ pod: p.name, node: p.node! }));
    if (next.length !== endpoints.length) n.log('info', `Endpoints web: ${endpoints.length} → ${next.length} ready pod(s)`);
    endpoints = next;
    n.gauge('endpoints', endpoints.length);
  };

  return {
    onStart() {
      endpoints = [];
      n.every(n.num('syncMs', 500), refresh);
    },
    onRequest(req: Req) {
      if (!endpoints.length) {
        say('none', 5000, 'info', 'Service web has no ready endpoints → 503');
        return req.reply({ ok: false, err: '503' });
      }
      const ep = endpoints[rr++ % endpoints.length];
      const msg = n.world.child(req.msg, n.id, ep.node);
      msg.data = { ...(msg.data ?? {}), pod: ep.pod };
      const edge = n.outEdges(e => e.to === ep.node)[0];
      if (edge) n.call(edge, msg, r => req.reply(r));
      else n.rpc(ep.node, { ...msg, kind: 'req' }, 2000, r => req.reply(r));
    },
    view() {
      return { badges: [{ text: `${endpoints.length} endpoints`, tone: endpoints.length ? 'muted' : 'fail' }] as Badge[] };
    },
  };
});

export {};
