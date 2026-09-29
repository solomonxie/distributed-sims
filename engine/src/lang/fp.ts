// Functional programming (group lang-fp): purity & immutability, higher-order functions & closures, recursion & folds, laziness, algebraic data types, functors & monads.
import type { Detail } from '../algo/frames';
import { machineDemo } from '../machine/lib/draw';
import { traceFrames } from '../machine/lib/trace';
import type { Trace } from '../machine/lib/trace';

const G = 'lang-fp';
const D = (title: string, text: string, code?: string): Detail => ({ title, text, code });

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

// ---------------- purity & immutability ----------------
traceDemo('fp-pure', 'Pure functions & immutability', 'Same input, same output, no side effects; persistent data shares structure instead of mutating; effects live at the edges.', {
  pure: [
    'Pure vs impure',
    {
      codeTitle: 'main.js',
      code: ['let total = 0;', 'const addImpure = x => { total += x; return total; };', 'const add = (a, b) => a + b;', 'addImpure(2); addImpure(2);   // 2, then 4', 'add(1, 2); add(1, 2);         // 3, then 3'],
      stackTitle: 'values',
      details: {
        total: D('Hidden state', 'addImpure reads and writes a variable outside itself, so its result depends on call history.'),
        add: D('Referential transparency', 'A pure call can be replaced by its result anywhere without changing the program. That makes it cacheable, testable and safe to run in parallel.', 'const memo = new Map();\nconst sq = n => memo.get(n) ?? (memo.set(n, n * n), n * n);'),
      },
      steps: [
        { note: 'total is shared mutable state outside both functions.', line: 0, vars: [['total', '0', 'write']], out: '' },
        { note: 'addImpure(2) returns 2 and changes total as a side effect.', line: [1, 3], vars: [['total', '2', 'write'], ['addImpure(2)', '2', 'warn']], out: '2' },
        { note: 'The identical call now returns 4. Its answer depends on history, not just on its argument.', line: 3, vars: [['total', '4', 'write'], ['addImpure(2)', '4', 'fail']], out: '2\n4' },
        { note: 'add only reads its arguments, so add(1, 2) is always 3.', line: [2, 4], vars: [['total', '4'], ['add(1, 2)', '3', 'ok'], ['again', '3', 'ok']], out: '2\n4\n3\n3' },
      ],
    },
  ],
  persistent: [
    'Persistent data',
    {
      codeTitle: 'main.js',
      code: ['const xs = [2, 3];          // immutable list', 'const ys = [1, ...xs];      // new list', 'const zs = [9, ...xs];', '// xs is unchanged'],
      stackTitle: 'names',
      heapTitle: 'cons cells',
      details: {
        xs: D('Persistent list', 'Linked cells that are never modified. Prepending makes one new cell that points at the old list.', '-- Haskell\nys = 1 : xs   -- O(1), xs shared'),
        c2: D('Structural sharing', 'ys and zs both point into the same cells. Sharing is safe because nobody can change them.'),
      },
      steps: [
        { note: 'xs is two cells: 2 → 3 → end.', line: 0, vars: [['xs', 'list', 'write', 'c2']], heap: [['c2', '2 → ·', 'read'], ['c3', '3 → nil', 'read']], out: '' },
        { note: 'Prepending 1 allocates one cell pointing at xs. Nothing is copied or changed.', line: 1, vars: [['xs', 'list', 'default', 'c2'], ['ys', 'list', 'write', 'c1']], heap: [['c1', '1 → ·', 'write', 'new'], ['c2', '2 → ·', 'read', 'shared'], ['c3', '3 → nil', 'read', 'shared']], out: '' },
        { note: 'zs shares the same tail. Three lists now exist but only four cells.', line: 2, vars: [['xs', 'list', 'default', 'c2'], ['ys', 'list', 'default', 'c1'], ['zs', 'list', 'write', 'c9']], heap: [['c1', '1 → ·', 'read'], ['c9', '9 → ·', 'write', 'new'], ['c2', '2 → ·', 'accent', 'shared'], ['c3', '3 → nil', 'accent', 'shared']], out: '' },
        { note: 'xs still reads [2, 3]. No reader can see a change it did not make.', line: 3, vars: [['xs', '[2, 3]', 'ok', 'c2'], ['ys', '[1, 2, 3]', 'ok', 'c1'], ['zs', '[9, 2, 3]', 'ok', 'c9']], heap: [['c1', '1 → ·', 'read'], ['c9', '9 → ·', 'read'], ['c2', '2 → ·', 'accent'], ['c3', '3 → nil', 'accent']], out: '' },
      ],
    },
  ],
  edges: [
    'Effects at the edges',
    {
      codeTitle: 'main.js',
      code: ['const price = (items, rate) =>          // pure core', '  items.reduce((s, i) => s + i.cost, 0) * (1 + rate);', 'async function checkout(id) {           // impure shell', '  const items = await db.cart(id);', '  const total = price(items, 0.1);', '  await db.charge(id, total);', '}'],
      stackTitle: 'checkout(7)',
      details: {
        items: D('Impure shell', 'I/O stays in a thin outer layer: read, call pure code, write.'),
        total: D('Functional core', 'All decisions happen in pure functions, which are tested without mocks.', "expect(price([{ cost: 10 }], 0.1)).toBe(11);"),
      },
      steps: [
        { note: 'checkout reads the cart. This is an effect, so it lives in the shell.', line: [2, 3], vars: [['id', '7'], ['items', '[{cost:10}]', 'read']], out: '' },
        { note: 'price is pure: it only computes from its inputs.', line: [0, 1, 4], vars: [['id', '7'], ['items', '[{cost:10}]'], ['total', '11', 'ok']], out: '' },
        { note: 'The shell performs the write. Effects happen once, at a known place.', line: 5, vars: [['id', '7'], ['total', '11']], out: 'charged 7: 11' },
      ],
    },
  ],
});

