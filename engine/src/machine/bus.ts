// Machine-level chips & buses (group 'machine-bus'): bus cycle, DRAM, PCIe, DMA, SSD/HDD, host networking, event loop.
import type { Shape, Tone } from '../algo/frames';
import { arrow, box, dot, Film, line, machineDemo, panel, text } from './lib/draw';

const G = 'machine-bus';

// ---------------- bus read cycle ----------------
function clock(now: number, n: number): Shape[] {
  const out: Shape[] = [text('clkl', 40, 730, 'clock', { align: 'left', size: 26, tone: 'muted' })];
  const w = Math.floor(880 / n);
  for (let i = 0; i < n; i++) {
    const x = 80 + i * w;
    const tone: Tone = i + 1 === now ? 'current' : i + 1 < now ? 'visited' : 'muted';
    out.push(line(`ch${i}`, x, 770, x + w / 2, 770, tone), line(`cf${i}`, x + w / 2, 770, x + w / 2, 850, tone), line(`cl${i}`, x + w / 2, 850, x + w, 850, tone), line(`cr${i}`, x + w, 850, x + w, 770, tone));
    out.push(text(`ct${i}`, x + w / 4, 900, `T${i + 1}`, { size: 26, tone }));
  }
  return out;
}

function busShapes(o: { now: number; n: number; addr?: boolean; ctrl?: string; data?: boolean; rowBuf: string; rowTone: Tone; cmd: string[]; cmdAt: number; lit: 'cpu' | 'mc' | 'dram' | null }): Shape[] {
  const t = (k: string): Tone => (o.lit === k ? 'current' : 'default');
  const out: Shape[] = [
    box('cpu', 40, 60, 220, 150, 'CPU', { sub: 'L3 missed', tone: t('cpu') }),
    box('mc', 390, 60, 220, 150, 'mem ctrl', { tone: t('mc') }),
    box('dram', 740, 60, 220, 150, 'DRAM', { sub: 'bank 2 row 88', tone: t('dram') }),
    arrow('abus', 260, 270, 740, 270, o.addr ? 'accent' : 'muted', { width: o.addr ? 7 : 3 }),
    text('abl', 500, 238, o.addr ? 'address bus: 0x1F40' : 'address bus', { size: 26, tone: o.addr ? 'accent' : 'muted', mono: true }),
    arrow('cbus', 260, 360, 740, 360, o.ctrl ? 'protocol' : 'muted', { width: o.ctrl ? 7 : 3 }),
    text('cbl', 500, 328, o.ctrl ? `control: ${o.ctrl}` : 'control', { size: 26, tone: o.ctrl ? 'protocol' : 'muted', mono: true }),
    arrow('dbus', 740, 450, 260, 450, o.data ? 'read' : 'muted', { width: o.data ? 9 : 3 }),
    text('dbl', 500, 418, o.data ? 'data bus: 64 B line (8 × 8 B)' : 'data bus', { size: 26, tone: o.data ? 'read' : 'muted', mono: true }),
    box('rb', 40, 520, 440, 130, `row buffer: ${o.rowBuf}`, { tone: o.rowTone, mono: true }),
  ];
  o.cmd.forEach((c, i) => out.push(box(`cmd${i}`, 520 + i * 150, 540, 135, 90, c, { tone: i === o.cmdAt ? 'current' : i < o.cmdAt ? 'visited' : 'muted', mono: true })));
  return [...out, ...clock(o.now, o.n)];
}

