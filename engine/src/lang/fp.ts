// Functional programming (group lang-fp): purity & immutability, higher-order functions & closures, recursion & folds,
// laziness, algebraic data types, functors & monads. Each scene is a picture rebuilt from the knobs under the stage;
// syntax-only parts (effects at the edges, composition, data declarations, exhaustiveness) stay as line traces.
import type { Detail, Frame, Shape, Tone } from '../algo/frames';
import { arrow, box, Film, line, panel, text } from '../machine/lib/draw';
import { cap, choice, liveGroup, num, number, pick } from '../machine/lib/live';
import type { P } from '../machine/lib/live';
import { Mem } from '../machine/lib/mem';
import { traceFrames } from '../machine/lib/trace';
import type { Trace } from '../machine/lib/trace';

const liveDemo = liveGroup('lang-fp');
const D = (title: string, text: string, code?: string): Detail => ({ title, text, code });

const edgesTrace: Trace = {
  codeTitle: 'main.js',
  code: ['const price = (items, rate) =>          // pure core', '  items.reduce((s, i) => s + i.cost, 0) * (1 + rate);', 'async function checkout(id) {           // impure shell', '  const items = await db.cart(id);', '  const total = price(items, 0.1);', '  await db.charge(id, total);', '}'],
  stackTitle: 'checkout(7)',
  details: {
    items: D('Impure shell', 'I/O stays in a thin outer layer: read, call pure code, write.'),
    total: D('Functional core', 'All decisions happen in pure functions, which are tested without mocks.', "expect(price([{ cost: 10 }], 0.1)).toBe(11);"),
  },
  steps: [
    { note: 'checkout reads the cart. This is an effect, so it lives in the shell.', line: [2, 3], vars: [['id', '7'], ['items', '[{cost:10}]', 'read']], out: '' },
    { note: 'price is pure: it only computes from its inputs.', line: [0, 1, 4], vars: [['id', '7'], ['items', '[{cost:10}]'], ['total', '11', 'ok']], out: '' },
    { note: 'The shell performs the write. Effects happen once, at a known place.', line: 5, vars: [['id', '7'], ['total', '11']], out: 'charged 7: 11' },
  ],
};

const composeTrace: Trace = {
  codeTitle: 'main.js',
  code: ['const add = a => b => a + b;          // curried', 'const inc = add(1);                   // partial', 'const dbl = x => x * 2;', 'const pipe = (...fs) => x => fs.reduce((v, f) => f(v), x);', 'const f = pipe(inc, dbl);', 'f(5);   // 12'],
  stackTitle: 'values',
  details: {
    inc: D('Partial application', 'Supplying some arguments now and the rest later yields a new, specialised function.'),
    f: D('Composition', 'Small functions snapped together into a pipeline. Point-free style names the steps, not the data.', '-- Haskell\nf = (* 2) . (+ 1)'),
  },
  steps: [
    { note: 'add takes one argument and returns a function for the next.', line: 0, vars: [['add', 'a => b => a + b', 'write']], out: '' },
    { note: 'add(1) fixes a = 1, giving inc.', line: 1, vars: [['add', 'fn'], ['inc', 'b => 1 + b', 'accent']], out: '' },
    { note: 'pipe(inc, dbl) builds a function that runs inc, then dbl.', line: [2, 3, 4], vars: [['inc', 'fn'], ['dbl', 'fn'], ['f', 'x => dbl(inc(x))', 'accent']], out: '' },
    { note: 'f(5): inc gives 6, dbl gives 12.', line: 5, vars: [['f', 'fn'], ['inc(5)', '6', 'read'], ['dbl(6)', '12', 'ok']], out: '12' },
  ],
};

const sumTrace: Trace = {
  codeTitle: 'Shape.hs',
  code: ['data Point = Point Double Double          -- product', 'data Shape = Circle Point Double           -- sum', '           | Rect Point Point', 's = Circle (Point 0 0) 2'],
  heapTitle: 'value',
  details: {
    v: D('Tagged value', 'A sum value stores which constructor built it plus that constructor’s fields.', '// TypeScript\ntype Shape =\n  | { kind: "circle"; r: number }\n  | { kind: "rect"; w: number; h: number };'),
    p: D('Product', 'All fields together: Point has an x AND a y.'),
  },
  steps: [
    { note: 'A product type holds several fields at once: x and y.', line: 0, vars: [['Point', 'Double × Double', 'accent']], out: '' },
    { note: 'A sum type is one of several alternatives: Circle or Rect.', line: [1, 2], vars: [['Point', 'Double × Double'], ['Shape', 'Circle | Rect', 'accent']], out: '' },
    { note: 's is tagged Circle and holds a Point and a radius.', line: 3, vars: [['s', 'Shape', 'write', 'v']], heap: [['v', 'tag=Circle r=2', 'write'], ['p', 'Point 0 0', 'read']], out: '' },
    { note: 'Illegal states, like a circle with a width, can’t even be written down.', line: 3, vars: [['s', 'Shape', 'ok', 'v']], heap: [['v', 'tag=Circle r=2', 'ok'], ['p', 'Point 0 0', 'read']], out: '' },
  ],
};

const exhaustiveTrace: Trace = {
  codeTitle: 'Shape.hs',
  code: ['data Shape = Circle Point Double | Rect Point Point', '           | Tri Point Point Point      -- new case', 'area (Circle _ r) = pi * r * r', 'area (Rect a b) = …', '-- no Tri clause'],
  stackTitle: 'compiler',
  details: {
    warning: D('Exhaustiveness check', 'The compiler knows every constructor, so it lists each place that forgot one.', '// Rust\nmatch s { Shape::Circle(..) => …, Shape::Rect(..) => … }\n// error[E0004]: pattern `Tri` not covered'),
  },
  steps: [
    { note: 'Someone adds a Tri constructor to Shape.', line: [0, 1], vars: [['Shape', 'Circle | Rect | Tri', 'write']], out: '' },
    { note: 'area still only handles Circle and Rect.', line: [2, 3, 4], vars: [['Shape', 'Circle | Rect | Tri'], ['area covers', 'Circle, Rect', 'warn']], out: '' },
    { note: 'The compiler reports the missing case before the program runs.', line: 4, vars: [['Shape', 'Circle | Rect | Tri'], ['warning', 'Tri not matched', 'fail']], out: "warning: Pattern match(es) are non-exhaustive\n  Patterns not matched: Tri _ _ _" },
  ],
};

