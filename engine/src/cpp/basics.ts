// C++ basics (group cpp-basics): types, variables, control flow, functions, arrays & strings, pointers, structs & enums,
// headers, preprocessor, I/O & files, exceptions, chrono. Mostly line-by-line traces with tap-to-explain boxes.
// Types, control flow and functions live in basics-core.ts; variables, arrays, I/O and exceptions in basics-memory.ts.
import type { Detail } from '../algo/frames';
import { machineDemo } from '../machine/lib/draw';
import { traceFrames } from '../machine/lib/trace';
import type { Trace } from '../machine/lib/trace';
import { boardDemo, N } from '../machine/lib/board';
import type { Board } from '../machine/lib/board';
import { codeMapFrames } from '../machine/lib/code';
import type { CodeMap } from '../machine/lib/code';
import { Mem, memDemo } from '../machine/lib/mem';

const G = 'cpp-basics';

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

const OUT: Detail = { title: 'Console output', text: 'What the program has printed so far with std::cout. std::cout is buffered; "\\n" ends a line, std::endl also flushes.', code: '#include <iostream>\nint main() {\n  std::cout << "x = " << 42 << "\\n";\n}' };

// ---------------- pointers & references ----------------
const PD: Record<string, Detail> = {
  x: { title: 'A box in memory', text: 'Every variable occupies bytes at some address. Real addresses look like 0x7ffd5c3a1e4c; short ones are used here.', code: 'int x = 5;\nstd::cout << &x;  // 0x7ffd5c3a1e4c' },
  p: { title: 'int*', text: 'A box whose value is an address. & reads an address, * follows one.', code: 'int x = 5;\nint* p = &x;\n*p = 7;      // x == 7' },
  pp: { title: 'int**', text: 'A box holding the address of a pointer. Each * follows one arrow.', code: 'int** pp = &p;\n*pp   // p\n**pp  // x' },
  out: { title: 'Parameter', text: 'A new box in the callee’s frame, initialised with a copy of the argument.', code: 'void make(int* out);   // copy of a pointer\nvoid make(int** out);  // address of the caller’s pointer\nvoid make(int*& out);  // C++: reference to it' },
  h: { title: 'Heap block', text: 'Made by new, lives until delete. If no pointer leads to it any more, it can never be freed: a leak.', code: 'int* p = new int(42);\ndelete p;' },
  q: { title: 'Dangling pointer', text: 'Still holds an address, but the box there was released. Most memory bugs are this.', code: 'int* f() {\n  int t = 3;\n  return &t;  // warning: address of local\n}' },
};

function ptrBasics() {
  const m = new Mem({ panel: 'Pointers', details: PD }).region('main', 'main() · stack frame');
  m.v('x', 'main', 0, 'x', '0x10', '5').snap('x is a box in memory. Every box has an address, shown above it.', 'int x = 5;');
  m.v('p', 'main', 1, 'p', '0x18', '0x10', { to: 'x' }).snap('&x reads x’s address. p is a box too, and it stores that number.', 'int* p = &x;', { fly: ['x.addr', 'p'], eq: 'p = &x = 0x10', rows: [['&x', '0x10']] });
  m.snap('p’s value matches x’s address, in the same colour. The arrow just draws that match.', 'int* p = &x;', { eq: 'p = &x = 0x10', rows: [['p', '0x10'], ['&x', '0x10']] });
  m.snap('*p means: take the address stored in p…', '*p = 7;', { finger: 'p', eq: '*p  →  *(0x10)', rows: [['p', '0x10']] });
  m.set('x', '7').snap('…and go to the box at that address. Writing *p changes x without naming it.', '*p = 7;', { finger: 'x', eq: '*(0x10)  →  x = 7', rows: [['*p', 'x']] });
  m.v('y', 'main', 2, 'y', '0x20', '9').snap('Another int, y, at 0x20.', 'int y = 9;', { finger: null });
  m.set('p', '0x20', 'y').snap('Assigning p itself just stores a different address. x is untouched.', 'p = &y;', { fly: ['y.addr', 'p'], eq: 'p = &y = 0x20', rows: [['p', '0x20'], ['x', '7']] });
  return m;
}

