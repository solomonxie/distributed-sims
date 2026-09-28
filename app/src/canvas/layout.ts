import type { SystemDoc } from '@dsims/engine';
import { catalog } from '@dsims/content';
import { containerBounds, NODE_H, NODE_W } from '../state/doc';

export interface RNode {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  name: string;
  sub: string;
  icon: string;
  type: string;
  composite: boolean;
  hidden: boolean;
}

export interface RContainer {
  id: string;
  kind: string;
  name: string;
  icon: string;
  x: number;
  y: number;
  w: number;
  h: number;
  depth: number;
  collapsed: boolean;
  hidden: boolean;
  count: number;
}

export interface REdge {
  id: string;
  from: string;
  to: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  async: boolean;
  hidden: boolean;
}

export interface Layout {
  nodes: RNode[];
  containers: RContainer[];
  edges: REdge[];
  /** node id → rendered anchor (collapsed members map to their container box) */
  anchor: Record<string, { x: number; y: number; w: number; h: number }>;
  bounds: { x: number; y: number; w: number; h: number };
}

const typeOf = new Map(catalog.types.map(t => [t.type, t]));
const skinOf = new Map(catalog.skins.map(s => [s.name, s]));
const containerIcon: Record<string, string> = Object.fromEntries(
  catalog.containers.map(c => [c.kind, c.icon ?? 'square-dashed']),
);

export function nodeIcon(type: string, skin?: string): string {
  const s = skin ? skinOf.get(skin) : undefined;
  return s?.icon ?? typeOf.get(type)?.icon ?? 'box';
}

export function nodeSubtitle(type: string, skin?: string): string {
  const s = skin ? skinOf.get(skin) : undefined;
  return s?.label ?? typeOf.get(type)?.label ?? type;
}

export function computeLayout(doc: SystemDoc): Layout {
  const byId = new Map(doc.containers.map(c => [c.id, c]));
  const collapsedAncestor = (parent?: string): string | undefined => {
    let top: string | undefined;
    let p = parent;
    let guard = 0;
    while (p && guard++ < 20) {
      const c = byId.get(p);
      if (!c) break;
      if (c.collapsed) top = c.id;
      p = c.parent;
    }
    return top;
  };
  const depthOf = (id: string) => {
    let d = 0;
    let p = byId.get(id)?.parent;
    while (p && d < 20) {
      d++;
      p = byId.get(p)?.parent;
    }
    return d;
  };

  const containers: RContainer[] = [];
  for (const c of doc.containers) {
    const b = containerBounds(doc, c.id);
    if (!b) continue;
    const hiddenBy = collapsedAncestor(c.parent);
    const count = doc.nodes.filter(n => {
      let p = n.parent;
      while (p) {
        if (p === c.id) return true;
        p = byId.get(p)?.parent;
      }
      return false;
    }).length;
    const collapsed = !!c.collapsed;
    const box = collapsed ? { x: b.x + b.w / 2 - 88, y: b.y + b.h / 2 - 34, w: 176, h: 68 } : b;
    containers.push({
      id: c.id,
      kind: c.kind,
      name: c.name,
      icon: containerIcon[c.kind] ?? 'square-dashed',
      ...box,
      depth: depthOf(c.id),
      collapsed,
      hidden: !!hiddenBy,
      count,
    });
  }
  containers.sort((a, b) => a.depth - b.depth);
  const cMap = new Map(containers.map(c => [c.id, c]));

  const anchor: Layout['anchor'] = {};
  const nodes: RNode[] = doc.nodes.map(n => {
    const hiddenBy = collapsedAncestor(n.parent);
    const rn: RNode = {
      id: n.id,
      x: n.pos.x,
      y: n.pos.y,
      w: NODE_W,
      h: NODE_H,
      name: n.name,
      sub: nodeSubtitle(n.type, n.skin),
      icon: nodeIcon(n.type, n.skin),
      type: n.type,
      composite: !!(n.skin && skinOf.get(n.skin)?.internals),
      hidden: !!hiddenBy,
    };
    if (hiddenBy) {
      const c = cMap.get(hiddenBy)!;
      anchor[n.id] = { x: c.x + c.w / 2, y: c.y + c.h / 2, w: c.w, h: c.h };
    } else anchor[n.id] = { x: n.pos.x, y: n.pos.y, w: NODE_W, h: NODE_H };
    return rn;
  });

  const edges: REdge[] = [];
  for (const e of doc.edges) {
    const a = anchor[e.from];
    const b = anchor[e.to];
    if (!a || !b) continue;
    const same = a.x === b.x && a.y === b.y;
    const [x1, y1] = borderPoint(a, b.x, b.y, 3);
    const [x2, y2] = borderPoint(b, a.x, a.y, 7);
    edges.push({ id: e.id, from: e.from, to: e.to, x1, y1, x2, y2, async: e.config?.mode === 'async', hidden: same });
  }

  const xs = [...nodes.filter(n => !n.hidden).flatMap(n => [n.x - n.w / 2, n.x + n.w / 2]), ...containers.filter(c => !c.hidden).flatMap(c => [c.x, c.x + c.w])];
  const ys = [...nodes.filter(n => !n.hidden).flatMap(n => [n.y - n.h / 2, n.y + n.h / 2]), ...containers.filter(c => !c.hidden).flatMap(c => [c.y, c.y + c.h])];
  const bounds = xs.length
    ? { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }
    : { x: -200, y: -300, w: 400, h: 600 };
  return { nodes, containers, edges, anchor, bounds };
}

/** Point on the (inflated) rect border along the line from its centre to (tx, ty). */
export function borderPoint(r: { x: number; y: number; w: number; h: number }, tx: number, ty: number, inflate = 0): [number, number] {
  const dx = tx - r.x;
  const dy = ty - r.y;
  if (dx === 0 && dy === 0) return [r.x, r.y];
  const hw = r.w / 2 + inflate;
  const hh = r.h / 2 + inflate;
  const s = Math.min(Math.abs(dx) > 0 ? hw / Math.abs(dx) : Infinity, Math.abs(dy) > 0 ? hh / Math.abs(dy) : Infinity);
  return [r.x + dx * s, r.y + dy * s];
}

export function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l2)) : 0;
  const cx = x1 + t * dx;
  const cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

export type Hit = { kind: 'node' | 'edge' | 'container' | 'container-header'; id: string } | null;

export function hitTest(l: Layout, x: number, y: number, slop = 6): Hit {
  for (let i = l.nodes.length - 1; i >= 0; i--) {
    const n = l.nodes[i];
    if (n.hidden) continue;
    if (Math.abs(x - n.x) <= n.w / 2 + slop && Math.abs(y - n.y) <= n.h / 2 + slop) return { kind: 'node', id: n.id };
  }
  for (let i = l.containers.length - 1; i >= 0; i--) {
    const c = l.containers[i];
    if (c.hidden) continue;
    if (c.collapsed && x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h) return { kind: 'container', id: c.id };
    if (x >= c.x && x <= c.x + Math.min(c.w, 220) && y >= c.y - 4 && y <= c.y + 30) return { kind: 'container-header', id: c.id };
  }
  // connections aren't tap targets — they're edited from the component's details
  for (let i = l.containers.length - 1; i >= 0; i--) {
    const c = l.containers[i];
    if (!c.hidden && x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h) return { kind: 'container', id: c.id };
  }
  return null;
}
