// Assembly demos (group 'machine-asm'): x86-64 Intel syntax, stepped by a small interpreter.
import type { Frame, PanelRow, Shape, Tone } from '../algo/frames';
import { arrow, box, Film, hex, machineDemo, panel, text } from './lib/draw';
import type { Row } from './lib/draw';
import { codeMapFrames } from './lib/code';
import { regValue, retLine, run, STACK_TOP } from './lib/x86';
import type { State, Step } from './lib/x86';

const G = 'machine-asm';

export interface AsmProg {
  code: [asm: string, note?: string][];
  regs: string[];
  flags?: boolean;
  init?: Record<string, number>;
  array?: { base: number; vals: number[]; name: string };
  stack?: boolean;
  entry?: string;
  intro: string;
  outro: string;
}

const RX = 545;

function fmt(v: number, asHex: boolean) {
  if (asHex) return hex(v < 0 ? v + 2 ** 32 : v);
  return Math.abs(v) < 1e6 ? String(v) : hex(v >>> 0);
}

function fill(note: string, st: State, step?: Step) {
  return note.replace(/\{(\w+)\}/g, (_m, k: string) => (k === 'jmp' ? (step?.taken ? 'jump taken' : 'falls through') : fmt(regValue(st, k), false)));
}

function fnAt(src: string[], line: number) {
  for (let i = line; i >= 0; i--) {
    const t = src[i].trim();
    if (t.endsWith(':') && !t.startsWith('.')) return t.slice(0, -1);
  }
  return '?';
}

function asmShapes(p: AsmProg, src: string[], st: State, step: Step | undefined, depth: number): Shape[] {
  const out: Shape[] = [text('ct', 20, 30, 'code', { align: 'left', size: 28, bold: true, tone: 'current' })];
  const lh = Math.min(46, 920 / src.length);
  const base = lh >= 34 ? 26 : 24;
  const ly = (i: number) => 70 + i * lh + lh / 2;
  src.forEach((s, i) => {
    const t = s.trim();
    const lbl = t.endsWith(':');
    if (step && step.pc === i) out.push(box('cur', 14, ly(i) - lh / 2 + 1, 512, lh - 2, undefined, { tone: 'current' }));
    const size = Math.max(24, Math.min(base, Math.floor(465 / (0.6 * t.length) / 2) * 2));
    out.push(text(`l${i}`, lbl ? 40 : 64, ly(i), t, { align: 'left', size, mono: true, tone: t.startsWith(';') ? 'muted' : lbl ? 'accent' : undefined }));
  });
  if (step && step.next !== step.pc + 1 && step.next < src.length && (step.taken || /^(jmp|call|ret)/.test(src[step.pc].trim()))) {
    let n = step.next;
    while (n > 0 && src[n - 1].trim().endsWith(':') && n - 1 !== step.pc) n--;
    out.push(arrow('jump', 24, ly(step.pc), 24, ly(n) + (n > step.pc ? -10 : 10), 'protocol', { width: 3 }));
  }

  out.push(text('rt', RX, 30, 'registers', { align: 'left', size: 28, bold: true, tone: 'write' }));
  p.regs.forEach((spec, i) => {
    const [name, h] = spec.split(':');
    const x = RX + (i % 2) * 228;
    const y = 58 + Math.floor(i / 2) * 76;
    const canonHit = step?.wrote.some((w) => w === name || (name.startsWith('e') && w === 'r' + name.slice(1)) || (name.endsWith('d') && w === name.slice(0, -1)));
    out.push(box(`r-${name}`, x, y, 212, 64, fmt(regValue(st, name), h === 'hex'), { sub: name, mono: true, tone: canonHit ? 'write' : 'default' }));
  });
  let y = 58 + Math.ceil(p.regs.length / 2) * 76;
  if (p.flags) {
    (['ZF', 'SF', 'CF', 'OF'] as const).forEach((k, i) => {
      const on = st.flags[k];
      out.push(box(`f-${k}`, RX + i * 112, y, 100, 50, `${k} ${on ? 1 : 0}`, { mono: true, tone: on ? (step?.flagsSet ? 'accent' : 'ok') : 'visited', filled: on }));
    });
    y += 64;
  }
  y += 44;

  const rows: { addr: number; label: string; sub?: string; tone: Tone; dashed?: boolean; mark?: string }[] = [];
  if (p.stack) {
    out.push(text('mt', RX, y - 20, 'stack ↓', { align: 'left', size: 28, bold: true, tone: 'protocol' }));
    for (let k = 1; k <= Math.max(depth, 2); k++) {
      const a = STACK_TOP - 8 * k;
      const v = st.mem.get(a);
      const live = a >= st.regs.rsp;
      const ret = v === undefined ? undefined : retLine(v);
      const tone: Tone = step?.memWrites.includes(a) ? 'write' : step?.memReads.includes(a) ? 'read' : ret !== undefined && live ? 'protocol' : 'default';
      const mark = [a === st.regs.rsp ? 'rsp' : '', a === st.regs.rbp ? 'rbp' : ''].filter(Boolean).join('·');
      rows.push({ addr: a, label: v === undefined ? '' : ret !== undefined ? `ret → ${fnAt(src, ret)}` : fmt(v, v >= 0x1000), tone: live ? tone : 'visited', dashed: !live, mark });
    }
  } else if (p.array) {
    out.push(text('mt', RX, y - 20, 'memory', { align: 'left', size: 28, bold: true, tone: 'read' }));
    p.array.vals.forEach((_, k) => {
      const a = p.array!.base + 4 * k;
      const tone: Tone = step?.memWrites.includes(a) ? 'write' : step?.memReads.includes(a) ? 'read' : 'default';
      rows.push({ addr: a, label: String(st.mem.get(a) ?? 0), sub: `${p.array!.name}[${k}]`, tone });
    });
  }
  const sh = Math.min(60, (985 - y) / Math.max(1, rows.length));
  rows.forEach((r, k) => {
    const ry = y + k * sh;
    out.push(text(`ma${k}`, RX, ry + sh / 2, r.addr.toString(16).toUpperCase(), { align: 'left', size: 24, mono: true, tone: 'muted' }));
    if (r.sub) out.push(text(`ms${k}`, RX + 90, ry + sh / 2, r.sub, { align: 'left', size: 24, mono: true }));
    if (r.mark) out.push(text(`mk${k}`, 680, ry + sh / 2, r.mark, { align: 'center', size: 24, mono: true, bold: true, tone: 'protocol' }));
    out.push(box(`mv${k}`, 745, ry + 3, 240, sh - 6, r.label || '—', { mono: true, tone: r.tone, dashed: r.dashed, filled: r.tone !== 'default' && r.tone !== 'visited' }));
  });
  return out;
}