function ptrToPtr() {
  const m = new Mem({ panel: 'Pointers', details: PD }).region('main', 'main() · stack frame');
  m.v('x', 'main', 0, 'x', '0x10', '5').v('y', 'main', 1, 'y', '0x14', '6').v('p', 'main', 2, 'p', '0x18', '0x10', { to: 'x' });
  m.snap('Start from what we know: p holds x’s address.', 'int* p = &x;');
  m.v('pp', 'main', 3, 'pp', '0x20', '0x18', { lv: 2, to: 'p' }).snap('p is a box with its own address, 0x18. pp stores that, so pp points at a pointer.', 'int** pp = &p;', { fly: ['p.addr', 'pp'], eq: 'pp = &p = 0x18', rows: [['pp', '0x18']] });
  m.snap('Read **pp one * at a time. Start at pp.', '**pp = 9;', { finger: 'pp', eq: '**pp = 9', rows: [['pp', '0x18']] });
  m.snap('The first * follows pp’s arrow and lands on p. So *pp is p itself.', '**pp = 9;', { finger: 'p', eq: '*(*pp) = 9  →  *p = 9', rows: [['pp', '0x18'], ['*pp', 'p = 0x10']] });
  m.set('x', '9').snap('The second * follows p’s arrow to x. **pp = 9 writes x.', '**pp = 9;', { finger: 'x', eq: '*p = 9  →  x = 9', rows: [['pp', '0x18'], ['*pp', 'p = 0x10'], ['**pp', 'x = 9', 'ok']] });
  m.snap('Now only one *. Start at pp again.', '*pp = &y;', { finger: 'pp', eq: '*pp = &y' });
  m.set('p', '0x14', 'y').snap('One * stops at p, so the assignment re-points p. Through pp you can change where p points.', '*pp = &y;', { finger: 'p', fly: ['y.addr', 'p'], eq: '*pp = &y  →  p = &y', rows: [['*pp', 'p = 0x14'], ['**pp', 'y = 6']] });
  return m;
}

function ptrOut() {
  const m = new Mem({ panel: 'Out-parameter', details: PD }).region('main', 'main() · stack frame');
  m.v('p', 'main', 0, 'p', '0x7f0', 'null', { lv: 1 }).snap('main wants make() to give p a new int.', 'int* p = nullptr;');
  m.region('make', 'make(int* out) · stack frame').v('out', 'make', 0, 'out', '0x7c0', 'null', { lv: 1 });
  m.snap('Arguments are copied. out is a new box holding a copy of p’s value.', 'make(p);', { fly: ['p', 'out'] });
  m.region('heap', 'heap').v('h', 'heap', 2, '', '0x500', '42').set('out', '0x500', 'h');
  m.snap('new puts 42 on the heap, and out points at it. p is still null.', 'out = new int(42);', { rows: [['out', '0x500'], ['p', 'null', 'warn']] });
  m.kill('make', 'make() returned').snap('make returns and out disappears. p never changed, and nothing points at the 42: a leak.', '}', { hot: { h: 'fail', p: 'warn' }, rows: [['p', 'null', 'fail'], ['leaked', '4 B', 'fail']] });
  m.drop('make').drop('heap').set('p', 'null');
  m.snap('Fix: give make the address of p, not a copy of its value.', 'void make(int** out);');
  m.region('make', 'make(int** out) · stack frame').v('out', 'make', 0, 'out', '0x7c0', '0x7f0', { lv: 2, to: 'p' });
  m.snap('out now holds 0x7f0, p’s own address, so out points at p.', 'make(&p);', { fly: ['p.addr', 'out'], rows: [['out', '0x7f0 (&p)']] });
  m.snap('*out follows that arrow…', '*out = new int(42);', { finger: 'out' });
  m.region('heap', 'heap').v('h', 'heap', 2, '', '0x500', '42').set('p', '0x500', 'h');
  m.snap('…to p, and the heap address is written into p itself.', '*out = new int(42);', { finger: 'p', rows: [['*out', 'p = 0x500', 'ok']] });
  m.kill('make', 'make() returned').snap('make returns and p keeps the int. C APIs hand back pointers this way.', '}', { finger: null, rows: [['p', '0x500', 'ok'], ['C++ style', 'return it, or int*&']] });
  return m;
}

