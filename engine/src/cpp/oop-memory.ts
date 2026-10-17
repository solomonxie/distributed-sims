// Classes & OOP, memory pictures (group cpp-oop): invariants, this, static members, member init order, construction and
// destruction order, temporaries, shallow vs deep copy, copy vs move, vtable dispatch, virtual destructors, dynamic_cast.
// Syntax-only parts (delegating ctors, explicit, override/final, interfaces, rule of zero) stay as line traces.
import type { Detail, Frame, Shape, Tone } from '../algo/frames';
import { box, Film, hex, panel, text } from '../machine/lib/draw';
import { cap, choice, liveGroup, num, number, pick } from '../machine/lib/live';
import type { P } from '../machine/lib/live';
import { Mem } from '../machine/lib/mem';
import { traceFrames } from '../machine/lib/trace';
import type { Trace } from '../machine/lib/trace';

const liveDemo = liveGroup('cpp-oop');
const OUT: Detail = { title: 'Console output', text: 'What the program printed so far. Constructors and destructors here print their names so you can see the order.' };

const delegateTrace: Trace = {
  code: ['class Url {', 'public:', '  Url(std::string host, int port)', '    : host_(std::move(host)), port_(port) {}', '  Url(std::string host) : Url(std::move(host), 80) {}', '  Url() : Url("localhost") {}', 'private:', '  std::string host_; int port_;', '};', 'Url u;'],
  steps: [
    { note: 'Url() delegates to Url(std::string) instead of repeating code.', line: [5, 9], vars: [['u', 'constructing…', 'current']] },
    { note: 'Which delegates to the full constructor with the default port.', line: 4, vars: [['u', 'constructing…', 'current'], ['host', '"localhost"'], ['port', '80']] },
    { note: 'Only the target constructor initialises members. The object is complete when it returns.', line: [2, 3], vars: [['u', 'Url{"localhost", 80}', 'ok']] },
  ],
  details: {
    u: { title: 'Delegating constructor', text: 'One constructor calls another in its init list, so the real work lives in one place.' },
    host: { title: 'Pass by value, then move', text: 'Taking std::string by value and moving it into the member is cheap for both lvalue and rvalue callers.' },
  },
};

const explicitTrace: Trace = {
  code: ['struct Timeout { Timeout(int ms) : ms(ms) {} int ms; };', 'void wait(Timeout t);', 'wait(5);            // silently Timeout(5)', 'struct Port { explicit Port(int p) : p(p) {} int p; };', 'void bind(Port p);', 'bind(8080);         // error', 'bind(Port{8080});   // ok'],
  steps: [
    { note: 'A one-argument constructor is also an implicit conversion from int.', line: [0, 1], vars: [['Timeout(int)', 'converting ctor', 'warn']] },
    { note: 'So wait(5) compiles, but is that 5 ms or 5 seconds? The type didn’t protect you.', line: 2, vars: [['t', 'Timeout{5}', 'warn']] },
    { note: 'explicit turns off the conversion. bind(8080) is now a compile error.', line: [3, 4, 5], vars: [['bind(8080)', 'error', 'fail']] },
    { note: 'Callers must name the type, which documents intent. Make single-argument constructors explicit by default.', line: 6, vars: [['p', 'Port{8080}', 'ok']] },
  ],
  details: {
    'Timeout(int)': { title: 'Converting constructor', text: 'Any constructor callable with one argument, and not explicit, lets the compiler convert automatically.' },
    'bind(8080)': { title: 'explicit', text: 'Blocks implicit conversion and copy-initialisation.', code: 'explicit Port(int p);\nPort a = 80;   // error\nPort b{80};    // ok' },
  },
};

const rule0Trace: Trace = {
  code: ['class Buf {', '  std::vector<char> data_;', 'public:', '  explicit Buf(std::size_t n) : data_(n) {}', '};', 'Buf a(16);', 'Buf b = a;             // deep copy, free', 'Buf c = std::move(a);  // move, free'],
  steps: [
    { note: 'Hold resources in members that already manage themselves: vector, string, unique_ptr.', line: [0, 1, 3], vars: [['a', 'data_ →', undefined, 'b1']], heap: [['b1', '16 B']] },
    { note: 'The generated copy copies the vector, which copies deeply.', line: 6, vars: [['a', 'data_ →', undefined, 'b1'], ['b', 'data_ →', 'ok', 'b2']], heap: [['b1', '16 B'], ['b2', '16 B copy', 'write']] },
    { note: 'The generated move moves the vector. You wrote none of the five, and all are correct.', line: 7, vars: [['a', 'empty', 'visited'], ['b', 'data_ →', undefined, 'b2'], ['c', 'data_ →', 'ok', 'b1']], heap: [['b1', '16 B'], ['b2', '16 B copy']] },
  ],
  details: {
    a: { title: 'Rule of zero', text: 'Write no special members at all; let RAII members do the work. This is the default for application classes.', code: 'struct Session {\n  std::string user;\n  std::unique_ptr<Socket> sock;  // move-only\n};' },
  },
};

const overrideTrace: Trace = {
  code: ['struct Base { virtual void run(int n); };', 'struct A : Base { void run(long n); };           // new fn!', 'struct B : Base { void run(long n) override; };  // error', 'struct C final : Base { void run(int) override; };', 'struct D : C {};                                 // error'],
  steps: [
    { note: 'A’s run(long) doesn’t match run(int), so it silently hides it instead of overriding.', line: [0, 1], vars: [['A::run', 'not virtual override', 'fail']] },
    { note: 'override makes the compiler check the signature. B fails to compile, which is what you want.', line: 2, vars: [['B::run', 'compile error', 'ok']] },
    { note: 'final forbids further overriding or deriving, and lets the compiler devirtualise calls.', line: [3, 4], vars: [['C', 'final', 'ok'], ['D : C', 'compile error', 'fail']] },
  ],
  details: {
    'A::run': { title: 'Accidental hiding', text: 'Different parameter types or a missing const make a new function, not an override.' },
    'B::run': { title: 'override', text: 'Always write override on overriding functions. Clang-tidy’s modernize-use-override adds it.', code: 'void run(int n) override;' },
    C: { title: 'final', text: 'On a class: no subclasses. On a function: no further overrides.' },
  },
};

