// Go escape analysis and growable stacks as memory pictures (group lang-go).
import type { Detail, Frame, Shape } from '../algo/frames';
import { box, Film, panel, text } from '../machine/lib/draw';
import { cap, choice, liveGroup, num, number, pick } from '../machine/lib/live';
import type { P } from '../machine/lib/live';
import { Mem } from '../machine/lib/mem';

const liveDemo = liveGroup('lang-go');
const D = (title: string, text: string, code?: string): Detail => ({ title, text, code });

const ED: Record<string, Detail> = {
  s: D('Local on the stack', 'The compiler proved s does not outlive add, so it lives in the frame and costs the GC nothing.', '$ go build -gcflags=-m\n./main.go:2: s does not escape'),
  u: D('Escaped value', 'Something that outlives the function (a returned pointer, an interface value) forces the compiler to allocate u on the heap. Legal in Go, unlike C.', '$ go build -gcflags=-m\n./main.go:3: moved to heap: u'),
  p: D('Pointer', 'p holds the heap address. When no pointer reaches the object any more, the GC frees it.'),
};

function stack(p: P): Frame[] {
  const ptr = pick(p.ret, ['int', 'ptr'], 'int') === 'ptr';
  const m = new Mem({ panel: 'Escape analysis', details: ED, out: true });
  m.region('main', 'main() · goroutine stack').region('fn', 'add(a, b) · frame').region('heap', 'heap (GC-managed)');
  m.v('x', 'main', 0, ptr ? 'x *int' : 'x int', '0xc0', '?');
  m.snap(`main calls add. x will live in main’s frame.`, ptr ? 'x := add(2, 3)   // func add(a, b int) *int' : 'x := add(2, 3)   // func add(a, b int) int', { out: '' });
  m.v('a', 'fn', 0, 'a', '0xa0', '2').v('b', 'fn', 1, 'b', '0xa8', '3');
  if (ptr) {
    m.v('s', 'heap', 2, 's (moved to heap)', '0xc000012', '5');
    m.snap('add returns &s, so s must outlive add. Escape analysis allocates it on the heap instead of in the frame.', '  s := a + b;  return &s', { finger: 's', hot: { s: 'warn' }, out: '', rows: [['allocations', 1, 'warn'], ['-gcflags=-m', 'moved to heap: s']] });
    m.kill('fn', 'add() returned').set('x', '0xc000012', 's');
    m.snap('The frame is popped but s survives on the heap; x points at it. The GC now has an object to track.', 'x := add(2, 3)', { finger: 'x', out: '', rows: [['GC objects', 1, 'warn']] });
    m.snap('*x prints 5, correct but at the cost of an allocation. Return values, not pointers, for small results.', 'fmt.Println(*x)', { finger: 's', out: '5', rows: [['cost', 'malloc + GC', 'warn']] });
  } else {
    m.v('s', 'fn', 2, 's', '0xb0', '5');
    m.snap('add gets its own frame holding a, b and s. s never leaves add, so no heap allocation at all.', '  s := a + b', { finger: 's', hot: { s: 'ok' }, out: '', rows: [['allocations', 0, 'ok'], ['-gcflags=-m', 's does not escape']] });
    m.kill('fn', 'add() returned').set('x', '5');
    m.snap('return s copies 5 into x and the frame is simply popped. Nothing for the GC to track.', 'x := add(2, 3)', { finger: 'x', fly: ['s', 'x'], out: '', rows: [['GC objects', 0, 'ok']] });
    m.snap('Stack values are free to allocate and free to discard.', 'fmt.Println(x)', { finger: 'x', out: '5', rows: [['cost', 'none', 'ok']] });
  }
  return m.frames();
}

const HOW = ['ptr', 'value', 'iface'];

function escape(p: P): Frame[] {
  const how = pick(p.how, HOW, 'ptr');
  const esc = how !== 'value';
  const stmt = how === 'ptr' ? '  return &u          // *User' : how === 'value' ? '  return u           // User (a copy)' : '  fmt.Println(u); return u.Name';
  const m = new Mem({ panel: 'Escape analysis', details: ED, out: true });
  m.region('main', 'main() · goroutine stack').region('fn', 'newUser(n) · frame').region('heap', 'heap (GC-managed)');
  m.snap('newUser builds a User. Where u lives depends on whether anything can still reach it after newUser returns.', 'u := User{Name: n}', { out: '' });
  if (esc) {
    m.v('u', 'heap', 1, 'u (moved to heap)', '0xc000010', 'User{ana}');
    m.snap(how === 'ptr' ? 'Returning &u means u must outlive the frame. In C this is a bug; Go’s compiler moves u to the heap instead.' : 'Passing u to fmt.Println converts it to an interface (any). The compiler cannot see where that goes, so u escapes too.', stmt, { finger: 'u', hot: { u: 'warn' }, out: '', rows: [['-gcflags=-m', 'moved to heap: u', 'warn']] });
  } else {
    m.v('u', 'fn', 0, 'u', '0xa0', 'User{ana}');
    m.snap('Returning u by value copies the struct out. Nothing refers to the frame’s u afterwards, so it stays on the stack.', stmt, { finger: 'u', hot: { u: 'ok' }, out: '', rows: [['-gcflags=-m', 'u does not escape', 'ok']] });
  }
  m.kill('fn', 'newUser() returned');
  if (how === 'ptr') m.v('p', 'main', 0, 'p *User', '0xc0', '0xc000010', { to: 'u' });
  else m.v('p', 'main', 0, how === 'value' ? 'p User' : 'name string', '0xc0', how === 'value' ? 'User{ana}' : '"ana"');
  m.snap(how === 'ptr' ? 'main’s p points to the heap object after newUser’s frame is gone. The GC frees it when p is gone too.' : how === 'value' ? 'main’s p holds its own copy. The frame was popped with zero heap allocations.' : 'The frame is gone but u’s heap copy remains until the GC finds it unreachable: an allocation just to print.', 'p := newUser("ana")', { finger: 'p', fly: how === 'value' ? ['u', 'p'] : undefined, out: how === 'iface' ? '{ana}' : '', rows: [['heap allocations', esc ? 1 : 0, esc ? 'warn' : 'ok']] });
  m.snap('Fewer escapes mean less GC work. Check hot paths with go build -gcflags=-m.', 'fmt.Println(p.Name)', { finger: esc ? 'u' : 'p', out: how === 'iface' ? '{ana}\nana' : 'ana', rows: [['escapes', esc ? 'yes' : 'no', esc ? 'warn' : 'ok']] });
  return m.frames();
}

