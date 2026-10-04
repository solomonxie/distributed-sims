import type { Snapshot, SystemDoc } from '@dsims/engine';
import { catalog, chaos as chaosDefs } from '@dsims/content';
import type { JourneyHop } from '../state/run';
import { wireOf, type Wire } from '../sheets/wire';
import { fmtMs } from '../canvas/SystemCanvas';

export type Phase = 'request' | 'waiting' | 'response' | 'failed' | 'done';

/** Plain-English story for one beat of the followed request. */
export interface Story {
  phase: Phase;
  /** component the beat is about (where the tip points) */
  at: string;
  title: string;
  body: string;
  /** first line on the wire, e.g. `GET /pFqEwDz HTTP/2` */
  wire?: string;
  chips: { text: string; tone: 'warn' | 'fail' | 'ok' | 'muted' }[];
}

const nameIn = (doc: SystemDoc) => (id: string) => doc.nodes.find(n => n.id === id)?.name ?? id;
const typeOf = (doc: SystemDoc, id: string) => doc.nodes.find(n => n.id === id)?.type ?? '';
const kindOf = (t: string) => (/cache|redis/.test(t) ? 'cache' : /cdn/.test(t) ? 'cdn' : /relational|pg-|document-db|kv-store|dynamodb|cassandra/.test(t) ? 'db' : /load-balancer|nginx/.test(t) ? 'lb' : /api-gateway/.test(t) ? 'gateway' : /id-generator/.test(t) ? 'idgen' : /queue|log-stream|pub-sub|kafka|rabbitmq/.test(t) ? 'queue' : 'other');

const VERB: Record<string, string> = { cache: 'Checking', cdn: 'Reaching', db: 'Querying', lb: 'Through', gateway: 'Through', idgen: 'Getting an ID from', queue: 'Publishing to', other: 'Calling' };

function wireFor(doc: SystemDoc, h: JourneyHop): Wire {
  const from = h.reply ? h.to : h.from;
  const to = h.reply ? h.from : h.to;
  return wireOf({ doc, from, to, msg: h.msg, res: h.res, ok: h.res?.ok ?? h.ok, err: h.res?.err ?? h.err, spanMs: h.spanMs, calls: h.calls, traceId: h.traceId });
}

function chipsFor(snap: Snapshot | null, id: string): Story['chips'] {
  const n = snap?.nodes[id];
  if (!n) return [];
  const out: Story['chips'] = [];
  if (!n.up) out.push({ text: 'down', tone: 'fail' });
  for (const k of n.chaos) out.push({ text: `⚡ ${chaosDefs.find(d => d.kind === k)?.label ?? k}`, tone: 'warn' });
  if (n.up && n.util >= 0.85) out.push({ text: `${Math.round(n.util * 100)}% busy`, tone: 'warn' });
  if (n.up && n.queue >= 1) out.push({ text: `${Math.round(n.queue)} waiting`, tone: 'warn' });
  return out;
}

/** background load right now vs what the design normally gets */
export function loadChip(snap: Snapshot | null, baseRps: number): Story['chips'] {
  const r = snap && baseRps > 0 ? snap.system.rps / baseRps : 0;
  return r >= 1.6 ? [{ text: `traffic ×${r < 10 ? r.toFixed(1) : Math.round(r)}`, tone: 'warn' }] : [];
}

const TCP_TEXT: Record<NonNullable<JourneyHop['tcp']>, string> = {
  SYN: 'Opens a TCP connection: “I want to talk, my first sequence number is x.”',
  'SYN-ACK': 'The server agrees: “Got x, here is my sequence number y.”',
  ACK: 'Both sides now know each other’s sequence numbers. The request can go; later calls reuse this connection.',
};

/** `txn.prepare` → PREPARE, `txn.prepare.reply` → YES / NO */
export function protoLabel(kind: string, ok = true): string {
  const base = kind.replace(/\.reply$/, '').replace(/^[a-z]+\./, '').toUpperCase();
  if (!kind.endsWith('.reply')) return base;
  return base === 'PREPARE' || base === 'PRECOMMIT' ? (ok ? 'Vote YES' : 'Vote NO') : ok ? `${base} ack` : `${base} failed`;
}

