// Classes & OOP (group cpp-oop): encapsulation, this, static members, constructors, lifetime order, copy control
// (rule of 0/3/5), inheritance layout & slicing, virtual dispatch, interfaces, multiple/virtual inheritance, RTTI, operators.
import type { Detail } from '../algo/frames';
import { machineDemo } from '../machine/lib/draw';
import { traceFrames } from '../machine/lib/trace';
import type { Trace } from '../machine/lib/trace';
import { boardDemo, N } from '../machine/lib/board';

const G = 'cpp-oop';

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

const OUT: Detail = { title: 'Console output', text: 'What the program printed so far. Constructors and destructors here print their names so you can see the order.' };

// ---------------- class basics ----------------
traceDemo('oop-class', 'Classes, this & static', 'Encapsulation and invariants, the hidden this pointer, and static members shared by all objects.', {
  encaps: [
    'Encapsulation',
    {
      code: ['class Account {', 'public:', '  void deposit(int c) {', '    if (c <= 0) throw std::invalid_argument("c");', '    cents_ += c;', '  }', '  int balance() const { return cents_; }', 'private:', '  int cents_ = 0;   // invariant: >= 0', '};'],
      steps: [
        { note: 'A class bundles data with the functions allowed to change it. cents_ is private.', line: [0, 7, 8], vars: [['acct', 'Account{cents_=0}', 'write']] },
        { note: 'Outside code must go through deposit, which enforces the invariant.', line: [2, 3, 4], vars: [['acct', 'Account{cents_=500}', 'write']], rows: [['deposit(500)', 'ok', 'ok']] },
        { note: 'A bad amount is rejected, so the balance can never go wrong.', line: 3, vars: [['acct', 'Account{cents_=500}'], ['deposit(-9)', 'throws', 'fail']], rows: [['invariant', 'kept', 'ok']] },
        { note: 'acct.cents_ = -1 doesn’t compile. const member functions promise not to modify the object.', line: [6, 8], vars: [['acct.cents_', 'error: private', 'fail'], ['balance()', '500 (const)', 'ok']] },
      ],
      details: {
        acct: { title: 'Object', text: 'An instance of the class. Its size is just its data members; member functions live once in the code.', code: 'Account a;\na.deposit(500);\nstd::cout << a.balance();' },
        'balance()': { title: 'const member function', text: 'Callable on const objects; the compiler rejects any modification inside.', code: 'void print(const Account& a) {\n  a.balance();   // ok\n  a.deposit(1);  // error\n}' },
        'acct.cents_': { title: 'private', text: 'Only member functions (and friends) can access private members. struct defaults to public, class to private.' },
      },
    },
  ],
  this: [
    'this',
    {
      code: ['struct Counter {', '  int n = 0;', '  Counter& add(int k) { this->n += k; return *this; }', '};', 'Counter a, b;', 'a.add(1).add(2);', 'b.add(10);'],
      steps: [
        { note: 'Two Counter objects, each with its own n.', line: 4, heap: [['a', 'a: n = 0'], ['b', 'b: n = 0']] },
        { note: 'a.add(1) is compiled as Counter::add(&a, 1). The hidden parameter is this.', line: [2, 5], vars: [['this', '&a', 'accent', 'a'], ['k', '1']], heap: [['a', 'a: n = 1', 'write'], ['b', 'b: n = 0']] },
        { note: 'Returning *this lets calls chain on the same object.', line: 5, vars: [['this', '&a', 'accent', 'a'], ['k', '2']], heap: [['a', 'a: n = 3', 'write'], ['b', 'b: n = 0']] },
        { note: 'b.add(10) runs the same code with this = &b.', line: 6, vars: [['this', '&b', 'accent', 'b'], ['k', '10']], heap: [['a', 'a: n = 3'], ['b', 'b: n = 10', 'write']] },
      ],
      stackTitle: 'add() frame',
      heapTitle: 'objects',
      details: {
        this: { title: 'this', text: 'A pointer to the object a member function was called on. In x86-64 it arrives in rdi like a first argument.', code: 'a.add(1);\n// is really\nCounter::add(&a, 1);' },
        a: { title: 'Counter a', text: 'Each object has its own copy of the data members.' },
      },
    },
  ],
  static: [
    'static members',
    {
      code: ['class Conn {', 'public:', '  Conn()  { ++live_; }', '  ~Conn() { --live_; }', '  static int live() { return live_; }', 'private:', '  static inline int live_ = 0;', '};', '{ Conn a, b; Conn::live(); }  // 2', 'Conn::live();                  // 0'],
      steps: [
        { note: 'A static data member exists once for the whole class, not once per object.', line: [6], heap: [['live', 'Conn::live_ = 0', 'current']] },
        { note: 'Each constructor bumps the shared counter.', line: [2, 8], vars: [['a', 'Conn'], ['b', 'Conn']], heap: [['live', 'Conn::live_ = 2', 'write']] },
        { note: 'A static member function has no this and is called on the class.', line: [4, 8], vars: [['a', 'Conn'], ['b', 'Conn'], ['live()', '2', 'ok']], heap: [['live', 'Conn::live_ = 2']] },
        { note: 'Leaving the block destroys a and b, and the count returns to 0.', line: [3, 9], vars: [['live()', '0', 'ok']], heap: [['live', 'Conn::live_ = 0', 'write']] },
      ],
      heapTitle: 'static storage',
      details: {
        live: { title: 'static data member', text: 'One variable shared by all instances, stored like a global. inline (C++17) lets you define it in the class.', code: 'class Id {\n  static inline int next_ = 1;\npublic:\n  int id = next_++;\n};' },
        'live()': { title: 'static member function', text: 'Called as Class::f(). It can only touch static members, since there is no object.' },
      },
    },
  ],
});

