// Exact numerics for the linear-algebra, ML-basics and MLP demos: every number drawn is computed here.
import { matmul, sigmoid, softmax, transpose, type Mat } from './math';

export const dot = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i], 0);
export const norm = (v: number[]) => Math.sqrt(dot(v, v));
export const normalize = (v: number[]) => {
  const n = norm(v);
  return v.map((x) => x / n);
};
export const cosSim = (a: number[], b: number[]) => dot(a, b) / (norm(a) * norm(b));
/** Projection of a onto b: (a·b / b·b) b. */
export const project = (a: number[], b: number[]) => {
  const k = dot(a, b) / dot(b, b);
  return b.map((x) => x * k);
};
export const matvec = (m: Mat, v: number[]) => m.map((row) => dot(row, v));
export const shape = (m: Mat): [number, number] => [m.length, m[0]?.length ?? 0];
/** (m×k)(k×n) → (m×n), or undefined when the inner dimensions differ. */
export const matmulShape = (a: [number, number], b: [number, number]): [number, number] | undefined => (a[1] === b[0] ? [a[0], b[1]] : undefined);
/** Add one row to every row (NumPy broadcasting of a (1×n) bias over (m×n)). */
export const broadcastAdd = (m: Mat, row: number[]) => m.map((r) => r.map((v, j) => v + row[j]));
export const hadamard = (a: Mat, b: Mat) => a.map((r, i) => r.map((v, j) => v * b[i][j]));
export const madd = (a: Mat, b: Mat) => a.map((r, i) => r.map((v, j) => v + b[i][j]));

/** Every product of C = A·B in order: cell (i, j), term k, running sum after it. */
export function matmulSteps(a: Mat, b: Mat) {
  const steps: { i: number; j: number; k: number; term: number; sum: number }[] = [];
  for (let i = 0; i < a.length; i++)
    for (let j = 0; j < b[0].length; j++) {
      let sum = 0;
      for (let k = 0; k < b.length; k++) {
        const term = a[i][k] * b[k][j];
        sum += term;
        steps.push({ i, j, k, term, sum });
      }
    }
  return steps;
}

/** softmax broken into its three steps. */
export function softmaxSteps(xs: number[]) {
  const exps = xs.map(Math.exp);
  const sum = exps.reduce((a, b) => a + b, 0);
  return { exps, sum, probs: exps.map((e) => e / sum), check: softmax(xs) };
}

// ---------- ML basics ----------
export const mse = (pred: number[], y: number[]) => pred.reduce((s, p, i) => s + (p - y[i]) ** 2, 0) / pred.length;

/** Least-squares line through the points (closed form). */
export function fitLine(pts: [number, number][]) {
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p[0], 0) / n;
  const my = pts.reduce((s, p) => s + p[1], 0) / n;
  const sxy = pts.reduce((s, [x, y]) => s + (x - mx) * (y - my), 0);
  const sxx = pts.reduce((s, [x]) => s + (x - mx) ** 2, 0);
  const w = sxy / sxx;
  return { w, b: my - w * mx };
}

/** Gradient descent on w for y ≈ w·x (no bias): loss(w) is a parabola. */
export function gdPath(xs: number[], ys: number[], lr: number, w0: number, steps: number) {
  const loss = (w: number) => mse(xs.map((x) => w * x), ys);
  const grad = (w: number) => xs.reduce((s, x, i) => s + 2 * (w * x - ys[i]) * x, 0) / xs.length;
  const path = [{ w: w0, loss: loss(w0), grad: grad(w0) }];
  for (let t = 0; t < steps; t++) {
    const w = path[path.length - 1].w - lr * path[path.length - 1].grad;
    path.push({ w, loss: loss(w), grad: grad(w) });
  }
  return { path, loss };
}

/** Binary cross-entropy of probability p for label y. */
export const bce = (p: number, y: 0 | 1) => -(y * Math.log(p) + (1 - y) * Math.log(1 - p));