export function asmFrames(p: AsmProg): Frame[] {
  const src = p.code.map(([s]) => s);
  const mem: [number, number][] = p.array ? p.array.vals.map((v, k) => [p.array!.base + 4 * k, v]) : [];
  const { steps, start } = run(src, p.init, mem, p.entry);
  const depth = p.stack ? Math.max(0, ...steps.map((s) => (STACK_TOP - s.state.regs.rsp) / 8)) : 0;
  const f = new Film();
  let taken = 0;
  const pn = (n: number, st: State): { title: string; rows: PanelRow[] } => {
    const rows: Row[] = [['executed', n]];
    if (src.some((s) => /^\s*j/.test(s))) rows.push(['jumps taken', taken]);
    if (p.stack) rows.push(['stack depth', `${STACK_TOP - st.regs.rsp} B`]);
    return panel('CPU', rows);
  };
  f.add(p.intro, asmShapes(p, src, start, undefined, depth), pn(0, start));
  steps.forEach((s, i) => {
    if (s.taken || /^\s*(jmp|call|ret)/.test(src[s.pc])) taken++;
    f.add(fill(p.code[s.pc][1] ?? src[s.pc].trim(), s.state, s), asmShapes(p, src, s.state, s, depth), pn(i + 1, s.state));
  });
  const last = steps[steps.length - 1]?.state ?? start;
  f.add(fill(p.outro, last), asmShapes(p, src, last, undefined, depth), pn(steps.length, last));
  return f.frames;
}

