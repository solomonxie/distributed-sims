// Machine-level CPU models (group 'machine-cpu'): pipeline, caches, MESI, scheduling, interrupts, out-of-order.
import type { Frame, Shape, Tone } from '../algo/frames';
import { arrow, box, dot, Film, line, machineDemo, panel, text } from './lib/draw';
import { Cache, L1D, Mesi, mesi, missRate, pipeline, Sched, stageAt } from './lib/sims';
import type { Instr } from './lib/sims';

const G = 'machine-cpu';

// ---------------- 5-stage pipeline ----------------
const HAZARD: Instr[] = [
  { text: 'ADD r1,r2,r3', dst: 'r1', src: ['r2', 'r3'] },
  { text: 'SUB r4,r1,r5', dst: 'r4', src: ['r1', 'r5'] },
  { text: 'AND r6,r1,r7', dst: 'r6', src: ['r1', 'r7'] },
  { text: 'OR  r8,r9,r2', dst: 'r8', src: ['r9', 'r2'] },
];
const BRANCH: Instr[] = [
  { text: 'BEQ r1,r2,L' },
  { text: 'ADD r3,r4,r5' },
  { text: 'SUB r6,r3,r7' },
  { text: 'L: OR r8,r9,r1' },
  { text: 'XOR r2,r8,r4' },
];

const PX = 250;
const PY = 170;

function pipeShapes(prog: Instr[], sch: Sched[], now: number, cycles: number, flush: Map<number, number>, fwd: [number, number][]): Shape[] {
  const PW = Math.min(90, 730 / cycles);
  const PH = Math.min(130, 660 / prog.length);
  const out: Shape[] = [text('hdr', 20, PY - 50, 'cycle', { align: 'left', size: 28, tone: 'default' })];
  for (let c = 1; c <= cycles; c++) out.push(text(`cy${c}`, PX + (c - 1) * PW + PW / 2, PY - 50, String(c), { size: 28, tone: c === now ? 'current' : 'default', bold: c === now }));
  prog.forEach((ins, i) => {
    const y = PY + i * PH;
    const dead = flush.has(i) && now >= flush.get(i)!;
    out.push(text(`in${i}`, 20, y + PH / 2, ins.text, { align: 'left', size: 28, mono: true, tone: dead ? 'fail' : undefined }));
    for (let c = 1; c <= Math.min(now, cycles); c++) {
      const f = flush.get(i);
      if (f !== undefined && c >= f) {
        if (c === f) out.push(box(`p${i}-${c}`, PX + (c - 1) * PW + 3, y + 6, PW - 6, PH - 12, '×', { tone: 'fail' }));
        continue;
      }
      const s = stageAt(sch[i], c);
      if (!s) continue;
      const tone: Tone = s.stall ? 'warn' : c === now ? 'current' : s.st === 'WB' ? 'ok' : 'visited';
      out.push(box(`p${i}-${c}`, PX + (c - 1) * PW + 3, y + 6, PW - 6, PH - 12, s.stall ? '··' : s.st, { tone }));
    }
  });
  const ly = Math.min(960, PY + prog.length * PH + 60);
  out.push(text('lg0', 20, ly, 'this cycle', { align: 'left', size: 28, bold: true, tone: 'current' }));
  out.push(text('lg1', 200, ly, 'stall', { align: 'left', size: 28, bold: true, tone: 'warn' }));
  out.push(text('lg2', 300, ly, 'retired', { align: 'left', size: 28, bold: true, tone: 'ok' }));
  if (flush.size) out.push(text('lg3', 430, ly, 'flushed', { align: 'left', size: 28, bold: true, tone: 'fail' }));
  for (const [a, b] of fwd) {
    const c = sch[b].EX;
    if (now < c) continue;
    const xa = PX + (sch[a].EX - 1) * PW + PW / 2;
    const xb = PX + (c - 1) * PW + PW / 2;
    out.push(arrow(`fw${a}-${b}`, xa, PY + a * PH + PH - 8, xb, PY + b * PH + 12, 'protocol'));
  }
  return out;
}

