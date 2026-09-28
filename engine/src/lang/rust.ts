// Rust (group lang-rust): ownership, borrowing & lifetimes, traits & dispatch, Send/Sync, async, modules & Cargo.
import type { Detail } from '../algo/frames';
import { boardDemo, N } from '../machine/lib/board';
import type { Board } from '../machine/lib/board';
import { machineDemo } from '../machine/lib/draw';
import { traceFrames } from '../machine/lib/trace';
import type { Trace } from '../machine/lib/trace';

const G = 'lang-rust';
const D = (title: string, text: string, code?: string): Detail => ({ title, text, code });
const demo = (slug: string, title: string, summary: string, boards: Record<string, [string, Board]>) => boardDemo(G, slug, title, summary, boards);

function traceDemo(slug: string, title: string, summary: string, traces: Record<string, [string, Trace]>) {
  machineDemo({
    slug,
    title,
    group: G,
    summary,
    inputs: Object.entries(traces).map(([id, [label]]) => ({ id, label, data: { k: id } })),
    build: ({ k }: { k: string }) => traceFrames(traces[k][1]),
  });
}

const STRING = D('String', 'Three words on the stack (pointer, length, capacity) owning a UTF-8 buffer on the heap.', 'let s = String::from("hi");\nassert_eq!(s.len(), 2);\nassert!(s.capacity() >= 2);');

// ---------------- ownership ----------------
traceDemo('rust-own', 'Ownership, moves & Drop', 'Each value has one owner; assignment moves; clone copies deeply; Drop runs when the owner goes out of scope.', {
  move: [
    'Move',
    {
      codeTitle: 'main.rs',
      code: ['fn main() {', '  let s = String::from("hi");', '  let t = s;              // move', '  // println!("{s}");     // E0382: moved value', '  println!("{t}");', '}'],
      details: { s: STRING, t: D('New owner', 'let t = s copied the three stack words and transferred ownership. s is statically dead from here on.'), h: D('Heap buffer', 'Freed exactly once, by whoever owns it when its scope ends.') },
      steps: [
        { note: 'String::from allocates "hi" on the heap. s holds pointer, length and capacity.', line: 1, vars: [['s', 'ptr len=2 cap=2', 'write', 'h']], heap: [['h', '"hi"', 'read', '2 bytes']], out: '' },
        { note: 'let t = s copies those three words and moves ownership to t. The heap bytes are not copied.', line: 2, vars: [['s', '(moved)', 'visited'], ['t', 'ptr len=2 cap=2', 'write', 'h']], heap: [['h', '"hi"', 'read']], out: '' },
        { note: 'Using s now is a compile error. Two owners could otherwise free the same buffer twice.', line: 3, vars: [['s', '(moved)', 'fail'], ['t', 'ptr len=2 cap=2', 'default', 'h']], heap: [['h', '"hi"', 'read']], out: '' },
        { note: 't prints hi.', line: 4, vars: [['s', '(moved)', 'visited'], ['t', 'ptr len=2 cap=2', 'default', 'h']], heap: [['h', '"hi"', 'read']], out: 'hi' },
        { note: 'At the closing brace t is dropped and the buffer freed exactly once. No GC and no manual free.', line: 5, vars: [], heap: [['h', '"hi"', 'visited', 'freed by drop(t)']], out: 'hi' },
      ],
    },
  ],
  clone: [
    'Clone vs Copy',
    {
      codeTitle: 'main.rs',
      code: ['let s = String::from("hi");', 'let t = s.clone();   // deep copy', 'println!("{s} {t}"); // both valid', 'let a = 5;', 'let b = a;           // i32 is Copy', 'println!("{a} {b}");'],
      details: { t: D('clone()', 'Explicit deep copy: a second heap buffer. Rust never deep-copies behind your back.'), a: D('Copy types', 'Integers, floats, bool, char and tuples of them live entirely on the stack, so assignment copies bits and both stay usable.', '#[derive(Clone, Copy)]\nstruct P { x: i32, y: i32 }') },
      steps: [
        { note: 's owns a heap buffer.', line: 0, vars: [['s', 'ptr len=2', 'write', 'h1']], heap: [['h1', '"hi"', 'read']], out: '' },
        { note: 'clone() allocates a second buffer, so s and t each own one.', line: 1, vars: [['s', 'ptr len=2', 'default', 'h1'], ['t', 'ptr len=2', 'write', 'h2']], heap: [['h1', '"hi"', 'read'], ['h2', '"hi"', 'write', 'copy']], out: '' },
        { note: 'Both are usable. The cost of the copy is visible in the code.', line: 2, vars: [['s', 'ptr len=2', 'default', 'h1'], ['t', 'ptr len=2', 'default', 'h2']], heap: [['h1', '"hi"', 'read'], ['h2', '"hi"', 'read']], out: 'hi hi' },
        { note: 'Plain integers are Copy: assigning duplicates the bits, and nothing is moved.', line: [3, 4, 5], vars: [['a', '5'], ['b', '5', 'write']], heap: [['h1', '"hi"', 'read'], ['h2', '"hi"', 'read']], out: 'hi hi\n5 5' },
      ],
    },
  ],
  drop: [
    'Drop & RAII',
    {
      codeTitle: 'main.rs',
      code: ['struct Guard(&\'static str);', 'impl Drop for Guard {', '  fn drop(&mut self) { println!("drop {}", self.0) }', '}', 'fn main() {', '  let _a = Guard("a");', '  let _b = Guard("b");', '}                     // drops b, then a'],
      details: { _a: D('Drop', 'Like a C++ destructor. Runs automatically when the owner goes out of scope, in reverse declaration order.', 'let f = File::open("x")?; // closed on drop\nlet g = m.lock().unwrap(); // unlocked on drop\ndrop(g);                   // release early') },
      steps: [
        { note: '_a owns a Guard.', line: 5, vars: [['_a', 'Guard("a")', 'write']], out: '' },
        { note: '_b owns another Guard.', line: 6, vars: [['_a', 'Guard("a")'], ['_b', 'Guard("b")', 'write']], out: '' },
        { note: 'At the closing brace, values drop in reverse order: _b first.', line: 7, vars: [['_a', 'Guard("a")'], ['_b', 'dropped', 'visited']], out: 'drop b' },
        { note: 'Then _a. Files, locks and sockets release the same way, with no finally blocks.', line: 7, vars: [['_a', 'dropped', 'visited'], ['_b', 'dropped', 'visited']], out: 'drop b\ndrop a' },
      ],
    },
  ],
});

