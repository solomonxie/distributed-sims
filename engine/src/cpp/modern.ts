// Modern C++ (group cpp-modern): auto, lambdas, std::function, smart pointers, move & forwarding, templates, variadics,
// concepts, constexpr, optional/variant/expected, ranges, coroutines, exception safety, filesystem.
import type { Detail } from '../algo/frames';
import { framesDemo, machineDemo } from '../machine/lib/draw';
import { Mem, memDemo } from '../machine/lib/mem';
import { boardDemo as demo, N } from '../machine/lib/board';
import type { Board } from '../machine/lib/board';
import { traceFrames } from '../machine/lib/trace';
import type { Trace } from '../machine/lib/trace';
import { codeMapFrames } from '../machine/lib/code';
import type { CodeMap } from '../machine/lib/code';

const G = 'cpp-modern';
const D = (title: string, text: string, code?: string): Detail => ({ title, text, code });
const boardDemo = (slug: string, title: string, summary: string, boards: Record<string, [string, Board]>) => demo(G, slug, title, summary, boards);
function traceDemo(slug: string, title: string, summary: string, traces: Record<string, [label: string, trace: Trace]>) {
  machineDemo({
    slug,
    title,
    group: G,
    summary,
    inputs: Object.entries(traces).map(([id, [label]]) => ({ id, label, data: { k: id } })),
    build: ({ k }: { k: string }) => traceFrames(traces[k][1]),
  });
}

// ---------------- auto & type deduction ----------------
traceDemo('mod-auto', 'auto & type deduction', 'What auto deduces, why it drops const and references, auto& / const auto& / auto&&, and decltype.', {
  deduce: [
    'auto rules',
    {
      code: ['const int& r = x;        // x is an int', 'auto a = r;              // int (copy)', 'auto& b = r;             // const int&', 'const auto& c = x + 1;   // binds a temporary', 'auto&& d = x;            // int& (forwarding ref)'],
      details: {
        a: D('Plain auto', 'Plain auto deduces like a by-value template parameter: references and top-level const are dropped, so you get a copy.', 'const std::string& s = name;\nauto t = s;   // std::string, a copy'),
        b: D('auto&', 'Keeps const and binds to the original object. Use it to modify elements in a loop.', 'for (auto& x : v) x *= 2;'),
        c: D('const auto&', 'Binds to anything, even temporaries, without copying. Good default for read-only loops over big objects.', 'for (const auto& row : table) print(row);'),
        d: D('auto&&', 'A forwarding reference: lvalue in, lvalue reference out; rvalue in, rvalue reference out. Used in generic code.', 'for (auto&& x : range) use(x);'),
      },
      steps: [
        { line: 0, note: 'r is a const reference to an int.', vars: [['r', 'const int& → x', 'current']], rows: [['type of r', 'const int&']] },
        { line: 1, note: 'Plain auto drops the reference and the const: a is a fresh int copy.', vars: [['r', 'const int& → x'], ['a', 'int (copy)', 'write']], rows: [['type of a', 'int']] },
        { line: 2, note: 'auto& keeps const, so b is a const int& to x.', vars: [['r', 'const int& → x'], ['a', 'int (copy)'], ['b', 'const int& → x', 'write']], rows: [['type of b', 'const int&']] },
        { line: 3, note: 'const auto& can bind a temporary and extends its lifetime to c’s scope.', vars: [['a', 'int (copy)'], ['b', 'const int& → x'], ['c', 'const int& → temp', 'write']], rows: [['type of c', 'const int&']] },
        { line: 4, note: 'auto&& on an lvalue becomes int&. Rule of thumb: auto for small values, const auto& for big ones, auto& to modify.', vars: [['a', 'int (copy)'], ['b', 'const int& → x'], ['d', 'int& → x', 'ok']], rows: [['type of d', 'int&']] },
      ],
    },
  ],
  pitfalls: [
    'Pitfalls & decltype',
    {
      code: ['std::vector<bool> flags(8);', 'auto f = flags[0];        // proxy, not bool!', 'auto n = {1, 2, 3};       // initializer_list', 'decltype(x) y = 0;         // exactly x\'s type', 'decltype(auto) g() { return (x); }  // int&'],
      details: {
        f: D('vector<bool> proxy', 'vector<bool> packs bits, so operator[] returns a proxy object, not a bool&. auto copies the proxy, which still refers into the vector.', 'bool f = flags[0];   // force a real bool'),
        n: D('Brace + auto', 'auto x = {1, 2} deduces std::initializer_list<int>. auto x{1} is int since C++17.', 'auto a{1};     // int\nauto b = {1};  // initializer_list<int>'),
        y: D('decltype', 'decltype(name) gives the declared type exactly. decltype((expr)) with extra parentheses gives a reference for lvalues.', 'decltype(v.size()) n = 0;  // size_t'),
      },
      steps: [
        { line: [0, 1], note: 'vector<bool> returns a proxy, so f is not a bool and changes when flags does.', vars: [['f', 'vector<bool>::reference', 'warn']], rows: [['surprise', 'proxy type', 'warn']] },
        { line: 2, note: 'auto with = { } deduces an initializer_list.', vars: [['f', 'vector<bool>::reference', 'warn'], ['n', 'initializer_list<int>', 'warn']] },
        { line: 3, note: 'decltype reports the declared type exactly, reference and const included.', vars: [['y', 'int', 'ok']] },
        { line: 4, note: 'decltype(auto) keeps references, and (x) in parentheses is an lvalue expression, so g returns int&.', vars: [['y', 'int'], ['g()', 'int& → x', 'warn']], rows: [['use', 'generic wrappers only']] },
      ],
    },
  ],
});

