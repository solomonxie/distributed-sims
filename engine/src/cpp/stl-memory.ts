// STL, memory pictures (group cpp-stl): vector growth and iterator invalidation, insert/erase shifting, small string
// optimisation, string copy vs move, append with and without reserve, binary search, erase-remove, dangling string_view.
// Syntax-heavy parts (emplace_back, sort, transform/accumulate, string_view basics, span) stay as line traces.
import type { Detail, Frame, Shape, Tone } from '../algo/frames';
import { arrow, box, Film, panel, text } from '../machine/lib/draw';
import type { Row } from '../machine/lib/draw';
import { cap, choice, liveGroup, num, number, pick } from '../machine/lib/live';
import type { P } from '../machine/lib/live';
import { Mem } from '../machine/lib/mem';
import { traceFrames } from '../machine/lib/trace';
import type { Trace } from '../machine/lib/trace';

const liveDemo = liveGroup('cpp-stl');
const D = (title: string, text: string, code?: string): Detail => ({ title, text, code });

const VEC_VAR = D('The vector object', 'On the stack a vector is just three pointers: begin, end and end-of-capacity (24 bytes). The elements live in one heap block.', 'std::vector<int> v;\nstatic_assert(sizeof(v) == 24);\nv.size();      // end - begin\nv.capacity();  // cap - begin');
const BLOCK = D('Heap block', 'One contiguous allocation holding the elements back to back, plus spare capacity.', 'int* p = v.data();  // first element\np[2] == v[2];       // same memory');
const STR = D('std::string', '32 bytes on the stack with libstdc++: a pointer, a size, and either a capacity or a 15-char inline buffer.', 'std::string s = "hi";\nsizeof(s);   // 32\ns.size();    // 2\ns.c_str();   // null-terminated');
const ALG_V = D('The data', 'A std::vector<int>. Algorithms only see the iterator range [begin, end).');
const SV = D('std::string_view', 'A pointer plus a length into characters someone else owns. 16 bytes, never allocates, never frees.', 'void log(std::string_view msg);\nlog("literal");       // no std::string built\nlog(s);               // no copy\nlog(s.substr(0, 3));  // copy! use sv.substr');

const emplaceTrace: Trace = {
  code: ['struct P { std::string name; int age; };', 'std::vector<P> v;', 'v.reserve(2);', 'v.push_back(P{"ann", 30});  // temp, then move', 'v.emplace_back("bob", 41);  // built in place'],
  details: {
    v: VEC_VAR,
    blk: BLOCK,
    tmp: D('Temporary P', 'P{"ann", 30} is built on the stack first, then moved into the vector and destroyed.', 'v.push_back(P{"ann", 30});\n// = construct tmp, move-construct\n//   into slot, destroy tmp'),
  },
  steps: [
    { line: [0, 1, 2], note: 'Room for two P objects, none constructed yet.', vars: [['v', 'size 0 · cap 2', 'default', 'blk']], heap: [['blk', '[ _ | _ ]']], rows: [['constructions', 0]] },
    { line: 3, note: 'push_back takes a finished object: a temporary is built, moved into the slot, then destroyed.', vars: [['v', 'size 1 · cap 2', 'current', 'blk']], heap: [['tmp', 'P{ann, 30}', 'visited', 'temporary'], ['blk', '[ ann,30 | _ ]', 'write']], rows: [['constructions', 2, 'warn']] },
    { line: 4, note: 'emplace_back forwards the arguments and constructs directly in the slot, with no temporary.', vars: [['v', 'size 2 · cap 2', 'ok', 'blk']], heap: [['blk', '[ ann,30 | bob,41 ]', 'ok']], rows: [['constructions', 1, 'ok']] },
  ],
};

const sortTrace: Trace = {
  code: ['std::vector<int> v{5, 2, 8, 1, 9, 3};', 'std::sort(v.begin(), v.end());', 'std::sort(v.begin(), v.end(), std::greater{});', 'std::stable_sort(people.begin(), people.end(),', '  [](auto& a, auto& b) { return a.age < b.age; });'],
  details: { v: ALG_V, people: D('stable_sort', 'Keeps equal elements in their original order. Sort by name first, then stable_sort by age, and people of the same age stay alphabetical.', 'std::sort(p.begin(), p.end(), by_name);\nstd::stable_sort(p.begin(), p.end(), by_age);') },
  steps: [
    { line: 0, note: 'Six unsorted ints.', vars: [['v', '5 2 8 1 9 3']], rows: [['sorted', 'no']] },
    { line: 1, note: 'std::sort is introsort: quicksort that falls back to heapsort, O(n log n) worst case.', vars: [['v', '1 2 3 5 8 9', 'write']], rows: [['compares', '~n log n']] },
    { line: 2, note: 'Pass a comparator to change the order. std::greater sorts descending.', vars: [['v', '9 8 5 3 2 1', 'write']] },
    { line: [3, 4], note: 'sort may reorder equal elements. stable_sort keeps their original order.', vars: [['v', '9 8 5 3 2 1'], ['people', 'ann 30, bob 25, cy 30 → bob, ann, cy', 'ok']], rows: [['stable', 'yes', 'ok']] },
  ],
};

