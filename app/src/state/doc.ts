import { create } from 'zustand';
import type { ContainerKind, EdgeConfig, NodeSpec, Point, SystemDoc } from '@dsims/engine';
import { catalog } from '@dsims/content';
import { saveSystem } from './library';
import { controller } from './run';

export type Selection = { kind: 'node' | 'edge' | 'container'; id: string } | null;

interface DocState {
  doc: SystemDoc | null;
  past: SystemDoc[];
  future: SystemDoc[];
  selection: Selection;
  multi: string[] | null;
  readOnly: boolean;
  load: (doc: SystemDoc, opts?: { readOnly?: boolean }) => void;
  close: () => void;
  commit: (fn: (d: SystemDoc) => void, opts?: { coalesce?: string }) => void;
  undo: () => void;
  redo: () => void;
  select: (s: Selection) => void;
  setMulti: (ids: string[] | null) => void;
  addNode: (type: string, skin: string | undefined, pos: Point) => string;
  moveNode: (id: string, pos: Point, final: boolean) => void;
  moveContainer: (id: string, dx: number, dy: number, final: boolean) => void;
  connect: (from: string, to: string) => string | null;
  setNodeConfig: (id: string, key: string, value: unknown) => void;
  setEdgeConfig: (id: string, patch: Partial<EdgeConfig>) => void;
  rename: (id: string, name: string) => void;
  setSkin: (id: string, skin: string) => void;
  remove: (s: NonNullable<Selection>) => void;
  duplicate: (id: string) => string | null;
  group: (ids: string[], kind: ContainerKind, name: string, config?: Record<string, unknown>) => string;
  toggleCollapse: (id: string) => void;
}

let lastCoalesce: string | undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

export const useDoc = create<DocState>((set, get) => ({
  doc: null,
  past: [],
  future: [],
  selection: null,
  multi: null,
  readOnly: false,

  load: (doc, opts) => set({ doc: clone(doc), past: [], future: [], selection: null, multi: null, readOnly: !!opts?.readOnly }),
  close: () => {
    flushSave();
    set({ doc: null, past: [], future: [], selection: null, multi: null });
  },

  commit: (fn, opts) => {
    const cur = get().doc;
    if (!cur) return;
    const next = clone(cur);
    fn(next);
    next.updatedAt = new Date().toISOString();
    const coalesce = opts?.coalesce && opts.coalesce === lastCoalesce;
    lastCoalesce = opts?.coalesce;
    set({ doc: next, past: coalesce ? get().past : [...get().past.slice(-99), cur], future: [] });
    scheduleSave();
  },

  undo: () => {
    const { past, doc, future } = get();
    if (!past.length || !doc) return;
    lastCoalesce = undefined;
    set({ doc: past[past.length - 1], past: past.slice(0, -1), future: [doc, ...future], selection: null });
    scheduleSave();
  },
  redo: () => {
    const { past, doc, future } = get();
    if (!future.length || !doc) return;
    lastCoalesce = undefined;
    set({ doc: future[0], past: [...past, doc], future: future.slice(1), selection: null });
    scheduleSave();
  },

  select: s => set({ selection: s }),
  setMulti: ids => set({ multi: ids }),

  addNode: (type, skin, pos) => {
    const d = get().doc!;
    const sk = skin ? catalog.skins.find(s => s.name === skin) : undefined;
    const t = catalog.types.find(x => x.type === type);
    const base = slug(sk?.label ?? t?.label ?? type);
    const id = uniqueId(d, base);
    const node: NodeSpec = { id, type, skin, name: id, pos: snap(pos), config: {} };
    get().commit(doc => {
      const parent = containerAt(doc, node.pos);
      if (parent) node.parent = parent;
      doc.nodes.push(node);
    });
    set({ selection: { kind: 'node', id } });
    return id;
  },

  moveNode: (id, pos, final) => {
    get().commit(
      doc => {
        const n = doc.nodes.find(x => x.id === id);
        if (!n) return;
        n.pos = final ? snap(pos) : pos;
        if (final) {
          const parent = containerAt(doc, n.pos, id);
          n.parent = parent;
        }
      },
      { coalesce: 'move:' + id },
    );
  },

  moveContainer: (id, dx, dy, final) => {
    get().commit(
      doc => {
        const ids = nodesInContainer(doc, id);
        for (const n of doc.nodes) {
          if (ids.has(n.id)) n.pos = final ? snap({ x: n.pos.x + dx, y: n.pos.y + dy }) : { x: n.pos.x + dx, y: n.pos.y + dy };
        }
      },
      { coalesce: 'movec:' + id },
    );
  },

  connect: (from, to) => {
    const d = get().doc!;
    if (from === to || d.edges.some(e => e.from === from && e.to === to)) return null;
    const id = `${from}->${to}`;
    get().commit(doc => {
      doc.edges.push({ id, from, to, config: {} });
    });
    set({ selection: { kind: 'edge', id } });
    return id;
  },

  setNodeConfig: (id, key, value) => {
    liveNode(id, key, value);
    get().commit(
      doc => {
        const n = doc.nodes.find(x => x.id === id);
        if (n) n.config = { ...(n.config ?? {}), [key]: value };
      },
      { coalesce: `cfg:${id}:${key}` },
    );
  },

  setEdgeConfig: (id, patch) => {
    liveEdge(id, patch);
    get().commit(
      doc => {
        const e = doc.edges.find(x => x.id === id);
        if (e) e.config = { ...(e.config ?? {}), ...patch };
      },
      { coalesce: `ecfg:${id}:${Object.keys(patch).join()}` },
    );
  },

  rename: (id, name) =>
    get().commit(doc => {
      const n = doc.nodes.find(x => x.id === id);
      if (n) n.name = name;
      const c = doc.containers.find(x => x.id === id);
      if (c) c.name = name;
      if (id === doc.id) doc.name = name;
    }),

  setSkin: (id, skin) =>
    get().commit(doc => {
      const n = doc.nodes.find(x => x.id === id);
      if (n) n.skin = skin;
    }),

  remove: s => {
    get().commit(doc => {
      if (s.kind === 'node') {
        doc.nodes = doc.nodes.filter(n => n.id !== s.id);
        doc.edges = doc.edges.filter(e => e.from !== s.id && e.to !== s.id);
        if (doc.scenario) doc.scenario.sources = doc.scenario.sources.filter(x => x.node !== s.id);
      } else if (s.kind === 'edge') {
        doc.edges = doc.edges.filter(e => e.id !== s.id);
      } else {
        const c = doc.containers.find(x => x.id === s.id);
        doc.containers = doc.containers.filter(x => x.id !== s.id);
        for (const n of doc.nodes) if (n.parent === s.id) n.parent = c?.parent;
        for (const x of doc.containers) if (x.parent === s.id) x.parent = c?.parent;
      }
    });
    set({ selection: null });
  },

  duplicate: id => {
    const d = get().doc!;
    const n = d.nodes.find(x => x.id === id);
    if (!n) return null;
    const nid = uniqueId(d, n.id.replace(/-\d+$/, ''));
    get().commit(doc => {
      doc.nodes.push({ ...clone(n), id: nid, name: nid, pos: { x: n.pos.x + 28, y: n.pos.y + 28 } });
    });
    set({ selection: { kind: 'node', id: nid } });
    return nid;
  },

  group: (ids, kind, name, config) => {
    const d = get().doc!;
    const id = uniqueId(d, kind === 'availability-zone' ? 'az' : kind);
    get().commit(doc => {
      const parents = new Set(doc.nodes.filter(n => ids.includes(n.id)).map(n => n.parent));
      const parent = parents.size === 1 ? [...parents][0] : undefined;
      doc.containers.push({ id, kind, name, parent, config });
      for (const n of doc.nodes) if (ids.includes(n.id)) n.parent = id;
    });
    set({ multi: null, selection: { kind: 'container', id } });
    return id;
  },

  toggleCollapse: id =>
    get().commit(doc => {
      const c = doc.containers.find(x => x.id === id);
      if (c) c.collapsed = !c.collapsed;
    }),
}));