const interfaceTrace: Trace = {
  code: ['struct Logger {                 // interface', '  virtual void write(std::string_view) = 0;', '  virtual ~Logger() = default;', '};', 'struct FileLog : Logger {', '  void write(std::string_view) override; };', 'struct TestLog : Logger {', '  std::vector<std::string> lines; … };', 'void serve(Logger& log) { log.write("ok"); }'],
  steps: [
    { note: '= 0 makes a function pure virtual, and the class abstract: you can’t create a Logger.', line: [0, 1, 2], vars: [['Logger', 'abstract', 'current']] },
    { note: 'Concrete classes implement the interface.', line: [4, 5, 6, 7], vars: [['Logger', 'abstract'], ['FileLog', 'writes a file', 'write'], ['TestLog', 'stores lines', 'write']] },
    { note: 'serve depends only on Logger. Production passes a FileLog, tests pass a TestLog.', line: 8, vars: [['serve(file)', 'FileLog::write', 'ok'], ['serve(test)', 'TestLog::write', 'ok']] },
  ],
  details: {
    Logger: { title: 'Abstract class / interface', text: 'Only pure virtual functions and a virtual destructor. The seam that decouples modules and enables fakes in tests.' },
    TestLog: { title: 'Test double', text: 'A fake implementation used in unit tests to observe behaviour without real I/O.', code: 'TestLog log;\nserve(log);\nassert(log.lines == std::vector<std::string>{"ok"});' },
  },
};

// ---------------- class basics: invariant, this, static ----------------
const CD: Record<string, Detail> = {
  cents: { title: 'private member', text: 'Only member functions (and friends) can touch it, so every change goes through code that checks the invariant.', code: 'class Account {\npublic:\n  void deposit(int c);\n  int balance() const;\nprivate:\n  int cents_ = 0;  // invariant: >= 0\n};' },
  c: { title: 'Parameter', text: 'The amount the caller asked for. deposit decides whether it is allowed.' },
  this: { title: 'this', text: 'A pointer to the object a member function was called on. a.add(1) is compiled as Counter::add(&a, 1).', code: 'a.add(1);\n// is really\nCounter::add(&a, 1);' },
  live: { title: 'static data member', text: 'One variable for the whole class, stored like a global. inline (C++17) lets you define it in the class.', code: 'class Conn {\n  static inline int live_ = 0;\n};' },
};
const AMOUNTS = ['500', '-9', 'direct'];

function encaps(p: P): Frame[] {
  const how = pick(p.amt, AMOUNTS, '500');
  const m = new Mem({ panel: 'Account', details: CD });
  m.region('obj', 'Account acct · object').v('cents', 'obj', 0, 'cents_ (private)', '0x10', '0');
  m.snap('An Account is just its data: one private int. The class promises cents_ never goes below 0.', 'Account acct;', { rows: [['invariant', 'cents_ ≥ 0', 'ok']] });
  if (how === 'direct') {
    m.snap('Outside code tries to write the member directly. private makes that a compile error: the invariant cannot be bypassed.', 'acct.cents_ = -1;', { finger: 'cents', hot: { cents: 'fail' }, rows: [['compile', 'error: private', 'fail']] });
    m.snap('The only way in is the public interface. balance() is const: it can read cents_, never change it.', 'acct.balance();   // 0', { finger: 'cents', hot: { cents: 'ok' }, rows: [['invariant', 'kept', 'ok']] });
    return m.frames();
  }
  const c = Number(how);
  m.region('fn', 'deposit(int c) · frame').v('c', 'fn', 0, 'c', '0x7c0', String(c));
  m.snap(`Outside code must go through deposit(${c}). The member function runs with c = ${c}.`, `acct.deposit(${c});`, { finger: 'c', rows: [['c', c]] });
  if (c <= 0) {
    m.snap(`if (c <= 0) is true, so deposit throws before touching cents_.`, '  if (c <= 0) throw std::invalid_argument("c");', { finger: 'c', hot: { c: 'fail', cents: 'ok' }, rows: [['thrown', 'invalid_argument', 'fail'], ['cents_', 0, 'ok']] });
  } else {
    m.set('cents', String(c));
    m.snap(`c passes the check, so cents_ += ${c}.`, '  cents_ += c;', { finger: 'cents', hot: { cents: 'write' }, rows: [['cents_', c, 'ok']] });
  }
  m.kill('fn', 'deposit() finished');
  m.snap(c <= 0 ? 'The bad amount was rejected and the balance is unchanged. Whatever callers do, cents_ stays valid.' : 'Every change went through the check, so the balance is valid by construction.', 'acct.balance();', { finger: 'cents', hot: { cents: 'ok' }, rows: [['balance()', Math.max(0, c), 'ok'], ['invariant', 'kept', 'ok']] });
  return m.frames();
}

