// C++ basics (group cpp-basics): types, variables, control flow, functions, arrays & strings, pointers, structs & enums,
// headers, preprocessor, I/O & files, exceptions, chrono. Mostly line-by-line traces with tap-to-explain boxes.
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

// ---------------- types ----------------
traceDemo('basics-types', 'Types, sizes & overflow', 'Built-in types, their sizes and ranges, signed vs unsigned overflow, and implicit vs explicit conversion.', {
  sizes: [
    'Sizes',
    {
      code: ['#include <cstdint>', 'char   c = \'A\';      // 1 byte', 'int    i = 42;       // 4 bytes', 'long long n = 9e18;  // 8 bytes', 'double d = 3.14;     // 8 bytes', 'bool   b = true;     // 1 byte', 'std::int32_t x = 7;  // exactly 32 bits', 'std::size_t s = sizeof(d);'],
      steps: [
        { note: 'Every variable has a type, and the type fixes its size in memory and what operations mean.', line: 1, vars: [['c', "'A' (65)", 'write']], rows: [['sizeof(char)', '1 B']] },
        { note: 'int is usually 4 bytes, about ±2.1 billion. long long is 8 bytes.', line: [2, 3], vars: [['c', "'A' (65)"], ['i', '42', 'write'], ['n', '9000000000000000000', 'write']], rows: [['sizeof(int)', '4 B'], ['sizeof(long long)', '8 B']] },
        { note: 'double holds about 15 significant digits. bool is true or false, stored in a byte.', line: [4, 5], vars: [['c', "'A' (65)"], ['i', '42'], ['n', '9e18'], ['d', '3.14', 'write'], ['b', 'true', 'write']], rows: [['sizeof(double)', '8 B']] },
        { note: 'The standard only guarantees minimums, so use <cstdint> types when the exact width matters (files, network).', line: [6, 7], vars: [['c', "'A' (65)"], ['i', '42'], ['n', '9e18'], ['d', '3.14'], ['x', '7', 'write'], ['s', '8', 'write']], rows: [['int32_t', 'exactly 4 B', 'ok']] },
      ],
      details: {
        c: { title: 'char', text: 'One byte. Holds a character code (ASCII \'A\' is 65) or a small integer.', code: "char c = 'A';\nstd::cout << c << ' ' << int(c); // A 65" },
        i: { title: 'int', text: 'The default integer. 4 bytes on every mainstream platform, range −2147483648 … 2147483647.', code: 'int i = 42;\n#include <climits>\nstd::cout << INT_MAX; // 2147483647' },
        n: { title: 'long long', text: 'At least 64 bits. Use it (or std::int64_t) for values past 2 billion: file sizes, timestamps in ns, money in cents.', code: 'long long bytes = 5LL * 1024 * 1024 * 1024;' },
        d: { title: 'double', text: 'IEEE-754 64-bit floating point. Fast, but not exact: 0.1 + 0.2 != 0.3.', code: 'double d = 0.1 + 0.2;\nstd::cout << (d == 0.3); // 0 (false)' },
        b: { title: 'bool', text: 'true or false. Converts to 1 or 0, and any non-zero number converts to true.', code: 'bool b = (3 > 2); // true\nif (ptr) { /* non-null */ }' },
        x: { title: 'Fixed-width integers', text: 'std::int8_t … std::int64_t and their unsigned uintN_t cousins have exact sizes. Use them in binary formats and protocols.', code: '#include <cstdint>\nstd::uint16_t port = 8080;\nstd::int64_t  ts   = 1700000000000;' },
        s: { title: 'size_t and sizeof', text: 'sizeof gives a size in bytes as std::size_t, an unsigned integer as wide as a pointer. Container sizes use it too.', code: 'std::vector<int> v(10);\nstd::size_t n = v.size();\nsizeof(int); // 4' },
      },
    },
  ],
  overflow: [
    'Overflow',
    {
      code: ['int big = 2147483647;      // INT_MAX', 'unsigned u = 0;', 'u = u - 1;                 // wraps', 'int bad = big + 1;         // UB!', 'long long ok = big + 1LL;  // fine', 'std::size_t n = v.size();', 'for (int i = 0; i < n - 1; i++)  // n=0?'],
      steps: [
        { note: 'big holds the largest int. There is no room for one more.', line: 0, vars: [['big', '2147483647', 'write']], rows: [['INT_MAX', '2147483647']] },
        { note: 'Unsigned arithmetic is defined to wrap around. 0 − 1 becomes the largest unsigned value.', line: [1, 2], vars: [['big', '2147483647'], ['u', '4294967295', 'warn']], rows: [['unsigned', 'wraps (defined)', 'warn']] },
        { note: 'Signed overflow is undefined behaviour, so the optimiser may assume it never happens. Anything can follow.', line: 3, vars: [['big', '2147483647'], ['u', '4294967295'], ['bad', '??? (UB)', 'fail']], rows: [['signed', 'UB', 'fail']] },
        { note: 'Widen before the operation, not after: big + 1LL is computed in 64 bits.', line: 4, vars: [['big', '2147483647'], ['u', '4294967295'], ['ok', '2147483648', 'ok']], rows: [['fix', 'wider type', 'ok']] },
        { note: 'Classic bug: with n = 0, n − 1 wraps to 18 quintillion and the loop runs off the end.', line: [5, 6], vars: [['n', '0'], ['n - 1', '18446744073709551615', 'fail']], rows: [['fix', 'i + 1 < n', 'ok']] },
      ],
      details: {
        big: { title: 'INT_MAX', text: 'The largest int. Adding 1 to it is undefined behaviour, not a wrap to negative.', code: '#include <limits>\nstd::numeric_limits<int>::max(); // 2147483647' },
        u: { title: 'unsigned wraparound', text: 'Unsigned types do arithmetic modulo 2^N. Handy for hashes, a trap for sizes and loop counters.', code: 'unsigned u = 0;\nu -= 1; // 4294967295' },
        bad: { title: 'Undefined behaviour', text: 'The compiler assumes signed overflow never happens and optimises on that basis. Catch it with -fsanitize=undefined.', code: 'g++ -fsanitize=undefined main.cpp' },
        ok: { title: 'Widen first', text: 'Promote one operand to the wider type so the whole expression is computed wide.', code: 'long long r = static_cast<long long>(a) * b;' },
        n: { title: 'size() is unsigned', text: 'v.size() returns size_t. Mixing it with int in comparisons gives surprising results; compilers warn with -Wsign-compare.', code: 'for (std::size_t i = 0; i + 1 < v.size(); ++i)' },
      },
    },
  ],
  conversion: [
    'Conversion',
    {
      code: ['int a = 7, b = 2;', 'int q = a / b;              // 3', 'double r = a / b;           // 3.0 !', 'double s = double(a) / b;   // 3.5', 'int t = 3.99;               // 3', 'int u{3.99};                // error', 'auto v = static_cast<int>(s);'],
      steps: [
        { note: 'int divided by int is integer division. The fraction is dropped.', line: [0, 1], vars: [['a', '7'], ['b', '2'], ['q', '3', 'write']], rows: [['7 / 2', '3']] },
        { note: 'Assigning to a double doesn’t help: the division already happened in int.', line: 2, vars: [['a', '7'], ['b', '2'], ['q', '3'], ['r', '3.0', 'warn']], rows: [['r', '3.0', 'warn']] },
        { note: 'Convert one operand first, and the division is done in double.', line: 3, vars: [['a', '7'], ['b', '2'], ['q', '3'], ['r', '3.0'], ['s', '3.5', 'ok']], rows: [['s', '3.5', 'ok']] },
        { note: 'double to int truncates toward zero silently. Brace initialisation refuses the narrowing at compile time.', line: [4, 5], vars: [['t', '3', 'warn'], ['u', 'compile error', 'fail']], rows: [['narrowing', 'caught by {}', 'ok']] },
        { note: 'static_cast makes an intended conversion explicit and easy to grep for.', line: 6, vars: [['s', '3.5'], ['v', '3', 'ok']], rows: [['cast', 'static_cast', 'ok']] },
      ],
      details: {
        q: { title: 'Integer division', text: 'Both operands are int, so the result is int, rounded toward zero. % gives the remainder.', code: '7 / 2   // 3\n7 % 2   // 1\n-7 / 2  // -3' },
        r: { title: 'Too late to convert', text: 'The right side is evaluated first, as int, and only the result is converted.', code: 'double r = 7 / 2;     // 3.0\ndouble r2 = 7 / 2.0;  // 3.5' },
        s: { title: 'Convert an operand', text: 'If either operand is double the other is promoted and the division is floating point.', code: 'double s = static_cast<double>(a) / b;' },
        u: { title: 'Brace initialisation', text: 'T x{v} rejects narrowing conversions (double→int, long→short). Prefer it for new code.', code: 'int u{3.99};   // error: narrowing\nint w{3};      // ok' },
        v: { title: 'static_cast', text: 'The explicit, checked-at-compile-time cast. Avoid C-style (int)x, which can silently do reinterpret or const casts.', code: 'int n = static_cast<int>(3.7); // 3' },
      },
    },
  ],
});