function scheduleSave() {
  if (useDoc.getState().readOnly) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 600);
}

export function flushSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = undefined;
  const { doc, readOnly } = useDoc.getState();
  if (doc && !readOnly) saveSystem(doc).catch(() => {});
}

export const GRID = 24;
export const snap = (p: Point): Point => ({ x: Math.round(p.x / GRID) * GRID, y: Math.round(p.y / GRID) * GRID });

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 14) || 'node';

function uniqueId(d: SystemDoc, base: string): string {
  const taken = new Set([...d.nodes.map(n => n.id), ...d.containers.map(c => c.id)]);
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

export function nodesInContainer(d: SystemDoc, cid: string): Set<string> {
  const out = new Set<string>();
  const inside = (parent?: string): boolean => {
    let p = parent;
    let guard = 0;
    while (p && guard++ < 20) {
      if (p === cid) return true;
      p = d.containers.find(c => c.id === p)?.parent;
    }
    return false;
  };
  for (const n of d.nodes) if (inside(n.parent)) out.add(n.id);
  return out;
}

/** Innermost container whose computed bounds contain the point. */
export function containerAt(d: SystemDoc, p: Point, excludeNode?: string): string | undefined {
  let best: { id: string; area: number } | undefined;
  for (const c of d.containers) {
    const b = containerBounds(d, c.id, excludeNode);
    if (!b) continue;
    if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) {
      const area = b.w * b.h;
      if (!best || area < best.area) best = { id: c.id, area };
    }
  }
  return best?.id;
}

export const NODE_W = 156;
export const NODE_H = 56;
const PAD = 18;
const HEADER = 26;

export function containerBounds(d: SystemDoc, cid: string, excludeNode?: string): { x: number; y: number; w: number; h: number } | undefined {
  const ids = nodesInContainer(d, cid);
  if (excludeNode) ids.delete(excludeNode);
  const nodes = d.nodes.filter(n => ids.has(n.id));
  if (!nodes.length) return undefined;
  const depth = (id: string) => {
    let k = 0;
    let p = d.containers.find(c => c.id === id)?.parent;
    while (p) {
      k++;
      p = d.containers.find(c => c.id === p)?.parent;
    }
    return k;
  };
  const inner = d.containers.filter(c => c.parent === cid).length ? 1 : 0;
  const pad = PAD + inner * 12;
  const minX = Math.min(...nodes.map(n => n.pos.x - NODE_W / 2)) - pad;
  const minY = Math.min(...nodes.map(n => n.pos.y - NODE_H / 2)) - pad - HEADER - inner * 18;
  const maxX = Math.max(...nodes.map(n => n.pos.x + NODE_W / 2)) + pad;
  const maxY = Math.max(...nodes.map(n => n.pos.y + NODE_H / 2)) + pad;
  void depth;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Apply an edit to the running engine too, so knob changes take effect live. */
function liveNode(id: string, key: string, value: unknown) {
  const n = controller.run?.world.nodes.get(id);
  if (!n) return;
  n.cfg[key] = value;
  n.series.setCapacity(n.capacity);
  n.drain();
}

function liveEdge(id: string, patch: Partial<EdgeConfig>) {
  const e = controller.run?.world.edges.get(id);
  if (e) Object.assign(e.cfg, patch);
}
