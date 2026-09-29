// Shared drawing for system-design demos: numbered sequence diagrams (one message per step) and time bars.
import type { Detail, Frame, Shape, Tone } from '../algo/frames';
import { arrow, box, Film, line, machineDemo, panel, text } from '../machine/lib/draw';
import type { Row } from '../machine/lib/draw';

export type { Row };

export interface Actor {
  id: string;
  label: string;
  sub?: string;
  detail?: Detail;
}

/** One message on the wire (or a self step when from === to). */
export interface SeqMsg {
  from: string;
  to: string;
  label: string;
  note: string;
  kind?: 'req' | 'resp' | 'async' | 'fail' | 'self';
  rows?: Row[];
}

export interface Seq {
  actors: Actor[];
  msgs: SeqMsg[];
  intro: string;
  outro?: string;
  panel?: string;
  rows?: Row[];
}

const TOP = 24;
const HEAD_H = 92;
const Y0 = 190;
const ROW_H = 58;
const MAX_ROWS = Math.floor((985 - Y0) / ROW_H);

const toneOf = (k: SeqMsg['kind']): Tone => (k === 'resp' ? 'ok' : k === 'async' ? 'protocol' : k === 'fail' ? 'fail' : k === 'self' ? 'write' : 'accent');

/** Sequence diagram: actors across the top, one numbered message revealed per frame. */
export function seqFrames(s: Seq): Frame[] {
  const f = new Film();
  const n = s.actors.length;
  const lane = 1000 / n;
  const w = Math.min(230, lane - 14);
  const x = new Map(s.actors.map((a, i) => [a.id, lane * i + lane / 2]));
  const draw = (upto: number): Shape[] => {
    const out: Shape[] = [];
    s.actors.forEach((a, i) => {
      const cx = lane * i + lane / 2;
      const b = box(`a-${a.id}`, cx - w / 2, TOP, w, HEAD_H, a.label, { sub: a.sub, tone: upto >= 0 && (s.msgs[upto]?.from === a.id || s.msgs[upto]?.to === a.id) ? 'current' : 'default' });
      if (b.t === 'rect' && a.detail) b.detail = a.detail;
      out.push(b, line(`l-${a.id}`, cx, TOP + HEAD_H + 4, cx, 985, 'muted', { dashed: true, width: 2 }));
    });
    const first = Math.max(0, upto - MAX_ROWS + 1);
    for (let k = first; k <= upto && k < s.msgs.length; k++) {
      const m = s.msgs[k];
      const y = Y0 + (k - first) * ROW_H;
      const cur = k === upto;
      const tone: Tone = cur ? toneOf(m.kind) : 'visited';
      const x1 = x.get(m.from)!;
      const x2 = x.get(m.to)!;
      const label = `${k + 1}. ${m.label}`;
      if (m.from === m.to || m.kind === 'self') {
        const bw = Math.min(lane - 10, 240);
        out.push(box(`m${k}`, Math.max(2, Math.min(998 - bw, x1 - bw / 2)), y - 22, bw, 44, label, { tone, filled: cur }));
      } else {
        const dir = x2 > x1 ? 1 : -1;
        out.push(arrow(`m${k}`, x1 + dir * 6, y, x2 - dir * 10, y, tone, { dashed: m.kind === 'async' || m.kind === 'fail', width: cur ? 5 : 3 }));
        out.push(text(`t${k}`, (x1 + x2) / 2, y - 20, label, { size: 24, tone: cur ? tone : 'muted', bold: cur }));
      }
    }
    return out;
  };
  const rows = (i: number): Row[] => {
    const m = s.msgs[i];
    const base: Row[] = [['step', i < 0 ? '—' : `${i + 1} of ${s.msgs.length}`]];
    if (m) base.push(['on the wire', m.kind === 'resp' ? 'response' : m.kind === 'async' ? 'async' : m.kind === 'fail' ? 'failure' : m.kind === 'self' ? 'local work' : 'request', m.kind === 'fail' ? 'fail' : undefined]);
    return [...base, ...(m?.rows ?? s.rows ?? [])];
  };
  const title = s.panel ?? 'Sequence';
  f.add(s.intro, draw(-1), panel(title, rows(-1)));
  s.msgs.forEach((m, i) => f.add(m.note, draw(i), panel(title, rows(i))));
  if (s.outro) f.add(s.outro, draw(s.msgs.length - 1), panel(title, [['messages', s.msgs.length], ...(s.rows ?? [])]));
  return f.frames;
}

export interface Seg {
  from: number;
  to: number;
  label: string;
  tone?: Tone;
}

export interface Lane {
  id: string;
  label: string;
  segs: Seg[];
  detail?: Detail;
}

export interface TimeBeat {
  note: string;
  /** time cursor: segments are drawn up to here */
  at: number;
  /** lanes shown (default all) */
  lanes?: string[];
  rows?: Row[];
  /** vertical marker labels at times */
  marks?: [t: number, label: string, tone?: Tone][];
}

