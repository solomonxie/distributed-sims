// C++ basics, memory pictures (group cpp-basics): scope and shadowing, C arrays and strings running off the end,
// stringstream parsing, throw/catch and unwinding. Syntax-only parts (init forms, const, std::array, cin, files) stay as line traces.
import type { Detail, Frame, Shape, Tone } from '../algo/frames';
import { box, Film, hex, panel, text } from '../machine/lib/draw';
import type { Row } from '../machine/lib/draw';
import { cap, choice, liveGroup, num, number, pick } from '../machine/lib/live';
import type { P } from '../machine/lib/live';
import { Mem } from '../machine/lib/mem';
import { traceFrames } from '../machine/lib/trace';
import type { Trace } from '../machine/lib/trace';

const liveDemo = liveGroup('cpp-basics');
const OUT: Detail = { title: 'Console output', text: 'What the program has printed so far with std::cout. std::cout is buffered; "\\n" ends a line, std::endl also flushes.', code: '#include <iostream>\nint main() {\n  std::cout << "x = " << 42 << "\\n";\n}' };

const initTrace: Trace = {
  code: ['int a;            // uninitialised!', 'int b = 5;', 'int c{5};', 'int d{};          // 0', 'auto e = 5;       // int', 'auto f = 5.0;     // double', 'auto g = "hi";    // const char*', 'std::string h = "hi";'],
  steps: [
    { note: 'A local int without an initialiser holds whatever bytes were on the stack. Reading it is undefined.', line: 0, vars: [['a', '??? garbage', 'fail']], rows: [['a', 'indeterminate', 'fail']] },
    { note: '= and {} both initialise. {} also works for every type and blocks narrowing.', line: [1, 2], vars: [['a', '???', 'fail'], ['b', '5', 'write'], ['c', '5', 'write']], rows: [['forms', '=, {}, ()']] },
    { note: 'Empty braces value-initialise: zero for numbers, nullptr for pointers.', line: 3, vars: [['a', '???', 'fail'], ['b', '5'], ['c', '5'], ['d', '0', 'ok']], rows: [['d', '0', 'ok']] },
    { note: 'auto takes the type of the initialiser. A string literal is a const char*, not std::string.', line: [4, 5, 6, 7], vars: [['e', '5 (int)', 'write'], ['f', '5.0 (double)', 'write'], ['g', '"hi" (const char*)', 'warn'], ['h', '"hi" (std::string)', 'ok']], rows: [['auto', 'from initialiser']] },
  ],
  details: {
    a: { title: 'Uninitialised variable', text: 'Locals of built-in type are not zeroed. Always initialise; -Wall warns on many cases.', code: 'int a;          // garbage\nint a2 = 0;     // do this' },
    c: { title: 'Brace (uniform) initialisation', text: 'Works for built-ins, structs, containers. Rejects narrowing.', code: 'int c{5};\nstd::vector<int> v{1, 2, 3};\nPoint p{1, 2};' },
    d: { title: 'Value initialisation', text: 'T x{} zero-initialises built-ins and calls the default constructor for classes.', code: 'int d{};      // 0\ndouble z{};   // 0.0\nint* p{};     // nullptr' },
    e: { title: 'auto', text: 'The compiler deduces the type. Great for long iterator types; keep it readable.', code: 'auto it = m.find(key);   // std::map<...>::iterator\nfor (auto& x : v) x *= 2;' },
    g: { title: 'String literal type', text: '"hi" is an array of const char that decays to const char*. Use std::string or "hi"s for a real string.', code: 'using namespace std::string_literals;\nauto s = "hi"s;  // std::string' },
  },
};

const constTrace: Trace = {
  code: ['const int max = 100;', 'max = 5;                  // error', 'constexpr int kb = 1024;', 'constexpr int mb = kb * kb;', 'int arr[mb];              // ok: compile time', 'const int n = read();     // runtime const', 'constexpr int m = read(); // error'],
  steps: [
    { note: 'const means this name can’t be used to modify the value. The compiler rejects the assignment.', line: [0, 1], vars: [['max', '100 (const)', 'write']], rows: [['assign', 'compile error', 'fail']] },
    { note: 'constexpr values are computed at compile time. mb is 1048576 baked into the binary.', line: [2, 3], vars: [['max', '100'], ['kb', '1024 (compile time)', 'ok'], ['mb', '1048576 (compile time)', 'ok']], rows: [['computed', 'by compiler', 'ok']] },
    { note: 'Compile-time constants can size arrays and be template arguments.', line: 4, vars: [['kb', '1024'], ['mb', '1048576'], ['arr', 'int[1048576]', 'write']], rows: [['array size', 'constant']] },
    { note: 'const can hold a runtime value. constexpr can’t, since read() runs only when the program does.', line: [5, 6], vars: [['n', 'from read() (const)', 'ok'], ['m', 'compile error', 'fail']], rows: [['const', 'runtime ok'], ['constexpr', 'compile time only']] },
  ],
  details: {
    max: { title: 'const', text: 'A promise not to modify through this name. Use it by default for locals and for reference parameters you only read.', code: 'void print(const std::string& s);\nconst auto total = sum(v);' },
    kb: { title: 'constexpr', text: 'Evaluated by the compiler. Replaces #define constants with typed, scoped names.', code: 'constexpr double pi = 3.14159;\nconstexpr int sq(int x) { return x * x; }\nstatic_assert(sq(4) == 16);' },
    n: { title: 'Runtime const', text: 'Initialised once at run time, then read-only.', code: 'const int n = std::stoi(argv[1]);' },
  },
};