function thisPtr(p: P): Frame[] {
  const byRef = pick(p.ret, ['ref', 'value'], 'ref') === 'ref';
  const ret = byRef ? 'Counter&' : 'Counter';
  const m = new Mem({ panel: 'this', details: CD });
  m.region('objs', 'objects in main').v('a', 'objs', 0, 'a.n', '0x10', '0').v('b', 'objs', 1, 'b.n', '0x14', '0');
  m.snap('Two Counter objects, each with its own n. The member function add exists once, in the code.', `${ret} add(int k) { n += k; return *this; }`, { rows: [['objects', 2]] });
  m.region('fr', 'add(1) · frame').v('this', 'fr', 0, 'this', '0x7c0', '0x10', { to: 'a' }).v('k', 'fr', 1, 'k', '0x7c8', '1');
  m.snap('a.add(1) passes &a as a hidden first argument: this. Inside, n means this->n.', 'a.add(1)', { finger: 'this', rows: [['this', '&a']] });
  m.set('a', '1').snap('n += k follows this to a and adds 1.', '  this->n += k;', { finger: 'a', hot: { a: 'write' }, rows: [['a.n', 1]] });
  if (byRef) {
    m.revive('fr', 'add(2) · frame').v('this', 'fr', 0, 'this', '0x7c0', '0x10', { to: 'a' }).v('k', 'fr', 1, 'k', '0x7c8', '2');
    m.snap('return *this hands back a itself (a reference), so .add(2) runs on a again.', 'a.add(1).add(2)', { finger: 'this', rows: [['returned', 'a (Counter&)', 'ok']] });
    m.set('a', '3').snap('a.n is 3. Chaining works because each call returns the same object.', '  this->n += k;', { finger: 'a', hot: { a: 'ok' }, rows: [['a.n', 3, 'ok']] });
  } else {
    m.region('tmp', 'temporary copy').v('t', 'tmp', 0, 'copy.n', '0x900', '1');
    m.snap('Returning Counter by value copies *this into a temporary. .add(2) is called on that copy.', 'a.add(1).add(2)', { fly: ['a', 't'], rows: [['returned', 'a copy', 'warn']] });
    m.revive('fr', 'add(2) · frame').v('this', 'fr', 0, 'this', '0x7c0', '0x900', { to: 't' }).v('k', 'fr', 1, 'k', '0x7c8', '2');
    m.set('t', '3').snap('this now points at the copy, so the 2 is added there and a stays at 1.', '  this->n += k;', { finger: 't', hot: { t: 'warn', a: 'fail' }, rows: [['copy.n', 3, 'warn'], ['a.n', 1, 'fail']] });
    m.kill('tmp', 'temporary destroyed at ;');
    m.snap('At the semicolon the copy dies, taking the +2 with it. Return Counter& to chain on the same object.', 'std::cout << a.n;   // 1', { finger: 'a', hot: { a: 'fail' }, rows: [['a.n', 1, 'fail'], ['fix', 'return Counter&', 'ok']] });
  }
  m.kill('fr', 'add() returned');
  m.revive('fr', 'b.add(10) · frame').v('this', 'fr', 0, 'this', '0x7c0', '0x14', { to: 'b' }).v('k', 'fr', 1, 'k', '0x7c8', '10');
  m.set('b', '10').snap('b.add(10) runs the same code with this = &b. One function, any object.', 'b.add(10);', { finger: 'b', hot: { b: 'write' }, rows: [['this', '&b'], ['b.n', 10]] });
  return m.frames();
}

function statics(p: P): Frame[] {
  const n = num(p.n, 2, 1, 4);
  const names = ['a', 'b', 'c', 'd'].slice(0, n);
  const m = new Mem({ panel: 'static', details: CD });
  m.region('st', 'static storage · one per class').v('live', 'st', 0, 'Conn::live_', '0x600', '0');
  m.region('blk', '{ block }');
  m.snap('live_ is static: it exists once for the whole class, before any object, like a global with a class name.', 'static inline int live_ = 0;', { finger: 'live', rows: [['live_', 0]] });
  names.forEach((x, k) => {
    m.v(x, 'blk', k, x, `0x${(0x10 + k * 8).toString(16)}`, 'Conn').set('live', String(k + 1));
    m.snap(`Constructing ${x}: Conn() runs ++live_. Every object bumps the same counter.`, `Conn ${x};`, { finger: 'live', hot: { [x]: 'write' }, rows: [['objects', k + 1], ['live_', k + 1]] });
  });
  m.snap(`Conn::live() is a static member function: no object, no this. It returns ${n}.`, 'Conn::live();', { finger: 'live', hot: { live: 'ok' }, rows: [['live()', n, 'ok']] });
  [...names].reverse().forEach((x, k) => {
    m.free(x).set('live', String(n - k - 1));
  });
  m.kill('blk', '} block ended');
  m.snap(`At the brace ${names.length > 1 ? `${[...names].reverse().join(', ')} are destroyed in reverse order` : 'a is destroyed'}, and each ~Conn() runs --live_.`, '}', { finger: 'live', rows: [['live_', 0, 'ok']] });
  m.snap('The counter outlives every object: it is back to 0, still there for the next Conn.', 'Conn::live();   // 0', { finger: 'live', hot: { live: 'ok' }, rows: [['live()', 0, 'ok']] });
  return m.frames();
}

liveDemo(
  'oop-class',
  'Classes, this & static',
  'An invariant guarded by a private member, the hidden this pointer (and the copy that breaks chaining), and one static counter shared by every object.',
  {
    encaps: ['Encapsulation', encaps],
    this: ['this', thisPtr],
    static: ['static members', statics],
  },
  [
    choice('amt', 'call', AMOUNTS, '500', { for: ['encaps'], labels: ['deposit(500)', 'deposit(-9)', 'cents_ = -1'] }),
    choice('ret', 'add returns', ['ref', 'value'], 'ref', { for: ['this'], labels: ['Counter&', 'Counter'] }),
    number('n', 'objects', 1, 4, 2, { for: ['static'] }),
  ],
);

// ---------------- constructors: member init order ----------------
const ID: Record<string, Detail> = {
  m0: { title: 'Declaration order', text: 'Members are always constructed top to bottom as declared, whatever order the init list uses. -Wreorder warns when they differ.', code: 'class A {\n  int x_, y_;\npublic:\n  A() : y_(1), x_(y_) {} // x_ reads garbage\n};' },
  blk: { title: 'Heap block', text: 'new char[size_] allocates however many bytes size_ holds at that moment.' },
};

