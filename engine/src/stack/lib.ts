// Sequence diagrams for the tech-stack demos: one lifeline per component, one message revealed per step.
import type { Detail, Frame, Shape, Tone } from '../algo/frames';
import { arrow, box, Film, line, machineDemo, panel, text } from '../machine/lib/draw';
import type { Row } from '../machine/lib/draw';

export interface Lane {
  id: string;
  label: string;
  sub?: string;
  detail?: Detail;
}

export interface SeqMsg {
  from: string;
  to: string;
  label: string;
  note: string;
  /** a response: drawn dashed, green (or red when !ok) */
  reply?: boolean;
  ok?: boolean;
  /** lost on the way: stops half way, red */
  lost?: boolean;
  rows?: Row[];
  detail?: Detail;
}

export interface Seq {
  lanes: Lane[];
  intro: string;
  msgs: SeqMsg[];
  outro: string;
  panel: string;
  rows0?: Row[];
  outroRows?: Row[];
}

const TOP = 20;
const HEAD_H = 92;

function laneX(lanes: Lane[]) {
  const n = lanes.length;
  const w = Math.min(230, (960 - (n - 1) * 16) / n);
  const total = n * w + (n - 1) * 16;
  const x0 = (1000 - total) / 2;
  return { w, xs: lanes.map((_, i) => x0 + i * (w + 16)) };
}

/** Frames: intro (lanes only), one per message (earlier ones faded), outro (all). */
export function seqFrames(s: Seq): Frame[] {
  const f = new Film();
  const { w, xs } = laneX(s.lanes);
  const cx = (id: string) => {
    const i = s.lanes.findIndex((l) => l.id === id);
    return xs[Math.max(0, i)] + w / 2;
  };
  const y0 = TOP + HEAD_H + 50;
  const dy = Math.min(66, (985 - y0) / Math.max(1, s.msgs.length));
  const draw = (upto: number, all: boolean): Shape[] => {
    const out: Shape[] = [];
    s.lanes.forEach((l, i) => {
      out.push(line(`ll-${l.id}`, xs[i] + w / 2, TOP + HEAD_H + 4, xs[i] + w / 2, 990, 'muted', { dashed: true, width: 2 }));
      const b = box(`lane-${l.id}`, xs[i], TOP, w, HEAD_H, l.label, { sub: l.sub, mono: true, tone: 'default' });
      if (l.detail && b.t === 'rect') b.detail = l.detail;
      out.push(b);
    });
    s.msgs.slice(0, upto).forEach((m, k) => {
      const cur = !all && k === upto - 1;
      const y = y0 + k * dy;
      const a = cx(m.from);
      const b = cx(m.to);
      const tone: Tone = m.lost ? 'fail' : m.reply ? (m.ok === false ? 'fail' : cur ? 'ok' : 'muted') : cur ? 'accent' : 'muted';
      if (a === b) {
        const r = box(`m${k}`, a - Math.min(w, 200) / 2, y - dy / 2 + 6, Math.min(w, 200), dy - 12, m.label, { mono: true, tone: cur ? 'current' : 'visited' });
        if (m.detail && r.t === 'rect') r.detail = m.detail;
        out.push(r);
        return;
      }
      const end = m.lost ? a + (b - a) * 0.55 : b + (b > a ? -6 : 6);
      out.push(arrow(`m${k}`, a, y, end, y, tone, { dashed: !!m.reply, width: cur ? 5 : 3 }));
      if (m.lost) out.push(text(`mx${k}`, end + (b > a ? 16 : -16), y, '✕', { size: 30, tone: 'fail', bold: true }));
      const tx = (a + (m.lost ? end : b)) / 2;
      const t = text(`mt${k}`, tx, y - 20, m.label, { size: 24, mono: true, tone: cur ? (m.reply ? 'ok' : 'accent') : 'muted' });
      out.push(t);
    });
    return out;
  };
  f.add(s.intro, draw(0, false), panel(s.panel, s.rows0 ?? [['messages', 0]]));
  s.msgs.forEach((m, k) => f.add(m.note, draw(k + 1, false), panel(s.panel, m.rows ?? [['step', `${k + 1} / ${s.msgs.length}`], [m.reply ? 'response' : 'request', m.label, m.lost ? 'fail' : m.reply ? (m.ok === false ? 'fail' : 'ok') : undefined]])));
  f.add(s.outro, draw(s.msgs.length, true), panel(s.panel, s.outroRows ?? [['messages', s.msgs.length]]));
  return f.frames;
}

/** One demo whose inputs are sequence diagrams: `seqs[id] = [chip label, seq]`. */
export function seqDemo(group: string, slug: string, title: string, summary: string, seqs: Record<string, [string, Seq]>, details?: Record<string, Detail>) {
  machineDemo({
    slug,
    title,
    group,
    summary,
    inputs: Object.entries(seqs).map(([id, [label]]) => ({ id, label, data: { k: id } })),
    build: ({ k }: { k: string }) => seqFrames(seqs[k][1]),
    details,
  });
}

export const D = (title: string, text: string, code?: string): Detail => (code ? { title, text, code } : { title, text });
