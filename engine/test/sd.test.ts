import { allDemos, frames, getDemo } from '../src/algo';
import type { Shape } from '../src/algo';
import { abrPick, cardinality, naiveFleetLimit, percentile, serverlessCrossover, serverlessMonthly, slidingEstimate } from '../src/sd/lib';
import { LADDER, simulateAbr } from '../src/sd/video';

const sd = () => allDemos().filter((d) => d.group.startsWith('sd-'));

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

test('sd demos exist', () => {
  expect(sd().length).toBeGreaterThanOrEqual(15);
});

describe.each(sd().flatMap((d) => d.inputs.map((i) => [`${d.slug}/${i.id}`, d.slug, i.data] as const)))('%s', (_name, slug, data) => {
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

  test('has something to tap', () => {
    expect(fs.some((f) => f.shapes.some((s) => (s.t === 'rect' || s.t === 'node') && s.detail))).toBe(true);
  });
});

test('ABR: lowest when the buffer is nearly empty, highest that fits 80% otherwise', () => {
  expect(abrPick(LADDER, 10000, 0)).toBe(400);
  expect(abrPick(LADDER, 10000, 20)).toBe(8000);
  expect(abrPick(LADDER, 3000, 20)).toBe(1200);
  const drop = simulateAbr([9000, 9500, 9000, 1500, 900, 1200, 6000, 9000]);
  expect(drop[0].pick).toBe(400);
  expect(Math.max(...drop.map((s) => s.pick))).toBeGreaterThan(Math.min(...drop.slice(3).map((s) => s.pick)));
});

test('serverless cost grows linearly and crosses a fleet', () => {
  expect(serverlessMonthly(2e6, 100, 256)).toBeCloseTo(2 * serverlessMonthly(1e6, 100, 256), 6);
  const x = serverlessCrossover(400, 1024, 150);
  expect(serverlessMonthly(x, 400, 1024)).toBeCloseTo(150, 3);
  expect(serverlessCrossover(100, 256, 150)).toBeGreaterThan(x);
});

test('rate limit and metrics helpers', () => {
  expect(naiveFleetLimit(100, 3)).toBe(300);
  expect(slidingEstimate(90, 90, 0.02)).toBeCloseTo(178.2, 5);
  expect(percentile([1, 2, 3, 4, 100], 50)).toBe(3);
  expect(percentile([1, 2, 3, 4, 100], 99)).toBe(100);
  expect(cardinality([4, 6, 40])).toBe(960);
});
