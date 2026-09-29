// AI foundations: a neuron and backprop, BPE tokenization, embeddings and vector search.
import type { Detail, Shape } from '../algo/frames';
import { arrow, box, Film, machineDemo, panel, text } from '../machine/lib/draw';
import { bars, fmt, grid } from './grid';
import { bpeEncode, bpeTrain, cosine, neuronStep, relu, sgdFit, sigmoid, topK, utf8Bytes, vadd, vsub } from './math';

// ---------------- neural network ----------------
const W = [0.5, -0.3];
const B = 0.1;
const X = [1, 2];
const Y = 1;
const LR = 0.5;

const NN_DETAILS: Record<string, Detail> = {
  neuron: {
    title: 'A neuron',
    text: 'A weighted sum of its inputs plus a bias, squashed by an activation. Every layer of every network is thousands of these in parallel.',
    code: 'import numpy as np\nw, b = np.array([0.5, -0.3]), 0.1\nx = np.array([1.0, 2.0])\nz = w @ x + b          # -0.0\na = 1 / (1 + np.exp(-z))  # 0.5',
  },
  loss: { title: 'Loss', text: 'How wrong the output is. Squared error here; language models use cross-entropy on the next token.', code: 'loss = (a - y) ** 2' },
  x1: { title: 'Input x₁', text: 'One feature of the example. In an LLM the inputs are embedding numbers, not raw words.' },
  x2: { title: 'Input x₂', text: 'Each input has its own weight; training nudges the weights, never the inputs.' },
  e0: { title: 'Loss per epoch', text: 'Mean squared error over all points after each full pass. Mini-batches make many small steps per epoch.', code: 'for epoch in range(12):\n    for xb, yb in batches(pts, 2):\n        err = w * xb + b - yb\n        w -= lr * (2 * err * xb).mean()\n        b -= lr * (2 * err).mean()' },
  grad: {
    title: 'Backpropagation',
    text: 'The chain rule, applied from the loss backwards: how much would the loss change if this weight moved a little?',
    code: 'dA = 2 * (a - y)\ndZ = dA * a * (1 - a)   # sigmoid\'\ndW = dZ * x\nw -= lr * dW            # gradient descent',
  },
};

function neuronShapes(o: { z?: string; a?: string; loss?: string; grads?: string[]; hot?: string[]; w?: number[]; b?: number }): Shape[] {
  const w = o.w ?? W;
  const hot = new Set(o.hot ?? []);
  const t = (k: string) => (hot.has(k) ? 'current' : 'default');
  const out: Shape[] = [
    box('x1', 40, 200, 200, 90, `x₁ = ${X[0]}`, { mono: true, tone: t('x') }),
    box('x2', 40, 420, 200, 90, `x₂ = ${X[1]}`, { mono: true, tone: t('x') }),
    box('neuron', 360, 280, 260, 150, 'Σ → σ', { sub: o.z ? `z = ${o.z}` : 'w·x + b', mono: true, tone: t('z') }),
    box('out', 700, 280, 250, 150, o.a ? `a = ${o.a}` : 'a = ?', { sub: `target y = ${Y}`, mono: true, tone: t('a') }),
    box('loss', 700, 520, 250, 110, o.loss ? `loss = ${o.loss}` : 'loss', { mono: true, tone: hot.has('loss') ? 'warn' : 'default' }),
    arrow('ax1', 242, 245, 356, 330, hot.has('w') ? 'accent' : 'muted'),
    arrow('ax2', 242, 465, 356, 390, hot.has('w') ? 'accent' : 'muted'),
    arrow('az', 622, 355, 696, 355, 'muted'),
    arrow('al', 825, 432, 825, 516, 'muted'),
    text('w1', 270, 262, `w₁ ${fmt(w[0])}`, { size: 26, mono: true, tone: hot.has('w') ? 'accent' : undefined }),
    text('w2', 270, 450, `w₂ ${fmt(w[1])}`, { size: 26, mono: true, tone: hot.has('w') ? 'accent' : undefined }),
    text('bb', 490, 460, `b ${fmt(o.b ?? B)}`, { size: 26, mono: true }),
  ];
  if (o.grads) {
    const g = box('grad', 40, 700, 910, 60 + o.grads.length * 42, undefined, { tone: 'write', filled: false });
    out.push(g);
    o.grads.forEach((l, i) => out.push(text(`g${i}`, 64, 740 + i * 42, l, { align: 'left', size: 26, mono: true })));
    if (g.t === 'rect') g.detail = NN_DETAILS.grad;
  }
  return out;
}

