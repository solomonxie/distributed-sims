// Bit manipulation demos (group 'machine-bits'): bit rows with operators between them, every LeetCode bit technique.
import type { Detail, Frame, Shape, Tone } from '../algo/frames';
import { box, Film, line, machineDemo, panel, text } from './lib/draw';
import type { Row } from './lib/draw';

const G = 'machine-bits';

// ---------------- pure helpers (tested in test/bits.test.ts) ----------------
export const u32 = (v: number) => v >>> 0;
export const unsignedOf = (v: number, w: number) => (w >= 32 ? v >>> 0 : v & ((1 << w) - 1));
export const signedOf = (v: number, w: number) => {
  if (w >= 32) return v | 0;
  const m = v & ((1 << w) - 1);
  return m >= 1 << (w - 1) ? m - (1 << w) : m;
};
export const bitOf = (v: number, i: number) => (v >>> i) & 1;

/** Kernighan: each n &= n - 1 clears one set bit (LC 191). */
export function popcount(n: number) {
  let x = n >>> 0;
  let c = 0;
  while (x) {
    x = (x & (x - 1)) >>> 0;
    c++;
  }
  return c;
}
/** LC 338 Counting Bits: bits[i] = bits[i >> 1] + (i & 1). */
export function countBits(n: number) {
  const b = [0];
  for (let i = 1; i <= n; i++) b.push(b[i >> 1] + (i & 1));
  return b;
}
export const hamming = (x: number, y: number) => popcount(x ^ y);
/** LC 477: per bit column, k ones and n - k zeros give k·(n - k) differing pairs. */
export function totalHamming(nums: number[]) {
  let t = 0;
  for (let b = 0; b < 32; b++) {
    const k = nums.filter((x) => bitOf(x, b)).length;
    t += k * (nums.length - k);
  }
  return t;
}
/** LC 190 Reverse Bits for a w-bit value. */
export function reverseBits(n: number, w = 32) {
  let r = 0;
  let x = n >>> 0;
  for (let i = 0; i < w; i++) {
    r = ((r << 1) | (x & 1)) >>> 0;
    x >>>= 1;
  }
  return r >>> 0;
}
/** LC 89 Gray Code: g(i) = i ^ (i >> 1). */
export const grayCode = (n: number) => Array.from({ length: 1 << n }, (_, i) => i ^ (i >> 1));
/** Non-empty submasks of m, descending: s = (s - 1) & m. */
export function submasks(m: number) {
  const out: number[] = [];
  for (let s = m; s; s = (s - 1) & m) out.push(s);
  return out;
}
/** Gosper's hack: next larger number with the same popcount. */
export function gosper(x: number) {
  const c = x & -x;
  const r = x + c;
  return (((r ^ x) >>> 2) / c) | r;
}
export const singleNumber = (nums: number[]) => nums.reduce((a, b) => a ^ b, 0);
/** LC 137: ones/twos state machine counts each bit mod 3. */
export function singleNumberII(nums: number[]) {
  let ones = 0;
  let twos = 0;
  for (const x of nums) {
    ones = (ones ^ x) & ~twos;
    twos = (twos ^ x) & ~ones;
  }
  return ones;
}
/** LC 260: split by the lowest bit where the two answers differ. */
export function singleNumberIII(nums: number[]): [number, number] {
  const x = singleNumber(nums);
  const low = x & -x;
  let a = 0;
  for (const v of nums) if (v & low) a ^= v;
  const b = x ^ a;
  return a < b ? [a, b] : [b, a];
}
/** LC 268 Missing Number: xor all indices 0..n with all values. */
export function missingNumber(nums: number[]) {
  let x = nums.length;
  nums.forEach((v, i) => (x ^= i ^ v));
  return x;
}
/** 0 ^ 1 ^ … ^ n, period 4. */
export const xorUpTo = (n: number) => [n, 1, n + 1, 0][n % 4];
/** LC 371 Sum of Two Integers without +. */
export function getSum(a: number, b: number) {
  let x = a | 0;
  let y = b | 0;
  while (y) {
    const carry = ((x & y) << 1) | 0;
    x = (x ^ y) | 0;
    y = carry;
  }
  return x;
}
/** LC 29 Divide Two Integers with shift-subtract, truncating, clamped to int32. */
export function divide(a: number, b: number) {
  if (a === -2147483648 && b === -1) return 2147483647;
  const neg = a < 0 !== b < 0;
  let x = Math.abs(a);
  const y = Math.abs(b);
  let q = 0;
  for (let k = 31; k >= 0; k--) {
    if (Math.floor(x / 2 ** k) >= y) {
      x -= y * 2 ** k;
      q += 2 ** k;
    }
  }
  return neg ? -q : q;
}
/** LC 201: the AND of a range is the common binary prefix of its ends. */
export function rangeBitwiseAnd(m: number, n: number) {
  let s = 0;
  while (m < n) {
    m >>>= 1;
    n >>>= 1;
    s++;
  }
  return (m << s) >>> 0;
}
/** LC 1318 Minimum Flips to make a | b == c. */
export function minFlips(a: number, b: number, c: number) {
  let f = 0;
  for (let i = 0; i < 31; i++) {
    const x = bitOf(a, i);
    const y = bitOf(b, i);
    const z = bitOf(c, i);
    f += z ? (x | y ? 0 : 1) : x + y;
  }
  return f;
}
/** LC 898: ORs of subarrays ending at i form a set of at most 32 values. */
export function subarrayBitwiseORs(arr: number[]) {
  const all = new Set<number>();
  let cur = new Set<number>();
  for (const x of arr) {
    const next = new Set<number>([x]);
    for (const y of cur) next.add(y | x);
    cur = next;
    cur.forEach((v) => all.add(v));
  }
  return all.size;
}
/** LC 421 greedily, prefix by prefix. */
export function maxXor(nums: number[], bits = 31) {
  let ans = 0;
  let mask = 0;
  for (let b = bits - 1; b >= 0; b--) {
    mask |= 1 << b;
    const pre = new Set(nums.map((x) => x & mask));
    const cand = ans | (1 << b);
    for (const p of pre)
      if (pre.has(p ^ cand)) {
        ans = cand;
        break;
      }
  }
  return ans;
}
const letterMask = (w: string) => [...w].reduce((m, ch) => m | (1 << (ch.charCodeAt(0) - 97)), 0);
/** LC 318 Maximum Product of Word Lengths. */
export function maxProductWords(words: string[]) {
  const m = words.map(letterMask);
  let best = 0;
  for (let i = 0; i < words.length; i++) for (let j = i + 1; j < words.length; j++) if (!(m[i] & m[j])) best = Math.max(best, words[i].length * words[j].length);
  return best;
}
/** LC 393 UTF-8 Validation. */
export function validUtf8(data: number[]) {
  let need = 0;
  for (const d of data) {
    if (need) {
      if ((d & 0xc0) !== 0x80) return false;
      need--;
    } else if ((d & 0x80) === 0) need = 0;
    else if ((d & 0xe0) === 0xc0) need = 1;
    else if ((d & 0xf0) === 0xe0) need = 2;
    else if ((d & 0xf8) === 0xf0) need = 3;
    else return false;
  }
  return need === 0;
}
const DNA: Record<string, number> = { A: 0, C: 1, G: 2, T: 3 };
/** LC 187 Repeated DNA Sequences: 2 bits per letter, 20-bit rolling code. */
export function findRepeatedDna(s: string) {
  const seen = new Set<number>();
  const out = new Set<string>();
  let code = 0;
  for (let i = 0; i < s.length; i++) {
    code = ((code << 2) | DNA[s[i]]) & 0xfffff;
    if (i >= 9) {
      if (seen.has(code)) out.add(s.slice(i - 9, i + 1));
      seen.add(code);
    }
  }
  return [...out];
}
/** LC 847 Shortest Path Visiting All Nodes: BFS over (node, visited mask). */
export function shortestPathAllNodes(graph: number[][]) {
  const n = graph.length;
  const full = (1 << n) - 1;
  const seen = new Set<string>();
  let q: [number, number][] = graph.map((_, i) => [i, 1 << i]);
  q.forEach(([v, m]) => seen.add(`${v},${m}`));
  for (let d = 0; q.length; d++) {
    const next: [number, number][] = [];
    for (const [v, m] of q) {
      if (m === full) return d;
      for (const u of graph[v]) {
        const k = `${u},${m | (1 << u)}`;
        if (!seen.has(k)) {
          seen.add(k);
          next.push([u, m | (1 << u)]);
        }
      }
    }
    q = next;
  }
  return -1;
}
/** LC 698 via dp[mask] = filled amount of the current bucket (−1 = unreachable). */
export function canPartitionK(nums: number[], k: number) {
  const sum = nums.reduce((a, b) => a + b, 0);
  if (sum % k) return false;
  const t = sum / k;
  const n = nums.length;
  const dp = new Array<number>(1 << n).fill(-1);
  dp[0] = 0;
  for (let m = 0; m < 1 << n; m++) {
    if (dp[m] < 0) continue;
    for (let i = 0; i < n; i++) if (!(m & (1 << i)) && dp[m] + nums[i] <= t) dp[m | (1 << i)] = (dp[m] + nums[i]) % t;
  }
  return dp[(1 << n) - 1] === 0;
}
/** LC 1879 Minimum XOR Sum of Two Arrays: dp over used positions of b. */
export function minXorSum(a: number[], b: number[]) {
  const n = a.length;
  const dp = new Array<number>(1 << n).fill(Infinity);
  dp[0] = 0;
  for (let m = 0; m < 1 << n; m++) {
    const i = popcount(m);
    if (i >= n) continue;
    for (let j = 0; j < n; j++) if (!(m & (1 << j))) dp[m | (1 << j)] = Math.min(dp[m | (1 << j)], dp[m] + (a[i] ^ b[j]));
  }
  return dp[(1 << n) - 1];
}
/** LC 464 Can I Win: memo on the mask of used numbers. */
export function canIWin(max: number, total: number) {
  if (total <= 0) return true;
  if ((max * (max + 1)) / 2 < total) return false;
  const memo = new Map<number, boolean>();
  const win = (used: number, left: number): boolean => {
    if (memo.has(used)) return memo.get(used)!;
    let r = false;
    for (let i = 1; i <= max && !r; i++) if (!(used & (1 << i)) && (i >= left || !win(used | (1 << i), left - i))) r = true;
    memo.set(used, r);
    return r;
  };
  return win(0, total);
}
export const isPowerOfTwo = (n: number) => n > 0 && (n & (n - 1)) === 0;
export const isPowerOfFour = (n: number) => isPowerOfTwo(n) && (n & 0x55555555) !== 0;
/** LC 476 Number Complement. */
export function findComplement(n: number) {
  let mask = 1;
  while (mask < n) mask = mask * 2 + 1;
  return n === 0 ? 1 : (n ^ mask) >>> 0;
}
/** LC 693 Binary Number with Alternating Bits. */
export function hasAlternatingBits(n: number) {
  const x = n ^ (n >> 1);
  return (x & (x + 1)) === 0;
}
/** LC 784 Letter Case Permutation: flip bit 5 (0x20) of chosen letters. */
export function letterCasePermutation(s: string) {
  const pos = [...s].map((ch, i) => (/[a-z]/i.test(ch) ? i : -1)).filter((i) => i >= 0);
  const out: string[] = [];
  for (let m = 0; m < 1 << pos.length; m++) {
    const cs = [...s.toLowerCase()];
    pos.forEach((p, k) => {
      if (m & (1 << k)) cs[p] = String.fromCharCode(cs[p].charCodeAt(0) ^ 0x20);
    });
    out.push(cs.join(''));
  }
  return out;
}
/** LC 401 Binary Watch: hours use 4 LEDs, minutes 6. */
export function readBinaryWatch(on: number) {
  const out: string[] = [];
  for (let h = 0; h < 12; h++) for (let m = 0; m < 60; m++) if (popcount(h) + popcount(m) === on) out.push(`${h}:${String(m).padStart(2, '0')}`);
  return out;
}
/** Parity by folding: 1 when popcount is odd. */
export function parity(n: number) {
  let x = n >>> 0;
  x ^= x >>> 16;
  x ^= x >>> 8;
  x ^= x >>> 4;
  x ^= x >>> 2;
  x ^= x >>> 1;
  return x & 1;
}

// ---------------- bit-row drawing ----------------
interface BR {
  label: string;
  v: number;
  op?: string;
  tone?: Tone;
  /** highlighted bit indices */
  hl?: number[];
  dim?: number[];
  /** bits not computed yet: drawn as empty slots */
  hide?: number[];
  sub?: string;
  /** rule above this row (result) */
  line?: boolean;
  signed?: boolean;
  detail?: Detail;
}
interface Beat {
  note: string;
  rows: BR[];
  panel?: Row[];
  title?: string;
  /** don't split into worked columns */
  whole?: boolean;
}
interface Opts {
  w: number;
  idx?: (b: number) => string;
  step?: number;
  title?: string;
}

const hexOf = (v: number, w: number) => '0x' + unsignedOf(v, w).toString(16).toUpperCase().padStart(Math.ceil(w / 4), '0');
const valOf = (r: BR, w: number) => (r.signed ? signedOf(r.v, w) : unsignedOf(r.v, w));
const subOf = (r: BR, w: number) => r.sub ?? (w > 16 ? String(valOf(r, w)) : `${valOf(r, w)} · ${hexOf(r.v, w)}`);

