// Transformer architecture step by step on one tiny example ("the cat sat down", d_model 8, 2 heads):
// embeddings + positions, Q/K/V projections, scaled dot-product attention, multi-head, the block, generation, shapes.
import type { Detail, Shape, Tone } from '../algo/frames';
import { boardDemo, N } from '../machine/lib/board';
import { arrow, box, Film, machineDemo, panel, text } from '../machine/lib/draw';
import type { Row } from '../machine/lib/draw';
import { bars, fmt, grid } from './grid';
import { matmul, positional, round, softmax, transpose, type Mat } from './math';

// ---------------- the example ----------------
export const TOKENS = ['the', 'cat', 'sat', 'down'];
export const VOCAB = ['the', 'cat', 'sat', 'down', 'on', 'a', 'mat', 'dog'];
export const IDS = TOKENS.map((t) => VOCAB.indexOf(t));
export const D = 8;
export const HEADS = 2;
export const D_HEAD = D / HEADS;
export const D_FF = 32;

/** Fixed pseudo-random weights, 2 decimals, so every number on screen is reproducible. */
export function weights(seed: number, rows: number, cols: number, scale = 0.6): Mat {
  return Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => round(Math.sin(seed * 91.7 + r * 12.9 + c * 7.31) * scale, 2)));
}

const layerSeed = (layer: number) => 10 * layer;
export const EMB = weights(1, VOCAB.length, D, 1);
export const layerWeights = (layer = 0) => {
  const s = layerSeed(layer);
  return { WQ: weights(2 + s, D, D), WK: weights(3 + s, D, D), WV: weights(4 + s, D, D), WO: weights(5 + s, D, D), W1: weights(6 + s, D, D_FF, 0.5), W2: weights(7 + s, D_FF, D, 0.3) };
};

// ---------------- pure helpers ----------------
export const embed = (ids: number[], E: Mat = EMB): Mat => ids.map((i) => E[i].slice());
export const posEnc = (T: number, d = D): Mat => Array.from({ length: T }, (_, t) => positional(t, d));
export const addM = (A: Mat, B: Mat): Mat => A.map((r, i) => r.map((v, j) => v + B[i][j]));
export const linear = (X: Mat, W: Mat): Mat => matmul(X, W);
export const scoresOf = (Q: Mat, K: Mat): Mat => matmul(Q, transpose(K));
export const scaleM = (S: Mat, dk: number): Mat => S.map((r) => r.map((v) => v / Math.sqrt(dk)));
export const causalMask = (S: Mat): Mat => S.map((r, i) => r.map((v, j) => (j > i ? -Infinity : v)));
export const softmaxRows = (S: Mat): Mat => S.map((r) => softmax(r));

/** Scaled dot-product attention with every intermediate kept for drawing. */
export function sdpa(Q: Mat, K: Mat, V: Mat, causal = true) {
  const raw = scoresOf(Q, K);
  const scaled = scaleM(raw, Q[0].length);
  const masked = causal ? causalMask(scaled) : scaled;
  const P = softmaxRows(masked);
  return { raw, scaled, masked, P, O: matmul(P, V) };
}

/** (T × d) → h matrices of (T × d/h): head k takes columns k·d/h … (k+1)·d/h − 1. */
export function splitHeads(X: Mat, h: number): Mat[] {
  const dh = X[0].length / h;
  return Array.from({ length: h }, (_, k) => X.map((r) => r.slice(k * dh, (k + 1) * dh)));
}
export const mergeHeads = (hs: Mat[]): Mat => hs[0].map((_, t) => hs.flatMap((m) => m[t]));

export function mha(X: Mat, layer = 0, h = HEADS) {
  const w = layerWeights(layer);
  const Q = linear(X, w.WQ);
  const K = linear(X, w.WK);
  const V = linear(X, w.WV);
  const [qs, ks, vs] = [splitHeads(Q, h), splitHeads(K, h), splitHeads(V, h)];
  const heads = qs.map((q, i) => sdpa(q, ks[i], vs[i]));
  const concat = mergeHeads(heads.map((x) => x.O));
  return { Q, K, V, heads, concat, out: linear(concat, w.WO) };
}

/** Per-row LayerNorm (no learned gain/bias, so the numbers stay readable). */
export function layerNorm(X: Mat, eps = 1e-5) {
  const mean = X.map((r) => r.reduce((a, b) => a + b, 0) / r.length);
  const variance = X.map((r, i) => r.reduce((a, b) => a + (b - mean[i]) ** 2, 0) / r.length);
  return { out: X.map((r, i) => r.map((v) => (v - mean[i]) / Math.sqrt(variance[i] + eps))), mean, variance };
}

/** GELU, tanh approximation (as in GPT-2). */
export const gelu = (x: number) => 0.5 * x * (1 + Math.tanh(Math.sqrt(2 / Math.PI) * (x + 0.044715 * x ** 3)));

export function ffn(X: Mat, layer = 0) {
  const w = layerWeights(layer);
  const hidden = linear(X, w.W1);
  const act = hidden.map((r) => r.map(gelu));
  return { hidden, act, out: linear(act, w.W2) };
}

/** Post-LN block, as in the original Transformer: x → LN(x + MHA(x)) → LN(· + FFN(·)). */
export function block(X: Mat, layer = 0) {
  const attn = mha(X, layer);
  const res1 = addM(X, attn.out);
  const ln1 = layerNorm(res1);
  const ff = ffn(ln1.out, layer);
  const res2 = addM(ln1.out, ff.out);
  const ln2 = layerNorm(res2);
  return { attn, res1, ln1, ff, res2, ln2, out: ln2.out };
}

/** Weight tying: logits = x · Eᵀ, one score per vocabulary entry. */
export const logitsOf = (x: number[], E: Mat = EMB) => E.map((row) => row.reduce((a, v, i) => a + v * x[i], 0));

export function forward(ids: number[], layers = 2) {
  let X = addM(embed(ids), posEnc(ids.length));
  const outs: Mat[] = [X];
  for (let l = 0; l < layers; l++) {
    X = block(X, l).out;
    outs.push(X);
  }
  const final = layerNorm(X).out;
  const logits = logitsOf(final[final.length - 1]);
  const probs = softmax(logits);
  const next = probs.indexOf(Math.max(...probs));
  return { outs, final, logits, probs, next };
}

/** Greedy decoding: append the argmax token `steps` times. */
export function generate(ids: number[], steps: number, layers = 2) {
  const seq = ids.slice();
  const picks: { id: number; p: number }[] = [];
  for (let s = 0; s < steps; s++) {
    const f = forward(seq, layers);
    picks.push({ id: f.next, p: f.probs[f.next] });
    seq.push(f.next);
  }
  return { seq, picks };
}

