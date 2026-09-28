// 'ratelimit' algorithm demos: token bucket, leaky bucket, fixed vs sliding window.
import { registerDemo, type Shape, type Tone } from './frames';
import { frame, text } from './lib/draw';

const GROUP = 'Rate limit';

const s1 = (t: number) => `${+t.toFixed(2)}s`;

const X0 = 90, X1 = 910;

/** Time axis from X0 to X1 with a left title and optional coloured legend words on the right. */
function axis(prefix: string, y: number, horizon: number, title: string, legend: [string, Tone][] = [], titleDy = 150): Shape[] {
  const out: Shape[] = [
    { t: 'line', id: `${prefix}:axis`, x1: X0, y1: y, x2: X1, y2: y, tone: 'muted', width: 3 },
    text(`${prefix}:title`, X0, y - titleDy, title, { size: 30, bold: true, align: 'left' }),
  ];
  let lx = X1;
  for (let i = legend.length - 1; i >= 0; i--) {
    out.push(text(`${prefix}:lg${i}`, lx, y - titleDy, legend[i][0], { size: 26, tone: legend[i][1], align: 'right', bold: true }));
    lx -= legend[i][0].length * 15 + 30;
  }
  for (let s = 0; s <= horizon; s++) {
    const x = X0 + (s / horizon) * (X1 - X0);
    out.push({ t: 'line', id: `${prefix}:tick${s}`, x1: x, y1: y - 10, x2: x, y2: y + 10, tone: 'muted' });
    out.push(text(`${prefix}:tl${s}`, x, y + 70, `${s}s`, { align: 'center', size: 24, tone: 'default' }));
  }
  return out;
}

const tx = (t: number, horizon: number) => X0 + (Math.min(t, horizon) / horizon) * (X1 - X0);

/** Dots on a lane; close neighbours stack away from the axis so bursts stay readable. */
function laneDots(items: { id: string; t: number; tone: Tone; hot: boolean }[], horizon: number, y: number, dir: 1 | -1): Shape[] {
  const placed: { x: number; level: number }[] = [];
  return items.map(it => {
    const x = tx(it.t, horizon);
    let level = 0;
    while (placed.some(p => p.level === level && Math.abs(p.x - x) < 24)) level++;
    placed.push({ x, level });
    return { t: 'dot', id: it.id, x, y: y + dir * (32 + level * 26), r: it.hot ? 17 : 10, tone: it.tone } as Shape;
  });
}

// ---------------- token bucket ----------------

interface TokenInput {
  cap: number;
  rate: number;
  times: number[];
  horizon: number;
}

registerDemo({
  slug: 'token-bucket',
  title: 'Token bucket',
  group: GROUP,
  summary: 'Tokens refill at a steady rate up to a cap; each request spends one. Allows bursts up to the cap, then the refill rate.',
  linkedFrom: ['Rate limit'],
  editable: 'none',
  inputs: [
    { id: 'burst', label: 'Burst then steady', data: { cap: 5, rate: 1, times: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 1.5, 2, 2.2, 2.4, 3.5, 4.2], horizon: 5 } satisfies TokenInput },
    { id: 'steady', label: 'Steady 2 req/s', data: { cap: 5, rate: 1, times: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5], horizon: 5 } satisfies TokenInput },
    { id: 'big', label: 'Bigger bucket (cap 8)', data: { cap: 8, rate: 1, times: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 3, 3.1], horizon: 5 } satisfies TokenInput },
  ],
  *run(raw) {
    const inp = raw as TokenInput;
    let tokens = inp.cap;
    let last = 0;
    let admitted = 0, rejected = 0;
    const results: { t: number; ok: boolean }[] = [];
    const draw = (curIdx = -1): Shape[] => {
      const H = 380, fillH = (tokens / inp.cap) * H;
      const out: Shape[] = [
        text('rate', 500, 50, `+${inp.rate} token/s · cap ${inp.cap}`, { align: 'center', size: 30, tone: 'accent' }),
        { t: 'rect', id: 'bucket', x: 330, y: 90, w: 340, h: H, tone: 'default', radius: 14 },
        { t: 'rect', id: 'fill', x: 336, y: 90 + H - fillH + 2, w: 328, h: Math.max(0, fillH - 8), tone: tokens < 1 ? 'warn' : 'accent', filled: true, radius: 10 },
        text('tok', 500, 280, `${tokens.toFixed(1)} / ${inp.cap}`, { align: 'center', size: 56, bold: true, mono: true }),
        ...axis('tl', 790, inp.horizon, 'Requests', [['admitted', 'ok'], ['rejected', 'fail']]),
      ];
      const pick = (ok: boolean) => results.map((r, i) => ({ r, i })).filter(x => x.r.ok === ok).map(({ r, i }) => ({ id: `rq${i}`, t: r.t, tone: (ok ? 'ok' : 'fail') as Tone, hot: i === curIdx }));
      out.push(...laneDots(pick(true), inp.horizon, 790, -1), ...laneDots(pick(false), inp.horizon, 790, 1));
      return out;
    };
    const panel = () => ({
      title: 'Bucket',
      rows: [
        { label: 'tokens', value: tokens.toFixed(2) },
        { label: 'admitted', value: String(admitted), tone: 'ok' as Tone },
        { label: 'rejected', value: String(rejected), tone: 'fail' as Tone },
      ],
    });
    yield frame(`Bucket starts full with ${inp.cap} tokens and refills ${inp.rate}/s. Each request needs 1 token.`, draw(), panel());
    for (const t of inp.times) {
      tokens = Math.min(inp.cap, tokens + (t - last) * inp.rate);
      last = t;
      let note: string;
      if (tokens >= 1) {
        const had = tokens;
        tokens -= 1;
        admitted++;
        results.push({ t, ok: true });
        note = `t=${s1(t)}: ${had.toFixed(1)} tokens → take 1, admit (${tokens.toFixed(1)} left).`;
      } else {
        rejected++;
        results.push({ t, ok: false });
        note = `t=${s1(t)}: only ${tokens.toFixed(1)} tokens (< 1) → reject with 429. Next token in ${((1 - tokens) / inp.rate).toFixed(1)}s.`;
      }
      yield frame(note, draw(results.length - 1), panel());
    }
    yield frame(`${admitted} admitted, ${rejected} rejected. Bursts up to ${inp.cap} pass instantly; sustained load is capped at ${inp.rate}/s.`, draw(), panel(), true);
  },
});