function ptrArith() {
  const m = new Mem({ panel: 'Pointer arithmetic', details: PD }).region('arr', 'int a[4] · 4 bytes each', { tight: true });
  ['10', '20', '30', '40'].forEach((v, i) => m.v(`a${i}`, 'arr', i, `a[${i}]`, '0x' + (16 + i * 4).toString(16), v));
  m.snap('An array is boxes side by side. Each int is 4 bytes, so addresses go up by 4.', 'int a[4] = {10, 20, 30, 40};');
  m.region('ptrs', 'pointers').v('p', 'ptrs', 0, 'p', '0x30', '0x10', { to: 'a0' });
  m.snap('The array name turns into the address of its first box.', 'int* p = a;', { fly: ['a0.addr', 'p'], rows: [['p', '0x10']] });
  m.set('p', '0x14', 'a1').snap('p + 1 moves one int, not one byte: 0x10 becomes 0x14.', '++p;', { rows: [['p', '0x10 + 1×4 = 0x14']] });
  m.snap('p[2] is *(p + 2): from p, step two boxes, then read.', 'int v = p[2];', { finger: 'a3', rows: [['p + 2', '0x14 + 2×4 = 0x1c'], ['p[2]', '40', 'ok']] });
  m.v('end', 'arr', 4, 'a+4', '0x20', '', {}).snap('a + 4 is one past the end. Comparing with it is fine, reading it is not.', 'for (int* q = a; q != a + 4; ++q)', { finger: null, hot: { end: 'muted' }, rows: [['end', '0x20']] });
  m.v('junk', 'arr', 5, '???', '0x24', '7781').snap('Nothing stops p[4]. It reads whatever lies past the array: undefined behaviour.', 'int bad = p[4];   // 0x14 + 16', { finger: 'junk', hot: { end: 'muted', junk: 'fail' }, rows: [['p[4]', '0x24', 'fail']] });
  return m;
}

function ptrDangling() {
  const m = new Mem({ panel: 'Null & dangling', details: PD }).region('main', 'main() · stack frame');
  m.v('q', 'main', 0, 'q', '0x7f0', 'null', { lv: 1 }).snap('nullptr is address 0, where no box ever lives. There is no arrow to follow.', 'int* q = nullptr;');
  m.snap('*q tries to follow a missing arrow. The OS stops the program: segmentation fault.', '*q = 1;', { finger: 'q', hot: { q: 'fail' }, rows: [['signal', 'SIGSEGV', 'fail']] });
  m.region('f', 'f() · stack frame').v('t', 'f', 0, 't', '0x7c0', '3');
  m.snap('Call f(). Its frame holds a local t at 0x7c0.', 'int t = 3;   // inside f()', { finger: null });
  m.set('q', '0x7c0', 't').snap('f returns t’s address, and q stores it.', 'q = f();     // return &t;', { fly: ['t.addr', 'q'] });
  m.kill('f', 'f() returned · slots free').snap('f returns and its frame is released. q still holds 0x7c0, but nothing lives there.', '}', { rows: [['q', '0x7c0', 'warn']] });
  m.revive('f', 'g() · stack frame · same slots').v('n', 'f', 0, 'n', '0x7c0', '99').set('q', '0x7c0', 'n');
  m.snap('The next call reuses the same addresses. g’s local n now sits at 0x7c0.', 'g();', { hot: { q: 'warn' } });
  m.snap('*q reads 99, not 3. A dangling pointer reads whatever moved in.', 'int v = *q;', { finger: 'n', hot: { q: 'warn', n: 'fail' }, rows: [['*q', '99', 'fail'], ['detect', '-fsanitize=address']] });
  return m;
}

