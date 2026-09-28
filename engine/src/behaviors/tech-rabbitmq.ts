// RabbitMQ internals: publisher (confirms, mandatory) → exchange (direct/topic/fanout) → queues
// (classic / classic mirrored / quorum, placed on broker nodes) → consumers (prefetch, acks) and
// dead-letter queues. Broker nodes raise a memory alarm that blocks every publisher (flow control).
// Protocol kinds: rmq.append (Raft/mirror replication), rmq.deliver, rmq.ack, rmq.nack, rmq.dead.
import type { NodeLogic, Req, SimNode } from '../node';
import type { World } from '../world';
import type { Badge, Msg } from '../types';
import { register } from './registry';
import { clusterOf } from '../composite';

interface Entry {
  id: number;
  rk: string;
  w: number;
  born: number;
  deliveries: number;
  poison?: boolean;
  trace?: boolean;
  /** broker nodes holding a copy */
  have: string[];
}

interface Ledger {
  seq: number;
  traced: number;
  processed: Map<number, number>;
}
const ledgers = new WeakMap<World, Ledger>();
function ledger(w: World): Ledger {
  let l = ledgers.get(w);
  if (!l) ledgers.set(w, (l = { seq: 0, traced: 0, processed: new Map() }));
  return l;
}

const cluster = (n: SimNode) => clusterOf(n, 'rabbitmq');
const brokers = (n: SimNode) => [...n.world.nodes.values()].filter(x => x.type === 'rabbitmq-node' && cluster(x) === cluster(n));
const alarmed = (n: SimNode) => brokers(n).filter(b => b.up && (b.gaugesNow.alarm ?? 0) > 0);

/** AMQP topic match: `*` = one word, `#` = zero or more words. */
export function topicMatch(pattern: string, key: string): boolean {
  const p = pattern.split('.');
  const k = key.split('.');
  const go = (i: number, j: number): boolean => {
    if (i === p.length) return j === k.length;
    if (p[i] === '#') return go(i + 1, j) || (j < k.length && go(i, j + 1));
    if (j === k.length) return false;
    return (p[i] === '*' || p[i] === k[j]) && go(i + 1, j + 1);
  };
  return go(0, 0);
}

/** a node id from config, relative to this composite instance when prefixed */
function ref(n: SimNode, id: string): string {
  if (!id || n.world.nodes.has(id)) return id;
  const i = n.id.lastIndexOf('/');
  return i > 0 ? `${n.id.slice(0, i)}/${id}` : id;
}

const list = (s: string) => s.split(',').map(x => x.trim()).filter(Boolean);

