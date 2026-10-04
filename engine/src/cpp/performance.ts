// Performance (group cpp-performance): CPU cache tiers, locality and layout, false sharing, zero-copy I/O, avoiding user-space copies, measuring.
import type { Detail, Frame, Shape, Tone } from '../algo/frames';
import { box, Film, framesDemo, panel, text } from '../machine/lib/draw';
import type { Row } from '../machine/lib/draw';
import { boardFrames, N } from '../machine/lib/board';
import type { Board } from '../machine/lib/board';

const G = 'cpp-performance';
const B = (b: Board) => () => boardFrames(b);

const D: Record<string, Detail> = {
  Registers: { title: 'Registers', text: 'Named slots inside the core. The compiler keeps hot locals here; access is effectively free.', code: 'long sum = 0;           // usually a register\nfor (int i = 0; i < n; ++i) sum += a[i];' },
  'L1 cache': { title: 'L1 cache', text: 'Tiny and private to each core, split into instruction and data. A hit costs about 4 cycles.', code: '$ lscpu | grep L1d\nL1d cache: 32 KiB (per core)' },
  'L2 cache': { title: 'L2 cache', text: 'Larger, still private to a core on most CPUs. About 14 cycles.', code: '$ lscpu | grep L2' },
  'L3 cache': { title: 'L3 cache', text: 'Shared by all cores of a socket, and where cores see each other’s writes. About 50 cycles.', code: '$ lscpu | grep L3' },
  RAM: { title: 'Main memory', text: 'Gigabytes, but 80 ns or more away: around 300 cycles the core could have spent working.', code: '// a pointer-chasing loop over 1 GB runs at RAM latency\nfor (Node* n = head; n; n = n->next) sum += n->v;' },
  'cache line': { title: 'Cache line', text: 'The unit the hardware moves: 64 bytes on x86 and most ARM. Touching one byte loads its whole line.', code: 'std::hardware_destructive_interference_size  // C++17, usually 64' },
  'one cache line': { title: 'One cache line', text: 'Two variables within the same 64 bytes share one line. A write by either core invalidates the other core’s copy.', code: 'struct Counters {\n  std::atomic<long> a;  // offset 0\n  std::atomic<long> b;  // offset 8: same line\n};' },
  'line A': { title: 'Padded counter', text: 'alignas(64) places each counter at the start of its own line, so no other core ever needs it.', code: 'struct alignas(64) Padded {\n  std::atomic<long> v;\n};\nPadded counters[2];' },
  'page cache': { title: 'Page cache', text: 'The kernel keeps recently used file pages in RAM. Reads and sendfile both start here.', code: '$ free -h   # "buff/cache" column' },
  'socket buffer': { title: 'Socket send buffer', text: 'Kernel memory holding bytes (or references to pages) until the NIC has sent them.', code: 'setsockopt(fd, SOL_SOCKET, SO_SNDBUF, &n, sizeof n);' },
  'user buffer': { title: 'User buffer', text: 'Memory in your process. Crossing the user/kernel boundary means a syscall and, usually, a copy.', code: 'char buf[65536];\nssize_t n = read(fd, buf, sizeof buf);' },
  NIC: { title: 'Network card', text: 'Reads packets out of RAM by DMA, with no CPU involved. With scatter-gather it can gather one packet from several places.', code: '$ ethtool -k eth0 | grep scatter-gather' },
  disk: { title: 'Disk', text: 'Blocks reach RAM by DMA into the page cache; the CPU does not copy them.', code: '$ iostat -x 1' },
  'perf stat': { title: 'perf stat', text: 'Hardware counters for a whole run: cycles, instructions, cache and branch misses.', code: '$ perf stat -e cycles,instructions,cache-misses,branch-misses ./app' },
  'perf record': { title: 'perf record', text: 'Samples the program counter ~1000×/s, so hot code shows up in proportion to the time it takes.', code: '$ perf record -g ./app\n$ perf report\n$ perf script | stackcollapse-perf.pl | flamegraph.pl > f.svg' },
};

// ---------------- cache tiers: a request travels down, a 64 B line travels back up ----------------
type Tier = 'l1' | 'l2' | 'l3' | 'ram';
const TIER_BOX: Record<Tier, { x: number; y: number; w: number; h: number; slots: number; name: string; key: string; human: string }> = {
  l1: { x: 300, y: 150, w: 400, h: 120, slots: 8, name: 'L1 · 32 KB', key: 'L1 cache', human: 'desk: 1 s' },
  l2: { x: 200, y: 300, w: 600, h: 120, slots: 12, name: 'L2 · 1 MB', key: 'L2 cache', human: 'drawer: 4 s' },
  l3: { x: 100, y: 450, w: 800, h: 120, slots: 16, name: 'L3 · 32 MB shared', key: 'L3 cache', human: 'shelf: 13 s' },
  ram: { x: 20, y: 600, w: 960, h: 130, slots: 24, name: 'RAM · 16 GB', key: 'RAM', human: 'library: 75 s' },
};
const TIER_ORDER: Tier[] = ['l1', 'l2', 'l3', 'ram'];
const MAX_CYCLES = 368;

function slotRect(t: Tier, i: number) {
  const b = TIER_BOX[t];
  const pitch = Math.min(48, (b.w - 28) / b.slots);
  const x0 = b.x + (b.w - pitch * b.slots) / 2;
  return { x: x0 + i * pitch, y: b.y + 66, w: pitch - 6, h: 44 };
}
const slotCenter = (t: Tier, i: number): [number, number] => {
  const r = slotRect(t, i);
  return [r.x + r.w / 2, r.y + r.h / 2];
};

interface CacheView {
  note: string;
  slots: Record<'l1' | 'l2' | 'l3', (number | null)[]>;
  /** per-slot tone, key `l1:3` */
  tone?: Record<string, Tone>;
  tier?: Partial<Record<Tier, Tone>>;
  dot?: [number, number];
  pkt?: [number, number];
  cycles: number;
  bar: string;
  rows: Row[];
  /** [C, asm] shown beside the core */
  src?: [string, string];
}