// ---------------- lambdas ----------------
const CLOSURE = D('Closure object', 'A lambda is an unnamed struct with operator(). Each captured variable becomes a member: copies for [=], references for [&].', '// [n](int x) { return x + n; } is roughly:\nstruct __lambda {\n  int n;\n  int operator()(int x) const { return x + n; }\n};');
traceDemo('mod-lambda', 'Lambdas & captures', 'Lambdas as closure objects: capture by value vs by reference, mutable, and captures that dangle.', {
  capture: [
    'By value vs by reference',
    {
      code: ['int n = 1;', 'auto byVal = [n](int x) { return x + n; };', 'auto byRef = [&n](int x) { return x + n; };', 'n = 10;', 'std::cout << byVal(1) << " " << byRef(1);'],
      details: { byVal: CLOSURE, byRef: D('Capture by reference', 'The closure stores a reference (in practice a pointer) to n. It sees later changes, and dangles if n dies first.', 'int total = 0;\nstd::for_each(b, e, [&](int x) { total += x; });') },
      steps: [
        { line: 0, note: 'A local int.', vars: [['n', '1', 'current']], out: '' },
        { line: 1, note: 'byVal is a closure object holding its own copy of n, taken now.', vars: [['n', '1'], ['byVal', '{ n: 1 }', 'write']], out: '', rows: [['sizeof(byVal)', '4 B']] },
        { line: 2, note: 'byRef holds a reference to n itself.', vars: [['n', '1'], ['byVal', '{ n: 1 }'], ['byRef', '{ &n }', 'write']], out: '', rows: [['sizeof(byRef)', '8 B']] },
        { line: 3, note: 'Changing n affects only the reference capture.', vars: [['n', '10', 'write'], ['byVal', '{ n: 1 }'], ['byRef', '{ &n } sees 10', 'current']], out: '' },
        { line: 4, note: 'The copy still has 1, the reference sees 10.', vars: [['n', '10'], ['byVal', '{ n: 1 }', 'ok'], ['byRef', '{ &n }', 'ok']], out: '2 11' },
      ],
    },
  ],
  dangling: [
    'Dangling capture',
    {
      code: ['std::function<int()> make() {', '  int count = 5;', '  return [&count] { return count; };  // bug', '}', 'auto f = make();', 'std::cout << f();   // UB'],
      details: { f: D('Escaping lambda', 'A lambda that outlives the scope it came from must capture by value (or move in what it needs).', 'return [count] { return count; };\nreturn [p = std::move(ptr)] { use(*p); };'), count: D('Local variable', 'Lives in make()’s stack frame and dies when make returns.') },
      steps: [
        { line: 1, note: 'count lives in make()’s stack frame.', vars: [['count', '5', 'current']], out: '' },
        { line: 2, note: 'The returned lambda captures a reference to count.', vars: [['count', '5'], ['lambda', '{ &count }', 'warn']], out: '' },
        { line: 4, note: 'make returns and its frame is popped. f still holds the address of the dead count.', vars: [['f', '{ &count } dangling', 'fail']], out: '', rows: [['bug', 'dangling reference', 'fail']] },
        { line: 5, note: 'Calling f reads a dead stack slot. Capture by value when the lambda escapes: [count] or [=].', vars: [['f', '{ &count } dangling', 'fail']], out: '32767 (garbage)', rows: [['fix', '[count]', 'ok']] },
      ],
    },
  ],
  mutable: [
    'mutable & init-capture',
    {
      code: ['auto counter = [i = 0]() mutable { return ++i; };', 'counter(); counter();', 'std::cout << counter();', 'auto up = std::make_unique<int>(7);', 'auto g = [p = std::move(up)] { return *p; };'],
      details: { counter: D('mutable', 'operator() is const by default, so by-value captures are read-only. mutable lets the closure change its own copies.', 'auto next = [n = 0]() mutable { return n++; };'), g: D('Init-capture', '[name = expr] creates a new member initialised by any expression, including moves of move-only types.', 'auto task = [buf = std::move(buffer)]() {\n  send(buf);\n};') },
      steps: [
        { line: 0, note: 'Init-capture [i = 0] creates a member i. mutable lets the call modify it.', vars: [['counter', '{ i: 0 }', 'current']], out: '' },
        { line: [1, 2], note: 'Each call increments the closure’s own i, so the lambda keeps state between calls.', vars: [['counter', '{ i: 3 }', 'write']], out: '3' },
        { line: [3, 4], note: 'Move-only things like unique_ptr can be moved into a closure with init-capture.', vars: [['counter', '{ i: 3 }'], ['up', 'nullptr', 'visited'], ['g', '{ p: unique_ptr → 7 }', 'ok']], out: '3', rows: [['ownership', 'moved into g', 'ok']] },
      ],
    },
  ],
});

// ---------------- std::function vs templates ----------------
boardDemo('mod-function', 'std::function vs templates', 'Type erasure: std::function stores any callable behind one type at the cost of an indirect call and maybe a heap allocation; templates inline.', {
  compare: [
    'Two ways to take a callback',
    {
      panel: 'Callbacks',
      code: ['void run(std::function<int(int)> f);   // erased', 'template <class F> void run2(F f);     // generic', 'run([k](int x) { return x * k; });', 'run2([k](int x) { return x * k; });'],
      nodes: [
        N('lam', 40, 230, 920, 110, 'lambda closure', '{ k }', { detail: D('The callable', 'Every lambda has its own unique type. Something has to decide how to store and call it.') }),
        N('fn', 40, 420, 440, 150, 'std::function', 'stores any callable', { detail: D('std::function', 'One concrete type that can hold any callable with a matching signature. Stores small callables inline, bigger ones on the heap, and calls through a function pointer.', 'std::vector<std::function<void()>> handlers;\nhandlers.push_back([] { … });\nhandlers.push_back(&free_fn);') }),
        N('tp', 520, 420, 440, 150, 'template F', 'one copy per lambda type', { detail: D('Template parameter', 'The compiler stamps out run2 for this exact lambda type, so the call is direct and usually inlined.', 'template <std::invocable<int> F>\nint apply(F&& f) { return f(1); }') }),
        N('heap', 40, 640, 440, 130, 'heap copy', 'if the closure is big', { detail: D('Allocation', 'Closures bigger than std::function’s inline buffer (typically 16–32 bytes) are heap-allocated.') }),
        N('call', 40, 830, 440, 130, 'indirect call', 'not inlinable', { detail: D('Indirect call', 'Calls go through a stored function pointer, which blocks inlining.') }),
        N('inl', 520, 640, 440, 130, 'direct call', 'inlined: x * k', { detail: D('Inlined', 'The body lands right at the call site, same as hand-written code.') }),
        N('bloat', 520, 830, 440, 130, 'code per type', 'compile time + size', { detail: D('Instantiations', 'Each distinct lambda type creates another copy of run2. Fine for small functions, heavy for big ones.') }),
      ],
      edges: ['lam>fn', 'lam>tp', 'fn>heap', 'heap>call', 'tp>inl', 'inl>bloat'],
      beats: [
        { note: 'Every lambda has its own unique type. A function taking a callback must either erase that type or be a template.', hl: [0, 1], hot: { lam: 'current' }, hide: ['heap', 'call', 'inl', 'bloat'] },
        { note: 'std::function erases the type: one signature, any callable, stored inline or on the heap.', hl: [2], hot: { fn: 'current', heap: 'warn', 'lam>fn': 'accent', 'fn>heap': 'accent' }, hide: ['inl', 'bloat', 'call'], rows: [['allocation', 'maybe', 'warn']] },
        { note: 'Each call goes through a pointer, so the compiler can’t inline it.', hot: { call: 'warn', 'heap>call': 'accent' }, hide: ['inl', 'bloat'], rows: [['call', 'indirect', 'warn']] },
        { note: 'A template takes the exact type, so the call is direct and inlined. The cost is code per lambda type.', hl: [3], hot: { tp: 'current', inl: 'ok', bloat: 'warn', 'lam>tp': 'accent', 'tp>inl': 'accent', 'inl>bloat': 'accent' }, rows: [['call', 'inlined', 'ok']] },
        { note: 'Store callbacks (member variables, containers) as std::function. Take them in hot functions as templates.', hot: { fn: 'ok', tp: 'ok' }, rows: [['store', 'std::function'], ['hot path', 'template']] },
      ],
    },
  ],
});