// ---------------- purity & immutability ----------------
function pure(p: P): Frame[] {
  const n = num(p.calls, 3, 1, 4);
  const f = new Film();
  const imp: number[] = [];
  const pur: number[] = [];
  let total = 0;
  const scene = (stmt: string, hot?: 'imp' | 'pur'): Shape[] => {
    const out: Shape[] = [...cap(stmt)];
    out.push(box('gt', 40, 120, 920, 90, `let total = ${total}`, { sub: 'shared mutable state, outside both functions', mono: true, tone: hot === 'imp' ? 'warn' : 'muted' }));
    out.push(text('it', 250, 260, 'addImpure(2)', { size: 28, mono: true, bold: true, tone: 'warn' }), text('pt', 750, 260, 'add(1, 2)', { size: 28, mono: true, bold: true, tone: 'ok' }));
    imp.forEach((v, k) => out.push(box(`i${k}`, 60, 290 + k * 110, 380, 90, `call ${k + 1} → ${v}`, { mono: true, tone: k === imp.length - 1 && hot === 'imp' ? 'current' : k ? 'warn' : 'default' })));
    pur.forEach((v, k) => out.push(box(`p${k}`, 560, 290 + k * 110, 380, 90, `call ${k + 1} → ${v}`, { mono: true, tone: k === pur.length - 1 && hot === 'pur' ? 'current' : 'ok' })));
    if (imp.length) out.push(arrow('rw', 250, 288, 250, 212, 'warn', { width: 4 }));
    return out;
  };
  f.add('Two functions. addImpure reads and writes a variable outside itself; add depends only on its arguments.', scene('const addImpure = x => { total += x; return total; };  const add = (a, b) => a + b;'), panel('Purity', [['total', 0]]));
  for (let k = 0; k < n; k++) {
    total += 2;
    imp.push(total);
    f.add(k ? `Same call, different answer: ${total}. The result depends on how many times it ran before.` : `addImpure(2) returns 2, and changes total as a side effect.`, scene('addImpure(2);', 'imp'), panel('Purity', [['total', total, 'warn'], ['addImpure(2)', total]]));
    pur.push(3);
    f.add(k ? 'add(1, 2) is 3 again. It always will be: nothing outside it can change the answer.' : 'add(1, 2) returns 3 and touches nothing.', scene('add(1, 2);', 'pur'), panel('Purity', [['total', total], ['add(1, 2)', 3, 'ok']]));
  }
  f.add('A pure call can be cached, reordered, run in parallel or tested with no setup. The impure one needs its hidden state managed every time.', scene('// referential transparency: add(1, 2) can be replaced by 3'), panel('Purity', [['pure', 'cacheable, testable', 'ok'], ['impure', 'depends on history', 'warn']]));
  return f.frames;
}

function persistent(p: P): Frame[] {
  const append = pick(p.op, ['prepend', 'append'], 'prepend') === 'append';
  const f = new Film();
  const W = 150;
  const node = (id: string, x: number, y: number, v: string | number, tone: Tone): Shape => box(id, x, y, W - 30, 80, String(v), { mono: true, tone });
  const nil = (id: string, x: number, y: number): Shape => text(id, x + 20, y + 48, '[]', { align: 'left', size: 26, mono: true, tone: 'muted' });
  const xs = (tone: Tone = 'default'): Shape[] => [text('xl', 40, 468, 'xs', { align: 'left', size: 28, mono: true, bold: true }), node('x2', 160, 420, 2, tone), arrow('x2a', 280, 460, 308, 460, 'default'), node('x3', 310, 420, 3, tone), arrow('x3a', 430, 460, 458, 460, 'muted'), nil('xn', 460, 420)];
  let made = 0;
  f.add('xs is an immutable list: cells holding 2 and 3. Nobody may change them, so anyone may point at them.', [...cap('const xs = [2, 3];'), ...xs()], panel('Persistent list', [['cells', 2]]));
  if (!append) {
    made = 1;
    const ys = [text('yl', 40, 268, 'ys', { align: 'left', size: 28, mono: true, bold: true }), node('y1', 160, 220, 1, 'write'), arrow('y1a', 220, 300, 220, 418, 'ok', { width: 4 })];
    f.add('Prepending makes one new cell, 1, whose tail is xs itself. The old cells are shared, not copied.', [...cap('const ys = [1, ...xs];   // cons 1 xs'), ...ys, ...xs('ok')], panel('Persistent list', [['new cells', made, 'ok'], ['shared', 2, 'ok']]));
    made = 2;
    const zs = [text('zl', 40, 668, 'zs', { align: 'left', size: 28, mono: true, bold: true }), node('z9', 160, 620, 9, 'write'), arrow('z9a', 220, 620, 220, 502, 'ok', { width: 4 })];
    f.add('zs shares the same tail. Three lists, four cells in total.', [...cap('const zs = [9, ...xs];'), ...ys, ...zs, ...xs('ok')], panel('Persistent list', [['new cells', made, 'ok'], ['shared', 2, 'ok']]));
    f.add('xs is unchanged and still valid. Sharing is safe only because nothing is ever mutated: the payoff of immutability.', [...cap('// xs is still [2, 3]'), ...ys, ...zs, ...xs('ok')], panel('Persistent list', [['copies', 0, 'ok'], ['xs', '[2, 3]', 'ok']]));
  } else {
    const copy = (pre: string, y: number, last: number, tone: Tone): Shape[] => [text(`${pre}l`, 40, y + 48, pre, { align: 'left', size: 28, mono: true, bold: true }), node(`${pre}2`, 160, y, 2, 'warn'), arrow(`${pre}2a`, 280, y + 40, 308, y + 40, 'default'), node(`${pre}3`, 310, y, 3, 'warn'), arrow(`${pre}3a`, 430, y + 40, 458, y + 40, 'default'), node(`${pre}x`, 460, y, last, tone), arrow(`${pre}xa`, 580, y + 40, 608, y + 40, 'muted'), nil(`${pre}n`, 610, y)];
    made = 3;
    f.add('Appending needs a new last cell, but 3’s tail is fixed forever. So 2 and 3 must be copied first: the whole list.', [...cap('const ys = [...xs, 1];   // xs ++ [1]'), ...copy('ys', 220, 1, 'write'), ...xs()], panel('Persistent list', [['new cells', made, 'warn'], ['copied', 2, 'warn']]));
    made = 6;
    f.add('zs copies xs again. Append is O(n) on immutable lists; prepend is O(1).', [...cap('const zs = [...xs, 9];'), ...copy('ys', 220, 1, 'write'), ...copy('zs', 620, 9, 'write'), ...xs()], panel('Persistent list', [['new cells', made, 'warn'], ['copied', 4, 'warn']]));
    f.add('xs is still intact, but nothing was shared. Persistent structures are built to grow at the cheap end (or use trees for both).', [...cap('// xs is still [2, 3]'), ...copy('ys', 220, 1, 'write'), ...copy('zs', 620, 9, 'write'), ...xs('ok')], panel('Persistent list', [['copies', 4, 'warn'], ['xs', '[2, 3]', 'ok']]));
  }
  return f.frames;
}