function cacheFrames(views: CacheView[]): Frame[] {
  const f = new Film();
  for (const v of views) {
    const [c, asm] = v.src ?? ['x = a[0];', 'mov rax,[rsi]'];
    const out: Shape[] = [box('core', 350, 30, 300, 80, 'Core', { mono: true, tone: 'current' }), text('srcC', 335, 70, c, { align: 'right', size: 24, mono: true }), text('srcA', 665, 70, asm, { align: 'left', size: 24, mono: true, tone: 'accent' })];
    for (const t of TIER_ORDER) {
      const b = TIER_BOX[t];
      const r = box(`t-${t}`, b.x, b.y, b.w, b.h, '', { tone: v.tier?.[t] ?? 'default' });
      if (r.t === 'rect') r.detail = D[b.key];
      out.push(r, text(`n-${t}`, b.x + 14, b.y + 26, b.name, { align: 'left', size: 24, bold: true }), text(`h-${t}`, b.x + b.w - 14, b.y + 26, b.human, { align: 'right', size: 24 }));
      for (let i = 0; i < b.slots; i++) {
        const line = t === 'ram' ? i : v.slots[t][i];
        const r2 = slotRect(t, i);
        out.push(box(`${t}${i}`, r2.x, r2.y, r2.w, r2.h, line == null ? '' : String(line), { mono: true, tone: v.tone?.[`${t}:${i}`] ?? (line == null ? 'muted' : line === 0 ? 'read' : 'default'), dashed: line == null }));
      }
    }
    out.push(text('tl', 500, 765, v.bar, { size: 26 }), box('tb0', 40, 790, 920, 36, '', { tone: 'muted', dashed: true }));
    out.push(box('tb', 40, 790, Math.max(8, (v.cycles / MAX_CYCLES) * 920), 36, '', { tone: v.cycles <= 4 ? 'ok' : v.cycles < 100 ? 'warn' : 'fail' }));
    out.push(text('tc', 500, 870, 'time bar: full width = a trip to RAM, 368 cycles', { size: 24 }));
    if (v.pkt) out.push(box('pkt', v.pkt[0] - 45, v.pkt[1] - 22, 90, 44, '64 B', { mono: true, tone: 'accent' }));
    out.push({ t: 'dot', id: 'req', x: v.dot?.[0] ?? 500, y: v.dot?.[1] ?? 135, r: 16, tone: 'accent', label: v.dot ? undefined : 'load' });
    f.add(v.note, out, panel('Load a[0]', v.rows));
  }
  return f.frames;
}

const without = <T,>(a: T[], x: T) => a.map((y) => (y === x ? null : y)) as (T | null)[];
const WARM = { l1: [3, 5, 7, 9, null, null, null, null], l2: [3, 5, 7, 9, 11, 12, 13, 14, null, null, null, null], l3: [3, 5, 7, 9, 11, 12, 13, 14, 15, 17, 18, 19, null, null, null, null] } as CacheView['slots'];
const HAS0 = { l1: [0, 3, 5, 7, null, null, null, null], l2: [0, 3, 5, 7, 9, 11, 12, 13, null, null, null, null], l3: [0, 3, 5, 7, 9, 11, 12, 13, 14, 15, 17, 18, null, null, null, null] } as CacheView['slots'];
const CORE: [number, number] = [500, 135];

const CACHE_LADDER = () => {
  void without;
  const base = { slots: HAS0, cycles: 0 };
  return cacheFrames([
    { ...base, note: 'Each tier is bigger and farther from the core. Scaled to human time, an L1 hit is a note on your desk.', bar: 'one access', rows: [['L1', '4 cycles'], ['RAM', '300 cycles']] },
    { ...base, note: 'L1 is a few dozen KB beside the core: 4 cycles, a sliver of the bar.', tier: { l1: 'ok' }, dot: slotCenter('l1', 0), cycles: 4, bar: 'L1 hit: 4 cycles', rows: [['L1 hit', '4 cycles', 'ok']] },
    { ...base, note: 'L2 is private to a core, L3 is shared by all cores.', tier: { l2: 'current', l3: 'current' }, dot: slotCenter('l3', 0), cycles: 50, bar: 'L3 hit: 50 cycles', rows: [['L2', '14 cycles'], ['L3', '50 cycles', 'warn']] },
    { ...base, note: 'RAM is a walk to the library: 75 s on the desk scale, 300 cycles for the core.', tier: { ram: 'fail' }, dot: slotCenter('ram', 0), cycles: 300, bar: 'RAM: 300 cycles', rows: [['RAM', '300 cycles', 'fail']] },
  ]);
};

const CACHE_HIT = () =>
  cacheFrames([
    { slots: HAS0, note: 'The core loads a[0]. The line holding it, line 0, is already in L1.', cycles: 0, bar: 'waiting…', rows: [['load', 'a[0]']] },
    { slots: HAS0, note: 'The request reaches L1 and finds line 0: a hit.', tier: { l1: 'ok' }, tone: { 'l1:0': 'ok' }, dot: slotCenter('l1', 0), cycles: 4, bar: 'L1 hit: 4 cycles', rows: [['result', 'L1 hit', 'ok']] },
    { slots: HAS0, note: 'The value is back in the register after 4 cycles. L2, L3 and RAM were never involved.', tier: { l1: 'ok' }, dot: CORE, cycles: 4, bar: 'total: 4 cycles', rows: [['cost', '4 cycles', 'ok']] },
  ]);

const put = (a: (number | null)[], x: number) => {
  const i = a.indexOf(null);
  const b = [...a];
  b[i >= 0 ? i : 0] = x;
  return { b, i: i >= 0 ? i : 0 };
};

const CACHE_MISS = () => {
  const l1 = put(WARM.l1, 0);
  const l2 = put(WARM.l2, 0);
  const l3 = put(WARM.l3, 0);
  const miss = (n: number) => Object.fromEntries(TIER_ORDER.slice(0, n).map((t) => [t, 'warn' as Tone]));
  const all = { l1: l1.b, l2: l2.b, l3: l3.b };
  return cacheFrames([
    { slots: WARM, note: 'The core loads a[0]. No cache holds line 0 yet.', cycles: 0, bar: 'waiting…', rows: [['load', 'a[0]']] },
    { slots: WARM, note: 'L1 does not have it: miss.', tier: miss(1), dot: [500, TIER_BOX.l1.y + 90], cycles: 4, bar: 'L1 checked: 4 cycles', rows: [['L1', 'miss', 'warn']] },
    { slots: WARM, note: 'L2 misses, then L3. The request keeps going down.', tier: miss(3), dot: [500, TIER_BOX.l3.y + 90], cycles: 68, bar: 'L1+L2+L3 checked: 68 cycles', rows: [['L2', 'miss', 'warn'], ['L3', 'miss', 'warn']] },
    { slots: WARM, note: 'RAM has it, after ~80 ns. The core has been stalled for 368 cycles.', tier: { ...miss(3), ram: 'ok' }, tone: { 'ram:0': 'ok' }, dot: slotCenter('ram', 0), cycles: 368, bar: 'stalled: 368 cycles', rows: [['stall', '368 cycles', 'fail']] },
    { slots: WARM, note: 'RAM does not return one value: it sends the whole 64 B line, 16 neighbours of a[0] included.', tier: { ram: 'ok' }, tone: { 'ram:0': 'ok' }, pkt: slotCenter('ram', 0), dot: slotCenter('ram', 0), cycles: 368, bar: 'stalled: 368 cycles', rows: [['line', '64 B']] },
    { slots: { ...WARM, l3: all.l3 }, note: 'The line is copied into L3 as it passes.', tone: { [`l3:${l3.i}`]: 'ok' }, pkt: slotCenter('l3', l3.i), dot: slotCenter('l3', l3.i), cycles: 368, bar: 'stalled: 368 cycles', rows: [['L3', 'has line 0', 'ok']] },
    { slots: { ...WARM, l3: all.l3, l2: all.l2 }, note: 'Then into L2.', tone: { [`l2:${l2.i}`]: 'ok' }, pkt: slotCenter('l2', l2.i), dot: slotCenter('l2', l2.i), cycles: 368, bar: 'stalled: 368 cycles', rows: [['L2', 'has line 0', 'ok']] },
    { slots: all, note: 'Finally into L1, and a[0] reaches the core. One miss paid for the whole line.', tone: { [`l1:${l1.i}`]: 'ok' }, pkt: slotCenter('l1', l1.i), dot: CORE, cycles: 368, bar: 'a[0] total: 368 cycles', rows: [['a[0]', '368 cycles', 'fail']] },
    { slots: all, src: ['y = a[1];', 'mov rbx,[rsi+8]'], note: 'Now a[1] is in the same line, so it is an L1 hit. 92× faster than a[0].', tier: { l1: 'ok' }, tone: { [`l1:${l1.i}`]: 'ok' }, dot: slotCenter('l1', l1.i), cycles: 4, bar: 'a[1] total: 4 cycles', rows: [['a[1]', '4 cycles', 'ok']] },
  ]);
};

