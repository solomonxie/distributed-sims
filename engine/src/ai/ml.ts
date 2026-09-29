// Machine learning basics (group `ai-ml`): data & a regression fit, gradient descent and the learning rate,
// logistic regression & cross-entropy, train/validation and overfitting.
import type { Detail, Shape, Tone } from '../algo/frames';
import { box, Film, line, machineDemo, panel, text, arrow } from '../machine/lib/draw';
import { fmt, grid } from './grid';
import { sigmoid } from './math';
import { bce, fitLine, gdPath, logisticFit, mse, polyfit, polyval } from './linmath';
import { curve, plot, scatter } from './plot';

const G = 'ai-ml';

const D: Record<string, Detail> = {
  data: { title: 'Features & labels', text: 'Each row is one example: features (inputs, x) and a label (the answer, y). Supervised learning finds a function from x to y.', code: 'import pandas as pd\ndf = pd.read_csv("houses.csv")\nX = df[["size"]].values   # features\ny = df["price"].values    # labels' },
  line: { title: 'Linear regression', text: 'Predict ŷ = w·x + b. Training picks w and b that make the mean squared error smallest.', code: 'from sklearn.linear_model import LinearRegression\nm = LinearRegression().fit(X, y)\nm.coef_, m.intercept_\nm.predict([[3.5]])' },
  mse: { title: 'Mean squared error', text: 'Average of (prediction − label)². Squaring punishes big misses and makes the loss smooth to differentiate.', code: 'mse = ((y_hat - y) ** 2).mean()' },
  gd: { title: 'Gradient descent', text: 'Compute the slope of the loss with respect to each weight and take a small step downhill. Repeat.', code: 'for step in range(steps):\n    grad = 2 * ((w * x - y) * x).mean()\n    w -= lr * grad' },
  lr: { title: 'Learning rate', text: 'The step size. Too small crawls, too big overshoots and bounces, bigger still blows up.', code: 'opt = torch.optim.SGD(model.parameters(), lr=0.05)' },
  sig: { title: 'Sigmoid', text: 'σ(z) = 1 / (1 + e^−z) squashes any number into (0, 1), read as a probability.', code: 'p = 1 / (1 + np.exp(-(X @ w + b)))\npred = (p >= 0.5).astype(int)' },
  bce: { title: 'Cross-entropy', text: 'Loss = −log(probability given to the right answer). Confident and right costs almost nothing; confident and wrong costs a lot.', code: 'loss = -(y * np.log(p) + (1 - y) * np.log(1 - p))\ntorch.nn.functional.binary_cross_entropy(p, y)' },
  boundary: { title: 'Decision boundary', text: 'Where w·x + b = 0, so the model is exactly 50/50. Logistic regression draws a straight line; deeper models bend it.', code: 'from sklearn.linear_model import LogisticRegression\nclf = LogisticRegression().fit(X, y)\nclf.coef_, clf.intercept_' },
  split: { title: 'Train / validation split', text: 'Fit on the training set only, then measure on data the model never saw. Only the validation error tells you how it will do in real use.', code: 'from sklearn.model_selection import train_test_split\nX_tr, X_val, y_tr, y_val = train_test_split(\n    X, y, test_size=0.3, random_state=0)' },
  poly: { title: 'Model capacity', text: 'A degree-d polynomial can bend d−1 times. Too little capacity underfits; too much memorises the noise.', code: 'c = np.polyfit(x_tr, y_tr, deg=6)\nnp.polyval(c, x_val)' },
};

// ---------------- data & linear regression ----------------
const HOUSES: [number, number][] = [[0.5, 1.2], [1, 1.9], [1.5, 2.3], [2, 3.1], [2.5, 3.4], [3, 4.2]];

