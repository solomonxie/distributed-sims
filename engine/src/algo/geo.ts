// 'Geo' algorithm demos: geohash encode + neighbours, quadtree insert / range query.
import { registerDemo, type PanelRow, type Shape } from './frames';
import { frame, text } from './lib/draw';

// ---- geohash ----

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

interface Bounds {
  lat0: number;
  lat1: number;
  lon0: number;
  lon1: number;
}

export function geohash(lat: number, lon: number, precision: number): string {
  let b: Bounds = { lat0: -90, lat1: 90, lon0: -180, lon1: 180 };
  let out = '';
  let v = 0;
  for (let i = 0; i < precision * 5; i++) {
    const r = bisect(b, lat, lon, i);
    b = r.next;
    v = (v << 1) | r.bit;
    if (i % 5 === 4) {
      out += BASE32[v];
      v = 0;
    }
  }
  return out;
}

function bisect(b: Bounds, lat: number, lon: number, i: number) {
  if (i % 2 === 0) {
    const mid = (b.lon0 + b.lon1) / 2;
    const bit = lon >= mid ? 1 : 0;
    return { bit, mid, next: bit ? { ...b, lon0: mid } : { ...b, lon1: mid } };
  }
  const mid = (b.lat0 + b.lat1) / 2;
  const bit = lat >= mid ? 1 : 0;
  return { bit, mid, next: bit ? { ...b, lat0: mid } : { ...b, lat1: mid } };
}

function decodeBounds(hash: string): Bounds {
  let b: Bounds = { lat0: -90, lat1: 90, lon0: -180, lon1: 180 };
  let i = 0;
  for (const ch of hash) {
    const v = BASE32.indexOf(ch);
    for (let k = 4; k >= 0; k--, i++) {
      const bit = (v >> k) & 1;
      if (i % 2 === 0) {
        const mid = (b.lon0 + b.lon1) / 2;
        b = bit ? { ...b, lon0: mid } : { ...b, lon1: mid };
      } else {
        const mid = (b.lat0 + b.lat1) / 2;
        b = bit ? { ...b, lat0: mid } : { ...b, lat1: mid };
      }
    }
  }
  return b;
}

function neighbours(hash: string): string[][] {
  const b = decodeBounds(hash);
  const clat = (b.lat0 + b.lat1) / 2;
  const clon = (b.lon0 + b.lon1) / 2;
  const dLat = b.lat1 - b.lat0;
  const dLon = b.lon1 - b.lon0;
  const rows: string[][] = [];
  for (const dy of [1, 0, -1]) {
    const row: string[] = [];
    for (const dx of [-1, 0, 1]) {
      const lat = Math.max(-89.999, Math.min(89.999, clat + dy * dLat));
      let lon = clon + dx * dLon;
      if (lon >= 180) lon -= 360;
      if (lon < -180) lon += 360;
      row.push(geohash(lat, lon, hash.length));
    }
    rows.push(row);
  }
  return rows;
}

interface GhInput {
  name: string;
  lat: number;
  lon: number;
  precision: number;
}

const BOX = { x: 90, y: 40, w: 820, h: 420 };
const decimals = (span: number) => (span > 10 ? 1 : span > 1 ? 2 : span > 0.1 ? 3 : 4);

