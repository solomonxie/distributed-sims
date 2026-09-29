// Linear algebra for ML (group `ai-linalg`): vectors & dot products, matrix products cell by cell,
// shapes, transpose, element-wise ops & broadcasting, norms, softmax, batches and the GPU view.
// Also registers the ML-basics (`ai-ml`) and MLP (`ai-neuralnet`) demos.
import type { Detail, Shape, Tone } from '../algo/frames';
import { arrow, box, Film, machineDemo, panel, text } from '../machine/lib/draw';
import { bars, fmt, grid } from './grid';
import { matmul, matmulCost, transpose, type Mat } from './math';
import { broadcastAdd, cosSim, dot as vdot, hadamard, madd, matmulShape, matmulSteps, matvec, norm, normalize, project, softmaxSteps } from './linmath';
import { plot } from './plot';
import './ml';
import './mlp';

const G = 'ai-linalg';

const D: Record<string, Detail> = {
  vec: { title: 'A vector', text: 'Just an ordered list of numbers. Geometrically it is an arrow from the origin; in a model it is an embedding, a row of activations, a set of weights.', code: 'import numpy as np\nv = np.array([3, 2])\nv.shape        # (2,)\nv[0], v[1]     # 3, 2' },
  dot: { title: 'Dot product', text: 'Multiply matching entries and add them up. Large when the vectors point the same way, zero when they are at right angles.', code: 'a = np.array([1, 2, 3])\nb = np.array([4, -5, 6])\na @ b          # 1*4 + 2*-5 + 3*6 = 12\nnp.dot(a, b)   # same' },
  cos: { title: 'Cosine similarity', text: 'The dot product of the two unit vectors: +1 same direction, 0 unrelated, −1 opposite. Embedding search ranks by this.', code: 'def cos(a, b):\n    return a @ b / (np.linalg.norm(a) *\n                    np.linalg.norm(b))' },
  proj: { title: 'Projection', text: 'How much of a lies along b: (a·b / b·b) b. Attention scores are dot products: how much a query lines up with each key.', code: 'k = (a @ b) / (b @ b)\nproj = k * b' },
  A: { title: 'A matrix', text: 'A grid of numbers with a shape (rows × columns). A weight matrix maps an input vector to an output vector.', code: 'A = np.array([[1, 2, 3],\n              [4, 5, 6]])\nA.shape   # (2, 3)' },
  C: { title: 'The product C = A @ B', text: 'Cell (i, j) of C is the dot product of row i of A with column j of B. Every cell is independent, which is why GPUs love it.', code: 'C = A @ B          # numpy\nC = torch.matmul(A, B)\n# C[i, j] = sum(A[i, k] * B[k, j] for k)' },
  W: { title: 'A layer is a matrix', text: 'Each output is one row of W dotted with the input. A dense layer with 2 inputs and 3 outputs is a 3×2 matrix.', code: 'W = np.array([[1, 2], [0, 1], [-1, 3]])\nx = np.array([2, 1])\ny = W @ x   # [4, 1, 1]' },
  shape: { title: 'Shape rule', text: '(m×k) @ (k×n) = (m×n): the inner sizes must match and vanish. Most bugs in model code are shape bugs.', code: 'X = torch.randn(4, 2)\nW = torch.randn(2, 3)\n(X @ W).shape   # (4, 3)\n# torch.randn(4, 2) @ torch.randn(3, 3)\n# RuntimeError: shapes cannot be multiplied' },
  T: { title: 'Transpose', text: 'Rows become columns: (2×3) becomes (3×2). Used to make shapes line up, as in QKᵀ in attention.', code: 'A.T          # numpy\nA.transpose(0, 1)  # torch\nQ @ K.T      # attention scores' },
  bias: { title: 'Broadcasting', text: 'A (1×n) row is stretched over every row of an (m×n) matrix without copying. That is how one bias vector serves the whole batch.', code: 'X = np.array([[1, 2], [3, 4], [5, 6]])\nb = np.array([10, 20])\nX + b   # adds b to every row' },
  ew: { title: 'Element-wise', text: 'Same-shape arrays combine cell by cell: +, −, * (Hadamard) and functions like ReLU apply to each number on its own.', code: 'A + B\nA * B        # element-wise, not matmul\nnp.maximum(A, 0)   # ReLU' },
  norm: { title: 'Norm', text: 'The length of a vector: square root of the sum of squares. Dividing by it gives a unit vector; LayerNorm uses mean and variance instead.', code: 'v = np.array([3, 4])\nnp.linalg.norm(v)   # 5.0\nv / np.linalg.norm(v)   # [0.6, 0.8]' },
  sm: { title: 'Softmax', text: 'Turns any scores into probabilities: exponentiate, then divide by the total. Bigger scores get exponentially more of the mass.', code: 'def softmax(z):\n    e = np.exp(z - z.max())\n    return e / e.sum()\nsoftmax(np.array([2, 1, 0.1]))\n# [0.66, 0.24, 0.10]' },
  X: { title: 'A batch', text: 'Stack examples as rows: one matrix product then processes all of them at once.', code: 'X = np.stack([x0, x1, x2, x3])  # (4, 2)\nY = X @ W                      # (4, 3)' },
  gpu: { title: 'Why GPUs', text: 'Each output cell is its own dot product, so thousands of cores can compute them at the same time. Tensor cores do small tiles in one instruction.', code: '# 4096×4096 @ 4096×4096\n# 2·M·K·N = 137 GFLOP\n# ~0.2 ms on an H100 (tensor cores)' },
};