function drawBits(o: Opts, rows: BR[], title?: string): Shape[] {
  const out: Shape[] = [];
  const { w } = o;
  const x0 = 262;
  const cw = 718 / w;
  const t = title ?? o.title;
  const top = t ? 150 : 110;
  const rh = Math.min(84, Math.floor((985 - top) / Math.max(1, rows.length)));
  if (t) out.push(text('ttl', 20, 44, t, { align: 'left', size: 28, bold: true }));
  const step = o.step ?? (w <= 16 ? 1 : 4);
  for (let b = 0; b < w; b += step) out.push(text(`ix${b}`, x0 + (w - 1 - b) * cw + cw / 2, top - 26, o.idx ? o.idx(b) : String(b), { size: 24, mono: true, tone: 'muted' }));
  rows.forEach((r, i) => {
    const y = top + i * rh;
    const h = rh - 12;
    const lab = box(`lab${i}`, 20, y, 206, h, r.label, { mono: true, sub: subOf(r, w), tone: r.tone ?? 'default' });
    if (r.detail && lab.t === 'rect') lab.detail = r.detail;
    out.push(lab);
    if (r.op) out.push(text(`op${i}`, 244, y + h / 2, r.op, { size: r.op.length > 2 ? 24 : 30, bold: true, mono: true, tone: 'accent' }));
    if (r.line) out.push(line(`ln${i}`, x0, y - 6, 980, y - 6, 'default', { width: 3 }));
    for (let b = 0; b < w; b++) {
      const bx = x0 + (w - 1 - b) * cw + 2;
      if (r.hide?.includes(b)) {
        out.push(box(`r${i}b${b}`, bx, y, cw - 4, h, '', { tone: 'muted', filled: false, dashed: true }));
        continue;
      }
      const bit = bitOf(r.v, b);
      const hot = r.hl?.includes(b);
      const tone: Tone = hot ? 'current' : r.dim?.includes(b) ? 'visited' : bit ? (r.tone ?? 'accent') : 'default';
      out.push(box(`r${i}b${b}`, bx, y, cw - 4, h, String(bit), { mono: true, tone, filled: bit === 1 || !!hot }));
    }
  });
  return out;
}

const COLUMN_OPS: Record<string, [name: string, fn: (a: number, b: number) => number]> = {
  '&': ['AND', (a, b) => a & b],
  '|': ['OR', (a, b) => a | b],
  '^': ['XOR', (a, b) => a ^ b],
};

/** First use of &, |, ^ or ~ in a film: empty result row, one or two worked columns, then the full result. */
function splitColumnOp(o: Opts, b: Beat, seen: Set<string>): Beat[] {
  const { w } = o;
  const k = b.rows.findIndex((r) => r.line);
  const unary = k < 0 ? b.rows.findIndex((r, j) => j > 0 && r.op === '~' && unsignedOf(r.v, w) === unsignedOf(~b.rows[j - 1].v, w)) : -1;
  const at = k >= 2 ? k : unary;
  if (at < 0) return [b];
  const res = b.rows[at];
  const ops = unary >= 0 ? [b.rows[at - 1]] : [b.rows[at - 2], b.rows[at - 1]];
  const op = unary >= 0 ? '~' : ops[1].op ?? '';
  const fn = op === '~' ? (x: number) => ~x : COLUMN_OPS[op]?.[1];
  if (!fn || b.whole || seen.has(op) || (unary < 0 && ops[0].op) || unsignedOf(fn(ops[0].v, ops[1]?.v ?? 0), w) !== unsignedOf(res.v, w)) return [b];
  seen.add(op);
  const all = Array.from({ length: w }, (_, i) => w - 1 - i);
  const a = (c: number) => bitOf(ops[0].v, c);
  const y = (c: number) => (ops[1] ? bitOf(ops[1].v, c) : 0);
  // most telling columns: a 1 from differing inputs, a 0 despite some input 1
  const best = (r: number, score: (c: number) => number) => all.filter((c) => bitOf(res.v, c) === r).sort((p, q) => score(q) - score(p))[0];
  const pick = [best(1, (c) => +(a(c) !== y(c))), best(0, (c) => a(c) | y(c))].filter((c): c is number => c !== undefined).slice(0, op === '~' ? 1 : 2);
  const name = op === '~' ? 'NOT' : COLUMN_OPS[op][0];
  const step = (shown: number[], hot?: number): BR[] =>
    b.rows.map((r, j) => {
      if (j === at) return { ...r, hide: all.filter((c) => !shown.includes(c)), hl: hot === undefined ? [] : [hot], sub: shown.length < w ? '?' : r.sub, tone: shown.length < w ? 'default' : r.tone, detail: undefined };
      if (hot !== undefined && ops.includes(r)) return { ...r, hl: [hot] };
      return r;
    });
  const colNote = (c: number) => (op === '~' ? `Bit ${c}: ~${a(c)} = ${bitOf(res.v, c)}. Every column just flips.` : `Bit ${c}: ${a(c)} ${op} ${y(c)} = ${bitOf(res.v, c)}.`);
  const pending: Row[] = [[res.label, '?']];
  const out: Beat[] = [{ note: `${name}, one column at a time: fill in ${res.label}.`, rows: step([]), panel: pending, title: b.title }];
  pick.forEach((c, n) => out.push({ note: colNote(c), rows: step(pick.slice(0, n + 1), c), panel: pending, title: b.title }));
  out.push(b);
  return out;
}

/** set while a demo builds its first preset: only that one teaches operators column by column */
let teachColumns = true;

function bitFrames(o: Opts, beats: Beat[], title = 'Bits'): Frame[] {
  const f = new Film();
  const seen = new Set<string>();
  for (const b of teachColumns ? beats.flatMap((x) => splitColumnOp(o, x, seen)) : beats) f.add(b.note, drawBits(o, b.rows, b.title), b.panel ? panel(title, b.panel) : undefined);
  return f.frames;
}

type Input = [label: string, build: () => Frame[]];
function bitDemo(slug: string, title: string, summary: string, inputs: Record<string, Input>) {
  machineDemo({
    slug,
    title,
    group: G,
    summary,
    inputs: Object.entries(inputs).map(([id, [label]]) => ({ id, label, data: { k: id } })),
    build: ({ k }: { k: string }) => {
      teachColumns = k === Object.keys(inputs)[0];
      try {
        return inputs[k][1]();
      } finally {
        teachColumns = true;
      }
    },
  });
}

const R = (label: string, v: number, o: Partial<BR> = {}): BR => ({ label, v, ...o });
const ones = (v: number, w: number) => Array.from({ length: w }, (_, b) => b).filter((b) => bitOf(v, b));
const D = (title: string, text: string, code: string): Detail => ({ title, text, code });

