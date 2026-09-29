// Transformer internals: attention on a tiny matrix, the block, and pretraining (loss, loop, sampling).
import type { Detail, Shape } from '../algo/frames';
import { boardDemo, N } from '../machine/lib/board';
import { box, Film, machineDemo, panel, text } from '../machine/lib/draw';
import { bars, fmt, grid } from './grid';
import { attention, crossEntropy, positional, softmax } from './math';

// ---------------- attention ----------------
export const ATT_TOKENS = ['the', 'cat', 'sat'];
export const ATT_Q = [
  [1, 0],
  [0, 1],
  [1, 1],
];
export const ATT_K = [
  [1, 0],
  [0, 1],
  [0.5, 1],
];
export const ATT_V = [
  [1, 0],
  [0, 1],
  [1, 1],
];

const HEAD_DETAIL: Detail = {
  title: 'Multi-head attention',
  text: 'd_model is split into h heads, each attending with its own projections; outputs are concatenated and projected.',
  code: 'q = q.view(B, T, h, d // h).transpose(1, 2)\n# (B, h, T, d/h) → attention per head\ny = y.transpose(1, 2).reshape(B, T, d)\ny = y @ W_o',
};
const PE_DETAIL: Detail = { title: 'Positional encoding', text: 'Added to token embeddings so identical tokens at different positions get different vectors.', code: 'pe[pos, 2i]   = sin(pos / 10000**(2i/d))\npe[pos, 2i+1] = cos(pos / 10000**(2i/d))' };

const ATT_DETAILS: Record<string, Detail> = {
  Q: {
    title: 'Queries, keys, values',
    text: 'Each token is projected three ways: a query (what am I looking for), a key (what do I contain) and a value (what I pass on). Attention weights come from query·key.',
    code: 'q, k, v = x @ Wq, x @ Wk, x @ Wv\nscores = q @ k.T / math.sqrt(d)\nscores = scores.masked_fill(mask, -inf)\nw = scores.softmax(-1)\nout = w @ v',
  },
  weights: { title: 'Attention weights', text: 'Row i says how much token i reads from each other token. Each row sums to 1 after the softmax.' },
  out: { title: 'Output', text: 'A weighted mix of value vectors: each token’s new representation now contains context from the tokens it attended to.' },
};