machineDemo({
  slug: 'cpu-pipeline',
  title: '5-stage pipeline',
  group: G,
  summary: 'Fetch → decode → execute → memory → writeback; data hazards, stalls, forwarding, branch flush.',
  linkedFrom: ['CPU'],
  inputs: [
    { id: 'stall', label: 'Hazard: stall', data: { mode: 'stall' } },
    { id: 'forward', label: 'Hazard: forwarding', data: { mode: 'forward' } },
    { id: 'branch', label: 'Branch mispredict', data: { mode: 'branch' } },
  ],
  build({ mode }: { mode: 'stall' | 'forward' | 'branch' }) {
    const f = new Film();
    const branch = mode === 'branch';
    const prog = branch ? BRANCH : HAZARD;
    let sch: Sched[];
    const flush = new Map<number, number>();
    const fwd: [number, number][] = [];
    if (branch) {
      sch = prog.map((_, i) => ({ IF: i + 1, ID: i + 2, EX: i + 3, MEM: i + 4, WB: i + 5 }));
      flush.set(1, 4);
      flush.set(2, 4);
    } else {
      sch = pipeline(prog, mode === 'forward');
      if (mode === 'forward') fwd.push([0, 1], [0, 2]);
    }
    const cycles = Math.max(...sch.filter((_, i) => !flush.has(i)).map((s) => s.WB));
    const ideal = prog.length - flush.size + 4;
    const bubbles = (c: number) => {
      let n = 0;
      sch.forEach((s, i) => {
        if (flush.has(i)) return;
        for (let k = 1; k <= c; k++) if (stageAt(s, k)?.stall) n++;
      });
      return n;
    };
    const retired = (c: number) => sch.filter((s, i) => !flush.has(i) && s.WB <= c).length;
    const pn = (c: number) =>
      panel('Pipeline', [
        ['cycle', `${c} / ${cycles}`],
        ['retired', retired(c)],
        ['stall slots', bubbles(c), bubbles(c) ? 'warn' : undefined],
        ['flushed', c >= 4 ? flush.size : 0, flush.size && c >= 4 ? 'fail' : undefined],
        ['forwarding', mode === 'forward' ? 'on' : branch ? 'on' : 'off'],
        ['CPI', retired(c) ? (c / retired(c)).toFixed(2) : '—'],
      ]);
    const intro =
      mode === 'branch'
        ? 'BEQ is predicted not-taken, so the CPU keeps fetching the next lines. The branch resolves in EX (cycle 3).'
        : mode === 'stall'
          ? 'SUB and AND read r1, which ADD only writes back in cycle 5. No forwarding: they must wait.'
          : 'Same code, but EX results are forwarded straight to the next instruction. r1 is usable one cycle later.';
    f.add(intro, pipeShapes(prog, sch, 0, cycles, flush, fwd), pn(0));
    for (let c = 1; c <= cycles; c++) {
      let note = `Cycle ${c}: each stage works on a different instruction in parallel.`;
      if (branch) {
        if (c === 3) note = 'Cycle 3: BEQ resolves in EX — taken! The 2 instructions fetched after it are on the wrong path.';
        else if (c === 4) note = 'Cycle 4: flush ADD and SUB, fetch from L. 2 cycles lost; a 20-stage real core loses ~15–20.';
        else if (c === cycles) note = `Done in ${cycles} cycles for 3 useful instructions. Predictors are ~95%+ right, so flushes are rare but costly.`;
      } else if (mode === 'stall') {
        if (c === 4 || c === 5) note = `Cycle ${c}: SUB stalls in ID (bubble) — r1 is not in the register file yet. AND stalls behind it in IF.`;
        else if (c === 6) note = 'Cycle 6: ADD wrote r1 in cycle 5, so SUB finally executes. 2 cycles lost.';
        else if (c === cycles) note = `Done: ${cycles} cycles vs ${ideal} ideal. Every dependent pair costs 2 bubbles without forwarding.`;
      } else {
        if (c === 4) note = "Cycle 4: ADD's result goes EX→EX via a bypass wire. SUB executes with no bubble.";
        else if (c === 5) note = 'Cycle 5: AND gets r1 forwarded from the MEM stage. Still no stall.';
        else if (c === cycles) note = `Done: ${cycles} cycles = ideal (4 stages fill + 1/instr). CPI → 1.0 on long runs.`;
      }
      if (c === 1) note = 'Cycle 1: fetch the first instruction. A new one enters every cycle when nothing blocks.';
      f.add(note, pipeShapes(prog, sch, c, cycles, flush, fwd), pn(c));
    }
    return f.frames;
  },
});

// ---------------- cache hierarchy ----------------
const LEVELS = [
  { id: 'L1', cyc: 4, ns: '~1ns', size: '32 KB' },
  { id: 'L2', cyc: 14, ns: '~4ns', size: '1 MB' },
  { id: 'L3', cyc: 50, ns: '~12ns', size: '32 MB' },
  { id: 'DRAM', cyc: 400, ns: '~100ns', size: '64 GB' },
];