// ---------------- smart pointers ----------------
const UP = D('std::unique_ptr', 'Sole owner of a heap object. Same size as a raw pointer; deletes the object in its destructor. Can be moved, never copied.', 'auto p = std::make_unique<Widget>(42);\nauto q = std::move(p);   // p is null now\n// Widget deleted when q goes out of scope');
const SP = D('std::shared_ptr', 'Two pointers: one to the object, one to a control block holding the strong and weak counts. The last strong owner deletes the object.', 'auto a = std::make_shared<Widget>();\nauto b = a;          // strong = 2\na.reset();           // strong = 1');
const CB = D('Control block', 'Heap block with the strong count, the weak count and the deleter. Counts change with atomic increments, so copying a shared_ptr is not free.', '// make_shared: one allocation for\n// control block + object together');
const WP = D('std::weak_ptr', 'Observes without owning: bumps only the weak count. lock() gives a shared_ptr if the object is still alive.', 'std::weak_ptr<Node> parent;\nif (auto p = parent.lock()) use(*p);');
const SD: Record<string, Detail> = {
  p: UP,
  q: UP,
  arg: UP,
  w: D('Widget on the heap', 'Exactly one unique_ptr points at it. When that owner dies, it is deleted.'),
  a: SP,
  b: SP,
  c: SP,
  cb: CB,
  sw: D('Widget', 'With make_shared it sits in the same allocation as the control block.'),
  na: D('Node A', 'Its strong count is how many shared_ptrs point at it. It dies at 0.'),
  nb: D('Node B', 'Owned by A’s next and by the local b.'),
  bprev: WP,
  anext: SP,
};

function smartUnique() {
  const m = new Mem({ panel: 'unique_ptr', details: SD }).region('main', 'main() · stack frame').region('heap', 'heap');
  m.v('w', 'heap', 1, 'Widget', '0x500', '42').v('p', 'main', 0, 'p', '0x7f0', '0x500', { to: 'w' });
  m.snap('p owns a Widget. One arrow into it means one owner.', 'auto p = std::make_unique<Widget>(42);', { rows: [['owners', 1]] });
  m.v('q', 'main', 1, 'q', '0x7f8', '0x500', { to: 'w' }).set('p', 'null', null);
  m.snap('Moving hands the arrow over: q points at it and p becomes null. Still one owner.', 'auto q = std::move(p);', { fly: ['p', 'q'], rows: [['owners', 1], ['p', 'null']] });
  m.snap('A copy would make two owners that both delete. The compiler refuses.', 'auto r = q;   // error: copy deleted', { hot: { q: 'fail' }, rows: [['copy', 'compile error', 'fail']] });
  m.region('take', 'take(unique_ptr<Widget> arg) · stack frame').v('arg', 'take', 0, 'arg', '0x7c0', '0x500', { to: 'w' }).set('q', 'null', null);
  m.snap('Passing by value moves ownership into the function.', 'take(std::move(q));', { fly: ['q', 'arg'], rows: [['owner', 'take()']] });
  m.kill('take', 'take() returned').free('w');
  m.snap('When take returns, arg is destroyed and deletes the Widget. No leak, no double delete.', '}   // ~unique_ptr → delete', { rows: [['leaks', 0, 'ok'], ['overhead', 'same as a raw pointer', 'ok']] });
  return m;
}

function smartShared() {
  const m = new Mem({ panel: 'shared_ptr', details: SD }).region('main', 'main() · stack frame').region('heap', 'heap · one allocation', { tight: true });
  m.v('cb', 'heap', 1, 'control', '0x500', 'strong 1').v('sw', 'heap', 2, 'Widget', '0x510', '{…}').v('a', 'main', 0, 'a', '0x7f0', '0x500', { to: 'cb' });
  m.snap('make_shared puts a control block next to the Widget. Its count is the number of shared_ptrs.', 'auto a = std::make_shared<Widget>();', { rows: [['strong', 1]] });
  m.v('b', 'main', 1, 'b', '0x7f8', '0x500', { to: 'cb' }).set('cb', 'strong 2');
  m.snap('Copying adds an arrow, and the count goes up by an atomic increment.', 'auto b = a;', { fly: ['a', 'b'], rows: [['strong', 2]] });
  m.region('blk', '{ inner block }').v('c', 'blk', 2, 'c', '0x7d0', '0x500', { to: 'cb' }).set('cb', 'strong 3');
  m.snap('One more copy inside a block: 3 arrows, count 3.', '{ auto c = b;', { rows: [['strong', 3]] });
  m.kill('blk', 'block ended').set('cb', 'strong 2');
  m.snap('At the brace c is destroyed, and the count drops back to 2.', '}', { rows: [['strong', 2]] });
  m.drop('blk').set('a', 'null', null).set('cb', 'strong 1');
  m.snap('reset() removes a’s arrow. The Widget lives on, because b still points at it.', 'a.reset();', { rows: [['strong', 1]] });
  m.set('b', 'null', null).set('cb', 'strong 0').free('cb').free('sw');
  m.snap('The last arrow is gone, so the count hits 0 and the Widget is destroyed.', 'b.reset();', { rows: [['strong', 0, 'ok'], ['copy cost', 'atomic inc/dec', 'warn']] });
  return m;
}

function smartWeak() {
  const m = new Mem({ panel: 'Cycles', details: SD }).region('main', 'main() · stack frame').region('heap', 'heap');
  const nodes = (weak: boolean) => {
    m.v('na', 'heap', 0, 'Node A', '0x500', 'strong 1').v('anext', 'heap', 1, 'A.next', '0x508', 'null', { lv: 1 });
    m.v('nb', 'heap', 3, 'Node B', '0x600', 'strong 1').v('bprev', 'heap', 4, 'B.prev', '0x608', 'null', { lv: 1, weak });
    m.v('a', 'main', 0, 'a', '0x7f0', '0x500', { to: 'na' }).v('b', 'main', 3, 'b', '0x7f8', '0x600', { to: 'nb' });
  };
  nodes(false);
  m.snap('Two nodes, each owned by a local shared_ptr.', 'auto a = make_shared<Node>(), b = make_shared<Node>();', { rows: [['A', 'strong 1'], ['B', 'strong 1']] });
  m.set('anext', '0x600', 'nb').set('nb', 'strong 2').snap('A.next owns B, so B’s count is 2.', 'a->next = b;', { rows: [['B', 'strong 2']] });
  m.set('bprev', '0x500', 'na').set('na', 'strong 2').snap('If B.prev is a shared_ptr too, A’s count becomes 2. Each node now owns the other.', 'b->prev = a;   // shared_ptr', { rows: [['A', 'strong 2'], ['B', 'strong 2']] });
  m.set('a', 'null', null).set('b', 'null', null).set('na', 'strong 1').set('nb', 'strong 1');
  m.snap('Drop a and b. Each count only falls to 1, held up by the other node: both leak.', 'a.reset(); b.reset();', { hot: { na: 'fail', nb: 'fail' }, rows: [['leaked', 'A and B', 'fail']] });
  m.drop('heap').region('heap', 'heap');
  nodes(true);
  m.set('anext', '0x600', 'nb').set('nb', 'strong 2').set('bprev', '0x500', 'na');
  m.snap('Fix: make B.prev a weak_ptr. It points at A without counting, so A stays at 1.', 'std::weak_ptr<Node> prev;', { rows: [['A', 'strong 1'], ['B', 'strong 2']] });
  m.set('a', 'null', null).set('na', 'strong 0').free('na').free('anext').set('nb', 'strong 1');
  m.snap('Dropping a takes A to 0, so A dies, and its next releases B.', 'a.reset();', { rows: [['A', 'destroyed', 'ok'], ['B', 'strong 1']] });
  m.set('b', 'null', null).set('nb', 'strong 0').free('nb').free('bprev');
  m.snap('Dropping b frees B. Use weak_ptr for back-links, parents and caches.', 'b.reset();', { rows: [['leaks', 0, 'ok']] });
  return m;
}