// ---------------- details (tap a row label) ----------------
const DT = {
  twos: D('Two’s complement', 'Negative numbers flip every bit and add 1, so −x == ~x + 1 and one adder handles signed and unsigned alike.', 'int8_t x = 5;\nint8_t neg = ~x + 1;   // -5 == 0b11111011\nassert(neg == -x);\n// top bit set => negative\nbool isNeg = x >> 7 & 1;'),
  overflow: D('Overflow checks', 'Signed overflow is undefined in C++, so check before the operation (LC 7 Reverse Integer, LC 8 atoi).', 'bool addOverflows(int a, int b) {\n  return (b > 0 && a > INT_MAX - b) ||\n         (b < 0 && a < INT_MIN - b);\n}\n// or: __builtin_add_overflow(a, b, &r)'),
  shift: D('Shifts', 'x << k multiplies by 2^k, x >> k divides by 2^k (floor for non-negative). Right-shifting a signed negative copies the sign bit.', 'unsigned u = 0xE8;   u >> 2;  // logical: 0x3A\nint8_t  s = -24;    s >> 2;  // arithmetic: -6\nuint64_t m = 1ULL << 40;     // not 1 << 40 (UB)'),
  and: D('AND &', 'Bit is 1 only where both inputs are 1. Masks and tests: x & 1 is odd/even, x & 0xFF keeps the low byte.', 'bool odd = x & 1;\nint low = x & 0xFF;\nbool has = x & (1 << i);'),
  or: D('OR |', 'Bit is 1 where either input is 1. Use it to switch bits on or merge flag sets.', 'flags |= READ | WRITE;\nx |= 1 << i;   // set bit i'),
  xor: D('XOR ^', 'Bit is 1 where inputs differ. x ^ x == 0, x ^ 0 == x, and it is commutative and associative, so pairs cancel in any order.', 'int acc = 0;\nfor (int v : nums) acc ^= v;  // LC 136\nx ^= 1 << i;                 // toggle bit i'),
  not: D('NOT ~', 'Flips every bit. In two’s complement ~x == -x - 1.', 'int x = 5;\nassert(~x == -6);\nx &= ~(1 << i);   // clear bit i'),
  get: D('Get bit i', 'Shift the bit down to position 0, then mask it.', 'int get(int n, int i) { return n >> i & 1; }\nbool test = n & (1 << i);'),
  set: D('Set bit i', 'OR with a one-bit mask.', 'n |= 1 << i;'),
  clear: D('Clear bit i', 'AND with the inverted mask.', 'n &= ~(1 << i);'),
  toggle: D('Toggle bit i', 'XOR with a one-bit mask.', 'n ^= 1 << i;'),
  field: D('Bit fields', '(1 << k) - 1 is k ones. Shift and mask to read or write a group of bits, as packed flags and protocol headers do.', 'int mask = (1 << k) - 1;\nint get = n >> pos & mask;\nn = (n & ~(mask << pos)) | (v << pos);'),
  clearLow: D('n & (n − 1)', 'Clears the lowest set bit. Zero exactly for powers of two (LC 231), and the heart of Kernighan’s popcount (LC 191).', 'bool isPow2(int n) {\n  return n > 0 && (n & (n - 1)) == 0;\n}'),
  pow4: D('Power of four (LC 342)', 'A power of two whose single bit sits at an even position: 0x55555555 has 1s at bits 0, 2, 4 and so on.', 'bool isPowerOfFour(int n) {\n  return n > 0 && (n & (n - 1)) == 0\n         && (n & 0x55555555);\n}'),
  lowbit: D('n & −n', 'Isolates the lowest set bit. Used by Fenwick trees (i += i & -i) and LC 260 to split numbers into two groups.', 'int low = n & -n;       // 12 -> 4\nfor (; i <= n; i += i & -i) tree[i] += d;'),
  lowzero: D('Lowest zero bit', '~n & (n + 1) isolates the lowest 0 bit, n | (n + 1) sets it.', 'int lowZero = ~n & (n + 1);\nint filled  = n | (n + 1);'),
  kernighan: D('Kernighan popcount (LC 191)', 'Loops once per set bit. In real code use std::popcount (C++20) or __builtin_popcount, which compile to one POPCNT instruction.', 'int hammingWeight(uint32_t n) {\n  int c = 0;\n  for (; n; n &= n - 1) c++;\n  return c;\n}\n// std::popcount(n), bitset<32>(n).count()'),
  countBits: D('Counting Bits (LC 338)', 'i >> 1 has the same bits minus the last one, so bits[i] = bits[i >> 1] + (i & 1). O(n) instead of O(n log n).', 'vector<int> countBits(int n) {\n  vector<int> b(n + 1);\n  for (int i = 1; i <= n; i++)\n    b[i] = b[i >> 1] + (i & 1);\n  return b;\n}'),
  hamming: D('Hamming Distance (LC 461)', 'XOR leaves 1s exactly where the bits differ; count them.', 'int hammingDistance(int x, int y) {\n  return __builtin_popcount(x ^ y);\n}'),
  total: D('Total Hamming Distance (LC 477)', 'Per bit column, k ones and n − k zeros make k·(n − k) differing pairs. O(32n) instead of O(n²).', 'int total = 0;\nfor (int b = 0; b < 32; b++) {\n  int k = 0;\n  for (int x : nums) k += x >> b & 1;\n  total += k * (n - k);\n}'),
  single: D('Single Number (LC 136)', 'XOR everything: pairs cancel, the loner remains. O(n) time, O(1) space.', 'int singleNumber(vector<int>& nums) {\n  int x = 0;\n  for (int v : nums) x ^= v;\n  return x;\n}'),
  missing: D('Missing Number (LC 268)', 'XOR all indices 0..n with all values; every present number cancels with its index. LC 389 Find the Difference is the same trick on chars.', 'int missingNumber(vector<int>& a) {\n  int x = a.size();\n  for (int i = 0; i < a.size(); i++)\n    x ^= i ^ a[i];\n  return x;\n}'),
  swap: D('XOR swap', 'Swaps without a temporary. A curiosity: it breaks if a and b alias the same variable, and std::swap is just as fast.', 'a ^= b;\nb ^= a;   // b = original a\na ^= b;   // a = original b'),
  range: D('XOR of 0..n', 'The prefix XOR repeats with period 4: n, 1, n + 1, 0. XOR of l..r is f(r) ^ f(l − 1).', 'int f(int n) {\n  switch (n % 4) {\n    case 0: return n; case 1: return 1;\n    case 2: return n + 1; default: return 0;\n  }\n}'),
  prefix: D('Prefix XOR (LC 1310, LC 1442)', 'p[i] = a[0] ^ … ^ a[i−1]; the XOR of a[l..r] is p[r+1] ^ p[l]. Two equal prefixes mean the XOR between them is 0 (LC 1442).', 'vector<int> p(n + 1);\nfor (int i = 0; i < n; i++) p[i+1] = p[i] ^ a[i];\n// query [l, r]:\nint q = p[r + 1] ^ p[l];'),
  single3: D('Single Number III (LC 260)', 'xor = a ^ b is non-zero; its lowest set bit differs between a and b. Split all numbers by that bit and XOR each group.', 'long x = 0; for (int v : a) x ^= v;\nlong low = x & -x;\nint p = 0, q = 0;\nfor (int v : a) (v & low ? p : q) ^= v;\nreturn {p, q};'),
  single2: D('Single Number II (LC 137)', 'Every other number appears three times, so each bit column count mod 3 is the loner’s bit. The ones/twos state machine does it in O(1) space.', 'int ones = 0, twos = 0;\nfor (int x : nums) {\n  ones = (ones ^ x) & ~twos;\n  twos = (twos ^ x) & ~ones;\n}\nreturn ones;'),
  reverse: D('Reverse Bits (LC 190)', 'Shift the answer left and push in the input’s low bit, 32 times. The divide-and-conquer version swaps halves, bytes, nibbles, pairs and bits with masks.', 'uint32_t reverseBits(uint32_t n) {\n  n = n >> 16 | n << 16;\n  n = (n & 0xff00ff00) >> 8 | (n & 0x00ff00ff) << 8;\n  n = (n & 0xf0f0f0f0) >> 4 | (n & 0x0f0f0f0f) << 4;\n  n = (n & 0xcccccccc) >> 2 | (n & 0x33333333) << 2;\n  n = (n & 0xaaaaaaaa) >> 1 | (n & 0x55555555) << 1;\n  return n;\n}'),
  complement: D('Number Complement (LC 476, LC 1009)', 'Flip only the significant bits: build a mask of 1s as wide as n, then XOR.', 'int findComplement(int n) {\n  unsigned mask = ~0u;\n  while (n & mask) mask <<= 1;\n  return ~mask & ~n;\n}'),
  alternating: D('Alternating Bits (LC 693)', 'If bits alternate, n ^ (n >> 1) is all ones, and all-ones x satisfies x & (x + 1) == 0. LC 868 Binary Gap scans set-bit positions.', 'bool hasAlternatingBits(int n) {\n  long x = n ^ (n >> 1);\n  return (x & (x + 1)) == 0;\n}'),
  sum: D('Sum of Two Integers (LC 371)', 'XOR adds without carries; (a & b) << 1 is the carries. Repeat until no carry is left, which is how a ripple adder works.', 'int getSum(int a, int b) {\n  while (b) {\n    unsigned c = (unsigned)(a & b) << 1;\n    a ^= b;\n    b = c;\n  }\n  return a;\n}'),
  divide: D('Divide Two Integers (LC 29)', 'Long division in base 2: subtract the largest divisor << k that fits, add 1 << k to the quotient. Watch INT_MIN / -1.', 'long x = labs(a), y = labs(b), q = 0;\nfor (int k = 31; k >= 0; k--)\n  if ((x >> k) >= y) { x -= y << k; q += 1L << k; }\nreturn (a < 0) ^ (b < 0) ? -q : q;'),
  mul: D('Multiply with shifts', 'x · 10 = x · 8 + x · 2 = (x << 3) + (x << 1). Compilers do this for constants; you rarely should by hand.', 'int times10(int x) {\n  return (x << 3) + (x << 1);\n}'),
  abs: D('Branchless abs, min, max', 'mask = x >> 31 is all ones for negatives, zero otherwise. (x + mask) ^ mask flips negatives to positive without a branch.', 'int mask = x >> 31;\nint absx = (x + mask) ^ mask;\nint mn = y ^ ((x ^ y) & -(x < y));\nint mx = x ^ ((x ^ y) & -(x < y));'),
  rangeand: D('Bitwise AND of Numbers Range (LC 201)', 'Any bit that changes inside the range becomes 0. What survives is the common prefix of m and n.', 'int rangeBitwiseAnd(int m, int n) {\n  int s = 0;\n  while (m < n) { m >>= 1; n >>= 1; s++; }\n  return m << s;\n}'),
  flips: D('Minimum Flips (LC 1318)', 'Per bit: if c is 1 you need one flip when a and b are both 0; if c is 0 you flip every 1 in a and b.', 'int f = 0;\nfor (int i = 0; i < 31; i++) {\n  int x = a>>i&1, y = b>>i&1, z = c>>i&1;\n  f += z ? !(x | y) : x + y;\n}'),
  orsub: D('Bitwise ORs of Subarrays (LC 898)', 'ORs of subarrays ending at i only gain bits, so there are at most 32 distinct ones. Carry that small set forward.', 'unordered_set<int> all, cur;\nfor (int x : arr) {\n  unordered_set<int> nxt{x};\n  for (int y : cur) nxt.insert(y | x);\n  cur = nxt; all.insert(cur.begin(), cur.end());\n}'),
  subsets: D('Subsets via masks (LC 78)', 'Each mask 0..2^n − 1 is one subset: bit i says whether item i is in.', 'for (int m = 0; m < 1 << n; m++) {\n  vector<int> s;\n  for (int i = 0; i < n; i++)\n    if (m >> i & 1) s.push_back(a[i]);\n  out.push_back(s);\n}'),
  submask: D('Iterate submasks', '(s − 1) & m steps to the next smaller submask of m. Over all masks this is 3^n total, the classic bitmask DP loop.', 'for (int s = m; s; s = (s - 1) & m) {\n  // s is a non-empty submask of m\n}'),
  gosper: D('Gosper’s hack', 'Next larger number with the same popcount: enumerates all k-of-n combinations in order.', 'int next(int x) {\n  int c = x & -x, r = x + c;\n  return (((r ^ x) >> 2) / c) | r;\n}'),
  gray: D('Gray Code (LC 89)', 'g = i ^ (i >> 1): consecutive codes differ in exactly one bit. Used in rotary encoders and to walk all subsets flipping one item at a time.', 'vector<int> grayCode(int n) {\n  vector<int> g;\n  for (int i = 0; i < 1 << n; i++)\n    g.push_back(i ^ i >> 1);\n  return g;\n}'),
  visit: D('Shortest Path Visiting All Nodes (LC 847)', 'BFS where a state is (node, mask of visited nodes). 2^n · n states; done when the mask is all ones.', 'queue<pair<int,int>> q; // node, mask\nfor (int i = 0; i < n; i++) q.push({i, 1 << i});\n// pop (v, m); for u in g[v]:\n//   push (u, m | 1 << u) if unseen\n// answer: first level with m == (1<<n)-1'),
  partition: D('Partition to K Equal Sum Subsets (LC 698)', 'dp[mask] is how full the current bucket is after using the items in mask. Reachable full mask with remainder 0 means yes.', 'dp[0] = 0;  // -1 = unreachable\nfor (int m = 0; m < 1 << n; m++) if (dp[m] >= 0)\n  for (int i = 0; i < n; i++)\n    if (!(m >> i & 1) && dp[m] + a[i] <= t)\n      dp[m | 1 << i] = (dp[m] + a[i]) % t;'),
  assign: D('Minimum XOR Sum (LC 1879)', 'Assignment DP: popcount(mask) tells which a[i] is next; mask says which b[j] are taken.', 'for (int m = 0; m < 1 << n; m++) {\n  int i = __builtin_popcount(m);\n  for (int j = 0; j < n; j++) if (!(m >> j & 1))\n    dp[m | 1 << j] = min(dp[m | 1 << j],\n                         dp[m] + (a[i] ^ b[j]));\n}'),
  caniwin: D('Can I Win (LC 464)', 'The game state is just the set of used numbers, a 20-bit mask. Memoise win/lose per mask.', 'bool win(int used, int left) {\n  if (memo.count(used)) return memo[used];\n  for (int i = 1; i <= mx; i++)\n    if (!(used >> i & 1) &&\n        (i >= left || !win(used | 1 << i, left - i)))\n      return memo[used] = true;\n  return memo[used] = false;\n}'),
  words: D('Maximum Product of Word Lengths (LC 318)', 'A 26-bit mask per word, one bit per letter. Two words share no letter exactly when their masks AND to 0.', 'vector<int> m(n);\nfor (int i = 0; i < n; i++)\n  for (char c : w[i]) m[i] |= 1 << (c - \'a\');\n// pair ok if (m[i] & m[j]) == 0'),
  dna: D('Repeated DNA Sequences (LC 187)', 'A, C, G, T fit in 2 bits, so a 10-letter window is a 20-bit integer. Roll it: shift in 2 bits, mask off the oldest.', 'int code = 0;\nfor (int i = 0; i < s.size(); i++) {\n  code = (code << 2 | enc(s[i])) & 0xFFFFF;\n  if (i >= 9 && !seen.insert(code).second)\n    out.insert(s.substr(i - 9, 10));\n}'),
  utf8: D('UTF-8 Validation (LC 393)', 'The leading 1s of the first byte give the length: 0xxxxxxx, 110xxxxx, 1110xxxx, 11110xxx. Continuation bytes are 10xxxxxx.', 'int need = 0;\nfor (int d : data) {\n  if (need) { if ((d & 0xC0) != 0x80) return false; need--; }\n  else if ((d & 0xE0) == 0xC0) need = 1;\n  else if ((d & 0xF0) == 0xE0) need = 2;\n  else if ((d & 0xF8) == 0xF0) need = 3;\n  else if (d & 0x80) return false;\n}\nreturn need == 0;'),
  watch: D('Binary Watch (LC 401)', 'Enumerate every h:m and keep those whose popcount(h) + popcount(m) equals the LEDs lit.', 'for (int h = 0; h < 12; h++)\n  for (int m = 0; m < 60; m++)\n    if (popcount(h) + popcount(m) == on)\n      out.push_back(format(h, m));'),
  letterCase: D('Letter Case Permutation (LC 784)', 'ASCII upper and lower case differ only in bit 5 (0x20). A mask over the letters picks which ones to flip.', 'char flip(char c) { return c ^ 0x20; }  // a <-> A\nfor (int m = 0; m < 1 << k; m++) { /* flip letter i if m>>i&1 */ }'),
  maxxor: D('Maximum XOR of Two Numbers (LC 421)', 'Decide the answer bit by bit from the top: can two prefixes XOR to the answer with this bit set? a ^ b == c iff a ^ c == b.', 'int ans = 0, mask = 0;\nfor (int b = 30; b >= 0; b--) {\n  mask |= 1 << b;\n  unordered_set<int> pre;\n  for (int x : nums) pre.insert(x & mask);\n  int cand = ans | 1 << b;\n  for (int p : pre) if (pre.count(p ^ cand)) { ans = cand; break; }\n}'),
  trie: D('Binary trie (LC 421, LC 1707)', 'Insert numbers bit by bit from the top. To maximise x ^ y, walk the trie choosing the opposite of x’s bit whenever it exists.', 'struct Node { Node* c[2]{}; };\nint best(Node* t, int x) {\n  int r = 0;\n  for (int b = 30; b >= 0; b--) {\n    int want = !(x >> b & 1);\n    if (t->c[want]) { r |= 1 << b; t = t->c[want]; }\n    else t = t->c[!want];\n  }\n  return r;\n}'),
  parity: D('Parity by folding', 'XOR the halves together repeatedly; bit 0 ends up as the XOR of all bits. __builtin_parity does it in one instruction.', 'x ^= x >> 16; x ^= x >> 8;\nx ^= x >> 4;  x ^= x >> 2;\nx ^= x >> 1;\nreturn x & 1;  // __builtin_parity(x)'),
  bitset: D('std::bitset', 'Fixed-size bit array. &, |, ^ and count() process 64 bits per machine word, a 64× speedup for set operations and DP over reachable sums.', 'bitset<10001> can;\ncan[0] = 1;\nfor (int x : nums) can |= can << x;  // subset sums\nbool ok = can[target];'),
  bloom: D('Bloom filter', 'k hash functions set k bits per item. A query with any 0 bit is definitely absent; all 1s means maybe present.', 'void add(string s) {\n  for (int i = 0; i < k; i++) bits.set(h(s, i) % m);\n}\nbool mayContain(string s) {\n  for (int i = 0; i < k; i++)\n    if (!bits.test(h(s, i) % m)) return false;\n  return true;\n}'),
  flags: D('CPU flags', 'The ALU sets CF on unsigned carry out of the top bit and OF when a signed result has the wrong sign. See Assembly → Arithmetic & flags.', 'uint8_t a = 200, b = 100;\nuint8_t s = a + b;   // 44, CF = 1\nint8_t x = 100, y = 100;\n// x + y as int8: -56, OF = 1'),
};

// ---------------- 1. binary & two's complement ----------------
bitDemo('bits-binary', 'Binary & two’s complement', 'Place values, negative numbers as ~x + 1, overflow and wraparound, logical vs arithmetic shifts.', {
  unsigned: [
    'Binary',
    () =>
      bitFrames({ w: 8 }, [
        { note: 'Every integer is a row of bits, and bit i is worth 2 to the power i.', rows: [R('n = 13', 13, { detail: D('Binary', 'Bit i is worth 2^i. Literals: 0b1101, 0xD, 13 are the same int; std::bitset prints the bits.', 'int n = 0b1101;          // 13\nstd::cout << std::bitset<8>(n);  // 00001101\nstd::cout << std::hex << n;      // d') })], panel: [['decimal', 13], ['hex', '0x0D']] },
        { note: '13 = 8 + 4 + 1, so bits 3, 2 and 0 are set.', rows: [R('n = 13', 13, { hl: ones(13, 8) })], panel: [['set bits', '3, 2, 0']] },
        { note: 'Each set bit is a power of two. OR them together and you rebuild the number.', rows: [R('1 << 3', 8), R('1 << 2', 4, { op: '|' }), R('1 << 0', 1, { op: '|' }), R('n', 13, { line: true, tone: 'ok' })], panel: [['n', '8 | 4 | 1 = 13']] },
        { note: 'Hex groups bits by four: each nibble is one hex digit.', rows: [R('0xD7', 0xd7, { hl: [4, 5, 6, 7] }), R('0xD7', 0xd7, { hl: [0, 1, 2, 3] })], panel: [['high nibble', 'D = 1101'], ['low nibble', '7 = 0111']] },
      ]),
  ],
  twos: [
    'Two’s complement',
    () =>
      bitFrames({ w: 8 }, [
        { note: 'In 8 bits, 5 is 00000101.', rows: [R('x = 5', 5, { signed: true })], panel: [['x', 5]] },
        { note: 'Negation starts by flipping every bit.', rows: [R('x', 5, { signed: true }), R('~x', ~5, { op: '~', signed: true, detail: DT.not })], panel: [['~x', -6]] },
        { note: 'Then add 1: ~x + 1 is −5. The top bit now carries weight −128.', rows: [R('x', 5, { signed: true }), R('~x', ~5, { op: '~', signed: true }), R('−x', -5, { op: '+1', signed: true, line: true, tone: 'ok', detail: DT.twos })], panel: [['−x', -5, 'ok'], ['check', '−128 + 123 = −5']] },
        { note: 'All ones is −1, and the most negative value is a lone top bit.', rows: [R('−1', -1, { signed: true }), R('INT8_MIN', -128, { signed: true, hl: [7] }), R('INT8_MAX', 127, { signed: true })], panel: [['range', '−128 … 127']] },
      ]),
  ],
  overflow: [
    'Overflow',
    () =>
      bitFrames({ w: 8 }, [
        { note: '127 is the largest int8. Adding 1 carries into the sign bit.', rows: [R('127', 127, { signed: true }), R('1', 1, { op: '+', signed: true }), R('result', 128, { signed: true, line: true, tone: 'fail', hl: [7] })], panel: [['hardware result', -128, 'fail']] },
        { note: 'Unsigned arithmetic wraps modulo 2^8 by definition: 255 + 1 is 0.', rows: [R('255', 255), R('1', 1, { op: '+' }), R('result', 0, { line: true, tone: 'warn' })], panel: [['unsigned', 'wraps (defined)', 'ok']] },
        { note: 'In C++ signed overflow is undefined behaviour, so check before adding.', rows: [R('INT8_MAX', 127, { signed: true, detail: DT.overflow }), R('INT8_MIN', -128, { signed: true })], panel: [['check', 'a > MAX − b'], ['LC', '7 Reverse Integer, 8 atoi']] },
      ]),
  ],
  shifts: [
    'Shifts',
    () =>
      bitFrames({ w: 8 }, [
        { note: 'Left shift by k multiplies by 2^k. Bits pushed off the top are lost.', rows: [R('x = 22', 22), R('x << 2', 88, { op: '<<', tone: 'ok', detail: DT.shift })], panel: [['x << 2', '22 · 4 = 88']] },
        { note: 'Right shift by k divides by 2^k, rounding down for non-negative values.', rows: [R('x = 22', 22), R('x >> 1', 11, { op: '>>', tone: 'ok' })], panel: [['x >> 1', 11]] },
        { note: 'On a negative signed value, >> copies the sign bit in (arithmetic). On unsigned it shifts in zeros (logical).', rows: [R('x = −24', -24, { signed: true }), R('int >> 2', -6, { op: '>>', signed: true, hl: [6, 7] }), R('unsigned >> 2', 0x3a, { op: '>>', hl: [6, 7] })], panel: [['arithmetic', -6], ['logical', 58]] },
        { note: 'Shifting by the bit width or more is undefined. Write 1ULL << 40, never 1 << 40.', rows: [R('1 << 7', 128), R('(1 << 4) − 1', 15, { detail: DT.field })], panel: [['safe', '1u << k, 1ULL << k']] },
      ]),
  ],
});