liveDemo(
  'fp-pure',
  'Pure functions & immutability',
  'The same call answering differently when it depends on hidden state, an immutable list shared by every version built on top of it (and the copying append forces), and effects at the edges.',
  {
    pure: ['Pure vs impure', pure],
    persistent: ['Persistent data', persistent],
    edges: ['Effects at the edges', () => traceFrames(edgesTrace)],
  },
  [number('calls', 'calls', 1, 4, 3, { for: ['pure'] }), choice('op', 'new list', ['prepend', 'append'], 'prepend', { for: ['persistent'], labels: ['[1, ...xs]', '[...xs, 1]'] })],
  { gt: D('Hidden state', 'A variable the function reads or writes besides its arguments. It makes the result depend on history.'), x2: D('Shared cell', 'An immutable cons cell. Many lists can point at it because none can change it.') },
);

// ---------------- higher-order functions ----------------
const HD: Record<string, Detail> = {
  na: D('Captured variable', 'n lived in counter’s frame. Because the returned function still refers to it, it moves to the heap and outlives the call.'),
  a: D('Closure', 'A function plus the environment it captured. next is not just code; it carries its own n.', "const makeAdder = k => x => x + k;\nconst add5 = makeAdder(5);\nadd5(1); // 6"),
};

function closure(p: P): Frame[] {
  const calls = num(p.calls, 2, 1, 3);
  const two = pick(p.two, ['no', 'yes'], 'no') === 'yes';
  const m = new Mem({ panel: 'Closure', details: HD, out: true });
  m.region('main', 'module scope').region('fr', 'counter() · frame').region('env', 'heap · captured environments');
  m.v('na', 'fr', 0, 'n', '0x7c0', '0');
  m.snap('Calling counter() creates n = 0 in its frame.', 'const next = counter();   // let n = 0', { out: '' });
  m.gone('na').v('na', 'env', 0, 'n (next’s)', '0x900', '0').v('a', 'main', 0, 'next', '0x10', 'fn', { to: 'na' });
  m.kill('fr', 'counter() returned');
  m.snap('counter returns a function that still uses n. So n is kept alive on the heap, owned by the closure, after the frame is gone.', '  return () => ++n;', { finger: 'na', fly: ['a', 'na'], out: '', rows: [['n', 'outlives counter()', 'ok']] });
  let out = '';
  for (let k = 1; k <= calls; k++) {
    m.set('na', String(k));
    out += `${k} `;
    m.snap(k === 1 ? 'next() increments its captured n: 1.' : `Again: ${k}. The state persists between calls, private to next.`, 'next();', { finger: 'na', hot: { na: 'write' }, out: out.trim(), rows: [['next()', k]] });
  }
  if (two) {
    m.drop('fr').region('fr', 'counter() · second call');
    m.v('nb', 'env', 1, 'n (other’s)', '0x980', '0').v('b', 'main', 1, 'other', '0x18', 'fn', { to: 'nb' });
    m.snap('A second counter() call gets a fresh n. Each closure carries its own environment.', 'const other = counter();', { finger: 'nb', out: out.trim(), rows: [['environments', 2]] });
    m.set('nb', '1');
    m.snap(`other() prints 1, not ${calls + 1}. Closures are how functional code keeps private state without objects.`, 'other();', { finger: 'nb', hot: { nb: 'write', na: 'ok' }, out: `${out.trim()} | 1`, rows: [['next’s n', calls], ['other’s n', 1]] });
  } else m.snap('Nobody outside can reach n except through next: a closure is private state without a class.', '// n is unreachable from here', { finger: null, out: out.trim(), rows: [['n', calls, 'ok']] });
  return m.frames();
}

const PREDS = ['even', 'odd', 'gt2'];

