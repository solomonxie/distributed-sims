// Python (group lang-python): CPython bytecode & eval loop, objects & references, refcount + cyclic GC, the GIL, asyncio & generators, imports, packaging.
import type { Detail, Frame, Shape, Tone } from '../algo/frames';
import { boardDemo, N } from '../machine/lib/board';
import { codeMapFrames } from '../machine/lib/code';
import type { CodeMap } from '../machine/lib/code';
import { box, Film, line, machineDemo, panel, text } from '../machine/lib/draw';
import type { Row } from '../machine/lib/draw';
import { traceFrames } from '../machine/lib/trace';

const G = 'lang-python';
const D = (title: string, text: string, code?: string): Detail => ({ title, text, code });

// ---------------- CPython pipeline ----------------
const PIPE_DETAILS: Record<string, Detail> = {
  'app.py': D('Source file', 'Plain text. Python never runs it directly: it is parsed and compiled to bytecode first.', 'def add(a, b):\n    return a + b\n\nprint(add(2, 3))'),
  'tokenizer + parser': D('Tokenizer and parser', 'Split the text into tokens, then build a tree that follows the grammar.', 'import ast\ntree = ast.parse("a + b")\nprint(ast.dump(tree.body[0].value))\n# BinOp(left=Name(id=\'a\'), op=Add(),\n#       right=Name(id=\'b\'))'),
  AST: D('Abstract syntax tree', 'The program as nested nodes (BinOp, Call, If). Linters and formatters work on this same tree.', 'import ast\nfor n in ast.walk(ast.parse("f(x)")):\n    print(type(n).__name__)\n# Module, Expr, Call, Name, Name'),
  compiler: D('Compiler', 'Walks the AST, resolves which names are local, and emits bytecode plus constant tables.', 'code = compile("a + b", "<s>", "eval")\nprint(code.co_names)   # (\'a\', \'b\')'),
  'code object': D('Code object', 'Immutable bundle of bytecode, constants, variable names and line table. Every function has one in __code__.', 'def add(a, b): return a + b\nc = add.__code__\nc.co_varnames   # (\'a\', \'b\')\nc.co_consts     # (None,)\nlen(c.co_code)  # raw bytecode bytes'),
  '__pycache__/*.pyc': D('Bytecode cache', 'Imported modules are compiled once and cached here, keyed by the Python version.', '$ python -c "import mymod"\n$ ls __pycache__\nmymod.cpython-312.pyc'),
  'eval loop': D('The eval loop', 'A giant switch in Python/ceval.c: fetch the next opcode, run it, repeat. Since 3.11 hot opcodes specialise themselves for the types they see.', 'import dis\ndis.dis(lambda a, b: a + b)\n#  LOAD_FAST   a\n#  LOAD_FAST   b\n#  BINARY_OP   0 (+)\n#  RETURN_VALUE'),
  'value stack': D('Value stack', 'Each frame has a small stack of object pointers. Opcodes push operands and pop results.', '# a + b on the value stack\n# LOAD_FAST a   -> [a]\n# LOAD_FAST b   -> [a, b]\n# BINARY_OP +   -> [a+b]'),
  frame: D('Frame', 'One per running call: the code object, local variables, the instruction pointer and the value stack.', 'import sys\ndef f():\n    fr = sys._getframe()\n    print(fr.f_code.co_name, fr.f_lineno)\nf()   # f 3'),
  'heap objects': D('Objects on the heap', 'Every value is a heap object. The stack and locals only hold pointers to them.', 'x = 3.5\nprint(id(x))        # address of the object\nprint(type(x))      # <class \'float\'>'),
  result: D('Result', 'The return value is just another object pointer handed to the caller’s frame.', 'print(add(2, 3))   # 5'),
};

const PIPE_NODES = [
  N('src', 40, 60, 280, 110, 'app.py', 'source text'),
  N('tok', 360, 60, 280, 110, 'tokenizer + parser', 'text → tokens → tree'),
  N('ast', 680, 60, 280, 110, 'AST', 'tree of nodes'),
  N('pyc', 40, 240, 280, 110, '__pycache__/*.pyc', 'cached bytecode'),
  N('code', 360, 240, 280, 110, 'code object', 'bytecode + consts'),
  N('cmp', 680, 240, 280, 110, 'compiler', 'AST → bytecode'),
  N('loop', 360, 440, 280, 120, 'eval loop', 'fetch, dispatch'),
  N('stack', 40, 640, 280, 120, 'value stack', 'per frame'),
  N('frame', 360, 640, 280, 120, 'frame', 'locals, ip'),
  N('objs', 680, 640, 280, 120, 'heap objects', 'ints, lists, funcs'),
  N('out', 360, 840, 280, 110, 'result'),
];
const PIPE_EDGES = ['src>tok', 'tok>ast', 'ast>cmp', 'cmp>code', 'code>pyc', 'code>loop', 'loop>frame', 'frame>stack', 'frame>objs', 'frame>out'];
const RUN = ['loop', 'stack', 'frame', 'objs', 'out'];

boardDemo(
  G,
  'py-pipeline',
  'How CPython runs a file',
  'Source → tokens → AST → bytecode in a code object → the eval loop running frames; the .pyc cache.',
  {
    compile: [
      'Compile',
      {
        panel: 'CPython',
        nodes: PIPE_NODES,
        edges: PIPE_EDGES,
        beats: [
          { note: 'python app.py starts by reading the source as plain text.', hot: { src: 'current' }, hide: ['tok', 'ast', 'cmp', 'code', 'pyc', ...RUN], rows: [['stage', 'read']] },
          { note: 'The tokenizer and parser turn the text into an abstract syntax tree.', hot: { tok: 'current', ast: 'write', 'src>tok': 'accent', 'tok>ast': 'accent' }, hide: ['cmp', 'code', 'pyc', ...RUN], rows: [['stage', 'parse']] },
          { note: 'The compiler walks the AST and emits bytecode into code objects, one per module and function.', hot: { cmp: 'current', code: 'write', 'ast>cmp': 'accent', 'cmp>code': 'accent' }, hide: ['pyc', ...RUN], rows: [['stage', 'compile']] },
          { note: 'For imported modules that code object is saved in __pycache__, so the next run skips compiling.', hot: { pyc: 'write', 'code>pyc': 'accent' }, hide: RUN, rows: [['stage', 'cache'], ['machine code', 'none', 'warn']] },
        ],
      },
    ],
    eval: [
      'Eval loop',
      {
        panel: 'CPython',
        nodes: PIPE_NODES,
        edges: PIPE_EDGES,
        beats: [
          { note: 'The eval loop is one big switch in ceval.c: fetch an opcode, run it, repeat.', hot: { loop: 'current', 'code>loop': 'accent' }, rows: [['opcodes', '~200']] },
          { note: 'Each call gets a frame holding locals, the instruction pointer and a value stack.', hot: { frame: 'current', stack: 'write', 'loop>frame': 'accent', 'frame>stack': 'accent' }, rows: [['frames', 'one per call']] },
          { note: 'Opcodes push and pop object pointers on the value stack, while the objects themselves live on the heap.', hot: { stack: 'current', objs: 'read', 'frame>objs': 'accent' }, rows: [['stack holds', 'pointers']] },
          { note: 'Every opcode pays for a dispatch and type checks at run time. That is why pure-Python loops are slow.', hot: { loop: 'warn', out: 'ok', 'frame>out': 'accent' }, rows: [['cost per op', 'dispatch + checks', 'warn']] },
        ],
      },
    ],
    pyc: [
      '.pyc cache',
      {
        panel: 'CPython',
        nodes: PIPE_NODES,
        edges: PIPE_EDGES,
        beats: [
          { note: 'The script you run is compiled on every start, but imported modules are cached.', hot: { src: 'current' }, hide: RUN, rows: [['cached', 'imports only']] },
          { note: 'Each .pyc records the source’s mtime and size, and Python recompiles when they change.', hot: { pyc: 'current', 'code>pyc': 'accent' }, hide: RUN, rows: [['invalidation', 'mtime + size']] },
          { note: 'The cache skips parsing, not execution. The eval loop still runs every opcode.', hot: { code: 'ok', loop: 'warn', 'code>loop': 'accent' }, rows: [['saves', 'start-up time', 'ok']] },
        ],
      },
    ],
  },
  PIPE_DETAILS,
);

