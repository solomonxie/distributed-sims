// Line-by-line program trace: code on top, stack variables (left), heap blocks (right), console output (bottom).
import type { Detail, Frame, Shape, Tone } from '../../algo/frames';
import { arrow, box, code, Film, panel, text } from './draw';
import type { Row } from './draw';

/** [name, value, tone?, heap block id it points to?] */
export type TraceVar = [name: string, value: string, tone?: Tone, to?: string];
/** [id, label, tone?, sub?] */
export type TraceBlock = [id: string, label: string, tone?: Tone, sub?: string];

export interface TraceStep {
  note: string;
  /** highlighted code line(s), 0-based */
  line?: number | number[];
  vars?: TraceVar[];
  heap?: TraceBlock[];
  /** full console text so far; lines split on \n */
  out?: string;
  rows?: Row[];
}

export interface Trace {
  code: string[];
  codeTitle?: string;
  steps: TraceStep[];
  /** column titles; heap column hidden when no step has heap blocks */
  stackTitle?: string;
  heapTitle?: string;
  panel?: string;
  /** keyed by variable name, heap block id, or 'out' */
  details?: Record<string, Detail>;
}

export function traceFrames(t: Trace): Frame[] {
  const f = new Film();
  const lh = Math.min(36, Math.floor(430 / Math.max(1, t.code.length)));
  const codeEnd = 42 + lh * t.code.length;
  const hasHeap = t.steps.some((s) => s.heap?.length);
  const hasOut = t.steps.some((s) => s.out !== undefined);
  const top = codeEnd + 60;
  const bottom = hasOut ? 820 : 985;
  const colW = hasHeap ? 440 : 920;
  const hx = 520;
  for (const s of t.steps) {
    const hl = s.line === undefined ? [] : Array.isArray(s.line) ? s.line : [s.line];
    const out: Shape[] = [text('ct', 20, 22, t.codeTitle ?? 'main.cpp', { align: 'left', size: 24, bold: true, tone: 'current' }), ...code(t.code, 42, lh, hl)];
    out.push(text('sh', 40, top - 24, t.stackTitle ?? 'stack', { align: 'left', size: 24, bold: true }));
    if (hasHeap) out.push(text('hh', hx, top - 24, t.heapTitle ?? 'heap', { align: 'left', size: 24, bold: true }));
    const vars = s.vars ?? [];
    const heap = s.heap ?? [];
    const rh = Math.min(72, Math.floor((bottom - top) / Math.max(1, vars.length, heap.length)));
    const at: Record<string, number> = {};
    heap.forEach(([id, label, tone, sub], k) => {
      const y = top + k * rh;
      at[id] = y + (rh - 8) / 2;
      const b = box(`h-${id}`, hx, y, colW, rh - 8, label, { mono: true, tone: tone ?? 'default', sub });
      if (b.t === 'rect' && t.details?.[id]) b.detail = t.details[id];
      out.push(b);
    });
    vars.forEach(([name, value, tone, to], k) => {
      const y = top + k * rh;
      const b = box(`v-${name}`, 40, y, colW, rh - 8, `${name} = ${value}`, { mono: true, tone: tone ?? 'default' });
      if (b.t === 'rect' && t.details?.[name]) b.detail = t.details[name];
      out.push(b);
      if (to && at[to] !== undefined) out.push(arrow(`p-${name}`, 40 + colW + 2, y + (rh - 8) / 2, hx - 4, at[to], 'accent'));
    });
    if (hasOut) {
      const lines = (s.out ?? '').split('\n').slice(-3);
      const o = box('out', 20, 840, 960, 145, undefined, { tone: 'muted', filled: false });
      if (o.t === 'rect' && t.details?.out) o.detail = t.details.out;
      out.push(o, text('oh', 36, 862, 'output', { align: 'left', size: 24, bold: true, tone: 'muted' }));
      lines.forEach((l, k) => out.push(text(`o${k}`, 36, 900 + k * 30, l, { align: 'left', size: 24, mono: true })));
    }
    f.add(s.note, out, s.rows ? panel(t.panel ?? 'State', s.rows) : undefined);
  }
  return f.frames;
}
