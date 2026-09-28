// Graph algorithm demos: Dijkstra, A*, BFS, DFS, Bellman-Ford, contraction hierarchies, topological sort.
import { registerDemo, type Frame, type GraphInput, type PanelRow, type Shape, type Tone } from './frames';
import { INF, adjacency, edgeKey, fmt, frame, graphShapes, label, pathTo, text } from './lib/draw';

type Prev = Map<string, { from: string; key: string }>;

const asGraph = (input: unknown, fallback: GraphInput): GraphInput => {
  const g = input as GraphInput | undefined;
  return g && Array.isArray(g.nodes) && g.nodes.length ? g : fallback;
};

const joinPath = (g: GraphInput, ids: string[]) => ids.map(id => label(g, id)).join(' → ');
const via = (g: GraphInput, ids: string[]) => (ids.length > 2 ? `via ${ids.slice(1, -1).map(id => label(g, id)).join(', ')}` : 'direct');
const w = (n: number) => (n < 0 ? `(${n})` : String(n));

// ---------- presets ----------

const smallGraph: GraphInput = {
  nodes: [
    { id: 'A', x: 100, y: 420 }, { id: 'C', x: 360, y: 420 }, { id: 'B', x: 580, y: 220 }, { id: 'E', x: 880, y: 220 },
    { id: 'D', x: 330, y: 760 }, { id: 'F', x: 600, y: 700 }, { id: 'T', x: 880, y: 700 },
  ],
  edges: [
    { from: 'A', to: 'C', w: 4 }, { from: 'C', to: 'B', w: 2 }, { from: 'C', to: 'F', w: 1 }, { from: 'A', to: 'D', w: 7 },
    { from: 'D', to: 'F', w: 1 }, { from: 'F', to: 'T', w: 5 }, { from: 'B', to: 'E', w: 3 }, { from: 'E', to: 'T', w: 2 },
  ],
  source: 'A',
  target: 'T',
};

const gridIds = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
const cityGrid: GraphInput = {
  nodes: gridIds.map((id, i) => ({ id, x: 150 + (i % 4) * 233, y: 200 + Math.floor(i / 4) * 300 })),
  edges: [
    ['A', 'B', 2], ['B', 'C', 6], ['C', 'D', 2], ['E', 'F', 3], ['F', 'G', 1], ['G', 'H', 5], ['I', 'J', 5], ['J', 'K', 2], ['K', 'L', 3],
    ['A', 'E', 3], ['B', 'F', 2], ['C', 'G', 3], ['D', 'H', 5], ['E', 'I', 2], ['F', 'J', 4], ['G', 'K', 2], ['H', 'L', 1],
  ].map(([from, to, wt]) => ({ from: from as string, to: to as string, w: wt as number })),
  source: 'A',
  target: 'L',
};

const negativeEdge: GraphInput = {
  nodes: [{ id: 'S', x: 120, y: 500 }, { id: 'A', x: 480, y: 220 }, { id: 'B', x: 480, y: 780 }, { id: 'T', x: 860, y: 500 }],
  edges: [
    { from: 'S', to: 'A', w: 2, directed: true }, { from: 'S', to: 'B', w: 5, directed: true },
    { from: 'B', to: 'A', w: -4, directed: true }, { from: 'A', to: 'T', w: 1, directed: true },
  ],
  source: 'S',
  target: 'T',
};

const negativeCycle: GraphInput = {
  nodes: [
    { id: 'S', x: 100, y: 500 }, { id: 'A', x: 360, y: 250 }, { id: 'B', x: 640, y: 250 }, { id: 'C', x: 500, y: 700 }, { id: 'T', x: 880, y: 700 },
  ],
  edges: [
    { from: 'S', to: 'A', w: 1, directed: true }, { from: 'A', to: 'B', w: 2, directed: true }, { from: 'B', to: 'C', w: -4, directed: true },
    { from: 'C', to: 'A', w: 1, directed: true }, { from: 'C', to: 'T', w: 2, directed: true },
  ],
  source: 'S',
  target: 'T',
};

const crawl: GraphInput = {
  nodes: [
    { id: 'H', label: 'Home', x: 500, y: 110 }, { id: 'A', label: 'About', x: 180, y: 330 }, { id: 'B', label: 'Blog', x: 500, y: 330 },
    { id: 'D', label: 'Docs', x: 820, y: 330 }, { id: 'C', label: 'Team', x: 120, y: 580 }, { id: 'P1', label: 'Post1', x: 360, y: 580 },
    { id: 'P2', label: 'Post2', x: 640, y: 580 }, { id: 'I', label: 'API', x: 780, y: 580 }, { id: 'F', label: 'FAQ', x: 920, y: 580 },
    { id: 'O', label: 'Old', x: 360, y: 850 },
  ],
  edges: [
    ['H', 'A'], ['H', 'B'], ['H', 'D'], ['A', 'C'], ['B', 'P1'], ['B', 'P2'], ['D', 'I'], ['D', 'F'],
    ['P1', 'P2'], ['P1', 'O'], ['P2', 'H'], ['I', 'F'], ['F', 'D'], ['C', 'H'],
  ].map(([from, to]) => ({ from, to, w: 1, directed: true })),
  source: 'H',
};

const pipeline: GraphInput = {
  nodes: [
    { id: 'U', label: 'Upload', x: 100, y: 500 }, { id: 'T3', label: 'T360', x: 330, y: 200 }, { id: 'T1', label: 'T1080', x: 330, y: 400 },
    { id: 'TH', label: 'Thumb', x: 330, y: 600 }, { id: 'SC', label: 'Scan', x: 330, y: 800 }, { id: 'PK', label: 'Pack', x: 560, y: 300 },
    { id: 'CD', label: 'CDN', x: 760, y: 300 }, { id: 'PB', label: 'Publish', x: 880, y: 650 },
  ],
  edges: [
    ['U', 'T3'], ['U', 'T1'], ['U', 'TH'], ['U', 'SC'], ['T3', 'PK'], ['T1', 'PK'], ['PK', 'CD'], ['CD', 'PB'], ['TH', 'PB'], ['SC', 'PB'],
  ].map(([from, to]) => ({ from, to, w: 1, directed: true })),
};

