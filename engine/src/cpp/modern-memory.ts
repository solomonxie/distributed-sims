// Modern C++, memory pictures (group cpp-modern): lambda captures as closure members, an escaping lambda that dangles,
// a lazy ranges pipeline pulling one element at a time, and the strong exception guarantee with copy-and-swap.
// Syntax-heavy parts (mutable/init-capture, unwinding recap) stay as line traces.
import type { Detail, Frame, Shape, Tone } from '../algo/frames';
import { arrow, box, Film, panel, text } from '../machine/lib/draw';
import { cap, choice, liveGroup, num, number, pick } from '../machine/lib/live';
import type { P } from '../machine/lib/live';
import { Mem } from '../machine/lib/mem';
import { traceFrames } from '../machine/lib/trace';
import type { Trace } from '../machine/lib/trace';

const liveDemo = liveGroup('cpp-modern');
const D = (title: string, text: string, code?: string): Detail => ({ title, text, code });

const CLOSURE = D('Closure object', 'A lambda is an unnamed struct with operator(). Each captured variable becomes a member: copies for [=], references for [&].', '// [n](int x) { return x + n; } is roughly:\nstruct __lambda {\n  int n;\n  int operator()(int x) const { return x + n; }\n};');

const mutableTrace: Trace = {
  code: ['auto counter = [i = 0]() mutable { return ++i; };', 'counter(); counter();', 'std::cout << counter();', 'auto up = std::make_unique<int>(7);', 'auto g = [p = std::move(up)] { return *p; };'],
  details: { counter: D('mutable', 'operator() is const by default, so by-value captures are read-only. mutable lets the closure change its own copies.', 'auto next = [n = 0]() mutable { return n++; };'), g: D('Init-capture', '[name = expr] creates a new member initialised by any expression, including moves of move-only types.', 'auto task = [buf = std::move(buffer)]() {\n  send(buf);\n};') },
  steps: [
    { line: 0, note: 'Init-capture [i = 0] creates a member i. mutable lets the call modify it.', vars: [['counter', '{ i: 0 }', 'current']], out: '' },
    { line: [1, 2], note: 'Each call increments the closure’s own i, so the lambda keeps state between calls.', vars: [['counter', '{ i: 3 }', 'write']], out: '3' },
    { line: [3, 4], note: 'Move-only things like unique_ptr can be moved into a closure with init-capture.', vars: [['counter', '{ i: 3 }'], ['up', 'nullptr', 'visited'], ['g', '{ p: unique_ptr → 7 }', 'ok']], out: '3', rows: [['ownership', 'moved into g', 'ok']] },
  ],
};

const unwindTrace: Trace = {
  code: ['void save(const Doc& d) {', '  std::ofstream f("out.txt");       // RAII', '  auto buf = std::make_unique<char[]>(4096);', '  write(f, d);                       // throws', '}', 'try { save(doc); } catch (const std::exception& e) { … }'],
  details: { f: D('RAII file', 'Its destructor closes the file even when an exception passes through.'), buf: D('RAII buffer', 'unique_ptr frees it during unwinding.'), ex: D('Exception object', 'Thrown objects are copied to special storage and caught by reference. Catch by const& to avoid slicing.', 'try { … }\ncatch (const std::runtime_error& e) {\n  log(e.what());\n}') },
  steps: [
    { line: [1, 2], note: 'save acquires a file and a buffer, each owned by an RAII object.', vars: [['f', 'ofstream (open)', 'current'], ['buf', 'unique_ptr', 'current', 'b']], heap: [['b', '4096 bytes']] },
    { line: 3, note: 'write throws. The rest of save is skipped.', vars: [['f', 'ofstream (open)'], ['buf', 'unique_ptr', 'default', 'b'], ['ex', 'std::runtime_error', 'fail']], heap: [['b', '4096 bytes']], rows: [['state', 'unwinding', 'warn']] },
    { line: 4, note: 'Unwinding runs destructors in reverse: buf frees the memory, then f closes the file.', vars: [['f', 'closed', 'ok'], ['buf', 'freed', 'ok'], ['ex', 'std::runtime_error', 'fail']], heap: [['b', '(freed)', 'ok']], rows: [['leaks', 0, 'ok']] },
    { line: 5, note: 'The handler catches by const reference. Only throw for failures the caller can’t handle locally.', vars: [['ex', 'caught', 'ok']], rows: [['cost when not thrown', '~0']] },
  ],
};

