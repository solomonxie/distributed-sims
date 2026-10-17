// C++ basics, the behaviour lessons (group cpp-basics): overflow, conversion, loops, switch, range-for and parameter passing.
// Each scene is a picture rebuilt from the knobs under the stage (`controls`); the syntax-only parts stay as line traces.
import type { Detail, Frame, Shape, Tone } from '../algo/frames';
import { arrow, box, code, dot, Film, hex, panel, text } from '../machine/lib/draw';
import { cap, choice, liveGroup, num, number, pick } from '../machine/lib/live';
import type { P } from '../machine/lib/live';
import type { Row } from '../machine/lib/draw';
import { Mem } from '../machine/lib/mem';
import { asSigned, bitStrip, mask, ring } from '../machine/lib/numbers';
import { traceFrames } from '../machine/lib/trace';
import type { Trace } from '../machine/lib/trace';

const G = 'cpp-basics';
const liveDemo = liveGroup(G);

const bin = (v: number, w: number) => '0b' + mask(v, w).toString(2).padStart(w, '0');
const OUT: Detail = { title: 'Console output', text: 'What the program has printed so far with std::cout. std::cout is buffered; "\\n" ends a line, std::endl also flushes.', code: '#include <iostream>\nint main() {\n  std::cout << "x = " << 42 << "\\n";\n}' };

// ---------------- types: sizes (trace), overflow (ring), conversion (dots) ----------------
const sizesTrace: Trace = {
  code: ['#include <cstdint>', "char   c = 'A';      // 1 byte", 'int    i = 42;       // 4 bytes', 'long long n = 9e18;  // 8 bytes', 'double d = 3.14;     // 8 bytes', 'bool   b = true;     // 1 byte', 'std::int32_t x = 7;  // exactly 32 bits', 'std::size_t s = sizeof(d);'],
  steps: [
    { note: 'Every variable has a type, and the type fixes its size in memory and what operations mean.', line: 1, vars: [['c', "'A' (65)", 'write']], rows: [['sizeof(char)', '1 B']] },
    { note: 'int is usually 4 bytes, about ±2.1 billion. long long is 8 bytes.', line: [2, 3], vars: [['c', "'A' (65)"], ['i', '42', 'write'], ['n', '9000000000000000000', 'write']], rows: [['sizeof(int)', '4 B'], ['sizeof(long long)', '8 B']] },
    { note: 'double holds about 15 significant digits. bool is true or false, stored in a byte.', line: [4, 5], vars: [['c', "'A' (65)"], ['i', '42'], ['n', '9e18'], ['d', '3.14', 'write'], ['b', 'true', 'write']], rows: [['sizeof(double)', '8 B']] },
    { note: 'The standard only guarantees minimums, so use <cstdint> types when the exact width matters (files, network).', line: [6, 7], vars: [['c', "'A' (65)"], ['i', '42'], ['n', '9e18'], ['d', '3.14'], ['x', '7', 'write'], ['s', '8', 'write']], rows: [['int32_t', 'exactly 4 B', 'ok']] },
  ],
  details: {
    c: { title: 'char', text: "One byte. Holds a character code (ASCII 'A' is 65) or a small integer.", code: "char c = 'A';\nstd::cout << c << ' ' << int(c); // A 65" },
    i: { title: 'int', text: 'The default integer. 4 bytes on every mainstream platform, range −2147483648 … 2147483647.', code: 'int i = 42;\n#include <climits>\nstd::cout << INT_MAX; // 2147483647' },
    n: { title: 'long long', text: 'At least 64 bits. Use it (or std::int64_t) for values past 2 billion: file sizes, timestamps in ns, money in cents.', code: 'long long bytes = 5LL * 1024 * 1024 * 1024;' },
    d: { title: 'double', text: 'IEEE-754 64-bit floating point. Fast, but not exact: 0.1 + 0.2 != 0.3.', code: 'double d = 0.1 + 0.2;\nstd::cout << (d == 0.3); // 0 (false)' },
    b: { title: 'bool', text: 'true or false. Converts to 1 or 0, and any non-zero number converts to true.', code: 'bool b = (3 > 2); // true\nif (ptr) { /* non-null */ }' },
    x: { title: 'Fixed-width integers', text: 'std::int8_t … std::int64_t and their unsigned uintN_t cousins have exact sizes. Use them in binary formats and protocols.', code: '#include <cstdint>\nstd::uint16_t port = 8080;\nstd::int64_t  ts   = 1700000000000;' },
    s: { title: 'size_t and sizeof', text: 'sizeof gives a size in bytes as std::size_t, an unsigned integer as wide as a pointer. Container sizes use it too.', code: 'std::vector<int> v(10);\nstd::size_t n = v.size();\nsizeof(int); // 4' },
  },
};

const OPS: Record<string, number> = { '+1': 1, '+10': 10, '-1': -1 };