// ---------------- constructors ----------------
traceDemo('oop-ctors', 'Constructors', 'Member initialiser lists and member order, delegating constructors, and explicit to stop implicit conversions.', {
  initlist: [
    'Init lists & order',
    {
      code: ['class Buffer {', '  char* data_;', '  std::size_t size_;', 'public:', '  Buffer(std::size_t n)', '    : data_(new char[size_]),   // size_ unset!', '      size_(n) {}', '};'],
      steps: [
        { note: 'The member initialiser list builds members directly, before the body runs.', line: [4, 5, 6], vars: [['size_', '?'], ['data_', '?']] },
        { note: 'Members are initialised in declaration order, not list order. data_ is declared first.', line: [1, 2], vars: [['data_', '?  (1st)', 'current'], ['size_', '?  (2nd)']] },
        { note: 'So data_ is built first and reads size_ before size_ is set.', line: 5, vars: [['data_', 'new char[garbage]', 'fail'], ['size_', 'garbage', 'fail']] },
        { note: 'Fix: list initialisers in declaration order, and build from the parameter n, not another member. -Wreorder warns.', line: [5, 6], vars: [['data_', 'new char[n]', 'ok'], ['size_', 'n', 'ok']] },
      ],
      details: {
        size_: { title: 'Declaration order', text: 'Members are always constructed top to bottom as declared, whatever order the init list uses.', code: 'class A {\n  int x_, y_;\npublic:\n  A() : y_(1), x_(y_) {} // x_ reads garbage\n};' },
        data_: { title: 'Member initialiser list', text: 'Initialises rather than assigns. Required for const members, references and members without default constructors.', code: 'Point(int x, int y) : x_(x), y_(y) {}' },
      },
    },
  ],
  delegate: [
    'Delegating ctors',
    {
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
    },
  ],
  explicit: [
    'explicit',
    {
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
    },
  ],
});

// ---------------- lifetime order ----------------
traceDemo('oop-lifetime', 'Object lifetime & order', 'Construction runs base → members → body; destruction runs in exact reverse, for scopes and for temporaries.', {
  order: [
    'Base, members, body',
    {
      code: ['struct Log { Log(){say("Log");} ~Log(){say("~Log");} };', 'struct Base { Base(){say("Base");} ~Base(){say("~Base");} };', 'struct App : Base {', '  Log log;', '  App()  { say("App"); }', '  ~App() { say("~App"); }', '};', '{ App a; }'],
      steps: [
        { note: 'Constructing App first constructs its base class.', line: [1, 7], vars: [['a', 'Base part', 'current']], out: 'Base' },
        { note: 'Then members, in declaration order.', line: [0, 3], vars: [['a', 'Base + log', 'current']], out: 'Base\nLog' },
        { note: 'The constructor body runs last, when all parts exist.', line: 4, vars: [['a', 'complete App', 'ok']], out: 'Base\nLog\nApp' },
        { note: 'At the closing brace destruction runs in reverse: body, members, base.', line: [5, 7], vars: [['a', 'destroyed', 'visited']], out: '~App\n~Log\n~Base' },
      ],
      details: {
        a: { title: 'Construction order', text: 'Virtual bases, then direct bases left to right, then members top to bottom, then the body. Destruction is the mirror image.' },
        out: OUT,
      },
    },
  ],
  scopes: [
    'Scopes',
    {
      code: ['T a("a");', '{', '  T b("b");', '  T c("c");', '}', 'T d("d");', 'return 0;'],
      steps: [
        { note: 'a is constructed.', line: 0, vars: [['a', 'alive', 'write']], out: '+a' },
        { note: 'Inside the block, b then c are constructed.', line: [1, 2, 3], vars: [['a', 'alive'], ['b', 'alive', 'write'], ['c', 'alive', 'write']], out: '+a\n+b\n+c' },
        { note: 'At the brace they die in reverse: c before b.', line: 4, vars: [['a', 'alive']], out: '+c\n-c\n-b' },
        { note: 'd is constructed, and at return d then a are destroyed. Last in, first out, like the stack.', line: [5, 6], vars: [], out: '+d\n-d\n-a' },
      ],
      details: {
        a: { title: 'Automatic lifetime', text: 'Stack objects end at the end of their scope, in reverse order of construction. RAII builds on this guarantee.' },
        b: { title: 'Why reverse order', text: 'Later objects may depend on earlier ones, so they must go first.', code: 'std::mutex m;\nstd::lock_guard lock(m);  // destroyed before m' },
        out: OUT,
      },
    },
  ],
  temps: [
    'Temporaries',
    {
      code: ['std::string name() { return "ada"; }', 'const char* p = name().c_str();  // dangling', 'std::cout << p;                   // UB', 'const std::string& r = name();    // extended', 'std::string s = name();           // best'],
      steps: [
        { note: 'name() returns a temporary string that lives until the end of the full expression.', line: [0, 1], heap: [['tmp', 'temporary "ada"', 'current']], vars: [['p', 'c_str()', 'accent', 'tmp']] },
        { note: 'At the semicolon the temporary is destroyed, and p points at freed memory.', line: 2, heap: [['tmp', 'destroyed', 'fail']], vars: [['p', 'dangling', 'fail', 'tmp']] },
        { note: 'Binding a temporary to a const reference extends its life to the reference’s scope.', line: 3, heap: [['tmp2', '"ada" (extended)', 'ok']], vars: [['r', 'const string&', 'ok', 'tmp2']] },
        { note: 'Simplest is to keep a value. Returned objects are built directly in place, with no copy.', line: 4, vars: [['s', '"ada"', 'ok']] },
      ],
      details: {
        tmp: { title: 'Temporary', text: 'An unnamed object created by an expression. It dies at the end of the full expression (the ;).' },
        p: { title: 'Dangling from a temporary', text: 'Common with c_str(), string_view and iterators into temporaries.', code: 'std::string_view v = std::string("x"); // dangles' },
        r: { title: 'Lifetime extension', text: 'Only works for direct binding to a local const T& or T&&, not through function returns.' },
      },
    },
  ],
});