// ---------------- variables, const, scope ----------------
traceDemo('basics-vars', 'Variables, const & scope', 'Initialisation forms and auto, const and constexpr, and block scope and shadowing.', {
  init: [
    'Initialisation',
    {
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
    },
  ],
  const: [
    'const & constexpr',
    {
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
    },
  ],
  scope: [
    'Scope & shadowing',
    {
      code: ['int x = 1;', '{', '  int y = 2;', '  int x = 10;   // shadows outer x', '  std::cout << x + y;', '}', '// y no longer exists', 'std::cout << x;'],
      steps: [
        { note: 'A variable lives from its declaration to the closing brace of its block.', line: 0, vars: [['x', '1', 'write']], out: '' },
        { note: 'Entering a block: y is pushed on the stack.', line: [1, 2], vars: [['x', '1'], ['y', '2', 'write']], out: '' },
        { note: 'An inner x hides the outer one. Legal, but a common source of bugs, so enable -Wshadow.', line: 3, vars: [['x', '1', 'visited'], ['y', '2'], ['x (inner)', '10', 'warn']], out: '' },
        { note: 'Inside the block, x means the inner one: 10 + 2.', line: 4, vars: [['x', '1', 'visited'], ['y', '2'], ['x (inner)', '10', 'current']], out: '12' },
        { note: 'At the brace, y and inner x are destroyed. The outer x was never touched.', line: [5, 7], vars: [['x', '1', 'ok']], out: '12\n1' },
      ],
      details: {
        x: { title: 'Outer x', text: 'Declared in the enclosing block, so visible inside nested blocks unless shadowed.' },
        y: { title: 'Block-scoped variable', text: 'Exists only between its declaration and the closing brace. Keep variables in the smallest scope that works.', code: 'for (int i = 0; i < n; ++i) { /* i only here */ }\nif (auto it = m.find(k); it != m.end()) { }' },
        'x (inner)': { title: 'Shadowing', text: 'Same name in an inner scope hides the outer variable. Compile with -Wshadow to catch it.' },
        out: OUT,
      },
    },
  ],
});

