// Running models: decoding and the KV cache, an inference server end to end, continuous batching,
// speculative decoding, and why GPUs are usually waiting on memory.
import type { Detail, Shape } from '../algo/frames';
import { boardDemo, N } from '../machine/lib/board';
import type { Board } from '../machine/lib/board';
import { box, Film, line, machineDemo, panel, text } from '../machine/lib/draw';
import { bars, fmt, grid } from './grid';
import { batchingTimeline, kvCacheBytes, matmulCost, roofline, softmax, speculativeExpected, speculativeRound, topKIdx, topP } from './math';

// ---------------- decoding & KV cache ----------------
const WORDS = ['mat', 'floor', 'sofa', 'roof', 'moon', 'cat'];
const LOGITS = [2.2, 1.6, 1.1, 0.4, -0.5, -1.2];

const DEC_DETAILS: Record<string, Detail> = {
  ctx: { title: 'Sampling strategies', text: 'Filter the distribution, renormalise, then sample. Greedy is top-k with k = 1.', code: 'out = model.generate(ids, do_sample=True,\n    temperature=0.7, top_k=50, top_p=0.9,\n    repetition_penalty=1.1)' },
  cache: {
    title: 'KV cache',
    text: 'Keys and values of past tokens don’t change, so they are stored and each new token only computes its own row.',
    code: 'out = model(ids, past_key_values=past,\n            use_cache=True)\npast = out.past_key_values   # grows by 1 token\nnext_id = out.logits[:, -1].argmax(-1)',
  },
  prefill: { title: 'Prefill', text: 'The whole prompt in one parallel forward pass: compute-bound, sets time-to-first-token.' },
  decode: { title: 'Decode', text: 'One token per forward pass, reading every weight and the whole cache each time: memory-bound, sets tokens per second.' },
};