function ptrRefs() {
  const m = new Mem({ panel: 'References', details: PD }).region('main', 'main() · stack frame');
  m.v('x', 'main', 0, 'x', '0x10', '5').snap('One int, x.', 'int x = 5;');
  m.rename('x', 'x, r').snap('A reference makes no new box. r is a second name on x’s box.', 'int& r = x;', { hot: { x: 'accent' }, rows: [['&r == &x', 'true']] });
  m.set('x', '8').snap('Anything done to r is done to x.', 'r = 8;', { eq: 'r = 8  →  x = 8', rows: [['x', '8']] });
  m.v('y', 'main', 1, 'y', '0x14', '1').snap('Another int, y.', 'int y = 1;');
  m.set('x', '1').snap('r can’t be re-pointed. r = y copies y’s value into x.', 'r = y;', { fly: ['y', 'x'], eq: 'r = y  →  x = y', rows: [['x', '1', 'warn'], ['r still names', 'x']] });
  m.v('p', 'main', 2, 'p', '0x18', '0x10', { to: 'x' }).snap('A pointer is its own box: it can change targets or be null. A reference can do neither.', 'int* p = &x;', { rows: [['pointer', 'own box, re-pointable'], ['reference', 'another name']] });
  return m;
}

memDemo(G, 'basics-pointers', 'Pointers & references', 'Boxes, addresses and arrows: & and *, pointer to pointer, out-parameters, pointer arithmetic, dangling pointers and references.', {
  basics: ['Address & *', ptrBasics],
  ptr2: ['Pointer to pointer', ptrToPtr],
  outparam: ['Why int**', ptrOut],
  arith: ['Pointer arithmetic', ptrArith],
  nullptr: ['nullptr & dangling', ptrDangling],
  refs: ['References', ptrRefs],
});

// ---------------- structs, enums, aliases, namespaces ----------------
traceDemo('basics-structs', 'Structs, enums & namespaces', 'Aggregates and designated init, enum vs enum class, using aliases, and namespaces.', {
  struct: [
    'struct',
    {
      code: ['struct Point {', '  int x = 0;', '  int y = 0;', '};', 'Point a;                 // {0, 0}', 'Point b{3, 4};', 'Point c{.x = 1, .y = 2}; // C++20', 'Point d = b;  d.x = 9;   // copy'],
      steps: [
        { note: 'A struct groups named fields into one type. Default member values apply when not given.', line: [0, 1, 2, 3, 4], vars: [['a', '{x=0, y=0}', 'write']] },
        { note: 'Brace init sets fields in declaration order.', line: 5, vars: [['a', '{0, 0}'], ['b', '{x=3, y=4}', 'write']] },
        { note: 'C++20 designated initialisers name the fields, which reads better.', line: 6, vars: [['a', '{0, 0}'], ['b', '{3, 4}'], ['c', '{x=1, y=2}', 'write']] },
        { note: 'Structs copy field by field. Changing d leaves b alone.', line: 7, vars: [['a', '{0, 0}'], ['b', '{3, 4}', 'ok'], ['c', '{1, 2}'], ['d', '{x=9, y=4}', 'write']] },
      ],
      details: {
        a: { title: 'Default member initialisers', text: 'int x = 0; inside the struct gives every Point a sane starting value.' },
        b: { title: 'Aggregate initialisation', text: 'A struct with public fields and no constructors is an aggregate and can be brace-initialised.', code: 'struct Rect { Point tl, br; };\nRect r{{0, 0}, {10, 5}};' },
        c: { title: 'Designated initialisers', text: 'C++20. Fields must be listed in declaration order.', code: 'Config cfg{.port = 8080, .threads = 4};' },
        d: { title: 'Value semantics', text: 'Assignment and passing by value copy every field. struct and class differ only in default access (public vs private).' },
      },
    },
  ],
  enums: [
    'enum vs enum class',
    {
      code: ['enum Color { Red, Green };      // old style', 'enum Fruit { Apple, Orange };', 'bool same = (Red == Apple);    // true?!', 'enum class Level : uint8_t {', '  Low, High };', 'Level l = Level::High;', 'int n = static_cast<int>(l);   // 1'],
      steps: [
        { note: 'Plain enum names leak into the surrounding scope and convert to int silently.', line: [0, 1], vars: [['Red', '0'], ['Apple', '0']] },
        { note: 'So unrelated enums compare equal. The compiler at most warns.', line: 2, vars: [['Red', '0'], ['Apple', '0'], ['same', 'true', 'fail']] },
        { note: 'enum class is scoped and strongly typed, and you can pick its underlying type.', line: [3, 4, 5], vars: [['l', 'Level::High', 'ok']], rows: [['sizeof(Level)', '1 B']] },
        { note: 'Converting to int needs an explicit cast.', line: 6, vars: [['l', 'Level::High'], ['n', '1', 'write']] },
      ],
      details: {
        same: { title: 'Unscoped enum pitfall', text: 'Old enums are basically named ints. Use them only for C compatibility.' },
        l: { title: 'enum class', text: 'Values are written Level::High, don’t convert implicitly, and don’t clash with other names.', code: 'enum class State { Idle, Running, Done };\nswitch (s) {\n  case State::Idle: ...\n}' },
      },
    },
  ],
  names: [
    'using & namespaces',
    {
      code: ['namespace net {', '  struct Socket { int fd; };', '  namespace detail { int retries = 3; }', '}', 'using Clock = std::chrono::steady_clock;', 'using Callback = std::function<void(int)>;', 'net::Socket s{3};', 'using namespace std;  // not in headers!'],
      steps: [
        { note: 'Namespaces group names so libraries don’t collide. Socket is really net::Socket.', line: [0, 1, 3], vars: [['net::Socket', 'type'], ['net::detail::retries', '3']] },
        { note: 'detail is a common nested namespace for internals users shouldn’t touch.', line: 2, vars: [['net::Socket', 'type'], ['net::detail::retries', '3', 'muted']] },
        { note: 'using makes a short alias for a long type. It replaces typedef.', line: [4, 5], vars: [['Clock', 'steady_clock', 'write'], ['Callback', 'function<void(int)>', 'write']] },
        { note: 'Qualified names always work. using namespace in a header pollutes every file that includes it.', line: [6, 7], vars: [['s', 'net::Socket{3}', 'ok'], ['using namespace', 'OK in .cpp only', 'warn']] },
      ],
      details: {
        'net::Socket': { title: 'Namespace', text: 'A named scope. Refer to members as ns::name, or bring one in with using ns::name.', code: 'namespace app::db { void open(); }\napp::db::open();' },
        Clock: { title: 'Type alias', text: 'using Name = Type; is the modern typedef, and it also works with templates.', code: 'template <class T>\nusing Vec = std::vector<T>;\nVec<int> v;' },
        'using namespace': { title: 'using namespace', text: 'Fine inside a .cpp or a function. Never at global scope in a header.' },
      },
    },
  ],
});