function pipeline(p: P): Frame[] {
  const pr = pick(p.pred, PREDS, 'even');
  const keep = (x: number) => (pr === 'even' ? x % 2 === 0 : pr === 'odd' ? x % 2 === 1 : x > 2);
  const src = pr === 'even' ? 'x => x % 2 === 0' : pr === 'odd' ? 'x => x % 2 === 1' : 'x => x > 2';
  const xs = [1, 2, 3, 4];
  const fl = xs.filter(keep);
  const sq = fl.map((x) => x * x);
  const f = new Film();
  const row = (id: string, y: number, label: string, vals: number[], tone: Tone, dim?: (i: number) => boolean): Shape[] => [text(`${id}l`, 40, y + 50, label, { align: 'left', size: 24, mono: true, bold: true, tone: 'muted' }), ...vals.map((v, i) => box(`${id}${i}`, 260 + i * 170, y, 150, 80, String(v), { mono: true, tone: dim?.(i) ? 'visited' : tone, dashed: dim?.(i) }))];
  const a = row('xs', 140, 'xs', xs, 'default');
  f.add('Four numbers. Instead of a loop with an accumulator, chain three small functions, each a value passed to another.', [...cap('const xs = [1, 2, 3, 4];'), ...a], panel('Pipeline', [['arrays', 1]]));
  const b = row('fl', 300, '.filter', fl, 'accent');
  f.add(`filter(${src}) keeps ${fl.length} of 4 in a new array. xs is untouched.`, [...cap(`  .filter(${src})`), ...row('xs', 140, 'xs', xs, 'default', (i) => !keep(xs[i])), ...b], panel('Pipeline', [['kept', fl.length], ['arrays', 2]]));
  const c = row('mp', 460, '.map', sq, 'protocol');
  f.add(`map(x => x * x) squares each survivor into another new array: ${sq.join(', ') || 'nothing'}.`, [...cap('  .map(x => x * x)'), ...row('xs', 140, 'xs', xs, 'default', (i) => !keep(xs[i])), ...b, ...c], panel('Pipeline', [['arrays', 3]]));
  let acc = 0;
  const steps: Shape[] = [];
  sq.forEach((v, i) => {
    acc += v;
    steps.push(box(`r${i}`, 260 + i * 170, 620, 150, 80, `${acc}`, { mono: true, tone: 'ok' }));
  });
  f.add(`reduce((a, x) => a + x, 0) folds them into one number: ${sq.length ? `0 + ${sq.join(' + ')} = ${acc}` : 'nothing to add, so the seed 0'}.`, [...cap('  .reduce((a, x) => a + x, 0);'), ...row('xs', 140, 'xs', xs, 'default', (i) => !keep(xs[i])), ...b, ...c, text('rl', 40, 670, '.reduce', { align: 'left', size: 24, mono: true, bold: true, tone: 'muted' }), ...steps], panel('Pipeline', [['result', acc, 'ok']]));
  f.add('Each step says what, not how, and none mutates anything. Arrays are eager: every stage built a full intermediate array.', [...cap(`// r === ${acc}`), ...row('xs', 140, 'xs', xs, 'default', (i) => !keep(xs[i])), ...b, ...c, ...steps], panel('Pipeline', [['loops written', 0, 'ok'], ['intermediate arrays', 2, 'warn']]));
  return f.frames;
}

liveDemo(
  'fp-hof',
  'Higher-order functions & closures',
  'A closure keeping its captured variable alive after the frame that made it is gone (and a second one with its own), map/filter/reduce as arrays flowing through stages, and composition.',
  {
    closure: ['Closures', closure],
    pipeline: ['map, filter, reduce', pipeline],
    compose: ['Currying & composition', () => traceFrames(composeTrace)],
  },
  [number('calls', 'next() calls', 1, 3, 2, { for: ['closure'] }), choice('two', 'second counter', ['no', 'yes'], 'no', { for: ['closure'] }), choice('pred', 'filter', PREDS, 'even', { for: ['pipeline'], labels: ['even', 'odd', '> 2'] })],
);

// ---------------- recursion & folds ----------------
function recur(n: number, tail: boolean): Frame[] {
  const xs = [...Array(n).keys()].map((i) => i + 1);
  const lst = (from: number) => `[${xs.slice(from).join(',')}]`;
  const f = new Film();
  const FH = Math.min(100, 640 / (n + 1));
  const stack = (frames: { label: string; sub: string; tone: Tone }[], stmt: string): Shape[] => {
    const out: Shape[] = [...cap(stmt), box('stk', 40, 120, 600, 860, undefined, { tone: 'muted', filled: false }), text('stt', 60, 150, 'call stack', { align: 'left', size: 24, bold: true, tone: 'muted' })];
    frames.forEach((fr, k) => out.push(box(`f${k}`, 60, 960 - (k + 1) * (FH + 8), 560, FH, fr.label, { sub: fr.sub, mono: true, tone: fr.tone })));
    out.push(box('depth', 680, 120, 280, 120, `depth ${frames.length}`, { mono: true, tone: frames.length > 3 ? 'warn' : 'ok' }));
    return out;
  };
  if (!tail) {
    const fr: { label: string; sub: string; tone: Tone }[] = [];
    for (let k = 0; k <= n; k++) {
      fr.forEach((x) => (x.tone = 'accent'));
      fr.push({ label: `sum ${lst(k)}`, sub: k < n ? `${xs[k]} + ?` : '= 0', tone: k < n ? 'current' : 'ok' });
      f.add(k === 0 ? `sum ${lst(0)} must compute ${xs[0]} + sum ${lst(1)} first, so it waits.` : k < n ? `Each call pushes a frame holding a pending addition: ${xs[k]} + ?.` : 'The base case sum [] returns 0. Now the frames can finish.', stack(fr.map((x) => ({ ...x })), k < n ? `sum (x:xs) = x + sum xs` : 'sum [] = 0'), panel('Recursion', [['frames', fr.length]]));
    }
    let acc = 0;
    for (let k = n - 1; k >= 0; k--) {
      acc += xs[k];
      fr.pop();
      fr[k] = { label: `sum ${lst(k)}`, sub: `= ${acc}`, tone: 'ok' };
      if (k === n - 1 || k === 0) f.add(k ? `Frames unwind, adding on the way out: ${xs[k]} + … = ${acc}.` : `The first frame finishes last: ${acc}. Depth equalled the list length, so a long enough list overflows the stack.`, stack(fr.slice(0, k + 1).map((x) => ({ ...x })), 'sum (x:xs) = x + sum xs'), panel('Recursion', [['frames', k + 1], ['result', acc, k ? 'default' : 'ok']]));
    }
  } else {
    let acc = 0;
    for (let k = 0; k <= n; k++) {
      const fr = [{ label: `go ${acc} ${lst(k)}`, sub: k < n ? `→ go ${acc + xs[k]} ${lst(k + 1)}` : `= ${acc}`, tone: (k < n ? 'current' : 'ok') as Tone }];
      f.add(k === 0 ? 'The work is done before the recursive call and carried in acc, so nothing waits on the way back.' : k < n ? `The tail call reuses the frame: acc = ${acc}. Still one frame.` : `The base case returns acc directly: ${acc}. Constant stack for any list length.`, stack(fr, k < n ? 'go acc (x:xs) = go (acc + x) xs   -- tail call' : 'go acc [] = acc'), panel('Tail call', [['frames', 1, 'ok'], ['acc', acc]]));
      if (k < n) acc += xs[k];
    }
    f.add(`Plain recursion would have needed ${n + 1} frames here; the tail call needed one. Folds like foldl' are built on this.`, stack([{ label: `go 0 ${lst(0)}`, sub: `= ${acc}`, tone: 'ok' }], `go 0 ${lst(0)}   -- ${acc}`), panel('Tail call', [['frames', 1, 'ok'], ['plain recursion', n + 1, 'warn']]));
  }
  return f.frames;
}

