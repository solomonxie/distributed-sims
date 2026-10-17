// Rust ownership and borrowing as memory pictures (group lang-rust): moves vs clones, Copy types, Drop order,
// shared vs exclusive borrows, why push is rejected while a borrow lives, and lifetimes. unsafe stays a line trace.
import type { Detail, Frame } from '../algo/frames';
import { choice, liveGroup, num, number, pick } from '../machine/lib/live';
import type { P } from '../machine/lib/live';
import { Mem } from '../machine/lib/mem';
import { traceFrames } from '../machine/lib/trace';
import type { Trace } from '../machine/lib/trace';

const liveDemo = liveGroup('lang-rust');
const D = (title: string, text: string, code?: string): Detail => ({ title, text, code });
const STRING = D('String', 'Three words on the stack (pointer, length, capacity) owning a UTF-8 buffer on the heap.', 'let s = String::from("hi");\nassert_eq!(s.len(), 2);\nassert!(s.capacity() >= 2);');

const unsafeTrace: Trace = {
  codeTitle: 'main.rs',
  code: ['let mut x = 5;', 'let p = &mut x as *mut i32; // raw pointer: fine', 'unsafe { *p += 1; }         // deref: needs unsafe', 'println!("{x}");            // 6'],
  details: { p: D('Raw pointer', '*const T / *mut T: no borrow tracking. Creating one is safe; dereferencing it requires unsafe.', 'unsafe fn get(p: *const u8) -> u8 { *p }\n// SAFETY: caller guarantees p is valid\nlet v = unsafe { get(buf.as_ptr()) };') },
  steps: [
    { note: 'x is an ordinary local.', line: 0, vars: [['x', '5', 'write']], out: '' },
    { note: 'Casting a reference to a raw pointer is allowed anywhere. Raw pointers skip the borrow checker.', line: 1, vars: [['x', '5'], ['p', '*mut i32', 'accent']], out: '' },
    { note: 'Dereferencing it needs an unsafe block: you now promise the pointer is valid and unaliased.', line: 2, vars: [['x', '6', 'write'], ['p', '*mut i32', 'warn']], out: '' },
    { note: 'unsafe unlocks five abilities, like raw derefs and FFI calls. It does not turn off the other checks.', line: 3, vars: [['x', '6']], out: '6' },
  ],
};

// ---------------- ownership ----------------
const OD: Record<string, Detail> = {
  s: STRING,
  t: D('New owner', 'After a move, t owns the buffer and s is statically dead: using it is error E0382.'),
  h: D('Heap buffer', 'Freed exactly once, by whoever owns it when its scope ends.'),
  h2: D('clone()', 'Explicit deep copy: a second heap buffer. Rust never deep-copies behind your back.'),
  a: D('Copy types', 'Integers, floats, bool, char and tuples of them live entirely on the stack, so assignment copies bits and both stay usable.', '#[derive(Clone, Copy)]\nstruct P { x: i32, y: i32 }'),
  g0: D('Drop', 'Like a C++ destructor. Runs automatically when the owner goes out of scope, in reverse declaration order.', 'let f = File::open("x")?; // closed on drop\nlet g = m.lock().unwrap(); // unlocked on drop\ndrop(g);                   // release early'),
};

function moveScene(p: P): Frame[] {
  const clone = pick(p.how, ['move', 'clone'], 'move') === 'clone';
  const m = new Mem({ panel: 'Ownership', details: OD, out: true });
  m.region('stk', 'main() · stack').region('heap', 'heap');
  m.v('h', 'heap', 0, 'buffer', '0x900', '"hi"').v('s', 'stk', 0, 's', '0x10', '0x900', { to: 'h' });
  m.snap('String::from allocates "hi" on the heap. s holds the pointer (plus length and capacity) and owns the buffer.', 'let s = String::from("hi");', { out: '', rows: [['owners', 1]] });
  if (clone) {
    m.v('h2', 'heap', 1, 'buffer', '0x980', '"hi"').v('t', 'stk', 1, 't', '0x28', '0x980', { to: 'h2' });
    m.snap('clone() allocates a second buffer and copies the bytes. s and t each own one.', 'let t = s.clone();', { fly: ['h', 'h2'], hot: { h2: 'write' }, out: '', rows: [['buffers', 2], ['owners', '1 each', 'ok']] });
    m.snap('Both are usable. The cost of the copy is visible right there in the code.', 'println!("{s} {t}");', { finger: null, out: 'hi hi', rows: [['s', 'valid', 'ok']] });
    m.free('h2').free('h').kill('stk', '} · t dropped, then s');
    m.snap('At the brace t is dropped, then s: each frees its own buffer, once.', '}', { out: 'hi hi', rows: [['frees', 2, 'ok']] });
  } else {
    m.v('t', 'stk', 1, 't', '0x28', '0x900', { to: 'h' }).set('s', 'moved', null);
    m.snap('let t = s copies the three stack words and moves ownership to t. The heap bytes are not copied.', 'let t = s;', { fly: ['s', 't'], hot: { s: 'visited' }, out: '', rows: [['buffers', 1, 'ok'], ['owners', 1, 'ok']] });
    m.snap('Using s now is a compile error. Two owners could otherwise free the same buffer twice.', 'println!("{s}");   // E0382', { finger: 's', hot: { s: 'fail' }, out: 'error[E0382]: borrow of moved value: `s`', rows: [['s', 'moved', 'fail']] });
    m.free('h').kill('stk', '} · t dropped');
    m.snap('At the brace t is dropped and the buffer is freed exactly once. No GC, no manual free.', '}', { finger: 'h', out: 'hi', rows: [['frees', 1, 'ok']] });
  }
  return m.frames();
}