// ---------------- borrowing ----------------
traceDemo('rust-borrow', 'Borrowing & lifetimes', 'Many &T or one &mut T, why a borrow blocks push, lifetimes rejecting dangling references, and unsafe.', {
  shared: [
    'Shared & mutable',
    {
      codeTitle: 'main.rs',
      code: ['let mut v = vec![1, 2];', 'let a = &v;  let b = &v;   // many readers', 'println!("{} {}", a.len(), b.len());', 'let m = &mut v;            // one writer', 'm.push(3);', 'println!("{:?}", v);       // m no longer used'],
      details: { a: D('&T — shared borrow', 'Read-only access. Any number may exist at once.'), m: D('&mut T — exclusive borrow', 'Read-write access. While it is alive, no other borrow of v may be used.', 'fn add_one(v: &mut Vec<i32>) {\n  v.push(1);\n}\nadd_one(&mut v);') },
      steps: [
        { note: 'v owns a heap buffer.', line: 0, vars: [['v', 'Vec len=2', 'write', 'buf']], heap: [['buf', '[1, 2]', 'read']], out: '' },
        { note: 'Two shared borrows at once are fine: readers can’t conflict.', line: [1, 2], vars: [['v', 'Vec len=2', 'default', 'buf'], ['a', '&v', 'accent', 'buf'], ['b', '&v', 'accent', 'buf']], heap: [['buf', '[1, 2]', 'read']], out: '2 2' },
        { note: 'a and b are never used again, so their borrows end. Now one &mut borrow may start.', line: 3, vars: [['v', 'Vec len=2', 'default', 'buf'], ['m', '&mut v', 'write', 'buf']], heap: [['buf', '[1, 2]', 'read']], out: '2 2' },
        { note: 'The rule is aliasing XOR mutation: many readers or one writer, never both.', line: [4, 5], vars: [['v', 'Vec len=3', 'default', 'buf']], heap: [['buf', '[1, 2, 3]', 'write']], out: '2 2\n[1, 2, 3]' },
      ],
    },
  ],
  conflict: [
    'Why push is rejected',
    {
      codeTitle: 'main.rs',
      code: ['let mut v = vec![1, 2, 3];', 'let first = &v[0];   // shared borrow', 'v.push(4);           // E0502: needs &mut v', 'println!("{first}");'],
      details: { first: D('Borrow into the buffer', 'first points inside v’s heap buffer. Anything that may reallocate the buffer must wait until first is dead.'), old: D('Old buffer', 'What push would free when it grows the Vec. first would point here: a use-after-free, which C++ allows and Rust refuses to compile.') },
      steps: [
        { note: 'v has length 3 and capacity 3.', line: 0, vars: [['v', 'len=3 cap=3', 'write', 'old']], heap: [['old', '[1, 2, 3]', 'read', 'cap 3']], out: '' },
        { note: 'first borrows an element inside the heap buffer.', line: 1, vars: [['v', 'len=3 cap=3', 'default', 'old'], ['first', '&v[0]', 'accent', 'old']], heap: [['old', '[1, 2, 3]', 'read']], out: '' },
        { note: 'push on a full Vec allocates a bigger buffer and frees the old one, so first would dangle.', line: 2, vars: [['v', 'len=4 cap=6', 'warn', 'new'], ['first', '&v[0]', 'fail', 'old']], heap: [['old', '[1, 2, 3]', 'fail', 'freed'], ['new', '[1, 2, 3, 4]', 'write', 'cap 6']], out: '' },
        { note: 'The borrow checker rejects push while first is still used afterwards. The C++ version of this compiles and crashes.', line: 2, vars: [['v', 'len=3 cap=3', 'default', 'old'], ['first', '&v[0]', 'accent', 'old']], heap: [['old', '[1, 2, 3]', 'read']], out: 'error[E0502]: cannot borrow `v` as mutable' },
      ],
    },
  ],
  lifetime: [
    'Lifetimes',
    {
      codeTitle: 'main.rs',
      code: ["fn longest<'a>(x: &'a str, y: &'a str) -> &'a str {", '  if x.len() > y.len() { x } else { y }', '}', 'let r;', '{ let s = String::from("long");', '  r = longest(&s, "hi"); }   // s dropped here', 'println!("{r}");              // E0597'],
      details: { r: D("Lifetime 'a", "The returned reference lives no longer than the shorter of x and y. Lifetimes are compile-time labels, not runtime data.", "fn first_word(s: &str) -> &str { // elided:\n  s.split(' ').next().unwrap()   // output\n}                                // borrows s") },
      steps: [
        { note: "longest says the result lives as long as both inputs, the lifetime 'a.", line: 0, vars: [['r', '?']], out: '' },
        { note: 'Inside the block, r borrows from s.', line: [4, 5], vars: [['r', '&s', 'accent', 's'], ['s', 'String', 'write', 's']], heap: [['s', '"long"', 'read']], out: '' },
        { note: 's is dropped at the end of the block while r still points at it.', line: 5, vars: [['r', '&s', 'fail', 's']], heap: [['s', '"long"', 'fail', 'freed']], out: '' },
        { note: 'So the use of r is rejected at compile time: s does not live long enough.', line: 6, vars: [['r', '&s', 'fail', 's']], heap: [['s', '"long"', 'fail', 'freed']], out: 'error[E0597]: `s` does not live long enough' },
      ],
    },
  ],
  unsafe: [
    'unsafe',
    {
      codeTitle: 'main.rs',
      code: ['let mut x = 5;', 'let p = &mut x as *mut i32; // raw pointer: fine', 'unsafe { *p += 1; }         // deref: needs unsafe', 'println!("{x}");            // 6'],
      details: { p: D('Raw pointer', '*const T / *mut T: no borrow tracking. Creating one is safe; dereferencing it requires unsafe.', 'unsafe fn get(p: *const u8) -> u8 { *p }\n// SAFETY: caller guarantees p is valid\nlet v = unsafe { get(buf.as_ptr()) };') },
      steps: [
        { note: 'x is an ordinary local.', line: 0, vars: [['x', '5', 'write']], out: '' },
        { note: 'Casting a reference to a raw pointer is allowed anywhere. Raw pointers skip the borrow checker.', line: 1, vars: [['x', '5'], ['p', '*mut i32', 'accent']], out: '' },
        { note: 'Dereferencing it needs an unsafe block: you now promise the pointer is valid and unaliased.', line: 2, vars: [['x', '6', 'write'], ['p', '*mut i32', 'warn']], out: '' },
        { note: 'unsafe unlocks five abilities, like raw derefs and FFI calls. It does not turn off the other checks.', line: 3, vars: [['x', '6']], out: '6' },
      ],
    },
  ],
});

