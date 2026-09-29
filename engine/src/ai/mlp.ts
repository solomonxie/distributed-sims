// A tiny MLP, 2 → 3 (ReLU) → 1, with real numbers (group `ai-neuralnet`): a layer as xW + b, the forward pass,
// backprop node by node through the chain rule, and the same thing for a mini-batch as matrices.
import type { Detail, Shape, Tone } from '../algo/frames';
import { box, Film, line, machineDemo, panel, text } from '../machine/lib/draw';
import type { Row } from '../machine/lib/draw';
import { fmt, grid } from './grid';
import { transpose, type Mat } from './math';
import { MLP, mlpStep, type Mlp } from './linmath';

const G = 'ai-neuralnet';
const X1: Mat = [[1, 2]];
const T1: Mat = [[1]];
const LR = 0.1;

const D: Record<string, Detail> = {
  layer: { title: 'A dense layer', text: 'z = xW + b: the input row times the weight matrix plus a bias row, then an activation. Shapes: (1×2)(2×3) + (1×3) = (1×3).', code: 'import torch\nlayer = torch.nn.Linear(2, 3)\nz = layer(x)          # x @ W.T + b in torch\nh = torch.relu(z)' },
  mlp: { title: 'An MLP', text: 'Layers stacked: each hidden neuron is a weighted sum of all inputs plus ReLU, the output a weighted sum of the hidden layer.', code: 'model = torch.nn.Sequential(\n    torch.nn.Linear(2, 3),\n    torch.nn.ReLU(),\n    torch.nn.Linear(3, 1),\n)\ny = model(torch.tensor([[1., 2.]]))' },
  chain: { title: 'Chain rule', text: 'dL/dw = dL/dy · dy/dh · dh/dz · dz/dw: multiply the local derivatives along the path from the loss back to the weight.', code: 'loss = (y - t) ** 2\nloss.backward()        # autograd does this\nmodel[0].weight.grad   # dL/dW1' },
  relu: { title: 'ReLU gradient', text: 'ReLU passes the gradient through where its input was positive and blocks it where it was negative. A neuron that is off learns nothing from this example.', code: 'dz = dh * (z > 0)' },
  batch: { title: 'A mini-batch', text: 'Rows are examples. The forward pass is two matrix products; the backward pass is two more, with transposes: dW = Xᵀ · dZ.', code: 'Z1 = X @ W1 + b1   # (4,3)\nH = np.maximum(Z1, 0)\nY = H @ W2 + b2    # (4,1)\ndW2 = H.T @ dY     # (3,1)\ndW1 = X.T @ dZ1    # (2,3)' },
  update: { title: 'The update', text: 'Every weight moves a little against its gradient: W ← W − lr · dL/dW. One step of this on every batch is training.', code: 'opt = torch.optim.SGD(model.parameters(), lr=0.1)\nopt.zero_grad()\nloss.backward()\nopt.step()' },
};

// ---------------- network diagram ----------------
const IN = [{ x: 60, y: 300 }, { x: 60, y: 560 }];
const HID = [{ x: 420, y: 180 }, { x: 420, y: 420 }, { x: 420, y: 660 }];
const OUT = { x: 780, y: 420 };
const NW = 170;
const NH = 90;

interface NetView {
  inputs?: string[];
  hidden?: string[];
  out?: string;
  loss?: string;
  w1?: string[][];
  w2?: string[];
  hot?: Set<string>;
  tones?: Record<string, Tone>;
}

