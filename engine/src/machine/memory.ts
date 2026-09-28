// Machine-level memory models (group 'machine-memory'): hierarchy, paging, faults, replacement, page cache, GC, NUMA, fork COW.
import type { Shape, Tone } from '../algo/frames';
import { arrow, box, Film, hex, line, machineDemo, panel, text } from './lib/draw';
import { BELADY_REFS, pageWalk, replace, STANDARD_REFS, WALK_VA } from './lib/sims';
import type { Policy } from './lib/sims';

const G = 'machine-memory';

// ---------------- hierarchy on a human time scale ----------------
const RUNGS: { name: string; ns: number; real: string; human: string }[] = [
  { name: 'L1 cache', ns: 1, real: '1 ns', human: '1 s' },
  { name: 'L2 cache', ns: 4, real: '4 ns', human: '4 s' },
  { name: 'L3 cache', ns: 12, real: '12 ns', human: '12 s' },
  { name: 'RAM', ns: 100, real: '100 ns', human: '~1.5 min' },
  { name: 'NVMe SSD', ns: 100e3, real: '100 µs', human: '~1 day' },
  { name: 'DC round trip', ns: 500e3, real: '0.5 ms', human: '~6 days' },
  { name: 'HDD seek', ns: 10e6, real: '10 ms', human: '~4 months' },
  { name: 'Cross-region', ns: 150e6, real: '150 ms', human: '~5 years' },
];

machineDemo({
  slug: 'mem-hierarchy',
  title: 'Memory hierarchy (human scale)',
  group: G,
  summary: 'Register → cache → RAM → SSD → network, with 1 ns stretched to 1 second.',
  linkedFrom: ['Memory', 'Redis'],
  inputs: [{ id: 'human', label: '1 ns = 1 s', data: {} }],
  build() {
    const f = new Film();
    const maxLog = Math.log10(RUNGS[RUNGS.length - 1].ns);
    const shapes = (upto: number): Shape[] => {
      const out: Shape[] = [text('hd', 500, 50, 'if 1 ns took 1 second…', { size: 32, bold: true })];
      RUNGS.forEach((r, i) => {
        const y = 90 + i * 110;
        const shown = i <= upto;
        const w = 60 + (Math.log10(r.ns) / maxLog) * 600;
        const tone: Tone = !shown ? 'muted' : i === upto ? 'current' : i < 3 ? 'ok' : i < 4 ? 'read' : 'warn';
        out.push(text(`n${i}`, 30, y + 45, r.name, { align: 'left', size: 28, tone: shown ? undefined : 'muted' }));
        out.push(box(`b${i}`, 300, y + 5, shown ? w : 40, 80, shown ? r.human : '', { tone, sub: shown ? r.real : undefined }));
      });
      return out;
    };
    const notes = [
      'L1 hit: ~1ns — one second on the human clock. Registers are faster still (~0.3s).',
      'L2: 4 seconds. Still on-core, still fast.',
      'L3: 12 seconds. Shared by all cores on the socket.',
      'RAM: ~100ns → about 1.5 minutes. This is why Redis (RAM) answers in µs, not ms.',
      'NVMe SSD read: ~100µs → about a day. A DB page miss costs a day; a buffer-pool hit costs a minute.',
      'Round trip inside a data center: ~0.5ms → almost a week. Every network hop is a week-long trip.',
      'Spinning disk seek: ~10ms → four months. Why HDDs only suit sequential IO.',
      'Cross-region round trip: ~150ms → about 5 years. Keep chatty calls inside one region.',
    ];
    const pn = (i: number) => panel('Scale', [['1 ns', '1 s'], ['level', i < 0 ? '—' : RUNGS[i].name], ['real', i < 0 ? '—' : RUNGS[i].real], ['human', i < 0 ? '—' : RUNGS[i].human, 'accent']]);
    f.add('Latency numbers are too small to feel. Stretch time so 1 nanosecond lasts 1 second.', shapes(-1), pn(-1));
    RUNGS.forEach((_, i) => f.add(notes[i], shapes(i), pn(i)));
    f.add('Each step down is 3–1000× slower. Good designs keep the hot path in the top rungs.', shapes(RUNGS.length - 1), pn(RUNGS.length - 1));
    return f.frames;
  },
});

// ---------------- virtual memory & page walk ----------------
const fmtVA = (va: number) => {
  const h = va.toString(16).toUpperCase().padStart(16, '0');
  return `0x${h.slice(0, 4)}_${h.slice(4, 8)}_${h.slice(8, 12)}_${h.slice(12)}`.replace('0x0000_0000_', '0x0000_');
};
const LEVEL_NAMES = ['PML4', 'PDPT', 'PD', 'PT'];
const RAM = [0x03, 0x12, 0x9c, null, null, null];