// ---------------- higher-order functions & closures ----------------
traceDemo('fp-hof', 'Higher-order functions & closures', 'Functions as values: closures capture their environment, map/filter/reduce replace loops, currying and composition build pipelines.', {
  closure: [
    'Closures',
    {
      codeTitle: 'main.js',
      code: ['function counter() {', '  let n = 0;', '  return () => ++n;', '}', 'const next = counter();', 'next(); next();   // 1, 2'],
      details: {
        next: D('Closure', 'A function plus the environment it was created in. n outlives counter() because the returned arrow still references it.'),
        env: D('Captured environment', 'Heap-allocated so it survives the call that created it. Each counter() call gets its own.', 'const a = counter(), b = counter();\na(); a(); b(); // 1, 2, 1'),
      },
      steps: [
        { note: 'counter() creates a local n = 0.', line: [0, 1], vars: [['n', '0', 'write', 'env']], heap: [['env', '{ n: 0 }', 'write']], out: '' },
        { note: 'It returns an arrow that refers to n. The environment moves with it.', line: [2, 4], vars: [['next', 'fn', 'accent', 'env']], heap: [['env', '{ n: 0 }', 'read', 'captured']], out: '' },
        { note: 'counter has returned, but next still updates the same n.', line: 5, vars: [['next', 'fn', 'accent', 'env']], heap: [['env', '{ n: 1 }', 'write', 'captured']], out: '1' },
        { note: 'State lives in the closure, private to whoever holds next.', line: 5, vars: [['next', 'fn', 'accent', 'env']], heap: [['env', '{ n: 2 }', 'write', 'captured']], out: '1\n2' },
      ],
    },
  ],
  pipeline: [
    'map, filter, reduce',
    {
      codeTitle: 'main.js',
      code: ['const xs = [1, 2, 3, 4];', 'const r = xs', '  .filter(x => x % 2 === 0)', '  .map(x => x * x)', '  .reduce((a, x) => a + x, 0);'],
      stackTitle: 'values',
      details: {
        filter: D('filter', 'Keeps the elements a predicate accepts. Returns a new array.'),
        map: D('map', 'Applies a function to each element. Same length, new array.'),
        r: D('reduce (fold)', 'Combines all elements into one value with an accumulator. map and filter can both be written as folds.', 'xs.reduce((acc, x) => acc + x, 0)'),
      },
      steps: [
        { note: 'Start with a list. No loop counter and no mutation.', line: 0, vars: [['xs', '[1, 2, 3, 4]', 'write']], out: '' },
        { note: 'filter keeps the even numbers.', line: 2, vars: [['xs', '[1, 2, 3, 4]'], ['filter', '[2, 4]', 'accent']], out: '' },
        { note: 'map squares each one.', line: 3, vars: [['xs', '[1, 2, 3, 4]'], ['filter', '[2, 4]'], ['map', '[4, 16]', 'accent']], out: '' },
        { note: 'reduce folds the list into a sum: 0 + 4 + 16.', line: 4, vars: [['xs', '[1, 2, 3, 4]'], ['filter', '[2, 4]'], ['map', '[4, 16]'], ['r', '20', 'ok']], out: '20' },
      ],
    },
  ],
  compose: [
    'Currying & composition',
    {
      codeTitle: 'main.js',
      code: ['const add = a => b => a + b;          // curried', 'const inc = add(1);                   // partial', 'const dbl = x => x * 2;', 'const pipe = (...fs) => x => fs.reduce((v, f) => f(v), x);', 'const f = pipe(inc, dbl);', 'f(5);   // 12'],
      stackTitle: 'values',
      details: {
        inc: D('Partial application', 'Supplying some arguments now and the rest later yields a new, specialised function.'),
        f: D('Composition', 'Small functions snapped together into a pipeline. Point-free style names the steps, not the data.', '-- Haskell\nf = (* 2) . (+ 1)'),
      },
      steps: [
        { note: 'add takes one argument and returns a function for the next.', line: 0, vars: [['add', 'a => b => a + b', 'write']], out: '' },
        { note: 'add(1) fixes a = 1, giving inc.', line: 1, vars: [['add', 'fn'], ['inc', 'b => 1 + b', 'accent']], out: '' },
        { note: 'pipe(inc, dbl) builds a function that runs inc, then dbl.', line: [2, 3, 4], vars: [['inc', 'fn'], ['dbl', 'fn'], ['f', 'x => dbl(inc(x))', 'accent']], out: '' },
        { note: 'f(5): inc gives 6, dbl gives 12.', line: 5, vars: [['f', 'fn'], ['inc(5)', '6', 'read'], ['dbl(6)', '12', 'ok']], out: '12' },
      ],
    },
  ],
});