const stdarrayTrace: Trace = {
  code: ['std::array<int, 3> a{1, 2, 3};', 'a.size();       // 3', 'a.at(5);        // throws out_of_range', 'std::vector<int> v{1, 2, 3};', 'v.push_back(4);', 'std::vector<std::vector<int>> grid(3,', '    std::vector<int>(4, 0));'],
  steps: [
    { note: 'std::array is a C array that knows its size and copies like a value. It lives on the stack.', line: [0, 1], vars: [['a', '[1, 2, 3]', 'write']], rows: [['size', 3], ['storage', 'stack']] },
    { note: 'at() checks bounds and throws. operator[] doesn’t check.', line: 2, vars: [['a', '[1, 2, 3]'], ['a.at(5)', 'std::out_of_range', 'fail']], rows: [['[]', 'unchecked'], ['at()', 'checked', 'ok']] },
    { note: 'std::vector grows at run time. Its elements live on the heap.', line: [3, 4], heap: [['vbuf', '1 | 2 | 3 | 4', 'write', 'capacity 6']], vars: [['a', '[1, 2, 3]'], ['v', 'size 4', undefined, 'vbuf']], rows: [['size', 4]] },
    { note: 'A 2D grid is a vector of vectors, each row its own heap block.', line: [5, 6], heap: [['r0', '0 0 0 0'], ['r1', '0 0 0 0'], ['r2', '0 0 0 0']], vars: [['grid', '3 rows', undefined, 'r0']], rows: [['rows', 3], ['cols', 4]] },
  ],
  details: {
    a: { title: 'std::array<T, N>', text: 'Fixed-size, stack-allocated, zero overhead over a C array, with size(), at(), iterators and value semantics.', code: 'std::array<int, 3> a{1, 2, 3};\nauto b = a;  // copies all 3\nstd::sort(a.begin(), a.end());' },
    v: { title: 'std::vector<T>', text: 'The default container. Contiguous, growable, cache friendly.', code: 'std::vector<int> v;\nv.reserve(100);\nv.push_back(1);\nv.erase(v.begin());' },
    vbuf: { title: 'Heap buffer', text: 'size() elements are in use; capacity() is how many fit before reallocating.' },
    grid: { title: 'Nested vectors', text: 'Easy, but rows are separate allocations. For speed use one vector<int>(rows*cols) and index r*cols+c.', code: 'std::vector<int> g(rows * cols);\ng[r * cols + c] = 1;' },
  },
};

const consoleTrace: Trace = {
  code: ['int age; std::string name;', 'std::cin >> name >> age;       // "Ada 36"', 'std::cin.ignore();', 'std::string line;', 'std::getline(std::cin, line);  // whole line', 'std::cout << name << " is " << age << "\\n";', 'std::cerr << "warn\\n";          // unbuffered'],
  steps: [
    { note: '>> reads one whitespace-separated token and converts it to the target type.', line: [0, 1], vars: [['name', '"Ada"', 'write'], ['age', '36', 'write']], out: '' },
    { note: '>> stops before the newline, so skip it before switching to getline.', line: 2, vars: [['name', '"Ada"'], ['age', '36'], ['cin', 'at next line', 'muted']], out: '' },
    { note: 'getline reads a full line including spaces.', line: [3, 4], vars: [['name', '"Ada"'], ['age', '36'], ['line', '"likes math"', 'write']], out: '' },
    { note: '<< chains values into the output stream. cerr goes to stderr, separate from stdout.', line: [5, 6], vars: [['name', '"Ada"'], ['age', '36'], ['line', '"likes math"']], out: 'Ada is 36\n(stderr) warn' },
  ],
  details: {
    name: { title: 'operator>>', text: 'Skips whitespace, reads one token. On bad input the stream enters a fail state; check it.', code: 'int n;\nif (!(std::cin >> n)) {\n  std::cerr << "not a number\\n";\n}' },
    line: { title: 'std::getline', text: 'Reads up to the newline, which it consumes and discards.', code: 'std::string line;\nwhile (std::getline(std::cin, line)) {\n  // one line at a time\n}' },
    out: OUT,
  },
};