// ---------------- control flow ----------------
traceDemo('basics-control', 'Control flow', 'if/else, loops with break and continue, switch fallthrough, and range-for.', {
  loop: [
    'for, break, continue',
    {
      code: ['int sum = 0;', 'for (int i = 1; i <= 6; i++) {', '  if (i % 2 == 0) continue;  // skip evens', '  if (i > 4) break;           // stop at 5', '  sum += i;', '}', 'std::cout << sum;'],
      steps: [
        { note: 'The for header is init; condition; step. The condition is checked before every iteration.', line: [0, 1], vars: [['sum', '0'], ['i', '1', 'write']], out: '' },
        { note: 'i = 1 is odd and ≤ 4, so it is added.', line: 4, vars: [['sum', '1', 'write'], ['i', '1']], out: '' },
        { note: 'i = 2 is even: continue jumps straight to i++, skipping the rest of the body.', line: 2, vars: [['sum', '1'], ['i', '2', 'warn']], out: '' },
        { note: 'i = 3 is added, i = 4 skipped.', line: 4, vars: [['sum', '4', 'write'], ['i', '3']], out: '' },
        { note: 'i = 5 is odd but > 4, so break leaves the loop entirely.', line: 3, vars: [['sum', '4'], ['i', '5', 'fail']], out: '' },
        { note: 'i is gone (it was scoped to the loop), and sum is 1 + 3.', line: 6, vars: [['sum', '4', 'ok']], out: '4' },
      ],
      details: {
        sum: { title: 'Accumulator', text: 'A variable updated on each iteration. std::accumulate does the same for whole ranges.', code: '#include <numeric>\nint sum = std::accumulate(v.begin(), v.end(), 0);' },
        i: { title: 'Loop counter', text: 'Declared in the for header, so it only exists inside the loop. while and do-while are the other loop forms.', code: 'while (cond) { ... }\ndo { ... } while (cond); // runs at least once' },
        out: OUT,
      },
    },
  ],
  switch: [
    'switch',
    {
      code: ['enum class Op { Add, Sub, Mul };', 'int apply(Op op, int a, int b) {', '  switch (op) {', '    case Op::Add: return a + b;', '    case Op::Sub: a = -a;  // no break!', '    case Op::Mul: return a * b;', '  }', '  return 0;', '}'],
      steps: [
        { note: 'switch jumps to the matching case label. It works on integers and enums, not strings.', line: [2, 3], vars: [['op', 'Op::Add'], ['a', '3'], ['b', '4'], ['result', '7', 'ok']], rows: [['apply(Add, 3, 4)', 7]] },
        { note: 'Execution falls through into the next case unless something stops it.', line: [4, 5], vars: [['op', 'Op::Sub'], ['a', '-3', 'warn'], ['b', '4'], ['result', '-12', 'fail']], rows: [['apply(Sub, 3, 4)', '-12 (bug)', 'fail']] },
        { note: 'Add break or return to every case, and mark intended fallthrough with [[fallthrough]].', line: 4, vars: [['op', 'Op::Sub'], ['a', '3'], ['b', '4'], ['result', '-1', 'ok']], rows: [['fixed', '-1', 'ok']] },
        { note: 'With enum class and no default, -Wswitch warns when you add a new enumerator and forget a case.', line: 0, vars: [['op', 'Op::Div (new)', 'warn']], rows: [['-Wswitch', 'missing case', 'warn']] },
      ],
      details: {
        op: { title: 'enum class', text: 'A scoped, strongly typed enum. Values are written Op::Add and don’t convert to int silently.', code: 'enum class Color { Red, Green };\nColor c = Color::Red;\nint n = static_cast<int>(c);' },
        result: { title: 'Fallthrough', text: 'Cases are just labels. Without break, execution continues into the next one.', code: 'case 1:\n  doA();\n  [[fallthrough]];\ncase 2:\n  doB();\n  break;' },
      },
    },
  ],
  rangefor: [
    'range-for',
    {
      code: ['std::vector<int> v{1, 2, 3};', 'for (int x : v) x *= 10;       // copy', 'for (int& x : v) x *= 10;      // edit', 'for (const auto& s : names)    // no copy', '  std::cout << s;'],
      steps: [
        { note: 'A range-for visits every element of a container, array or anything with begin() and end().', line: 0, heap: [['buf', '1 | 2 | 3']], vars: [['v', 'vector (3)', undefined, 'buf']] },
        { note: 'int x is a copy of each element. Changing it changes nothing in v.', line: 1, heap: [['buf', '1 | 2 | 3', 'visited']], vars: [['v', 'vector (3)', undefined, 'buf'], ['x', 'copy → 30', 'warn']] },
        { note: 'int& x refers to the element itself, so the vector is updated.', line: 2, heap: [['buf', '10 | 20 | 30', 'write']], vars: [['v', 'vector (3)', undefined, 'buf'], ['x', 'ref → v[2]', 'ok', 'buf']] },
        { note: 'For big elements use const auto&: no copy, and no accidental edits.', line: [3, 4], heap: [['names', '"ann" | "bob"']], vars: [['s', 'const ref', 'ok', 'names']], out: 'annbob' },
      ],
      details: {
        v: { title: 'std::vector', text: 'A growable array. The vector object on the stack holds a pointer to elements on the heap.', code: 'std::vector<int> v{1, 2, 3};\nv.push_back(4);\nv.size(); // 4' },
        buf: { title: 'Element buffer', text: 'The contiguous heap block holding the elements.' },
        x: { title: 'Loop variable', text: 'By value copies each element; by reference aliases it.', code: 'for (auto x : v)        // copy\nfor (auto& x : v)       // modify\nfor (const auto& x : v) // read, no copy' },
        s: { title: 'const auto&', text: 'The default choice for reading elements of non-trivial type such as std::string.' },
        out: OUT,
      },
    },
  ],
});