const shapeLabel = (m: Mat) => `${m.length}×${m[0].length}`;

// ---------------- vectors & dot products ----------------
machineDemo({
  slug: 'ai-vectors',
  title: 'Vectors & the dot product',
  group: G,
  summary: 'A vector as a list and as an arrow, the dot product term by term, cosine similarity and projection.',
  inputs: [
    { id: 'vector', label: 'Vectors', data: { k: 'vector' } },
    { id: 'dot', label: 'Dot product', data: { k: 'dot' } },
    { id: 'similarity', label: 'Similarity', data: { k: 'similarity' } },
    { id: 'projection', label: 'Projection', data: { k: 'projection' } },
  ],
  details: D,
  build({ k }: { k: string }) {
    const f = new Film();
    const P = plot('pl', 520, 200, 440, 440, [-3, 5], [-3, 5], ['x₁', 'x₂']);
    const vecArrow = (id: string, v: number[], tone: Tone, from: number[] = [0, 0]) => arrow(id, P.px(from[0]), P.py(from[1]), P.px(from[0] + v[0]), P.py(from[1] + v[1]), tone, { width: 5 });
    const cells = (id: string, v: number[], y: number, title: string, tone?: (c: number) => Tone | undefined) => grid(id, 60, y, [v], { cw: 100, title, tone: tone ? (_r, c) => tone(c) : undefined, detail: D.vec });
    if (k === 'vector') {
      const a = [3, 2];
      const b = [1, 3];
      f.add('A vector is an ordered list of numbers, here two of them.', [...cells('a', a, 260, 'a')], panel('Vector', [['a', `[${a}]`], ['size', 2]]));
      f.add('The same list is an arrow: 3 along x₁, 2 along x₂.', [...cells('a', a, 260, 'a'), ...P.axes, vecArrow('va', a, 'accent')], panel('Vector', [['a', `[${a}]`]]));
      f.add('A second vector b points somewhere else.', [...cells('a', a, 260, 'a'), ...cells('b', b, 420, 'b'), ...P.axes, vecArrow('va', a, 'accent'), vecArrow('vb', b, 'write')], panel('Vector', [['b', `[${b}]`]]));
      const s = [a[0] + b[0], a[1] + b[1]];
      f.add(`Adding them adds entry by entry: a + b = [${s}], tip to tail on the plane.`, [...cells('a', a, 260, 'a'), ...cells('b', b, 420, 'b'), ...cells('s', s, 580, 'a + b', () => 'ok'), ...P.axes, vecArrow('va', a, 'accent'), vecArrow('vb', b, 'write', a), vecArrow('vs', s, 'ok')], panel('Vector', [['a + b', `[${s}]`, 'ok']]));
      f.add('Embeddings, activations and weight rows are all vectors like these, just with hundreds or thousands of entries.', [...cells('a', a, 260, 'a'), ...cells('b', b, 420, 'b'), ...P.axes, vecArrow('va', a, 'accent'), vecArrow('vb', b, 'write')], panel('Vector', [['typical size', '768–8192']]));
    } else if (k === 'dot') {
      const a = [1, 2, 3];
      const b = [4, -5, 6];
      let sum = 0;
      f.add('The dot product pairs up entries of two same-length vectors.', [...cells('a', a, 260, 'a'), ...cells('b', b, 420, 'b')], panel('a · b', [['length', 3]]));
      a.forEach((v, i) => {
        sum += v * b[i];
        const tone = (c: number): Tone | undefined => (c === i ? 'current' : c < i ? 'visited' : undefined);
        f.add(`Multiply entry ${i}: ${v} × ${b[i]} = ${v * b[i]}, running sum ${sum}.`, [...cells('a', a, 260, 'a', tone), ...cells('b', b, 420, 'b', tone), box('sum', 60, 580, 300, 80, `sum = ${sum}`, { mono: true, tone: 'write' })], panel('a · b', [['term', `${v}·${b[i]} = ${v * b[i]}`], ['running sum', sum]]));
      });
      f.add(`a · b = ${vdot(a, b)}: one number summarising how much the two vectors agree.`, [...cells('a', a, 260, 'a'), ...cells('b', b, 420, 'b'), box('sum', 60, 580, 300, 80, `a·b = ${vdot(a, b)}`, { mono: true, tone: 'ok' })], panel('a · b', [['result', vdot(a, b), 'ok']]));
    } else if (k === 'similarity') {
      const a = [3, 1];
      const pairs: [string, number[]][] = [
        ['same direction', [4, 1.33]],
        ['right angle', [-1, 3]],
        ['opposite', [-3, -1]],
      ];
      f.add('Cosine similarity divides the dot product by both lengths, leaving only the angle.', [...P.axes, vecArrow('va', a, 'accent'), text('fa', 60, 300, 'cos θ = a·b / (|a| |b|)', { align: 'left', size: 30, mono: true })], panel('Similarity', [['a', `[${a}]`]]));
      for (const [label, b] of pairs) {
        const c = cosSim(a, b);
        const tone: Tone = c > 0.5 ? 'ok' : c < -0.5 ? 'fail' : 'warn';
        f.add(`${label[0].toUpperCase() + label.slice(1)}: cos = ${fmt(Math.round(c * 100) / 100)}.`, [...P.axes, vecArrow('va', a, 'accent'), vecArrow('vb', b, tone), text('fa', 60, 300, 'cos θ = a·b / (|a| |b|)', { align: 'left', size: 30, mono: true }), box('cv', 60, 380, 380, 90, `cos = ${fmt(Math.round(c * 100) / 100)}`, { sub: label, mono: true, tone })], panel('Similarity', [['b', `[${b.map((x) => fmt(x))}]`], ['a·b', fmt(vdot(a, b))], ['cos', fmt(Math.round(c * 100) / 100), tone]]));
      }
      const cs = box('cs', 60, 380, 380, 90, 'rank by cos', { sub: 'embedding search', mono: true, tone: 'accent' });
      if (cs.t === 'rect') cs.detail = D.cos;
      f.add('Vector search ranks documents by cosine similarity to the query embedding.', [...P.axes, vecArrow('va', a, 'accent'), cs], panel('Similarity', [['+1', 'same meaning'], ['0', 'unrelated'], ['−1', 'opposite']]));
    } else {
      const a = [3, 2];
      const b = [2, 0];
      const pr = project(a, b);
      const pb = box('pb', 60, 260, 400, 90, 'k = a·b / b·b', { sub: `= ${vdot(a, b)} / ${vdot(b, b)} = ${fmt(vdot(a, b) / vdot(b, b))}`, mono: true });
      if (pb.t === 'rect') pb.detail = D.proj;
      f.add('Two vectors: a, and a direction b.', [...P.axes, vecArrow('va', a, 'accent'), vecArrow('vb', b, 'write')], panel('Projection', [['a', `[${a}]`], ['b', `[${b}]`]]));
      f.add('The projection asks how far a reaches along b.', [...P.axes, vecArrow('va', a, 'accent'), vecArrow('vb', b, 'write'), pb], panel('Projection', [['k', fmt(vdot(a, b) / vdot(b, b))]]));
      f.add(`Scale b by k to get the shadow of a on b: [${pr.map(fmt)}].`, [...P.axes, vecArrow('va', a, 'accent'), vecArrow('vb', b, 'write'), vecArrow('vp', pr, 'ok'), arrow('drop', P.px(a[0]), P.py(a[1]), P.px(pr[0]), P.py(pr[1]), 'muted', { dashed: true }), pb], panel('Projection', [['proj', `[${pr.map(fmt)}]`, 'ok']]));
      f.add('Attention does the same kind of measuring: a query dotted with each key scores how relevant it is.', [...P.axes, vecArrow('va', a, 'accent'), vecArrow('vp', pr, 'ok'), pb], panel('Projection', [['used in', 'attention scores']]));
    }
    return f.frames;
  },
});