machineDemo({
  slug: 'bus-cycle',
  title: 'Bus read cycle',
  group: G,
  summary: 'One memory read: address out → decode → row activate → column read → 64B burst → ack.',
  linkedFrom: ['Chips & buses'],
  inputs: [
    { id: 'miss', label: 'Row buffer miss', data: { hit: false } },
    { id: 'hit', label: 'Row buffer hit', data: { hit: true } },
  ],
  build({ hit }: { hit: boolean }) {
    const f = new Film();
    const cmd = hit ? ['RD'] : ['PRE', 'ACT', 'RD'];
    const n = hit ? 5 : 7;
    let ns = 0;
    const pn = (tick: number, phase: string) => panel('Bus', [['tick', `T${tick} / T${n}`], ['phase', phase], ['DRAM time', `${ns.toFixed(1)} ns`], ['row buffer', hit ? 'HIT' : 'MISS', hit ? 'ok' : 'fail'], ['burst', '8 beats × 8 B']]);
    const rowBuf0 = hit ? 'row 88' : 'row 12';
    let tick = 1;
    f.add('L3 missed. The CPU drives address 0x1F40 onto the address bus and asserts RD on the control lines.', busShapes({ now: tick, n, addr: true, ctrl: 'RD', rowBuf: rowBuf0, rowTone: 'default', cmd, cmdAt: -1, lit: 'cpu' }), pn(tick, 'address out'));
    tick++;
    f.add('The memory controller decodes 0x1F40 → channel 0, bank 2, row 88, column 40, and queues it.', busShapes({ now: tick, n, ctrl: 'RD', rowBuf: rowBuf0, rowTone: hit ? 'ok' : 'fail', cmd, cmdAt: -1, lit: 'mc' }), pn(tick, 'decode'));
    if (!hit) {
      tick++;
      ns += 13.75;
      f.add('Row buffer holds row 12 — MISS. PRE closes it and writes it back to the cells: tRP ≈ 14 ns.', busShapes({ now: tick, n, ctrl: 'PRE', rowBuf: 'row 12 → closing', rowTone: 'fail', cmd, cmdAt: 0, lit: 'dram' }), pn(tick, 'precharge'));
      tick++;
      ns += 13.75;
      f.add('ACT opens row 88: 8 KB of cells dumped into the sense amps (the row buffer). tRCD ≈ 14 ns.', busShapes({ now: tick, n, ctrl: 'ACT', rowBuf: 'row 88', rowTone: 'current', cmd, cmdAt: 1, lit: 'dram' }), pn(tick, 'activate'));
    }
    tick++;
    ns += 13.75;
    f.add(`RD column 40: the chip picks 64 bytes out of the open row. CAS latency ≈ 14 ns${hit ? ', and no PRE/ACT since the row is already open' : ''}.`, busShapes({ now: tick, n, ctrl: 'RD', rowBuf: 'row 88', rowTone: hit ? 'ok' : 'current', cmd, cmdAt: cmd.length - 1, lit: 'dram' }), pn(tick, 'column read'));
    tick++;
    ns += 2.5;
    f.add('Data burst: 8 beats of 8 bytes on the 64-bit data bus, 2 per clock (DDR). 64 B in 2.5 ns.', busShapes({ now: tick, n, data: true, rowBuf: 'row 88', rowTone: 'ok', cmd, cmdAt: cmd.length, lit: 'mc' }), pn(tick, 'data burst'));
    tick++;
    f.add(
      hit ? `Line delivered and acked: DRAM part ≈ ${ns.toFixed(0)} ns, ~2.7× faster than a row miss. The row stays open for the next hit.` : `Line delivered and acked. DRAM part ≈ ${ns.toFixed(0)} ns; with queues and the on-chip trip, a load sees ~80–100 ns.`,
      busShapes({ now: tick, n, rowBuf: 'row 88', rowTone: 'ok', cmd, cmdAt: cmd.length, lit: 'cpu' }),
      pn(tick, 'ack'),
    );
    return f.frames;
  },
});

// ---------------- DRAM internals ----------------
type Req = { bank: number; row: number; col: number };

machineDemo({
  slug: 'bus-dram',
  title: 'DRAM internals',
  group: G,
  summary: 'Banks, rows, columns; ACT/RD/PRE; row-buffer hit vs miss vs conflict latency; refresh.',
  linkedFrom: ['Chips & buses', 'Memory'],
  inputs: [
    { id: 'hits', label: 'Sequential (row hits)', data: { reqs: [{ bank: 0, row: 3, col: 0 }, { bank: 0, row: 3, col: 8 }, { bank: 0, row: 3, col: 16 }, { bank: 0, row: 3, col: 24 }] } },
    { id: 'conflict', label: 'Ping-pong rows (conflicts)', data: { reqs: [{ bank: 0, row: 3, col: 0 }, { bank: 0, row: 5, col: 0 }, { bank: 0, row: 3, col: 8 }, { bank: 0, row: 5, col: 8 }] } },
    { id: 'banks', label: 'Rows in 2 banks', data: { reqs: [{ bank: 0, row: 3, col: 0 }, { bank: 1, row: 5, col: 0 }, { bank: 0, row: 3, col: 8 }, { bank: 1, row: 5, col: 8 }] } },
  ],
  build({ reqs }: { reqs: Req[] }) {
    const f = new Film();
    const open: (number | null)[] = [null, null];
    let total = 0;
    const counts = { hit: 0, empty: 0, conflict: 0 };
    const shapes = (cur: Req | null, kind: string, cmds: string): Shape[] => {
      const out: Shape[] = [];
      for (const b of [0, 1]) {
        const x = 40 + b * 480;
        out.push(text(`bl${b}`, x, 70, `bank ${b}`, { align: 'left', size: 30, bold: true }));
        for (let r = 0; r < 6; r++) {
          const isCur = cur && cur.bank === b && cur.row === r;
          out.push(box(`r${b}-${r}`, x, 100 + r * 78, 440, 68, `row ${r}`, { tone: isCur ? 'current' : open[b] === r ? 'read' : 'muted', mono: true }));
        }
        out.push(box(`rb${b}`, x, 590, 440, 110, open[b] === null ? 'row buffer: closed' : `row buffer: row ${open[b]}`, { tone: open[b] === null ? 'muted' : cur?.bank === b ? (kind === 'hit' ? 'ok' : 'warn') : 'read', mono: true }));
      }
      if (cmds) out.push(text('cmds', 500, 790, cmds, { size: 40, bold: true, mono: true, tone: kind === 'hit' ? 'ok' : kind === 'conflict' ? 'fail' : 'warn' }));
      return out;
    };
    const pn = (lat: string) => panel('DRAM (DDR4-3200)', [['this access', lat], ['total', `${total.toFixed(0)} ns`], ['row hits', counts.hit, 'ok'], ['empty', counts.empty], ['conflicts', counts.conflict, counts.conflict ? 'fail' : undefined], ['tRP = tRCD = CL', '~14 ns']]);
    f.add('Each bank is a grid of rows (8 KB each). Only one row per bank can be open, held in its row buffer.', shapes(null, '', ''), pn('—'));
    reqs.forEach((q) => {
      let kind: 'hit' | 'empty' | 'conflict';
      let cmds: string;
      let lat: number;
      if (open[q.bank] === q.row) [kind, cmds, lat] = ['hit', 'RD', 14];
      else if (open[q.bank] === null) [kind, cmds, lat] = ['empty', 'ACT → RD', 28];
      else [kind, cmds, lat] = ['conflict', 'PRE → ACT → RD', 42];
      counts[kind]++;
      total += lat;
      open[q.bank] = q.row;
      const note =
        kind === 'hit'
          ? `Bank ${q.bank} row ${q.row} col ${q.col}: row-buffer HIT. Just RD: ~14 ns.`
          : kind === 'empty'
            ? `Bank ${q.bank} row ${q.row}: bank idle, so ACT opens the row then RD. ~28 ns.`
            : `Bank ${q.bank} row ${q.row}: CONFLICT — another row is open. PRE, ACT, RD: ~42 ns, 3× a hit.`;
      f.add(note, shapes(q, kind, cmds), pn(`${lat} ns`));
    });
    f.add(`${reqs.length} reads in ${total} ns; controllers reorder requests to batch row hits across banks. Every 7.8 µs a REFRESH also stalls a rank ~350 ns.`, shapes(null, '', ''), pn('—'));
    return f.frames;
  },
});