const CACHE_EVICT = () => {
  const src: [string, string] = ['sum += a[i];', 'add rax,[rsi+rcx*8]'];
  const slots: (number | null)[] = Array(8).fill(null);
  const order: number[] = [];
  let hits = 0;
  let total = 0;
  let last = 0;
  const access = (line: number) => {
    total++;
    const at = slots.indexOf(line);
    if (at >= 0) {
      hits++;
      order.splice(order.indexOf(line), 1);
      order.push(line);
      last = at;
      return;
    }
    const free = slots.indexOf(null);
    const slot = free >= 0 ? free : slots.indexOf(order.shift()!);
    slots[slot] = line;
    order.push(line);
    last = slot;
  };
  const view = (note: string, run: number[], recent: number): CacheView => {
    const h0 = hits;
    const t0 = total;
    run.forEach(access);
    const stepHits = hits - h0;
    const stepAcc = t0 === total ? 1 : total - t0;
    const avg = Math.round((stepHits * 4 + (stepAcc - stepHits) * MAX_CYCLES) / stepAcc);
    return {
      note,
      slots: { l1: [...slots], l2: Array(12).fill(null), l3: Array(16).fill(null) },
      tone: { [`l1:${last}`]: stepHits === stepAcc ? 'ok' : 'warn' },
      tier: { l1: stepHits === stepAcc ? 'ok' : 'warn' },
      dot: slotCenter('l1', last),
      cycles: avg,
      bar: `average per access: ${avg} cycles`,
      src,
      rows: [['working set', `${recent} lines`], ['L1 slots', 8], ['hit rate', `${Math.round((stepHits / stepAcc) * 100)}%`, stepHits === stepAcc ? 'ok' : 'fail']],
    };
  };
  const seq = (n: number) => Array.from({ length: n }, (_, i) => i);
  return cacheFrames([
    view('A loop touches 6 lines. L1 has 8 slots, so everything fits after the first pass.', seq(6), 6),
    view('Second pass over the same 6 lines: every access hits.', seq(6), 6),
    view('The loop now walks 10 lines, more than L1 holds. Lines 0 and 1, the least recently used, get evicted to make room.', [6, 7, 8, 9], 10),
    view('Back to line 0: it was just evicted, so it misses and evicts line 2, the next one the loop needs.', [0, 1], 10),
    view('Each access evicts exactly the line needed soon. A full pass over 10 lines: every access misses.', seq(10), 10),
  ]);
};

// ---------------- context switches: a thread's registers travel core ⇄ RAM ----------------
type Th = 'T1' | 'T2' | 'T3';
const TH_PROC: Record<Th, 'A' | 'B'> = { T1: 'A', T2: 'A', T3: 'B' };
const TCB_AT: Record<Th, [number, number]> = { T1: [80, 500], T2: [300, 500], T3: [620, 500] };
const CTX_TONE: Record<Th, Tone> = { T1: 'ok', T2: 'read', T3: 'protocol' };
const SEG_TONE: Record<string, Tone> = { '1': 'ok', '2': 'read', '3': 'protocol', K: 'warn', C: 'fail' };

const SW_D: Record<string, Detail> = {
  ctx: { title: 'Saved context', text: 'Program counter, stack pointer, flags and the general registers, plus FPU/SIMD state: up to a few KB with AVX-512.', code: '// Linux: pushed on the kernel stack, then\n// switch_to(prev, next) swaps rsp and jumps\nstruct pt_regs { unsigned long r15, …, rip, cs, flags, rsp, ss; };' },
  tcb: { title: 'Thread control block', text: 'The kernel’s record of a thread (task_struct on Linux): saved registers, state, priority, and which address space it uses.', code: '$ cat /proc/<pid>/task/<tid>/status\n$ grep ctxt /proc/<pid>/status   # voluntary vs nonvoluntary' },
  cr3: { title: 'CR3 register', text: 'Points to the current process’s page table. Threads of one process share it; a process switch loads a new one.', code: '// x86: mov cr3, <new page table> on a process switch' },
  tlb: { title: 'TLB', text: 'Cache of virtual → physical translations. Changing CR3 makes them invalid unless tagged with PCID/ASID.', code: '$ perf stat -e dTLB-load-misses ./app' },
  l1: { title: 'L1 cache', text: 'Still holds the old thread’s data after a switch. The new thread’s first accesses miss and refill it.', code: '' },
  rq: { title: 'Run queue', text: 'Threads ready to run, waiting for a core. The scheduler picks the next one when a slice ends or a thread blocks.', code: '$ vmstat 1   # r = run queue length\n$ perf sched latency' },
  pt: { title: 'Page table', text: 'Per-process map from virtual to physical pages. Threads of the same process share it, which is why thread switches are cheaper.', code: '' },
};

interface SwView {
  note: string;
  run: Th | null;
  mode: string;
  cr3: 'A' | 'B';
  tlb: [string, Tone];
  l1: [string, Tone];
  queue: Th[];
  wait?: Th[];
  segs: string;
  rows: Row[];
  hot?: Th;
}