// ---------------- traits ----------------
demo('rust-traits', 'Traits, dispatch & Send/Sync', 'Generics monomorphise to static calls, dyn Trait uses fat pointers and vtables, Send/Sync make threads safe.', {
  generic: [
    'Generics (static)',
    {
      panel: 'Dispatch',
      codeTitle: 'main.rs',
      code: ['trait Shape { fn area(&self) -> f64; }', 'fn total<T: Shape>(xs: &[T]) -> f64 {', '  xs.iter().map(|s| s.area()).sum()', '}', 'total(&circles); total(&squares);'],
      nodes: [
        N('gen', 355, 260, 290, 110, 'total<T>', 'generic source', { detail: D('Trait bound', 'T: Shape means any type implementing Shape. The compiler checks the body once against the trait.', 'impl Shape for Circle {\n  fn area(&self) -> f64 { 3.14 * self.r * self.r }\n}') }),
        N('m1', 40, 450, 440, 110, 'total::<Circle>', 'own machine code'),
        N('m2', 520, 450, 440, 110, 'total::<Square>', 'own machine code'),
        N('inl', 40, 640, 920, 120, 'Circle::area inlined', 'static dispatch'),
        N('cost', 40, 830, 920, 120, 'cost', 'code size & compile time'),
      ],
      edges: ['gen>m1', 'gen>m2', 'm1>inl'],
      beats: [
        { note: 'total is generic over any T that implements Shape.', hl: [1], hot: { gen: 'current' }, hide: ['m1', 'm2', 'inl', 'cost'], rows: [['copies', 0]] },
        { note: 'Each call with a new type stamps out a copy: total::<Circle> and total::<Square>. This is monomorphisation.', hl: [4], hot: { m1: 'write', m2: 'write', 'gen>m1': 'accent', 'gen>m2': 'accent' }, hide: ['inl', 'cost'], rows: [['copies', 2]] },
        { note: 'Inside each copy the call to area is direct, so it can be inlined. Zero-cost abstraction.', hl: [2], hot: { inl: 'ok', 'm1>inl': 'accent' }, hide: ['cost'], rows: [['dispatch', 'static', 'ok']] },
        { note: 'The price is a copy per type: bigger binaries and longer compiles, the same trade as C++ templates.', hot: { cost: 'warn' }, rows: [['trade-off', 'size vs speed']] },
      ],
    },
  ],
  dyn: [
    'dyn Trait (dynamic)',
    {
      panel: 'Dispatch',
      codeTitle: 'main.rs',
      code: ['let shapes: Vec<Box<dyn Shape>> = vec![', '  Box::new(Circle { r: 2.0 }), Box::new(Sq { s: 3.0 }),', '];', 'for s in &shapes { println!("{}", s.area()); }'],
      nodes: [
        N('fat', 40, 240, 440, 120, 'Box<dyn Shape>', 'fat pointer: 2 words', { detail: D('Trait object', 'A pointer to the data plus a pointer to a vtable. Lets one Vec hold different types.', 'fn draw_all(xs: &[&dyn Shape]) {\n  for s in xs { s.area(); }\n}') }),
        N('data', 40, 430, 440, 110, 'data ptr'),
        N('vt', 40, 610, 440, 110, 'vtable ptr'),
        N('obj', 520, 430, 440, 110, 'Circle { r: 2.0 }', 'heap'),
        N('tbl', 520, 610, 440, 110, 'vtable for Circle', 'drop · size · align · area'),
        N('fn', 520, 800, 440, 110, 'Circle::area'),
      ],
      edges: ['fat>data', 'data>obj', 'vt>tbl', 'tbl>fn'],
      beats: [
        { note: 'A Vec of Box<dyn Shape> can mix Circles and Squares.', hl: [0, 1], hot: { fat: 'current' }, rows: [['element size', '16 B']] },
        { note: 'Each element is a fat pointer: one word to the data, one to the type’s vtable.', hot: { data: 'write', vt: 'write', 'fat>data': 'accent', 'data>obj': 'accent' }, rows: [['words', 2]] },
        { note: 'The vtable holds drop, size, alignment and one pointer per trait method.', hot: { tbl: 'current', 'vt>tbl': 'accent' }, rows: [['methods', 1]] },
        { note: 's.area() loads the slot and calls through it. One indirect call and no inlining, but only one copy of the code.', hl: [3], hot: { fn: 'ok', 'tbl>fn': 'accent' }, rows: [['dispatch', 'dynamic']] },
      ],
    },
  ],
  sendsync: [
    'Send, Sync, Arc<Mutex>',
    {
      panel: 'Threads',
      codeTitle: 'main.rs',
      code: ['let n = Arc::new(Mutex::new(0));', 'for _ in 0..4 {', '  let n = Arc::clone(&n);', '  thread::spawn(move || *n.lock().unwrap() += 1);', '}', '// Rc::new(0) here: error, Rc<i32> is not Send'],
      nodes: [
        N('arc', 355, 290, 290, 110, 'Arc<Mutex<i32>>', 'refcount 1', { detail: D('Arc', 'Atomically reference-counted shared ownership. Clone bumps the count; the value drops when the last Arc does.') }),
        ...[0, 1, 2, 3].map((i) => N(`t${i}`, 40 + i * 240, 480, 200, 100, `thread ${i + 1}`)),
        N('mtx', 355, 660, 290, 110, 'Mutex', 'unlocked', { detail: D('Mutex<T>', 'Owns the data it protects. The only way in is lock(), and the guard unlocks on drop.', 'let mut g = m.lock().unwrap();\n*g += 1;\n// unlocked when g drops') }),
        N('rc', 40, 850, 920, 120, 'Rc<T>', 'non-atomic count: not Send', { detail: D('Send and Sync', 'Send: safe to move to another thread. Sync: safe to share &T between threads. The compiler derives them and spawn requires them.', 'let r = Rc::new(0);\nthread::spawn(move || r);\n// error[E0277]: `Rc<i32>` cannot be sent\n// between threads safely') }),
      ],
      edges: ['t0>arc', 't1>arc', 't2>arc', 't3>arc', 'arc>mtx'],
      beats: [
        { note: 'Arc shares one Mutex<i32> between threads.', hl: [0], hot: { arc: 'current' }, hide: ['rc'], rows: [['refcount', 1]] },
        { note: 'Each thread gets its own Arc clone, bumping the atomic count to 5.', hl: [2, 3], hot: { t0: 'write', t1: 'write', t2: 'write', t3: 'write', 't0>arc': 'accent', 't1>arc': 'accent', 't2>arc': 'accent', 't3>arc': 'accent' }, sub: { arc: 'refcount 5' }, hide: ['rc'], rows: [['refcount', 5]] },
        { note: 'The i32 lives inside the Mutex, so it can only be touched through lock(). A data race doesn’t compile.', hot: { mtx: 'current', 'arc>mtx': 'accent', t2: 'current' }, sub: { arc: 'refcount 5', mtx: 'locked by thread 3' }, hide: ['rc'], rows: [['races possible', 0, 'ok']] },
        { note: 'Swap in Rc and spawn fails to compile: Rc’s count isn’t atomic, so Rc is not Send.', hl: [5], hot: { rc: 'fail' }, sub: { arc: 'refcount 5' }, rows: [['compile', 'E0277', 'fail']] },
      ],
    },
  ],
});