machineDemo({
  slug: 'ai-decode',
  title: 'Decoding & the KV cache',
  group: 'ai-inference',
  summary: 'Greedy, top-k and top-p on real probabilities; prefill vs decode; KV-cache memory for a 7B model.',
  inputs: [
    { id: 'strategies', label: 'Greedy / top-k / top-p', data: { k: 'strategies' } },
    { id: 'kv', label: 'Prefill vs decode', data: { k: 'kv' } },
    { id: 'memory', label: 'Cache memory', data: { k: 'memory' } },
  ],
  details: DEC_DETAILS,
  build({ k }: { k: string }) {
    const f = new Film();
    const p = softmax(LOGITS);
    if (k === 'strategies') {
      const draw = (keep: number[], label: string): Shape[] => [
        box('ctx', 30, 60, 940, 90, '"the cat sat on the ___"', { sub: label, mono: true, tone: 'current' }),
        ...bars('p', 40, 220, 900, p.map((v, i) => ({ label: WORDS[i], p: v, tone: keep.includes(i) ? 'ok' : 'visited' }))),
      ];
      const tk = topKIdx(p, 3);
      const tp = topP(p, 0.9);
      f.add('The model outputs a probability for every token in the vocabulary.', draw(WORDS.map((_, i) => i), 'full distribution'), panel('Decode', [['candidates', WORDS.length]]));
      f.add('Greedy always takes the top token: deterministic, and prone to loops.', draw([0], 'greedy'), panel('Decode', [['pick', 'mat']]));
      f.add('Top-k keeps the k most likely (k = 3), renormalises, then samples.', draw(tk, 'top-k, k = 3'), panel('Decode', [['kept', tk.length]]));
      f.add(`Top-p keeps the smallest set reaching p = 0.9: here ${tp.length} tokens, adapting to how sure the model is.`, draw(tp, 'top-p, p = 0.9'), panel('Decode', [['kept', tp.length, 'ok']]));
    } else if (k === 'kv') {
      const cells = (n: number, hi: number[]) => grid('cache', 60, 360, [Array.from({ length: 8 }, (_, i) => (i < n ? `t${i}` : ''))], { cw: 110, ch: 70, title: 'KV cache (one layer)', tone: (_, c) => (hi.includes(c) ? 'write' : c < n ? 'read' : 'visited'), detail: DEC_DETAILS.cache });
      const phase = (id: string, label: string, sub: string, hot: boolean) => box(id, id === 'prefill' ? 60 : 520, 120, 420, 120, label, { sub, mono: true, tone: hot ? 'current' : 'default' });
      f.add('Prefill runs all 5 prompt tokens in one parallel pass and fills the cache.', [phase('prefill', 'prefill', '5 tokens, 1 pass', true), phase('decode', 'decode', '1 token per pass', false), ...cells(5, [0, 1, 2, 3, 4])], panel('KV', [['passes', 1], ['cached', 5]]));
      f.add('Decode step 1: only the new token computes Q, K, V; it attends to all cached keys.', [phase('prefill', 'prefill', 'done', false), phase('decode', 'decode', 'token 6', true), ...cells(6, [5])], panel('KV', [['new rows', 1], ['cached', 6]]));
      f.add('Each step appends one row, so work per token stays flat instead of growing with length.', [phase('prefill', 'prefill', 'done', false), phase('decode', 'decode', 'token 8', true), ...cells(8, [7])], panel('KV', [['with cache', 'O(n)'], ['without', 'O(n²)', 'warn']]));
      f.add('Prefill is compute-bound and sets time to first token; decode is memory-bound and sets tokens per second.', [phase('prefill', 'prefill', 'TTFT', false), phase('decode', 'decode', 'tokens/s', false), ...cells(8, [])], panel('KV', [['TTFT', 'prefill'], ['TPOT', 'decode']]));
    } else {
      const per = kvCacheBytes(32, 32, 128, 1, 1);
      const at = (tokens: number, batch: number) => kvCacheBytes(32, 32, 128, tokens, batch) / 1e9;
      const draw = (hi: number): Shape[] =>
        grid('mem', 220, 200, [['1 token', `${(per / 1e6).toFixed(2)} MB`], ['4k context', `${fmt(at(4096, 1))} GB`], ['4k × batch 16', `${fmt(at(4096, 16))} GB`]], { cw: 300, ch: 90, colLabels: ['', 'KV cache'], tone: (r) => (r === hi ? 'current' : undefined), detail: { title: 'KV cache size', text: '2 × layers × kv_heads × head_dim × tokens × batch × bytes. Llama-2-7B: 32 layers, 32 heads of 128, fp16.', code: 'kv = 2 * 32 * 32 * 128 * tokens * batch * 2' } });
      f.add('Per token the cache stores K and V for every layer and head: 2 × 32 × 32 × 128 × 2 bytes.', draw(0), panel('Llama-7B', [['per token', `${(per / 1e6).toFixed(2)} MB`]]));
      f.add(`A 4k-token conversation needs ${fmt(at(4096, 1))} GB of cache.`, draw(1), panel('Llama-7B', [['4k tokens', `${fmt(at(4096, 1))} GB`]]));
      f.add(`Sixteen of them need ${fmt(at(4096, 16))} GB, far more than the 14 GB of weights.`, draw(2), panel('Llama-7B', [['batch 16', `${fmt(at(4096, 16))} GB`, 'warn']]));
      f.add('That is why servers page the cache into blocks, share prefixes, and use grouped-query attention with fewer KV heads.', draw(2), panel('Fixes', [['GQA 8 heads', `${fmt(at(4096, 16) / 4)} GB`, 'ok']]));
    }
    return f.frames;
  },
});