function swFrames(views: SwView[]): Frame[] {
  const f = new Film();
  const withD = (sh: Shape, d: Detail) => {
    if (sh.t === 'rect') sh.detail = d;
    return sh;
  };
  for (const v of views) {
    const out: Shape[] = [
      box('core', 40, 40, 560, 320, '', { tone: v.run ? 'default' : 'warn' }),
      text('coreT', 60, 70, 'Core 0', { align: 'left', size: 26, bold: true }),
      text('mode', 580, 70, v.mode, { align: 'right', size: 24, mono: true }),
      box('slot', 80, 130, 220, 130, '', { tone: 'muted', dashed: true }),
      text('slotT', 190, 290, 'registers', { size: 24 }),
      withD(box('cr3', 330, 110, 250, 60, `CR3 → table ${v.cr3}`, { mono: true, tone: 'accent' }), SW_D.cr3),
      withD(box('tlb', 330, 190, 250, 60, v.tlb[0], { mono: true, tone: v.tlb[1] }), SW_D.tlb),
      withD(box('l1', 330, 270, 250, 60, v.l1[0], { mono: true, tone: v.l1[1] }), SW_D.l1),
      withD(box('sched', 640, 40, 320, 320, '', {}), SW_D.rq),
      text('rqT', 800, 70, 'run queue', { size: 24, bold: true }),
      text('wqT', 800, 240, 'waiting on I/O', { size: 24, bold: true }),
      box('ram', 40, 400, 920, 360, '', { tone: 'muted' }),
      text('ramT', 60, 425, 'RAM', { align: 'left', size: 26, bold: true }),
      box('pA', 60, 445, 520, 300, '', { dashed: true }),
      text('pAT', 80, 470, 'Process A', { align: 'left', size: 24, bold: true }),
      box('pB', 600, 445, 340, 300, '', { dashed: true }),
      text('pBT', 620, 470, 'Process B', { align: 'left', size: 24, bold: true }),
      withD(box('ptA', 80, 665, 480, 60, 'page table A', { mono: true }), SW_D.pt),
      withD(box('ptB', 620, 665, 300, 60, 'page table B', { mono: true }), SW_D.pt),
    ];
    for (const t of ['T1', 'T2', 'T3'] as Th[]) {
      const [x, y] = TCB_AT[t];
      out.push(withD(box(`tcb${t}`, x, y, 200, 110, '', { tone: 'muted', dashed: true }), SW_D.tcb), text(`tcbT${t}`, x + 100, y + 135, `${t} TCB`, { size: 24 }));
    }
    v.queue.forEach((t, i) => out.push(box(`q${t}`, 670, 90 + i * 64, 260, 52, `${t} · ready`, { mono: true, tone: CTX_TONE[t] })));
    (v.wait ?? []).forEach((t, i) => out.push(box(`q${t}`, 670, 260 + i * 64, 260, 52, `${t} · blocked`, { mono: true, tone: 'muted' })));
    for (const t of ['T1', 'T2', 'T3'] as Th[]) {
      const [x, y] = v.run === t ? [90, 140] : TCB_AT[t];
      out.push(withD(box(`ctx${t}`, x, y, 200, 110, `${t} regs`, { sub: v.run === t ? 'running' : 'saved', mono: true, tone: v.hot === t ? 'current' : CTX_TONE[t] }), SW_D.ctx));
    }
    out.push(text('tsT', 40, 790, 'CPU time', { align: 'left', size: 24, bold: true }));
    [...v.segs].forEach((c, i) => out.push(box(`ts${i}`, 40 + i * 38, 810, 34, 44, c, { mono: true, tone: SEG_TONE[c] })));
    out.push(text('tsL', 500, 900, '1 2 3 = thread runs · K = kernel · C = cold caches', { size: 24 }));
    f.add(v.note, out, panel('Context switch', v.rows));
  }
  return f.frames;
}

const warmA = { cr3: 'A' as const, tlb: ['TLB: A pages', 'ok'] as [string, Tone], l1: ['L1: T1 data', 'ok'] as [string, Tone] };

const SW_THREAD = () =>
  swFrames([
    { ...warmA, note: 'T1 runs on the core. Its live state is the core’s registers: PC, SP and 16 general registers.', run: 'T1', mode: 'user · T1', queue: ['T2', 'T3'], segs: '1111', rows: [['running', 'T1'], ['slice', '~4 ms']] },
    { ...warmA, note: 'T1’s time slice ends. A timer interrupt drops the core into the kernel.', run: 'T1', hot: 'T1', mode: 'kernel · timer IRQ', queue: ['T2', 'T3'], segs: '1111K', rows: [['event', 'timer interrupt', 'warn']] },
    { ...warmA, note: 'The kernel saves T1’s registers into T1’s control block in RAM.', run: null, hot: 'T1', mode: 'kernel · save T1', queue: ['T2', 'T3', 'T1'], segs: '1111KK', rows: [['saved', 'T1 → RAM', 'warn']] },
    { ...warmA, note: 'It takes T2 from the run queue and loads T2’s registers into the core.', run: 'T2', hot: 'T2', mode: 'kernel · load T2', queue: ['T3', 'T1'], segs: '1111KKK', rows: [['loaded', 'RAM → T2', 'warn']] },
    { ...warmA, l1: ['L1: A data', 'ok'], note: 'T2 shares process A’s memory, so CR3, the TLB and much of the cache stay valid. Cost: about 1–2 µs.', run: 'T2', mode: 'user · T2', queue: ['T3', 'T1'], segs: '1111KKK2222', rows: [['switch', '~1–2 µs', 'ok'], ['TLB', 'kept', 'ok']] },
  ]);

const SW_PROCESS = () =>
  swFrames([
    { ...warmA, note: 'T1 of process A runs. Next in line is T3, which belongs to process B.', run: 'T1', mode: 'user · T1', queue: ['T3', 'T2'], segs: '1111', rows: [['running', 'T1 (A)'], ['next', 'T3 (B)']] },
    { ...warmA, note: 'Slice over: the kernel saves T1’s registers to RAM.', run: null, hot: 'T1', mode: 'kernel · save T1', queue: ['T3', 'T2', 'T1'], segs: '1111KK', rows: [['saved', 'T1 → RAM', 'warn']] },
    { ...warmA, cr3: 'B', tlb: ['TLB: flushed', 'fail'], note: 'Different process, so CR3 now points at page table B. The TLB’s A translations are useless and get flushed.', run: null, mode: 'kernel · CR3 = B', queue: ['T3', 'T2', 'T1'], segs: '1111KKK', rows: [['CR3', 'A → B', 'warn'], ['TLB', 'flushed', 'fail']] },
    { cr3: 'B', tlb: ['TLB: flushed', 'fail'], l1: ['L1: A data', 'warn'], note: 'T3’s registers are loaded and it starts running.', run: 'T3', hot: 'T3', mode: 'kernel · load T3', queue: ['T2', 'T1'], segs: '1111KKKK', rows: [['loaded', 'RAM → T3', 'warn']] },
    { cr3: 'B', tlb: ['TLB: refilling', 'warn'], l1: ['L1: missing', 'fail'], note: 'Every first access misses in the TLB and the cache, which still hold A’s data. This refill often costs more than the switch itself.', run: 'T3', mode: 'user · T3 (cold)', queue: ['T2', 'T1'], segs: '1111KKKKCCC', rows: [['TLB', 'misses', 'fail'], ['L1', 'misses', 'fail']] },
    { cr3: 'B', tlb: ['TLB: B pages', 'ok'], l1: ['L1: T3 data', 'ok'], note: 'Once warm, T3 runs at full speed. A process switch costs roughly 3–5 µs plus the cache refill.', run: 'T3', mode: 'user · T3', queue: ['T2', 'T1'], segs: '1111KKKKCCC333', rows: [['switch', '3–5 µs + refill', 'warn']] },
  ]);