machineDemo({
  slug: 'ai-nn',
  title: 'A neuron, backprop & SGD',
  group: 'ai-neuralnet',
  summary: 'One neuron forward and backward with real numbers, mini-batch gradient descent on a line, and activation functions.',
  inputs: [
    { id: 'forward', label: 'Forward pass', data: { k: 'forward' } },
    { id: 'backprop', label: 'Backprop', data: { k: 'backprop' } },
    { id: 'sgd', label: 'Mini-batch SGD', data: { k: 'sgd' } },
    { id: 'activations', label: 'Activations', data: { k: 'activations' } },
  ],
  details: NN_DETAILS,
  build({ k }: { k: string }) {
    const f = new Film();
    const s = neuronStep(W, B, X, Y, LR);
    if (k === 'forward') {
      f.add('A neuron takes two inputs, each with a weight, plus a bias.', neuronShapes({ hot: ['x'] }), panel('Neuron', [['w', W.join(', ')], ['b', B]]));
      f.add(`Weighted sum: 0.5·1 − 0.3·2 + 0.1 = ${fmt(s.z)}.`, neuronShapes({ z: fmt(s.z), hot: ['z', 'w'] }), panel('Neuron', [['z', fmt(s.z)]]));
      f.add(`The sigmoid squashes z into (0, 1): σ(${fmt(s.z)}) = ${fmt(s.a)}.`, neuronShapes({ z: fmt(s.z), a: fmt(s.a), hot: ['a'] }), panel('Neuron', [['a', fmt(s.a)]]));
      f.add(`The target is 1, so the squared error is ${fmt(s.loss)}.`, neuronShapes({ z: fmt(s.z), a: fmt(s.a), loss: fmt(s.loss), hot: ['loss'] }), panel('Neuron', [['loss', fmt(s.loss), 'warn']]));
    } else if (k === 'backprop') {
      const base = { z: fmt(s.z), a: fmt(s.a), loss: fmt(s.loss) };
      f.add('Backprop asks how the loss changes as each weight moves, starting from the loss.', neuronShapes({ ...base, hot: ['loss'], grads: [`dL/da = 2(a − y) = ${fmt(s.dA)}`] }), panel('Gradients', [['dL/da', fmt(s.dA)]]));
      f.add(`Through the sigmoid: dL/dz = dL/da · a(1 − a) = ${fmt(s.dZ)}.`, neuronShapes({ ...base, hot: ['a'], grads: [`dL/da = ${fmt(s.dA)}`, `dL/dz = ${fmt(s.dZ)}`] }), panel('Gradients', [['dL/dz', fmt(s.dZ)]]));
      f.add('Each weight’s gradient is dL/dz times its input.', neuronShapes({ ...base, hot: ['w'], grads: [`dL/da = ${fmt(s.dA)}`, `dL/dz = ${fmt(s.dZ)}`, `dL/dw = [${s.dW.map(fmt).join(', ')}]`] }), panel('Gradients', [['dL/dw₁', fmt(s.dW[0])], ['dL/dw₂', fmt(s.dW[1])]]));
      const after = neuronStep(s.w2, s.b2, X, Y, LR);
      f.add(`Step against the gradient (lr ${LR}): the loss falls from ${fmt(s.loss)} to ${fmt(after.loss)}.`, neuronShapes({ z: fmt(after.z), a: fmt(after.a), loss: fmt(after.loss), w: s.w2, b: s.b2, hot: ['w', 'loss'], grads: [`w ← w − lr·dL/dw = [${s.w2.map(fmt).join(', ')}]`] }), panel('Gradients', [['loss before', fmt(s.loss)], ['loss after', fmt(after.loss), 'ok']]));
    } else if (k === 'sgd') {
      const pts: [number, number][] = [[0, 1], [1, 3], [2, 5], [3, 7], [4, 9], [5, 11]];
      const fit = sgdFit(pts, 2, 0.02, 12);
      const chart = (upto: number): Shape[] => {
        const out: Shape[] = [text('ct', 40, 60, 'loss per epoch (fit y = 2x + 1, batch 2)', { align: 'left', size: 26, bold: true })];
        const max = fit.losses[0];
        fit.losses.slice(0, upto).forEach((l, i) => {
          const h = Math.max(4, (l / max) * 560);
          out.push(box(`e${i}`, 60 + i * 74, 720 - h, 60, h, undefined, { tone: i === upto - 1 ? 'current' : 'read' }));
          out.push(text(`el${i}`, 90 + i * 74, 750, String(i + 1), { size: 24, mono: true }));
        });
        return out;
      };
      f.add('Mini-batch SGD: take 2 points, average their gradients, step, repeat.', chart(1), panel('SGD', [['epoch', 1], ['loss', fmt(fit.losses[0])]]));
      f.add('Each epoch sees every point once; the loss drops fast at first.', chart(4), panel('SGD', [['epoch', 4], ['loss', fmt(fit.losses[3])]]));
      f.add(`After 12 epochs w = ${fmt(fit.w)}, b = ${fmt(fit.b)}, heading for 2 and 1.`, chart(12), panel('SGD', [['epoch', 12], ['loss', fmt(fit.losses[11]), 'ok']]));
    } else {
      const xs = [-2, -1, 0, 1, 2];
      const rows = [xs.map((x) => sigmoid(x)), xs.map((x) => Math.tanh(x)), xs.map((x) => relu(x))];
      const g = (hi: number) => grid('act', 220, 260, rows, { cw: 140, ch: 90, rowLabels: ['sigmoid', 'tanh', 'ReLU'], colLabels: xs.map((x) => `x=${x}`), tone: (r) => (r === hi ? 'current' : undefined), title: 'activation(x)', detail: { title: 'Activation functions', text: 'Applied element-wise after each linear layer. Transformers mostly use GELU, a smooth ReLU.', code: 'torch.sigmoid(x); torch.tanh(x)\ntorch.relu(x);    F.gelu(x)' } });
      f.add('Without a nonlinearity, stacked layers collapse into one linear map.', g(-1), panel('Activations', [['why', 'nonlinearity']]));
      f.add('Sigmoid and tanh saturate, so gradients vanish at the ends.', g(0), panel('Activations', [['σ′(2)', fmt(sigmoid(2) * (1 - sigmoid(2)))]]));
      f.add('ReLU is zero or the identity: cheap, and its gradient never shrinks for positive inputs.', g(2), panel('Activations', [['used in', 'most modern nets']]));
    }
    return f.frames;
  },
});