// ---------------- recursion & folds ----------------
traceDemo('fp-rec', 'Recursion, tail calls & folds', 'Recursion replaces loops; tail calls run in constant stack; foldl and foldr associate differently.', {
  stack: [
    'Recursion',
    {
      codeTitle: 'Sum.hs',
      code: ['sum [] = 0', 'sum (x:xs) = x + sum xs', '', 'sum [1, 2, 3]'],
      stackTitle: 'call stack',
      details: {
        'sum [3]': D('Pending work', 'Each frame waits for the inner call before it can add x, so the stack grows with the list.'),
      },
      steps: [
        { note: 'sum [1,2,3] must compute 1 + sum [2,3] first.', line: [1, 3], vars: [['sum [1,2,3]', '1 + ?', 'current']], out: '' },
        { note: 'Each call pushes a frame with a pending addition.', line: 1, vars: [['sum [1,2,3]', '1 + ?'], ['sum [2,3]', '2 + ?'], ['sum [3]', '3 + ?', 'current']], out: '' },
        { note: 'The base case returns 0.', line: 0, vars: [['sum [1,2,3]', '1 + ?'], ['sum [2,3]', '2 + ?'], ['sum [3]', '3 + ?'], ['sum []', '0', 'ok']], out: '' },
        { note: 'Frames unwind, adding on the way out. Depth equals list length, so huge lists overflow.', line: 1, vars: [['sum [1,2,3]', '6', 'ok']], out: '6' },
      ],
    },
  ],
  tail: [
    'Tail calls',
    {
      codeTitle: 'Sum.hs',
      code: ['go acc [] = acc', 'go acc (x:xs) = go (acc + x) xs   -- tail call', '', 'go 0 [1, 2, 3]'],
      stackTitle: 'call stack',
      details: {
        acc: D('Accumulator', 'The running result travels as an argument, so nothing is left to do after the recursive call.'),
        go: D('Tail-call optimisation', 'A call in tail position reuses the current frame: recursion compiles to a jump, like a loop.', '// Scala\n@tailrec def go(acc: Int, xs: List[Int]): Int'),
      },
      steps: [
        { note: 'The work is done before the recursive call, carried in acc.', line: [1, 3], vars: [['go', 'acc=0 [1,2,3]', 'current']], out: '' },
        { note: 'The frame is reused, not pushed.', line: 1, vars: [['go', 'acc=1 [2,3]', 'current']], out: '' },
        { note: 'Still one frame.', line: 1, vars: [['go', 'acc=3 [3]', 'current']], out: '' },
        { note: 'The base case returns acc directly. Constant stack for any list length.', line: 0, vars: [['go', 'acc=6 []', 'ok']], out: '6' },
      ],
    },
  ],
  folds: [
    'foldr vs foldl',
    {
      codeTitle: 'Fold.hs',
      code: ["foldr (-) 0 [1, 2, 3]   -- 1 - (2 - (3 - 0))", "foldl (-) 0 [1, 2, 3]   -- ((0 - 1) - 2) - 3"],
      stackTitle: 'expression',
      details: {
        foldr: D('foldr', 'Associates to the right. Works on infinite lists when the function is lazy in its second argument.', 'foldr (\\x acc -> x : acc) [] -- rebuilds the list'),
        foldl: D('foldl', "Associates to the left, like a loop with an accumulator. Use the strict foldl' in Haskell."),
      },
      steps: [
        { note: 'foldr nests to the right: the last element meets the seed first.', line: 0, vars: [['foldr', '1 - (2 - (3 - 0))', 'accent']], out: '' },
        { note: '3 - 0 = 3, then 2 - 3 = -1, then 1 - (-1) = 2.', line: 0, vars: [['foldr', '2', 'ok']], out: '2' },
        { note: 'foldl nests to the left: the seed meets the first element first.', line: 1, vars: [['foldr', '2'], ['foldl', '((0 - 1) - 2) - 3', 'accent']], out: '2' },
        { note: 'Same list and function, different answer: -6. Only associative operations agree.', line: 1, vars: [['foldr', '2'], ['foldl', '-6', 'warn']], out: '2\n-6' },
      ],
    },
  ],
});