// ---------------- copy control ----------------
traceDemo('oop-copy', 'Copying & the rule of 0/3/5', 'Shallow copy double-free, deep copy constructor and assignment, and letting members manage themselves.', {
  shallow: [
    'Shallow copy bug',
    {
      code: ['class Buf {', '  char* p_; std::size_t n_;', 'public:', '  Buf(std::size_t n) : p_(new char[n]), n_(n) {}', '  ~Buf() { delete[] p_; }', '};', 'Buf a(16);', 'Buf b = a;   // compiler copy: copies p_', '} // ~b, then ~a'],
      steps: [
        { note: 'a owns a 16-byte heap block through a raw pointer.', line: [3, 6], vars: [['a', 'p_ →', undefined, 'blk']], heap: [['blk', '16 B']] },
        { note: 'The generated copy constructor copies members one by one, so b.p_ is the same address.', line: 7, vars: [['a', 'p_ →', undefined, 'blk'], ['b', 'p_ →', 'warn', 'blk']], heap: [['blk', '16 B, two owners', 'warn']] },
        { note: 'b is destroyed first and frees the block.', line: [4, 8], vars: [['a', 'p_ → freed', 'fail', 'blk']], heap: [['blk', 'freed', 'fail']] },
        { note: 'Then ~a frees it again. Double free: heap corruption or a crash.', line: 8, vars: [], heap: [['blk', 'double free', 'fail']], rows: [['ASan', 'attempting double-free', 'fail']] },
      ],
      details: {
        a: { title: 'Owning raw pointer', text: 'If a class owns a resource through a raw handle, the default copy is wrong.' },
        blk: { title: 'Heap block', text: 'One allocation must be freed exactly once.' },
        b: { title: 'Member-wise copy', text: 'The implicit copy constructor copies the pointer value, not what it points to.' },
      },
    },
  ],
  deep: [
    'Rule of three/five',
    {
      code: ['Buf(const Buf& o) : p_(new char[o.n_]), n_(o.n_) {', '  std::copy(o.p_, o.p_ + n_, p_);', '}', 'Buf& operator=(Buf o) {   // copy-and-swap', '  std::swap(p_, o.p_); std::swap(n_, o.n_);', '  return *this;', '}', 'Buf(Buf&& o) noexcept', '  : p_(std::exchange(o.p_, nullptr)), n_(o.n_) {}'],
      steps: [
        { note: 'A deep copy constructor allocates its own block and copies the bytes.', line: [0, 1, 2], vars: [['a', 'p_ →', undefined, 'b1'], ['b', 'p_ →', 'ok', 'b2']], heap: [['b1', 'a: 16 B'], ['b2', 'b: 16 B copy', 'write']] },
        { note: 'Copy-and-swap assignment: take a copy, swap it in, and the old block dies with the parameter. Self-assignment is safe.', line: [3, 4, 5], vars: [['a', 'p_ →', undefined, 'b1'], ['b', 'p_ →', 'ok', 'b2']], heap: [['b1', 'a: 16 B'], ['b2', 'b: new copy', 'write']] },
        { note: 'The move constructor steals the pointer and nulls the source. No allocation.', line: [7, 8], vars: [['a', 'p_ = nullptr', 'visited'], ['c', 'p_ →', 'ok', 'b1']], heap: [['b1', 'now c’s 16 B', 'write']] },
        { note: 'Rule of five: if you write one of destructor, copy ctor, copy assign, move ctor, move assign, write all five.', line: 7, vars: [['c', 'owns 1 block', 'ok']], heap: [['b1', 'freed once', 'ok']] },
      ],
      details: {
        b: { title: 'Deep copy', text: 'Each object gets its own resource, so each destructor frees its own.' },
        c: { title: 'Move constructor', text: 'Transfers ownership. Mark it noexcept so std::vector uses it when growing.', code: 'Buf c = std::move(a);  // a is now empty' },
      },
    },
  ],
  rule0: [
    'Rule of zero',
    {
      code: ['class Buf {', '  std::vector<char> data_;', 'public:', '  explicit Buf(std::size_t n) : data_(n) {}', '};', 'Buf a(16);', 'Buf b = a;             // deep copy, free', 'Buf c = std::move(a);  // move, free'],
      steps: [
        { note: 'Hold resources in members that already manage themselves: vector, string, unique_ptr.', line: [0, 1, 3], vars: [['a', 'data_ →', undefined, 'b1']], heap: [['b1', '16 B']] },
        { note: 'The generated copy copies the vector, which copies deeply.', line: 6, vars: [['a', 'data_ →', undefined, 'b1'], ['b', 'data_ →', 'ok', 'b2']], heap: [['b1', '16 B'], ['b2', '16 B copy', 'write']] },
        { note: 'The generated move moves the vector. You wrote none of the five, and all are correct.', line: 7, vars: [['a', 'empty', 'visited'], ['b', 'data_ →', undefined, 'b2'], ['c', 'data_ →', 'ok', 'b1']], heap: [['b1', '16 B'], ['b2', '16 B copy']] },
      ],
      details: {
        a: { title: 'Rule of zero', text: 'Write no special members at all; let RAII members do the work. This is the default for application classes.', code: 'struct Session {\n  std::string user;\n  std::unique_ptr<Socket> sock;  // move-only\n};' },
      },
    },
  ],
});