const migrations: GraphInput = {
  nodes: [
    { id: 'm1', label: 'users', x: 120, y: 300 }, { id: 'm2', label: 'orgs', x: 120, y: 700 }, { id: 'm3', label: 'member', x: 420, y: 300 },
    { id: 'm5', label: 'billing', x: 420, y: 700 }, { id: 'm4', label: 'index', x: 720, y: 180 }, { id: 'm6', label: 'audit', x: 820, y: 560 },
  ],
  edges: [
    ['m1', 'm2'], ['m1', 'm3'], ['m2', 'm3'], ['m3', 'm4'], ['m2', 'm5'], ['m3', 'm6'], ['m5', 'm6'],
  ].map(([from, to]) => ({ from, to, w: 1, directed: true })),
};

const cyclic: GraphInput = {
  nodes: [
    { id: 'L', label: 'lint', x: 100, y: 500 }, { id: 'B', label: 'build', x: 360, y: 500 }, { id: 'T', label: 'test', x: 620, y: 250 },
    { id: 'P', label: 'pkg', x: 620, y: 750 }, { id: 'D', label: 'deploy', x: 880, y: 500 },
  ],
  edges: [['L', 'B'], ['B', 'T'], ['T', 'P'], ['P', 'B'], ['P', 'D']].map(([from, to]) => ({ from, to, w: 1, directed: true })),
};

const roads: GraphInput = {
  nodes: [
    { id: 'A', x: 100, y: 300 }, { id: 'B', x: 340, y: 150 }, { id: 'C', x: 640, y: 150 }, { id: 'D', x: 900, y: 300 },
    { id: 'M', x: 490, y: 500 },
    { id: 'E', x: 100, y: 700 }, { id: 'F', x: 340, y: 850 }, { id: 'G', x: 640, y: 850 }, { id: 'H', x: 900, y: 700 },
  ],
  edges: [
    ['A', 'B', 3], ['B', 'C', 4], ['C', 'D', 3], ['A', 'E', 5], ['D', 'H', 4], ['E', 'F', 3], ['F', 'G', 4], ['G', 'H', 3],
    ['B', 'M', 2], ['C', 'M', 3], ['F', 'M', 2], ['G', 'M', 3],
  ].map(([from, to, wt]) => ({ from: from as string, to: to as string, w: wt as number })),
  source: 'A',
  target: 'H',
};

// ---------- Dijkstra ----------

export function bellmanFordDist(g: GraphInput, src: string): Map<string, number> | null {
  const dist = new Map(g.nodes.map(n => [n.id, n.id === src ? 0 : INF]));
  const arcs = g.edges.flatMap(e => (e.directed ? [e] : [e, { ...e, from: e.to, to: e.from }]));
  for (let i = 0; i < g.nodes.length; i++) {
    let changed = false;
    for (const e of arcs) {
      const d = dist.get(e.from)! + e.w;
      if (d < dist.get(e.to)!) {
        dist.set(e.to, d);
        changed = true;
      }
    }
    if (!changed) return dist;
  }
  return null;
}

function* dijkstra(input: unknown): Generator<Frame> {
  const g = asGraph(input, smallGraph);
  const adj = adjacency(g);
  const src = g.source ?? g.nodes[0].id;
  const tgt = g.target;
  const dist = new Map(g.nodes.map(n => [n.id, n.id === src ? 0 : INF]));
  const prev: Prev = new Map();
  const settled = new Set<string>();
  let pq: { id: string; d: number }[] = [{ id: src, d: 0 }];
  const L = (id: string) => label(g, id);

  const pqRows = (): PanelRow[] => {
    const live = pq.filter(e => e.d === dist.get(e.id) && !settled.has(e.id)).sort((a, b) => a.d - b.d || a.id.localeCompare(b.id));
    return live.length ? live.map((e, i) => ({ label: L(e.id), value: fmt(e.d), tone: i === 0 ? 'accent' : undefined })) : [{ label: 'empty', value: '' }];
  };
  const draw = (cur?: string, curEdge?: string, path?: { nodes: string[]; keys: Set<string> }, final = false): Shape[] => {
    const tree = new Set([...prev.values()].map(p => p.key));
    const onPath = new Set(path?.nodes ?? []);
    return graphShapes(g, {
      node: id => ({
        tone: onPath.has(id) ? 'path' : id === cur ? 'current' : settled.has(id) ? 'visited' : dist.get(id)! < INF ? 'accent' : final ? 'muted' : 'default',
        sub: fmt(dist.get(id)!),
        badge: id === src ? 'src' : id === tgt ? 'dst' : undefined,
      }),
      edge: k => (path?.keys.has(k) ? 'path' : k === curEdge ? 'current' : tree.has(k) ? 'visited' : final && path ? 'muted' : undefined),
    });
  };
  const pqPanel = () => ({ title: 'Priority queue', rows: pqRows() });

  yield frame(`Start at ${L(src)} with dist 0; every other node is ∞. Push ${L(src)} into the priority queue.`, draw(src), pqPanel());

  while (pq.length) {
    pq.sort((a, b) => a.d - b.d || a.id.localeCompare(b.id));
    const { id: u, d } = pq.shift()!;
    if (settled.has(u) || d !== dist.get(u)) continue;
    settled.add(u);
    const isTarget = u === tgt;
    yield frame(
      isTarget ? `Pop ${L(u)} (dist ${fmt(d)}). The target is settled, so we can stop.` : `Pop ${L(u)} (dist ${fmt(d)}), the closest unsettled node. Its distance is now final.`,
      draw(u), pqPanel(),
    );
    if (isTarget) break;
    for (const a of adj.get(u) ?? []) {
      if (settled.has(a.to)) continue;
      const old = dist.get(a.to)!;
      const nd = d + a.w;
      const sum = `${fmt(d)}+${w(a.w)}=${fmt(nd)}`;
      if (nd < old) {
        dist.set(a.to, nd);
        prev.set(a.to, { from: u, key: a.key });
        pq.push({ id: a.to, d: nd });
        yield frame(`Relax ${L(u)}→${L(a.to)}: ${sum} < ${fmt(old)}, so ${L(a.to)} = ${fmt(nd)}.`, draw(u, a.key), pqPanel());
      } else {
        yield frame(`Relax ${L(u)}→${L(a.to)}: ${sum} ≥ ${fmt(old)}, keep ${L(a.to)} = ${fmt(old)}.`, draw(u, a.key), pqPanel());
      }
    }
  }

  const distRows = (): PanelRow[] => g.nodes.map(n => ({ label: L(n.id), value: fmt(dist.get(n.id)!), tone: settled.has(n.id) ? undefined : 'muted' }));
  if (!tgt) {
    yield frame(`All reachable nodes settled: ${settled.size} of ${g.nodes.length}. Highlighted edges form the shortest-path tree.`, draw(undefined, undefined, undefined, true), { title: 'Distances', rows: distRows() }, true);
    return;
  }
  if (dist.get(tgt) === INF) {
    yield frame(`${L(tgt)} is unreachable from ${L(src)}. Unreachable nodes are greyed out.`, draw(undefined, undefined, undefined, true), { title: 'Distances', rows: distRows() }, true);
    return;
  }
  const path = pathTo(prev, tgt);
  const total = dist.get(tgt)!;
  const rows: PanelRow[] = [
    { label: 'Path', value: joinPath(g, path.nodes), tone: 'path' },
    { label: 'Distance', value: fmt(total), tone: 'path' },
    { label: 'Settled', value: `${settled.size} of ${g.nodes.length}` },
  ];
  const truth = g.edges.some(e => e.w < 0) ? bellmanFordDist(g, src) : undefined;
  let note = `${L(tgt)} reached: shortest ${L(src)}→${L(tgt)} = ${fmt(total)} ${via(g, path.nodes)}.`;
  if (truth === null) note = `Dijkstra says ${L(tgt)} = ${fmt(total)}, but a negative cycle makes it meaningless. Use Bellman-Ford to detect it.`;
  else if (truth && truth.get(tgt)! < total)
    note = `Dijkstra says ${L(tgt)} = ${fmt(total)}, but the true shortest is ${fmt(truth.get(tgt)!)}. A negative edge broke "popped = final"; use Bellman-Ford.`;
  if (truth !== undefined) rows.push({ label: 'Bellman-Ford', value: truth ? fmt(truth.get(tgt)!) : 'neg. cycle', tone: 'warn' });
  yield frame(note, draw(undefined, undefined, path, true), { title: 'Result', rows }, true);
}