// ---------------- laziness ----------------
traceDemo('fp-lazy', 'Lazy evaluation', 'Expressions become thunks evaluated on demand: infinite lists work, unused work is skipped, and unforced thunks can leak space.', {
  thunks: [
    'Thunks',
    {
      codeTitle: 'Lazy.hs',
      code: ['let x = expensive 42', '    y = 1 + 2', 'in if flag then y else x'],
      heapTitle: 'thunks',
      details: {
        tx: D('Thunk', 'A suspended computation: code plus captured variables. Forcing it runs once and overwrites it with the value.'),
      },
      steps: [
        { note: 'let binds names to thunks. Nothing has been computed yet.', line: [0, 1], vars: [['x', 'thunk', 'muted', 'tx'], ['y', 'thunk', 'muted', 'ty']], heap: [['tx', 'expensive 42', 'muted', 'unevaluated'], ['ty', '1 + 2', 'muted', 'unevaluated']], out: '' },
        { note: 'flag is True, so y is demanded and forced.', line: 2, vars: [['x', 'thunk', 'muted', 'tx'], ['y', 'forcing', 'current', 'ty']], heap: [['tx', 'expensive 42', 'muted'], ['ty', '1 + 2', 'current', 'evaluating']], out: '' },
        { note: 'y’s thunk is overwritten with 3, so later uses are free.', line: 2, vars: [['x', 'thunk', 'muted', 'tx'], ['y', '3', 'ok', 'ty']], heap: [['tx', 'expensive 42', 'muted'], ['ty', '3', 'ok', 'value']], out: '3' },
        { note: 'expensive 42 is never run. It is garbage once the expression finishes.', line: 2, vars: [['y', '3', 'ok', 'ty']], heap: [['tx', 'expensive 42', 'visited', 'never forced'], ['ty', '3', 'ok']], out: '3' },
      ],
    },
  ],
  infinite: [
    'Infinite lists',
    {
      codeTitle: 'Lazy.hs',
      code: ['nats = [1 ..]                -- infinite', 'take 3 (map (* 2) nats)'],
      heapTitle: 'list cells',
      details: {
        rest: D('Unevaluated tail', 'Only as much of the list is built as someone asks for.', 'fibs = 0 : 1 : zipWith (+) fibs (tail fibs)'),
      },
      steps: [
        { note: 'nats is one thunk standing for the whole infinite list.', line: 0, vars: [['nats', 'thunk', 'muted', 'rest']], heap: [['rest', '[1 ..]', 'muted', 'unevaluated']], out: '' },
        { note: 'take 3 demands the first cell. map produces 2.', line: 1, vars: [['nats', 'list', 'default', 'c1']], heap: [['c1', '1 → 2', 'write'], ['rest', '[2 ..]', 'muted']], out: '' },
        { note: 'Two more cells are produced on demand.', line: 1, vars: [['nats', 'list', 'default', 'c1']], heap: [['c1', '1 → 2', 'read'], ['c2', '2 → 4', 'write'], ['c3', '3 → 6', 'write'], ['rest', '[4 ..]', 'muted']], out: '' },
        { note: 'take has its three elements and stops. The rest is never built.', line: 1, vars: [['result', '[2, 4, 6]', 'ok']], heap: [['c1', '1 → 2', 'read'], ['c2', '2 → 4', 'read'], ['c3', '3 → 6', 'read'], ['rest', '[4 ..]', 'visited', 'never forced']], out: '[2,4,6]' },
      ],
    },
  ],
  leak: [
    'Space leaks',
    {
      codeTitle: 'Lazy.hs',
      code: ['foldl  (+) 0 [1 .. 1000000]   -- builds thunks', "foldl' (+) 0 [1 .. 1000000]   -- strict"],
      stackTitle: 'accumulator',
      heapTitle: 'heap',
      details: {
        chain: D('Thunk chain', 'Lazy foldl never adds until the end, so it stores a million pending additions.'),
        acc: D("foldl'", 'Forces the accumulator at each step, so it stays a plain number.', "import Data.List (foldl')"),
      },
      steps: [
        { note: 'Lazy foldl delays each addition, wrapping the last thunk.', line: 0, vars: [['acc', 'thunk', 'warn', 'chain']], heap: [['chain', '((0+1)+2)+3 …', 'warn', 'growing']], out: '' },
        { note: 'After a million steps the heap holds a million thunks.', line: 0, vars: [['acc', 'thunk', 'fail', 'chain']], heap: [['chain', '(((0+1)+2)+ … +1000000)', 'fail', '~1M thunks']], out: '' },
        { note: "foldl' forces the sum each step, so the accumulator stays one number.", line: 1, vars: [['acc', '500000500000', 'ok']], heap: [['chain', 'freed', 'visited']], out: '500000500000' },
      ],
    },
  ],
});

