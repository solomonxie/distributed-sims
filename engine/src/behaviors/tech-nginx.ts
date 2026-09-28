// nginx internals (technologies.md → nginx): master + one worker per core, each worker a
// single-threaded event loop multiplexing thousands of connections; sendfile zero-copy;
// upstream keepalive vs ephemeral-port exhaustion; slowloris; graceful reload.
// Compared against apache-prefork: one process per connection.
import type { NodeLogic, Req, SimNode } from '../node';
import { pickWeighted } from '../node';
import type { Badge } from '../types';
import { register } from './registry';

interface Worker {
  busyUntil: number;
  conns: number;
  blockMs: number;
}

export function nginxServer(n: SimNode): NodeLogic {
  let workers: Worker[] = [];
  let rr = 0;
  let slowConns = 0;
  let connX = 1;
  let timeWait = 0;
  let upstreamOpen = 0;
  let reloads = 0;
  let draining = 0;
  let refusedW = 0;
  let cpuMs = 0;
  const say = throttle(n);

  const W = () => Math.max(1, Math.round(n.num('workers', 4)));
  const idleConns = () => n.num('clients', 0);
  const perWorkerLimit = () => Math.max(1, Math.round(n.num('workerConnections', 1024) * connX));
  const connsTotal = () => workers.reduce((a, w) => a + w.conns, 0) + slowConns + idleConns() + draining;

  /** run `ms` of CPU per request × weight on one worker's event loop, then fn */
  function run(w: Worker, ms: number, weight: number, fn: () => void) {
    const start = Math.max(n.now, w.busyUntil, n.mods.pausedUntil);
    const cost = (ms + w.blockMs) * weight * n.mods.slowX;
    w.busyUntil = start + cost;
    n.series.cur.busy += cost;
    cpuMs += cost;
    n.timer(w.busyUntil - n.now, fn);
  }

  function refuse(req: Req, why: string) {
    refusedW += req.msg.weight;
    say(why, why);
    req.reply({ ok: false, err: 'refused' });
  }

  function onRequest(req: Req) {
    const w = workers[rr++ % workers.length];
    const weight = req.msg.weight;
    // idle keep-alive + slowloris connections are spread over workers
    const held = (slowConns + idleConns()) / workers.length;
    if (w.conns + held + weight > perWorkerLimit()) return refuse(req, `worker_connections (${perWorkerLimit()}) are not enough — new connections refused`);
    w.conns += weight;
    const done = (ok: boolean, err?: 'refused' | '5xx' | 'timeout' | '503') => {
      w.conns -= weight;
      req.reply(ok ? { ok: true } : { ok: false, err: err ?? '5xx' });
    };
    const ups = n.syncOut(req.msg.op);
    const isStatic = !ups.length || n.rng.chance(n.num('staticRatio', 0));
    const baseMs = n.num('cpuUs', 20) / 1000;
    if (isStatic) {
      // sendfile: disk → page cache → NIC by DMA; without it the worker copies through user space
      const copyMs = n.bool('sendfile', true) ? 0 : (n.num('fileKb', 100) * n.num('copyUsPerKb', 2)) / 1000;
      return run(w, baseMs + copyMs, weight, () => done(true));
    }
    run(w, baseMs + n.num('proxyUs', 30) / 1000, weight, () => {
      const keep = n.bool('upstreamKeepalive', true);
      let connectMs = 0;
      if (!keep) {
        if (upstreamOpen + timeWait + weight > n.num('portRange', 28232)) {
          w.conns -= weight;
          return refuse(req, `connect() to upstream failed: no free ephemeral ports (${Math.round(timeWait)} in TIME_WAIT)`);
        }
        connectMs = n.num('connectMs', 1);
      }
      upstreamOpen += weight;
      const e = pickWeighted(ups, n.rng)!;
      n.timer(connectMs, () =>
        n.call(e, n.world.child(req.msg, n.id, e.to), r => {
          upstreamOpen -= weight;
          if (!keep) {
            timeWait += weight;
            n.world.kernel.after(n.num('timeWaitSec', 60) * 1000, () => (timeWait -= weight));
          }
          run(w, n.num('proxyUs', 30) / 3000, weight, () => done(r.ok, r.err as any));
        }),
      );
    });
  }

  return {
    onStart() {
      workers = Array.from({ length: W() }, () => ({ busyUntil: 0, conns: 0, blockMs: 0 }));
      n.cfg.instances = 1;
      n.cfg.slots = W();
      n.series.setCapacity(W());
      n.every(1000, () => {
        const conns = connsTotal();
        n.memMb = W() * n.num('workerMemMb', 10) + (conns * n.num('connMemKb', 2.5)) / 1024;
        n.gauge('connections', Math.round(conns));
        n.gauge('memMb', Math.round(n.memMb));
        n.gauge('timeWait', Math.round(timeWait));
        n.gauge('refused', Math.round(refusedW));
        n.gauge('ctxSwitches', Math.round(W() * 50 + cpuMs));
        n.gauge('worker1BusyMs', Math.round(Math.max(0, workers[0].busyUntil - n.now)));
        refusedW = 0;
        cpuMs = 0;
      });
    },
    onRequest,
    onChaos(kind, p, heal) {
      switch (kind) {
        case 'slowloris': {
          const c = Number(p.conns ?? 5000);
          slowConns = heal ? 0 : c;
          if (!heal) n.log('chaos', `Slowloris: ${c} clients trickle headers, each holding a connection (cheap here: ~${n.num('connMemKb', 2.5)} KB each, no thread)`);
          return true;
        }
        case 'blocking-call': {
          workers[0].blockMs = heal ? 0 : Number(p.ms ?? 200);
          if (!heal) n.log('chaos', `Blocking call in worker 1 (e.g. sync DNS / disk on NFS): its whole event loop stalls ${workers[0].blockMs}ms per request`);
          return true;
        }
        case 'conn-exhaustion': {
          connX = heal ? 1 : 0.1;
          if (!heal) n.log('chaos', `worker_connections cut to ${perWorkerLimit()}`);
          return true;
        }
        case 'config-push':
        case 'reload': {
          if (heal) return true;
          reloads++;
          const inflight = workers.reduce((a, w) => a + w.conns, 0);
          draining += inflight;
          n.log('info', `nginx -s reload: master starts ${W()} new workers; old workers stop accepting and drain ${Math.round(inflight)} connections — nothing dropped`);
          n.timer(n.num('drainMs', 2000), () => (draining = Math.max(0, draining - inflight)));
          workers = workers.map(w => ({ ...w, busyUntil: n.now }));
          return true;
        }
      }
      return false;
    },
    view() {
      const badges: Badge[] = [{ text: `${W()} workers`, tone: 'accent' }];
      if (slowConns) badges.push({ text: `slowloris ${slowConns}`, tone: 'warn' });
      if (workers[0]?.blockMs) badges.push({ text: 'worker 1 blocked', tone: 'fail' });
      if (reloads) badges.push({ text: `reload ×${reloads}`, tone: 'muted' });
      return { badges };
    },
  };
}