function walkShapes(o: { split: boolean; tlb: 'idle' | 'miss' | 'hit'; tlbHasVpn: boolean; level: number; frameLit: boolean; pa: string | null }): Shape[] {
  const w = pageWalk(WALK_VA);
  const out: Shape[] = [text('va', 40, 60, `virtual ${fmtVA(WALK_VA)}`, { align: 'left', size: 34, mono: true, bold: true })];
  out.push(box('vpn', 40, 100, 590, 90, o.split ? `VPN ${hex(w.vpn)}` : '', { tone: o.split ? 'accent' : 'muted', mono: true }));
  out.push(box('off', 650, 100, 310, 90, o.split ? `offset ${w.offset.toString(16).toUpperCase()}` : '', { tone: o.split ? 'path' : 'muted', mono: true }));
  out.push(text('tlbl', 40, 265, 'TLB', { align: 'left', size: 30, bold: true }));
  const entries = o.tlbHasVpn ? ['7F3A2→9C', '7F3A1→12', '0044→03'] : ['7F3A1→12', '0044→03', '…'];
  entries.forEach((e, i) => out.push(box(`tlb${i}`, 130 + i * 230, 225, 215, 80, e, { mono: true, tone: o.tlb === 'hit' && i === 0 && o.tlbHasVpn ? 'ok' : o.tlb === 'miss' ? 'muted' : 'default' })));
  if (o.tlb !== 'idle') out.push(text('tlbr', 950, 265, o.tlb === 'hit' ? 'hit ✓' : 'miss ✕', { align: 'right', size: 30, tone: o.tlb === 'hit' ? 'ok' : 'fail', bold: true }));
  LEVEL_NAMES.forEach((n, i) => {
    const x = 40 + i * 235;
    const tone: Tone = i < o.level ? 'visited' : i === o.level ? 'current' : 'muted';
    out.push(box(`lv${i}`, x, 380, 210, 100, `${n}[${w.idx[i]}]`, { tone, mono: true }));
    if (i < 3) out.push(arrow(`la${i}`, x + 210, 430, x + 235, 430, i < o.level ? 'path' : 'muted'));
  });
  out.push(text('rl', 40, 590, 'RAM frames', { align: 'left', size: 28, tone: 'muted' }));
  RAM.forEach((fr, i) => out.push(box(`fr${i}`, 40 + i * 155, 620, 140, 100, fr === null ? '' : fr.toString(16).toUpperCase().padStart(2, '0'), { mono: true, tone: fr === 0x9c && o.frameLit ? 'ok' : fr === null ? 'muted' : 'default' })));
  if (o.frameLit) out.push(arrow('toframe', 40 + 3 * 235 + 105, 480, 40 + 2 * 155 + 70, 620, 'path'));
  if (o.pa) out.push(text('pa', 40, 820, `physical ${o.pa}`, { align: 'left', size: 36, mono: true, bold: true, tone: 'ok' }));
  return out;
}

machineDemo({
  slug: 'mem-paging',
  title: 'Page table walk',
  group: G,
  summary: 'Virtual address → VPN|offset, TLB lookup, 4-level walk (PML4→PDPT→PD→PT), physical frame.',
  linkedFrom: ['Paging', 'Memory'],
  inputs: [
    { id: 'miss', label: 'TLB miss', data: { tlb: 'miss' } },
    { id: 'hit', label: 'TLB hit', data: { tlb: 'hit' } },
  ],
  build({ tlb }: { tlb: 'miss' | 'hit' }) {
    const f = new Film();
    const w = pageWalk(WALK_VA);
    const pa = `0x${w.frame!.toString(16).toUpperCase()} ${w.offset.toString(16).toUpperCase()}`;
    let reads = 0;
    const pn = (tl: string, ns: number, phys = '—') =>
      panel('Translation', [
        ['virtual', hex(WALK_VA)],
        ['VPN', hex(w.vpn)],
        ['offset', hex(w.offset)],
        ['TLB', tl, tl === 'miss' ? 'fail' : tl === 'hit' ? 'ok' : undefined],
        ['table reads', reads],
        ['extra time', `${ns} ns`],
        ['physical', phys, phys === '—' ? undefined : 'ok'],
      ]);
    const base = { split: false, tlb: 'idle' as const, tlbHasVpn: tlb === 'hit', level: -1, frameLit: false, pa: null };
    f.add('The program loads from a virtual address. Every process sees its own private address space.', walkShapes(base), pn('—', 0));
    f.add('4 KB pages: the low 12 bits are the offset inside the page, the rest is the virtual page number (VPN).', walkShapes({ ...base, split: true }), pn('—', 0));
    if (tlb === 'hit') {
      f.add('TLB lookup: VPN 0x7F3A2 is cached → frame 0x9C. ~1 cycle, no table reads.', walkShapes({ ...base, split: true, tlb: 'hit', frameLit: true }), pn('hit', 0));
      f.add(`Physical = frame 0x9C + offset 0xC41 = ${hex(w.pa!)}. ~99% of accesses take this path.`, walkShapes({ ...base, split: true, tlb: 'hit', frameLit: true, pa }), pn('hit', 0, hex(w.pa!)));
      return f.frames;
    }
    f.add('TLB miss: the translation isn’t cached. The CPU must walk the page table in RAM.', walkShapes({ ...base, split: true, tlb: 'miss' }), pn('miss', 0));
    const notes = [
      `CR3 points to the PML4; bits 47–39 pick entry ${w.idx[0]}. 1 memory read (~100ns if it misses cache).`,
      `PDPT entry ${w.idx[1]} (bits 38–30) → next table. 2 reads so far.`,
      `PD entry ${w.idx[2]} (bits 29–21) → the page table. 3 reads.`,
      `PT entry ${w.idx[3]} (bits 20–12) holds frame 0x9C, present=1. TLB missed, so the walk cost 4 extra memory reads (~400ns).`,
    ];
    for (let i = 0; i < 4; i++) {
      reads++;
      f.add(notes[i], walkShapes({ ...base, split: true, tlb: 'miss', level: i, frameLit: i === 3 }), pn('miss', reads * 100));
    }
    f.add(`Physical address = frame 0x9C | offset 0xC41 = ${hex(w.pa!)}. The TLB caches 7F3A2→9C for next time.`, walkShapes({ ...base, split: true, tlb: 'miss', tlbHasVpn: true, level: 4, frameLit: true, pa }), pn('miss', 400, hex(w.pa!)));
    f.add('Huge pages (2 MB) skip the PT level and cover 512× more memory per TLB entry — fewer misses for big heaps.', walkShapes({ ...base, split: true, tlb: 'hit', tlbHasVpn: true, level: 4, frameLit: true, pa }), pn('miss', 400, hex(w.pa!)));
    return f.frames;
  },
});

