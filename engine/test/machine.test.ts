import { allDemos, frames, getDemo } from '../src/algo';
import type { Shape } from '../src/algo';
import { BELADY_REFS, missRate, pageWalk, replace, STANDARD_REFS, WALK_VA } from '../src/machine/lib/sims';

const GROUPS = ['machine-cpu', 'machine-memory', 'machine-bus'];
const machine = () => allDemos().filter((d) => GROUPS.includes(d.group));

function points(s: Shape): number[] {
  switch (s.t) {
    case 'rect':
      return [s.x, s.y, s.x + s.w, s.y + s.h];
    case 'line':
      return [s.x1, s.y1, s.x2, s.y2];
    case 'arc':
      return [s.cx - s.r, s.cy - s.r, s.cx + s.r, s.cy + s.r];
    case 'node':
      return s.r ? [s.x - s.r, s.y - s.r, s.x + s.r, s.y + s.r] : [s.x, s.y];
    case 'edge':
      return [s.from, s.to].flatMap((p) => (typeof p === 'string' ? [] : [p.x, p.y]));
    default:
      return [s.x, s.y];
  }
}

test('every group has demos', () => {
  for (const g of GROUPS) expect(machine().filter((d) => d.group === g).length).toBeGreaterThanOrEqual(5);
});

describe.each(machine().flatMap((d) => d.inputs.map((i) => [`${d.slug}/${i.id}`, d.slug, i.data] as const)))('%s', (_name, slug, data) => {
  const fs = frames(getDemo(slug)!, data);

  test('≥ 3 frames, ends done', () => {
    expect(fs.length).toBeGreaterThanOrEqual(3);
    expect(fs[fs.length - 1].done).toBe(true);
    expect(fs.slice(0, -1).some((f) => f.done)).toBe(false);
  });

  test('unique ids, coordinates in [0,1000], short notes', () => {
    for (const f of fs) {
      const ids = f.shapes.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const s of f.shapes) for (const v of points(s)) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1000);
      }
      expect(f.note.length).toBeGreaterThan(0);
      expect((f.note.match(/[.!?](\s|$)/g) ?? []).length).toBeLessThanOrEqual(2);
    }
  });
});

test('row-major miss rate < column-major', () => {
  const row = missRate('row');
  const col = missRate('col');
  expect(row).toBeCloseTo(1 / 16, 3);
  expect(col).toBeGreaterThan(0.9);
  expect(row).toBeLessThan(col);
});

test('LRU faults ≤ FIFO on the standard reference string', () => {
  const fifo = replace('fifo', STANDARD_REFS, 3).faults;
  const lru = replace('lru', STANDARD_REFS, 3).faults;
  expect(fifo).toBe(15);
  expect(lru).toBe(12);
  expect(lru).toBeLessThanOrEqual(fifo);
});

test('Belady preset: FIFO faults increase with more frames', () => {
  expect(replace('fifo', BELADY_REFS, 4).faults).toBeGreaterThan(replace('fifo', BELADY_REFS, 3).faults);
  const fs = frames(getDemo('mem-page-replacement')!, { policy: 'fifo', belady: true });
  const rows = fs[fs.length - 1].panel!.rows;
  const f3 = Number(rows.find((r) => r.label === 'faults (3 frames)')!.value);
  const f4 = Number(rows.find((r) => r.label === 'faults (4 frames)')!.value);
  expect(f4).toBeGreaterThan(f3);
});

test('page walk ends at frame 0x9C with offset 0xC41', () => {
  const w = pageWalk(WALK_VA);
  expect(w.frame).toBe(0x9c);
  expect(w.offset).toBe(0xc41);
  expect(w.pa).toBe(0x9cc41);
  expect(w.idx.slice(0, 3)).toEqual([0, 1, 505]);
  const fs = frames(getDemo('mem-paging')!, { tlb: 'miss' });
  const phys = fs[fs.length - 1].panel!.rows.find((r) => r.label === 'physical')!;
  expect(phys.value).toBe('0x9CC41');
});