function copyScene(p: P): Frame[] {
  const str = pick(p.ty, ['i32', 'String'], 'i32') === 'String';
  const m = new Mem({ panel: 'Copy vs move', details: OD, out: true });
  m.region('stk', 'main() · stack');
  if (str) {
    m.region('heap', 'heap').v('h', 'heap', 0, 'buffer', '0x900', '"5"').v('a', 'stk', 0, 'a: String', '0x10', '0x900', { to: 'h' });
    m.snap('a is a String: it owns a heap buffer.', 'let a = String::from("5");', { out: '' });
    m.v('b', 'stk', 1, 'b: String', '0x28', '0x900', { to: 'h' }).set('a', 'moved', null);
    m.snap('String is not Copy, so let b = a moves: a gives up the buffer.', 'let b = a;', { fly: ['a', 'b'], hot: { a: 'visited' }, out: '', rows: [['a', 'moved', 'warn']] });
    m.snap('Printing a is rejected. A type that owns a resource cannot be duplicated by copying bits.', 'println!("{a} {b}");   // E0382', { finger: 'a', hot: { a: 'fail' }, out: 'error[E0382]: borrow of moved value: `a`', rows: [['Copy', 'no', 'fail']] });
  } else {
    m.v('a', 'stk', 0, 'a: i32', '0x10', '5');
    m.snap('a is an i32: 4 bytes on the stack, owning nothing else.', 'let a = 5;', { out: '' });
    m.v('b', 'stk', 1, 'b: i32', '0x14', '5');
    m.snap('i32 is Copy, so let b = a duplicates the 4 bytes. Nothing is moved.', 'let b = a;', { fly: ['a', 'b'], out: '', rows: [['a', 'still valid', 'ok']] });
    m.snap('Both are usable. Copy is for small plain values whose bits are the whole story.', 'println!("{a} {b}");', { finger: null, hot: { a: 'ok', b: 'ok' }, out: '5 5', rows: [['Copy', 'yes', 'ok']] });
  }
  return m.frames();
}

function dropScene(p: P): Frame[] {
  const n = num(p.n, 2, 1, 3);
  const early = pick(p.early, ['no', 'yes'], 'no') === 'yes';
  const names = ['a', 'b', 'c'].slice(0, n);
  const m = new Mem({ panel: 'Drop', details: OD, out: true });
  m.region('stk', 'main() · stack');
  let out = '';
  names.forEach((x, i) => {
    m.v(`g${i}`, 'stk', i, `_${x}`, `0x${(0x10 + i * 8).toString(16)}`, `Guard("${x}")`);
    m.snap(`_${x} owns a Guard. Its Drop impl prints when it is dropped.`, `let _${x} = Guard("${x}");`, { finger: `g${i}`, out });
  });
  const order = names.map((_, i) => i).reverse();
  if (early) {
    out += `drop ${names[0]}\n`;
    m.free('g0');
    m.snap(`drop(_a) moves _a into std::mem::drop, which drops it right now instead of at the brace.`, 'drop(_a);', { finger: 'g0', hot: { g0: 'warn' }, out: out.trim(), rows: [['released', 'early', 'ok']] });
  }
  for (const i of order) {
    if (early && i === 0) continue;
    out += `drop ${names[i]}\n`;
    m.free(`g${i}`);
    m.snap(i === order[0] ? `At the closing brace values drop in reverse order: _${names[i]} first.` : `Then _${names[i]}.`, '}', { finger: `g${i}`, out: out.trim() });
  }
  m.kill('stk', 'main() returned');
  m.snap(`Last declared, first dropped. Files, locks and sockets release the same way, with no finally blocks${early ? '; drop() releases one early' : ''}.`, '}', { finger: null, out: out.trim(), rows: [['drops', n, 'ok']] });
  return m.frames();
}