/** Parameters of one block: attention (4 d²), FFN (2 d·ff + biases), two LayerNorms (gain + bias each). */
export function blockParams(d: number, ff: number) {
  const attn = 4 * d * d;
  const mlp = 2 * d * ff + ff + d;
  const norms = 2 * 2 * d;
  return { attn, mlp, norms, total: attn + mlp + norms };
}

// ---------------- drawing ----------------
const heat = (w: number): Tone => (w >= 0.5 ? 'current' : w >= 0.3 ? 'write' : w >= 0.15 ? 'read' : 'visited');
const cell = (v: number) => (v === -Infinity ? '−∞' : fmt(round(v, 2)));
const sh = (M: Mat) => `${M.length}×${M[0].length}`;

interface MatOpts {
  cw?: number;
  ch?: number;
  title?: string;
  rows?: string[];
  cols?: string[];
  tone?: (r: number, c: number) => Tone | undefined;
  detail: Detail;
}
/** Matrix grid where every cell opens the same explainer. */
function mat(id: string, x: number, y: number, M: Mat, o: MatOpts): Shape[] {
  const out = grid(id, x, y, M.map((r) => r.map(cell)), { cw: o.cw ?? 56, ch: o.ch ?? 42, title: o.title, rowLabels: o.rows, colLabels: o.cols, tone: o.tone });
  for (const s of out) if (s.t === 'rect') s.detail = o.detail;
  return out;
}

function tokenRow(id: string, x: number, y: number, labels: string[], o: { w?: number; tone?: (i: number) => Tone | undefined; sub?: (i: number) => string; detail: Detail }): Shape[] {
  const w = o.w ?? 130;
  return labels.map((l, i) => {
    const b = box(`${id}${i}`, x + i * (w + 14), y, w, 64, l, { mono: true, tone: o.tone?.(i) ?? 'default', sub: o.sub?.(i) });
    if (b.t === 'rect') b.detail = o.detail;
    return b;
  });
}

const DT: Record<string, Detail> = {
  tokens: { title: 'Tokens and ids', text: 'The tokenizer turns text into integer ids; the model only ever sees these numbers.', code: 'ids = tok.encode("the cat sat down")\n# → [0, 1, 2, 3]  (tiny demo vocab)\nx = torch.tensor(ids)[None]  # (B=1, T=4)' },
  E: { title: 'Embedding matrix E (vocab × d_model)', text: 'One learned row per vocabulary entry. Looking up a token is just picking its row.', code: 'emb = nn.Embedding(vocab, d_model)\nx = emb(ids)          # (B, T, d_model)\n# same as: x = E[ids]' },
  PE: { title: 'Positional encoding', text: 'Attention has no notion of order, so each position adds its own pattern of sines and cosines.', code: 'pos = torch.arange(T)[:, None]\ni = torch.arange(0, d, 2)\npe[:, 0::2] = torch.sin(pos / 10000**(i/d))\npe[:, 1::2] = torch.cos(pos / 10000**(i/d))\nx = x + pe' },
  X: { title: 'X: the input to the block (T × d_model)', text: 'One row per token: meaning (embedding) plus position. Every layer reads and rewrites these rows.', code: 'x = tok_emb(ids) + pos_emb(pos)  # (B, T, C)' },
  WQ: { title: 'W_Q: learned query projection', text: 'Multiplying X by W_Q turns each token into a query: what it is looking for in other tokens.', code: 'q = x @ W_q   # (T, d) @ (d, d) → (T, d)\n# in PyTorch: self.q = nn.Linear(d, d, bias=False)' },
  WK: { title: 'W_K: learned key projection', text: 'Keys advertise what each token offers. A query matches keys that point the same way.', code: 'k = x @ W_k   # (T, d)' },
  WV: { title: 'W_V: learned value projection', text: 'Values carry the content that actually gets mixed into the output once the weights are known.', code: 'v = x @ W_v   # (T, d)' },
  Q: { title: 'Q (T × d)', text: 'Row i is token i’s query vector.', code: 'q = x @ W_q' },
  K: { title: 'K (T × d)', text: 'Row j is token j’s key vector. Kᵀ turns rows into columns so Q·Kᵀ compares every pair.', code: 'k = x @ W_k\nkT = k.transpose(-2, -1)' },
  V: { title: 'V (T × d)', text: 'Row j is what token j contributes when someone attends to it.', code: 'v = x @ W_v' },
  S: { title: 'Scores Q·Kᵀ (T × T)', text: 'Cell (i, j) is the dot product of query i with key j: how relevant token j is to token i.', code: 'scores = q @ k.transpose(-2, -1)  # (T, T)' },
  scaled: { title: 'Scaled scores', text: 'Dividing by √d_k keeps the dot products from growing with dimension, so the softmax does not saturate.', code: 'scores = scores / math.sqrt(d_k)' },
  mask: { title: 'Causal mask', text: 'A decoder may not look ahead: scores for future tokens become −∞, so their weight after softmax is exactly 0.', code: 'mask = torch.triu(torch.ones(T, T), 1).bool()\nscores = scores.masked_fill(mask, float("-inf"))' },
  P: { title: 'Attention weights (softmax per row)', text: 'Each row is a probability distribution over the tokens it may see: non-negative and summing to 1.', code: 'weights = scores.softmax(dim=-1)  # rows sum to 1' },
  O: { title: 'Output = weights · V', text: 'Each output row is a weighted average of value rows: token i now carries context from what it attended to.', code: 'out = weights @ v   # (T, T) @ (T, d) → (T, d)' },
  split: { title: 'Splitting into heads', text: 'd_model is cut into h slices of d_head columns. Each head gets its own small Q, K, V and attends independently.', code: 'q = q.view(B, T, h, d // h).transpose(1, 2)\n# (B, h, T, d_head)' },
  concat: { title: 'Concatenate heads', text: 'Head outputs are placed side by side again, giving back a T × d_model matrix.', code: 'y = y.transpose(1, 2).contiguous().view(B, T, d)' },
  WO: { title: 'W_O: output projection', text: 'Mixes information across heads so the block can combine what each head found.', code: 'y = y @ W_o   # self.proj = nn.Linear(d, d)' },
  res: { title: 'Residual connection', text: 'The block adds its result to its input instead of replacing it, so information and gradients flow straight through.', code: 'x = x + attn(x)\nx = x + mlp(x)' },
  LN: { title: 'LayerNorm', text: 'Each token row is shifted to mean 0 and scaled to variance 1 (then a learned gain and bias, left out here).', code: 'mu = x.mean(-1, keepdim=True)\nvar = x.var(-1, keepdim=True, unbiased=False)\nx = (x - mu) / torch.sqrt(var + 1e-5)' },
  FFN: { title: 'Feed-forward network', text: 'The same small MLP runs on every token independently: widen to 4·d, apply GELU, project back.', code: 'self.fc = nn.Linear(d, 4 * d)\nself.proj = nn.Linear(4 * d, d)\nx = self.proj(F.gelu(self.fc(x)))' },
  logits: { title: 'Logits and next token', text: 'The last row is projected onto the vocabulary (here with the embedding matrix, weight tying) and softmaxed.', code: 'logits = x[:, -1] @ E.T       # (B, vocab)\nprobs = logits.softmax(-1)\nnext_id = probs.argmax(-1)    # greedy' },
  block: { title: 'Transformer block', text: 'Attention lets tokens exchange information; the FFN processes each token; residuals and LayerNorm keep it trainable.', code: 'class Block(nn.Module):\n  def forward(self, x):\n    x = self.ln1(x + self.attn(x))\n    x = self.ln2(x + self.mlp(x))\n    return x\n# GPT-2 uses pre-LN: x + attn(ln1(x))' },
};