registerDemo({
  slug: 'dijkstra',
  title: 'Dijkstra shortest path',
  group: 'Graph',
  summary: 'Greedy shortest paths with a priority queue; each pop is final when weights are non-negative.',
  linkedFrom: ['Google Maps', 'Network'],
  inputs: [
    { id: 'small', label: 'Small graph', data: smallGraph },
    { id: 'city', label: 'City grid', data: cityGrid },
    { id: 'negative', label: 'Negative edge', data: negativeEdge },
  ],
  editable: 'graph',
  run: dijkstra,
});

// ---------- A* on a grid ----------

export interface GridInput {
  /** rows of '.', '#', 'S', 'G' */
  map: string[];
  heuristic: 'manhattan' | 'zero';
}

type Cell = [number, number];
const ck = (c: Cell) => `${c[0]},${c[1]}`;

interface GridEvent {
  cur: Cell;
  g: number;
  h: number;
  pushed: Cell[];
  open: Map<string, { g: number; h: number }>;
  closed: Set<string>;
}

function parseGrid(map: string[]) {
  let start: Cell = [0, 0];
  let goal: Cell = [0, 0];
  const walls = new Set<string>();
  map.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch === '#') walls.add(ck([x, y]));
      if (ch === 'S') start = [x, y];
      if (ch === 'G') goal = [x, y];
    }),
  );
  return { cols: Math.max(...map.map(r => r.length)), rows: map.length, start, goal, walls };
}

function* gridSearch(inp: GridInput): Generator<GridEvent, { path: Cell[] | null; expanded: number }> {
  const { cols, rows, start, goal, walls } = parseGrid(inp.map);
  const h = (c: Cell) => (inp.heuristic === 'zero' ? 0 : Math.abs(c[0] - goal[0]) + Math.abs(c[1] - goal[1]));
  const open = new Map<string, { g: number; h: number; seq: number; cell: Cell }>();
  const closed = new Set<string>();
  const prev = new Map<string, Cell>();
  let seq = 0;
  open.set(ck(start), { g: 0, h: h(start), seq: seq++, cell: start });
  let expanded = 0;
  while (open.size) {
    const best = [...open.values()].sort((a, b) => a.g + a.h - (b.g + b.h) || a.h - b.h || a.seq - b.seq)[0];
    const k = ck(best.cell);
    open.delete(k);
    closed.add(k);
    expanded++;
    if (k === ck(goal)) {
      const path: Cell[] = [goal];
      let c = goal;
      while (prev.has(ck(c))) path.unshift((c = prev.get(ck(c))!));
      yield { cur: best.cell, g: best.g, h: best.h, pushed: [], open, closed };
      return { path, expanded };
    }
    const pushed: Cell[] = [];
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const n: Cell = [best.cell[0] + dx, best.cell[1] + dy];
      const nk = ck(n);
      if (n[0] < 0 || n[1] < 0 || n[0] >= cols || n[1] >= rows || walls.has(nk) || closed.has(nk)) continue;
      const ng = best.g + 1;
      const o = open.get(nk);
      if (o && o.g <= ng) continue;
      open.set(nk, { g: ng, h: h(n), seq: seq++, cell: n });
      prev.set(nk, best.cell);
      pushed.push(n);
    }
    yield { cur: best.cell, g: best.g, h: best.h, pushed, open, closed };
  }
  return { path: null, expanded };
}

export function astarSearch(inp: GridInput): { expanded: number; pathLen: number } {
  const it = gridSearch(inp);
  let r = it.next();
  while (!r.done) r = it.next();
  return { expanded: r.value.expanded, pathLen: r.value.path ? r.value.path.length - 1 : -1 };
}

const openMap = [
  '..........',
  '..........',
  '.S....#...',
  '......#...',
  '..###.#.G.',
  '......#...',
  '....###...',
  '..........',
];
const mazeMap = [
  '..........',
  '.S..#.....',
  '.##.#.###.',
  '....#...#.',
  '.####.#.#.',
  '......#.#G',
  '.######.#.',
  '........#.',
];

