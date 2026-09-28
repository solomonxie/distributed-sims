// Celery internals: producer (delay), broker (Redis / RabbitMQ), prefork workers, result backend, beat.
// Protocol kinds: celery.publish (rpc), celery.deliver / celery.ack (send), celery.store-result (rpc).
import type { NodeLogic, Req, SimNode } from '../node';
import type { World } from '../world';
import type { Badge, Msg } from '../types';
import { register } from './registry';

interface Task {
  id: string;
  /** dedupe key for side effects: task id, or beat schedule tick */
  key: string;
  name: string;
  ms: number;
  born: number;
  trace?: boolean;
}

interface Ledger {
  seq: number;
  exec: Map<string, number>;
  waits: number[];
  traced: number;
}
const ledgers = new WeakMap<World, Ledger>();
function ledger(w: World): Ledger {
  let l = ledgers.get(w);
  if (!l) ledgers.set(w, (l = { seq: 0, exec: new Map(), waits: [], traced: 0 }));
  return l;
}

/** Targets of this node's out edges with the given type, else every node of that type. */
function peers(n: SimNode, type: string): string[] {
  const out = n.outEdges().map(e => e.to).filter(id => n.world.nodes.get(id)?.type === type);
  if (out.length) return out;
  return [...n.world.nodes.values()].filter(x => x.type === type).map(x => x.id);
}

function p95(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))];
}

function newTask(n: SimNode, name: string, key?: string, trace?: boolean): Task {
  const l = ledger(n.world);
  const id = `t${++l.seq}`;
  const long = n.rng.chance(n.num('longTaskPct', 0) / 100);
  const ms = long ? n.num('longTaskMs', 20000) : n.rng.lognormal(n.num('taskMs', 1000), n.num('taskP99Ms', 3000));
  return { id, key: key ?? id, name, ms, born: n.now, trace: trace || l.traced++ < 3 };
}

function publish(n: SimNode, task: Task, cb: (ok: boolean) => void) {
  const broker = peers(n, 'celery-broker')[0];
  if (!broker) return cb(false);
  if (task.trace) n.log('protocol', `delay() → ${task.id} (${task.name}) sent to broker`);
  n.rpc(broker, { kind: 'celery.publish', data: { task } }, 1500, r => cb(r.ok));
}

// ---------- producer: the app calling task.delay() ----------
register('celery-producer', n => ({
  onRequest(req: Req) {
    n.process(req.msg.weight, n.serviceTime('p50Ms', 'p99Ms', 2, 10), ok => {
      if (!ok) return req.reply({ ok: false, err: '503' });
      const task = newTask(n, n.str('taskName', 'process_order'), undefined, req.msg.traceId !== undefined);
      publish(n, task, ok2 => req.reply(ok2 ? { ok: true } : { ok: false, err: '503' }));
    });
  },
}));

// ---------- broker ----------
interface Unacked {
  task: Task;
  worker: string;
  epoch: number;
  at: number;
}