const shape = (id: string, x: number, y: number, s: string, tone: Tone = 'muted') => text(id, x, y, s, { align: 'left', size: 26, mono: true, tone });
const fr = (rows: Row[]) => panel('Tensors', rows);

// ---------------- 1. embeddings + positions ----------------
machineDemo({
  slug: 'tx-embed',
  title: 'Tokens → embeddings + positions',
  group: 'ai-attention',
  summary: 'Look up each token’s row in the embedding matrix, then add a sinusoidal position vector: X (4×8).',
  inputs: [
    { id: 'lookup', label: 'Embedding lookup', data: { k: 'lookup' } },
    { id: 'position', label: '+ positions', data: { k: 'position' } },
  ],
  build({ k }: { k: string }) {
    const f = new Film();
    const tok = embed(IDS);
    const pe = posEnc(TOKENS.length);
    const X = addM(tok, pe);
    const toks = (hi: number) => tokenRow('tk', 110, 40, TOKENS, { w: 150, tone: (i) => (i === hi ? 'current' : undefined), sub: (i) => `id ${IDS[i]}`, detail: DT.tokens });
    if (k === 'lookup') {
      const rowsOf = (n: number) => tok.map((r, i) => (i < n ? r : r.map(() => 0)));
      f.add('Four tokens, already turned into integer ids by the tokenizer.', [...toks(-1), ...mat('E', 130, 200, EMB, { title: 'E  (vocab 8 × d 8)', rows: VOCAB, detail: DT.E, ch: 40 })], fr([['E', '8×8'], ['ids', '[0, 1, 2, 3]']]));
      for (let t = 0; t < TOKENS.length; t++)
        f.add(`“${TOKENS[t]}” has id ${IDS[t]}, so its vector is simply row ${IDS[t]} of E.`, [
          ...toks(t),
          ...mat('E', 130, 200, EMB, { title: 'E  (vocab 8 × d 8)', rows: VOCAB, detail: DT.E, ch: 40, tone: (r) => (r === IDS[t] ? 'current' : undefined) }),
          ...mat('X', 130, 640, rowsOf(t + 1), { title: 'token embeddings (4×8)', rows: TOKENS, detail: DT.X, ch: 40, tone: (r) => (r === t ? 'write' : r > t ? 'visited' : undefined) }),
        ], fr([['lookup', `E[${IDS[t]}]`], ['filled', `${t + 1} of 4 rows`]]));
      f.add('An embedding lookup is a row copy: no arithmetic, just indexing into a learned table.', [...toks(-1), ...mat('X', 130, 640, tok, { title: 'token embeddings (4×8)', rows: TOKENS, detail: DT.X, ch: 40 })], fr([['shape', '4×8'], ['learned', 'every entry of E']]));
    } else {
      const partial = (n: number) => tok.map((r, i) => (i < n ? X[i] : r));
      f.add('The embeddings say what each token is, but not where it sits in the sentence.', [...toks(-1), ...mat('T', 130, 200, tok, { title: 'token embeddings', rows: TOKENS, detail: DT.X, ch: 40 }), ...mat('P', 130, 460, pe, { title: 'positional encoding  sin / cos', rows: ['pos 0', 'pos 1', 'pos 2', 'pos 3'], detail: DT.PE, ch: 40 })], fr([['PE', '4×8, not learned']]));
      for (let t = 0; t < TOKENS.length; t++)
        f.add(`Row ${t}: add the position ${t} pattern to the embedding of “${TOKENS[t]}”.`, [
          ...toks(t),
          ...mat('T', 130, 200, partial(t + 1), { title: 'X = embedding + position', rows: TOKENS, detail: DT.X, ch: 40, tone: (r) => (r === t ? 'current' : r < t ? 'write' : undefined) }),
          ...mat('P', 130, 460, pe, { title: 'positional encoding  sin / cos', rows: ['pos 0', 'pos 1', 'pos 2', 'pos 3'], detail: DT.PE, ch: 40, tone: (r) => (r === t ? 'current' : undefined) }),
        ], fr([['x[0,0]', `${cell(tok[t][0])} + ${cell(pe[t][0])} = ${cell(X[t][0])}`], ['row', `${t + 1} of 4`]]));
      f.add('X is ready: 4 tokens × 8 features, the input to the first transformer block.', [...toks(-1), ...mat('X', 130, 200, X, { title: 'X  (T 4 × d_model 8)', rows: TOKENS, detail: DT.X, ch: 40 }), shape('sh', 130, 420, 'X = E[ids] + PE    shape 4×8')], fr([['X', sh(X)]]));
    }
    return f.frames;
  },
});

// ---------------- 2. Q, K, V projections ----------------
const X0 = addM(embed(IDS), posEnc(IDS.length));
const W0 = layerWeights(0);
const PROJ: Record<string, { W: Mat; name: string; dt: Detail; out: Detail; role: string }> = {
  query: { W: W0.WQ, name: 'Q', dt: DT.WQ, out: DT.Q, role: 'Queries: what each token is looking for.' },
  key: { W: W0.WK, name: 'K', dt: DT.WK, out: DT.K, role: 'Keys: what each token offers to be found by.' },
  value: { W: W0.WV, name: 'V', dt: DT.WV, out: DT.V, role: 'Values: the content each token hands over when attended to.' },
};

