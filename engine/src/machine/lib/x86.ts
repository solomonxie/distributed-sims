// Tiny x86-64 interpreter (Intel syntax, integer subset) behind the Assembly demos.

export const R64 = ['rax', 'rbx', 'rcx', 'rdx', 'rsi', 'rdi', 'rbp', 'rsp', 'r8', 'r9', 'r10', 'r11', 'r12', 'r13', 'r14', 'r15'] as const;
const R32: Record<string, string> = { eax: 'rax', ebx: 'rbx', ecx: 'rcx', edx: 'rdx', esi: 'rsi', edi: 'rdi', ebp: 'rbp', esp: 'rsp' };
for (let i = 8; i <= 15; i++) R32[`r${i}d`] = `r${i}`;

export interface Flags {
  ZF: boolean;
  SF: boolean;
  CF: boolean;
  OF: boolean;
}

export const STACK_TOP = 0x8000;
export const CODE_BASE = 0x401000;

type Operand = { k: 'reg'; r: string; w: 32 | 64 } | { k: 'imm'; v: number } | { k: 'mem'; w?: 32 | 64; terms: { r?: string; scale: number; disp: number }[] } | { k: 'label'; name: string };

export interface Line {
  text: string;
  label?: string;
  comment?: boolean;
  op?: string;
  args: Operand[];
}

export interface State {
  regs: Record<string, number>;
  flags: Flags;
  mem: Map<number, number>;
}

export interface Step {
  pc: number;
  next: number;
  state: State;
  wrote: string[];
  memWrites: number[];
  memReads: number[];
  flagsSet: boolean;
  taken?: boolean;
}

export const isReg = (s: string) => (R64 as readonly string[]).includes(s) || s in R32;
const canon = (r: string) => R32[r] ?? r;
const width = (r: string): 32 | 64 => (r in R32 ? 32 : 64);

function parseNum(s: string): number | undefined {
  const m = /^(-)?(0x[0-9a-f]+|\d+)$/i.exec(s.trim());
  if (!m) return undefined;
  const v = Number(m[2]);
  return m[1] ? -v : v;
}

function parseOperand(raw: string): Operand {
  let s = raw.trim().toLowerCase();
  let w: 32 | 64 | undefined;
  const ptr = /^(dword|qword)\s+ptr\s+/.exec(s);
  if (ptr) {
    w = ptr[1] === 'dword' ? 32 : 64;
    s = s.slice(ptr[0].length);
  }
  if (s.startsWith('[')) {
    const terms: { r?: string; scale: number; disp: number }[] = [];
    for (const m of s.slice(1, -1).replace(/\s/g, '').matchAll(/([+-]?)([^+-]+)/g)) {
      const sign = m[1] === '-' ? -1 : 1;
      const [a, b] = m[2].split('*');
      if (isReg(a)) terms.push({ r: a, scale: b ? Number(b) : 1, disp: 0 });
      else if (b && isReg(b)) terms.push({ r: b, scale: Number(a), disp: 0 });
      else terms.push({ scale: 1, disp: sign * (parseNum(a) ?? 0) });
    }
    return { k: 'mem', w, terms };
  }
  if (isReg(s)) return { k: 'reg', r: s, w: width(s) };
  const n = parseNum(s);
  if (n !== undefined) return { k: 'imm', v: n };
  return { k: 'label', name: s };
}

export function parse(src: string[]): Line[] {
  return src.map((text) => {
    const t = text.trim();
    if (!t || t.startsWith(';')) return { text, comment: true, args: [] };
    if (t.endsWith(':')) return { text, label: t.slice(0, -1), args: [] };
    const sp = t.search(/\s/);
    const op = (sp < 0 ? t : t.slice(0, sp)).toLowerCase();
    const rest = sp < 0 ? '' : t.slice(sp + 1);
    return { text, op, args: rest ? rest.split(/,(?![^[]*\])/).map(parseOperand) : [] };
  });
}

const wrap = (v: number, w: 32 | 64) => (w === 32 ? v | 0 : v);
const unsigned = (v: number, w: 32 | 64) => (w === 32 ? v >>> 0 : v < 0 ? v + 2 ** 64 : v);