registerDemo({
  slug: 'geohash',
  title: 'Geohash encode',
  group: 'Geo',
  summary: 'Halve longitude and latitude ranges alternately; each choice is one bit. Every 5 bits become a base32 character.',
  linkedFrom: ['Proximity', 'Yelp'],
  editable: 'none',
  inputs: [
    { id: 'sf', label: 'San Francisco', data: { name: 'San Francisco', lat: 37.7749, lon: -122.4194, precision: 5 } satisfies GhInput },
    { id: 'london', label: 'London', data: { name: 'London', lat: 51.5074, lon: -0.1278, precision: 5 } satisfies GhInput },
    { id: 'edge', label: 'Cell edge', data: { name: 'Greenwich', lat: 51.4779, lon: -0.0015, precision: 5 } satisfies GhInput },
  ],
  *run(raw) {
    const inp = (raw ?? { name: 'San Francisco', lat: 37.7749, lon: -122.4194, precision: 5 }) as GhInput;
    const { lat, lon, precision } = inp;
    const nBits = precision * 5;
    const rowH = Math.min(80, 400 / precision);
    const bitX = (i: number) => 90 + (i % 5) * 84;
    const bitY = (i: number) => 520 + Math.floor(i / 5) * rowH;
    const bitVals: number[] = [];
    const chars: string[] = [];

    const boxShapes = (b: Bounds, split?: { bit: number; mid: number; lonAxis: boolean }): Shape[] => {
      const d = decimals(Math.max(b.lat1 - b.lat0, b.lon1 - b.lon0));
      const px = BOX.x + ((lon - b.lon0) / (b.lon1 - b.lon0)) * BOX.w;
      const py = BOX.y + ((b.lat1 - lat) / (b.lat1 - b.lat0)) * BOX.h;
      const s: Shape[] = [{ t: 'rect', id: 'box', x: BOX.x, y: BOX.y, w: BOX.w, h: BOX.h, tone: 'muted' }];
      if (split) {
        if (split.lonAxis) {
          s.push({ t: 'rect', id: 'half', x: split.bit ? BOX.x + BOX.w / 2 : BOX.x, y: BOX.y, w: BOX.w / 2, h: BOX.h, tone: 'accent', filled: true });
          s.push({ t: 'line', id: 'mid', x1: BOX.x + BOX.w / 2, y1: BOX.y, x2: BOX.x + BOX.w / 2, y2: BOX.y + BOX.h, tone: 'current', dashed: true, width: 3 });
        } else {
          s.push({ t: 'rect', id: 'half', x: BOX.x, y: split.bit ? BOX.y : BOX.y + BOX.h / 2, w: BOX.w, h: BOX.h / 2, tone: 'accent', filled: true });
          s.push({ t: 'line', id: 'mid', x1: BOX.x, y1: BOX.y + BOX.h / 2, x2: BOX.x + BOX.w, y2: BOX.y + BOX.h / 2, tone: 'current', dashed: true, width: 3 });
        }
      }
      const right = px > BOX.x + BOX.w - 280;
      s.push(
        { t: 'dot', id: 'pt', x: px, y: py, r: 12, tone: 'current' },
        text('ptl', px + (right ? -24 : 24), Math.max(BOX.y + 70, Math.min(BOX.y + BOX.h - 60, py)), inp.name, { align: right ? 'right' : 'left', size: 28, bold: true }),
        text('n', BOX.x + 14, BOX.y + 30, `N ${b.lat1.toFixed(d)}`, { align: 'left', size: 26, mono: true, tone: 'default' }),
        text('s', BOX.x + 14, BOX.y + BOX.h - 26, `S ${b.lat0.toFixed(d)}`, { align: 'left', size: 26, mono: true, tone: 'default' }),
        text('w', BOX.x, BOX.y + BOX.h + 30, `W ${b.lon0.toFixed(d)}`, { align: 'left', size: 26, mono: true, tone: 'default' }),
        text('e', BOX.x + BOX.w, BOX.y + BOX.h + 30, `E ${b.lon1.toFixed(d)}`, { align: 'right', size: 26, mono: true, tone: 'default' }),
      );
      return s;
    };
    const bitShapes = (cur?: number, group?: number): Shape[] => {
      const s: Shape[] = [];
      for (let i = 0; i < nBits; i++) {
        const known = i < bitVals.length;
        const hi = i === cur || (group !== undefined && Math.floor(i / 5) === group);
        s.push({
          t: 'rect', id: `b${i}`, x: bitX(i), y: bitY(i), w: 76, h: rowH - 12, mono: true,
          label: known ? String(bitVals[i]) : '·',
          tone: hi ? 'current' : known ? (i % 2 === 0 ? 'read' : 'write') : 'muted',
          filled: known,
        });
      }
      for (let g = 0; g < precision; g++) {
        s.push(text(`c${g}`, 528, bitY(g * 5) + (rowH - 12) / 2, chars[g] ?? '', { size: 40, mono: true, bold: true, align: 'left', tone: g === group ? 'current' : 'default' }));
      }
      s.push(text('leg0', 90, 960, 'lon bit', { size: 26, tone: 'read', bold: true, align: 'left' }));
      s.push(text('leg1', 210, 960, 'lat bit', { size: 26, tone: 'write', bold: true, align: 'left' }));
      return s;
    };
    const panel = (b: Bounds): { title: string; rows: PanelRow[] } => ({
      title: 'Geohash',
      rows: [
        { label: 'Point', value: `${lat}, ${lon}` },
        { label: 'Bits', value: `${bitVals.length} / ${nBits}` },
        { label: 'Hash', value: chars.join('') || '—' },
        { label: 'Cell', value: `${(b.lat1 - b.lat0).toFixed(3)}° × ${(b.lon1 - b.lon0).toFixed(3)}°` },
      ],
    });

    let b: Bounds = { lat0: -90, lat1: 90, lon0: -180, lon1: 180 };
    yield frame(
      `Encode ${inp.name} (${lat}, ${lon}) into ${nBits} bits. Even bits halve longitude, odd bits halve latitude.`,
      [...boxShapes(b), ...bitShapes()],
      panel(b),
    );

    for (let i = 0; i < nBits; i++) {
      const r = bisect(b, lat, lon, i);
      const lonAxis = i % 2 === 0;
      const d = decimals(lonAxis ? b.lon1 - b.lon0 : b.lat1 - b.lat0);
      const v = lonAxis ? lon : lat;
      const side = lonAxis ? (r.bit ? 'east' : 'west') : r.bit ? 'north' : 'south';
      bitVals.push(r.bit);
      const shapes = [...boxShapes(b, { bit: r.bit, mid: r.mid, lonAxis }), ...bitShapes(i)];
      const lo = lonAxis ? r.next.lon0 : r.next.lat0;
      const hi = lonAxis ? r.next.lon1 : r.next.lat1;
      yield frame(
        `Bit ${i + 1} (${lonAxis ? 'lon' : 'lat'}): ${v} ${r.bit ? '≥' : '<'} mid ${r.mid.toFixed(d)} → ${r.bit}. Keep the ${side} half [${lo.toFixed(d)}, ${hi.toFixed(d)}].`,
        shapes,
        panel(r.next),
      );
      b = r.next;
    }

    for (let g = 0; g < precision; g++) {
      const grp = bitVals.slice(g * 5, g * 5 + 5).join('');
      const val = parseInt(grp, 2);
      chars.push(BASE32[val]);
      yield frame(
        `Bits ${grp} = ${val} → base32 '${BASE32[val]}'. Hash so far: ${chars.join('')}.`,
        [...boxShapes(b), ...bitShapes(undefined, g)],
        panel(b),
      );
    }

    const hash = chars.join('');
    const grid = neighbours(hash);
    const flat = grid.flat();
    const shared = (h: string) => {
      let n = 0;
      while (n < h.length && h[n] === hash[n]) n++;
      return n;
    };
    const minShared = Math.min(...flat.map(shared));
    const cells: Shape[] = [];
    grid.forEach((row, ry) =>
      row.forEach((h, rx) => {
        const center = ry === 1 && rx === 1;
        cells.push({
          t: 'rect', id: `nb${ry}${rx}`, x: 590 + rx * 110, y: 520 + ry * 80, w: 104, h: 70, mono: true, label: h,
          tone: center ? 'current' : shared(h) === 0 ? 'fail' : shared(h) < precision - 1 ? 'warn' : 'accent', filled: center,
        });
      }),
    );
    yield frame(
      minShared === 0
        ? `${hash} sits on a cell edge: some neighbours share no prefix (e.g. ${flat.find(h => shared(h) === 0)}), so always search all 9 cells.`
        : `${hash} is a ${(b.lat1 - b.lat0).toFixed(2)}° × ${(b.lon1 - b.lon0).toFixed(2)}° cell. Search it plus its 8 neighbours to find nearby places.`,
      [...boxShapes(b), ...bitShapes(), ...cells, text('nbl', 752, 790, '9 cells to search', { size: 26, tone: 'default' })],
      { title: 'Neighbours', rows: [{ label: 'Hash', value: hash, tone: 'current' }, ...grid.map((row, i) => ({ label: ['North', 'Middle', 'South'][i], value: row.join(' ') }))] },
      true,
    );
  },
});

