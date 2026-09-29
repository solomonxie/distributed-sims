// After pretraining: fine-tuning (full, LoRA, QLoRA), preference tuning (reward model, PPO, DPO), quantization.
import type { Detail, Shape } from '../algo/frames';
import { boardDemo, N } from '../machine/lib/board';
import { box, Film, machineDemo, panel, text } from '../machine/lib/draw';
import { fmt, grid } from './grid';
import { bradleyTerry, dpoLoss, loraParams, packInt4, quantize, unpackInt4, weightGB } from './math';

// ---------------- fine-tuning ----------------
const LORA_DETAILS: Record<string, Detail> = {
  W: { title: 'Frozen base weight W', text: 'The pretrained matrix. With LoRA it never changes and needs no gradients or optimizer state.' },
  A: {
    title: 'LoRA A (r × k)',
    text: 'A small trainable matrix. Initialised random; B starts at zero so training begins exactly at the base model.',
    code: 'class LoRALinear(nn.Module):\n    def __init__(self, base, r=8, alpha=16):\n        super().__init__()\n        self.base = base.requires_grad_(False)\n        d, k = base.out_features, base.in_features\n        self.A = nn.Parameter(torch.randn(r, k) * .01)\n        self.B = nn.Parameter(torch.zeros(d, r))\n        self.s = alpha / r\n    def forward(self, x):\n        return self.base(x) + self.s * (x @ self.A.T @ self.B.T)',
  },
  B: { title: 'LoRA B (d × r)', text: 'The other half of the low-rank update ΔW = B·A. Rank r (4–64) limits how much it can change.' },
  merged: { title: 'Merge for serving', text: 'After training, fold the update into the weight so inference costs nothing extra, or keep adapters separate to swap them per request.', code: 'model = peft_model.merge_and_unload()\nmodel.save_pretrained("merged")' },
};

machineDemo({
  slug: 'ai-lora',
  title: 'Full fine-tune vs LoRA vs QLoRA',
  group: 'ai-finetune',
  summary: 'What each method trains and stores: full weights, a low-rank B·A adapter, or an adapter over a 4-bit frozen base.',
  inputs: [
    { id: 'full', label: 'Full fine-tune', data: { k: 'full' } },
    { id: 'lora', label: 'LoRA', data: { k: 'lora' } },
    { id: 'qlora', label: 'QLoRA', data: { k: 'qlora' } },
  ],
  details: LORA_DETAILS,
  build({ k }: { k: string }) {
    const f = new Film();
    const d = 4096;
    const r = 8;
    const p = loraParams(d, d, r);
    const matrices = (mode: string): Shape[] => {
      const out: Shape[] = [box('W', 60, 150, 420, 420, 'W', { sub: `${d} × ${d}`, mono: true, tone: mode === 'full' ? 'write' : 'visited', dashed: mode !== 'full' })];
      if (mode !== 'full') {
        out.push(box('B', 560, 150, 60, 420, 'B', { mono: true, tone: 'write' }));
        out.push(box('A', 660, 150, 300, 60, 'A', { mono: true, tone: 'write' }));
        out.push(text('eq', 700, 320, `ΔW = B·A  (rank ${r})`, { align: 'left', size: 28, mono: true }));
      }
      if (mode === 'qlora') out.push(text('q4', 270, 610, 'base stored in 4-bit NF4', { size: 26, tone: 'warn' }));
      return out;
    };
    if (k === 'full') {
      f.add('Full fine-tuning updates every weight of every layer.', matrices('full'), panel('Full', [['trainable', `${(p.full / 1e6).toFixed(1)}M per matrix`]]));
      f.add('Adam keeps two extra numbers per weight, so memory is roughly 4× the model in fp32.', matrices('full'), panel('Full', [['7B model', '~112 GB to train', 'warn']]));
      f.add('Result: a whole new copy of the model per task.', matrices('full'), panel('Full', [['output', '14 GB checkpoint']]));
    } else if (k === 'lora') {
      f.add('LoRA freezes W and learns a small update ΔW = B·A beside it.', matrices('lora'), panel('LoRA', [['rank r', r]]));
      f.add(`Trainable: ${r}·(${d}+${d}) = ${(p.lora / 1e3).toFixed(0)}k instead of ${(p.full / 1e6).toFixed(1)}M, which is ${(p.ratio * 100).toFixed(2)}%.`, matrices('lora'), panel('LoRA', [['trainable', `${(p.lora / 1e3).toFixed(0)}k`, 'ok'], ['share', `${(p.ratio * 100).toFixed(2)}%`]]));
      f.add('The output is y = Wx + (α/r)·B·A·x, and B starts at zero so step 0 equals the base model.', matrices('lora'), panel('LoRA', [['adapter file', '~10 MB', 'ok']]));
      f.add('Merge ΔW into W for serving, or keep many adapters and pick one per request.', [...matrices('lora'), box('merged', 60, 700, 900, 110, 'W′ = W + (α/r)·B·A', { mono: true, tone: 'ok' })], panel('LoRA', [['inference cost', '0 extra when merged']]));
    } else {
      f.add('QLoRA stores the frozen base in 4-bit, and trains a LoRA adapter on top in bf16.', matrices('qlora'), panel('QLoRA', [['base', '4-bit']]));
      f.add(`A 7B base drops from ${weightGB(7, 16)} GB to about ${weightGB(7, 4)} GB of weights.`, matrices('qlora'), panel('QLoRA', [['7B weights', `${weightGB(7, 4)} GB`, 'ok']]));
      f.add('Weights are dequantized on the fly for each matmul; gradients flow only into A and B.', matrices('qlora'), panel('QLoRA', [['fits', 'one 24 GB GPU', 'ok']]));
    }
    return f.frames;
  },
});