const foldTrace: Trace = {
  code: ['std::vector<int> v{1, 2, 3, 4};', 'std::vector<int> sq(v.size());', 'std::transform(v.begin(), v.end(), sq.begin(),', '               [](int x) { return x * x; });', 'int sum = std::accumulate(sq.begin(), sq.end(), 0);'],
  details: { sq: D('Destination range', 'transform writes through an output iterator; the destination must already have room, or use std::back_inserter.', 'std::vector<int> out;\nstd::transform(b, e, std::back_inserter(out), f);'), sum: D('accumulate', 'Folds a range with + (or any binary op) from an initial value. The init type sets the result type: 0 gives int, 0.0 gives double.', 'double avg = std::accumulate(b, e, 0.0) / n;') },
  steps: [
    { line: [0, 1], note: 'sq is pre-sized to hold the results.', vars: [['v', '1 2 3 4'], ['sq', '0 0 0 0']] },
    { line: [2, 3], note: 'transform applies the lambda to each element and writes the result.', vars: [['v', '1 2 3 4'], ['sq', '1 4 9 16', 'write']] },
    { line: 4, note: 'accumulate folds them with + starting from 0.', vars: [['v', '1 2 3 4'], ['sq', '1 4 9 16'], ['sum', '30', 'ok']], rows: [['loops written', 0, 'ok']] },
    { line: 4, note: 'Named algorithms say what the loop does. With std::execution::par some run in parallel too.', vars: [['sum', '30', 'ok']], rows: [['parallel', 'reduce, transform']] },
  ],
};

const viewTrace: Trace = {
  code: ['std::string s = "GET /index.html HTTP/1.1";', 'std::string_view sv = s;', 'auto path = sv.substr(4, 11);', 'std::cout << path;'],
  details: { s: STR, sv: SV, path: SV, buf: D('The owner’s buffer', 's owns these characters. Both views just point into it.') },
  steps: [
    { line: 0, note: 's owns a heap buffer with the request line.', vars: [['s', 'owner', 'current', 'buf']], heap: [['buf', 'GET /index.html HTTP/1.1', 'write']], out: '' },
    { line: 1, note: 'sv is just a pointer and a length into s’s buffer. No copy.', vars: [['s', 'owner', 'default', 'buf'], ['sv', 'ptr + len 24', 'current', 'buf']], heap: [['buf', 'GET /index.html HTTP/1.1']], out: '', rows: [['allocations', 0, 'ok']] },
    { line: 2, note: 'substr on a view returns another view: parsing without allocating.', vars: [['s', 'owner', 'default', 'buf'], ['sv', 'ptr + len 24', 'default', 'buf'], ['path', 'ptr+4 · len 11', 'write', 'buf']], heap: [['buf', 'GET [/index.html] HTTP/1.1']], out: '', rows: [['allocations', 0, 'ok']] },
    { line: 3, note: 'Take string_view parameters for read-only text. Views are great for parsers.', vars: [['path', 'ptr+4 · len 11', 'ok', 'buf']], heap: [['buf', 'GET [/index.html] HTTP/1.1']], out: '/index.html' },
  ],
};

const spanTrace: Trace = {
  code: ['int sum(std::span<const int> xs) {', '  int t = 0; for (int x : xs) t += x; return t;', '}', 'std::vector<int> v{1, 2, 3}; int a[] = {4, 5};', 'sum(v) + sum(a) + sum({v.data() + 1, 2});'],
  details: { xs: D('std::span', 'A pointer plus a count over contiguous elements. One function accepts vectors, arrays and C arrays without templates or copies.', 'void fill(std::span<int> out);\nfill(vec);\nfill(arr);\nfill({p, n});'), vb: D('vector’s buffer', 'Owned by v; the span only borrows it.') },
  steps: [
    { line: 3, note: 'Two different containers of ints.', vars: [['v', 'vector', 'default', 'vb'], ['a', '{4, 5} (stack)']], heap: [['vb', '1 2 3']], out: '' },
    { line: [0, 4], note: 'sum(v) sees a span over v’s buffer: pointer and length, no copy.', vars: [['v', 'vector', 'default', 'vb'], ['xs', 'ptr + 3', 'current', 'vb']], heap: [['vb', '1 2 3', 'read']], out: '', rows: [['copies', 0, 'ok']] },
    { line: 4, note: 'The same function takes a C array or any slice of contiguous memory.', vars: [['xs', 'ptr + 2 (a)', 'current']], heap: [['vb', '1 2 3']], out: '' },
    { line: 4, note: 'span replaces the old (int* p, size_t n) pair. Like string_view, it must not outlive the data.', vars: [['xs', 'ptr+1 · 2 (v)', 'current', 'vb']], heap: [['vb', '1 [2 3]', 'read']], out: '20', rows: [['result', 20, 'ok']] },
  ],
};