// ---------------- registers & flags ----------------
const REGS: Record<string, AsmProg> = {
  basics: {
    regs: ['eax', 'ecx', 'edx'],
    flags: true,
    intro: 'Intel syntax: op destination, source. Right: the registers after each instruction.',
    code: [
      ['mov eax, 7', 'mov copies a value into a register: eax = 7.'],
      ['mov ecx, 5', 'ecx = 5. Registers live inside the core, no memory access at all.'],
      ['add eax, ecx', 'add dst, src means dst += src: eax = 7 + 5 = {eax}.'],
      ['sub eax, 2', 'eax = {eax}. Arithmetic also sets the flags as a side effect.'],
      ['imul eax, ecx', 'Two-operand multiply, eax *= ecx → {eax}.'],
      ['mov edx, eax', 'A copy, not a link: changing eax later leaves edx alone.'],
      ['inc edx', 'edx + 1 = {edx}; eax still holds {eax}.'],
    ],
    outro: 'Seven instructions, zero memory traffic. Compilers keep hot locals in registers for this reason.',
  },
  flags: {
    regs: ['eax', 'ecx'],
    flags: true,
    intro: 'cmp and test only set flags. ZF = zero, SF = sign, CF = unsigned carry/borrow, OF = signed overflow.',
    code: [
      ['mov eax, 5', 'eax = 5.'],
      ['mov ecx, 5', 'ecx = 5.'],
      ['cmp eax, ecx', 'cmp computes eax − ecx, drops the result, keeps the flags. Equal → ZF = 1.'],
      ['mov ecx, 9', 'ecx = 9. mov never changes flags.'],
      ['cmp eax, ecx', '5 − 9 is negative → SF = 1; unsigned 5 < 9 borrows → CF = 1.'],
      ['cmp ecx, eax', '9 − 5 = 4: every flag clear, so a jg or ja would jump.'],
      ['test eax, eax', 'test is an AND that only sets flags; test x, x asks whether x is zero or negative.'],
    ],
    outro: 'Branches compare nothing themselves: they read the flags the last cmp or test left behind.',
  },
  overflow: {
    regs: ['eax', 'ecx', 'edx'],
    flags: true,
    intro: 'Registers are fixed-width bit patterns. Push one past its limit and watch CF and OF.',
    code: [
      ['mov eax, 0x7FFFFFFF', 'eax = INT_MAX, the largest signed 32-bit value.'],
      ['add eax, 1', 'INT_MAX + 1 wraps to INT_MIN (0x80000000). OF = 1 flags the signed overflow.'],
      ['mov ecx, -1', 'ecx = -1 = 0xFFFFFFFF: read as unsigned, the same bits are 4294967295.'],
      ['add ecx, 1', 'Unsigned 0xFFFFFFFF + 1 carries out of bit 31 → CF = 1, and the result 0 sets ZF.'],
      ['xor edx, edx', 'xor with itself zeroes a register; compilers prefer it to mov edx, 0 (shorter).'],
    ],
    outro: 'The CPU has no signed or unsigned add: CF is the unsigned verdict, OF the signed one.',
  },
};

machineDemo({
  slug: 'asm-registers',
  title: 'Registers & flags',
  group: G,
  summary: 'mov, add, sub, imul on x86-64 registers; how cmp sets ZF/SF/CF/OF; overflow vs carry.',
  linkedFrom: ['Assembly'],
  inputs: [
    { id: 'basics', label: 'mov & add', data: { p: 'basics' } },
    { id: 'flags', label: 'cmp sets flags', data: { p: 'flags' } },
    { id: 'overflow', label: 'Overflow & carry', data: { p: 'overflow' } },
  ],
  build: ({ p }: { p: string }) => asmFrames(REGS[p]),
});

// ---------------- memory addressing ----------------
const ARR = { base: 0x1000, vals: [10, 20, 30, 40, 50, 60], name: 'a' };
const MEM: Record<string, AsmProg> = {
  load: {
    regs: ['rdi:hex', 'eax', 'ecx'],
    init: { rdi: 0x1000 },
    array: ARR,
    intro: 'rdi holds the address of int a[6], 0x1000. Brackets mean the memory at that address.',
    code: [
      ['mov eax, DWORD PTR [rdi]', 'Load 4 bytes from 0x1000: eax = a[0] = {eax}.'],
      ['mov ecx, DWORD PTR [rdi+4]', 'Base + displacement: 0x1004 is a[1], each int being 4 bytes.'],
      ['add eax, ecx', 'eax = {eax}. The arithmetic happens in registers.'],
      ['mov DWORD PTR [rdi+8], eax', 'Store: a[2] = {eax}. DWORD PTR says the access is 4 bytes wide.'],
      ['add DWORD PTR [rdi+12], 5', 'x86 can add straight into memory: a[3] += 5. Inside it is still load, add, store.'],
    ],
    outro: 'Loads and stores are the only way data moves between registers and RAM, and each one goes through the caches.',
  },
  index: {
    regs: ['rdi:hex', 'rcx', 'eax', 'rdx:hex'],
    init: { rdi: 0x1000 },
    array: ARR,
    intro: 'a[i] needs base + i × 4. x86 has an addressing mode for exactly that.',
    code: [
      ['mov ecx, 3', 'i = 3.'],
      ['mov eax, DWORD PTR [rdi+rcx*4]', 'base + index × scale: 0x1000 + 3 × 4 = 0x100C, so eax = a[3] = {eax}.'],
      ['lea rdx, [rdi+rcx*4]', 'lea computes the same address but loads nothing: rdx = &a[3].'],
      ['mov DWORD PTR [rdx], 0', 'Store through the pointer: *p = 0, so a[3] = 0.'],
      ['mov eax, DWORD PTR [rdx+8]', 'p[2] is [rdx+8], which is a[5] = {eax}.'],
    ],
    outro: 'Scale can be 1, 2, 4 or 8: the sizes of char, short, int and pointer.',
  },
  lea: {
    regs: ['ecx', 'eax', 'edx'],
    array: ARR,
    intro: 'lea means load effective address, but it is really a free adder with a shift built in.',
    code: [
      ['mov ecx, 6', 'x = 6.'],
      ['lea eax, [rcx+rcx*2]', 'eax = x + x × 2 = {eax}. No memory is touched.'],
      ['lea edx, [rax+rcx*4+1]', 'edx = 18 + 6 × 4 + 1 = {edx} in one instruction.'],
    ],
    outro: 'x * 3, x * 5 and x * 9 each become one lea. Watch for it in -O2 output.',
  },
};