function overflow(p: P): Frame[] {
  const x = num(p.x, 255, 0, 255);
  const d = OPS[pick(p.op, ['+1', '+10', '-1'], '+1')];
  const raw = x + d;
  const y = mask(raw, 8);
  const wraps = raw !== y;
  const opS = d > 0 ? `+ ${d}` : `- ${-d}`;
  const sx = asSigned(x, 8);
  const sy = asSigned(y, 8);
  const sOver = sx + d !== sy;
  const f = new Film();
  const big = (s: string, tone?: Tone, legend = 'uint8_t · 0 … 255') => [text('sv', 100, 300, s, { align: 'left', size: 44, mono: true, bold: true, tone }), text('sl', 900, 300, legend, { align: 'right', size: 24, mono: true, tone: 'muted' })];
  const terms = [...Array(8).keys()].filter((b) => (x >>> b) & 1).map((b) => 2 ** b).reverse();
  f.add(
    `x is 8 cells, each worth a power of two. Add the weights under the 1-cells: ${terms.length ? terms.join(' + ') + ' = ' : ''}${x}.`,
    [...cap(`std::uint8_t x = ${x};`), ...bitStrip('s', x, 8, 100, 120, 800), ...big(`x = ${x}`), ...ring('r', 500, 640, 220, 8, x)],
    panel('uint8_t', [['x', x], ['bits', bin(x, 8)], ['range', '0 … 255']]),
  );
  f.add(
    wraps
      ? d > 0
        ? `${x} ${opS} = ${raw} needs a 9th cell, and there is none: that bit is lost and ${y} stays. On the ring the needle crosses the seam.`
        : `${x} ${opS} would be ${raw}, below zero, so it borrows past the first cell and wraps to ${y}. The needle crosses the seam backwards.`
      : `${x} ${opS} = ${raw} still fits in 8 cells. No wrap, nothing lost.`,
    [...cap(`x = x ${opS};`), ...bitStrip('s', y, 8, 100, 120, 800, { carry: wraps && d > 0 }), ...big(`x = ${y}`, wraps ? 'warn' : 'ok'), ...ring('r', 500, 640, 220, 8, y, { from: x, step: d, tone: wraps ? 'warn' : 'ok' })],
    panel('uint8_t', [['true result', raw], ['stored', y, wraps ? 'warn' : 'ok'], ['unsigned', wraps ? 'wraps (defined)' : 'fits', wraps ? 'warn' : 'ok']]),
  );
  f.add(
    `Same cells, signed type: the top cell now means −128, so these bits read ${sy}. ${sOver ? `${sx} ${opS} should be ${sx + d}, and signed overflow is undefined behaviour: the optimiser assumes it never happens.` : `${sx} ${opS} = ${sy} is fine, no overflow here.`}`,
    [...cap(`std::int8_t s = x ${opS};`), ...bitStrip('s', y, 8, 100, 120, 800, { tone: (b, on) => (b === 7 ? (on ? 'warn' : 'muted') : on ? 'accent' : 'default') }), ...big(`s = ${sy}`, sOver ? 'fail' : 'ok', 'int8_t · −128 … 127'), ...ring('r', 500, 640, 220, 8, y, { signed: true, from: x, step: d, tone: sOver ? 'fail' : 'ok' })],
    panel('int8_t', [['bits', bin(y, 8)], ['as unsigned', y], ['as signed', sy, sOver ? 'fail' : 'ok'], ['signed overflow', sOver ? 'UB' : 'none', sOver ? 'fail' : 'ok']]),
  );
  f.add(
    `Widen before the operation: in a 16-bit (or 32-bit int) type ${x} ${opS} = ${raw} fits with room to spare. The fix is a bigger box, not a check afterwards.`,
    [...cap(`int wide = int(x) ${opS};   // ${raw}`), ...bitStrip('s', mask(raw, 16), 16, 20, 120, 960, { weights: false }), ...big(`wide = ${raw}`, 'ok', 'int · ±2.1 billion'), ...ring('r', 500, 640, 220, 16, mask(raw, 16), { from: x, step: d, tone: 'ok' })],
    panel('int', [['result', raw, 'ok'], ['bits used', Math.max(1, Math.abs(raw)).toString(2).length], ['rule', 'widen first']]),
  );
  f.add(
    'The classic: n is size_t and holds 0, so n − 1 wraps to the largest value and the loop runs off the end. Write i + 1 < n instead.',
    [...cap('for (int i = 0; i < n - 1; i++)  // n == 0'), ...bitStrip('s', 255, 8, 100, 120, 800, { tone: () => 'fail' }), ...big('n − 1 = 255', 'fail', 'size_t · 1.8e19 really'), ...ring('r', 500, 640, 220, 8, 255, { from: 0, step: -1, tone: 'fail' })],
    panel('size_t', [['n', 0], ['n - 1', '18446744073709551615', 'fail'], ['fix', 'i + 1 < n', 'ok']]),
  );
  return f.frames;
}

const fmt = (v: number) => (Number.isInteger(v) ? String(v) : String(+v.toFixed(3)));