/** a row of slots; `vals[i]` undefined = empty capacity */
function slots(prefix: string, vals: (string | number | undefined)[], x: number, y: number, w: number, o: { tone?: (i: number) => Tone | undefined; dead?: boolean; h?: number; idx?: boolean } = {}): Shape[] {
  const cw = w / Math.max(1, vals.length);
  const h = o.h ?? Math.min(90, cw);
  const out: Shape[] = [];
  vals.forEach((v, i) => {
    const t = o.tone?.(i) ?? (v === undefined ? 'muted' : 'default');
    out.push(box(`${prefix}${i}`, x + i * cw + 2, y, cw - 4, h, v === undefined ? '' : String(v), { mono: true, tone: o.dead ? 'visited' : t, dashed: o.dead || v === undefined, filled: v !== undefined && !o.dead }));
    if (o.idx) out.push(text(`${prefix}i${i}`, x + i * cw + cw / 2, y + h + 22, String(i), { size: 20, mono: true, tone: 'muted' }));
  });
  return out;
}

// ---------------- vector: growth and invalidation, insert/erase cost ----------------
function capacity(p: P): Frame[] {
  const res = num(p.reserve, 0, 0, 8);
  const n = num(p.n, 5, 1, 9);
  const f = new Film();
  let capN = res;
  let vals: number[] = [];
  let reallocs = 0;
  let moves = 0;
  let pAlive: boolean | undefined;
  const W = 920;
  const scene = (stmt: string, o: { old?: number[]; oldCap?: number; hot?: number } = {}): Shape[] => {
    const cells = [...vals, ...Array(Math.max(0, capN - vals.length)).fill(undefined)];
    const out: Shape[] = [...cap(stmt), text('vt', 40, 130, `v · size ${vals.length} · capacity ${capN}`, { align: 'left', size: 26, bold: true, tone: 'muted' })];
    const w = Math.min(W, Math.max(1, capN) * 100);
    if (capN) out.push(...slots('c', cells, 40, 160, w, { tone: (i) => (i === o.hot ? 'write' : i < vals.length ? 'accent' : undefined) }));
    else out.push(text('none', 40, 205, 'no heap block yet', { align: 'left', size: 26, tone: 'muted' }));
    if (o.old) {
      const ow = Math.min(W, o.oldCap! * 100);
      out.push(text('ot', 40, 330, 'old block · freed', { align: 'left', size: 24, bold: true, tone: 'fail' }), ...slots('o', [...o.old, ...Array(o.oldCap! - o.old.length).fill(undefined)], 40, 350, ow, { dead: true }));
      o.old.forEach((_, i) => out.push(arrow(`mv${i}`, 40 + (i + 0.5) * (ow / o.oldCap!), 350, 40 + (i + 0.5) * (w / capN), 254, 'warn', { width: 3 })));
    }
    if (pAlive !== undefined) {
      const cw = w / Math.max(1, capN);
      out.push(box('p', 40, 560, 300, 80, pAlive ? 'p = &v[0]' : 'p dangles', { mono: true, tone: pAlive ? 'accent' : 'fail' }));
      if (pAlive) out.push(arrow('pa', 190, 560, 40 + cw / 2, 254, 'accent', { width: 4 }));
      else if (o.old) out.push(arrow('pa', 190, 560, 40 + Math.min(W, o.oldCap! * 100) / o.oldCap! / 2, 444, 'fail', { dashed: true, width: 4 }));
      else out.push(box('ghost', 400, 570, 260, 60, 'freed memory', { tone: 'fail', dashed: true, filled: false }), arrow('pa', 340, 600, 396, 600, 'fail', { dashed: true, width: 4 }));
    }
    return out;
  };
  const rows = (): Row[] => [['size', vals.length], ['capacity', capN], ['reallocations', reallocs, reallocs ? 'warn' : 'ok'], ['elements moved', moves, moves ? 'warn' : 'ok']];
  f.add(res ? `reserve(${res}) allocates room for ${res} ints up front. size is still 0: room is not elements.` : 'An empty vector owns no heap memory: just three pointers (begin, end, end of capacity).', scene(res ? `v.reserve(${res});` : 'std::vector<int> v;'), panel('vector', rows()));
  for (let k = 1; k <= n; k++) {
    const x = k * 10;
    if (vals.length === capN) {
      const old = vals;
      const oldCap = capN;
      capN = Math.max(1, capN * 2);
      vals = [...old, x];
      reallocs++;
      moves += old.length;
      if (old.length) {
        if (pAlive) pAlive = false;
        f.add(`Full: push_back allocates a block twice the size (${capN}), moves the ${old.length} element${old.length > 1 ? 's' : ''} across and frees the old block.${pAlive === false ? ' p still points into the freed block.' : ''}`, scene(`v.push_back(${x});`, { old, oldCap, hot: vals.length - 1 }), panel('vector', [...rows(), ...(pAlive === false ? [['p', 'dangling', 'fail'] as Row] : [])]));
      } else f.add(`The first push_back allocates a 1-slot block and constructs ${x} in it.`, scene(`v.push_back(${x});`, { hot: 0 }), panel('vector', rows()));
    } else {
      vals = [...vals, x];
      f.add(`There is spare capacity, so ${x} is constructed in the next slot. Nothing moves.`, scene(`v.push_back(${x});`, { hot: vals.length - 1 }), panel('vector', rows()));
    }
    if (k === 1 && pAlive === undefined) {
      pAlive = true;
      f.add('Take a pointer to the first element. It is valid only as long as the block does not move.', scene('int* p = &v[0];'), panel('vector', [...rows(), ['p', 'valid', 'ok']]));
    }
  }
  f.add(reallocs > 1 ? `${reallocs} reallocations moved ${moves} elements. reserve(${n}) up front would allocate once and move nothing, and keep p valid.` : `Only ${reallocs} allocation${reallocs === 1 ? '' : 's'} for ${n} push_backs: the capacity was there when it was needed.`, scene(`v.size() == ${vals.length}, v.capacity() == ${capN}`), panel('vector', [...rows(), ['p', pAlive ? 'valid' : 'dangling', pAlive ? 'ok' : 'fail']]));
  return f.frames;
}