// ---------------- bytecode ----------------
const BYTECODE: Record<string, CodeMap> = {
  add: {
    srcTitle: 'main.py',
    asmTitle: 'python -m dis (3.12)',
    src: ['def add(a, b):', '    return a + b'],
    asm: ['RESUME        0', 'LOAD_FAST     0 (a)', 'LOAD_FAST     1 (b)', 'BINARY_OP     0 (+)', 'RETURN_VALUE'],
    intro: 'A two-line function and the bytecode CPython compiles it to.',
    steps: [
      { src: [0], asm: [0], note: 'RESUME marks the start of the function body.' },
      { src: [1], asm: [1, 2], note: 'LOAD_FAST pushes a and b from the frame’s local slots, an array index with no dict lookup.' },
      { src: [1], asm: [3], note: 'BINARY_OP pops both and calls the type’s addition, int or str or your own __add__.' },
      { src: [1], asm: [4], note: 'RETURN_VALUE pops the result and hands it to the caller.' },
    ],
    outro: 'The bytecode knows nothing about types. The same four instructions add ints, floats or strings.',
    rows: () => [['locals', 'fast slots']],
  },
  loop: {
    srcTitle: 'main.py (module level)',
    asmTitle: 'python -m dis (3.12)',
    src: ['total = 0', 'for x in items:', '    total += x'],
    asm: ['LOAD_CONST    0 (0)', 'STORE_NAME    0 (total)', 'LOAD_NAME     1 (items)', 'GET_ITER', 'FOR_ITER      to L2', 'STORE_NAME    2 (x)', 'LOAD_NAME     0 (total)', 'LOAD_NAME     2 (x)', 'BINARY_OP    13 (+=)', 'STORE_NAME    0 (total)', 'JUMP_BACKWARD to FOR_ITER', 'L2: END_FOR', 'RETURN_CONST  None'],
    intro: 'A loop at module level. Watch which opcodes the loop body uses.',
    steps: [
      { src: [0], asm: [0, 1], note: 'Module-level names are stored in the module’s globals dict.' },
      { src: [1], asm: [2, 3, 4, 5], note: 'GET_ITER asks items for an iterator and FOR_ITER calls its __next__ each round.' },
      { src: [2], asm: [6, 7, 8, 9], note: 'Every LOAD_NAME and STORE_NAME is a dict lookup, several per iteration.' },
      { src: [1], asm: [10, 11], note: 'JUMP_BACKWARD loops until the iterator is exhausted.' },
    ],
    outro: 'Inside a function the same code uses LOAD_FAST slots instead of dicts. Wrapping a hot loop in a function often makes it noticeably faster.',
  },
  attr: {
    srcTitle: 'main.py',
    asmTitle: 'python -m dis (3.12)',
    src: ['def area(c):', '    return c.r * c.r * 3.14'],
    asm: ['RESUME        0', 'LOAD_FAST     0 (c)', 'LOAD_ATTR     0 (r)', 'LOAD_FAST     0 (c)', 'LOAD_ATTR     0 (r)', 'BINARY_OP     5 (*)', 'LOAD_CONST    1 (3.14)', 'BINARY_OP     5 (*)', 'RETURN_VALUE'],
    intro: 'Attribute access looks free in source and isn’t in bytecode.',
    steps: [
      { src: [1], asm: [1, 2], note: 'c.r is a LOAD_ATTR: look in the instance, then the class and its bases.' },
      { src: [1], asm: [3, 4], note: 'Nothing is cached across lines, so the second c.r repeats the lookup.' },
      { src: [1], asm: [5, 6, 7], note: 'Two multiplies, each dispatching on the operand types at run time.' },
    ],
    outro: 'Since 3.11 the interpreter specialises hot LOAD_ATTRs into fast paths for the types it has seen. Hoisting r = c.r into a local still helps in tight loops.',
  },
};

machineDemo({
  slug: 'py-bytecode',
  title: 'Python bytecode (dis)',
  group: G,
  summary: 'Source lines and the CPython bytecode they compile to: fast locals, name lookups, attribute access.',
  inputs: [
    { id: 'add', label: 'Function', data: { k: 'add' } },
    { id: 'loop', label: 'Module-level loop', data: { k: 'loop' } },
    { id: 'attr', label: 'Attribute access', data: { k: 'attr' } },
  ],
  build: ({ k }: { k: string }) => codeMapFrames(BYTECODE[k]),
});

// ---------------- objects & references ----------------
const OBJ_DETAILS: Record<string, Detail> = {
  a: D('Names are references', 'A Python variable is a name bound to an object, never a box holding a value. Assignment rebinds the name.', 'a = [1, 2]\nb = a\nprint(a is b)          # True\nprint(id(a) == id(b))  # same object'),
  b: D('Another name, same object', 'b = a copies the reference. Both names now reach the one list.', 'import copy\nb = a              # alias\nc = list(a)        # shallow copy\nd = copy.deepcopy(a)'),
  c: D('A copy', 'list(a), a[:] and a.copy() build a new list holding the same item pointers.', 'a = [[0], [1]]\nc = list(a)\nc[0].append(9)\nprint(a)   # [[0, 9], [1]] (items shared)'),
  l1: D('A list object', 'Every object starts with a header: a reference count and a pointer to its type. A list then holds an array of pointers to its items.', 'import sys\nx = [1, 2]\nsys.getrefcount(x)   # 2 (x + the call)\ntype(x).__name__     # \'list\''),
  l2: D('A separate list', 'A new object with its own identity. Changing it leaves the original alone.', 'a = [1, 2, 3]\nc = list(a)\nprint(a is c, a == c)   # False True'),
  i256: D('Cached small int', 'CPython creates the ints -5 to 256 once at start-up and reuses them everywhere.', 'a = 256\nb = 256\nprint(a is b)   # True'),
  i257a: D('A new int object', 'Values outside the cache are created on demand, so equal values can be different objects.', 'x = 257\ny = int("257")\nprint(x == y)   # True\nprint(x is y)   # False'),
  i257b: D('Another int object', 'Compare values with ==. Use is only for singletons like None.', 'if value is None:\n    ...'),
  fn: D('Function object', 'def runs at import time and creates a function object. Default values are evaluated then, once.', 'def add(item, bucket=[]):\n    ...\nprint(add.__defaults__)   # ([],)'),
  dflt: D('The shared default', 'One list stored on the function and reused by every call that omits bucket.', 'def add(item, bucket=None):\n    if bucket is None:\n        bucket = []\n    bucket.append(item)\n    return bucket'),
  out: D('Output', 'What print wrote so far.'),
};