function net(v: NetView): Shape[] {
  const hot = v.hot ?? new Set<string>();
  const tone = (k: string): Tone => v.tones?.[k] ?? (hot.has(k) ? 'current' : 'default');
  const out: Shape[] = [];
  IN.forEach((p, i) =>
    HID.forEach((q, j) => {
      const x1 = p.x + NW;
      const y1 = p.y + NH / 2;
      const x2 = q.x;
      const y2 = q.y + NH / 2;
      const k = `w1-${i}-${j}`;
      out.push(line(`e1-${i}-${j}`, x1, y1, x2, y2, hot.has(k) ? 'accent' : 'muted', { width: hot.has(k) ? 4 : 2 }));
      const lbl = v.w1?.[i]?.[j] ?? fmt(MLP.W1[i][j]);
      out.push(text(`l1-${i}-${j}`, x1 + (x2 - x1) * 0.28, y1 + (y2 - y1) * 0.28 - 14, lbl, { size: 24, mono: true, tone: hot.has(k) ? 'accent' : 'muted' }));
    }),
  );
  HID.forEach((q, j) => {
    const x1 = q.x + NW;
    const y1 = q.y + NH / 2;
    const k = `w2-${j}`;
    out.push(line(`e2-${j}`, x1, y1, OUT.x, OUT.y + NH / 2, hot.has(k) ? 'accent' : 'muted', { width: hot.has(k) ? 4 : 2 }));
    out.push(text(`l2-${j}`, x1 + (OUT.x - x1) * 0.45, y1 + (OUT.y + NH / 2 - y1) * 0.45 - 14, v.w2?.[j] ?? fmt(MLP.W2[j][0]), { size: 24, mono: true, tone: hot.has(k) ? 'accent' : 'muted' }));
  });
  IN.forEach((p, i) => out.push(box(`in${i}`, p.x, p.y, NW, NH, v.inputs?.[i] ?? `x${i + 1}`, { mono: true, tone: tone(`in${i}`) })));
  HID.forEach((q, j) => {
    const b = box(`h${j}`, q.x, q.y, NW, NH, v.hidden?.[j] ?? `h${j + 1}`, { sub: `b ${fmt(MLP.b1[j])}`, mono: true, tone: tone(`h${j}`) });
    if (j === 0 && b.t === 'rect') b.detail = D.mlp;
    out.push(b);
  });
  out.push(box('y', OUT.x, OUT.y, NW, NH, v.out ?? 'y', { sub: `b ${fmt(MLP.b2[0])}`, mono: true, tone: tone('y') }));
  if (v.loss) {
    const l = box('loss', OUT.x, OUT.y + 200, NW, 80, v.loss, { mono: true, tone: tone('loss') });
    if (l.t === 'rect') l.detail = D.chain;
    out.push(l);
  }
  return out;
}

const all = (pfx: string, n: number) => Array.from({ length: n }, (_, i) => `${pfx}${i}`);