// ---------------- matrix products ----------------
const A: Mat = [[1, 2, 3], [4, 5, 6]];
const B: Mat = [[1, 0], [0, 1], [2, -1]];

machineDemo({
  slug: 'ai-matmul',
  title: 'Matrix × vector, matrix × matrix',
  group: G,
  summary: 'A layer as a matrix-vector product, a matrix product computed cell by cell, the shape rule and transpose.',
  inputs: [
    { id: 'matvec', label: 'Matrix × vector', data: { k: 'matvec' } },
    { id: 'matmul', label: 'Matrix × matrix', data: { k: 'matmul' } },
    { id: 'shapes', label: 'Shapes', data: { k: 'shapes' } },
    { id: 'transpose', label: 'Transpose', data: { k: 'transpose' } },
  ],
  details: D,
  build({ k }: { k: string }) {
    const f = new Film();
    if (k === 'matvec') {
      const W: Mat = [[1, 2], [0, 1], [-1, 3]];
      const x = [2, 1];
      const y = matvec(W, x);
      const draw = (row: number, filled: number): Shape[] => [
        ...grid('W', 60, 260, W, { cw: 110, title: 'W (3×2)', tone: (r) => (r === row ? 'current' : undefined), detail: D.W }),
        ...grid('x', 360, 260, x.map((v) => [v]), { cw: 110, title: 'x (2)', tone: () => (row >= 0 ? 'accent' : undefined), detail: D.vec }),
        text('eq', 530, 350, '=', { size: 40 }),
        ...grid('y', 600, 260, y.map((v, i) => [i < filled ? v : '?']), { cw: 110, title: 'y (3)', tone: (r) => (r === row ? 'write' : r < filled ? 'ok' : undefined) }),
      ];
      f.add('A layer with 2 inputs and 3 outputs is a 3×2 weight matrix W times the input x.', draw(-1, 0), panel('W · x', [['W', '3×2'], ['x', '2'], ['y', '3']]));
      y.forEach((v, i) => f.add(`Output ${i} is row ${i} of W dotted with x: ${W[i][0]}·${x[0]} + ${W[i][1]}·${x[1]} = ${v}.`, draw(i, i + 1), panel('W · x', [[`y[${i}]`, v]])));
      f.add(`y = [${y}]: every output neuron is one dot product.`, draw(-1, 3), panel('W · x', [['y', `[${y}]`, 'ok']]));
    } else if (k === 'matmul') {
      const C = matmul(A, B);
      const steps = matmulSteps(A, B);
      const draw = (i: number, j: number, kk: number, doneCells: number, partial?: number): Shape[] => [
        ...grid('A', 40, 460, A, { cw: 100, ch: 70, title: 'A (2×3)', tone: (r, c) => (r === i ? (c === kk ? 'accent' : 'current') : undefined), detail: D.A }),
        ...grid('B', 420, 180, B, { cw: 100, ch: 70, title: 'B (3×2)', tone: (r, c) => (c === j ? (r === kk ? 'accent' : 'current') : undefined) }),
        ...grid('C', 420, 460, C.map((row, r) => row.map((v, c) => (r * 2 + c < doneCells ? v : r === i && c === j && partial !== undefined ? `${partial}…` : '·'))), { cw: 100, ch: 70, title: 'C = A·B (2×2)', tone: (r, c) => (r === i && c === j ? 'write' : r * 2 + c < doneCells ? 'ok' : undefined), detail: D.C }),
      ];
      f.add('C = A · B: each cell of C pairs a row of A with a column of B.', draw(-1, -1, -1, 0), panel('A · B', [['A', '2×3'], ['B', '3×2'], ['C', '2×2']]));
      for (const s of steps.filter((x) => x.i === 0 && x.j === 0)) {
        const terms = steps.filter((x) => x.i === 0 && x.j === 0 && x.k <= s.k).map((x) => `${A[0][x.k]}·${B[x.k][0]}`);
        f.add(`C[0][0], term ${s.k}: A[0][${s.k}] × B[${s.k}][0] = ${s.term}, running sum ${s.sum}.`, draw(0, 0, s.k, 0, s.sum), panel('C[0][0]', [['terms', terms.join(' + ')], ['sum', s.sum]]));
      }
      [[0, 1], [1, 0], [1, 1]].forEach(([i, j], n) => {
        const terms = A[i].map((v, kk) => `${v}·${B[kk][j]}`).join(' + ');
        f.add(`C[${i}][${j}] = row ${i} · column ${j} = ${terms} = ${C[i][j]}.`, draw(i, j, -1, n + 1), panel(`C[${i}][${j}]`, [['terms', terms], ['sum', C[i][j]]]));
      });
      f.add(`Done: ${steps.length} multiplications for a 2×3 by 3×2 product, each cell independent of the others.`, draw(-1, -1, -1, 4), panel('A · B', [['multiplications', steps.length], ['C', JSON.stringify(C)]]));
    } else if (k === 'shapes') {
      const blk = (id: string, x: number, y: number, r: number, c: number, label: string, tone: Tone = 'default', dims: [Tone | undefined, Tone | undefined] = [undefined, undefined]) => {
        const out: Shape[] = [box(id, x, y, c * 70, r * 70, label, { mono: true, tone })];
        out.push(text(`${id}-r`, x - 12, y + (r * 70) / 2, String(r), { align: 'right', size: 28, mono: true, tone: dims[0] }));
        out.push(text(`${id}-c`, x + (c * 70) / 2, y - 22, String(c), { size: 28, mono: true, tone: dims[1] }));
        const b = out[0];
        if (b.t === 'rect') b.detail = D.shape;
        return out;
      };
      const ok = matmulShape([4, 2], [2, 3])!;
      f.add('Think of matrices as rectangles with a shape: rows × columns.', [...blk('X', 80, 300, 4, 2, 'X'), ...blk('W', 330, 300, 2, 3, 'W')], panel('Shapes', [['X', '4×2'], ['W', '2×3']]));
      f.add('X @ W needs the inner sizes to match: X has 2 columns and W has 2 rows.', [...blk('X', 80, 300, 4, 2, 'X', 'default', [undefined, 'accent']), ...blk('W', 330, 300, 2, 3, 'W', 'default', ['accent', undefined])], panel('Shapes', [['inner', '2 = 2', 'ok']]));
      f.add(`The inner 2s vanish and the result is ${ok[0]}×${ok[1]}: one row per example, one column per output.`, [...blk('X', 80, 300, 4, 2, 'X'), ...blk('W', 330, 300, 2, 3, 'W'), text('eq', 580, 440, '=', { size: 40 }), ...blk('Y', 640, 300, 4, 3, 'Y', 'ok')], panel('Shapes', [['(4×2)(2×3)', '(4×3)', 'ok']]));
      const bad = matmulShape([4, 2], [3, 3]);
      f.add('Try a 3×3 matrix instead: 2 columns against 3 rows cannot be paired, a shape error.', [...blk('X', 80, 300, 4, 2, 'X', 'default', [undefined, 'fail']), ...blk('V', 330, 300, 3, 3, 'V', 'fail', ['fail', undefined]), box('err', 80, 640, 860, 90, bad ? 'ok' : 'RuntimeError: mat1 and mat2 shapes cannot be multiplied (4x2 and 3x3)', { mono: true, tone: 'fail' })], panel('Shapes', [['inner', '2 ≠ 3', 'fail']]));
      f.add('Reading shapes is the first debugging step in any model: print them at every layer.', [...blk('X', 80, 300, 4, 2, 'X'), ...blk('W', 330, 300, 2, 3, 'W'), text('eq', 580, 440, '=', { size: 40 }), ...blk('Y', 640, 300, 4, 3, 'Y', 'ok')], panel('Shapes', [['rule', '(m×k)(k×n)=(m×n)']]));
    } else {
      const T = transpose(A);
      const draw = (row: number): Shape[] => [
        ...grid('A', 60, 300, A, { cw: 100, ch: 70, title: `A (${shapeLabel(A)})`, tone: (r) => (r === row ? 'current' : undefined), detail: D.A }),
        text('ar', 430, 370, '→', { size: 40 }),
        ...grid('T', 520, 260, T.map((r, i) => r.map((v, j) => (row >= j || row === 9 ? v : '·'))), { cw: 100, ch: 70, title: `Aᵀ (${shapeLabel(T)})`, tone: (_r, c) => (c === row ? 'write' : undefined), detail: D.T }),
      ];
      f.add('Transposing swaps rows and columns.', draw(-1), panel('Transpose', [['A', shapeLabel(A)], ['Aᵀ', shapeLabel(T)]]));
      f.add('Row 0 of A becomes column 0 of Aᵀ.', draw(0), panel('Transpose', [['row 0', `[${A[0]}]`]]));
      f.add('Row 1 becomes column 1.', draw(1), panel('Transpose', [['row 1', `[${A[1]}]`]]));
      f.add('Aᵀ is 3×2; attention uses it to score every query against every key in one product, Q·Kᵀ.', draw(9), panel('Transpose', [['in attention', 'Q @ K.T']]));
    }
    return f.frames;
  },
});