machineDemo({
  slug: 'ai-ml-regression',
  title: 'Data, features & a regression fit',
  group: G,
  summary: 'A table of examples, the scatter plot, a guessed line with its residuals and MSE, then the least-squares fit.',
  inputs: [
    { id: 'data', label: 'Data', data: { k: 'data' } },
    { id: 'fit', label: 'Fit a line', data: { k: 'fit' } },
  ],
  details: D,
  build({ k }: { k: string }) {
    const f = new Film();
    const P = plot('pl', 440, 180, 520, 440, [0, 3.5], [0, 5], ['size (100 m²)', 'price ($100k)']);
    const table = (hl?: number): Shape[] => grid('t', 140, 220, HOUSES, { cw: 120, ch: 60, colLabels: ['x size', 'y price'], rowLabels: HOUSES.map((_, i) => `#${i}`), tone: (r) => (r === hl ? 'current' : undefined), detail: D.data });
    const pts = (hl?: number) => scatter('pt', P, HOUSES, (i) => (i === hl ? 'accent' : 'read'));
    const lineOf = (id: string, w: number, b: number, tone: Tone): Shape[] => curve(id, P, (x) => w * x + b, [0, 3.5], [0, 5], tone, 8);
    if (k === 'data') {
      f.add('Six houses: the feature x is the size, the label y is the price.', table(), panel('Data', [['examples', 6], ['features', 1], ['label', 'price']]));
      f.add('Row 3: a 200 m² house sold for $310k.', [...table(3), ...P.axes, ...pts(3)], panel('Data', [['x', 2], ['y', 3.1]]));
      f.add('Plotted, the points roughly follow a line.', [...table(), ...P.axes, ...pts()], panel('Data', [['trend', 'bigger → pricier']]));
      f.add('Supervised learning: find a function that maps x to y and works on houses not in the table.', [...P.axes, ...pts(), box('q', 60, 700, 880, 80, 'price(3.5) = ?', { mono: true, tone: 'accent' })], panel('Goal', [['learn', 'ŷ = f(x)']]));
    } else {
      const xs = HOUSES.map((p) => p[0]);
      const ys = HOUSES.map((p) => p[1]);
      const guess = { w: 0.5, b: 1 };
      const best = fitLine(HOUSES);
      const resid = (w: number, b: number): Shape[] => HOUSES.map(([x, y], i) => line(`res${i}`, P.px(x), P.py(y), P.px(x), P.py(w * x + b), 'fail', { dashed: true, width: 2 }));
      const lossG = mse(xs.map((x) => guess.w * x + guess.b), ys);
      const lossB = mse(xs.map((x) => best.w * x + best.b), ys);
      const eq = (w: number, b: number, loss: number, tone: Tone) => {
        const e = box('eq', 40, 200, 360, 100, `ŷ = ${fmt(w)}x + ${fmt(b)}`, { sub: `MSE ${fmt(loss)}`, mono: true, tone });
        if (e.t === 'rect') e.detail = D.line;
        return e;
      };
      f.add('Start with a guess: ŷ = 0.5x + 1.', [...P.axes, ...pts(), ...lineOf('lg', guess.w, guess.b, 'warn'), eq(guess.w, guess.b, lossG, 'warn')], panel('Fit', [['w', guess.w], ['b', guess.b]]));
      const m = box('mse', 40, 340, 360, 100, 'MSE', { sub: 'mean of (ŷ − y)²', mono: true });
      if (m.t === 'rect') m.detail = D.mse;
      f.add(`Each dashed line is a residual, the miss on one house; their mean square is ${fmt(lossG)}.`, [...P.axes, ...pts(), ...lineOf('lg', guess.w, guess.b, 'warn'), ...resid(guess.w, guess.b), eq(guess.w, guess.b, lossG, 'warn'), m], panel('Fit', [['MSE', fmt(lossG), 'warn']]));
      f.add(`The best line minimises that: w = ${fmt(best.w)}, b = ${fmt(best.b)}.`, [...P.axes, ...pts(), ...lineOf('lb', best.w, best.b, 'ok'), ...resid(best.w, best.b), eq(best.w, best.b, lossB, 'ok'), m], panel('Fit', [['MSE', fmt(lossB), 'ok'], ['before', fmt(lossG)]]));
      const pred = best.w * 3.5 + best.b;
      f.add(`Now predict a new house: size 3.5 gives $${fmt(pred * 100)}k.`, [...P.axes, ...pts(), ...lineOf('lb', best.w, best.b, 'ok'), ...scatter('np', P, [[3.5, pred]], () => 'accent', 16), eq(best.w, best.b, lossB, 'ok')], panel('Predict', [['ŷ(3.5)', fmt(pred), 'accent']]));
    }
    return f.frames;
  },
});

// ---------------- gradient descent & learning rate ----------------
const GX = [1, 2, 3];
const GY = [2, 4, 6];
const RATES: Record<string, { lr: number; label: string }> = {
  good: { lr: 0.05, label: 'lr 0.05, just right' },
  small: { lr: 0.01, label: 'lr 0.01, too small' },
  big: { lr: 0.19, label: 'lr 0.19, too big' },
  diverge: { lr: 0.25, label: 'lr 0.25, diverges' },
};