// ---------------- algebraic data types ----------------
traceDemo('fp-adt', 'Algebraic data types & pattern matching', 'Sum and product types model data exactly; pattern matching takes them apart; the compiler checks every case is handled.', {
  sum: [
    'Sum & product types',
    {
      codeTitle: 'Shape.hs',
      code: ['data Point = Point Double Double          -- product', 'data Shape = Circle Point Double           -- sum', '           | Rect Point Point', 's = Circle (Point 0 0) 2'],
      heapTitle: 'value',
      details: {
        v: D('Tagged value', 'A sum value stores which constructor built it plus that constructor’s fields.', '// TypeScript\ntype Shape =\n  | { kind: "circle"; r: number }\n  | { kind: "rect"; w: number; h: number };'),
        p: D('Product', 'All fields together: Point has an x AND a y.'),
      },
      steps: [
        { note: 'A product type holds several fields at once: x and y.', line: 0, vars: [['Point', 'Double × Double', 'accent']], out: '' },
        { note: 'A sum type is one of several alternatives: Circle or Rect.', line: [1, 2], vars: [['Point', 'Double × Double'], ['Shape', 'Circle | Rect', 'accent']], out: '' },
        { note: 's is tagged Circle and holds a Point and a radius.', line: 3, vars: [['s', 'Shape', 'write', 'v']], heap: [['v', 'tag=Circle r=2', 'write'], ['p', 'Point 0 0', 'read']], out: '' },
        { note: 'Illegal states, like a circle with a width, can’t even be written down.', line: 3, vars: [['s', 'Shape', 'ok', 'v']], heap: [['v', 'tag=Circle r=2', 'ok'], ['p', 'Point 0 0', 'read']], out: '' },
      ],
    },
  ],
  match: [
    'Pattern matching',
    {
      codeTitle: 'Shape.hs',
      code: ['area :: Shape -> Double', 'area (Circle _ r) = pi * r * r', 'area (Rect (Point x1 y1) (Point x2 y2)) =', '  abs (x2 - x1) * abs (y2 - y1)', '', 'area (Rect (Point 0 0) (Point 3 2))'],
      stackTitle: 'match',
      details: {
        Rect: D('Destructuring', 'A pattern checks the tag and binds the fields to names in one step.', "match shape:\n  case Circle(r=r): ...\n  case Rect(a, b): ...   # Python 3.10"),
      },
      steps: [
        { note: 'The argument is tagged Rect.', line: 5, vars: [['arg', 'Rect (0,0) (3,2)', 'current']], out: '' },
        { note: 'The Circle clause is tried first and does not match.', line: 1, vars: [['arg', 'Rect (0,0) (3,2)'], ['Circle _ r', 'no match', 'fail']], out: '' },
        { note: 'The Rect clause matches and binds x1, y1, x2 and y2.', line: 2, vars: [['arg', 'Rect (0,0) (3,2)'], ['Rect', 'x1=0 y1=0 x2=3 y2=2', 'ok']], out: '' },
        { note: 'The body computes 3 × 2.', line: 3, vars: [['Rect', 'x1=0 y1=0 x2=3 y2=2'], ['area', '6.0', 'ok']], out: '6.0' },
      ],
    },
  ],
  exhaustive: [
    'Exhaustiveness',
    {
      codeTitle: 'Shape.hs',
      code: ['data Shape = Circle Point Double | Rect Point Point', '           | Tri Point Point Point      -- new case', 'area (Circle _ r) = pi * r * r', 'area (Rect a b) = …', '-- no Tri clause'],
      stackTitle: 'compiler',
      details: {
        warning: D('Exhaustiveness check', 'The compiler knows every constructor, so it lists each place that forgot one.', '// Rust\nmatch s { Shape::Circle(..) => …, Shape::Rect(..) => … }\n// error[E0004]: pattern `Tri` not covered'),
      },
      steps: [
        { note: 'Someone adds a Tri constructor to Shape.', line: [0, 1], vars: [['Shape', 'Circle | Rect | Tri', 'write']], out: '' },
        { note: 'area still only handles Circle and Rect.', line: [2, 3, 4], vars: [['Shape', 'Circle | Rect | Tri'], ['area covers', 'Circle, Rect', 'warn']], out: '' },
        { note: 'The compiler reports the missing case before the program runs.', line: 4, vars: [['Shape', 'Circle | Rect | Tri'], ['warning', 'Tri not matched', 'fail']], out: "warning: Pattern match(es) are non-exhaustive\n  Patterns not matched: Tri _ _ _" },
      ],
    },
  ],
});