machineDemo({
  slug: 'tx-qkv',
  title: 'Q, K, V projections',
  group: 'ai-attention',
  summary: 'Three matrix multiplications turn X into queries, keys and values: (4×8)·(8×8) = (4×8), row by row.',
  inputs: Object.keys(PROJ).map((id) => ({ id, label: `X·W_${PROJ[id].name}`, data: { k: id } })),
  build({ k }: { k: string }) {
    const p = PROJ[k];
    const Y = linear(X0, p.W);
    const f = new Film();
    const scene = (n: number, hiRow: number) => [
      ...mat('X', 110, 90, X0, { title: 'X  (4×8)', rows: TOKENS, detail: DT.X, cw: 52, ch: 40, tone: (r) => (r === hiRow ? 'current' : undefined) }),
      ...mat('W', 540, 90, p.W, { title: `W_${p.name}  (8×8)`, detail: p.dt, cw: 52, ch: 40 }),
      shape('eq', 110, 470, `(4×8) · (8×8) = (4×8)`),
      ...mat('Y', 110, 560, Y.map((r, i) => (i < n ? r : r.map(() => 0))), { title: `${p.name} = X · W_${p.name}`, rows: TOKENS, detail: p.out, cw: 52, ch: 40, tone: (r) => (r === hiRow ? 'write' : r >= n ? 'visited' : undefined) }),
    ];
    const terms = X0[0].slice(0, 3).map((x, i) => `${cell(x)}×${cell(p.W[i][0])}`).join(' + ');
    f.add(`${p.role} One matrix multiply produces all four at once.`, scene(0, -1), fr([['X', '4×8'], [`W_${p.name}`, '8×8 learned'], [p.name, '4×8']]));
    for (let t = 0; t < 4; t++)
      f.add(t === 0 ? `Row “the”: each of its 8 numbers is a dot product of the X row with one column of W_${p.name}.` : `Row “${TOKENS[t]}”: the same weights, applied to this token’s features.`, scene(t + 1, t), fr(t === 0 ? [[`${p.name}[0,0]`, `${terms} + … = ${cell(Y[0][0])}`], ['multiply-adds', '8 per cell']] : [['row', `${t + 1} of 4`], [`${p.name}[${t},0]`, cell(Y[t][0])]]));
    f.add(`Every token got its ${p.name} row from the same W_${p.name}; only the input row differs.`, scene(4, -1), fr([[p.name, sh(Y)], ['cost', '4·8·8 = 256 multiply-adds']]));
    return f.frames;
  },
});

// ---------------- 3. scaled dot-product attention ----------------
const SD = sdpa(linear(X0, W0.WQ), linear(X0, W0.WK), linear(X0, W0.WV));
const Q0 = linear(X0, W0.WQ);
const K0 = linear(X0, W0.WK);
const V0 = linear(X0, W0.WV);

machineDemo({
  slug: 'tx-sdpa',
  title: 'Scaled dot-product attention, cell by cell',
  group: 'ai-attention',
  summary: 'scores = Q·Kᵀ, divide by √d_k, mask the future, softmax each row, then mix the rows of V.',
  inputs: [
    { id: 'scores', label: 'Q·Kᵀ', data: { k: 'scores' } },
    { id: 'scale', label: '÷ √d_k + mask', data: { k: 'scale' } },
    { id: 'softmax', label: 'Softmax rows', data: { k: 'softmax' } },
    { id: 'mix', label: 'Weights · V', data: { k: 'mix' } },
  ],
  build({ k }: { k: string }) {
    const f = new Film();
    const S = SD.raw;
    const cols = TOKENS.map((t) => `k:${t}`);
    if (k === 'scores') {
      const KT = transpose(K0);
      const view = (i: number, j: number, filled: number) => [
        ...mat('Q', 90, 90, Q0, { title: 'Q  (4×8)', rows: TOKENS, detail: DT.Q, cw: 46, ch: 38, tone: (r) => (r === i ? 'current' : undefined) }),
        ...mat('KT', 560, 90, KT, { title: 'Kᵀ  (8×4)', cols: TOKENS, detail: DT.K, cw: 90, ch: 36, tone: (_r, c) => (c === j ? 'current' : undefined) }),
        ...mat('S', 330, 560, S.map((r, a) => r.map((v, b) => (a * 4 + b < filled ? v : 0))), { title: 'scores = Q · Kᵀ  (4×4)', rows: TOKENS, cols, detail: DT.S, cw: 110, ch: 52, tone: (a, b) => (a === i && b === j ? 'write' : a * 4 + b >= filled ? 'visited' : undefined) }),
      ];
      f.add('Every query is compared with every key, so the result is a 4×4 table of scores.', view(-1, -1, 0), fr([['Q', '4×8'], ['Kᵀ', '8×4'], ['scores', '4×4']]));
      for (let i = 0; i < 4; i++)
        for (let j = 0; j < 4; j++) {
          const n = i * 4 + j + 1;
          const expand = Q0[i].slice(0, 2).map((q, d) => `${cell(q)}×${cell(K0[j][d])}`).join(' + ');
          f.add(`Score (${TOKENS[i]}, ${TOKENS[j]}): query of “${TOKENS[i]}” dotted with key of “${TOKENS[j]}”.`, view(i, j, n), fr([['q·k', `${expand} + … = ${cell(S[i][j])}`], ['cell', `${n} of 16`]]));
        }
      f.add('High score means “this key answers my query well”; the sign and size are not yet probabilities.', view(-1, -1, 16), fr([['scores', '4×4 raw']]));
    } else if (k === 'scale') {
      const dk = Q0[0].length;
      f.add('Raw scores grow with the vector length, which would make the softmax too peaky.', mat('S', 250, 140, SD.raw, { title: 'Q · Kᵀ', rows: TOKENS, cols, detail: DT.S, cw: 120, ch: 60 }), fr([['d_k', dk], ['√d_k', cell(Math.sqrt(dk))]]));
      f.add(`Divide every score by √${dk} ≈ ${cell(Math.sqrt(dk))} to keep them in a comfortable range.`, mat('S', 250, 140, SD.scaled, { title: `Q · Kᵀ / √${dk}`, rows: TOKENS, cols, detail: DT.scaled, cw: 120, ch: 60, tone: () => 'write' }), fr([['scaled', 'all 16 cells']]));
      for (let i = 0; i < 4; i++)
        f.add(i === 0 ? '“the” is the first token, so it may only look at itself: the rest of its row becomes −∞.' : `“${TOKENS[i]}” may look at tokens 0 to ${i}; everything to the right is the future and gets masked.`, mat('S', 250, 140, SD.scaled.map((r, a) => r.map((v, b) => (a <= i && b > a ? -Infinity : v))), { title: 'masked scores', rows: TOKENS, cols, detail: DT.mask, cw: 120, ch: 60, tone: (a, b) => (a <= i && b > a ? 'muted' : a === i ? 'current' : undefined) }), fr([['masked so far', [3, 5, 6, 6][i]]]));
      f.add('The upper triangle is −∞: after the softmax those weights are exactly zero.', mat('S', 250, 140, SD.masked, { title: 'masked scores', rows: TOKENS, cols, detail: DT.mask, cw: 120, ch: 60, tone: (a, b) => (b > a ? 'muted' : undefined) }), fr([['masked cells', 6], ['visible pairs', 10]]));
    } else if (k === 'softmax') {
      const P = SD.P;
      const view = (n: number, hi: number) => [
        ...mat('M', 90, 110, SD.masked, { title: 'masked scores', rows: TOKENS, detail: DT.mask, cw: 95, ch: 56, tone: (a, b) => (a === hi ? 'current' : b > a ? 'muted' : undefined) }),
        ...mat('P', 570, 110, P.map((r, a) => (a < n ? r : r.map(() => 0))), { title: 'weights (softmax)', cols: TOKENS, detail: DT.P, cw: 95, ch: 56, tone: (a, b) => (a < n ? (b > a ? 'muted' : heat(P[a][b])) : 'visited') }),
      ];
      f.add('Softmax turns each row of scores into weights that are non-negative and add up to 1.', view(0, -1), fr([['per row', 'exp, then divide by the sum']]));
      for (let i = 0; i < 4; i++)
        f.add(`Row “${TOKENS[i]}”: ${P[i].slice(0, i + 1).map((w, j) => `${TOKENS[j]} ${cell(w)}`).join(', ')}.`, view(i + 1, i), fr([['row sum', cell(P[i].reduce((a, b) => a + b, 0))], ['largest', TOKENS[P[i].indexOf(Math.max(...P[i]))]]]));
      f.add('Darker cells are stronger attention; the masked future stays at exactly 0.', [...view(4, -1), ...bars('pb', 90, 480, 820, TOKENS.map((t, j) => ({ label: `down→${t}`, p: P[3][j], tone: heat(P[3][j]) })))], fr([['rows', 'all sum to 1']]));
    } else {
      const P = SD.P;
      const O = SD.O;
      const toks = (hi: number) => tokenRow('tk', 90, 60, TOKENS, { w: 170, tone: (i) => (i === hi ? 'current' : undefined), detail: DT.tokens });
      const view = (i: number, n: number) => [
        ...toks(i),
        ...(i >= 0 ? TOKENS.slice(0, i + 1).map((_, j) => arrow(`a${j}`, 90 + j * 184 + 85, 128, 90 + i * 184 + 85 + (j - i) * 8, 128 + 70 + 10 * (i - j), heat(P[i][j]), { width: 2 + 8 * P[i][j] })) : []),
        ...(i >= 0 ? TOKENS.slice(0, i + 1).map((t, j) => text(`w${j}`, 90 + j * 184 + 85, 240, `${cell(P[i][j])}`, { size: 26, mono: true, tone: heat(P[i][j]) })) : []),
        ...mat('V', 90, 330, V0, { title: 'V  (4×8)', rows: TOKENS, detail: DT.V, cw: 52, ch: 38, tone: (r) => (i >= 0 && r <= i ? heat(P[i][r]) : undefined) }),
        ...mat('O', 90, 610, O.map((r, a) => (a < n ? r : r.map(() => 0))), { title: 'output = weights · V  (4×8)', rows: TOKENS, detail: DT.O, cw: 52, ch: 38, tone: (a) => (a === i ? 'write' : a >= n ? 'visited' : undefined) }),
      ];
      f.add('Last step: each token’s output is a blend of the value rows it attends to.', view(-1, 0), fr([['weights', '4×4'], ['V', '4×8'], ['output', '4×8']]));
      for (let i = 0; i < 4; i++)
        f.add(`“${TOKENS[i]}” = ${TOKENS.slice(0, i + 1).map((t, j) => `${cell(P[i][j])}·v(${t})`).join(' + ')}.`, view(i, i + 1), fr([['out[0]', cell(O[i][0])], ['row', `${i + 1} of 4`]]));
      f.add('Each row now carries context: “down” holds a mix of everything before it.', view(-1, 4), fr([['attention out', sh(O)]]));
    }
    return f.frames;
  },
});

