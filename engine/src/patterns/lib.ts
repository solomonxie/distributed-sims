// Coding-pattern demos: one generic step renderer (array + pointers + window, aux lists, grid, tree/graph) and demo registration.
import type { Detail, Frame, Shape, Tone } from '../algo/frames';
import { arrow, box, Film, line, machineDemo, panel, text } from '../machine/lib/draw';
import type { Row } from '../machine/lib/draw';

export type Val = string | number;

export interface GNode {
  id: string;
  x: number;
  y: number;
  label: string;
  tone?: Tone;
  sub?: string;
}
export interface GEdge {
  a: string;
  b: string;
  tone?: Tone;
  label?: string;
  dir?: boolean;
}

export interface Step {
  note: string;
  arr?: Val[];
  arrLabel?: string;
  ptrs?: Record<string, number>;
  win?: [number, number];
  tones?: Record<number, Tone>;
  arr2?: { label: string; vals: Val[]; tones?: Record<number, Tone> };
  lists?: { label: string; items: Val[]; tones?: Record<number, Tone> }[];
  grid?: { cells: Val[][]; tones?: Record<string, Tone>; rowHead?: string[]; colHead?: string[] };
  graph?: { nodes: GNode[]; edges: GEdge[] };
  rows?: Row[];
}

export interface Case {
  id: string;
  label: string;
  /** "LC 167 · Two Sum II" */
  problem: string;
  /** one-line input / goal */
  input: string;
  detail: Detail;
  steps: () => Step[];
}

export const D = (title: string, text: string, code?: string): Detail => ({ title, text, code });
export const fmt = (v: Val) => (typeof v === 'number' && !Number.isInteger(v) ? v.toFixed(1) : String(v));
export const ok: Tone = 'ok';

const TOP = 170;

function drawArray(out: Shape[], s: Step, y0: number): number {
  const a = s.arr!;
  const n = a.length;
  const cw = Math.min(96, Math.floor(920 / Math.max(1, n)));
  const x0 = Math.round((1000 - cw * n) / 2);
  if (s.arrLabel) out.push(text('al', 30, y0 - 26, s.arrLabel, { align: 'left', size: 24, bold: true, tone: 'muted' }));
  a.forEach((v, i) => {
    const inWin = s.win && i >= s.win[0] && i <= s.win[1];
    out.push(text(`ai${i}`, x0 + i * cw + cw / 2, y0 + 12, String(i), { size: 24, mono: true, tone: 'muted' }));
    out.push(box(`a${i}`, x0 + i * cw + 3, y0 + 30, cw - 6, 76, fmt(v), { mono: true, tone: s.tones?.[i] ?? (inWin ? 'current' : 'default') }));
  });
  if (s.win) {
    const [l, r] = s.win;
    if (l <= r && l >= 0 && r < n) out.push(box('win', x0 + l * cw - 1, y0 + 26, (r - l + 1) * cw + 2, 84, undefined, { tone: 'accent', filled: false }));
  }
  // pointers: arrows under their cell, names stacked when they share one
  const at: Record<number, string[]> = {};
  for (const [name, i] of Object.entries(s.ptrs ?? {})) if (i >= 0 && i < n) (at[i] ??= []).push(name);
  let deepest = y0 + 110;
  for (const [iStr, names] of Object.entries(at)) {
    const i = +iStr;
    const cx = x0 + i * cw + cw / 2;
    out.push(arrow(`p${i}`, cx, y0 + 170, cx, y0 + 112, 'accent'));
    names.forEach((nm, k) => out.push(text(`pn${i}-${k}`, cx, y0 + 192 + k * 28, nm, { size: 24, mono: true, bold: true, tone: 'accent' })));
    deepest = Math.max(deepest, y0 + 192 + names.length * 28);
  }
  return deepest;
}

function drawList(out: Shape[], id: string, label: string, items: Val[], tones: Record<number, Tone> | undefined, y: number) {
  out.push(text(`${id}h`, 30, y + 35, label, { align: 'left', size: 24, bold: true }));
  const shown = items.length > 8 ? items.slice(-8) : items;
  const off = items.length - shown.length;
  const w = Math.min(110, Math.floor(760 / Math.max(1, shown.length)));
  if (!items.length) out.push(box(`${id}e`, 200, y, 160, 70, 'empty', { tone: 'visited', dashed: true, filled: false }));
  shown.forEach((v, k) => out.push(box(`${id}${k}`, 200 + k * w, y, w - 6, 70, fmt(v), { mono: true, tone: tones?.[k + off] ?? 'read' })));
  if (off) out.push(text(`${id}m`, 190, y + 35, '…', { align: 'right', size: 28 }));
}