// ---------------- publisher ----------------
register('rabbitmq-publisher', n => {
  let held: { req: Req; at: number }[] = [];
  let typo = false;
  let blockedLogged = false;
  let returned = 0;
  let nacked = 0;

  function publish(req: Req) {
    const keys = list(n.str('routingKeys', 'order.created,order.paid,user.signup'));
    let rk = keys[(req.msg.key ?? 0) % keys.length] ?? 'order.created';
    if (typo) rk = rk.replace('order.', 'orders.');
    const l = ledger(n.world);
    const trace = l.traced < 1 && n.now > 1000;
    if (trace) l.traced++;
    const e = n.syncOut()[0];
    if (!e) return req.reply({ ok: false, err: '5xx' });
    const confirms = n.bool('confirms', true);
    const m = n.world.child(req.msg, n.id, e.to);
    m.data = { rk, mandatory: n.bool('mandatory', false), trace };
    if (trace) n.log('protocol', `basic.publish routing key '${rk}' → exchange ${n.world.nodeName(e.to)}${confirms ? ' (waiting for confirm)' : ''}`);
    n.process(req.msg.weight, n.serviceTime('p50Ms', 'p99Ms', 0.5, 3), ok => {
      if (!ok) return req.reply({ ok: false, err: '503' });
      if (!confirms) req.reply({ ok: true });
      n.call(e, m, r => {
        if (r.data === 'NO_ROUTE') {
          returned += req.msg.weight;
          if (returned <= req.msg.weight) n.log('info', `basic.return: '${rk}' matched no queue (mandatory) → publisher sees the failure`);
        } else if (!r.ok) {
          nacked += req.msg.weight;
          if (!confirms) {
            n.anomaly('lost-write', req.msg.weight);
            if (nacked <= req.msg.weight) n.log('info', `${n.name}: publish failed (${r.err}) but without confirms the app never knows — message lost`);
          }
        }
        else if (trace) n.log('protocol', `basic.ack (publisher confirm) for '${rk}': every matched queue has it`);
        if (confirms) req.reply(r.ok ? { ok: true } : { ok: false, err: r.err ?? '5xx' });
      });
    });
  }

  return {
    onStart() {
      held = [];
      n.every(100, () => {
        if (alarmed(n).length) return;
        if (blockedLogged) {
          blockedLogged = false;
          n.log('info', `connection.unblocked: ${n.name} publishes again (${held.length} held)`);
        }
        const h = held;
        held = [];
        for (const x of h) publish(x.req);
      });
      n.every(1000, () => {
        n.gauge('blocked', alarmed(n).length ? 1 : 0);
        n.gauge('held', held.length);
        n.gauge('returned', returned);
        n.gauge('nacked', nacked);
      });
    },
    onRequest(req: Req) {
      const a = alarmed(n);
      if (a.length) {
        // connection.blocked: the socket stops being read; the app's publish call hangs
        if (!blockedLogged) {
          blockedLogged = true;
          n.log('info', `connection.blocked: memory alarm on ${a.map(b => b.name).join(', ')} → ${n.name} cannot publish`);
        }
        if (held.length < n.num('queueLimit', 5000)) held.push({ req, at: n.now });
        else req.reply({ ok: false, err: '503' });
        return;
      }
      publish(req);
    },
    onChaos(kind, _p, heal) {
      if (kind !== 'bad-deploy') return false;
      typo = !heal;
      if (!heal) n.log('info', `${n.name}: new release publishes with routing key 'orders.*' (typo) — no binding matches`);
      return true;
    },
    view() {
      const b: Badge[] = [{ text: n.bool('confirms', true) ? 'confirms' : 'fire & forget', tone: 'muted' }];
      if (alarmed(n).length) b.unshift({ text: 'blocked', tone: 'fail' });
      if (typo) b.unshift({ text: 'bad routing key', tone: 'fail' });
      return { badges: b };
    },
  };
});

// ---------------- exchange ----------------
register('rabbitmq-exchange', n => {
  let routed = 0;
  let unroutable = 0;
  const kind = () => n.str<'direct' | 'topic' | 'fanout'>('kind', 'topic');
  const matches = (q: SimNode, rk: string) => {
    if (kind() === 'fanout') return true;
    const keys = list(q.str('bindingKey', '#'));
    return keys.some(b => (kind() === 'direct' ? b === rk : topicMatch(b, rk)));
  };
  return {
    onStart() {
      n.every(1000, () => {
        n.gauge('routed', routed);
        n.gauge('unroutable', unroutable);
      });
    },
    onRequest(req: Req) {
      const m = req.msg;
      const d = m.data ?? {};
      const rk: string = d.rk ?? 'order.created';
      if (!brokers(n).some(b => b.up)) return req.reply({ ok: false, err: 'unavailable' });
      const qs = n.outEdges(e => n.world.nodes.get(e.to)?.type === 'rabbitmq-queue').filter(e => matches(n.world.nodes.get(e.to)!, rk));
      n.process(m.weight, n.serviceTime('p50Ms', 'p99Ms', 0.05, 0.3), ok => {
        if (!ok) return req.reply({ ok: false, err: '503' });
        if (!qs.length) {
          unroutable += m.weight;
          if (d.mandatory) return req.reply({ ok: false, err: '5xx', data: 'NO_ROUTE' });
          n.anomaly('lost-write', m.weight);
          if (unroutable <= m.weight || unroutable % 200 < m.weight) n.log('info', `Exchange ${n.name}: '${rk}' matches no binding → message silently dropped`);
          return req.reply({ ok: true }); // confirms still ack unroutable messages
        }
        routed += m.weight;
        if (d.trace) n.log('protocol', `Exchange ${n.name} routed '${rk}' → ${qs.map(e => n.world.nodeName(e.to)).join(', ')}`);
        let left = qs.length;
        let fail: string | undefined;
        for (const e of qs)
          n.call(e, { ...n.world.child(m, n.id, e.to), data: d }, r => {
            if (!r.ok) fail = r.err ?? '503';
            if (--left === 0) req.reply(fail ? { ok: false, err: fail as any } : { ok: true });
          });
      });
    },
    view() {
      return { badges: [{ text: kind(), tone: 'accent' }] as Badge[] };
    },
  };
});