/** What a request/reply of a known protocol kind means, request side first. */
const PROTO_TEXT: Record<string, [req: string, reply: string]> = {
  'txn.precommit': ['3PC phase 2: everyone voted YES; {to} is told a commit is coming, so it can finish alone if the coordinator dies.', '{from} is ready to commit.'],
  'saga.step': ['The saga orchestrator asks {to} to run its local transaction and commit it right away.', '{from} committed its step. If a later step fails, this one gets compensated.'],
  'saga.compensate': ['A later step failed, so {to} runs the undo action for the step it already committed.', '{from} undid its step.'],
  'kafka.Produce': ['The producer sends a batch of records to the partition leader {to}.', 'The leader acks: the records are in its log (and in the ISR, with acks=all).'],
  'kafka.Fetch': ['{from} fetches from leader {to}: a follower copying the log, or a consumer reading records below the high watermark.', '{from} returns the records (and the high watermark).'],
  'kafka.OffsetCommit': ['The consumer tells the group coordinator {to} how far it has processed.', 'Offset stored: after a restart the group resumes from here.'],
  'kafka.AlterPartition': ['{from} asks the controller to change the in-sync replica set.', 'The controller accepted the new ISR.'],
  'celery.publish': ['The task is published to the broker {to}.', 'The broker stored the task in the queue.'],
  'celery.deliver': ['The broker hands the task to worker {to}.', 'Delivered.'],
  'celery.ack': ['Worker {from} acks the task, so the broker deletes it.', 'Acked.'],
  'celery.store-result': ['Worker {from} stores the task result in the backend {to}.', 'Result stored.'],
  'cassandra.mutation': ['The coordinator sends the write to replica {to}.', 'Replica {from} wrote it to its commit log and memtable.'],
  'cassandra.read': ['The coordinator asks replica {to} for the row.', 'Replica {from} returns its version; the newest timestamp wins.'],
  'es.replicate': ['The primary shard forwards the write to replica {to}.', 'Replica {from} indexed it.'],
  'raft.Forward': ['{from} is not the leader, so it forwards the request to {to}.', 'The leader handled it.'],
  'raft.AppendEntries': ['The leader {from} replicates a log entry to follower {to}.', 'Follower {from} appended the entry.'],
  'lock.acquire': ['{from} asks {to} for the lock.', 'Granted, with a fencing token.'],
  'lock.release': ['{from} releases the lock.', 'Released.'],
  'fenced.write': ['{from} writes, attaching its fencing token so stale lock holders are rejected.', 'The store checked the token and accepted the write.'],
  'dynamo.gsi-put': ['The table asynchronously updates the global secondary index {to}.', 'Index updated.'],
  req: ['{from} passes the request on to {to}.', '{from} answers.'],
};

function protoText(base: string, h: JourneyHop, name: (id: string) => string): string | undefined {
  const t = PROTO_TEXT[base];
  if (!t) return undefined;
  return (h.reply ? t[1] : t[0]).replace(/\{from\}/g, name(h.from)).replace(/\{to\}/g, name(h.to));
}

function protoStory(h: JourneyHop, name: (id: string) => string): Story {
  const base = (h.proto ?? '').replace(/\.reply$/, '');
  const label = protoLabel(h.proto ?? '', h.ok);
  const body =
    base === 'txn.prepare'
      ? h.reply
        ? h.ok
          ? `${name(h.from)} has locked the rows and written the change to its log. It promises it can commit.`
          : `${name(h.from)} can’t do it (conflict or failure). One NO aborts the whole transaction.`
        : `Phase 1: ${name(h.from)} asks ${name(h.to)} to get ready and hold its locks, without committing yet.`
      : base === 'txn.commit'
        ? h.reply
          ? `${name(h.from)} committed and released its locks.`
          : `Phase 2: every participant voted YES, so the decision is COMMIT. ${name(h.to)} must obey.`
        : base === 'txn.abort'
          ? h.reply
            ? `${name(h.from)} rolled back and released its locks.`
            : `Phase 2: someone voted NO or timed out, so everyone rolls back.`
          : protoText(base, h, name) ?? `A protocol message between ${name(h.from)} and ${name(h.to)} while handling the request.`;
  const after = h.async ? 'After the reply: ' : '';
  return { phase: h.reply ? (h.ok ? 'response' : 'failed') : 'request', at: h.to, title: `${after}${label}: ${name(h.from)} → ${name(h.to)}`, body: h.async ? `${body} The user already has their answer; this happens in the background because of their request.` : body, wire: h.proto, chips: [] };
}

/** CPU/cache/RAM hops: loads carry `data.hw` (instruction, line, per-hop note); times are cycles. */
const HW_TYPES = /^(cpu-core|cpu-cache|dram)$/;
const hwData = (x: any) => (x?.hw ? (x as { c: string; asm: string; line: number; note: string; title?: string }) : undefined);
const cycles = (ms: number) => `${Math.max(1, Math.round(ms)).toLocaleString()} cycles`;