function ladder(hit: number | null, at: number, have: boolean[][]): Shape[] {
  const out: Shape[] = [box('core', 330, 30, 340, 110, 'Core', { sub: '4 GHz · 1 cycle = 0.25ns', tone: 'accent' })];
  LEVELS.forEach((l, i) => {
    const y = 190 + i * 190;
    const tone: Tone = i === at ? (hit === i ? 'ok' : i < at || hit === null ? 'fail' : 'current') : i < at ? 'fail' : 'default';
    out.push(box(`lv${i}`, 250, y, 500, 130, `${l.id}  ${l.size}`, { sub: `${l.cyc} cycles · ${l.ns}`, tone: i === at && hit === i ? 'ok' : tone }));
    out.push(line(`lk${i}`, 500, y - 50, 500, y, 'muted'));
    have[i].forEach((h, k) => out.push(box(`ln${i}-${k}`, 790 + k * 60, y + 35, 50, 60, undefined, { tone: h ? 'read' : 'muted', filled: h })));
  });
  if (at >= 0) out.push(dot('req', 210, 190 + at * 190 + 65, hit === at ? 'ok' : 'current', 'ld'));
  return out;
}

function cacheWalk(): Frame[] {
  const f = new Film();
  // lines present per level: [A-line, B-line]
  const have = [
    [false, false],
    [false, true],
    [false, true],
    [true, true],
  ];
  const pn = (load: string, cyc: number, res: string, tone?: Tone) => panel('Load', [['address', load], ['line', '64 B'], ['cycles so far', cyc], ['time', `${(cyc / 4).toFixed(1)} ns`], ['result', res, tone]]);
  f.add('A load of 0x1F40 leaves the core. Caches move whole 64-byte lines, never single bytes.', ladder(null, -1, have), pn('0x1F40', 0, '—'));
  let cyc = 0;
  for (let i = 0; i < 4; i++) {
    cyc += LEVELS[i].cyc;
    const hit = i === 3;
    f.add(
      hit ? `DRAM answers after ~400 cycles (~100ns). The 64B line is copied into L3, L2 and L1 on the way back.` : `${LEVELS[i].id} miss: ${LEVELS[i].cyc} cycles spent just to learn the line isn't there.`,
      ladder(hit ? 3 : null, i, have),
      pn('0x1F40', cyc, hit ? 'DRAM (miss ×3)' : `${LEVELS[i].id} miss`, hit ? 'fail' : 'warn'),
    );
  }
  have[0][0] = have[1][0] = have[2][0] = true;
  f.add('Next load 0x1F48 is 8 bytes later — same line. L1 hit: 4 cycles (~1ns), 100× faster.', ladder(0, 0, have), pn('0x1F48', 4, 'L1 hit', 'ok'));
  f.add('Load 0x8000: evicted from the tiny L1 earlier, still in L2. L1 miss + L2 hit = 18 cycles (~4.5ns).', ladder(1, 1, have), pn('0x8000', 18, 'L2 hit', 'ok'));
  f.add('Rule of thumb: L1 1ns · L2 4ns · L3 12ns · DRAM 100ns. Code that reuses lines stays near the top.', ladder(1, 1, have), pn('0x8000', 18, 'L2 hit', 'ok'));
  return f.frames;
}

const GR = 8;
const GC = 16;

function gridShapes(state: Map<string, Tone>, slots: (number | null)[], cur: [number, number] | null, orderLabel: string): Shape[] {
  const out: Shape[] = [
    text('ttl', 30, 70, `int a[8][16] · ${orderLabel}`, { align: 'left', size: 32, bold: true }),
    text('ttl2', 30, 120, 'each row = 64 B = one cache line', { align: 'left', size: 26, tone: 'muted' }),
    text('cttl', 830, 190, 'cache (4 lines)', { size: 26, tone: 'muted' }),
  ];
  for (let r = 0; r < GR; r++)
    for (let c = 0; c < GC; c++) {
      const k = `${r}-${c}`;
      const cur2 = cur && cur[0] === r && cur[1] === c;
      out.push(box(`g${k}`, 30 + c * 38, 210 + r * 56, 34, 50, undefined, { tone: cur2 ? 'current' : state.get(k) ?? 'muted', filled: true }));
    }
  slots.forEach((s, i) => out.push(box(`slot${i}`, 700, 220 + i * 110, 260, 90, s === null ? 'empty' : `row ${s}`, { tone: s === null ? 'muted' : 'read', mono: true })));
  return out;
}