const WHERE = ['front', 'middle', 'back'];

function insertErase(p: P): Frame[] {
  const where = pick(p.at, WHERE, 'front');
  const base = [1, 2, 3, 4, 5, 6];
  const capN = 8;
  const i = where === 'front' ? 0 : where === 'middle' ? 3 : base.length;
  const f = new Film();
  const row = (vals: number[], hot: number | undefined, moved: number[], dir = 0): Shape[] => {
    const out = slots('c', [...vals, ...Array(capN - vals.length).fill(undefined)], 40, 200, 920, { idx: true, tone: (k) => (k === hot ? 'write' : moved.includes(k) ? 'warn' : undefined) });
    const cw = 920 / capN;
    moved.forEach((k) => out.push(arrow(`sh${k}`, 40 + (k - dir + 0.5) * cw, 330, 40 + (k + 0.5) * cw, 330, 'warn', { width: 4 })));
    return out;
  };
  f.add('Six ints, contiguous, with room for eight. Every element sits right after the previous one: there are no gaps to use.', [...cap('std::vector<int> v{1, 2, 3, 4, 5, 6};'), ...row(base, undefined, [])], panel('vector', [['size', 6], ['capacity', 8]]));
  const ins = [...base.slice(0, i), 0, ...base.slice(i)];
  const shifted = base.length - i;
  f.add(shifted ? `Inserting at index ${i} first shifts the ${shifted} element${shifted > 1 ? 's' : ''} after it one slot right, then writes 0 in the gap: O(n).` : 'Inserting at the end shifts nothing: 0 goes straight into the next free slot.', [...cap(`v.insert(v.begin() + ${i}, 0);`), ...row(ins, i, [...Array(shifted).keys()].map((k) => i + 1 + k), 1)], panel('vector', [['moved', shifted, shifted ? 'warn' : 'ok'], ['size', 7]]));
  f.add(`Now erase it again. Erasing at index ${i} shifts the ${shifted} element${shifted === 1 ? '' : 's'} after it one slot left${shifted ? '' : ': none'}.`, [...cap(`v.erase(v.begin() + ${i});`), ...row(base, undefined, [...Array(shifted).keys()].map((k) => i + k), -1)], panel('vector', [['moved', shifted, shifted ? 'warn' : 'ok'], ['size', 6]]));
  f.add(where === 'back' ? 'Work at the back is O(1): push_back and pop_back move nothing.' : `The cost is the number of elements after the position: ${shifted} here, a million in a big vector. For a cheap front, use std::deque.`, [...cap(where === 'back' ? 'v.push_back(x); v.pop_back();' : 'std::deque<int> d;  d.push_front(0);'), ...row(base, undefined, [])], panel('vector', [['insert/erase at', where], ['cost', where === 'back' ? 'O(1)' : 'O(n)', where === 'back' ? 'ok' : 'warn']]));
  return f.frames;
}

liveDemo(
  'stl-vector',
  'vector in depth',
  'push_back filling a block and doubling it (with a pointer that dangles when the block moves), reserve, insert and erase shifting everything after them, and emplace_back.',
  {
    capacity: ['size & capacity', capacity],
    insert: ['insert & erase cost', insertErase],
    emplace: ['emplace_back', () => traceFrames(emplaceTrace)],
  },
  [number('reserve', 'reserve', 0, 8, 0, { for: ['capacity'] }), number('n', 'push_backs', 1, 9, 5, { for: ['capacity'] }), choice('at', 'insert at', WHERE, 'front', { for: ['insert'] })],
  { c0: BLOCK, p: D('Iterator invalidation', 'A pointer, reference or iterator into a vector dies when the vector reallocates.', 'int* p = &v[0];\nv.push_back(x);   // may reallocate\n*p;               // undefined behaviour') },
);