// ---------------- page fault ----------------
function faultShapes(o: { step: string; present: boolean; frame: string; dirty: boolean; ramFilled: boolean; diskLit: boolean; tone?: Tone }): Shape[] {
  const out: Shape[] = [
    box('cpu', 40, 60, 400, 150, 'CPU', { sub: o.step, tone: o.tone ?? 'default' }),
    box('os', 560, 60, 400, 150, 'OS kernel', { sub: 'fault handler', tone: o.tone === 'protocol' ? 'protocol' : 'default' }),
    text('ptel', 40, 290, 'PTE for VPN 0x7F3A2', { align: 'left', size: 28, tone: 'muted' }),
    box('pteP', 40, 310, 200, 100, `P=${o.present ? 1 : 0}`, { tone: o.present ? 'ok' : 'fail', mono: true }),
    box('pteD', 260, 310, 200, 100, `D=${o.dirty ? 1 : 0}`, { tone: o.dirty ? 'write' : 'default', mono: true }),
    box('pteF', 480, 310, 480, 100, `frame ${o.frame}`, { mono: true, tone: o.frame === '—' ? 'muted' : 'default' }),
    text('raml', 40, 490, 'RAM', { align: 'left', size: 28, tone: 'muted' }),
  ];
  for (let i = 0; i < 5; i++) out.push(box(`ram${i}`, 40 + i * 185, 520, 170, 110, i === 2 ? (o.ramFilled ? '9C' : 'free') : ['03', '12', '', '41', '7A'][i], { mono: true, tone: i === 2 ? (o.ramFilled ? 'ok' : 'muted') : 'default' }));
  out.push(box('disk', 250, 740, 500, 160, 'SSD / swap / file', { sub: '4 KB page', tone: o.diskLit ? 'read' : 'default' }));
  if (o.diskLit) out.push(arrow('dma', 500, 740, 40 + 2 * 185 + 85, 630, 'read'));
  return out;
}

machineDemo({
  slug: 'mem-page-fault',
  title: 'Page fault',
  group: G,
  summary: 'PTE not present → trap to the OS → load page from disk → update PTE → restart the instruction.',
  linkedFrom: ['Paging'],
  inputs: [
    { id: 'major', label: 'Major fault (SSD)', data: { major: true } },
    { id: 'minor', label: 'Minor fault (no IO)', data: { major: false } },
  ],
  build({ major }: { major: boolean }) {
    const f = new Film();
    const pn = (ns: string, faults: number, io: string) => panel('Fault', [['elapsed', ns], ['page faults', faults, faults ? 'warn' : undefined], ['disk IO', io]]);
    const b = { present: false, frame: '—', dirty: false, ramFilled: false, diskLit: false };
    f.add('mov (0x7F3A2C41) → rax: the TLB misses and the walk reaches a PTE with present = 0.', faultShapes({ ...b, step: 'load 0x7F3A2C41' }), pn('0.4 µs', 0, 'none'));
    f.add('The CPU raises a page-fault exception (#PF) with the address in CR2 and jumps into the kernel.', faultShapes({ ...b, step: '#PF trap', tone: 'fail' }), pn('0.6 µs', 1, 'none'));
    f.add('The kernel checks the address is in a valid mapping (else SIGSEGV) and grabs a free frame: 0x9C.', faultShapes({ ...b, step: 'waiting', tone: 'protocol' }), pn('1 µs', 1, 'none'));
    if (major) f.add('Major fault: the page lives on SSD. Read 4 KB via DMA, ~100µs — the thread sleeps, the core runs others.', faultShapes({ ...b, step: 'sleeping', diskLit: true, tone: 'protocol' }), pn('~100 µs', 1, '4 KB read'));
    else f.add('Minor fault: the page is already in the page cache (or it’s a fresh zero page). No IO, ~1µs.', faultShapes({ ...b, step: 'waiting', tone: 'protocol', ramFilled: true }), pn('~1 µs', 1, 'none'));
    f.add('The kernel writes PTE: present = 1, frame = 0x9C. Dirty stays 0 until someone writes the page.', faultShapes({ ...b, step: 'waiting', present: true, frame: '0x9C', ramFilled: true, tone: 'protocol' }), pn(major ? '~101 µs' : '~2 µs', 1, major ? '4 KB read' : 'none'));
    f.add('Return from the trap and restart the same instruction. This time the walk succeeds: physical 0x9CC41.', faultShapes({ ...b, step: 'load ✓', present: true, frame: '0x9C', ramFilled: true, tone: 'ok' }), pn(major ? '~101 µs' : '~2 µs', 1, major ? '4 KB read' : 'none'));
    f.add(
      major ? 'A later write sets D=1, so eviction must write it back. Thousands of major faults/s = swapping = p99 disaster.' : 'A later write sets D=1. Minor faults are cheap, but a burst of them (new heap, fork) still shows up in p99.',
      faultShapes({ ...b, step: 'store ✓', present: true, frame: '0x9C', dirty: true, ramFilled: true, tone: 'ok' }),
      pn(major ? '~101 µs' : '~2 µs', 1, major ? '4 KB read' : 'none'),
    );
    return f.frames;
  },
});