// ---------------- functions ----------------
traceDemo('basics-functions', 'Functions & parameters', 'Pass by value, reference and pointer; returning; overloading and default arguments.', {
  value: [
    'By value',
    {
      code: ['void inc(int n) {', '  n++;', '}', 'int main() {', '  int a = 5;', '  inc(a);', '  std::cout << a;   // 5', '}'],
      steps: [
        { note: 'main has a = 5 in its stack frame.', line: 4, vars: [['a', '5', 'write']], out: '' },
        { note: 'Calling inc copies a into the parameter n, in a new frame.', line: [0, 5], vars: [['a', '5'], ['n (inc)', '5', 'write']], out: '' },
        { note: 'n++ changes the copy only.', line: 1, vars: [['a', '5'], ['n (inc)', '6', 'warn']], out: '' },
        { note: 'The frame is popped on return, and a is still 5.', line: 6, vars: [['a', '5', 'ok']], out: '5' },
      ],
      details: {
        a: { title: 'Caller’s variable', text: 'Lives in main’s stack frame.' },
        'n (inc)': { title: 'Value parameter', text: 'A fresh copy made at the call. Cheap for int and small types; expensive for big objects.', code: 'void f(int n);                 // copy, fine\nvoid g(std::vector<int> v);    // copies the whole vector!' },
        out: OUT,
      },
    },
  ],
  reference: [
    'By reference',
    {
      code: ['void inc(int& n) {', '  n++;', '}', 'void show(const std::string& s);', 'int main() {', '  int a = 5;', '  inc(a);', '  std::cout << a;   // 6', '}'],
      steps: [
        { note: 'int& n is another name for the caller’s variable. No copy is made.', line: [0, 6], vars: [['a', '5'], ['n (inc)', '→ a', 'accent']], out: '' },
        { note: 'n++ increments a itself.', line: 1, vars: [['a', '6', 'write'], ['n (inc)', '→ a', 'accent']], out: '' },
        { note: 'After the call, main sees the change.', line: 7, vars: [['a', '6', 'ok']], out: '6' },
        { note: 'const T& is the standard way to pass big objects you only read: no copy, no modification.', line: 3, vars: [['s', 'const ref, no copy', 'ok']], out: '6' },
      ],
      details: {
        'n (inc)': { title: 'Reference parameter', text: 'Use T& for out-parameters and const T& for read-only big objects. Under the hood it is usually a pointer.', code: 'void scale(std::vector<int>& v, int k);\nvoid print(const std::vector<int>& v);' },
        s: { title: 'const reference', text: 'Binds to anything, including temporaries, without copying.', code: 'show("hello");  // temporary string, still no extra copy' },
        out: OUT,
      },
    },
  ],
  pointer: [
    'By pointer',
    {
      code: ['bool parse(const char* s, int* out) {', '  if (!out) return false;', '  *out = std::atoi(s);', '  return true;', '}', 'int v = 0;', 'parse("42", &v);', 'parse("42", nullptr);'],
      steps: [
        { note: 'A pointer parameter receives an address. &v passes where v lives.', line: [5, 6], heap: [['v', 'v = 0']], vars: [['out', '&v', 'accent', 'v']], rows: [['call', 'parse("42", &v)']] },
        { note: '*out = … writes through the pointer into v.', line: 2, heap: [['v', 'v = 42', 'write']], vars: [['out', '&v', 'accent', 'v']], rows: [['v', 42, 'ok']] },
        { note: 'Unlike a reference, a pointer can be null, so the callee must check.', line: [1, 7], vars: [['out', 'nullptr', 'warn']], rows: [['returns', 'false', 'warn']] },
        { note: 'Rule of thumb: reference when the argument must exist, pointer when it is optional.', line: 0, vars: [['out', 'optional out-param']], rows: [['modern', 'return std::optional<int>']] },
      ],
      stackTitle: 'parse() frame',
      heapTitle: 'caller',
      details: {
        out: { title: 'Pointer parameter', text: 'Holds an address. *out reads or writes the pointed-to object; it may be nullptr.', code: 'void f(int* p) {\n  if (p) *p = 1;\n}' },
        v: { title: 'Caller’s variable', text: 'The object the pointer refers to. It lives in the caller’s frame.' },
      },
    },
  ],
  overload: [
    'Overloads & defaults',
    {
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
    },
  ],
});

