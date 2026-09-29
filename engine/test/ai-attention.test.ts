import { allDemos, frames, getDemo } from '../src/algo/frames';
import type { Shape } from '../src/algo/frames';
import { addM, block, blockParams, causalMask, D, embed, EMB, forward, generate, gelu, HEADS, IDS, layerNorm, linear, layerWeights, mergeHeads, mha, posEnc, scoresOf, sdpa, softmaxRows, splitHeads } from '../src/ai/attention';
import { matmul } from '../src/ai/math';

const X = addM(embed(IDS), posEnc(IDS.length));

test('embedding lookup copies rows; X is 4×8', () => {
  expect(embed([3, 0])).toEqual([EMB[3], EMB[0]]);
  expect([X.length, X[0].length]).toEqual([4, D]);
});

test('causal softmax: rows sum to 1, future weights are 0', () => {
  const w = layerWeights(0);
  const a = sdpa(linear(X, w.WQ), linear(X, w.WK), linear(X, w.WV));
  a.P.forEach((r, i) => {
    expect(r.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 9);
    r.forEach((v, j) => (j > i ? expect(v).toBe(0) : expect(v).toBeGreaterThan(0)));
  });
  expect(causalMask([[1, 2], [3, 4]])).toEqual([[1, -Infinity], [3, 4]]);
  expect(a.O.length).toBe(4);
  expect(a.O[0]).toEqual(linear(X, w.WV)[0].map((v) => expect.closeTo(v, 9)));
});

test('scores are Q·Kᵀ', () => {
  const Q = [[1, 2], [0, 1]];
  const K = [[1, 0], [1, 1]];
  expect(scoresOf(Q, K)).toEqual([[1, 3], [0, 1]]);
  expect(softmaxRows([[0, 0]])[0]).toEqual([0.5, 0.5]);
});

test('split/merge heads round-trips; multi-head = concat of per-head attention', () => {
  const hs = splitHeads(X, HEADS);
  expect(hs.map((h) => [h.length, h[0].length])).toEqual([[4, 4], [4, 4]]);
  expect(mergeHeads(hs)).toEqual(X);
  const m = mha(X);
  const per = splitHeads(m.Q, 2).map((q, i) => sdpa(q, splitHeads(m.K, 2)[i], splitHeads(m.V, 2)[i]).O);
  expect(m.concat).toEqual(mergeHeads(per));
  expect(m.out).toEqual(matmul(m.concat, layerWeights(0).WO));
});

test('layerNorm rows have mean 0 and variance 1', () => {
  const { out } = layerNorm(X);
  for (const r of out) {
    const mean = r.reduce((a, b) => a + b, 0) / r.length;
    expect(mean).toBeCloseTo(0, 6);
    expect(r.reduce((a, b) => a + (b - mean) ** 2, 0) / r.length).toBeCloseTo(1, 3);
  }
});

test('gelu, block shape, generation, parameter count', () => {
  expect(gelu(0)).toBe(0);
  expect(gelu(3)).toBeCloseTo(3, 1);
  expect(gelu(-3)).toBeCloseTo(0, 1);
  const b = block(X);
  expect([b.out.length, b.out[0].length]).toEqual([4, 8]);
  const f = forward(IDS);
  expect(f.probs.reduce((a, v) => a + v, 0)).toBeCloseTo(1, 9);
  expect(f.probs[f.next]).toBe(Math.max(...f.probs));
  const g = generate(IDS, 3);
  expect(g.seq.length).toBe(7);
  expect(g.seq[4]).toBe(f.next);
  expect(blockParams(8, 32)).toEqual({ attn: 256, mlp: 552, norms: 32, total: 840 });
  expect(blockParams(768, 3072).total).toBe(7084800);
  expect(posEnc(2, 4)[0]).toEqual([0, 1, 0, 1]);
});

const demos = () => allDemos().filter((d) => d.group === 'ai-attention' || d.group === 'ai-block-deep');

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

test('transformer deep-dive demos exist', () => {
  expect(demos().map((d) => d.slug).sort()).toEqual(['tx-block', 'tx-block-math', 'tx-embed', 'tx-generate', 'tx-mha', 'tx-qkv', 'tx-sdpa', 'tx-shapes']);
});

describe.each(demos().flatMap((d) => d.inputs.map((i) => [`${d.slug}/${i.id}`, d.slug, i.data] as const)))('%s', (_name, slug, data) => {
  const fs = frames(getDemo(slug)!, data);

  test('≥ 3 frames, ends done, has a tappable box', () => {
    expect(fs.length).toBeGreaterThanOrEqual(3);
    expect(fs[fs.length - 1].done).toBe(true);
    expect(fs.slice(0, -1).some((f) => f.done)).toBe(false);
    expect(fs.some((f) => f.shapes.some((s) => (s.t === 'rect' || s.t === 'node') && s.detail))).toBe(true);
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
          for (const l of (s.detail.code ?? '').split('\n')) expect(l.length).toBeLessThanOrEqual(60);
        }
      }
      expect(f.note.length).toBeGreaterThan(0);
      expect((f.note.match(/[.!?](\s|$)/g) ?? []).length).toBeLessThanOrEqual(2);
    }
  });
});
