// Engine throughput bench: ~60 nodes, budgeted traffic. Budget: 20k events/s virtual at 1×.
import { readFileSync } from 'fs';
import { createRun, type SystemDoc } from '../src';

const catalog = JSON.parse(readFileSync(new URL('../../content/dist/catalog.json', import.meta.url), 'utf8'));

function bigSystem(): SystemDoc {
  const nodes: SystemDoc['nodes'] = [{ id: 'users', type: 'web-client', name: 'users', pos: { x: 0, y: 0 } }];
  const edges: SystemDoc['edges'] = [];
  nodes.push({ id: 'lb', type: 'load-balancer', skin: 'aws-alb', name: 'lb', pos: { x: 0, y: 100 } });
  edges.push({ id: 'u-lb', from: 'users', to: 'lb' });
  for (let i = 0; i < 20; i++) {
    nodes.push({ id: `api${i}`, type: 'service', name: `api${i}`, pos: { x: i * 10, y: 200 } });
    edges.push({ id: `lb-api${i}`, from: 'lb', to: `api${i}` });
    nodes.push({ id: `svc${i}`, type: 'service', name: `svc${i}`, pos: { x: i * 10, y: 300 } });
    edges.push({ id: `api-svc${i}`, from: `api${i}`, to: `svc${i}` });
    nodes.push({ id: `db${i}`, type: 'relational-db', skin: 'postgres', name: `db${i}`, pos: { x: i * 10, y: 400 } });
    edges.push({ id: `svc-db${i}`, from: `svc${i}`, to: `db${i}` });
  }
  return { schemaVersion: 1, id: 'bench', name: 'bench', nodes, edges, containers: [], scenario: { sources: [{ id: 's', node: 'users', shape: { kind: 'constant', rps: 20000 } }], events: [] } };
}

const run = createRun(bigSystem(), { catalog, seed: 1 });
const t0 = performance.now();
let simMs = 0;
while (simMs < 30000) {
  simMs += 100;
  run.step(simMs, 1e9);
}
const wall = performance.now() - t0;
const events = run.world.kernel.processed;
const perSimSec = events / 30;
const msPerFrameAt1x = (wall / 30) / 60;
console.log(`nodes=${run.world.nodes.size} events=${events} (${Math.round(perSimSec)}/sim-s) wall=${Math.round(wall)}ms  → ${msPerFrameAt1x.toFixed(2)} ms/frame at 1× (budget 6ms on phone; Node is ~2-3× faster)`);
