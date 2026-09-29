// Small, exact numerics behind the AI demos: every number drawn is computed here.

export type Mat = number[][];

export const round = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;

export function softmax(xs: number[], temperature = 1): number[] {
  const t = Math.max(1e-6, temperature);
  const m = Math.max(...xs.map((x) => x / t));
  const e = xs.map((x) => Math.exp(x / t - m));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((x) => x / s);
}

export function matmul(a: Mat, b: Mat): Mat {
  return a.map((row) => b[0].map((_, j) => row.reduce((acc, v, k) => acc + v * b[k][j], 0)));
}

export const transpose = (a: Mat): Mat => a[0].map((_, j) => a.map((r) => r[j]));

/** Scaled dot-product attention; causal masks future positions. */
export function attention(Q: Mat, K: Mat, V: Mat, causal = false) {
  const d = Q[0].length;
  const scores = matmul(Q, transpose(K)).map((r, i) => r.map((s, j) => (causal && j > i ? -Infinity : s / Math.sqrt(d))));
  const weights = scores.map((r) => softmax(r));
  return { scores, weights, out: matmul(weights, V) };
}

/** Sinusoidal positional encoding for position `pos`, `d` dims. */
export function positional(pos: number, d: number): number[] {
  return Array.from({ length: d }, (_, i) => {
    const f = pos / 10000 ** ((2 * Math.floor(i / 2)) / d);
    return i % 2 === 0 ? Math.sin(f) : Math.cos(f);
  });
}

// ---------- tokenization ----------
export interface BpeStep {
  pair: [string, string];
  count: number;
  tokens: string[];
}