machineDemo({
  slug: 'asm-memory',
  title: 'Memory addressing',
  group: G,
  summary: 'Loads and stores, [base + index × scale + disp], pointers, and lea as arithmetic.',
  linkedFrom: ['Assembly'],
  inputs: [
    { id: 'load', label: 'Load & store', data: { p: 'load' } },
    { id: 'index', label: 'a[i] indexing', data: { p: 'index' } },
    { id: 'lea', label: 'lea as math', data: { p: 'lea' } },
  ],
  build: ({ p }: { p: string }) => asmFrames(MEM[p]),
});

// ---------------- branches & loops ----------------
const BR: Record<string, AsmProg> = {
  if: {
    regs: ['edi', 'esi', 'eax'],
    flags: true,
    init: { edi: 3, esi: 8 },
    intro: 'if/else becomes cmp plus a conditional jump that skips the branch not taken.',
    code: [
      ['; int max(int a, int b)'],
      ['mov eax, edi', 'Args arrive in edi = a and esi = b; the result goes in eax. Assume a.'],
      ['cmp edi, esi', 'Compare a with b: 3 − 8 < 0, so SF ≠ OF.'],
      ['jge .done', 'jge jumps when a ≥ b: {jmp}.'],
      ['mov eax, esi', 'a < b, so the result is b = {eax}.'],
      ['.done:'],
      ['ret', 'Return with {eax} in eax.'],
    ],
    outro: 'The CPU guesses jge long before cmp finishes. A wrong guess flushes the pipeline (CPU → Pipeline).',
  },
  cmov: {
    regs: ['edi', 'esi', 'eax'],
    flags: true,
    init: { edi: 3, esi: 8 },
    intro: 'Same max(a, b), no jump: the compiler can pick a conditional move instead.',
    code: [
      ['; int max(int a, int b)'],
      ['cmp edi, esi', 'Same compare, 3 − 8.'],
      ['mov eax, esi', 'Assume b.'],
      ['cmovge eax, edi', 'Take a only if a ≥ b. The flags say no, so eax stays {eax}.'],
      ['ret', 'No jump at all, so nothing to mispredict.'],
    ],
    outro: 'cmov swaps a possible ~15-cycle mispredict for a data dependency. Compilers use it when a branch looks random.',
  },
  loop: {
    regs: ['edi', 'ecx', 'eax'],
    flags: true,
    init: { edi: 4 },
    intro: 'sum = 1 + 2 + … + n with n = 4. A loop is a test plus a backward jump.',
    code: [
      ['; int sum(int n)'],
      ['xor eax, eax', 'sum = 0.'],
      ['mov ecx, 1', 'i = 1.'],
      ['.loop:'],
      ['cmp ecx, edi', 'Is i ≤ n? Compare i = {ecx} with n = 4.'],
      ['jg .done', 'Exit when i > n: {jmp}.'],
      ['add eax, ecx', 'sum += i → {eax}.'],
      ['inc ecx', 'i++ → {ecx}.'],
      ['jmp .loop', 'Back to the test.'],
      ['.done:'],
      ['ret', 'sum = {eax}.'],
    ],
    outro: 'Five instructions per iteration, two of them jumps. -O2 moves the test to the bottom so each iteration has one.',
  },
  array: {
    regs: ['rdi:hex', 'rsi', 'rcx', 'eax'],
    flags: true,
    init: { rdi: 0x1000, rsi: 5 },
    array: { base: 0x1000, vals: [3, 1, 4, 1, 5], name: 'a' },
    intro: 'Sum int a[5]: a in rdi, n in rsi. This is the shape -O2 emits.',
    code: [
      ['; int sum(int *a, long n)'],
      ['xor eax, eax', 'sum = 0.'],
      ['xor ecx, ecx', 'i = 0.'],
      ['.loop:'],
      ['add eax, DWORD PTR [rdi+rcx*4]', 'sum += a[i]: load and add in one instruction → {eax}.'],
      ['inc rcx', 'i++ → {rcx}.'],
      ['cmp rcx, rsi', 'Is i == n?'],
      ['jne .loop', 'Loop while i ≠ n: {jmp}.'],
      ['ret', 'sum = {eax}.'],
    ],
    outro: 'Test at the bottom: one branch per iteration, predicted right every time but the last.',
  },
};