const OPS = ['-', '+'];

function folds(p: P): Frame[] {
  const op = pick(p.op, OPS, '-');
  const ap = (a: number, b: number) => (op === '-' ? a - b : a + b);
  const xs = [1, 2, 3];
  const f = new Film();
  const nodeBox = (id: string, x: number, y: number, label: string, tone: Tone) => box(id, x - 70, y - 35, 140, 70, label, { mono: true, tone });
  const tree = (pre: string, left: boolean, x0: number, vals: (number | undefined)[]): Shape[] => {
    // three op nodes stepping down-right (foldr) or down-left (foldl)
    const out: Shape[] = [];
    const dir = left ? -1 : 1;
    for (let k = 0; k < 3; k++) {
      const x = x0 + dir * k * 70;
      const y = 280 + k * 150;
      const v = vals[k];
      out.push(nodeBox(`${pre}o${k}`, x, y, v === undefined ? op : `${op} = ${v}`, v === undefined ? 'accent' : 'ok'));
      const lx = x - dir * 110;
      out.push(line(`${pre}l${k}`, x, y + 35, lx, y + 95, 'muted'), nodeBox(`${pre}v${k}`, lx, y + 130, String(left ? [3, 2, 1][k] : xs[k]), 'default'));
      if (k < 2) out.push(line(`${pre}c${k}`, x, y + 35, x + dir * 70, y + 115, 'muted'));
      else out.push(line(`${pre}s`, x, y + 35, x + dir * 70, y + 95, 'muted'), nodeBox(`${pre}seed`, x + dir * 70, y + 130, '0', 'muted'));
    }
    return out;
  };
  const rVals = [ap(1, ap(2, ap(3, 0))), ap(2, ap(3, 0)), ap(3, 0)];
  const lVals = [ap(ap(ap(0, 1), 2), 3), ap(ap(0, 1), 2), ap(0, 1)];
  const lbl = (pre: string, x: number, s: string) => text(`${pre}t`, x, 140, s, { size: 26, mono: true, bold: true });
  const R = (vals: (number | undefined)[]) => [lbl('r', 260, `foldr (${op}) 0 [1,2,3]`), ...tree('r', false, 200, vals)];
  const L = (vals: (number | undefined)[]) => [lbl('l', 740, `foldl (${op}) 0 [1,2,3]`), ...tree('l', true, 800, vals)];
  f.add(`foldr nests to the right: 1 ${op} (2 ${op} (3 ${op} 0)). The last element meets the seed first, at the bottom.`, [...cap(`foldr (${op}) 0 [1, 2, 3]`), ...R([undefined, undefined, undefined])], panel('Folds', [['shape', 'right-nested']]));
  f.add(`Evaluate from the bottom up: 3 ${op} 0 = ${rVals[2]}, then 2 ${op} ${rVals[2]} = ${rVals[1]}, then 1 ${op} ${rVals[1]} = ${rVals[0]}.`, [...cap(`foldr (${op}) 0 [1, 2, 3]   -- ${rVals[0]}`), ...R(rVals)], panel('Folds', [['foldr', rVals[0], 'ok']]));
  f.add(`foldl nests to the left: ((0 ${op} 1) ${op} 2) ${op} 3. The seed meets the first element first.`, [...cap(`foldl (${op}) 0 [1, 2, 3]`), ...R(rVals), ...L([undefined, undefined, undefined])], panel('Folds', [['foldr', rVals[0]], ['shape', 'left-nested']]));
  f.add(`0 ${op} 1 = ${lVals[2]}, then ${lVals[2]} ${op} 2 = ${lVals[1]}, then ${lVals[1]} ${op} 3 = ${lVals[0]}.`, [...cap(`foldl (${op}) 0 [1, 2, 3]   -- ${lVals[0]}`), ...R(rVals), ...L(lVals)], panel('Folds', [['foldr', rVals[0]], ['foldl', lVals[0], 'ok']]));
  const same = rVals[0] === lVals[0];
  f.add(same ? `Both give ${lVals[0]}: + is associative, so the nesting does not matter. Pick foldl' for speed.` : `Same list, same function, different answers: ${rVals[0]} vs ${lVals[0]}. − is not associative, so the direction is part of the meaning.`, [...cap(same ? '-- associative: foldr == foldl' : '-- not associative: foldr /= foldl'), ...R(rVals), ...L(lVals)], panel('Folds', [['foldr', rVals[0], same ? 'ok' : 'warn'], ['foldl', lVals[0], same ? 'ok' : 'warn']]));
  return f.frames;
}

liveDemo(
  'fp-rec',
  'Recursion, tail calls & folds',
  'Plain recursion stacking a frame per element until the base case, a tail call reusing one frame, and foldr vs foldl drawn as right- and left-leaning trees (try − and +).',
  {
    stack: ['Recursion & the stack', (p) => recur(num(p.n, 3, 1, 6), false)],
    tail: ['Tail calls', (p) => recur(num(p.n2, 3, 1, 6), true)],
    folds: ['foldl vs foldr', folds],
  },
  [number('n', 'list length', 1, 6, 3, { for: ['stack'] }), number('n2', 'list length', 1, 6, 3, { for: ['tail'] }), choice('op', 'operator', OPS, '-', { for: ['folds'] })],
  { depth: D('Stack depth', 'Each non-tail call waits for the next, so the stack grows with the input. Tail calls (or folds) keep it constant.') },
);

// ---------------- laziness ----------------
const LZ: Record<string, Detail> = {
  tx: D('Thunk', 'A suspended computation: code plus the values it needs, run at most once when demanded, then replaced by its result.'),
  ty: D('Forced thunk', 'After evaluation the thunk is overwritten with its value, so later uses are free.'),
};