// ---------------- lambdas: captures, dangling ----------------
const LD: Record<string, Detail> = {
  n: D('Captured variable', 'A local in the enclosing scope. Capture by value copies it now; capture by reference stores where it lives.'),
  m: CLOSURE,
  count: D('Local variable', 'Lives in make()’s stack frame and dies when make returns.'),
};

function capture(p: P): Frame[] {
  const ref = pick(p.cap, ['val', 'ref'], 'val') === 'ref';
  const intro = ref ? 'auto f = [&n](int x) { return x + n; };' : 'auto f = [n](int x) { return x + n; };';
  const m = new Mem({ panel: 'Closure', details: LD, out: true });
  m.region('main', 'main() · stack').v('n', 'main', 0, 'n', '0x10', '1');
  m.snap('A local int n = 1.', 'int n = 1;', { out: '' });
  m.region('cl', 'f · the closure object (an unnamed struct)');
  if (ref) m.v('m', 'cl', 0, 'member: int&', '0x20', '0x10', { to: 'n' });
  else m.v('m', 'cl', 0, 'member: int', '0x20', '1');
  m.snap(ref ? 'The lambda becomes an object whose member is a reference to n (an address under the hood).' : 'The lambda becomes an object whose member is a copy of n, taken right now.', intro, { finger: 'm', fly: ref ? ['n.addr', 'm'] : ['n', 'm'], out: '', rows: [['sizeof(f)', ref ? '8 B' : '4 B']] });
  m.set('n', '10');
  m.snap(ref ? 'n changes to 10. The closure holds no copy, so it will see the new value.' : 'n changes to 10. The closure’s copy is a separate box and stays 1.', 'n = 10;', { finger: 'n', hot: { n: 'write', m: ref ? 'accent' : 'ok' }, out: '' });
  m.snap(ref ? 'f(1) follows the member to n: 1 + 10 = 11.' : 'f(1) reads its own member: 1 + 1 = 2.', 'std::cout << f(1);', { finger: ref ? 'n' : 'm', hot: { m: 'ok' }, out: ref ? '11' : '2', rows: [['f(1)', ref ? 11 : 2, 'ok'], ['sees later changes', ref ? 'yes' : 'no']] });
  return m.frames();
}

function dangling(p: P): Frame[] {
  const ref = pick(p.cap2, ['ref', 'val'], 'ref') === 'ref';
  const m = new Mem({ panel: 'Escaping lambda', details: LD, out: true });
  m.region('main', 'main() · stack').region('mk', 'make() · frame');
  m.v('count', 'mk', 0, 'count', '0x7c0', '5');
  m.snap('Inside make(), count lives in make’s stack frame.', '  int count = 5;', { out: '' });
  m.v('m', 'main', 0, ref ? 'f · member int&' : 'f · member int', '0x10', ref ? '0x7c0' : '5', ref ? { to: 'count' } : {});
  m.snap(ref ? 'The returned lambda captures count by reference: its member holds count’s address.' : 'The returned lambda captures count by value: its member is its own 5.', ref ? '  return [&count] { return count; };' : '  return [count] { return count; };', { finger: 'm', fly: ref ? ['count.addr', 'm'] : ['count', 'm'], out: '' });
  m.kill('mk', 'make() returned · frame popped');
  m.snap(ref ? 'make returns and its frame is popped. f still holds the address of the dead count.' : 'make returns and its frame is popped. f does not care: it carried its own copy out.', 'auto f = make();', { finger: 'm', hot: { m: ref ? 'fail' : 'ok' }, out: '', rows: [['count', 'dead', 'muted'], ['f', ref ? 'dangling' : 'self-contained', ref ? 'fail' : 'ok']] });
  m.snap(ref ? 'Calling f reads a dead stack slot: undefined behaviour, often garbage. A lambda that escapes must capture by value.' : 'f() returns 5. Capture by value (or move in) whatever an escaping lambda needs.', 'std::cout << f();', { finger: ref ? 'count' : 'm', hot: { count: ref ? 'fail' : 'muted' }, out: ref ? '32767 (garbage)' : '5', rows: [['f()', ref ? 'UB' : 5, ref ? 'fail' : 'ok']] });
  return m.frames();
}