// ---------------- tokenization ----------------
const BPE_TEXT = 'low lower lowest';
const bpe = bpeTrain(BPE_TEXT, 6);

function tokenRow(id: string, y: number, toks: string[], hot?: (t: string, i: number) => boolean, title?: string): Shape[] {
  const out: Shape[] = [];
  if (title) out.push(text(`${id}-t`, 30, y - 30, title, { align: 'left', size: 26, bold: true }));
  let x = 30;
  toks.forEach((t, i) => {
    const w = Math.max(48, 26 + 22 * [...t].length);
    if (x + w > 980) return;
    out.push(box(`${id}-${i}`, x, y, w, 70, t === ' ' ? '␣' : t.replace(/ /g, '␣'), { mono: true, tone: hot?.(t, i) ? 'current' : 'default' }));
    x += w + 6;
  });
  return out;
}

const BPE_DETAILS: Record<string, Detail> = {
  vocab: {
    title: 'Byte-pair encoding',
    text: 'Start from characters (or bytes) and repeatedly merge the most frequent adjacent pair into a new token. GPT-2 did 50,000 merges.',
    code: 'def merge_step(tokens):\n    pairs = Counter(zip(tokens, tokens[1:]))\n    (a, b), n = pairs.most_common(1)[0]\n    out, i = [], 0\n    while i < len(tokens):\n        if tokens[i:i+2] == [a, b]:\n            out.append(a + b); i += 2\n        else:\n            out.append(tokens[i]); i += 1\n    return out',
  },
};

