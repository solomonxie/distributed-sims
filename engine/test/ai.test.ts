import { allDemos, frames, getDemo } from '../src/algo';
import type { Shape } from '../src/algo';
import {
  attention,
  batchingTimeline,
  bpeEncode,
  bpeTrain,
  chunk,
  cosine,
  crossEntropy,
  dpoLoss,
  kvCacheBytes,
  loraParams,
  neuronStep,
  packInt4,
  quantize,
  recallAtK,
  roofline,
  rrf,
  sgdFit,
  softmax,
  speculativeExpected,
  speculativeRound,
  topK,
  topP,
  unpackInt4,
  utf8Bytes,
} from '../src/ai/math';

describe('math', () => {
  test('softmax sums to 1 and temperature sharpens', () => {
    const p = softmax([2, 1, 0]);
    expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    expect(softmax([2, 1, 0], 0.3)[0]).toBeGreaterThan(p[0]);
  });

  test('attention rows sum to 1; causal mask zeroes the future', () => {
    const Q = [[1, 0], [0, 1], [1, 1]];
    const a = attention(Q, Q, Q, true);
    for (const r of a.weights) expect(r.reduce((x, y) => x + y, 0)).toBeCloseTo(1, 10);
    expect(a.weights[0][1]).toBe(0);
    expect(a.weights[0][0]).toBeCloseTo(1, 10);
    expect(a.out[0]).toEqual(Q[0]);
  });

  test('BPE merges the most frequent pair and encoding reuses merges', () => {
    const r = bpeTrain('low lower lowest', 3);
    expect(r.steps[0].pair).toEqual(['l', 'o']);
    expect(r.steps[1].pair).toEqual(['lo', 'w']);
    expect(r.steps[0].count).toBe(3);
    expect(bpeEncode('lowly', r.steps.map((s) => s.pair)).slice(0, 1)).toEqual(['low']);
    expect(r.tokens.join('')).toBe('low lower lowest');
  });

  test('cosine and top-k', () => {
    expect(cosine([1, 0], [2, 0])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
    const r = topK([1, 0], [{ id: 'a', v: [0, 1] }, { id: 'b', v: [1, 0.1] }], 1);
    expect(r[0].id).toBe('b');
  });

  test('neuron gradient matches a finite difference; the update lowers the loss', () => {
    const s = neuronStep([0.5, -0.3], 0.1, [1, 2], 1, 0.5);
    const eps = 1e-6;
    const up = neuronStep([0.5 + eps, -0.3], 0.1, [1, 2], 1, 0.5).loss;
    expect((up - s.loss) / eps).toBeCloseTo(s.dW[0], 4);
    expect(neuronStep(s.w2, s.b2, [1, 2], 1, 0.5).loss).toBeLessThan(s.loss);
  });

  test('SGD loss decreases', () => {
    const f = sgdFit([[0, 1], [1, 3], [2, 5], [3, 7]], 2, 0.02, 20);
    expect(f.losses[19]).toBeLessThan(f.losses[0]);
  });

  test('cross-entropy of uniform is log V', () => {
    expect(crossEntropy([0, 0, 0, 0], 2)).toBeCloseTo(Math.log(4));
  });

  test('LoRA param count and DPO sign', () => {
    expect(loraParams(4096, 4096, 8)).toMatchObject({ full: 16777216, lora: 65536 });
    expect(dpoLoss(0.1, -4, -6, -9, -8).margin).toBeCloseTo(0.3);
    expect(dpoLoss(0.1, -4, -6, -9, -8).loss).toBeLessThan(Math.log(2));
  });

  test('int8 error is under half a step; int4 packs and unpacks', () => {
    const w = [0.42, -1.27, 0.05, 0.88, -0.33, 2.1, -0.71, 0.16];
    const q8 = quantize(w, 8);
    expect(q8.maxErr).toBeLessThanOrEqual(q8.scale / 2 + 1e-12);
    expect(Math.max(...q8.q.map(Math.abs))).toBe(127);
    const q4 = quantize(w, 4);
    expect(q4.maxErr).toBeGreaterThan(q8.maxErr);
    for (const [a, b] of [[-7, 7], [3, -1], [0, -8]]) expect(unpackInt4(packInt4(a, b))).toEqual([a, b]);
  });

  test('utf8Bytes matches Node', () => {
    for (const str of ['abc', 'café', '🙂', 'é中🙂x']) expect(utf8Bytes(str)).toEqual([...Buffer.from(str, 'utf8')]);
  });

  test('KV cache for Llama-7B', () => {
    expect(kvCacheBytes(32, 32, 128, 1, 1)).toBe(524288);
    expect(kvCacheBytes(32, 32, 128, 4096, 1) / 2 ** 30).toBeCloseTo(2, 5);
  });

  test('top-p keeps the smallest prefix reaching p', () => {
    expect(topP([0.5, 0.3, 0.15, 0.05], 0.8)).toEqual([0, 1]);
    expect(topP([0.5, 0.3, 0.15, 0.05], 0.81)).toEqual([0, 1, 2]);
  });

  test('continuous batching finishes no later than static and keeps every request', () => {
    const t = batchingTimeline([6, 2, 3, 7, 2, 4], 3);
    expect(t.staticSteps).toBe(13);
    expect(t.contSteps).toBeLessThanOrEqual(t.staticSteps);
    expect(t.contEnd.length).toBe(6);
    t.contEnd.forEach((e, i) => expect(e - t.contStart[i]).toBe([6, 2, 3, 7, 2, 4][i]));
  });

  test('speculative acceptance and expectation', () => {
    const r = speculativeRound([0.6, 0.5, 0.2, 0.7], [0.7, 0.5, 0.6, 0.7], [0.3, 0.9, 0.8, 0.1]);
    expect(r.accepted).toBe(2);
    expect(r.tokens).toBe(3);
    expect(speculativeExpected(0.5, 4)).toBeCloseTo(1.9375);
    expect(speculativeExpected(1, 4)).toBe(5);
  });

  test('roofline: decode is memory-bound, big matmuls compute-bound', () => {
    expect(roofline(2 * 4096 * 4096, 2 * 4096 * 4096, 1000, 3.35).bound).toBe('memory');
    expect(roofline(1e12, 1e9, 1000, 3.35).bound).toBe('compute');
  });

  test('chunking overlaps; RRF favours items ranked high in both lists; recall@k', () => {
    const c = chunk('a b c d e f g'.split(' '), 4, 1);
    expect(c[0]).toEqual(['a', 'b', 'c', 'd']);
    expect(c[1][0]).toBe('d');
    expect(rrf([['x', 'y'], ['y', 'x', 'z']])[2].id).toBe('z');
    expect(recallAtK(['a', 'b', 'c'], ['b', 'd'], 2)).toBe(0.5);
  });
});

const ai = () => allDemos().filter((d) => d.group.startsWith('ai-'));

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

test('ai demos exist', () => {
  expect(ai().length).toBeGreaterThanOrEqual(12);
});

describe.each(ai().flatMap((d) => d.inputs.map((i) => [`${d.slug}/${i.id}`, d.slug, i.data] as const)))('%s', (_name, slug, data) => {
  const fs = frames(getDemo(slug)!, data);

  test('≥ 3 frames, ends done, has tappable details', () => {
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
        }
      }
      expect(f.note.length).toBeGreaterThan(0);
      expect((f.note.match(/[.!?](\s|$)/g) ?? []).length).toBeLessThanOrEqual(2);
    }
  });
});