// ---------------- string: SSO, copy vs move, append ----------------
const ALPHA = 'abcdefghijklmnopqrstuvwxyz0123456789ABCD';

function sso(p: P): Frame[] {
  const len = num(p.len, 5, 1, 40);
  const s = ALPHA.slice(0, len);
  const inline = len <= 15;
  const f = new Film();
  const obj = (o: { heap: boolean; copy?: boolean }): Shape[] => {
    const out: Shape[] = [box('obj', 20, 110, 960, inline ? 300 : 160, undefined, { tone: 'muted', filled: false }), text('ot', 40, 138, 'std::string s · 32 bytes on the stack', { align: 'left', size: 24, bold: true, tone: 'muted' })];
    out.push(box('ptr', 40, 160, 300, 90, 'ptr', { sub: inline ? '→ own buffer' : '→ heap', mono: true, tone: 'accent' }), box('size', 360, 160, 250, 90, 'size', { sub: String(len), mono: true }));
    if (inline) {
      out.push(box('capf', 630, 160, 330, 90, '16 bytes', { sub: 'used as a buffer ↓', mono: true, tone: 'ok' }));
      out.push(...slots('in', [...s, '\\0', ...Array(15 - len).fill(undefined)], 40, 290, 920, { h: 90, tone: (i) => (i < len ? 'ok' : i === len ? 'muted' : undefined) }));
      out.push(arrow('self', 190, 252, 70, 286, 'accent', { width: 4 }));
    } else {
      out.push(box('capf', 630, 160, 330, 90, '16 bytes', { sub: `capacity ${len}`, mono: true, tone: 'muted' }));
      out.push(text('ht', 40, 380, `heap block · ${len + 1} bytes`, { align: 'left', size: 24, bold: true, tone: 'warn' }));
      out.push(...slots('h', [...s, '\\0'], 40, 400, 920, { h: 70, tone: (i) => (i < len ? 'warn' : 'muted') }));
      out.push(arrow('hp', 190, 252, 190, 398, 'accent', { width: 4 }));
    }
    if (o.copy) out.push(box('cp', 40, 640, 920, 90, inline ? 'copy: 32 bytes, no allocation' : `copy: a new ${len + 1}-byte heap block`, { mono: true, tone: inline ? 'ok' : 'warn' }));
    return out;
  };
  f.add(`The object always has the same 32 bytes: a pointer, a size, and 16 bytes that are either a capacity or a tiny buffer. "${s}" is ${len} char${len > 1 ? 's' : ''}.`, [...cap(`std::string s = "${len > 20 ? s.slice(0, 18) + '…' : s}";`), ...obj({ heap: !inline })], panel('std::string', [['length', len], ['inline limit', 15]]));
  f.add(inline ? `${len} ≤ 15, so the characters fit in the object’s own buffer and ptr points at it. No heap allocation at all.` : `${len} > 15 does not fit inside, so the string allocates a heap block and ptr points there. The 16 bytes now hold the capacity.`, [...cap(inline ? '// small string optimisation' : 'operator new(' + (len + 1) + ')'), ...obj({ heap: !inline })], panel('std::string', [['allocations', inline ? 0 : 1, inline ? 'ok' : 'warn'], ['where', inline ? 'inside the object' : 'heap']]));
  f.add(inline ? 'Copying a short string copies 32 bytes and allocates nothing. Most real strings (names, keys, words) are short.' : 'Copying a long string allocates again and copies every character. Pass const std::string& or std::string_view to avoid it.', [...cap('auto t = s;'), ...obj({ heap: !inline, copy: true })], panel('std::string', [['copy cost', inline ? '32 B, no malloc' : `malloc + ${len + 1} B`, inline ? 'ok' : 'warn']]));
  return f.frames;
}

const SD: Record<string, Detail> = {
  s: STR,
  b1: D('s’s buffer', '40 chars on the heap.'),
  b2: D('t’s buffer', 'A copy allocates its own buffer and copies every char.', 'std::string t = s;  // malloc + memcpy'),
};