machineDemo({
  slug: 'ai-attention',
  title: 'Scaled dot-product attention',
  group: 'ai-transformer',
  summary: 'Q·Kᵀ/√d, softmax, weighted sum of V on a 3-token example; causal masking, multiple heads and positional encoding.',
  inputs: [
    { id: 'attend', label: 'Q·K → softmax → V', data: { k: 'attend' } },
    { id: 'causal', label: 'Causal mask', data: { k: 'causal' } },
    { id: 'heads', label: 'Multi-head', data: { k: 'heads' } },
    { id: 'position', label: 'Positional encoding', data: { k: 'position' } },
  ],
  details: ATT_DETAILS,
  build({ k }: { k: string }) {
    const f = new Film();
    const causal = k === 'causal';
    const a = attention(ATT_Q, ATT_K, ATT_V, causal);
    const qkv = (hi: string) => [
      ...grid('Q', 90, 110, ATT_Q, { rowLabels: ATT_TOKENS, title: 'Q', tone: () => (hi.includes('Q') ? 'current' : undefined), detail: ATT_DETAILS.Q }),
      ...grid('K', 400, 110, ATT_K, { title: 'K', tone: () => (hi.includes('K') ? 'current' : undefined) }),
      ...grid('V', 710, 110, ATT_V, { title: 'V', tone: () => (hi.includes('V') ? 'current' : undefined) }),
    ];
    const scores = a.scores.map((r) => r.map((s) => (s === -Infinity ? '−∞' : fmt(s))));
    if (k === 'attend' || k === 'causal') {
      f.add(causal ? 'Same tokens, but a decoder may only look backwards: future positions are masked.' : 'Three tokens, each already projected to a query, key and value (2 dims here).', qkv('QKV'), panel('Attention', [['tokens', 3], ['d', 2]]));
      f.add('Scores: each query dotted with every key, divided by √d so they don’t grow with dimension.', [...qkv('QK'), ...grid('S', 330, 420, scores, { rowLabels: ATT_TOKENS, colLabels: ATT_TOKENS, title: causal ? 'Q·Kᵀ/√d (masked)' : 'Q·Kᵀ/√d', cw: 110, tone: (r, c) => (causal && c > r ? 'fail' : 'read') })], panel('Attention', [['score(sat, cat)', scores[2][1]]]));
      f.add('Softmax turns each row into weights that sum to 1.', [...qkv(''), ...grid('weights', 330, 420, a.weights, { rowLabels: ATT_TOKENS, colLabels: ATT_TOKENS, title: 'weights = softmax(row)', cw: 110, tone: (r, c) => (a.weights[r][c] === Math.max(...a.weights[r]) ? 'current' : undefined) })], panel('Attention', [['sat → cat', fmt(a.weights[2][1])], ['row sum', 1]]));
      f.add(causal ? '"the" can only see itself, so its output is exactly its own value.' : 'Output = weights · V: each token becomes a context-weighted blend of values.', [...qkv('V'), ...grid('weights', 100, 420, a.weights, { rowLabels: ATT_TOKENS, title: 'weights', cw: 110 }), ...grid('out', 640, 420, a.out, { title: 'out', tone: () => 'ok' })], panel('Attention', [['out(sat)', a.out[2].map(fmt).join(', '), 'ok']]));
    } else if (k === 'heads') {
      const h2 = attention(ATT_K, ATT_Q, ATT_V);
      f.add('One head learns one notion of relevance; real models run many in parallel.', [...grid('h1', 120, 200, a.weights, { rowLabels: ATT_TOKENS, title: 'head 1 weights', cw: 110, detail: HEAD_DETAIL }), ...grid('h2', 620, 200, h2.weights, { title: 'head 2 weights', cw: 110 })], panel('Heads', [['heads', 2]]));
      f.add('Each head has its own Q, K, V projections, so each attends differently.', [...grid('h1', 120, 200, a.weights, { rowLabels: ATT_TOKENS, title: 'head 1 weights', cw: 110, detail: HEAD_DETAIL, tone: (r, c) => (a.weights[r][c] > 0.4 ? 'current' : undefined) }), ...grid('h2', 620, 200, h2.weights, { title: 'head 2 weights', cw: 110, tone: (r, c) => (h2.weights[r][c] > 0.4 ? 'write' : undefined) })], panel('Heads', [['GPT-2 small', '12 heads × 64 dims']]));
      f.add('Outputs of all heads are concatenated and mixed by one more projection.', [...grid('o1', 120, 200, a.out, { rowLabels: ATT_TOKENS, title: 'head 1 out', detail: HEAD_DETAIL }), ...grid('o2', 420, 200, h2.out, { title: 'head 2 out' }), box('proj', 120, 520, 760, 110, 'concat → W_o → next layer', { mono: true, tone: 'ok' })], panel('Heads', [['d_model', '2 × 2 = 4']]));
    } else {
      const pe = [0, 1, 2, 3].map((p) => positional(p, 4));
      f.add('Attention alone is order-blind: "cat sat" and "sat cat" look identical.', grid('pe', 250, 250, pe, { rowLabels: ['pos 0', 'pos 1', 'pos 2', 'pos 3'], colLabels: ['sin', 'cos', 'sin', 'cos'], title: 'positional encoding (d = 4)', cw: 130, detail: PE_DETAIL }), panel('Position', [['problem', 'no order']]));
      f.add('Sinusoids of different wavelengths give each position a unique pattern, added to the token embedding.', grid('pe', 250, 250, pe, { rowLabels: ['pos 0', 'pos 1', 'pos 2', 'pos 3'], colLabels: ['sin', 'cos', 'sin', 'cos'], title: 'positional encoding (d = 4)', cw: 130, detail: PE_DETAIL, tone: (r, c) => (c < 2 ? 'current' : undefined) }), panel('Position', [['fast dims', '0, 1']]));
      f.add('Modern LLMs rotate Q and K by position instead (RoPE), so attention sees relative distance.', grid('pe', 250, 250, pe, { rowLabels: ['pos 0', 'pos 1', 'pos 2', 'pos 3'], colLabels: ['sin', 'cos', 'sin', 'cos'], title: 'positional encoding (d = 4)', cw: 130, detail: PE_DETAIL, tone: () => 'read' }), panel('Position', [['Llama, Qwen', 'RoPE', 'ok']]));
    }
    return f.frames;
  },
});