// ---------------- arrays & strings ----------------
traceDemo('basics-arrays', 'Arrays & strings', 'C arrays and decay, std::array, C strings vs std::string, and out-of-bounds access.', {
  carray: [
    'C arrays',
    {
      code: ['int a[4] = {10, 20, 30, 40};', 'int* p = a;           // decays', 'sizeof(a);            // 16', 'sizeof(p);            // 8', 'a[4] = 99;            // out of bounds!', 'void f(int arr[]);    // really int*'],
      steps: [
        { note: 'A C array is a fixed block of elements, here 4 ints side by side.', line: 0, heap: [['arr', '10 | 20 | 30 | 40', 'write', 'a, 16 bytes']], vars: [['a', 'int[4]', undefined, 'arr']] },
        { note: 'Used as a value, an array decays to a pointer to its first element and loses its size.', line: [1, 2, 3], heap: [['arr', '10 | 20 | 30 | 40', undefined, 'a, 16 bytes']], vars: [['a', 'int[4], sizeof 16'], ['p', 'int*, sizeof 8', 'warn', 'arr']] },
        { note: 'No bounds check: a[4] writes past the end into whatever lives next.', line: 4, heap: [['arr', '10 | 20 | 30 | 40', undefined, 'a'], ['next', '99 overwrote a neighbour', 'fail']], vars: [['a', 'int[4]', undefined, 'arr']] },
        { note: 'Array parameters are really pointers, so a function can’t know the length. Prefer std::array, std::vector or std::span.', line: 5, vars: [['arr (param)', 'int*', 'warn']] },
      ],
      details: {
        a: { title: 'C array', text: 'Fixed size known at compile time. Doesn’t know its size once passed around.', code: 'int a[4] = {10, 20, 30, 40};\nstd::size(a); // 4 (only where a is the array)' },
        arr: { title: 'Array storage', text: 'Elements are contiguous: a[i] lives at address a + i * sizeof(int).' },
        p: { title: 'Array-to-pointer decay', text: 'Arrays convert to a pointer to element 0 in most expressions.', code: 'int* p = a;   // same as &a[0]\np[2] == a[2]; // true' },
        next: { title: 'Buffer overflow', text: 'Out-of-bounds writes corrupt neighbouring memory silently. Catch with -fsanitize=address.' },
        'arr (param)': { title: 'std::span', text: 'C++20 std::span is a pointer + length view over any contiguous array.', code: 'void f(std::span<const int> s) {\n  for (int x : s) ...\n}\nf(a); f(vec);' },
      },
    },
  ],
  stdarray: [
    'std::array & vector',
    {
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
    },
  ],
  strings: [
    'C strings vs std::string',
    {
      code: ['char buf[6] = "hello";   // 5 + \'\\0\'', 'std::strlen(buf);         // 5', 'char small[4];', 'std::strcpy(small, buf);  // overflow!', 'std::string s = "hello";', 's += " world";', 's.substr(0, 5);  s.find("wor");'],
      steps: [
        { note: 'A C string is a char array ending in a zero byte. strlen walks until it finds it.', line: [0, 1], vars: [['buf', "h e l l o \\0", 'write']], rows: [['strlen', 5], ['bytes', 6]] },
        { note: 'strcpy doesn’t know the destination size, so it writes past the end.', line: [2, 3], vars: [['buf', 'h e l l o \\0'], ['small', 'h e l l | o \\0 overflow', 'fail']], rows: [['overflow', '2 bytes', 'fail']] },
        { note: 'std::string manages its own memory and grows as needed.', line: [4, 5], heap: [['sbuf', '"hello world"', 'write']], vars: [['s', 'size 11', undefined, 'sbuf']], rows: [['size', 11]] },
        { note: 'It has the operations you want: substr, find, compare with ==. Use it everywhere except C APIs.', line: 6, heap: [['sbuf', '"hello world"']], vars: [['s', 'size 11', undefined, 'sbuf'], ['substr', '"hello"', 'ok'], ['find', '6', 'ok']], rows: [['C API', 's.c_str()']] },
      ],
      details: {
        buf: { title: 'C string', text: 'char array + terminating \\0. Every function relies on the terminator being there.', code: 'const char* p = "hi";  // {\'h\',\'i\',\'\\0\'}\nstd::strlen(p);        // 2' },
        small: { title: 'strcpy overflow', text: 'A top source of security bugs. Use std::string, or snprintf with a size.', code: 'std::snprintf(small, sizeof small, "%s", buf);' },
        s: { title: 'std::string', text: 'Owns its characters, tracks its length, and short strings (≤ 15 chars in libstdc++) live inside the object without a heap allocation.', code: 'std::string s = "hi";\ns += "!";\nif (s == "hi!") ...\nconst char* c = s.c_str();' },
        sbuf: { title: 'String buffer', text: 'Long strings keep their characters on the heap; short ones use the small-string buffer inside the object.' },
      },
    },
  ],
});

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