// ---- quadtree ----

interface QPoint {
  id: string;
  x: number;
  y: number;
}

interface QNode {
  id: string;
  name: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  pts: QPoint[];
  kids?: QNode[];
}

interface QtInput {
  capacity: number;
  points: [string, number, number][];
  query: { x0: number; y0: number; x1: number; y1: number };
}

const QUAD = ['NW', 'NE', 'SW', 'SE'];
const mx = (v: number) => 100 + v * 8;
const my = (v: number) => 90 + v * 8;

registerDemo({
  slug: 'quadtree',
  title: 'Quadtree insert / range query',
  group: 'Geo',
  summary: 'Each cell holds up to a few points, then splits into 4 quadrants. Range queries skip quadrants that miss the box.',
  linkedFrom: ['Proximity'],
  editable: 'none',
  inputs: [
    {
      id: 'cafes', label: 'Cafés (cap 2)',
      data: {
        capacity: 2,
        points: [['A', 20, 15], ['B', 70, 20], ['C', 80, 35], ['D', 60, 10], ['E', 30, 60], ['F', 15, 80], ['G', 85, 85], ['H', 40, 40], ['I', 65, 70], ['J', 90, 60]],
        query: { x0: 55, y0: 50, x1: 95, y1: 95 },
      } satisfies QtInput,
    },
    {
      id: 'cluster', label: 'Clustered (cap 1)',
      data: {
        capacity: 1,
        points: [['A', 70, 20], ['B', 80, 30], ['C', 60, 35], ['D', 20, 70], ['E', 85, 12], ['F', 30, 85]],
        query: { x0: 55, y0: 5, x1: 90, y1: 40 },
      } satisfies QtInput,
    },
  ],
  *run(raw) {
    const inp = (raw ?? { capacity: 2, points: [], query: { x0: 0, y0: 0, x1: 50, y1: 50 } }) as QtInput;
    const cap = inp.capacity;
    const root: QNode = { id: 'q', name: 'root', x0: 0, y0: 0, x1: 100, y1: 100, pts: [] };
    const inserted: QPoint[] = [];
    let nodeCount = 1;

    const allNodes = (n: QNode, out: QNode[] = []) => {
      out.push(n);
      n.kids?.forEach(k => allNodes(k, out));
      return out;
    };
    const draw = (o: { cur?: string; visited?: Set<string>; pruned?: Set<string>; hiPts?: Map<string, 'ok' | 'fail' | 'current'>; query?: boolean }): Shape[] => {
      const s: Shape[] = allNodes(root).map(n => ({
        t: 'rect', id: n.id, x: mx(n.x0), y: my(n.y0), w: (n.x1 - n.x0) * 8, h: (n.y1 - n.y0) * 8,
        tone: n.id === o.cur ? 'current' : o.pruned?.has(n.id) ? 'muted' : o.visited?.has(n.id) ? 'visited' : 'default',
        filled: n.id === o.cur || !!o.pruned?.has(n.id),
      }) as Shape);
      if (o.query) {
        const q = inp.query;
        s.push({ t: 'rect', id: 'query', x: mx(q.x0), y: my(q.y0), w: (q.x1 - q.x0) * 8, h: (q.y1 - q.y0) * 8, tone: 'protocol', dashed: true });
      }
      for (const p of inserted) s.push({ t: 'dot', id: `p:${p.id}`, x: mx(p.x), y: my(p.y), r: 12, label: p.id, tone: o.hiPts?.get(p.id) ?? 'accent' });
      return s;
    };
    const path = (n: QNode) => n.name;
    const stats = (extra: PanelRow[] = []) => ({
      title: 'Quadtree',
      rows: [{ label: 'Points', value: String(inserted.length) }, { label: 'Cells', value: String(nodeCount) }, { label: 'Capacity', value: `${cap} / leaf` }, ...extra],
    });
    const childFor = (n: QNode, p: QPoint) => {
      const cx = (n.x0 + n.x1) / 2;
      const cy = (n.y0 + n.y1) / 2;
      return n.kids![(p.y >= cy ? 2 : 0) + (p.x >= cx ? 1 : 0)];
    };
    const split = (n: QNode) => {
      const cx = (n.x0 + n.x1) / 2;
      const cy = (n.y0 + n.y1) / 2;
      const boxes = [[n.x0, n.y0, cx, cy], [cx, n.y0, n.x1, cy], [n.x0, cy, cx, n.y1], [cx, cy, n.x1, n.y1]];
      n.kids = boxes.map(([x0, y0, x1, y1], i) => ({
        id: `${n.id}${i}`, name: n.name === 'root' ? QUAD[i] : `${n.name}›${QUAD[i]}`, x0, y0, x1, y1, pts: [],
      }));
      nodeCount += 4;
      for (const p of n.pts) childFor(n, p).pts.push(p);
      n.pts = [];
    };

    yield frame(
      `Empty quadtree over a 100 × 100 map. Each leaf holds up to ${cap} point${cap > 1 ? 's' : ''} before splitting into NW, NE, SW, SE.`,
      draw({}),
      stats(),
    );

    for (const [id, x, y] of inp.points) {
      const p: QPoint = { id, x, y };
      inserted.push(p);
      let n = root;
      const trail: string[] = [];
      while (n.kids) {
        n = childFor(n, p);
        trail.push(n.name.split('›').pop()!);
      }
      n.pts.push(p);
      const hi = new Map<string, 'current'>([[id, 'current']]);
      yield frame(
        `Insert ${id} (${x}, ${y})${trail.length ? `: descend ${trail.join(' → ')}` : ' into the root'}. Leaf ${path(n)} now holds ${n.pts.length}${n.pts.length > cap ? ` > ${cap}` : ` ≤ ${cap}`}.`,
        draw({ cur: n.id, hiPts: hi }),
        stats(),
      );
      while (n.pts.length > cap) {
        const before = n.pts.map(q => q.id);
        split(n);
        const over = n.kids!.find(k => k.pts.length > cap);
        yield frame(
          `Split ${path(n)} into 4 quadrants and push ${before.join(', ')} down.${over ? ` ${over.name} still holds ${over.pts.length}, so split again.` : ''}`,
          draw({ cur: n.id, hiPts: new Map(before.map(b => [b, 'current'] as const)) }),
          stats(),
        );
        if (!over) break;
        n = over;
      }
    }

    // Range query.
    const q = inp.query;
    const visited = new Set<string>();
    const pruned = new Set<string>();
    const hiPts = new Map<string, 'ok' | 'fail' | 'current'>();
    const found: string[] = [];
    let checked = 0;
    const qStats = () => stats([
      { label: 'Visited', value: String(visited.size), tone: 'visited' },
      { label: 'Checked', value: `${checked} / ${inserted.length} pts` },
      { label: 'Found', value: found.join(', ') || '—', tone: 'ok' },
    ]);
    const overlaps = (n: QNode) => n.x0 < q.x1 && n.x1 > q.x0 && n.y0 < q.y1 && n.y1 > q.y0;
    const count = (n: QNode): number => n.pts.length + (n.kids ?? []).reduce((s, k) => s + count(k), 0);

    yield frame(
      `Range query: find points in x ${q.x0}–${q.x1}, y ${q.y0}–${q.y1}. Start at the root.`,
      draw({ query: true }),
      qStats(),
    );

    const frames: ReturnType<typeof frame>[] = [];
    const visit = (n: QNode) => {
      if (!overlaps(n)) {
        pruned.add(n.id);
        frames.push(frame(`${path(n)} misses the query box: prune it and skip its ${count(n)} point${count(n) === 1 ? '' : 's'}.`, draw({ cur: n.id, visited, pruned, hiPts, query: true }), qStats()));
        return;
      }
      visited.add(n.id);
      if (n.kids) {
        frames.push(frame(`${path(n)} overlaps the query box: descend into its 4 quadrants.`, draw({ cur: n.id, visited, pruned, hiPts, query: true }), qStats()));
        n.kids.forEach(visit);
        return;
      }
      const res: string[] = [];
      for (const p of n.pts) {
        checked++;
        const inside = p.x >= q.x0 && p.x <= q.x1 && p.y >= q.y0 && p.y <= q.y1;
        hiPts.set(p.id, inside ? 'ok' : 'fail');
        if (inside) found.push(p.id);
        res.push(`${p.id} ${inside ? 'inside' : 'outside'}`);
      }
      frames.push(frame(
        n.pts.length ? `Leaf ${path(n)}: check ${n.pts.length} point${n.pts.length === 1 ? '' : 's'}: ${res.join(', ')}.` : `Leaf ${path(n)} overlaps but is empty.`,
        draw({ cur: n.id, visited, pruned, hiPts, query: true }),
        qStats(),
      ));
    };
    visit(root);
    yield* frames;

    yield frame(
      `Found ${found.length} point${found.length === 1 ? '' : 's'} (${found.join(', ') || 'none'}) after checking ${checked} of ${inserted.length}. Pruned ${pruned.size} cell${pruned.size === 1 ? '' : 's'} without looking inside.`,
      draw({ visited, pruned, hiPts, query: true }),
      qStats(),
      true,
    );
  },
});