// ---------------- async ----------------
demo('rust-async', 'async/await & executors', 'Futures compile to state machines polled by an executor like tokio; wakers, the reactor, and not blocking workers.', {
  statemachine: [
    'Futures are state machines',
    {
      panel: 'Future',
      codeTitle: 'main.rs',
      code: ['async fn fetch(url: &str) -> Result<String> {', '  let conn = connect(url).await?;    // state 1', '  let body = conn.read_all().await?; // state 2', '  Ok(body)', '}'],
      nodes: [
        N('fut', 355, 250, 290, 110, 'impl Future', 'enum of states', { detail: D('Future', 'fetch() returns this value immediately; nothing runs until it is polled. Locals that live across an .await are fields of it.', 'let f = fetch(url); // nothing happens yet\nlet body = f.await?; // now it runs') }),
        N('s0', 40, 440, 290, 110, 'Start'),
        N('s1', 355, 440, 290, 110, 'AwaitConnect'),
        N('s2', 670, 440, 290, 110, 'AwaitRead', 'holds conn'),
        N('done', 355, 630, 290, 110, 'Ready(body)'),
        N('poll', 40, 820, 920, 120, 'poll(cx)', '—', { detail: D('poll', 'The executor calls poll. It returns Pending (with a waker registered) or Ready(value).', 'enum Poll<T> { Ready(T), Pending }\n// fn poll(self: Pin<&mut Self>,\n//         cx: &mut Context) -> Poll<T>') }),
      ],
      edges: ['fut>s1', 's0>s1', 's1>s2', 's2>done'],
      beats: [
        { note: 'Calling fetch runs nothing. It returns a Future, an enum with one variant per .await point.', hl: [0], hot: { fut: 'current', s0: 'write' }, rows: [['heap allocs', 0]] },
        { note: 'The executor polls it: it runs until connect isn’t ready, saves its state, and returns Pending.', hl: [1], hot: { s1: 'current', poll: 'warn', 's0>s1': 'accent' }, sub: { poll: 'Pending' }, rows: [['state', 'AwaitConnect']] },
        { note: 'When the socket is ready the waker reschedules it, and the next poll resumes at state 2 with conn saved.', hl: [2], hot: { s2: 'current', 's1>s2': 'accent' }, sub: { poll: 'Pending' }, rows: [['state', 'AwaitRead']] },
        { note: 'The last poll returns Ready(body). A future nobody awaits never runs at all.', hl: [3], hot: { done: 'ok', 's2>done': 'accent' }, sub: { poll: 'Ready' }, rows: [['state', 'done', 'ok']] },
      ],
    },
  ],
  executor: [
    'Executor & reactor',
    {
      panel: 'Runtime',
      nodes: [
        N('rt', 355, 40, 290, 110, 'tokio runtime', '#[tokio::main]', { detail: D('Runtime', 'Rust ships no async runtime. tokio provides worker threads, a timer and an I/O reactor.', '#[tokio::main]\nasync fn main() {\n  let h = tokio::spawn(fetch(url));\n  let body = h.await??;\n}') }),
        N('q', 40, 230, 440, 110, 'task queue', 'T1 T2 T3'),
        N('rx', 520, 230, 440, 110, 'reactor', 'epoll / kqueue'),
        N('w1', 40, 420, 440, 110, 'worker 1'),
        N('w2', 520, 420, 440, 110, 'worker 2'),
        N('wk', 40, 620, 920, 120, 'Waker', 'puts a task back on the queue'),
        N('blk', 40, 820, 920, 120, 'blocking code', 'use spawn_blocking', { detail: D('Never block a worker', 'std::thread::sleep, blocking file I/O or long CPU work stall every task on that worker.', 'let hash = tokio::task::spawn_blocking(move || {\n  argon2_hash(&pw) // CPU-heavy\n}).await?;') }),
      ],
      edges: ['rt>q', 'rt>rx', 'q>w1', 'q>w2', 'rx>wk'],
      beats: [
        { note: 'tokio::spawn puts tasks, each a future, on a queue that worker threads poll.', hot: { rt: 'current', q: 'write', 'rt>q': 'accent' }, hide: ['wk', 'blk'], rows: [['tasks', 3]] },
        { note: 'A worker polls T1 until it returns Pending on a socket read.', hot: { w1: 'current', 'q>w1': 'accent' }, sub: { w1: 'polling T1', q: 'T2 T3' }, hide: ['wk', 'blk'], rows: [['running', 'T1']] },
        { note: 'The socket is registered with the reactor, and the worker moves on to T2.', hot: { rx: 'current', 'rt>rx': 'accent' }, sub: { w1: 'polling T2', q: 'T3', rx: 'T1 waits on fd 7' }, hide: ['blk'], rows: [['parked', 'T1']] },
        { note: 'epoll reports fd 7 readable, and T1’s waker puts it back on the queue.', hot: { wk: 'ok', 'rx>wk': 'accent', q: 'write' }, sub: { q: 'T3 T1', w1: 'polling T2' }, hide: ['blk'], rows: [['woken', 'T1', 'ok']] },
        { note: 'Blocking inside a task stalls a worker and every task behind it. Move blocking work to spawn_blocking.', hot: { blk: 'warn', w2: 'fail' }, sub: { w2: 'thread::sleep: stuck' }, rows: [['rule', 'never block a worker', 'warn']] },
      ],
    },
  ],
});