const SW_BLOCK = () =>
  swFrames([
    { ...warmA, note: 'T1 calls read() on a socket with no data yet.', run: 'T1', hot: 'T1', mode: 'user · T1 → read()', queue: ['T2'], segs: '111', rows: [['call', 'read()']] },
    { ...warmA, note: 'Nothing to return, so the kernel saves T1 and parks it on the socket’s wait queue. It isn’t on the run queue at all.', run: null, mode: 'kernel · T1 sleeps', queue: ['T2'], wait: ['T1'], segs: '111KK', rows: [['switch', 'voluntary'], ['T1', 'blocked', 'warn']] },
    { ...warmA, note: 'T2 is loaded and gets the core. A blocked thread uses no CPU.', run: 'T2', hot: 'T2', mode: 'user · T2', queue: [], wait: ['T1'], segs: '111KKK222', rows: [['running', 'T2']] },
    { ...warmA, note: 'Data arrives and the NIC interrupt wakes T1: it moves to the run queue. It still waits for a core.', run: 'T2', mode: 'kernel · IRQ: data for T1', queue: ['T1'], segs: '111KKK222K', rows: [['T1', 'ready', 'ok']] },
    { ...warmA, note: 'At the next switch T1’s registers come back and read() returns its bytes. 10,000 blocked threads mean 10,000 of these round trips.', run: 'T1', hot: 'T1', mode: 'user · T1 ← read()', queue: ['T2'], segs: '111KKK222KKK11', rows: [['per blocking call', '2 switches', 'warn'], ['fix at scale', 'epoll'], ['see', 'Network servers']] },
  ]);

// ---------------- locality & data layout (grid of 8 B slots, one row = one 64 B line) ----------------
const LINE = 8;
const cellX = (c: number) => 40 + c * 115;

interface Pass {
  upto: number;
  note: string;
}

function matrixFrames(colMajor: boolean, passes: Pass[]): Frame[] {
  const R = 6;
  const seq: [number, number][] = colMajor ? Array.from({ length: R * LINE }, (_, i) => [i % R, Math.floor(i / R)]) : Array.from({ length: R * LINE }, (_, i) => [Math.floor(i / LINE), i % LINE]);
  const f = new Film();
  const lru: number[] = [];
  const seen = new Map<string, Tone>();
  let hits = 0;
  let misses = 0;
  let pos = 0;
  for (const p of passes) {
    for (; pos < p.upto; pos++) {
      const [r, c] = seq[pos];
      const at = lru.indexOf(r);
      if (at >= 0) {
        lru.splice(at, 1);
        hits++;
        seen.set(`${r}_${c}`, 'ok');
      } else {
        misses++;
        if (lru.length === 2) lru.shift();
        seen.set(`${r}_${c}`, 'warn');
      }
      lru.push(r);
    }
    const out = [text('h', 500, 70, 'long a[6][8]: each row is one 64 B cache line', { size: 26 })];
    for (let r = 0; r < R; r++)
      for (let c = 0; c < LINE; c++) out.push(box(`g${r}_${c}`, cellX(c), 110 + r * 85, 105, 75, String(r * LINE + c), { mono: true, tone: seen.get(`${r}_${c}`) ?? (lru.includes(r) ? 'read' : 'default') }));
    out.push(text('ct', 500, 665, 'L1 holds 2 lines', { size: 26 }));
    for (let i = 0; i < 2; i++) out.push(box(`l${i}`, 40 + i * 480, 700, 440, 90, lru[i] === undefined ? '' : `line ${lru[i]}`, { mono: true, tone: lru[i] === undefined ? 'muted' : 'read', dashed: lru[i] === undefined }));
    f.add(p.note, out, panel('Cache', [['access', colMajor ? 'down columns' : 'along rows'], ['hits', hits, 'ok'], ['misses', misses, misses > hits ? 'fail' : 'warn']]));
  }
  return f.frames;
}

const ROWS = () =>
  matrixFrames(false, [
    { upto: 1, note: 'a[0][0] misses, so the CPU loads its whole 64 B line: eight neighbours come along.' },
    { upto: 4, note: 'a[0][1] to a[0][3] are hits: they were fetched with the first one.' },
    { upto: 8, note: 'Row 0 done: 1 miss and 7 hits.' },
    { upto: 9, note: 'Row 1 starts a new line, another miss.' },
    { upto: 48, note: 'Whole matrix: 6 misses, 42 hits. Row order walks memory in the order it is laid out.' },
  ]);

const COLS = () =>
  matrixFrames(true, [
    { upto: 1, note: 'a[0][0] misses and loads line 0.' },
    { upto: 3, note: 'a[1][0] and a[2][0] live in other lines: both miss, and the 2-line cache is already full.' },
    { upto: 6, note: 'Column 0 done: 6 misses. Only the last two lines are still cached.' },
    { upto: 7, note: 'Column 1 starts at a[0][1], whose line was evicted. Miss again.' },
    { upto: 48, note: 'Whole matrix: 48 misses, 0 hits. Same work, 8× the memory traffic.' },
  ]);

function slotFrames(fields: string[], used: (i: number) => boolean, steps: { note: string; fetched: number; rows: Row[] }[], caption: string): Frame[] {
  const f = new Film();
  steps.forEach((s, k) => {
    const out = [text('cap', 500, 70, caption, { size: 26, mono: true })];
    for (let line = 0; line < 2; line++) {
      out.push(text(`n${line}`, 500, 150 + line * 190, `cache line ${line}`, { size: 26 }));
      for (let i = 0; i < LINE; i++) {
        const idx = line * LINE + i;
        const tone: Tone = line < s.fetched ? (used(idx) ? 'ok' : 'warn') : 'default';
        out.push(box(`s${idx}`, cellX(i), 180 + line * 190, 105, 100, fields[idx % fields.length], { mono: true, tone }));
      }
    }
    f.add(s.note, out, panel('Fetched', s.rows));
    void k;
  });
  return f.frames;
}

