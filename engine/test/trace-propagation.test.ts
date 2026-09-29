// One traced request (Run.sendOne) must tag every component-to-component message it causes,
// including async follow-ups after the client got its reply; background traffic must not be tagged.
import * as fs from 'fs';
import * as path from 'path';
import { createRun } from '../src';
import type { Catalog, SystemDoc } from '../src/types';

const dist = path.join(__dirname, '../../content/dist');
const catalog: Catalog = JSON.parse(fs.readFileSync(path.join(dist, 'catalog.json'), 'utf8'));
const templates: Record<string, SystemDoc> = JSON.parse(fs.readFileSync(path.join(dist, 'templates.json'), 'utf8'));

const quiet = (d: SystemDoc): SystemDoc => ({ ...d, scenario: { ...(d.scenario ?? { events: [] }), sources: [], events: [] } });

/** Warm up, fire one request, run on; returns the trace's hops as "from>to kind". */
function follow(name: string, o: { client?: string; op?: 'read' | 'write'; warm?: number; ms?: number; traffic?: boolean } = {}) {
  const doc = o.traffic ? templates[name] : quiet(templates[name]);
  const r = createRun(doc, { catalog, seed: 1 });
  r.step(o.warm ?? 3000, 1e9);
  const client = o.client ?? doc.nodes.find(n => catalog.types.find(t => t.type === n.type)?.client)!.id;
  const id = r.sendOne(client, o.op ?? 'write')!;
  r.step(r.now + (o.ms ?? 5000), 1e9);
  const tr = r.trace(id)!;
  const flights = r.world.traceFlights.get(id) ?? [];
  const hops = flights.map(f => `${f.from}>${f.to} ${f.msg?.kind ?? ''}`);
  return { r, tr, flights, hops, has: (s: string) => hops.some(h => h.includes(s)) };
}

const BACKGROUND = /Heartbeat|BrokerHeartbeat|JoinGroup|Vote|gossip|PING|REPLCONF.*idle|follower-check/;

test('Kafka: produce → leader → followers fetch it → ack → consumer fetch → offset commit', () => {
  const { tr, flights, has } = follow('tech-kafka-anatomy', { ms: 3000 });
  expect(tr.ok).toBe(true);
  expect(has('prod>b')).toBe(true);
  expect(has('kafka.Produce')).toBe(true);
  expect(has('kafka.Produce.reply')).toBe(true);
  // the leader answers each follower's parked long-poll with the traced record, then the followers confirm
  const leader = flights.find(f => f.msg?.kind === 'kafka.Produce')!.to;
  const replicaReplies = flights.filter(f => f.msg?.kind === 'kafka.Fetch.reply' && f.from === leader && /^b\d/.test(f.to));
  expect(replicaReplies.length).toBe(2);
  const confirms = flights.filter(f => f.msg?.kind === 'kafka.Fetch' && f.to === leader && /^b\d/.test(f.from));
  expect(confirms.length).toBe(2);
  // acks=all: the produce reply comes after the followers confirmed
  const ack = flights.find(f => f.msg?.kind === 'kafka.Produce.reply')!;
  expect(ack.t0).toBeGreaterThanOrEqual(Math.min(...confirms.map(f => f.t0)));
  // async tail after the client already has its reply
  // consumers only see it once the high watermark passed it: after the followers confirmed
  const consumerFetch = flights.find(f => f.msg?.kind === 'kafka.Fetch' && /^c\d/.test(f.from));
  expect(consumerFetch).toBeDefined();
  expect(consumerFetch!.t0).toBeGreaterThanOrEqual(Math.min(...confirms.map(f => f.t0)));
  const commit = flights.find(f => f.msg?.kind === 'kafka.OffsetCommit');
  expect(commit).toBeDefined();
  expect(commit!.t0).toBeGreaterThan(consumerFetch!.t0);
  expect(flights.every(f => !BACKGROUND.test(f.msg?.kind ?? ''))).toBe(true);
});

test('Kafka under background traffic: only the followed record is tagged', () => {
  const { flights } = follow('tech-kafka-anatomy', { traffic: true, ms: 2000 });
  expect(flights.filter(f => f.msg?.kind === 'kafka.Produce').length).toBe(1);
  expect(flights.every(f => !BACKGROUND.test(f.msg?.kind ?? ''))).toBe(true);
});