liveDemo(
  'mod-lambda',
  'Lambdas & captures',
  'A lambda as an object with a member per capture: a copy or an arrow back to the variable, what happens when the lambda outlives that variable, and mutable state.',
  {
    capture: ['By value vs by reference', capture],
    dangling: ['Dangling capture', dangling],
    mutable: ['mutable & init-capture', () => traceFrames(mutableTrace)],
  },
  [choice('cap', 'capture', ['val', 'ref'], 'val', { for: ['capture'], labels: ['[n]', '[&n]'] }), choice('cap2', 'capture', ['ref', 'val'], 'ref', { for: ['dangling'], labels: ['[&count]', '[count]'] })],
);

// ---------------- ranges: a lazy pipeline ----------------
function lazy(p: P): Frame[] {
  const keep = pick(p.keep, ['even', 'odd'], 'even');
  const take = num(p.take, 2, 1, 3);
  const v = [1, 2, 3, 4, 5, 6];
  const pass = (x: number) => (keep === 'even' ? x % 2 === 0 : x % 2 === 1);
  const f = new Film();
  const state: Tone[] = v.map(() => 'default');
  const out: number[] = [];
  const cw = 920 / v.length;
  const stage = (id: string, y: number, label: string, sub: string, tone: Tone): Shape => box(id, 260, y, 480, 90, label, { sub, mono: true, tone });
  const scene = (stmt: string, o: { k?: number; passed?: boolean; sq?: number } = {}): Shape[] => {
    const s: Shape[] = [...cap(stmt), text('vt', 40, 128, 'v', { align: 'left', size: 24, bold: true, tone: 'muted' })];
    v.forEach((x, i) => s.push(box(`v${i}`, 40 + i * cw + 3, 140, cw - 6, 80, String(x), { mono: true, tone: i === o.k ? 'current' : state[i] })));
    s.push(stage('flt', 290, `filter(is_${keep})`, o.k === undefined ? 'waiting' : o.passed ? `${v[o.k]} passes` : `${v[o.k]} dropped`, o.k === undefined ? 'muted' : o.passed ? 'ok' : 'fail'));
    s.push(stage('trf', 430, 'transform(square)', o.sq !== undefined ? `${v[o.k!]} → ${o.sq}` : 'waiting', o.sq !== undefined ? 'ok' : 'muted'));
    s.push(stage('tk', 570, `take(${take})`, `${out.length} of ${take}`, out.length >= take ? 'warn' : 'muted'));
    if (o.k !== undefined) s.push(arrow('pull', 40 + (o.k + 0.5) * cw, 222, 500, 288, 'current', { width: 4 }));
    if (o.passed) s.push(arrow('p1', 500, 382, 500, 428, 'ok', { width: 4 }), arrow('p2', 500, 522, 500, 568, 'ok', { width: 4 }));
    s.push(text('ot', 40, 720, 'printed', { align: 'left', size: 24, bold: true, tone: 'muted' }));
    out.forEach((x, i) => s.push(box(`o${i}`, 40 + i * 160, 740, 140, 80, String(x), { mono: true, tone: 'ok' })));
    return s;
  };
  const examined = () => state.filter((t) => t !== 'default').length;
  f.add('Building the pipeline only records the steps. Nothing is filtered or squared yet, and nothing is allocated.', scene(`auto r = v | views::filter(is_${keep}) | views::transform(square);`), panel('ranges', [['work done', 0, 'ok'], ['allocations', 0, 'ok']]));
  for (let k = 0; k < v.length && out.length < take; k++) {
    const ok = pass(v[k]);
    if (ok) {
      out.push(v[k] * v[k]);
      state[k] = 'ok';
      f.add(`The loop pulls the next element: ${v[k]} passes the filter, is squared to ${v[k] * v[k]} and printed.`, scene(`for (int x : r | views::take(${take}))`, { k, passed: true, sq: v[k] * v[k] }), panel('ranges', [['examined', examined()], ['printed', out.length]]));
    } else {
      state[k] = 'visited';
      f.add(`${v[k]} is pulled but fails is_${keep}, so it is dropped and the pull moves on. transform never sees it.`, scene(`for (int x : r | views::take(${take}))`, { k, passed: false }), panel('ranges', [['examined', examined()], ['printed', out.length]]));
    }
  }
  const untouched = v.length - examined();
  f.add(untouched ? `take(${take}) is satisfied, so the loop stops. The last ${untouched} element${untouched > 1 ? 's were' : ' was'} never examined: lazy means only the work you pull.` : `take(${take}) asked for more than there was, so the pipeline ran to the end of v.`, scene(`// ${out.join(' ')}`), panel('ranges', [['examined', examined(), 'ok'], ['never touched', untouched, untouched ? 'ok' : 'muted']]));
  return f.frames;
}

