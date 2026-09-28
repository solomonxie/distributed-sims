// Shape helpers shared by algorithm demos.
import type { Frame, GraphInput, PanelRow, Shape, Tone } from '../frames';

export const INF = Number.POSITIVE_INFINITY;

export const fmt = (d: number) => (d === INF ? '∞' : Number.isInteger(d) ? String(d) : d.toFixed(1));

export const clamp = (v: number, lo = 0, hi = 1000) => Math.max(lo, Math.min(hi, v));

export function frame(note: string, shapes: Shape[], panel?: { title: string; rows: PanelRow[] }, done?: boolean): Frame {
  const f: Frame = { note, shapes };
  if (panel) f.panel = panel;
  if (done) f.done = true;
  return f;
}

/** Point on a circle; angle in degrees, 0 = top, clockwise. */
export function polar(cx: number, cy: number, r: number, deg: number) {
  const a = (deg * Math.PI) / 180;
  return { x: cx + r * Math.sin(a), y: cy - r * Math.cos(a) };
}

export const text = (id: string, x: number, y: number, t: string, o: Partial<Extract<Shape, { t: 'text' }>> = {}): Shape => ({
  t: 'text', id, x, y, text: t, ...o,
});

// ---- graphs ----

export interface Adj {
  to: string;
  w: number;
  key: string;
}

export const edgeKey = (e: { from: string; to: string }) => `e:${e.from}-${e.to}`;

export function adjacency(g: GraphInput): Map<string, Adj[]> {
  const adj = new Map<string, Adj[]>(g.nodes.map(n => [n.id, []]));
  for (const e of g.edges) {
    const key = edgeKey(e);
    adj.get(e.from)?.push({ to: e.to, w: e.w, key });
    if (!e.directed) adj.get(e.to)?.push({ to: e.from, w: e.w, key });
  }
  for (const list of adj.values()) list.sort((a, b) => a.to.localeCompare(b.to));
  return adj;
}

export function label(g: GraphInput, id: string) {
  return g.nodes.find(n => n.id === id)?.label ?? id;
}

export interface GraphStyle {
  node?: (id: string) => { tone?: Tone; sub?: string; badge?: string } | undefined;
  edge?: (key: string) => Tone | undefined;
  hideWeights?: boolean;
  extra?: Shape[];
}

/** Circle radius that fits the label at a readable size. */
export const nodeRadius = (lbl: string) => (lbl.length <= 2 ? 38 : Math.min(60, 14 + lbl.length * 9));

export function graphShapes(g: GraphInput, s: GraphStyle = {}): Shape[] {
  const out: Shape[] = [];
  for (const e of g.edges) {
    const key = edgeKey(e);
    out.push({
      t: 'edge', id: key, from: e.from, to: e.to,
      label: s.hideWeights ? undefined : String(e.w),
      arrow: !!e.directed,
      tone: s.edge?.(key) ?? 'default',
    });
  }
  if (s.extra) out.push(...s.extra);
  for (const n of g.nodes) {
    const st = s.node?.(n.id) ?? {};
    const lbl = n.label ?? n.id;
    const shape: Shape = { t: 'node', id: n.id, x: clamp(n.x), y: clamp(n.y), r: nodeRadius(lbl), label: lbl, tone: st.tone ?? 'default' };
    if (st.sub !== undefined) shape.sub = st.sub;
    if (st.badge !== undefined) shape.badge = st.badge;
    out.push(shape);
  }
  return out;
}

/** Walk prev pointers back from target. */
export function pathTo(prev: Map<string, { from: string; key: string }>, target: string) {
  const nodes = [target];
  const keys: string[] = [];
  let cur = target;
  const seen = new Set([cur]);
  while (prev.has(cur)) {
    const p = prev.get(cur)!;
    keys.push(p.key);
    cur = p.from;
    if (seen.has(cur)) break;
    seen.add(cur);
    nodes.unshift(cur);
  }
  return { nodes, keys: new Set(keys) };
}

// ---- trees ----

export interface TreeNode {
  id: string;
  children: TreeNode[];
}

/** Leaves spread evenly across [x0, x1]; parents centred over children. */
export function layoutTree<T extends TreeNode>(root: T, x0: number, x1: number, y0: number, dy: number) {
  const pos = new Map<string, { x: number; y: number; depth: number }>();
  const leaves: T[] = [];
  const walk = (n: T, d: number) => {
    if (!n.children.length) leaves.push(n);
    for (const c of n.children) walk(c as T, d + 1);
  };
  walk(root, 0);
  const step = leaves.length > 1 ? (x1 - x0) / (leaves.length - 1) : 0;
  let i = 0;
  const place = (n: T, d: number): number => {
    let x: number;
    if (!n.children.length) x = leaves.length > 1 ? x0 + step * i++ : (x0 + x1) / 2;
    else {
      const xs = n.children.map(c => place(c as T, d + 1));
      x = (xs[0] + xs[xs.length - 1]) / 2;
    }
    pos.set(n.id, { x, y: y0 + d * dy, depth: d });
    return x;
  };
  place(root, 0);
  return pos;
}
