// Classes & OOP (group cpp-oop): encapsulation, this, static members, constructors, lifetime order, copy control
// (rule of 0/3/5), inheritance layout & slicing, virtual dispatch, interfaces, multiple/virtual inheritance, RTTI, operators.
// Class basics, constructors, lifetime, copying, virtual dispatch and RTTI live in oop-memory.ts as knob-driven pictures.
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