machineDemo({
  slug: 'ai-mlp',
  title: 'A small network, forward & backward',
  group: G,
  summary: 'A layer as xW + b, a 2→3→1 network computed with real numbers, backprop one node at a time, and the mini-batch as matrices.',
  inputs: [
    { id: 'layer', label: 'A layer: xW + b', data: { k: 'layer' } },
    { id: 'forward', label: 'Forward pass', data: { k: 'forward' } },
    { id: 'backprop', label: 'Backprop, node by node', data: { k: 'backprop' } },
    { id: 'batch', label: 'Mini-batch as matrices', data: { k: 'batch' } },
  ],
  details: D,
  build({ k }: { k: string }) {
    const f = new Film();
    const s = mlpStep(MLP, X1, T1);
    const z = s.Z1[0];
    const h = s.H[0];
    const y = s.Y[0][0];
    if (k === 'layer') {
      const draw = (col: number, stage: 'mul' | 'bias' | 'relu' | 'none'): Shape[] => {
        const zShown = z.map((v, j) => (stage === 'none' || (stage === 'mul' && j > col) ? '·' : stage === 'mul' ? fmt(v - MLP.b1[j]) : fmt(v)));
        return [
          ...grid('x', 60, 240, X1, { cw: 90, ch: 70, title: 'x (1×2)', tone: () => (col >= 0 && stage === 'mul' ? 'accent' : undefined) }),
          ...grid('W', 300, 240, MLP.W1, { cw: 100, ch: 70, title: 'W (2×3)', tone: (_r, c) => (stage === 'mul' && c === col ? 'current' : undefined), detail: D.layer }),
          ...grid('b', 300, 460, [MLP.b1], { cw: 100, ch: 70, title: 'b (1×3)', tone: () => (stage === 'bias' ? 'accent' : undefined) }),
          text('eq', 650, 310, '→', { size: 40 }),
          ...grid('z', 700, 240, [zShown.map((v) => v)], { cw: 90, ch: 70, title: stage === 'relu' ? 'z (1×3)' : 'xW + b', tone: (_r, c) => (stage === 'mul' && c === col ? 'write' : undefined) }),
          ...(stage === 'relu' ? grid('h', 700, 460, [h], { cw: 90, ch: 70, title: 'ReLU(z)', tone: (_r, c) => (z[c] > 0 ? 'ok' : 'fail') }) : []),
        ];
      };
      f.add('A layer maps a 1×2 input to 3 outputs with a 2×3 weight matrix and a 1×3 bias.', draw(-1, 'none'), panel('Layer', [['x', '1×2'], ['W', '2×3'], ['b', '1×3']]));
      z.forEach((_, j) => f.add(`Output ${j}: x · column ${j} of W = ${fmt(X1[0][0] * MLP.W1[0][j] + X1[0][1] * MLP.W1[1][j])}.`, draw(j, 'mul'), panel('Layer', [[`(xW)[${j}]`, fmt(z[j] - MLP.b1[j])]])));
      f.add(`Add the bias row: z = [${z.map(fmt).join(', ')}].`, draw(2, 'bias'), panel('Layer', [['z', `[${z.map(fmt).join(', ')}]`]]));
      f.add(`ReLU keeps positives and zeroes the rest: h = [${h.map(fmt).join(', ')}].`, draw(2, 'relu'), panel('Layer', [['h', `[${h.map(fmt).join(', ')}]`, 'ok']]));
    } else if (k === 'forward') {
      const hv = h.map((v, j) => `${fmt(z[j])}→${fmt(v)}`);
      f.add('Two inputs, three hidden neurons with ReLU, one output; every line is a weight.', net({}), panel('Network', [['params', 2 * 3 + 3 + 3 + 1]]));
      f.add('Feed in x = [1, 2] with target t = 1.', net({ inputs: ['x₁ = 1', 'x₂ = 2'], hot: new Set(['in0', 'in1']) }), panel('Forward', [['x', '[1, 2]'], ['t', 1]]));
      for (let j = 0; j < 3; j++) {
        const hidden = hv.map((v, i) => (i <= j ? v : `h${i + 1}`));
        f.add(`h${j + 1} = relu(1·${fmt(MLP.W1[0][j])} + 2·${fmt(MLP.W1[1][j])} + ${fmt(MLP.b1[j])}) = relu(${fmt(z[j])}) = ${fmt(h[j])}.`, net({ inputs: ['x₁ = 1', 'x₂ = 2'], hidden, hot: new Set([`h${j}`, `w1-0-${j}`, `w1-1-${j}`]), tones: z[j] <= 0 && j <= 2 ? { [`h${j}`]: 'fail' } : undefined }), panel('Forward', [[`z${j + 1}`, fmt(z[j])], [`h${j + 1}`, fmt(h[j]), h[j] > 0 ? 'ok' : 'fail']]));
      }
      f.add(`y = ${h.map((v, j) => `${fmt(v)}·${fmt(MLP.W2[j][0])}`).join(' + ')} + ${fmt(MLP.b2[0])} = ${fmt(y)}.`, net({ inputs: ['x₁ = 1', 'x₂ = 2'], hidden: hv, out: `y = ${fmt(y)}`, hot: new Set(['y', ...all('w2-', 3)]) }), panel('Forward', [['y', fmt(y)]]));
      f.add(`Compared with the target 1, the loss (y − t)² is ${fmt(s.loss)}.`, net({ inputs: ['x₁ = 1', 'x₂ = 2'], hidden: hv, out: `y = ${fmt(y)}`, loss: `L = ${fmt(s.loss)}`, tones: { loss: 'warn' } }), panel('Forward', [['loss', fmt(s.loss), 'warn']]));
    } else if (k === 'backprop') {
      const hv = h.map((v) => `h ${fmt(v)}`);
      const base: NetView = { inputs: ['x₁ = 1', 'x₂ = 2'], hidden: hv, out: `y = ${fmt(y)}`, loss: `L = ${fmt(s.loss)}` };
      const dy = s.dY[0][0];
      f.add(`Start at the loss: dL/dy = 2(y − t) = ${fmt(dy)}.`, net({ ...base, out: `dL/dy ${fmt(dy)}`, tones: { y: 'write', loss: 'warn' } }), panel('Backward', [['dL/dy', fmt(dy)]]));
      f.add('Each output weight’s gradient is dL/dy times the hidden value it multiplied.', net({ ...base, out: `dL/dy ${fmt(dy)}`, w2: s.dW2.map((r) => `∇${fmt(r[0])}`), hot: new Set(all('w2-', 3)) }), panel('Backward', s.dW2.map((r, j) => [`dL/dw2[${j}]`, fmt(r[0])])));
      f.add('Going further back, each hidden neuron gets dL/dy times its outgoing weight.', net({ ...base, out: `dL/dy ${fmt(dy)}`, hidden: s.dH[0].map((v) => `dh ${fmt(v)}`), tones: { h0: 'write', h1: 'write', h2: 'write' } }), panel('Backward', s.dH[0].map((v, j) => [`dL/dh${j + 1}`, fmt(v)])));
      const reluDetail = { tones: { h0: 'write', h1: 'write', h2: 'fail' } as Record<string, Tone> };
      const rb = net({ ...base, out: `dL/dy ${fmt(dy)}`, hidden: s.dZ1[0].map((v, j) => (z[j] > 0 ? `dz ${fmt(v)}` : 'dz 0 (off)')), ...reluDetail });
      const h3 = rb.find((x) => x.id === 'h2');
      if (h3 && h3.t === 'rect') h3.detail = D.relu;
      f.add('Through ReLU: h1 and h2 were on, so the gradient passes; h3 was off, so it stops there.', rb, panel('Backward', s.dZ1[0].map((v, j): Row => [`dL/dz${j + 1}`, fmt(v), z[j] > 0 ? 'ok' : 'fail'])));
      f.add('Each first-layer weight’s gradient is its input times the neuron’s dz.', net({ ...base, hidden: s.dZ1[0].map((v) => `dz ${fmt(v)}`), w1: s.dW1.map((r) => r.map((v) => `∇${fmt(v)}`)), hot: new Set(IN.flatMap((_, i) => HID.map((_q, j) => `w1-${i}-${j}`))) }), panel('Backward', [['dL/dW1 row x₁', s.dW1[0].map(fmt).join(', ')], ['dL/dW1 row x₂', s.dW1[1].map(fmt).join(', ')]]));
      const next: Mlp = {
        W1: MLP.W1.map((r, i) => r.map((v, j) => v - LR * s.dW1[i][j])),
        b1: MLP.b1.map((v, j) => v - LR * s.db1[j]),
        W2: MLP.W2.map((r, j) => [r[0] - LR * s.dW2[j][0]]),
        b2: [MLP.b2[0] - LR * s.db2[0]],
      };
      const s2 = mlpStep(next, X1, T1);
      const up = net({ ...base, out: `y = ${fmt(s2.Y[0][0])}`, loss: `L = ${fmt(s2.loss)}`, w1: next.W1.map((r) => r.map(fmt)), w2: next.W2.map((r) => fmt(r[0])), tones: { loss: 'ok' } });
      const upBox = up.find((x) => x.id === 'y');
      if (upBox && upBox.t === 'rect') upBox.detail = D.update;
      f.add(`Step every weight against its gradient (lr ${LR}): the loss falls from ${fmt(s.loss)} to ${fmt(s2.loss)}.`, up, panel('Update', [['loss before', fmt(s.loss)], ['loss after', fmt(s2.loss), 'ok']]));
    } else {
      const X: Mat = [[1, 2], [0, 1], [2, 0], [1, 1]];
      const T: Mat = [[1], [0], [1], [0]];
      const b = mlpStep(MLP, X, T);
      const g = (id: string, m: Mat, x: number, y: number, title: string, tone?: Tone, det?: Detail) => grid(id, x, y, m.map((r) => r.map((v) => fmt(v))), { cw: 88, ch: 52, title, tone: () => tone, detail: det });
      f.add('Four examples stacked as X (4×2) go through the same weights together.', [...g('X', X, 40, 220, 'X (4×2)', undefined, D.batch), ...g('W1', MLP.W1, 280, 220, 'W1 (2×3)')], panel('Batch', [['examples', 4]]));
      f.add('Z1 = X·W1 + b1 is (4×3), one row per example; ReLU gives H.', [...g('X', X, 40, 220, 'X (4×2)'), ...g('W1', MLP.W1, 280, 220, 'W1 (2×3)'), ...g('Z', b.Z1, 40, 560, 'Z1 (4×3)', 'current'), ...g('H', b.H, 400, 560, 'H = ReLU (4×3)', 'ok')], panel('Forward', [['Z1', '4×3'], ['H', '4×3']]));
      f.add(`Y = H·W2 + b2 is (4×1); the mean loss over the batch is ${fmt(b.loss)}.`, [...g('H', b.H, 40, 220, 'H (4×3)'), ...g('W2', MLP.W2, 360, 220, 'W2 (3×1)'), ...g('Y', b.Y, 560, 220, 'Y (4×1)', 'write'), ...g('T', T, 760, 220, 'target', 'muted')], panel('Forward', [['loss', fmt(b.loss), 'warn']]));
      f.add('Backward, dW2 = Hᵀ·dY: (3×4)(4×1) = (3×1), summing over the four examples.', [...g('Ht', transpose(b.H), 40, 220, 'Hᵀ (3×4)'), ...g('dY', b.dY, 460, 220, 'dY (4×1)', 'current'), ...g('dW2', b.dW2, 700, 220, 'dW2 (3×1)', 'ok')], panel('Backward', [['dW2', '3×1']]));
      f.add('And dW1 = Xᵀ·dZ1: (2×4)(4×3) = (2×3), the same shape as W1, ready for the update.', [...g('Xt', transpose(X), 40, 220, 'Xᵀ (2×4)'), ...g('dZ', b.dZ1, 440, 220, 'dZ1 (4×3)', 'current'), ...g('dW1', b.dW1, 440, 560, 'dW1 (2×3)', 'ok')], panel('Backward', [['dW1', '2×3'], ['rule', 'dW = inputᵀ · d(output)']]));
    }
    return f.frames;
  },
});
