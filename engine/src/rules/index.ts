// Static architecture rules — see engine.md → Rules checker.
import type { Catalog, ContainerSpec, EdgeSpec, Id, NodeSpec, SystemDoc } from '../types';
import { placementOf, type Placement } from '../model';

export interface RuleWarning {
  id: string;
  edgeId?: Id;
  nodeId?: Id;
  severity: 'warn' | 'info';
  rule: 'layered-upward' | 'layered-skip' | 'ddd-shared-db' | 'ddd-direct-call' | 'shared-db' | 'tenant-pool' | 'tenant-silo-breach' | 'public-data-store';
  message: string;
  help: string;
}

const DATA_TYPES = new Set([
  'relational-db', 'kv-store', 'document-db', 'cache', 'object-store', 'search-index',
  'time-series-db', 'graph-db', 'blob-cdn-origin', 'wide-column-db', 'data-warehouse',
, 'columnar-db', 'lakehouse', 'data-warehouse']);
const CLIENT_RE = /client|device|bot$/;
/** hops that just pass a client's request through */
const PASSTHROUGH = new Set(['dns', 'cdn', 'load-balancer', 'waf']);
const CONTEXT_GATES = new Set(['api-gateway', 'anti-corruption-layer']);
const LAYER_ORDER: Record<string, number> = { presentation: 0, ui: 0, web: 0, application: 1, service: 1, domain: 2, business: 2, infrastructure: 3, persistence: 3, data: 3 };

export function isDataStore(type: string, catalog?: Catalog): boolean {
  if (DATA_TYPES.has(type)) return true;
  const g = catalog?.types.find(t => t.type === type)?.group;
  return g === 'data';
}

function isClientType(type: string, catalog?: Catalog): boolean {
  return !!catalog?.types.find(t => t.type === type)?.client || CLIENT_RE.test(type);
}

export function checkRules(doc: SystemDoc, catalog?: Catalog): RuleWarning[] {
  const containers = new Map<Id, ContainerSpec>(doc.containers.map(c => [c.id, c]));
  const nodes = new Map<Id, NodeSpec>(doc.nodes.map(n => [n.id, n]));
  const place = new Map<Id, Placement>(doc.nodes.map(n => [n.id, placementOf(n, containers)]));
  const edges = doc.edges.filter(e => nodes.has(e.from) && nodes.has(e.to));
  const out: RuleWarning[] = [];
  const ctx = { doc, catalog, containers, nodes, place, edges, out };
  layered(ctx);
  ddd(ctx);
  sharedDb(ctx);
  tenancy(ctx);
  publicExposure(ctx);
  return out;
}

interface Ctx {
  doc: SystemDoc;
  catalog?: Catalog;
  containers: Map<Id, ContainerSpec>;
  nodes: Map<Id, NodeSpec>;
  place: Map<Id, Placement>;
  edges: EdgeSpec[];
  out: RuleWarning[];
}

const nameOf = (c: Ctx, id: Id) => c.nodes.get(id)?.name ?? c.containers.get(id)?.name ?? id;
const push = (c: Ctx, w: Omit<RuleWarning, 'id'>) => c.out.push({ id: `${w.rule}:${w.edgeId ?? w.nodeId}`, ...w });

// ---------- layered ----------

function layerOrderOf(c: Ctx, id: Id): number | undefined {
  const chain = c.place.get(id)?.chain ?? [];
  const layer = chain.map(cid => c.containers.get(cid)).find(k => k?.kind === 'layer');
  if (!layer) return undefined;
  return orderOf(layer);
}

function orderOf(k: ContainerSpec): number | undefined {
  const o = k.order ?? k.config?.order;
  return typeof o === 'number' ? o : LAYER_ORDER[k.name.trim().toLowerCase()];
}

function layered(c: Ctx) {
  const orders = new Set<number>();
  for (const k of c.containers.values()) {
    if (k.kind !== 'layer') continue;
    const o = orderOf(k);
    if (o !== undefined) orders.add(o);
  }
  for (const e of c.edges) {
    const a = layerOrderOf(c, e.from);
    const b = layerOrderOf(c, e.to);
    if (a === undefined || b === undefined || a === b) continue;
    const la = c.place.get(e.from)!.layer;
    const lb = c.place.get(e.to)!.layer;
    if (b < a) {
      if (e.config?.mode === 'async') continue; // events/callbacks upward are fine
      push(c, {
        edgeId: e.id, severity: 'warn', rule: 'layered-upward',
        message: `${nameOf(c, e.from)} (${la}) calls up into ${nameOf(c, e.to)} (${lb})`,
        help: 'Lower layers must not depend on upper ones. Invert the dependency (interface/callback) or publish an event.',
      });
    } else if ([...orders].some(o => o > a && o < b)) {
      push(c, {
        edgeId: e.id, severity: 'info', rule: 'layered-skip',
        message: `${nameOf(c, e.from)} (${la}) skips a layer to reach ${nameOf(c, e.to)} (${lb})`,
        help: 'Strict layering only calls the layer directly below. Route through the intermediate layer or relax the rule deliberately.',
      });
    }
  }
}

// ---------- DDD bounded contexts ----------