function* astar(input: unknown): Generator<Frame> {
  const inp = (input as GridInput | undefined)?.map ? (input as GridInput) : { map: openMap, heuristic: 'manhattan' as const };
  const { cols, rows, start, goal, walls } = parseGrid(inp.map);
  const size = Math.floor(Math.min(920 / cols, 820 / rows));
  const x0 = (1000 - size * cols) / 2;
  const y0 = 40;
  const hName = inp.heuristic === 'zero' ? 'zero (Dijkstra)' : 'Manhattan';
  const cellName = (c: Cell) => `(${c[0]},${c[1]})`;

  const draw = (ev: GridEvent | null, path?: Set<string>): Shape[] => {
    const out: Shape[] = [];
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        const k = ck([x, y]);
        const cx = x0 + x * size, cy = y0 + y * size;
        if (walls.has(k)) {
          // solid block
          out.push({ t: 'line', id: `c:${k}`, x1: cx + 3, y1: cy + (size - 4) / 2, x2: cx + size - 7, y2: cy + (size - 4) / 2, tone: 'muted', width: size - 8 });
          continue;
        }
        const o = ev?.open.get(k);
        const isCur = ev && ck(ev.cur) === k;
        let tone: Tone = 'default';
        let lbl: string | undefined;
        if (path?.has(k)) tone = 'path';
        else if (isCur) tone = 'current';
        else if (ev?.closed.has(k)) tone = 'protocol';
        else if (o) tone = 'warn';
        if (o) lbl = String(o.g + o.h);
        if (k === ck(start)) lbl = 'S';
        if (k === ck(goal)) lbl = 'G';
        out.push({ t: 'rect', id: `c:${k}`, x: cx, y: cy, w: size - 4, h: size - 4, tone, filled: tone !== 'default', label: lbl, radius: 8, mono: true });
      }
    return out;
  };
  const legendY = Math.min(y0 + rows * size + 50, 965);
  const legend = (s: string): Shape[] => [
    text('legend', 40, legendY, s, { align: 'left', size: 28, tone: 'default' }),
    text('lg:open', 960 - 280, legendY, 'open', { align: 'right', size: 28, bold: true, tone: 'warn' }),
    text('lg:done', 960 - 130, legendY, 'expanded', { align: 'right', size: 28, bold: true, tone: 'protocol' }),
    text('lg:path', 960, legendY, 'path', { align: 'right', size: 28, bold: true, tone: 'path' }),
  ];

  yield frame(
    `Find a path from S to G with heuristic h = ${hName}. Cells show f = g + h; the open cell with the lowest f is expanded next.`,
    [...draw({ cur: start, g: 0, h: 0, pushed: [], open: new Map([[ck(start), { g: 0, h: 0 }]]), closed: new Set() }), ...legend('f = g + h')],
    { title: 'A*', rows: [{ label: 'Heuristic', value: hName }, { label: 'Expanded', value: '0' }] },
  );
  const it = gridSearch(inp);
  let r = it.next();
  let n = 0;
  let lastEv: GridEvent | null = null;
  while (!r.done) {
    const ev = r.value;
    n++;
    const top = [...ev.open.entries()].sort((a, b) => a[1].g + a[1].h - (b[1].g + b[1].h) || a[1].h - b[1].h).slice(0, 3);
    const note =
      ck(ev.cur) === ck(goal)
        ? `Expand G ${cellName(ev.cur)}: g=${ev.g}. Goal reached after ${n} expansions.`
        : `Expand ${cellName(ev.cur)}: g=${ev.g}, h=${ev.h}, f=${ev.g + ev.h}. ${ev.pushed.length ? `Push ${ev.pushed.length} neighbour${ev.pushed.length > 1 ? 's' : ''}.` : 'No new neighbours.'}`;
    lastEv = ev;
    yield frame(note, [...draw(ev), ...legend(`${n} expanded`)], {
      title: 'Open list (lowest f first)',
      rows: [
        { label: 'Heuristic', value: hName },
        { label: 'Expanded', value: String(n) },
        ...top.map(([k, v]) => ({ label: `(${k})`, value: `f ${v.g + v.h}` })),
      ],
    });
    r = it.next();
  }
  const { path, expanded } = r.value;
  const other = astarSearch({ map: inp.map, heuristic: inp.heuristic === 'zero' ? 'manhattan' : 'zero' }).expanded;
  const otherName = inp.heuristic === 'zero' ? 'Manhattan A*' : 'Zero heuristic (Dijkstra)';
  const pathSet = new Set((path ?? []).map(ck));
  const last: GridEvent = { cur: goal, g: 0, h: 0, pushed: [], open: new Map(), closed: lastEv?.closed ?? new Set<string>() };
  yield frame(
    path
      ? `Path found: ${path.length - 1} steps with ${expanded} expansions. ${otherName} needs ${other} on this map.`
      : `G is unreachable: all ${expanded} reachable cells expanded.`,
    [...draw(last, pathSet), ...legend(`${expanded} expanded`)],
    { title: 'Result', rows: [{ label: 'Heuristic', value: hName }, { label: 'Expanded', value: String(expanded), tone: 'accent' }, { label: otherName, value: String(other) }, { label: 'Path length', value: path ? String(path.length - 1) : '—', tone: 'path' }] },
    true,
  );
}

registerDemo({
  slug: 'astar',
  title: 'A* search',
  group: 'Graph',
  summary: 'Dijkstra plus a heuristic that pulls the search toward the goal; fewer cells expanded, same optimal path.',
  linkedFrom: ['Google Maps'],
  inputs: [
    { id: 'manhattan', label: 'Manhattan heuristic', data: { map: openMap, heuristic: 'manhattan' } },
    { id: 'zero', label: 'Zero heuristic (= Dijkstra)', data: { map: openMap, heuristic: 'zero' } },
    { id: 'maze', label: 'Maze', data: { map: mazeMap, heuristic: 'manhattan' } },
  ],
  editable: 'none',
  run: astar,
});

// ---------- BFS / DFS ----------

function* bfs(input: unknown): Generator<Frame> {
  const g = asGraph(input, crawl);
  const adj = adjacency(g);
  const src = g.source ?? g.nodes[0].id;
  const L = (id: string) => label(g, id);
  const depth = new Map([[src, 0]]);
  const order: string[] = [];
  const queue = [src];
  const tree: Prev = new Map();
  const draw = (cur?: string, hot: string[] = []): Shape[] => {
    const treeKeys = new Set([...tree.values()].map(p => p.key));
    const hotKeys = new Set(hot);
    return graphShapes(g, {
      hideWeights: true,
      node: id => ({
        tone: id === cur ? 'current' : order.includes(id) ? 'visited' : depth.has(id) ? 'accent' : 'default',
        sub: depth.has(id) ? `d${depth.get(id)}` : undefined,
        badge: order.includes(id) ? String(order.indexOf(id) + 1) : undefined,
      }),
      edge: k => (hotKeys.has(k) ? 'current' : treeKeys.has(k) ? 'path' : undefined),
    });
  };
  const panel = () => ({ title: 'Queue (FIFO)', rows: queue.length ? queue.map((id, i) => ({ label: `${i + 1}`, value: `${L(id)} · d${depth.get(id)}` })) : [{ label: 'empty', value: '' }] });
  yield frame(`Start the crawl at ${L(src)}: mark it seen and enqueue it. BFS visits pages level by level.`, draw(), panel());
  while (queue.length) {
    const u = queue.shift()!;
    order.push(u);
    const fresh: string[] = [];
    const hot: string[] = [];
    let seen = 0;
    for (const a of adj.get(u) ?? []) {
      if (depth.has(a.to)) {
        seen++;
        continue;
      }
      depth.set(a.to, depth.get(u)! + 1);
      tree.set(a.to, { from: u, key: a.key });
      queue.push(a.to);
      fresh.push(L(a.to));
      hot.push(a.key);
    }
    const tail = fresh.length
      ? `Enqueue ${fresh.join(', ')} at depth ${depth.get(u)! + 1}.`
      : seen
        ? seen === 1 ? 'Its only link is already seen; nothing new.' : `All ${seen} links already seen; nothing new.`
        : 'No outgoing links.';
    yield frame(`Dequeue ${L(u)} (depth ${depth.get(u)}). ${tail}`, draw(u, hot), panel());
  }
  const unreached = g.nodes.filter(n => !depth.has(n.id)).length;
  yield frame(
    `Done: ${order.length} pages in BFS order ${order.map(L).join(', ')}.${unreached ? ` ${unreached} unreachable.` : ''}`,
    draw(),
    { title: 'Visit order', rows: order.map((id, i) => ({ label: `${i + 1}`, value: `${L(id)} · d${depth.get(id)}` })) },
    true,
  );
}