// ---------------- inheritance ----------------
const BASE_D: Detail = { title: 'Base subobject', text: 'A derived object contains a complete base object at its start, so a Derived* converts to Base* for free.', code: 'struct Animal { std::string name; };\nstruct Dog : Animal { int tricks = 0; };\nDog d;\nAnimal& a = d;  // refers to d’s Animal part' };

boardDemo(G, 'oop-inherit', 'Inheritance & object layout', 'Derived objects contain their base, access control with protected, and slicing when copying to a base.', {
  layout: [
    'Layout',
    {
      panel: 'Layout',
      code: ['struct Animal { std::string name; int legs; };', 'struct Dog : Animal { int tricks; };', 'Dog d{{"Rex", 4}, 3};'],
      nodes: [
        N('an', 40, 220, 440, 130, 'Animal', 'name, legs', { detail: { title: 'Animal (base)', text: 'The base class. Its members are inherited by every derived class.', code: 'struct Animal {\n  std::string name;\n  int legs;\n};' } }),
        N('dg', 520, 220, 440, 130, 'Dog : Animal', '+ tricks', { detail: { title: 'Dog (derived)', text: 'Public inheritance means a Dog is-an Animal and can be used wherever an Animal is expected.', code: 'struct Dog : Animal {\n  int tricks;\n  void bark();\n};' } }),
        N('m0', 40, 450, 920, 110, 'name  (std::string, 32 B)', '+0', { detail: BASE_D }),
        N('m1', 40, 580, 920, 110, 'legs  (int)', '+32', { detail: BASE_D }),
        N('m2', 40, 710, 920, 110, 'tricks  (int)', '+36', { detail: { title: 'Derived members', text: 'Added after the base part. sizeof(Dog) = 40 here.' } }),
      ],
      edges: ['dg>an'],
      beats: [
        { note: 'Dog derives from Animal: it has everything Animal has, plus tricks.', hot: { dg: 'current', 'dg>an': 'accent' }, hide: ['m0', 'm1', 'm2'], rows: [['relation', 'is-a']] },
        { note: 'In memory, a Dog starts with a whole Animal.', hot: { m0: 'read', m1: 'read' }, hide: ['m2'], rows: [['Animal part', '36 B']] },
        { note: 'Derived members follow. No pointers, no overhead.', hot: { m2: 'write' }, rows: [['sizeof(Dog)', '40 B']] },
        { note: 'That’s why Dog* converts to Animal* with the same address. Tap the boxes for code.', hot: { m0: 'ok', m1: 'ok', an: 'ok' }, rows: [['upcast', 'free', 'ok']] },
      ],
    },
  ],
  slicing: [
    'Slicing',
    {
      panel: 'Slicing',
      code: ['void feed(Animal a);        // by value!', 'Dog d{{"Rex", 4}, 3};', 'feed(d);                    // copies Animal part', 'void feed2(const Animal& a); // no slicing'],
      nodes: [
        N('d', 40, 240, 440, 150, 'Dog d', 'name · legs · tricks', { detail: { title: 'The full object', text: 'The Dog in the caller, with all its members.' } }),
        N('a', 520, 240, 440, 150, 'Animal a (param)', 'name · legs', { detail: { title: 'Sliced copy', text: 'Only the Animal part was copied. Virtual calls on it use Animal’s versions.', code: 'Animal a = d;  // tricks is gone\na.speak();     // Animal::speak, not Dog’s' } }),
        N('r', 280, 520, 440, 150, 'const Animal& a', 'refers to d', { detail: { title: 'Pass by reference', text: 'Keeps the whole Dog; polymorphism works.', code: 'void feed(const Animal& a);\nfeed(d);' } }),
      ],
      edges: ['d>a', 'r>d'],
      beats: [
        { note: 'feed takes an Animal by value.', hot: { d: 'current' }, hide: ['a', 'r'], rows: [['parameter', 'Animal (value)', 'warn']] },
        { note: 'Passing a Dog copies only its Animal part. tricks and Dog’s behaviour are sliced off.', hot: { a: 'warn', 'd>a': 'warn' }, hide: ['r'], rows: [['copied', 'Animal part', 'warn']] },
        { note: 'Pass base classes by reference or pointer to keep the real object.', hot: { r: 'ok', 'r>d': 'ok' }, rows: [['parameter', 'const Animal&', 'ok']] },
      ],
    },
  ],
  access: [
    'public/protected/private',
    {
      panel: 'Access',
      code: ['class Shape {', 'public:    double area() const;', 'protected: std::string name_;   // subclasses', 'private:   int id_;             // Shape only', '};', 'class Circle : public Shape { … };'],
      nodes: [
        N('pub', 40, 260, 290, 130, 'public', 'everyone', { detail: { title: 'public', text: 'The class’s interface. Anyone can call it.' } }),
        N('pro', 355, 260, 290, 130, 'protected', 'derived classes', { detail: { title: 'protected', text: 'Visible to derived classes. Use sparingly; it couples subclasses to internals.' } }),
        N('pri', 670, 260, 290, 130, 'private', 'this class only', { detail: { title: 'private', text: 'Implementation details. Derived classes can’t see them either.' } }),
        N('user', 40, 540, 440, 130, 'main()', 'outside code'),
        N('circ', 520, 540, 440, 130, 'Circle', 'derived class', { detail: { title: 'public inheritance', text: 'Keeps the base’s public members public. Private inheritance means implemented-in-terms-of, rarely needed.', code: 'class Circle : public Shape {\n  double r_;\n};' } }),
      ],
      edges: ['user>pub', 'circ>pub', 'circ>pro'],
      beats: [
        { note: 'Three access levels decide who may use each member.', rows: [['levels', 3]] },
        { note: 'Outside code sees only public members.', hot: { user: 'current', pub: 'ok', 'user>pub': 'accent' }, rows: [['main → private', 'error', 'fail']] },
        { note: 'A derived class also sees protected, but never private.', hot: { circ: 'current', pub: 'ok', pro: 'ok', pri: 'fail', 'circ>pub': 'accent', 'circ>pro': 'accent' }, rows: [['Circle → private', 'error', 'fail']] },
      ],
    },
  ],
});