machineDemo({
  slug: 'py-objects',
  title: 'Names, objects & references',
  group: G,
  summary: 'Variables are references to heap objects: aliasing, copies, identity vs equality, small-int cache, mutable defaults.',
  inputs: [
    { id: 'alias', label: 'Aliasing', data: { k: 'alias' } },
    { id: 'smallint', label: 'is vs ==', data: { k: 'smallint' } },
    { id: 'default', label: 'Mutable default', data: { k: 'default' } },
  ],
  build({ k }: { k: string }) {
    const base = { codeTitle: 'main.py', stackTitle: 'names', heapTitle: 'objects', panel: 'Objects', details: OBJ_DETAILS };
    if (k === 'alias')
      return traceFrames({
        ...base,
        code: ['a = [1, 2]', 'b = a', 'b.append(3)', 'print(a)', 'c = list(a)', 'c.append(4)', 'print(a, c)'],
        steps: [
          { line: 0, note: 'a = [1, 2] creates a list object and binds the name a to it.', vars: [['a', '0x7f10', 'write', 'l1']], heap: [['l1', 'list [1, 2]', 'read', 'refcount 1']], out: '', rows: [['objects', 1]] },
          { line: 1, note: 'b = a copies the reference, not the list. Both names point at one object.', vars: [['a', '0x7f10', undefined, 'l1'], ['b', '0x7f10', 'write', 'l1']], heap: [['l1', 'list [1, 2]', 'read', 'refcount 2']], out: '', rows: [['objects', 1]] },
          { line: 2, note: 'Mutating through b changes the only list there is.', vars: [['a', '0x7f10', undefined, 'l1'], ['b', '0x7f10', undefined, 'l1']], heap: [['l1', 'list [1, 2, 3]', 'write', 'refcount 2']], out: '', rows: [['objects', 1]] },
          { line: 3, note: 'So a shows the change too. That is aliasing.', vars: [['a', '0x7f10', 'warn', 'l1'], ['b', '0x7f10', undefined, 'l1']], heap: [['l1', 'list [1, 2, 3]', 'read', 'refcount 2']], out: '[1, 2, 3]', rows: [['objects', 1]] },
          { line: 4, note: 'list(a) builds a new list, a shallow copy with its own identity.', vars: [['a', '0x7f10', undefined, 'l1'], ['b', '0x7f10', undefined, 'l1'], ['c', '0x7f58', 'write', 'l2']], heap: [['l1', 'list [1, 2, 3]', 'read', 'refcount 2'], ['l2', 'list [1, 2, 3]', 'ok', 'refcount 1']], out: '[1, 2, 3]', rows: [['objects', 2]] },
          { line: [5, 6], note: 'Appending to c leaves a alone.', vars: [['a', '0x7f10', undefined, 'l1'], ['b', '0x7f10', undefined, 'l1'], ['c', '0x7f58', undefined, 'l2']], heap: [['l1', 'list [1, 2, 3]', 'read', 'refcount 2'], ['l2', 'list [1, 2, 3, 4]', 'write', 'refcount 1']], out: '[1, 2, 3]\n[1, 2, 3] [1, 2, 3, 4]', rows: [['objects', 2]] },
        ],
      });
    if (k === 'smallint')
      return traceFrames({
        ...base,
        code: ['a = 256', 'b = 256', 'print(a is b)', 'x = 257', 'y = int("257")', 'print(x is y, x == y)'],
        steps: [
          { line: [0, 1], note: 'CPython pre-creates the ints -5 to 256, so both names get the same cached object.', vars: [['a', '0x9a0', 'write', 'i256'], ['b', '0x9a0', 'write', 'i256']], heap: [['i256', 'int 256', 'ok', 'cached singleton']], out: '', rows: [['int objects', 1]] },
          { line: 2, note: 'is compares identity, and here it is one object.', vars: [['a', '0x9a0', undefined, 'i256'], ['b', '0x9a0', undefined, 'i256']], heap: [['i256', 'int 256', 'ok', 'cached singleton']], out: 'True', rows: [['a is b', 'True', 'ok']] },
          { line: [3, 4], note: '257 is outside the cache, and int("257") builds a fresh object at run time.', vars: [['x', '0xb10', 'write', 'i257a'], ['y', '0xb38', 'write', 'i257b']], heap: [['i257a', 'int 257', 'read', 'object 1'], ['i257b', 'int 257', 'read', 'object 2']], out: 'True', rows: [['int objects', 2]] },
          { line: 5, note: 'Equal values, different objects. Compare values with ==, and keep is for None.', vars: [['x', '0xb10', undefined, 'i257a'], ['y', '0xb38', undefined, 'i257b']], heap: [['i257a', 'int 257', 'read', 'object 1'], ['i257b', 'int 257', 'read', 'object 2']], out: 'True\nFalse True', rows: [['x is y', 'False', 'warn'], ['x == y', 'True', 'ok']] },
        ],
      });
    return traceFrames({
      ...base,
      code: ['def add(item, bucket=[]):', '    bucket.append(item)', '    return bucket', '', 'print(add(1))', 'print(add(2))'],
      steps: [
        { line: 0, note: 'def runs once and creates the function, evaluating the default [] right then.', vars: [['add', 'function', 'write', 'fn']], heap: [['fn', 'function add', 'read', '__defaults__'], ['dflt', 'list []', 'read', 'one shared list']], out: '', rows: [['default lists', 1]] },
        { line: [4, 1], note: 'add(1) omits bucket, so it gets the stored default list and appends 1.', vars: [['item', '1'], ['bucket', 'default', 'write', 'dflt']], heap: [['fn', 'function add', 'read', '__defaults__'], ['dflt', 'list [1]', 'write', 'one shared list']], out: '[1]', rows: [['calls', 1]] },
        { line: [5, 1], note: 'add(2) gets the same list, which already holds 1.', vars: [['item', '2'], ['bucket', 'default', 'fail', 'dflt']], heap: [['fn', 'function add', 'read', '__defaults__'], ['dflt', 'list [1, 2]', 'fail', 'one shared list']], out: '[1]\n[1, 2]', rows: [['calls', 2], ['surprise', 'state leaks', 'fail']] },
        { line: 0, note: 'Use bucket=None and create the list inside the function. Defaults are evaluated once, not per call.', vars: [['add', 'function', undefined, 'fn']], heap: [['fn', 'function add', 'ok', 'bucket=None'], ['dflt', 'None', 'ok', 'immutable default']], out: '[1]\n[1, 2]', rows: [['fix', 'None sentinel', 'ok']] },
      ],
    });
  },
});

// ---------------- memory: refcount, cyclic GC, generations, pymalloc ----------------
const GC_DETAILS: Record<string, Detail> = {
  x: D('Name x', 'One reference to the list, counted in its ob_refcnt.', 'x = [1, 2]\ny = x\nimport sys\nprint(sys.getrefcount(x))   # 3 (x, y, argument)'),
  y: D('Name y', 'A second reference. del y removes the name and decrements the count.', 'del y'),
  'list [1, 2]': D('Reference counted object', 'Every PyObject carries ob_refcnt. Each new reference increments it, each dropped one decrements it.', '/* CPython, simplified */\ntypedef struct {\n    Py_ssize_t ob_refcnt;\n    PyTypeObject *ob_type;\n} PyObject;'),
  freed: D('Freed immediately', 'When the count reaches zero the object’s __del__ runs and its memory is released at once.', 'class R:\n    def __del__(self): print("bye")\nr = R()\nr = None    # prints bye right here'),
  a: D('Name a', 'The only outside reference into the ring.', 'a = Node(); b = Node(); c = Node()\na.next, b.next, c.next = b, c, a\ndel b, c'),
  'node A': D('Node in a cycle', 'Its count never reaches zero while another node in the ring points at it.', 'import gc\ngc.collect()   # returns objects found unreachable'),
  'node B': D('Node in a cycle', 'Referenced only by node A.'),
  'node C': D('Node in a cycle', 'Referenced only by node B, and points back at A.'),
  'gc module': D('Cyclic garbage collector', 'Scans container objects (lists, dicts, instances) for groups that are only referenced from inside the group.', 'import gc\ngc.get_threshold()   # (700, 10, 10)\ngc.get_count()       # allocations per generation\ngc.collect(0)        # collect generation 0'),
  allocations: D('New container objects', 'Only objects that can hold references are tracked. Ints and strings can’t form cycles, so the GC ignores them.', 'import gc\ngc.is_tracked([])    # True\ngc.is_tracked(42)    # False'),
  'gen 0': D('Generation 0', 'Every new tracked object starts here. It is scanned most often.'),
  'gen 1': D('Generation 1', 'Objects that survived one gen-0 collection.'),
  'gen 2': D('Generation 2', 'Long-lived objects, rarely scanned.'),
  thresholds: D('Thresholds', 'Gen 0 runs after 700 net allocations, gen 1 after 10 gen-0 runs, gen 2 after 10 gen-1 runs.', 'import gc\ngc.set_threshold(50_000, 20, 20)'),
  'gc.freeze()': D('gc.freeze()', 'Moves every tracked object to a permanent generation the GC never scans. Useful after a server has loaded its code and caches.', 'import gc\n# after start-up, before forking workers\ngc.freeze()'),
  'small alloc': D('Small allocation', 'Most Python objects are small: ints, tuples, frames, dict entries.', 'import sys\nsys.getsizeof(1)       # 28\nsys.getsizeof((1, 2))  # 56'),
  pool: D('Pool', 'A 16 KiB page divided into blocks of one size class, 8-byte steps up to 512.'),
  arena: D('Arena', '1 MiB chunk from the OS, carved into pools. Returned only when completely empty.', '$ PYTHONMALLOCSTATS=1 python -c "pass"\n# prints arenas, pools and size classes'),
  'large alloc': D('Large allocation', 'Anything over 512 bytes (big lists’ item arrays, long strings) bypasses pymalloc.'),
  'system malloc': D('System allocator', 'Plain malloc and free from the C library.'),
  'RSS stays high': D('Fragmentation', 'One live object keeps its whole arena alive, so memory after a spike may not return to the OS.'),
};