test('2PC: prepare, votes and commit to every participant', () => {
  const { hops } = follow('txn-2pc');
  for (const p of ['orders', 'payments', 'stock']) {
    for (const k of ['txn.prepare', 'txn.commit']) {
      expect(hops).toContain(`tm>${p} ${k}`);
      expect(hops).toContain(`${p}>tm ${k}.reply`);
    }
  }
});

test('Orchestrated saga: a step to each service in order', () => {
  const { flights } = follow('txn-saga');
  const steps = flights.filter(f => f.msg?.kind === 'saga.step').map(f => f.to);
  expect(steps).toEqual(['order', 'payment', 'inventory']);
  expect(flights.filter(f => f.msg?.kind === 'saga.step.reply').length).toBe(3);
});

test('Choreographed saga and events: every hop through the buses', () => {
  const { hops } = follow('lesson-txn-saga-choreo');
  for (const h of ['web>order', 'order>bus-a', 'bus-a>payment', 'payment>bus-b', 'bus-b>inventory']) expect(hops.some(x => x.startsWith(h))).toBe(true);
});

test('Celery: publish → deliver → ack → result, the result long after the client got its reply', () => {
  const { hops, flights, tr } = follow('tech-celery-anatomy', { ms: 8000 });
  for (const k of ['celery.publish', 'celery.deliver', 'celery.ack', 'celery.store-result']) expect(hops.some(h => h.endsWith(k))).toBe(true);
  expect(flights.find(f => f.msg?.kind === 'celery.store-result')!.t0).toBeGreaterThan(tr.end! + 500);
});

test('RabbitMQ: exchange → queues → deliver → ack, mirrored appends', () => {
  const { hops } = follow('tech-rabbitmq-anatomy');
  for (const k of ['rmq.deliver', 'rmq.ack', 'rmq.append']) expect(hops.some(h => h.endsWith(k))).toBe(true);
});

test('Cassandra: coordinator writes to every replica', () => {
  const { flights } = follow('tech-cassandra-anatomy');
  const muts = flights.filter(f => f.msg?.kind === 'cassandra.mutation');
  expect(new Set(muts.map(f => f.to)).size).toBeGreaterThanOrEqual(3);
  expect(flights.filter(f => f.msg?.kind === 'cassandra.mutation.reply').length).toBe(muts.length);
});

test('Raft: leader replicates the entry to every follower', () => {
  const { flights } = follow('lesson-consensus-raft', { warm: 5000, ms: 2000 });
  const ae = flights.filter(f => f.msg?.kind === 'raft.AppendEntries');
  expect(ae.length).toBe(4);
  expect(flights.filter(f => f.msg?.kind === 'raft.AppendEntriesReply').length).toBe(4);
});

test('Temporal: task queue → worker → history, all on the request', () => {
  // read = StartWorkflowExecution (a signal needs a workflow already running)
  const { hops } = follow('tech-temporal-anatomy', { op: 'read', ms: 8000 });
  for (const k of ['temporal.persist', 'temporal.AddWorkflowTask', 'temporal.RecordTaskStarted', 'temporal.PollWorkflowTaskQueue.reply', 'temporal.RespondWorkflowTaskCompleted'])
    expect(hops.some(h => h.endsWith(k))).toBe(true);
});

test('Postgres / Redis: the replication stream that carries the write is tagged', () => {
  expect(follow('tech-pg-replica', { warm: 5000, ms: 2000 }).hops).toEqual(expect.arrayContaining(['pg>standby pg.wal', 'standby>pg pg.ack']));
  expect(follow('tech-redis-anatomy', { warm: 5000, ms: 2000 }).hops).toContain('redis>replica redis.REPLCONF');
});

test('Plain microservices: every call and its reply', () => {
  const { hops } = follow('paradigm-ddd');
  for (const h of ['web>gw', 'gw>ord', 'ord>odb', 'odb>ord', 'ord>bus', 'bus>bill', 'bus>ship', 'ship>acl', 'acl>carrier']) expect(hops.some(x => x.startsWith(h))).toBe(true);
});

test('spans name their caller', () => {
  const { tr } = follow('paradigm-ddd');
  expect(tr.spans.find(s => s.node === 'odb')?.from).toBe('ord');
});

test('tracing adds no randomness: same seed, same run', () => {
  const once = () => {
    const r = createRun(templates['tech-kafka-anatomy'], { catalog, seed: 7 });
    r.step(4000, 1e9);
    const s = r.snapshot();
    return [r.world.kernel.processed, r.events().length, s.system.rps, s.nodes.c1?.gauges.processed];
  };
  expect(once()).toEqual(once());
});