function thunks(p: P): Frame[] {
  const flag = pick(p.flag, ['True', 'False'], 'True') === 'True';
  const m = new Mem({ panel: 'Thunks', details: LZ, out: true });
  m.region('env', 'let bindings').region('heap', 'heap · thunks');
  m.v('tx', 'heap', 0, 'thunk', '0x900', 'expensive 42').v('ty', 'heap', 1, 'thunk', '0x980', '1 + 2');
  m.v('x', 'env', 0, 'x', '0x10', '→', { to: 'tx' }).v('y', 'env', 1, 'y', '0x18', '→', { to: 'ty' });
  m.snap('let binds x and y to thunks: recipes, not values. Nothing has been computed yet.', 'let x = expensive 42;  y = 1 + 2', { out: '', rows: [['computed', 0, 'ok']] });
  const [want, skip] = flag ? ['ty', 'tx'] : ['tx', 'ty'];
  m.snap(`flag is ${flag ? 'True' : 'False'}, so the if demands ${flag ? 'y' : 'x'}. Only that thunk is forced.`, `in if flag then y else x`, { finger: want, hot: { [want]: 'current' }, out: '' });
  m.set(want, flag ? '3' : '1764');
  m.snap(`The thunk runs and is overwritten with its value, ${flag ? 3 : 1764}. A second use would be free.`, '-- forced', { finger: want, hot: { [want]: 'ok' }, out: flag ? '3' : '1764', rows: [['computed', 1]] });
  m.free(skip);
  m.snap(flag ? 'expensive 42 is never run. Once the expression finishes it is just garbage: work you never pay for.' : 'This time the expensive branch was needed and y’s cheap thunk was the one skipped.', '-- the other thunk is never forced', { finger: skip, out: flag ? '3' : '1764', rows: [['skipped', flag ? 'expensive 42' : '1 + 2', 'ok']] });
  return m.frames();
}

function infinite(p: P): Frame[] {
  const n = num(p.take, 3, 1, 5);
  const f = new Film();
  const cells: number[] = [];
  const scene = (stmt: string, hot?: number, done?: boolean): Shape[] => {
    const out: Shape[] = [...cap(stmt), text('nl', 40, 180, 'nats', { align: 'left', size: 26, mono: true, bold: true })];
    cells.forEach((v, i) => out.push(box(`c${i}`, 140 + i * 150, 140, 130, 80, `${v}`, { sub: `→ ${v * 2}`, mono: true, tone: i === hot ? 'write' : 'ok' })));
    const tx = 140 + cells.length * 150;
    if (tx < 900) out.push(box('rest', tx, 140, Math.min(260, 990 - tx), 80, `[${cells.length + 1} ..]`, { sub: done ? 'never built' : 'thunk', mono: true, tone: done ? 'visited' : 'muted', dashed: true }));
    out.push(text('rl', 40, 340, 'take result', { align: 'left', size: 24, bold: true, tone: 'muted' }));
    cells.forEach((v, i) => out.push(box(`o${i}`, 40 + i * 150, 360, 130, 80, String(v * 2), { mono: true, tone: done ? 'ok' : 'accent' })));
    return out;
  };
  f.add('nats is one thunk standing for the whole infinite list. Defining it costs nothing.', scene('nats = [1 ..]'), panel('Lazy list', [['cells built', 0, 'ok']]));
  for (let k = 1; k <= n; k++) {
    cells.push(k);
    f.add(k === 1 ? `take ${n} demands the first cell: the thunk produces 1 and a new thunk for the rest; map turns it into 2.` : `take needs another, so one more cell is produced on demand: ${k} → ${k * 2}.`, scene(`take ${n} (map (* 2) nats)`, k - 1), panel('Lazy list', [['cells built', k], ['taken', k]]));
  }
  f.add(`take has its ${n} element${n > 1 ? 's' : ''} and stops pulling. The rest of the infinite list is never built.`, scene(`-- [${cells.map((c) => c * 2).join(', ')}]`, undefined, true), panel('Lazy list', [['cells built', n, 'ok'], ['infinite?', 'only on paper', 'ok']]));
  return f.frames;
}

function leak(p: P): Frame[] {
  const strict = pick(p.fold, ['lazy', 'strict'], 'lazy') === 'strict';
  const f = new Film();
  const fn = strict ? "foldl'" : 'foldl';
  const scene = (k: number, stmt: string, big?: boolean): Shape[] => {
    const out: Shape[] = [...cap(stmt)];
    if (strict) {
      const s = (k * (k + 1)) / 2;
      out.push(box('acc', 40, 160, 400, 110, big ? 'acc = 500000500000' : `acc = ${s}`, { sub: 'one evaluated number', mono: true, tone: 'ok' }));
    } else {
      const shown = Math.min(k, 6);
      for (let i = 0; i < shown; i++) out.push(box(`t${i}`, 40 + i * 30, 160 + i * 110, 600, 90, i === 0 ? '0 + 1' : `(…) + ${i + 1}`, { sub: 'thunk', mono: true, tone: big ? 'fail' : 'warn', dashed: true }));
      if (big) out.push(text('more', 700, 520, '… ×1,000,000', { size: 36, bold: true, tone: 'fail' }));
    }
    return out;
  };
  for (const k of [1, 2, 3]) f.add(k === 1 ? (strict ? `${fn} forces each addition as it goes: acc is a plain number.` : 'Lazy foldl does not add: it wraps the old accumulator in a new thunk, (0 + 1).') : strict ? `acc = ${(k * (k + 1)) / 2}. Still one number in memory.` : `Another step, another unevaluated layer. Nothing has been added yet.`, scene(k, `${fn} (+) 0 [1 .. 1000000]   -- step ${k}`), panel(fn, [['steps', k], ['thunks', strict ? 0 : k, strict ? 'ok' : 'warn']]));
  f.add(strict ? 'After a million steps acc is still one number: constant space.' : 'After a million steps the heap holds a million nested thunks: a space leak, maybe a stack overflow when it is finally forced.', scene(1000000, `${fn} (+) 0 [1 .. 1000000]`, true), panel(fn, [['thunks', strict ? 0 : '1,000,000', strict ? 'ok' : 'fail'], ['memory', strict ? 'constant' : '~ 32 MB', strict ? 'ok' : 'fail']]));
  f.add(strict ? "foldl' (or a bang pattern) is the default for numeric accumulators. Laziness is for structure, not running totals." : "Fix: foldl' forces the accumulator each step. Unforced thunks are the classic Haskell space leak.", scene(strict ? 1000000 : 3, strict ? '-- 500000500000' : "foldl' (+) 0 [1 .. 1000000]", strict), panel(fn, [['result', '500000500000', 'ok']]));
  return f.frames;
}