boardDemo(
  G,
  'py-gc',
  'Python memory: refcount & GC',
  'Reference counting frees most objects instantly; the generational cyclic GC finds reference cycles; pymalloc arenas.',
  {
    refcount: [
      'Refcounting',
      {
        panel: 'Memory',
        nodes: [N('x', 40, 100, 220, 90, 'x'), N('y', 40, 280, 220, 90, 'y'), N('obj', 400, 170, 320, 130, 'list [1, 2]', 'ob_refcnt 2'), N('free', 400, 460, 320, 120, 'freed', 'memory released', { dashed: true })],
        edges: ['x>obj', 'y>obj'],
        beats: [
          { note: 'Every object counts the references pointing at it: here x and y, so 2.', hot: { obj: 'current' }, hide: ['free'], rows: [['ob_refcnt', 2]] },
          { note: 'del y drops the count to 1, and nothing else happens.', hot: { obj: 'read' }, sub: { obj: 'ob_refcnt 1' }, hide: ['y', 'free'], rows: [['ob_refcnt', 1]] },
          { note: 'x = None drops it to 0, and CPython frees the list on the spot.', hot: { obj: 'visited', free: 'ok' }, sub: { obj: 'ob_refcnt 0' }, hide: ['x', 'y'], rows: [['ob_refcnt', 0, 'ok']] },
          { note: 'Freeing is deterministic, so files and locks close at a known moment. The price is a count update on every reference change.', hot: { free: 'ok' }, hide: ['x', 'y', 'obj'], rows: [['cost', 'inc/dec everywhere', 'warn']] },
        ],
      },
    ],
    cycle: [
      'Cycles',
      {
        panel: 'Memory',
        nodes: [N('na', 80, 40, 260, 90, 'a'), N('A', 80, 200, 260, 120, 'node A', 'refcnt 2'), N('B', 660, 200, 260, 120, 'node B', 'refcnt 1'), N('C', 370, 420, 260, 120, 'node C', 'refcnt 1'), N('gc', 340, 700, 320, 120, 'gc module', 'cycle detector')],
        edges: ['na>A', 'A>B', 'B>C', 'C>A'],
        beats: [
          { note: 'Three objects point at each other in a ring, and the name a points at A.', hot: { A: 'current', 'na>A': 'accent' }, hide: ['gc'], rows: [['reachable', 'yes']] },
          { note: 'del a removes the only outside reference, yet every node still has refcount 1 from the ring.', hot: { A: 'warn', B: 'warn', C: 'warn' }, sub: { A: 'refcnt 1' }, hide: ['na', 'gc'], rows: [['reachable', 'no', 'warn'], ['refcounts', '1, 1, 1', 'warn']] },
          { note: 'Reference counting alone never frees them. The cyclic GC looks for groups only referenced from inside.', hot: { gc: 'current', A: 'warn', B: 'warn', C: 'warn' }, sub: { A: 'refcnt 1' }, hide: ['na'], rows: [['leaked until GC', '3 objects', 'warn']] },
          { note: 'It subtracts references that come from inside the group, and whatever drops to zero is garbage.', hot: { gc: 'ok', A: 'visited', B: 'visited', C: 'visited', 'A>B': 'fail', 'B>C': 'fail', 'C>A': 'fail' }, sub: { A: 'external 0', B: 'external 0', C: 'external 0' }, hide: ['na'], rows: [['freed', 3, 'ok']] },
        ],
      },
    ],
    generations: [
      'Generations',
      {
        panel: 'GC',
        nodes: [N('alloc', 40, 40, 290, 110, 'allocations', 'containers only'), N('g0', 40, 220, 290, 140, 'gen 0', 'new objects'), N('g1', 355, 220, 290, 140, 'gen 1', 'survived 1'), N('g2', 670, 220, 290, 140, 'gen 2', 'long-lived'), N('thr', 40, 440, 920, 120, 'thresholds', '700 · 10 · 10'), N('frz', 40, 640, 920, 120, 'gc.freeze()', 'permanent generation')],
        edges: ['alloc>g0', 'g0>g1', 'g1>g2'],
        beats: [
          { note: 'New container objects start in generation 0.', hot: { alloc: 'current', g0: 'write', 'alloc>g0': 'accent' }, hide: ['frz'], rows: [['gen 0 count', 0]] },
          { note: 'When allocations minus frees pass 700, gen 0 is scanned and survivors move to gen 1.', hot: { g0: 'current', thr: 'read', g1: 'write', 'g0>g1': 'accent' }, hide: ['frz'], rows: [['gen 0 runs', 'every 700 allocs']] },
          { note: 'Gen 1 is scanned every 10 gen-0 runs and gen 2 every 10 gen-1 runs, so old objects are rarely rescanned.', hot: { g1: 'current', g2: 'write', 'g1>g2': 'accent' }, hide: ['frz'], rows: [['gen 2 runs', 'rare']] },
          { note: 'Most objects die young, which keeps collections cheap. Servers often call gc.freeze() after start-up to keep boot-time objects out of every scan.', hot: { frz: 'ok', g2: 'ok' }, rows: [['full GC pauses', 'shorter', 'ok']] },
        ],
      },
    ],
    pymalloc: [
      'pymalloc',
      {
        panel: 'Allocator',
        nodes: [N('req', 40, 60, 290, 110, 'small alloc', '≤ 512 bytes'), N('pool', 355, 60, 290, 110, 'pool', '16 KiB, one size'), N('arena', 670, 60, 290, 110, 'arena', '1 MiB from the OS'), N('big', 40, 300, 290, 110, 'large alloc', '> 512 bytes'), N('malloc', 355, 300, 290, 110, 'system malloc'), N('rss', 40, 540, 920, 120, 'RSS stays high', 'one live block pins an arena')],
        edges: ['req>pool', 'pool>arena', 'big>malloc'],
        beats: [
          { note: 'Objects up to 512 bytes skip malloc and come from pymalloc, Python’s own allocator.', hot: { req: 'current', 'req>pool': 'accent' }, hide: ['big', 'malloc', 'rss'], rows: [['path', 'pymalloc']] },
          { note: 'Blocks of one size class are carved from pools, and pools from 1 MiB arenas.', hot: { pool: 'current', arena: 'write', 'pool>arena': 'accent' }, hide: ['big', 'malloc', 'rss'], rows: [['size classes', '8-byte steps']] },
          { note: 'Larger requests go straight to the system allocator.', hot: { big: 'current', malloc: 'write', 'big>malloc': 'accent' }, hide: ['rss'], rows: [['path', 'malloc']] },
          { note: 'An arena returns to the OS only when every block in it is free, so memory can stay high after a spike.', hot: { rss: 'warn', arena: 'warn' }, rows: [['after spike', 'RSS stays high', 'warn']] },
        ],
      },
    ],
  },
  GC_DETAILS,
);

// ---------------- the GIL: thread timelines ----------------
export interface Seg {
  lane: number;
  t0: number;
  t1: number;
  tone: Tone;
  label?: string;
}

/** Round-robin GIL hand-off: n CPU-bound threads, `work` ms each, switching every `slice` ms. */
export function gilSchedule(n: number, work: number, slice: number): Seg[] {
  const left = Array(n).fill(work);
  const out: Seg[] = [];
  let t = 0;
  let i = 0;
  while (left.some((x) => x > 0)) {
    if (left[i] > 0) {
      const d = Math.min(slice, left[i]);
      out.push({ lane: i, t0: t, t1: t + d, tone: 'write' }, { lane: n, t0: t, t1: t + d, tone: 'accent', label: `T${i + 1}` });
      left[i] -= d;
      t += d;
    }
    i = (i + 1) % n;
  }
  return out;
}

interface Timeline {
  lanes: [label: string, detail?: Detail][];
  T: number;
  segs: Seg[];
  beats: { note: string; until: number; rows: Row[] }[];
  title: string;
}