function conversion(p: P): Frame[] {
  const a = num(p.a, 7, 1, 20);
  const b = num(p.b, 2, 2, 9);
  const q = Math.floor(a / b);
  const rem = a % b;
  const s = a / b;
  const rows = Math.ceil(a / b);
  const pitch = Math.min(100, 440 / b, 720 / rows);
  const f = new Film();
  const dots = (leftTone: Tone): Shape[] => {
    const out: Shape[] = [];
    for (let k = 0; k < rows; k++) {
      const y = 150 + k * pitch + pitch / 2;
      const full = (k + 1) * b <= a;
      const n = full ? b : rem;
      out.push(box(`g${k}`, 30, y - pitch / 2 + 2, n * pitch + 20, pitch - 4, undefined, { tone: full ? 'ok' : leftTone, filled: false, dashed: !full }));
      for (let j = 0; j < n; j++) out.push(dot(`d${k}-${j}`, 40 + j * pitch + pitch / 2, y, full ? 'ok' : leftTone, undefined, Math.max(8, pitch * 0.3)));
    }
    out.push(text('gl', 40, 125, `${a} dots in rows of ${b}`, { align: 'left', size: 24, tone: 'muted' }));
    if (rem) out.push(text('lo', 40, 150 + rows * pitch + 24, `${rem} left over`, { align: 'left', size: 24, tone: leftTone }));
    return out;
  };
  const res = (k: number, label: string, value: string, tone: Tone) => box(`r${k}`, 520, 120 + k * 120, 460, 96, label, { sub: value, mono: true, tone });
  const base = (leftTone: Tone, ...more: Shape[]) => [...dots(leftTone), res(0, `int q = ${a} / ${b}`, `q = ${q}`, 'ok'), ...more];
  f.add(
    rem ? `int divided by int makes whole rows of ${b}: ${q} full row${q === 1 ? '' : 's'}, and the ${rem} left over ${rem === 1 ? 'is' : 'are'} simply dropped.` : `int divided by int makes whole rows of ${b}: ${q} full rows and nothing left over, so ${a} / ${b} is exactly ${q}.`,
    [...cap(`int q = ${a} / ${b};        // ${q}`), ...base('warn')],
    panel('Conversion', [[`${a} / ${b}`, q], [`${a} % ${b}`, rem, rem ? 'warn' : 'ok']]),
  );
  f.add(
    `The right side is computed first, in int, so r receives ${q}.0: the leftover was gone before the double ever saw it.`,
    [...cap(`double r = ${a} / ${b};     // ${q}.0 !`), ...base('warn', res(1, `double r = ${a} / ${b}`, `r = ${q}.0`, 'warn'))],
    panel('Conversion', [['r', `${q}.0`, 'warn'], ['why', 'int ÷ int first']]),
  );
  f.add(
    rem ? `Convert one operand first and the division is done in double: the ${rem} leftover split${rem === 1 ? 's' : ''} into ${rem}/${b} = ${fmt(rem / b)}.` : `Convert one operand first and the division is done in double. Here nothing was left over, so s is ${fmt(s)} either way.`,
    [...cap(`double s = double(${a}) / ${b};  // ${fmt(s)}`), ...base('ok', res(1, `double r = ${a} / ${b}`, `r = ${q}.0`, 'warn'), res(2, `double(${a}) / ${b}`, `s = ${fmt(s)}`, 'ok'))],
    panel('Conversion', [['s', fmt(s), 'ok'], ['rule', 'convert an operand']]),
  );
  f.add(
    rem ? `Going back to int silently drops the fraction: t = ${q}. Brace initialisation refuses that narrowing at compile time.` : `double to int is a narrowing conversion even when the value happens to be whole. Brace initialisation refuses it at compile time.`,
    [...cap(`int t = s;  int u{s};`), ...base('ok', res(1, `double(${a}) / ${b}`, `s = ${fmt(s)}`, 'ok'), res(2, 'int t = s', `t = ${q}`, 'warn'), res(3, 'int u{s}', 'compile error', 'fail'))],
    panel('Conversion', [['t', q, 'warn'], ['u{s}', 'narrowing', 'fail']]),
  );
  f.add(
    'When you do mean to drop the fraction, say so with static_cast: explicit, checked by the compiler and easy to grep for.',
    [...cap('auto v = static_cast<int>(s);'), ...base('ok', res(1, `double(${a}) / ${b}`, `s = ${fmt(s)}`, 'ok'), res(2, 'static_cast<int>(s)', `v = ${q}`, 'ok'))],
    panel('Conversion', [['v', q, 'ok'], ['cast', 'static_cast']]),
  );
  return f.frames;
}

liveDemo(
  'basics-types',
  'Types, sizes & overflow',
  'Built-in types and their sizes, signed vs unsigned overflow on a wrap-around ring, and integer vs floating division as rows of dots.',
  {
    sizes: ['Sizes', () => traceFrames(sizesTrace)],
    overflow: ['Overflow', overflow],
    conversion: ['Conversion', conversion],
  },
  [
    number('x', 'x', 0, 255, 255, { for: ['overflow'] }),
    choice('op', 'then', ['+1', '+10', '-1'], '+1', { for: ['overflow'], labels: ['+ 1', '+ 10', '− 1'] }),
    number('a', 'a', 1, 20, 7, { for: ['conversion'] }),
    number('b', 'b', 2, 9, 2, { for: ['conversion'] }),
  ],
  {
    cap: { title: 'The statement', text: 'The line of C++ this picture shows. Change the knobs under the stage and the picture is rebuilt.' },
    scarry: { title: 'Lost carry', text: 'Adding past the top bit produces a 9th bit that the 8-bit box cannot hold. Unsigned types drop it by definition (arithmetic modulo 2^N).', code: 'std::uint8_t x = 255;\nx += 1;   // 0' },
    r0: { title: 'Integer division', text: 'Both operands are int, so the result is int, rounded toward zero. % gives the remainder.', code: '7 / 2   // 3\n7 % 2   // 1\n-7 / 2  // -3' },
    r1: { title: 'Too late to convert', text: 'The right side is evaluated first, as int, and only the result is converted.', code: 'double r = 7 / 2;     // 3.0\ndouble r2 = 7 / 2.0;  // 3.5' },
  },
);