function traversalDemo(order: 'row' | 'col') {
  const f = new Film();
  const cache = new Cache({ lineBytes: 64, sets: 1, ways: 4 });
  const state = new Map<string, Tone>();
  let hits = 0;
  let miss = 0;
  const real = missRate(order, 512, L1D);
  const label = order === 'row' ? 'row-major a[i][j]' : 'column-major a[j][i]';
  const slots = (): (number | null)[] => {
    const ls = cache.lines();
    return [0, 1, 2, 3].map((i) => (ls[i] === undefined ? null : ls[i]));
  };
  const pn = () =>
    panel('Misses', [
      ['accesses', hits + miss],
      ['hits', hits, 'ok'],
      ['misses', miss, miss ? 'fail' : undefined],
      ['miss rate', hits + miss ? `${Math.round((miss / (hits + miss)) * 100)}%` : '—'],
      ['512×512, 32KB L1', `${(real * 100).toFixed(1)}%`],
    ]);
  f.add(
    order === 'row' ? 'Walk the array row by row, the way C lays it out. Each miss brings in 16 ints at once.' : 'Walk column by column: each step jumps 64 B to the next row, a new line every time.',
    gridShapes(state, slots(), null, label),
    pn(),
  );
  const seq: [number, number][] = [];
  for (let a = 0; a < GR * GC; a++) seq.push(order === 'row' ? [Math.floor(a / GC), a % GC] : [a % GR, Math.floor(a / GR)]);
  const perStep = order === 'row' ? 5 : 3;
  let step = 0;
  seq.forEach(([r, c], idx) => {
    const hit = cache.access((r * GC + c) * 4);
    hit ? hits++ : miss++;
    state.set(`${r}-${c}`, hit ? 'ok' : 'fail');
    const groupEnd = order === 'row' ? c === GC - 1 : r === GR - 1;
    if (step < perStep || groupEnd) {
      let note: string;
      if (step < perStep) note = hit ? `a[${r}][${c}]: L1 hit (4 cycles) — the line for row ${r} is already cached.` : `a[${r}][${c}]: miss — fetch row ${r}'s 64 B line${cache.lines().length >= 4 && order === 'col' && idx >= 4 ? ', evicting the oldest line' : ''}.`;
      else note = order === 'row' ? `Row ${r} done: 1 miss + 15 hits. Miss rate stays at 1/16 ≈ 6%.` : `Column ${c} done: 8 misses. By the time we return to row 0, its line was evicted.`;
      f.add(note, gridShapes(state, slots(), [r, c], label), pn());
    }
    step++;
  });
  const avg = order === 'row' ? 0.9375 * 4 + 0.0625 * 200 : 200;
  f.add(
    order === 'row'
      ? `Final: ${(real * 100).toFixed(2)}% misses on a real 512×512 array (~${avg.toFixed(0)} cycles/access). Prefetchers make it even faster.`
      : `Final: ${(real * 100).toFixed(0)}% misses on a real 512×512 array (~200 cycles/access). Same work, ~12× slower than row-major.`,
    gridShapes(state, slots(), null, label),
    pn(),
  );
  return f.frames;
}

machineDemo({
  slug: 'cpu-cache',
  title: 'Cache hierarchy',
  group: G,
  summary: 'L1/L2/L3/DRAM hits and misses with cycle costs; 64B lines; row- vs column-major traversal.',
  linkedFrom: ['CPU', 'Memory'],
  inputs: [
    { id: 'walk', label: 'Load walk', data: { mode: 'walk' } },
    { id: 'row', label: 'Row-major loop', data: { mode: 'row' } },
    { id: 'col', label: 'Column-major loop', data: { mode: 'col' } },
  ],
  build({ mode }: { mode: 'walk' | 'row' | 'col' }) {
    return mode === 'walk' ? cacheWalk() : traversalDemo(mode);
  },
});

// ---------------- MESI coherence ----------------
type Op = { core: number; line: number; op: 'read' | 'write'; what: string };