machineDemo({
  slug: 'ai-bpe',
  title: 'Tokenization & BPE',
  group: 'ai-tokenizer',
  summary: 'Word vs character tokens, byte-pair-encoding merges learned step by step, encoding new text, and byte-level fallback.',
  inputs: [
    { id: 'levels', label: 'Word vs char', data: { k: 'levels' } },
    { id: 'merges', label: 'Learn merges', data: { k: 'merges' } },
    { id: 'encode', label: 'Encode new text', data: { k: 'encode' } },
    { id: 'bytes', label: 'Byte-level', data: { k: 'bytes' } },
  ],
  details: BPE_DETAILS,
  build({ k }: { k: string }) {
    const f = new Film();
    const v = (label: string, sub: string) => box('vocab', 30, 820, 940, 120, label, { sub, mono: true, tone: 'write' });
    if (k === 'levels') {
      const words = BPE_TEXT.split(' ');
      f.add('A model reads integer ids, not text, so text must be cut into tokens first.', [...tokenRow('raw', 200, [BPE_TEXT], undefined, 'text')], panel('Tokens', [['chars', BPE_TEXT.length]]));
      f.add('Word tokens are short sequences, but every unseen word is out of vocabulary.', [...tokenRow('w', 200, words, undefined, 'word-level'), v('vocab = every word ever seen', '"lowish" → <unk>')], panel('Tokens', [['tokens', words.length], ['unknowns', 'likely', 'warn']]));
      f.add('Character tokens never miss, but sequences get long and each token means little.', [...tokenRow('c', 200, [...BPE_TEXT], undefined, 'char-level'), v('vocab = ~100 characters', 'long sequences, costly attention')], panel('Tokens', [['tokens', BPE_TEXT.length, 'warn']]));
      f.add('Subwords sit in between: frequent chunks become one token, rare words split into pieces.', [...tokenRow('s', 200, bpe.tokens, undefined, 'subword (BPE)'), v('vocab = chars + learned merges', 'no <unk>, short sequences')], panel('Tokens', [['tokens', bpe.tokens.length, 'ok']]));
    } else if (k === 'merges') {
      f.add('Start with characters, and count every adjacent pair.', [...tokenRow('m0', 200, [...BPE_TEXT], undefined, 'step 0'), v('vocab: l o w e r s t ␣', '8 symbols')], panel('BPE', [['tokens', BPE_TEXT.length]]));
      bpe.steps.slice(0, 5).forEach((st, i) => {
        const merged = st.pair.join('');
        f.add(`Merge ${i + 1}: "${st.pair[0]}" + "${st.pair[1]}" appears ${st.count} times, so it becomes the token "${merged}".`, [...tokenRow(`m${i + 1}`, 200, st.tokens, (t) => t === merged, `after merge ${i + 1}`), v(`+ "${merged.replace(/ /g, '␣')}"`, `${st.tokens.length} tokens`)], panel('BPE', [['merge', `${st.pair[0].replace(/ /g, '␣')} + ${st.pair[1].replace(/ /g, '␣')}`], ['count', st.count], ['tokens', st.tokens.length]]));
      });
    } else if (k === 'encode') {
      const merges = bpe.steps.map((s) => s.pair);
      const word = 'slower';
      const steps: string[][] = [[...word]];
      for (let i = 1; i <= merges.length; i++) {
        const t = bpeEncode(word, merges.slice(0, i));
        if (t.join('|') !== steps[steps.length - 1].join('|')) steps.push(t);
      }
      f.add(`Encoding a word it never saw, "${word}", starts from characters.`, tokenRow('e0', 260, steps[0], undefined, word), panel('Encode', [['tokens', steps[0].length]]));
      steps.slice(1).forEach((t, i) => f.add('Apply the learned merges in the order they were learned.', tokenRow(`e${i + 1}`, 260, t, (x) => x.length > 1, word), panel('Encode', [['tokens', t.length]])));
      f.add('No unknown token: rare words just become more pieces.', [...tokenRow('ef', 260, steps[steps.length - 1], (x) => x.length > 1, word), v('ids = [vocab[t] for t in tokens]', 'what the model sees')], panel('Encode', [['tokens', steps[steps.length - 1].length, 'ok']]));
    } else {
      const s = 'café 🙂';
      const bytes = utf8Bytes(s);
      f.add('Byte-level BPE starts from the 256 UTF-8 byte values, not characters.', tokenRow('b0', 260, [...s], undefined, s), panel('Bytes', [['chars', [...s].length]]));
      f.add(`"é" is 2 bytes and the emoji is 4, so the text is ${bytes.length} bytes.`, tokenRow('b1', 260, bytes.map((b) => b.toString(16).padStart(2, '0')), (_, i) => i >= 3 && i <= 4, 'UTF-8 bytes (hex)'), panel('Bytes', [['bytes', bytes.length]]));
      f.add('Any string is representable, so there is never an unknown token; merges then learn common byte runs.', [...tokenRow('b2', 260, bytes.map((b) => b.toString(16).padStart(2, '0')), undefined, 'UTF-8 bytes (hex)'), v('base vocab = 256 bytes + merges', 'GPT-2: 50,257 tokens')], panel('Bytes', [['unknowns', 0, 'ok']]));
    }
    return f.frames;
  },
});