function copyMove(p: P): Frame[] {
  const mv = pick(p.how, ['copy', 'move'], 'copy') === 'move';
  const m = new Mem({ panel: mv ? 'Move' : 'Copy', details: SD, out: true });
  m.region('stk', 'main() · stack').region('heap', 'heap');
  m.v('b1', 'heap', 0, 'chars', '0x900', 'x…x (40)').v('s', 'stk', 0, 's', '0x10', '0x900', { to: 'b1' });
  m.snap('s owns a 40-char heap buffer (too long for the inline buffer).', "std::string s(40, 'x');", { out: '', rows: [['allocations', 1]] });
  if (mv) {
    m.v('t', 'stk', 1, 't', '0x30', '0x900', { to: 'b1' });
    m.snap('std::move(s) lets t steal s’s pointer. No allocation, no characters copied.', 'std::string t = std::move(s);', { fly: ['s', 't'], hot: { t: 'ok' }, out: '', rows: [['allocations', 1, 'ok'], ['copied', '32 B (the object)', 'ok']] });
    m.set('s', '""', null).snap('s is left valid but empty. Assign to it or let it die; do not rely on its value.', 'std::cout << s.size();', { finger: 's', hot: { s: 'visited' }, out: '0', rows: [['s.size()', 0, 'muted']] });
  } else {
    m.v('b2', 'heap', 1, 'chars', '0x980', 'x…x (40)').v('t', 'stk', 1, 't', '0x30', '0x980', { to: 'b2' });
    m.snap('Copying allocates a second buffer and copies all 40 chars. Two independent strings.', 'std::string t = s;', { fly: ['b1', 'b2'], hot: { b2: 'warn' }, out: '', rows: [['allocations', 2, 'warn'], ['copied', '40 chars', 'warn']] });
    m.snap('s is untouched. If s is not used again, the copy was waste: std::move(s) would hand the buffer over instead.', 'std::cout << s.size();', { finger: 's', out: '40', rows: [['s.size()', 40], ['better', 'std::move(s)', 'ok']] });
  }
  return m.frames();
}

function append(p: P): Frame[] {
  const res = pick(p.reserve, ['no', 'yes'], 'no') === 'yes';
  const total = 290;
  const caps: number[] = [];
  let c = res ? 1000 : 15;
  if (!res) {
    caps.push(c);
    while (c < total) caps.push((c *= 2));
  } else caps.push(15, 1000);
  const f = new Film();
  const maxC = Math.max(...caps);
  const bars = (upto: number, used: number): Shape[] => {
    const out: Shape[] = [text('bt', 40, 130, 'every buffer the string has had', { align: 'left', size: 24, bold: true, tone: 'muted' })];
    caps.slice(0, upto + 1).forEach((cv, k) => {
      const w = Math.max(30, (880 * cv) / maxC);
      const live = k === upto;
      out.push(box(`b${k}`, 40, 160 + k * 90, w, 70, `cap ${cv}`, { mono: true, tone: live ? 'accent' : 'visited', dashed: !live }));
      if (live) out.push(box('used', 40, 160 + k * 90, Math.max(8, (880 * Math.min(used, cv)) / maxC), 70, undefined, { tone: 'ok', filled: true }));
    });
    return out;
  };
  const rows = (k: number, used: number): Row[] => [['length', used], ['capacity', caps[k]], ['allocations', res ? Math.min(k, 1) : k, k > 1 ? 'warn' : 'ok'], ['chars copied', res ? 0 : caps.slice(0, k).reduce((a, b, i) => a + (i ? Math.min(b, total) : 0), 0), res || k < 2 ? 'ok' : 'warn']];
  f.add('An empty string starts with its 15-char inline buffer.', [...cap('std::string out;'), ...bars(0, 0)], panel('append', rows(0, 0)));
  if (res) {
    f.add('reserve(1000) allocates once, up front.', [...cap('out.reserve(1000);'), ...bars(1, 0)], panel('append', rows(1, 0)));
    f.add('All 100 appends land in the reserved buffer: 290 chars, no reallocation, nothing copied twice.', [...cap('for (i < 100) out += std::to_string(i) + ",";'), ...bars(1, total)], panel('append', rows(1, total)));
  } else {
    for (let k = 1; k < caps.length; k++) {
      f.add(`At ${caps[k - 1]} chars the buffer is full: allocate ${caps[k]}, copy the ${caps[k - 1]} chars across, free the old one.`, [...cap('out += std::to_string(i) + ",";'), ...bars(k, caps[k - 1])], panel('append', rows(k, caps[k - 1])));
    }
    f.add(`Done at 290 chars after ${caps.length - 1} reallocations. Doubling keeps it amortised O(1), but reserve when you know the size.`, [...cap('out.size() == 290'), ...bars(caps.length - 1, total)], panel('append', rows(caps.length - 1, total)));
  }
  return f.frames;
}

liveDemo(
  'stl-string',
  'std::string & SSO',
  'The 32-byte string object with a length knob: short strings live inside it, long ones on the heap. Copy vs move as boxes and buffers, and append regrowing without reserve.',
  {
    sso: ['Short vs long', sso],
    copy: ['Copy vs move', copyMove],
    append: ['Building strings', append],
  },
  [number('len', 'length', 1, 40, 5, { for: ['sso'] }), choice('how', 'std::string t =', ['copy', 'move'], 'copy', { for: ['copy'], labels: ['s', 'std::move(s)'] }), choice('reserve', 'reserve(1000)', ['no', 'yes'], 'no', { for: ['append'] })],
  { ptr: STR, size: STR },
);

// ---------------- algorithms: binary search, erase-remove ----------------
const SORTED = [1, 3, 5, 7, 9, 11, 13];