// ---------------- PCIe ----------------
function pcieShapes(o: { lit: string[]; tlp?: [number, number, Tone]; label?: string }): Shape[] {
  const t = (k: string): Tone => (o.lit.includes(k) ? 'current' : 'default');
  const out: Shape[] = [
    box('cpu', 40, 50, 420, 170, 'CPU + root complex', { tone: t('cpu') }),
    box('ram', 560, 50, 400, 170, 'RAM', { sub: 'queues + buffers', tone: t('ram') }),
    line('memch', 460, 135, 560, 135, 'muted', { width: 8 }),
    box('nvme', 40, 620, 280, 180, 'NVMe SSD', { sub: 'x4 · ~8 GB/s', tone: t('nvme') }),
    box('nic', 360, 620, 280, 180, 'NIC 25G', { sub: 'x8 · ~16 GB/s', tone: t('nic') }),
    box('gpu', 680, 620, 280, 180, 'GPU', { sub: 'x16 · ~32 GB/s', tone: t('gpu') }),
  ];
  const lanes: [string, number, number][] = [
    ['nvme', 180, 4],
    ['nic', 500, 8],
    ['gpu', 820, 16],
  ];
  for (const [id, x, n] of lanes) {
    const shown = Math.min(n, 8);
    for (let i = 0; i < shown; i++) {
      const dx = (i - (shown - 1) / 2) * 12;
      out.push(line(`ln-${id}-${i}`, 250 + dx * 0.5, 220, x + dx, 620, o.lit.includes(id) ? 'protocol' : 'muted', { width: 2 }));
    }
  }
  if (o.tlp) out.push(dot('tlp', o.tlp[0], o.tlp[1], o.tlp[2], 'TLP', 22));
  if (o.label) out.push(text('tl', 500, 900, o.label, { size: 30, mono: true, bold: true }));
  return out;
}