// ---------------- embeddings ----------------
const EMB: Record<string, number[]> = {
  king: [0.9, 0.8, 0.1],
  queen: [0.9, 0.1, 0.8],
  man: [0.2, 0.9, 0.1],
  woman: [0.2, 0.1, 0.9],
  apple: [0.1, 0.4, 0.4],
};

const DOCS = [
  { id: 'refund policy', v: [0.9, 0.1, 0.2] },
  { id: 'shipping times', v: [0.2, 0.9, 0.1] },
  { id: 'return a gift', v: [0.8, 0.2, 0.3] },
  { id: 'reset password', v: [0.1, 0.1, 0.95] },
];

const EMB_DETAILS: Record<string, Detail> = {
  query: {
    title: 'Query embedding',
    text: 'The question goes through the same embedding model as the documents, so both live in the same vector space.',
    code: 'from sentence_transformers import SentenceTransformer\nm = SentenceTransformer("all-MiniLM-L6-v2")\nq = m.encode("how do I get my money back?")\ndocs = m.encode(texts)\nscores = docs @ q / (norm(docs, axis=1) * norm(q))',
  },
};

machineDemo({
  slug: 'ai-embed',
  title: 'Embeddings & vector search',
  group: 'ai-embeddings',
  summary: 'Words and documents as vectors: cosine similarity, analogy arithmetic, and top-k nearest-neighbour search.',
  inputs: [
    { id: 'cosine', label: 'Cosine similarity', data: { k: 'cosine' } },
    { id: 'analogy', label: 'king − man + woman', data: { k: 'analogy' } },
    { id: 'search', label: 'Top-k search', data: { k: 'search' } },
  ],
  details: EMB_DETAILS,
  build({ k }: { k: string }) {
    const f = new Film();
    const names = Object.keys(EMB);
    const table = (hi: string[]) => grid('emb', 240, 140, names.map((n) => EMB[n]), { cw: 150, ch: 70, rowLabels: names, colLabels: ['royal', 'male', 'female'], tone: (r) => (hi.includes(names[r]) ? 'current' : undefined), title: 'embedding (3 of ~768 dims)', detail: { title: 'Embedding table', text: 'One learned row per token. Real dimensions aren’t labelled like this; meaning is spread across hundreds of them.', code: 'emb = nn.Embedding(vocab_size, 768)\nv = emb(torch.tensor([tok_id]))' } });
    if (k === 'cosine') {
      const c1 = cosine(EMB.king, EMB.queen);
      const c2 = cosine(EMB.king, EMB.apple);
      f.add('An embedding maps each token to a vector; similar meanings end up pointing the same way.', table([]), panel('Embeddings', [['dims shown', 3]]));
      f.add(`cos(king, queen) = ${fmt(c1)}: both are royal.`, table(['king', 'queen']), panel('Cosine', [['king·queen', fmt(c1), 'ok']]));
      f.add(`cos(king, apple) = ${fmt(c2)}: much less related.`, table(['king', 'apple']), panel('Cosine', [['king·apple', fmt(c2)]]));
      f.add('Cosine ignores length and compares direction only, which is what vector search ranks by.', table(['king', 'queen', 'apple']), panel('Cosine', [['range', '−1 … 1']]));
    } else if (k === 'analogy') {
      const v = vadd(vsub(EMB.king, EMB.man), EMB.woman);
      const ranked = names.filter((n) => n !== 'king' && n !== 'man' && n !== 'woman').map((n) => ({ n, s: cosine(v, EMB[n]) })).sort((a, b) => b.s - a.s);
      f.add('Directions carry meaning: king − man isolates something like "royalty".', table(['king', 'man']), panel('Analogy', [['king − man', vsub(EMB.king, EMB.man).map(fmt).join(', ')]]));
      f.add('Add woman back and you get a new vector.', [...table(['woman']), ...grid('res', 240, 560, [v], { cw: 150, ch: 70, rowLabels: ['result'], tone: () => 'write' })], panel('Analogy', [['result', v.map(fmt).join(', ')]]));
      f.add(`Its nearest word is ${ranked[0].n} (cos ${fmt(ranked[0].s)}).`, [...table([ranked[0].n]), ...grid('res', 240, 560, [v], { cw: 150, ch: 70, rowLabels: ['result'], tone: () => 'ok' })], panel('Analogy', [['nearest', ranked[0].n, 'ok']]));
    } else {
      const q = [0.85, 0.15, 0.25];
      const ranked = topK(q, DOCS, 4);
      const draw = (shown: number, scored: boolean) => {
        const out: Shape[] = [box('query', 30, 120, 940, 100, '"how do I get my money back?"', { sub: `embed → [${q.join(', ')}]`, mono: true, tone: 'current' })];
        DOCS.forEach((d, i) => {
          const r = ranked.findIndex((x) => x.id === d.id);
          const s = cosine(q, d.v);
          out.push(box(`d${i}`, 30, 300 + i * 120, 600, 100, d.id, { sub: `[${d.v.join(', ')}]`, mono: true, tone: scored && r < shown ? (r === 0 ? 'ok' : 'read') : 'default' }));
          if (scored) out.push(text(`s${i}`, 680, 350 + i * 120, `cos ${fmt(s)}  #${r + 1}`, { align: 'left', size: 28, mono: true }));
        });
        return out;
      };
      f.add('Documents were embedded once at index time; the query is embedded now.', draw(0, false), panel('Search', [['docs', DOCS.length]]));
      f.add('Score every document by cosine similarity with the query.', draw(0, true), panel('Search', [['scored', DOCS.length]]));
      f.add(`Top-2: "${ranked[0].id}" and "${ranked[1].id}", no shared keywords needed.`, draw(2, true), panel('Search', [['top-2', `${ranked[0].id}, ${ranked[1].id}`, 'ok']]));
      f.add('Real indexes (HNSW, IVF) skip most documents and return approximately the same top-k.', draw(2, true), panel('Search', [['exact', 'O(n·d)'], ['HNSW', '~O(log n)', 'ok']]));
    }
    return f.frames;
  },
});