// ---------------- inference server ----------------
const SRV_NODES = [
  N('client', 30, 60, 280, 110, 'client', 'POST /generate', { detail: { title: 'Client', text: 'Sends a prompt and reads tokens back as a stream (server-sent events).', code: 'curl -N localhost:8000/generate \\\n  -d \'{"prompt":"hi","max_tokens":64,\n       "stream":true}\'' } }),
  N('api', 360, 60, 280, 110, 'API server', 'tokenize, validate', { detail: { title: 'API server', text: 'Tokenizes the prompt, checks limits, and hands a request object to the scheduler queue.', code: '@app.post("/generate")\nasync def gen(req: Req):\n    ids = tok.encode(req.prompt)\n    q = await scheduler.submit(ids, req)\n    return StreamingResponse(stream(q))' } }),
  N('queue', 690, 60, 280, 110, 'waiting queue', 'FIFO + priority', { detail: { title: 'Waiting queue', text: 'Requests wait here until the scheduler has KV-cache blocks and a batch slot for them.' } }),
  N('sched', 360, 300, 280, 120, 'scheduler', 'builds each step’s batch', { detail: { title: 'Scheduler', text: 'Every step it decides which running sequences continue and which waiting ones join, bounded by KV-cache blocks.', code: 'while True:\n    batch = running + admit(waiting)\n    logits = engine.step(batch)\n    for s, tok in sample(batch, logits):\n        s.emit(tok)\n        if s.done: free(s.blocks)' } }),
  N('kv', 690, 300, 280, 120, 'KV block pool', 'paged cache', { detail: { title: 'Paged KV cache', text: 'The cache is split into fixed-size blocks (16 tokens) mapped per sequence like virtual memory, so nothing is reserved up front.' } }),
  N('gpu', 360, 540, 280, 120, 'GPU forward', 'one step, whole batch', { detail: { title: 'Model step', text: 'One forward pass for every sequence in the batch: prefill chunks and decode tokens together.' } }),
  N('stream', 30, 540, 280, 120, 'token stream', 'SSE chunks', { detail: { title: 'Streaming', text: 'Each sampled token is detokenized and pushed to the client immediately, so users see text before the answer is done.', code: 'data: {"token": " Hello"}\n\ndata: {"token": "!"}\n\ndata: [DONE]' } }),
];
const SRV_EDGES = ['client>api', 'api>queue', 'queue>sched', 'sched>kv', 'kv>sched', 'sched>gpu', 'gpu>sched', 'sched>stream', 'stream>client'];

boardDemo('ai-serving', 'ai-server', 'An LLM inference server, request by request', 'Every hop of one request: HTTP in, tokenize, queue, scheduler, KV blocks, GPU step, token stream back to the client.', {
  request: [
    'One request, every hop',
    {
      panel: 'Server',
      nodes: SRV_NODES,
      edges: SRV_EDGES,
      beats: [
        { note: 'Request: the client POSTs a prompt with stream = true.', hot: { client: 'current', 'client>api': 'accent' }, rows: [['hop', 'client → API']] },
        { note: 'The API tokenizes it into 12 ids and enqueues a request object.', hot: { api: 'current', 'api>queue': 'accent' }, rows: [['prompt', '12 tokens']] },
        { note: 'The scheduler admits it once a batch slot is free.', hot: { queue: 'current', 'queue>sched': 'accent' }, rows: [['hop', 'queue → scheduler']] },
        { note: 'Request to the block pool: reserve cache blocks for 12 tokens; response: one 16-token block.', hot: { kv: 'current', 'sched>kv': 'accent', 'kv>sched': 'ok' }, rows: [['blocks', 1]] },
        { note: 'Prefill: the GPU runs the prompt in the next step alongside other sequences, and returns logits.', hot: { gpu: 'current', 'sched>gpu': 'accent', 'gpu>sched': 'ok' }, rows: [['step', 'prefill'], ['batch', 9]] },
        { note: 'The first token is sampled and streamed straight back to the client.', hot: { stream: 'ok', 'sched>stream': 'accent', 'stream>client': 'ok', client: 'ok' }, rows: [['TTFT', '85 ms', 'ok']] },
        { note: 'Every later step repeats scheduler → GPU → stream, one token each, until max_tokens or end-of-text.', hot: { sched: 'current', gpu: 'current', 'sched>gpu': 'accent', 'sched>stream': 'accent' }, rows: [['per token', '~22 ms']] },
        { note: 'When it finishes, its blocks return to the pool and a waiting request takes the slot.', hot: { kv: 'ok', queue: 'current', 'kv>sched': 'ok' }, rows: [['blocks freed', 1, 'ok']] },
      ],
    },
  ],
  overload: [
    'Overload',
    {
      panel: 'Server',
      nodes: SRV_NODES,
      edges: SRV_EDGES,
      beats: [
        { note: 'Under heavy load every running sequence keeps growing its cache.', hot: { kv: 'warn' }, sub: { kv: '98% blocks used' }, rows: [['KV used', '98%', 'warn']] },
        { note: 'New requests stay in the queue, so time to first token climbs while tokens per second hold.', hot: { queue: 'warn' }, sub: { queue: '37 waiting' }, rows: [['TTFT p99', '4.2 s', 'fail']] },
        { note: 'If blocks run out mid-generation, the scheduler preempts a sequence: frees its blocks and recomputes later.', hot: { sched: 'fail', kv: 'fail' }, sub: { sched: 'preempt seq 12' }, rows: [['preemptions', 3, 'warn']] },
        { note: 'Fixes: cap max tokens, add replicas behind a load balancer, or shed load with 429s at the API.', hot: { api: 'ok' }, sub: { api: '429 when queue > 32' }, rows: [['fix', 'admission control', 'ok']] },
      ],
    },
  ],
});