// ---------------- page replacement ----------------
function replFilm(f: Film, policy: Policy, refs: number[], nFrames: number, tag: string, extra: [string, string][] = []) {
  const { steps, faults } = replace(policy, refs, nFrames);
  const cw = Math.min(46, Math.floor(940 / refs.length));
  const shapes = (upto: number): Shape[] => {
    const out: Shape[] = [text('pol', 30, 50, `${policy.toUpperCase()} · ${nFrames} frames${tag}`, { align: 'left', size: 32, bold: true })];
    refs.forEach((r, i) => {
      const s = steps[i];
      const tone: Tone = i === upto ? 'current' : i < upto ? (s.fault ? 'fail' : 'ok') : 'muted';
      out.push(box(`r${i}`, 30 + i * cw, 90, cw - 4, 70, String(r), { tone, mono: true }));
      if (i <= upto && s.fault) out.push(text(`fx${i}`, 30 + i * cw + (cw - 4) / 2, 195, 'F', { size: 24, tone: 'fail', bold: true }));
    });
    const s = upto >= 0 ? steps[upto] : null;
    const fr = s ? s.frames : Array(nFrames).fill(null);
    fr.forEach((p, k) => {
      const lit = s && s.slot === k;
      const tone: Tone = lit ? (s.fault ? 'fail' : 'ok') : p === null ? 'muted' : 'default';
      const sub = s?.refBits ? `ref bit ${s.refBits[k] ? 1 : 0}` : undefined;
      out.push(box(`f${k}`, 200, 260 + k * 150, 400, 130, p === null ? 'empty' : `page ${p}`, { tone, sub }));
    });
    if (s?.hand !== undefined) out.push(arrow('hand', 700, 260 + s.hand * 150 + 65, 610, 260 + s.hand * 150 + 65, 'accent'));
    if (s?.victim !== undefined) out.push(text('vic', 650, 900, `evicted page ${s.victim}`, { size: 30, tone: 'fail' }));
    return out;
  };
  let seen = 0;
  const pn = (i: number) => panel(policy.toUpperCase(), [['ref', i < 0 ? '—' : `${steps[i].ref} (${i + 1}/${refs.length})`], ['frames', nFrames], ['faults', seen, 'fail'], ['hits', i + 1 - seen, 'ok'], ...extra.map(([a, b]) => [a, b] as [string, string])]);
  const why: Record<Policy, string> = {
    fifo: 'evict the page loaded longest ago',
    lru: 'evict the page unused for longest',
    clock: 'hand skips ref-bit 1 pages (clearing them), evicts first 0',
  };
  f.add(`${policy.toUpperCase()} with ${nFrames} frames: on a fault, ${why[policy]}.`, shapes(-1), pn(-1));
  steps.forEach((s, i) => {
    if (s.fault) seen++;
    const note = !s.fault ? `Page ${s.ref}: hit, already in a frame.` : s.victim === undefined ? `Page ${s.ref}: fault, load into a free frame (~100µs from SSD).` : `Page ${s.ref}: fault, evict page ${s.victim} — ${why[policy]}.`;
    f.add(note, shapes(i), pn(i));
  });
  return faults;
}

machineDemo({
  slug: 'mem-page-replacement',
  title: 'Page replacement',
  group: G,
  summary: 'FIFO vs LRU vs Clock on a reference string; Belady’s anomaly for FIFO.',
  linkedFrom: ['Paging'],
  inputs: [
    { id: 'fifo', label: 'FIFO · 3 frames', data: { policy: 'fifo', frames: 3 } },
    { id: 'lru', label: 'LRU · 3 frames', data: { policy: 'lru', frames: 3 } },
    { id: 'clock', label: 'Clock · 3 frames', data: { policy: 'clock', frames: 3 } },
    { id: 'belady', label: 'Belady’s anomaly', data: { policy: 'fifo', belady: true } },
  ],
  build(d: { policy: Policy; frames?: number; belady?: boolean }) {
    const f = new Film();
    if (d.belady) {
      const f3 = replace('fifo', BELADY_REFS, 3).faults;
      const f4 = replace('fifo', BELADY_REFS, 4).faults;
      replFilm(f, 'fifo', BELADY_REFS, 3, ' (run 1)');
      replFilm(f, 'fifo', BELADY_REFS, 4, ' (run 2)', [['3 frames', `${f3} faults`]]);
      f.add(`Belady’s anomaly: FIFO with 4 frames faults ${f4} times, more than ${f3} with 3. LRU never does this (it’s a stack algorithm).`, [
        box('a3', 100, 250, 350, 300, `${f3}`, { sub: 'faults · 3 frames', tone: 'ok' }),
        box('a4', 550, 250, 350, 300, `${f4}`, { sub: 'faults · 4 frames', tone: 'fail' }),
        text('am', 500, 700, 'more RAM, more faults', { size: 36, bold: true, tone: 'warn' }),
      ], panel('FIFO', [['faults (3 frames)', f3, 'ok'], ['faults (4 frames)', f4, 'fail']]));
      return f.frames;
    }
    const n = d.frames ?? 3;
    const faults = replFilm(f, d.policy, STANDARD_REFS, n, '');
    const all = (['fifo', 'lru', 'clock'] as Policy[]).map((p) => [p.toUpperCase(), String(replace(p, STANDARD_REFS, n).faults)] as [string, string]);
    f.add(`${faults} faults on 20 refs. Same string: ${all.map(([a, b]) => `${a} ${b}`).join(', ')}; Clock approximates LRU with 1 bit per page.`, [
      ...all.map(([p, v], i) => box(`cmp${i}`, 60 + i * 310, 300, 260, 260, v, { sub: `${p} faults`, tone: p === d.policy.toUpperCase() ? 'current' : 'default' })),
      text('cm', 500, 700, 'when the working set > RAM, every policy thrashes', { size: 28, tone: 'muted' }),
    ], panel('Faults (3 frames)', all));
    return f.frames;
  },
});