/** Apache prefork MPM: one process per connection (keep-alive and slow clients pin a process). */
export function apachePrefork(n: SimNode): NodeLogic {
  let busy = 0;
  let cpuActive = 0;
  let slow = 0;
  let backlog: { req: Req; at: number }[] = [];
  let arrivals = 0;
  let rpsEst = 0;
  let rolledAt = 0;
  let ctx = 0;
  const say = throttle(n);

  const max = () => Math.max(1, Math.round(n.num('maxRequestWorkers', 256)));
  const cores = () => Math.max(1, n.num('cores', 4));

  /** idle time a keep-alive connection pins its process before the client's next request */
  function idleHoldMs() {
    if (!n.bool('keepAlive', true)) return 0;
    const kat = n.num('keepAliveTimeoutSec', 5) * 1000;
    const clients = n.num('clients', 0);
    const rps = rpsEst || arrivals / Math.max(0.05, (n.now - rolledAt) / 1000);
    if (!clients || rps <= 0) return kat;
    return Math.min(kat, (clients / rps) * 1000);
  }

  function start(req: Req) {
    const w = req.msg.weight;
    busy += w;
    cpuActive += w;
    // run queue longer than cores: time slicing + context switches inflate CPU time
    const contention = Math.max(1, cpuActive / cores());
    const cpu = (n.num('cpuUs', 100) / 1000) * contention * n.mods.slowX + n.num('ctxSwitchUs', 5) / 1000 * (busy / cores());
    ctx += w * 2 + busy / cores();
    const hold = idleHoldMs();
    n.series.cur.busy += w * (cpu + hold);
    n.timer(cpu, () => {
      cpuActive -= w;
      req.reply({ ok: true });
      n.timer(hold, () => {
        busy -= w;
        drain();
      });
    });
  }

  function drain() {
    const giveUp = n.num('clientTimeoutMs', 3000);
    while (backlog.length && busy + slow + backlog[0].req.msg.weight <= max()) {
      const b = backlog.shift()!;
      // client gave up while queued: the accepted socket is already closed
      if (n.now - b.at > giveUp) b.req.reply({ ok: false, err: 'timeout' });
      else start(b.req);
    }
  }

  return {
    onStart() {
      n.cfg.instances = 1;
      n.cfg.slots = max();
      n.series.setCapacity(max());
      busy = 0;
      cpuActive = 0;
      backlog = [];
      n.every(1000, () => {
        rpsEst = rpsEst ? rpsEst * 0.5 + arrivals * 0.5 : arrivals;
        arrivals = 0;
        rolledAt = n.now;
        const procs = Math.max(n.num('spareServers', 5), Math.min(max(), busy + slow));
        n.memMb = procs * n.num('memPerProcessMb', 20);
        n.gauge('processes', Math.round(procs));
        n.gauge('memMb', Math.round(n.memMb));
        n.gauge('backlog', Math.round(backlog.reduce((a, b) => a + b.req.msg.weight, 0)));
        n.gauge('ctxSwitches', Math.round(ctx + procs * 100));
        n.gauge('connections', Math.round(busy + slow + backlog.length));
        ctx = 0;
      });
    },
    onRequest(req: Req) {
      arrivals += req.msg.weight;
      if (busy + slow + req.msg.weight <= max() && !backlog.length) return start(req);
      const queued = backlog.reduce((a, b) => a + b.req.msg.weight, 0);
      if (queued + req.msg.weight > n.num('listenBacklog', 511)) {
        say('full', `MaxRequestWorkers (${max()}) reached and listen backlog full — connections refused`);
        return req.reply({ ok: false, err: 'refused' });
      }
      backlog.push({ req, at: n.now });
    },
    onKill() {
      backlog = [];
      busy = 0;
      cpuActive = 0;
    },
    onChaos(kind, p, heal) {
      if (kind !== 'slowloris') return false;
      slow = heal ? 0 : Math.min(max(), Number(p.conns ?? 5000));
      if (!heal) n.log('chaos', `Slowloris: ${slow} of ${max()} processes pinned by clients sending one header byte at a time`);
      else drain();
      return true;
    },
    view() {
      const full = busy + slow >= max();
      return { badges: [{ text: `${Math.round(Math.min(max(), busy + slow))}/${max()} procs`, tone: full ? 'fail' : 'accent' }] };
    },
  };
}

function throttle(n: SimNode) {
  const last = new Map<string, number>();
  return (key: string, text: string) => {
    if (n.now - (last.get(key) ?? -Infinity) < 3000) return;
    last.set(key, n.now);
    n.log('info', `${n.name}: ${text}`);
  };
}

register('nginx-server', nginxServer);
register('apache-prefork', apachePrefork);