machineDemo({
  slug: 'bus-pcie',
  title: 'PCIe',
  group: G,
  summary: 'Lanes and TLP packets: doorbell, descriptor fetch, DMA writes, MSI-X; bandwidth vs latency.',
  linkedFrom: ['Chips & buses', 'Storage'],
  inputs: [
    { id: '4k', label: '4 KB NVMe read', data: { kb: 4 } },
    { id: '1m', label: '1 MB NVMe read', data: { kb: 1024 } },
  ],
  build({ kb }: { kb: number }) {
    const f = new Film();
    const tlps = Math.ceil((kb * 1024) / 256);
    const xferUs = (kb * 1024) / 7.9e3; // x4 Gen4 ≈ 7.9 GB/s → bytes per µs
    let us = 0;
    const pn = (step: string, n: number) => panel('PCIe 4.0', [['per lane', '~2 GB/s'], ['link', 'x4 → ~7.9 GB/s'], ['step', step], ['TLPs so far', n], ['elapsed', `${us.toFixed(1)} µs`]]);
    f.add(`PCIe is a packet network: each device has 1–16 serial lanes to the root complex. Read ${kb >= 1024 ? '1 MB' : `${kb} KB`} from the NVMe SSD.`, pcieShapes({ lit: [] }), pn('—', 0));
    us += 0.5;
    f.add('The driver writes the command into a submission queue in RAM, then an MMIO write "rings the doorbell": 1 posted TLP.', pcieShapes({ lit: ['cpu', 'nvme'], tlp: [180, 560, 'protocol'], label: 'MWr doorbell (4 B)' }), pn('doorbell', 1));
    us += 1;
    f.add('The SSD fetches the 64 B command from RAM: a read-request TLP up, a completion TLP back. ~1 µs round trip.', pcieShapes({ lit: ['nvme', 'ram'], tlp: [500, 200, 'read'], label: 'MRd 64 B → CplD' }), pn('fetch cmd', 3));
    us += 60;
    f.add('Flash read inside the SSD: ~60 µs. The link is idle; latency here is the NAND, not PCIe.', pcieShapes({ lit: ['nvme'] }), pn('NAND read', 3));
    us += xferUs;
    f.add(
      `DMA: the SSD writes the data to RAM as ${tlps} TLPs of 256 B payload (+~24 B header each, ~91% efficient). ${xferUs.toFixed(1)} µs on x4.`,
      pcieShapes({ lit: ['nvme', 'ram'], tlp: [700, 220, 'write'], label: `${tlps} × MWr 256 B` }),
      pn('DMA write', 3 + tlps),
    );
    us += 1;
    f.add('A completion entry and an MSI-X interrupt — both just more memory-write TLPs — tell the CPU it’s done.', pcieShapes({ lit: ['nvme', 'cpu'], tlp: [250, 230, 'ok'], label: 'MWr CQ + MSI-X' }), pn('interrupt', 5 + tlps));
    f.add(
      kb < 64
        ? `Total ~${us.toFixed(0)} µs; the transfer was only ${xferUs.toFixed(1)} µs. Small IO is latency-bound: more lanes wouldn’t help.`
        : `Total ~${us.toFixed(0)} µs; transfer ${xferUs.toFixed(0)} µs dominates. Big IO is bandwidth-bound: an x16 link would cut it 4×.`,
      pcieShapes({ lit: [] }),
      pn('done', 5 + tlps),
    );
    return f.frames;
  },
});

// ---------------- DMA & zero-copy ----------------
function dmaShapes(lit: string[], arrows: [string, string, Tone][]): Shape[] {
  const t = (k: string): Tone => (lit.includes(k) ? 'current' : 'default');
  const pos: Record<string, [number, number]> = { user: [500, 145], pc: [250, 440], sk: [750, 440], disk: [250, 760], nic: [750, 760] };
  const out: Shape[] = [
    box('uz', 20, 40, 960, 210, undefined, { tone: 'muted', filled: false, dashed: true }),
    text('uzl', 40, 75, 'user', { align: 'left', size: 24, tone: 'muted' }),
    box('user', 300, 90, 400, 110, 'app buffer', { tone: t('user') }),
    box('kz', 20, 300, 960, 280, undefined, { tone: 'muted', filled: false, dashed: true }),
    text('kzl', 40, 335, 'kernel', { align: 'left', size: 24, tone: 'muted' }),
    box('pc', 90, 385, 320, 110, 'page cache', { tone: t('pc') }),
    box('sk', 590, 385, 320, 110, 'socket buffer', { tone: t('sk') }),
    box('disk', 90, 700, 320, 120, 'SSD', { tone: t('disk') }),
    box('nic', 590, 700, 320, 120, 'NIC', { tone: t('nic') }),
  ];
  arrows.forEach(([a, b, tone], i) => {
    const [x1, y1] = pos[a];
    const [x2, y2] = pos[b];
    if (y1 === y2) out.push(arrow(`a${i}`, x1 + 160, y1, x2 - 160, y2, tone, { width: 7, dashed: tone === 'muted' }));
    else {
      const dy = y2 > y1 ? 60 : -60;
      out.push(arrow(`a${i}`, x1, y1 + dy, x2, y2 - dy, tone, { width: 7 }));
    }
  });
  out.push(text('lg0', 480, 900, 'DMA (no CPU)', { size: 28, bold: true, align: 'right', tone: 'ok' }));
  out.push(text('lg1', 520, 900, 'CPU copy', { size: 28, bold: true, align: 'left', tone: 'fail' }));
  return out;
}