// ---------------- page cache, fsync, mmap ----------------
function pcShapes(o: { app: string; pages: (string | null)[]; dirty: boolean[]; disk: Tone; flow?: 'up' | 'down' | 'map'; appTone?: Tone }): Shape[] {
  const out: Shape[] = [
    box('app', 40, 50, 920, 170, 'app process', { sub: o.app, tone: o.appTone ?? 'default' }),
    text('pcl', 40, 300, 'page cache (kernel RAM)', { align: 'left', size: 28, tone: 'muted' }),
  ];
  o.pages.forEach((p, i) => out.push(box(`pg${i}`, 40 + i * 235, 330, 215, 150, p ?? 'free', { tone: p === null ? 'muted' : o.dirty[i] ? 'write' : 'read', sub: p === null ? undefined : o.dirty[i] ? 'dirty' : 'clean', mono: true })));
  out.push(box('disk', 200, 700, 600, 180, 'NVMe SSD', { sub: 'file data.db', tone: o.disk }));
  if (o.flow === 'up') out.push(arrow('fl', 500, 700, 500, 480, 'read', { width: 6 }));
  if (o.flow === 'down') out.push(arrow('fl', 500, 480, 500, 700, 'write', { width: 6 }));
  if (o.flow === 'map') out.push(arrow('fl', 157, 220, 157, 330, 'accent', { width: 6, dashed: true }));
  return out;
}

machineDemo({
  slug: 'mem-page-cache',
  title: 'Page cache, fsync, mmap',
  group: G,
  summary: 'File reads cached in RAM; writes are dirty pages until fsync; mmap maps the cache into the process.',
  linkedFrom: ['Memory', 'Kafka', 'Storage'],
  inputs: [
    { id: 'read', label: 'Read twice', data: { mode: 'read' } },
    { id: 'fsync', label: 'Write + fsync', data: { mode: 'fsync' } },
    { id: 'mmap', label: 'mmap', data: { mode: 'mmap' } },
  ],
  build({ mode }: { mode: 'read' | 'fsync' | 'mmap' }) {
    const f = new Film();
    const empty: (string | null)[] = [null, null, null, null];
    const clean = [false, false, false, false];
    const pn = (lat: string, sys: number, io: string, durable?: string) => panel('IO', [['latency', lat], ['syscalls', sys], ['disk IO', io], ...(durable ? [['durable', durable, durable === 'yes' ? 'ok' : 'fail'] as [string, string, Tone]] : [])]);
    if (mode === 'read') {
      f.add('read(fd, 4 KB at offset 0): the kernel first looks in the page cache. Empty — cold start.', pcShapes({ app: 'read() #1', pages: empty, dirty: clean, disk: 'default' }), pn('—', 1, 'none'));
      f.add('Miss: the SSD DMAs the 4 KB page into a free RAM page (~100µs). The kernel may read ahead the next pages too.', pcShapes({ app: 'blocked', pages: ['p0', 'p1', null, null], dirty: clean, disk: 'read', flow: 'up' }), pn('~100 µs', 1, '8 KB'));
      f.add('The kernel copies 4 KB to the app buffer (~1µs). read() returns.', pcShapes({ app: 'got 4 KB', pages: ['p0', 'p1', null, null], dirty: clean, disk: 'default', appTone: 'ok' }), pn('~101 µs', 1, '8 KB'));
      f.add('Read #2 (same or next page): page-cache hit, no IO at all. ~1–2µs — 50× faster.', pcShapes({ app: 'read() #2 ✓', pages: ['p0', 'p1', null, null], dirty: clean, disk: 'default', appTone: 'ok' }), pn('~2 µs', 2, '8 KB'));
      f.add('Free RAM becomes page cache automatically. Kafka leans on it; Postgres keeps its own buffer pool on top.', pcShapes({ app: 'idle', pages: ['p0', 'p1', null, null], dirty: clean, disk: 'default' }), pn('~2 µs', 2, '8 KB'));
    } else if (mode === 'fsync') {
      f.add('write(fd, 4 KB): the data lands in a page-cache page, marked dirty. write() returns in ~2µs.', pcShapes({ app: 'write() ✓', pages: ['p0', null, null, null], dirty: [true, false, false, false], disk: 'default', appTone: 'ok' }), pn('~2 µs', 1, 'none', 'no'));
      f.add('Nothing is on the SSD yet. Power loss now = the write is gone, even though the app saw success.', pcShapes({ app: 'thinks it’s saved', pages: ['p0', null, null, null], dirty: [true, false, false, false], disk: 'fail', appTone: 'warn' }), pn('~2 µs', 1, 'none', 'no'));
      f.add('fsync(fd): the kernel writes dirty pages and issues a device FLUSH. The app blocks ~0.1–2 ms.', pcShapes({ app: 'fsync() blocked', pages: ['p0', null, null, null], dirty: [true, false, false, false], disk: 'write', flow: 'down', appTone: 'warn' }), pn('~1 ms', 2, '4 KB + flush', 'no'));
      f.add('Done: page clean, data durable. Databases group-commit many transactions per fsync to amortise this.', pcShapes({ app: 'fsync() ✓', pages: ['p0', null, null, null], dirty: clean, disk: 'ok', appTone: 'ok' }), pn('~1 ms', 2, '4 KB + flush', 'yes'));
    } else {
      f.add('mmap(file) maps the file into the address space. No data is read yet — just page table entries marked not-present.', pcShapes({ app: 'ptr = mmap(data.db)', pages: empty, dirty: clean, disk: 'default' }), pn('~5 µs', 1, 'none'));
      f.add('First touch of ptr[0]: page fault. The kernel reads the page into the page cache (~100µs).', pcShapes({ app: 'x = ptr[0] (fault)', pages: ['p0', null, null, null], dirty: clean, disk: 'read', flow: 'up', appTone: 'warn' }), pn('~100 µs', 1, '4 KB'));
      f.add('The PTE now points straight at the page-cache page. No copy into a user buffer.', pcShapes({ app: 'x = ptr[0] ✓', pages: ['p0', null, null, null], dirty: clean, disk: 'default', flow: 'map', appTone: 'ok' }), pn('~100 µs', 1, '4 KB'));
      f.add('Further reads are plain memory loads: ~100ns, zero syscalls. Writes dirty the page; msync/fsync flush it.', pcShapes({ app: 'ptr[1..511] ✓', pages: ['p0', null, null, null], dirty: [true, false, false, false], disk: 'default', flow: 'map', appTone: 'ok' }), pn('~0.1 µs', 1, '4 KB'));
      f.add('Catch: a miss is an invisible page fault that blocks the thread. LMDB and MongoDB’s old engine used mmap.', pcShapes({ app: 'ptr[9999] → fault', pages: ['p0', 'p9', null, null], dirty: [true, false, false, false], disk: 'read', flow: 'up', appTone: 'warn' }), pn('~100 µs', 1, '8 KB'));
    }
    return f.frames;
  },
});