machineDemo({
  slug: 'ai-ml-gd',
  title: 'Gradient descent & the learning rate',
  group: G,
  summary: 'Fitting y = w·x by walking down the loss curve: the gradient, the step, and what the learning rate does.',
  inputs: Object.entries(RATES).map(([id, r]) => ({ id, label: r.label, data: { k: id } })),
  details: D,
  build({ k }: { k: string }) {
    const f = new Film();
    const { lr } = RATES[k];
    const { path, loss } = gdPath(GX, GY, lr, 0, 5);
    const P = plot('pl', 380, 160, 580, 480, [-2, 6], [0, 45], ['w', 'loss(w)']);
    const bowl = curve('bowl', P, loss, [-2, 6], [0, 45], 'muted', 48);
    const info = box('info', 40, 180, 300, 110, `lr = ${lr}`, { sub: 'y = w·x, true w = 2', mono: true, tone: 'accent' });
    if (info.t === 'rect') info.detail = D.lr;
    const walk = (upto: number): Shape[] => {
      const out: Shape[] = [];
      for (let i = 0; i <= upto; i++) {
        const p = path[i];
        const on = P.inside(p.w, p.loss);
        if (on) out.push(...scatter(`s${i}`, P, [[p.w, p.loss]], () => (i === upto ? 'current' : 'visited'), i === upto ? 14 : 9));
        if (i > 0 && on && P.inside(path[i - 1].w, path[i - 1].loss)) out.push(arrow(`a${i}`, P.px(path[i - 1].w), P.py(path[i - 1].loss), P.px(p.w), P.py(p.loss), 'accent', { width: 3 }));
      }
      if (!P.inside(path[upto].w, path[upto].loss)) out.push(box('off', 420, 680, 520, 80, `w = ${fmt(path[upto].w)}: off the chart`, { mono: true, tone: 'fail' }));
      return out;
    };
    const g = box('grad', 40, 330, 300, 110, 'dL/dw', { sub: '2·mean((wx − y)·x)', mono: true });
    if (g.t === 'rect') g.detail = D.gd;
    f.add('The loss for each possible w is a bowl, lowest at w = 2; start at w = 0.', [...P.axes, ...bowl, info, g, ...walk(0)], panel('Step 0', [['w', 0], ['loss', fmt(path[0].loss)], ['gradient', fmt(path[0].grad)]]));
    for (let t = 1; t < path.length; t++) {
      const p = path[t];
      const q = path[t - 1];
      f.add(`Step ${t}: w ← ${fmt(q.w)} − ${lr}·${fmt(q.grad)} = ${fmt(p.w)}.`, [...P.axes, ...bowl, info, g, ...walk(t)], panel(`Step ${t}`, [['w', fmt(p.w)], ['loss', fmt(p.loss), p.loss < q.loss ? 'ok' : 'fail'], ['gradient', fmt(p.grad)]]));
    }
    const end = path[path.length - 1];
    const verdict = k === 'good' ? 'Converges quickly to w ≈ 2.' : k === 'small' ? 'Still far from 2 after five steps: too slow.' : k === 'big' ? 'Bounces across the bowl but slowly settles.' : 'Each step overshoots further, so the loss explodes.';
    f.add(verdict, [...P.axes, ...bowl, info, g, ...walk(path.length - 1)], panel('Result', [['w', fmt(end.w)], ['loss', fmt(end.loss), end.loss < 1 ? 'ok' : 'fail']]));
    return f.frames;
  },
});

// ---------------- logistic regression ----------------
const CLS: { x: [number, number]; y: 0 | 1 }[] = [
  { x: [1, 1.5], y: 0 },
  { x: [1.5, 0.8], y: 0 },
  { x: [0.8, 2], y: 0 },
  { x: [2, 1], y: 0 },
  { x: [3, 3], y: 1 },
  { x: [2.5, 3.5], y: 1 },
  { x: [3.5, 2.2], y: 1 },
  { x: [2.2, 2.8], y: 1 },
];