// ---------------- element-wise, broadcasting, norms, softmax ----------------
machineDemo({
  slug: 'ai-elementwise',
  title: 'Element-wise ops, broadcasting, norms & softmax',
  group: G,
  summary: 'Cell-by-cell add and multiply, a bias row broadcast over a batch, vector length and normalisation, softmax step by step.',
  inputs: [
    { id: 'elementwise', label: 'Element-wise', data: { k: 'elementwise' } },
    { id: 'broadcast', label: 'Broadcasting', data: { k: 'broadcast' } },
    { id: 'norm', label: 'Norms', data: { k: 'norm' } },
    { id: 'softmax', label: 'Softmax', data: { k: 'softmax' } },
  ],
  details: D,
  build({ k }: { k: string }) {
    const f = new Film();
    if (k === 'elementwise') {
      const P: Mat = [[1, 2], [3, 4]];
      const Q: Mat = [[10, 0], [-1, 2]];
      const g = (id: string, m: Mat, x: number, title: string, tone?: Tone) => grid(id, x, 320, m, { cw: 90, ch: 70, title, tone: () => tone, detail: D.ew });
      f.add('Element-wise operations need two arrays of the same shape.', [...g('P', P, 60, 'P'), ...g('Q', Q, 330, 'Q')], panel('Element-wise', [['shape', '2×2 and 2×2']]));
      f.add('P + Q adds matching cells.', [...g('P', P, 60, 'P'), ...g('Q', Q, 330, 'Q'), ...g('S', madd(P, Q), 620, 'P + Q', 'ok')], panel('Element-wise', [['P + Q', JSON.stringify(madd(P, Q))]]));
      f.add('P * Q multiplies matching cells, the Hadamard product, which is not a matrix product.', [...g('P', P, 60, 'P'), ...g('Q', Q, 330, 'Q'), ...g('H', hadamard(P, Q), 620, 'P * Q', 'write')], panel('Element-wise', [['P * Q', JSON.stringify(hadamard(P, Q))], ['P @ Q', JSON.stringify(matmul(P, Q))]]));
      const Z = madd(P, Q).map((r) => r.map((v) => v - 5));
      const R = Z.map((r) => r.map((v) => Math.max(0, v)));
      f.add('Activation functions work the same way: ReLU clips every cell below zero on its own.', [...g('Z', Z, 60, 'Z = P + Q − 5'), ...g('R', R, 620, 'ReLU(Z)', 'ok')], panel('Element-wise', [['ReLU', 'max(0, z) per cell']]));
    } else if (k === 'broadcast') {
      const X: Mat = [[1, 2], [3, 4], [5, 6]];
      const b = [10, 20];
      const Y = broadcastAdd(X, b);
      const draw = (row: number): Shape[] => [
        ...grid('X', 60, 300, X, { cw: 100, ch: 70, title: 'X (3×2)', tone: (r) => (r === row ? 'current' : undefined) }),
        text('plus', 300, 405, '+', { size: 40 }),
        ...grid('b', 360, 300, [b], { cw: 100, ch: 70, title: 'b (1×2)', tone: () => (row >= 0 ? 'accent' : undefined), detail: D.bias }),
        ...(row >= 0 ? [arrow('stretch', 460, 375, 460, 300 + row * 70 + 35, 'accent', { dashed: true })] : []),
        text('eq', 620, 405, '=', { size: 40 }),
        ...grid('Y', 680, 300, Y.map((r, i) => r.map((v) => (i <= row || row === 9 ? v : '·'))), { cw: 100, ch: 70, title: 'X + b (3×2)', tone: (r) => (r === row ? 'write' : r < row || row === 9 ? 'ok' : undefined) }),
      ];
      f.add('A 3×2 batch plus a single bias row of shape 1×2: the shapes differ.', draw(-1), panel('Broadcast', [['X', '3×2'], ['b', '1×2']]));
      X.forEach((r, i) => f.add(`Broadcasting reuses b for row ${i}: [${r}] + [${b}] = [${Y[i]}].`, draw(i), panel('Broadcast', [[`row ${i}`, `[${Y[i]}]`]])));
      f.add('No copies are made; the bias is stretched virtually over all rows, one bias for the whole batch.', draw(9), panel('Broadcast', [['rule', 'align from the right; 1 stretches']]));
    } else if (k === 'norm') {
      const v = [3, 4];
      const n = norm(v);
      const u = normalize(v);
      const g = (id: string, x: number, vals: (string | number)[], title: string, tone?: Tone, det?: Detail, y = 300) => grid(id, x, y, [vals], { cw: 110, ch: 70, title, tone: () => tone, detail: det });
      f.add('The length of a vector is its norm.', g('v', 60, v, 'v', undefined, D.norm), panel('Norm', [['v', `[${v}]`]]));
      f.add('Square each entry: 9 and 16.', [...g('v', 60, v, 'v'), ...g('sq', 360, v.map((x) => x * x), 'squares', 'current')], panel('Norm', [['squares', '[9, 16]']]));
      f.add(`Add and take the square root: √25 = ${n}.`, [...g('v', 60, v, 'v'), ...g('sq', 360, v.map((x) => x * x), 'squares'), box('n', 660, 300, 240, 70, `|v| = ${n}`, { mono: true, tone: 'write' })], panel('Norm', [['|v|', n]]));
      f.add(`Divide by the length to get a unit vector: [${u.map(fmt)}].`, [...g('v', 60, v, 'v'), box('n', 660, 300, 240, 70, `|v| = ${n}`, { mono: true }), ...g('u', 60, u.map((x) => fmt(x)), 'v / |v|', 'ok', undefined, 500)], panel('Norm', [['unit', `[${u.map(fmt)}]`, 'ok']]));
      f.add('Normalising keeps numbers in a stable range; LayerNorm does it per token with mean and variance.', [box('n', 660, 300, 240, 70, `|v| = ${n}`, { mono: true }), ...g('u', 60, u.map((x) => fmt(x)), 'v / |v|', 'ok', undefined, 500)], panel('Norm', [['LayerNorm', '(x − μ) / σ · γ + β']]));
    } else {
      const z = [2, 1, 0.1];
      const s = softmaxSteps(z);
      const lab = ['cat', 'dog', 'car'];
      const g = (id: string, vals: (string | number)[], title: string, y: number, tone?: Tone, det?: Detail) => grid(id, 200, y, [vals], { cw: 150, ch: 70, title, colLabels: lab, tone: () => tone, detail: det });
      f.add('A model outputs raw scores (logits), one per class.', g('z', z, 'logits z', 260, undefined, D.sm), panel('Softmax', [['z', `[${z}]`]]));
      f.add('Exponentiate each: always positive, and bigger scores grow much faster.', [...g('z', z, 'logits z', 260), ...g('e', s.exps.map((x) => fmt(x)), 'exp(z)', 420, 'current')], panel('Softmax', [['exp', `[${s.exps.map(fmt)}]`]]));
      f.add(`Add them up: ${fmt(s.sum)}.`, [...g('z', z, 'logits z', 260), ...g('e', s.exps.map((x) => fmt(x)), 'exp(z)', 420), box('sum', 200, 540, 450, 70, `sum = ${fmt(s.sum)}`, { mono: true, tone: 'write' })], panel('Softmax', [['sum', fmt(s.sum)]]));
      f.add('Divide each by the sum: probabilities that add up to 1.', [...g('z', z, 'logits z', 260), ...bars('p', 80, 560, 900, s.probs.map((p, i) => ({ label: lab[i], p, tone: i === 0 ? 'ok' : 'read' })))], panel('Softmax', [['p', `[${s.probs.map((p) => fmt(p))}]`, 'ok'], ['sum', '1.00']]));
    }
    return f.frames;
  },
});