// ---------------- the block ----------------
const BLOCK_NODES = [
  N('tok', 60, 40, 380, 100, 'token ids', '[464, 3797, 3332]', { detail: { title: 'Token ids', text: 'Integers from the tokenizer. The model never sees text.', code: 'ids = tok.encode("the cat sat")\n# [464, 3797, 3332]' } }),
  N('emb', 60, 200, 380, 100, 'embedding + position', 'vocab × d_model lookup', { detail: { title: 'Embedding lookup', text: 'Row i of a (vocab × d_model) table, plus the position signal.', code: 'x = wte[ids] + wpe[range(len(ids))]' } }),
  N('attn', 60, 370, 380, 110, 'masked self-attention', 'tokens read each other', { detail: { title: 'Attention sub-layer', text: 'The only place tokens exchange information. Pre-norm, then a residual add.', code: 'x = x + attn(ln1(x))' } }),
  N('ffn', 60, 550, 380, 110, 'feed-forward (MLP)', 'per token, 4× wider', { detail: { title: 'Feed-forward sub-layer', text: 'Each token alone through Linear → GELU → Linear. Most parameters live here.', code: 'x = x + mlp(ln2(x))\n# mlp: d → 4d → d' } }),
  N('stack', 540, 450, 400, 110, '× N layers', 'GPT-2 small: 12', { detail: { title: 'Depth', text: 'The same block repeated. Each layer refines every token’s vector.' } }),
  N('head', 60, 730, 380, 100, 'LM head → logits', 'd_model × vocab', { detail: { title: 'LM head', text: 'Projects the last hidden state onto the vocabulary: one score per possible next token.', code: 'logits = ln_f(x) @ wte.T  # tied weights' } }),
  N('next', 540, 730, 400, 100, 'softmax → next token', '"on" 0.41', { detail: { title: 'Next token', text: 'Softmax turns logits into probabilities; decoding picks one and feeds it back in.' } }),
];