// ---------------- virtual & polymorphism ----------------
traceDemo('oop-virtual', 'Virtual functions & interfaces', 'Dynamic dispatch through base pointers, override and final, virtual destructors, and abstract interfaces.', {
  dispatch: [
    'Dispatch',
    {
      code: ['struct Shape {', '  virtual double area() const = 0;', '  virtual ~Shape() = default; };', 'struct Sq : Shape { double s;', '  double area() const override { return s*s; } };', 'struct Ci : Shape { double r;', '  double area() const override { return 3.14*r*r; } };', 'std::vector<std::unique_ptr<Shape>> v;', 'v.push_back(std::make_unique<Sq>(2));', 'v.push_back(std::make_unique<Ci>(1));', 'for (auto& s : v) std::cout << s->area() << " ";'],
      steps: [
        { note: 'A vector of base-class pointers can hold any kind of Shape.', line: [7, 8, 9], vars: [['v[0]', 'Shape*', undefined, 'sq'], ['v[1]', 'Shape*', undefined, 'ci']], heap: [['sq', 'Sq{s=2}', undefined, 'vptr → Sq vtable'], ['ci', 'Ci{r=1}', undefined, 'vptr → Ci vtable']], out: '' },
        { note: 's->area() on v[0] follows Sq’s vptr, so Sq::area runs.', line: [4, 10], vars: [['v[0]', 'Shape*', 'current', 'sq'], ['v[1]', 'Shape*', undefined, 'ci']], heap: [['sq', 'Sq{s=2}', 'current', 'Sq::area'], ['ci', 'Ci{r=1}']], out: '4 ' },
        { note: 'Same call site, Ci object, Ci::area. The type is decided at run time.', line: [6, 10], vars: [['v[0]', 'Shape*', undefined, 'sq'], ['v[1]', 'Shape*', 'current', 'ci']], heap: [['sq', 'Sq{s=2}'], ['ci', 'Ci{r=1}', 'current', 'Ci::area']], out: '4 3.14 ' },
        { note: 'Calling code depends only on Shape. New shapes need no changes there.', line: 10, vars: [['v', '2 shapes', 'ok']], heap: [['sq', 'Sq{s=2}'], ['ci', 'Ci{r=1}']], out: '4 3.14 ' },
      ],
      details: {
        sq: { title: 'Polymorphic object', text: 'Has a hidden vptr to its class’s vtable. See C++ under the hood → Virtual dispatch for the machine code.' },
        ci: { title: 'Polymorphic object', text: 'Same base, different vtable, so a different area().' },
        'v[0]': { title: 'Base pointer', text: 'Static type Shape*, dynamic type Sq. Virtual calls use the dynamic type.', code: 'Shape& s = sq;\ns.area();  // Sq::area' },
        out: OUT,
      },
    },
  ],
  override: [
    'override & final',
    {
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
    },
  ],
  vdtor: [
    'Virtual destructor',
    {
      code: ['struct Base { ~Base() {} };           // not virtual', 'struct File : Base {', '  std::string path; int fd;', '  ~File() { close(fd); }', '};', 'Base* p = new File{...};', 'delete p;   // only ~Base runs!'],
      steps: [
        { note: 'A File is created and held through a Base pointer.', line: [1, 5], vars: [['p', 'Base*', undefined, 'f']], heap: [['f', 'File{path, fd=3}']] },
        { note: 'delete p calls the destructor through the static type. ~Base isn’t virtual, so ~File never runs.', line: 6, vars: [['p', 'deleted', 'fail']], heap: [['f', 'path leaked, fd 3 open', 'fail']] },
        { note: 'Rule: a base class meant for polymorphic delete needs virtual ~Base() = default;', line: 0, vars: [['p', 'virtual ~Base()', 'ok']], heap: [['f', '~File, then ~Base', 'ok']] },
      ],
      details: {
        f: { title: 'Partial destruction', text: 'Technically undefined behaviour; in practice derived members leak.', code: 'struct Base {\n  virtual ~Base() = default;\n};' },
        p: { title: 'Owning base pointer', text: 'Prefer std::unique_ptr<Base>, which still needs the virtual destructor.' },
      },
    },
  ],
  interface: [
    'Interfaces',
    {
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
    },
  ],
});

