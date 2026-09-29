import { allDemos, frames, getDemo } from '../src/algo';
import type { Shape } from '../src/algo';
import { matmul } from '../src/ai/math';
import { bce, broadcastAdd, cosSim, dot, fitLine, gdPath, hadamard, logisticFit, matmulShape, matmulSteps, matvec, MLP, mlpStep, mse, norm, normalize, polyfit, polyval, project, softmaxSteps, solve } from '../src/ai/linmath';
import { fitErrors } from '../src/ai/ml';

const MINE = new Set(['ai-vectors', 'ai-matmul', 'ai-elementwise', 'ai-batch-gpu', 'ai-ml-regression', 'ai-ml-gd', 'ai-ml-logistic', 'ai-ml-overfit', 'ai-mlp']);
const mine = () => allDemos().filter((d) => MINE.has(d.slug));
const close = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe('linear algebra helpers', () => {
  test('dot, norm, cosine, projection', () => {
    expect(dot([1, 2, 3], [4, -5, 6])).toBe(12);
    expect(norm([3, 4])).toBe(5);
    expect(normalize([3, 4])).toEqual([0.6, 0.8]);
    close(cosSim([3, 1], [-3, -1]), -1);
    close(cosSim([3, 1], [-1, 3]), 0);
    expect(project([3, 2], [2, 0])).toEqual([3, 0]);
  });

  test('matrix products, shapes, broadcasting', () => {
    expect(matvec([[1, 2], [0, 1], [-1, 3]], [2, 1])).toEqual([4, 1, 1]);
    const A = [[1, 2, 3], [4, 5, 6]];
    const B = [[1, 0], [0, 1], [2, -1]];
    expect(matmul(A, B)).toEqual([[7, -1], [16, -1]]);
    const steps = matmulSteps(A, B);
    expect(steps).toHaveLength(12);
    expect(steps.filter((s) => s.i === 0 && s.j === 0).map((s) => s.sum)).toEqual([1, 1, 7]);
    expect(matmulShape([4, 2], [2, 3])).toEqual([4, 3]);
    expect(matmulShape([4, 2], [3, 3])).toBeUndefined();
    expect(broadcastAdd([[1, 2], [3, 4], [5, 6]], [10, 20])).toEqual([[11, 22], [13, 24], [15, 26]]);
    expect(hadamard([[1, 2], [3, 4]], [[10, 0], [-1, 2]])).toEqual([[10, 0], [-3, 8]]);
  });

  test('softmax steps sum to one and match softmax', () => {
    const s = softmaxSteps([2, 1, 0.1]);
    close(s.probs.reduce((a, b) => a + b, 0), 1);
    s.probs.forEach((p, i) => close(p, s.check[i]));
    close(s.probs[0], 0.659, 1e-3);
  });
});

describe('ML helpers', () => {
  test('least squares line and MSE', () => {
    const { w, b } = fitLine([[0, 1], [1, 3], [2, 5]]);
    close(w, 2);
    close(b, 1);
    expect(mse([1, 2], [1, 4])).toBe(2);
  });

  test('gradient descent: good converges, too-big diverges', () => {
    const good = gdPath([1, 2, 3], [2, 4, 6], 0.05, 0, 30).path;
    close(good[good.length - 1].w, 2, 1e-3);
    const bad = gdPath([1, 2, 3], [2, 4, 6], 0.25, 0, 5).path;
    expect(bad[5].loss).toBeGreaterThan(bad[0].loss);
    const first = gdPath([1, 2, 3], [2, 4, 6], 0.05, 0, 1).path;
    close(first[0].grad, -28 / 3 * 2);
  });

  test('cross-entropy and logistic regression', () => {
    close(bce(0.5, 1), Math.log(2));
    close(bce(0.9, 1), -Math.log(0.9));
    const pts: { x: [number, number]; y: 0 | 1 }[] = [{ x: [0, 0], y: 0 }, { x: [0, 1], y: 0 }, { x: [3, 3], y: 1 }, { x: [3, 2], y: 1 }];
    const snaps = logisticFit(pts, 0.5, [0, 200]);
    expect(snaps[0].acc).toBe(0.5);
    expect(snaps[1].acc).toBe(1);
    expect(snaps[1].loss).toBeLessThan(snaps[0].loss);
  });

  test('solve and polyfit recover an exact polynomial', () => {
    expect(solve([[2, 1], [1, 3]], [3, 5]).map((v) => Math.round(v * 1e6) / 1e6)).toEqual([0.8, 1.4]);
    const pts: [number, number][] = [0, 0.25, 0.5, 0.75, 1].map((x) => [x, 1 - 2 * x + 3 * x * x]);
    const c = polyfit(pts, 2);
    [1, -2, 3].forEach((v, i) => close(c[i], v, 1e-6));
    close(polyval(c, 2), 1 - 4 + 12, 1e-6);
  });

  test('overfitting: degree 6 has the lowest train error but the worst validation error', () => {
    const [d1, d3, d6] = [1, 3, 6].map(fitErrors);
    expect(d6.train).toBeLessThan(d3.train);
    expect(d3.train).toBeLessThan(d1.train);
    expect(d6.val).toBeGreaterThan(d3.val);
    expect(d1.val).toBeGreaterThan(d3.val);
  });
});

describe('tiny MLP', () => {
  test('forward values match the hand computation', () => {
    const s = mlpStep(MLP, [[1, 2]], [[1]]);
    s.Z1[0].forEach((v, i) => close(v, [1.1, 0.7, -0.9][i]));
    close(s.Y[0][0], 0.52);
    close(s.loss, 0.2304);
  });

  test('backward matches finite differences and ReLU blocks the off neuron', () => {
    const X = [[1, 2], [0, 1], [2, 0], [1, 1]];
    const T = [[1], [0], [1], [0]];
    const s = mlpStep(MLP, X, T);
    const eps = 1e-6;
    for (let i = 0; i < 2; i++)
      for (let j = 0; j < 3; j++) {
        const W1 = MLP.W1.map((r) => [...r]);
        W1[i][j] += eps;
        const num = (mlpStep({ ...MLP, W1 }, X, T).loss - s.loss) / eps;
        close(s.dW1[i][j], num, 1e-4);
      }
    for (let j = 0; j < 3; j++) {
      const W2 = MLP.W2.map((r) => [...r]);
      W2[j][0] += eps;
      close(s.dW2[j][0], (mlpStep({ ...MLP, W2 }, X, T).loss - s.loss) / eps, 1e-4);
    }
    const one = mlpStep(MLP, [[1, 2]], [[1]]);
    expect(one.dZ1[0][2]).toBe(0);
  });
});

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

test('all nine foundation demos are registered', () => {
  expect(mine().map((d) => d.slug).sort()).toEqual([...MINE].sort());
});

describe.each(mine().flatMap((d) => d.inputs.map((i) => [`${d.slug}/${i.id}`, d.slug, i.data] as const)))('%s', (_name, slug, data) => {
  const fs = frames(getDemo(slug)!, data);

  test('≥ 3 frames, ends done', () => {
    expect(fs.length).toBeGreaterThanOrEqual(3);
    expect(fs[fs.length - 1].done).toBe(true);
    expect(fs.slice(0, -1).some((f) => f.done)).toBe(false);
  });

  test('unique ids, coordinates in [0,1000], short notes, a tappable box', () => {
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
    expect(fs.some((f) => f.shapes.some((s) => (s.t === 'rect' || s.t === 'node') && s.detail))).toBe(true);
  });
});