function initList(p: P): Frame[] {
  const fixed = pick(p.decl, ['data', 'size'], 'data') === 'size';
  const order = fixed ? ['size_', 'data_'] : ['data_', 'size_'];
  const m = new Mem({ panel: 'Init order', details: ID });
  m.region('obj', `Buffer b(16) · members in declaration order`);
  order.forEach((x, k) => m.v(`m${k}`, 'obj', k, `${k + 1}. ${x}`, `0x${(0x10 + k * 8).toString(16)}`, '???'));
  m.region('heap', 'heap');
  m.snap(`The members are declared ${order.join(' then ')}. Before construction they hold garbage.`, 'Buffer(n) : data_(new char[size_]), size_(n) {}', { rows: [['declared', order.join(', ')]] });
  if (!fixed) {
    m.v('blk', 'heap', 0, 'new char[???]', '0x900', '? B', {}).set('m0', '0x900', 'blk');
    m.snap('data_ is declared first, so its initialiser runs first, and it reads size_, which is still garbage.', '  data_(new char[size_])', { finger: 'm0', hot: { m0: 'fail', m1: 'fail', blk: 'fail' }, rows: [['size_ read', 'garbage', 'fail']] });
    m.set('m1', '16');
    m.snap('Only now is size_ set to 16, too late. The list order in the source changed nothing.', '  size_(n)', { finger: 'm1', hot: { m1: 'write', blk: 'fail' }, rows: [['buffer size', 'garbage', 'fail'], ['-Wreorder', 'warns', 'warn']] });
    m.snap('Fix: declare size_ before data_, or better, build data_ from the parameter n rather than another member.', 'data_(new char[n])', { finger: null, hot: { blk: 'fail' }, rows: [['fix', 'new char[n]', 'ok']] });
  } else {
    m.set('m0', '16');
    m.snap('size_ is declared first now, so it is initialised first: 16.', '  size_(n)', { finger: 'm0', hot: { m0: 'write' }, rows: [['size_', 16, 'ok']] });
    m.v('blk', 'heap', 0, 'new char[16]', '0x900', '16 B').set('m1', '0x900', 'blk');
    m.snap('Then data_ reads a valid size_ and allocates 16 bytes.', '  data_(new char[size_])', { finger: 'm1', hot: { blk: 'ok' }, rows: [['buffer size', '16 B', 'ok']] });
    m.snap('Correct, but fragile: reorder the declarations later and it breaks. new char[n] avoids the dependency.', 'data_(new char[n])', { finger: null, rows: [['safer', 'use n', 'ok']] });
  }
  return m.frames();
}

liveDemo(
  'oop-ctors',
  'Constructors',
  'Members built in declaration order whatever the init list says (flip the declarations to see the garbage read go away), delegating constructors, and explicit.',
  {
    initlist: ['Init lists & order', initList],
    delegate: ['Delegating ctors', () => traceFrames(delegateTrace)],
    explicit: ['explicit', () => traceFrames(explicitTrace)],
  },
  [choice('decl', 'declared first', ['data', 'size'], 'data', { for: ['initlist'], labels: ['data_', 'size_'] })],
);

// ---------------- lifetime: construction order, scopes, temporaries ----------------
const MEMBERS = ['Log', 'Cfg', 'Db'];

function order(p: P): Frame[] {
  const n = num(p.n, 1, 1, 3);
  const parts = ['Base', ...MEMBERS.slice(0, n).map((x) => x.toLowerCase()), 'App body'];
  const kinds = ['base', ...MEMBERS.slice(0, n).map(() => 'member'), 'body'];
  const ph = Math.min(120, 520 / parts.length);
  const f = new Film();
  let log: string[] = [];
  const scene = (built: number, gone: number, cur: number | undefined, stmt: string): Shape[] => {
    const out: Shape[] = [...cap(stmt), box('obj', 40, 120, 480, parts.length * (ph + 10) + 60, undefined, { tone: 'muted', filled: false }), text('objt', 60, 150, 'App a', { align: 'left', size: 24, bold: true, tone: 'muted' })];
    parts.forEach((x, k) => {
      const live = k < built && k < parts.length - gone;
      const tone: Tone = k === cur ? 'current' : live ? (kinds[k] === 'base' ? 'protocol' : kinds[k] === 'body' ? 'ok' : 'accent') : 'muted';
      out.push(box(`p${k}`, 60, 170 + k * (ph + 10), 440, ph, kinds[k] === 'member' ? `${MEMBERS[k - 1]} ${x}` : x, { sub: kinds[k], tone, dashed: !live, filled: live || k === cur }));
    });
    out.push(box('log', 560, 120, 400, 600, undefined, { tone: 'muted', filled: false }), text('logt', 580, 150, 'output', { align: 'left', size: 24, bold: true, tone: 'muted' }));
    log.slice(-12).forEach((l, k) => out.push(text(`l${k}`, 580, 196 + k * 42, l, { align: 'left', size: 28, mono: true, tone: l.startsWith('~') ? 'warn' : 'ok' })));
    return out;
  };
  const say = (s: string) => (log = [...log, s]);
  f.add('App derives from Base and has ' + (n === 1 ? 'one member' : `${n} members`) + '. Each part prints its name when built and destroyed.', scene(0, 0, undefined, '{ App a;'), panel('Lifetime', [['parts', parts.length]]));
  parts.forEach((x, k) => {
    say(kinds[k] === 'body' ? 'App' : kinds[k] === 'base' ? 'Base' : MEMBERS[k - 1]);
    const why = kinds[k] === 'base' ? 'The base class is built first: the derived parts may use it.' : kinds[k] === 'body' ? 'The constructor body runs last, when every part already exists.' : `Then members, top to bottom in declaration order: ${MEMBERS[k - 1]} ${x}.`;
    f.add(why, scene(k + 1, 0, k, kinds[k] === 'body' ? '  App() { say("App"); }' : kinds[k] === 'base' ? '  : Base()' : `  ${MEMBERS[k - 1]} ${x};`), panel('Lifetime', [['built', `${k + 1}/${parts.length}`]]));
  });
  for (let g = 0; g < parts.length; g++) {
    const k = parts.length - 1 - g;
    say('~' + (kinds[k] === 'body' ? 'App' : kinds[k] === 'base' ? 'Base' : MEMBERS[k - 1]));
    const why = kinds[k] === 'body' ? 'At the closing brace destruction runs in exact reverse. First the ~App() body.' : kinds[k] === 'base' ? 'The base goes last, so nothing above it is left using it.' : `Then members bottom to top: ~${MEMBERS[k - 1]}.`;
    f.add(why, scene(parts.length, g + 1, k, g === 0 ? '}' : `~${kinds[k] === 'base' ? 'Base' : MEMBERS[k - 1]}()`), panel('Lifetime', [['left', parts.length - g - 1]]));
  }
  f.add('Built base → members → body, destroyed body → members → base. Later parts may depend on earlier ones, so they go first.', scene(parts.length, parts.length, undefined, '}'), panel('Lifetime', [['order', 'mirror image', 'ok']]));
  return f.frames;
}

const LD: Record<string, Detail> = {
  a: { title: 'Automatic lifetime', text: 'Stack objects end at the end of their scope, in reverse order of construction. RAII builds on this guarantee.' },
  b: { title: 'Why reverse order', text: 'Later objects may depend on earlier ones, so they must go first.', code: 'std::mutex m;\nstd::lock_guard lock(m);  // destroyed before m' },
  tmp: { title: 'Temporary', text: 'An unnamed object created by an expression. It dies at the end of the full expression (the ;).' },
  p: { title: 'Dangling from a temporary', text: 'Common with c_str(), string_view and iterators into temporaries.', code: 'std::string_view v = std::string("x"); // dangles' },
};