// ---------------- 4. multi-head attention ----------------
const MH = mha(X0, 0);

machineDemo({
  slug: 'tx-mha',
  title: 'Multi-head attention',
  group: 'ai-attention',
  summary: 'Split Q, K, V into 2 heads of 4 columns, attend in parallel with different patterns, concatenate, project with W_O.',
  inputs: [
    { id: 'split', label: 'Split into heads', data: { k: 'split' } },
    { id: 'heads', label: 'Heads in parallel', data: { k: 'heads' } },
    { id: 'concat', label: 'Concat + W_O', data: { k: 'concat' } },
  ],
  build({ k }: { k: string }) {
    const f = new Film();
    const headTone = (c: number): Tone => (c < D_HEAD ? 'read' : 'write');
    if (k === 'split') {
      const [q0, q1] = splitHeads(MH.Q, HEADS);
      f.add('Q is 4×8, but the 8 columns are treated as 2 groups of 4, one per head.', mat('Q', 110, 120, MH.Q, { title: 'Q  (4×8)', rows: TOKENS, detail: DT.split, cw: 90, ch: 52, tone: (_r, c) => headTone(c) }), fr([['heads', HEADS], ['d_head', D_HEAD]]));
      f.add('Head 1 takes columns 0 to 3.', [...mat('Q', 110, 120, MH.Q, { title: 'Q  (4×8)', rows: TOKENS, detail: DT.split, cw: 90, ch: 52, tone: (_r, c) => (c < D_HEAD ? 'current' : 'visited') }), ...mat('q0', 110, 500, q0, { title: 'Q head 1  (4×4)', rows: TOKENS, detail: DT.split, cw: 90, ch: 52, tone: () => 'read' })], fr([['Q_h1', sh(q0)]]));
      f.add('Head 2 takes columns 4 to 7; K and V are split the same way.', [...mat('q0', 110, 150, q0, { title: 'Q head 1  (4×4)', rows: TOKENS, detail: DT.split, cw: 90, ch: 52, tone: () => 'read' }), ...mat('q1', 560, 150, q1, { title: 'Q head 2  (4×4)', detail: DT.split, cw: 90, ch: 52, tone: () => 'write' }), shape('sh', 110, 470, '(4×8) → view → (2 heads × 4 × 4)'), shape('sh2', 110, 520, 'no new weights: just a reshape')], fr([['reshape', '4×8 → 2×4×4']]));
    } else if (k === 'heads') {
      const hm = (id: string, x: number, P: Mat, title: string, t: Tone) => mat(id, x, 150, P, { title, rows: x < 400 ? TOKENS : undefined, cols: TOKENS, detail: DT.P, cw: 95, ch: 60, tone: (a, b) => (b > a ? 'muted' : heat(P[a][b]) === 'visited' ? 'visited' : t) });
      const [h0, h1] = MH.heads;
      f.add('Each head runs the whole attention recipe on its own 4-column slice, in parallel.', [...hm('h0', 110, h0.P.map((r) => r.map(() => 0)), 'head 1 weights', 'read'), ...hm('h1', 560, h1.P.map((r) => r.map(() => 0)), 'head 2 weights', 'write')], fr([['√d_head', '2']]));
      f.add('Head 1 finishes: its own scores, ÷ √4, mask, softmax.', [...hm('h0', 110, h0.P, 'head 1 weights', 'read'), ...hm('h1', 560, h1.P.map((r) => r.map(() => 0)), 'head 2 weights', 'write')], fr([['down attends most to', TOKENS[h0.P[3].indexOf(Math.max(...h0.P[3]))]]]));
      f.add('Head 2 finishes with a different pattern, because its slice of Q and K is different.', [...hm('h0', 110, h0.P, 'head 1 weights', 'read'), ...hm('h1', 560, h1.P, 'head 2 weights', 'write')], fr([['head 1: down →', TOKENS[h0.P[3].indexOf(Math.max(...h0.P[3]))]], ['head 2: down →', TOKENS[h1.P[3].indexOf(Math.max(...h1.P[3]))]]]));
      f.add('Different heads learn different relations, like “previous word” or “the subject”.', [...hm('h0', 110, h0.P, 'head 1 weights', 'read'), ...hm('h1', 560, h1.P, 'head 2 weights', 'write'), ...mat('o0', 110, 560, h0.O, { title: 'head 1 out  (4×4)', rows: TOKENS, detail: DT.O, cw: 90, ch: 44, tone: () => 'read' }), ...mat('o1', 560, 560, h1.O, { title: 'head 2 out  (4×4)', detail: DT.O, cw: 90, ch: 44, tone: () => 'write' })], fr([['outputs', '2 × 4×4']]));
    } else {
      const [h0, h1] = MH.heads;
      f.add('Two head outputs, each 4×4.', [...mat('o0', 110, 130, h0.O, { title: 'head 1 out', rows: TOKENS, detail: DT.O, cw: 90, ch: 48, tone: () => 'read' }), ...mat('o1', 560, 130, h1.O, { title: 'head 2 out', detail: DT.O, cw: 90, ch: 48, tone: () => 'write' })], fr([['heads', 2]]));
      f.add('Concatenate them side by side: back to 4×8.', [...mat('C', 110, 130, MH.concat, { title: 'concat  (4×8)', rows: TOKENS, detail: DT.concat, cw: 90, ch: 48, tone: (_r, c) => headTone(c) })], fr([['concat', sh(MH.concat)]]));
      f.add('Multiply by W_O (8×8) so the heads’ findings get mixed together.', [...mat('C', 110, 130, MH.concat, { title: 'concat  (4×8)', rows: TOKENS, detail: DT.concat, cw: 90, ch: 48, tone: (_r, c) => headTone(c) }), ...mat('Y', 110, 560, MH.out, { title: 'MHA(X) = concat · W_O  (4×8)', rows: TOKENS, detail: DT.WO, cw: 90, ch: 48, tone: () => 'current' })], fr([['W_O', '8×8'], ['out', sh(MH.out)]]));
      f.add('Same shape as X, so it can be added straight back onto X by the residual connection.', [...mat('Y', 110, 130, MH.out, { title: 'MHA(X)  (4×8)', rows: TOKENS, detail: DT.WO, cw: 90, ch: 48 }), shape('sh', 110, 400, 'X (4×8) + MHA(X) (4×8)  →  residual')], fr([['weights used', 'W_Q W_K W_V W_O']]));
    }
    return f.frames;
  },
});