const filesTrace: Trace = {
  code: ['std::ofstream out("log.txt");', 'out << "line 1\\n";', 'out.close();', 'std::ifstream in("log.txt");', 'if (!in) return 1;', 'std::string l; std::getline(in, l);', 'struct Rec { int id; float v; } r{7, 1.5f};', 'std::ofstream b("r.bin", std::ios::binary);', 'b.write(reinterpret_cast<char*>(&r), sizeof r);'],
  steps: [
    { note: 'ofstream opens a file for writing, and << works just like with cout.', line: [0, 1], vars: [['out', 'log.txt (open)', 'write']], heap: [['file', 'log.txt: "line 1\\n"', 'write']] },
    { note: 'Closing flushes. The destructor also closes, so scope-based cleanup is enough.', line: 2, vars: [['out', 'closed', 'visited']], heap: [['file', 'log.txt: "line 1\\n"', 'ok']] },
    { note: 'ifstream reads it back. Always check that the open succeeded.', line: [3, 4, 5], vars: [['in', 'log.txt (open)', 'current'], ['l', '"line 1"', 'write']], heap: [['file', 'log.txt: "line 1\\n"']] },
    { note: 'Binary mode writes raw bytes of the struct: 8 bytes, no text conversion.', line: [6, 7, 8], vars: [['r', '{id=7, v=1.5}'], ['b', 'r.bin (binary)', 'write']], heap: [['bin', 'r.bin: 07 00 00 00 00 00 C0 3F', 'write']] },
    { note: 'Raw struct dumps depend on padding and byte order. Use a defined format for anything shared.', line: 8, vars: [['r', '{id=7, v=1.5}'], ['b', 'r.bin', 'warn']], heap: [['bin', 'layout = this compiler only', 'warn']] },
  ],
  heapTitle: 'disk',
  details: {
    out: { title: 'std::ofstream', text: 'An output file stream. Opens in the constructor, closes in the destructor (RAII).', code: '#include <fstream>\n{\n  std::ofstream f("a.txt", std::ios::app);\n  f << "appended\\n";\n} // closed here' },
    in: { title: 'std::ifstream', text: 'An input file stream. Converts to false when the file couldn’t be opened or a read failed.', code: 'std::ifstream in("a.txt");\nfor (std::string l; std::getline(in, l);)\n  process(l);' },
    bin: { title: 'Binary file', text: 'Exact bytes. Fast and compact, but tied to struct layout and endianness.', code: 'Rec r;\nin.read(reinterpret_cast<char*>(&r), sizeof r);' },
  },
};

// ---------------- variables: scope & shadowing ----------------
const SD: Record<string, Detail> = {
  x: { title: 'Outer x', text: 'Declared in main’s block, so visible inside nested blocks unless an inner declaration hides it.' },
  y: { title: 'Block-scoped variable', text: 'Exists only between its declaration and the closing brace. Keep variables in the smallest scope that works.', code: 'for (int i = 0; i < n; ++i) { /* i only here */ }\nif (auto it = m.find(k); it != m.end()) { }' },
  xi: { title: 'Shadowing', text: 'Same name in an inner scope hides the outer variable. Compile with -Wshadow to catch it.' },
};

function scope(p: P): Frame[] {
  const shadow = pick(p.inner, ['declare', 'assign'], 'declare') === 'declare';
  const m = new Mem({ panel: 'Scope', details: SD, out: true });
  m.region('main', 'main() · stack frame').v('x', 'main', 0, 'x', '0x10', '1');
  m.snap('x lives in main’s frame, from its declaration to main’s closing brace.', 'int x = 1;', { out: '' });
  m.region('blk', '{ inner block }').v('y', 'blk', 1, 'y', '0x14', '2');
  m.snap('Entering a block: y is pushed on the stack. It exists only until the matching }.', '{  int y = 2;', { out: '', rows: [['live boxes', 2]] });
  if (shadow) {
    m.v('xi', 'blk', 0, 'x (inner)', '0x18', '10');
    m.snap('int x = 10 declares a second x: until } the name x means this new box, and the outer one is hidden (-Wshadow warns).', '  int x = 10;', { hot: { x: 'visited', xi: 'warn' }, out: '', rows: [['boxes named x', 2, 'warn']] });
    m.snap('x + y reads the inner x: 10 + 2.', '  std::cout << x + y;', { finger: 'xi', hot: { x: 'visited' }, out: '12', rows: [['x means', 'inner (0x18)', 'warn']] });
  } else {
    m.set('x', '10');
    m.snap('x = 10 has no type in front, so it declares nothing: it assigns to the outer x, the only x there is.', '  x = 10;', { finger: 'x', hot: { x: 'write' }, out: '', rows: [['boxes named x', 1]] });
    m.snap('x + y = 10 + 2.', '  std::cout << x + y;', { finger: 'x', out: '12', rows: [['x means', 'outer (0x10)']] });
  }
  m.kill('blk', '} block ended');
  m.snap(`At the brace the block’s boxes die: y${shadow ? ' and the inner x' : ''}. Using y after this line would not compile.`, '}', { finger: null, out: '12', rows: [['y', 'out of scope', 'muted']] });
  m.drop('blk');
  m.snap(shadow ? 'The outer x was never touched, so this prints 1.' : 'The assignment changed the outer x for good, so this prints 10.', 'std::cout << x;', { finger: 'x', hot: { x: shadow ? 'ok' : 'warn' }, out: `12\n${shadow ? 1 : 10}`, rows: [['x', shadow ? 1 : 10, shadow ? 'ok' : 'warn']] });
  return m.frames();
}