function search(p: P): Frame[] {
  const x = num(p.target, 8, 0, 14);
  const f = new Film();
  let lo = 0;
  let hi = SORTED.length;
  let step = 0;
  const scene = (mid?: number, done?: boolean): Shape[] => {
    const cw = 920 / SORTED.length;
    const out: Shape[] = [...cap(`std::lower_bound(v.begin(), v.end(), ${x});`)];
    out.push(...slots('v', SORTED, 40, 220, 920, { idx: true, tone: (i) => (done && i === lo ? 'ok' : i === mid ? 'current' : i >= lo && i < hi ? 'accent' : 'visited') }));
    out.push(box('rng', 40 + lo * cw, 200, Math.max(cw * (hi - lo), 6), 130, undefined, { tone: done ? 'ok' : 'accent', filled: false, dashed: hi === lo }));
    out.push(text('rt', 40 + lo * cw + 4, 186, hi > lo ? `[${lo}, ${hi})` : `→ ${lo}`, { align: 'left', size: 22, mono: true, tone: done ? 'ok' : 'accent' }));
    if (mid !== undefined) out.push(arrow('mid', 40 + (mid + 0.5) * cw, 420, 40 + (mid + 0.5) * cw, 336, 'current', { width: 4 }), text('mt', 40 + (mid + 0.5) * cw, 450, 'mid', { size: 22, tone: 'current' }));
    return out;
  };
  f.add(`Find where ${x} belongs in a sorted vector. The candidate range starts as the whole thing: [0, ${hi}).`, scene(), panel('lower_bound', [['x', x], ['range', `[${lo}, ${hi})`]]));
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    step++;
    const less = SORTED[mid] < x;
    f.add(`Middle is v[${mid}] = ${SORTED[mid]}. ${less ? `${SORTED[mid]} < ${x}, so the answer is to its right.` : `${SORTED[mid]} ≥ ${x}, so the answer is here or to its left.`}`, scene(mid), panel('lower_bound', [['step', step], ['v[mid]', SORTED[mid]], ['keep', less ? 'right half' : 'left half']]));
    if (less) lo = mid + 1;
    else hi = mid;
  }
  const found = lo < SORTED.length && SORTED[lo] === x;
  f.add(lo === SORTED.length ? `The range is empty at the end: every element is less than ${x}, so lower_bound returns end().` : found ? `The range closed on index ${lo}, and v[${lo}] == ${x}: found in ${step} steps.` : `The range closed on index ${lo}: ${x} is not present, but this is where it would be inserted (before ${SORTED[lo]}).`, scene(undefined, true), panel('lower_bound', [['steps', step, 'ok'], ['index', lo], ['found', found ? 'yes' : 'no', found ? 'ok' : 'warn'], ['1M elements', '≈ 20 steps']]));
  return f.frames;
}

function eraseRemove(p: P): Frame[] {
  const x = num(p.rm, 0, 0, 3);
  const v = [1, 0, 2, 0, 3, 0];
  const f = new Film();
  const a = [...v];
  let w = 0;
  const scene = (stmt: string, o: { r?: number; end?: number; size?: number; hot?: number } = {}): Shape[] => {
    const size = o.size ?? a.length;
    const cw = 920 / v.length;
    const out: Shape[] = [...cap(stmt), ...slots('v', a.map((e, i) => (i < size ? e : undefined)), 40, 220, 920, { idx: true, tone: (i) => (i === o.hot ? 'write' : o.end !== undefined && i >= o.end && i < size ? 'warn' : i < (o.end ?? (o.r !== undefined ? w : 0)) ? 'ok' : undefined) })];
    if (o.r !== undefined) out.push(arrow('r', 40 + (o.r + 0.5) * cw, 430, 40 + (o.r + 0.5) * cw, 336, 'current', { width: 4 }), text('rt', 40 + (o.r + 0.5) * cw, 460, 'read', { size: 22, tone: 'current' }));
    const wi = o.end ?? (o.r !== undefined ? w : undefined);
    if (wi !== undefined && wi <= v.length) out.push(arrow('w', 40 + wi * cw + 4, 150, 40 + wi * cw + 4, 214, 'accent', { width: 4 }), text('wt', 40 + wi * cw + 8, 140, o.end !== undefined ? 'end' : 'write', { align: 'left', size: 22, tone: 'accent' }));
    out.push(text('sz', 40, 540, `size() = ${size}`, { align: 'left', size: 30, mono: true, bold: true, tone: o.size !== undefined && o.size < v.length ? 'ok' : 'default' }));
    return out;
  };
  f.add(`Remove every ${x}. std::remove only has iterators, so it cannot shrink the vector: it can only move elements.`, scene('std::vector<int> v{1, 0, 2, 0, 3, 0};'), panel('erase-remove', [['remove', x], ['size', v.length]]));
  for (let r = 0; r < v.length; r++) {
    const keep = v[r] !== x;
    if (keep) a[w] = v[r];
    f.add(keep ? `v[${r}] = ${v[r]} is kept: copied to the write position ${w}${w === r ? ' (itself)' : ''}.` : `v[${r}] is ${x}: skipped. The write position stays at ${w}.`, scene('std::remove(v.begin(), v.end(), ' + x + ')', { r, hot: keep ? w : undefined }), panel('erase-remove', [['read', r], ['write', keep ? w + 1 : w], ['kept', keep ? w + 1 : w]]));
    if (keep) w++;
  }
  const removed = v.length - w;
  f.add(removed ? `remove returns the new logical end, index ${w}. The ${removed} slot${removed > 1 ? 's' : ''} after it hold leftovers, and size() is still ${v.length}.` : `Nothing equal to ${x}, so remove kept everything and returns end().`, scene(`auto end = std::remove(v.begin(), v.end(), ${x});`, { end: w }), panel('erase-remove', [['size', v.length, removed ? 'warn' : 'ok'], ['leftovers', removed, removed ? 'warn' : 'ok']]));
  f.add(`erase(end, v.end()) actually shrinks the vector to ${w}. Forgetting it is the classic bug; C++20 std::erase(v, ${x}) does both.`, scene('v.erase(end, v.end());', { end: w, size: w }), panel('erase-remove', [['size', w, 'ok'], ['passes', 1, 'ok']]));
  return f.frames;
}