machineDemo({
  slug: 'bus-dma',
  title: 'DMA & zero-copy',
  group: G,
  summary: 'Devices write RAM directly; read()+write() costs 2 CPU copies, sendfile() costs 0.',
  linkedFrom: ['Chips & buses', 'Kafka', 'nginx'],
  inputs: [
    { id: 'copy', label: 'read() + write()', data: { zero: false } },
    { id: 'sendfile', label: 'sendfile()', data: { zero: true } },
  ],
  build({ zero }: { zero: boolean }) {
    const f = new Film();
    let cpu = 0;
    let dma = 0;
    let sys = 0;
    const pn = () => panel('Serve 1 MB file', [['CPU copies', cpu, cpu ? 'fail' : 'ok'], ['DMA transfers', dma, 'ok'], ['syscalls', sys], ['mode switches', sys * 2]]);
    const A: [string, string, Tone][] = [];
    if (!zero) {
      sys++;
      dma++;
      A.push(['disk', 'pc', 'ok']);
      f.add('read(file, buf): the SSD DMAs the file into the page cache. The CPU is free meanwhile.', dmaShapes(['disk', 'pc'], [...A]), pn());
      cpu++;
      A.push(['pc', 'user', 'fail']);
      f.add('The kernel copies page cache → app buffer. 1 MB at ~10 GB/s ≈ 100 µs of CPU and pollutes the caches.', dmaShapes(['pc', 'user'], [...A]), pn());
      sys++;
      cpu++;
      A.push(['user', 'sk', 'fail']);
      f.add('write(sock, buf): copy it again, app buffer → socket buffer. Second CPU copy of the same bytes.', dmaShapes(['user', 'sk'], [...A]), pn());
      dma++;
      A.push(['sk', 'nic', 'ok']);
      f.add('The NIC DMAs the socket buffer out and raises an interrupt when done.', dmaShapes(['sk', 'nic'], [...A]), pn());
      f.add('2 syscalls, 4 user↔kernel switches, 2 CPU copies for data the app never looked at.', dmaShapes([], A), pn());
    } else {
      sys++;
      dma++;
      A.push(['disk', 'pc', 'ok']);
      f.add('sendfile(sock, file): one syscall. The SSD DMAs the file into the page cache.', dmaShapes(['disk', 'pc'], [...A]), pn());
      A.push(['pc', 'sk', 'muted']);
      f.add('Only descriptors (page pointers + lengths) go to the socket buffer. No bytes copied.', dmaShapes(['pc', 'sk'], [...A]), pn());
      dma++;
      A.push(['pc', 'nic', 'ok']);
      f.add('The NIC gathers straight from page-cache pages via DMA.', dmaShapes(['pc', 'nic'], [...A]), pn());
      f.add('0 CPU copies, 1 syscall. Kafka serves consumers this way; nginx uses it for static files.', dmaShapes([], A), pn());
    }
    return f.frames;
  },
});

// ---------------- SSD vs HDD ----------------
type Pg = { lba: string | null; st: 'free' | 'valid' | 'stale' };

function ssdFilm(f: Film) {
  const blocks: Pg[][] = Array.from({ length: 4 }, () => Array.from({ length: 6 }, () => ({ lba: null, st: 'free' as const })));
  const map = new Map<string, [number, number]>();
  let host = 0;
  let flash = 0;
  let erases = 0;
  const names = ['A', 'B', 'C', 'D'];
  const shapes = (): Shape[] => {
    const out: Shape[] = [text('ft', 40, 60, 'FTL: logical page → flash page', { align: 'left', size: 28, bold: true })];
    blocks.forEach((b, bi) => {
      out.push(text(`bn${bi}`, 60, 180 + bi * 150, `blk ${names[bi]}`, { size: 28, tone: bi === 3 ? 'muted' : undefined }));
      b.forEach((p, pi) => {
        const tone: Tone = p.st === 'valid' ? 'write' : p.st === 'stale' ? 'fail' : 'muted';
        out.push(box(`p${bi}-${pi}`, 140 + pi * 138, 125 + bi * 150, 128, 110, p.lba ?? '', { tone, mono: true, sub: p.st === 'stale' ? 'stale' : undefined }));
      });
    });
    out.push(text('lg', 40, 760, 'blk D = spare (over-provisioning)', { size: 28, align: 'left' }));
    out.push(text('lg0', 40, 830, 'live page', { size: 28, bold: true, align: 'left', tone: 'write' }));
    out.push(text('lg1', 220, 830, 'stale page', { size: 28, bold: true, align: 'left', tone: 'fail' }));
    return out;
  };
  const pn = () => panel('SSD', [['host writes', host], ['flash writes', flash], ['write amp', host ? (flash / host).toFixed(2) : '—', flash > host ? 'warn' : undefined], ['erases', erases], ['read / program / erase', '60µs / 300µs / 3ms']]);
  const write = (lba: string) => {
    const old = map.get(lba);
    if (old) blocks[old[0]][old[1]].st = 'stale';
    for (let bi = 0; bi < 3; bi++) {
      const pi = blocks[bi].findIndex((p) => p.st === 'free');
      if (pi >= 0) {
        blocks[bi][pi] = { lba, st: 'valid' };
        map.set(lba, [bi, pi]);
        break;
      }
    }
    flash++;
    host++;
  };
  f.add('Flash can’t overwrite in place: write in 16 KB pages, erase only whole blocks (here 6 pages).', shapes(), pn());
  for (let i = 0; i < 12; i++) write(`L${i}`);
  f.add('Write logical pages L0–L11. The FTL maps each one to the next free flash page.', shapes(), pn());
  for (const l of ['L0', 'L6', 'L1', 'L7']) write(l);
  f.add('Overwrite L0, L1, L6, L7: new copies go to block C, old pages are only marked stale.', shapes(), pn());
  f.add('Block C is filling up. To get free space the SSD must garbage-collect a block with stale pages.', shapes(), pn());
  const valid = blocks[0].filter((p) => p.st === 'valid').map((p) => p.lba!);
  for (const l of valid) {
    const old = map.get(l)!;
    blocks[old[0]][old[1]].st = 'stale';
    const pi = blocks[3].findIndex((p) => p.st === 'free');
    blocks[3][pi] = { lba: l, st: 'valid' };
    map.set(l, [3, pi]);
    flash++;
  }
  f.add(`GC copies block A’s ${valid.length} still-valid pages into spare block D. Those are writes the host never asked for.`, shapes(), pn());
  blocks[0] = blocks[0].map(() => ({ lba: null, st: 'free' }));
  erases++;
  f.add(`Erase block A (~3 ms). Write amplification = ${flash}/${host} = ${(flash / host).toFixed(2)}; a full drive under random writes sees 2–4×.`, shapes(), pn());
  f.add('Why it matters: WA burns flash endurance and steals bandwidth. Sequential writes (LSM trees, logs) keep it near 1.', shapes(), pn());
}