function mesiShapes(cores: number, lines: string[], st: Mesi[][], op: Op | null, bus: string): Shape[] {
  const w = cores === 4 ? 210 : 300;
  const gap = (1000 - cores * w) / (cores + 1);
  const toneOf: Record<Mesi, Tone> = { M: 'write', E: 'ok', S: 'read', I: 'muted' };
  const out: Shape[] = [];
  for (let c = 0; c < cores; c++) {
    const x = gap + c * (w + gap);
    out.push(box(`core${c}`, x, 60, w, 90, `core ${c}`, { tone: op?.core === c ? 'current' : 'default' }));
    lines.forEach((ln, li) => {
      const s = st[li][c];
      out.push(box(`st${c}-${li}`, x + 10, 170 + li * 130, w - 20, 110, s, { sub: ln, tone: toneOf[s] }));
    });
    out.push(line(`bl${c}`, x + w / 2, 170 + lines.length * 130, x + w / 2, 520, 'muted'));
  }
  out.push(line('bus', 40, 520, 960, 520, bus && bus[0] !== '—' ? 'protocol' : 'muted', { width: 8 }));
  out.push(text('busl', 40, 575, bus && bus[0] !== '—' ? `bus: ${bus}` : 'bus idle', { size: 30, align: 'left', tone: bus && bus[0] !== '—' ? 'protocol' : 'default' }));
  out.push(box('mem', 300, 640, 400, 110, 'L3 / memory', { sub: 'line home', tone: 'default' }));
  out.push(line('meml', 500, 520, 500, 640, 'muted'));
  (['M modified', 'E exclusive', 'S shared', 'I invalid'] as const).forEach((l, i) =>
    out.push(text(`lg${i}`, 40 + i * 240, 830, l, { size: 28, bold: true, align: 'left', tone: toneOf[l[0] as Mesi] === 'muted' ? 'default' : toneOf[l[0] as Mesi] })),
  );
  if (op) out.push(text('opl', 500, 900, `core ${op.core} ${op.op}s ${op.what}`, { size: 34, bold: true, tone: op.op === 'write' ? 'write' : 'read' }));
  return out;
}

machineDemo({
  slug: 'cpu-mesi',
  title: 'Cache coherence (MESI)',
  group: G,
  summary: 'MESI states across cores; invalidations; false sharing ping-pong on one 64B line.',
  linkedFrom: ['CPU'],
  inputs: [
    { id: 'basic', label: '4 cores share a line', data: { mode: 'basic' } },
    { id: 'false', label: 'False sharing', data: { mode: 'false' } },
    { id: 'padded', label: 'Padded (fixed)', data: { mode: 'padded' } },
  ],
  build({ mode }: { mode: 'basic' | 'false' | 'padded' }) {
    const f = new Film();
    const cores = mode === 'basic' ? 4 : 2;
    const lines = mode === 'padded' ? ['line A: x', 'line B: y'] : mode === 'false' ? ['line A: x | y'] : ['line A: cfg'];
    let st: Mesi[][] = lines.map(() => Array(cores).fill('I'));
    const ops: Op[] =
      mode === 'basic'
        ? [
            { core: 0, line: 0, op: 'read', what: 'cfg' },
            { core: 1, line: 0, op: 'read', what: 'cfg' },
            { core: 2, line: 0, op: 'read', what: 'cfg' },
            { core: 0, line: 0, op: 'write', what: 'cfg' },
            { core: 1, line: 0, op: 'read', what: 'cfg' },
            { core: 3, line: 0, op: 'write', what: 'cfg' },
          ]
        : [0, 1, 0, 1, 0, 1].map((c) => ({ core: c, line: mode === 'padded' ? c : 0, op: 'write' as const, what: c ? 'y++' : 'x++' }));
    let traffic = 0;
    let ns = 0;
    const pn = () =>
      panel('Coherence', [
        ...lines.map((l, li) => [l.split(':')[0], st[li].join(' ')] as [string, string]),
        ['bus transactions', traffic, traffic > 3 ? 'warn' : undefined],
        ['time on line', `${ns} ns`],
      ]);
    f.add(
      mode === 'basic'
        ? 'One 64B line, 4 cores, all Invalid. MESI keeps every private cache consistent by snooping a shared bus.'
        : mode === 'false'
          ? 'x and y are different variables but sit in the same 64B line. Core 0 bumps x, core 1 bumps y.'
          : 'Same counters, padded to 64 B each so x and y live on different lines.',
      mesiShapes(cores, lines, st, null, ''),
      pn(),
    );
    ops.forEach((op, k) => {
      const before = st[op.line][op.core];
      const r = mesi(st[op.line], op.core, op.op);
      st = st.map((s, li) => (li === op.line ? r.states : s));
      if (!r.hit) traffic++;
      const cost = r.hit ? 1 : 50;
      ns += cost;
      let note: string;
      if (mode === 'false') note = k < 2 ? `Core ${op.core} writes: ${r.bus} steals the line, the other core → I. ~50ns instead of ~1ns.` : `Ping-pong again: ${r.bus}, ~50ns. Two "independent" counters now scale worse than one thread.`;
      else if (mode === 'padded') note = r.hit ? `Core ${op.core} hits its own line in M: ~1ns, no bus traffic.` : `Core ${op.core} first write: ${r.bus} → M (~50ns once). Nobody else wants this line.`;
      else if (op.op === 'read') note = r.hit ? 'Read hit, no bus traffic.' : `Core ${op.core} read miss → ${r.bus}. ${r.states[op.core] === 'E' ? 'No one else has it: Exclusive.' : `Now Shared${r.bus.includes('writeback') ? ' after the dirty copy is written back' : ''}.`}`;
      else note = `Core ${op.core} writes from ${before}: ${r.bus} invalidates every other copy. Only core ${op.core} holds it now (M).`;
      f.add(note, mesiShapes(cores, lines, st, op, r.bus), pn());
    });
    f.add(
      mode === 'false'
        ? `6 writes = ${traffic} coherence misses (~${ns}ns). Fix: pad hot per-thread data to 64 B with alignas(64) or @Contended.`
        : mode === 'padded'
          ? `6 writes = ${traffic} misses, ~${ns}ns total. Padding wastes 56 bytes and removes the ping-pong.`
          : `${traffic} bus transactions for 6 accesses. Writes to shared data are what cost; reads can be shared freely.`,
      mesiShapes(cores, lines, st, null, ''),
      pn(),
    );
    return f.frames;
  },
});