function scopes(): Frame[] {
  const m = new Mem({ panel: 'Scopes', details: LD, out: true });
  m.region('main', 'main()').region('blk', '{ block }');
  m.v('a', 'main', 0, 'a', '0x10', 'T("a")').snap('a is constructed in main’s scope.', 'T a("a");', { out: '+a' });
  m.v('b', 'blk', 1, 'b', '0x18', 'T("b")').snap('Inside the block, b is constructed…', '{  T b("b");', { out: '+a\n+b' });
  m.v('c', 'blk', 2, 'c', '0x20', 'T("c")').snap('…then c. Three objects alive.', '   T c("c");', { out: '+a\n+b\n+c' });
  m.free('c').snap('At the brace the block’s objects die in reverse: c first…', '}', { finger: 'c', out: '+b\n+c\n-c' });
  m.free('b').kill('blk', '} block ended').snap('…then b. a is untouched: its scope is still open.', '}', { finger: 'b', out: '+c\n-c\n-b' });
  m.drop('blk').v('d', 'main', 1, 'd', '0x18', 'T("d")').snap('d is built, reusing the stack space the block gave back.', 'T d("d");', { finger: 'd', out: '-c\n-b\n+d' });
  m.free('d').free('a').kill('main', 'main() returned').snap('At return d then a are destroyed. Last in, first out, like the stack itself.', 'return 0;', { finger: null, out: '+d\n-d\n-a' });
  return m.frames();
}

const KEEPS = ['ptr', 'ref', 'value'];

function temps(p: P): Frame[] {
  const keep = pick(p.keep, KEEPS, 'ptr');
  const stmt = keep === 'ptr' ? 'const char* p = name().c_str();' : keep === 'ref' ? 'const std::string& p = name();' : 'std::string p = name();';
  const m = new Mem({ panel: 'Temporaries', details: LD, out: true });
  m.region('main', 'main() · stack');
  m.region('tmps', 'temporaries & heap');
  if (keep === 'value') {
    m.v('p', 'main', 0, 'p', '0x10', '"ada"');
    m.snap('name() returns a std::string, and here it is built straight into p (copy elision): no temporary at all.', stmt, { finger: 'p', hot: { p: 'ok' }, out: '' });
    m.snap('p is an ordinary local that owns its characters. Nothing can dangle.', 'std::cout << p;', { finger: 'p', hot: { p: 'ok' }, out: 'ada', rows: [['p', 'owns "ada"', 'ok']] });
    m.snap('Keeping a value is the simplest choice and usually costs nothing extra.', '// best', { finger: null, out: 'ada', rows: [['copies', 0, 'ok']] });
    return m.frames();
  }
  m.v('tmp', 'tmps', 0, 'temporary string', '0x900', '"ada"');
  m.v('p', 'main', 0, keep === 'ptr' ? 'p (const char*)' : 'p (const string&)', '0x10', '0x900', { to: 'tmp' });
  m.snap('name() returns a temporary string: an unnamed object that lives until the end of the full expression.', stmt, { finger: 'tmp', out: '' });
  if (keep === 'ptr') {
    m.free('tmp');
    m.snap('At the semicolon the temporary is destroyed. p still holds its old address: it dangles.', stmt, { finger: 'p', hot: { p: 'fail' }, out: '', rows: [['tmp', 'destroyed', 'fail']] });
    m.snap('Reading through p is undefined behaviour: it may print ada, garbage, or crash.', 'std::cout << p;', { finger: 'tmp', hot: { tmp: 'fail' }, out: '??? (UB)', rows: [['read', 'freed memory', 'fail']] });
  } else {
    m.rename('tmp', 'temporary (extended)');
    m.snap('Binding a temporary directly to a const reference extends its life to the reference’s scope.', stmt, { finger: 'tmp', hot: { tmp: 'ok' }, out: '', rows: [['tmp', 'lives as long as p', 'ok']] });
    m.snap('So p is valid here. The rule only works for direct binding, not through a function that returns a reference.', 'std::cout << p;', { finger: 'tmp', hot: { tmp: 'ok' }, out: 'ada', rows: [['p', 'valid', 'ok']] });
  }
  return m.frames();
}

liveDemo(
  'oop-lifetime',
  'Object lifetime & order',
  'An object built part by part (base, members, body) and torn down in mirror order, stack objects dying with their scopes, and a temporary outliving or not outliving the line that made it.',
  {
    order: ['Base, members, body', order],
    scopes: ['Scopes', scopes],
    temps: ['Temporaries', temps],
  },
  [number('n', 'members', 1, 3, 1, { for: ['order'] }), choice('keep', 'keep it as', KEEPS, 'ptr', { for: ['temps'], labels: ['c_str()', 'const&', 'value'] })],
  { log: OUT },
);

// ---------------- copying: shallow vs deep, copy vs move ----------------
const KD: Record<string, Detail> = {
  a: { title: 'Owning raw pointer', text: 'If a class owns a resource through a raw handle, the compiler-generated copy is wrong: it copies the handle, not the resource.' },
  b: { title: 'Member-wise copy', text: 'The implicit copy constructor copies each member. For a pointer that means the address, so two objects share one block.' },
  b1: { title: 'Heap block', text: 'One allocation must be freed exactly once.' },
  c: { title: 'Move constructor', text: 'Transfers ownership: steal the pointer, null the source. Mark it noexcept so std::vector uses it when growing.', code: 'Buf(Buf&& o) noexcept\n  : p_(std::exchange(o.p_, nullptr)), n_(o.n_) {}' },
};