machineDemo({
  slug: 'asm-branches',
  title: 'Branches & loops',
  group: G,
  summary: 'cmp + jcc for if/else, branchless cmov, counted loops and walking an array.',
  linkedFrom: ['Assembly'],
  inputs: [
    { id: 'if', label: 'if / else', data: { p: 'if' } },
    { id: 'cmov', label: 'Branchless cmov', data: { p: 'cmov' } },
    { id: 'loop', label: 'Loop 1..n', data: { p: 'loop' } },
    { id: 'array', label: 'Sum an array', data: { p: 'array' } },
  ],
  build: ({ p }: { p: string }) => asmFrames(BR[p]),
});

// ---------------- stack, calls, frames ----------------
const STK: Record<string, AsmProg> = {
  push: {
    regs: ['rax', 'rcx', 'rsp:hex'],
    stack: true,
    intro: 'rsp points at the top of the stack, which starts at 0x8000 and grows down.',
    code: [
      ['mov eax, 1', 'rax = 1.'],
      ['mov ecx, 2', 'rcx = 2.'],
      ['push rax', 'push: rsp −= 8, then store rax at [rsp].'],
      ['push rcx', 'Another 8 bytes: rsp = {rsp}.'],
      ['pop rax', 'pop: load [rsp] into rax, then rsp += 8. rax = {rax}.'],
      ['pop rcx', 'rcx = {rcx}: last in, first out swapped the two.'],
    ],
    outro: 'Popped slots are not erased, only above rsp and free to reuse. Reading a dead local gives whatever is left there.',
  },
  call: {
    regs: ['edi', 'eax', 'rsp:hex'],
    stack: true,
    entry: 'main',
    intro: 'A call is two stack operations: call pushes where to come back to, ret pops it.',
    code: [
      ['main:'],
      ['mov edi, 5', 'The first integer argument goes in edi (System V ABI).'],
      ['call square', 'call pushes the return address, then jumps to square.'],
      ['add eax, 1', 'Back in main, with the result in eax: {eax}.'],
      ['ret', 'main returns.'],
      ['square:'],
      ['mov eax, edi', 'eax = x.'],
      ['imul eax, edi', 'eax = x × x = {eax}.'],
      ['ret', 'ret pops the return address into rip, so execution resumes after the call.'],
    ],
    outro: 'Args go in rdi, rsi, rdx, rcx, r8, r9 and the result in rax. ARM64 uses x0–x7, x0, and a link register instead of pushing.',
  },
  frames: {
    regs: ['edi', 'eax', 'ebx', 'rsp:hex', 'rbp:hex'],
    flags: true,
    stack: true,
    entry: 'main',
    intro: 'Each call gets a frame: return address, saved rbp, saved registers. Watch fact(3) stack three of them.',
    code: [
      ['main:'],
      ['mov edi, 3', 'Call fact(3).'],
      ['call fact', 'Push the return address and jump.'],
      ['ret', 'fact(3) = {eax}.'],
      ['fact:'],
      ['push rbp', 'Prologue: save the caller’s frame pointer.'],
      ['mov rbp, rsp', 'rbp now marks this frame’s base; locals would sit below it.'],
      ['push rbx', 'rbx is callee-saved: a function that uses it must restore it.'],
      ['mov ebx, edi', 'Keep n = {ebx} in rbx so it survives the next call.'],
      ['mov eax, 1', 'Result so far: 1.'],
      ['cmp edi, 1', 'Base case, n ≤ 1?'],
      ['jle .out', 'n = {edi}: {jmp}.'],
      ['dec edi', 'Argument n − 1 = {edi}.'],
      ['call fact', 'Recurse: a new frame lands below this one.'],
      ['imul eax, ebx', 'fact(n − 1) × n = {eax}.'],
      ['.out:'],
      ['pop rbx', 'Epilogue: restore the caller’s rbx ({ebx}).'],
      ['pop rbp', 'Restore the caller’s rbp.'],
      ['ret', 'Pop the return address and go back.'],
    ],
    outro: 'Frames are just 8-byte slots below rsp. Recurse too deep and they run past the stack’s end: a stack overflow.',
  },
};