/** Horizontal time bars: one lane per row, segments revealed up to each beat's cursor. */
export function timelineFrames(t: { lanes: Lane[]; span: number; unit: string; beats: TimeBeat[]; panel?: string }): Frame[] {
  const f = new Film();
  const LX = 250;
  const W = 730;
  const X = (v: number) => LX + (Math.min(v, t.span) / t.span) * W;
  const rowH = Math.min(120, Math.floor(820 / Math.max(1, t.lanes.length)));
  for (const b of t.beats) {
    const out: Shape[] = [];
    const show = t.lanes.filter((l) => !b.lanes || b.lanes.includes(l.id));
    show.forEach((l, i) => {
      const y = 70 + i * rowH;
      const lb = box(`ln-${l.id}`, 10, y, LX - 24, rowH - 16, l.label, {});
      if (lb.t === 'rect' && l.detail) lb.detail = l.detail;
      out.push(lb);
      l.segs.forEach((s, k) => {
        if (s.from >= b.at) return;
        const x1 = X(s.from);
        const x2 = X(Math.min(s.to, b.at));
        if (x2 - x1 < 2) return;
        out.push(box(`sg-${l.id}-${k}`, x1, y + 4, x2 - x1, rowH - 24, x2 - x1 > 60 ? s.label : undefined, { tone: s.tone ?? 'accent' }));
      });
    });
    const cx = X(b.at);
    out.push(line('cur', cx, 50, cx, 70 + show.length * rowH, 'current', { width: 2 }));
    out.push(text('ax0', LX, 30, `0 ${t.unit}`, { align: 'left', size: 24, tone: 'muted' }), text('ax1', LX + W, 30, `${t.span} ${t.unit}`, { align: 'right', size: 24, tone: 'muted' }));
    (b.marks ?? []).forEach(([tm, label, tone], k) => {
      const mx = X(tm);
      const y = 70 + show.length * rowH + 20 + (k % 3) * 34;
      if (y > 985) return;
      out.push(line(`mk${k}`, mx, 60, mx, y - 12, tone ?? 'warn', { dashed: true, width: 2 }), text(`mt${k}`, Math.max(40, Math.min(960, mx)), y, label, { size: 24, tone: tone ?? 'warn' }));
    });
    f.add(b.note, out, panel(t.panel ?? 'Timeline', b.rows ?? [['time', `${Math.round(Math.min(b.at, t.span))} ${t.unit}`]]));
  }
  return f.frames;
}

/** Register a demo whose inputs each map to prebuilt frames. */
export function sdDemo(group: string, slug: string, title: string, summary: string, inputs: Record<string, [label: string, build: () => Frame[]]>, details?: Record<string, Detail>) {
  machineDemo({
    slug,
    title,
    group,
    summary,
    inputs: Object.entries(inputs).map(([id, [label]]) => ({ id, label, data: { k: id } })),
    build: ({ k }: { k: string }) => inputs[k][1](),
    details,
  });
}

// ---------- small pure models the demos compute from ----------

/** ABR: highest rendition whose bitrate fits a safety fraction of throughput; drop to lowest when the buffer is nearly empty. */
export function abrPick(ladderKbps: number[], throughputKbps: number, bufferSec: number, safety = 0.8, panicSec = 4): number {
  const sorted = [...ladderKbps].sort((a, b) => a - b);
  if (bufferSec < panicSec) return sorted[0];
  const fit = sorted.filter((r) => r <= throughputKbps * safety);
  return fit.length ? fit[fit.length - 1] : sorted[0];
}

/** Monthly cost of Lambda-style pricing vs an always-on fleet (USD). */
export function serverlessMonthly(reqPerMonth: number, avgMs: number, memMb: number, perGbSec = 0.0000166667, perMillion = 0.2): number {
  const gbSec = reqPerMonth * (avgMs / 1000) * (memMb / 1024);
  return gbSec * perGbSec + (reqPerMonth / 1e6) * perMillion;
}

/** Requests/month where serverless starts costing more than `fleetMonthly`. */
export function serverlessCrossover(avgMs: number, memMb: number, fleetMonthly: number): number {
  const per = serverlessMonthly(1e6, avgMs, memMb) / 1e6;
  return fleetMonthly / per;
}

/** Sliding-window-counter estimate: previous window weighted by its overlap. */
export function slidingEstimate(prevCount: number, curCount: number, elapsedFrac: number): number {
  return prevCount * (1 - elapsedFrac) + curCount;
}

/** Effective limit when each of `instances` replicas enforces `limit` with a local counter. */
export const naiveFleetLimit = (limit: number, instances: number) => limit * instances;

/** Nearest-rank percentile of a sample. */
export function percentile(xs: number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return 0;
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
}

/** Number of time series a metric produces: product of distinct values per label. */
export const cardinality = (labelValues: number[]) => labelValues.reduce((a, b) => a * b, 1);