const AOS = () =>
  slotFrames(['x', 'y', 'z', 'hp'], (i) => i % 4 === 3, [
    { note: 'Array of structs: each Particle is four 8 B fields, so a 64 B line holds two of them.', fetched: 0, rows: [['struct', '32 B']] },
    { note: 'Summing hp pulls in line 0: 2 values we need, 6 slots we never read.', fetched: 1, rows: [['useful', '25%', 'warn']] },
    { note: 'Four hp values cost two line fetches. Three quarters of the bandwidth carries x, y and z.', fetched: 2, rows: [['useful', '25%', 'fail'], ['lines per 4 hp', 2]] },
  ], 'for (auto& p : ps) sum += p.hp;');

const SOA = () =>
  slotFrames(['hp'], () => true, [
    { note: 'Struct of arrays: all hp values sit side by side, eight to a line.', fetched: 0, rows: [['hp[]', 'contiguous']] },
    { note: 'One line fetch delivers 8 hp values and every byte is used.', fetched: 1, rows: [['useful', '100%', 'ok']] },
    { note: 'Eight hp values cost one fetch, and contiguous data lets the compiler use SIMD.', fetched: 2, rows: [['useful', '100%', 'ok'], ['lines per 4 hp', '0.5', 'ok']] },
  ], 'for (float h : hp) sum += h;');

// ---------------- false sharing ----------------
const coreNodes = [N('c0', 40, 40, 420, 100, 'Core 0', 'a++'), N('c1', 540, 40, 420, 100, 'Core 1', 'b++'), N('l0', 40, 260, 420, 130, 'L1 · core 0'), N('l1', 540, 260, 420, 130, 'L1 · core 1')];

const SHARE_SAME: Board = {
  panel: 'Coherence',
  nodes: [...coreNodes, N('ln', 200, 520, 600, 130, 'one cache line', 'a | b'), N('res', 40, 760, 920, 120, 'result')],
  edges: ['c0>l0', 'c1>l1', 'l0>ln', 'l1>ln'],
  beats: [
    { note: 'Two threads, two counters. They are different variables, but only 8 bytes apart.', hide: ['res'], rows: [['data shared', 'none', 'ok'], ['line shared', 'yes', 'warn']] },
    { note: 'Core 0 writes a. It takes the line exclusively and core 1’s copy is invalidated.', hot: { c0: 'write', l0: 'write', 'l0>ln': 'accent', l1: 'fail' }, sub: { l0: 'line: modified', l1: 'line: invalid' }, hide: ['res'], rows: [['core 0', 'owns line', 'ok'], ['core 1', 'invalid', 'fail']] },
    { note: 'Core 1 writes b. It must pull the line from core 0, which now loses its copy.', hot: { c1: 'write', l1: 'write', 'l1>ln': 'accent', l0: 'fail' }, sub: { l1: 'line: modified', l0: 'line: invalid' }, hide: ['res'], rows: [['core 0', 'invalid', 'fail'], ['core 1', 'owns line', 'ok']] },
    { note: 'The line ping-pongs on every write: often 10× slower, with no shared data and no lock.', hot: { l0: 'fail', l1: 'fail', res: 'fail' }, label: { res: 'false sharing: coherence traffic' }, rows: [['slowdown', '5–50×', 'fail']] },
  ],
};

const SHARE_PAD: Board = {
  panel: 'Coherence',
  nodes: [...coreNodes, N('la', 40, 520, 420, 130, 'line A', 'a'), N('lb', 540, 520, 420, 130, 'line B', 'b'), N('res', 40, 760, 920, 120, 'result')],
  edges: ['c0>l0', 'c1>l1', 'l0>la', 'l1>lb'],
  beats: [
    { note: 'Fix: alignas(64) gives each counter its own cache line.', hot: { la: 'accent', lb: 'accent' }, hide: ['res'], rows: [['a', 'line A'], ['b', 'line B']] },
    { note: 'Each core owns its line and writes it without asking anyone.', hot: { c0: 'write', l0: 'ok', c1: 'write', l1: 'ok', 'l0>la': 'ok', 'l1>lb': 'ok' }, sub: { l0: 'line A: modified', l1: 'line B: modified' }, hide: ['res'], rows: [['invalidations', 0, 'ok']] },
    { note: 'No ping-pong. The same code now scales with the number of cores.', hot: { res: 'ok' }, label: { res: 'alignas(64) · padding trades bytes for speed' }, rows: [['slowdown', 'gone', 'ok']] },
  ],
};

// ---------------- zero-copy ----------------
const ZC_NODES = [N('disk', 40, 60, 440, 110, 'disk'), N('nic', 520, 60, 440, 110, 'NIC'), N('pc', 40, 300, 440, 110, 'page cache', 'kernel'), N('sb', 520, 300, 440, 110, 'socket buffer', 'kernel'), N('ub', 280, 540, 440, 110, 'user buffer', 'your process'), N('res', 40, 740, 920, 130, 'result')];
const ZC_EDGES = ['disk>pc', 'pc>ub', 'ub>sb', 'sb>nic', 'pc>sb'];
const zc = (beats: Board['beats']): Board => ({ panel: 'Copies', nodes: ZC_NODES, edges: ZC_EDGES, beats });

const ZC_COPY = zc([
  { note: 'read() then send(): serving a file the classic way. It starts on disk.', hot: { disk: 'current' }, hide: ['res'], rows: [['copies', 0], ['by CPU', 0]] },
  { note: 'The disk DMAs the file into the page cache. No CPU copy yet.', hot: { disk: 'ok', pc: 'ok', 'disk>pc': 'ok' }, hide: ['res'], rows: [['copies', 1], ['by CPU', 0, 'ok']] },
  { note: 'read(): the CPU copies the bytes from the page cache into your buffer.', hot: { pc: 'ok', ub: 'warn', 'pc>ub': 'warn' }, hide: ['res'], rows: [['copies', 2], ['by CPU', 1, 'warn']] },
  { note: 'send(): the CPU copies them again, into the socket buffer.', hot: { ub: 'warn', sb: 'warn', 'ub>sb': 'warn' }, hide: ['res'], rows: [['copies', 3], ['by CPU', 2, 'fail']] },
  { note: 'The NIC DMAs the bytes out. The app never changed them, yet the CPU moved every byte twice.', hot: { sb: 'ok', nic: 'ok', 'sb>nic': 'ok', res: 'fail' }, label: { res: '4 copies · 2 syscalls · 4 mode switches' }, rows: [['copies', 4], ['by CPU', 2, 'fail']] },
]);

const ZC_SENDFILE = zc([
  { note: 'sendfile(sock, file, …): the data never enters your process.', hot: { disk: 'current' }, hide: ['ub', 'res'], rows: [['copies', 0], ['by CPU', 0]] },
  { note: 'Same start: the disk DMAs the file into the page cache.', hot: { disk: 'ok', pc: 'ok', 'disk>pc': 'ok' }, hide: ['ub', 'res'], rows: [['copies', 1], ['by CPU', 0, 'ok']] },
  { note: 'The kernel queues references to those pages on the socket. With scatter-gather DMA, no bytes move.', hot: { pc: 'ok', sb: 'accent', 'pc>sb': 'accent' }, sub: { sb: 'page refs only' }, hide: ['ub', 'res'], rows: [['copies', 1], ['by CPU', 0, 'ok']] },
  { note: 'The NIC reads straight from the page cache. Two DMA transfers, none by the CPU, one syscall.', hot: { sb: 'ok', nic: 'ok', 'sb>nic': 'ok', res: 'ok' }, sub: { sb: 'page refs only' }, label: { res: '2 DMA copies · 0 CPU copies · 1 syscall' }, hide: ['ub'], rows: [['copies', 2], ['by CPU', 0, 'ok']] },
]);

