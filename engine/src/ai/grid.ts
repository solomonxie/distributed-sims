// Grids of numbers or tokens for the AI demos (matrices, token rows, probability bars).
import type { Detail, Shape, Tone } from '../algo/frames';
import { box, text } from '../machine/lib/draw';

export interface GridOpts {
  cw?: number;
  ch?: number;
  tone?: (r: number, c: number) => Tone | undefined;
  rowLabels?: string[];
  colLabels?: string[];
  title?: string;
  detail?: Detail;
}

/** Matrix of values at (x, y); cells `cw`×`ch`. Title sits above, row labels to the left. */
export function grid(id: string, x: number, y: number, cells: (string | number)[][], o: GridOpts = {}): Shape[] {
  const cw = o.cw ?? 90;
  const ch = o.ch ?? 56;
  const out: Shape[] = [];
  if (o.title) out.push(text(`${id}-t`, x, y - 22, o.title, { align: 'left', size: 24, bold: true }));
  o.colLabels?.forEach((l, c) => out.push(text(`${id}-c${c}`, x + c * cw + cw / 2, y - (o.title ? 50 : 20), l, { size: 24, tone: 'muted', mono: true })));
  cells.forEach((row, r) => {
    if (o.rowLabels) out.push(text(`${id}-r${r}`, x - 10, y + r * ch + ch / 2, o.rowLabels[r], { align: 'right', size: 24, mono: true }));
    row.forEach((v, c) => {
      const b = box(`${id}-${r}-${c}`, x + c * cw + 2, y + r * ch + 2, cw - 4, ch - 4, typeof v === 'number' ? fmt(v) : v, { mono: true, tone: o.tone?.(r, c) ?? 'default' });
      if (o.detail && b.t === 'rect' && r === 0 && c === 0) b.detail = o.detail;
      out.push(b);
    });
  });
  return out;
}

export const fmt = (v: number) => (Number.isInteger(v) ? String(v) : Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2));

/** Horizontal probability bars: label, bar ∝ p, value. */
export function bars(id: string, x: number, y: number, w: number, items: { label: string; p: number; tone?: Tone }[], rowH = 54): Shape[] {
  const out: Shape[] = [];
  const max = Math.max(...items.map((i) => i.p), 1e-9);
  items.forEach((it, i) => {
    const yy = y + i * rowH;
    out.push(text(`${id}-l${i}`, x, yy + rowH / 2, it.label, { align: 'left', size: 26, mono: true }));
    const bw = Math.max(6, ((w - 300) * it.p) / max);
    out.push(box(`${id}-b${i}`, x + 170, yy + 8, bw, rowH - 16, undefined, { tone: it.tone ?? 'read' }));
    out.push(text(`${id}-v${i}`, x + 180 + bw, yy + rowH / 2, it.p.toFixed(2), { align: 'left', size: 24, mono: true }));
  });
  return out;
}