// ---------------- control flow: loop (track), switch (jump table), range-for (memory) ----------------
function loop(p: P): Frame[] {
  const n = num(p.n, 6, 1, 10);
  const skip = pick(p.skip, ['evens', 'odds', 'none'], 'evens');
  const stop = num(p.stop, 4, 1, 10);
  const skipLine = skip === 'evens' ? '  if (i % 2 == 0) continue;  // skip evens' : skip === 'odds' ? '  if (i % 2 == 1) continue;  // skip odds' : '  // (no continue here)';
  const src = ['int sum = 0;', `for (int i = 1; i <= ${n}; i++) {`, skipLine, `  if (i > ${stop}) break;         // stop`, '  sum += i;', '}', 'std::cout << sum;'];
  const cw = Math.min(84, 900 / n);
  const x0 = (1000 - n * cw) / 2;
  const cx = (i: number) => x0 + (i - 1) * cw + cw / 2;
  const f = new Film();
  const tones: Record<number, Tone> = {};
  const added: number[] = [];
  let sum = 0;
  const scene = (hl: number[], cur: number | undefined, extra: Shape[], o: { exit?: boolean; done?: boolean } = {}): Shape[] => {
    const out: Shape[] = [text('ct', 20, 22, 'main.cpp', { align: 'left', size: 24, bold: true, tone: 'current' }), ...code(src, 42, 30, hl)];
    out.push(text('tt', 40, 300, 'i walks the track', { align: 'left', size: 24, tone: 'muted' }));
    if (cur !== undefined && !o.done) out.push(box('curbg', cx(cur) - cw / 2 - 2, 326, cw + 4, 92, undefined, { tone: 'current' }), dot('marker', cx(cur), 300, 'current', undefined, 12));
    for (let i = 1; i <= n; i++) out.push(box(`cell${i}`, x0 + (i - 1) * cw + 3, 330, cw - 6, 84, String(i), { mono: true, tone: tones[i] ?? 'default' }));
    out.push(...extra);
    out.push(box('vi', 20, 470, 500, 80, cur === undefined || o.done ? 'i: not in scope' : `i = ${cur}`, { mono: true, tone: cur === undefined || o.done ? 'muted' : 'current' }));
    out.push(box('vs', 20, 580, 500, 80, `sum = ${sum}`, { mono: true, tone: o.done ? 'ok' : 'default' }));
    out.push(box('exit', 20, 690, 500, 80, o.exit ? 'break → out of the loop' : 'after the loop', { tone: o.exit ? 'fail' : 'muted', filled: !!o.exit }));
    out.push(box('bk', 560, 440, 420, 470, undefined, { tone: 'muted', filled: false }), text('bkt', 770, 470, `sum = ${sum}`, { size: 28, bold: true }));
    added.forEach((v, k) => out.push(box(`chip${k}`, 580, 900 - 42 * (k + 1), 380, 38, `+ ${v}`, { mono: true, tone: 'ok' })));
    return out;
  };
  const rows = (i?: number): Row[] => [['i', i === undefined ? '—' : i], ['sum', sum], ['added', added.length], ['skipped', Object.values(tones).filter((t) => t === 'warn').length]];
  f.add(`sum starts at 0. The for header reads: start i at 1, keep going while i ≤ ${n}, add 1 after each round.`, scene([0, 1], undefined, []), panel('Loop', rows()));
  for (let i = 1; i <= n; i++) {
    const even = i % 2 === 0;
    if ((skip === 'evens' && even) || (skip === 'odds' && !even)) {
      tones[i] = 'warn';
      const hop: Shape[] = [text('hopt', cx(i), 262, 'continue', { size: 24, bold: true, tone: 'warn' }), ...(i < n ? [{ t: 'edge' as const, id: `hop${i}`, from: { x: cx(i), y: 290 }, to: { x: cx(i + 1), y: 326 }, bend: -40, tone: 'warn' as Tone, dashed: true, arrow: true }] : [])];
      f.add(`i = ${i} is ${even ? 'even' : 'odd'}: continue jumps straight to i++ and the rest of the body is skipped.`, scene([2], i, hop), panel('Loop', rows(i)));
    } else if (i > stop) {
      tones[i] = 'fail';
      f.add(`i = ${i} > ${stop}: break leaves the loop entirely. ${i < n ? 'The cells after it are never visited.' : 'It was the last cell anyway.'}`, scene([3], i, [arrow(`brk`, cx(i), 418, 270, 686, 'fail', { width: 5 })], { exit: true }), panel('Loop', rows(i)));
      break;
    } else {
      tones[i] = 'ok';
      sum += i;
      added.push(i);
      f.add(`i = ${i} passes both checks, so sum += ${i} makes ${sum}.`, scene([4], i, []), panel('Loop', rows(i)));
    }
  }
  f.add(`The loop is over: i is gone (it lived in the for header) and sum is ${sum}, which is what gets printed.`, scene([6], undefined, [], { done: true }), panel('Loop', [...rows(), ['prints', sum, 'ok']]));
  return f.frames;
}