// ---------------- batching timeline ----------------
export const BATCH_LENGTHS = [6, 2, 3, 7, 2, 4];

machineDemo({
  slug: 'ai-batching',
  title: 'Static vs continuous batching',
  group: 'ai-serving',
  summary: 'Six requests of different lengths on 3 slots: static batches wait for the longest, continuous batching refills slots every step.',
  inputs: [
    { id: 'static', label: 'Static batching', data: { k: 'static' } },
    { id: 'continuous', label: 'Continuous batching', data: { k: 'continuous' } },
  ],
  details: {
    slot0: { title: 'A batch slot', text: 'One sequence decoding in the shared forward pass. Idle slots are wasted GPU time.', code: '# vLLM\nllm = LLM("meta-llama/Llama-3-8B")\nouts = llm.generate(prompts, SamplingParams(max_tokens=64))' },
  },
  build({ k }: { k: string }) {
    const f = new Film();
    const t = batchingTimeline(BATCH_LENGTHS, 3);
    const unit = 30;
    const x0 = 160;
    const cont = k === 'continuous';
    const lanes = (upto: number): Shape[] => {
      const out: Shape[] = [text('tt', 30, 60, cont ? 'continuous: a finished slot is refilled next step' : 'static: batch ends when its longest request ends', { align: 'left', size: 26, bold: true })];
      for (let s = 0; s < 3; s++) out.push(box(`slot${s}`, 30, 120 + s * 120, 110, 90, `slot ${s + 1}`, { mono: true }));
      const slotFree = [0, 0, 0];
      BATCH_LENGTHS.forEach((len, i) => {
        let start: number;
        let slot: number;
        if (cont) {
          start = t.contStart[i];
          slot = slotFree.indexOf(Math.min(...slotFree));
          slotFree[slot] = start + len;
        } else {
          slot = i % 3;
          start = 0;
          for (let j = 0; j < i - slot; j += 3) start += Math.max(...BATCH_LENGTHS.slice(j, j + 3));
        }
        if (start >= upto) return;
        const w = Math.min(len, upto - start) * unit;
        out.push(box(`r${i}`, x0 + start * unit, 120 + slot * 120, w - 4, 90, `R${i + 1}`, { mono: true, tone: (['read', 'write', 'protocol', 'accent', 'ok', 'warn'] as const)[i] }));
      });
      const end = cont ? t.contSteps : t.staticSteps;
      out.push(line('end', x0 + end * unit, 100, x0 + end * unit, 500, cont ? 'ok' : 'warn', { dashed: true }));
      out.push(text('endl', x0 + end * unit, 530, `${end} steps`, { size: 26, mono: true, tone: cont ? 'ok' : 'warn' }));
      return out;
    };
    const total = BATCH_LENGTHS.reduce((a, b) => a + b, 0);
    const steps = cont ? t.contSteps : t.staticSteps;
    const util = total / (3 * steps);
    f.add('Six requests needing 6, 2, 3, 7, 2 and 4 decode steps share 3 GPU slots.', lanes(1), panel('Batching', [['requests', 6], ['slots', 3]]));
    f.add(cont ? 'Continuous batching admits a waiting request the moment a slot frees up.' : 'Static batching runs R1–R3 together, and R2’s slot idles once it is done.', lanes(Math.ceil(steps / 2)), panel('Batching', [['step', Math.ceil(steps / 2)]]));
    f.add(`All done after ${steps} steps; slots were busy ${Math.round(util * 100)}% of the time.`, lanes(steps + 1), panel('Batching', [['steps', steps, cont ? 'ok' : 'warn'], ['utilisation', `${Math.round(util * 100)}%`, cont ? 'ok' : 'warn']]));
    return f.frames;
  },
});