machineDemo({
  slug: 'ai-ml-logistic',
  title: 'Logistic regression & cross-entropy',
  group: G,
  summary: 'The sigmoid turns a score into a probability, cross-entropy scores it, gradient descent draws the decision boundary.',
  inputs: [
    { id: 'sigmoid', label: 'Sigmoid', data: { k: 'sigmoid' } },
    { id: 'xent', label: 'Cross-entropy', data: { k: 'xent' } },
    { id: 'boundary', label: 'Decision boundary', data: { k: 'boundary' } },
  ],
  details: D,
  build({ k }: { k: string }) {
    const f = new Film();
    if (k === 'sigmoid') {
      const P = plot('pl', 360, 180, 600, 420, [-6, 6], [0, 1], ['z = w·x + b', 'σ(z)']);
      const sg = curve('sg', P, sigmoid, [-6, 6], [0, 1], 'accent', 48);
      const lab = box('lab', 40, 200, 280, 110, 'σ(z)', { sub: '1 / (1 + e^−z)', mono: true, tone: 'accent' });
      if (lab.t === 'rect') lab.detail = D.sig;
      f.add('A linear score z can be any number, but a probability must sit between 0 and 1.', [...P.axes, lab], panel('Sigmoid', [['z range', '−∞ … +∞']]));
      f.add('The sigmoid squashes z into (0, 1): very negative → 0, very positive → 1.', [...P.axes, ...sg, lab], panel('Sigmoid', [['σ(−6)', fmt(sigmoid(-6))], ['σ(0)', 0.5], ['σ(6)', fmt(sigmoid(6))]]));
      f.add(`A score of z = 1.5 becomes probability ${fmt(sigmoid(1.5))}.`, [...P.axes, ...sg, lab, ...scatter('pz', P, [[1.5, sigmoid(1.5)]], () => 'current', 14)], panel('Sigmoid', [['σ(1.5)', fmt(sigmoid(1.5)), 'accent']]));
      f.add('Predict class 1 when p ≥ 0.5, which is exactly where z ≥ 0.', [...P.axes, ...sg, lab, line('th', P.px(-6), P.py(0.5), P.px(6), P.py(0.5), 'warn', { dashed: true }), line('z0', P.px(0), P.py(0), P.px(0), P.py(1), 'warn', { dashed: true })], panel('Rule', [['p ≥ 0.5', 'class 1']]));
    } else if (k === 'xent') {
      const P = plot('pl', 360, 180, 600, 420, [0, 1], [0, 5], ['p given to the true class', 'loss']);
      const cv = curve('ce', P, (p) => -Math.log(Math.max(p, 1e-6)), [0.01, 1], [0, 5], 'fail', 48);
      const lab = box('lab', 40, 200, 280, 110, '−log p', { sub: 'label y = 1', mono: true, tone: 'fail' });
      if (lab.t === 'rect') lab.detail = D.bce;
      f.add('Cross-entropy charges −log of the probability the model gave to the right answer.', [...P.axes, ...cv, lab], panel('Cross-entropy', [['label', 1]]));
      for (const p of [0.9, 0.5, 0.1]) {
        const l = bce(p, 1);
        f.add(`Model says p = ${p}: loss ${fmt(l)}.`, [...P.axes, ...cv, lab, ...scatter('pt', P, [[p, l]], () => (l < 0.5 ? 'ok' : l < 1 ? 'warn' : 'fail'), 14)], panel('Cross-entropy', [['p', p], ['loss', fmt(l), l < 0.5 ? 'ok' : 'fail']]));
      }
      f.add('Confidently wrong answers are punished hardest, which pushes the model to be calibrated.', [...P.axes, ...cv, lab], panel('Cross-entropy', [['LLMs', 'same loss, over the vocabulary']]));
    } else {
      const P = plot('pl', 360, 160, 560, 500, [0, 4], [0, 4], ['x₁', 'x₂']);
      const pts = scatter('pt', P, CLS.map((c) => c.x), (i) => (CLS[i].y ? 'write' : 'read'), 13);
      const snaps = logisticFit(CLS, 0.5, [0, 5, 50, 500]);
      const lab = box('lab', 40, 200, 280, 110, 'w·x + b = 0', { sub: 'boundary', mono: true, tone: 'accent' });
      if (lab.t === 'rect') lab.detail = D.boundary;
      f.add('Two classes in 2D: blue (0) lower left, orange (1) upper right.', [...P.axes, ...pts, lab], panel('Data', [['points', CLS.length]]));
      for (const s of snaps.slice(1)) {
        const bd = Math.abs(s.w[1]) > 1e-9 ? curve(`bd${s.it}`, P, (x) => -(s.w[0] * x + s.b) / s.w[1], [0, 4], [0, 4], 'accent', 16) : [];
        f.add(`After ${s.it} gradient steps the boundary sits here: loss ${fmt(s.loss)}, accuracy ${Math.round(s.acc * 100)}%.`, [...P.axes, ...pts, ...bd, lab], panel(`Iteration ${s.it}`, [['w', `[${s.w.map(fmt)}]`], ['b', fmt(s.b)], ['loss', fmt(s.loss)], ['accuracy', `${Math.round(s.acc * 100)}%`, s.acc === 1 ? 'ok' : 'warn']]));
      }
    }
    return f.frames;
  },
});