function drawGrid(out: Shape[], g: NonNullable<Step['grid']>, y0: number) {
  const rows = g.cells.length;
  const cols = g.cells[0]?.length ?? 0;
  const head = g.colHead ? 1 : 0;
  const side = g.rowHead ? 1 : 0;
  const cs = Math.min(84, Math.floor(900 / (cols + side)), Math.floor((980 - y0) / (rows + head)));
  const x0 = Math.round((1000 - cs * (cols + side)) / 2);
  g.colHead?.forEach((h, c) => out.push(text(`gc${c}`, x0 + (c + side) * cs + cs / 2, y0 + cs / 2, h, { size: 24, mono: true, bold: true, tone: 'muted' })));
  g.rowHead?.forEach((h, r) => out.push(text(`gr${r}`, x0 + cs / 2, y0 + (r + head) * cs + cs / 2, h, { size: 24, mono: true, bold: true, tone: 'muted' })));
  g.cells.forEach((row, r) =>
    row.forEach((v, c) => {
      const t = g.tones?.[`${r},${c}`];
      out.push(box(`g${r}-${c}`, x0 + (c + side) * cs + 2, y0 + (r + head) * cs + 2, cs - 4, cs - 4, fmt(v), { mono: true, tone: t ?? 'default', filled: v !== '' }));
    }),
  );
}

function drawGraph(out: Shape[], g: NonNullable<Step['graph']>) {
  const pos = new Map(g.nodes.map((n) => [n.id, n]));
  g.edges.forEach((e, k) => {
    const a = pos.get(e.a);
    const b = pos.get(e.b);
    if (!a || !b) return;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const sh = 42 / len;
    const x1 = a.x + dx * sh;
    const y1 = a.y + dy * sh;
    const x2 = b.x - dx * sh;
    const y2 = b.y - dy * sh;
    out.push(e.dir ? arrow(`e${k}`, x1, y1, x2, y2, e.tone ?? 'muted') : line(`e${k}`, x1, y1, x2, y2, e.tone ?? 'muted', { width: e.tone && e.tone !== 'muted' ? 5 : 3 }));
    if (e.label) out.push(text(`el${k}`, (a.x + b.x) / 2 + 14, (a.y + b.y) / 2 - 14, e.label, { size: 24, mono: true, tone: 'muted' }));
  });
  g.nodes.forEach((n) => out.push(box(`n-${n.id}`, n.x - 40, n.y - 32, 80, 64, n.label, { mono: true, tone: n.tone ?? 'default', sub: n.sub })));
}

export function render(c: Case, steps: Step[], detail: Detail): Frame[] {
  const f = new Film();
  for (const s of steps) {
    const out: Shape[] = [];
    const head = box('prob', 20, 20, 960, 110, c.problem, { sub: c.input, tone: 'protocol' });
    if (head.t === 'rect') head.detail = detail;
    out.push(head);
    let y = TOP;
    if (s.grid) drawGrid(out, s.grid, y + (s.arr ? 240 : 0));
    if (s.graph) drawGraph(out, s.graph);
    if (s.arr) y = drawArray(out, s, y + 20) + 20;
    if (s.arr2) {
      const a2 = s.arr2;
      const n = a2.vals.length;
      const cw = Math.min(96, Math.floor(920 / Math.max(1, n)));
      const x0 = Math.round((1000 - cw * n) / 2);
      out.push(text('a2h', 30, y + 14, a2.label, { align: 'left', size: 24, bold: true, tone: 'muted' }));
      a2.vals.forEach((v, i) => out.push(box(`b${i}`, x0 + i * cw + 3, y + 34, cw - 6, 70, fmt(v), { mono: true, tone: a2.tones?.[i] ?? 'default', filled: v !== '' })));
      y += 124;
    }
    const ly = Math.max(y + 10, s.grid || s.graph ? 830 : y + 10);
    (s.lists ?? []).slice(0, 2).forEach((l, k) => drawList(out, `l${k}-`, l.label, l.items, l.tones, Math.min(900, ly + k * 90)));
    f.add(s.note, out, s.rows ? panel('State', s.rows) : undefined);
  }
  return f.frames;
}

/** Register one demo per pattern topic; each case (LeetCode problem) is a preset. */
export function patternDemo(group: string, slug: string, title: string, summary: string, cases: Case[]) {
  machineDemo({
    slug,
    title,
    group,
    summary,
    inputs: cases.map((c) => ({ id: c.id, label: c.label, data: { k: c.id } })),
    build: ({ k }: { k: string }) => {
      const c = cases.find((x) => x.id === k) ?? cases[0];
      return render(c, c.steps(), c.detail);
    },
  });
}

/** Binary tree layout from level-order array (null = missing). */
export function treeLayout(vals: (number | null)[], tones: Record<number, Tone> = {}, y0 = 260): { nodes: GNode[]; edges: GEdge[] } {
  const nodes: GNode[] = [];
  const edges: GEdge[] = [];
  vals.forEach((v, i) => {
    if (v === null) return;
    const level = Math.floor(Math.log2(i + 1));
    const idx = i - (2 ** level - 1);
    const span = 1000 / 2 ** level;
    nodes.push({ id: String(i), x: Math.round(span * idx + span / 2), y: y0 + level * 140, label: String(v), tone: tones[i] });
    if (i > 0 && vals[Math.floor((i - 1) / 2)] !== null) edges.push({ a: String(Math.floor((i - 1) / 2)), b: String(i) });
  });
  return { nodes, edges };
}