// ---------------- multiple & virtual inheritance ----------------
boardDemo(G, 'oop-multiple', 'Multiple & virtual inheritance', 'Two bases in one object and this-pointer adjustment, the diamond problem, and virtual base classes.', {
  multi: [
    'Two bases',
    {
      panel: 'Layout',
      code: ['struct Reader { virtual int read(); int rfd; };', 'struct Writer { virtual void write(int); int wfd; };', 'struct Pipe : Reader, Writer { };', 'Pipe p; Writer* w = &p;   // w != &p'],
      nodes: [
        N('r', 40, 230, 440, 110, 'Reader', 'vptr · rfd', { detail: { title: 'First base', text: 'Sits at offset 0 of Pipe, so Reader* has the same address as Pipe*.' } }),
        N('w', 520, 230, 440, 110, 'Writer', 'vptr · wfd', { detail: { title: 'Second base', text: 'Sits after Reader inside Pipe. Converting Pipe* to Writer* adds its offset.' } }),
        N('p0', 40, 450, 920, 110, 'Reader part', '+0', { detail: { title: 'Reader subobject', text: 'Pipe’s first 16 bytes.' } }),
        N('p1', 40, 580, 920, 110, 'Writer part', '+16', { detail: { title: 'Writer subobject', text: 'Starts at +16. A Writer* into a Pipe points here.', code: 'Pipe p;\nWriter* w = &p;\n(void*)w == (char*)&p + 16;  // true' } }),
        N('ptr', 280, 780, 440, 110, 'Writer* w', '&p + 16'),
      ],
      edges: ['ptr>p1'],
      beats: [
        { note: 'Pipe inherits from both Reader and Writer.', hot: { r: 'current', w: 'current' }, hide: ['p0', 'p1', 'ptr'], rows: [['bases', 2]] },
        { note: 'The object holds both subobjects one after the other, each with its own vptr.', hot: { p0: 'read', p1: 'write' }, hide: ['ptr'], rows: [['sizeof(Pipe)', '32 B']] },
        { note: 'Converting to Writer* shifts the pointer by 16 bytes. The compiler does it for you.', hot: { ptr: 'accent', 'ptr>p1': 'accent', p1: 'current' }, rows: [['this adjust', '+16']] },
        { note: 'Multiple inheritance of interfaces is common and fine. Of stateful classes, keep it rare.', hot: { r: 'ok', w: 'ok' }, rows: [['use for', 'interfaces', 'ok']] },
      ],
    },
  ],
  diamond: [
    'Diamond',
    {
      panel: 'Diamond',
      nodes: [
        N('dev', 355, 60, 290, 120, 'Device', 'int id', { detail: { title: 'Common base', text: 'Shared ancestor of both branches.' } }),
        N('in', 40, 300, 290, 120, 'Input : Device'),
        N('out', 670, 300, 290, 120, 'Output : Device'),
        N('io', 355, 540, 290, 120, 'IO : Input, Output', undefined, { detail: { title: 'Diamond', text: 'Without virtual inheritance IO holds two Device subobjects, and io.id is ambiguous.', code: 'struct Input : Device {};\nstruct Output : Device {};\nstruct IO : Input, Output {};\nio.id;  // error: ambiguous' } }),
        N('d1', 40, 780, 440, 110, 'Device #1', 'via Input'),
        N('d2', 520, 780, 440, 110, 'Device #2', 'via Output'),
      ],
      edges: ['in>dev', 'out>dev', 'io>in', 'io>out', 'io>d1', 'io>d2'],
      beats: [
        { note: 'Input and Output both derive from Device, and IO derives from both.', hot: { io: 'current' }, hide: ['d1', 'd2'], rows: [['shape', 'diamond']] },
        { note: 'By default IO contains two separate Device subobjects.', hot: { d1: 'warn', d2: 'warn', 'io>d1': 'warn', 'io>d2': 'warn' }, rows: [['Device copies', 2, 'warn']] },
        { note: 'So io.id is ambiguous, and the two ids can drift apart.', hot: { io: 'fail', d1: 'fail', d2: 'fail' }, rows: [['io.id', 'ambiguous', 'fail']] },
      ],
    },
  ],
  virtualbase: [
    'Virtual base',
    {
      panel: 'Diamond',
      code: ['struct Input : virtual Device {};', 'struct Output : virtual Device {};', 'struct IO : Input, Output {};'],
      nodes: [
        N('dev', 355, 200, 290, 120, 'Device', 'shared, once', { detail: { title: 'Virtual base', text: 'Exactly one subobject, shared by all paths. The most-derived class constructs it.' } }),
        N('in', 40, 420, 290, 120, 'Input', 'virtual Device'),
        N('out', 670, 420, 290, 120, 'Output', 'virtual Device'),
        N('io', 355, 660, 290, 120, 'IO', 'one Device', { detail: { title: 'virtual inheritance', text: 'Costs an extra pointer or offset lookup to reach the base. std::iostream uses it.', code: 'struct IO : Input, Output {\n  IO() : Device(42) {}  // IO builds Device\n};' } }),
      ],
      edges: ['in>dev', 'out>dev', 'io>in', 'io>out'],
      beats: [
        { note: 'Marking the inheritance virtual makes the branches share one Device.', hot: { dev: 'current', 'in>dev': 'accent', 'out>dev': 'accent' }, rows: [['Device copies', 1, 'ok']] },
        { note: 'io.id is now unambiguous. IO itself constructs the shared base.', hot: { io: 'ok' }, rows: [['io.id', 'ok', 'ok']] },
        { note: 'Access to the base goes through an offset in the vtable. Prefer interfaces without state instead.', hot: { dev: 'warn' }, rows: [['cost', 'indirect base access', 'warn']] },
      ],
    },
  ],
});

