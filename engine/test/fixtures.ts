import type { Catalog, EdgeConfig, NodeSpec, Scenario, SystemDoc } from '../src/types';

export const testCatalog: Catalog = {
  groups: [{ id: 'compute', label: 'Compute' }],
  types: [
    { type: 'web-client', group: 'clients', label: 'Web', description: '', icon: 'web', knobs: [], client: true },
    {
      type: 'service', group: 'compute', label: 'Service', description: '', icon: 'svc',
      knobs: [
        { key: 'instances', label: 'Instances', kind: 'int', default: 2 },
        { key: 'slots', label: 'Slots', kind: 'int', default: 16 },
        { key: 'p50Ms', label: 'p50', kind: 'ms', default: 5 },
        { key: 'p99Ms', label: 'p99', kind: 'ms', default: 25 },
      ],
    },
  ],
  skins: [],
  containers: [],
};

export function node(id: string, type = 'service', config: Record<string, unknown> = {}, extra: Partial<NodeSpec> = {}): NodeSpec {
  return { id, type, name: id, pos: { x: 0, y: 0 }, config, ...extra };
}

export function edge(from: string, to: string, config: EdgeConfig = {}) {
  return { id: `${from}->${to}`, from, to, config };
}

export function doc(nodes: NodeSpec[], edges: ReturnType<typeof edge>[], scenario?: Partial<Scenario>, extra: Partial<SystemDoc> = {}): SystemDoc {
  return {
    schemaVersion: 1, id: 't', name: 't', nodes, edges, containers: [],
    scenario: { sources: [{ id: 's', node: 'c', shape: { kind: 'constant', rps: 200 } }], events: [], ...scenario },
    ...extra,
  };
}