// ---------------- modules & Cargo ----------------
demo('rust-modules', 'Modules, crates & Cargo', 'The mod tree and use paths, Cargo.toml semver resolution, Cargo.lock, feature unification, workspaces.', {
  modtree: [
    'Module tree',
    {
      panel: 'Modules',
      nodes: [
        N('root', 355, 40, 290, 110, 'crate root', 'src/main.rs', { detail: D('Crate root', 'main.rs (binary) or lib.rs (library). Modules exist only if declared from here with mod.', '// src/main.rs\nmod net;   // loads src/net.rs\nmod db;    // loads src/db/mod.rs\n\nfn main() { net::http::get("x"); }') }),
        N('net', 40, 230, 290, 110, 'mod net', 'src/net.rs'),
        N('db', 670, 230, 290, 110, 'mod db', 'src/db/mod.rs'),
        N('http', 40, 420, 290, 110, 'mod http', 'src/net/http.rs', { detail: D('Nested module', 'Declared inside net.rs with pub mod http;', '// src/net.rs\npub mod http;\n\n// src/net/http.rs\npub fn get(url: &str) {}\nfn retry() {} // private to http') }),
        N('use', 355, 620, 290, 110, 'use', 'crate::net::http::get', { detail: D('use', 'Brings a path into scope. Paths start at crate::, self::, super:: or an external crate name.', 'use crate::net::http::get;\nuse super::config::Config;\nuse serde::{Deserialize, Serialize};') }),
        N('vis', 40, 810, 920, 120, 'visibility', 'private by default'),
      ],
      edges: ['root>net', 'root>db', 'net>http', 'use>http'],
      beats: [
        { note: 'A crate is one compilation unit with a root file. mod declarations build the module tree from there.', hot: { root: 'current', 'root>net': 'accent', 'root>db': 'accent' }, hide: ['http', 'use', 'vis'], rows: [['modules', 2]] },
        { note: 'mod net; loads src/net.rs, and pub mod http; inside it loads src/net/http.rs.', hot: { http: 'write', 'net>http': 'accent' }, hide: ['use', 'vis'], rows: [['modules', 3]] },
        { note: 'use crate::net::http::get brings that function into scope by its path.', hot: { use: 'current', 'use>http': 'accent' }, hide: ['vis'], rows: [['path', 'crate::net::http']] },
        { note: 'Everything is private by default. pub exposes an item, and pub(crate) exposes it only inside this crate.', hot: { vis: 'current' }, sub: { vis: 'pub · pub(crate) · pub(super)' }, rows: [['default', 'private']] },
      ],
    },
  ],
  cargo: [
    'Cargo resolution',
    {
      panel: 'Cargo',
      nodes: [
        N('toml', 40, 40, 440, 120, 'Cargo.toml', 'serde = "1.0"', { detail: D('Cargo.toml', '"1.0" means ^1.0: any 1.x at or above 1.0. Use "=1.0.3" to pin exactly.', '[dependencies]\nserde = { version = "1.0", features = ["derive"] }\ntokio = { version = "1", features = ["full"] }') }),
        N('idx', 520, 40, 440, 120, 'crates.io index'),
        N('res', 355, 240, 290, 110, 'resolver'),
        N('s1', 40, 420, 290, 110, 'serde 1.0.210'),
        N('s0', 670, 420, 290, 110, 'serde 0.9.15', 'via old-dep'),
        N('lock', 355, 610, 290, 110, 'Cargo.lock', 'not written yet'),
        N('tree', 40, 800, 920, 120, 'cargo tree -d', 'shows duplicate versions', { detail: D('cargo tree', 'Prints the resolved graph. -d lists crates built in more than one version.', '$ cargo tree -d\nserde v0.9.15\n└── old-dep v0.3.1\nserde v1.0.210\n└── app v0.1.0') }),
      ],
      edges: ['toml>res', 'idx>res', 'res>s1', 'res>s0', 'res>lock'],
      beats: [
        { note: 'serde = "1.0" is a caret requirement: any semver-compatible 1.x release.', hot: { toml: 'current' }, hide: ['s1', 's0', 'lock', 'tree'], rows: [['range', '>=1.0.0, <2.0.0']] },
        { note: 'The resolver picks the newest compatible version from the index, one per major version, shared by everything that needs it.', hot: { res: 'current', s1: 'ok', 'toml>res': 'accent', 'idx>res': 'accent', 'res>s1': 'accent' }, hide: ['s0', 'lock', 'tree'], rows: [['serde', '1.0.210', 'ok']] },
        { note: 'An old dependency needing serde 0.9 gets its own copy. Their types don’t mix, which shows up as confusing mismatch errors.', hot: { s0: 'warn', 'res>s0': 'warn' }, hide: ['lock', 'tree'], rows: [['serde copies', 2, 'warn']] },
        { note: 'Cargo.lock records the exact versions. Commit it for binaries so every build is identical, and use cargo update to move forward.', hot: { lock: 'current', 'res>lock': 'accent' }, sub: { lock: 'exact versions + hashes' }, hide: ['tree'], rows: [['reproducible', 'yes', 'ok']] },
        { note: 'cargo tree -d finds duplicates to consolidate.', hot: { tree: 'current' }, sub: { lock: 'exact versions + hashes' }, rows: [['tool', 'cargo tree']] },
      ],
    },
  ],
  features: [
    'Features',
    {
      panel: 'Features',
      nodes: [
        N('app', 355, 40, 290, 110, 'app'),
        N('a', 40, 230, 290, 110, 'crate a', 'tokio [net]'),
        N('b', 670, 230, 290, 110, 'crate b', 'tokio [fs]'),
        N('tok', 355, 420, 290, 110, 'tokio', 'built once', { detail: D('Feature flags', 'Optional code compiled in with #[cfg(feature = "...")]. Cargo builds each crate once with the union of requested features.', '[features]\ndefault = ["json"]\njson = ["dep:serde_json"]\n\n#[cfg(feature = "json")]\npub fn to_json() {}') }),
        N('opt', 40, 620, 920, 120, 'optional deps', 'a feature can enable a dependency'),
        N('rule', 40, 810, 920, 120, 'rule', 'features must be additive'),
      ],
      edges: ['app>a', 'app>b', 'a>tok', 'b>tok'],
      beats: [
        { note: 'Crate a enables tokio’s net feature, crate b its fs feature.', hot: { a: 'write', b: 'write' }, hide: ['opt', 'rule'], rows: [['requests', 2]] },
        { note: 'Cargo unifies them: tokio is built once with net and fs together.', hot: { tok: 'current', 'a>tok': 'accent', 'b>tok': 'accent' }, sub: { tok: 'net + fs' }, hide: ['opt', 'rule'], rows: [['tokio builds', 1, 'ok']] },
        { note: 'Features can also switch optional dependencies on, which keeps default builds small.', hot: { opt: 'current' }, sub: { tok: 'net + fs' }, hide: ['rule'], rows: [['default-features', 'opt out']] },
        { note: 'Since features combine across the graph, a feature must only add API. One that removes something breaks another crate.', hot: { rule: 'warn' }, sub: { tok: 'net + fs' }, rows: [['rule', 'additive', 'warn']] },
      ],
    },
  ],
  workspace: [
    'Workspaces',
    {
      panel: 'Workspace',
      nodes: [
        N('ws', 355, 40, 290, 110, 'workspace', 'Cargo.toml [workspace]', { detail: D('Workspace', 'Several crates developed together.', '[workspace]\nmembers = ["core", "server", "cli"]\nresolver = "2"\n\n[workspace.dependencies]\nserde = "1.0"') }),
        N('c1', 40, 230, 290, 110, 'core', 'lib'),
        N('c2', 355, 230, 290, 110, 'server', 'bin'),
        N('c3', 670, 230, 290, 110, 'cli', 'bin'),
        N('lock', 40, 440, 440, 110, 'one Cargo.lock'),
        N('tgt', 520, 440, 440, 110, 'one target/'),
        N('dep', 40, 640, 920, 120, 'path dependency', 'core = { path = "../core" }'),
      ],
      edges: ['ws>c1', 'ws>c2', 'ws>c3', 'c2>c1'],
      beats: [
        { note: 'A workspace groups crates that are versioned and built together.', hot: { ws: 'current', 'ws>c1': 'accent', 'ws>c2': 'accent', 'ws>c3': 'accent' }, hide: ['lock', 'tgt', 'dep'], rows: [['members', 3]] },
        { note: 'server depends on core by path, so an edit to core is picked up immediately.', hot: { c2: 'write', c1: 'write', 'c2>c1': 'accent' }, hide: ['lock', 'tgt'], rows: [['path deps', 1]] },
        { note: 'All members share one Cargo.lock and one target/ directory, so versions agree and nothing builds twice.', hot: { lock: 'ok', tgt: 'ok' }, rows: [['lock files', 1, 'ok']] },
        { note: 'cargo build -p server builds one member, and cargo test runs every member’s tests.', hot: { c2: 'current' }, rows: [['commands', '-p, --workspace']] },
      ],
    },
  ],
});