// ---------------- 5. the block ----------------
const B0 = block(X0, 0);
const BLOCK_NODES = [
  N('x', 60, 60, 260, 90, 'X', '4×8', { detail: DT.X }),
  N('mha', 380, 60, 300, 90, 'multi-head attn', '4×8', { detail: DT.block }),
  N('add1', 740, 60, 200, 90, '+ residual', undefined, { detail: DT.res }),
  N('ln1', 740, 230, 200, 90, 'LayerNorm', undefined, { detail: DT.LN }),
  N('ffn', 380, 230, 300, 90, 'FFN 8→32→8', 'GELU', { detail: DT.FFN }),
  N('add2', 60, 230, 260, 90, '+ residual', undefined, { detail: DT.res }),
  N('ln2', 60, 400, 260, 90, 'LayerNorm', undefined, { detail: DT.LN }),
  N('out', 380, 400, 300, 90, 'block output', '4×8', { detail: DT.block }),
];
const BLOCK_EDGES = ['x>mha', 'mha>add1', 'add1>ln1', 'ln1>ffn', 'ffn>add2', 'add2>ln2', 'ln2>out'];

boardDemo(
  'ai-block-deep',
  'tx-block',
  'The transformer block, following the data',
  'Attention, residual + LayerNorm, feed-forward with GELU, residual + LayerNorm; with the real numbers for row “the”.',
  {
    flow: [
      'Data flow',
      {
        panel: 'Block',
        nodes: BLOCK_NODES,
        edges: BLOCK_EDGES,
        beats: [
          { note: 'A block takes X (4×8) and returns a new 4×8 matrix; stacking blocks repeats this.', hot: { x: 'current' }, rows: [['in', '4×8']] },
          { note: 'Multi-head attention lets every token read from earlier tokens.', hot: { mha: 'current', 'x>mha': 'accent' }, rows: [['out', '4×8']] },
          { note: 'The residual adds the attention output back onto X instead of replacing it.', hot: { add1: 'current', 'mha>add1': 'accent' }, rows: [['x[0,0]', `${cell(X0[0][0])} + ${cell(B0.attn.out[0][0])} = ${cell(B0.res1[0][0])}`]] },
          { note: 'LayerNorm rescales each row to mean 0 and variance 1.', hot: { ln1: 'current', 'add1>ln1': 'accent' }, rows: [['row the', `mean ${cell(B0.ln1.mean[0])} → 0`]] },
          { note: 'The feed-forward network processes each token on its own: widen to 32, GELU, back to 8.', hot: { ffn: 'current', 'ln1>ffn': 'accent' }, rows: [['hidden', '4×32']] },
          { note: 'A second residual adds the FFN output to its input.', hot: { add2: 'current', 'ffn>add2': 'accent' }, rows: [['shape', '4×8']] },
          { note: 'A final LayerNorm, and the block output has the same shape as its input.', hot: { ln2: 'current', out: 'ok', 'add2>ln2': 'accent', 'ln2>out': 'accent' }, rows: [['out', '4×8'], ['params', blockParams(D, D_FF).total]] },
        ],
      },
    ],
  },
);