memDemo(G, 'mod-smart', 'Smart pointers in depth', 'Ownership drawn as arrows: unique_ptr hands its one arrow over, shared_ptr counts arrows, weak_ptr points without counting.', {
  unique: ['unique_ptr', smartUnique],
  shared: ['shared_ptr & control block', smartShared],
  weak: ['Cycles & weak_ptr', smartWeak],
});

// ---------------- move & forwarding ----------------
const MD: Record<string, Detail> = {
  a: D('std::string', 'A small object holding a pointer, a size and a capacity. Long text lives in a heap buffer.', 'sizeof(std::string);  // 32 on libstdc++'),
  buf: D('Heap buffer', 'The characters. Copying a string copies these; moving just hands over the pointer.'),
  buf2: D('Second buffer', 'A copy allocates its own buffer and copies every byte.'),
  c: D('Moved-into string', 'Took a’s pointer and size. No allocation, no byte copied.'),
  src: D('Moved-from object', 'After the move its pointer is null, so its destructor deletes nothing.'),
  dst: D('noexcept move', 'vector only uses your move constructor when growing if it is noexcept; otherwise it copies to stay exception-safe.', 'Buffer(Buffer&&) noexcept;\n// = default works when members are movable'),
  blk: D('The buffer', 'Only one Buffer owns it at a time.'),
};

function moveRvalue() {
  const m = new Mem({ panel: 'Copy vs move', details: MD }).region('main', 'main() · stack frame').region('heap', 'heap');
  m.v('buf', 'heap', 0, 'chars', '0x500', '"a long…"').v('a', 'main', 0, 'a', '0x7f0', '0x500', { to: 'buf' });
  m.snap('A long string keeps its characters on the heap. a just holds a pointer to them.', 'std::string a = "a long string…";', { rows: [['heap buffers', 1]] });
  m.v('buf2', 'heap', 2, 'chars', '0x540', '"a long…"').v('b', 'main', 1, 'b', '0x810', '0x540', { to: 'buf2' });
  m.snap('Copying allocates a second buffer and copies every byte.', 'std::string b = a;        // copy', { fly: ['buf', 'buf2'], rows: [['allocations', 1, 'warn'], ['bytes copied', 'all']] });
  m.v('c', 'main', 2, 'c', '0x830', '0x500', { to: 'buf' }).set('a', 'empty', null);
  m.snap('Moving copies only the pointer, then empties a. The characters never move.', 'std::string c = std::move(a);', { fly: ['a', 'c'], rows: [['allocations', 0, 'ok'], ['bytes copied', 0, 'ok']] });
  m.snap('a is still a valid, empty string you can reuse. std::move was only a cast that allowed the steal.', 'a = "reuse me";   // fine', { hot: { a: 'visited' }, rows: [['std::move', 'cast to &&'], ['the move ctor', 'does the stealing']] });
  return m;
}

function moveRule5() {
  const m = new Mem({ panel: 'Rule of five', details: MD }).region('main', 'main() · stack frame').region('heap', 'heap');
  m.v('blk', 'heap', 1, '64 bytes', '0x500', 'data…').v('src', 'main', 0, 'src.p', '0x7f0', '0x500', { to: 'blk' });
  m.snap('Buffer owns raw memory through p, so it must write all five special members.', 'class Buffer { char* p; size_t n; … };', { rows: [['special members', 5]] });
  m.v('dst', 'main', 2, 'dst.p', '0x810', '0x500', { to: 'blk' });
  m.snap('The move constructor copies src’s pointer…', 'Buffer(Buffer&& o) noexcept : p(o.p)', { fly: ['src', 'dst'], rows: [['owners', 2, 'warn']] });
  m.set('src', 'null', null);
  m.snap('…and sets src’s to null. Exactly one owner again.', '  { o.p = nullptr; }   // std::exchange', { rows: [['owners', 1, 'ok']] });
  m.free('src').snap('src’s destructor runs delete[] on null, which does nothing.', '~Buffer() { delete[] p; }   // src', { rows: [['deletes', 0]] });
  m.free('dst').free('blk').snap('dst’s destructor frees the block, once. Simpler still: hold a vector and write none of the five.', '~Buffer() { delete[] p; }   // dst', { rows: [['deletes', 1, 'ok'], ['rule of zero', 'std::vector<char>', 'ok']] });
  return m;
}

const FWD: Record<string, [label: string, trace: Trace]> = {
  forward: [
    'Perfect forwarding',
    {
      code: ['template <class T, class... Args>', 'std::unique_ptr<T> make(Args&&... args) {', '  return std::unique_ptr<T>(', '      new T(std::forward<Args>(args)...));', '}', 'make<Person>(name, std::string("x"));'],
      details: { args: D('Forwarding reference', 'Args&& in a template deduces lvalue or rvalue from the argument. std::forward restores that category when passing on.', 'template <class F, class... A>\ndecltype(auto) call(F&& f, A&&... a) {\n  return std::forward<F>(f)(\n      std::forward<A>(a)...);\n}') },
      steps: [
        { line: 5, note: 'One lvalue and one temporary go into make.', vars: [['name', 'lvalue string', 'current'], ['tmp', 'rvalue string', 'current']] },
        { line: 1, note: 'Args&& deduces string& for name and string&& for the temporary.', vars: [['args[0]', 'std::string&', 'write'], ['args[1]', 'std::string&&', 'write']] },
        { line: 3, note: 'Inside, both have names, so both are lvalues. std::forward casts each back to what it was.', vars: [['args[0]', '→ copied', 'default'], ['args[1]', '→ moved', 'ok']], rows: [['copies', 1], ['moves', 1, 'ok']] },
        { line: 3, note: 'That is how make_unique, emplace_back and std::thread pass arguments on without extra copies.', vars: [['result', 'unique_ptr<Person>', 'ok']] },
      ],
    },
  ],
};
framesDemo(G, 'mod-move', 'Move semantics & perfect forwarding', 'Copy vs move drawn in memory: who points at the heap buffer, what std::move really does, the rule of five, and std::forward.', {
  rvalue: ['Copy vs move', () => moveRvalue().frames()],
  rule5: ['Rule of five', () => moveRule5().frames()],
  forward: [FWD.forward[0], () => traceFrames(FWD.forward[1])],
});