const COND: Record<string, (f: Flags) => boolean> = {
  e: (f) => f.ZF,
  z: (f) => f.ZF,
  ne: (f) => !f.ZF,
  nz: (f) => !f.ZF,
  l: (f) => f.SF !== f.OF,
  ge: (f) => f.SF === f.OF,
  g: (f) => !f.ZF && f.SF === f.OF,
  le: (f) => f.ZF || f.SF !== f.OF,
  b: (f) => f.CF,
  ae: (f) => !f.CF,
  a: (f) => !f.CF && !f.ZF,
  be: (f) => f.CF || f.ZF,
  s: (f) => f.SF,
  ns: (f) => !f.SF,
};

/** Runs a listing from `entry` (label or first line) until the outermost ret, the end, or `max` steps. */
export function run(src: string[], init: Partial<Record<string, number>> = {}, mem: [number, number][] = [], entry?: string, max = 200): { lines: Line[]; steps: Step[]; start: State } {
  const lines = parse(src);
  const labels = new Map<string, number>();
  lines.forEach((l, i) => l.label && labels.set(l.label.toLowerCase(), i));
  const regs: Record<string, number> = {};
  for (const r of R64) regs[r] = 0;
  regs.rsp = STACK_TOP;
  for (const [k, v] of Object.entries(init)) regs[canon(k)] = width(k) === 32 ? (v! | 0) >>> 0 : v!;
  const st: State = { regs, flags: { ZF: false, SF: false, CF: false, OF: false }, mem: new Map(mem) };
  const start: State = { regs: { ...regs }, flags: { ...st.flags }, mem: new Map(st.mem) };
  const steps: Step[] = [];
  const exec = (i: number) => i < lines.length && !lines[i].op;
  let pc = entry ? labels.get(entry.toLowerCase())! : 0;
  while (pc < lines.length && exec(pc)) pc++;

  while (pc < lines.length && steps.length < max) {
    const ln = lines[pc];
    const wrote: string[] = [];
    const memWrites: number[] = [];
    const memReads: number[] = [];
    let flagsSet = false;
    let taken: boolean | undefined;
    let next = pc + 1;
    let halt = false;

    const addr = (o: Operand & { k: 'mem' }) => o.terms.reduce((a, t) => a + (t.r ? rd({ k: 'reg', r: t.r, w: 64 }) * t.scale : t.disp), 0);
    const opW = (): 32 | 64 => {
      for (const a of ln.args) if (a.k === 'reg') return a.w;
      for (const a of ln.args) if (a.k === 'mem' && a.w) return a.w;
      return 64;
    };
    function rd(o: Operand, w: 32 | 64 = 64): number {
      if (o.k === 'imm') return wrap(o.v, w);
      if (o.k === 'reg') {
        const v = st.regs[canon(o.r)];
        return o.w === 32 ? v | 0 : v;
      }
      if (o.k === 'mem') {
        const a = addr(o);
        memReads.push(a);
        return wrap(st.mem.get(a) ?? 0, o.w ?? w);
      }
      return labels.get(o.name) ?? 0;
    }
    const wr = (o: Operand, v: number, w: 32 | 64) => {
      if (o.k === 'reg') {
        st.regs[canon(o.r)] = o.w === 32 ? (v | 0) >>> 0 : v;
        wrote.push(canon(o.r));
      } else if (o.k === 'mem') {
        const a = addr(o);
        st.mem.set(a, wrap(v, o.w ?? w));
        memWrites.push(a);
      }
    };
    const setZS = (r: number) => {
      st.flags.ZF = r === 0;
      st.flags.SF = r < 0;
      flagsSet = true;
    };
    const arith = (kind: 'add' | 'sub', a: number, b: number, w: 32 | 64, keepCF = false) => {
      const exact = kind === 'add' ? a + b : a - b;
      const r = wrap(exact, w);
      setZS(r);
      st.flags.OF = w === 32 ? r !== exact : false;
      if (!keepCF) st.flags.CF = kind === 'add' ? unsigned(a, w) + unsigned(b, w) > (w === 32 ? 0xffffffff : 2 ** 64 - 1) : unsigned(a, w) < unsigned(b, w);
      return r;
    };
    const push = (v: number) => {
      st.regs.rsp -= 8;
      st.mem.set(st.regs.rsp, v);
      memWrites.push(st.regs.rsp);
      wrote.push('rsp');
    };
    const pop = () => {
      const v = st.mem.get(st.regs.rsp) ?? 0;
      memReads.push(st.regs.rsp);
      st.regs.rsp += 8;
      wrote.push('rsp');
      return v;
    };
    const target = (o: Operand) => (o.k === 'label' ? labels.get(o.name)! : pc + 1);

    const [d, s] = ln.args;
    const w = opW();
    const op = ln.op!;
    if (op === 'mov') wr(d, rd(s, w), w);
    else if (op === 'movsx' || op === 'movsxd') wr(d, rd(s, 32), 64);
    else if (op === 'cdqe') wr({ k: 'reg', r: 'rax', w: 64 }, st.regs.rax | 0, 64);
    else if (op === 'lea') wr(d, addr(s as Operand & { k: 'mem' }), w);
    else if (op === 'add' || op === 'sub') wr(d, arith(op, rd(d, w), rd(s, w), w), w);
    else if (op === 'cmp') arith('sub', rd(d, w), rd(s, w), w);
    else if (op === 'inc' || op === 'dec') wr(d, arith(op === 'inc' ? 'add' : 'sub', rd(d, w), 1, w, true), w);
    else if (op === 'neg') wr(d, arith('sub', 0, rd(d, w), w), w);
    else if (op === 'imul') {
      const exact = rd(d, w) * rd(s, w);
      const r = w === 32 ? Math.imul(rd(d, w), rd(s, w)) : exact;
      setZS(r);
      st.flags.CF = st.flags.OF = r !== exact;
      wr(d, r, w);
    } else if (op === 'and' || op === 'or' || op === 'xor' || op === 'test') {
      const a = rd(d, w);
      const b = rd(s, w);
      const r = op === 'and' || op === 'test' ? a & b : op === 'or' ? a | b : a ^ b;
      setZS(r);
      st.flags.CF = st.flags.OF = false;
      if (op !== 'test') wr(d, r, w);
    } else if (op === 'shl' || op === 'sar') {
      const n = rd(s, 32) & 63;
      const r = wrap(op === 'shl' ? rd(d, w) * 2 ** n : Math.floor(rd(d, w) / 2 ** n), w);
      setZS(r);
      wr(d, r, w);
    } else if (op.startsWith('cmov')) {
      if (COND[op.slice(4)](st.flags)) wr(d, rd(s, w), w);
    } else if (op === 'jmp') next = target(d);
    else if (op.startsWith('j')) {
      taken = COND[op.slice(1)](st.flags);
      if (taken) next = target(d);
    } else if (op === 'push') push(rd(d, 64));
    else if (op === 'pop') wr(d, pop(), 64);
    else if (op === 'call') {
      push(CODE_BASE + (pc + 1) * 4);
      next = target(d);
    } else if (op === 'ret') {
      if (st.regs.rsp >= STACK_TOP) halt = true;
      else next = (pop() - CODE_BASE) / 4;
    } else if (op === 'hlt') halt = true;

    while (next < lines.length && exec(next)) next++;
    steps.push({ pc, next: halt ? lines.length : next, state: { regs: { ...st.regs }, flags: { ...st.flags }, mem: new Map(st.mem) }, wrote, memWrites, memReads, flagsSet, taken });
    if (halt) break;
    pc = next;
  }
  return { lines, steps, start };
}

/** Value of a register as it reads at its own width (eax → signed 32-bit). */
export function regValue(st: State, name: string): number {
  const v = st.regs[canon(name)];
  return width(name) === 32 ? v | 0 : v;
}

export const retLine = (v: number) => (v >= CODE_BASE && v < CODE_BASE + 4096 ? (v - CODE_BASE) / 4 : undefined);