function* dfs(input: unknown): Generator<Frame> {
  const g = asGraph(input, crawl);
  const adj = adjacency(g);
  const src = g.source ?? g.nodes[0].id;
  const L = (id: string) => label(g, id);
  const order: string[] = [];
  const done = new Set<string>();
  const stack: string[] = [];
  const tree: Prev = new Map();
  const draw = (cur?: string, hot?: string): Shape[] => {
    const treeKeys = new Set([...tree.values()].map(p => p.key));
    return graphShapes(g, {
      hideWeights: true,
      node: id => ({
        tone: id === cur ? 'current' : done.has(id) ? 'visited' : stack.includes(id) ? 'accent' : 'default',
        badge: order.includes(id) ? String(order.indexOf(id) + 1) : undefined,
      }),
      edge: k => (k === hot ? 'current' : treeKeys.has(k) ? 'path' : undefined),
    });
  };
  const panel = () => ({ title: 'Stack (deepest last)', rows: stack.length ? stack.map((id, i) => ({ label: `${i}`, value: L(id) })) : [{ label: 'empty', value: '' }] });

  function* visit(u: string): Generator<Frame> {
    stack.push(u);
    order.push(u);
    yield frame(`Visit ${L(u)} (#${order.length}, depth ${stack.length - 1}) and push it on the stack.${order.length === 1 ? ' DFS goes as deep as possible before backtracking.' : ''}`, draw(u), panel());
    for (const a of adj.get(u) ?? []) {
      if (order.includes(a.to)) {
        yield frame(`${L(u)} → ${L(a.to)}: already seen, skip.`, draw(u, a.key), panel());
        continue;
      }
      tree.set(a.to, { from: u, key: a.key });
      yield frame(`${L(u)} → ${L(a.to)}: unseen, go deeper.`, draw(u, a.key), panel());
      yield* visit(a.to);
    }
    stack.pop();
    done.add(u);
    const parent = stack[stack.length - 1];
    yield frame(parent ? `${L(u)} has no unseen links left; backtrack to ${L(parent)}.` : `${L(u)} finished; the stack is empty.`, draw(parent), panel());
  }
  yield frame(`Start DFS at ${L(src)} with an empty stack.`, draw(), panel());
  yield* visit(src);
  yield frame(`Done: ${order.length} pages in DFS order ${order.map(L).join(', ')}.`, draw(), { title: 'Visit order', rows: order.map((id, i) => ({ label: `${i + 1}`, value: L(id) })) }, true);
}

const smallUnweighted: GraphInput = { ...smallGraph, target: undefined };

registerDemo({
  slug: 'bfs',
  title: 'BFS traversal',
  group: 'Graph',
  summary: 'Breadth-first: a FIFO queue visits nodes in rings of equal hop distance, like a polite web crawler.',
  linkedFrom: ['Web crawler'],
  inputs: [
    { id: 'crawl', label: 'Site crawl', data: crawl },
    { id: 'small', label: 'Small graph', data: smallUnweighted },
  ],
  editable: 'graph',
  run: bfs,
});

registerDemo({
  slug: 'dfs',
  title: 'DFS traversal',
  group: 'Graph',
  summary: 'Depth-first: follow one link as deep as possible, then backtrack; a stack holds the current path.',
  linkedFrom: ['Web crawler'],
  inputs: [
    { id: 'crawl', label: 'Site crawl', data: crawl },
    { id: 'small', label: 'Small graph', data: smallUnweighted },
  ],
  editable: 'graph',
  run: dfs,
});

// ---------- Bellman-Ford ----------