function timelineFrames(o: Timeline): Frame[] {
  const f = new Film();
  const x0 = 250;
  const x1 = 960;
  const X = (t: number) => x0 + ((x1 - x0) * t) / o.T;
  const lh = Math.min(150, 620 / o.lanes.length);
  for (const b of o.beats) {
    const out: Shape[] = [text('title', 20, 60, o.title, { align: 'left', size: 28, bold: true })];
    o.lanes.forEach(([label, detail], i) => {
      const y = 140 + i * lh;
      const lane = box(`lane${i}`, 20, y, 210, lh - 30, label, { mono: true, tone: 'default' });
      if (detail && lane.t === 'rect') lane.detail = detail;
      out.push(lane, line(`track${i}`, x0, y + (lh - 30) / 2, x1, y + (lh - 30) / 2, 'muted', { dashed: true, width: 2 }));
    });
    o.segs.forEach((s, k) => {
      if (s.t0 >= b.until) return;
      const y = 140 + s.lane * lh;
      const w = X(Math.min(s.t1, b.until)) - X(s.t0);
      out.push(box(`s${k}`, X(s.t0), y, Math.max(4, w - 3), lh - 30, w > 60 ? s.label : undefined, { tone: s.tone, mono: true }));
    });
    const ay = 140 + o.lanes.length * lh + 10;
    out.push(line('axis', x0, ay, x1, ay, 'default', { width: 2 }), text('t0', x0, ay + 30, '0 ms', { size: 24, mono: true }), text('tT', x1 - 30, ay + 30, `${o.T} ms`, { size: 24, mono: true }));
    out.push(line('now', X(b.until), 110, X(b.until), ay, 'current', { width: 3 }));
    f.add(b.note, out, panel('Timeline', b.rows));
  }
  return f.frames;
}

const LANE: Record<string, Detail> = {
  t: D('A Python thread', 'A real OS thread. It may only run bytecode while holding the GIL.', 'import threading\ndef work():\n    sum(i * i for i in range(10**7))\nts = [threading.Thread(target=work) for _ in range(2)]\nfor t in ts: t.start()\nfor t in ts: t.join()'),
  gil: D('Global Interpreter Lock', 'One mutex per interpreter. It keeps refcounts and interpreter state consistent without a lock on every object.', 'import sys\nsys.getswitchinterval()   # 0.005 s'),
  p: D('A process', 'A separate interpreter with its own memory and its own GIL.', 'from multiprocessing import Pool\nwith Pool(2) as p:\n    p.map(work, range(2))'),
  ft: D('Free-threaded build', 'python3.13t removes the GIL; objects are protected by per-object locks and biased reference counting.', '$ python3.13t -c "import sys; print(sys._is_gil_enabled())"\nFalse'),
};

machineDemo({
  slug: 'py-gil',
  title: 'The GIL',
  group: G,
  summary: 'Only one thread runs Python bytecode at a time: CPU-bound threads take turns, I/O releases the GIL, processes and free-threaded builds run in parallel.',
  inputs: [
    { id: 'cpu', label: 'CPU-bound threads', data: { k: 'cpu' } },
    { id: 'io', label: 'I/O-bound threads', data: { k: 'io' } },
    { id: 'multiproc', label: 'multiprocessing', data: { k: 'multiproc' } },
    { id: 'freethreaded', label: 'Free-threaded 3.13t', data: { k: 'freethreaded' } },
  ],
  build({ k }: { k: string }) {
    if (k === 'cpu') {
      const segs = gilSchedule(2, 20, 5);
      const T = Math.max(...segs.map((s) => s.t1));
      return timelineFrames({
        title: '2 threads × 20 ms of CPU work',
        lanes: [['thread 1', LANE.t], ['thread 2', LANE.t], ['GIL', LANE.gil]],
        T,
        segs,
        beats: [
          { note: 'Two threads run a CPU-bound loop. Only the thread holding the GIL may execute bytecode.', until: 5, rows: [['running', 'T1']] },
          { note: 'After the 5 ms switch interval the holder is asked to drop it, and the other thread takes over.', until: 10, rows: [['switch interval', '5 ms']] },
          { note: 'They take turns instead of running side by side.', until: 25, rows: [['parallel', 'no', 'warn']] },
          { note: '20 ms of work each still takes 40 ms in total. Threads give CPU-bound Python no speedup.', until: T, rows: [['wall time', `${T} ms`, 'warn'], ['speedup', '1.0×', 'warn']] },
        ],
      });
    }
    if (k === 'io')
      return timelineFrames({
        title: 'thread 1 waits on a socket',
        lanes: [['thread 1', LANE.t], ['thread 2', LANE.t], ['GIL', LANE.gil]],
        T: 40,
        segs: [
          { lane: 0, t0: 0, t1: 3, tone: 'write', label: 'send' },
          { lane: 2, t0: 0, t1: 3, tone: 'accent', label: 'T1' },
          { lane: 0, t0: 3, t1: 30, tone: 'visited', label: 'recv (GIL released)' },
          { lane: 1, t0: 3, t1: 30, tone: 'write', label: 'compute' },
          { lane: 2, t0: 3, t1: 30, tone: 'accent', label: 'T2' },
          { lane: 0, t0: 30, t1: 34, tone: 'write', label: 'parse' },
          { lane: 2, t0: 30, t1: 34, tone: 'accent', label: 'T1' },
          { lane: 1, t0: 34, t1: 40, tone: 'write', label: 'compute' },
          { lane: 2, t0: 34, t1: 40, tone: 'accent', label: 'T2' },
        ],
        beats: [
          { note: 'Thread 1 sends a request, then blocks in recv.', until: 4, rows: [['holder', 'T1']] },
          { note: 'Blocking I/O calls release the GIL, so thread 2 runs meanwhile.', until: 20, rows: [['overlap', 'yes', 'ok']] },
          { note: 'When the reply arrives, thread 1 takes the GIL back to parse it.', until: 34, rows: [['holder', 'T1']] },
          { note: 'That is why threads work well for I/O-bound code like HTTP clients and database calls.', until: 40, rows: [['waiting overlapped', '27 ms', 'ok']] },
        ],
      });
    if (k === 'multiproc')
      return timelineFrames({
        title: '2 processes × 20 ms of CPU work',
        lanes: [['process 1', LANE.p], ['process 2', LANE.p], ['GIL 1', LANE.gil], ['GIL 2', LANE.gil]],
        T: 40,
        segs: [
          { lane: 0, t0: 0, t1: 20, tone: 'write', label: 'work' },
          { lane: 1, t0: 0, t1: 20, tone: 'write', label: 'work' },
          { lane: 2, t0: 0, t1: 20, tone: 'accent', label: 'P1' },
          { lane: 3, t0: 0, t1: 20, tone: 'accent', label: 'P2' },
        ],
        beats: [
          { note: 'multiprocessing starts separate interpreters, each with its own GIL.', until: 5, rows: [['GILs', 2]] },
          { note: 'They run on two cores at once, so 20 ms of work each finishes in 20 ms.', until: 20, rows: [['wall time', '20 ms', 'ok'], ['speedup', '2.0×', 'ok']] },
          { note: 'The price is process start-up and pickling every argument and result between processes.', until: 40, rows: [['overhead', 'spawn + pickle', 'warn']] },
        ],
      });
    return timelineFrames({
      title: 'python3.13t: no GIL',
      lanes: [['thread 1', LANE.ft], ['thread 2', LANE.ft]],
      T: 40,
      segs: [
        { lane: 0, t0: 0, t1: 23, tone: 'write', label: 'work' },
        { lane: 1, t0: 0, t1: 23, tone: 'write', label: 'work' },
      ],
      beats: [
        { note: 'Python 3.13 ships an optional free-threaded build, python3.13t, with no GIL.', until: 3, rows: [['GIL', 'off']] },
        { note: 'Threads now run truly in parallel, with fine-grained locks inside objects instead.', until: 23, rows: [['wall time', '23 ms', 'ok']] },
        { note: 'Single-threaded code runs somewhat slower, and C extensions must declare they are safe.', until: 40, rows: [['single-thread cost', '~10%', 'warn']] },
      ],
    });
  },
});

