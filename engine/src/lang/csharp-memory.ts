// C# value vs reference types and boxing as memory pictures (group lang-csharp).
import type { Detail, Frame } from '../algo/frames';
import { choice, liveGroup, num, number, pick } from '../machine/lib/live';
import type { P } from '../machine/lib/live';
import { Mem } from '../machine/lib/mem';

const liveDemo = liveGroup('lang-csharp');
const D = (title: string, text: string, code?: string): Detail => ({ title, text, code });

const TD: Record<string, Detail> = {
  a: D('Value type', 'A struct is stored inline: on the stack, or inside the object or array holding it. Assignment copies the fields.', 'readonly record struct Point(int X, int Y);\n// keep structs small and immutable'),
  obj: D('Reference type', 'A class instance lives on the managed heap with a header and a method-table pointer. Variables hold references to it.'),
  box: D('Boxing', 'Converting a value type to object or an interface allocates a heap copy. Unboxing copies it back out.', 'object o = 42;      // box\nint n = (int)o;     // unbox\nIComparable c = 5;  // box too'),
};

function points(kind: 'struct' | 'class'): Frame[] {
  const cls = kind === 'class';
  const m = new Mem({ panel: kind, details: TD, out: true });
  m.region('stk', 'Main() · stack');
  if (cls) m.region('heap', 'managed heap');
  if (cls) m.v('obj', 'heap', 0, 'Point object', '0x2a0', 'X=1 Y=2').v('a', 'stk', 0, 'a', '0x10', '0x2a0', { to: 'obj' });
  else m.v('a', 'stk', 0, 'a', '0x10', 'X=1 Y=2');
  m.snap(cls ? 'class: new allocates the object on the heap (header, method table, fields) and a holds a reference to it.' : 'struct: the two fields live inline in a, right in the stack frame. No heap object.', `${kind} Point { public int X, Y; }  var a = new Point { X = 1, Y = 2 };`, { out: '', rows: [['heap objects', cls ? 1 : 0]] });
  if (cls) m.v('b', 'stk', 1, 'b', '0x18', '0x2a0', { to: 'obj' });
  else m.v('b', 'stk', 1, 'b', '0x18', 'X=1 Y=2');
  m.snap(cls ? 'b = a copies the reference, not the object: two arrows to one Point.' : 'b = a copies both fields: two independent Points.', 'var b = a;', { fly: ['a', 'b'], out: '', rows: [['Points', cls ? 1 : 2]] });
  m.set(cls ? 'obj' : 'b', 'X=9 Y=2');
  m.snap(cls ? 'b.X = 9 follows b’s arrow and changes the one shared object.' : 'b.X = 9 changes b’s own copy. a is untouched.', 'b.X = 9;', { finger: cls ? 'obj' : 'b', hot: cls ? { obj: 'warn' } : { b: 'write', a: 'ok' }, out: '' });
  m.snap(cls ? 'So a.X prints 9: a and b are the same object. When no reference remains, the GC reclaims it.' : 'a.X prints 1. No heap allocation and no GC work: why small structs are fast.', 'Console.WriteLine(a.X);', { finger: cls ? 'obj' : 'a', out: cls ? '9' : '1', rows: [['a.X', cls ? 9 : 1, cls ? 'warn' : 'ok']] });
  return m.frames();
}

function boxing(p: P): Frame[] {
  const generic = pick(p.coll, ['ArrayList', 'List'], 'ArrayList') === 'List';
  const n = num(p.n, 3, 1, 4);
  const m = new Mem({ panel: 'Boxing', details: TD, out: true });
  m.region('stk', 'Main() · stack').region('heap', 'managed heap');
  m.v('n', 'stk', 0, 'n', '0x10', '42');
  m.snap('n is a plain int on the stack.', 'int n = 42;', { out: '' });
  m.v('box', 'heap', 0, 'boxed int', '0x300', '42').v('o', 'stk', 1, 'o (object)', '0x18', '0x300', { to: 'box' });
  m.snap('Assigning it to object boxes it: a new 24-byte heap object holding a copy of 42.', 'object o = n;', { fly: ['n', 'box'], hot: { box: 'warn' }, out: '', rows: [['allocations', 1, 'warn']] });
  m.set('n', '7').snap('The box is a copy, so changing n does not affect it.', 'n = 7;  Console.WriteLine(o);', { finger: 'box', out: '42' });
  if (generic) {
    m.v('list', 'heap', 1, `List<int> · ${n} ints inline`, '0x340', [1, 2, 3, 4].slice(0, n).join(' '));
    m.snap(`List<int> stores the ${n} ints inline in its own array: no box per element.`, `var xs = new List<int> { ${[1, 2, 3, 4].slice(0, n).join(', ')} };`, { finger: 'list', hot: { list: 'ok' }, out: '42', rows: [['boxes', 0, 'ok']] });
  } else {
    for (let i = 0; i < n; i++) m.v(`b${i}`, 'heap', i + 1, `box ${i + 1}`, `0x3${4 + i}0`, String(i + 1));
    m.snap(`ArrayList holds object, so every int added is boxed: ${n} extra heap object${n > 1 ? 's' : ''} for the GC.`, `var xs = new ArrayList { ${[1, 2, 3, 4].slice(0, n).join(', ')} };`, { finger: null, hot: Object.fromEntries([...Array(n).keys()].map((i) => [`b${i}`, 'warn' as const])), out: '42', rows: [['boxes', n, 'warn']] });
  }
  m.snap(generic ? 'Generics specialise for value types, so boxing disappears. Watch for it where values become object or an interface.' : 'In a hot loop this is GC pressure. Use List<int> (or Span<T>) and the boxes disappear.', generic ? '// IComparable c = n;  still boxes' : 'var xs = new List<int> { … };', { finger: null, out: '42', rows: [['allocations', generic ? 1 : n + 1, generic ? 'ok' : 'warn']] });
  return m.frames();
}

liveDemo(
  'cs-types',
  'Value types, reference types & boxing',
  'The same Point code as a struct and as a class: copied fields vs a shared heap object. Then boxing, one heap object per value that becomes object.',
  {
    value: ['struct (value)', (p) => points(pick(p.kv, ['struct', 'class'], 'struct'))],
    reference: ['class (reference)', (p) => points(pick(p.kr, ['class', 'struct'], 'class'))],
    boxing: ['Boxing', boxing],
  },
  [
    choice('kv', 'Point is a', ['struct', 'class'], 'struct', { for: ['value'] }),
    choice('kr', 'Point is a', ['class', 'struct'], 'class', { for: ['reference'] }),
    choice('coll', 'collection', ['ArrayList', 'List'], 'ArrayList', { for: ['boxing'], labels: ['ArrayList', 'List<int>'] }),
    number('n', 'items', 1, 4, 3, { for: ['boxing'] }),
  ],
);