// ---------------- multicore scheduling ----------------
machineDemo({
  slug: 'cpu-scheduling',
  title: 'Multicore scheduling',
  group: G,
  summary: 'Run queue, time slices, context-switch cost, and what thread oversubscription does to latency.',
  linkedFrom: ['CPU'],
  inputs: [
    { id: 'fit', label: '4 threads · 4 cores', data: { threads: 4 } },
    { id: 'over', label: '12 threads · 4 cores', data: { threads: 12 } },
  ],
  build({ threads }: { threads: number }) {
    const f = new Film();
    const cores = 4;
    const need = 3; // slices of 4ms each
    const left = Array(threads).fill(need);
    const finish: number[] = Array(threads).fill(0);
    let queue = Array.from({ length: threads }, (_, i) => i);
    let running: (number | null)[] = Array(cores).fill(null);
    let t = 0;
    let switches = 0;
    const shapes = (): Shape[] => {
      const out: Shape[] = [text('cl', 30, 60, 'cores', { align: 'left', size: 28, tone: 'muted' })];
      running.forEach((th, c) => out.push(box(`core${c}`, 30 + c * 240, 90, 220, 170, `core ${c}`, { sub: th === null ? 'idle' : `T${th + 1}`, tone: th === null ? 'muted' : 'current' })));
      out.push(text('ql', 30, 330, `run queue (${queue.length})`, { align: 'left', size: 28, tone: queue.length > 4 ? 'warn' : 'muted' }));
      queue.forEach((th, i) => out.push(box(`q${th}`, 30 + (i % 8) * 118, 360 + Math.floor(i / 8) * 100, 105, 85, `T${th + 1}`, { tone: 'warn' })));
      out.push(text('dl', 30, 600, 'done', { align: 'left', size: 28, tone: 'muted' }));
      let d = 0;
      for (let i = 0; i < threads; i++) if (!left[i] && !running.includes(i)) out.push(box(`d${i}`, 30 + (d % 8) * 118, 630 + Math.floor(d++ / 8) * 100, 105, 85, `T${i + 1}`, { tone: 'ok', sub: `${finish[i]}ms` }));
      return out;
    };
    const pn = () =>
      panel('Scheduler', [
        ['time', `${t} ms`],
        ['slice', '4 ms'],
        ['run queue', queue.length, queue.length > cores ? 'warn' : undefined],
        ['ctx switches', switches],
        ['switch cost', '~3µs + cache refill'],
        ['done', `${finish.filter(Boolean).length} / ${threads}`],
      ]);
    f.add(`${threads} runnable threads, 4 cores, each thread needs 12ms of CPU. The scheduler hands out 4ms time slices.`, shapes(), pn());
    while (left.some((x) => x > 0)) {
      // dispatch
      running = running.map(() => {
        const th = queue.shift();
        if (th === undefined) return null;
        switches++;
        return th;
      });
      const busy = running.filter((x) => x !== null).length;
      f.add(
        queue.length
          ? `t=${t}ms: ${busy} threads run, ${queue.length} wait in the run queue. A waiting thread can't serve its request even though it's "ready".`
          : `t=${t}ms: every runnable thread has a core. No queueing delay.`,
        shapes(),
        pn(),
      );
      t += 4;
      running.forEach((th) => {
        if (th === null) return;
        left[th]--;
        if (!left[th]) finish[th] = t;
        else queue.push(th);
      });
      running = running.map(() => null);
    }
    const avg = finish.reduce((a, b) => a + b, 0) / threads;
    f.add(
      threads > cores
        ? `All done at ${t}ms; average finish ${avg.toFixed(0)}ms vs 12ms with ≤4 threads. ${switches} context switches (~3µs each, plus cold caches after).`
        : `All done at ${t}ms with ${switches} switches. Threads ≤ cores: latency = pure CPU time.`,
      shapes(),
      pn(),
    );
    return f.frames;
  },
});