// ---------------- 2. operators ----------------
const A = 0b11001010;
const B = 0b10100110;
bitDemo('bits-ops', 'AND, OR, XOR, NOT', 'The four bitwise operators column by column, their identities, and what each is for.', {
  and: [
    'AND',
    () =>
      bitFrames({ w: 8 }, [
        { note: 'Bitwise operators work on each column independently.', rows: [R('a', A), R('b', B)], panel: [['a', A], ['b', B]] },
        { note: 'AND keeps a 1 only where both columns have 1.', rows: [R('a', A), R('b', B, { op: '&' }), R('a & b', A & B, { line: true, tone: 'ok', detail: DT.and })], panel: [['a & b', A & B]] },
        { note: 'AND with a mask keeps just the masked bits: x & 0x0F is the low nibble.', rows: [R('a', A), R('0x0F', 0x0f, { op: '&' }), R('a & 0x0F', A & 0x0f, { line: true, tone: 'ok' })], panel: [['low nibble', A & 0x0f], ['x & 1', 'odd test']] },
      ]),
  ],
  or: [
    'OR',
    () =>
      bitFrames({ w: 8 }, [
        { note: 'OR gives 1 where either column has 1.', rows: [R('a', A), R('b', B, { op: '|' }), R('a | b', A | B, { line: true, tone: 'ok', detail: DT.or })], panel: [['a | b', A | B]] },
        { note: 'OR with a mask switches bits on and leaves the rest alone.', rows: [R('a', A), R('0x05', 0x05, { op: '|' }), R('a | 0x05', A | 0x05, { line: true, tone: 'ok', hl: [0, 2] })], panel: [['flags', 'set READ | WRITE']] },
        { note: 'x | x == x and x | 0 == x. OR only ever adds bits.', rows: [R('a', A), R('0', 0, { op: '|' }), R('a | 0', A, { line: true })], panel: [['identity', 'x | 0 = x']] },
      ]),
  ],
  xor: [
    'XOR',
    () =>
      bitFrames({ w: 8 }, [
        { note: 'XOR gives 1 where the columns differ.', rows: [R('a', A), R('b', B, { op: '^' }), R('a ^ b', A ^ B, { line: true, tone: 'ok', detail: DT.xor })], panel: [['a ^ b', A ^ B]] },
        { note: 'Anything XOR itself is 0.', rows: [R('a', A), R('a', A, { op: '^' }), R('a ^ a', 0, { line: true, tone: 'ok' })], panel: [['x ^ x', 0]] },
        { note: 'XOR with 0 changes nothing, and XOR is commutative and associative. So pairs cancel in any order.', rows: [R('a', A), R('0', 0, { op: '^' }), R('a ^ 0', A, { line: true })], panel: [['x ^ 0', 'x'], ['a ^ b ^ a', 'b']] },
        { note: 'XOR with a mask toggles exactly the masked bits.', rows: [R('a', A), R('0x0F', 0x0f, { op: '^' }), R('a ^ 0x0F', A ^ 0x0f, { line: true, tone: 'ok', hl: [0, 1, 2, 3] })], panel: [['toggled', 'low nibble']] },
      ]),
  ],
  not: [
    'NOT',
    () =>
      bitFrames({ w: 8 }, [
        { note: 'NOT flips every bit.', rows: [R('a', A, { signed: true }), R('~a', ~A, { op: '~', signed: true, tone: 'ok', detail: DT.not })], panel: [['~a', signedOf(~A, 8)]] },
        { note: 'In two’s complement ~x equals −x − 1.', rows: [R('x = 5', 5, { signed: true }), R('~x', ~5, { op: '~', signed: true, tone: 'ok' })], panel: [['~5', -6]] },
        { note: '~ is how you build clear masks: x & ~(1 << i) clears bit i.', rows: [R('1 << 3', 8), R('~(1 << 3)', ~8 & 0xff, { op: '~' })], panel: [['use', 'clear masks']] },
      ]),
  ],
});

// ---------------- 3. single bits & fields ----------------
const N0 = 0b01011010;
bitDemo('bits-single', 'Get, set, clear, toggle', 'One-bit masks (1 << i) for get/set/clear/toggle, and multi-bit fields with (1 << k) − 1.', {
  get: [
    'Get bit i',
    () =>
      bitFrames({ w: 8 }, [
        { note: 'To read bit 4 of n, build the mask 1 << 4.', rows: [R('n', N0), R('1 << 4', 16, { hl: [4] })], panel: [['i', 4]] },
        { note: 'n & mask is non-zero exactly when bit 4 is set.', rows: [R('n', N0), R('1 << 4', 16, { op: '&' }), R('n & mask', N0 & 16, { line: true, tone: 'ok', detail: DT.get })], panel: [['bit 4', 1, 'ok']] },
        { note: 'Or shift the bit down first: (n >> 4) & 1 is exactly 0 or 1.', rows: [R('n >> 4', N0 >> 4), R('1', 1, { op: '&' }), R('bit', (N0 >> 4) & 1, { line: true, tone: 'ok' })], panel: [['(n >> 4) & 1', 1]] },
      ]),
  ],
  set: [
    'Set bit i',
    () =>
      bitFrames({ w: 8 }, [
        { note: 'Set bit 2 by ORing in 1 << 2.', rows: [R('n', N0), R('1 << 2', 4, { op: '|', hl: [2] })], panel: [['i', 2]] },
        { note: 'Every other bit is unchanged.', rows: [R('n', N0), R('1 << 2', 4, { op: '|' }), R('n | mask', N0 | 4, { line: true, tone: 'ok', hl: [2], detail: DT.set })], panel: [['n', N0 | 4, 'ok']] },
        { note: 'Setting an already-set bit is a no-op.', rows: [R('n', N0 | 4), R('1 << 2', 4, { op: '|' }), R('n | mask', N0 | 4, { line: true })], panel: [['idempotent', 'yes']] },
      ]),
  ],
  clear: [
    'Clear bit i',
    () =>
      bitFrames({ w: 8 }, [
        { note: 'Clear bit 4: build 1 << 4 and invert it.', rows: [R('1 << 4', 16), R('~(1 << 4)', ~16 & 0xff, { op: '~', hl: [4] })], panel: [['mask', '11101111']] },
        { note: 'AND with the inverted mask zeroes bit 4 only.', rows: [R('n', N0), R('~(1 << 4)', ~16 & 0xff, { op: '&' }), R('n & ~mask', N0 & ~16, { line: true, tone: 'ok', hl: [4], detail: DT.clear })], panel: [['n', N0 & ~16, 'ok']] },
        { note: 'Clearing the lowest set bit has a faster trick, n & (n − 1).', rows: [R('n', N0), R('n − 1', N0 - 1, { op: '−' }), R('n & (n−1)', N0 & (N0 - 1), { line: true, tone: 'ok' })], panel: [['see', 'Lowest set bit']] },
      ]),
  ],
  toggle: [
    'Toggle bit i',
    () =>
      bitFrames({ w: 8 }, [
        { note: 'XOR with 1 << 0 flips bit 0.', rows: [R('n', N0), R('1 << 0', 1, { op: '^' }), R('n ^ 1', N0 ^ 1, { line: true, tone: 'ok', hl: [0], detail: DT.toggle })], panel: [['n', N0 ^ 1]] },
        { note: 'Toggling again restores it, because x ^ m ^ m == x.', rows: [R('n ^ 1', N0 ^ 1), R('1 << 0', 1, { op: '^' }), R('n', N0, { line: true, hl: [0] })], panel: [['n', N0]] },
        { note: 'A wider mask toggles several bits at once.', rows: [R('n', N0), R('0x0F', 0x0f, { op: '^' }), R('n ^ 0x0F', N0 ^ 0x0f, { line: true, tone: 'ok' })], panel: [['toggled', 4]] },
      ]),
  ],
  field: [
    'Bit fields',
    () =>
      bitFrames({ w: 8 }, [
        { note: '(1 << k) − 1 is k ones: the mask for a k-bit field.', rows: [R('1 << 4', 16), R('(1<<4) − 1', 15, { op: '−1', tone: 'ok', detail: DT.field })], panel: [['k', 4]] },
        { note: 'Read the 4-bit field at bits 3 to 6: shift it down, then mask.', rows: [R('n', N0, { hl: [3, 4, 5, 6] }), R('n >> 3', N0 >> 3, { op: '>>' }), R('& 0xF', (N0 >> 3) & 15, { op: '&', line: true, tone: 'ok' })], panel: [['field', (N0 >> 3) & 15]] },
        { note: 'Write 5 into that field: clear it with ~(0xF << 3), then OR in 5 << 3.', rows: [R('n', N0), R('~(0xF << 3)', ~(15 << 3) & 0xff, { op: '&' }), R('5 << 3', 5 << 3, { op: '|' }), R('n', (N0 & ~(15 << 3)) | (5 << 3), { line: true, tone: 'ok', hl: [3, 4, 5, 6] })], panel: [['n', (N0 & ~(15 << 3)) | (5 << 3), 'ok']] },
      ]),
  ],
});

// ---------------- 4. lowest set bit ----------------
bitDemo('bits-lowest', 'Lowest set bit tricks', 'n & (n − 1), n & −n, power of two / four, and isolating the lowest zero.', {
  clear: [
    'n & (n − 1)',
    () =>
      bitFrames({ w: 8 }, [
        { note: 'n = 12 has its lowest set bit at position 2.', rows: [R('n = 12', 12, { hl: [2] })], panel: [['lowest set', 'bit 2']] },
        { note: 'n − 1 flips that bit to 0 and every 0 below it to 1.', rows: [R('n', 12), R('n − 1', 11, { op: '−1', hl: [0, 1, 2] })], panel: [['n − 1', 11]] },
        { note: 'AND cancels exactly those bits: the lowest set bit is gone.', rows: [R('n', 12), R('n − 1', 11, { op: '&' }), R('n & (n−1)', 8, { line: true, tone: 'ok', detail: DT.clearLow })], panel: [['result', 8, 'ok']] },
      ]),
  ],
  pow2: [
    'Power of two',
    () =>
      bitFrames({ w: 8 }, [
        { note: 'A power of two has exactly one set bit.', rows: [R('16', 16, { hl: [4] }), R('12', 12)], panel: [['LC', '231 Power of Two']] },
        { note: '16 & 15 is 0, so 16 is a power of two.', rows: [R('n = 16', 16), R('n − 1', 15, { op: '&' }), R('n & (n−1)', 0, { line: true, tone: 'ok', detail: DT.clearLow })], panel: [['16', 'power of 2', 'ok']] },
        { note: '12 & 11 is 8, not 0: another bit survives.', rows: [R('n = 12', 12), R('n − 1', 11, { op: '&' }), R('n & (n−1)', 8, { line: true, tone: 'fail' })], panel: [['12', 'not a power', 'fail']] },
      ]),
  ],
  pow4: [
    'Power of four',
    () =>
      bitFrames({ w: 8 }, [
        { note: 'Powers of four are powers of two with the bit at an even index. 0x55 marks the even bits.', rows: [R('0x55', 0x55, { detail: DT.pow4 })], panel: [['LC', '342 Power of Four']] },
        { note: '16 has one bit, at index 4, so 16 & 0x55 is non-zero.', rows: [R('n = 16', 16), R('0x55', 0x55, { op: '&' }), R('n & 0x55', 16 & 0x55, { line: true, tone: 'ok' })], panel: [['16', isPowerOfFour(16) ? 'power of 4' : 'no', 'ok']] },
        { note: '8 is a power of two, but its bit is at index 3, so the mask kills it.', rows: [R('n = 8', 8), R('0x55', 0x55, { op: '&' }), R('n & 0x55', 8 & 0x55, { line: true, tone: 'fail' })], panel: [['8', isPowerOfFour(8) ? 'power of 4' : 'not a power of 4', 'fail']] },
      ]),
  ],
  isolate: [
    'n & −n',
    () =>
      bitFrames({ w: 8 }, [
        { note: '−n is ~n + 1: every bit above the lowest set bit flips, that bit and below stay.', rows: [R('n = 12', 12), R('−n', -12, { op: '−', signed: true })], panel: [['−n', -12]] },
        { note: 'So n & −n keeps only the lowest set bit.', rows: [R('n', 12), R('−n', -12, { op: '&', signed: true }), R('n & −n', 4, { line: true, tone: 'ok', detail: DT.lowbit })], panel: [['lowbit', 4, 'ok']] },
        { note: 'Fenwick trees step by it, and LC 260 splits numbers with it.', rows: [R('n = 40', 40), R('n & −n', 40 & -40, { tone: 'ok' })], panel: [['40 & −40', 8]] },
      ]),
  ],
  zero: [
    'Lowest zero bit',
    () =>
      bitFrames({ w: 8 }, [
        { note: 'n + 1 turns the trailing 1s to 0 and the lowest 0 into 1.', rows: [R('n', 183), R('n + 1', 184, { op: '+1', hl: [0, 1, 2, 3] })], panel: [['n', 183]] },
        { note: '~n & (n + 1) isolates that lowest 0 bit.', rows: [R('~n', ~183 & 0xff), R('n + 1', 184, { op: '&' }), R('lowest zero', ~183 & 184 & 0xff, { line: true, tone: 'ok', detail: DT.lowzero })], panel: [['lowest zero', 'bit 3']] },
        { note: 'n | (n + 1) sets it instead.', rows: [R('n', 183), R('n + 1', 184, { op: '|' }), R('n | (n+1)', 183 | 184, { line: true, tone: 'ok', hl: [3] })], panel: [['result', 183 | 184]] },
      ]),
  ],
});