liveDemo(
  'rust-own',
  'Ownership, moves & Drop',
  'One owner per value: a move hands the heap buffer over and kills the old name, clone makes a second buffer, Copy types just duplicate bits, and Drop runs in reverse order (or early).',
  {
    move: ['Move', moveScene],
    clone: ['Clone vs Copy', copyScene],
    drop: ['Drop & RAII', dropScene],
  },
  [
    choice('how', 'let t =', ['move', 'clone'], 'move', { for: ['move'], labels: ['s', 's.clone()'] }),
    choice('ty', 'a is', ['i32', 'String'], 'i32', { for: ['clone'] }),
    number('n', 'guards', 1, 3, 2, { for: ['drop'] }),
    choice('early', 'drop(_a) early', ['no', 'yes'], 'no', { for: ['drop'] }),
  ],
);

// ---------------- borrowing ----------------
const BD: Record<string, Detail> = {
  a: D('&T, shared borrow', 'Read-only access. Any number may exist at once.'),
  m: D('&mut T, exclusive borrow', 'Read-write access. While it is alive, no other borrow of v may be used.', 'fn add_one(v: &mut Vec<i32>) {\n  v.push(1);\n}\nadd_one(&mut v);'),
  first: D('Borrow into the buffer', 'first points inside v’s heap buffer. Anything that may reallocate the buffer must wait until first is dead.'),
  b0: D('Old buffer', 'What push would free when it grows the Vec. first would point here: a use-after-free, which C++ allows and Rust refuses to compile.'),
  r: D("Lifetime 'a", 'The returned reference lives no longer than the shorter of x and y. Lifetimes are compile-time labels, not runtime data.', "fn longest<'a>(x: &'a str, y: &'a str) -> &'a str"),
};

function shared(p: P): Frame[] {
  const late = pick(p.late, ['no', 'yes'], 'no') === 'yes';
  const m = new Mem({ panel: 'Borrows', details: BD, out: true });
  m.region('stk', 'main() · stack').region('heap', 'heap');
  m.v('buf', 'heap', 0, 'Vec buffer', '0x900', '1 2').v('v', 'stk', 0, 'v', '0x10', '0x900', { to: 'buf' });
  m.snap('v owns a Vec buffer on the heap.', 'let mut v = vec![1, 2];', { out: '' });
  m.v('a', 'stk', 1, 'a: &Vec', '0x28', '0x10', { to: 'v', weak: true }).v('b', 'stk', 2, 'b: &Vec', '0x30', '0x10', { to: 'v', weak: true });
  m.snap('Two shared borrows at once are fine: readers cannot conflict.', 'let a = &v;  let b = &v;', { out: '2 2', rows: [['&v', 2, 'ok'], ['&mut v', 0]] });
  if (!late) {
    m.gone('a').gone('b');
    m.snap('a and b are never used again, so their borrows end here, before the next line.', 'println!("{} {}", a.len(), b.len());', { out: '2 2', rows: [['&v live', 0, 'ok']] });
  }
  m.v('m', 'stk', 3, 'm: &mut Vec', '0x38', '0x10', { to: 'v' });
  m.snap(late ? 'A &mut borrow starts while a is still going to be used later. Many readers or one writer, never both.' : 'Now one &mut borrow may start: nobody else is looking.', 'let m = &mut v;', { finger: 'm', hot: late ? { m: 'fail', a: 'warn' } : { m: 'write' }, out: '2 2', rows: [['&v live', late ? 1 : 0, late ? 'fail' : 'ok'], ['&mut v', 1]] });
  if (late) {
    m.snap('Because a is read after m, the compiler rejects the program: a could see v change under it.', 'm.push(3);  println!("{}", a.len());', { finger: 'a', hot: { a: 'fail', m: 'fail' }, out: 'error[E0502]: cannot borrow `v` as mutable', rows: [['rule', 'aliasing XOR mutation', 'fail']] });
    return m.frames();
  }
  m.set('buf', '1 2 3');
  m.snap('m.push(3) writes through the only live borrow. Nothing else can observe the change mid-way.', 'm.push(3);', { finger: 'buf', hot: { buf: 'write' }, out: '2 2', rows: [['v', '[1, 2, 3]', 'ok']] });
  m.gone('m');
  m.snap('m is done, so v is usable directly again.', 'println!("{:?}", v);', { finger: 'v', out: '2 2\n[1, 2, 3]', rows: [['rule', 'aliasing XOR mutation', 'ok']] });
  return m.frames();
}