machineDemo({
  slug: 'asm-stack',
  title: 'Stack, calls & frames',
  group: G,
  summary: 'push/pop, call/ret and the return address, System V calling convention, prologue/epilogue and recursion.',
  linkedFrom: ['Assembly', 'C++'],
  inputs: [
    { id: 'push', label: 'push & pop', data: { p: 'push' } },
    { id: 'call', label: 'call & ret', data: { p: 'call' } },
    { id: 'frames', label: 'Recursion & frames', data: { p: 'frames' } },
  ],
  build: ({ p }: { p: string }) => asmFrames(STK[p]),
});

// ---------------- SIMD ----------------
const SIMD = {
  scalar: {
    reg: 'eax',
    lanes: 1,
    code: ['.loop:', '  mov  eax, DWORD PTR [rdi+rcx*4]', '  add  eax, DWORD PTR [rsi+rcx*4]', '  mov  DWORD PTR [rdx+rcx*4], eax', '  inc  rcx', '  cmp  rcx, 8', '  jne  .loop'],
    perIter: 6,
  },
  sse: {
    reg: 'xmm0',
    lanes: 4,
    code: ['.loop:', '  movdqu xmm0, [rdi+rcx*4]', '  movdqu xmm1, [rsi+rcx*4]', '  paddd  xmm0, xmm1', '  movdqu [rdx+rcx*4], xmm0', '  add    rcx, 4', '  cmp    rcx, 8', '  jne    .loop'],
    perIter: 7,
  },
  avx: {
    reg: 'ymm0',
    lanes: 8,
    code: ['  vmovdqu ymm0, [rdi]', '  vpaddd  ymm0, ymm0, [rsi]', '  vmovdqu [rdx], ymm0'],
    perIter: 3,
  },
};