// ---------------- asyncio ----------------
const ASYNC_DETAILS: Record<string, Detail> = {
  'event loop': D('Event loop', 'Runs one task at a time on one thread, switching only at await points.', 'import asyncio\n\nasync def main():\n    await asyncio.gather(fetch("a"), fetch("b"))\n\nasyncio.run(main())'),
  'ready queue': D('Ready queue', 'Callbacks and tasks that can run right now, processed in order each loop iteration.'),
  selector: D('Selector', 'epoll on Linux, kqueue on macOS: one system call that reports which sockets are readable or writable.', 'import selectors\nsel = selectors.DefaultSelector()\nprint(type(sel).__name__)   # EpollSelector'),
  'task fetch(a)': D('Task', 'A coroutine wrapped so the loop can schedule it. It runs until its next await.', 'async def fetch(host):\n    r, w = await asyncio.open_connection(host, 80)\n    w.write(b"GET / HTTP/1.0\\r\\n\\r\\n")\n    return await r.read()'),
  'task fetch(b)': D('Task', 'Same coroutine, different host. It shares the thread with the others.'),
  'task fetch(c)': D('Task', 'Suspended tasks cost only their frame, so thousands can wait at once.'),
  sockets: D('Sockets', 'Non-blocking sockets registered with the selector.'),
};
const ASYNC_NODES = [
  N('loop', 355, 40, 290, 120, 'event loop', 'one thread'),
  N('rq', 40, 260, 290, 110, 'ready queue'),
  N('sel', 670, 260, 290, 110, 'selector', 'epoll / kqueue'),
  N('ta', 40, 480, 290, 110, 'task fetch(a)'),
  N('tb', 355, 480, 290, 110, 'task fetch(b)'),
  N('tc', 670, 480, 290, 110, 'task fetch(c)'),
  N('sock', 355, 720, 290, 110, 'sockets'),
];
const ASYNC_EDGES = ['loop>rq', 'loop>sel', 'rq>ta', 'rq>tb', 'ta>sock', 'tb>sock', 'tc>sock'];

boardDemo(
  G,
  'py-async',
  'asyncio event loop',
  'Coroutines as tasks on one thread: await yields to the loop, the selector wakes tasks, and a blocking call freezes everything.',
  {
    loop: [
      'Event loop',
      {
        panel: 'asyncio',
        nodes: ASYNC_NODES,
        edges: ASYNC_EDGES,
        beats: [
          { note: 'asyncio.run starts an event loop on the current thread.', hot: { loop: 'current' }, rows: [['threads', 1]] },
          { note: 'gather wraps three coroutines as tasks and queues them as ready.', hot: { rq: 'current', ta: 'write', tb: 'write', tc: 'write', 'loop>rq': 'accent' }, rows: [['tasks', 3]] },
          { note: 'Each task runs until await reader.read(), then yields back to the loop.', hot: { ta: 'visited', tb: 'visited', tc: 'visited', sock: 'read', 'ta>sock': 'accent', 'tb>sock': 'accent', 'tc>sock': 'accent' }, sub: { ta: 'awaiting read', tb: 'awaiting read', tc: 'awaiting read' }, rows: [['suspended', 3]] },
          { note: 'The loop asks the selector which sockets have data and resumes exactly those tasks.', hot: { sel: 'current', tb: 'ok', 'loop>sel': 'accent' }, sub: { tb: 'resumed' }, rows: [['ready', 'b']] },
          { note: 'Three requests overlap on one thread. No locks are needed because tasks only switch at await.', hot: { loop: 'ok', ta: 'ok', tb: 'ok', tc: 'ok' }, rows: [['wall time', '≈ slowest request', 'ok']] },
        ],
      },
    ],
    blocking: [
      'Blocking call',
      {
        panel: 'asyncio',
        nodes: ASYNC_NODES,
        edges: ASYNC_EDGES,
        beats: [
          { note: 'Task b calls time.sleep(1), or a blocking library, instead of awaiting.', hot: { tb: 'fail' }, sub: { tb: 'time.sleep(1)' }, rows: [['yields', 'never', 'fail']] },
          { note: 'It never yields, so the loop and every other task freeze for the full second.', hot: { tb: 'fail', loop: 'fail', ta: 'warn', tc: 'warn' }, sub: { tb: 'time.sleep(1)' }, rows: [['stalled tasks', 2, 'fail']] },
          { note: 'Use await asyncio.sleep, async libraries, or asyncio.to_thread for blocking work.', hot: { tb: 'ok', loop: 'ok' }, sub: { tb: 'await to_thread(…)' }, rows: [['fix', 'await it', 'ok']] },
        ],
      },
    ],
  },
  ASYNC_DETAILS,
);

// ---------------- generators ----------------
const GEN_DETAILS: Record<string, Detail> = {
  g: D('Generator object', 'Calling a generator function returns this object without running the body.', 'def count(n):\n    i = 0\n    while i < n:\n        yield i\n        i += 1\n\ng = count(2)\nprint(list(g))   # [0, 1]'),
  gen: D('Suspended frame', 'The generator keeps its frame (locals and position) on the heap between next() calls.', 'import inspect\ng = count(2)\ninspect.getgeneratorstate(g)   # GEN_CREATED\nnext(g)\ninspect.getgeneratorstate(g)   # GEN_SUSPENDED'),
  nums: D('range object', 'Stores start, stop and step only, whatever its length.', 'import sys\nsys.getsizeof(range(10**9))   # 48'),
  rng: D('range', 'Values are computed on demand.'),
  sq: D('Generator expression', 'A lazy pipeline stage: pulls one item, squares it, hands it on.', 'sq = (x * x for x in range(10))'),
  gsq: D('Paused genexpr', 'Holds its own frame and a reference to the iterator it reads from.'),
  evens: D('Chained generator', 'Pulls from sq only when asked for its next value.', 'evens = (y for y in sq if y % 2 == 0)\nprint(next(evens))'),
  gev: D('Paused genexpr', 'Nothing runs until something calls next().'),
  out: D('Output', 'What print wrote so far.'),
};

machineDemo({
  slug: 'py-generator',
  title: 'Generators & lazy pipelines',
  group: G,
  summary: 'yield suspends a frame on the heap; next() resumes it; chained generator expressions process a billion items in constant memory.',
  inputs: [
    { id: 'gen', label: 'yield', data: { k: 'gen' } },
    { id: 'lazy', label: 'Lazy pipeline', data: { k: 'lazy' } },
  ],
  build({ k }: { k: string }) {
    const base = { codeTitle: 'main.py', stackTitle: 'names', heapTitle: 'objects', panel: 'Generators', details: GEN_DETAILS };
    if (k === 'gen')
      return traceFrames({
        ...base,
        code: ['def count(n):', '    i = 0', '    while i < n:', '        yield i', '        i += 1', '', 'g = count(2)', 'print(next(g))', 'print(next(g))'],
        steps: [
          { line: 6, note: 'Calling count(2) runs none of the body. It returns a generator object holding a fresh frame.', vars: [['g', 'generator', 'write', 'gen']], heap: [['gen', 'count frame', 'read', 'not started']], out: '', rows: [['state', 'GEN_CREATED']] },
          { line: [7, 3], note: 'next(g) runs the body until yield i, then pauses with the frame kept alive on the heap.', vars: [['g', 'generator', undefined, 'gen']], heap: [['gen', 'count frame', 'write', 'i = 0 · at yield']], out: '0', rows: [['state', 'GEN_SUSPENDED']] },
          { line: [8, 4, 3], note: 'The next call resumes right after the yield, with i still in the frame.', vars: [['g', 'generator', undefined, 'gen']], heap: [['gen', 'count frame', 'write', 'i = 1 · at yield']], out: '0\n1', rows: [['state', 'GEN_SUSPENDED']] },
          { line: 2, note: 'A third next(g) falls off the end and raises StopIteration, which is how a for loop knows to stop.', vars: [['g', 'generator', undefined, 'gen']], heap: [['gen', 'count frame', 'visited', 'finished']], out: '0\n1', rows: [['state', 'GEN_CLOSED']] },
        ],
      });
    return traceFrames({
      ...base,
      code: ['nums = range(10**9)', 'sq = (x * x for x in nums)', 'evens = (y for y in sq if y % 2 == 0)', 'print(next(evens))'],
      steps: [
        { line: 0, note: 'range(10**9) stores three numbers, not a billion ints.', vars: [['nums', 'range', 'write', 'rng']], heap: [['rng', 'range(0, 10**9)', 'read', '48 bytes']], out: '', rows: [['memory', '48 B']] },
        { line: [1, 2], note: 'Each generator expression is a paused frame that will pull from the one before it.', vars: [['nums', 'range', undefined, 'rng'], ['sq', 'genexpr', 'write', 'gsq'], ['evens', 'genexpr', 'write', 'gev']], heap: [['rng', 'range(0, 10**9)', 'read', '48 bytes'], ['gsq', 'sq frame', 'read', 'not started'], ['gev', 'evens frame', 'read', 'not started']], out: '', rows: [['items computed', 0]] },
        { line: 3, note: 'next(evens) pulls from sq, which pulls 0 from nums, and 0 passes the filter.', vars: [['nums', 'range', undefined, 'rng'], ['sq', 'genexpr', undefined, 'gsq'], ['evens', 'genexpr', 'ok', 'gev']], heap: [['rng', 'range(0, 10**9)', 'read', '48 bytes'], ['gsq', 'sq frame', 'write', 'x = 0'], ['gev', 'evens frame', 'write', 'y = 0']], out: '0', rows: [['items computed', 1, 'ok']] },
        { line: 3, note: 'Only one item was ever computed. Memory stays constant however long the pipeline runs.', vars: [['nums', 'range', undefined, 'rng'], ['sq', 'genexpr', undefined, 'gsq'], ['evens', 'genexpr', undefined, 'gev']], heap: [['rng', 'range(0, 10**9)', 'ok', '48 bytes'], ['gsq', 'sq frame', 'ok', 'paused'], ['gev', 'evens frame', 'ok', 'paused']], out: '0', rows: [['memory', 'O(1)', 'ok']] },
      ],
    });
  },
});