// ---------------- headers & multi-file programs (board) ----------------
const D_MAIN: Detail = { title: 'main.cpp', text: 'The file with main(), where the program starts. It includes headers to learn about functions defined elsewhere.', code: '#include "greeting.h"\n\nint main() {\n  greet("Ada");\n  return 0;\n}' };
const D_H: Detail = { title: 'greeting.h (header)', text: 'Declarations only: what exists and its signature. Every .cpp that uses greet includes it.', code: '#pragma once\n#include <string>\n\nvoid greet(const std::string& name);' };
const D_CPP: Detail = { title: 'greeting.cpp (source)', text: 'The definition, compiled exactly once. It includes its own header so the compiler checks both agree.', code: '#include "greeting.h"\n#include <iostream>\n\nvoid greet(const std::string& name) {\n  std::cout << "Hello, " << name << "\\n";\n}' };
const D_EXE: Detail = { title: 'Executable', text: 'The linker joins main.o and greeting.o into one program.', code: 'g++ -c main.cpp greeting.cpp\ng++ main.o greeting.o -o app\n./app   # Hello, Ada' };
const D_GUARD: Detail = { title: 'Include guard', text: 'Stops a header being pasted twice into the same .cpp, which would redefine its types.', code: '#ifndef SHAPES_H\n#define SHAPES_H\nstruct Point { int x, y; };\n#endif\n// or simply: #pragma once' };
const D_FWD: Detail = { title: 'Forward declaration', text: 'Says a class exists without its definition. Enough for pointers, references and function signatures.', code: 'class Engine;           // no #include\nclass Car {\n  Engine* engine_;\n  void set(Engine& e);\n};' };

const hdrBoard = (beats: Board['beats'], nodes: Board['nodes'], edges: string[]): Board => ({ panel: 'Files', nodes, edges, beats });