/** Train BPE on one string (chars as the base vocabulary): repeatedly merge the most frequent adjacent pair. */
export function bpeTrain(text: string, merges: number): { steps: BpeStep[]; tokens: string[] } {
  let tokens = [...text];
  const steps: BpeStep[] = [];
  for (let m = 0; m < merges; m++) {
    const counts = new Map<string, number>();
    for (let i = 0; i + 1 < tokens.length; i++) {
      const k = tokens[i] + '\u0000' + tokens[i + 1];
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    let best = '';
    let bc = 1;
    for (const [k, c] of counts) if (c > bc) (best = k), (bc = c);
    if (!best) break;
    const [a, b] = best.split('\u0000');
    const next: string[] = [];
    for (let i = 0; i < tokens.length; i++) {
      if (i + 1 < tokens.length && tokens[i] === a && tokens[i + 1] === b) next.push(a + b), i++;
      else next.push(tokens[i]);
    }
    tokens = next;
    steps.push({ pair: [a, b], count: bc, tokens });
  }
  return { steps, tokens };
}

/** Encode with learned merges, applied in training order. */
export function bpeEncode(text: string, merges: [string, string][]): string[] {
  let tokens = [...text];
  for (const [a, b] of merges) {
    const next: string[] = [];
    for (let i = 0; i < tokens.length; i++) {
      if (i + 1 < tokens.length && tokens[i] === a && tokens[i + 1] === b) next.push(a + b), i++;
      else next.push(tokens[i]);
    }
    tokens = next;
  }
  return tokens;
}

/** UTF-8 bytes of a string (plain JS; no TextEncoder in every runtime). */
export function utf8Bytes(s: string): number[] {
  const out: number[] = [];
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return out;
}

// ---------- embeddings ----------
export function cosine(a: number[], b: number[]): number {
  const dot = a.reduce((s, v, i) => s + v * b[i], 0);
  const na = Math.hypot(...a);
  const nb = Math.hypot(...b);
  return na && nb ? dot / (na * nb) : 0;
}

export function topK(query: number[], items: { id: string; v: number[] }[], k: number) {
  return items
    .map((it) => ({ id: it.id, score: cosine(query, it.v) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

export const vadd = (a: number[], b: number[]) => a.map((v, i) => v + b[i]);
export const vsub = (a: number[], b: number[]) => a.map((v, i) => v - b[i]);

// ---------- neural nets ----------
export const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
export const relu = (x: number) => Math.max(0, x);

/** One neuron, sigmoid, squared error: forward values and exact gradients. */
export function neuronStep(w: number[], b: number, x: number[], y: number, lr: number) {
  const z = w.reduce((s, wi, i) => s + wi * x[i], b);
  const a = sigmoid(z);
  const loss = (a - y) ** 2;
  const dA = 2 * (a - y);
  const dZ = dA * a * (1 - a);
  const dW = x.map((xi) => dZ * xi);
  const dB = dZ;
  return { z, a, loss, dA, dZ, dW, dB, w2: w.map((wi, i) => wi - lr * dW[i]), b2: b - lr * dB };
}

/** Fit y = w·x + b to points with mini-batch SGD; returns the loss after each epoch. */
export function sgdFit(pts: [number, number][], batch: number, lr: number, epochs: number) {
  let w = 0;
  let b = 0;
  const losses: number[] = [];
  for (let e = 0; e < epochs; e++) {
    for (let i = 0; i < pts.length; i += batch) {
      const bt = pts.slice(i, i + batch);
      let gw = 0;
      let gb = 0;
      for (const [x, y] of bt) {
        const err = w * x + b - y;
        gw += (2 * err * x) / bt.length;
        gb += (2 * err) / bt.length;
      }
      w -= lr * gw;
      b -= lr * gb;
    }
    losses.push(pts.reduce((s, [x, y]) => s + (w * x + b - y) ** 2, 0) / pts.length);
  }
  return { w, b, losses };
}

/** Cross-entropy of the correct next token under softmax(logits). */
export const crossEntropy = (logits: number[], target: number) => -Math.log(softmax(logits)[target]);

// ---------- fine-tuning ----------
/** Trainable params: full fine-tune of a d×k matrix vs a rank-r LoRA adapter (A: r×k, B: d×r). */
export const loraParams = (d: number, k: number, r: number) => ({ full: d * k, lora: r * (d + k), ratio: (r * (d + k)) / (d * k) });

/** DPO loss for one pair: −log σ(β·[(logπ(yw)−logπref(yw)) − (logπ(yl)−logπref(yl))]). */
export function dpoLoss(beta: number, pw: number, refW: number, pl: number, refL: number) {
  const margin = beta * (pw - refW - (pl - refL));
  return { margin, loss: -Math.log(sigmoid(margin)) };
}

/** Bradley–Terry: probability the chosen answer beats the rejected one. */
export const bradleyTerry = (rChosen: number, rRejected: number) => sigmoid(rChosen - rRejected);

// ---------- quantization ----------
/** Symmetric absmax quantization to `bits` (int8 → ±127, int4 → ±7). */
export function quantize(xs: number[], bits: 8 | 4) {
  const qmax = 2 ** (bits - 1) - 1;
  const absmax = Math.max(...xs.map(Math.abs));
  const scale = absmax / qmax || 1;
  const q = xs.map((x) => Math.max(-qmax, Math.min(qmax, Math.round(x / scale))));
  const deq = q.map((v) => v * scale);
  const errs = xs.map((x, i) => Math.abs(x - deq[i]));
  return { scale, q, deq, maxErr: Math.max(...errs), meanErr: errs.reduce((a, b) => a + b, 0) / errs.length };
}

/** Two int4 values in one byte, low nibble first (two's complement nibbles). */
export const packInt4 = (a: number, b: number) => (a & 0xf) | ((b & 0xf) << 4);
export function unpackInt4(byte: number): [number, number] {
  const s = (n: number) => (n & 0x8 ? n - 16 : n);
  return [s(byte & 0xf), s((byte >> 4) & 0xf)];
}

/** Weight memory in GB for `params` billions at `bits` per weight. */
export const weightGB = (paramsB: number, bits: number) => (paramsB * 1e9 * bits) / 8 / 1e9;

// ---------- inference ----------
/** KV cache bytes: 2 (K and V) × layers × kvHeads × headDim × tokens × batch × bytes. */
export const kvCacheBytes = (layers: number, kvHeads: number, headDim: number, tokens: number, batch: number, bytes = 2) => 2 * layers * kvHeads * headDim * tokens * batch * bytes;

/** Keep the smallest set of tokens whose probability sums to ≥ p (sorted high → low). */
export function topP(probs: number[], p: number): number[] {
  const idx = probs.map((v, i) => i).sort((a, b) => probs[b] - probs[a]);
  const keep: number[] = [];
  let acc = 0;
  for (const i of idx) {
    keep.push(i);
    acc += probs[i];
    if (acc >= p) break;
  }
  return keep;
}

export const topKIdx = (probs: number[], k: number) =>
  probs
    .map((v, i) => i)
    .sort((a, b) => probs[b] - probs[a])
    .slice(0, k);

/** Decode steps per request: static batching waits for the longest in each batch; continuous refills freed slots. */
export function batchingTimeline(lengths: number[], slots: number) {
  let t = 0;
  const staticEnd: number[] = [];
  for (let i = 0; i < lengths.length; i += slots) {
    const b = lengths.slice(i, i + slots);
    const m = Math.max(...b);
    b.forEach(() => staticEnd.push(t + m));
    t += m;
  }
  const staticSteps = t;
  const free = Array(slots).fill(0);
  const contEnd: number[] = [];
  const contStart: number[] = [];
  for (const len of lengths) {
    let s = 0;
    for (let i = 1; i < slots; i++) if (free[i] < free[s]) s = i;
    contStart.push(free[s]);
    free[s] += len;
    contEnd.push(free[s]);
  }
  return { staticSteps, staticEnd, contSteps: Math.max(...free), contStart, contEnd };
}

/**
 * Speculative decoding, one round: accept draft token i with prob min(1, p/q); stop at the first rejection.
 * `us` are the uniform draws. Returns accepted count and whether a correction token is sampled.
 */
export function speculativeRound(p: number[], q: number[], us: number[]) {
  let accepted = 0;
  const ratios = p.map((pi, i) => Math.min(1, pi / q[i]));
  for (let i = 0; i < p.length; i++) {
    if (us[i] < ratios[i]) accepted++;
    else break;
  }
  return { accepted, ratios, rejectedAt: accepted < p.length ? accepted : -1, tokens: accepted + 1 };
}

/** Expected tokens per target call with k drafts and per-token acceptance α: (1 − α^(k+1)) / (1 − α). */
export const speculativeExpected = (alpha: number, k: number) => (alpha >= 1 ? k + 1 : (1 - alpha ** (k + 1)) / (1 - alpha));

// ---------- GPU ----------
/** Roofline: attainable FLOP/s = min(peak, intensity × bandwidth). */
export function roofline(flops: number, bytes: number, peakTflops: number, bwTBs: number) {
  const intensity = flops / bytes;
  const ridge = peakTflops / bwTBs;
  const attainable = Math.min(peakTflops, intensity * bwTBs);
  return { intensity, ridge, attainable, bound: intensity < ridge ? ('memory' as const) : ('compute' as const) };
}

/** Matmul M×K by K×N in fp16: FLOPs and minimum bytes moved. */
export const matmulCost = (M: number, K: number, N: number, bytes = 2) => ({ flops: 2 * M * K * N, bytes: bytes * (M * K + K * N + M * N) });

// ---------- RAG ----------
/** Fixed-size word chunks with overlap. */
export function chunk(words: string[], size: number, overlap: number): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < words.length; i += size - overlap) {
    out.push(words.slice(i, i + size));
    if (i + size >= words.length) break;
  }
  return out;
}

/** Recall@k: share of relevant ids found in the top k. */
export const recallAtK = (ranked: string[], relevant: string[], k: number) => relevant.filter((r) => ranked.slice(0, k).includes(r)).length / relevant.length;

/** Reciprocal rank fusion of several rankings (k = 60). */
export function rrf(rankings: string[][], k = 60): { id: string; score: number }[] {
  const s = new Map<string, number>();
  for (const r of rankings) r.forEach((id, i) => s.set(id, (s.get(id) ?? 0) + 1 / (k + i + 1)));
  return [...s.entries()].map(([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score);
}