// ---------------- speculative decoding ----------------
const SPEC_DETAIL: Detail = { title: 'Expected tokens per pass', text: 'With per-token acceptance α and k drafts, the target produces (1 − α^(k+1)) / (1 − α) tokens per forward pass on average.', code: 'def expected(a, k):\n    return (1 - a ** (k + 1)) / (1 - a)' };

export const SPEC_P = [0.6, 0.5, 0.2, 0.7];
export const SPEC_Q = [0.7, 0.5, 0.6, 0.7];
export const SPEC_U = [0.3, 0.9, 0.8, 0.1];

machineDemo({
  slug: 'ai-spec',
  title: 'Speculative decoding',
  group: 'ai-speculative',
  summary: 'A small draft model proposes 4 tokens, the big model verifies them in one pass; accept with probability min(1, p/q).',
  inputs: [
    { id: 'round', label: 'One round', data: { k: 'round' } },
    { id: 'speedup', label: 'Expected speedup', data: { k: 'speedup' } },
  ],
  details: {
    draft: { title: 'Draft model', text: 'A small model with the same tokenizer (distilgpt2 for gpt2). Cheap to run 4 times.', code: 'draft_ids = draft.generate(ids, max_new_tokens=4,\n                           do_sample=True)' },
    target: { title: 'Target model', text: 'One forward pass over prompt + 4 drafts gives its own probability at every drafted position.', code: 'p = target(torch.cat([ids, draft_ids], -1)).logits' },
  },
  build({ k }: { k: string }) {
    const f = new Film();
    const r = speculativeRound(SPEC_P, SPEC_Q, SPEC_U);
    const toks = ['on', 'the', 'red', 'mat'];
    if (k === 'round') {
      const row = (upto: number, verdict: boolean): Shape[] => [
        box('draft', 30, 80, 440, 110, 'draft model', { sub: 'proposes 4 tokens', mono: true, tone: upto === 0 ? 'current' : 'default' }),
        box('target', 530, 80, 440, 110, 'target model', { sub: '1 pass checks all 4', mono: true, tone: verdict ? 'current' : 'default' }),
        ...toks.flatMap((t, i): Shape[] => {
          const ok = i < r.accepted;
          const tone = !verdict || i >= upto ? 'default' : ok ? 'ok' : i === r.rejectedAt ? 'fail' : 'visited';
          return [box(`t${i}`, 60 + i * 230, 300, 200, 90, `"${t}"`, { mono: true, tone }), text(`pq${i}`, 160 + i * 230, 430, `p ${SPEC_P[i]} / q ${SPEC_Q[i]}`, { size: 24, mono: true }), text(`u${i}`, 160 + i * 230, 470, verdict && i < upto ? `u ${SPEC_U[i]} ${ok ? '< ' : '≥ '}${fmt(r.ratios[i])}` : '', { size: 24, mono: true, tone: ok ? 'ok' : 'fail' })];
        }),
      ];
      f.add('The draft model guesses the next 4 tokens, one cheap step each.', row(0, false), panel('Speculative', [['drafted', 4]]));
      f.add(`Token 1: p/q = ${fmt(r.ratios[0])} and u = ${SPEC_U[0]}, so it is accepted.`, row(1, true), panel('Speculative', [['accepted', 1]]));
      f.add(`Token 2: p/q = 1, accepted whatever u is.`, row(2, true), panel('Speculative', [['accepted', 2]]));
      f.add(`Token 3: p/q = ${fmt(r.ratios[2])} but u = ${SPEC_U[2]}, so it is rejected and everything after it is discarded.`, row(4, true), panel('Speculative', [['accepted', r.accepted], ['rejected at', r.rejectedAt + 1, 'fail']]));
      f.add(`The target samples a replacement from max(0, p − q), so one target pass produced ${r.tokens} tokens.`, row(4, true), panel('Speculative', [['tokens / target pass', r.tokens, 'ok']]));
    } else {
      const rows = [0.5, 0.7, 0.9].map((a) => [`α = ${a}`, fmt(speculativeExpected(a, 4))]);
      f.add('Speedup depends on α, how often the target agrees with the draft.', grid('sp', 280, 220, rows, { cw: 220, ch: 90, colLabels: ['acceptance', 'tokens / pass'], detail: SPEC_DETAIL }), panel('Expected', [['k', 4]]));
      f.add('Expected tokens per target pass with k drafts is (1 − α^(k+1)) / (1 − α).', grid('sp', 280, 220, rows, { cw: 220, ch: 90, colLabels: ['acceptance', 'tokens / pass'], tone: (r2) => (r2 === 2 ? 'ok' : undefined) }), panel('Expected', [['α 0.9', fmt(speculativeExpected(0.9, 4)), 'ok']]));
      f.add('Output is exactly the target model’s distribution; only latency changes.', grid('sp', 280, 220, rows, { cw: 220, ch: 90, colLabels: ['acceptance', 'tokens / pass'], tone: () => 'read' }), panel('Expected', [['quality', 'unchanged', 'ok']]));
    }
    return f.frames;
  },
});