function hddFilm(f: Film) {
  const cx = 400;
  const cy = 450;
  const pivot: [number, number] = [900, 850];
  let ms = 0;
  const shapes = (headR: number, sectorDeg: number, lit: Tone): Shape[] => {
    const a = (sectorDeg * Math.PI) / 180;
    const hx = cx + headR;
    return [
      { t: 'node', id: 'platter', x: cx, y: cy, r: 300, shape: 'circle', tone: 'default' },
      { t: 'node', id: 'track', x: cx, y: cy, r: 150, shape: 'circle', tone: 'muted' },
      { t: 'node', id: 'spindle', x: cx, y: cy, r: 30, shape: 'circle', tone: 'muted' },
      dot('sector', Math.round(cx + 150 * Math.cos(a)), Math.round(cy + 150 * Math.sin(a)), 'accent', 'LBA', 18),
      line('arm', pivot[0], pivot[1], hx, cy, lit, { width: 10 }),
      dot('head', hx, cy, lit, undefined, 16),
      text('rpm', 820, 120, '7200 rpm', { size: 30, tone: 'muted' }),
    ];
  };
  const pn = (phase: string) => panel('HDD', [['phase', phase], ['elapsed', `${ms.toFixed(2)} ms`], ['full rotation', '8.3 ms'], ['random IOPS', '~100'], ['sequential', '~200 MB/s']]);
  f.add('A 4 KB random read. The head sits on the outer track; the data is on the inner track, half a turn away.', shapes(280, 180, 'default'), pn('queued'));
  ms += 4.5;
  f.add('Seek: the arm swings to the right track and settles. ~4–9 ms, pure mechanics.', shapes(150, 180, 'warn'), pn('seek'));
  ms += 2.1;
  f.add('Rotational delay: wait for the sector to spin under the head. Average half a turn = 4.2 ms.', shapes(150, 90, 'warn'), pn('rotate'));
  ms += 2.1;
  f.add('Sector arrives under the head.', shapes(150, 0, 'current'), pn('rotate'));
  ms += 0.02;
  f.add('Transfer 4 KB: 0.02 ms. Total ~9 ms, so ~100 random IOPS — vs ~500k on an NVMe SSD.', shapes(150, 0, 'ok'), pn('transfer'));
  f.add('Sequential reads skip seek and rotation: ~200 MB/s. That’s why logs and Kafka were built for HDDs.', shapes(150, 0, 'ok'), pn('done'));
}

machineDemo({
  slug: 'bus-storage',
  title: 'SSD vs HDD internals',
  group: G,
  summary: 'SSD pages/blocks, FTL, write amplification and GC; HDD seek + rotation.',
  linkedFrom: ['Storage devices'],
  inputs: [
    { id: 'ssd', label: 'SSD: FTL & GC', data: { dev: 'ssd' } },
    { id: 'hdd', label: 'HDD: seek + rotation', data: { dev: 'hdd' } },
  ],
  build({ dev }: { dev: 'ssd' | 'hdd' }) {
    const f = new Film();
    if (dev === 'ssd') ssdFilm(f);
    else hddFilm(f);
    return f.frames;
  },
});