function shallow(p: P): Frame[] {
  const deep = pick(p.copy, ['implicit', 'deep'], 'implicit') === 'deep';
  const m = new Mem({ panel: 'Copy', details: KD });
  m.region('stk', 'main() · stack').region('heap', 'heap');
  m.v('b1', 'heap', 0, 'block', '0x900', '"hi"').v('a', 'stk', 0, 'a.p_', '0x10', '0x900', { to: 'b1' });
  m.snap('a owns a heap block through a raw pointer. Its destructor does delete[] p_.', 'Buf a("hi");', { rows: [['blocks', 1], ['owners', 1]] });
  if (!deep) {
    m.v('b', 'stk', 1, 'b.p_', '0x18', '0x900', { to: 'b1' });
    m.snap('The implicit copy constructor copies p_ itself: b points at the same block. Two owners, one block.', 'Buf b = a;', { fly: ['a', 'b'], hot: { b1: 'warn' }, rows: [['blocks', 1], ['owners', 2, 'warn']] });
    m.set('b1', '"Ho"').snap('Writing through b changes what a sees too: they were never separate.', "b.p_[0] = 'H';", { finger: 'b1', hot: { b1: 'warn' }, rows: [['a reads', '"Ho"', 'warn']] });
    m.free('b1').gone('b').snap('At the brace b is destroyed first and frees the block. a still points at it.', '} // ~b', { finger: 'a', hot: { a: 'fail' }, rows: [['a.p_', 'dangling', 'fail']] });
    m.snap('Then ~a frees the same block again: a double free, heap corruption or a crash. Write a deep copy, or hold a std::vector.', '} // ~a', { finger: 'b1', hot: { b1: 'fail' }, rows: [['delete[]', '2 × same block', 'fail'], ['ASan', 'double-free', 'fail']] });
  } else {
    m.v('b2', 'heap', 1, 'block', '0x980', '"hi"').v('b', 'stk', 1, 'b.p_', '0x18', '0x980', { to: 'b2' });
    m.snap('A deep copy constructor allocates b’s own block and copies the bytes into it.', 'Buf(const Buf& o) : p_(new char[o.n_]) { copy… }', { fly: ['b1', 'b2'], rows: [['blocks', 2, 'ok'], ['owners', '1 each', 'ok']] });
    m.set('b2', '"Ho"').snap('Writing through b changes only b’s block.', "b.p_[0] = 'H';", { finger: 'b2', hot: { b1: 'ok' }, rows: [['a reads', '"hi"', 'ok']] });
    m.free('b2').gone('b').snap('~b frees b’s block…', '} // ~b', { finger: 'b2', rows: [['freed', 1]] });
    m.free('b1').gone('a').snap('…and ~a frees a’s: each block freed exactly once. That is the rule of three: destructor, copy ctor and copy assignment together.', '} // ~a', { finger: null, rows: [['freed', 2, 'ok'], ['rule', 'of three / five', 'ok']] });
  }
  return m.frames();
}

function move(p: P): Frame[] {
  const mv = pick(p.how, ['copy', 'move'], 'move') === 'move';
  const m = new Mem({ panel: mv ? 'Move' : 'Copy', details: KD });
  m.region('stk', 'main() · stack').region('heap', 'heap');
  m.v('b1', 'heap', 0, 'block', '0x900', '1 MB').v('a', 'stk', 0, 'a.p_', '0x10', '0x900', { to: 'b1' });
  m.snap('a owns a 1 MB block. We want c to hold the same contents.', 'Buf a(1 << 20);', { rows: [['a', '1 MB']] });
  if (mv) {
    m.v('c', 'stk', 1, 'c.p_', '0x18', '0x900', { to: 'b1' });
    m.snap('std::move(a) selects the move constructor: c takes a’s pointer. No allocation, no bytes copied.', 'Buf c = std::move(a);', { fly: ['a', 'c'], hot: { c: 'write' }, rows: [['allocated', '0 B', 'ok'], ['copied', '8 B (a pointer)', 'ok']] });
    m.set('a', 'nullptr', null).snap('a.p_ is set to nullptr, so ~a will free nothing. a is valid but empty: assign to it or let it die.', '  o.p_ = nullptr;', { finger: 'a', hot: { a: 'visited' }, rows: [['a', 'empty', 'muted'], ['owners of block', 1, 'ok']] });
    m.free('b1').snap('At the end only c frees the block. Exactly one owner the whole time.', '} // ~c, ~a', { finger: 'b1', rows: [['freed', 'once', 'ok']] });
  } else {
    m.v('b2', 'heap', 1, 'block', '0xA00', '1 MB').v('c', 'stk', 1, 'c.p_', '0x18', '0xA00', { to: 'b2' });
    m.snap('Plain c = a calls the copy constructor: a second 1 MB block is allocated and every byte copied.', 'Buf c = a;', { fly: ['b1', 'b2'], hot: { b2: 'warn' }, rows: [['allocated', '1 MB', 'warn'], ['copied', '1 MB', 'warn']] });
    m.snap('Fine if a is still needed. If a is never used again, that copy was wasted work: std::move(a) would just hand the block over.', 'a.~Buf();  // a unused after this', { finger: 'b1', hot: { b1: 'warn' }, rows: [['use', 'std::move(a)', 'ok']] });
    m.free('b1').free('b2').snap('Both blocks are freed, each once. Correct, just twice the memory and a 1 MB copy.', '} // ~c, ~a', { finger: null, rows: [['freed', 2]] });
  }
  return m.frames();
}

liveDemo(
  'oop-copy',
  'Copying & the rule of 0/3/5',
  'Two pointers to one block and the double free that follows, the deep copy that fixes it, a move that hands the block over instead of copying it, and letting members manage themselves.',
  {
    shallow: ['Shallow copy bug', shallow],
    deep: ['Rule of three/five', move],
    rule0: ['Rule of zero', () => traceFrames(rule0Trace)],
  },
  [choice('copy', 'copy ctor', ['implicit', 'deep'], 'implicit', { for: ['shallow'], labels: ['compiler’s', 'deep copy'] }), choice('how', 'Buf c =', ['copy', 'move'], 'move', { for: ['deep'], labels: ['a', 'std::move(a)'] })],
);

// ---------------- virtual: vtable dispatch, virtual destructor ----------------
const VD: Record<string, Detail> = {
  v0: { title: 'Base pointer', text: 'Static type Shape*, dynamic type Sq or Ci. A virtual call uses the dynamic type.', code: 'Shape& s = sq;\ns.area();  // Sq::area' },
  sqv: { title: 'vptr', text: 'A hidden first member of every polymorphic object, set by the constructor to its class’s vtable.' },
  vsq: { title: 'vtable', text: 'One read-only table per class: the addresses of its virtual functions. A virtual call is load vptr, load slot, call.' },
  f: { title: 'Owning base pointer', text: 'delete through a Base* calls the destructor of the static type unless ~Base is virtual.' },
  path: { title: 'Derived member', text: 'Only ~File knows to release it. If ~File never runs, it leaks.' },
};