// ---------------- RLHF / DPO ----------------
const RLHF_NODES = [
  N('data', 40, 60, 430, 120, 'preference pairs', 'prompt, chosen, rejected', { detail: { title: 'Preference data', text: 'Humans (or a rule) pick the better of two answers. The toy task: more "A"s is better.', code: '{"prompt": "…",\n "chosen": "AAAB",\n "rejected": "ABBB"}' } }),
  N('rm', 530, 60, 430, 120, 'reward model', 'scores one answer', { detail: { title: 'Reward model', text: 'Trained so r(chosen) > r(rejected): Bradley–Terry loss −log σ(r_c − r_r).', code: 'loss = -F.logsigmoid(r(chosen) - r(rejected)).mean()' } }),
  N('policy', 40, 300, 430, 120, 'policy (the LLM)', 'generates answers', { detail: { title: 'Policy', text: 'The model being tuned. It samples answers to prompts.' } }),
  N('score', 530, 300, 430, 120, 'reward', 'r(answer)', { detail: { title: 'Scoring', text: 'Each sampled answer is scored by the frozen reward model.' } }),
  N('kl', 530, 520, 430, 120, 'KL to reference', 'don’t drift too far', { detail: { title: 'KL penalty', text: 'Reward minus β·KL(policy‖reference) stops the policy from gaming the reward model with gibberish.' } }),
  N('ppo', 40, 520, 430, 120, 'PPO update', 'clipped policy gradient', { detail: { title: 'PPO', text: 'Raise the log-probability of high-advantage tokens, clipped so one step can’t move the policy too far.', code: 'ratio = (logp - old_logp).exp()\nloss = -torch.min(ratio * adv,\n    ratio.clamp(.8, 1.2) * adv).mean()' } }),
  N('dpo', 40, 760, 920, 130, 'DPO: skip the reward model', 'optimise the preference directly', { detail: { title: 'DPO', text: 'A closed-form loss on (chosen, rejected) pairs using the policy and a frozen reference; no sampling, no reward model.', code: 'm = beta * ((pc - rc) - (pr - rr))\nloss = -F.logsigmoid(m).mean()' } }),
];

const bt = bradleyTerry(1.4, 0.3);
const dpo = dpoLoss(0.1, -4, -6, -9, -8);