// ---------------- interrupts & syscalls ----------------
function irqScene(active: string[], token: [number, number] | null, tok: Tone = 'current'): Shape[] {
  const on = (id: string): Tone => (active.includes(id) ? 'current' : 'default');
  const out: Shape[] = [
    box('user', 20, 40, 960, 260, undefined, { tone: 'muted', filled: false, dashed: true }),
    text('ul', 40, 80, 'user mode (ring 3)', { align: 'left', size: 26, tone: 'muted' }),
    box('app', 80, 120, 360, 140, 'app', { sub: 'read(fd, buf)', tone: on('app') }),
    box('libc', 560, 120, 360, 140, 'libc / epoll', { tone: on('libc') }),
    box('kern', 20, 330, 960, 330, undefined, { tone: 'muted', filled: false, dashed: true }),
    text('kl', 40, 370, 'kernel mode (ring 0)', { align: 'left', size: 26, tone: 'muted' }),
    box('entry', 60, 400, 260, 110, 'syscall entry', { tone: on('entry') }),
    box('sock', 370, 400, 260, 110, 'socket / VFS', { tone: on('sock') }),
    box('drv', 680, 400, 260, 110, 'NIC driver', { tone: on('drv') }),
    box('soft', 370, 530, 560, 100, 'softirq: TCP/IP stack', { tone: on('soft') }),
    box('cpu', 60, 720, 380, 200, 'CPU core', { sub: 'registers, mode bit', tone: on('cpu') }),
    box('nic', 560, 720, 380, 200, 'NIC', { sub: 'RX ring in RAM', tone: on('nic') }),
  ];
  if (token) {
    // sit at the left edge of the box it's in, clear of the centred label
    const host = out.find((b) => b.t === 'rect' && b.id !== 'user' && b.id !== 'kern' && token[0] > b.x && token[0] < b.x + b.w && token[1] > b.y && token[1] < b.y + b.h);
    const at = host && host.t === 'rect' ? { x: host.x + 26, y: host.y + 4 } : { x: token[0], y: token[1] };
    out.push(dot('tok', at.x, at.y, tok, undefined, 16));
  }
  return out;
}

machineDemo({
  slug: 'cpu-interrupts',
  title: 'Interrupts & syscalls',
  group: G,
  summary: 'User → kernel mode switch, NIC hard interrupt and softirq, and why syscalls cost.',
  linkedFrom: ['CPU', 'Host networking'],
  inputs: [
    { id: 'syscall', label: 'read() syscall', data: { mode: 'syscall' } },
    { id: 'irq', label: 'NIC interrupt', data: { mode: 'irq' } },
  ],
  build({ mode }: { mode: 'syscall' | 'irq' }) {
    const f = new Film();
    const pn = (mode_: string, ns: number, n: number) => panel('Core', [['mode', mode_, mode_ === 'kernel' ? 'protocol' : undefined], ['elapsed', ns >= 1000 ? `${(ns / 1000).toFixed(1)} µs` : `${ns} ns`], [mode === 'syscall' ? 'syscalls' : 'interrupts', n]]);
    if (mode === 'syscall') {
      f.add('The app calls read(fd) on a socket. It cannot touch hardware or kernel memory from user mode.', irqScene(['app'], [260, 190]), pn('user', 0, 0));
      f.add('libc puts the syscall number (0 = read) in rax and executes SYSCALL. The CPU flips to ring 0.', irqScene(['libc', 'cpu'], [740, 190]), pn('user', 20, 1));
      f.add('Kernel entry saves user registers and switches stacks. With Spectre/Meltdown mitigations this alone is ~100ns+.', irqScene(['entry', 'cpu'], [190, 455], 'protocol'), pn('kernel', 150, 1));
      f.add('The socket layer finds 1 KB waiting in the receive buffer and copies it to the user buffer.', irqScene(['sock'], [500, 455], 'protocol'), pn('kernel', 400, 1));
      f.add('SYSRET back to ring 3: ~0.5µs total. Cheap once, costly at 1M calls/s — hence batching, io_uring, epoll.', irqScene(['app'], [260, 190], 'ok'), pn('user', 500, 1));
    } else {
      f.add('A packet arrives. The NIC DMAs it into the RX ring in RAM without the CPU.', irqScene(['nic'], [750, 820], 'read'), pn('user', 0, 0));
      f.add('The NIC raises a hard interrupt (MSI-X). The core stops the app mid-instruction and jumps to the handler.', irqScene(['cpu', 'nic'], [250, 820], 'warn'), pn('kernel', 1000, 1));
      f.add('The driver handler is tiny: ack the NIC, mask its IRQ, schedule a softirq (NAPI). ~1µs.', irqScene(['drv'], [810, 455], 'protocol'), pn('kernel', 1500, 1));
      f.add('softirq polls the ring in batches of up to 64 packets and runs the TCP/IP stack. Busy NICs stop interrupting and just poll.', irqScene(['soft'], [650, 580], 'protocol'), pn('kernel', 5000, 1));
      f.add('Data lands in the socket buffer; epoll marks the fd ready and wakes the waiting thread.', irqScene(['sock', 'libc'], [500, 455], 'ok'), pn('kernel', 7000, 1));
      f.add('The app resumes where it was cut off. ~5–10µs of kernel work per burst; at 1M pkt/s a whole core goes to softirq.', irqScene(['app'], [260, 190], 'ok'), pn('user', 8000, 1));
    }
    return f.frames;
  },
});