function hwStep(doc: SystemDoc, h: JourneyHop): { title: string; body: string; wire?: string } | undefined {
  const name = nameIn(doc);
  if (h.wait && HW_TYPES.test(typeOf(doc, h.to))) {
    const ram = typeOf(doc, h.to) === 'dram';
    return { title: `Inside ${name(h.to)}: ${cycles(h.spanMs)}`, body: ram ? 'DRAM opens the row holding the line, then streams it out. The core is stalled the whole time.' : 'Checking its tags for the line, or waiting for a line already on its way.' };
  }
  const d = h.reply ? hwData(h.res?.data) : hwData(h.msg?.data);
  if (!d) return undefined;
  return { title: d.title ?? `line ${d.line}`, body: d.note, wire: h.reply ? `64 B · line ${d.line}` : `${d.asm}` };
}

/** Short label for one step in the timeline list. */
export function stepLabel(doc: SystemDoc, h: JourneyHop): string {
  const name = nameIn(doc);
  if (h.done) return h.ok ? 'Answer reaches the user' : 'User sees an error';
  const hw = hwStep(doc, h);
  if (hw) return hw.title;
  if (h.tcp) return `TCP ${h.tcp} · ${name(h.from)} → ${name(h.to)}`;
  if (h.proto) return `${h.async ? '↳ ' : ''}${protoLabel(h.proto, h.ok)} · ${name(h.from)} → ${name(h.to)}`;
  if (h.wait && h.peer) return `${name(h.to)} waits for ${name(h.peer)}`;
  if (h.wait) return `Inside ${name(h.to)} · ${fmtMs(h.spanMs)}`;
  const w = wireFor(doc, h);
  return h.reply ? `${w.status} · ${name(h.from)} → ${name(h.to)}` : `${w.req[0] ?? 'Request'} · ${name(h.from)} → ${name(h.to)}`;
}