machineDemo({
  slug: 'asm-simd',
  title: 'SIMD: one instruction, many lanes',
  group: G,
  summary: 'c[i] = a[i] + b[i] for 8 ints: scalar vs SSE (4 lanes) vs AVX2 (8 lanes).',
  linkedFrom: ['Assembly', 'CPU'],
  inputs: [
    { id: 'scalar', label: 'Scalar', data: { mode: 'scalar' } },
    { id: 'sse', label: 'SSE · 128-bit', data: { mode: 'sse' } },
    { id: 'avx', label: 'AVX2 · 256-bit', data: { mode: 'avx' } },
  ],
  build({ mode }: { mode: keyof typeof SIMD }) {
    const m = SIMD[mode];
    const A = [1, 2, 3, 4, 5, 6, 7, 8];
    const B = [10, 20, 30, 40, 50, 60, 70, 80];
    const iters = 8 / m.lanes;
    const CX = 150;
    const CW = 100;
    const f = new Film();
    const draw = (it: number) => {
      const lo = it * m.lanes;
      const hi = lo + m.lanes;
      const out: Shape[] = [text('ct', 20, 30, 'loop body', { align: 'left', size: 28, bold: true, tone: 'current' })];
      m.code.forEach((l, i) => out.push(text(`l${i}`, 28, 70 + i * 32, l, { align: 'left', size: 24, mono: true, tone: l.endsWith(':') ? 'accent' : it >= 0 ? 'current' : undefined })));
      const row = (name: string, y: number, vals: (number | undefined)[], active: (i: number) => boolean, tone: Tone) => {
        out.push(text(`${name}n`, 60, y + 35, name, { size: 30, bold: true, mono: true }));
        vals.forEach((v, i) => out.push(box(`${name}${i}`, CX + i * CW + 4, y, CW - 8, 70, v === undefined ? '' : String(v), { mono: true, tone: active(i) ? tone : 'default', filled: active(i) })));
      };
      const on = (i: number) => it >= 0 && i >= lo && i < hi;
      row('a', 360, A, on, 'read');
      row('b', 460, B, on, 'read');
      out.push(text('rn', 60, 625, m.reg, { size: 26, bold: true, mono: true, tone: 'write' }));
      out.push(box('regw', CX + Math.max(0, it) * m.lanes * CW, 582, m.lanes * CW, 86, undefined, { tone: 'write', filled: false, dashed: true }));
      if (it >= 0)
        for (let k = 0; k < m.lanes; k++) out.push(box(`lane${k}`, CX + (lo + k) * CW + 4, 590, CW - 8, 70, String(A[lo + k] + B[lo + k]), { mono: true, tone: 'write', sub: m.lanes > 1 ? String(k) : undefined }));
      row('c', 720, A.map((a, i) => (i < hi && it >= 0 ? a + B[i] : undefined)), on, 'ok');
      out.push(arrow('ld', CX - 30, 545, CX - 30, 585, 'read', { width: 3 }));
      out.push(arrow('st', CX - 30, 670, CX - 30, 712, 'ok', { width: 3 }));
      if (it >= 0) out.push(text('cnt', 500, 880, `${(it + 1) * m.perIter} instructions for ${Math.min(8, hi)} elements`, { size: 30, bold: true, tone: it === iters - 1 ? 'ok' : 'default' }));
      return out;
    };
    const pn = (it: number) =>
      panel('SIMD', [
        ['lanes', `${m.lanes} × 32-bit`],
        ['iterations', `${it + 1} / ${iters}`],
        ['instructions', (it + 1) * m.perIter],
        ['elements / instr', (m.lanes / m.perIter).toFixed(2)],
      ]);
    const intro =
      mode === 'scalar'
        ? 'One int per add: load a[i], add b[i], store c[i], then loop bookkeeping.'
        : mode === 'sse'
          ? 'A 128-bit xmm register holds 4 ints; paddd adds all four pairs at once.'
          : 'A 256-bit ymm register holds all 8 ints, so the whole loop collapses to 3 instructions.';
    f.add(intro, draw(-1), pn(-1));
    for (let it = 0; it < iters; it++) f.add(`Iteration ${it + 1}: elements ${it * m.lanes}–${it * m.lanes + m.lanes - 1} in ${m.lanes === 1 ? 'one register' : `${m.lanes} lanes of ${m.reg}`}.`, draw(it), pn(it));
    const total = iters * m.perIter;
    f.add(
      mode === 'scalar'
        ? `${total} instructions for 8 adds. -O3 auto-vectorizes loops like this when it can prove no aliasing.`
        : `${total} instructions instead of 48. Same loads and adds, just ${m.lanes} wide; AVX-512 goes to 16.`,
      draw(iters - 1),
      pn(iters - 1),
    );
    return f.frames;
  },
});

// ---------------- compiler output ----------------
const SUM_C = ['int sum(int *a, int n) {', '  int s = 0;', '  for (int i = 0; i < n; i++)', '    s += a[i];', '  return s;', '}'];

const O0 = ['sum:', '  push rbp', '  mov  rbp, rsp', '  mov  QWORD PTR [rbp-24], rdi', '  mov  DWORD PTR [rbp-28], esi', '  mov  DWORD PTR [rbp-4], 0', '  mov  DWORD PTR [rbp-8], 0', '  jmp  .L2', '.L3:', '  mov  eax, DWORD PTR [rbp-8]', '  cdqe', '  lea  rdx, [0+rax*4]', '  mov  rax, QWORD PTR [rbp-24]', '  add  rax, rdx', '  mov  eax, DWORD PTR [rax]', '  add  DWORD PTR [rbp-4], eax', '  add  DWORD PTR [rbp-8], 1', '.L2:', '  mov  eax, DWORD PTR [rbp-8]', '  cmp  eax, DWORD PTR [rbp-28]', '  jl   .L3', '  mov  eax, DWORD PTR [rbp-4]', '  pop  rbp', '  ret'];
const O2 = ['sum:', '  test  esi, esi', '  jle   .L4', '  movsx rsi, esi', '  lea   rdx, [rdi+rsi*4]', '  xor   eax, eax', '.L3:', '  add   eax, DWORD PTR [rdi]', '  add   rdi, 4', '  cmp   rdi, rdx', '  jne   .L3', '  ret', '.L4:', '  xor   eax, eax', '  ret'];
const ARM = ['sum:', '  cmp  w1, 0', '  ble  .L4', '  add  x2, x0, w1, sxtw 2', '  mov  w1, 0', '.L3:', '  ldr  w3, [x0], 4', '  add  w1, w1, w3', '  cmp  x2, x0', '  bne  .L3', '  mov  w0, w1', '  ret', '.L4:', '  mov  w0, 0', '  ret'];