// ---------------- out-of-order ----------------
const OOO = ['LD r1←[a]', 'ADD r2←r1+1', 'MUL r3←r4·r5', 'ADD r6←r7+r8', 'LD r9←[b]', 'SUB r10←r9−1'];

machineDemo({
  slug: 'cpu-ooo',
  title: 'Out-of-order execution',
  group: G,
  summary: 'Reorder buffer, issuing independent instructions around a stall, in-order retirement, IPC > 1.',
  linkedFrom: ['CPU'],
  inputs: [{ id: 'rob', label: 'Reorder buffer', data: {} }],
  build() {
    const f = new Film();
    // per-instr status per frame: q queued, x executing, d done, r retired, w waiting
    const scene = (st: string[], cyc: number, note: string, retired: number) => {
      const tone: Record<string, Tone> = { q: 'muted', w: 'warn', x: 'current', d: 'ok', r: 'visited' };
      const lab: Record<string, string> = { q: 'queued', w: 'waiting', x: 'executing', d: 'done', r: 'retired' };
      const sh: Shape[] = [text('rl', 30, 60, 'reorder buffer (oldest first)', { align: 'left', size: 28, tone: 'muted' })];
      OOO.forEach((ins, i) => {
        sh.push(box(`rob${i}`, 30, 90 + i * 125, 520, 105, ins, { tone: tone[st[i]], mono: true }));
        sh.push(text(`rs${i}`, 580, 90 + i * 125 + 55, lab[st[i]], { align: 'left', size: 30, tone: tone[st[i]] }));
      });
      sh.push(box('units', 790, 90, 180, 480, 'ALU×4 LD×2', { tone: 'default' }));
      sh.push(line('retl', 30, 870, 970, 870, 'muted'));
      sh.push(text('rt', 500, 930, `retired ${retired} / 6 · in program order`, { size: 30, tone: retired === 6 ? 'ok' : 'muted' }));
      f.add(note, sh, panel('Core', [['cycle', cyc], ['retired', retired], ['IPC', cyc ? (retired / cyc).toFixed(2) : '—'], ['ROB size', '~500 (modern)']]));
    };
    scene(['q', 'q', 'q', 'q', 'q', 'q'], 0, 'A 4-wide core decodes 6 instructions into the reorder buffer. Registers are renamed so only true dependencies remain.', 0);
    scene(['x', 'w', 'x', 'x', 'x', 'w'], 1, 'Cycle 1: LD r1 misses L1. An in-order core would freeze here; this one issues MUL, ADD and LD r9 anyway.', 0);
    scene(['x', 'w', 'd', 'd', 'x', 'w'], 3, 'Cycle 3: MUL and ADD r6 finish. They wait in the ROB — results stay invisible until older ones retire.', 0);
    scene(['x', 'w', 'd', 'd', 'd', 'x'], 5, 'Cycle 5: LD r9 hit L1 (4 cycles), so SUB runs. 4 of 6 done while the first load is still out.', 0);
    scene(['d', 'x', 'd', 'd', 'd', 'd'], 14, 'Cycle 14: LD r1 returns from L2 (~14 cycles). ADD r2 finally executes.', 0);
    scene(['r', 'r', 'r', 'r', 'r', 'r'], 15, 'Cycle 15: all 6 retire in order, up to 4 per cycle. In-order would take ~20 cycles.', 6);
    scene(['r', 'r', 'r', 'r', 'r', 'r'], 15, 'On cache-friendly code this overlap gives IPC 2–4. Branch mispredicts and DRAM misses (~400 cycles) drain it.', 6);
    return f.frames;
  },
});