machineDemo({
  slug: 'tx-block-math',
  title: 'LayerNorm and the feed-forward network',
  group: 'ai-block-deep',
  summary: 'LayerNorm’s mean and variance on a real row, then the FFN widening 8 → 32, GELU, and back to 8.',
  inputs: [
    { id: 'layernorm', label: 'LayerNorm', data: { k: 'layernorm' } },
    { id: 'ffn', label: 'FFN + GELU', data: { k: 'ffn' } },
  ],
  build({ k }: { k: string }) {
    const f = new Film();
    if (k === 'layernorm') {
      const r = B0.res1;
      const n = B0.ln1;
      f.add('After the residual, rows can drift to any scale.', mat('R', 110, 150, r, { title: 'X + MHA(X)  (4×8)', rows: TOKENS, detail: DT.res, cw: 90, ch: 52 }), fr([['row the mean', cell(n.mean[0])], ['row the var', cell(n.variance[0])]]));
      for (let t = 0; t < 4; t++)
        f.add(`Row “${TOKENS[t]}”: subtract its mean ${cell(n.mean[t])}, divide by √(var ${cell(n.variance[t])}).`, [
          ...mat('R', 110, 150, r, { title: 'X + MHA(X)', rows: TOKENS, detail: DT.res, cw: 90, ch: 52, tone: (a) => (a === t ? 'current' : undefined) }),
          ...mat('L', 110, 560, n.out.map((row, a) => (a <= t ? row : row.map(() => 0))), { title: 'LayerNorm output', rows: TOKENS, detail: DT.LN, cw: 90, ch: 52, tone: (a) => (a === t ? 'write' : a > t ? 'visited' : undefined) }),
        ], fr([['mean', cell(n.mean[t])], ['variance', cell(n.variance[t])]]));
      const m = n.out[0].reduce((a, b) => a + b, 0) / D;
      f.add('Every row now has mean 0 and variance 1, whatever came in.', mat('L', 110, 150, n.out, { title: 'LayerNorm output', rows: TOKENS, detail: DT.LN, cw: 90, ch: 52 }), fr([['row the mean', cell(m)], ['row the var', cell(n.out[0].reduce((a, b) => a + (b - m) ** 2, 0) / D)]]));
    } else {
      const ff = B0.ff;
      const show = (M: number[]) => [M.slice(0, 8), M.slice(8, 16), M.slice(16, 24), M.slice(24, 32)];
      f.add('The FFN runs on each token separately; here is the row for “the”.', mat('x', 110, 150, [B0.ln1.out[0]], { title: 'input row the  (1×8)', detail: DT.FFN, cw: 90, ch: 52 }), fr([['W1', '8×32'], ['W2', '32×8']]));
      f.add('Multiply by W1 (8×32): the row widens to 32 hidden features.', [...mat('x', 110, 150, [B0.ln1.out[0]], { title: 'input row the  (1×8)', detail: DT.FFN, cw: 90, ch: 52 }), ...mat('h', 110, 330, show(ff.hidden[0]), { title: 'hidden = x · W1  (32 values)', detail: DT.FFN, cw: 90, ch: 52, tone: () => 'read' })], fr([['hidden', '1×32']]));
      f.add('GELU squashes negatives towards 0 and keeps positives, like a smooth ReLU.', [...mat('h', 110, 150, show(ff.hidden[0]), { title: 'hidden  (before)', detail: DT.FFN, cw: 90, ch: 52, tone: () => 'read' }), ...mat('a', 110, 500, show(ff.act[0]), { title: 'GELU(hidden)', detail: DT.FFN, cw: 90, ch: 52, tone: () => 'write' })], fr([['GELU(−1)', cell(gelu(-1))], ['GELU(1)', cell(gelu(1))]]));
      f.add('Multiply by W2 (32×8) to return to 8 features, ready for the residual.', [...mat('a', 110, 150, show(ff.act[0]), { title: 'GELU(hidden)', detail: DT.FFN, cw: 90, ch: 52, tone: () => 'write' }), ...mat('y', 110, 500, [ff.out[0]], { title: 'FFN(x) = GELU(x·W1) · W2  (1×8)', detail: DT.FFN, cw: 90, ch: 52, tone: () => 'current' })], fr([['out', '1×8'], ['FFN params', 2 * D * D_FF]]));
    }
    return f.frames;
  },
});

// ---------------- 6. stacking + next token ----------------
const FW = forward(IDS, 2);
const GEN = generate(IDS, 3, 2);