// ---------------- allocation & GC ----------------
type Cell = { owner: string | null; tone: Tone };

function heapShapes(title: string, cells: Cell[], extra: Shape[] = []): Shape[] {
  const out: Shape[] = [text('ht', 40, 60, title, { align: 'left', size: 32, bold: true })];
  cells.forEach((c, i) => out.push(box(`h${i}`, 40 + (i % 8) * 115, 110 + Math.floor(i / 8) * 165, 105, 150, c.owner ?? '', { tone: c.owner ? c.tone : 'muted', mono: true })));
  return [...out, ...extra];
}

machineDemo({
  slug: 'mem-gc',
  title: 'Allocation & GC',
  group: G,
  summary: 'Heap fragmentation with malloc/free; generational GC with a stop-the-world pause.',
  linkedFrom: ['Memory', 'GC pause'],
  inputs: [
    { id: 'frag', label: 'Fragmentation', data: { mode: 'frag' } },
    { id: 'gen', label: 'Generational GC', data: { mode: 'gen' } },
  ],
  build({ mode }: { mode: 'frag' | 'gen' }) {
    const f = new Film();
    if (mode === 'frag') {
      const cells: Cell[] = Array.from({ length: 16 }, () => ({ owner: null, tone: 'default' }));
      const pn = (used: number, largest: number, res: string) => panel('Heap (1 cell = 8 KB)', [['used', `${used * 8} KB`], ['free', `${(16 - used) * 8} KB`], ['largest hole', `${largest * 8} KB`], ['result', res]]);
      const holes = () => {
        let best = 0;
        let run = 0;
        for (const c of cells) {
          run = c.owner ? 0 : run + 1;
          best = Math.max(best, run);
        }
        return best;
      };
      const used = () => cells.filter((c) => c.owner).length;
      f.add('A 128 KB heap. Stack frames are freed automatically; heap objects live until free() or GC.', heapShapes('heap: 16 × 8 KB', cells), pn(0, 16, '—'));
      'ABCDEFGH'.split('').forEach((o, i) => {
        cells[i * 2] = { owner: o, tone: 'write' };
        cells[i * 2 + 1] = { owner: o, tone: 'write' };
      });
      f.add('Allocate 8 objects of 16 KB each (A–H). The heap is full and compact.', heapShapes('heap: 16 × 8 KB', cells), pn(used(), holes(), 'ok'));
      for (const i of [0, 2, 4, 6]) {
        cells[i * 2] = { owner: null, tone: 'default' };
        cells[i * 2 + 1] = { owner: null, tone: 'default' };
      }
      f.add('Free A, C, E, G. 64 KB is free again — but in four separate 16 KB holes.', heapShapes('heap: 16 × 8 KB', cells), pn(used(), holes(), '—'));
      f.add('malloc(32 KB) fails to fit: no hole is big enough. The allocator must grow the heap (mmap more RAM).', heapShapes('heap: 16 × 8 KB', cells, [box('want', 300, 560, 400, 130, 'need 32 KB', { tone: 'fail' })]), pn(used(), holes(), 'no fit'));
      f.add('That’s fragmentation: RSS grows while "free" memory sits unused. jemalloc size classes and compacting GCs fight it.', heapShapes('heap: 16 × 8 KB', cells), pn(used(), holes(), 'RSS +32 KB'));
      return f.frames;
    }
    const young: Cell[] = Array.from({ length: 8 }, () => ({ owner: null, tone: 'default' }));
    const old: Cell[] = Array.from({ length: 8 }, () => ({ owner: null, tone: 'default' }));
    let pause = 0;
    let gcs = 0;
    const view = (note: string, hl?: Tone) => {
      const cells = [...young, ...old];
      f.add(
        note,
        heapShapes('eden (young) · old gen', cells, [
          text('yl', 40, 470, 'row 1: young (eden) · row 2: old gen', { align: 'left', size: 26, tone: 'muted' }),
          box('app', 40, 540, 920, 140, hl === 'fail' ? 'app threads STOPPED' : 'app threads running', { tone: hl === 'fail' ? 'fail' : 'ok' }),
        ]),
        panel('GC', [['young used', `${young.filter((c) => c.owner).length}/8`], ['old used', `${old.filter((c) => c.owner).length}/8`], ['GCs', gcs], ['total pause', `${pause} ms`, pause > 100 ? 'fail' : pause ? 'warn' : undefined]]),
      );
    };
    view('Young objects go to eden: cheap bump-pointer allocation, ~10ns each.');
    for (let i = 0; i < 8; i++) young[i] = { owner: `o${i}`, tone: i === 2 || i === 5 ? 'write' : 'muted' };
    view('Eden is full after a burst of requests. Most of these objects (grey) are already garbage.');
    gcs++;
    pause += 5;
    view('Minor GC: stop the world, trace only the young gen, copy 2 live objects out. ~5 ms pause.', 'fail');
    for (let i = 0; i < 8; i++) young[i] = { owner: null, tone: 'default' };
    old[0] = { owner: 'o2', tone: 'write' };
    old[1] = { owner: 'o5', tone: 'write' };
    view('Survivors are promoted to the old gen; eden is empty again. Cost ∝ live objects, not garbage.');
    for (let i = 2; i < 8; i++) old[i] = { owner: `L${i}`, tone: 'write' };
    view('Hours later a cache fills the old gen with long-lived objects. Old gen is 100% full.');
    gcs++;
    pause += 800;
    view('Full GC: mark and compact the whole heap. ~800 ms stop-the-world on a big heap — this is the p99 spike.', 'fail');
    for (let i = 2; i < 8; i++) old[i] = { owner: i % 2 ? `L${i}` : null, tone: 'write' };
    view('Fixes: smaller heaps, G1/ZGC concurrent collectors (<10 ms pauses), or less garbage per request.');
    return f.frames;
  },
});