boardDemo(
  'ai-transformer',
  'ai-block',
  'A decoder block, end to end',
  'Token ids → embedding → masked attention → MLP (× N layers) → logits → next token, the path every token takes.',
  {
    forward: [
      'Forward pass',
      {
        panel: 'Transformer',
        nodes: BLOCK_NODES,
        edges: ['tok>emb', 'emb>attn', 'attn>ffn', 'ffn>stack', 'ffn>head', 'head>next'],
        beats: [
          { note: 'Three token ids enter the model.', hot: { tok: 'current' }, hide: ['emb', 'attn', 'ffn', 'stack', 'head', 'next'], rows: [['tokens', 3]] },
          { note: 'Each id picks a row of the embedding table, plus a position signal.', hot: { emb: 'current', 'tok>emb': 'accent' }, hide: ['attn', 'ffn', 'stack', 'head', 'next'], rows: [['vector', '768 floats']] },
          { note: 'Attention lets each token read the ones before it.', hot: { attn: 'current', 'emb>attn': 'accent' }, hide: ['ffn', 'stack', 'head', 'next'], rows: [['mixes', 'across tokens']] },
          { note: 'The MLP then transforms each token on its own.', hot: { ffn: 'current', 'attn>ffn': 'accent' }, hide: ['stack', 'head', 'next'], rows: [['mixes', 'within a token']] },
          { note: 'That pair is one layer, and the output feeds the next identical layer.', hot: { stack: 'current', 'ffn>stack': 'accent' }, hide: ['head', 'next'], rows: [['layers', 12]] },
          { note: 'The last token’s vector is scored against every vocabulary entry.', hot: { head: 'current', 'ffn>head': 'accent' }, hide: ['next'], rows: [['logits', '50,257']] },
          { note: 'Softmax gives probabilities, and one token is chosen.', hot: { next: 'ok', 'head>next': 'accent' }, rows: [['next', '"on"', 'ok']] },
        ],
      },
    ],
    params: [
      'Where the parameters are',
      {
        panel: 'Parameters',
        nodes: BLOCK_NODES,
        edges: ['tok>emb', 'emb>attn', 'attn>ffn', 'ffn>stack', 'ffn>head', 'head>next'],
        beats: [
          { note: 'GPT-2 small has 124M parameters.', rows: [['total', '124M']] },
          { note: 'The embedding table is 50,257 × 768, about 39M.', hot: { emb: 'current' }, sub: { emb: '39M params' }, rows: [['embedding', '39M']] },
          { note: 'Attention holds Q, K, V and output projections: 4 × 768² per layer.', hot: { attn: 'current' }, sub: { attn: '2.4M / layer' }, rows: [['attention', '28M']] },
          { note: 'The MLP is 768 → 3072 → 768: twice the attention weights.', hot: { ffn: 'current' }, sub: { ffn: '4.7M / layer' }, rows: [['MLP', '57M', 'warn']] },
          { note: 'The LM head reuses the embedding matrix, so it adds nothing.', hot: { head: 'ok' }, sub: { head: 'tied to embedding' }, rows: [['LM head', '0 extra', 'ok']] },
        ],
      },
    ],
  },
);

// ---------------- pretraining ----------------
const VOCAB = ['on', 'the', 'mat', 'sat', 'cat'];
const TRAIN_DETAILS: Record<string, Detail> = {
  ctx: { title: 'Cross-entropy', text: 'The loss is −log of the probability given to the true next token: 0 when certain and right, large when confidently wrong.', code: 'loss = F.cross_entropy(logits, target)\n# = -log_softmax(logits)[target]' },
  sctx: { title: 'Temperature sampling', text: 'Divide logits by T before the softmax, then sample. T → 0 approaches greedy.', code: 'probs = (logits / T).softmax(-1)\nnext_id = torch.multinomial(probs, 1)' },
  loop: {
    title: 'Training loop',
    text: 'Sample a batch, predict every next token, measure cross-entropy, backprop, update. Repeat millions of times.',
    code: 'for step in range(steps):\n    x, y = get_batch()          # y = x shifted by 1\n    logits = model(x)\n    loss = F.cross_entropy(\n        logits.view(-1, V), y.view(-1))\n    opt.zero_grad()\n    loss.backward()\n    opt.step()                  # AdamW',
  },
  batch: { title: 'Batch', text: 'B sequences of T tokens. Every position is a training example: predict token t+1 from tokens ≤ t.', code: 'ix = torch.randint(len(data) - T, (B,))\nx = torch.stack([data[i:i+T] for i in ix])\ny = torch.stack([data[i+1:i+T+1] for i in ix])' },
  optimizer: { title: 'AdamW', text: 'Keeps running averages of each gradient and its square: per-parameter step sizes, plus weight decay.', code: 'opt = torch.optim.AdamW(\n    model.parameters(), lr=3e-4,\n    betas=(0.9, 0.95), weight_decay=0.1)' },
};