// ---------------- 5. popcount ----------------
function kernighanFrames(n: number): Frame[] {
  const beats: Beat[] = [{ note: `Count the set bits of ${n}. Kernighan’s loop runs once per set bit.`, rows: [R('n', n, { detail: DT.kernighan })], panel: [['count', 0]] }];
  const hist: BR[] = [R('n', n)];
  let x = n;
  let c = 0;
  while (x) {
    const low = x & -x;
    x &= x - 1;
    c++;
    hist.push(R(`n &= n−1`, x, { op: '&', tone: x ? undefined : 'ok' }));
    beats.push({ note: `Clear bit ${Math.log2(low)}: count = ${c}.`, rows: hist.map((r, i) => (i === hist.length - 2 ? { ...r, hl: [Math.log2(low)] } : r)), panel: [['count', c, x ? undefined : 'ok']] });
  }
  beats.push({ note: `n is 0 after ${c} rounds. std::popcount does it in one POPCNT instruction.`, rows: hist, panel: [['popcount', popcount(n), 'ok'], ['LC', '191 Number of 1 Bits']] });
  return bitFrames({ w: 8 }, beats, 'Popcount');
}
bitDemo('bits-popcount', 'Counting bits', 'Kernighan’s loop, Counting Bits DP, Hamming distance and total Hamming distance by columns.', {
  kernighan: ['Kernighan loop', () => kernighanFrames(0b10110100)],
  dp: [
    'Counting Bits DP',
    () => {
      const b = countBits(8);
      const rows = (k: number, hi = -1) => Array.from({ length: k + 1 }, (_, i) => R(`${i} → ${b[i]}`, i, { sub: i ? `= [${i >> 1}] + ${i & 1}` : 'base', tone: i === hi ? 'current' : undefined, detail: DT.countBits }));
      return bitFrames({ w: 4 }, [
        { note: 'i >> 1 is i without its last bit, and its count is already known.', rows: rows(4), panel: [['LC', '338 Counting Bits']] },
        { note: 'So bits[i] = bits[i >> 1] + (i & 1), one step per number.', rows: rows(8), panel: [['time', 'O(n)']] },
        { note: '6 = 110 reuses 3 = 11 (two bits) and adds its last bit 0.', rows: rows(8, 6), panel: [['bits[6]', b[6], 'ok']] },
      ], 'Counting bits');
    },
  ],
  hamming: [
    'Hamming distance',
    () =>
      bitFrames({ w: 8 }, [
        { note: 'Hamming distance counts the positions where two numbers differ.', rows: [R('x = 93', 93), R('y = 73', 73)], panel: [['LC', '461 Hamming Distance']] },
        { note: 'x ^ y has a 1 exactly at those positions.', rows: [R('x', 93), R('y', 73, { op: '^' }), R('x ^ y', 93 ^ 73, { line: true, tone: 'ok', hl: ones(93 ^ 73, 8), detail: DT.hamming })], panel: [['x ^ y', 93 ^ 73]] },
        { note: `Popcount of the XOR is the distance: ${hamming(93, 73)}.`, rows: [R('x ^ y', 93 ^ 73, { tone: 'ok' })], panel: [['distance', hamming(93, 73), 'ok']] },
      ], 'Hamming'),
  ],
  total: [
    'Total Hamming distance',
    () => {
      const nums = [4, 14, 2];
      const rows = (b: number) => nums.map((x) => R(`${x}`, x, { hl: b >= 0 && bitOf(x, b) ? [b] : [], detail: DT.total }));
      const beats: Beat[] = [{ note: 'All pairs would be O(n²). Count per bit column instead.', rows: rows(-1), panel: [['LC', '477 Total Hamming Distance']] }];
      let t = 0;
      for (let b = 0; b < 4; b++) {
        const k = nums.filter((x) => bitOf(x, b)).length;
        t += k * (nums.length - k);
        beats.push({ note: `Bit ${b}: ${k} ones and ${nums.length - k} zeros give ${k * (nums.length - k)} differing pairs.`, rows: rows(b), panel: [[`bit ${b}`, `${k}·${nums.length - k}`], ['total', t]] });
      }
      beats.push({ note: `Sum over columns: ${totalHamming(nums)}. O(32·n) no matter how many pairs.`, rows: rows(-1), panel: [['total', totalHamming(nums), 'ok']] });
      return bitFrames({ w: 4 }, beats, 'Columns');
    },
  ],
});

// ---------------- 6. XOR tricks ----------------
function runningXor(nums: number[], w: number, intro: string, outro: string, detail: Detail, labels?: string[]): Frame[] {
  const beats: Beat[] = [{ note: intro, rows: nums.map((v, i) => R(labels?.[i] ?? String(v), v, { op: i ? '^' : undefined })), panel: [['n', nums.length]] }];
  let acc = 0;
  nums.forEach((v, i) => {
    acc ^= v;
    if (i > 0)
      beats.push({ note: `acc ^= ${labels?.[i] ?? v}: acc is now ${acc}.`, rows: [...nums.slice(0, i + 1).map((x, j) => R(labels?.[j] ?? String(x), x, { op: j ? '^' : undefined })), R('acc', acc, { line: true, tone: 'write' })], panel: [['acc', acc]] });
  });
  beats.push({ note: outro, rows: [...nums.map((x, j) => R(labels?.[j] ?? String(x), x, { op: j ? '^' : undefined })), R('result', acc, { line: true, tone: 'ok', detail })], panel: [['result', acc, 'ok']] });
  return bitFrames({ w }, beats, 'XOR');
}
bitDemo('bits-xor', 'XOR tricks', 'Pairs cancel: Single Number, Missing Number, XOR swap, XOR of 0..n and prefix XOR queries.', {
  single: ['Single Number', () => runningXor([4, 1, 2, 1, 2], 4, 'Every number appears twice except one (LC 136). XOR them all.', 'The pairs cancelled to 0, leaving 4. O(n) time, O(1) space.', DT.single)],
  missing: [
    'Missing Number',
    () =>
      runningXor([0, 1, 2, 3, 3, 0, 1], 4, 'XOR the indices 0..3 with the values 3, 0, 1 (LC 268).', `Every present number cancelled with its index, so ${missingNumber([3, 0, 1])} is missing.`, DT.missing, ['i 0', 'i 1', 'i 2', 'i 3', 'v 3', 'v 0', 'v 1']),
  ],
  swap: [
    'XOR swap',
    () =>
      bitFrames({ w: 4 }, [
        { note: 'Swap a = 12 and b = 10 without a temporary.', rows: [R('a', 12), R('b', 10)], panel: [['a', 12], ['b', 10]] },
        { note: 'a ^= b: a now holds the bits where a and b differ.', rows: [R('a', 12), R('b', 10, { op: '^' }), R('a', 12 ^ 10, { line: true, tone: 'write' })], panel: [['a', 12 ^ 10]] },
        { note: 'b ^= a: (a ^ b) ^ b cancels b, leaving the original a.', rows: [R('b', 10), R('a', 12 ^ 10, { op: '^' }), R('b', 12, { line: true, tone: 'write' })], panel: [['b', 12]] },
        { note: 'a ^= b: (a ^ b) ^ a cancels a, leaving the original b.', rows: [R('a', 12 ^ 10), R('b', 12, { op: '^' }), R('a', 10, { line: true, tone: 'write' })], panel: [['a', 10]] },
        { note: 'Swapped. A party trick: std::swap is as fast, and safe when a and b alias.', rows: [R('a', 10, { tone: 'ok', detail: DT.swap }), R('b', 12, { tone: 'ok' })], panel: [['a', 10, 'ok'], ['b', 12, 'ok']] },
      ], 'XOR swap'),
  ],
  range: [
    'XOR of 0..n',
    () => {
      const rows = (k: number, hl = -1) => Array.from({ length: k + 1 }, (_, i) => R(`f(${i})`, xorUpTo(i), { sub: `0^…^${i} = ${xorUpTo(i)}`, tone: i % 4 === hl ? 'current' : undefined, detail: DT.range }));
      return bitFrames({ w: 4 }, [
        { note: 'f(n) = 0 ^ 1 ^ … ^ n looks random at first.', rows: rows(3), panel: [['f', 'n, 1, n+1, 0']] },
        { note: 'It repeats every 4: n, 1, n + 1, 0 for n mod 4 = 0, 1, 2, 3.', rows: rows(7, 3), panel: [['period', 4]] },
        { note: 'So the XOR of l..r is f(r) ^ f(l − 1) in O(1), as in LC 1486.', rows: rows(7, 0), panel: [['xor(3..6)', xorUpTo(6) ^ xorUpTo(2), 'ok']] },
      ], 'Prefix pattern');
    },
  ],
  prefix: [
    'Prefix XOR',
    () => {
      const arr = [1, 3, 4, 8];
      const p = [0];
      arr.forEach((v) => p.push(p[p.length - 1] ^ v));
      const rows = (hl: number[] = []) => p.map((v, i) => R(`p[${i}]`, v, { tone: hl.includes(i) ? 'current' : undefined, detail: DT.prefix }));
      return bitFrames({ w: 4 }, [
        { note: 'p[i+1] = p[i] ^ a[i] for a = [1, 3, 4, 8] (LC 1310).', rows: rows(), panel: [['p', p.join(', ')]] },
        { note: `Query [1, 2] is p[3] ^ p[1] = ${p[3] ^ p[1]}: the shared prefix cancels.`, rows: rows([1, 3]), panel: [['3 ^ 4', p[3] ^ p[1], 'ok']] },
        { note: `Query [0, 3] is p[4] ^ p[0] = ${p[4] ^ p[0]}.`, rows: rows([0, 4]), panel: [['1^3^4^8', p[4], 'ok']] },
        { note: 'Equal prefixes p[i] == p[k+1] mean a zero-XOR stretch, which is all LC 1442 counts.', rows: rows(), panel: [['LC', '1442 Count Triplets']] },
      ], 'Prefix XOR');
    },
  ],
});