function dispatch(p: P): Frame[] {
  const virt = pick(p.v, ['virtual', 'plain'], 'virtual') === 'virtual';
  const m = new Mem({ panel: 'Dispatch', details: VD, out: true });
  m.region('stk', 'std::vector<Shape*> v');
  m.region('heap', 'objects on the heap');
  if (virt) m.region('vt', 'vtables · one per class, read-only');
  const objs = [['sq', 'Sq', 's = 2', '4'], ['ci', 'Ci', 'r = 1', '3.14']] as const;
  objs.forEach(([id, cls, field], k) => {
    if (virt) m.v(`${id}v`, 'heap', k * 2, `${cls}.vptr`, `0x9${k}0`, `→ ${cls} vt`, { to: `v${id}` }).v(`${id}f`, 'heap', k * 2 + 1, cls, `0x9${k}8`, field);
    else m.v(`${id}f`, 'heap', k * 2 + 1, cls, `0x9${k}8`, field);
    if (virt) m.v(`v${id}`, 'vt', k * 2, `${cls} vtable[0]`, `0x40${k}0`, `${cls}::area`);
    m.v(`v${k}`, 'stk', k * 2, `v[${k}]`, hex(0x10 + k * 8), `0x9${k}0`, { to: virt ? `${id}v` : `${id}f` });
  });
  m.snap(virt ? 'Each object starts with a hidden vptr pointing at its class’s vtable. v only knows it holds Shape pointers.' : 'Without virtual, the objects carry no vptr: just their data. v only knows it holds Shape pointers.', 'v = { new Sq(2), new Ci(1) };', { out: '', rows: [['vptr', virt ? 'yes' : 'none']] });
  let out = '';
  objs.forEach(([id, cls, , res], k) => {
    if (virt) {
      m.snap(`s->area() on v[${k}]: follow the pointer to the object, then its vptr…`, 'for (auto* s : v) s->area();', { finger: `${id}v`, out, rows: [['static type', 'Shape*'], ['dynamic type', cls]] });
      out += res + ' ';
      m.snap(`…to ${cls}’s vtable, whose slot holds ${cls}::area. Same call site, ${cls}’s code: ${res}.`, 'for (auto* s : v) s->area();', { finger: `v${id}`, hot: { [`v${id}`]: 'ok' }, out: out.trim(), rows: [['called', `${cls}::area`, 'ok']] });
    } else {
      out += '0 ';
      m.snap(`area() is not virtual, so the compiler picks Shape::area from the static type Shape*, never looking at the object.`, 'for (auto* s : v) s->area();', { finger: `v${k}`, hot: { [`${id}f`]: 'warn' }, out: out.trim(), rows: [['called', 'Shape::area', 'fail'], ['object is', cls]] });
    }
  });
  m.snap(virt ? 'The calling loop depends only on Shape. Add a Triangle and this code needs no change.' : 'Both shapes printed Shape’s answer. Mark area() virtual (and override in the derived classes) for dispatch on the real type.', virt ? '// open for extension' : 'virtual double area() const;', { finger: null, out: out.trim(), rows: [['dispatch', virt ? 'run time' : 'compile time', virt ? 'ok' : 'fail']] });
  return m.frames();
}

function vdtor(p: P): Frame[] {
  const virt = pick(p.vd, ['plain', 'virtual'], 'plain') === 'virtual';
  const m = new Mem({ panel: 'Destructor', details: VD });
  m.region('stk', 'main() · stack').region('obj', 'File object on the heap (Base part + File part)').region('res', 'what File owns');
  m.v('base', 'obj', 0, 'Base part', '0x900', 'Base').v('fpart', 'obj', 1, 'File::fd', '0x908', '3', { to: 'fd' }).v('path', 'obj', 2, 'File::path', '0x910', '0xA00', { to: 'pbuf' });
  m.v('fd', 'res', 1, 'open file', 'fd 3', 'open').v('pbuf', 'res', 2, 'path chars', '0xA00', '"/tmp/x"');
  m.v('f', 'stk', 0, 'p (Base*)', '0x10', '0x900', { to: 'base' });
  m.snap('A File is created and held through a Base*. It owns an open file and a heap string.', 'Base* p = new File("/tmp/x");', { rows: [['~Base', virt ? 'virtual' : 'not virtual', virt ? 'ok' : 'warn']] });
  if (virt) {
    m.set('fd', 'closed').free('fd').free('pbuf');
    m.snap('delete p looks up the destructor through the vtable, so ~File runs first: the file is closed and path is freed.', 'delete p;   // ~File()', { finger: 'fpart', hot: { fpart: 'ok', path: 'ok' }, rows: [['~File', 'ran', 'ok']] });
    m.kill('obj', 'object freed');
    m.snap('Then ~Base, then the memory is released. Everything File owned went with it.', 'delete p;   // ~Base()', { finger: 'base', rows: [['leaked', 'nothing', 'ok']] });
  } else {
    m.snap('delete p calls the destructor of the static type, Base. ~Base is not virtual, so ~File is never called.', 'delete p;   // ~Base() only', { finger: 'base', hot: { fpart: 'fail', path: 'fail' }, rows: [['~File', 'skipped', 'fail']] });
    m.kill('obj', 'object memory freed');
    m.snap('The object’s memory is gone, but the file is still open and the string is still allocated, with nothing pointing at them.', '// after delete p', { finger: null, hot: { fd: 'fail', pbuf: 'fail' }, rows: [['fd 3', 'still open', 'fail'], ['path', 'leaked', 'fail']] });
    m.snap('Rule: a base class you delete through needs virtual ~Base() = default; (also true for std::unique_ptr<Base>).', 'virtual ~Base() = default;', { finger: null, hot: { fd: 'fail', pbuf: 'fail' }, rows: [['fix', 'virtual ~Base()', 'ok']] });
  }
  return m.frames();
}