// ---------------- GPU ----------------
const GPU_NODES = [
  N('hbm', 30, 620, 940, 140, 'HBM (global memory)', '80 GB · ~3 TB/s', { detail: { title: 'HBM', text: 'Where weights and the KV cache live. Huge but far from the cores; every decode step streams the weights through here.' } }),
  N('l2', 30, 430, 940, 110, 'L2 cache', '50 MB · shared by all SMs', { detail: { title: 'L2', text: 'On-chip cache in front of HBM, shared by every streaming multiprocessor.' } }),
  N('smem', 30, 240, 440, 110, 'shared memory (SRAM)', '~200 KB per SM', { detail: { title: 'Shared memory', text: 'Programmer-managed scratchpad inside each SM. Tiled matmul and FlashAttention keep data here to avoid HBM trips.', code: '// Metal: threadgroup float tile[16][16];\n// CUDA:  __shared__ float tile[16][16];' } }),
  N('reg', 530, 240, 440, 110, 'registers', 'per thread, fastest', { detail: { title: 'Registers', text: 'Each thread’s private values. Tensor cores multiply small tiles straight from here.' } }),
  N('cores', 280, 60, 440, 110, 'SMs × tensor cores', '~1000 TFLOP/s bf16', { detail: { title: 'Compute', text: 'Thousands of threads in groups of 32 (a warp) run the same instruction on different data.', code: 'kernel void add(device float* a, device float* b,\n  device float* c, uint i [[thread_position_in_grid]]) {\n  c[i] = a[i] + b[i];\n}' } }),
];