// ---------------- templates ----------------
boardDemo('mod-templates', 'Templates', 'Function and class templates, instantiation per type, full and partial specialization, CTAD, and where template code must live.', {
  instantiate: [
    'Instantiation',
    {
      panel: 'Templates',
      code: ['template <class T>', 'T max_of(T a, T b) { return a < b ? b : a; }', 'max_of(3, 7);          // T = int', 'max_of(2.5, 1.0);      // T = double', 'max_of<std::string>("a", "b");'],
      nodes: [
        N('tpl', 40, 250, 920, 110, 'template max_of<T>', 'a pattern, no code yet', { detail: D('Template', 'A recipe the compiler fills in per type. Nothing is emitted until it is used.', 'template <class T>\nT max_of(T a, T b);') }),
        N('i1', 40, 440, 290, 120, 'max_of<int>', 'cmp + cmov', { detail: D('Instantiation', 'Real machine code for T = int, generated at the first use in this translation unit.') }),
        N('i2', 355, 440, 290, 120, 'max_of<double>', 'maxsd', { detail: D('Instantiation', 'A separate function for doubles, with float instructions.') }),
        N('i3', 670, 440, 290, 120, 'max_of<string>', 'calls compare()', { detail: D('Instantiation', 'Works because std::string has operator<. A type without it fails to compile here.') }),
        N('hdr', 40, 640, 920, 130, 'must be in the header', 'callers need the body', { detail: D('Header-only', 'Each translation unit that instantiates a template needs the full definition, so templates live in headers. Duplicate instantiations are merged by the linker.', '// widget.h\ntemplate <class T>\nvoid log(const T& x) { std::cout << x; }') }),
      ],
      edges: ['tpl>i1', 'tpl>i2', 'tpl>i3'],
      beats: [
        { note: 'A template is a pattern. Nothing is compiled until someone uses it with a type.', hl: [0, 1], hot: { tpl: 'current' }, hide: ['i1', 'i2', 'i3', 'hdr'] },
        { note: 'Each use deduces T and stamps out a separate function.', hl: [2, 3], hot: { i1: 'write', i2: 'write', 'tpl>i1': 'accent', 'tpl>i2': 'accent' }, hide: ['i3', 'hdr'], rows: [['instantiations', 2]] },
        { note: 'You can name T explicitly. The body must compile for that type, or you get an error inside the template.', hl: [4], hot: { i3: 'write', 'tpl>i3': 'accent' }, hide: ['hdr'], rows: [['instantiations', 3]] },
        { note: 'Because callers need the body to instantiate it, templates are defined in headers.', hot: { hdr: 'warn' }, rows: [['location', 'header']] },
      ],
    },
  ],
  specialize: [
    'Specialization & CTAD',
    {
      panel: 'Templates',
      code: ['template <class T> struct Hash { size_t operator()(T); };', 'template <> struct Hash<bool> { /* 2 values */ };', 'template <class T> struct Hash<T*> { /* by address */ };', 'std::pair p{1, 2.5};   // CTAD: pair<int, double>'],
      nodes: [
        N('prim', 40, 240, 920, 110, 'primary template', 'Hash<T>', { detail: D('Primary template', 'The general case, used when nothing more specific matches.') }),
        N('full', 40, 420, 440, 130, 'full specialization', 'Hash<bool>', { detail: D('Full specialization', 'A completely separate implementation for one exact type. This is how std::hash<std::string> is provided.', 'template <>\nstruct std::hash<Point> {\n  size_t operator()(const Point& p) const;\n};') }),
        N('part', 520, 420, 440, 130, 'partial specialization', 'Hash<T*>', { detail: D('Partial specialization', 'Matches a family of types, like any pointer. Only class templates can be partially specialized.') }),
        N('ctad', 40, 630, 920, 130, 'CTAD (C++17)', 'pair p{1, 2.5}', { detail: D('Class template argument deduction', 'Constructor arguments deduce the class template’s parameters, so you can drop the <...>.', 'std::vector v{1, 2, 3};      // vector<int>\nstd::lock_guard lk(m);       // lock_guard<mutex>') }),
      ],
      edges: ['prim>full', 'prim>part'],
      beats: [
        { note: 'The primary template handles the general case.', hl: [0], hot: { prim: 'current' }, hide: ['full', 'part', 'ctad'] },
        { note: 'A full specialization replaces it for one exact type, like hashing your own key type.', hl: [1], hot: { full: 'write', 'prim>full': 'accent' }, hide: ['part', 'ctad'] },
        { note: 'A partial specialization covers a family, like all pointers. The most specific match wins.', hl: [2], hot: { part: 'write', 'prim>part': 'accent' }, hide: ['ctad'] },
        { note: 'CTAD deduces class template arguments from the constructor, so pair p{1, 2.5} needs no angle brackets.', hl: [3], hot: { ctad: 'ok' } },
      ],
    },
  ],
});

// ---------------- variadic ----------------
traceDemo('mod-variadic', 'Variadic templates & folds', 'Parameter packs, pack expansion, and C++17 fold expressions replacing recursive templates.', {
  fold: [
    'Fold expressions',
    {
      code: ['template <class... Ts>', 'auto sum(Ts... xs) { return (xs + ... + 0); }', 'template <class... Ts>', 'void print(const Ts&... xs) {', '  ((std::cout << xs << " "), ...);', '}', 'sum(1, 2, 3);', 'print("id", 42, 3.5);'],
      details: { xs: D('Parameter pack', 'Ts... is a list of types and xs... a list of values. sizeof...(xs) gives the count.', 'template <class... Ts>\nconstexpr size_t count(Ts...) { return sizeof...(Ts); }'), result: D('Fold expression', '(xs + ... + 0) expands to x1 + (x2 + (x3 + 0)) at compile time. No recursion, no runtime loop.', '(... && preds(x))   // all of\n(v.push_back(xs), ...);  // comma fold') },
      steps: [
        { line: 6, note: 'sum(1, 2, 3) deduces Ts = int, int, int.', vars: [['xs', '{1, 2, 3}', 'current']], out: '', rows: [['sizeof...(xs)', 3]] },
        { line: 1, note: 'The fold expands at compile time into 1 + (2 + (3 + 0)).', vars: [['xs', '{1, 2, 3}'], ['result', '6', 'ok']], out: '', rows: [['runtime loop', 'none', 'ok']] },
        { line: [4, 7], note: 'A comma fold runs an expression once per argument, in order, across different types.', vars: [['xs', '{"id", 42, 3.5}', 'current']], out: 'id 42 3.5 ', rows: [['types', 'const char*, int, double']] },
        { line: 4, note: 'Folds replaced the old recursive head/tail templates. std::make_tuple and printf-style loggers are built on them.', vars: [['xs', '{"id", 42, 3.5}', 'ok']], out: 'id 42 3.5 ' },
      ],
    },
  ],
});