// ---------------- leaky bucket ----------------

interface LeakyInput {
  cap: number;
  leakMs: number;
  times: number[];
  horizon: number;
}

registerDemo({
  slug: 'leaky-bucket',
  title: 'Leaky bucket',
  group: GROUP,
  summary: 'Requests queue in a bounded bucket that drains at a fixed rate: smooth output, overflow is dropped.',
  linkedFrom: ['Rate limit'],
  editable: 'none',
  inputs: [
    { id: 'burst', label: 'Burst', data: { cap: 4, leakMs: 500, times: [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 1.2, 1.3, 2.6, 2.7, 2.8], horizon: 4 } satisfies LeakyInput },
    { id: 'steady', label: 'Steady 2 req/s', data: { cap: 4, leakMs: 500, times: [0.1, 0.6, 1.1, 1.6, 2.1, 2.6], horizon: 4 } satisfies LeakyInput },
  ],
  *run(raw) {
    const inp = raw as LeakyInput;
    const leak = inp.leakMs / 1000;
    const queue: number[] = [];
    const arrivals: { t: number; ok: boolean; i: number }[] = [];
    const outs: { t: number; i: number }[] = [];
    let dropped = 0;
    const draw = (hi = -1): Shape[] => {
      const out: Shape[] = [
        text('q:title', X0, 50, `Queue · cap ${inp.cap}`, { size: 30, bold: true, align: 'left' }),
        text('q:rate', X1, 50, `drains 1 per ${inp.leakMs}ms`, { size: 26, align: 'right', tone: 'protocol' }),
      ];
      const slotW = 150, gap = 22, qx = 90;
      for (let s = 0; s < inp.cap; s++) out.push({ t: 'rect', id: `slot${s}`, x: qx + s * (slotW + gap), y: 100, w: slotW, h: 120, tone: 'muted', dashed: true, radius: 12 });
      queue.forEach((r, s) => out.push({ t: 'node', id: `q:r${r}`, x: qx + slotW / 2 + s * (slotW + gap), y: 160, shape: 'rect', w: slotW - 20, h: 96, label: `r${r + 1}`, tone: r === hi ? 'current' : 'accent' }));
      const qEnd = qx + inp.cap * (slotW + gap);
      out.push({ t: 'line', id: 'drain', x1: qEnd, y1: 160, x2: Math.min(970, qEnd + 110), y2: 160, arrow: true, tone: 'protocol', width: 5 });
      out.push(...axis('in', 520, inp.horizon, 'Arrivals', [['queued', 'ok'], ['dropped', 'fail']]), ...axis('out', 850, inp.horizon, 'Processed', [['steady rate', 'accent']]));
      out.push(...laneDots(arrivals.filter(a => a.ok).map(a => ({ id: `in:r${a.i}`, t: a.t, tone: 'ok' as Tone, hot: a.i === hi })), inp.horizon, 520, -1));
      out.push(...laneDots(arrivals.filter(a => !a.ok).map(a => ({ id: `in:r${a.i}`, t: a.t, tone: 'fail' as Tone, hot: a.i === hi })), inp.horizon, 520, 1));
      out.push(...laneDots(outs.map(o => ({ id: `out:r${o.i}`, t: o.t, tone: 'accent' as Tone, hot: o.i === hi })), inp.horizon, 850, -1));
      return out;
    };
    const panel = () => ({
      title: 'Leaky bucket',
      rows: [
        { label: 'queued', value: `${queue.length} / ${inp.cap}` },
        { label: 'processed', value: String(outs.length), tone: 'accent' as Tone },
        { label: 'dropped', value: String(dropped), tone: 'fail' as Tone },
      ],
    });
    yield frame(`Requests wait in a queue of ${inp.cap}. It drains one every ${inp.leakMs}ms (${(1 / leak).toFixed(0)}/s), however bursty the input.`, draw(), panel());

    const events: { t: number; kind: 'arrive' | 'leak'; i: number }[] = inp.times.map((t, i) => ({ t, kind: 'arrive' as const, i }));
    for (let t = leak; t <= inp.horizon + 1e-9; t += leak) events.push({ t: +t.toFixed(3), kind: 'leak', i: -1 });
    events.sort((a, b) => a.t - b.t || (a.kind === 'leak' ? -1 : 1));
    for (const ev of events) {
      if (ev.kind === 'leak') {
        if (!queue.length) continue;
        const r = queue.shift()!;
        outs.push({ t: ev.t, i: r });
        yield frame(`t=${s1(ev.t)}: leak processes r${r + 1}. Queue ${queue.length}/${inp.cap}.`, draw(r), panel());
      } else if (queue.length < inp.cap) {
        queue.push(ev.i);
        arrivals.push({ t: ev.t, ok: true, i: ev.i });
        yield frame(`t=${s1(ev.t)}: r${ev.i + 1} arrives, queue ${queue.length}/${inp.cap} → enqueue. It waits for the next leak tick.`, draw(ev.i), panel());
      } else {
        dropped++;
        arrivals.push({ t: ev.t, ok: false, i: ev.i });
        yield frame(`t=${s1(ev.t)}: r${ev.i + 1} arrives but queue is full ${inp.cap}/${inp.cap} → drop.`, draw(ev.i), panel());
      }
    }
    yield frame(`${outs.length} processed at a steady ${(1 / leak).toFixed(0)}/s, ${dropped} dropped${queue.length ? `, ${queue.length} still queued` : ''}. Output never bursts.`, draw(), panel(), true);
  },
});