function conflict(p: P): Frame[] {
  const used = pick(p.after, ['yes', 'no'], 'yes') === 'yes';
  const m = new Mem({ panel: 'push vs borrow', details: BD, out: true });
  m.region('stk', 'main() · stack').region('heap', 'heap');
  m.v('b0', 'heap', 0, 'buffer cap 3', '0x900', '1 2 3').v('v', 'stk', 0, 'v', '0x10', '0x900', { to: 'b0' });
  m.snap('v has length 3 and capacity 3: its buffer is full.', 'let mut v = vec![1, 2, 3];', { out: '' });
  m.v('first', 'stk', 1, 'first: &i32', '0x28', '0x900', { to: 'b0' });
  m.snap('first borrows an element inside the heap buffer.', 'let first = &v[0];', { finger: 'first', out: '' });
  if (used) {
    m.v('b1', 'heap', 1, 'buffer cap 6', '0xA00', '1 2 3 4').set('v', '0xA00', 'b1').free('b0');
    m.snap('Imagine push ran: a full Vec allocates a bigger buffer, moves the elements and frees the old one. first would dangle.', 'v.push(4);   // what would happen', { finger: 'first', hot: { first: 'fail', b0: 'fail' }, out: '', rows: [['first', 'dangling', 'fail']] });
    m.drop('heap').region('heap', 'heap').v('b0', 'heap', 0, 'buffer cap 3', '0x900', '1 2 3').set('v', '0x900', 'b0');
    m.snap('So since first is used after the push, the borrow checker refuses push. The C++ version of this compiles and crashes.', 'v.push(4);  println!("{first}");', { finger: 'first', hot: { first: 'accent' }, out: 'error[E0502]: cannot borrow `v` as mutable', rows: [['compiles', 'no', 'fail']] });
  } else {
    m.gone('first');
    m.snap('first is not used after this point, so its borrow already ended. Nothing points into the buffer.', 'println!("{first}");', { out: '1', rows: [['borrow', 'ended', 'ok']] });
    m.v('b1', 'heap', 1, 'buffer cap 6', '0xA00', '1 2 3 4').set('v', '0xA00', 'b1').free('b0');
    m.snap('push may now reallocate freely: the old buffer is freed and nobody is left pointing at it.', 'v.push(4);', { finger: 'b1', hot: { b1: 'write' }, out: '1', rows: [['compiles', 'yes', 'ok']] });
  }
  return m.frames();
}

function lifetime(p: P): Frame[] {
  const inside = pick(p.use, ['outside', 'inside'], 'outside') === 'inside';
  const m = new Mem({ panel: 'Lifetimes', details: BD, out: true });
  m.region('main', 'main() · stack').region('blk', '{ inner block }').region('heap', 'heap');
  m.v('r', 'main', 0, 'r: &str', '0x10', '?');
  m.snap("longest's signature says its result lives no longer than both inputs: the lifetime 'a.", "fn longest<'a>(x: &'a str, y: &'a str) -> &'a str", { out: '' });
  m.v('hs', 'heap', 0, 'chars', '0x900', '"long"').v('s', 'blk', 0, 's: String', '0x40', '0x900', { to: 'hs' });
  m.set('r', '0x900', 'hs');
  m.snap('Inside the block, r borrows from s via longest(&s, "hi").', 'let s = String::from("long");  r = longest(&s, "hi");', { finger: 'r', out: '' });
  if (inside) {
    m.snap('Using r while s is still alive is fine: the borrow ends before s does.', '  println!("{r}");', { finger: 'hs', hot: { hs: 'ok' }, out: 'long', rows: [['r used', 'inside s’s scope', 'ok']] });
    m.free('hs').kill('blk', '} s dropped');
    m.snap('Then s is dropped. r is never used again, so nothing dangles.', '}', { finger: null, out: 'long', rows: [['compiles', 'yes', 'ok']] });
  } else {
    m.free('hs').kill('blk', '} s dropped');
    m.snap('s is dropped at the end of the block while r still points at its buffer.', '}', { finger: 'r', hot: { r: 'fail' }, out: '', rows: [['s', 'dropped', 'muted']] });
    m.snap('So the later use of r is rejected at compile time: s does not live long enough. Move the println into the block, or keep s alive longer.', 'println!("{r}");', { finger: 'hs', hot: { r: 'fail', hs: 'fail' }, out: 'error[E0597]: `s` does not live long enough', rows: [['compiles', 'no', 'fail']] });
  }
  return m.frames();
}

liveDemo(
  'rust-borrow',
  'Borrowing & lifetimes',
  'Borrows as arrows into owned memory: many readers or one writer, push refused while a reference into the buffer is still used, and a lifetime too short for where the reference is read.',
  {
    shared: ['Shared & mutable', shared],
    conflict: ['Why push is rejected', conflict],
    lifetime: ['Lifetimes', lifetime],
    unsafe: ['unsafe', () => traceFrames(unsafeTrace)],
  },
  [
    choice('late', 'use a after &mut', ['no', 'yes'], 'no', { for: ['shared'] }),
    choice('after', 'use first after push', ['yes', 'no'], 'yes', { for: ['conflict'] }),
    choice('use', 'println!("{r}")', ['outside', 'inside'], 'outside', { for: ['lifetime'], labels: ['after the block', 'inside the block'] }),
  ],
);