function ddd(c: Ctx) {
  for (const e of c.edges) {
    const a = c.place.get(e.from)!.context;
    const b = c.place.get(e.to)!.context;
    if (!a || !b || a === b) continue;
    const from = c.nodes.get(e.from)!;
    const to = c.nodes.get(e.to)!;
    if (isDataStore(to.type, c.catalog)) {
      push(c, {
        edgeId: e.id, severity: 'warn', rule: 'ddd-shared-db',
        message: `Shared database across contexts: ${nameOf(c, a)} reaches ${to.name} owned by ${nameOf(c, b)}`,
        help: "Each bounded context owns its data. Ask the owning context through its API, or subscribe to its domain events and keep a local copy.",
      });
    } else if (e.config?.mode !== 'async' && !CONTEXT_GATES.has(to.type) && !CONTEXT_GATES.has(from.type)) {
      push(c, {
        edgeId: e.id, severity: 'info', rule: 'ddd-direct-call',
        message: `${from.name} calls ${to.name} across contexts (${nameOf(c, a)} → ${nameOf(c, b)}) directly`,
        help: 'Cross-context calls should go through an API gateway / anti-corruption layer, or use async domain events.',
      });
    }
  }
}

// ---------- microservices shared-DB smell ----------

function sharedDb(c: Ctx) {
  const writers = new Map<Id, Set<Id>>();
  for (const e of c.edges) {
    const to = c.nodes.get(e.to)!;
    const from = c.nodes.get(e.from)!;
    if (!isDataStore(to.type, c.catalog) || isDataStore(from.type, c.catalog) || isClientType(from.type, c.catalog)) continue;
    if (PASSTHROUGH.has(from.type) || e.config?.op === 'read') continue;
    if (!writers.has(e.to)) writers.set(e.to, new Set());
    writers.get(e.to)!.add(e.from);
  }
  for (const [db, ws] of writers) {
    if (ws.size < 2) continue;
    const ctxs = [...ws].map(w => c.place.get(w)!.context);
    const distinct = new Set(ctxs);
    if (distinct.size < 2 && !ctxs.includes(undefined)) continue;
    push(c, {
      nodeId: db, severity: 'warn', rule: 'shared-db',
      message: `${ws.size} services write to ${nameOf(c, db)}: ${[...ws].map(w => nameOf(c, w)).join(', ')}`,
      help: 'Shared-database smell: schema changes and load couple the services. Give each service its own store; share data via APIs or events.',
    });
  }
}

// ---------- multi-tenancy ----------

function tenancy(c: Ctx) {
  const tenantBox = (id: Id) => {
    const chain = c.place.get(id)?.chain ?? [];
    return chain.map(cid => c.containers.get(cid)!).find(k => k?.kind === 'tenant');
  };
  const isolation = (k?: ContainerSpec) => String(k?.config?.isolation ?? 'pool');
  for (const e of c.edges) {
    const ta = tenantBox(e.from);
    const tb = tenantBox(e.to);
    const to = c.nodes.get(e.to)!;
    if (ta && tb && ta.id !== tb.id && (isolation(ta) === 'silo' || isolation(tb) === 'silo')) {
      push(c, {
        edgeId: e.id, severity: 'warn', rule: 'tenant-silo-breach',
        message: `${nameOf(c, e.from)} (${ta.name}) reaches ${to.name} in silo ${tb.name}`,
        help: 'Silo tenants get dedicated resources; cross-tenant links break the isolation guarantee.',
      });
      continue;
    }
    if (!ta || isolation(ta) !== 'pool' || !isDataStore(to.type, c.catalog)) continue;
    if (tb && isolation(tb) === 'silo') continue;
    const cfg = to.config ?? {};
    const keyed = cfg.shardBy === 'tenant' || cfg.partitionKey === 'tenant' || !!cfg.tenantKey || cfg.rowLevelSecurity === true;
    if (keyed) continue;
    push(c, {
      edgeId: e.id, severity: 'info', rule: 'tenant-pool',
      message: `Pooled tenant ${ta.name} shares ${to.name} with no tenant key`,
      help: 'In a pool model every row/key must carry the tenant id (partition key or row-level security) to prevent cross-tenant reads and to isolate noisy neighbours.',
    });
  }
}

// ---------- public exposure ----------

function publicExposure(c: Ctx) {
  const outBy = new Map<Id, EdgeSpec[]>();
  for (const e of c.edges) {
    if (!outBy.has(e.from)) outBy.set(e.from, []);
    outBy.get(e.from)!.push(e);
  }
  for (const n of c.nodes.values()) {
    if (!isClientType(n.type, c.catalog)) continue;
    const seen = new Set<Id>([n.id]);
    const stack = [n.id];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const e of outBy.get(cur) ?? []) {
        if (seen.has(e.to)) continue;
        seen.add(e.to);
        const to = c.nodes.get(e.to)!;
        if (isDataStore(to.type, c.catalog) && to.type !== 'object-store' && to.type !== 'blob-cdn-origin') {
          if (c.out.some(w => w.rule === 'public-data-store' && w.edgeId === e.id)) continue;
          push(c, {
            edgeId: e.id, severity: 'warn', rule: 'public-data-store',
            message: `${to.name} is reachable directly from client ${n.name}`,
            help: 'Data stores belong in a private subnet behind a service that authenticates and validates requests.',
          });
        } else if (PASSTHROUGH.has(to.type)) stack.push(e.to);
      }
    }
  }
}