// ---------------- queue ----------------
interface Unacked {
  e: Entry;
  consumer: string;
  epoch: number;
  at: number;
}

register('rabbitmq-queue', n => {
  let ready: Entry[] = [];
  const unacked = new Map<number, Unacked>();
  let tag = 0;
  let rr = 0;
  let leader = '';
  let members: string[] = [];
  let term = 1;
  let downSince = 0;
  const wasUp = new Map<string, boolean>();
  let lost = 0;
  let redelivered = 0;
  let dead = 0;
  let published = 0;
  let poisonShare = 0;
  let quorumLogged = false;
  const qtype = () => n.str<'quorum' | 'classic' | 'mirrored'>('queueType', 'quorum');
  const node = (id: string) => n.world.nodes.get(id);
  const upMembers = () => members.filter(m => node(m)?.up && (m === leader || !n.world.blocked(leader, m)));
  const hasQuorum = () => upMembers().length * 2 > members.length;
  const available = () => {
    if (!node(leader)?.up) return false;
    return qtype() !== 'quorum' || hasQuorum();
  };
  const msgKb = () => n.num('msgKb', 16);

  function place() {
    const bs = brokers(n).map(b => b.id).sort();
    if (!bs.length) return;
    const want = ref(n, n.str('leader', ''));
    const start = Math.max(0, bs.indexOf(want));
    const size = qtype() === 'classic' ? 1 : Math.min(bs.length, Math.max(1, Math.round(n.num('replicas', 3))));
    members = Array.from({ length: size }, (_, i) => bs[(start + i) % bs.length]);
    leader = members[0];
    for (const m of members) wasUp.set(m, true);
  }

  function consumers() {
    return n
      .outEdges(e => node(e.to)?.type === 'rabbitmq-consumer')
      .map(e => node(e.to)!)
      .filter(c => c.up);
  }

  function pump() {
    if (!available()) return;
    const cs = consumers();
    if (!cs.length) return;
    const inflight = new Map<string, number>();
    for (const u of unacked.values()) inflight.set(u.consumer, (inflight.get(u.consumer) ?? 0) + 1);
    while (ready.length) {
      let c: SimNode | undefined;
      for (let i = 0; i < cs.length; i++) {
        const x = cs[(rr + i) % cs.length];
        const pf = x.num('prefetch', 10);
        if (x.str('ackMode', 'manual') === 'auto' || pf <= 0 || (inflight.get(x.id) ?? 0) < pf) {
          c = x;
          rr = (rr + i + 1) % cs.length;
          break;
        }
      }
      if (!c) break;
      const e = ready.shift()!;
      e.deliveries++;
      const t = ++tag;
      const auto = c.str('ackMode', 'manual') === 'auto';
      if (!auto) {
        unacked.set(t, { e, consumer: c.id, epoch: c.epoch, at: n.now });
        inflight.set(c.id, (inflight.get(c.id) ?? 0) + 1);
      }
      if (e.trace) n.log('protocol', `Queue ${n.name} delivers to ${c.name} (${auto ? 'autoAck: forgotten on send' : `unacked ${inflight.get(c.id)}/${c.num('prefetch', 10) || '∞'} prefetch`})`);
      n.send(c.id, { kind: 'rmq.deliver', data: { tag: t, e, auto } });
    }
  }

  function enqueue(e: Entry) {
    e.have = upMembers();
    ready.push(e);
    published += e.w;
    if (qtype() !== 'classic') for (const m of e.have) if (m !== leader) n.send(m, { kind: 'rmq.append', data: { q: n.name, id: e.id } });
    pump();
  }

  function deadLetter(e: Entry, why: string) {
    const to = ref(n, n.str('deadLetter', ''));
    dead += e.w;
    if (dead <= e.w || dead % 50 < e.w) n.log('info', `Queue ${n.name}: message dead-lettered (${why})${to ? ` → ${n.world.nodeName(to)}` : ' and dropped (no DLX)'}`);
    if (to) n.rpc(to, { kind: 'rmq.dead', weight: e.w, data: { e: { ...e, deliveries: 0, trace: false } } }, 5000, () => {});
  }

  function requeue(e: Entry) {
    if (qtype() === 'quorum' && n.num('deliveryLimit', 0) > 0 && e.deliveries >= n.num('deliveryLimit', 0)) return deadLetter(e, `delivery-limit ${n.num('deliveryLimit', 0)} reached`);
    redelivered += e.w;
    ready.unshift(e);
  }

  function watchMembers() {
    // members rejoining
    for (const m of members) {
      const up = !!node(m)?.up;
      if (up && !wasUp.get(m) && m !== leader) {
        if (qtype() === 'quorum') {
          n.timer(500, () => {
            for (const e of ready) if (!e.have.includes(m)) e.have.push(m);
            n.log('protocol', `Quorum queue ${n.name}: ${n.world.nodeName(m)} rejoined; Raft log replicated to it (caught up, ${countW()} messages)`);
          });
        } else if (qtype() === 'mirrored') {
          for (const e of ready) e.have = e.have.filter(x => x !== m);
          n.log('info', `Mirrored queue ${n.name}: ${n.world.nodeName(m)} rejoined as an unsynchronised mirror (ha-sync-mode: manual) — has 0 of ${countW()} messages`);
        }
      }
      wasUp.set(m, up);
    }
    if (node(leader)?.up) {
      downSince = 0;
      if (qtype() === 'quorum' && !hasQuorum()) {
        if (!quorumLogged) n.log('info', `Quorum queue ${n.name}: leader can't reach a majority — publishes are nacked`);
        quorumLogged = true;
      } else quorumLogged = false;
      return;
    }
    // leader failover
    downSince ||= n.now;
    const ups = members.filter(m => node(m)?.up);
    if (qtype() === 'classic') return;
    if (qtype() === 'quorum') {
      if (!hasQuorumAmong(ups)) {
        if (!quorumLogged) n.log('info', `Quorum queue ${n.name}: only ${ups.length}/${members.length} members up — no majority, queue unavailable`);
        quorumLogged = true;
        return;
      }
      if (n.now - downSince < n.num('electionMs', 2000)) return;
      const old = leader;
      leader = ups[0];
      term++;
      downSince = 0;
      quorumLogged = false;
      n.log('protocol', `Quorum queue ${n.name}: leader ${n.world.nodeName(old)} lost → ${n.world.nodeName(leader)} elected (Raft term ${term}); all ${countW()} messages kept`);
    } else {
      if (!ups.length || n.now - downSince < 1000) return;
      const old = leader;
      leader = ups[0];
      downSince = 0;
      const gone = ready.filter(e => !e.have.includes(leader));
      ready = ready.filter(e => e.have.includes(leader));
      const w = gone.reduce((a, e) => a + e.w, 0);
      lost += w;
      n.log('protocol', `Mirrored queue ${n.name}: ${n.world.nodeName(old)} lost → mirror ${n.world.nodeName(leader)} promoted${w ? `, but it was unsynchronised: ${Math.round(w)} messages lost` : ''}`);
      if (w) n.anomaly('lost-write', w);
    }
    pump();
  }
  const hasQuorumAmong = (ups: string[]) => ups.length * 2 > members.length;
  const countW = () => Math.round(ready.reduce((a, e) => a + e.w, 0) + [...unacked.values()].reduce((a, u) => a + u.e.w, 0));

  function scan() {
    // channel closed (consumer died/restarted) or consumer_timeout → all its unacked requeued
    const closed = new Map<string, string>();
    for (const u of unacked.values()) {
      const c = node(u.consumer);
      if (!c || !c.up || c.epoch !== u.epoch) closed.set(u.consumer, 'connection lost');
      else if (n.now - u.at > n.num('consumerTimeoutMs', 30000)) closed.set(u.consumer, 'consumer_timeout: channel closed by the broker');
    }
    for (const [cid, why] of closed) {
      let back = 0;
      for (const [t, u] of [...unacked]) {
        if (u.consumer !== cid) continue;
        unacked.delete(t);
        back++;
        requeue(u.e);
      }
      n.log('protocol', `Queue ${n.name}: ${n.world.nodeName(cid)} ${why} → ${back} unacked message(s) requeued (redelivered=true)`);
    }
    watchMembers();
    pump();
  }

  return {
    handles: k => k.startsWith('rmq.'),
    onStart() {
      if (!members.length) place();
      n.every(250, scan);
      n.every(1000, () => {
        n.gauge('ready', Math.round(ready.reduce((a, e) => a + e.w, 0)));
        n.gauge('unacked', unacked.size);
        n.gauge('redelivered', Math.round(redelivered));
        n.gauge('deadLettered', Math.round(dead));
        n.gauge('lost', Math.round(lost));
        n.gauge('published', Math.round(published));
        n.gauge('available', available() ? 1 : 0);
        n.gauge('term', term);
      });
    },
    onRequest(req: Req) {
      const m = req.msg;
      const d = m.data ?? {};
      if (!available()) return req.reply({ ok: false, err: 'unavailable' });
      const quorum = qtype() === 'quorum';
      const ms = n.serviceTime('p50Ms', 'p99Ms', quorum ? 1.5 : 0.5, quorum ? 6 : 3);
      n.process(m.weight, ms, ok => {
        if (!ok) return req.reply({ ok: false, err: '503' });
        if (!available()) return req.reply({ ok: false, err: 'unavailable' });
        if (m.kind === 'rmq.dead') {
          enqueue({ ...(d.e as Entry), id: ++ledger(n.world).seq, born: n.now });
          return req.reply({ ok: true });
        }
        const e: Entry = { id: ++ledger(n.world).seq, rk: d.rk ?? '', w: m.weight, born: n.now, deliveries: 0, have: [], trace: d.trace, poison: poisonShare > 0 && n.rng.chance(poisonShare) };
        e.have = upMembers();
        if (d.trace)
          n.log(
            'protocol',
            quorum
              ? `Quorum queue ${n.name}: appended on leader ${n.world.nodeName(leader)}, replicated to ${e.have.length}/${members.length} members (majority) → confirm`
              : `Queue ${n.name} (${qtype()}): stored on ${n.world.nodeName(leader)}${qtype() === 'mirrored' ? ' + mirror' : ''} → confirm`,
          );
        enqueue(e);
        req.reply({ ok: true });
      });
    },
    onMessage(m: Msg) {
      const d = m.data;
      if (m.kind === 'rmq.ack') {
        const u = unacked.get(d.tag);
        if (u?.e.trace) n.log('protocol', `Queue ${n.name}: basic.ack from ${n.world.nodeName(m.from)} → message removed`);
        unacked.delete(d.tag);
        pump();
      } else if (m.kind === 'rmq.nack') {
        const u = unacked.get(d.tag);
        if (!u) return;
        unacked.delete(d.tag);
        if (d.requeue) requeue(u.e);
        else deadLetter(u.e, 'rejected, requeue=false');
        pump();
      }
    },
    onChaos(kind, p, heal) {
      if (kind !== 'poison-message') return false;
      poisonShare = heal ? 0 : Number(p.pct ?? 0.02);
      if (!heal) n.log('info', `${n.name}: ${Math.round(poisonShare * 100)}% of new messages are poison (the consumer throws on them)`);
      return true;
    },
    view() {
      const b: Badge[] = [{ text: qtype() === 'quorum' ? `quorum · 👑 ${n.world.nodeName(leader)}` : qtype() === 'mirrored' ? `mirrored · ${n.world.nodeName(leader)}` : `classic · ${n.world.nodeName(leader)}`, tone: 'muted' }];
      if (!available()) b.unshift({ text: 'unavailable', tone: 'fail' });
      const r = ready.length;
      if (r) b.push({ text: `${Math.round(ready.reduce((a, e) => a + e.w, 0))} ready`, tone: r > 500 ? 'warn' : 'muted' });
      return { badges: b };
    },
    ...({
      /** KB held on a broker node (leader + replicas each keep a copy) */
      kbOn: (id: string) => ready.reduce((a, e) => a + (e.have.includes(id) ? e.w : 0), 0) * msgKb() + [...unacked.values()].reduce((a, u) => a + (u.e.have.includes(id) ? u.e.w : 0), 0) * msgKb(),
      leaderId: () => leader,
    } as object),
  };
});

