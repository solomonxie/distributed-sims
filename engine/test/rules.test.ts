import { checkRules } from '../src/rules';
import type { ContainerSpec, SystemDoc } from '../src/types';
import { edge, node } from './fixtures';

const sys = (nodes: SystemDoc['nodes'], edges: SystemDoc['edges'], containers: ContainerSpec[] = []): SystemDoc => ({
  schemaVersion: 1, id: 't', name: 't', nodes, edges, containers,
});
const rulesOf = (d: SystemDoc) => checkRules(d).map(w => `${w.rule}@${w.edgeId ?? w.nodeId}`).sort();

test('layered: upward call is a violation, skipping a layer is flagged', () => {
  const layers: ContainerSpec[] = [
    { id: 'L0', kind: 'layer', name: 'Presentation', order: 0 },
    { id: 'L1', kind: 'layer', name: 'Application', order: 1 },
    { id: 'L2', kind: 'layer', name: 'Domain', order: 2 },
    { id: 'L3', kind: 'layer', name: 'Infrastructure', order: 3 },
  ];
  const d = sys(
    [node('web', 'service', {}, { parent: 'L0' }), node('app', 'service', {}, { parent: 'L1' }), node('dom', 'service', {}, { parent: 'L2' }), node('repo', 'service', {}, { parent: 'L3' })],
    [edge('web', 'app'), edge('app', 'dom'), edge('dom', 'repo'), edge('repo', 'web'), edge('web', 'dom'), edge('dom', 'app', { mode: 'async' })],
    layers,
  );
  expect(rulesOf(d)).toEqual(['layered-skip@web->dom', 'layered-upward@repo->web']);
  expect(checkRules(d).find(w => w.rule === 'layered-upward')!.severity).toBe('warn');
});

test('layered: order falls back to conventional layer names', () => {
  const d = sys([node('a', 'service', {}, { parent: 'd' }), node('b', 'service', {}, { parent: 'p' })], [edge('a', 'b')], [
    { id: 'p', kind: 'layer', name: 'Presentation' },
    { id: 'd', kind: 'layer', name: 'Domain' },
  ]);
  expect(rulesOf(d)).toEqual(['layered-upward@a->b']);
});

test('DDD: shared DB across contexts and direct cross-context calls', () => {
  const ctx: ContainerSpec[] = [
    { id: 'orders', kind: 'bounded-context', name: 'Orders' },
    { id: 'billing', kind: 'bounded-context', name: 'Billing' },
  ];
  const d = sys(
    [
      node('ord', 'service', {}, { parent: 'orders' }),
      node('odb', 'relational-db', {}, { parent: 'orders' }),
      node('bill', 'service', {}, { parent: 'billing' }),
      node('acl', 'anti-corruption-layer', {}, { parent: 'orders' }),
    ],
    [edge('ord', 'odb'), edge('bill', 'odb'), edge('bill', 'ord'), edge('bill', 'acl'), edge('ord', 'bill', { mode: 'async' })],
    ctx,
  );
  expect(rulesOf(d)).toEqual(['ddd-direct-call@bill->ord', 'ddd-shared-db@bill->odb', 'shared-db@odb']);
});

test('shared-DB smell only for services in different or no contexts', () => {
  const two = sys([node('a'), node('b'), node('db', 'kv-store')], [edge('a', 'db'), edge('b', 'db')]);
  expect(rulesOf(two)).toEqual(['shared-db@db']);
  const same = sys([node('a', 'service', {}, { parent: 'x' }), node('b', 'service', {}, { parent: 'x' }), node('db', 'kv-store', {}, { parent: 'x' })], [edge('a', 'db'), edge('b', 'db')], [
    { id: 'x', kind: 'bounded-context', name: 'X' },
  ]);
  expect(rulesOf(same)).toEqual([]);
  const reader = sys([node('a'), node('b'), node('db', 'kv-store')], [edge('a', 'db'), edge('b', 'db', { op: 'read' })]);
  expect(rulesOf(reader)).toEqual([]);
});

test('multi-tenant pool without tenant key, silo breach', () => {
  const t: ContainerSpec[] = [
    { id: 'pool', kind: 'tenant', name: 'Pool', config: { isolation: 'pool' } },
    { id: 'big', kind: 'tenant', name: 'BigCo', config: { isolation: 'silo' } },
  ];
  const d = sys(
    [node('api', 'service', {}, { parent: 'pool' }), node('db', 'relational-db'), node('db2', 'kv-store', { shardBy: 'tenant' }), node('bigapi', 'service', {}, { parent: 'big' })],
    [edge('api', 'db'), edge('api', 'db2'), edge('api', 'bigapi')],
    t,
  );
  expect(rulesOf(d)).toEqual(['tenant-pool@api->db', 'tenant-silo-breach@api->bigapi']);
});

test('public exposure through a load balancer', () => {
  const d = sys([node('c', 'web-client'), node('lb', 'load-balancer'), node('db', 'relational-db'), node('api'), node('cache', 'cache')], [
    edge('c', 'lb'), edge('lb', 'db'), edge('c', 'api'), edge('api', 'cache'),
  ]);
  expect(rulesOf(d)).toEqual(['public-data-store@lb->db']);
});