const ZC_MMAP = zc([
  { note: 'mmap() maps the page-cache pages into your address space instead of copying them.', hot: { disk: 'ok', pc: 'ok', 'disk>pc': 'ok' }, hide: ['res', 'sb', 'nic', 'ub>sb', 'sb>nic', 'pc>sb'], rows: [['copies', 1], ['by CPU', 0, 'ok']] },
  { note: 'Your process sees the same bytes at an address: the read() copy is gone.', hot: { pc: 'ok', ub: 'accent', 'pc>ub': 'accent' }, sub: { ub: 'mapped view of page cache' }, hide: ['res', 'sb', 'nic', 'ub>sb', 'sb>nic', 'pc>sb'], rows: [['copies', 1], ['by CPU', 0, 'ok']] },
  { note: 'send() still copies from the mapped pages into the socket buffer.', hot: { ub: 'accent', sb: 'warn', 'ub>sb': 'warn' }, sub: { ub: 'mapped view of page cache' }, hide: ['res', 'nic', 'sb>nic', 'pc>sb'], rows: [['copies', 2], ['by CPU', 1, 'warn']] },
  { note: 'One CPU copy saved. First touch costs page faults, and truncating the file raises SIGBUS.', hot: { sb: 'ok', nic: 'ok', 'sb>nic': 'ok', res: 'warn' }, sub: { ub: 'mapped view of page cache' }, label: { res: '3 copies · page faults · SIGBUS risk' }, hide: ['pc>sb'], rows: [['copies', 3], ['by CPU', 1, 'warn']] },
]);

const ZC_MSG = zc([
  { note: 'Data already lives in your buffer, such as a response you built. sendfile does not apply.', hot: { ub: 'current' }, hide: ['disk', 'pc', 'nic', 'res', 'disk>pc', 'pc>ub', 'pc>sb', 'sb>nic'], rows: [['copies', 0], ['by CPU', 0]] },
  { note: 'send(…, MSG_ZEROCOPY) pins your pages and queues references to them.', hot: { ub: 'accent', sb: 'accent', 'ub>sb': 'accent' }, sub: { sb: 'pinned page refs' }, hide: ['disk', 'pc', 'nic', 'res', 'disk>pc', 'pc>ub', 'pc>sb', 'sb>nic'], rows: [['copies', 0], ['by CPU', 0, 'ok']] },
  { note: 'The NIC DMAs straight from your buffer. Do not touch it until a completion arrives.', hot: { sb: 'ok', nic: 'ok', 'sb>nic': 'ok', ub: 'warn' }, sub: { sb: 'pinned page refs', ub: 'locked until completion' }, hide: ['disk', 'pc', 'res', 'disk>pc', 'pc>ub', 'pc>sb'], rows: [['copies', 0], ['completion', 'error queue', 'warn']] },
  { note: 'Pinning and completions cost something, so it only pays off for sends around 10 KB and up.', hot: { res: 'warn' }, sub: { ub: 'locked until completion' }, label: { res: 'big sends: win · small sends: copy is faster' }, hide: ['disk', 'pc', 'disk>pc', 'pc>ub', 'pc>sb'], rows: [['rule', 'measure first', 'warn']] },
]);

// ---------------- avoiding user-space copies ----------------
const CP_NODES = [N('req', 40, 330, 420, 110, 'req.body', '4 KB heap block'), N('cp', 540, 330, 420, 110, 'body (copy)', 'new 4 KB block'), N('fn', 270, 540, 460, 110, 'handle()'), N('res', 40, 740, 920, 120, 'result')];

const CP_VALUE: Board = {
  panel: 'Call',
  codeTitle: 'by value',
  code: ['void handle(std::string body);', 'handle(req.body);'],
  nodes: CP_NODES,
  edges: ['req>fn', 'req>cp', 'cp>fn'],
  beats: [
    { note: 'handle takes its string by value.', hl: [0, 1], hide: ['cp', 'res', 'req>cp', 'cp>fn'], rows: [['allocations', 0]] },
    { note: 'The call allocates a second 4 KB block and memcpys into it.', hl: [1], hot: { cp: 'warn', 'req>cp': 'warn' }, sub: { cp: 'malloc + memcpy' }, hide: ['res', 'req>fn', 'cp>fn'], rows: [['allocations', 1, 'warn'], ['bytes copied', '4 KB', 'warn']] },
    { note: 'The copy is freed on return: a malloc, a free and 4 KB of traffic per request.', hl: [1], hot: { fn: 'current', 'cp>fn': 'accent', res: 'fail' }, label: { res: 'per request: malloc · memcpy · free' }, hide: ['req>fn'], rows: [['allocations', 1, 'fail']] },
  ],
};

const CP_REF: Board = {
  panel: 'Call',
  codeTitle: 'by reference',
  code: ['void handle(const std::string& body);', 'void handle(std::string_view body);'],
  nodes: CP_NODES,
  edges: ['req>fn'],
  beats: [
    { note: 'const& passes an address: no allocation and no copy.', hl: [0], hot: { 'req>fn': 'ok', fn: 'ok' }, sub: { fn: 'pointer to req.body' }, hide: ['cp', 'res'], rows: [['allocations', 0, 'ok'], ['bytes copied', 0, 'ok']] },
    { note: 'string_view is a pointer and a length. It also takes literals and substrings without building a string.', hl: [1], hot: { 'req>fn': 'ok', fn: 'ok' }, sub: { fn: 'ptr + len · 16 B' }, hide: ['cp', 'res'], rows: [['allocations', 0, 'ok'], ['bytes copied', '16 B', 'ok']] },
    { note: 'A view does not own its bytes. Never keep one past the owner’s lifetime.', hl: [1], hot: { req: 'current', fn: 'ok', res: 'warn' }, label: { res: 'dangling view = use-after-free' }, hide: ['cp'], rows: [['rule', 'borrow, never store', 'warn']] },
  ],
};