// ---------------- broker node ----------------
register('rabbitmq-node', n => {
  let alarm = false;
  return {
    onStart() {
      alarm = false;
      n.every(500, () => {
        const qs = [...n.world.nodes.values()].filter(x => x.type === 'rabbitmq-queue' && cluster(x) === cluster(n));
        const kb = qs.reduce((a, q) => a + ((q.logic as any).kbOn?.(n.id) ?? 0), 0);
        n.memMb = n.num('baseMemMb', 80) + kb / 1024;
        const hw = n.num('memoryHighWatermarkMb', 400);
        if (!alarm && n.memMb > hw) {
          alarm = true;
          n.log('alert', `Memory alarm on ${n.name}: ${Math.round(n.memMb)} MB > high watermark ${hw} MB → all publishers blocked`);
        } else if (alarm && n.memMb < hw) {
          alarm = false;
          n.log('info', `Memory alarm cleared on ${n.name} (${Math.round(n.memMb)} MB)`);
        }
        n.gauge('memMb', Math.round(n.memMb));
        n.gauge('alarm', alarm ? 1 : 0);
        n.gauge('leaders', qs.filter(q => (q.logic as any).leaderId?.() === n.id).length);
      });
    },
    onKill() {
      alarm = false;
      n.gauge('alarm', 0);
    },
    onMessage() {},
    view() {
      const leads = n.gaugesNow.leaders ?? 0;
      return { badges: [...(alarm ? [{ text: 'MEM ALARM', tone: 'fail' as const }] : []), { text: `${leads} leader${leads === 1 ? '' : 's'}`, tone: 'muted' as const }] };
    },
  };
});

