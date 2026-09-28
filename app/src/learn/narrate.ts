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

export function story(doc: SystemDoc, hops: JourneyHop[], i: number, snap: Snapshot | null, total?: number, ok?: boolean): Story {
  const h = hops[i];
  const name = nameIn(doc);
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
      ? h.calls
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
