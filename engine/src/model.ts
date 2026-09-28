import type { Catalog, Config, ContainerSpec, Id, NodeSpec } from './types';

/** skin defaults → type knob defaults → instance config */
export function resolveConfig(n: NodeSpec, catalog: Catalog): Config {
  const type = catalog.types.find(t => t.type === n.type);
  const skin = n.skin ? catalog.skins.find(s => s.name === n.skin) : undefined;
  const base: Config = {};
  for (const k of type?.knobs ?? []) base[k.key] = k.default;
  return { ...base, ...(skin?.defaults ?? {}), ...(n.config ?? {}) };
}

export interface Placement {
  region?: string;
  az?: string;
  cell?: string;
  tenant?: string;
  layer?: string;
  layerOrder?: number;
  context?: string;
  vpc?: string;
  chain: Id[];
}

export function placementOf(n: { parent?: Id }, containers: Map<Id, ContainerSpec>): Placement {
  const p: Placement = { chain: [] };
  let cur = n.parent ? containers.get(n.parent) : undefined;
  let guard = 0;
  while (cur && guard++ < 20) {
    p.chain.push(cur.id);
    switch (cur.kind) {
      case 'region':
        p.region ??= cur.name;
        break;
      case 'availability-zone':
        p.az ??= cur.id;
        break;
      case 'cell':
        p.cell ??= cur.id;
        break;
      case 'tenant':
        p.tenant ??= cur.name;
        break;
      case 'layer':
        p.layer ??= cur.name;
        p.layerOrder ??= cur.order;
        break;
      case 'bounded-context':
        p.context ??= cur.id;
        break;
      case 'vpc':
        p.vpc ??= cur.id;
        break;
    }
    cur = cur.parent ? containers.get(cur.parent) : undefined;
  }
  return p;
}

/** All node ids inside a container (recursively). */
export function nodesIn(containerId: Id, nodes: NodeSpec[], containers: Map<Id, ContainerSpec>): Id[] {
  return nodes.filter(n => placementOf(n, containers).chain.includes(containerId)).map(n => n.id);
}