// ---------------- I/O & files ----------------
traceDemo('basics-io', 'I/O, streams & files', 'cout/cin, getline, stringstream parsing, and text and binary files.', {
  console: [
    'cin & cout',
    {
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
    },
  ],
  sstream: [
    'stringstream',
    {
      code: ['std::istringstream in("GET /index.html 200");', 'std::string method, path; int code;', 'in >> method >> path >> code;', 'std::ostringstream out;', 'out << method << " -> " << code;', 'std::string s = out.str();'],
      steps: [
        { note: 'istringstream reads from a string the way cin reads from the keyboard.', line: 0, vars: [['in', '"GET /index.html 200"', 'current']] },
        { note: 'The same >> operators split and convert the tokens.', line: [1, 2], vars: [['in', 'consumed', 'visited'], ['method', '"GET"', 'write'], ['path', '"/index.html"', 'write'], ['code', '200', 'write']] },
        { note: 'ostringstream builds a string with <<, handy for formatting.', line: [3, 4, 5], vars: [['method', '"GET"'], ['code', '200'], ['s', '"GET -> 200"', 'ok']] },
      ],
      details: {
        in: { title: 'std::istringstream', text: 'An input stream over a string. Great for parsing lines of text.', code: '#include <sstream>\nstd::istringstream in(line);\nint a, b;\nin >> a >> b;' },
        s: { title: 'std::ostringstream', text: 'Collects output into a string. C++20 std::format is the faster, typed alternative.', code: '#include <format>\nauto s = std::format("{} -> {}", method, code);' },
      },
    },
  ],
  files: [
    'Text & binary files',
    {
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
    },
  ],
});