machineDemo({
  slug: 'ai-train',
  title: 'Pretraining a language model',
  group: 'ai-training',
  summary: 'Next-token cross-entropy on real logits, the batch → forward → loss → backward → AdamW loop, and temperature sampling.',
  inputs: [
    { id: 'loss', label: 'Next-token loss', data: { k: 'loss' } },
    { id: 'loop', label: 'Training loop', data: { k: 'loop' } },
    { id: 'sample', label: 'Sampling', data: { k: 'sample' } },
  ],
  details: TRAIN_DETAILS,
  build({ k }: { k: string }) {
    const f = new Film();
    if (k === 'loss') {
      const early = [0.2, 0.1, 0.0, 0.3, 0.1];
      const late = [3.2, 0.4, 0.1, 0.2, 0.0];
      const draw = (logits: number[], label: string): Shape[] => [
        box('ctx', 30, 60, 940, 90, '"the cat sat ___"', { sub: 'target next token: "on"', mono: true, tone: 'current' }),
        text('lt', 30, 200, label, { align: 'left', size: 26, bold: true }),
        ...bars('p', 40, 230, 900, softmax(logits).map((p, i) => ({ label: VOCAB[i], p, tone: i === 0 ? 'ok' : 'read' }))),
      ];
      const l1 = crossEntropy(early, 0);
      const l2 = crossEntropy(late, 0);
      f.add('Pretraining is one task: predict the next token of real text.', draw(early, 'random init: nearly uniform'), panel('Loss', [['vocab', VOCAB.length]]));
      f.add(`Loss is −log p(correct): p("on") = ${fmt(softmax(early)[0])}, so the loss is ${fmt(l1)}.`, draw(early, 'random init'), panel('Loss', [['loss', fmt(l1), 'warn'], ['uniform', fmt(Math.log(VOCAB.length))]]));
      f.add(`After training the model puts ${fmt(softmax(late)[0])} on "on", and the loss drops to ${fmt(l2)}.`, draw(late, 'after training'), panel('Loss', [['loss', fmt(l2), 'ok']]));
    } else if (k === 'loop') {
      const nodes = (hot: string): Shape[] => {
        const items: [string, string, string, number, number][] = [
          ['batch', 'batch B × T', 'x, y = x shifted', 60, 120],
          ['model', 'forward', 'logits B × T × V', 540, 120],
          ['lossb', 'loss', 'cross-entropy', 540, 420],
          ['back', 'backward', 'grads for 124M params', 60, 420],
          ['optimizer', 'AdamW step', 'weights updated', 300, 720],
        ];
        return items.map(([id, l, s, x, y]) => box(id, x, y, 400, 130, l, { sub: s, mono: true, tone: id === hot ? 'current' : 'default' }));
      };
      const loop = box('loop', 30, 30, 60, 40, 'loop', { mono: true, tone: 'muted' });
      f.add('Grab B random windows of T tokens; the targets are the same windows shifted by one.', [loop, ...nodes('batch')], panel('Step', [['B × T', '32 × 256']]));
      f.add('Forward: logits for every position at once, thanks to the causal mask.', [loop, ...nodes('model')], panel('Step', [['predictions', '8,192']]));
      f.add('Average the cross-entropy over all of them.', [loop, ...nodes('lossb')], panel('Step', [['loss', '4.21']]));
      f.add('Backward fills a gradient for every weight.', [loop, ...nodes('back')], panel('Step', [['grads', '124M']]));
      f.add('AdamW nudges each weight; then the next batch, for hundreds of thousands of steps.', [loop, ...nodes('optimizer')], panel('Step', [['loss trend', '4.21 → 3.10', 'ok']]));
    } else {
      const logits = [2.0, 1.0, 0.5, 0.2, -1];
      const draw = (t: number): Shape[] => [
        box('sctx', 30, 60, 940, 90, '"the cat sat on the ___"', { sub: `temperature ${t}`, mono: true, tone: 'current' }),
        ...bars('p', 40, 230, 900, softmax(logits, t).map((p, i) => ({ label: ['mat', 'floor', 'sofa', 'roof', 'moon'][i], p, tone: i === 0 ? 'ok' : 'read' }))),
      ];
      f.add('Generation samples from the predicted distribution, one token at a time.', draw(1), panel('Sampling', [['T', 1]]));
      f.add('Low temperature sharpens it: nearly always "mat", repetitive but safe.', draw(0.3), panel('Sampling', [['T', 0.3], ['p(mat)', fmt(softmax(logits, 0.3)[0])]]));
      f.add('High temperature flattens it: more variety, more nonsense.', draw(2), panel('Sampling', [['T', 2], ['p(mat)', fmt(softmax(logits, 2)[0]), 'warn']]));
    }
    return f.frames;
  },
});