boardDemo(G, 'basics-headers', 'Headers & multiple files', 'Splitting code into .h and .cpp, include guards and #pragma once, and forward declarations.', {
  split: [
    'Header + source',
    hdrBoard(
      [
        { note: 'Small programs fit in main.cpp. Bigger ones split into a header (what) and a source file (how).', hide: ['h', 'cpp', 'o1', 'o2', 'exe'], rows: [['files', 1]] },
        { note: 'greeting.h declares greet. main.cpp includes it, so the compiler knows the call is valid.', hot: { h: 'current', 'h>main': 'accent' }, hide: ['o1', 'o2', 'exe'], rows: [['files', 3]] },
        { note: 'greeting.cpp defines greet and includes its own header too.', hot: { cpp: 'current', 'h>cpp': 'accent' }, hide: ['o1', 'o2', 'exe'], rows: [['definitions', 1]] },
        { note: 'Each .cpp compiles on its own into an object file. The header is compiled as part of each.', hot: { o1: 'write', o2: 'write', 'main>o1': 'accent', 'cpp>o2': 'accent' }, hide: ['exe'], rows: [['objects', 2]] },
        { note: 'The linker joins the objects into one program. Tap any box for its code.', hot: { exe: 'ok', 'o1>exe': 'accent', 'o2>exe': 'accent' }, rows: [['output', 'app', 'ok']] },
      ],
      [
        N('h', 355, 60, 290, 120, 'greeting.h', 'declares greet()', { detail: D_H }),
        N('main', 40, 300, 290, 120, 'main.cpp', 'calls greet()', { detail: D_MAIN }),
        N('cpp', 670, 300, 290, 120, 'greeting.cpp', 'defines greet()', { detail: D_CPP }),
        N('o1', 40, 540, 290, 120, 'main.o', 'machine code', { detail: { title: 'Object file', text: 'Compiled machine code for one .cpp, with unresolved references to functions defined elsewhere.', code: 'g++ -c main.cpp   # → main.o\nnm main.o         # U greet(...)' } }),
        N('o2', 670, 540, 290, 120, 'greeting.o', 'machine code', { detail: { title: 'Object file', text: 'Contains the compiled body of greet, listed as a defined (T) symbol.', code: 'nm greeting.o   # T greet(...)' } }),
        N('exe', 355, 780, 290, 120, 'app', 'executable', { detail: D_EXE }),
      ],
      ['h>main', 'h>cpp', 'main>o1', 'cpp>o2', 'o1>exe', 'o2>exe'],
    ),
  ],
  guards: [
    'Include guards',
    hdrBoard(
      [
        { note: 'shapes.h defines struct Point. Both geometry.h and render.h include it.', hot: { s: 'current' }, hide: ['err'], rows: [['includes of shapes.h', 2]] },
        { note: 'main.cpp includes both, so shapes.h is pasted in twice.', hot: { 's>g': 'accent', 's>r': 'accent', 'g>m': 'accent', 'r>m': 'accent', m: 'current' }, hide: ['err'], rows: [['copies in main.cpp', 2, 'warn']] },
        { note: 'Without a guard, Point is defined twice in one translation unit and compilation fails.', hot: { err: 'fail', m: 'fail' }, label: { err: 'error: redefinition of Point' }, rows: [['result', 'compile error', 'fail']] },
        { note: '#pragma once, or an #ifndef guard, makes the second include a no-op. Put one in every header.', hot: { s: 'ok', m: 'ok', err: 'ok' }, label: { err: 'second include skipped' }, sub: { s: '#pragma once' }, rows: [['copies', 1, 'ok']] },
      ],
      [
        N('s', 355, 60, 290, 120, 'shapes.h', 'struct Point', { detail: D_GUARD }),
        N('g', 40, 290, 290, 120, 'geometry.h', '#include "shapes.h"', { detail: { title: 'geometry.h', text: 'Needs Point, so it includes shapes.h.', code: '#pragma once\n#include "shapes.h"\ndouble dist(Point a, Point b);' } }),
        N('r', 670, 290, 290, 120, 'render.h', '#include "shapes.h"', { detail: { title: 'render.h', text: 'Also needs Point.', code: '#pragma once\n#include "shapes.h"\nvoid draw(Point p);' } }),
        N('m', 355, 520, 290, 120, 'main.cpp', 'includes both', { detail: { title: 'main.cpp', text: 'Includes both headers, so it indirectly includes shapes.h twice.', code: '#include "geometry.h"\n#include "render.h"\nint main() { draw({1, 2}); }' } }),
        N('err', 40, 760, 920, 120, 'result'),
      ],
      ['s>g', 's>r', 'g>m', 'r>m', 'm>err'],
    ),
  ],
  fwd: [
    'Forward declarations',
    hdrBoard(
      [
        { note: 'car.h includes engine.h only because Car holds an Engine*.', hot: { e: 'current', 'e>c': 'accent' }, sub: { c: '#include "engine.h"' }, rows: [['depends on engine.h', 3, 'warn']] },
        { note: 'Every file including car.h now also parses engine.h and rebuilds when it changes.', hot: { a: 'warn', b: 'warn', 'c>a': 'warn', 'c>b': 'warn' }, sub: { c: '#include "engine.h"' }, rows: [['rebuild on engine.h edit', 3, 'warn']] },
        { note: 'class Engine; is enough to declare a pointer or reference. car.h drops the include.', hot: { c: 'ok' }, sub: { c: 'class Engine;' }, hide: ['e>c'], rows: [['depends on engine.h', 1, 'ok']] },
        { note: 'Only car.cpp, which calls Engine methods, includes engine.h. Fewer includes means faster builds.', hot: { cc: 'current', 'e>cc': 'accent' }, sub: { c: 'class Engine;' }, hide: ['e>c'], rows: [['rebuild on engine.h edit', 1, 'ok']] },
      ],
      [
        N('e', 40, 60, 290, 120, 'engine.h', 'class Engine {…}', { detail: { title: 'engine.h', text: 'The full class definition. Needed only where Engine’s members are used or its size must be known.', code: '#pragma once\nclass Engine {\npublic:\n  void start();\n  int rpm() const;\n};' } }),
        N('c', 355, 60, 290, 120, 'car.h', 'Engine* engine_', { detail: D_FWD }),
        N('cc', 670, 60, 290, 120, 'car.cpp', 'uses Engine', { detail: { title: 'car.cpp', text: 'Calls engine_->start(), so it needs the full definition.', code: '#include "car.h"\n#include "engine.h"\nvoid Car::drive() { engine_->start(); }' } }),
        N('a', 40, 420, 440, 120, 'dashboard.cpp', 'includes car.h'),
        N('b', 520, 420, 440, 120, 'garage.cpp', 'includes car.h'),
      ],
      ['e>c', 'e>cc', 'c>a', 'c>b'],
    ),
  ],
});