// ---------------- consumer ----------------
register('rabbitmq-consumer', n => {
  let forget = false;
  let inHand = 0;
  let done = 0;
  let failed = 0;
  const handle = (m: Msg) => {
    const { tag, e, auto } = m.data as { tag: number; e: Entry; auto: boolean };
    const queue = m.from;
    inHand += e.w;
    n.process(1, n.serviceTime('p50Ms', 'p99Ms', 10, 40), ok => {
      inHand -= e.w;
      if (!ok) return auto ? undefined : n.send(queue, { kind: 'rmq.nack', data: { tag, requeue: true } });
      if (e.poison) {
        failed++;
        if (failed <= 2) n.log('info', `${n.name}: handler threw on a poison message (delivery #${e.deliveries}) → basic.nack requeue=${n.bool('requeueOnError', true)}`);
        if (!auto) n.send(queue, { kind: 'rmq.nack', data: { tag, requeue: n.bool('requeueOnError', true) } });
        return;
      }
      const l = ledger(n.world);
      const runs = (l.processed.get(e.id) ?? 0) + 1;
      l.processed.set(e.id, runs);
      if (runs > 1) n.anomaly('duplicate', e.w);
      done += e.w;
      n.series.cur.okW += e.w;
      if (e.trace) n.log('protocol', `${n.name} processed the message${auto ? ' (autoAck: broker already forgot it)' : forget ? ' but never acks it' : ' → basic.ack'}`);
      if (!auto && !forget) n.send(queue, { kind: 'rmq.ack', data: { tag } });
    });
  };
  return {
    handles: k => k.startsWith('rmq.'),
    onStart() {
      inHand = 0;
      n.every(1000, () => {
        n.gauge('processed', Math.round(done));
        n.gauge('failed', failed);
      });
    },
    onMessage(m: Msg) {
      if (m.kind === 'rmq.deliver') handle(m);
    },
    onKill() {
      if (n.str('ackMode', 'manual') === 'auto' && inHand > 0) {
        n.anomaly('lost-write', inHand);
        n.log('info', `${n.name} crashed with ${Math.round(inHand)} autoAck'd message(s) in memory — gone for good`);
      }
      inHand = 0;
    },
    onChaos(kind, _p, heal) {
      if (kind !== 'bad-deploy') return false;
      forget = !heal;
      if (!heal) n.log('info', `${n.name}: new release processes messages but never calls basic.ack`);
      return true;
    },
    view() {
      const auto = n.str('ackMode', 'manual') === 'auto';
      return { badges: [{ text: auto ? 'autoAck' : `prefetch ${n.num('prefetch', 10) || '∞'}`, tone: auto ? 'warn' : 'muted' }, ...(forget ? [{ text: 'no ack!', tone: 'fail' as const }] : [])] as Badge[] };
    },
  };
});

export {};