liveDemo(
  'oop-virtual',
  'Virtual functions & interfaces',
  'A virtual call followed hop by hop through vptr and vtable (turn virtual off and the static type wins), override and final, the destructor a non-virtual base skips, and abstract interfaces.',
  {
    dispatch: ['Dispatch', dispatch],
    override: ['override & final', () => traceFrames(overrideTrace)],
    vdtor: ['Virtual destructor', vdtor],
    interface: ['Interfaces', () => traceFrames(interfaceTrace)],
  },
  [choice('v', 'area() is', ['virtual', 'plain'], 'virtual', { for: ['dispatch'], labels: ['virtual', 'not virtual'] }), choice('vd', '~Base() is', ['plain', 'virtual'], 'plain', { for: ['vdtor'], labels: ['not virtual', 'virtual'] })],
);

// ---------------- RTTI: dynamic_cast ----------------
const RD: Record<string, Detail> = {
  ti: { title: 'type_info', text: 'RTTI: each polymorphic class’s vtable points at a description of the class. dynamic_cast and typeid read it.', code: 'typeid(*s) == typeid(Circle)' },
  c: { title: 'dynamic_cast<T*>', text: 'Checks the dynamic type at run time and returns nullptr on mismatch. Needs at least one virtual function in the base.', code: 'if (auto* c = dynamic_cast<Circle*>(s))\n  c->radius();' },
};
const CASTS = ['ptr', 'ref', 'static'];

function rtti(p: P): Frame[] {
  const real = pick(p.obj, ['Circle', 'Square'], 'Square');
  const how = pick(p.cast, CASTS, 'ptr');
  const ok = real === 'Circle';
  const field = ok ? 'r = 2' : 'side = 3';
  const m = new Mem({ panel: 'dynamic_cast', details: RD, out: true });
  m.region('stk', 'main() · stack').region('heap', 'object').region('ro', 'vtable & type_info (read-only)');
  m.v('vp', 'heap', 0, `${real}.vptr`, '0x900', `→ ${real} vt`, { to: 'vt' }).v('fld', 'heap', 1, real, '0x908', field);
  m.v('vt', 'ro', 0, `${real} vtable`, '0x400', '→ type_info', { to: 'ti' }).v('ti', 'ro', 1, 'type_info', '0x480', `"${real}"`);
  m.v('s', 'stk', 0, 's (Shape*)', '0x10', '0x900', { to: 'vp' });
  m.snap(`s is a Shape*. What it really points at is a ${real}, and only the object knows that.`, 'Shape* s = pick();', { out: '' });
  if (how === 'static') {
    m.v('c', 'stk', 1, 'c (Circle*)', '0x18', '0x900', { to: 'vp' });
    m.snap('static_cast checks nothing at run time: it just relabels the address as a Circle*.', 'auto* c = static_cast<Circle*>(s);', { finger: 'c', hot: { c: ok ? 'default' : 'warn' }, out: '', rows: [['checked', 'no', 'warn']] });
    m.snap(ok ? 'It happens to be a Circle, so reading radius() works. Only safe when you already know the type.' : 'It is really a Square, so radius() reads the side field as if it were a radius: undefined behaviour, here a silent wrong answer.', 'c->radius();', { finger: 'fld', hot: { fld: ok ? 'ok' : 'fail' }, out: ok ? '2' : '3 ???', rows: [['result', ok ? 'correct' : 'UB', ok ? 'ok' : 'fail']] });
    return m.frames();
  }
  m.snap('dynamic_cast follows s to the object, its vptr to the vtable, and the vtable to the class’s type_info…', how === 'ptr' ? 'auto* c = dynamic_cast<Circle*>(s);' : 'Circle& c = dynamic_cast<Circle&>(*s);', { finger: 'ti', out: '', rows: [['dynamic type', real]] });
  if (ok) {
    m.v('c', 'stk', 1, how === 'ptr' ? 'c (Circle*)' : 'c (Circle&)', '0x18', '0x900', { to: 'vp' });
    m.snap('…the type_info says Circle, so the cast succeeds and c points at the same object.', how === 'ptr' ? 'if (c) …' : 'Circle& c = …', { finger: 'c', hot: { ti: 'ok', c: 'ok' }, out: '', rows: [['result', 'the object', 'ok']] });
    m.snap('Now radius() is safe to call.', 'c->radius();', { finger: 'fld', hot: { fld: 'ok' }, out: '2', rows: [['printed', 2, 'ok']] });
  } else if (how === 'ptr') {
    m.v('c', 'stk', 1, 'c (Circle*)', '0x18', 'nullptr');
    m.snap('…the type_info says Square, not Circle, so the pointer form returns nullptr.', 'auto* c = dynamic_cast<Circle*>(s);', { finger: 'c', hot: { ti: 'warn', c: 'warn' }, out: '', rows: [['result', 'nullptr', 'warn']] });
    m.snap('if (c) is false and the Circle-only code is skipped. Frequent dynamic_casts hint that the behaviour belongs in a virtual function.', 'if (c) c->radius();', { finger: 'c', out: '', rows: [['skipped', 'yes', 'ok'], ['better', 's->describe()', 'ok']] });
  } else {
    m.snap('…the type_info says Square. A reference cannot be null, so the reference form throws std::bad_cast.', 'Circle& c = dynamic_cast<Circle&>(*s);', { finger: 'ti', hot: { ti: 'fail' }, out: '', rows: [['thrown', 'std::bad_cast', 'fail']] });
    m.snap('Use the reference form only when a mismatch is a real error you want reported as an exception.', 'catch (const std::bad_cast&) { … }', { finger: null, out: '(stderr) bad_cast', rows: [['handled', 'catch', 'ok']] });
  }
  return m.frames();
}

liveDemo(
  'oop-rtti',
  'RTTI & dynamic_cast',
  'dynamic_cast following object → vptr → vtable → type_info to check the real type, and what pointer, reference and static_cast each do when it is the wrong one.',
  { cast: ['dynamic_cast', rtti] },
  [choice('obj', 's points at', ['Circle', 'Square'], 'Square', { for: ['cast'] }), choice('cast', 'cast', CASTS, 'ptr', { for: ['cast'], labels: ['dynamic_cast<T*>', 'dynamic_cast<T&>', 'static_cast'] })],
);