// ---------------- SFINAE → concepts ----------------
boardDemo('mod-concepts', 'SFINAE & concepts', 'Constraining templates: enable_if tricks, then C++20 concepts and requires clauses with readable errors.', {
  concepts: [
    'Constraining a template',
    {
      panel: 'Constraints',
      code: ['template <class T>', '  requires std::integral<T>', 'T gcd(T a, T b) { return b ? gcd(b, a % b) : a; }', 'gcd(12, 18);      // ok', 'gcd(1.5, 2.5);    // error: not integral'],
      nodes: [
        N('call1', 40, 300, 440, 120, 'gcd(12, 18)', 'T = int', { detail: D('Satisfied', 'int is integral, so this overload is viable.') }),
        N('call2', 520, 300, 440, 120, 'gcd(1.5, 2.5)', 'T = double', { detail: D('Not satisfied', 'double fails std::integral, so the template is removed from overload resolution.') }),
        N('ok', 40, 490, 440, 120, 'compiles', 'returns 6', { detail: D('Result', 'Instantiated for int and runs normally.') }),
        N('err', 520, 490, 440, 120, 'one clear error', 'integral<double> is false', { detail: D('Concept error', 'The compiler names the unmet constraint instead of dumping errors from deep inside the body.', 'error: no matching function for call to gcd\nnote: constraints not satisfied\nnote: the expression is_integral_v<T>\n      evaluated to false') }),
        N('old', 40, 680, 920, 130, 'before C++20: SFINAE', 'std::enable_if_t<…, int> = 0', { detail: D('SFINAE', 'Substitution failure is not an error: if substituting T makes a signature invalid, that overload silently drops out. enable_if abuses this to constrain templates.', 'template <class T,\n  std::enable_if_t<\n    std::is_integral_v<T>, int> = 0>\nT gcd(T a, T b);') }),
        N('own', 40, 850, 920, 120, 'your own concept', 'concept Shape = requires(T s) { s.area(); }', { detail: D('Defining a concept', 'A named, reusable set of requirements.', 'template <class T>\nconcept Shape = requires(const T& s) {\n  { s.area() } -> std::convertible_to<double>;\n};\ndouble total(const std::vector<Shape auto>&);') }),
      ],
      edges: ['call1>ok', 'call2>err'],
      beats: [
        { note: 'Without constraints, gcd(1.5, 2.5) fails deep inside the body on %, with a long confusing error.', hl: [2], hot: { call2: 'warn' }, hide: ['ok', 'err', 'old', 'own'] },
        { note: 'requires std::integral<T> states the rule up front. int passes.', hl: [1, 3], hot: { call1: 'current', ok: 'ok', 'call1>ok': 'accent' }, hide: ['err', 'old', 'own'], rows: [['int', 'ok', 'ok']] },
        { note: 'double fails the concept, so the error names the constraint instead of the body.', hl: [4], hot: { call2: 'fail', err: 'fail', 'call2>err': 'fail' }, hide: ['old', 'own'], rows: [['double', 'rejected', 'fail']] },
        { note: 'Before C++20 the same was done with SFINAE and enable_if. You’ll still read a lot of it.', hot: { old: 'warn' }, hide: ['own'] },
        { note: 'Define your own concepts to document what a template expects.', hot: { own: 'ok' }, rows: [['errors', 'readable', 'ok']] },
      ],
    },
  ],
});

// ---------------- constexpr ----------------
const CONSTEXPR: Record<string, CodeMap> = {
  fib: {
    srcTitle: 'C++',
    asmTitle: 'x86-64 · g++ -O2',
    src: ['constexpr int fib(int n) {', '  return n < 2 ? n : fib(n - 1) + fib(n - 2);', '}', 'int main() {', '  constexpr int f = fib(20);', '  return f;', '}'],
    asm: ['main:', '  mov  eax, 6765', '  ret'],
    intro: 'constexpr lets a function run at compile time when its inputs are constants.',
    steps: [
      { src: [0, 1, 2], asm: [], note: 'fib is an ordinary recursive function marked constexpr.' },
      { src: [4], asm: [1], note: 'constexpr int f forces evaluation during compilation. All 21,891 calls happen inside the compiler.' },
      { src: [5], asm: [2], note: 'main just returns the constant 6765.' },
    ],
    outro: 'Use it for lookup tables, parsing constants and checks, and static_assert results to prove them at build time.',
  },
  consteval: {
    srcTitle: 'C++20',
    asmTitle: 'x86-64 · g++ -O2',
    src: ['consteval unsigned hash(std::string_view s) {', '  unsigned h = 2166136261u;', '  for (char c : s) h = (h ^ c) * 16777619u;', '  return h;', '}', 'switch (hash(cmd)) { case hash("get"): … }'],
    asm: ['  ; case labels are plain integers', '  cmp  eax, 0x1D9F1F1B   ; hash("get")', '  je   .Lget', '  cmp  eax, 0x4E7A0C9D   ; hash("put")', '  je   .Lput'],
    intro: 'consteval goes further: the function may only run at compile time.',
    steps: [
      { src: [0, 1, 2, 3], asm: [], note: 'An FNV-1a string hash, marked consteval.' },
      { src: [5], asm: [1, 2, 3, 4], note: 'hash("get") becomes an integer constant, so string commands can be switch case labels.' },
    ],
    outro: 'Calling a consteval function with a runtime value is a compile error, which guarantees no runtime cost.',
  },
};
machineDemo({
  slug: 'mod-constexpr',
  title: 'constexpr & consteval',
  group: G,
  summary: 'Moving work to compile time: constexpr functions folded to constants, consteval that can only run in the compiler.',
  inputs: [
    { id: 'fib', label: 'constexpr fib', data: { m: 'fib' } },
    { id: 'consteval', label: 'consteval hash', data: { m: 'consteval' } },
  ],
  build: ({ m }: { m: string }) => codeMapFrames(CONSTEXPR[m]),
});