liveDemo(
  'fp-lazy',
  'Lazy evaluation',
  'Expressions as thunks: only the branch you demand is computed, an infinite list built one cell per demand, and a lazy accumulator piling up a million thunks.',
  {
    thunks: ['Thunks', thunks],
    infinite: ['Infinite lists', infinite],
    leak: ['Space leaks', leak],
  },
  [choice('flag', 'flag', ['True', 'False'], 'True', { for: ['thunks'] }), number('take', 'take', 1, 5, 3, { for: ['infinite'] }), choice('fold', 'fold', ['lazy', 'strict'], 'lazy', { for: ['leak'], labels: ['foldl', "foldl'"] })],
  { rest: D('Unevaluated tail', 'The rest of the list is a thunk until someone asks for the next cell.'), acc: D("foldl'", 'Forces the accumulator at each step, so it never builds a chain of thunks.') },
);

// ---------------- algebraic data types: matching ----------------
const SHAPES = ['Circle', 'Rect', 'Tri'];

function match(p: P): Frame[] {
  const sh = pick(p.shape, SHAPES, 'Rect');
  const val = sh === 'Circle' ? 'Circle (Point 0 0) 2' : sh === 'Rect' ? 'Rect (Point 0 0) (Point 3 2)' : 'Tri a b c';
  const clauses = [
    { pat: 'area (Circle _ r)', body: 'pi * r * r', hit: sh === 'Circle', binds: 'r = 2', res: '12.57' },
    { pat: 'area (Rect (Point x1 y1) (Point x2 y2))', body: 'abs (x2-x1) * abs (y2-y1)', hit: sh === 'Rect', binds: 'x1=0 y1=0 x2=3 y2=2', res: '6.0' },
  ];
  const f = new Film();
  const scene = (stmt: string, cur: number | undefined, tested: number, done?: boolean): Shape[] => {
    const out: Shape[] = [...cap(stmt), box('val', 40, 120, 920, 90, val, { sub: 'the value being matched', mono: true, tone: 'accent' })];
    clauses.forEach((c, k) => {
      const tone: Tone = k === cur ? (c.hit ? 'ok' : 'warn') : k < tested ? (c.hit ? 'ok' : 'visited') : 'muted';
      out.push(box(`cl${k}`, 40, 270 + k * 150, 920, 120, c.pat, { sub: k < tested && c.hit ? `${c.binds}  →  ${c.res}` : k < tested ? 'no match' : c.body, mono: true, tone }));
    });
    if (sh === 'Tri' && done) out.push(box('miss', 40, 570, 920, 110, 'no clause matches', { sub: 'runtime error: Non-exhaustive patterns in function area', mono: true, tone: 'fail' }));
    return out;
  };
  f.add('Pattern matching tries each clause top to bottom against the shape of the value: which constructor, and what is inside.', scene(`area (${val})`, undefined, 0), panel('Matching', [['constructor', sh]]));
  for (let k = 0; k < clauses.length; k++) {
    const c = clauses[k];
    f.add(c.hit ? `${sh} matches this clause, and the pattern names the parts at once: ${c.binds}.` : `Clause ${k + 1} wants a ${k ? 'Rect' : 'Circle'}; this is a ${sh}, so move on.`, scene(c.pat, k, k + 1), panel('Matching', [['clause', k + 1], ['match', c.hit ? 'yes' : 'no', c.hit ? 'ok' : 'warn']]));
    if (c.hit) {
      f.add(`The body runs with those names bound: ${c.body} = ${c.res}. Destructuring and branching in one step.`, scene(`= ${c.res}`, k, k + 1, true), panel('Matching', [['area', c.res, 'ok']]));
      return f.frames;
    }
  }
  f.add('A Tri falls off the end: no clause matches, and the program crashes at run time. -Wincomplete-patterns would have warned at compile time.', scene('-- missing: area (Tri …)', undefined, 2, true), panel('Matching', [['result', 'crash', 'fail'], ['fix', 'add a Tri clause', 'ok']]));
  return f.frames;
}

liveDemo(
  'fp-adt',
  'Algebraic data types & pattern matching',
  'Sum and product types, pattern matching trying clauses top to bottom and binding the parts of whichever shape you feed it (including one nobody handled), and exhaustiveness checks.',
  {
    sum: ['Sum & product types', () => traceFrames(sumTrace)],
    match: ['Pattern matching', match],
    exhaustive: ['Exhaustiveness', () => traceFrames(exhaustiveTrace)],
  },
  [choice('shape', 'area of a', SHAPES, 'Rect', { for: ['match'] })],
  { val: D('Value', 'A value built from one of Shape’s constructors. Matching inspects which one.') },
);

// ---------------- functors & monads: chains that short-circuit ----------------
interface Step {
  name: string;
  code: string;
  out: string;
  ok: boolean;
}

function chain(steps: Step[], intro: string, introStmt: string, outro: (failed: number) => string, title: string): Frame[] {
  const f = new Film();
  const fail = steps.findIndex((s) => !s.ok);
  const scene = (upto: number, stmt: string): Shape[] => {
    const out: Shape[] = [...cap(stmt)];
    steps.forEach((s, k) => {
      const y = 130 + k * 170;
      const done = k <= upto;
      const skipped = fail >= 0 && k > fail && done;
      const tone: Tone = !done ? 'muted' : skipped ? 'visited' : s.ok ? 'ok' : 'fail';
      out.push(box(`s${k}`, 40, y, 520, 120, s.code, { mono: true, tone, dashed: skipped || !done }));
      if (done) out.push(box(`r${k}`, 620, y + 15, 340, 90, skipped ? 'skipped' : s.out, { mono: true, tone: skipped ? 'visited' : s.ok ? 'ok' : 'fail' }));
      if (k < steps.length - 1) out.push(arrow(`a${k}`, 300, y + 122, 300, y + 168, done && !(fail >= 0 && k >= fail) ? 'ok' : 'muted', { width: 4 }));
    });
    return out;
  };
  f.add(intro, scene(-1, introStmt), panel(title, [['steps', steps.length]]));
  steps.forEach((s, k) => {
    if (fail >= 0 && k > fail) return;
    f.add(s.ok ? `${s.name} succeeds with ${s.out}, which is passed to the next step.` : `${s.name} fails with ${s.out}. The chain stops here: later steps never run.`, scene(k, s.code), panel(title, [['step', k + 1], ['result', s.out, s.ok ? 'ok' : 'fail']]));
  });
  f.add(outro(fail), scene(steps.length - 1, fail >= 0 ? `-- ${steps[fail].out}` : `-- ${steps[steps.length - 1].out}`), panel(title, [['result', fail >= 0 ? steps[fail].out : steps[steps.length - 1].out, fail >= 0 ? 'warn' : 'ok'], ['skipped', fail >= 0 ? steps.length - 1 - fail : 0]]));
  return f.frames;
}