liveDemo(
  'stl-algorithms',
  'Algorithms',
  'sort and stable_sort, lower_bound halving a range for any target you pick, erase-remove with read and write positions, and transform and accumulate.',
  {
    sort: ['sort & stable_sort', () => traceFrames(sortTrace)],
    search: ['Binary search', search],
    eraseRemove: ['erase-remove', eraseRemove],
    fold: ['transform & accumulate', () => traceFrames(foldTrace)],
  },
  [number('target', 'value', 0, 14, 8, { for: ['search'] }), number('rm', 'remove', 0, 3, 0, { for: ['eraseRemove'] })],
  { v0: ALG_V, rng: D('lower_bound', 'Returns the first position where the value could be inserted without breaking the order: the first element not less than it.', 'auto it = std::lower_bound(b, e, x);\nbool found = it != e && *it == x;') },
);

// ---------------- views: dangling string_view ----------------
function dangling(p: P): Frame[] {
  const owned = pick(p.ret, ['view', 'string'], 'view') === 'string';
  const m = new Mem({ panel: 'string_view', details: { s: STR, sv: SV }, out: true });
  m.region('main', 'main() · stack').region('fn', 'name() · frame').region('heap', 'heap');
  m.v('buf', 'heap', 0, 'chars', '0x900', '"temporary"').v('s', 'fn', 0, 's', '0x7c0', '0x900', { to: 'buf' });
  m.snap('Inside name(), s owns its characters on the heap.', '  std::string s = "temporary";', { out: '' });
  if (owned) {
    m.v('sv', 'main', 0, 'r (std::string)', '0x10', '0x900', { to: 'buf' }).set('s', '""', null);
    m.snap('Returning std::string moves s’s buffer out to the caller. The caller now owns it.', '  return s;   // std::string', { fly: ['s', 'sv'], out: '', rows: [['owner', 'caller', 'ok']] });
    m.kill('fn', 'name() returned');
    m.snap('name()’s frame is gone, and nothing is lost: the buffer belongs to r.', '}', { finger: 'sv', out: '', rows: [['buffer', 'alive', 'ok']] });
    m.snap('Printing reads live memory. Return owning types; take views only as parameters.', 'std::cout << r;', { finger: 'buf', hot: { buf: 'ok' }, out: 'temporary', rows: [['result', 'correct', 'ok']] });
  } else {
    m.v('sv', 'main', 0, 'r (string_view)', '0x10', '0x900', { to: 'buf' });
    m.snap('Returning a string_view copies just a pointer and a length into s’s buffer.', '  return s;   // std::string_view', { fly: ['s', 'sv'], out: '', rows: [['copied', '16 B', 'ok']] });
    m.free('buf').kill('fn', 'name() returned · s destroyed');
    m.snap('At the brace s is destroyed and frees its buffer. r still points there: it dangles.', '}', { finger: 'sv', hot: { sv: 'fail' }, out: '', rows: [['owner', 'dead', 'fail']] });
    m.snap('Printing reads freed memory: garbage, a crash, or worse. Never return a view of a local.', 'std::cout << r;', { finger: 'buf', hot: { buf: 'fail' }, out: '�emp�r…', rows: [['bug', 'use-after-free', 'fail']] });
  }
  return m.frames();
}

liveDemo(
  'stl-views',
  'string_view & span',
  'Non-owning views: a pointer and a length into someone else’s buffer, what happens when the owner dies first, and std::span.',
  {
    view: ['string_view', () => traceFrames(viewTrace)],
    dangling: ['Dangling view', dangling],
    span: ['std::span', () => traceFrames(spanTrace)],
  },
  [choice('ret', 'name() returns', ['view', 'string'], 'view', { for: ['dangling'], labels: ['string_view', 'std::string'] })],
);