liveDemo(
  'basics-vars',
  'Variables, const & scope',
  'Initialisation forms and auto, const and constexpr, and block scope drawn as stack boxes that appear and die with their braces.',
  {
    init: ['Initialisation', () => traceFrames(initTrace)],
    const: ['const & constexpr', () => traceFrames(constTrace)],
    scope: ['Scope & shadowing', scope],
  },
  [choice('inner', 'inside the block', ['declare', 'assign'], 'declare', { for: ['scope'], labels: ['int x = 10;', 'x = 10;'] })],
  { out: OUT },
);

// ---------------- arrays: C arrays past the end, C strings past the end ----------------
const AD: Record<string, Detail> = {
  a0: { title: 'C array', text: 'Elements are contiguous: a[i] lives at address a + i * sizeof(int). Nothing records where the array ends.', code: 'int a[4] = {10, 20, 30, 40};\nstd::size(a); // 4 (only where a is the array)' },
  n: { title: 'Neighbour variable', text: 'Whatever the compiler placed next. Writing past the array silently overwrites it.' },
  ret: { title: 'Return address', text: 'Where the function jumps back to. Overwriting it is the classic stack-smashing exploit; -fstack-protector adds a canary to catch it.' },
  p: { title: 'Array-to-pointer decay', text: 'Arrays convert to a pointer to element 0 in most expressions, and the pointer has lost the length.', code: 'int* p = a;   // same as &a[0]\nsizeof(a);    // 16\nsizeof(p);    // 8' },
};

function carray(p: P): Frame[] {
  const i = num(p.i, 4, 0, 5);
  const addr = (k: number) => hex(0x10 + k * 4);
  const m = new Mem({ panel: 'C array', details: AD });
  m.region('stk', 'main() · stack, 4 bytes per box', { tight: true });
  [10, 20, 30, 40].forEach((v, k) => m.v(`a${k}`, 'stk', k, `a[${k}]`, addr(k), String(v)));
  m.v('n', 'stk', 4, 'n', addr(4), '7').v('ret', 'stk', 5, 'return to', addr(5), '0x401A');
  m.snap('int a[4] is four ints side by side, 16 bytes. Right after it the compiler put n, then main’s return address.', 'int a[4] = {10, 20, 30, 40};', { rows: [['sizeof(a)', '16 B'], ['a[k] at', '0x10 + 4·k']] });
  m.region('loc', 'other locals').v('p', 'loc', 0, 'p', '0x30', '0x10', { to: 'a0' });
  m.snap('Used as a value, a decays to a pointer to a[0]. p is 8 bytes and knows nothing about the length 4.', 'int* p = a;', { finger: 'p', rows: [['sizeof(a)', '16 B'], ['sizeof(p)', '8 B', 'warn']] });
  const target = i < 4 ? `a${i}` : i === 4 ? 'n' : 'ret';
  m.snap(`a[${i}] is just address 0x10 + 4·${i} = ${addr(i)}. No check is made that ${i} < 4.`, `a[${i}] = 99;`, { finger: target, rows: [['index', i, i < 4 ? 'ok' : 'fail'], ['address', addr(i)], ['bounds check', 'none', 'warn']] });
  m.set(target, i === 5 ? '0x63' : '99');
  const hot: Record<string, Tone> = { [target]: i < 4 ? 'ok' : 'fail' };
  const what = i < 4 ? `In bounds: a[${i}] is now 99.` : i === 4 ? 'One past the end: the write lands in n. n is now 99 and nothing complained.' : 'Two past the end: the return address is now 0x63. When main returns it jumps there: a crash, or an exploit.';
  m.snap(what, `a[${i}] = 99;`, { finger: target, hot, rows: [['wrote', i < 4 ? `a[${i}]` : i === 4 ? 'n (!)' : 'return address (!)', i < 4 ? 'ok' : 'fail']] });
  m.snap(i < 4 ? `std::array<int, 4> with a.at(${i}) would do the same write, plus a check that passes.` : `std::array<int, 4> with a.at(${i}) checks the index and throws std::out_of_range instead. -fsanitize=address catches raw arrays.`, `a.at(${i}) = 99;   // std::array`, { finger: null, hot, rows: [['at()', i < 4 ? 'ok' : 'throws out_of_range', i < 4 ? 'ok' : 'fail'], ['prefer', 'std::array / std::span', 'ok']] });
  return m.frames();
}