// ---------------- imports ----------------
const IMPORT_DETAILS: Record<string, Detail> = {
  'import requests': D('import statement', 'Find the module, run it once, bind a name. The first two steps are skipped when it is already loaded.', 'import requests\nimport json as j\nfrom os import path'),
  'sys.modules': D('Module cache', 'A dict of every module imported so far, keyed by dotted name. Every later import returns the same object.', 'import sys, json\nprint(sys.modules["json"] is json)   # True\nprint(len(sys.modules))'),
  'meta path finders': D('Finders', 'Objects on sys.meta_path asked in turn: built-ins, frozen modules, then the path finder. Import hooks add their own.', 'import sys\nfor f in sys.meta_path:\n    print(f)'),
  'sys.path': D('Search path', 'Directories searched in order. The first match wins, so a local file named json.py shadows the standard library.', 'import sys\nfor p in sys.path:\n    print(p)'),
  'script dir': D('Script directory', 'The folder of the script you ran (or the current dir for -m and the REPL) comes first.'),
  PYTHONPATH: D('PYTHONPATH', 'Extra directories from the environment variable.', '$ PYTHONPATH=src python -m app'),
  stdlib: D('Standard library', 'The lib/python3.x directory of your interpreter.'),
  'site-packages': D('site-packages', 'Where pip installs third-party packages for this interpreter or venv.', '$ pip show requests\nName: requests\nVersion: 2.32.3\nLocation: …/.venv/lib/python3.12/site-packages'),
  'module spec': D('Module spec', 'What the finder returns: the module’s name, origin file and the loader that can execute it.', 'import importlib.util\nspec = importlib.util.find_spec("requests")\nprint(spec.origin)'),
  'run module code': D('Executing the module', 'A new module object is put in sys.modules first, then its top-level code runs to fill its namespace.', '# requests/__init__.py runs top to bottom\n# defining functions and importing submodules'),
  'bind name': D('Binding the name', 'import requests binds requests in the importing module’s globals. from x import y binds only y.', 'import requests\nprint(globals()["requests"])'),
};
const IMP_NODES = [
  N('stmt', 40, 40, 290, 110, 'import requests'),
  N('mods', 355, 40, 290, 110, 'sys.modules', 'cache dict'),
  N('fnd', 670, 40, 290, 110, 'meta path finders'),
  N('path', 670, 210, 290, 100, 'sys.path', 'searched in order'),
  N('p1', 670, 340, 290, 80, 'script dir'),
  N('p2', 670, 440, 290, 80, 'PYTHONPATH'),
  N('p3', 670, 540, 290, 80, 'stdlib'),
  N('p4', 670, 640, 290, 80, 'site-packages'),
  N('spec', 355, 640, 290, 80, 'module spec'),
  N('exec', 355, 820, 290, 100, 'run module code'),
  N('bind', 40, 820, 290, 100, 'bind name'),
];
const IMP_EDGES = ['stmt>mods', 'mods>fnd', 'fnd>path', 'path>p1', 'p4>spec', 'spec>exec', 'exec>bind'];

boardDemo(
  G,
  'py-import',
  'How import works',
  'sys.modules cache, finders and sys.path search, module specs, executing module code once; packages, relative and circular imports.',
  {
    first: [
      'First import',
      {
        panel: 'Import',
        nodes: IMP_NODES,
        edges: IMP_EDGES,
        beats: [
          { note: 'import requests first checks sys.modules, the cache of every module loaded so far.', hot: { stmt: 'current', mods: 'read', 'stmt>mods': 'accent' }, rows: [['cached', 'no']] },
          { note: 'Not there, so the finders search each sys.path entry in order.', hot: { fnd: 'current', path: 'read', p1: 'visited', p2: 'visited', p3: 'visited', p4: 'ok', 'mods>fnd': 'accent', 'fnd>path': 'accent', 'path>p1': 'accent' }, rows: [['dirs tried', 4]] },
          { note: 'site-packages has requests/__init__.py, which gives a spec: the file and the loader for it.', hot: { p4: 'ok', spec: 'current', 'p4>spec': 'accent' }, rows: [['origin', 'site-packages']] },
          { note: 'A module object goes into sys.modules, then its code runs top to bottom.', hot: { exec: 'current', mods: 'write', 'spec>exec': 'accent' }, sub: { mods: '+ requests' }, rows: [['module code runs', 'once']] },
          { note: 'Finally the name requests is bound in your module’s globals.', hot: { bind: 'ok', 'exec>bind': 'accent' }, sub: { mods: '+ requests' }, rows: [['bound', 'requests', 'ok']] },
        ],
      },
    ],
    cached: [
      'Second import',
      {
        panel: 'Import',
        nodes: IMP_NODES,
        edges: IMP_EDGES,
        beats: [
          { note: 'Another module runs import requests later on.', hot: { stmt: 'current' }, sub: { mods: 'has requests' }, rows: [['cached', 'yes', 'ok']] },
          { note: 'sys.modules already has it, so there is no search and no re-execution.', hot: { mods: 'ok', bind: 'ok', 'stmt>mods': 'accent' }, sub: { mods: 'has requests' }, hide: ['fnd>path', 'path>p1', 'p4>spec', 'spec>exec'], rows: [['cost', 'dict lookup', 'ok']] },
          { note: 'Every importer shares one module object, so module-level code runs once per process.', hot: { mods: 'ok', exec: 'visited' }, sub: { mods: 'has requests', exec: 'not run again' }, rows: [['module objects', 1]] },
        ],
      },
    ],
    package: [
      'Packages & relative',
      {
        panel: 'Import',
        nodes: IMP_NODES,
        edges: IMP_EDGES,
        beats: [
          { note: 'A package is a directory with __init__.py, and importing app.db imports app first.', label: { stmt: 'import app.db' }, hot: { stmt: 'current', exec: 'write' }, sub: { exec: 'app/__init__.py' }, rows: [['imported', 'app']] },
          { note: 'Then app.db and app.db.models, each cached under its full dotted name.', label: { stmt: 'import app.db' }, hot: { mods: 'write' }, sub: { mods: 'app, app.db' }, rows: [['imported', 'app, app.db']] },
          { note: 'Inside the package, from .db import models is relative: resolved from the current package, not sys.path.', label: { stmt: 'from .db import models' }, hot: { stmt: 'current', mods: 'ok' }, hide: ['fnd>path', 'path>p1', 'p4>spec'], rows: [['resolved from', '__package__']] },
          { note: 'Running a file inside the package as a script breaks relative imports, so run python -m app.main instead.', label: { stmt: 'from .db import models' }, hot: { stmt: 'fail' }, sub: { stmt: 'no parent package' }, rows: [['fix', 'python -m', 'ok']] },
        ],
      },
    ],
    circular: [
      'Circular import',
      {
        panel: 'Import',
        nodes: IMP_NODES,
        edges: IMP_EDGES,
        beats: [
          { note: 'a.py starts running and, on its first line, imports b.', label: { stmt: 'import a' }, hot: { exec: 'current' }, sub: { mods: 'a (running)', exec: 'a.py line 1' }, rows: [['a', 'half done', 'warn']] },
          { note: 'b.py runs from a import f, and sys.modules already holds a, half executed.', label: { stmt: 'from a import f' }, hot: { mods: 'warn', stmt: 'current' }, sub: { mods: 'a (no f yet)' }, rows: [['a.f', 'not defined yet', 'warn']] },
          { note: 'ImportError: cannot import name f from partially initialized module a.', label: { stmt: 'from a import f' }, hot: { stmt: 'fail', bind: 'fail' }, sub: { mods: 'a (no f yet)' }, rows: [['result', 'ImportError', 'fail']] },
          { note: 'Move the shared code into a third module, or import inside the function that needs it.', label: { stmt: 'import common' }, hot: { stmt: 'ok', bind: 'ok' }, rows: [['fix', 'break the cycle', 'ok']] },
        ],
      },
    ],
  },
  IMPORT_DETAILS,
);