// ---------------- host networking path ----------------
const HOPS = [
  { id: 'wire', label: 'wire → NIC', us: 0.5, why: '1500 B at 25 Gb/s = 0.5 µs on the wire.' },
  { id: 'ring', label: 'NIC → RX ring (DMA)', us: 1, why: 'The NIC DMAs the frame into a ring buffer in RAM. ~1 µs.' },
  { id: 'irq', label: 'IRQ → driver', us: 1, why: 'MSI-X interrupt; the driver schedules NAPI. ~1 µs.' },
  { id: 'soft', label: 'softirq: IP/TCP', us: 2, why: 'softirq runs IP + TCP: checksums, ACKs, reorder. ~2 µs.' },
  { id: 'sock', label: 'socket rx buffer', us: 0.5, why: 'Payload queued on the socket; fd marked readable.' },
  { id: 'wake', label: 'epoll wakeup', us: 3, why: 'epoll wakes the app thread: scheduler + context switch ~3 µs.' },
  { id: 'read', label: 'read() syscall', us: 1, why: 'epoll_wait returns, then read() copies bytes to the app: 2 syscalls, ~1 µs.' },
  { id: 'app', label: 'app handler', us: 0, why: 'The app finally sees the request.' },
];

const WARM_US = HOPS.reduce((a, h) => a + h.us, 0);

machineDemo({
  slug: 'bus-host-net',
  title: 'Host networking path',
  group: G,
  summary: 'NIC ring → driver → kernel → socket buffer → epoll → app; syscalls and where latency hides.',
  linkedFrom: ['Host networking', 'nginx', 'Redis'],
  inputs: [
    { id: 'warm', label: 'Busy host', data: { cold: false } },
    { id: 'cold', label: 'Idle host (C-states)', data: { cold: true } },
  ],
  build({ cold }: { cold: boolean }) {
    const f = new Film();
    let us = 0;
    let sys = 0;
    const cost = HOPS.map((h) => (cold && h.id === 'irq' ? h.us + 50 : cold && h.id === 'wake' ? h.us + 20 : h.us));
    const shapes = (upto: number): Shape[] => {
      const out: Shape[] = [];
      HOPS.forEach((h, i) => {
        const tone: Tone = i === upto ? 'current' : i < upto ? (cost[i] >= 10 ? 'fail' : 'visited') : 'muted';
        out.push(box(`h${i}`, 40, 30 + i * 115, 540, 100, h.label, { tone }));
        if (i <= upto) out.push(text(`t${i}`, 620, 30 + i * 115 + 55, `${cost[i]} µs`, { align: 'left', size: 32, mono: true, tone: cost[i] >= 10 ? 'fail' : undefined }));
        if (i < HOPS.length - 1) out.push(line(`l${i}`, 310, 130 + i * 115, 310, 145 + i * 115, 'muted'));
      });
      return out;
    };
    const pn = () => panel('Receive path', [['elapsed', `${us.toFixed(1)} µs`], ['syscalls', sys], ['copies', sys >= 2 ? 1 : 0], ['CPU state', cold ? 'idle (C6)' : 'busy']]);
    f.add(cold ? 'Same packet, but the host is idle: its cores sleep in deep C-states to save power.' : 'A request packet arrives at a busy server. Follow it to the app.', shapes(-1), pn());
    HOPS.forEach((h, i) => {
      us += cost[i];
      if (h.id === 'read') sys += 2;
      let why = h.why;
      if (cold && h.id === 'irq') why = 'The interrupt must wake a core from C6 first: ~50 µs before the driver even runs.';
      if (cold && h.id === 'wake') why = 'The app thread was sleeping on an idle core: wakeup + migration ~20 µs more.';
      f.add(why, shapes(i), pn());
    });
    f.add(
      cold
        ? `Total ~${us.toFixed(0)} µs, ~${Math.round(us / WARM_US)}× the busy case. Low-traffic services often have worse p99 — tune C-states or busy-poll.`
        : `Total ~${us.toFixed(0)} µs of host time before app code runs. Kernel bypass (DPDK) or busy polling gets it to ~2 µs.`,
      shapes(HOPS.length),
      pn(),
    );
    return f.frames;
  },
});

// ---------------- event loop vs thread-per-connection ----------------
function socketsGrid(ready: number[], threads: boolean, handled: number[]): Shape[] {
  const out: Shape[] = [text('sl', 40, 55, '10,000 sockets (1 cell = 200)', { align: 'left', size: 28, tone: 'muted' })];
  for (let i = 0; i < 50; i++) {
    const tone: Tone = handled.includes(i) ? 'ok' : ready.includes(i) ? 'current' : 'muted';
    out.push(box(`s${i}`, 40 + (i % 10) * 92, 80 + Math.floor(i / 10) * 72, 82, 62, threads ? 'T' : '', { tone }));
  }
  return out;
}