// ---------------- 7. single number II / III ----------------
bitDemo('bits-single2', 'Single Number II & III', 'Split by the lowest differing bit (LC 260), count bits mod 3 and the ones/twos state machine (LC 137).', {
  partition: [
    'Two singles (LC 260)',
    () => {
      const nums = [1, 2, 1, 3, 2, 5];
      const x = singleNumber(nums);
      const low = x & -x;
      const lb = Math.log2(low);
      const [a, b] = singleNumberIII(nums);
      const ga = nums.filter((v) => v & low);
      const gb = nums.filter((v) => !(v & low));
      return bitFrames({ w: 4 }, [
        { note: 'Two numbers appear once, the rest twice. XOR of everything is a ^ b.', rows: [...nums.map((v, i) => R(String(v), v, { op: i ? '^' : undefined })), R('a ^ b', x, { line: true, tone: 'write' })], panel: [['a ^ b', x]] },
        { note: `a and b differ at every 1 of ${x}. Take the lowest one, bit ${lb}, with x & −x.`, rows: [R('a ^ b', x), R('low', low, { tone: 'current', hl: [lb], detail: DT.lowbit })], panel: [['low', low]] },
        { note: `Numbers with bit ${lb} set go to one group. Pairs stay together, and a and b split.`, rows: ga.map((v, i) => R(String(v), v, { op: i ? '^' : undefined, hl: [lb] })).concat([R('group 1', a === (ga.reduce((s, v) => s ^ v, 0)) ? a : b, { line: true, tone: 'ok' })]), panel: [['group 1', ga.join(', ')]] },
        { note: `The rest XOR to the other single. Answer ${a} and ${b}.`, rows: gb.map((v, i) => R(String(v), v, { op: i ? '^' : undefined })).concat([R('group 2', gb.reduce((s, v) => s ^ v, 0), { line: true, tone: 'ok', detail: DT.single3 })]), panel: [['answer', `${a}, ${b}`, 'ok']] },
      ], 'LC 260');
    },
  ],
  mod3: [
    'Count bits mod 3',
    () => {
      const nums = [2, 2, 3, 2];
      const cnt = (b: number) => nums.filter((v) => bitOf(v, b)).length;
      const rows = (b: number) => nums.map((v) => R(String(v), v, { hl: b >= 0 && bitOf(v, b) ? [b] : [] }));
      return bitFrames({ w: 4 }, [
        { note: 'Every number appears three times except one (LC 137). XOR can’t cancel triples.', rows: rows(-1), panel: [['nums', nums.join(', ')]] },
        { note: `Count ones per column: bit 0 has ${cnt(0)}, and ${cnt(0)} mod 3 = ${cnt(0) % 3}.`, rows: rows(0), panel: [['bit 0', `${cnt(0)} → ${cnt(0) % 3}`]] },
        { note: `Bit 1 has ${cnt(1)}, and ${cnt(1)} mod 3 = ${cnt(1) % 3}. Triples vanish mod 3.`, rows: rows(1), panel: [['bit 1', `${cnt(1)} → ${cnt(1) % 3}`]] },
        { note: `The leftover column bits spell the single number, ${singleNumberII(nums)}.`, rows: [...rows(-1), R('single', singleNumberII(nums), { line: true, tone: 'ok', detail: DT.single2 })], panel: [['answer', singleNumberII(nums), 'ok']] },
      ], 'LC 137');
    },
  ],
  fsm: [
    'ones / twos',
    () => {
      const nums = [2, 2, 3, 2];
      let o = 0;
      let t = 0;
      const beats: Beat[] = [{ note: 'ones holds bits seen once (mod 3), twos bits seen twice. Both start at 0.', rows: [R('ones', 0), R('twos', 0)], panel: [['state', '00']] }];
      nums.forEach((x, n) => {
        o = (o ^ x) & ~t;
        beats.push({ note: `Read ${x} (#${n + 1}). ones = (ones ^ x) & ~twos: bits seen once, unless already in twos.`, rows: [R('x', x), R('ones', o, { tone: 'write' }), R('twos', t)], panel: [['ones', o], ['twos', t]] });
        t = (t ^ x) & ~o;
        beats.push({ note: 'twos = (twos ^ x) & ~ones: bits seen twice. A third sighting clears both.', rows: [R('x', x), R('ones', o), R('twos', t, { tone: 'write' })], panel: [['ones', o], ['twos', t]] });
      });
      beats.push({ note: `A bit seen three times clears from both. ones = ${o} is the answer.`, rows: [R('ones', o, { tone: 'ok', detail: DT.single2 }), R('twos', t)], panel: [['answer', o, 'ok']] });
      return bitFrames({ w: 4 }, beats, 'State machine');
    },
  ],
});

// ---------------- 8. reverse, complement, alternating ----------------
bitDemo('bits-reverse', 'Reverse, complement, patterns', 'Reverse Bits by loop and by mask swaps, Number Complement, Alternating Bits.', {
  loop: [
    'Reverse (loop)',
    () => {
      const n = 0b00010110;
      const beats: Beat[] = [{ note: 'Reverse 8 bits of 22: pop the low bit of n and push it into r (LC 190 uses 32).', rows: [R('n', n), R('r', 0)], panel: [['i', 0]] }];
      let x = n;
      let r = 0;
      for (let i = 1; i <= 8; i++) {
        const low = x & 1;
        r = ((r << 1) | low) & 0xff;
        x >>= 1;
        beats.push({ note: `Step ${i}: n & 1 is ${low}. Shift r left and put it in; shift n right.`, rows: [R('n', x), R('r', r, { tone: i === 8 ? 'ok' : 'write', hl: [0], detail: i === 8 ? DT.reverse : undefined })], panel: [['i', i], ['r', r]] });
      }
      beats.push({ note: `Reversed: ${reverseBits(n, 8)}. For many calls, cache a 256-entry byte table.`, rows: [R('input', n), R('reversed', reverseBits(n, 8), { tone: 'ok', detail: DT.reverse })], panel: [['result', reverseBits(n, 8), 'ok']] });
      return bitFrames({ w: 8 }, beats, 'Reverse bits');
    },
  ],
  dc: [
    'Reverse (masks)',
    () => {
      const n = 0b00010110;
      const s1 = ((n & 0xf0) >> 4) | ((n & 0x0f) << 4);
      const s2 = ((s1 & 0xcc) >> 2) | ((s1 & 0x33) << 2);
      const s3 = ((s2 & 0xaa) >> 1) | ((s2 & 0x55) << 1);
      return bitFrames({ w: 8 }, [
        { note: 'Divide and conquer: swap halves, then quarters, then single bits.', rows: [R('n', n)], panel: [['stages', 'log2(8) = 3']] },
        { note: 'Swap nibbles with masks 0xF0 and 0x0F.', rows: [R('n', n), R('nibbles', s1, { tone: 'write' })], panel: [['after', s1]] },
        { note: 'Swap bit pairs with 0xCC and 0x33.', rows: [R('n', n), R('nibbles', s1), R('pairs', s2, { tone: 'write' })], panel: [['after', s2]] },
        { note: 'Swap neighbours with 0xAA and 0x55. 32 bits need 5 stages, no loop.', rows: [R('n', n), R('nibbles', s1), R('pairs', s2), R('bits', s3, { tone: 'ok', detail: DT.reverse })], panel: [['result', s3, s3 === reverseBits(n, 8) ? 'ok' : 'fail']] },
      ], 'Mask swaps');
    },
  ],
  complement: [
    'Number Complement',
    () =>
      bitFrames({ w: 8 }, [
        { note: 'Complement 5 = 101 without flipping the leading zeros (LC 476).', rows: [R('n = 5', 5), R('~n', ~5 & 0xff, { op: '~', tone: 'fail' })], panel: [['~n', 'flips too much', 'fail']] },
        { note: 'Build a mask of 1s as wide as n: 111.', rows: [R('n', 5), R('mask', 7, { hl: [0, 1, 2] })], panel: [['mask', 7]] },
        { note: `n ^ mask flips only the significant bits: ${findComplement(5)}. LC 1009 treats 0 as 1.`, rows: [R('n', 5), R('mask', 7, { op: '^' }), R('result', findComplement(5), { line: true, tone: 'ok', detail: DT.complement })], panel: [['result', findComplement(5), 'ok']] },
      ], 'Complement'),
  ],
  alternating: [
    'Alternating bits',
    () =>
      bitFrames({ w: 8 }, [
        { note: 'Does 21 = 10101 alternate (LC 693)? Shift by one and XOR.', rows: [R('n', 21), R('n >> 1', 10, { op: '^' }), R('x', 21 ^ 10, { line: true, tone: 'write' })], panel: [['x', 21 ^ 10]] },
        { note: 'Alternating means x is all ones, and all ones means x & (x + 1) == 0.', rows: [R('x', 31), R('x + 1', 32, { op: '&' }), R('x & (x+1)', 0, { line: true, tone: 'ok', detail: DT.alternating })], panel: [['21', hasAlternatingBits(21) ? 'alternates' : 'no', 'ok']] },
        { note: '22 = 10110 fails: its x has a gap, so the AND is non-zero.', rows: [R('n', 22), R('n >> 1', 11, { op: '^' }), R('x', 22 ^ 11, { line: true }), R('x & (x+1)', (22 ^ 11) & ((22 ^ 11) + 1), { tone: 'fail' })], panel: [['22', hasAlternatingBits(22) ? 'alternates' : 'no', 'fail']] },
      ], 'Patterns'),
  ],
});

// ---------------- 9. arithmetic ----------------
bitDemo('bits-arith', 'Arithmetic with bits', 'Add with XOR and carries (LC 371), divide by shift-subtract (LC 29), multiply by shifts, branchless abs.', {
  sum: [
    'Add without +',
    () => {
      let a = 5;
      let b = 3;
      const beats: Beat[] = [{ note: 'Add 5 and 3 without + (LC 371).', rows: [R('a', a), R('b', b)], panel: [['a + b', getSum(5, 3)]] }];
      while (b) {
        const s = a ^ b;
        const c = (a & b) << 1;
        beats.push({ note: `a ^ b adds every column but drops the carries: ${s}.`, rows: [R('a', a), R('b', b, { op: '^' }), R('a ^ b', s, { line: true, tone: 'write' })], panel: [['sum', s]] });
        beats.push({ note: c ? `1 + 1 columns carry into the next column: (a & b) << 1 = ${c}.` : 'No column has 1 + 1, so there is no carry.', rows: [R('a', a), R('b', b, { op: '&' }), R('carry', c, { op: '<<1', line: true, tone: c ? 'warn' : 'ok', hl: ones(c, 8) })], panel: [['sum', s], ['carry', c]], whole: true });
        if (c) beats.push({ note: `Now add the carry: a = ${s}, b = ${c}. Repeat.`, rows: [R('a', s, { tone: 'write' }), R('b', c, { tone: 'write' })], panel: [['a', s], ['b', c]] });
        a = s;
        b = c;
      }
      beats.push({ note: `No carry left, a = ${a}. This is a ripple-carry adder in software.`, rows: [R('a', a, { tone: 'ok', detail: DT.sum }), R('carry', 0)], panel: [['result', a, 'ok']] });
      return bitFrames({ w: 8 }, beats, 'LC 371');
    },
  ],
  divide: [
    'Divide by shifts',
    () => {
      const a = 43;
      const b = 5;
      return bitFrames({ w: 8 }, [
        { note: 'Divide 43 by 5 without / (LC 29): long division in base 2.', rows: [R('dividend', a), R('divisor', b)], panel: [['q', 0]] },
        { note: '5 << 3 = 40 is the largest shifted divisor that fits.', rows: [R('dividend', a), R('5 << 3', b << 3, { tone: 'current' }), R('5 << 4', b << 4, { tone: 'fail' })], panel: [['k', 3]] },
        { note: 'Subtract it: 43 − 40 leaves 3.', rows: [R('dividend', a), R('5 << 3', b << 3, { op: '−' }), R('remainder', a - (b << 3), { line: true, tone: 'write' })], panel: [['r', a - (b << 3)]] },
        { note: 'Add 1 << 3 to the quotient. 3 is less than 5, so stop: 43 / 5 = 8.', rows: [R('remainder', a - (b << 3)), R('q', 8, { tone: 'ok', hl: [3], detail: DT.divide })], panel: [['q', divide(a, b), 'ok'], ['r', a % b]] },
        { note: 'Handle signs separately and clamp INT_MIN / −1, the one overflow case.', rows: [R('q', divide(a, b), { tone: 'ok' })], panel: [['INT_MIN / −1', 'INT_MAX']] },
      ], 'LC 29');
    },
  ],
  mul: [
    'Multiply by shifts',
    () =>
      bitFrames({ w: 8 }, [
        { note: '10 = 1010, so x · 10 = x · 8 + x · 2.', rows: [R('x = 13', 13), R('10', 10, { hl: [1, 3] })], panel: [['x · 10', 130]] },
        { note: 'Shift for each set bit of 10 and add.', rows: [R('x << 3', 13 << 3), R('x << 1', 13 << 1, { op: '+' }), R('x · 10', 130, { line: true, tone: 'ok', detail: DT.mul })], panel: [['result', 130, 'ok']] },
        { note: 'Compilers already do this for constant multipliers. Write x * 10 and let them.', rows: [R('x · 10', 130, { tone: 'ok' })], panel: [['asm', 'lea + add']] },
      ], 'Shift-add'),
  ],
  abs: [
    'Branchless abs',
    () =>
      bitFrames({ w: 8 }, [
        { note: 'x >> 7 on a signed 8-bit value is all ones if negative, else 0.', rows: [R('x = −6', -6, { signed: true }), R('mask', -1, { op: '>>', signed: true })], panel: [['mask', -1]] },
        { note: 'x + mask subtracts 1 from negatives.', rows: [R('x', -6, { signed: true }), R('mask', -1, { op: '+', signed: true }), R('x + mask', -7, { line: true, signed: true })], panel: [['x + mask', -7]] },
        { note: 'XOR with mask flips all bits, finishing the negation: 6.', rows: [R('x + mask', -7, { signed: true }), R('mask', -1, { op: '^', signed: true }), R('|x|', 6, { line: true, tone: 'ok', detail: DT.abs })], panel: [['|x|', 6, 'ok']] },
      ], 'Branchless'),
  ],
});