function sw(p: P): Frame[] {
  const op = pick(p.op, ['Add', 'Sub', 'Mul'], 'Sub');
  const fix = pick(p.fix, ['fallthrough', 'return'], 'fallthrough');
  const a = 3;
  const b = 4;
  const subLine = fix === 'return' ? '  case Op::Sub: return a - b;' : '  case Op::Sub: a = -a;        // no break!';
  const src = ['enum class Op { Add, Sub, Mul };', 'switch (op) {', '  case Op::Add: return a + b;', subLine, '  case Op::Mul: return a * b;', '}', 'return 0;'];
  const cases = ['Add', 'Sub', 'Mul'] as const;
  const idx = cases.indexOf(op);
  const falls = op === 'Sub' && fix === 'fallthrough';
  const result = op === 'Add' ? a + b : op === 'Mul' ? a * b : fix === 'return' ? a - b : -a * b;
  const by = (y: number) => 336 + y * 126;
  const f = new Film();
  const scene = (hl: number[], tone: Partial<Record<string, Tone>>, extra: Shape[], o: { res?: string; resTone?: Tone; opLabel?: string; div?: boolean } = {}): Shape[] => {
    const out: Shape[] = [text('ct', 20, 22, 'apply(op, 3, 4)', { align: 'left', size: 24, bold: true, tone: 'current' }), ...code(src, 42, 34, hl)];
    out.push(box('op', 20, by(0), 250, 92, o.opLabel ?? `op = ${op}`, { mono: true, tone: tone.op ?? 'accent' }));
    cases.forEach((c, k) => {
      const body = c === 'Add' ? 'return a + b' : c === 'Mul' ? 'return a * b' : fix === 'return' ? 'return a - b' : 'a = -a';
      out.push(box(`case${c}`, 320, by(k), 660, 92, `case Op::${c}:`, { sub: body, mono: true, tone: tone[c] ?? 'default' }));
    });
    if (o.div) out.push(box('caseDiv', 320, by(3), 660, 92, 'case Op::Div: ?', { sub: 'missing → -Wswitch warning', mono: true, tone: 'warn', dashed: true }));
    out.push(box('res', 20, by(2), 250, 92, 'result', { sub: o.res ?? '…', mono: true, tone: o.resTone ?? 'muted' }));
    out.push(...extra);
    return out;
  };
  const jump = arrow('jump', 270, by(0) + 46, 316, by(idx) + 46, 'accent', { width: 5 });
  f.add('switch compares op with each case label and jumps straight to the match: a lookup, not a chain of ifs.', scene([1], { [op]: 'current' }, [jump]), panel('switch', [['op', `Op::${op}`], ['jumps to', `case ${op}`]]));
  const bodyNote = op === 'Add' ? 'return a + b hands back 7 at once. A return ends both the switch and the function.' : op === 'Mul' ? 'return a * b hands back 12 at once. A return ends both the switch and the function.' : fix === 'return' ? 'return a − b hands back −1 at once. A return ends both the switch and the function.' : 'a = −a runs, so a is now −3. Nothing in this case ends it: no break, no return.';
  f.add(bodyNote, scene([2 + idx], { [op]: falls ? 'warn' : 'ok' }, [jump]), panel('switch', [['a', falls ? -a : a, falls ? 'warn' : 'default'], ['b', b], ['case ends?', falls ? 'no' : 'yes', falls ? 'fail' : 'ok']]));
  if (falls) {
    const drop = arrow('fall', 650, by(1) + 94, 650, by(2) - 4, 'fail', { width: 6, dashed: true });
    f.add('Cases are just labels, so execution falls through into case Mul: return a * b runs with a = −3.', scene([3, 4], { Sub: 'warn', Mul: 'fail' }, [jump, drop, text('fallt', 690, by(1) + 110, 'falls through', { align: 'left', size: 24, tone: 'fail' })]), panel('switch', [['a', -a, 'warn'], ['runs next', 'case Mul', 'fail']]));
    f.add(`apply(Sub, 3, 4) returns ${result} instead of −1. End every case with break or return, and mark the rare intended fallthrough with [[fallthrough]].`, scene([4], { Sub: 'warn', Mul: 'fail' }, [jump, drop], { res: String(result), resTone: 'fail' }), panel('switch', [['returned', result, 'fail'], ['expected', a - b], ['fix', 'break / return', 'ok']]));
  } else {
    const below = Object.fromEntries(cases.slice(idx + 1).map((c) => [c, 'muted' as Tone]));
    f.add('The function has returned, so the cases below the match are never reached.', scene([2 + idx], { [op]: 'ok', ...below }, [jump]), panel('switch', [['reached', `case ${op} only`, 'ok']]));
    f.add(`apply(${op}, 3, 4) = ${result}. Every case ends in a return, so nothing leaks into the next one.`, scene([2 + idx], { [op]: 'ok', ...below }, [jump], { res: String(result), resTone: 'ok' }), panel('switch', [['returned', result, 'ok']]));
  }
  f.add('Later someone adds Op::Div to the enum. With enum class and no default, -Wswitch warns that a case is missing, before it is a bug at run time.', scene([0], { op: 'warn' }, [], { opLabel: 'op = Div', div: true, res: '0 ?', resTone: 'warn' }), panel('switch', [['enumerators', 4], ['cases', 3, 'warn'], ['-Wswitch', 'warning', 'ok']]));
  return f.frames;
}

const RF: Record<string, Detail> = {
  e0: { title: 'Vector element', text: 'std::vector keeps its elements side by side in one heap buffer, 4 bytes apart for int.' },
  x: { title: 'Loop variable', text: 'Declared in the range-for header, it is created fresh for each element.', code: 'for (int x : v)          // copy\nfor (int& x : v)         // alias, can edit\nfor (const auto& x : v)  // alias, read only' },
};