function growth(p: P): Frame[] {
  const depth = num(p.n, 10, 1, 14);
  const FRAME = 560;
  const f = new Film();
  let size = 2048;
  let copies = 0;
  let maxSize = 2048;
  while (maxSize < Math.min(depth + 1, 15) * FRAME) maxSize *= 2;
  const scene = (frames: number, stmt: string, o: { old?: number; oldFrames?: number } = {}): Shape[] => {
    const out: Shape[] = [...cap(stmt)];
    const col = (id: string, x: number, sz: number, n: number, dead: boolean, label: string): Shape[] => {
      const h = (760 * sz) / maxSize;
      const y0 = 980 - h;
      const s: Shape[] = [box(`${id}`, x, y0, 300, h, undefined, { tone: dead ? 'fail' : 'muted', filled: false, dashed: dead }), text(`${id}t`, x + 150, y0 - 16, label, { size: 22, bold: true, tone: dead ? 'fail' : 'muted' })];
      const fh = (h * FRAME) / sz;
      for (let k = 0; k < n; k++) s.push(box(`${id}f${k}`, x + 10, 980 - (k + 1) * fh, 280, Math.max(2, fh - 2), fh > 22 ? `depth(${depth - k})` : undefined, { mono: true, tone: dead ? 'visited' : k === n - 1 ? 'current' : 'accent' }));
      return s;
    };
    if (o.old) out.push(...col('old', 60, o.old, o.oldFrames!, true, `old ${o.old / 1024} KB · freed`));
    out.push(...col('cur', o.old ? 560 : 340, size, frames, false, `stack ${size / 1024} KB`));
    return out;
  };
  const rows = (n: number) => [['frames', n], ['used', `${n * FRAME} B`], ['stack', `${size / 1024} KB`], ['copies', copies, copies ? 'warn' : 'ok']] as [string, string | number, ('warn' | 'ok')?][];
  f.add('A new goroutine gets a 2 KB stack, not the megabytes an OS thread reserves. That is why a million goroutines fit.', scene(0, `go depth(${depth})   // ~560 B per frame`), panel('stack', rows(0)));
  for (let k = 1; k <= depth + 1 && k <= 15; k++) {
    if (k * FRAME > size) {
      const old = size;
      size *= 2;
      copies++;
      f.add(`Frame ${k} would not fit in ${old / 1024} KB. The prologue calls the runtime, which allocates ${size / 1024} KB, copies all ${k - 1} frames and fixes pointers into the stack.`, scene(k, 'morestack → copystack', { old, oldFrames: k - 1 }), panel('stack', rows(k)));
    } else if (k === 1 || k === depth + 1 || k * FRAME + FRAME > size) f.add(k === depth + 1 ? `depth(0) is the base case: ${k} frames, ${k * FRAME} bytes in a ${size / 1024} KB stack.` : `Frame ${k} fits: ${k * FRAME} of ${size} bytes used.`, scene(k, k === depth + 1 ? '  if n == 0 { return 0 }' : `  return 1 + depth(${depth - k})`), panel('stack', rows(k)));
  }
  f.add(copies ? `${copies} doubling${copies > 1 ? 's' : ''}, each a full copy. Pointers into the stack move with it, which is why Go never lets C code hold one.` : 'The recursion fit in the starting 2 KB: no growth needed.', scene(Math.min(depth + 1, 15), '// stacks can also shrink during GC'), panel('stack', rows(Math.min(depth + 1, 15))));
  return f.frames;
}

liveDemo(
  'go-escape',
  'Escape analysis & growable stacks',
  'Whether a value lives in the frame or on the GC heap depends on how it leaves the function: pick value, pointer or interface. Goroutine stacks start at 2 KB and double by copying as recursion deepens.',
  {
    stack: ['Stays on the stack', stack],
    escape: ['Escapes to the heap', escape],
    growth: ['Stack growth', growth],
  },
  [
    choice('ret', 'add returns', ['int', 'ptr'], 'int', { for: ['stack'], labels: ['int', '*int'] }),
    choice('how', 'newUser', HOW, 'ptr', { for: ['escape'], labels: ['return &u', 'return u', 'fmt.Println(u)'] }),
    number('n', 'depth', 1, 14, 10, { for: ['growth'] }),
  ],
  { cur: D('Goroutine stack', 'Starts at 2 KB and lives on the heap. Grows by doubling and copying; can shrink during GC.'), old: D('Old stack', 'The runtime allocated twice the space, copied every frame, and fixed up pointers into the stack.') },
);