const STRD: Record<string, Detail> = {
  s0: { title: 'C string', text: 'A char array ending in a zero byte. strlen and strcpy walk until they find it.', code: 'const char* p = "hi";  // {\'h\',\'i\',\'\\0\'}\nstd::strlen(p);        // 2' },
  d0: { title: 'Destination buffer', text: 'strcpy is never told its size. Use std::string, or snprintf with a size.', code: 'std::snprintf(small, sizeof small, "%s", src);' },
  str: { title: 'std::string', text: 'Owns its characters and tracks its length; it grows its buffer instead of overflowing. c_str() gives a C string for C APIs.', code: 'std::string s = "hello";\ns += " world";\nconst char* c = s.c_str();' },
};

function cstrings(p: P): Frame[] {
  const n = num(p.n, 4, 2, 8);
  const word = 'hello';
  const need = word.length + 1;
  const ch = (k: number) => (k < word.length ? `'${word[k]}'` : "'\\0'");
  const m = new Mem({ panel: 'C strings', details: STRD });
  m.region('src', `const char src[] · ${need} bytes`, { tight: true });
  for (let k = 0; k < need; k++) m.v(`s${k}`, 'src', k, `[${k}]`, hex(0x40 + k), ch(k));
  m.region('dst', `char small[${n}] · then the next variable`, { tight: true });
  const span = Math.max(n, need);
  for (let k = 0; k < span; k++) m.v(`d${k}`, 'dst', k, k < n ? `small[${k}]` : 'next', hex(0x80 + k), k < n ? '?' : '0');
  m.snap(`"${word}" is ${word.length} letters plus the zero byte that ends it: ${need} bytes. small has room for ${n}${n < need ? ', and right after it lives another variable' : ''}.`, `char small[${n}];`, { rows: [['need', `${need} B`], ['have', `${n} B`, n < need ? 'warn' : 'ok']] });
  let over = 0;
  for (let k = 0; k < need; k++) {
    const bad = k >= n;
    if (bad) over++;
    m.set(`d${k}`, ch(k));
    if (k === 0 || k === need - 1 || k === n) m.snap(bad ? `Byte ${k} goes past small: strcpy does not know where small ends, so it writes into the next variable.` : k === 0 ? 'strcpy copies byte by byte until it has copied the zero.' : `The zero byte lands in small[${k}]: the copy fits.`, 'std::strcpy(small, src);', { finger: `d${k}`, hot: Object.fromEntries([...Array(k + 1).keys()].map((j) => [`d${j}`, (j >= n ? 'fail' : 'ok') as Tone])), rows: [['copied', `${k + 1} B`], ['overflow', `${over} B`, over ? 'fail' : 'ok']] });
  }
  const hot = Object.fromEntries([...Array(need).keys()].map((j) => [`d${j}`, (j >= n ? 'fail' : 'ok') as Tone]));
  m.snap(over ? `${over} byte${over > 1 ? 's' : ''} of the neighbour ${over > 1 ? 'were' : 'was'} overwritten and nothing complained. That is a buffer overflow.` : 'The copy fit, this time. Change the source and the same line overflows: strcpy never checks.', 'std::strcpy(small, src);', { finger: null, hot, rows: [['overflow', `${over} B`, over ? 'fail' : 'ok']] });
  m.drop('dst').region('dst', 'std::string s · grows its own buffer', { tight: true });
  for (let k = 0; k < need; k++) m.v(k ? `t${k}` : 'str', 'dst', k, k ? `[${k}]` : 's[0]', hex(0x80 + k), ch(k));
  m.snap('std::string allocates as much as it needs and tracks the length. No size to get wrong.', 'std::string s = src;', { finger: null, rows: [['s.size()', word.length, 'ok'], ['overflow', 'impossible', 'ok']] });
  return m.frames();
}