function rangeFor(p: P): Frame[] {
  const how = pick(p.how, ['copy', 'ref', 'cref'], 'copy');
  const m = new Mem({ panel: 'range-for', details: RF, out: how === 'cref' });
  m.region('vec', 'std::vector<int> v · heap buffer', { tight: true });
  const vals = [1, 2, 3];
  vals.forEach((v, i) => m.v(`e${i}`, 'vec', i, `v[${i}]`, hex(0x100 + i * 4), String(v)));
  m.region('loop', 'loop body · stack');
  const head = how === 'copy' ? 'for (int x : v)' : how === 'ref' ? 'for (int& x : v)' : 'for (const auto& x : v)';
  m.snap('v owns three ints side by side on the heap. The loop visits each one in turn.', 'std::vector<int> v{1, 2, 3};');
  let out = '';
  for (let i = 0; i < 3; i++) {
    const v = vals[i];
    if (how === 'copy') {
      m.v('x', 'loop', 0, 'x', '0x7f0', String(v));
      m.snap(`Round ${i + 1}: x is a brand-new box holding a copy of v[${i}].`, head, { fly: [`e${i}`, 'x'], finger: null, rows: [['x', v], [`v[${i}]`, v]] });
      m.set('x', String(v * 10));
      m.snap(`x *= 10 changes the copy only. v[${i}] is still ${v}.`, '  x *= 10;', { hot: { x: 'warn' }, rows: [['x', v * 10, 'warn'], [`v[${i}]`, v]] });
    } else if (how === 'ref') {
      m.v('x', 'loop', 0, 'x (int&)', '0x7f0', hex(0x100 + i * 4), { to: `e${i}` });
      m.snap(`Round ${i + 1}: x is another name for v[${i}], drawn as an arrow. Nothing is copied.`, head, { finger: 'x', rows: [['x', `→ v[${i}]`]] });
      m.set(`e${i}`, String(v * 10));
      m.snap(`x *= 10 follows the arrow: v[${i}] itself becomes ${v * 10}.`, '  x *= 10;', { finger: `e${i}`, rows: [[`v[${i}]`, v * 10, 'ok']] });
    } else {
      m.v('x', 'loop', 0, 'x (const int&)', '0x7f0', hex(0x100 + i * 4), { to: `e${i}`, weak: true });
      m.snap(`Round ${i + 1}: x is a read-only name for v[${i}]. No copy, and no way to edit it.`, head, { finger: 'x', out, rows: [['x', `→ v[${i}]`, 'ok'], ['copied', '0 B', 'ok']] });
      out += `${v} `;
      m.snap(`Reading through x is fine. x *= 10 would not compile, which is the point of const.`, '  std::cout << x;', { finger: `e${i}`, out: out.trim(), rows: [['x *= 10', 'compile error', 'fail']] });
    }
  }
  m.gone('x');
  const last = how === 'copy' ? 'After the loop v is unchanged, {1, 2, 3}: every x was a throwaway copy.' : how === 'ref' ? 'After the loop v is {10, 20, 30}. int& is the form that edits in place.' : 'v is unchanged and nothing was copied. For big elements you only read, this is the form to use.';
  m.snap(last, '}', { finger: null, out: out.trim(), rows: vals.map((v, i) => [`v[${i}]`, how === 'ref' ? v * 10 : v, how === 'ref' ? 'ok' : 'default'] as Row) });
  return m.frames();
}

liveDemo(
  'basics-control',
  'Control flow',
  'A loop as a track with continue hops and a break exit, switch as a jump table that falls through, and range-for as copies or arrows into the vector.',
  {
    loop: ['for, break, continue', loop],
    switch: ['switch', sw],
    rangefor: ['range-for', rangeFor],
  },
  [
    number('n', 'n', 1, 10, 6, { for: ['loop'] }),
    choice('skip', 'continue on', ['evens', 'odds', 'none'], 'evens', { for: ['loop'] }),
    number('stop', 'break after', 1, 10, 4, { for: ['loop'] }),
    choice('op', 'op', ['Add', 'Sub', 'Mul'], 'Sub', { for: ['switch'] }),
    choice('fix', 'case Sub', ['fallthrough', 'return'], 'fallthrough', { for: ['switch'], labels: ['a = -a', 'return a - b'] }),
    choice('how', 'x is', ['copy', 'ref', 'cref'], 'copy', { for: ['rangefor'], labels: ['int x', 'int& x', 'const auto&'] }),
  ],
  {
    bk: { title: 'Accumulator', text: 'sum collects one chip per round that reaches sum += i. std::accumulate does the same for whole ranges.', code: '#include <numeric>\nint sum = std::accumulate(v.begin(), v.end(), 0);' },
    vi: { title: 'Loop counter', text: 'Declared in the for header, so it exists only inside the loop. while and do-while are the other loop forms.', code: 'while (cond) { ... }\ndo { ... } while (cond); // runs at least once' },
    op: { title: 'enum class', text: 'A scoped, strongly typed enum. Values are written Op::Add and never convert to int by accident.', code: 'enum class Color { Red, Green };\nColor c = Color::Red;\nint n = static_cast<int>(c);' },
    res: { title: 'Fallthrough', text: 'Cases are just labels. Without break or return, execution continues into the next one.', code: 'case 1:\n  doA();\n  [[fallthrough]];\ncase 2:\n  doB();\n  break;' },
  },
);

