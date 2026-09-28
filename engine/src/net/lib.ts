// Network drawing helpers (packet lanes, header byte layouts, bar charts) and pure math (CIDR, RTO, cwnd).
import type { Detail, Frame, Shape, Tone } from '../algo/frames';
import { arrow, box, Film, line, panel, text } from '../machine/lib/draw';
import type { Row } from '../machine/lib/draw';

const withDetail = (s: Shape, d?: Detail): Shape => {
  if (d && (s.t === 'rect' || s.t === 'node')) s.detail = d;
  return s;
};

// ---------------- packet lanes (sequence diagram) ----------------
export interface Msg {
  /** lane index; from === to draws a local event box on that lane */
  from: number;
  to: number;
  label: string;
  note: string;
  tone?: Tone;
  /** arrow stops halfway with a ✕ */
  lost?: boolean;
  detail?: Detail;
  rows?: Row[];
  /** extra empty slots before this message (time passing) */
  gap?: number;
}

export interface Lanes {
  lanes: string[];
  subs?: string[];
  laneDetails?: (Detail | undefined)[];
  intro: string;
  rows?: Row[];
  msgs: Msg[];
  outro?: string;
  outroRows?: Row[];
  panel?: string;
}

export function laneFrames(l: Lanes): Frame[] {
  const n = l.lanes.length;
  const span = 1000 / n;
  const lx = (i: number) => Math.round(span * i + span / 2);
  const slots = l.msgs.reduce((a, m) => a + 1 + (m.gap ?? 0), 0);
  const top = 140;
  const dy = Math.min(80, Math.floor((975 - top) / Math.max(1, slots)));
  const ys: number[] = [];
  let y = top;
  for (const m of l.msgs) {
    y += (m.gap ?? 0) * dy;
    ys.push(y);
    y += dy;
  }
  const base = (): Shape[] => {
    const out: Shape[] = [];
    l.lanes.forEach((name, i) => {
      const w = Math.min(span - 16, 300);
      out.push(line(`ll${i}`, lx(i), 104, lx(i), 990, 'muted', { dashed: true, width: 2 }));
      out.push(withDetail(box(`ln${i}`, lx(i) - w / 2, 18, w, 84, name, { sub: l.subs?.[i], tone: 'default' }), l.laneDetails?.[i]));
    });
    return out;
  };
  const drawMsg = (k: number, cur: boolean): Shape[] => {
    const m = l.msgs[k];
    const y0 = ys[k];
    const out: Shape[] = [];
    const tone: Tone = cur ? m.tone ?? 'current' : m.tone === 'fail' || m.lost ? 'fail' : 'visited';
    if (m.from === m.to) {
      const w = Math.min(Math.max(140, m.label.length * 14 + 30), Math.min(span * 1.6, 420));
      const x = Math.max(4, Math.min(996 - w, lx(m.from) - w / 2));
      out.push(withDetail(box(`mb${k}`, x, y0, w, Math.min(40, dy - 6), m.label, { tone: cur ? m.tone ?? 'warn' : 'visited' }), m.detail));
      return out;
    }
    const x1 = lx(m.from);
    const x2full = lx(m.to);
    const x2 = m.lost ? (x1 + x2full) / 2 : x2full;
    const y1 = y0 + 4;
    const y2 = y0 + Math.max(14, dy * 0.55);
    out.push(arrow(`m${k}`, x1, y1, x2, y2, cur ? (m.lost || m.tone === 'fail' ? 'fail' : 'accent') : 'muted', { width: cur ? 4 : 3 }));
    if (m.lost) out.push(text(`mx${k}`, x2 + (x2full > x1 ? 16 : -16), y2, '✕', { size: 34, bold: true, tone: 'fail' }));
    const gapW = Math.abs(x2full - x1) - 24;
    const w = Math.max(90, Math.min(gapW, m.label.length * 14 + 30));
    const mx = (x1 + x2full) / 2;
    const h = Math.min(38, dy - 8);
    out.push(withDetail(box(`mb${k}`, mx - w / 2, (y1 + y2) / 2 - h / 2, w, h, m.label, { tone, mono: true }), m.detail));
    return out;
  };
  const f = new Film();
  const pn = (rows?: Row[]) => (rows ? panel(l.panel ?? 'Packets', rows) : undefined);
  f.add(l.intro, base(), pn(l.rows));
  l.msgs.forEach((m, i) => {
    const out = base();
    for (let k = 0; k <= i; k++) out.push(...drawMsg(k, k === i));
    f.add(m.note, out, pn(m.rows ?? l.rows));
  });
  if (l.outro) {
    const out = base();
    for (let k = 0; k < l.msgs.length; k++) out.push(...drawMsg(k, false));
    f.add(l.outro, out, pn(l.outroRows ?? l.msgs[l.msgs.length - 1]?.rows ?? l.rows));
  }
  return f.frames;
}

