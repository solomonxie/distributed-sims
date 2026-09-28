import { allDemos, frames, getDemo, type Frame, type Shape } from '../src/algo/frames';
import { astarSearch, topoOrder } from '../src/algo/graph';
import { consistentHashMove } from '../src/algo/partition';
import { Bloom } from '../src/algo/probabilistic';
import { geohash } from '../src/algo/geo';
import '../src/algo/storage';
import '../src/algo/distributed';
import '../src/algo/ratelimit';

const coords = (s: Shape): number[] => {
  switch (s.t) {
    case 'node':
    case 'text':
    case 'dot':
      return [s.x, s.y];
    case 'rect':
      return [s.x, s.y, s.x + s.w, s.y + s.h];
    case 'line':
      return [s.x1, s.y1, s.x2, s.y2];
    case 'arc':
      return [s.cx - s.r, s.cy - s.r, s.cx + s.r, s.cy + s.r];
    case 'edge':
      return [s.from, s.to].flatMap(p => (typeof p === 'string' ? [] : [p.x, p.y]));
  }
};

const demos = allDemos().filter(d => !d.group.toLowerCase().startsWith('machine'));

test('all v1 demos registered', () => {
  expect(demos.length).toBeGreaterThanOrEqual(27);
});

describe.each(demos.flatMap(d => d.inputs.map(i => [`${d.slug} / ${i.label}`, d.slug, i.data] as const)))('%s', (_name, slug, data) => {
  const fs: Frame[] = frames(getDemo(slug)!, data);

  test('≥ 3 frames, finishes', () => {
    expect(fs.length).toBeGreaterThanOrEqual(3);
    expect(fs.length).toBeLessThan(2000);
    expect(fs[fs.length - 1].done).toBe(true);
    expect(fs.slice(0, -1).some(f => f.done)).toBe(false);
  });

  test('unique ids, coords in range, notes present', () => {
    for (const f of fs) {
      const ids = f.shapes.map(s => s.id);
      expect(new Set(ids).size).toBe(ids.length);
      const nodeIds = new Set(f.shapes.filter(s => s.t === 'node').map(s => s.id));
      for (const s of f.shapes) {
        for (const c of coords(s)) {
          expect(Number.isFinite(c)).toBe(true);
          expect(c).toBeGreaterThanOrEqual(0);
          expect(c).toBeLessThanOrEqual(1000);
        }
        if (s.t === 'edge') for (const p of [s.from, s.to]) if (typeof p === 'string') expect(nodeIds.has(p)).toBe(true);
      }
      expect(f.note.length).toBeGreaterThan(0);
    }
  });
});

test('Dijkstra small graph: T = 10 via A→C→F→T', () => {
  const d = getDemo('dijkstra')!;
  const last = frames(d, d.inputs[0].data).pop()!;
  const row = (l: string) => last.panel!.rows.find(r => r.label === l)?.value;
  expect(row('Distance')).toBe('10');
  expect(row('Path')).toBe('A → C → F → T');
  const pathNodes = last.shapes.filter(s => s.t === 'node' && s.tone === 'path').map(s => s.id).sort();
  expect(pathNodes).toEqual(['A', 'C', 'F', 'T']);
});

test('Dijkstra negative edge reports the wrong answer and points to Bellman-Ford', () => {
  const d = getDemo('dijkstra')!;
  const last = frames(d, d.inputs.find(i => i.id === 'negative')!.data).pop()!;
  expect(last.note).toMatch(/Bellman-Ford/);
  expect(last.panel!.rows.find(r => r.label === 'Distance')?.value).toBe('3');
  expect(last.panel!.rows.find(r => r.label === 'Bellman-Ford')?.value).toBe('2');
});

test('A* expands fewer cells than the zero heuristic, same path length', () => {
  const map = getDemo('astar')!.inputs[0].data as { map: string[] };
  const a = astarSearch({ map: map.map, heuristic: 'manhattan' });
  const z = astarSearch({ map: map.map, heuristic: 'zero' });
  expect(a.pathLen).toBe(z.pathLen);
  expect(a.pathLen).toBeGreaterThan(0);
  expect(a.expanded).toBeLessThan(z.expanded);
});

test('topological sort order respects every edge; cycle yields null', () => {
  const topo = getDemo('topo-sort')!;
  for (const inp of topo.inputs) {
    const g = inp.data as Parameters<typeof topoOrder>[0];
    const order = topoOrder(g);
    if (inp.id === 'cycle') {
      expect(order).toBeNull();
      continue;
    }
    expect(order).not.toBeNull();
    const pos = new Map(order!.map((id, i) => [id, i]));
    expect(pos.size).toBe(g.nodes.length);
    for (const e of g.edges) expect(pos.get(e.from)!).toBeLessThan(pos.get(e.to)!);
  }
});

test('consistent hashing: adding a node moves ≈ keys/N, all to the new node', () => {
  const r = consistentHashMove(3, 4, 1000);
  expect(r.total).toBe(1000);
  expect(r.allToNew).toBe(true);
  expect(r.moved).toBeGreaterThan(1000 / 4 * 0.4);
  expect(r.moved).toBeLessThan(1000 / 4 * 1.8);
});

test('Bloom filter never gives false negatives', () => {
  const b = new Bloom(64, 3);
  const words = Array.from({ length: 40 }, (_, i) => `word-${i}`);
  words.forEach(w => b.add(w));
  for (const w of words) expect(b.has(w)).toBe(true);
});

test('geohash known values', () => {
  expect(geohash(37.7749, -122.4194, 5)).toBe('9q8yy');
  expect(geohash(51.5074, -0.1278, 5)).toBe('gcpvj');
});