// ---------------- fixed vs sliding window ----------------

interface WindowInput {
  mode: 'log' | 'counter';
  limit: number;
  times: number[];
  horizon: number;
}

registerDemo({
  slug: 'sliding-window',
  title: 'Fixed vs sliding window',
  group: GROUP,
  summary: 'Fixed windows reset on the boundary and can admit 2× the limit across it; a sliding window counts the last second exactly.',
  linkedFrom: ['Rate limit'],
  editable: 'none',
  inputs: [
    { id: 'boundary', label: 'Boundary burst', data: { mode: 'log', limit: 5, times: [0.8, 0.84, 0.88, 0.92, 0.96, 1.0, 1.04, 1.08, 1.12, 1.16, 1.5, 1.9], horizon: 2 } satisfies WindowInput },
    { id: 'counter', label: 'Sliding counter', data: { mode: 'counter', limit: 5, times: [0.8, 0.84, 0.88, 0.92, 0.96, 1.0, 1.04, 1.08, 1.12, 1.16, 1.5, 1.9], horizon: 2 } satisfies WindowInput },
    { id: 'steady', label: 'Steady', data: { mode: 'log', limit: 5, times: [0.1, 0.35, 0.6, 0.85, 1.1, 1.35, 1.6, 1.85], horizon: 2 } satisfies WindowInput },
  ],
  *run(raw) {
    const inp = raw as WindowInput;
    const H = inp.horizon;
    const L = inp.limit;
    const fixedCount = new Map<number, number>();
    const fixedOk: number[] = [];
    const slideOk: number[] = [];
    const slideCount = new Map<number, number>();
    const res: { t: number; f: boolean; s: boolean }[] = [];
    const slideName = inp.mode === 'log' ? 'Sliding log' : 'Sliding counter';
    let cur = -1;

    const FY = 400, SY = 850;
    const draw = (): Shape[] => {
      const lg: [string, Tone][] = [['admit', 'ok'], ['reject', 'fail']];
      const out: Shape[] = [...axis('fx', FY, H, `Fixed window · ${L}/s`, lg, 240), ...axis('sl', SY, H, `${slideName} · ${L}/s`, lg, 240)];
      const span = (X1 - X0) / H;
      for (let w = 0; w < H; w++) {
        const c = fixedCount.get(w) ?? 0;
        out.push({ t: 'rect', id: `fw${w}`, x: tx(w, H) + 6, y: FY - 170, w: span - 12, h: 70, tone: c >= L ? 'warn' : 'muted', dashed: true, label: `${c} / ${L}`, radius: 10 });
      }
      if (cur >= 0) {
        const t = res[cur].t;
        const x0 = tx(Math.max(0, t - 1), H);
        const inWin = res.filter((r, i) => i <= cur && r.s && r.t > t - 1 + 1e-9).length;
        const sw = Math.max(4, tx(t, H) - x0);
        out.push({ t: 'rect', id: 'sw', x: x0, y: SY - 170, w: sw, h: 70, tone: 'accent', dashed: true, label: sw > 180 ? `${inWin} in last 1s` : String(inWin), radius: 10 });
      }
      const dots = (pre: string, key: 'f' | 's', y: number, ok: boolean) =>
        laneDots(res.map((r, i) => ({ r, i })).filter(x => x.r[key] === ok).map(({ r, i }) => ({ id: `${pre}${i}`, t: r.t, tone: (ok ? 'ok' : 'fail') as Tone, hot: i === cur })), H, y, ok ? -1 : 1);
      out.push(...dots('f', 'f', FY, true), ...dots('f', 'f', FY, false), ...dots('s', 's', SY, true), ...dots('s', 's', SY, false));
      return out;
    };
    const panel = () => ({
      title: 'Admitted',
      rows: [
        { label: 'fixed', value: `${fixedOk.length} / ${res.length}`, tone: 'ok' as Tone },
        { label: inp.mode === 'log' ? 'sliding log' : 'sliding counter', value: `${slideOk.length} / ${res.length}`, tone: 'ok' as Tone },
      ],
    });
    yield frame(`Limit ${L} requests per second. Top: counters reset each second; bottom: ${inp.mode === 'log' ? 'count admitted requests in the last 1s' : 'a weighted estimate from this and the previous window'}.`, draw(), panel());

    for (const t of inp.times) {
      const w = Math.floor(t + 1e-9);
      const fc = fixedCount.get(w) ?? 0;
      const f = fc < L;
      if (f) {
        fixedCount.set(w, fc + 1);
        fixedOk.push(t);
      }
      let s: boolean;
      let sTxt: string;
      if (inp.mode === 'log') {
        const inWin = slideOk.filter(x => x > t - 1 + 1e-9).length;
        s = inWin < L;
        sTxt = `sliding (${s1(Math.max(0, t - 1))}, ${s1(t)}] has ${inWin} → ${s ? 'admit' : 'reject'}`;
      } else {
        const prev = slideCount.get(w - 1) ?? 0;
        const c = slideCount.get(w) ?? 0;
        const frac = t - w;
        const est = prev * (1 - frac) + c;
        s = est < L;
        sTxt = `counter ${prev}×${(1 - frac).toFixed(2)} + ${c} = ${est.toFixed(1)} → ${s ? 'admit' : 'reject'}`;
      }
      if (s) {
        slideOk.push(t);
        slideCount.set(w, (slideCount.get(w) ?? 0) + 1);
      }
      res.push({ t, f, s });
      cur = res.length - 1;
      yield frame(`t=${s1(t)}: fixed window [${w}s, ${w + 1}s) has ${fc} → ${f ? 'admit' : 'reject'}. ${sTxt.charAt(0).toUpperCase()}${sTxt.slice(1)}.`, draw(), panel());
    }
    // worst 1s span actually admitted by each
    const worst = (ok: number[]) => {
      let best = 0, span = 0;
      ok.forEach((t, i) => {
        const inWin = ok.filter(x => x >= t && x < t + 1);
        if (inWin.length > best) {
          best = inWin.length;
          span = inWin[inWin.length - 1] - t;
        }
      });
      return { best, span };
    };
    const wf = worst(fixedOk), ws = worst(slideOk);
    cur = -1;
    const note = wf.best > L
      ? `Fixed window let ${wf.best} through within ${wf.span.toFixed(2)}s, ${wf.best / L}× the limit. ${slideName} peaked at ${ws.best} in any 1s${ws.best > L ? ' (an estimate, O(1) memory)' : ''}.`
      : `Both stay within ${L}/s here: fixed peaked at ${wf.best}, sliding at ${ws.best} in any 1s.`;
    yield frame(note, draw(), panel(), true);
  },
});