// ---------------- functors & monads ----------------
traceDemo('fp-monad', 'Functors & monads', 'map lifts a function into a context, flatMap chains steps that may fail, and do-notation reads like ordinary code.', {
  functor: [
    'Functor: map',
    {
      codeTitle: 'Maybe.hs',
      code: ['fmap (+ 1) (Just 2)   -- Just 3', 'fmap (+ 1) Nothing    -- Nothing', 'fmap (+ 1) [1, 2, 3]  -- [2, 3, 4]'],
      stackTitle: 'values',
      details: {
        Just: D('Functor', 'A context that supports map. The function sees the value inside; the context shape is preserved.', '[1, 2].map(x => x + 1)\nPromise.resolve(2).then(x => x + 1)'),
      },
      steps: [
        { note: 'fmap reaches into Just and applies (+ 1).', line: 0, vars: [['Just', '2 → 3', 'ok']], out: 'Just 3' },
        { note: 'Nothing has no value, so fmap does nothing. No null check is written.', line: 1, vars: [['Just', '3'], ['Nothing', 'Nothing', 'muted']], out: 'Just 3\nNothing' },
        { note: 'A list is a functor too: map every element.', line: 2, vars: [['Just', '3'], ['Nothing', 'Nothing'], ['list', '[2, 3, 4]', 'ok']], out: 'Just 3\nNothing\n[2,3,4]' },
      ],
    },
  ],
  bind: [
    'Monad: flatMap',
    {
      codeTitle: 'Order.hs',
      code: ['findUser  :: Id -> Maybe User', 'findOrder :: User -> Maybe Order', '', 'findUser 7 >>= findOrder >>= shipTo'],
      stackTitle: 'pipeline',
      details: {
        '>>=': D('bind (>>=)', 'Runs the next step with the value inside, or short-circuits on Nothing. It is flatMap: the step returns a Maybe and bind flattens it.', 'user?.order?.address   // JS\nuser.flatMap(u => u.order)   // Java Optional'),
      },
      steps: [
        { note: 'findUser 7 returns Just alice.', line: [0, 3], vars: [['findUser 7', 'Just alice', 'ok']], out: '' },
        { note: '>>= unwraps alice and passes her to findOrder, which finds nothing.', line: [1, 3], vars: [['findUser 7', 'Just alice'], ['findOrder', 'Nothing', 'warn']], out: '' },
        { note: 'Every later step is skipped. The result is Nothing, with no if-chain.', line: 3, vars: [['findUser 7', 'Just alice'], ['findOrder', 'Nothing'], ['shipTo', 'skipped', 'visited']], out: 'Nothing' },
      ],
    },
  ],
  doblock: [
    'do-notation & Either',
    {
      codeTitle: 'Parse.hs',
      code: ['parse :: String -> Either String Config', 'parse s = do', '  n    <- readInt s', '  port <- inRange 1 65535 n', '  pure (Config port)', '', 'parse "99999"'],
      stackTitle: 'do block',
      details: {
        Left: D('Either', 'Right holds a success; Left holds an error. Its bind stops at the first Left, like an exception that is a plain value.', "// Rust\nlet n: u32 = s.parse()?;\nlet port = in_range(1, 65535, n)?;"),
      },
      steps: [
        { note: 'do-notation is sugar for >>= and reads like sequential code.', line: [1, 6], vars: [['s', '"99999"']], out: '' },
        { note: 'readInt succeeds, so n is bound.', line: 2, vars: [['s', '"99999"'], ['n', 'Right 99999', 'ok']], out: '' },
        { note: 'inRange fails with a Left.', line: 3, vars: [['n', '99999'], ['port', 'Left "out of range"', 'fail']], out: '' },
        { note: 'The rest of the block is skipped and the Left becomes the result. Errors are values in the type.', line: 4, vars: [['n', '99999'], ['Left', '"out of range"', 'fail'], ['pure', 'skipped', 'visited']], out: 'Left "out of range"' },
      ],
    },
  ],
});