const CP_MOVE: Board = {
  panel: 'Hand-off',
  codeTitle: 'move',
  code: ['std::string body = read_body();', 'queue.push(std::move(body));'],
  nodes: [N('a', 40, 330, 420, 110, 'body', 'ptr → 4 KB block'), N('b', 540, 330, 420, 110, 'queue slot', 'empty'), N('res', 40, 600, 920, 120, 'result')],
  edges: ['a>b'],
  beats: [
    { note: 'body owns a 4 KB heap block that the queue now needs.', hl: [0], hot: { a: 'current' }, hide: ['b', 'res', 'a>b'], rows: [['owner', 'body']] },
    { note: 'std::move hands over the block: the slot takes the pointer, 24 B are copied and body is left empty.', hl: [1], hot: { a: 'muted', b: 'ok', 'a>b': 'ok' }, sub: { a: 'empty', b: 'ptr → same block' }, hide: ['res'], rows: [['bytes copied', '24 B', 'ok'], ['owner', 'queue slot']] },
    { note: 'A move costs the same for 4 B or 4 GB. Do not read body afterwards.', hl: [1], hot: { b: 'ok', res: 'ok' }, sub: { a: 'empty', b: 'ptr → same block' }, label: { res: 'O(1) hand-off · no malloc' }, rows: [['allocations', 0, 'ok']] },
  ],
};

// ---------------- measuring ----------------
const MEASURE_LOOP: Board = {
  panel: 'Workflow',
  nodes: [N('bench', 200, 40, 600, 110, 'benchmark', 'fixed input · -O2 · quiet machine'), N('stat', 200, 220, 600, 110, 'perf stat', 'cycles · IPC · misses'), N('rec', 200, 400, 600, 110, 'perf record', 'flame graph: where time goes'), N('fix', 200, 580, 600, 110, 'one change', 'layout, copy, lock, algorithm'), N('chk', 200, 760, 600, 110, 're-measure', 'kept only if it is faster')],
  edges: ['bench>stat', 'stat>rec', 'rec>fix', 'fix>chk'],
  beats: [
    { note: 'Measure first: a repeatable benchmark on optimized code gives you a number to beat.', hot: { bench: 'current' }, rows: [['rule', 'no guessing']] },
    { note: 'perf stat says what kind of slow: stalled on memory, mispredicting, or just busy.', hot: { stat: 'current', 'bench>stat': 'accent' }, rows: [['IPC', 'low = stalled', 'warn']] },
    { note: 'perf record finds the function. Typically one or two frames hold most of the time.', hot: { rec: 'current', 'stat>rec': 'accent' }, rows: [['hot spots', '1–2']] },
    { note: 'Change one thing at a time, aimed at what the counters showed.', hot: { fix: 'current', 'rec>fix': 'accent' }, rows: [['changes', 1]] },
    { note: 'Measure again. If the number did not move, revert.', hot: { chk: 'ok', 'fix>chk': 'accent' }, rows: [['kept', 'only wins', 'ok']] },
  ],
};

const MEASURE_COUNTERS: Board = {
  panel: 'perf stat',
  nodes: [N('ipc', 40, 60, 440, 170, 'IPC', 'instructions / cycle'), N('cm', 520, 60, 440, 170, 'cache-misses', 'of all loads'), N('bm', 40, 300, 440, 170, 'branch-misses', 'of all branches'), N('pf', 520, 300, 440, 170, 'page-faults', 'first touch, mmap, swap'), N('res', 40, 570, 920, 150, 'result')],
  edges: [],
  beats: [
    { note: 'perf stat prints a handful of ratios. Each one points at a different fix.', hide: ['res'], rows: [['cmd', 'perf stat ./app']] },
    { note: 'IPC under 1 on a modern core means it is mostly waiting, usually for memory.', hot: { ipc: 'warn' }, hide: ['res'], rows: [['IPC', '< 1', 'warn']] },
    { note: 'Many cache misses: fix layout and traversal order, or shrink the working set.', hot: { cm: 'warn', res: 'ok' }, label: { res: 'contiguous data · SoA · smaller types' }, rows: [['misses', '> 5%', 'warn']] },
    { note: 'Many branch misses: the data steers the if. Sorting it, or going branchless, helps.', hot: { bm: 'warn', res: 'ok' }, label: { res: 'sort input · cmov / lookup table' }, rows: [['misses', '> 2%', 'warn']] },
    { note: 'Many page faults: memory is first touched in the hot path. Reserve and reuse it.', hot: { pf: 'warn', res: 'ok' }, label: { res: 'reserve() · pools · pre-fault' }, rows: [['faults', 'in hot loop', 'warn']] },
  ],
};

framesDemo(G, 'perf-cache', 'CPU cache tiers', 'Registers, L1, L2, L3 and RAM: size and latency of each, a hit in L1, and a miss that goes all the way to memory and fills a 64 B line.', {
  ladder: ['Tiers', CACHE_LADDER],
  hit: ['L1 hit', CACHE_HIT],
  miss: ['Miss to RAM', CACHE_MISS],
  evict: ['Eviction', CACHE_EVICT],
}, D);

framesDemo(G, 'perf-switch', 'Context switches', 'Watch a thread’s registers travel from the core to RAM and back: thread switch, process switch with CR3 and a TLB flush, and blocking I/O.', {
  thread: ['Thread switch', SW_THREAD],
  process: ['Process switch', SW_PROCESS],
  block: ['Blocking call', SW_BLOCK],
});

framesDemo(G, 'perf-locality', 'Locality & data layout', 'Why row order beats column order, and why struct-of-arrays beats array-of-structs: use every byte of each cache line you pay for.', {
  rows: ['Row order', ROWS],
  cols: ['Column order', COLS],
  aos: ['Array of structs', AOS],
  soa: ['Struct of arrays', SOA],
}, D);

framesDemo(G, 'perf-sharing', 'False sharing', 'Two cores writing different variables that share a cache line invalidate each other on every write; alignas(64) fixes it.', {
  shared: ['Same line', B(SHARE_SAME)],
  padded: ['Padded', B(SHARE_PAD)],
}, D);

framesDemo(G, 'perf-zerocopy', 'Zero-copy I/O', 'Count the copies between disk and wire: read+send, mmap, sendfile with scatter-gather DMA, and MSG_ZEROCOPY.', {
  copy: ['read + send', B(ZC_COPY)],
  mmap: ['mmap', B(ZC_MMAP)],
  sendfile: ['sendfile', B(ZC_SENDFILE)],
  msgzc: ['MSG_ZEROCOPY', B(ZC_MSG)],
}, D);

framesDemo(G, 'perf-copies', 'Avoiding copies in your code', 'Pass by value copies a heap block; const&, string_view and std::move hand over a pointer instead.', {
  byvalue: ['By value', B(CP_VALUE)],
  ref: ['const& / view', B(CP_REF)],
  move: ['std::move', B(CP_MOVE)],
}, D);

framesDemo(G, 'perf-measure', 'Measuring performance', 'The measure → locate → change one thing → re-measure loop, and what perf stat counters point to.', {
  loop: ['The loop', B(MEASURE_LOOP)],
  counters: ['Counters', B(MEASURE_COUNTERS)],
}, D);