liveDemo(
  'mod-ranges',
  'Ranges & views',
  'A lazy view pipeline drawn as stages: each loop step pulls one element through filter and transform, and take stops the pulling early. Change the filter and the count.',
  { lazy: ['Lazy pipeline', lazy] },
  [choice('keep', 'filter', ['even', 'odd'], 'even', { for: ['lazy'] }), number('take', 'take', 1, 3, 2, { for: ['lazy'] })],
  { flt: D('views::filter', 'Skips elements that fail the predicate. Nothing happens until someone pulls.', 'auto evens = v | std::views::filter([](int x) { return x % 2 == 0; });'), trf: D('views::transform', 'Applies a function to each element as it is pulled through.'), tk: D('views::take', 'Stops after n elements, so the rest of the range is never examined.') },
);

// ---------------- exception safety: in-place vs copy-and-swap ----------------
const GD: Record<string, Detail> = {
  s0: D('*this', 'The object being assigned to. With copy-and-swap it is either fully updated or unchanged.'),
  t0: D('Copy first', 'All the work that can fail happens on a temporary, so a throw leaves *this as it was.'),
};
const OLD = ['A', 'B', 'C', 'D'];
const NEW = ['w', 'x', 'y', 'z'];

function strong(p: P): Frame[] {
  const swap = pick(p.impl, ['inplace', 'swap'], 'inplace') === 'swap';
  const failAt = pick(p.fail, ['none', '2'], '2') === '2' ? 2 : -1;
  const m = new Mem({ panel: 'Guarantee', details: GD });
  m.region('self', '*this · rows', { tight: true });
  OLD.forEach((x, i) => m.v(`s${i}`, 'self', i, `row ${i}`, `0x${(0x100 + i * 8).toString(16)}`, x));
  m.snap(`Assign 4 new rows into *this. Copying a row can throw (say bad_alloc)${failAt >= 0 ? ', and row 2 will' : ''}.`, swap ? 'Table& operator=(const Table& o) { Table tmp(o); swap(*this, tmp); }' : 'Table& operator=(const Table& o) { for (i…) rows[i] = o.rows[i]; }', { rows: [['plan', swap ? 'copy-and-swap' : 'in place']] });
  if (!swap) {
    for (let i = 0; i < 4; i++) {
      if (i === failAt) {
        m.snap(`Copying row ${i} throws. Rows 0–${i - 1} are already overwritten, the rest are still old.`, `  rows[${i}] = o.rows[${i}];   // throws`, { finger: `s${i}`, hot: Object.fromEntries(OLD.map((_, k) => [`s${k}`, (k < i ? 'warn' : k === i ? 'fail' : 'default') as Tone])), rows: [['state', 'half old, half new', 'fail']] });
        m.snap('The caller catches an exception and holds a Table that is neither the old one nor the new one. That is only the basic guarantee: valid, but changed.', 'catch (…) { /* t is mixed */ }', { finger: null, hot: Object.fromEntries(OLD.map((_, k) => [`s${k}`, (k < i ? 'warn' : 'default') as Tone])), rows: [['guarantee', 'basic', 'warn']] });
        return m.frames();
      }
      m.set(`s${i}`, NEW[i]);
      if (i === 0 || i === 3) m.snap(`Row ${i} is overwritten in place.`, `  rows[${i}] = o.rows[${i}];`, { finger: `s${i}` });
    }
    m.snap('Nothing threw this time, so *this holds the new rows. But the code has no answer for a failure halfway through.', 'return *this;', { finger: null, rows: [['guarantee', 'basic only', 'warn']] });
    return m.frames();
  }
  m.region('tmp', 'Table tmp(o) · a full copy, built first', { tight: true });
  for (let i = 0; i < 4; i++) {
    if (i === failAt) {
      m.snap(`Copying row ${i} into tmp throws. *this has not been touched at all.`, '  Table tmp(o);   // throws', { finger: i ? `t${i - 1}` : null, hot: { [`s0`]: 'ok', s1: 'ok', s2: 'ok', s3: 'ok' }, rows: [['*this', 'untouched', 'ok']] });
      m.kill('tmp', 'tmp destroyed during unwinding');
      m.snap('Unwinding destroys the half-built tmp, freeing what it copied. The caller sees the old Table exactly as it was: the strong guarantee.', 'catch (…) { /* t unchanged */ }', { finger: null, hot: { s0: 'ok', s1: 'ok', s2: 'ok', s3: 'ok' }, rows: [['guarantee', 'strong', 'ok'], ['leaks', 0, 'ok']] });
      return m.frames();
    }
    m.v(`t${i}`, 'tmp', i, `row ${i}`, `0x${(0x200 + i * 8).toString(16)}`, NEW[i]);
    if (i === 0 || i === 3) m.snap(`Row ${i} is copied into tmp. *this is still the old table.`, '  Table tmp(o);', { finger: `t${i}` });
  }
  OLD.forEach((x, i) => {
    m.set(`s${i}`, NEW[i]).set(`t${i}`, x);
  });
  m.snap('swap exchanges the two tables’ internal pointers. It cannot throw, and now *this has the new rows.', '  swap(*this, tmp);   // noexcept', { finger: 's0', hot: { s0: 'ok', s1: 'ok', s2: 'ok', s3: 'ok' }, rows: [['guarantee', 'strong', 'ok']] });
  m.kill('tmp', 'tmp destroyed · frees the old rows');
  m.snap('tmp now holds the old rows and its destructor frees them. Destructors, swaps and moves should be noexcept.', '}', { finger: null, rows: [['basic', 'valid, maybe changed'], ['strong', 'all or nothing', 'ok'], ['nothrow', 'never fails']] });
  return m.frames();
}

liveDemo(
  'mod-exceptions',
  'Exceptions & exception safety',
  'Stack unwinding, and assignment that fails halfway: in place leaves a half-updated object, copy-and-swap leaves it untouched. Make row 2 throw and compare.',
  {
    unwind: ['Unwinding', () => traceFrames(unwindTrace)],
    strong: ['Strong guarantee', strong],
  },
  [choice('impl', 'operator=', ['inplace', 'swap'], 'inplace', { for: ['strong'], labels: ['in place', 'copy-and-swap'] }), choice('fail', 'copying throws', ['2', 'none'], '2', { for: ['strong'], labels: ['at row 2', 'never'] })],
);