// ---------------- RTTI ----------------
traceDemo('oop-rtti', 'RTTI & dynamic_cast', 'Checked downcasts with dynamic_cast, bad_cast with references, typeid, and why a virtual method is usually better.', {
  cast: [
    'dynamic_cast',
    {
      code: ['Shape* s = pick();', 'if (auto* c = dynamic_cast<Circle*>(s))', '  std::cout << c->radius();', 'Circle& r = dynamic_cast<Circle&>(*s);  // may throw', 'typeid(*s).name();                       // "6Square"', 'static_cast<Circle*>(s);  // unchecked!'],
      steps: [
        { note: 'dynamic_cast asks at run time whether s really points to a Circle. Here it does.', line: [0, 1, 2], vars: [['s', 'Shape*', undefined, 'obj'], ['c', 'Circle*', 'ok', 'obj']], heap: [['obj', 'Circle{r=2}']], out: '2' },
        { note: 'If s points to a Square instead, the pointer cast returns nullptr.', line: 1, vars: [['s', 'Shape*', undefined, 'obj'], ['c', 'nullptr', 'warn']], heap: [['obj', 'Square{s=3}']], out: '2' },
        { note: 'The reference form can’t return null, so it throws std::bad_cast.', line: 3, vars: [['r', 'throws bad_cast', 'fail']], heap: [['obj', 'Square{s=3}']], out: '2' },
        { note: 'typeid gives the dynamic type. static_cast skips the check and is UB if wrong.', line: [4, 5], vars: [['typeid', 'Square', 'current'], ['static_cast', 'UB here', 'fail']], heap: [['obj', 'Square{s=3}']], out: '2' },
        { note: 'Frequent dynamic_casts hint at a missing virtual function. Put the behaviour in the class.', line: 1, vars: [['better', 's->describe()', 'ok']], heap: [['obj', 'Square{s=3}']], out: '2' },
      ],
      details: {
        c: { title: 'dynamic_cast<T*>', text: 'Walks the RTTI attached to the vtable. Needs a polymorphic base (at least one virtual function). Costs a few dozen ns.', code: 'if (auto* d = dynamic_cast<Dog*>(animal))\n  d->bark();' },
        r: { title: 'dynamic_cast<T&>', text: 'Throws std::bad_cast on failure.' },
        typeid: { title: 'typeid', text: 'std::type_info for the dynamic type. name() is compiler-specific (mangled on GCC).', code: 'if (typeid(*s) == typeid(Circle)) ...' },
        static_cast: { title: 'static_cast downcast', text: 'Fast, no check. Only when you already know the type.' },
      },
    },
  ],
});

