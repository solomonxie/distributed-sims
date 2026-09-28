import { allDemos, frames, getDemo } from '../src/algo';
import type { Shape } from '../src/algo';

import { gilSchedule } from '../src/lang/python';
import { CONFLICT_TREE, resolveHighest, resolveNearest } from '../src/lang/java';

const cpp = () => allDemos().filter((d) => d.group === 'lang-python' || d.group === 'lang-java');

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

test('python and java demos exist', () => {
  expect(cpp().filter((d) => d.group === 'lang-python').length).toBeGreaterThanOrEqual(6);
  expect(cpp().filter((d) => d.group === 'lang-java').length).toBeGreaterThanOrEqual(6);
});

test('GIL round-robin: CPU-bound threads take turns, total = sum of work', () => {
  const segs = gilSchedule(2, 20, 5);
  const gil = segs.filter((s) => s.lane === 2);
  expect(Math.max(...segs.map((s) => s.t1))).toBe(40);
  for (let i = 1; i < gil.length; i++) expect(gil[i].t0).toBe(gil[i - 1].t1);
  expect(gil.map((s) => s.label)).toEqual(['T1', 'T2', 'T1', 'T2', 'T1', 'T2', 'T1', 'T2']);
  expect(gilSchedule(3, 7, 5).filter((s) => s.lane === 0).reduce((a, s) => a + s.t1 - s.t0, 0)).toBe(7);
});

test('Maven nearest-wins vs Gradle highest-version', () => {
  expect(resolveNearest(CONFLICT_TREE).guava).toBe('30.0');
  expect(resolveHighest(CONFLICT_TREE).guava).toBe('32.1');
  const deep = [{ name: 'a', version: '1', deps: [{ name: 'x', version: '2.0', deps: [{ name: 'y', version: '1.0' }] }] }, { name: 'y', version: '0.9' }];
  expect(resolveNearest(deep).y).toBe('0.9');
  expect(resolveHighest(deep).y).toBe('1.0');
  expect(resolveHighest([{ name: 'z', version: '1.10' }, { name: 'z', version: '1.9' }]).z).toBe('1.10');
});

describe.each(cpp().flatMap((d) => d.inputs.map((i) => [`${d.slug}/${i.id}`, d.slug, i.data] as const)))('%s', (_name, slug, data) => {
  const fs = frames(getDemo(slug)!, data);

  test('≥ 3 frames, ends done', () => {
    expect(fs.length).toBeGreaterThanOrEqual(3);
    expect(fs[fs.length - 1].done).toBe(true);
    expect(fs.slice(0, -1).some((f) => f.done)).toBe(false);
  });

  test('unique ids, coordinates in [0,1000], short notes, well-formed details', () => {
    for (const f of fs) {
      const ids = f.shapes.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const s of f.shapes) {
        for (const v of points(s)) {
          expect(Number.isFinite(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1000);
        }
        if ((s.t === 'rect' || s.t === 'node') && s.detail) {
          expect(s.detail.title.length).toBeGreaterThan(0);
          expect(!!(s.detail.text || s.detail.code)).toBe(true);
        }
      }
      expect(f.note.length).toBeGreaterThan(0);
      expect((f.note.match(/[.!?](\s|$)/g) ?? []).length).toBeLessThanOrEqual(2);
    }
  });
});