function* bellmanFord(input: unknown): Generator<Frame> {
  const g = asGraph(input, negativeEdge);
  const src = g.source ?? g.nodes[0].id;
  const tgt = g.target;
  const L = (id: string) => label(g, id);
  const arcs = g.edges.flatMap(e => {
    const key = edgeKey(e);
    const fwd = { from: e.from, to: e.to, w: e.w, key };
    return e.directed ? [fwd] : [fwd, { from: e.to, to: e.from, w: e.w, key }];
  });
  const dist = new Map(g.nodes.map(n => [n.id, n.id === src ? 0 : INF]));
  const prev: Prev = new Map();
  const V = g.nodes.length;
  let round = 0;
  const draw = (hot?: string, cur?: string, path?: { nodes: string[]; keys: Set<string> }, bad?: Set<string>): Shape[] => {
    const tree = new Set([...prev.values()].map(p => p.key));
    const onPath = new Set(path?.nodes ?? []);
    return graphShapes(g, {
      node: id => ({
        tone: bad?.has(id) ? 'fail' : onPath.has(id) ? 'path' : id === cur ? 'current' : dist.get(id)! < INF ? 'accent' : 'default',
        sub: fmt(dist.get(id)!),
        badge: id === src ? 'src' : id === tgt ? 'dst' : undefined,
      }),
      edge: k => (path?.keys.has(k) ? 'path' : k === hot ? 'current' : tree.has(k) ? 'visited' : undefined),
    });
  };
  const panel = () => ({
    title: `Round ${round} of ${V - 1}`,
    rows: g.nodes.map(n => ({ label: L(n.id), value: fmt(dist.get(n.id)!) })),
  });
  yield frame(`Set ${L(src)} = 0, others ∞. Relax every edge, up to V−1 = ${V - 1} rounds.`, draw(), panel());
  let converged = false;
  for (round = 1; round < V; round++) {
    let updates = 0;
    for (const a of arcs) {
      const du = dist.get(a.from)!;
      if (du === INF) continue;
      const nd = du + a.w;
      const old = dist.get(a.to)!;
      if (nd < old) {
        dist.set(a.to, nd);
        prev.set(a.to, { from: a.from, key: a.key });
        updates++;
        yield frame(`Round ${round}: relax ${L(a.from)}→${L(a.to)}: ${fmt(du)}+${w(a.w)}=${fmt(nd)} < ${fmt(old)}, so ${L(a.to)} = ${fmt(nd)}.`, draw(a.key, a.to), panel());
      }
    }
    if (!updates) {
      converged = true;
      yield frame(`Round ${round}: no edge improves anything, so distances are final. Stop early.`, draw(), panel());
      break;
    }
    yield frame(`Round ${round} done: ${updates} update${updates > 1 ? 's' : ''}.`, draw(), panel());
  }
  if (!converged) {
    const bad = arcs.find(a => dist.get(a.from)! < INF && dist.get(a.from)! + a.w < dist.get(a.to)!);
    if (bad) {
      const cyc = new Set<string>();
      let c = bad.to;
      for (let i = 0; i < V; i++) c = prev.get(c)?.from ?? c;
      for (let x = c; !cyc.has(x); x = prev.get(x)?.from ?? x) cyc.add(x);
      round = V;
      yield frame(
        `Extra round ${V} still relaxes ${L(bad.from)}→${L(bad.to)}. Negative cycle ${[...cyc].reverse().map(L).join('→')}: no shortest path exists.`,
        draw(bad.key, undefined, undefined, cyc), { title: 'Negative cycle', rows: [...cyc].map(id => ({ label: L(id), value: fmt(dist.get(id)!), tone: 'fail' as Tone })) }, true,
      );
      return;
    }
  }
  if (tgt && dist.get(tgt)! < INF) {
    const path = pathTo(prev, tgt);
    yield frame(
      `Shortest ${L(src)}→${L(tgt)} = ${fmt(dist.get(tgt)!)} ${via(g, path.nodes)}. Negative edges are fine as long as there's no negative cycle.`,
      draw(undefined, undefined, path),
      { title: 'Result', rows: [{ label: 'Path', value: joinPath(g, path.nodes), tone: 'path' }, { label: 'Distance', value: fmt(dist.get(tgt)!), tone: 'path' }, ...panel().rows] },
      true,
    );
  } else {
    yield frame(tgt ? `${L(tgt)} is unreachable from ${L(src)}.` : `All distances from ${L(src)} are final.`, draw(), panel(), true);
  }
}

registerDemo({
  slug: 'bellman-ford',
  title: 'Bellman-Ford',
  group: 'Graph',
  summary: 'Relax every edge V−1 times; handles negative weights and detects negative cycles.',
  linkedFrom: ['Network'],
  inputs: [
    { id: 'negative', label: 'Negative edge', data: negativeEdge },
    { id: 'cycle', label: 'Negative cycle', data: negativeCycle },
    { id: 'small', label: 'Small graph', data: smallGraph },
  ],
  editable: 'graph',
  run: bellmanFord,
});

// ---------- Contraction hierarchies ----------

interface Arc {
  w: number;
  via?: string;
}
const pk = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