// ---------------- operator overloading ----------------
traceDemo('oop-operators', 'Operator overloading & friends', 'Arithmetic operators, stream output via a friend, and C++20 defaulted comparisons.', {
  arith: [
    'Arithmetic',
    {
      code: ['struct Vec2 {', '  double x, y;', '  Vec2& operator+=(Vec2 o) {', '    x += o.x; y += o.y; return *this; }', '};', 'Vec2 operator+(Vec2 a, Vec2 b) { return a += b; }', 'Vec2 operator*(Vec2 a, double k) { return {a.x*k, a.y*k}; }', 'Vec2 p{1, 2}, q{3, 4};', 'auto r = (p + q) * 2;'],
      steps: [
        { note: 'Operators are functions with special names. p + q calls operator+(p, q).', line: [5, 7], vars: [['p', '{1, 2}'], ['q', '{3, 4}']] },
        { note: 'Implement += as a member, then + as a free function built on it.', line: [2, 3, 5, 8], vars: [['p', '{1, 2}'], ['q', '{3, 4}'], ['p + q', '{4, 6}', 'write']] },
        { note: 'Then * 2 scales it. Keep operators unsurprising: + should add.', line: [6, 8], vars: [['p', '{1, 2}'], ['q', '{3, 4}'], ['r', '{8, 12}', 'ok']] },
      ],
      details: {
        'p + q': { title: 'Free operator+', text: 'Free functions allow conversions on both sides and keep the class small.', code: 'Vec2 operator+(Vec2 a, Vec2 b) { return a += b; }' },
        r: { title: 'Result', text: 'Operators compose like built-in ones, with the usual precedence.' },
      },
    },
  ],
  stream: [
    'operator<< & friend',
    {
      code: ['class Money {', '  long cents_;', 'public:', '  explicit Money(long c) : cents_(c) {}', '  friend auto& operator<<(std::ostream& os, Money m) {', '    return os << m.cents_ / 100 << "." << m.cents_ % 100;', '  }', '};', 'std::cout << Money{1250} << "\\n";'],
      steps: [
        { note: 'std::cout << m calls operator<<(std::cout, m). The stream is on the left, so it can’t be a member of Money.', line: [4, 8], vars: [['m', 'Money{1250}']], out: '' },
        { note: 'friend grants this free function access to private cents_.', line: [1, 4, 5], vars: [['m', 'Money{1250}'], ['cents_', '1250 (private)', 'accent']], out: '' },
        { note: 'Returning the stream lets << chain.', line: [5, 8], vars: [['m', 'Money{1250}']], out: '12.50' },
      ],
      details: {
        m: { title: 'Printable type', text: 'Give types an operator<< so they work with logging and tests.', code: 'std::ostream& operator<<(std::ostream&, const T&);' },
        cents_: { title: 'friend', text: 'A function or class granted access to private members. Keep friends in the same header as the class.' },
        out: OUT,
      },
    },
  ],
  compare: [
    'Comparisons (<=>)',
    {
      code: ['struct Version {', '  int major, minor, patch;', '  auto operator<=>(const Version&) const = default;', '};', 'Version a{1, 4, 2}, b{1, 10, 0};', 'a < b;      // true', 'a == b;     // false', 'std::sort(v.begin(), v.end());'],
      steps: [
        { note: 'One defaulted <=> generates <, <=, >, >= and ==, comparing members in order.', line: [0, 1, 2], vars: [['<=>', 'defaulted', 'current']] },
        { note: 'major ties, then minor 4 < 10 decides: a < b.', line: [4, 5], vars: [['a', '1.4.2'], ['b', '1.10.0'], ['a < b', 'true', 'ok']] },
        { note: 'Now Version works with sort, set and map with no extra code.', line: [6, 7], vars: [['a == b', 'false'], ['sort', 'works', 'ok']] },
      ],
      details: {
        '<=>': { title: 'Three-way comparison', text: 'C++20. Returns less, equal or greater. Defaulted, it compares members lexicographically.', code: '#include <compare>\nauto operator<=>(const T&) const = default;' },
        'a < b': { title: 'Lexicographic order', text: 'Like comparing words: first differing member wins.' },
      },
    },
  ],
});