machineDemo({
  slug: 'bus-event-loop',
  title: 'Event loop vs threads',
  group: G,
  summary: 'One thread multiplexing 10k sockets with epoll vs a thread per connection.',
  linkedFrom: ['Host networking', 'Redis', 'nginx'],
  inputs: [
    { id: 'epoll', label: 'epoll event loop', data: { mode: 'epoll' } },
    { id: 'threads', label: 'Thread per connection', data: { mode: 'threads' } },
  ],
  build({ mode }: { mode: 'epoll' | 'threads' }) {
    const f = new Film();
    const ready = [7, 23, 41];
    if (mode === 'epoll') {
      let sys = 0;
      const pn = (ctx: string) => panel('Event loop', [['threads', 1], ['connections', '10,000'], ['memory', '~10 KB/conn ≈ 100 MB'], ['syscalls', sys], ['ctx switches', ctx]]);
      const loop = (state: string, tone: Tone) => box('loop', 40, 480, 920, 150, 'event loop thread', { sub: state, tone });
      const rl = (items: string[]) => items.map((s, i) => box(`rl${i}`, 40 + i * 310, 700, 290, 100, s, { tone: 'current', mono: true }));
      sys++;
      f.add('10k mostly idle keep-alive connections. One thread registers them all with epoll and calls epoll_wait().', [...socketsGrid([], false, []), loop('epoll_wait() — sleeping', 'muted')], pn('0'));
      f.add('Packets arrive for 3 sockets. The kernel’s softirq puts just those fds on epoll’s ready list — no scanning.', [...socketsGrid(ready, false, []), loop('epoll_wait() — sleeping', 'muted'), ...rl(['fd 1401', 'fd 4622', 'fd 8203'])], pn('0'));
      f.add('epoll_wait returns 3 ready fds in one syscall. Cost is O(ready), not O(10k) like select()/poll().', [...socketsGrid(ready, false, []), loop('got 3 events', 'current'), ...rl(['fd 1401', 'fd 4622', 'fd 8203'])], pn('1'));
      for (let k = 0; k < 3; k++) {
        sys += 2;
        f.add(
          k < 2 ? `Handle fd ${['1401', '4622', '8203'][k]}: non-blocking read(), run the command, write(). ~5 µs, then the next one.` : 'All 3 done on one core with zero context switches. Back to epoll_wait().',
          [...socketsGrid(ready, false, ready.slice(0, k + 1)), loop(`handling ${k + 1} / 3`, 'current'), ...rl(['fd 1401', 'fd 4622', 'fd 8203'].slice(k + 1))],
          pn('1'),
        );
      }
      f.add('Catch: one slow handler (a 50 ms KEYS *) blocks all 10k clients. That’s Redis and nginx’s trade-off.', [...socketsGrid([], false, ready), loop('blocked by slow command', 'fail')], pn('1'));
      return f.frames;
    }
    let ctx = 0;
    const pn = (rq: number) => panel('Threads', [['threads', '10,000'], ['stack memory', '~64 KB used each ≈ 640 MB'], ['run queue', rq, rq > 4 ? 'warn' : undefined], ['ctx switches', ctx], ['switch cost', '~3 µs + cache refill']]);
    const cores = (running: string[]) => running.map((r, i) => box(`core${i}`, 40 + i * 235, 480, 215, 150, `core ${i}`, { sub: r, tone: r === 'idle' ? 'muted' : 'current' }));
    f.add('10k connections → 10k threads, each blocked in read(). Each has its own stack (8 MB reserved, ~64 KB touched).', [...socketsGrid([], true, []), ...cores(['idle', 'idle', 'idle', 'idle'])], pn(0));
    ctx += 3;
    f.add('3 sockets get data. The kernel wakes 3 threads and the scheduler context-switches them onto cores.', [...socketsGrid(ready, true, []), ...cores(['T1401', 'T4622', 'T8203', 'idle'])], pn(0));
    f.add('Simple blocking code, and a slow request only blocks its own thread. Fine at 100s of connections.', [...socketsGrid(ready, true, ready), ...cores(['idle', 'idle', 'idle', 'idle'])], pn(0));
    const burst = Array.from({ length: 40 }, (_, i) => i);
    ctx += 2000;
    f.add('Burst: 2,000 sockets ready at once. 2,000 runnable threads fight for 4 cores; the run queue explodes.', [...socketsGrid(burst, true, []), ...cores(['T12', 'T977', 'T3310', 'T8420'])], pn(1996));
    f.add('Each switch costs ~3 µs plus cold caches: 2,000 switches ≈ 6 ms of pure overhead per burst, and p99 climbs.', [...socketsGrid(burst, true, burst.slice(0, 20)), ...cores(['T55', 'T1024', 'T4001', 'T9120'])], pn(1000));
    f.add('Hence event loops (nginx, Redis, Node) or a small worker pool per core for 10k+ connections.', [...socketsGrid([], true, burst), ...cores(['idle', 'idle', 'idle', 'idle'])], pn(0));
    return f.frames;
  },
});