// ---------------- NUMA ----------------
function numaShapes(o: { threadOn: 0 | 1; memOn: 0 | 1; lit: boolean }): Shape[] {
  const out: Shape[] = [];
  for (const s of [0, 1]) {
    const x = 40 + s * 500;
    out.push(box(`sock${s}`, x, 60, 420, 330, undefined, { tone: 'default', filled: false }));
    out.push(text(`sl${s}`, x + 20, 100, `socket ${s}`, { align: 'left', size: 28, bold: true }));
    for (let c = 0; c < 4; c++) out.push(box(`c${s}-${c}`, x + 20 + (c % 2) * 195, 130 + Math.floor(c / 2) * 120, 180, 100, o.threadOn === s && c === 0 ? 'T1' : `core ${c}`, { tone: o.threadOn === s && c === 0 ? 'current' : 'muted' }));
    out.push(box(`dram${s}`, x, 560, 420, 200, `DRAM node ${s}`, { sub: o.memOn === s ? 'T1’s data' : '32 GB', tone: o.memOn === s ? 'read' : 'default' }));
    out.push(line(`mc${s}`, x + 210, 390, x + 210, 560, 'muted', { width: 6 }));
  }
  out.push(line('upi', 460, 225, 540, 225, o.threadOn !== o.memOn && o.lit ? 'warn' : 'muted', { width: 10 }));
  out.push(text('upil', 500, 450, 'UPI link', { size: 26, tone: 'muted' }));
  if (o.lit) {
    const from = 40 + o.threadOn * 500 + 110;
    const to = 40 + o.memOn * 500 + 210;
    out.push(arrow('acc', from, 230, to, 560, o.threadOn === o.memOn ? 'ok' : 'warn', { width: 6 }));
  }
  return out;
}