// ---------------- header byte layout ----------------
export interface Field {
  name: string;
  bits: number;
  value?: string;
  detail?: Detail;
}

export interface HeaderStep {
  note: string;
  /** field indexes to highlight */
  hl?: number[];
  rows?: Row[];
  tone?: Tone;
}

/** Fields laid out 32 bits per row, like an RFC diagram. */
export function headerShapes(fields: Field[], hl: number[], y0 = 150, tone: Tone = 'current', width = 32): Shape[] {
  const X = 40;
  const W = 920;
  const bw = W / width;
  const rows = Math.ceil(fields.reduce((a, f) => a + f.bits, 0) / width);
  const rh = Math.min(110, Math.floor((960 - y0) / Math.max(1, rows)));
  const out: Shape[] = [];
  for (const b of [0, 8, 16, 24]) if (b < width) out.push(text(`bt${b}`, X + b * bw + 4, y0 - 22, String(b), { align: 'left', size: 24, mono: true, tone: 'muted' }));
  out.push(text('btE', X + W - 4, y0 - 22, String(width - 1), { align: 'right', size: 24, mono: true, tone: 'muted' }));
  let bit = 0;
  fields.forEach((f, i) => {
    let left = f.bits;
    let part = 0;
    while (left > 0) {
      const r = Math.floor(bit / width);
      const c = bit % width;
      const take = Math.min(left, width - c);
      const on = hl.includes(i);
      const wide = take * bw >= 120;
      out.push(
        withDetail(
          box(`f${i}-${part}`, X + c * bw + 2, y0 + r * rh + 2, take * bw - 4, rh - 4, wide || take === f.bits ? f.name : '', {
            sub: wide ? f.value ?? `${f.bits} bits` : undefined,
            mono: true,
            tone: on ? tone : 'default',
          }),
          f.detail,
        ),
      );
      bit += take;
      left -= take;
      part++;
    }
  });
  return out;
}

export function headerFrames(title: string, fields: Field[], steps: HeaderStep[], panelTitle = 'Header'): Frame[] {
  const f = new Film();
  const bytes = fields.reduce((a, x) => a + x.bits, 0) / 8;
  for (const s of steps) {
    const out: Shape[] = [text('ht', 20, 40, title, { align: 'left', size: 30, bold: true }), text('hb', 980, 40, `${bytes} bytes`, { align: 'right', size: 26, mono: true, tone: 'muted' }), ...headerShapes(fields, s.hl ?? [], 150, s.tone)];
    f.add(s.note, out, panel(panelTitle, s.rows ?? [['header size', `${bytes} B`]]));
  }
  return f.frames;
}

// ---------------- bar chart (cwnd over rounds) ----------------
export interface Bar {
  value: number;
  tone?: Tone;
  label?: string;
}

/** Bars left→right over [x0,x1], baseline y1, top y0; optional dashed per-bar threshold. */
export function barChart(prefix: string, bars: Bar[], max: number, o: { x0?: number; x1?: number; y0?: number; y1?: number; threshold?: (number | undefined)[]; axis?: string; yAxis?: string } = {}): Shape[] {
  const x0 = o.x0 ?? 80;
  const x1 = o.x1 ?? 970;
  const y0 = o.y0 ?? 220;
  const y1 = o.y1 ?? 900;
  const out: Shape[] = [line(`${prefix}ax`, x0, y1, x1, y1, 'muted', { width: 3 }), line(`${prefix}ay`, x0, y0 - 10, x0, y1, 'muted', { width: 3 })];
  if (o.axis) out.push(text(`${prefix}xl`, (x0 + x1) / 2, y1 + 50, o.axis, { size: 26, tone: 'muted' }));
  if (o.yAxis) out.push(text(`${prefix}yl`, x0 + 8, y0 - 36, o.yAxis, { align: 'left', size: 26, tone: 'muted' }));
  const n = Math.max(1, bars.length);
  const slot = (x1 - x0 - 10) / Math.max(n, 12);
  bars.forEach((b, i) => {
    const h = Math.max(4, ((y1 - y0) * b.value) / Math.max(1, max));
    const x = x0 + 8 + i * slot;
    out.push(box(`${prefix}b${i}`, x, y1 - h, Math.max(8, slot - 6), h, undefined, { tone: b.tone ?? 'read' }));
    if (b.label) out.push(text(`${prefix}v${i}`, x + (slot - 6) / 2, y1 - h - 18, b.label, { size: 24, mono: true, tone: b.tone === 'fail' ? 'fail' : undefined }));
    const t = o.threshold?.[i];
    if (t !== undefined && t <= max) {
      const ty = y1 - ((y1 - y0) * t) / max;
      out.push(line(`${prefix}t${i}`, x - 3, ty, x + slot - 3, ty, 'warn', { dashed: true, width: 3 }));
    }
  });
  return out;
}