machineDemo({
  slug: 'tx-generate',
  title: 'Stack blocks, predict the next token',
  group: 'ai-block-deep',
  summary: 'N blocks refine X; the last row becomes logits over the vocabulary; softmax picks the next token; the loop appends it and repeats.',
  inputs: [
    { id: 'stack', label: 'Stack N blocks', data: { k: 'stack' } },
    { id: 'logits', label: 'Logits → token', data: { k: 'logits' } },
    { id: 'loop', label: 'Generation loop', data: { k: 'loop' } },
  ],
  build({ k }: { k: string }) {
    const f = new Film();
    if (k === 'stack') {
      const lay = (n: number) => [
        ...[0, 1].map((l) => {
          const b = box(`b${l}`, 140, 620 - l * 170, 460, 120, `block ${l + 1}`, { sub: 'MHA · FFN · residuals · LN', tone: n === l + 1 ? 'current' : n > l + 1 ? 'ok' : 'default' });
          if (b.t === 'rect') b.detail = DT.block;
          return b;
        }),
        ...[0, 1].map((l) => arrow(`ba${l}`, 370, 790 - l * 170, 370, 745 - l * 170, n > l ? 'accent' : 'muted')),
        box('xin', 140, 800, 460, 80, 'X = E[ids] + PE', { sub: '4×8', tone: n === 0 ? 'current' : 'default' }),
        box('lnf', 140, 160, 460, 80, 'final LayerNorm', { tone: n === 3 ? 'current' : 'default' }),
        arrow('ba2', 370, 445, 370, 245, n > 2 ? 'accent' : 'muted'),
        ...mat('xo', 660, 300, [FW.outs[Math.min(n, 2)][3]].map((r) => r.slice(0, 3)), { title: `row down after ${Math.min(n, 2)}`, detail: DT.X, cw: 100, ch: 52 }),
      ];
      f.add('X enters the stack; real models use 12 to 100+ blocks, this one has 2.', lay(0), fr([['blocks', 2], ['shape', '4×8 throughout']]));
      f.add('Block 1 rewrites every row using attention and the FFN.', lay(1), fr([['after block 1', '4×8']]));
      f.add('Block 2 does the same with its own weights, building more abstract features.', lay(2), fr([['after block 2', '4×8']]));
      f.add('A final LayerNorm, and the last row now summarises the whole prefix.', lay(3), fr([['next', 'project onto vocab']]));
    } else if (k === 'logits') {
      const last = FW.final[3];
      const items = (vals: number[]) => VOCAB.map((t, i) => ({ label: t, p: Math.max(0, vals[i]), tone: i === FW.next ? ('current' as Tone) : ('read' as Tone) }));
      f.add('Only the last row matters for the next token: “down” has seen the whole sentence.', mat('h', 110, 150, [last], { title: 'final row down  (1×8)', detail: DT.logits, cw: 90, ch: 52 }), fr([['vocab', VOCAB.length]]));
      f.add('Dot it with every embedding row: one logit per vocabulary word.', [...mat('h', 110, 150, [last], { title: 'final row down  (1×8)', detail: DT.logits, cw: 90, ch: 52 }), ...mat('lg', 110, 330, [FW.logits], { title: 'logits = h · Eᵀ  (1×8)', cols: VOCAB, detail: DT.logits, cw: 90, ch: 52, tone: () => 'write' })], fr([['highest logit', VOCAB[FW.logits.indexOf(Math.max(...FW.logits))]]]));
      f.add('Softmax turns logits into probabilities over the 8 words.', [...bars('pb', 110, 150, 800, items(FW.probs))], fr([['sum', cell(FW.probs.reduce((a, b) => a + b, 0))]]));
      f.add(`Greedy decoding picks the most likely word: “${VOCAB[FW.next]}”, with random weights so the choice is arbitrary.`, [...bars('pb', 110, 150, 800, items(FW.probs)), box('pick', 110, 640, 400, 90, `next = ${VOCAB[FW.next]}`, { tone: 'ok', sub: `p = ${cell(FW.probs[FW.next])}` })], fr([['next', VOCAB[FW.next]], ['training', 'would make it sensible']]));
    } else {
      const seqAt = (s: number) => GEN.seq.slice(0, IDS.length + s).map((i) => VOCAB[i]);
      f.add('Generation is a loop: run the model, pick a token, append it, run again.', tokenRow('tk', 60, 200, seqAt(0), { w: 120, detail: DT.tokens }), fr([['length', 4]]));
      GEN.picks.forEach((p, s) =>
        f.add(`Step ${s + 1}: the model picks “${VOCAB[p.id]}” (p ${cell(p.p)}) and it is appended.`, [
          ...tokenRow('tk', 60, 200, seqAt(s + 1), { w: 120, tone: (i) => (i === IDS.length + s ? 'ok' : undefined), detail: DT.tokens }),
          text('note', 60, 360, 'each step re-reads the whole prefix', { align: 'left', size: 26, tone: 'muted' }),
        ], fr([['length', IDS.length + s + 1], ['picked', VOCAB[p.id]]])),
      );
      f.add('Recomputing K and V for old tokens is wasteful, which is what the KV cache fixes (Inference topic).', tokenRow('tk', 60, 200, seqAt(GEN.picks.length), { w: 120, detail: DT.tokens }), fr([['see', 'AI → Inference & decoding']]));
    }
    return f.frames;
  },
});

// ---------------- 7. shapes and parameters ----------------
const SHAPES: [string, string, string][] = [
  ['ids', 'B × T', 'integers'],
  ['x = E[ids] + PE', 'B × T × C', 'C = d_model'],
  ['q, k, v', 'B × T × C', '3 linear layers'],
  ['q per head', 'B × h × T × C/h', 'view + transpose'],
  ['scores', 'B × h × T × T', 'grows with T²'],
  ['weights · v', 'B × h × T × C/h', ''],
  ['concat · W_O', 'B × T × C', ''],
  ['FFN hidden', 'B × T × 4C', ''],
  ['block out', 'B × T × C', 'same as input'],
  ['logits', 'B × T × vocab', 'last row used'],
];

machineDemo({
  slug: 'tx-shapes',
  title: 'Shapes and parameter count',
  group: 'ai-block-deep',
  summary: 'Every tensor’s shape through one block in (B, T, C, heads) terms, and the parameter count of a block for the demo and for GPT-2 small.',
  inputs: [
    { id: 'shapes', label: 'Tensor shapes', data: { k: 'shapes' } },
    { id: 'params', label: 'Parameters', data: { k: 'params' } },
  ],
  build({ k }: { k: string }) {
    const f = new Film();
    if (k === 'shapes') {
      const table = (n: number) =>
        SHAPES.slice(0, n).flatMap(([name, s, note], i) => {
          const b = box(`n${i}`, 40, 60 + i * 88, 400, 76, name, { mono: true, tone: i === n - 1 ? 'current' : 'default' });
          if (b.t === 'rect') b.detail = { title: name, text: `Shape ${s}${note ? `: ${note}` : ''}. In the demo B = 1, T = 4, C = 8, h = 2.`, code: 'print(x.shape)  # torch.Size([1, 4, 8])' };
          return [b, text(`s${i}`, 470, 60 + i * 88 + 38, s, { align: 'left', size: 26, mono: true, tone: 'write' }), text(`t${i}`, 770, 60 + i * 88 + 38, note, { align: 'left', size: 24, tone: 'muted' })];
        });
      for (let n = 1; n <= SHAPES.length; n++) f.add(n === 1 ? 'B is the batch, T the sequence length, C the model width, h the number of heads.' : `${SHAPES[n - 1][0]}: ${SHAPES[n - 1][1]}.`, table(n), fr([['demo', 'B 1 · T 4 · C 8 · h 2'], ['step', `${n} of ${SHAPES.length}`]]));
    } else {
      const tiny = blockParams(D, D_FF);
      const gpt2 = blockParams(768, 3072);
      const view = (p: ReturnType<typeof blockParams>, label: string, hi: number) =>
        [
          ['attention  4·C²', p.attn],
          ['FFN  2·C·4C + biases', p.mlp],
          ['2 LayerNorms  4·C', p.norms],
          ['block total', p.total],
        ].map(([n, v], i) => {
          const b = box(`p${i}`, 110, 150 + i * 130, 780, 100, `${n}`, { sub: `${label}: ${Number(v).toLocaleString('en-US')}`, mono: true, tone: i === hi ? 'current' : i === 3 && hi >= 3 ? 'ok' : 'default' });
          if (b.t === 'rect') b.detail = DT.block;
          return b;
        });
      f.add('Attention holds four C×C matrices: W_Q, W_K, W_V and W_O.', view(tiny, 'C = 8', 0), fr([['attention', tiny.attn]]));
      f.add('The FFN holds two C×4C matrices plus biases, twice the attention.', view(tiny, 'C = 8', 1), fr([['FFN', tiny.mlp]]));
      f.add('The demo block has a few hundred parameters.', view(tiny, 'C = 8', 3), fr([['total', tiny.total]]));
      f.add('The same formula at GPT-2 small width (C 768) gives about 7 million per block, times 12 blocks.', view(gpt2, 'C = 768', 3), fr([['per block', gpt2.total.toLocaleString('en-US')], ['12 blocks', (12 * gpt2.total).toLocaleString('en-US')]]));
    }
    return f.frames;
  },
});