// ---------------- a batch as a matrix, and why GPUs ----------------
machineDemo({
  slug: 'ai-batch-gpu',
  title: 'Batches & the GPU view',
  group: G,
  summary: 'Stacking examples into a matrix so one product handles the batch, and why every output cell can run in parallel.',
  inputs: [
    { id: 'batch', label: 'A batch', data: { k: 'batch' } },
    { id: 'gpu', label: 'Parallel cells', data: { k: 'gpu' } },
  ],
  details: D,
  build({ k }: { k: string }) {
    const f = new Film();
    const X: Mat = [[1, 0], [0, 1], [1, 1], [2, -1]];
    const W: Mat = [[1, 2, 0], [0, 1, 3]];
    const Y = matmul(X, W);
    if (k === 'batch') {
      f.add('Four examples, each a vector of 2 features.', X.flatMap((x, i) => grid(`x${i}`, 60, 220 + i * 110, [x], { cw: 100, ch: 70, title: i === 0 ? 'examples' : undefined, rowLabels: [`x${i}`] })), panel('Batch', [['examples', 4]]));
      f.add('Stack them as the rows of one 4×2 matrix X.', grid('X', 100, 280, X, { cw: 100, ch: 70, title: 'X (4×2)', tone: () => 'current', detail: D.X }), panel('Batch', [['X', '4×2']]));
      f.add('One product with the 2×3 weights handles all four at once.', [...grid('X', 60, 280, X, { cw: 90, ch: 70, title: 'X (4×2)' }), ...grid('W', 300, 280, W, { cw: 90, ch: 70, title: 'W (2×3)', tone: () => 'accent' }), text('eq', 610, 420, '=', { size: 40 }), ...grid('Y', 660, 280, Y, { cw: 90, ch: 70, title: 'Y (4×3)', tone: () => 'ok' })], panel('Batch', [['Y', '4×3'], ['rows', 'one per example']]));
      f.add('Row i of Y is exactly what example i alone would give, so batching changes speed, not results.', [...grid('Y', 380, 280, Y, { cw: 90, ch: 70, title: 'Y (4×3)', tone: (r) => (r === 2 ? 'write' : undefined) })], panel('Batch', [['x2 · W', `[${Y[2]}]`, 'ok']]));
    } else {
      const N = 4;
      const cells = (lit: (r: number, c: number) => Tone | undefined, label = ''): Shape[] => {
        const g = grid('C', 300, 260, Array.from({ length: N }, () => Array.from({ length: N }, () => label)), { cw: 100, ch: 90, title: 'C = A·B (4×4)', tone: lit });
        const first = g.find((s) => s.id === 'C-0-0');
        if (first && first.t === 'rect') first.detail = D.gpu;
        return g;
      };
      const cost = matmulCost(4096, 4096, 4096);
      f.add('Each of the 16 output cells is its own dot product; none needs another.', cells(() => undefined, '·'), panel('4×4 output', [['cells', 16]]));
      f.add('A single CPU core computes them one after another.', cells((r, c) => (r * N + c < 3 ? 'ok' : r * N + c === 3 ? 'current' : undefined)), panel('CPU core', [['done', '3 of 16'], ['time', '16 steps']]));
      f.add('A GPU gives every cell its own thread, so all 16 finish in one step.', cells(() => 'current'), panel('GPU', [['threads', 16], ['time', '1 step', 'ok']]));
      f.add('Tensor cores go further and multiply whole tiles per instruction.', cells((r, c) => ((Math.floor(r / 2) + Math.floor(c / 2)) % 2 ? 'write' : 'read')), panel('GPU', [['tile', '2×2 per instruction']]));
      f.add(`A 4096³ product is ${fmt(cost.flops / 1e9)} GFLOP, a fraction of a millisecond on a modern GPU; models are mostly this.`, cells(() => 'ok'), panel('Cost', [['FLOPs', `2·M·K·N = ${fmt(cost.flops / 1e9)} G`]]));
    }
    return f.frames;
  },
});
