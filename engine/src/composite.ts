// Composite components (technologies.md → Composite component model):
// a skin with `internals` (a SystemDoc) + `ports` is replaced by its sub-graph.
import type { Badge, Catalog, EdgeSpec, Health, Id, NodeSpec, SystemDoc } from './types';
import type { NodeSnap, Snapshot } from './run';
import type { Flight } from './world';
import type { SimNode } from './node';

/** composite id → inner node ids; the in-port node is always first. */
export type Members = Record<Id, Id[]>;

const MAX_DEPTH = 4;

export function isComposite(skinName: string | undefined, catalog: Catalog): boolean {
  const s = skinName ? catalog.skins.find(x => x.name === skinName) : undefined;
  return !!(s?.internals && s.ports?.in);
}

/** Replace every composite node by its internals (ids prefixed `${nodeId}/`), rewiring edges and scenario. */
export function expandComposites(doc: SystemDoc, catalog: Catalog): { doc: SystemDoc; members: Members } {
  let cur = doc;
  const members: Members = {};
  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    const next = expandOnce(cur, catalog, members);
    if (next === cur) break;
    cur = next;
  }
  // nested composites: resolve members to leaf ids
  for (const id of Object.keys(members)) members[id] = leafMembers(id, members);
  return { doc: cur, members };
}

function leafMembers(id: Id, members: Members, guard = 0): Id[] {
  const out: Id[] = [];
  for (const m of members[id] ?? []) {
    if (members[m] && guard < MAX_DEPTH) out.push(...leafMembers(m, members, guard + 1));
    else out.push(m);
  }
  return out;
}

function expandOnce(doc: SystemDoc, catalog: Catalog, members: Members): SystemDoc {
  const comps = doc.nodes.filter(n => isComposite(n.skin, catalog));
  if (!comps.length) return doc;
  const portIn = new Map<Id, Id>();
  const portOut = new Map<Id, Id>();
  const nodes: NodeSpec[] = [];
  const edges: EdgeSpec[] = [];
  const containers = [...doc.containers];

  for (const n of doc.nodes) {
    const skin = comps.includes(n) ? catalog.skins.find(s => s.name === n.skin) : undefined;
    if (!skin?.internals || !skin.ports) {
      nodes.push(n);
      continue;
    }
    const inner = skin.internals;
    const pre = (id: Id) => `${n.id}/${id}`;
    const inId = pre(skin.ports.in);
    portIn.set(n.id, inId);
    portOut.set(n.id, pre(skin.ports.out ?? skin.ports.in));
    for (const c of inner.containers ?? []) containers.push({ ...c, id: pre(c.id), parent: c.parent ? pre(c.parent) : n.parent });
    const ids: Id[] = [];
    for (const x of inner.nodes) {
      ids.push(pre(x.id));
      nodes.push({ ...x, id: pre(x.id), parent: x.parent ? pre(x.parent) : n.parent, config: { ...(x.config ?? {}) } });
    }
    members[n.id] = [inId, ...ids.filter(i => i !== inId)];
    for (const e of inner.edges ?? []) edges.push({ ...e, id: pre(e.id), from: pre(e.from), to: pre(e.to) });
  }

  for (const e of doc.edges) {
    edges.push({ ...e, from: portOut.get(e.from) ?? e.from, to: portIn.get(e.to) ?? e.to });
  }
  const retarget = (id?: Id) => (id ? portIn.get(id) ?? id : id);
  const sc = doc.scenario;
  return {
    ...doc,
    nodes,
    edges,
    containers,
    alerts: doc.alerts?.map(a => (a.target === 'system' ? a : { ...a, target: retarget(a.target)! })),
    scenario: sc && {
      ...sc,
      sources: sc.sources.map(s => ({ ...s, node: retarget(s.node)! })),
      events: sc.events.map(ev =>
        ev.event.kind === 'traffic' ? ev : { ...ev, event: { ...ev.event, target: retarget((ev.event as any).target), target2: retarget((ev.event as any).target2) } },
      ),
    },
  };
}