function* contraction(input: unknown): Generator<Frame> {
  const g = asGraph(input, roads);
  const L = (id: string) => label(g, id);
  const src = g.source ?? g.nodes[0].id;
  const tgt = g.target ?? g.nodes[g.nodes.length - 1].id;
  const pairs = new Map<string, Arc>();
  for (const e of g.edges) {
    const k = pk(e.from, e.to);
    if (!pairs.has(k) || pairs.get(k)!.w > e.w) pairs.set(k, { w: e.w });
  }
  const shortcuts = new Map<string, number>();
  const rank = new Map<string, number>();
  const nbrs = (v: string) => {
    const out: { id: string; w: number }[] = [];
    for (const [k, a] of pairs) {
      const [x, y] = k.split('|');
      if (x === v) out.push({ id: y, w: a.w });
      else if (y === v) out.push({ id: x, w: a.w });
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
  };
  const alive = (v: string) => !rank.has(v);
  const witness = (u: string, target: string, skip: string, limit: number) => {
    const dist = new Map([[u, 0]]);
    const pq = [{ id: u, d: 0 }];
    const done = new Set<string>();
    while (pq.length) {
      pq.sort((a, b) => a.d - b.d);
      const { id, d } = pq.shift()!;
      if (done.has(id) || d > limit) continue;
      if (id === target) return d;
      done.add(id);
      for (const n of nbrs(id)) {
        if (n.id === skip || !alive(n.id)) continue;
        const nd = d + n.w;
        if (nd < (dist.get(n.id) ?? INF)) {
          dist.set(n.id, nd);
          pq.push({ id: n.id, d: nd });
        }
      }
    }
    return INF;
  };
  const plan = (v: string) => {
    const ns = nbrs(v).filter(n => alive(n.id));
    const adds: { a: string; b: string; w: number }[] = [];
    const saved: string[] = [];
    for (let i = 0; i < ns.length; i++)
      for (let j = i + 1; j < ns.length; j++) {
        const sum = ns[i].w + ns[j].w;
        const wit = witness(ns[i].id, ns[j].id, v, sum);
        if (wit <= sum) saved.push(`${L(ns[i].id)}–${L(ns[j].id)} ${fmt(wit)} ≤ ${fmt(sum)}`);
        else adds.push({ a: ns[i].id, b: ns[j].id, w: sum });
      }
    const gone = nbrs(v).length - ns.length;
    return { ns, adds, saved, gone, score: adds.length - ns.length + gone };
  };

  const scShapes = (hot?: Set<string>, pathKeys?: Set<string>): Shape[] =>
    [...shortcuts.entries()].map(([k, wt]) => {
      const [a, b] = k.split('|');
      return { t: 'edge', id: `s:${k}`, from: a, to: b, label: String(wt), dashed: true, bend: 0.25, tone: pathKeys?.has(`s:${k}`) ? 'path' : hot?.has(k) ? 'current' : 'accent' } as Shape;
    });
  const drawBuild = (cur?: string, hot?: Set<string>): Shape[] =>
    graphShapes(g, {
      extra: scShapes(hot),
      node: id => ({ tone: id === cur ? 'current' : rank.has(id) ? 'muted' : 'default', sub: rank.has(id) ? `r${rank.get(id)}` : undefined }),
    });

  yield frame(`Preprocess: contract nodes one by one, least important first. Keep distances by adding shortcut edges.`, drawBuild(), {
    title: 'Contraction', rows: [{ label: 'Nodes', value: String(g.nodes.length) }, { label: 'Shortcuts', value: '0' }],
  });
  let r = 0;
  while (rank.size < g.nodes.length) {
    const cands = g.nodes.filter(n => alive(n.id)).map(n => ({ id: n.id, p: plan(n.id) }));
    cands.sort((a, b) => a.p.score - b.p.score || a.p.ns.length - b.p.ns.length || a.id.localeCompare(b.id));
    const { id: v, p } = cands[0];
    rank.set(v, ++r);
    const hot = new Set<string>();
    for (const s of p.adds) {
      const k = pk(s.a, s.b);
      pairs.set(k, { w: s.w, via: v });
      shortcuts.set(k, s.w);
      hot.add(k);
    }
    let note: string;
    if (!p.ns.length) note = `Contract ${L(v)} (rank ${r}): no neighbours left, it is the top of the hierarchy.`;
    else if (p.adds.length)
      note = `Contract ${L(v)} (rank ${r}): add shortcut ${p.adds.map(s => `${L(s.a)}–${L(s.b)} = ${s.w}`).join(', ')}. No shorter path avoids ${L(v)}.`;
    else note = `Contract ${L(v)} (rank ${r}): no shortcut needed. ${p.saved.length ? `Witness ${p.saved[0]}.` : 'Only one live neighbour.'}`;
    yield frame(note, drawBuild(v, hot), {
      title: 'Contraction',
      rows: [
        { label: 'Contracted', value: `${rank.size} of ${g.nodes.length}` },
        { label: 'Shortcuts', value: String(shortcuts.size) },
        { label: 'Priority', value: `${p.adds.length} added − ${p.ns.length} removed + ${p.gone} contracted nbrs = ${p.score}` },
      ],
    });
  }

  // bidirectional upward query
  const up = (v: string) => nbrs(v).filter(n => rank.get(n.id)! > rank.get(v)!);
  const side = (s: string) => ({ dist: new Map([[s, 0]]), prev: new Map<string, string>(), pq: [{ id: s, d: 0 }], done: new Set<string>(), stopped: false });
  const F = side(src);
  const B = side(tgt);
  let best = INF;
  let meet: string | undefined;
  const drawQuery = (cur?: string, path?: { nodes: Set<string>; keys: Set<string> }): Shape[] =>
    graphShapes(g, {
      extra: scShapes(undefined, path?.keys),
      node: id => ({
        tone: path?.nodes.has(id) ? 'path' : id === cur ? 'current' : id === meet ? 'accent' : F.done.has(id) ? 'read' : B.done.has(id) ? 'write' : 'muted',
        sub: `r${rank.get(id)}`,
        badge: id === src ? 'src' : id === tgt ? 'dst' : undefined,
      }),
      edge: k => (path?.keys.has(k) ? 'path' : undefined),
    });
  const qPanel = () => ({
    title: 'Bidirectional query',
    rows: [
      { label: 'Forward', value: [...F.dist].map(([k, d]) => `${L(k)}:${fmt(d)}`).join(' '), tone: 'read' as Tone },
      { label: 'Backward', value: [...B.dist].map(([k, d]) => `${L(k)}:${fmt(d)}`).join(' '), tone: 'write' as Tone },
      { label: 'Best', value: meet ? `${fmt(best)} via ${L(meet)}` : '∞' },
    ],
  });
  yield frame(`Query ${L(src)}→${L(tgt)}: search forward from ${L(src)} and backward from ${L(tgt)}, both only climbing to higher ranks.`, drawQuery(), qPanel());
  let turn = 0;
  let settledCount = 0;
  while (!(F.stopped && B.stopped)) {
    const S = turn++ % 2 === 0 ? (F.stopped ? B : F) : B.stopped ? F : B;
    const O = S === F ? B : F;
    const dirName = S === F ? 'Forward' : 'Backward';
    S.pq.sort((a, b) => a.d - b.d || a.id.localeCompare(b.id));
    while (S.pq.length && S.done.has(S.pq[0].id)) S.pq.shift();
    if (!S.pq.length || S.pq[0].d >= best) {
      S.stopped = true;
      yield frame(`${dirName} search stops: ${S.pq.length ? `next dist ${fmt(S.pq[0].d)} ≥ best ${fmt(best)}` : 'nothing left to climb'}.`, drawQuery(), qPanel());
      continue;
    }
    const { id: u, d } = S.pq.shift()!;
    S.done.add(u);
    settledCount++;
    const relaxed: string[] = [];
    for (const n of up(u)) {
      const nd = d + n.w;
      if (nd < (S.dist.get(n.id) ?? INF)) {
        S.dist.set(n.id, nd);
        S.prev.set(n.id, u);
        S.pq.push({ id: n.id, d: nd });
        relaxed.push(`${L(n.id)} ${fmt(nd)}`);
      }
    }
    let meetNote = '';
    if (O.dist.has(u) && d + O.dist.get(u)! < best) {
      best = d + O.dist.get(u)!;
      meet = u;
      meetNote = ` Both sides reached ${L(u)}: best = ${fmt(d)}+${fmt(O.dist.get(u)!)} = ${fmt(best)}.`;
    }
    yield frame(`${dirName}: settle ${L(u)} (dist ${fmt(d)}); climb to ${relaxed.length ? relaxed.join(', ') : 'nothing higher'}.${meetNote}`, drawQuery(u), qPanel());
  }
  if (!meet) {
    yield frame(`${L(tgt)} is unreachable from ${L(src)}.`, drawQuery(), qPanel(), true);
    return;
  }
  // unpack
  const half = (S: typeof F, from: string) => {
    const out = [from];
    let c = from;
    while (S.prev.has(c)) out.push((c = S.prev.get(c)!));
    return out;
  };
  const coarse = [...half(F, meet).reverse(), ...half(B, meet).slice(1)];
  const keys = new Set<string>();
  const unpack = (a: string, b: string): string[] => {
    const arc = pairs.get(pk(a, b))!;
    if (arc.via === undefined) {
      const e = g.edges.find(x => pk(x.from, x.to) === pk(a, b))!;
      keys.add(edgeKey(e));
      return [a, b];
    }
    keys.add(`s:${pk(a, b)}`);
    return [...unpack(a, arc.via), ...unpack(arc.via, b).slice(1)];
  };
  let full = [coarse[0]];
  for (let i = 1; i < coarse.length; i++) full = [...full, ...unpack(coarse[i - 1], coarse[i]).slice(1)];
  const plain = plainSettled(g, src, tgt);
  yield frame(
    `Meet at ${L(meet)}: shortest = ${fmt(best)}. Unpack shortcuts → ${full.map(L).join(' → ')}.`,
    drawQuery(undefined, { nodes: new Set(full), keys }),
    { title: 'Result', rows: [
      { label: 'Path', value: full.map(L).join(' → '), tone: 'path' },
      { label: 'Distance', value: fmt(best), tone: 'path' },
      { label: 'CH settled', value: String(settledCount), tone: 'accent' },
      { label: 'Dijkstra settled', value: String(plain) },
      { label: 'At scale', value: 'CH ≈ 1k vs Dijkstra ≈ millions' },
    ] },
    true,
  );
}

function plainSettled(g: GraphInput, src: string, tgt: string) {
  const adj = adjacency(g);
  const dist = new Map([[src, 0]]);
  const pq = [{ id: src, d: 0 }];
  const done = new Set<string>();
  while (pq.length) {
    pq.sort((a, b) => a.d - b.d);
    const { id, d } = pq.shift()!;
    if (done.has(id)) continue;
    done.add(id);
    if (id === tgt) break;
    for (const a of adj.get(id) ?? []) if (d + a.w < (dist.get(a.to) ?? INF)) (dist.set(a.to, d + a.w), pq.push({ id: a.to, d: d + a.w }));
  }
  return done.size;
}

registerDemo({
  slug: 'contraction-hierarchies',
  title: 'Contraction hierarchies',
  group: 'Graph',
  summary: 'Precompute a node ranking plus shortcut edges, then answer queries with a tiny bidirectional upward search.',
  linkedFrom: ['Google Maps'],
  inputs: [
    { id: 'roads', label: 'Road network', data: roads },
    { id: 'small', label: 'Small graph', data: smallGraph },
  ],
  editable: 'graph',
  run: contraction,
});

// ---------- Topological sort (Kahn) ----------

export function topoOrder(g: GraphInput): string[] | null {
  const indeg = new Map(g.nodes.map(n => [n.id, 0]));
  for (const e of g.edges) indeg.set(e.to, indeg.get(e.to)! + 1);
  const q = g.nodes.filter(n => indeg.get(n.id) === 0).map(n => n.id);
  const out: string[] = [];
  while (q.length) {
    const u = q.shift()!;
    out.push(u);
    for (const e of g.edges.filter(x => x.from === u)) {
      indeg.set(e.to, indeg.get(e.to)! - 1);
      if (indeg.get(e.to) === 0) q.push(e.to);
    }
  }
  return out.length === g.nodes.length ? out : null;
}

function* topoSort(input: unknown): Generator<Frame> {
  const g0 = asGraph(input, pipeline);
  const g: GraphInput = { ...g0, edges: g0.edges.map(e => ({ ...e, directed: true })) };
  const L = (id: string) => label(g, id);
  const indeg = new Map(g.nodes.map(n => [n.id, 0]));
  for (const e of g.edges) indeg.set(e.to, indeg.get(e.to)! + 1);
  const queue = g.nodes.filter(n => indeg.get(n.id) === 0).map(n => n.id);
  const order: string[] = [];
  const draw = (cur?: string, hot = new Set<string>(), final?: 'ok' | 'cycle'): Shape[] =>
    graphShapes(g, {
      hideWeights: true,
      node: id => ({
        tone: id === cur ? 'current' : order.includes(id) ? (final === 'ok' ? 'path' : 'visited') : final === 'cycle' ? 'fail' : queue.includes(id) ? 'accent' : 'default',
        sub: order.includes(id) ? undefined : `in ${indeg.get(id)}`,
        badge: order.includes(id) ? `#${order.indexOf(id) + 1}` : undefined,
      }),
      edge: k => (hot.has(k) ? 'current' : undefined),
    });
  const panel = () => ({
    title: 'Kahn',
    rows: [
      { label: 'Queue', value: queue.map(L).join(', ') || '—', tone: 'accent' as Tone },
      { label: 'Order', value: order.map(L).join(', ') || '—' },
    ],
  });
  yield frame(`Count each job's in-degree (unmet dependencies). ${queue.map(L).join(', ') || 'Nothing'} ha${queue.length === 1 ? 's' : 've'} 0 and can run now.`, draw(), panel());
  while (queue.length) {
    const u = queue.shift()!;
    order.push(u);
    const outs = g.edges.filter(e => e.from === u);
    const drops: string[] = [];
    const ready: string[] = [];
    for (const e of outs) {
      const before = indeg.get(e.to)!;
      indeg.set(e.to, before - 1);
      if (before - 1 === 0) {
        queue.push(e.to);
        ready.push(L(e.to));
      } else drops.push(`${L(e.to)} ${before}→${before - 1}`);
    }
    const parts: string[] = [];
    if (ready.length) parts.push(ready.length === 1 ? `${ready[0]} drops to 0 and joins the queue` : `${ready.join(', ')} drop to 0 and join the queue`);
    if (drops.length) parts.push(`${drops.join(', ')} still waiting`);
    yield frame(`Take ${L(u)} (job #${order.length}). ${parts.length ? `${parts.join('; ')}.` : 'Nothing depends on it.'}`, draw(u, new Set(outs.map(edgeKey))), panel());
  }
  if (order.length === g.nodes.length) {
    yield frame(`Valid order: ${order.map(L).join(' → ')}. Every job runs after all its dependencies.`, draw(undefined, undefined, 'ok'), panel(), true);
  } else {
    const stuck = g.nodes.filter(n => !order.includes(n.id)).map(n => L(n.id));
    yield frame(`Queue empty but ${stuck.length} jobs remain (${stuck.join(', ')}): they wait on each other. That's a cycle, so no valid order exists.`, draw(undefined, undefined, 'cycle'), panel(), true);
  }
}

registerDemo({
  slug: 'topo-sort',
  title: 'Topological sort',
  group: 'Graph',
  summary: "Kahn's algorithm: repeatedly run a job with no unmet dependencies; leftovers mean a cycle.",
  linkedFrom: ['YouTube pipeline', 'Migrations'],
  inputs: [
    { id: 'pipeline', label: 'Video pipeline', data: pipeline },
    { id: 'migrations', label: 'DB migrations', data: migrations },
    { id: 'cycle', label: 'Has a cycle', data: cyclic },
  ],
  editable: 'graph',
  run: topoSort,
});