register('celery-broker', n => {
  const queue: Task[] = [];
  const unacked = new Map<number, Unacked>();
  let tag = 0;
  let rr = 0;
  let redelivered = 0;
  const mode = () => n.str<'redis' | 'rabbitmq'>('mode', 'redis');
  const workers = () => peers(n, 'celery-worker');
  const limitOf = (w: SimNode) => {
    const m = w.num('prefetchMultiplier', 4);
    return m <= 0 ? Infinity : Math.max(1, w.num('slots', 4)) * m;
  };

  const pump = () => {
    if (!n.up) return;
    const ws = workers()
      .map(id => n.world.nodes.get(id)!)
      .filter(w => w?.up);
    if (!ws.length) return;
    const inflight = new Map<string, number>();
    for (const u of unacked.values()) inflight.set(u.worker, (inflight.get(u.worker) ?? 0) + 1);
    while (queue.length) {
      let chosen: SimNode | undefined;
      for (let i = 0; i < ws.length; i++) {
        const w = ws[(rr + i) % ws.length];
        if ((inflight.get(w.id) ?? 0) < limitOf(w)) {
          chosen = w;
          rr = (rr + i + 1) % ws.length;
          break;
        }
      }
      if (!chosen) break;
      const task = queue.shift()!;
      const t = ++tag;
      unacked.set(t, { task, worker: chosen.id, epoch: chosen.epoch, at: n.now });
      inflight.set(chosen.id, (inflight.get(chosen.id) ?? 0) + 1);
      n.send(chosen.id, { kind: 'celery.deliver', data: { task, tag: t } });
    }
  };

  const scan = () => {
    const restored: Task[] = [];
    const reasons = new Set<string>();
    for (const [t, u] of unacked) {
      const w = n.world.nodes.get(u.worker);
      const connLost = !w || !w.up || w.epoch !== u.epoch;
      if (mode() === 'rabbitmq' && connLost) reasons.add(`connection to ${w?.name ?? u.worker} lost`);
      else if (mode() === 'redis' && n.now - u.at > n.num('visibilityMs', 30000)) reasons.add('visibility timeout');
      else continue;
      unacked.delete(t);
      restored.push(u.task);
    }
    if (restored.length) {
      redelivered += restored.length;
      queue.unshift(...restored);
      n.log('protocol', `${[...reasons].join(', ')}: ${restored.length} unacked task(s) redelivered (${restored.slice(0, 3).map(x => x.id).join(', ')})`);
    }
    // prefetch hoarding: tasks reserved behind busy slots while another worker sits idle
    const ws = workers()
      .map(id => n.world.nodes.get(id)!)
      .filter(w => w?.up);
    const idle = ws.some(w => (w.gaugesNow.running ?? 0) < w.num('slots', 4) && !(w.gaugesNow.reserved ?? 0));
    const hoarded = idle ? ws.reduce((a, w) => a + ((w.gaugesNow.running ?? 0) >= w.num('slots', 4) ? w.gaugesNow.reserved ?? 0 : 0), 0) : 0;
    n.gauge('hoarded', hoarded);
    n.gauge('waitP95', Math.round(p95(ledger(n.world).waits)));
    n.gauge('queued', queue.length);
    n.gauge('unacked', unacked.size);
    n.gauge('redelivered', redelivered);
    pump();
  };

  return {
    onStart() {
      n.every(250, scan);
    },
    onRequest(req: Req) {
      if (req.msg.kind !== 'celery.publish') return req.reply({ ok: false, err: '5xx' });
      if (queue.length >= n.num('queueLimit', 10000)) return req.reply({ ok: false, err: '503' });
      n.process(1, n.serviceTime('p50Ms', 'p99Ms', 0.3, 2), ok => {
        if (!ok) return req.reply({ ok: false, err: '503' });
        const task = req.msg.data.task as Task;
        queue.push(task);
        if (task.trace) n.log('protocol', `${task.id} appended to queue 'celery' (${mode()})`);
        req.reply({ ok: true });
        pump();
      });
    },
    onMessage(m: Msg) {
      if (m.kind === 'celery.ack') {
        unacked.delete(m.data.tag);
        pump();
      }
    },
    view() {
      return { badges: [{ text: mode() === 'redis' ? 'Redis' : 'RabbitMQ', tone: 'muted' }, { text: `${queue.length} queued`, tone: queue.length > 50 ? 'warn' : 'muted' }] as Badge[] };
    },
  };
});

// ---------- worker (prefork pool) ----------
interface Reserved {
  task: Task;
  tag: number;
  broker: string;
  at: number;
}