// ---------------- preprocessor ----------------
const PRE: Record<string, CodeMap> = {
  macro: {
    srcTitle: 'source',
    asmTitle: 'after the preprocessor (g++ -E)',
    src: ['#define SQUARE(x) x * x', '#define MAX 100', 'int a = SQUARE(3 + 1);', 'int b = MAX;', 'constexpr int sq(int x) { return x * x; }'],
    asm: ['int a = 3 + 1 * 3 + 1;   // 7, not 16', 'int b = 100;', 'constexpr int sq(int x) { return x * x; }'],
    intro: 'The preprocessor runs before the compiler and does pure text substitution.',
    steps: [
      { src: [0, 2], asm: [0], note: 'SQUARE pastes text, so 3 + 1 * 3 + 1 is 7. Precedence bites.' },
      { src: [1, 3], asm: [1], note: 'Object-like macros are plain text too, with no type and no scope.' },
      { src: [4], asm: [2], note: 'A constexpr function is typed, scoped and evaluated correctly.' },
    ],
    outro: 'Prefer constexpr and inline functions. Keep macros for include guards and conditional compilation.',
  },
  ifdef: {
    srcTitle: 'source',
    asmTitle: 'after g++ -DDEBUG -E',
    src: ['#ifdef DEBUG', '  #define LOG(m) std::cerr << m << "\\n"', '#else', '  #define LOG(m)', '#endif', '#if defined(_WIN32)', '  #include <windows.h>', '#endif', 'LOG("start");'],
    asm: ['std::cerr << "start" << "\\n";'],
    intro: 'Conditional compilation keeps or drops code before the compiler sees it.',
    steps: [
      { src: [0, 1], asm: [], note: 'With -DDEBUG on the command line, the first branch is kept.' },
      { src: [5, 6, 7], asm: [], note: 'Platform checks like _WIN32 pick OS-specific code.' },
      { src: [8], asm: [0], note: 'LOG expands to a real statement in debug builds and to nothing otherwise.' },
    ],
    outro: 'CMake passes defines per target with target_compile_definitions.',
  },
};