machineDemo({
  slug: 'mem-numa',
  title: 'NUMA',
  group: G,
  summary: 'Two sockets, each with local DRAM; remote access crosses the socket link and costs ~1.5×.',
  linkedFrom: ['Memory'],
  inputs: [
    { id: 'local', label: 'Local access', data: { remote: false } },
    { id: 'remote', label: 'Thread migrated', data: { remote: true } },
  ],
  build({ remote }: { remote: boolean }) {
    const f = new Film();
    const pn = (lat: string, bw: string) => panel('NUMA', [['latency', lat], ['bandwidth', bw], ['policy', 'first-touch']]);
    f.add('A 2-socket server: each socket has its own memory controller and DRAM. One address space, two distances.', numaShapes({ threadOn: 0, memOn: 0, lit: false }), pn('—', '—'));
    f.add('T1 on socket 0 first touches its buffer, so Linux allocates it on node 0 (first-touch policy).', numaShapes({ threadOn: 0, memOn: 0, lit: true }), pn('~90 ns', '~100 GB/s'));
    if (!remote) {
      f.add('Every miss goes to local DRAM: ~90ns. Pinning threads and memory together (numactl) keeps it that way.', numaShapes({ threadOn: 0, memOn: 0, lit: true }), pn('~90 ns', '~100 GB/s'));
      return f.frames;
    }
    f.add('The scheduler moves T1 to socket 1 to balance load. Its data stays on node 0.', numaShapes({ threadOn: 1, memOn: 0, lit: false }), pn('—', '—'));
    f.add('Now every miss crosses the UPI link: ~140ns (~1.5×) and the link’s bandwidth is shared by both sockets.', numaShapes({ threadOn: 1, memOn: 0, lit: true }), pn('~140 ns', '~40 GB/s'));
    f.add('Big DBs and JVMs show 10–30% slowdowns from this. Fix: pin per socket, or interleave memory evenly.', numaShapes({ threadOn: 1, memOn: 0, lit: true }), pn('~140 ns', '~40 GB/s'));
    return f.frames;
  },
});

// ---------------- fork() copy-on-write ----------------
function cowShapes(o: { child: boolean; copied: boolean; ro: boolean; fault: boolean }): Shape[] {
  const rowY = (i: number) => 260 + i * 130;
  const out: Shape[] = [
    box('par', 40, 50, 300, 130, 'parent (Redis)', { sub: 'serving writes', tone: 'default' }),
    text('ptp', 40, 225, 'page table', { align: 'left', size: 28 }),
    text('rl', 500, 225, 'RAM frames', { size: 28 }),
  ];
  const pages = ['A', 'B', 'C'];
  pages.forEach((p, i) => out.push(box(`pp${i}`, 40, rowY(i), 300, 100, `${p} ${o.ro ? 'R/O' : 'R/W'}`, { mono: true, tone: i === 1 && o.fault ? 'fail' : 'default' })));
  if (o.child) {
    out.push(box('chi', 660, 50, 300, 130, 'child (RDB save)', { sub: 'writes dump.rdb', tone: 'accent' }));
    out.push(text('ptc', 960, 225, 'page table', { align: 'right', size: 28 }));
    pages.forEach((p, i) => out.push(box(`cp${i}`, 660, rowY(i), 300, 100, `${p} R/O`, { mono: true, tone: 'default' })));
  }
  const frames = o.copied ? ['A', 'B', 'C', 'B′'] : ['A', 'B', 'C'];
  frames.forEach((p, i) => out.push(box(`fr${i}`, 420, rowY(i), 160, 100, p, { mono: true, tone: i === 3 ? 'write' : 'read' })));
  pages.forEach((_, i) => {
    const tgt = o.copied && i === 1 ? 3 : i;
    out.push(line(`pl${i}`, 340, rowY(i) + 50, 420, rowY(tgt) + 50, i === 1 && o.copied ? 'write' : 'muted', { width: i === 1 && o.copied ? 5 : 3 }));
    if (o.child) out.push(line(`cl${i}`, 660, rowY(i) + 50, 580, rowY(i) + 50, 'muted', { dashed: true }));
  });
  return out;
}

machineDemo({
  slug: 'mem-fork-cow',
  title: 'fork() copy-on-write',
  group: G,
  summary: 'fork shares pages read-only; the first write faults and copies one page (Redis RDB snapshots).',
  linkedFrom: ['Memory', 'Redis'],
  inputs: [{ id: 'redis', label: 'Redis BGSAVE', data: {} }],
  build() {
    const f = new Film();
    const pn = (rss: string, copied: number, faults: number) => panel('Memory', [['shared pages', 3 - copied], ['copied pages', copied, copied ? 'write' : undefined], ['COW faults', faults], ['RSS', rss]]);
    f.add('Redis holds its dataset in RAM pages A, B, C. BGSAVE wants a consistent snapshot without stopping writes.', cowShapes({ child: false, copied: false, ro: false, fault: false }), pn('3 pages', 0, 0));
    f.add('fork(): the child gets a copy of the page table only (~10 ms per GB of RSS), not the data. All pages are marked read-only.', cowShapes({ child: true, copied: false, ro: true, fault: false }), pn('3 pages', 0, 0));
    f.add('The child reads every page and streams dump.rdb to disk. Reads of shared pages cost nothing extra.', cowShapes({ child: true, copied: false, ro: true, fault: false }), pn('3 pages', 0, 0));
    f.add('Parent handles SET on a key in page B: write to a read-only page → page fault.', cowShapes({ child: true, copied: false, ro: true, fault: true }), pn('3 pages', 0, 1));
    f.add('Kernel copies B into a new frame B′ (4 KB, ~1µs), points the parent at it R/W, restarts the write. The child still sees old B.', cowShapes({ child: true, copied: true, ro: true, fault: false }), pn('4 pages', 1, 1));
    f.add('Extra RAM = pages written during the save. Write-heavy Redis can nearly double RSS; with 2 MB huge pages each fault copies 512× more, so disable THP.', cowShapes({ child: true, copied: true, ro: true, fault: false }), pn('4 pages', 1, 1));
    return f.frames;
  },
});