const HEALTH_RANK: Record<Health, number> = { ok: 0, warn: 1, fail: 2, down: 3 };
const TONE_RANK: Record<string, number> = { fail: 0, warn: 1, accent: 2, protocol: 3, ok: 4, muted: 5 };

/** Add a synthetic NodeSnap per composite id, aggregated from its members. */
export function aggregateSnapshot(snapshot: Snapshot, members: Members): Snapshot {
  const nodes = { ...snapshot.nodes };
  for (const [id, ids] of Object.entries(members)) {
    const snaps = ids.map(i => snapshot.nodes[i]).filter((s): s is NodeSnap => !!s);
    if (!snaps.length) continue;
    const port = snapshot.nodes[ids[0]] ?? snaps[0];
    const anyUp = snaps.some(s => s.up);
    let health: Health = 'ok';
    for (const s of snaps) if (HEALTH_RANK[s.health] > HEALTH_RANK[health]) health = s.health;
    if (health === 'down' && anyUp) health = 'fail';
    const gauges: Record<string, number> = {};
    for (const s of snaps) for (const [k, v] of Object.entries(s.gauges)) gauges[k] = Math.max(gauges[k] ?? -Infinity, v);
    Object.assign(gauges, port.gauges);
    nodes[id] = {
      id,
      up: anyUp,
      health,
      rps: port.rps,
      p50: port.p50,
      p99: port.p99,
      errRate: port.errRate,
      util: Math.max(...snaps.map(s => s.util)),
      queue: snaps.reduce((a, s) => a + s.queue, 0),
      memMb: snaps.reduce((a, s) => a + s.memMb, 0),
      badges: topBadges(snaps.flatMap(s => s.badges), 2),
      gauges,
      spark: port.spark,
      alerting: snaps.some(s => s.alerting),
      chaos: [...new Set(snaps.flatMap(s => s.chaos))],
    };
  }
  return { ...snapshot, nodes };
}

function topBadges(all: Badge[], k: number): Badge[] {
  const seen = new Set<string>();
  const uniq = all.filter(b => !seen.has(b.text) && seen.add(b.text));
  return uniq.sort((a, b) => (TONE_RANK[a.tone ?? 'muted'] ?? 5) - (TONE_RANK[b.tone ?? 'muted'] ?? 5)).slice(0, k);
}

/** Outer (collapsed) id for an inner id, else the id itself. */
export function outerId(id: Id, members: Members): Id {
  for (const [c, ids] of Object.entries(members)) if (ids.includes(id)) return c;
  return id;
}

/** Flights for the collapsed view: endpoints mapped to composites, purely internal ones dropped. */
export function collapseFlights(flights: Flight[], members: Members): Flight[] {
  const map = new Map<Id, Id>();
  for (const [c, ids] of Object.entries(members)) for (const i of ids) map.set(i, c);
  const out: Flight[] = [];
  for (const f of flights) {
    const from = map.get(f.from) ?? f.from;
    const to = map.get(f.to) ?? f.to;
    if (from !== to) out.push(from === f.from && to === f.to ? f : { ...f, from, to });
  }
  return out;
}

// ---------- helpers for internals behaviours ----------

/** Namespace for a node's cluster: explicit `cluster` config, else composite prefix, else dflt. */
export function clusterOf(n: SimNode, dflt: string): string {
  const c = n.cfg['cluster'];
  if (typeof c === 'string' && c) return c;
  const i = n.id.lastIndexOf('/');
  return i > 0 ? n.id.slice(0, i) : dflt;
}

/** Credit protocol traffic to a drawn edge between two nodes (either direction) so it animates as busy. */
export function touchEdge(n: SimNode, to: Id, w: number, ok = true) {
  const e = n.outEdges(x => x.to === to)[0] ?? n.world.out.get(to)?.find(x => x.to === n.id);
  if (!e) return;
  e.series.cur.inW += w;
  if (ok) e.series.cur.okW += w;
  else e.series.cur.errW += w;
}
