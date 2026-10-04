// CPU core, caches and RAM as live components. 1 ms of sim time = 1 CPU cycle; a message key is a 64 B line number.
// Every load carries `data.hw` (C line, asm, address, a per-hop note) so the app can narrate the dot.
import { register } from './registry';
import type { NodeLogic, Req, SimNode } from '../node';
import type { Reply } from '../types';

const LINE = 64;
const ELEM = 8;

export interface HwData {
  hw: true;
  c: string;
  asm: string;
  addr: string;
  line: number;
  note: string;
  title?: string;
}

const hex = (n: number) => '0x' + n.toString(16).padStart(6, '0');
const hwOf = (x: unknown) => (x && typeof x === 'object' && (x as HwData).hw ? (x as HwData) : undefined);

function cpuCore(n: SimNode): NodeLogic {
  let i = 0;
  let override: { pattern: string; stride?: number } | undefined;
  const base = 0x7f1000;
  return {
    onRequest(req: Req) {
      const pattern = override?.pattern ?? n.str('pattern', 'sequential');
      const stride = Math.max(1, Math.round(override?.stride ?? n.num('stride', 8)));
      const elems = Math.max(LINE / ELEM, Math.round((n.num('workingSetKB', 64) * 1024) / ELEM));
      const idx = pattern === 'random' ? n.rng.int(elems) : ((pattern === 'stride' ? i * stride : i) % elems);
      i++;
      const addr = base + idx * ELEM;
      const line = Math.floor(addr / LINE);
      const step = pattern === 'random' ? 'i = rand() % n;' : pattern === 'stride' ? `i += ${stride};` : 'i++;';
      const data: HwData = {
        hw: true,
        c: `sum += a[${idx}];  // ${step}`,
        asm: `add rax, [rsi + rcx*8]  ; rcx = ${idx}`,
        addr: hex(addr),
        line,
        note: `Load a[${idx}] at ${hex(addr)}. That byte lives in 64 B line ${line}, so L1 is asked for the whole line.`,
        title: `Load a[${idx}] → line ${line}`,
      };
      const e = n.syncOut('read')[0] ?? n.outEdges()[0];
      if (!e) return req.reply({ ok: true });
      n.call(e, { ...n.world.child(req.msg, n.id, e.to), op: 'read', key: line, data }, r => req.reply(r));
    },
    onChaos(kind, p, heal) {
      if (kind === 'access-random') override = heal ? undefined : { pattern: 'random' };
      else if (kind === 'access-stride') override = heal ? undefined : { pattern: 'stride', stride: Number(p.stride ?? 8) };
      else return false;
      i = 0;
      return true;
    },
    view() {
      const pattern = override?.pattern ?? n.str('pattern', 'sequential');
      return { badges: [{ text: pattern, tone: pattern === 'sequential' ? 'ok' : 'warn' }] };
    },
  };
}

function cpuCache(n: SimNode): NodeLogic {
  let lines = new Map<number, true>();
  /** fill buffer (MSHR): loads waiting for a line already on its way up */
  const pending = new Map<number, Req[]>();
  let hits = 0;
  let misses = 0;
  let ratio = 0;
  const cap = () => Math.max(1, Math.round(n.num('capacityLines', 64)));
  const lat = () => Math.max(1, n.num('latencyCycles', 4));

  function fill(line: number): number | undefined {
    let evicted: number | undefined;
    if (!lines.has(line) && lines.size >= cap()) {
      evicted = lines.keys().next().value;
      if (evicted !== undefined) lines.delete(evicted);
    }
    lines.delete(line);
    lines.set(line, true);
    return evicted;
  }

  return {
    onStart() {
      n.every(1000, () => {
        const t = hits + misses;
        if (t > 0) ratio = hits / t;
        hits = misses = 0;
        n.gauge('hitRatio', Math.round(ratio * 100));
      });
    },
    onRequest(req: Req) {
      const line = req.msg.key ?? 0;
      const d = hwOf(req.msg.data);
      n.process(req.msg.weight, lat(), ok => {
        if (!ok) return req.reply({ ok: false, err: '503' });
        if (lines.has(line)) {
          hits += req.msg.weight;
          fill(line);
          const r: Reply = { ok: true, data: d && { ...d, title: `${n.name} hit · line ${line}`, note: `Line ${line} is already in ${n.name}. Answered in ${lat()} cycles; nothing below is touched.` } };
          return req.reply(r);
        }
        const waiting = pending.get(line);
        if (waiting) {
          hits += req.msg.weight;
          return void waiting.push(req);
        }
        misses += req.msg.weight;
        const e = n.syncOut('read')[0] ?? n.outEdges()[0];
        if (!e) return req.reply({ ok: true, miss: true });
        const next = n.world.nodeName(e.to) ?? e.to;
        const down = d && { ...d, title: `${n.name} miss → ${next}`, note: `${n.name} doesn’t have line ${line}, so the request goes down to ${next}.` };
        pending.set(line, []);
        n.call(e, { ...n.world.child(req.msg, n.id, e.to), data: down }, (r) => {
          const evicted = fill(line);
          const up = hwOf(r.data) ?? d;
          req.reply({ ...r, data: up && { ...up, title: `Line ${line} copied into ${n.name}`, note: `The 64 B line passes through ${n.name}, which keeps a copy so the next load of it is a hit.${evicted !== undefined ? ` ${n.name} was full, so the least recently used line, ${evicted}, was evicted.` : ''}` } });
          const merged = pending.get(line) ?? [];
          pending.delete(line);
          for (const q of merged) {
            const qd = hwOf(q.msg.data);
            q.reply({ ...r, data: qd && { ...qd, title: `${n.name} fill buffer · line ${line}`, note: `Line ${line} was already on its way up from an earlier miss, so this load waited for it instead of going down again.` } });
          }
        });
      });
    },
    onChaos(kind, _p, heal) {
      if (kind !== 'cache-flush' || heal) return false;
      lines = new Map();
      pending.clear();
      return true;
    },
    onKill() {
      lines = new Map();
      pending.clear();
    },
    view() {
      return {
        badges: [
          { text: `hit ${Math.round(ratio * 100)}%`, tone: ratio > 0.8 ? 'ok' : ratio > 0.4 ? 'muted' : 'warn' },
          { text: `${lines.size}/${cap()} lines`, tone: 'muted' },
        ],
      };
    },
  };
}

function dram(n: SimNode): NodeLogic {
  return {
    onRequest(req: Req) {
      const lat = Math.max(1, n.num('latencyCycles', 300));
      const d = hwOf(req.msg.data);
      n.process(req.msg.weight, lat, ok => {
        if (!ok) return req.reply({ ok: false, err: '503' });
        req.reply({ ok: true, data: d && { ...d, title: `RAM sends line ${d.line}`, note: `DRAM opens the row, then streams the 64 B line back in 8 bursts of 8 B. ${lat} cycles the core spent waiting.` } });
      });
    },
  };
}

register('cpu-core', cpuCore);
register('cpu-cache', cpuCache);
register('dram', dram);