/** Logistic regression on 2D points by full-batch gradient descent; snapshots at the given iterations. */
export function logisticFit(pts: { x: [number, number]; y: 0 | 1 }[], lr: number, snaps: number[]) {
  let w = [0, 0];
  let b = 0;
  const out: { it: number; w: number[]; b: number; loss: number; acc: number }[] = [];
  const stats = () => {
    let loss = 0;
    let ok = 0;
    for (const p of pts) {
      const q = Math.min(1 - 1e-9, Math.max(1e-9, sigmoid(dot(w, p.x) + b)));
      loss += bce(q, p.y);
      if ((q >= 0.5 ? 1 : 0) === p.y) ok++;
    }
    return { loss: loss / pts.length, acc: ok / pts.length };
  };
  const last = Math.max(...snaps);
  for (let it = 0; it <= last; it++) {
    if (snaps.includes(it)) out.push({ it, w: [...w], b, ...stats() });
    const g = [0, 0];
    let gb = 0;
    for (const p of pts) {
      const err = sigmoid(dot(w, p.x) + b) - p.y;
      g[0] += (err * p.x[0]) / pts.length;
      g[1] += (err * p.x[1]) / pts.length;
      gb += err / pts.length;
    }
    w = [w[0] - lr * g[0], w[1] - lr * g[1]];
    b -= lr * gb;
  }
  return out;
}

/** Solve A x = y by Gaussian elimination with partial pivoting. */
export function solve(A: Mat, y: number[]): number[] {
  const n = y.length;
  const m = A.map((r, i) => [...r, y[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    [m[c], m[p]] = [m[p], m[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r][c] / m[c][c];
      for (let k = c; k <= n; k++) m[r][k] -= f * m[c][k];
    }
  }
  return m.map((r, i) => r[n] / r[i]);
}

/** Least-squares polynomial of `degree` (coefficients lowest power first). */
export function polyfit(pts: [number, number][], degree: number): number[] {
  const X = pts.map(([x]) => Array.from({ length: degree + 1 }, (_, p) => x ** p));
  const Xt = transpose(X);
  return solve(matmul(Xt, X), matvec(Xt, pts.map((p) => p[1])));
}
export const polyval = (c: number[], x: number) => c.reduce((s, a, p) => s + a * x ** p, 0);

// ---------- a tiny MLP: 2 → 3 (ReLU) → 1, squared error ----------
export interface Mlp {
  W1: Mat;
  b1: number[];
  W2: Mat;
  b2: number[];
}
export const MLP: Mlp = { W1: [[0.5, -0.2, 0.1], [0.3, 0.4, -0.6]], b1: [0, 0.1, 0.2], W2: [[0.7], [-0.5], [0.9]], b2: [0.1] };

/** Forward + backward for a batch X (n×2) with targets T (n×1); loss = mean squared error. */
export function mlpStep(net: Mlp, X: Mat, T: Mat) {
  const n = X.length;
  const Z1 = broadcastAdd(matmul(X, net.W1), net.b1);
  const H = Z1.map((r) => r.map((v) => Math.max(0, v)));
  const Y = broadcastAdd(matmul(H, net.W2), net.b2);
  const loss = Y.reduce((s, r, i) => s + (r[0] - T[i][0]) ** 2, 0) / n;
  const dY = Y.map((r, i) => [(2 * (r[0] - T[i][0])) / n]);
  const dW2 = matmul(transpose(H), dY);
  const db2 = [dY.reduce((s, r) => s + r[0], 0)];
  const dH = matmul(dY, transpose(net.W2));
  const dZ1 = dH.map((r, i) => r.map((v, j) => (Z1[i][j] > 0 ? v : 0)));
  const dW1 = matmul(transpose(X), dZ1);
  const db1 = dZ1[0].map((_, j) => dZ1.reduce((s, r) => s + r[j], 0));
  return { Z1, H, Y, loss, dY, dW2, db2, dH, dZ1, dW1, db1 };
}