// ---------------- optional / variant / expected ----------------
boardDemo('mod-sumtypes', 'optional, variant & expected', 'Vocabulary types: a value that may be absent, one of several types, or a value-or-error without exceptions.', {
  optional: [
    'std::optional',
    {
      panel: 'optional',
      code: ['std::optional<User> find(int id);', 'if (auto u = find(7)) std::cout << u->name;', 'int port = cfg.port.value_or(8080);'],
      nodes: [
        N('has', 40, 220, 440, 150, 'engaged', 'bool true + User', { detail: D('Engaged optional', 'Stores the value inline plus a bool flag. No heap allocation.', 'std::optional<int> o = 5;\no.has_value();  // true\n*o;             // 5') }),
        N('none', 520, 220, 440, 150, 'std::nullopt', 'bool false', { detail: D('Empty optional', 'The storage is there but holds no object. *o on it is UB; o.value() throws bad_optional_access.', 'std::optional<int> o;\no.value_or(0);  // 0') }),
        N('lay', 40, 440, 920, 150, 'layout', 'sizeof(User) + 1, padded', { detail: D('Layout', 'optional<T> is T’s bytes plus a flag. Much cheaper than returning a pointer to a heap object.') }),
        N('use', 40, 660, 920, 150, 'instead of', '-1, nullptr, bool + out-param', { detail: D('Why', 'Makes "maybe no result" part of the type, so callers can’t forget to check.') }),
      ],
      edges: [],
      beats: [
        { note: 'optional<T> holds a T or nothing. find returns one instead of a magic value.', hl: [0], hot: { has: 'current', none: 'current' }, hide: ['lay', 'use'] },
        { note: 'It converts to bool, so checking and unpacking fit in one if.', hl: [1], hot: { has: 'ok' }, hide: ['lay', 'use'] },
        { note: 'The value lives inline next to a flag. No heap allocation.', hot: { lay: 'current' }, hide: ['use'], rows: [['allocations', 0, 'ok']] },
        { note: 'value_or supplies defaults. Use optional wherever you’d have returned -1 or nullptr.', hl: [2], hot: { use: 'ok' } },
      ],
    },
  ],
  variant: [
    'std::variant',
    {
      panel: 'variant',
      code: ['using Msg = std::variant<Ping, Text, Close>;', 'std::visit(overloaded{', '  [](const Ping&) { pong(); },', '  [](const Text& t) { show(t.body); },', '  [](const Close&) { disconnect(); } }, msg);'],
      nodes: [
        N('tag', 40, 280, 290, 150, 'index', '0 · 1 · 2', { detail: D('Discriminator', 'variant stores which alternative is active, like a tagged union. msg.index() returns it.') }),
        N('store', 355, 280, 605, 150, 'storage', 'max(sizeof Ping, Text, Close)', { detail: D('Inline storage', 'Big enough for the largest alternative; no heap. Switching type destroys the old value and constructs the new one.', 'Msg m = Ping{};\nm = Text{"hi"};   // Ping destroyed\nstd::get<Text>(m).body;') }),
        N('vis', 40, 500, 920, 150, 'std::visit', 'calls the matching lambda', { detail: D('visit', 'Dispatches on the index with a jump table. If you forget an alternative, it fails to compile.', 'template <class... F>\nstruct overloaded : F... { using F::operator()...; };') }),
        N('vs', 40, 720, 920, 150, 'vs virtual classes', 'closed set, value semantics, no heap', { detail: D('When to use', 'variant fits a closed set of types known up front, like protocol messages or AST nodes. Virtual functions fit open sets that plugins extend.') }),
      ],
      edges: ['tag>store'],
      beats: [
        { note: 'A variant holds exactly one of several types: a type-safe union with an index.', hl: [0], hot: { tag: 'current', store: 'current' }, hide: ['vis', 'vs'], rows: [['alternatives', 3]] },
        { note: 'std::visit dispatches on the active type. Missing a case is a compile error, not a runtime bug.', hl: [1, 2, 3, 4], hot: { vis: 'ok' }, hide: ['vs'], rows: [['exhaustive', 'yes', 'ok']] },
        { note: 'Compared with a class hierarchy: no heap, no vtables, but the set of types is closed.', hot: { vs: 'current' }, rows: [['allocations', 0, 'ok']] },
      ],
    },
  ],
  expected: [
    'std::expected',
    {
      panel: 'expected',
      code: ['std::expected<Config, std::string> load(path p);', 'auto cfg = load("app.toml");', 'if (!cfg) log(cfg.error());', 'auto port = cfg.transform(&Config::port);'],
      nodes: [
        N('val', 40, 240, 440, 150, 'value', 'Config', { detail: D('Success', 'expected<T, E> holds the T on success. *cfg or cfg.value() reads it.') }),
        N('err', 520, 240, 440, 150, 'error', '"missing key: port"', { detail: D('Failure', 'Holds an E instead. cfg.error() reads it; no exception thrown.', 'return std::unexpected("missing key");') }),
        N('exc', 40, 460, 920, 150, 'vs exceptions', 'errors visible in the signature', { detail: D('expected vs exceptions', 'Exceptions suit rare failures far from the handler. expected suits failures that are normal outcomes, like parsing input, and code built with -fno-exceptions.') }),
        N('chain', 40, 680, 920, 150, 'monadic ops', 'and_then · transform · or_else', { detail: D('Chaining', 'Chain steps that can fail without nested ifs; the first error short-circuits.', 'return read(p)\n  .and_then(parse)\n  .transform(validate);') }),
      ],
      edges: [],
      beats: [
        { note: 'expected (C++23) holds either a value or an error, both inline.', hl: [0], hot: { val: 'current', err: 'current' }, hide: ['exc', 'chain'] },
        { note: 'The caller must look: an expected converts to false on error.', hl: [1, 2], hot: { err: 'fail' }, hide: ['exc', 'chain'], rows: [['result', 'error', 'fail']] },
        { note: 'Unlike exceptions, the failure is in the signature and costs nothing extra on the error path.', hot: { exc: 'current' }, hide: ['chain'] },
        { note: 'and_then and transform chain fallible steps, stopping at the first error.', hl: [3], hot: { chain: 'ok' } },
      ],
    },
  ],
});

// ---------------- ranges ----------------
traceDemo('mod-ranges', 'Ranges & views', 'C++20 ranges: algorithms on whole containers, and lazy view pipelines that compute elements on demand.', {
  lazy: [
    'Lazy pipeline',
    {
      code: ['std::vector<int> v{1, 2, 3, 4, 5, 6};', 'auto evens_sq = v | std::views::filter(is_even)', '                  | std::views::transform(square);', 'for (int x : evens_sq | std::views::take(2))', '  std::cout << x << " ";'],
      details: { v: D('Source range', 'The vector owns the data; views only look at it.'), evens_sq: D('View pipeline', 'A small object describing the steps. Building it does no work and allocates nothing.', 'auto r = v | std::views::filter(p)\n          | std::views::transform(f);\n// nothing computed yet'), x: D('Pull-based', 'Each ++ on the view pulls one element through filter, then transform. take(2) stops after two.') },
      steps: [
        { line: 0, note: 'Six ints.', vars: [['v', '1 2 3 4 5 6']], out: '', rows: [['work done', 0]] },
        { line: [1, 2], note: 'The pipeline is only a description. Nothing is filtered or squared yet.', vars: [['v', '1 2 3 4 5 6'], ['evens_sq', 'filter → transform', 'current']], out: '', rows: [['work done', 0, 'ok'], ['allocations', 0, 'ok']] },
        { line: [3, 4], note: 'The loop pulls: 1 is skipped, 2 passes and becomes 4.', vars: [['v', '1 [2] 3 4 5 6'], ['evens_sq', 'filter → transform'], ['x', '4', 'write']], out: '4 ', rows: [['elements examined', 2]] },
        { line: [3, 4], note: '3 is skipped, 4 becomes 16, and take(2) ends the loop. 5 and 6 are never touched.', vars: [['v', '1 2 3 [4] 5 6'], ['x', '16', 'write']], out: '4 16 ', rows: [['elements examined', 4, 'ok']] },
        { note: 'Views compose like shell pipes. Also std::ranges::sort(v) and friends take whole containers.', vars: [['v', '1 2 3 4 5 6']], out: '4 16 ', rows: [['dangling risk', 'views of temporaries', 'warn']] },
      ],
    },
  ],
});

// ---------------- coroutines ----------------
boardDemo('mod-coroutines', 'Coroutines', 'C++20 coroutines: a function that suspends, with its state kept in a heap frame; generators and async I/O built on co_yield / co_await.', {
  generator: [
    'Generator',
    {
      panel: 'Coroutine',
      code: ['std::generator<int> count(int n) {   // C++23', '  for (int i = 1; i <= n; ++i) co_yield i;', '}', 'for (int x : count(3)) std::cout << x;'],
      nodes: [
        N('caller', 40, 240, 440, 140, 'caller', 'for (int x : …)', { detail: D('Caller', 'Drives the coroutine: each ++ on the generator resumes it until the next co_yield.') }),
        N('frame', 520, 240, 440, 140, 'coroutine frame', 'heap: i, n, resume point', { detail: D('Coroutine frame', 'Locals that must survive a suspension live in a heap-allocated frame, not on the stack. The compiler can sometimes elide the allocation.', 'auto h = std::coroutine_handle<P>::from_promise(p);\nh.resume();\nh.done();\nh.destroy();') }),
        N('prom', 520, 450, 440, 140, 'promise', 'holds the yielded value', { detail: D('promise_type', 'The customisation point: decides what the coroutine returns, where values go on co_yield, and what happens at start and end.', 'struct promise_type {\n  int value;\n  auto yield_value(int v) {\n    value = v; return std::suspend_always{};\n  }\n};') }),
        N('out', 40, 450, 440, 140, 'output', ''),
        N('aw', 40, 680, 920, 150, 'co_await', 'suspend until I/O is ready', { detail: D('co_await', 'Suspends until an awaitable is ready, such as a socket read. Async servers (asio, cppcoro) use it to write sequential-looking code on an event loop.', 'task<void> session(tcp::socket s) {\n  char buf[1024];\n  auto n = co_await s.async_read_some(buf);\n  co_await async_write(s, buf, n);\n}') }),
      ],
      edges: ['caller>frame', 'frame>prom'],
      beats: [
        { note: 'Calling count(3) creates a heap frame and suspends before running any code.', hl: [0, 3], hot: { frame: 'write', caller: 'current' }, sub: { out: '' }, hide: ['aw'], rows: [['state', 'suspended']] },
        { note: 'The loop resumes it. It runs until co_yield 1, stores 1 in the promise and suspends.', hl: [1], hot: { frame: 'current', prom: 'write', 'caller>frame': 'accent', 'frame>prom': 'accent' }, sub: { frame: 'i = 1 · at co_yield', out: '1' }, hide: ['aw'], rows: [['resumes', 1]] },
        { note: 'Each resume continues exactly where it stopped, with i intact in the frame.', hl: [1], hot: { frame: 'current', prom: 'write' }, sub: { frame: 'i = 3 · at co_yield', out: '123' }, hide: ['aw'], rows: [['resumes', 3]] },
        { note: 'Past the last yield the coroutine finishes, the loop ends and the frame is destroyed.', hot: { frame: 'visited', caller: 'ok' }, sub: { frame: 'done · freed', out: '123' }, hide: ['aw'], rows: [['state', 'done', 'ok']] },
        { note: 'co_await uses the same machinery to suspend on I/O, letting async servers read like straight-line code.', hot: { aw: 'current' }, sub: { out: '123' }, rows: [['used by', 'asio, generators, tasks']] },
      ],
    },
  ],
});