// ---------------- train / validation, under- and overfitting ----------------
const NOISE = [0.12, -0.18, 0.08, 0.2, -0.1, -0.15, 0.17, -0.05, 0.1, -0.2];
const WAVE: [number, number][] = NOISE.map((n, i) => [i / 9, Math.sin(2 * Math.PI * (i / 9)) + n]);
const VAL = new Set([2, 5, 8]);
const TRAIN = WAVE.filter((_, i) => !VAL.has(i));
const VALID = WAVE.filter((_, i) => VAL.has(i));
const DEGREES: Record<string, { d: number; label: string }> = {
  underfit: { d: 1, label: 'Degree 1: underfit' },
  good: { d: 3, label: 'Degree 3: about right' },
  overfit: { d: 6, label: 'Degree 6: overfit' },
};

export function fitErrors(d: number) {
  const c = polyfit(TRAIN, d);
  return { c, train: mse(TRAIN.map(([x]) => polyval(c, x)), TRAIN.map((p) => p[1])), val: mse(VALID.map(([x]) => polyval(c, x)), VALID.map((p) => p[1])) };
}

machineDemo({
  slug: 'ai-ml-overfit',
  title: 'Train, validate & overfitting',
  group: G,
  summary: 'Hold out data, fit polynomials of growing degree, and watch training error fall while validation error turns up.',
  inputs: Object.entries(DEGREES).map(([id, v]) => ({ id, label: v.label, data: { k: id } })),
  details: D,
  build({ k }: { k: string }) {
    const f = new Film();
    const { d } = DEGREES[k];
    const P = plot('pl', 360, 160, 600, 500, [0, 1], [-2, 2], ['x', 'y']);
    const pts = [...scatter('tr', P, TRAIN, () => 'read', 12), ...scatter('va', P, VALID, () => 'write', 14)];
    const e = fitErrors(d);
    const sp = box('split', 40, 180, 280, 110, `${TRAIN.length} train · ${VALID.length} val`, { mono: true, tone: 'accent' });
    if (sp.t === 'rect') sp.detail = D.split;
    const cap = box('cap', 40, 330, 280, 110, `degree ${d}`, { sub: `${d + 1} coefficients`, mono: true });
    if (cap.t === 'rect') cap.detail = D.poly;
    const fit = curve('fit', P, (x) => polyval(e.c, x), [0, 1], [-2, 2], d === 6 ? 'fail' : d === 3 ? 'ok' : 'warn', 60);
    f.add('Ten noisy points from a wave: blue ones train the model, orange ones are held back to validate.', [...P.axes, ...pts, sp], panel('Split', [['train', TRAIN.length], ['validation', VALID.length]]));
    f.add(`Fit a degree-${d} polynomial to the training points only.`, [...P.axes, ...pts, sp, cap, ...fit], panel('Fit', [['degree', d]]));
    const valTone: Tone = d === 1 ? 'warn' : d === 3 ? 'ok' : 'fail';
    const verdict = d === 1 ? 'Too stiff: both errors are high, it underfits.' : d === 3 ? 'Follows the wave: both errors are low and close together.' : 'It threads every training point, yet misses the held-out ones: it memorised the noise.';
    f.add(verdict, [...P.axes, ...pts, sp, cap, ...fit, text('te', 40, 520, `train MSE ${fmt(e.train)}`, { align: 'left', size: 28, mono: true, tone: 'read' }), text('ve', 40, 570, `val MSE ${fmt(e.val)}`, { align: 'left', size: 28, mono: true, tone: valTone })], panel('Errors', [['train', fmt(e.train)], ['validation', fmt(e.val), valTone]]));
    return f.frames;
  },
});
