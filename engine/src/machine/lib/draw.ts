// Shape/frame helpers shared by machine models (1000×1000 viewBox, phone-sized text).
import { registerDemo } from '../../algo/frames';
import type { Demo, Frame, PanelRow, Shape, Tone } from '../../algo/frames';

export type Row = [label: string, value: string | number, tone?: Tone];

export function panel(title: string, rows: Row[]): { title: string; rows: PanelRow[] } {
  return { title, rows: rows.map(([label, value, tone]) => (tone ? { label, value: String(value), tone } : { label, value: String(value) })) };
}

interface BoxOpts {
  sub?: string;
  tone?: Tone;
  mono?: boolean;
  dashed?: boolean;
  filled?: boolean;
}

export function box(id: string, x: number, y: number, w: number, h: number, label?: string, o: BoxOpts = {}): Shape {
  return { t: 'rect', id, x, y, w, h, label, sub: o.sub, tone: o.tone ?? 'default', filled: o.filled ?? true, mono: o.mono, dashed: o.dashed, radius: 10 };
}

interface TextOpts {
  tone?: Tone;
  size?: number;
  align?: 'left' | 'center' | 'right';
  mono?: boolean;
  bold?: boolean;
}

export function text(id: string, x: number, y: number, s: string, o: TextOpts = {}): Shape {
  const size = o.size ?? 30;
  // small muted captions are too low-contrast on a phone
  const tone = o.tone === 'muted' && size <= 28 ? 'default' : o.tone;
  return { t: 'text', id, x, y, text: s, size: Math.max(24, size), align: o.align ?? 'center', tone, mono: o.mono, bold: o.bold };
}

export function arrow(id: string, x1: number, y1: number, x2: number, y2: number, tone: Tone = 'default', o: { dashed?: boolean; width?: number } = {}): Shape {
  return { t: 'line', id, x1, y1, x2, y2, tone, arrow: true, dashed: o.dashed, width: o.width ?? 4 };
}

export function line(id: string, x1: number, y1: number, x2: number, y2: number, tone: Tone = 'muted', o: { dashed?: boolean; width?: number } = {}): Shape {
  return { t: 'line', id, x1, y1, x2, y2, tone, dashed: o.dashed, width: o.width ?? 3 };
}

export function dot(id: string, x: number, y: number, tone: Tone = 'accent', label?: string, r = 14): Shape {
  return { t: 'dot', id, x, y, r, tone, label };
}

/** Accumulates frames for one demo run. */
export class Film {
  frames: Frame[] = [];
  add(note: string, shapes: Shape[], p?: { title: string; rows: PanelRow[] }) {
    this.frames.push(p ? { note, shapes, panel: p } : { note, shapes });
  }
}

export const hex = (n: number, pad = 1) => '0x' + n.toString(16).toUpperCase().padStart(pad, '0');

/** Registers a demo whose frames are built eagerly; the last frame is marked done. */
export function machineDemo(d: Omit<Demo, 'run'> & { build(input: any): Frame[] }) {
  const { build, ...meta } = d;
  registerDemo({
    ...meta,
    editable: 'none',
    *run(input: unknown) {
      const fs = build(input ?? d.inputs[0]?.data);
      if (fs.length) fs[fs.length - 1].done = true;
      yield* fs;
    },
  });
}

/** Monospace code listing; highlighted lines get a current-tone bar. */
export function code(lines: string[], y0: number, lh: number, hi: number[], x = 28, prefix = 'c', w = 972): Shape[] {
  const out: Shape[] = [];
  lines.forEach((l, i) => {
    const y = y0 + i * lh + lh / 2;
    if (hi.includes(i)) out.push(box(`${prefix}h${i}`, x - 14, y - lh / 2 + 1, w, lh - 2, undefined, { tone: 'current' }));
    out.push(text(`${prefix}${i}`, x, y, l, { align: 'left', size: lh >= 38 ? 26 : 24, mono: true, tone: l.trim().startsWith('//') ? 'muted' : undefined }));
  });
  return out;
}