// ---------------- exception safety ----------------
traceDemo('mod-exceptions', 'Exceptions & exception safety', 'Stack unwinding, the basic/strong/nothrow guarantees, copy-and-swap, and noexcept.', {
  unwind: [
    'Unwinding',
    {
      code: ['void save(const Doc& d) {', '  std::ofstream f("out.txt");       // RAII', '  auto buf = std::make_unique<char[]>(4096);', '  write(f, d);                       // throws', '}', 'try { save(doc); } catch (const std::exception& e) { … }'],
      details: { f: D('RAII file', 'Its destructor closes the file even when an exception passes through.'), buf: D('RAII buffer', 'unique_ptr frees it during unwinding.'), ex: D('Exception object', 'Thrown objects are copied to special storage and caught by reference. Catch by const& to avoid slicing.', 'try { … }\ncatch (const std::runtime_error& e) {\n  log(e.what());\n}') },
      steps: [
        { line: [1, 2], note: 'save acquires a file and a buffer, each owned by an RAII object.', vars: [['f', 'ofstream (open)', 'current'], ['buf', 'unique_ptr', 'current', 'b']], heap: [['b', '4096 bytes']] },
        { line: 3, note: 'write throws. The rest of save is skipped.', vars: [['f', 'ofstream (open)'], ['buf', 'unique_ptr', 'default', 'b'], ['ex', 'std::runtime_error', 'fail']], heap: [['b', '4096 bytes']], rows: [['state', 'unwinding', 'warn']] },
        { line: 4, note: 'Unwinding runs destructors in reverse: buf frees the memory, then f closes the file.', vars: [['f', 'closed', 'ok'], ['buf', 'freed', 'ok'], ['ex', 'std::runtime_error', 'fail']], heap: [['b', '(freed)', 'ok']], rows: [['leaks', 0, 'ok']] },
        { line: 5, note: 'The handler catches by const reference. Only throw for failures the caller can’t handle locally.', vars: [['ex', 'caught', 'ok']], rows: [['cost when not thrown', '~0']] },
      ],
    },
  ],
  strong: [
    'Strong guarantee',
    {
      code: ['Table& operator=(const Table& o) {', '  Table tmp(o);        // may throw: *this untouched', '  swap(*this, tmp);    // noexcept', '  return *this;', '}                      // tmp frees old data'],
      details: { self: D('*this', 'The object being assigned to. With copy-and-swap it is either fully updated or unchanged.'), tmp: D('Copy first', 'All the work that can fail happens on a temporary, so a throw leaves *this as it was.'), g: D('The guarantees', 'Basic: no leaks, object still valid. Strong: commit or roll back. Nothrow: never fails (destructors, swaps, moves).', 'void swap(Table& a, Table& b) noexcept;\nTable(Table&&) noexcept;') },
      steps: [
        { line: 0, note: 'Assigning a big table. If copying throws halfway, what state is *this in?', vars: [['self', 'old rows', 'current'], ['g', 'strong wanted']] },
        { line: 1, note: 'Copy into a temporary first. If this throws, *this was never touched.', vars: [['self', 'old rows'], ['tmp', 'copy of o', 'write'], ['g', 'strong wanted']] },
        { line: 2, note: 'swap can’t throw; it just exchanges pointers. Now *this has the new rows.', vars: [['self', 'new rows', 'ok'], ['tmp', 'old rows', 'visited'], ['g', 'commit']], rows: [['guarantee', 'strong', 'ok']] },
        { line: 4, note: 'tmp’s destructor frees the old data. Destructors, swaps and moves should be noexcept.', vars: [['self', 'new rows', 'ok'], ['g', 'nothrow parts: swap, dtor']], rows: [['basic', 'no leaks, valid'], ['strong', 'all or nothing'], ['nothrow', 'never fails']] },
      ],
    },
  ],
});

// ---------------- filesystem ----------------
traceDemo('mod-filesystem', 'std::filesystem', 'Portable paths, directory walks, file sizes and error handling with std::filesystem.', {
  walk: [
    'Walk a directory',
    {
      code: ['namespace fs = std::filesystem;', 'fs::path root = "logs";', 'for (auto& e : fs::recursive_directory_iterator(root))', '  if (e.path().extension() == ".log")', '    total += e.file_size();', 'fs::remove_all(root / "tmp", ec);   // no throw'],
      details: {
        root: D('fs::path', 'A portable path. / joins components with the right separator; stem(), extension(), parent_path() split it.', 'fs::path p = "logs/app.log";\np.stem();       // "app"\np.extension();  // ".log"\np.parent_path() / "old";'),
        e: D('directory_entry', 'One entry from the walk, with cached status. is_regular_file(), file_size(), last_write_time().'),
        ec: D('error_code overloads', 'Every throwing fs function has an overload taking std::error_code&. Use it where missing files are normal.', 'std::error_code ec;\nfs::remove("x", ec);\nif (ec) log(ec.message());'),
      },
      steps: [
        { line: [0, 1], note: 'fs::path handles separators and splitting portably.', vars: [['root', '"logs"', 'current']], out: '' },
        { line: [2, 3], note: 'recursive_directory_iterator walks the whole tree. Each entry carries its path and status.', vars: [['root', '"logs"'], ['e', 'logs/2024/app.log', 'current']], out: '', rows: [['visited', 1]] },
        { line: 4, note: 'Filter by extension and add up sizes.', vars: [['root', '"logs"'], ['e', 'logs/2024/db.log', 'current'], ['total', '18.2 MB', 'write']], out: '', rows: [['visited', 7]] },
        { line: 5, note: 'Most functions throw fs::filesystem_error. The error_code overloads report instead, for expected failures.', vars: [['total', '18.2 MB', 'ok'], ['ec', 'no such file', 'warn']], out: 'total 18.2 MB', rows: [['threw', 'no', 'ok']] },
      ],
    },
  ],
});
