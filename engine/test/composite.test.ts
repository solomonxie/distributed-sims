import { createRun } from '../src';
import { aggregateSnapshot, collapseFlights, expandComposites, outerId } from '../src/composite';
import { kafkaCluster } from '../src/behaviors/tech-kafka';
import type { Catalog, SystemDoc } from '../src/types';
import { doc, edge, node, testCatalog } from './fixtures';

const pairSkin = {
  name: 'pair',
  type: 'service',
  label: 'Pair',
  description: '',
  icon: 'box',
  defaults: {},
  ports: { in: 'a', out: 'b' },
  internals: {
    schemaVersion: 1,
    id: 'pair',
    name: 'pair',
    nodes: [node('a', 'service', { p50Ms: 1, p99Ms: 3 }, { parent: 'inner' }), node('b', 'service', { p50Ms: 1, p99Ms: 3 })],
    edges: [edge('a', 'b')],
    containers: [{ id: 'inner', kind: 'layer', name: 'inner' }],
  } as SystemDoc,
};

const kafkaSkin = {
  name: 'kafka-cluster',
  type: 'log-stream',
  label: 'Kafka',
  description: '',
  icon: 'box',
  defaults: {},
  ports: { in: 'producer', out: 'consumer' },
  internals: {
    schemaVersion: 1,
    id: 'kc',
    name: 'kc',
    nodes: [
      node('producer', 'kafka-producer'),
      node('broker-1', 'kafka-broker'),
      node('broker-2', 'kafka-broker'),
      node('broker-3', 'kafka-broker'),
      node('controller', 'kraft-controller'),
      node('consumer', 'kafka-consumer', { slots: 1 }),
    ],
    edges: [],
    containers: [],
  } as SystemDoc,
};

const catalog: Catalog = { ...testCatalog, skins: [pairSkin, kafkaSkin] };

const outer = () =>
  doc(
    [node('c', 'web-client'), node('k', 'service', {}, { skin: 'pair', parent: 'az1' }), node('w')],
    [edge('c', 'k'), edge('k', 'w')],
    { events: [{ atSec: 5, event: { kind: 'kill', target: 'k' } }] },
    { containers: [{ id: 'az1', kind: 'availability-zone', name: 'az1' }] },
  );

test('expands internals with prefixed ids and rewires edges through the ports', () => {
  const { doc: d, members } = expandComposites(outer(), catalog);
  expect(d.nodes.map(n => n.id).sort()).toEqual(['c', 'k/a', 'k/b', 'w']);
  expect(members).toEqual({ k: ['k/a', 'k/b'] });
  const e = Object.fromEntries(d.edges.map(x => [x.id, `${x.from}>${x.to}`]));
  expect(e['c->k']).toBe('c>k/a');
  expect(e['k->w']).toBe('k/b>w');
  expect(e['k/a->b']).toBe('k/a>k/b');
  // containers: inner ones prefixed and parented under the composite's parent
  expect(d.containers.find(c => c.id === 'k/inner')?.parent).toBe('az1');
  expect(d.nodes.find(n => n.id === 'k/a')?.parent).toBe('k/inner');
  expect(d.nodes.find(n => n.id === 'k/b')?.parent).toBe('az1');
  // scenario events retarget to the in-port
  expect((d.scenario!.events[0].event as any).target).toBe('k/a');
});

test('leaves docs without composites untouched', () => {
  const plain = doc([node('c', 'web-client'), node('api')], [edge('c', 'api')]);
  const r = expandComposites(plain, catalog);
  expect(r.doc).toBe(plain);
  expect(r.members).toEqual({});
});

test('sources on a composite retarget to the in-port', () => {
  const d = doc([node('k', 'service', {}, { skin: 'pair' })], [], { sources: [{ id: 's', node: 'k', shape: { kind: 'constant', rps: 10 } }] });
  expect(expandComposites(d, catalog).doc.scenario!.sources[0].node).toBe('k/a');
});

test('aggregate snapshot: in-port traffic, worst member health, one dead member is not "down"', () => {
  const src = outer();
  src.scenario!.events = [];
  const { doc: d, members } = expandComposites(src, catalog);
  const r = createRun(d, { catalog, seed: 3 });
  r.step(5000, 1e9);
  let s = aggregateSnapshot(r.snapshot(), members);
  expect(s.nodes.k.rps).toBeCloseTo(s.nodes['k/a'].rps);
  expect(s.nodes.k.health).toBe('ok');
  expect(s.nodes.k.up).toBe(true);
  r.fire({ kind: 'kill', target: 'k/b' });
  r.step(9000, 1e9);
  s = aggregateSnapshot(r.snapshot(), members);
  expect(s.nodes.k.up).toBe(true);
  expect(s.nodes.k.health).toBe('fail');
  expect(s.nodes.k.chaos).toContain('kill');
  expect(outerId('k/b', members)).toBe('k');
  const flights = collapseFlights(r.snapshot().flights, members);
  expect(flights.every(f => f.from !== f.to && !String(f.from).startsWith('k/'))).toBe(true);
});

test('a collapsed Kafka node runs real internals and feeds downstream', () => {
  const src = doc(
    [node('c', 'web-client'), node('k', 'log-stream', {}, { skin: 'kafka-cluster' }), node('w', 'service', { p50Ms: 1, p99Ms: 3 })],
    [edge('c', 'k'), edge('k', 'w')],
    { sources: [{ id: 's', node: 'c', shape: { kind: 'constant', rps: 300 }, readRatio: 0 }] },
  );
  const { doc: d, members } = expandComposites(src, catalog);
  const r = createRun(d, { catalog, seed: 1 });
  r.step(8000, 1e9);
  const s = aggregateSnapshot(r.snapshot(), members);
  expect(kafkaCluster(r.world, 'k')?.brokers).toEqual(['k/broker-1', 'k/broker-2', 'k/broker-3']);
  expect(s.system.availability).toBeGreaterThan(99);
  expect(s.nodes.w.rps).toBeGreaterThan(50);
  expect(s.nodes.k.rps).toBeGreaterThan(200);
  expect(r.protocol().some(p => p.kind === 'kafka.Produce')).toBe(true);
});