// ---------------- exceptions ----------------
traceDemo('basics-exceptions', 'Exceptions', 'throw, try/catch, stack unwinding with destructors, and catching by reference.', {
  throw: [
    'throw & catch',
    {
      code: ['int parse(const std::string& s) {', '  if (s.empty())', '    throw std::invalid_argument("empty");', '  return std::stoi(s);', '}', 'try {', '  int n = parse("");', '} catch (const std::exception& e) {', '  std::cerr << e.what();', '}'],
      steps: [
        { note: 'main calls parse inside a try block.', line: [5, 6], vars: [['main', 'in try'], ['parse(s="")', 'frame', 'current']], out: '' },
        { note: 'throw creates an exception object and abandons normal flow.', line: [1, 2], vars: [['main', 'in try'], ['parse(s="")', 'throwing', 'fail']], heap: [['ex', 'invalid_argument("empty")', 'fail']], out: '' },
        { note: 'The stack unwinds: parse’s frame is popped without returning a value.', line: 7, vars: [['main', 'catching', 'current']], heap: [['ex', 'invalid_argument("empty")', 'fail']], out: '' },
        { note: 'The first matching catch runs. Catch by const reference to keep the real type.', line: [7, 8], vars: [['main', 'handled', 'ok'], ['e', 'const exception&', 'accent', 'ex']], heap: [['ex', 'invalid_argument("empty")']], out: '(stderr) empty' },
      ],
      heapTitle: 'exception object',
      details: {
        ex: { title: 'Exception object', text: 'Any type can be thrown; derive from std::exception so callers can catch it generically.', code: 'struct ConfigError : std::runtime_error {\n  using std::runtime_error::runtime_error;\n};\nthrow ConfigError("missing port");' },
        e: { title: 'catch by const&', text: 'Catching by value would slice a derived exception to its base and copy it.', code: 'catch (const ConfigError& e) { ... }\ncatch (const std::exception& e) { ... }\ncatch (...) { /* anything */ }' },
        'parse(s="")': { title: 'Throwing function', text: 'Its frame is destroyed during unwinding. Local objects’ destructors still run.' },
      },
    },
  ],
  unwind: [
    'Unwinding & RAII',
    {
      code: ['void work() {', '  std::ofstream log("w.log");', '  auto buf = std::make_unique<char[]>(4096);', '  int* raw = new int[100];', '  step();          // throws', '  delete[] raw;    // skipped!', '}'],
      steps: [
        { note: 'work acquires three resources: a file, a smart-pointer buffer, and a raw array.', line: [1, 2, 3], vars: [['log', 'open file', 'write'], ['buf', 'unique_ptr', 'write', 'b1'], ['raw', 'int*', 'write', 'b2']], heap: [['b1', '4096 B'], ['b2', '400 B']] },
        { note: 'step throws. Control leaves work immediately.', line: 4, vars: [['log', 'open file'], ['buf', 'unique_ptr', undefined, 'b1'], ['raw', 'int*', 'warn', 'b2']], heap: [['b1', '4096 B'], ['b2', '400 B']] },
        { note: 'Unwinding runs destructors: log closes, buf frees its block. delete[] raw never runs.', line: 5, vars: [['log', 'closed', 'ok'], ['buf', 'freed', 'ok']], heap: [['b2', '400 B leaked', 'fail']] },
        { note: 'Anything owned by an object is cleaned up, anything owned by hand leaks. Use RAII types for every resource.', line: 3, vars: [['raw', 'use std::vector<int>', 'ok']], heap: [] },
      ],
      details: {
        log: { title: 'RAII file', text: 'Closed by its destructor, even when an exception passes through.' },
        buf: { title: 'std::unique_ptr', text: 'Frees its memory in its destructor, so it can’t leak on exceptions.', code: 'auto buf = std::make_unique<char[]>(4096);' },
        b2: { title: 'Leaked block', text: 'Raw new has no destructor to free it. That is why modern C++ avoids naked new/delete.' },
      },
    },
  ],
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