boardDemo('ai-rlhf', 'ai-rlhf', 'RLHF: reward model, PPO and DPO', 'Preference pairs train a reward model; PPO optimises the policy against it with a KL leash; DPO does it in one loss.', {
  ppo: [
    'Reward model + PPO',
    {
      panel: 'RLHF',
      nodes: RLHF_NODES,
      edges: ['data>rm', 'policy>score', 'rm>score', 'score>kl', 'kl>ppo', 'ppo>policy'],
      beats: [
        { note: 'Start from pairs of answers where one was preferred.', hot: { data: 'current' }, hide: ['rm', 'policy', 'score', 'kl', 'ppo', 'dpo'], rows: [['pairs', '10k']] },
        { note: `Train a reward model so the chosen one scores higher; r_c = 1.4 vs r_r = 0.3 gives p(prefer chosen) = ${fmt(bt)}.`, hot: { rm: 'current', 'data>rm': 'accent' }, hide: ['policy', 'score', 'kl', 'ppo', 'dpo'], rows: [['p(chosen wins)', fmt(bt), 'ok']] },
        { note: 'The policy samples answers to fresh prompts, and the reward model scores them.', hot: { policy: 'current', score: 'current', 'policy>score': 'accent', 'rm>score': 'accent' }, hide: ['kl', 'ppo', 'dpo'], rows: [['samples', '64 per batch']] },
        { note: 'Subtract a KL penalty so the policy stays close to the original model.', hot: { kl: 'warn', 'score>kl': 'accent' }, hide: ['ppo', 'dpo'], rows: [['objective', 'r − β·KL']] },
        { note: 'PPO nudges the policy toward high-advantage answers, clipped to small steps, and the loop repeats.', hot: { ppo: 'current', 'kl>ppo': 'accent', 'ppo>policy': 'accent' }, hide: ['dpo'], rows: [['models in memory', 4, 'warn']] },
      ],
    },
  ],
  dpo: [
    'DPO',
    {
      panel: 'DPO',
      nodes: RLHF_NODES,
      edges: ['data>rm', 'policy>score', 'rm>score', 'score>kl', 'kl>ppo', 'ppo>policy'],
      beats: [
        { note: 'PPO needs a reward model, sampling and four models in memory.', hot: { rm: 'warn', ppo: 'warn' }, rows: [['PPO models', 4, 'warn']] },
        { note: 'DPO trains straight on the preference pairs with one classification-style loss.', hot: { dpo: 'current', data: 'current' }, hide: ['rm', 'score', 'kl', 'ppo'], rows: [['models', 'policy + frozen ref', 'ok']] },
        { note: `Margin = β·(chosen gain − rejected gain) = ${fmt(dpo.margin)}, loss = ${fmt(dpo.loss)}.`, hot: { dpo: 'current' }, hide: ['rm', 'score', 'kl', 'ppo'], rows: [['margin', fmt(dpo.margin)], ['loss', fmt(dpo.loss)]] },
        { note: 'Minimising it raises the chosen answer’s likelihood relative to the reference, and lowers the rejected one.', hot: { dpo: 'ok', policy: 'ok' }, hide: ['rm', 'score', 'kl', 'ppo'], rows: [['trade-off', 'simpler, offline', 'ok']] },
      ],
    },
  ],
});

// ---------------- quantization ----------------
export const QW = [0.42, -1.27, 0.05, 0.88, -0.33, 2.1, -0.71, 0.16];

const Q_DETAILS: Record<string, Detail> = {
  fp: { title: 'fp32 weights', text: 'Eight weights of one row. Real layers quantize per row or per group of 64–128 weights, each with its own scale.' },
  int8: {
    title: 'Absmax int8',
    text: 'scale = max|w| / 127, q = round(w / scale). One byte per weight plus one scale per group.',
    code: 'scale = w.abs().max() / 127\nq = (w / scale).round().clamp(-127, 127).to(torch.int8)\nw_hat = q.float() * scale',
  },
  int4: { title: 'int4', text: 'Only 15 levels, so error grows; GPTQ and AWQ pick values and scales to protect the weights that matter most.', code: '# bitsandbytes 4-bit\nBitsAndBytesConfig(load_in_4bit=True,\n    bnb_4bit_quant_type="nf4")' },
};