liveDemo(
  'basics-arrays',
  'Arrays & strings',
  'C arrays as boxes with no end marker, an index knob that walks off the end into the neighbours, std::array, and strcpy overflowing a buffer you size.',
  {
    carray: ['C arrays', carray],
    stdarray: ['std::array & vector', () => traceFrames(stdarrayTrace)],
    strings: ['C strings vs std::string', cstrings],
  },
  [number('i', 'index', 0, 5, 4, { for: ['carray'] }), number('n', 'small[n]', 2, 8, 4, { for: ['strings'] })],
);

// ---------------- I/O: stringstream parsing as a cursor ----------------
const LINES = ['GET /index.html 200', 'GET /a b 200', 'POST /x abc'];

function sstream(p: P): Frame[] {
  const line = LINES[num(p.line, 0, 0, LINES.length - 1)];
  const cw = Math.min(46, 940 / line.length);
  const x0 = (1000 - cw * line.length) / 2;
  const f = new Film();
  const owner: (string | undefined)[] = [];
  const targets: [name: string, type: string, val: string, tone: Tone][] = [];
  let pos = 0;
  let failed = false;
  const tapeTone: Record<string, Tone> = { method: 'accent', path: 'protocol', code: 'ok', bad: 'fail' };
  const scene = (stmt: string, cursor: number): Shape[] => {
    const out: Shape[] = [...cap(stmt), text('tl', 40, 140, 'std::istringstream in', { align: 'left', size: 24, bold: true, tone: 'muted' })];
    [...line].forEach((c, k) => out.push(box(`ch${k}`, x0 + k * cw + 1, 160, cw - 2, 70, c === ' ' ? '␣' : c, { mono: true, tone: owner[k] ? tapeTone[owner[k]!] : c === ' ' ? 'muted' : 'default' })));
    const cx = x0 + Math.min(cursor, line.length) * cw;
    out.push({ t: 'edge', id: 'cursor', from: { x: cx, y: 290 }, to: { x: cx, y: 236 }, arrow: true, tone: failed ? 'fail' : 'current', width: 5 });
    out.push(text('cl', cx, 316, failed ? 'stuck (failbit)' : cursor >= line.length ? 'end' : 'read position', { size: 22, tone: failed ? 'fail' : 'current' }));
    targets.forEach(([n, t, v, tone], k) => out.push(box(`v-${n}`, 40 + k * 315, 380, 290, 120, `${n} = ${v}`, { sub: t, mono: true, tone })));
    out.push(box('st', 40, 560, 920, 80, failed ? 'in.fail() == true · later >> do nothing' : 'in is good', { tone: failed ? 'fail' : 'ok', filled: false }));
    return out;
  };
  const rows = (): Row[] => targets.map(([n, , v, t]) => [n, v, t] as Row).concat([['stream', failed ? 'failed' : 'good', failed ? 'fail' : 'ok']]);
  f.add('istringstream reads from a string the way cin reads from the keyboard. A read position starts at the first character.', scene('std::istringstream in(line);', 0), panel('stringstream', [['line', `"${line}"`]]));
  const read = (name: string, type: 'string' | 'int') => {
    const stmt = `in >> ${name};`;
    if (failed) {
      targets.push([name, type === 'int' ? 'int' : 'std::string', type === 'int' ? '0' : '""', 'muted']);
      f.add(`The stream already failed, so >> ${name} does nothing at all. ${name} keeps its initial value.`, scene(stmt, pos), panel('stringstream', rows()));
      return;
    }
    while (line[pos] === ' ') pos++;
    const start = pos;
    while (pos < line.length && line[pos] !== ' ') pos++;
    const tok = line.slice(start, pos);
    if (type === 'int' && !/^\d+$/.test(tok)) {
      failed = true;
      pos = start;
      for (let k = start; k < start + tok.length; k++) owner[k] = 'bad';
      targets.push([name, 'int', '0', 'fail']);
      f.add(`>> into an int expects digits, but the next token is "${tok}". The read fails: ${name} becomes 0 and the stream sets failbit. Always check: if (in >> ${name}).`, scene(stmt, pos), panel('stringstream', rows()));
      return;
    }
    for (let k = start; k < pos; k++) owner[k] = name;
    targets.push([name, type === 'int' ? 'int' : 'std::string', type === 'int' ? tok : `"${tok}"`, tapeTone[name]]);
    f.add(`>> skips spaces, then takes characters up to the next space: "${tok}"${type === 'int' ? `, converted to the number ${tok}` : ''}.`, scene(stmt, pos), panel('stringstream', rows()));
  };
  read('method', 'string');
  read('path', 'string');
  read('code', 'int');
  const ok = !failed;
  f.add(ok ? `All three reads worked. The same >> chain parses any whitespace-separated line.` : 'The line did not match the shape the code expected. A space inside a token, or letters where a number goes, both break >> parsing: check the stream after reading.', scene(ok ? 'if (in) { /* use method, path, code */ }' : 'if (!in) { /* reject the line */ }', pos), panel('stringstream', [...rows(), ['check', ok ? 'passes' : 'rejects line', ok ? 'ok' : 'fail']]));
  return f.frames;
}