const BOXES = ['Just', 'Nothing', 'List'];

function functor(p: P): Frame[] {
  const b = pick(p.box, BOXES, 'Just');
  const f = new Film();
  const content = b === 'Just' ? ['2'] : b === 'List' ? ['1', '2', '3'] : [];
  const scene = (stmt: string, vals: string[], after: boolean): Shape[] => {
    const out: Shape[] = [...cap(stmt), box('ctx', 40, 160, 920, 220, undefined, { tone: after ? 'ok' : 'accent', filled: false }), text('ctxl', 60, 192, b === 'List' ? 'list' : b === 'Just' ? 'Just' : 'Nothing', { align: 'left', size: 26, mono: true, bold: true, tone: after ? 'ok' : 'accent' })];
    if (!vals.length) out.push(text('empty', 500, 290, 'no value inside', { size: 28, tone: 'muted' }));
    vals.forEach((v, i) => out.push(box(`v${i}`, 120 + i * 260, 220, 220, 120, v, { mono: true, tone: after ? 'ok' : 'default' })));
    out.push(box('fn', 340, 470, 320, 100, '(+ 1)', { sub: 'a plain function on numbers', mono: true, tone: 'current' }));
    if (after && vals.length) vals.forEach((_, i) => out.push(arrow(`ap${i}`, 500, 468, 230 + i * 260, 344, 'current', { width: 3 })));
    return out;
  };
  const src = b === 'Just' ? 'Just 2' : b === 'List' ? '[1, 2, 3]' : 'Nothing';
  const res = b === 'Just' ? 'Just 3' : b === 'List' ? '[2, 3, 4]' : 'Nothing';
  f.add(`${src} is a value in a context: maybe-there, or many. (+ 1) only knows numbers.`, scene(`fmap (+ 1) (${src})`, content, false), panel('Functor', [['context', b]]));
  f.add(b === 'Nothing' ? 'fmap on Nothing has nothing to apply the function to, so it returns Nothing untouched. No null check written.' : `fmap reaches inside and applies (+ 1) to ${b === 'List' ? 'every element' : 'the value'}, keeping the context the same shape.`, scene(`fmap (+ 1) (${src})   -- ${res}`, b === 'Just' ? ['3'] : b === 'List' ? ['2', '3', '4'] : [], true), panel('Functor', [['result', res, 'ok']]));
  f.add('One function, any container: Maybe, lists, Either, futures. fmap lifts plain code into the context.', scene(`-- ${res}`, b === 'Just' ? ['3'] : b === 'List' ? ['2', '3', '4'] : [], true), panel('Functor', [['law', 'fmap id == id', 'ok']]));
  return f.frames;
}

const FAILS = ['none', 'user', 'order'];

function bind(p: P): Frame[] {
  const at = pick(p.fail, FAILS, 'none');
  return chain(
    [
      { name: 'findUser', code: 'findUser 7', out: at === 'user' ? 'Nothing' : 'Just ana', ok: at !== 'user' },
      { name: 'findOrder', code: 'findOrder ana', out: at === 'order' ? 'Nothing' : 'Just #42', ok: at !== 'order' },
      { name: 'shipTo', code: 'shipTo #42', out: 'Just "Oslo"', ok: true },
    ],
    'Three lookups, each of which may find nothing. >>= feeds each Just value into the next step.',
    'findUser 7 >>= findOrder >>= shipTo',
    (fl) => (fl >= 0 ? 'The whole chain is Nothing, and not one if-null check was written: >>= short-circuits.' : 'Every step found something, so the result is Just "Oslo".'),
    'Maybe monad',
  );
}

const PORTS = ['8080', '99999', 'abc'];

function doblock(p: P): Frame[] {
  const s = pick(p.input, PORTS, '99999');
  const isNum = /^\d+$/.test(s);
  const inRange = isNum && Number(s) >= 1 && Number(s) <= 65535;
  return chain(
    [
      { name: 'readInt', code: `n <- readInt "${s}"`, out: isNum ? `Right ${s}` : 'Left "not a number"', ok: isNum },
      { name: 'inRange', code: 'port <- inRange 1 65535 n', out: inRange ? `Right ${s}` : 'Left "out of range"', ok: inRange },
      { name: 'pure', code: 'pure (Config port)', out: `Right Config ${s}`, ok: true },
    ],
    'do-notation reads like ordinary step-by-step code, but each <- is a >>= that stops at the first Left.',
    `parse "${s}"`,
    (fl) => (fl >= 0 ? `The result is the first Left, carrying the reason. Errors are values, not exceptions.` : 'Both checks passed, so parse returns Right Config.'),
    'Either monad',
  );
}

liveDemo(
  'fp-monad',
  'Functors & monads',
  'fmap reaching into a context (or finding nothing there), >>= chaining lookups that stop at the first Nothing, and do-notation stopping at the first Left. Pick where it fails.',
  {
    functor: ['Functor: map in a context', functor],
    bind: ['Monad: chain steps', bind],
    doblock: ['do-notation & Either', doblock],
  },
  [choice('box', 'value', BOXES, 'Just', { for: ['functor'], labels: ['Just 2', 'Nothing', '[1, 2, 3]'] }), choice('fail', 'fails at', FAILS, 'none', { for: ['bind'], labels: ['nowhere', 'findUser', 'findOrder'] }), choice('input', 'parse', PORTS, '99999', { for: ['doblock'], labels: ['"8080"', '"99999"', '"abc"'] })],
  { s0: D('Step', 'A function that returns a value in a context (Maybe / Either). >>= unwraps it for the next step or stops.'), fn: D('Plain function', 'fmap lifts it so it works inside any functor.') },
);