machineDemo({
  slug: 'ai-quant',
  title: 'Quantization: int8 and int4',
  group: 'ai-quant',
  summary: 'Absmax int8 on real numbers with its rounding error, int4 packing two weights per byte, and the memory/quality trade-off.',
  inputs: [
    { id: 'int8', label: 'int8 absmax', data: { k: 'int8' } },
    { id: 'int4', label: 'int4 + packing', data: { k: 'int4' } },
    { id: 'tradeoff', label: 'Memory vs quality', data: { k: 'tradeoff' } },
  ],
  details: Q_DETAILS,
  build({ k }: { k: string }) {
    const f = new Film();
    const row = (id: string, y: number, vals: (string | number)[], title: string, tone?: 'write' | 'ok' | 'warn' | 'read') => grid(id, 60, y, [vals], { cw: 110, ch: 64, title, tone: () => tone, detail: Q_DETAILS[id] });
    if (k === 'int8' || k === 'int4') {
      const bits = k === 'int8' ? 8 : 4;
      const q = quantize(QW, bits);
      const qmax = 2 ** (bits - 1) - 1;
      const fp = row('fp', 120, QW, 'fp32 weights (32 bits each)');
      f.add(`Map these fp32 weights onto ${bits}-bit integers in ±${qmax}.`, [...fp, box('fp', 60, 280, 880, 80, `absmax = ${fmt(Math.max(...QW.map(Math.abs)))}`, { mono: true })], panel('Quantize', [['bits', bits]]));
      f.add(`scale = absmax / ${qmax} = ${q.scale.toFixed(4)}, and each weight becomes round(w / scale).`, [...fp, ...row(`int${bits}`, 320, q.q, `int${bits}`, 'write')], panel('Quantize', [['scale', q.scale.toFixed(4)]]));
      f.add('Multiplying back by the scale gives close, but not equal, weights.', [...fp, ...row(`int${bits}`, 320, q.q, `int${bits}`, 'write'), ...row('deq', 520, q.deq.map((v) => fmt(v)), 'dequantized', bits === 8 ? 'ok' : 'warn')], panel('Quantize', [['max error', q.maxErr.toFixed(4), bits === 8 ? 'ok' : 'warn'], ['mean error', q.meanErr.toFixed(4)]]));
      if (bits === 4) {
        const b = packInt4(q.q[0], q.q[1]);
        f.add(`Two int4 values share a byte: ${q.q[0]} and ${q.q[1]} pack into 0x${b.toString(16).padStart(2, '0')}.`, [...fp, ...row('int4', 320, q.q, 'int4', 'write'), box('pack', 60, 520, 880, 110, `byte 0x${b.toString(16).padStart(2, '0')} → unpack → ${unpackInt4(b).join(', ')}`, { mono: true, tone: 'ok' })], panel('Pack', [['bytes / weight', 0.5, 'ok']]));
      } else f.add('One byte per weight: 4× smaller than fp32, with error under half a step.', [...fp, ...row('int8', 320, q.q, 'int8', 'ok')], panel('Quantize', [['size', '¼ of fp32', 'ok']]));
    } else {
      const rows: [string, number][] = [['fp32', 32], ['bf16', 16], ['int8', 8], ['int4', 4]];
      const table = (hi: number) =>
        grid('mem', 280, 160, rows.map(([n, b]) => [n, `${weightGB(7, b)} GB`, b >= 16 ? 'baseline' : b === 8 ? '≈ same' : 'small drop']), { cw: 200, ch: 80, colLabels: ['format', '7B weights', 'quality'], tone: (r) => (r === hi ? 'current' : undefined) });
      f.add('Weights dominate memory, so bits per weight set what hardware a model needs.', table(0), panel('7B model', [['fp32', `${weightGB(7, 32)} GB`, 'warn']]));
      f.add('bf16 halves it with no quality loss, the default for serving.', table(1), panel('7B model', [['bf16', `${weightGB(7, 16)} GB`]]));
      f.add('int8 halves it again with almost no loss; int4 fits a laptop but costs some accuracy.', table(3), panel('7B model', [['int4', `${weightGB(7, 4)} GB`, 'ok']]));
      f.add('Decoding is memory-bound, so fewer bytes per weight also means faster tokens.', table(3), panel('Speed', [['int4 vs bf16', 'up to ~3× faster', 'ok']]));
    }
    return f.frames;
  },
});