// ---------------- 10. ranges & per-bit reasoning ----------------
bitDemo('bits-range', 'Per-bit reasoning', 'Range AND as a common prefix (LC 201), Minimum Flips (LC 1318), distinct subarray ORs (LC 898).', {
  rangeand: [
    'Range AND',
    () => {
      let m = 5;
      let n = 7;
      const beats: Beat[] = [{ note: 'AND every number from 5 to 7 (LC 201). Any bit that changes in the range ends up 0.', rows: [R('5', 5), R('6', 6, { op: '&' }), R('7', 7, { op: '&' }), R('AND', 5 & 6 & 7, { line: true })], panel: [['brute force', 5 & 6 & 7]] }];
      let s = 0;
      while (m < n) {
        m >>= 1;
        n >>= 1;
        s++;
        beats.push({ note: `Shift both right until they match: shift ${s} gives ${m} and ${n}.`, rows: [R('m', m), R('n', n)], panel: [['shift', s]] });
      }
      beats.push({ note: `The common prefix is ${m}; shift it back: ${rangeBitwiseAnd(5, 7)}.`, rows: [R('prefix', m), R('<< ' + s, rangeBitwiseAnd(5, 7), { tone: 'ok', detail: DT.rangeand })], panel: [['answer', rangeBitwiseAnd(5, 7), 'ok']] });
      return bitFrames({ w: 4 }, beats, 'LC 201');
    },
  ],
  flips: [
    'Minimum flips',
    () => {
      const [a, b, c] = [2, 6, 5];
      const rows = (bit: number) => [R('a', a, { hl: bit >= 0 ? [bit] : [] }), R('b', b, { hl: bit >= 0 ? [bit] : [] }), R('a | b', a | b, { line: true }), R('c', c, { hl: bit >= 0 ? [bit] : [] })];
      const beats: Beat[] = [{ note: 'Flip as few bits of a and b as possible so a | b == c (LC 1318).', rows: rows(-1), panel: [['flips', 0]] }];
      let f = 0;
      for (let i = 0; i < 3; i++) {
        const x = bitOf(a, i);
        const y = bitOf(b, i);
        const z = bitOf(c, i);
        const k = z ? (x | y ? 0 : 1) : x + y;
        f += k;
        beats.push({ note: z ? `Bit ${i}: c wants 1, a | b has ${x | y}, so ${k} flip${k === 1 ? '' : 's'}.` : `Bit ${i}: c wants 0, so every 1 in a and b flips: ${k}.`, rows: rows(i), panel: [[`bit ${i}`, k], ['total', f]] });
      }
      beats.push({ note: `Total ${minFlips(a, b, c)} flips. Each bit is decided on its own.`, rows: [...rows(-1).slice(0, 3), R('c', c, { tone: 'ok', detail: DT.flips })], panel: [['answer', minFlips(a, b, c), 'ok']] });
      return bitFrames({ w: 4 }, beats, 'LC 1318');
    },
  ],
  orsub: [
    'Subarray ORs',
    () => {
      const arr = [1, 1, 2, 4];
      const beats: Beat[] = [{ note: 'Count distinct ORs over all subarrays of [1, 1, 2, 4] (LC 898). There are O(n²) subarrays.', rows: arr.map((v) => R(String(v), v)), panel: [['subarrays', (arr.length * (arr.length + 1)) / 2]] }];
      let cur = new Set<number>();
      const all = new Set<number>();
      arr.forEach((x, i) => {
        const next = new Set<number>([x]);
        cur.forEach((y) => next.add(y | x));
        cur = next;
        cur.forEach((v) => all.add(v));
        beats.push({ note: `ORs ending at index ${i} only gain bits, so there are few: ${[...cur].join(', ')}.`, rows: [R(`a[${i}]`, x, { tone: 'current' }), ...[...cur].map((v) => R(`ends ${i}`, v, { tone: 'write' }))], panel: [['set size', cur.size], ['distinct', all.size]] });
      });
      beats.push({ note: `${subarrayBitwiseORs(arr)} distinct values, found in O(32·n).`, rows: [...all].map((v) => R('OR', v, { tone: 'ok', detail: DT.orsub })), panel: [['answer', subarrayBitwiseORs(arr), 'ok']] });
      return bitFrames({ w: 4 }, beats, 'LC 898');
    },
  ],
});

// ---------------- 11. subsets ----------------
bitDemo('bits-subsets', 'Masks as subsets', 'Enumerate subsets (LC 78), iterate submasks, Gosper’s hack for k-combinations, Gray code (LC 89).', {
  all: [
    'All subsets',
    () => {
      const items = ['a', 'b', 'c'];
      const name = (m: number) => `{${items.filter((_, i) => m & (1 << i)).join(',')}}`;
      const rows = (k: number, hi = -1) => Array.from({ length: k }, (_, m) => R(name(m), m, { sub: `mask ${m}`, tone: m === hi ? 'current' : undefined, detail: DT.subsets }));
      const idx = (b: number) => items[b];
      return bitFrames({ w: 3, idx }, [
        { note: 'Bit i of the mask says whether item i is in the subset.', rows: rows(4), panel: [['n', 3]] },
        { note: 'Counting 0 to 2^n − 1 lists every subset exactly once (LC 78).', rows: rows(8), panel: [['subsets', 8]] },
        { note: 'Mask 5 = 101 is {a, c}.', rows: rows(8, 5), panel: [['mask 5', '{a, c}', 'ok']] },
      ], 'Subsets');
    },
  ],
  submask: [
    'Submasks',
    () => {
      const m = 0b1011;
      const subs = submasks(m);
      const rows = (k: number) => [R('m', m, { tone: 'current' }), ...subs.slice(0, k).map((s) => R(`s = ${s}`, s, { tone: 'write', detail: DT.submask }))];
      return bitFrames({ w: 4 }, [
        { note: 'List every submask of m = 1011: subsets of its set bits.', rows: rows(0), panel: [['popcount', popcount(m)]] },
        ...subs.map((v, k): Beat => ({
          note: k ? `(${subs[k - 1]} − 1) & m = ${v}: −1 borrows through the low bits, & m drops the bits m doesn’t have.` : `Start with s = m = ${v}.`,
          rows: rows(k + 1).map((r, j) => (j === k + 1 ? { ...r, tone: 'current' as Tone } : r)),
          panel: [['s', v], ['seen', k + 1]],
        })),
        { note: `All ${subs.length} non-empty submasks, in descending order. Over every mask this totals 3^n.`, rows: rows(subs.length), panel: [['submasks', subs.length, 'ok'], ['all masks', '3^n']] },
      ], 'Submasks');
    },
  ],
  gosper: [
    'Gosper’s hack',
    () => {
      const x = 0b00111;
      const c = x & -x;
      const r = x + c;
      const seq = [x];
      while (seq.length < 7) seq.push(gosper(seq[seq.length - 1]));
      return bitFrames({ w: 5 }, [
        { note: 'Walk all 3-of-5 combinations in order, starting from 00111.', rows: [R('x', x)], panel: [['k', 3]] },
        { note: 'c = x & −x is the lowest set bit.', rows: [R('x', x), R('c', c, { tone: 'current' })], panel: [['c', c]] },
        { note: 'r = x + c carries the lowest block of 1s up by one place.', rows: [R('x', x), R('c', c, { op: '+' }), R('r', r, { line: true, tone: 'write' })], panel: [['c', c], ['r', r]] },
        { note: '((r ^ x) >> 2) / c refills the leftover 1s at the bottom; OR with r.', rows: [R('x', x), R('next', gosper(x), { tone: 'ok', detail: DT.gosper })], panel: [['next', gosper(x), 'ok']] },
        { note: 'Repeat for every combination, each with popcount 3.', rows: seq.map((v) => R(String(v), v, { tone: 'write' })), panel: [['C(5,3)', 10]] },
      ], 'Gosper');
    },
  ],
  gray: [
    'Gray code',
    () => {
      const g = grayCode(3);
      const rows = (k: number) => g.slice(0, k).map((v, i) => R(`${i} → ${v}`, v, { hl: i ? [Math.log2(v ^ g[i - 1])] : [], detail: DT.gray }));
      return bitFrames({ w: 3 }, [
        { note: 'Gray code orders numbers so neighbours differ in one bit (LC 89).', rows: rows(4), panel: [['n', 3]] },
        { note: 'g(i) = i ^ (i >> 1). The highlighted bit is the one that changed.', rows: rows(8), panel: [['codes', g.join(', ')]] },
        { note: 'The last code also differs from the first in one bit, so it is a cycle.', rows: [R('last', g[7]), R('first', g[0])], panel: [['cyclic', 'yes', 'ok']] },
      ], 'Gray code');
    },
  ],
});

// ---------------- 12. bitmask DP ----------------
bitDemo('bits-dp', 'Bitmask DP', 'State = mask of used items: visit all nodes (LC 847), partition into k subsets (LC 698), assignment (LC 1879), Can I Win (LC 464).', {
  visitall: [
    'Visit all nodes',
    () => {
      const graph = [[1, 2, 3], [0], [0], [0]];
      const path = [1, 0, 2, 0, 3];
      let m = 0;
      const rows: BR[] = [];
      const beats: Beat[] = [{ note: 'Star graph: 0 links to 1, 2 and 3 (LC 847). A BFS state is (node, visited mask).', rows: [R('start', 0)], panel: [['states', `${graph.length}·2^${graph.length}`]] }];
      path.forEach((v, i) => {
        m |= 1 << v;
        rows.push(R(`at ${v}`, m, { hl: [v], tone: m === 15 ? 'ok' : 'write', detail: DT.visit }));
        beats.push({ note: `Step ${i}: at node ${v}, visited mask ${m.toString(2).padStart(4, '0')}.`, rows: [...rows], panel: [['steps', i], ['mask', m]] });
      });
      beats.push({ note: `The first BFS level reaching mask 1111 is ${shortestPathAllNodes(graph)} steps.`, rows, panel: [['answer', shortestPathAllNodes(graph), 'ok']] });
      return bitFrames({ w: 4 }, beats, 'LC 847');
    },
  ],
  partition: [
    'K equal subsets',
    () => {
      const nums = [4, 3, 2, 3, 5, 2, 1];
      const groups = [[4], [0, 6], [1, 2], [3, 5]];
      const idx = (b: number) => String(nums[b] ?? '');
      let m = 0;
      const rows: BR[] = [];
      const beats: Beat[] = [{ note: 'Split [4, 3, 2, 3, 5, 2, 1] into 4 subsets summing to 5 (LC 698).', rows: [R('used', 0)], panel: [['target', 5]] }];
      groups.forEach((g, k) => {
        g.forEach((i) => (m |= 1 << i));
        rows.push(R(`bucket ${k + 1}`, m, { hl: g, tone: 'write', detail: DT.partition }));
        beats.push({ note: `Fill bucket ${k + 1} with ${g.map((i) => nums[i]).join(' + ')} = 5. The mask records used items.`, rows: [...rows], panel: [['mask', m], ['dp[mask]', 0]] });
      });
      beats.push({ note: `Full mask reached with remainder 0: ${canPartitionK(nums, 4) ? 'possible' : 'impossible'}.`, rows, panel: [['answer', String(canPartitionK(nums, 4)), 'ok'], ['states', 2 ** nums.length]] });
      return bitFrames({ w: 7, idx }, beats, 'LC 698');
    },
  ],
  assign: [
    'Assignment',
    () => {
      const a = [1, 2];
      const b = [2, 3];
      const idx = (j: number) => `b${j}`;
      return bitFrames({ w: 2, idx }, [
        { note: 'Pair a = [1, 2] with b = [2, 3] to minimise the sum of XORs (LC 1879).', rows: [R('dp[00]', 0, { sub: 'cost 0' })], panel: [['n', 2]] },
        { note: 'popcount(mask) says which a comes next; the mask says which b are taken.', rows: [R('dp[00]', 0, { sub: 'cost 0' }), R('a0↔b0', 1, { sub: `cost ${a[0] ^ b[0]}` }), R('a0↔b1', 2, { sub: `cost ${a[0] ^ b[1]}` })], panel: [['1^2', 3], ['1^3', 2]] },
        { note: `dp[11] = min over the last pair: ${minXorSum(a, b)}.`, rows: [R('a0↔b1', 2, { sub: `cost ${a[0] ^ b[1]}` }), R('a1↔b0', 3, { sub: `total ${(a[0] ^ b[1]) + (a[1] ^ b[0])}`, tone: 'ok', detail: DT.assign }), R('a0↔b0', 1, { sub: `cost ${a[0] ^ b[0]}` }), R('a1↔b1', 3, { sub: `total ${(a[0] ^ b[0]) + (a[1] ^ b[1])}` })], panel: [['answer', minXorSum(a, b), 'ok']] },
      ], 'LC 1879');
    },
  ],
  caniwin: [
    'Can I Win',
    () => {
      const idx = (b: number) => String(b);
      return bitFrames({ w: 11, idx, step: 1 }, [
        { note: 'Players pick unused numbers 1..10 and race to a total of 11 (LC 464).', rows: [R('used', 0)], panel: [['max', 10], ['target', 11]] },
        { note: 'The state is just the set of used numbers: a mask with bit i for number i.', rows: [R('used', 1 << 6, { hl: [6] }), R('used', (1 << 6) | (1 << 5), { hl: [5], tone: 'write', detail: DT.caniwin })], panel: [['states', '2^10']] },
        { note: `Memoise win or lose per mask. Here the first player ${canIWin(10, 11) ? 'can force a win' : 'always loses'}.`, rows: [R('used', (1 << 6) | (1 << 5), { tone: 'ok' })], panel: [['answer', String(canIWin(10, 11)), canIWin(10, 11) ? 'ok' : 'fail']] },
      ], 'LC 464');
    },
  ],
});