export function story(doc: SystemDoc, hops: JourneyHop[], i: number, snap: Snapshot | null, total?: number, ok?: boolean): Story {
  const h = hops[i];
  const name = nameIn(doc);
  if (h.tcp) return { phase: 'request', at: h.to, title: `TCP ${h.tcp}: ${name(h.from)} → ${name(h.to)}`, body: TCP_TEXT[h.tcp], wire: h.tcp === 'SYN' ? 'SYN seq=x' : h.tcp === 'SYN-ACK' ? 'SYN, ACK seq=y ack=x+1' : 'ACK seq=x+1 ack=y+1', chips: [] };
  if (h.proto) return protoStory(h, name);
  const first = hwData(hops[0]?.msg?.data);
  if (h.done && first) return { phase: 'done', at: h.from, title: `Load done: ${cycles(total ?? 0)}`, body: (total ?? 0) <= 10 ? `a[] came from L1. ${first.c}` : `The core waited ${cycles(total ?? 0)} for one value. A loop that misses like this runs mostly idle.`, wire: first.asm, chips: [] };
  const hw = hwStep(doc, h);
  if (hw) return { phase: h.wait ? 'waiting' : h.reply ? 'response' : 'request', at: h.wait ? h.to : h.to, title: hw.title, body: hw.body, wire: hw.wire, chips: chipsFor(snap, h.reply ? h.from : h.to) };
  if (h.done) {
    const first = hops.find(x => x.reply && x.to === h.from && !x.wait);
    const w = first ? wireFor(doc, first) : undefined;
    const waits = hops.filter(x => x.wait).sort((a, b) => b.spanMs - a.spanMs);
    const slow = waits[0] && total && waits[0].spanMs > total * 0.4 ? ` Most of it (${fmtMs(waits[0].spanMs)}) was spent inside ${name(waits[0].to)}.` : '';
    const failAt = [...hops].reverse().find(x => x.reply && !x.ok && !x.done);
    return {
      phase: 'done',
      at: h.from,
      title: ok ? `Done: ${w?.status ?? 'OK'} in ${fmtMs(total ?? 0)}` : `Failed: ${w?.status ?? 'error'} after ${fmtMs(total ?? 0)}`,
      body: ok ? `The user got an answer.${slow}` : `The user saw an error.${failAt ? ` It started at ${name(failAt.from)}.` : ''}`,
      wire: w?.res[0],
      chips: [],
    };
  }
  if (h.wait && h.peer) {
    const edge = doc.edges.find(e => e.from === h.to && e.to === h.peer);
    const limit = (edge?.config as any)?.timeoutMs ?? 3000;
    return { phase: 'waiting', at: h.to, title: `Waiting for ${name(h.peer)}…`, body: `No reply. ${name(h.to)} holds the request until its ${fmtMs(limit)} timeout, then gives up.`, chips: chipsFor(snap, h.peer) };
  }
  if (h.wait) {
    const chips = chipsFor(snap, h.to);
    const n = snap?.nodes[h.to];
    const busy = n && n.util >= 0.85;
    const reason = n?.chaos.length ? 'A fault is active here, so it is slower than usual.' : busy ? 'It is nearly full, so requests wait in line before they are handled.' : h.spanMs > 50 ? 'Slower than a typical step: work plus some waiting in line.' : 'Doing its work.';
    return { phase: 'waiting', at: h.to, title: `Inside ${name(h.to)}: ${fmtMs(h.spanMs)}`, body: reason, chips };
  }
  const w = wireFor(doc, h);
  if (!h.reply) {
    const t = typeOf(doc, h.to);
    const desc = catalog.types.find(x => x.type === t)?.description ?? '';
    if (kindOf(t) === 'cache' && h.msg?.op === 'write') {
      const del = !!h.msg.data?.del;
      return { phase: 'request', at: h.to, title: `${del ? 'Clearing' : 'Storing in'} ${name(h.to)}`, body: del ? 'The database changed, so the cached copy is dropped. The next read misses and refills it.' : 'Keeping a copy of what the database returned, so the next read is a hit.', wire: w.req[0], chips: chipsFor(snap, h.to) };
    }
    return { phase: 'request', at: h.to, title: `${VERB[kindOf(t)]} ${name(h.to)}`, body: desc ? `${desc}.`.replace(/\.\.$/, '.') : '', wire: w.req[0], chips: chipsFor(snap, h.to) };
  }
  const t = typeOf(doc, h.from);
  const k = kindOf(t);
  if (!w.ok) {
    const edge = doc.edges.find(e => e.from === h.to && e.to === h.from);
    const limit = (edge?.config as any)?.timeoutMs ?? 3000;
    const why = h.ghost
      ? `${name(h.from)} never answered (down or unreachable), so ${name(h.to)} gave up after ${fmtMs(limit)}.`
      : w.status === 'timeout' || h.err === 'timeout'
        ? `It took longer than the ${fmtMs(limit)} limit, so ${name(h.to)} stopped waiting.`
        : h.err === '503'
          ? `${name(h.from)} is too busy and turned the request away instead of queueing it.`
          : h.err === '429'
            ? 'Rate limited: too many requests from this client right now.'
            : h.err === 'refused' || h.err === 'unavailable'
              ? `Nothing accepted the connection: ${name(h.from)} is down.`
              : h.err === 'auth'
                ? 'Not allowed: the login token is missing or expired.'
                : `Something failed inside ${name(h.from)} or behind it.`;
    return { phase: 'failed', at: h.to, title: h.ghost ? `No answer from ${name(h.from)}` : `${w.status} from ${name(h.from)}`, body: why, wire: w.res[0], chips: chipsFor(snap, h.from) };
  }
  const detail =
    k === 'cache'
      ? h.msg?.op === 'write'
        ? h.msg.data?.del
          ? 'Dropped the cached copy.'
          : 'Stored. The next read for this key is a hit.'
        : h.res?.miss
          ? 'Cache miss: not in memory. Next, the service asks the database itself.'
          : h.calls
            ? 'Cache miss: it asked the database first, then kept a copy for next time.'
            : 'Cache hit: answered from memory, no database trip.'
      : k === 'cdn'
        ? h.calls
          ? 'Not cached at the edge, so it went all the way to the servers.'
          : 'Served from the edge, close to the user: the servers never saw it.'
        : k === 'db'
          ? `${h.msg?.op === 'write' ? 'Saved' : 'Found'} in ${fmtMs(h.spanMs)}.${h.res?.stale ? ' From a replica that is behind: an older copy.' : ''}`
          : k === 'idgen'
            ? 'A unique ID, made without asking the database.'
            : `Answered in ${fmtMs(h.spanMs)}${h.calls ? ', including the calls it made' : ''}.`;
  return { phase: 'response', at: h.to, title: `${w.status} from ${name(h.from)}`, body: detail, wire: w.res.find(l => l && !l.startsWith('#')), chips: [] };
}