register('celery-worker', n => {
  let reserved: Reserved[] = [];
  let running = new Map<string, { r: Reserved; acked: boolean }>();
  let lost = 0;
  let done = 0;
  let resultErrors = 0;
  const waits: number[] = [];
  const acksLate = () => n.bool('acksLate', false);
  const slots = () => Math.max(1, n.num('slots', 4));
  const ack = (r: Reserved) => n.send(r.broker, { kind: 'celery.ack', data: { tag: r.tag, id: r.task.id } });

  const gauges = () => {
    n.gauge('running', running.size);
    n.gauge('reserved', reserved.length);
    n.gauge('lost', lost);
    n.gauge('done', done);
    n.gauge('waitP95', Math.round(p95(waits)));
    n.gauge('resultErrors', resultErrors);
  };

  const finish = (r: Reserved, startedAt: number) => {
    const l = ledger(n.world);
    const t = r.task;
    const runs = (l.exec.get(t.key) ?? 0) + 1;
    l.exec.set(t.key, runs);
    if (runs > 1) {
      n.anomaly('duplicate', 1);
      n.log('info', `${t.id} (${t.name}) executed twice: duplicate side effect`);
    }
    running.delete(t.id + ':' + r.tag);
    done++;
    n.series.cur.okW += 1;
    if (acksLate()) ack(r);
    const backend = peers(n, 'celery-result-backend')[0];
    if (backend)
      n.rpc(backend, { kind: 'celery.store-result', data: { id: t.id } }, 2000, res => {
        if (!res.ok) resultErrors++;
        else if (t.trace) n.log('protocol', `${t.id} succeeded in ${((n.now - startedAt) / 1000).toFixed(1)}s; result stored`);
      });
    tryRun();
  };

  const tryRun = () => {
    while (n.up && running.size < slots() && reserved.length) {
      const r = reserved.shift()!;
      const wait = n.now - r.task.born;
      waits.push(wait);
      if (waits.length > 50) waits.shift();
      const lw = ledger(n.world).waits;
      lw.push(wait);
      if (lw.length > 30) lw.shift();
      if (!acksLate()) ack(r);
      if (r.task.trace) n.log('protocol', `${n.name} started ${r.task.id}${acksLate() ? ' (ack after it finishes)' : ', acked early'}`);
      running.set(r.task.id + ':' + r.tag, { r, acked: !acksLate() });
      const ms = r.task.ms * n.mods.slowX;
      n.series.cur.inW += 1;
      n.series.cur.busy += ms;
      const at = n.now;
      n.timer(ms, () => finish(r, at));
    }
    gauges();
  };

  return {
    onStart() {
      reserved = [];
      running = new Map();
      n.every(500, gauges);
    },
    onMessage(m: Msg) {
      if (m.kind !== 'celery.deliver') return;
      const r: Reserved = { task: m.data.task, tag: m.data.tag, broker: m.from, at: n.now };
      if (r.task.trace) n.log('protocol', `${n.name} reserved ${r.task.id} (prefetch)`);
      reserved.push(r);
      tryRun();
    },
    onKill() {
      const gone = [...running.values()].filter(x => x.acked).length;
      if (gone) {
        lost += gone;
        n.anomaly('lost-write', gone);
        n.log('info', `${n.name} crashed: ${gone} running task(s) were already acked, lost for good`);
      }
      n.gauge('lost', lost);
      n.gauge('running', 0);
      n.gauge('reserved', 0);
    },
    view() {
      return {
        badges: [
          { text: `${running.size}/${slots()}`, tone: running.size >= slots() ? 'warn' : 'muted' },
          { text: acksLate() ? 'acks_late' : 'early ack', tone: acksLate() ? 'ok' : 'muted' },
          ...(reserved.length ? [{ text: `${reserved.length} reserved`, tone: 'protocol' as const }] : []),
        ] as Badge[],
      };
    },
  };
});

// ---------- result backend ----------
register('celery-result-backend', n => {
  let expiries: number[] = [];
  let lastFullLog = -1e9;
  const kb = () => n.num('resultKb', 16);
  const update = () => {
    const now = n.now;
    let i = 0;
    while (i < expiries.length && expiries[i] <= now) i++;
    if (i) expiries = expiries.slice(i);
    n.memMb = (expiries.length * kb()) / 1024;
    n.gauge('results', expiries.length);
    n.gauge('memMb', Math.round(n.memMb * 10) / 10);
  };
  return {
    onStart() {
      n.every(1000, update);
    },
    onRequest(req: Req) {
      update();
      if (n.mods.diskFull || n.memMb + kb() / 1024 > n.num('maxMemoryMb', 1024)) {
        if (n.now - lastFullLog > 5000) {
          lastFullLog = n.now;
          n.log('info', `Result backend full (OOM command not allowed): ${expiries.length} results never expired`);
        }
        return req.reply({ ok: false, err: '5xx' });
      }
      n.process(1, n.serviceTime('p50Ms', 'p99Ms', 0.5, 3), ok => {
        if (!ok) return req.reply({ ok: false, err: '503' });
        expiries.push(n.now + n.num('expiresSec', 86400) * 1000);
        update();
        req.reply({ ok: true });
      });
    },
    onChaos(kind, _p, heal) {
      if (kind !== 'cache-flush') return false;
      if (!heal) {
        n.log('info', `${n.name} FLUSHDB: ${expiries.length} results dropped`);
        expiries = [];
        update();
      }
      return true;
    },
  };
});

// ---------- beat (periodic scheduler; must run exactly once) ----------
register('celery-beat', n => {
  let copies = 1;
  let tick = 0;
  const period = () => Math.max(0.1, n.num('scheduleSec', 5)) * 1000;
  const fire = () => {
    tick = Math.round(n.now / period());
    const name = n.str('taskName', 'send_digest');
    for (let i = 0; i < copies; i++) {
      const t = newTask(n, name, `beat:${name}:${tick}`);
      publish(n, t, ok => ok || n.log('info', `beat could not publish ${name} (broker down)`));
    }
    n.gauge('ticks', tick);
  };
  return {
    onStart() {
      const p = period();
      n.timer(p - (n.now % p), () => {
        fire();
        n.every(p, fire);
      });
    },
    onChaos(kind, _p, heal) {
      if (kind !== 'split-brain') return false;
      copies = heal ? 1 : 2;
      n.log('info', heal ? `${n.name}: second beat stopped` : `${n.name}: a second beat instance started; every schedule now fires twice`);
      return true;
    },
    view() {
      return { badges: copies > 1 ? [{ text: '×2 beat', tone: 'fail' }] : [] };
    },
  };
});

export {};