const MAPS = {
  O0: {
    srcTitle: 'C source',
    asmTitle: 'x86-64 · gcc -O0',
    src: SUM_C,
    asm: O0,
    intro: 'Debug builds translate each statement on its own and keep every variable in memory.',
    steps: [
      { src: [0], asm: [1, 2, 3, 4], note: 'Prologue, then both arguments are spilled from registers to the stack frame.' },
      { src: [1], asm: [5], note: 's lives at [rbp-4], a memory slot, not a register.' },
      { src: [2], asm: [6, 7], note: 'i = 0 at [rbp-8], then jump to the loop test at the bottom.' },
      { src: [2], asm: [18, 19, 20], note: 'i < n: reload i and compare against n in memory, every iteration.' },
      { src: [3], asm: [9, 10, 11, 12, 13, 14, 15], note: 's += a[i] takes 7 instructions: reload i, widen it, scale, reload a, add, load, add to memory.' },
      { src: [2], asm: [16], note: 'i++ is a read-modify-write on the stack slot.' },
      { src: [4], asm: [21, 22, 23], note: 'Load s into eax for the return, restore rbp, ret.' },
    ],
    outro: '11 instructions and ~9 memory accesses per iteration. Great for a debugger, slow to run.',
    rows: () => [['per iteration', '11 instr · 9 mem'] as Row],
  },
  O2: {
    srcTitle: 'C source',
    asmTitle: 'x86-64 · gcc -O2',
    src: SUM_C,
    asm: O2,
    intro: 'Same function at -O2: variables live in registers and the loop is restructured.',
    steps: [
      { src: [2], asm: [1, 2], note: 'n ≤ 0 is checked once up front; then the loop can test at the bottom.' },
      { src: [2], asm: [3, 4], note: 'i is gone. The compiler computes an end pointer, a + n.' },
      { src: [1], asm: [5], note: 's lives in eax, zeroed with xor.' },
      { src: [3], asm: [7], note: 's += a[i] is one instruction: add from memory through the pointer.' },
      { src: [2], asm: [8, 9, 10], note: 'i++ became pointer += 4; i < n became pointer ≠ end.' },
      { src: [4], asm: [11], note: 's is already in eax, the return register.' },
    ],
    outro: '4 instructions and 1 load per iteration, about 3× fewer. -O3 would also vectorize it (see SIMD).',
    rows: () => [['per iteration', '4 instr · 1 mem'] as Row],
  },
  arm64: {
    srcTitle: 'C source',
    asmTitle: 'ARM64 · gcc -O2',
    src: SUM_C,
    asm: ARM,
    intro: 'The same loop on ARM64 (Apple silicon, phones): fixed 4-byte instructions, 31 registers.',
    steps: [
      { src: [2], asm: [1, 2], note: 'Args arrive in x0 (a) and w1 (n); w means the low 32 bits of x.' },
      { src: [2], asm: [3], note: 'End pointer a + n × 4 in one add with a shifted, sign-extended operand.' },
      { src: [1], asm: [4], note: 's in w1, reusing n’s register once n is no longer needed.' },
      { src: [3], asm: [6, 7], note: 'Load/store architecture: ldr loads a[i] and bumps x0 by 4, then a separate add.' },
      { src: [2], asm: [8, 9], note: 'Compare pointer to end, b.ne back.' },
      { src: [4], asm: [10, 11], note: 'The result goes in w0; ret jumps to the address in the link register x30.' },
    ],
    outro: 'Same algorithm, different ISA: ARM arithmetic never touches memory, x86 add can.',
    rows: () => [['per iteration', '4 instr · 1 mem'] as Row],
  },
};

machineDemo({
  slug: 'asm-compiler',
  title: 'Reading compiler output',
  group: G,
  summary: 'One C function at -O0, -O2 and on ARM64: which instructions each line becomes.',
  linkedFrom: ['Assembly', 'C++'],
  inputs: [
    { id: 'O0', label: 'x86-64 -O0', data: { m: 'O0' } },
    { id: 'O2', label: 'x86-64 -O2', data: { m: 'O2' } },
    { id: 'arm64', label: 'ARM64 -O2', data: { m: 'arm64' } },
  ],
  build: ({ m }: { m: keyof typeof MAPS }) => codeMapFrames(MAPS[m]),
});