// ---------------- functions: by value, by reference, by pointer (memory), overloads (trace) ----------------
const FD: Record<string, Detail> = {
  a: { title: 'Caller’s variable', text: 'Lives in main’s stack frame. Only a reference or a pointer lets the callee reach it.' },
  n: { title: 'Parameter', text: 'A box in the callee’s frame. By value it holds a copy; by reference it is an alias (an address under the hood).', code: 'void f(int n);        // copy\nvoid g(int& n);       // alias, can edit\nvoid h(const T& n);   // alias, read only' },
  v: { title: 'std::vector handle', text: 'The vector object itself is small (pointer, size, capacity). The elements live in a heap buffer it owns.' },
  buf: { title: 'Heap buffer', text: 'One million ints, 4 MB. Copying a vector means allocating and copying this buffer.' },
  copy: { title: 'The copy', text: 'Pass-by-value duplicates the whole buffer, then throws it away on return. Pass const std::vector<int>& instead.', code: 'void inc(const std::vector<int>& v);  // no copy' },
  out: { title: 'Pointer parameter', text: 'Holds an address. *out reads or writes the pointed-to object, and it may be nullptr, so check first.', code: 'void f(int* p) {\n  if (p) *p = 1;\n}' },
};

const ARGS = ['int', 'vector'] as const;

function byValue(p: P): Frame[] {
  const arg = pick(p.arg, ARGS, 'int');
  const m = new Mem({ panel: 'By value', details: FD, out: arg === 'int' });
  m.region('main', 'main() · stack frame');
  if (arg === 'int') {
    m.v('a', 'main', 0, 'a', '0x10', '5').snap('main has a = 5 in its own stack frame.', 'int a = 5;', { out: '' });
    m.region('inc', 'inc(int n) · stack frame').v('n', 'inc', 0, 'n', '0x7c0', '5');
    m.snap('The call copies a into n, a new box in a new frame. Two boxes, two lives.', 'inc(a);', { fly: ['a', 'n'], out: '', rows: [['copied', '4 bytes']] });
    m.set('n', '6').snap('n++ changes the copy only. a never hears about it.', '  n++;', { hot: { n: 'warn' }, out: '', rows: [['n', 6, 'warn'], ['a', 5]] });
    m.kill('inc', 'inc() returned').snap('The frame is popped on return and n is gone. a is still 5.', 'std::cout << a;', { hot: { a: 'ok' }, out: '5', rows: [['a', 5, 'ok']] });
  } else {
    m.region('heap', 'heap');
    m.v('v', 'main', 0, 'v', '0x10', '0x500', { to: 'buf' }).v('buf', 'heap', 0, 'v’s buffer', '0x500', '4 MB');
    m.snap('v is a small handle on the stack that owns a 4 MB buffer on the heap.', 'std::vector<int> v(1000000);', { rows: [['elements', '1,000,000'], ['bytes', '4,000,000']] });
    m.region('inc', 'inc(std::vector<int> n) · frame').v('n', 'inc', 0, 'n', '0x7c0', '0x900', { to: 'copy' }).v('copy', 'heap', 2, 'n’s buffer', '0x900', '4 MB');
    m.snap('By value means a full copy: 4 MB are allocated and duplicated before inc even starts.', 'inc(v);', { fly: ['buf', 'copy'], hot: { copy: 'warn' }, rows: [['copied', '4 MB', 'warn'], ['time', '~1 ms', 'warn']] });
    m.set('copy', '4 MB + 1').snap('n.push_back touches the copy. v’s buffer is untouched.', '  n.push_back(1);', { hot: { copy: 'warn' }, rows: [['n.size()', '1,000,001', 'warn'], ['v.size()', '1,000,000']] });
    m.kill('inc', 'inc() returned').free('copy').snap('On return the copy is destroyed: all that work, thrown away. Pass const std::vector<int>& instead.', '}', { rows: [['v.size()', '1,000,000', 'ok'], ['wasted', '4 MB copy', 'fail']] });
  }
  return m.frames();
}

function byRef(p: P): Frame[] {
  const arg = pick(p.arg, ARGS, 'int');
  const m = new Mem({ panel: 'By reference', details: FD, out: arg === 'int' });
  m.region('main', 'main() · stack frame');
  if (arg === 'int') {
    m.v('a', 'main', 0, 'a', '0x10', '5').snap('main has a = 5 in its own stack frame.', 'int a = 5;', { out: '' });
    m.region('inc', 'inc(int& n) · stack frame').v('n', 'inc', 0, 'n (int&)', '0x7c0', '0x10', { to: 'a' });
    m.snap('int& n makes no copy: n is another name for a, drawn as an arrow (under the hood, its address).', 'inc(a);', { fly: ['a.addr', 'n'], out: '', rows: [['copied', '0 bytes', 'ok']] });
    m.snap('n++ starts at n…', '  n++;', { finger: 'n', out: '' });
    m.set('a', '6').snap('…follows the arrow, and increments a itself.', '  n++;', { finger: 'a', hot: { a: 'write' }, out: '', rows: [['a', 6, 'ok']] });
    m.kill('inc', 'inc() returned').snap('After the call main sees 6. T& is how a function hands results back through its arguments.', 'std::cout << a;', { finger: null, hot: { a: 'ok' }, out: '6', rows: [['a', 6, 'ok']] });
  } else {
    m.region('heap', 'heap');
    m.v('v', 'main', 0, 'v', '0x10', '0x500', { to: 'buf' }).v('buf', 'heap', 0, 'v’s buffer', '0x500', '4 MB');
    m.snap('The same 4 MB vector as before.', 'std::vector<int> v(1000000);', { rows: [['bytes', '4,000,000']] });
    m.region('inc', 'show(const std::vector<int>& n)').v('n', 'inc', 0, 'n (const&)', '0x7c0', '0x10', { to: 'v' });
    m.snap('const std::vector<int>& n: no copy at all, n is an arrow to v itself. 8 bytes moved, not 4 MB.', 'show(v);', { fly: ['v.addr', 'n'], rows: [['copied', '0 bytes', 'ok'], ['time', '~0', 'ok']] });
    m.snap('n[i] reads v’s buffer through two hops: n to v, v to its buffer.', '  n[i]', { finger: 'buf', rows: [['n[0]', 0, 'ok']] });
    m.snap('n is const, so n.push_back(1) does not compile: the callee can read, not change.', '  n.push_back(1);  // error', { finger: 'n', hot: { n: 'fail' }, rows: [['push_back', 'compile error', 'fail']] });
    m.kill('inc', 'show() returned').snap('Rule: big objects go by const T& to read, T& to modify, and by value only when you need your own copy.', '}', { finger: null, rows: [['read', 'const T&', 'ok'], ['modify', 'T&', 'ok'], ['own copy', 'T']] });
  }
  return m.frames();
}