boardDemo(
  'ai-gpu',
  'ai-gpu',
  'GPU memory hierarchy & roofline',
  'Where data lives on a GPU, and why LLM decoding is limited by memory bandwidth while prefill and training are limited by compute.',
  {
    hierarchy: [
      'Memory hierarchy',
      {
        panel: 'GPU',
        nodes: GPU_NODES,
        edges: ['hbm>l2', 'l2>smem', 'l2>reg', 'smem>cores', 'reg>cores'],
        beats: [
          { note: 'Weights start in HBM: big, but hundreds of cycles away.', hot: { hbm: 'current' }, rows: [['HBM', '3 TB/s']] },
          { note: 'On the way up they pass the shared L2 cache.', hot: { l2: 'current', 'hbm>l2': 'accent' }, rows: [['L2', '~10 TB/s']] },
          { note: 'Kernels copy tiles into per-SM shared memory and registers.', hot: { smem: 'current', reg: 'current', 'l2>smem': 'accent', 'l2>reg': 'accent' }, rows: [['SRAM', '~20 TB/s', 'ok']] },
          { note: 'Tensor cores multiply those tiles; reusing each tile many times is the whole game.', hot: { cores: 'ok', 'smem>cores': 'accent', 'reg>cores': 'accent' }, rows: [['reuse', 'tiling', 'ok']] },
        ],
      },
    ],
    roofline: [
      'Roofline',
      (() => {
        const dec = matmulCost(1, 4096, 4096);
        const pre = matmulCost(2048, 4096, 4096);
        const rd = roofline(dec.flops, dec.bytes, 1000, 3.35);
        const rp = roofline(pre.flops, pre.bytes, 1000, 3.35);
        const b: Board = {
          panel: 'Roofline',
          nodes: [
            N('peak', 30, 60, 940, 110, 'peak compute 1000 TFLOP/s', `ridge = ${Math.round(rd.ridge)} FLOP/byte`, { detail: { title: 'Ridge point', text: 'Below this many FLOPs per byte loaded, a kernel cannot keep the cores busy: it is memory-bound.' } }),
            N('dec', 30, 300, 440, 160, 'decode: 1 × 4096 × 4096', `${fmt(rd.intensity)} FLOP/byte`, { detail: { title: 'Decode matmul', text: 'One token times a weight matrix: every weight is loaded to do 2 FLOPs. Batching more sequences raises the intensity.' } }),
            N('pre', 530, 300, 440, 160, 'prefill: 2048 × 4096 × 4096', `${Math.round(rp.intensity)} FLOP/byte`, { detail: { title: 'Prefill matmul', text: 'Thousands of tokens share each loaded weight, so the cores stay busy.' } }),
            N('res', 30, 580, 940, 150, 'attainable', 'min(peak, intensity × bandwidth)'),
          ],
          edges: ['peak>dec', 'peak>pre'],
          beats: [
            { note: 'A kernel is capped by compute, or by how fast memory can feed it: whichever is lower.', hot: { peak: 'current' }, rows: [['bandwidth', '3.35 TB/s']] },
            { note: `Decode does ${fmt(rd.intensity)} FLOPs per byte, far below the ridge, so it is memory-bound.`, hot: { dec: 'warn' }, sub: { res: `decode: ${fmt(rd.attainable)} TFLOP/s` }, rows: [['decode', `${fmt(rd.attainable)} TFLOP/s`, 'warn']] },
            { note: `Prefill does ${Math.round(rp.intensity)} FLOPs per byte, above the ridge, so it is compute-bound.`, hot: { pre: 'ok' }, sub: { res: `prefill: ${Math.round(rp.attainable)} TFLOP/s` }, rows: [['prefill', `${Math.round(rp.attainable)} TFLOP/s`, 'ok']] },
            { note: 'That is why batching, quantization and KV-cache tricks speed up decoding: they cut bytes per FLOP.', hot: { res: 'ok' }, sub: { res: 'more work per byte loaded' }, rows: [['levers', 'batch, int4, GQA', 'ok']] },
          ],
        };
        return b;
      })(),
    ],
  },
);
