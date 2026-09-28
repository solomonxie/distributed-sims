// Declarative box-and-arrow scenes: fixed nodes/edges, each beat restyles them and optionally highlights a code listing on top.
import type { Detail, Frame, Shape, Tone } from '../../algo/frames';
import { arrow, box, code, Film, machineDemo, panel, text } from './draw';
import type { Row } from './draw';

export interface BoardNode {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  sub?: string;
  dashed?: boolean;
  detail?: Detail;
}

export interface Beat {
  note: string;
  rows?: Row[];
  hl?: number[];
  /** node or edge (`a>b`) id → tone */
  hot?: Record<string, Tone>;
  label?: Record<string, string>;
  sub?: Record<string, string>;
  /** node or edge ids; edges touching a hidden node hide too */
  hide?: string[];
}

export interface Board {
  panel: string;
  code?: string[];
  codeTitle?: string;
  lh?: number;
  nodes: BoardNode[];
  edges: string[];
  beats: Beat[];
  rows?: Row[];
}

function anchors(a: BoardNode, b: BoardNode): [number, number, number, number] {
  const ax = a.x + a.w / 2;
  const bx = b.x + b.w / 2;
  if (b.y >= a.y + a.h) return [ax, a.y + a.h + 2, bx, b.y - 4];
  if (a.y >= b.y + b.h) return [ax, a.y - 2, bx, b.y + b.h + 4];
  const ay = a.y + a.h / 2;
  const by = b.y + b.h / 2;
  return b.x > a.x ? [a.x + a.w + 2, ay, b.x - 4, by] : [a.x - 2, ay, b.x + b.w + 4, by];
}

export function boardFrames(b: Board): Frame[] {
  const f = new Film();
  const byId = new Map(b.nodes.map((n) => [n.id, n]));
  const lh = b.lh ?? 36;
  for (const beat of b.beats) {
    const hide = new Set(beat.hide ?? []);
    const out: Shape[] = [];
    if (b.code) {
      out.push(text('ct', 20, 22, b.codeTitle ?? 'CMakeLists.txt', { align: 'left', size: 24, bold: true, tone: 'current' }));
      out.push(...code(b.code, 42, lh, beat.hl ?? []));
    }
    for (const e of b.edges) {
      const [from, to] = e.split('>');
      if (hide.has(e) || hide.has(from) || hide.has(to)) continue;
      const [x1, y1, x2, y2] = anchors(byId.get(from)!, byId.get(to)!);
      out.push(arrow(`e-${from}-${to}`, x1, y1, x2, y2, beat.hot?.[e] ?? 'muted'));
    }
    for (const n of b.nodes) {
      if (hide.has(n.id)) continue;
      const r = box(`n-${n.id}`, n.x, n.y, n.w, n.h, beat.label?.[n.id] ?? n.label, { sub: beat.sub?.[n.id] ?? n.sub, mono: true, tone: beat.hot?.[n.id] ?? 'default', dashed: n.dashed });
      if (n.detail && r.t === 'rect') r.detail = n.detail;
      out.push(r);
    }
    f.add(beat.note, out, panel(b.panel, beat.rows ?? b.rows ?? []));
  }
  return f.frames;
}

export const N = (id: string, x: number, y: number, w: number, h: number, label: string, sub?: string, o: { dashed?: boolean; detail?: Detail } = {}): BoardNode => ({ id, x, y, w, h, label, sub, ...o });

/** One demo, one board per input: `boards[id] = [chip label, board]`. `details` keyed by node label. */
export function boardDemo(group: string, slug: string, title: string, summary: string, boards: Record<string, [label: string, board: Board]>, details?: Record<string, Detail>) {
  machineDemo({
    slug,
    title,
    group,
    summary,
    inputs: Object.entries(boards).map(([id, [label]]) => ({ id, label, data: { k: id } })),
    build: ({ k }: { k: string }) => boardFrames(boards[k][1]),
    details,
  });
}