// ---------------- packaging ----------------
const PIP_DETAILS: Record<string, Detail> = {
  'system python': D('System interpreter', 'The Python your OS or Homebrew installed. Tools depend on its packages, so don’t pip install into it.', '$ which python3\n/usr/bin/python3'),
  '.venv/': D('Virtual environment', 'A folder with a python link and its own site-packages. Delete it to start over.', '$ python3 -m venv .venv\n$ source .venv/bin/activate\n(.venv) $ which python\n./.venv/bin/python'),
  'pyproject.toml': D('pyproject.toml', 'The standard project file: metadata, dependencies and the build backend.', '[project]\nname = "app"\nversion = "0.1.0"\ndependencies = [\n  "requests>=2.31",\n  "pydantic~=2.7",\n]\n\n[build-system]\nrequires = ["hatchling"]\nbuild-backend = "hatchling.build"'),
  'pip / uv': D('Installer', 'pip is the default installer; uv is a much faster drop-in with its own resolver and lock file.', '$ pip install -e .\n$ uv sync'),
  PyPI: D('Package index', 'pypi.org serves each project’s versions and files (wheels and sdists). Companies often mirror it.', '$ pip index versions requests'),
  'wheel (.whl)': D('Wheel', 'A prebuilt zip. Its name encodes the Python version and platform it works on, and installing is just unzipping.', 'numpy-2.0.0-cp312-cp312-macosx_14_0_arm64.whl\n#     ^ver  ^python ^abi  ^platform'),
  'sdist (.tar.gz)': D('Source distribution', 'The source plus build instructions. Installing it runs the build backend, possibly compiling C code.', '$ pip install --no-binary :all: somepkg\n# forces building from the sdist'),
  'site-packages': D('site-packages', 'Installed packages for this environment, plus a .dist-info folder recording each one’s version and files.', '$ pip list\n$ pip show -f requests'),
  resolver: D('Dependency resolver', 'Finds one version of every package that satisfies all constraints, backtracking on conflicts.', 'ERROR: Cannot install a==1.0 and b==2.0\n  a 1.0 depends on urllib3<2\n  b 2.0 depends on urllib3>=2'),
  'lock file': D('Lock file', 'Exact versions and hashes of every package, transitive ones included, so every machine installs the same set.', '# uv.lock (excerpt)\n[[package]]\nname = "urllib3"\nversion = "2.2.2"'),
};
const PIP_NODES = [
  N('sys', 40, 60, 290, 110, 'system python', '/usr/bin/python3'),
  N('venv', 355, 60, 290, 110, '.venv/', 'own site-packages'),
  N('proj', 670, 60, 290, 110, 'pyproject.toml', 'deps + build'),
  N('res', 40, 250, 290, 110, 'resolver', 'one compatible set'),
  N('pip', 355, 250, 290, 110, 'pip / uv', 'installer'),
  N('idx', 670, 250, 290, 110, 'PyPI', 'package index'),
  N('lock', 40, 440, 290, 110, 'lock file', 'exact versions'),
  N('sp', 355, 440, 290, 110, 'site-packages', 'installed code'),
  N('whl', 670, 440, 290, 110, 'wheel (.whl)', 'prebuilt zip'),
  N('sdist', 670, 630, 290, 110, 'sdist (.tar.gz)', 'needs a build'),
];
const PIP_EDGES = ['sys>venv', 'proj>pip', 'pip>idx', 'idx>whl', 'whl>sp', 'sdist>sp', 'pip>res', 'res>lock'];

boardDemo(
  G,
  'py-pip',
  'pip, venv & dependencies',
  'Virtual environments, pyproject.toml, wheels vs sdists, one-version-per-environment resolution and lock files.',
  {
    venv: [
      'venv',
      {
        panel: 'Packaging',
        nodes: PIP_NODES,
        edges: PIP_EDGES,
        beats: [
          { note: 'Installing into the system Python mixes every project’s packages and can break OS tools.', hot: { sys: 'warn' }, hide: ['res', 'lock', 'whl', 'sdist'], rows: [['isolation', 'none', 'warn']] },
          { note: 'python -m venv .venv makes a folder with its own interpreter link and site-packages.', hot: { venv: 'current', sp: 'write', 'sys>venv': 'accent' }, hide: ['res', 'lock', 'whl', 'sdist'], rows: [['environments', 'one per project', 'ok']] },
          { note: 'Activating only puts .venv/bin first on PATH, and the venv is just a directory you can delete.', hot: { venv: 'ok' }, hide: ['res', 'lock', 'whl', 'sdist'], rows: [['activate', 'PATH tweak']] },
        ],
      },
    ],
    install: [
      'Install',
      {
        panel: 'Packaging',
        nodes: PIP_NODES,
        edges: PIP_EDGES,
        beats: [
          { note: 'pip install -e . reads the dependencies from pyproject.toml.', hot: { proj: 'current', pip: 'write', 'proj>pip': 'accent' }, hide: ['res', 'lock'], rows: [['declared', 'requests, pydantic']] },
          { note: 'It asks PyPI for each project’s available versions and files.', hot: { idx: 'current', 'pip>idx': 'accent' }, hide: ['res', 'lock'], rows: [['index', 'pypi.org']] },
          { note: 'A wheel matching your Python and platform is simply unzipped into site-packages.', hot: { whl: 'ok', sp: 'write', 'idx>whl': 'accent', 'whl>sp': 'accent' }, hide: ['res', 'lock'], rows: [['build step', 'none', 'ok']] },
          { note: 'With no matching wheel pip builds the sdist instead, which may need a C compiler.', hot: { sdist: 'warn', 'sdist>sp': 'warn' }, hide: ['res', 'lock'], rows: [['build step', 'compile', 'warn']] },
        ],
      },
    ],
    resolve: [
      'Resolve & lock',
      {
        panel: 'Packaging',
        nodes: PIP_NODES,
        edges: PIP_EDGES,
        beats: [
          { note: 'One package needs urllib3 < 2 and another needs urllib3 ≥ 2.', hot: { res: 'warn', 'pip>res': 'accent' }, sub: { res: 'urllib3 conflict' }, rows: [['constraints', 2, 'warn']] },
          { note: 'An environment holds one version per package, so the resolver must find a set that satisfies both or fail.', hot: { res: 'fail', sp: 'read' }, sub: { res: 'ResolutionImpossible' }, rows: [['versions per env', 1]] },
          { note: 'A lock file from uv or poetry pins every transitive version and hash, so CI installs exactly what you tested.', hot: { lock: 'ok', res: 'ok', 'res>lock': 'accent' }, rows: [['reproducible', 'yes', 'ok']] },
        ],
      },
    ],
  },
  PIP_DETAILS,
);