machineDemo({
  slug: 'basics-preprocessor',
  title: 'The preprocessor',
  group: G,
  summary: '#define, function-like macro pitfalls, #ifdef and conditional compilation, shown as source → preprocessed output.',
  inputs: [
    { id: 'macro', label: 'Macros', data: { m: 'macro' } },
    { id: 'ifdef', label: '#ifdef', data: { m: 'ifdef' } },
  ],
  build: ({ m }: { m: string }) => codeMapFrames(PRE[m]),
});

// ---------------- chrono ----------------
traceDemo('basics-chrono', 'Time with <chrono>', 'Durations and their units, time points and clocks, and timing a piece of code correctly.', {
  durations: [
    'Durations',
    {
      code: ['using namespace std::chrono_literals;', 'auto t = 1500ms;', 'auto s = std::chrono::duration_cast<', '    std::chrono::seconds>(t);          // 1s', 'std::chrono::duration<double> d = t;   // 1.5', 'std::this_thread::sleep_for(200ms);'],
      steps: [
        { note: 'A duration is a count plus a unit, checked by the type system.', line: [0, 1], vars: [['t', '1500 ms', 'write']] },
        { note: 'Converting to a coarser unit truncates, so it needs duration_cast.', line: [2, 3], vars: [['t', '1500 ms'], ['s', '1 s', 'warn']] },
        { note: 'A double-based duration keeps the fraction.', line: 4, vars: [['t', '1500 ms'], ['s', '1 s'], ['d', '1.5 s', 'ok']] },
        { note: 'APIs take durations, so sleep_for(200ms) can’t be confused with 200 seconds.', line: 5, vars: [['sleep', '200 ms', 'current']] },
      ],
      details: {
        t: { title: 'std::chrono::duration', text: 'Type-safe time spans. Literals: h, min, s, ms, us, ns.', code: 'auto timeout = 30s;\nif (elapsed > timeout) ...' },
        s: { title: 'duration_cast', text: 'Explicit conversion that may lose precision. Converting to a finer unit is implicit.', code: 'std::chrono::milliseconds ms = 2s; // implicit, exact' },
      },
    },
  ],
  timing: [
    'Timing code',
    {
      code: ['auto t0 = std::chrono::steady_clock::now();', 'run();', 'auto t1 = std::chrono::steady_clock::now();', 'auto us = std::chrono::duration_cast<', '    std::chrono::microseconds>(t1 - t0);', 'std::cout << us.count() << " us\\n";', 'auto wall = std::chrono::system_clock::now();'],
      steps: [
        { note: 'now() returns a time point on a given clock.', line: 0, vars: [['t0', 'time_point', 'write']] },
        { note: 'Take a second time point after the work.', line: [1, 2], vars: [['t0', 'time_point'], ['t1', 'time_point', 'write']] },
        { note: 'Subtracting time points gives a duration, converted here to microseconds.', line: [3, 4, 5], vars: [['t0', 'time_point'], ['t1', 'time_point'], ['us', '1834 us', 'ok']], out: '1834 us' },
        { note: 'steady_clock never jumps, so use it to measure. system_clock is wall time and can move with NTP.', line: 6, vars: [['wall', 'calendar time', 'muted']], out: '1834 us' },
      ],
      details: {
        t0: { title: 'steady_clock', text: 'Monotonic: never goes backwards. The right clock for timeouts and benchmarks.' },
        wall: { title: 'system_clock', text: 'Real-world time, convertible to a date. Can jump when the system time is adjusted.', code: 'auto now = std::chrono::system_clock::now();\nstd::time_t t = std::chrono::system_clock::to_time_t(now);' },
        us: { title: 'Measured duration', text: 'Run the code many times and take the median; one sample is noisy.' },
        out: OUT,
      },
    },
  ],
});