// ---------------- IPv4 / CIDR ----------------
export function ipToInt(ip: string): number {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) throw new Error(`bad ip ${ip}`);
  return ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0;
}

export const intToIp = (n: number) => [24, 16, 8, 0].map((s) => (n >>> s) & 255).join('.');

export const maskOf = (len: number) => (len === 0 ? 0 : (0xffffffff << (32 - len)) >>> 0);

export function parseCidr(cidr: string): { net: number; len: number } {
  const [ip, l] = cidr.split('/');
  const len = Number(l);
  return { net: (ipToInt(ip) & maskOf(len)) >>> 0, len };
}

export function cidrContains(cidr: string, ip: string): boolean {
  const { net, len } = parseCidr(cidr);
  return ((ipToInt(ip) & maskOf(len)) >>> 0) === net;
}

export function subnet(cidr: string) {
  const { net, len } = parseCidr(cidr);
  const size = 2 ** (32 - len);
  const broadcast = (net + size - 1) >>> 0;
  const usable = len >= 31 ? size : size - 2;
  return {
    network: intToIp(net),
    broadcast: intToIp(broadcast),
    mask: intToIp(maskOf(len)),
    first: intToIp(len >= 31 ? net : net + 1),
    last: intToIp(len >= 31 ? broadcast : broadcast - 1),
    size,
    hosts: usable,
  };
}

export interface Route {
  prefix: string;
  via: string;
}

/** Longest-prefix match: the most specific matching route wins. */
export function lpm(table: Route[], ip: string): { route?: Route; matches: Route[] } {
  const matches = table.filter((r) => cidrContains(r.prefix, ip));
  const route = [...matches].sort((a, b) => parseCidr(b.prefix).len - parseCidr(a.prefix).len)[0];
  return { route, matches };
}

export const bits32 = (n: number) => (n >>> 0).toString(2).padStart(32, '0');

// ---------------- TCP timers & congestion ----------------
export interface RtoPoint {
  sample: number;
  srtt: number;
  rttvar: number;
  rto: number;
}

/** RFC 6298 (Jacobson/Karels): SRTT, RTTVAR and RTO after each RTT sample, in ms. */
export function rtoEstimate(samples: number[], minRto = 200): RtoPoint[] {
  const out: RtoPoint[] = [];
  let srtt = 0;
  let rttvar = 0;
  samples.forEach((r, i) => {
    if (i === 0) {
      srtt = r;
      rttvar = r / 2;
    } else {
      rttvar = 0.75 * rttvar + 0.25 * Math.abs(srtt - r);
      srtt = 0.875 * srtt + 0.125 * r;
    }
    out.push({ sample: r, srtt: Math.round(srtt * 10) / 10, rttvar: Math.round(rttvar * 10) / 10, rto: Math.max(minRto, Math.round(srtt + 4 * rttvar)) });
  });
  return out;
}

export interface CwndPoint {
  round: number;
  cwnd: number;
  ssthresh: number;
  phase: 'slow start' | 'avoidance';
  event?: 'dupack' | 'timeout';
}

/** TCP Reno-style cwnd (in MSS) per RTT round; `loss[round]` fires after sending that round. */
export function cwndTrace(rounds: number, loss: Record<number, 'dupack' | 'timeout'> = {}, ssthresh0 = 64): CwndPoint[] {
  const out: CwndPoint[] = [];
  let cwnd = 1;
  let ssthresh = ssthresh0;
  for (let r = 0; r < rounds; r++) {
    const ev = loss[r];
    out.push({ round: r, cwnd, ssthresh, phase: cwnd < ssthresh ? 'slow start' : 'avoidance', event: ev });
    if (ev) {
      ssthresh = Math.max(2, Math.floor(cwnd / 2));
      cwnd = ev === 'timeout' ? 1 : ssthresh;
    } else if (cwnd < ssthresh) cwnd = Math.min(cwnd * 2, ssthresh);
    else cwnd += 1;
  }
  return out;
}

/** Bandwidth-delay product in bytes: how much must be in flight to fill the pipe. */
export const bdpBytes = (mbps: number, rttMs: number) => Math.round((mbps * 1e6 * rttMs) / 1000 / 8);