function byPointer(): Frame[] {
  const m = new Mem({ panel: 'By pointer', details: FD });
  m.region('main', 'main() · stack frame').v('v', 'main', 0, 'v', '0x10', '0');
  m.snap('main has v = 0 and wants parse to fill it in.', 'int v = 0;');
  m.region('parse', 'parse(const char* s, int* out) · frame').v('out', 'parse', 0, 'out', '0x7c0', '0x10', { to: 'v' });
  m.snap('&v passes v’s address. out is a pointer box in parse’s frame holding that address.', 'parse("42", &v);', { fly: ['v.addr', 'out'], rows: [['out', '0x10 (&v)']] });
  m.snap('if (!out) comes first: unlike a reference, a pointer may point nowhere.', '  if (!out) return false;', { finger: 'out', rows: [['out', 'non-null', 'ok']] });
  m.set('v', '42').snap('*out follows the arrow and writes 42 into v.', '  *out = std::atoi(s);', { finger: 'v', hot: { v: 'write' }, rows: [['v', 42, 'ok']] });
  m.kill('parse', 'parse() returned true').snap('parse returned true and main’s v is 42. C APIs hand back results this way.', 'std::cout << v;   // 42', { finger: null, hot: { v: 'ok' }, rows: [['returned', 'true', 'ok'], ['v', 42, 'ok']] });
  m.revive('parse', 'parse(…, nullptr) · frame').v('out', 'parse', 0, 'out', '0x7c0', 'null', { lv: 1 });
  m.snap('Second call with nullptr: out holds address 0, so there is no arrow to follow.', 'parse("42", nullptr);', { rows: [['out', 'null', 'warn']] });
  m.snap('The check catches it and parse returns false instead of crashing. Reference when the argument must exist, pointer when it is optional.', '  if (!out) return false;', { finger: 'out', hot: { out: 'warn' }, rows: [['returned', 'false', 'warn'], ['modern', 'std::optional<int>']] });
  return m.frames();
}

const overloadTrace: Trace = {
  code: ['int area(int w, int h) { return w * h; }', 'double area(double r) { return 3.14 * r * r; }', 'int box(int w, int h = 1, int d = 1) {', '  return w * h * d;', '}', 'area(2, 3);   area(1.0);', 'box(2);  box(2, 3);  box(2, 3, 4);'],
  steps: [
    { note: 'Two functions may share a name if their parameter lists differ. That is overloading.', line: [0, 1], vars: [['area(int,int)', 'overload 1'], ['area(double)', 'overload 2']] },
    { note: 'The compiler picks one by argument types, at compile time.', line: 5, vars: [['area(2, 3)', '6 → overload 1', 'ok'], ['area(1.0)', '3.14 → overload 2', 'ok']], out: '6 3.14' },
    { note: 'Default arguments fill in trailing parameters the caller leaves out.', line: [2, 3, 6], vars: [['box(2)', '2', 'write'], ['box(2, 3)', '6', 'write'], ['box(2, 3, 4)', '24', 'write']], out: '6 3.14\n2 6 24' },
    { note: 'Defaults go in the declaration (the header), once. Ambiguous overloads are compile errors.', line: 2, vars: [['area(1)', 'int→double? ambiguous', 'warn']], out: '6 3.14\n2 6 24' },
  ],
  details: {
    'area(int,int)': { title: 'Overloading', text: 'Same name, different parameter types. The return type alone can’t distinguish overloads.', code: 'void log(int);\nvoid log(const std::string&);\nlog(3); log("x");' },
    'box(2)': { title: 'Default arguments', text: 'Only trailing parameters may have defaults.', code: '// box.h\nint box(int w, int h = 1, int d = 1);\n// box.cpp\nint box(int w, int h, int d) { ... }' },
    out: OUT,
  },
};

liveDemo(
  'basics-functions',
  'Functions & parameters',
  'What a call does to memory: by value copies the box (or the whole vector), by reference draws an arrow, by pointer may point nowhere. Overloads and defaults as a trace.',
  {
    value: ['By value', byValue],
    reference: ['By reference', byRef],
    pointer: ['By pointer', byPointer],
    overload: ['Overloads & defaults', () => traceFrames(overloadTrace)],
  },
  [choice('arg', 'argument', [...ARGS], 'int', { for: ['value', 'reference'], labels: ['int', 'vector<int> (4 MB)'] })],
);