liveDemo(
  'basics-io',
  'I/O, streams & files',
  'cout/cin and getline, stringstream parsing as a read position walking a line token by token (pick a line that breaks it), and text and binary files.',
  {
    console: ['cin & cout', () => traceFrames(consoleTrace)],
    sstream: ['stringstream', sstream],
    files: ['Text & binary files', () => traceFrames(filesTrace)],
  },
  [choice('line', 'line', ['0', '1', '2'], '0', { for: ['sstream'], labels: LINES.map((l) => `"${l}"`) })],
  {
    'v-method': { title: 'operator>>', text: 'Skips whitespace, reads one token, converts it to the target type.', code: 'std::istringstream in(line);\nstd::string m; int c;\nif (in >> m >> c) { ... }' },
    st: { title: 'Stream state', text: 'A failed conversion sets failbit; every later >> is a no-op until in.clear(). The stream converts to false when failed.', code: 'if (!(in >> code)) {\n  in.clear();\n  in.ignore(1000, \'\\n\');\n}' },
  },
);

// ---------------- exceptions: throw/catch and unwinding ----------------
const ED: Record<string, Detail> = {
  ex: { title: 'Exception object', text: 'Any type can be thrown; derive from std::exception so callers can catch it generically. It lives apart from the stack so it survives unwinding.', code: 'struct ConfigError : std::runtime_error {\n  using std::runtime_error::runtime_error;\n};\nthrow ConfigError("missing port");' },
  e: { title: 'catch by const&', text: 'Catching by value would slice a derived exception to its base and copy it.', code: 'catch (const ConfigError& e) { ... }\ncatch (const std::exception& e) { ... }\ncatch (...) { /* anything */ }' },
  s: { title: 'Throwing function', text: 'Its frame is destroyed during unwinding, without returning a value. Local objects’ destructors still run.' },
};
const ARGS = ['""', '"42"', '"abc"'];

function throwCatch(p: P): Frame[] {
  const arg = pick(p.arg, ARGS, '""');
  const m = new Mem({ panel: 'throw & catch', details: ED, out: true });
  m.region('main', 'main() · try { … }').v('n', 'main', 0, 'n', '0x10', '?');
  m.region('parse', `parse(s = ${arg}) · frame`).v('s', 'parse', 0, 's', '0x7c0', arg);
  m.snap('main calls parse inside a try block. parse gets its own frame on top.', `try { int n = parse(${arg}); … }`, { out: '' });
  if (arg === '"42"') {
    m.snap('s is not empty, so parse goes on to std::stoi, which converts "42".', '  return std::stoi(s);', { finger: 's', out: '' });
    m.kill('parse', 'parse() returned 42').set('n', '42');
    m.snap('A normal return: the frame is popped and n receives 42.', 'int n = parse("42");', { finger: 'n', fly: ['s', 'n'], hot: { n: 'ok' }, out: '' });
    m.drop('parse');
    m.snap('No exception was thrown, so the catch block is skipped entirely. Exceptions cost nothing on this path.', 'std::cout << n;', { finger: null, hot: { n: 'ok' }, out: '42', rows: [['catch ran', 'no', 'ok']] });
    return m.frames();
  }
  const empty = arg === '""';
  const type = 'std::invalid_argument';
  const msg = empty ? 'empty' : 'stoi';
  m.region('exr', 'exception object · outside the stack');
  m.v('ex', 'exr', 0, type.replace('std::', ''), '0x9000', `"${msg}"`);
  m.snap(empty ? 'if (s.empty()) is true, so parse throws. An exception object is created outside the stack and normal flow is abandoned.' : '"abc" has no digits, so std::stoi throws invalid_argument from deep inside the library. Same mechanism: an exception object, normal flow abandoned.', empty ? '    throw std::invalid_argument("empty");' : '  return std::stoi(s);   // throws', { finger: 'ex', hot: { ex: 'fail', s: 'fail' }, out: '', rows: [['thrown', type, 'fail']] });
  m.kill('parse', 'parse() unwound · no return value');
  m.snap('The stack unwinds: parse’s frame is popped without returning, and n never receives a value.', '} catch …', { finger: null, hot: { ex: 'fail', n: 'muted' }, out: '', rows: [['n', 'never assigned', 'warn']] });
  m.drop('parse').region('parse', 'catch (const std::exception& e)').v('e', 'parse', 0, 'e', '0x7c0', '0x9000', { to: 'ex' });
  m.snap('The first catch whose type matches runs. e is a const reference to the thrown object, so no copy and no slicing.', '} catch (const std::exception& e) {', { finger: 'e', out: '', rows: [['matched', 'std::exception&', 'ok']] });
  m.snap('e.what() is the message the thrower gave. The program carries on after the catch block.', '  std::cerr << e.what();', { finger: 'ex', hot: { ex: 'ok' }, out: `(stderr) ${msg}`, rows: [['handled', 'yes', 'ok']] });
  return m.frames();
}

