import { allDemos, frames, getDemo } from '../src/algo';
import type { Shape } from '../src/algo';

const GROUPS = ['lang-go', 'lang-rust', 'lang-csharp', 'lang-fp'];
const FRAME_GROUPS = [...GROUPS, 'lang-lua'];
const langDemos = (gs = GROUPS) => allDemos().filter((d) => gs.includes(d.group));

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

test('each language has demos', () => {
  for (const g of GROUPS) expect(langDemos().filter((d) => d.group === g).length).toBeGreaterThanOrEqual(5);
});

describe.each(langDemos(FRAME_GROUPS).flatMap((d) => d.inputs.map((i) => [`${d.slug}/${i.id}`, d.slug, i.data] as const)))('%s', (_name, slug, data) => {
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

test('tri-colour marking frees only the unreachable object', () => {
  const fs = frames(getDemo('go-gc')!, { k: 'tricolor' });
  const last = fs[fs.length - 1].shapes;
  const tone = (id: string) => (last.find((s) => s.id === `n-${id}`) as { tone?: string }).tone;
  expect(tone('E')).toBe('fail');
  for (const o of ['A', 'B', 'C', 'D', 'F']) expect(tone(o)).toBe('accent');
});

test('every language demo has tap-to-explain details', () => {
  for (const d of langDemos(FRAME_GROUPS)) {
    const fs = frames(d, d.inputs[0].data);
    expect(fs.some((f) => f.shapes.some((s) => (s.t === 'rect' || s.t === 'node') && s.detail))).toBe(true);
  }
});