// ---------------- 13. masks as encodings ----------------
const letters = (b: number) => String.fromCharCode(97 + b);
bitDemo('bits-encode', 'Masks as sets & encodings', 'Letter sets (LC 318), 2-bit DNA codes (LC 187), UTF-8 headers (LC 393), Binary Watch (LC 401), case bit 0x20 (LC 784).', {
  words: [
    'Letter masks',
    () => {
      const words = ['abcw', 'baz', 'foo', 'bar', 'xtfn', 'abcdef'];
      const rows = (hi: number[] = []) => words.map((w, i) => R(w, letterMask(w), { tone: hi.includes(i) ? 'current' : undefined, sub: `len ${w.length}`, detail: DT.words }));
      return bitFrames({ w: 26, idx: letters, step: 1 }, [
        { note: 'One bit per letter: each word becomes a 26-bit mask (LC 318).', rows: rows(), panel: [['words', words.length]] },
        { note: 'abcw & baz share a and b, so their AND is non-zero.', rows: rows([0, 1]), panel: [['abcw & baz', letterMask('abcw') & letterMask('baz'), 'fail']] },
        { note: `abcw & xtfn is 0: no common letter, product 16. That is the best, ${maxProductWords(words)}.`, rows: rows([0, 4]), panel: [['answer', maxProductWords(words), 'ok']] },
      ], 'LC 318');
    },
  ],
  dna: [
    'DNA codes',
    () => {
      const s = 'AAAAACCCCCAAAAACCCCCC';
      const code = (i: number) => [...s.slice(i, i + 10)].reduce((c, ch) => ((c << 2) | DNA[ch]) & 0xfffff, 0);
      return bitFrames({ w: 20, step: 2 }, [
        { note: 'A, C, G, T fit in 2 bits: 00, 01, 10, 11. Ten letters make a 20-bit integer (LC 187).', rows: [R('AAAAACCCCC', code(0), { sub: 'window 0', detail: DT.dna })], panel: [['bits', 20]] },
        { note: 'Slide by one: shift left 2, OR in the new letter, mask to 20 bits.', rows: [R('AAAAACCCCC', code(0)), R('AAAACCCCCA', code(1), { tone: 'write', sub: 'window 1' })], panel: [['per step', 'O(1)']] },
        { note: 'Window 10 has the same code as window 0, so the sequence repeats.', rows: [R('AAAAACCCCC', code(0), { tone: 'current' }), R('AAAAACCCCC', code(10), { tone: 'ok', sub: 'window 10' })], panel: [['repeats', findRepeatedDna(s).join(', '), 'ok']] },
      ], 'LC 187');
    },
  ],
  utf8: [
    'UTF-8',
    () =>
      bitFrames({ w: 8 }, [
        { note: 'The first byte’s leading 1s give the length: 110xxxxx starts a 2-byte character (LC 393).', rows: [R('197', 197, { hl: [7, 6, 5], detail: DT.utf8 })], panel: [['need', 1]] },
        { note: 'Continuation bytes must match 10xxxxxx: test with (b & 0xC0) == 0x80.', rows: [R('197', 197, { hl: [7, 6, 5] }), R('130', 130, { hl: [7, 6], tone: 'ok' }), R('1', 1, { hl: [7], sub: 'ASCII' })], panel: [['[197,130,1]', String(validUtf8([197, 130, 1])), 'ok']] },
        { note: '1110xxxx promises two continuations, but 4 = 00000100 is not one.', rows: [R('235', 235, { hl: [7, 6, 5, 4] }), R('140', 140, { hl: [7, 6] }), R('4', 4, { hl: [7, 6], tone: 'fail' })], panel: [['[235,140,4]', String(validUtf8([235, 140, 4])), 'fail']] },
      ], 'LC 393'),
  ],
  watch: [
    'Binary watch',
    () => {
      const idx = (b: number) => (b >= 6 ? `h${b - 6}` : `m${b}`);
      const t = (h: number, m: number) => (h << 6) | m;
      return bitFrames({ w: 10, idx, step: 1 }, [
        { note: 'A binary watch has 4 hour LEDs and 6 minute LEDs (LC 401).', rows: [R('3:25', t(3, 25), { detail: DT.watch })], panel: [['LEDs lit', popcount(t(3, 25))]] },
        { note: 'popcount(3) + popcount(25) = 2 + 3, so 3:25 lights 5 LEDs.', rows: [R('3:25', t(3, 25), { hl: ones(t(3, 25), 10) })], panel: [['lit', 5]] },
        { note: `Enumerate all 720 times and keep those with the right count. With 1 LED lit there are ${readBinaryWatch(1).length}.`, rows: [R('1:00', t(1, 0), { tone: 'ok' }), R('0:32', t(0, 32), { tone: 'ok' })], panel: [['on = 1', readBinaryWatch(1).length, 'ok']] },
      ], 'LC 401');
    },
  ],
  case: [
    'Case bit',
    () => {
      const perms = letterCasePermutation('a1b2');
      return bitFrames({ w: 8 }, [
        { note: '’a’ is 0x61 and ’A’ is 0x41: they differ only in bit 5, 0x20.', rows: [R("'a'", 0x61, { hl: [5] }), R("'A'", 0x41, { hl: [5] })], panel: [['diff', '0x20']] },
        { note: 'c ^ 0x20 flips the case of any ASCII letter.', rows: [R("'b'", 0x62), R('0x20', 0x20, { op: '^' }), R("'B'", 0x42, { line: true, tone: 'ok', detail: DT.letterCase })], panel: [['flip', 'c ^ 0x20']] },
        { note: `A mask over the letters picks which to flip: ${perms.join(', ')} (LC 784).`, rows: perms.map((p, m) => R(p, m, { sub: `mask ${m}` })), panel: [['count', perms.length, 'ok']] },
      ], 'LC 784');
    },
  ],
});

// ---------------- 14. maximum XOR ----------------
const MX = [3, 10, 5, 25, 2, 8];
function trieFrames(): Frame[] {
  const W = 5;
  const keys = new Set<string>(['']);
  for (const x of MX) {
    let p = '';
    for (let b = W - 1; b >= 0; b--) {
      p += bitOf(x, b);
      keys.add(p);
    }
  }
  const leaves = [...keys].filter((k) => k.length === W).sort();
  const pos = new Map<string, { x: number; y: number }>();
  const place = (k: string): number => {
    if (k.length === W) {
      const x = 80 + (leaves.indexOf(k) * 840) / Math.max(1, leaves.length - 1);
      pos.set(k, { x, y: 130 + k.length * 150 });
      return x;
    }
    const xs = ['0', '1'].filter((c) => keys.has(k + c)).map((c) => place(k + c));
    const x = xs.reduce((a, b) => a + b, 0) / xs.length;
    pos.set(k, { x, y: 130 + k.length * 150 });
    return x;
  };
  place('');
  const q = 5;
  const path = [''];
  let cur = '';
  for (let b = W - 1; b >= 0; b--) {
    const want = bitOf(q, b) ? '0' : '1';
    cur += keys.has(cur + want) ? want : want === '0' ? '1' : '0';
    path.push(cur);
  }
  const leafVal = (k: string) => parseInt(k, 2);
  const f = new Film();
  const draw = (upto: number) => {
    const out: Shape[] = [];
    for (const k of keys) if (k) {
      const a = pos.get(k.slice(0, -1))!;
      const b = pos.get(k)!;
      out.push(line(`e-${k}`, a.x, a.y + 26, b.x, b.y - 26, path.slice(1, upto + 1).includes(k) ? 'accent' : 'muted', { width: path.slice(1, upto + 1).includes(k) ? 5 : 3 }));
    }
    for (const k of keys) {
      const p = pos.get(k)!;
      const on = path.slice(0, upto + 1).includes(k);
      const lab = k ? k[k.length - 1] : 'root';
      const r = box(`t-${k || 'root'}`, p.x - (k ? 26 : 50), p.y - 26, k ? 52 : 100, 52, lab, { mono: true, tone: on ? (k.length === W && upto === W ? 'ok' : 'current') : 'default' });
      if (r.t === 'rect') r.detail = k.length === W ? { title: `Leaf ${leafVal(k)}`, text: `The path spells ${k}, the number ${leafVal(k)}. ${leafVal(k)} ^ 5 = ${leafVal(k) ^ 5}.`, code: DT.trie.code } : DT.trie;
      out.push(r);
      if (k.length === W) out.push(text(`v-${k}`, p.x, p.y + 50, String(leafVal(k)), { size: 24, mono: true }));
    }
    out.push(text('ttl', 20, 44, 'binary trie of [3, 10, 5, 25, 2, 8]', { align: 'left', size: 26, bold: true }));
    return out;
  };
  f.add('Insert each number bit by bit from the top: a binary trie (LC 421).', draw(-1), panel('Trie', [['numbers', MX.length], ['bits', W]]));
  for (let d = 1; d <= W; d++) {
    const b = W - d;
    const want = bitOf(q, b) ? 0 : 1;
    const took = Number(path[d][path[d].length - 1]);
    f.add(took === want ? `Query 5: bit ${b} of 5 is ${1 - want}, so take the opposite branch ${want}.` : `Bit ${b}: no ${want} branch here, so follow ${took}.`, draw(d), panel('Trie', [['bit', b], ['xor so far', ((parseInt(path[d], 2) ^ (q >> b)) << b) >>> 0]]));
  }
  f.add(`Best partner for 5 is ${leafVal(path[W])}: 5 ^ ${leafVal(path[W])} = ${5 ^ leafVal(path[W])}. Query every number for LC 421.`, draw(W), panel('Trie', [['max xor', maxXor(MX, W), 'ok']]));
  return f.frames;
}
bitDemo('bits-maxxor', 'Maximum XOR', 'LC 421 two ways: greedy answer bits with a prefix set, and walking a binary trie.', {
  greedy: [
    'Greedy prefixes',
    () => {
      const beats: Beat[] = [{ note: 'Maximise a ^ b over [3, 10, 5, 25, 2, 8] (LC 421). Decide the answer one bit at a time, from the top.', rows: MX.map((v) => R(String(v), v)), panel: [['answer', 0]] }];
      let ans = 0;
      let mask = 0;
      for (let b = 4; b >= 0; b--) {
        mask |= 1 << b;
        const pre = new Set(MX.map((x) => x & mask));
        const cand = ans | (1 << b);
        let ok = false;
        for (const p of pre) if (pre.has(p ^ cand)) ok = true;
        if (ok) ans = cand;
        beats.push({ note: ok ? `Try bit ${b}: two prefixes XOR to ${cand}, so keep it.` : `Try bit ${b}: no prefix pair XORs to ${cand}, so it stays 0.`, rows: [...MX.map((v) => R(String(v), v & mask, { dim: Array.from({ length: b }, (_, i) => i) })), R('answer', ans, { line: true, tone: ok ? 'ok' : 'warn', hl: [b], detail: DT.maxxor })], panel: [['bit', b], ['answer', ans]] });
      }
      beats.push({ note: `Answer ${maxXor(MX, 5)}, from 5 ^ 25. a ^ b == c is the same as a ^ c == b, so a hash set answers each test.`, rows: [R('5', 5), R('25', 25, { op: '^' }), R('max', 5 ^ 25, { line: true, tone: 'ok', detail: DT.maxxor })], panel: [['answer', maxXor(MX, 5), 'ok']] });
      return bitFrames({ w: 5 }, beats, 'LC 421');
    },
  ],
  trie: ['Binary trie', trieFrames],
});

// ---------------- 15. bitsets, parity, bloom, flags ----------------
bitDemo('bits-bitset', 'Bitsets, parity & hardware', 'Parity by folding, std::bitset word-parallel ops, Bloom filter bits, CPU carry and overflow flags.', {
  parity: [
    'Parity',
    () => {
      const x0 = 0b10110110;
      const x1 = x0 ^ (x0 >> 4);
      const x2 = x1 ^ (x1 >> 2);
      const x3 = x2 ^ (x2 >> 1);
      return bitFrames({ w: 8 }, [
        { note: 'Parity is 1 when the number of set bits is odd.', rows: [R('x', x0)], panel: [['popcount', popcount(x0)]] },
        { note: 'Fold: x ^= x >> 4 XORs the high nibble into the low one.', rows: [R('x', x0), R('x ^ x>>4', x1, { tone: 'write', hl: [0, 1, 2, 3] })], panel: [['low nibble', x1 & 15]] },
        { note: 'Fold by 2: the low 2 bits now hold the XOR of the nibble halves.', rows: [R('x', x0), R('x ^ x>>4', x1), R('x ^ x>>2', x2, { tone: 'write', hl: [0, 1] })], panel: [['low 2 bits', x2 & 3]] },
        { note: 'Fold by 1: bit 0 now holds the XOR of all 8 bits.', rows: [R('x', x0), R('x ^ x>>4', x1), R('x ^ x>>2', x2), R('x ^ x>>1', x3, { tone: 'ok', hl: [0], detail: DT.parity })], panel: [['parity', parity(x0), 'ok']] },
      ], 'Parity');
    },
  ],
  bitset: [
    'std::bitset',
    () => {
      const a = 0b1011001110100101;
      const b = 0b0110101011100011;
      return bitFrames({ w: 16 }, [
        { note: 'A bitset is a set of small integers, one bit each.', rows: [R('a', a, { detail: DT.bitset }), R('b', b)], panel: [['|a|', popcount(a)], ['|b|', popcount(b)]] },
        { note: 'Intersection is one AND per 64-bit word: 64 elements per instruction.', rows: [R('a', a), R('b', b, { op: '&' }), R('a ∩ b', a & b, { line: true, tone: 'ok' })], panel: [['|a ∩ b|', popcount(a & b)]] },
        { note: 'can |= can << x adds x to every reachable sum at once, the subset-sum speedup.', rows: [R('can', 0b1011), R('can << 3', 0b1011 << 3, { op: '<<' }), R('can |= …', 0b1011 | (0b1011 << 3), { line: true, tone: 'ok' })], panel: [['sums', ones(0b1011 | (0b1011 << 3), 16).join(', ')]] },
      ], 'Bitset');
    },
  ],
  bloom: [
    'Bloom filter',
    () => {
      const cat = [1, 5, 11];
      const dog = [3, 5, 14];
      const cow = [1, 3, 14];
      const m1 = cat.reduce((m, i) => m | (1 << i), 0);
      const m2 = dog.reduce((m, i) => m | (1 << i), m1);
      return bitFrames({ w: 16 }, [
        { note: 'Adding "cat" sets the bits of its 3 hash positions.', rows: [R('filter', m1, { hl: cat, detail: DT.bloom })], panel: [['items', 1]] },
        { note: 'Adding "dog" sets 3 more; bit 5 was already on.', rows: [R('filter', m2, { hl: dog })], panel: [['items', 2]] },
        { note: '"cow" hashes to 1, 3 and 14, all set by others: a false positive. Any 0 would mean definitely absent.', rows: [R('filter', m2, { hl: cow, tone: 'warn' })], panel: [['cow', 'maybe (false +)', 'warn']] },
      ], 'Bloom filter');
    },
  ],
  flags: [
    'CPU flags',
    () =>
      bitFrames({ w: 8 }, [
        { note: 'The ALU adds bits exactly as the XOR-and-carry loop does.', rows: [R('200', 200), R('100', 100, { op: '+' }), R('sum', (200 + 100) & 0xff, { line: true, tone: 'warn', detail: DT.flags })], panel: [['CF', 1, 'warn'], ['unsigned', '300 wrapped to 44']] },
        { note: 'Signed, 100 + 100 lands on the sign bit: OF says the result is wrong.', rows: [R('100', 100, { signed: true }), R('100', 100, { op: '+', signed: true }), R('sum', 200, { line: true, signed: true, tone: 'fail', hl: [7] })], panel: [['OF', 1, 'fail'], ['signed', -56]] },
        { note: 'jc and jo branch on these flags. See Assembly → Arithmetic & flags.', rows: [R('sum', 200, { signed: true })], panel: [['__builtin_add_overflow', 'uses OF']] },
      ], 'Flags'),
  ],
});