const UD: Record<string, Detail> = {
  log: { title: 'RAII file', text: 'std::ofstream closes its file in its destructor, even when an exception passes through.' },
  buf: { title: 'std::unique_ptr', text: 'Frees its memory in its destructor, so it cannot leak on exceptions.', code: 'auto buf = std::make_unique<char[]>(4096);' },
  raw: { title: 'Raw owning pointer', text: 'A plain pointer has no destructor. If the delete is skipped, the block is never freed.', code: 'int* raw = new int[100];   // avoid\nstd::vector<int> raw(100); // freed automatically' },
  b2: { title: 'The 400-byte block', text: 'Leaked when only a raw pointer owned it; freed by vector’s destructor otherwise.' },
};

function unwind(p: P): Frame[] {
  const raii = pick(p.own, ['raw', 'vector'], 'raw') === 'vector';
  const m = new Mem({ panel: 'Unwinding', details: UD });
  m.region('work', 'work() · stack frame');
  m.region('heap', 'heap & OS');
  m.v('log', 'work', 0, 'log', '0x10', 'fd 3', { to: 'file' }).v('file', 'heap', 0, 'w.log', 'fd 3', 'open');
  m.v('buf', 'work', 1, 'buf', '0x18', '0x500', { to: 'b1' }).v('b1', 'heap', 1, 'buf block', '0x500', '4096 B');
  m.v('raw', 'work', 2, raii ? 'raw (vector)' : 'raw (int*)', '0x20', '0x900', { to: 'b2' }).v('b2', 'heap', 2, 'raw block', '0x900', '400 B');
  m.snap(`work acquires three resources: a file, a unique_ptr buffer, and ${raii ? 'a std::vector' : 'a raw new int[100]'}.`, raii ? 'std::vector<int> raw(100);' : 'int* raw = new int[100];', { rows: [['open', 3]] });
  m.snap('step() throws. Control leaves work right here: every line below it is skipped.', '  step();   // throws', { finger: 'raw', hot: { raw: raii ? 'default' : 'warn' }, rows: [['skipped', raii ? 'nothing needed' : 'delete[] raw', raii ? 'ok' : 'fail']] });
  if (raii) m.free('b2');
  m.snap(raii ? 'Unwinding runs destructors in reverse order. First raw: vector’s destructor frees its 400 bytes.' : 'Unwinding runs destructors in reverse order. First raw: a plain pointer has no destructor, so nothing happens.', '~raw', { finger: 'raw', hot: { b2: raii ? 'ok' : 'warn' } });
  m.free('b1');
  m.snap('Then buf: unique_ptr’s destructor frees the 4096-byte block.', '~buf', { finger: 'buf', hot: { b1: 'ok', b2: raii ? 'ok' : 'warn' } });
  m.set('file', 'closed').free('file');
  m.snap('Then log: ofstream’s destructor closes the file.', '~log', { finger: 'log', hot: { b2: raii ? 'ok' : 'warn' } });
  m.kill('work', 'work() unwound');
  m.snap(raii ? 'Everything work acquired was released. Every resource was owned by an object, so the exception leaked nothing.' : 'The frame is gone, but the 400-byte block is still there with nothing pointing at it: a leak. Own every resource with an object (RAII).', 'catch (…) in the caller', { finger: raii ? null : 'b2', hot: { b2: raii ? 'ok' : 'fail' }, rows: [['leaked', raii ? '0 B' : '400 B', raii ? 'ok' : 'fail'], ['fix', 'std::vector<int>', 'ok']] });
  return m.frames();
}

liveDemo(
  'basics-exceptions',
  'Exceptions',
  'throw and catch as frames on a stack with the exception object beside it, and unwinding destructors one by one: what an owning object frees and what a raw pointer leaks.',
  {
    throw: ['throw & catch', throwCatch],
    unwind: ['Unwinding & RAII', unwind],
  },
  [choice('arg', 'parse(', ARGS, '""', { for: ['throw'], labels: ['"")', '"42")', '"abc")'] }), choice('own', 'raw is', ['raw', 'vector'], 'raw', { for: ['unwind'], labels: ['new int[100]', 'vector<int>'] })],
  { out: OUT },
);
