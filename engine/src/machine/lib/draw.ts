// Shape/frame helpers shared by machine models (1000×1000 viewBox, phone-sized text).
import { registerDemo } from '../../algo/frames';
import type { Demo, Detail, Frame, PanelRow, Shape, Tone } from '../../algo/frames';

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
  /** `from`: shape id → where (and how) it starts; a copy is placed in the previous frame so the shape glides in */
  add(note: string, shapes: Shape[], p?: { title: string; rows: PanelRow[] }, from?: Record<string, { x: number; y: number } & Record<string, unknown>>) {
    const last = this.frames[this.frames.length - 1];
    if (from && last)
      for (const [id, at] of Object.entries(from)) {
        const s = shapes.find((x) => x.id === id);
        if (s && !last.shapes.some((x) => x.id === id) && (s.t === 'dot' || s.t === 'text' || s.t === 'rect')) last.shapes.push({ ...s, ...at });
      }
    this.frames.push(p ? { note, shapes, panel: p } : { note, shapes });
  }
}

export const hex = (n: number, pad = 1) => '0x' + n.toString(16).toUpperCase().padStart(pad, '0');

/** Attaches details to boxes (rect/node) whose label or id matches a key, unless they already have one. */
export function attachDetails(frames: Frame[], details: Record<string, Detail>) {
  for (const f of frames)
    for (const s of f.shapes)
      if ((s.t === 'rect' || s.t === 'node') && !s.detail) {
        const d = (s.label !== undefined && details[s.label]) || details[s.id];
        if (d) s.detail = d;
      }
  return frames;
}

/** Registers a demo whose frames are built eagerly; the last frame is marked done. `details` is keyed by box label or id. */
export function machineDemo(d: Omit<Demo, 'run'> & { build(input: any): Frame[]; details?: Record<string, Detail> }) {
  const { build, details, ...meta } = d;
  registerDemo({
    ...meta,
    editable: 'none',
    *run(input: unknown) {
      const fs = build(input ?? d.inputs[0]?.data);
      if (details) attachDetails(fs, details);
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

/** One demo whose inputs each build their own frames, so scene kinds can mix: `inputs[id] = [chip label, build]`. */
export function framesDemo(group: string, slug: string, title: string, summary: string, inputs: Record<string, [label: string, build: () => Frame[]]>, details?: Record<string, Detail>) {
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
