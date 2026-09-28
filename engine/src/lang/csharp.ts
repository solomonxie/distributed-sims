// C# / .NET (group lang-csharp): CLR & IL, tiered JIT & AOT, GC generations, value vs reference & boxing, async, LINQ, assemblies & NuGet.
import type { Detail } from '../algo/frames';
import { boardDemo, N } from '../machine/lib/board';
import type { Board } from '../machine/lib/board';
import { machineDemo } from '../machine/lib/draw';
import { traceFrames } from '../machine/lib/trace';
import type { Trace } from '../machine/lib/trace';

const G = 'lang-csharp';
const D = (title: string, text: string, code?: string): Detail => ({ title, text, code });
const demo = (slug: string, title: string, summary: string, boards: Record<string, [string, Board]>) => boardDemo(G, slug, title, summary, boards);

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

// ---------------- CLR, JIT, AOT ----------------
const CLR_NODES = [
  N('src', 40, 40, 290, 110, 'Program.cs', undefined, { detail: D('Source', 'C# source compiled per project, not per file.', 'Console.WriteLine(Add(2, 3));\n\nstatic int Add(int a, int b) => a + b;') }),
  N('csc', 355, 40, 290, 110, 'Roslyn (csc)', 'C# compiler'),
  N('dll', 670, 40, 290, 110, 'app.dll', 'IL + metadata', { detail: D('Assembly', 'The unit of deployment and versioning: IL code, type metadata and a manifest of referenced assemblies.', '// ildasm / ILSpy view of Add:\nldarg.0\nldarg.1\nadd\nret') }),
  N('clr', 355, 230, 290, 110, 'CLR', 'dotnet app.dll', { detail: D('Common Language Runtime', 'Loads assemblies, verifies types, JIT-compiles methods, runs the GC, and handles exceptions and threads.') }),
  N('alc', 40, 420, 290, 110, 'AssemblyLoadContext', 'loads app.dll + deps', { detail: D('AssemblyLoadContext', '.NET’s replacement for AppDomains. A collectible context can load plugins and unload them again.', 'var ctx = new AssemblyLoadContext("plugin", isCollectible: true);\nvar asm = ctx.LoadFromAssemblyPath(path);\n// ...\nctx.Unload();') }),
  N('jit', 355, 420, 290, 110, 'JIT (RyuJIT)', 'per method, on first call'),
  N('native', 670, 420, 290, 110, 'native code', 'x64 / arm64'),
  N('t0', 40, 610, 290, 110, 'Tier 0', 'fast compile, no opts'),
  N('cnt', 355, 610, 290, 110, 'call counter', '30 calls'),
  N('t1', 670, 610, 290, 110, 'Tier 1', 'fully optimised', { detail: D('Tiered compilation', 'Methods start with a quick Tier-0 JIT, then hot ones are recompiled optimised in the background, using Dynamic PGO data from real runs.', '<!-- csproj -->\n<TieredPGO>true</TieredPGO>  <!-- default on .NET 8 -->\n<TieredCompilation>true</TieredCompilation>') }),
  N('r2r', 40, 800, 440, 120, 'ReadyToRun', 'precompiled + JIT fallback', { detail: D('ReadyToRun', 'Assemblies ship with pre-generated native code for faster startup. The JIT still exists and can re-tier hot methods.', 'dotnet publish -c Release -r linux-x64 \\\n  -p:PublishReadyToRun=true') }),
  N('aot', 520, 800, 440, 120, 'NativeAOT', 'no JIT at run time', { detail: D('NativeAOT', 'Compiles the whole app to one native executable: instant startup, small memory, but trimmed and limited reflection and no runtime code generation.', 'dotnet publish -c Release -r linux-x64 \\\n  -p:PublishAot=true') }),
];
const CLR_EDGES = ['src>csc', 'csc>dll', 'dll>clr', 'clr>alc', 'clr>jit', 'jit>native', 't0>cnt', 'cnt>t1'];
const clr = (beats: Board['beats']): Board => ({ panel: 'Runtime', nodes: CLR_NODES, edges: CLR_EDGES, beats });
const TIERS = ['t0', 'cnt', 't1'];
const AOT = ['r2r', 'aot'];

demo('cs-clr', 'CLR, IL & the JIT', 'C# compiles to IL in assemblies; the CLR loads them and JIT-compiles methods in tiers; ReadyToRun and NativeAOT precompile.', {
  pipeline: [
    'Source to native',
    clr([
      { note: 'Roslyn compiles C# to IL, a CPU-neutral bytecode, not to machine code.', hot: { src: 'current', csc: 'current', dll: 'write', 'src>csc': 'accent', 'csc>dll': 'accent' }, hide: ['clr', 'alc', 'jit', 'native', ...TIERS, ...AOT], rows: [['output', 'IL']] },
      { note: 'The assembly bundles IL with metadata describing every type, so the runtime and reflection know them all.', hot: { dll: 'current' }, hide: ['alc', 'jit', 'native', ...TIERS, ...AOT], rows: [['self-describing', 'yes']] },
      { note: 'dotnet app.dll starts the CLR, which loads the assembly and its dependencies into an AssemblyLoadContext.', hot: { clr: 'current', alc: 'write', 'dll>clr': 'accent', 'clr>alc': 'accent' }, hide: ['jit', 'native', ...TIERS, ...AOT], rows: [['loaded', 'app + deps']] },
      { note: 'The first call to a method jumps to a stub that JIT-compiles it and patches itself. Later calls go straight to native code.', hot: { jit: 'current', native: 'ok', 'clr>jit': 'accent', 'jit>native': 'accent' }, hide: [...TIERS, ...AOT], rows: [['compiled', 'per method, lazily']] },
    ]),
  ],
  tiered: [
    'Tiered JIT & PGO',
    clr([
      { note: 'Tier 0 compiles quickly with few optimisations, so startup is fast.', hot: { t0: 'current', jit: 'write' }, hide: AOT, rows: [['tier', 0]] },
      { note: 'Each call bumps a counter. After 30 calls the method is queued for recompiling.', hot: { cnt: 'warn', 't0>cnt': 'accent' }, sub: { cnt: '30 / 30' }, hide: AOT, rows: [['calls', 30]] },
      { note: 'Tier 1 recompiles it fully optimised on a background thread, using profile data gathered at Tier 0.', hot: { t1: 'ok', 'cnt>t1': 'accent' }, hide: AOT, rows: [['tier', 1, 'ok']] },
      { note: 'Long-running loops can jump to optimised code mid-execution, called on-stack replacement. Warm-up is why early benchmark runs are slow.', hot: { t1: 'current', native: 'ok' }, hide: AOT, rows: [['benchmark', 'BenchmarkDotNet warms up']] },
    ]),
  ],
  aot: [
    'ReadyToRun & NativeAOT',
    clr([
      { note: 'JIT costs startup time and memory. Two ways to compile ahead of time exist.', hot: { jit: 'warn' }, hide: TIERS, rows: [['startup', 'JIT work', 'warn']] },
      { note: 'ReadyToRun ships precompiled code inside the assembly and keeps the JIT for re-tiering hot paths.', hot: { r2r: 'ok' }, hide: TIERS, rows: [['startup', 'faster']] },
      { note: 'NativeAOT builds one self-contained executable with no JIT at all. Great for CLIs, functions and containers.', hot: { aot: 'ok', jit: 'visited' }, hide: TIERS, rows: [['startup', '~10 ms', 'ok']] },
      { note: 'The cost: code is trimmed and runtime code generation is gone, so heavy reflection and some serializers need source generators.', hot: { aot: 'warn' }, hide: TIERS, rows: [['reflection', 'limited', 'warn']] },
    ]),
  ],
});

// ---------------- GC ----------------
const GC_NODES = [
  N('alloc', 40, 40, 920, 110, 'allocation', 'bump pointer in gen 0', { detail: D('Allocation', 'new just advances a pointer in the thread’s allocation context, which is about as fast as stack allocation.', 'var p = new Person(); // ~20 ns\n// GC.GetAllocatedBytesForCurrentThread()') }),
  N('g0', 40, 240, 290, 130, 'Gen 0', 'new objects'),
  N('g1', 355, 240, 290, 130, 'Gen 1', 'survived 1 GC'),
  N('g2', 670, 240, 290, 130, 'Gen 2', 'long-lived', { detail: D('Generations', 'Most objects die young, so collecting gen 0 often and gen 2 rarely is cheap. Survivors are promoted and compacted.', 'GC.CollectionCount(0); // many\nGC.CollectionCount(2); // few\nGC.GetGeneration(obj);') }),
  N('loh', 670, 450, 290, 130, 'LOH', '≥ 85,000 bytes', { detail: D('Large Object Heap', 'Big arrays go straight to the LOH, collected with gen 2 and not compacted by default. Churning big buffers fragments it; rent them instead.', 'var buf = ArrayPool<byte>.Shared.Rent(1 << 20);\ntry { Use(buf); }\nfinally { ArrayPool<byte>.Shared.Return(buf); }') }),
  N('poh', 355, 450, 290, 130, 'POH', 'pinned objects'),
  N('mode', 40, 660, 920, 120, 'GC mode', 'workstation', { detail: D('Workstation vs server GC', 'Server GC uses a heap and a GC thread per core for throughput; workstation GC suits desktop and small containers.', '<!-- csproj -->\n<ServerGarbageCollector>true</ServerGarbageCollector>\n<ConcurrentGarbageCollection>true</ConcurrentGarbageCollection>') }),
  N('bg', 40, 840, 920, 120, 'background GC', 'gen 2 marks concurrently'),
];
const gc = (beats: Board['beats']): Board => ({ panel: 'GC', nodes: GC_NODES, edges: ['alloc>g0', 'g0>g1', 'g1>g2'], beats });

demo('cs-gc', '.NET garbage collector', 'Generational GC: gen 0/1/2 promotion, the Large Object Heap, workstation vs server and background GC.', {
  generations: [
    'Generations',
    gc([
      { note: 'Every new object lands in gen 0 by bumping a pointer.', hot: { alloc: 'current', g0: 'write', 'alloc>g0': 'accent' }, sub: { g0: '1,000 objects' }, hide: ['loh', 'poh', 'mode', 'bg'], rows: [['gen 0', '1,000']] },
      { note: 'Gen 0 fills and a quick collection runs. Most objects are already garbage.', hot: { g0: 'warn' }, sub: { g0: '950 dead · 50 live' }, hide: ['loh', 'poh', 'mode', 'bg'], rows: [['dead', '95%']] },
      { note: 'Survivors are compacted and promoted to gen 1, leaving gen 0 empty.', hot: { g1: 'write', 'g0>g1': 'accent' }, sub: { g0: 'empty', g1: '50 objects' }, hide: ['loh', 'poh', 'mode', 'bg'], rows: [['promoted', 50]] },
      { note: 'Objects that keep surviving reach gen 2, which is collected rarely. Caches and singletons live there.', hot: { g2: 'current', 'g1>g2': 'accent' }, sub: { g0: 'empty', g1: '10 objects', g2: '5,000 objects' }, hide: ['loh', 'poh', 'mode', 'bg'], rows: [['gen 2 GCs', 'rare']] },
      { note: 'Avoid mid-life objects: things that live just long enough to reach gen 2 and then die make expensive full GCs.', hot: { g2: 'warn' }, hide: ['loh', 'poh', 'mode', 'bg'], rows: [['anti-pattern', 'mid-life crisis', 'warn']] },
    ]),
  ],
  loh: [
    'Large objects & pinning',
    gc([
      { note: 'An array of 85,000 bytes or more skips gen 0 and goes to the Large Object Heap.', hot: { loh: 'write' }, sub: { loh: 'new byte[1_000_000]' }, hide: ['mode', 'bg'], rows: [['threshold', '85,000 B']] },
      { note: 'The LOH is collected only with gen 2 and not compacted by default, so churning big buffers fragments it.', hot: { loh: 'warn' }, sub: { loh: 'fragmented' }, hide: ['mode', 'bg'], rows: [['compacted', 'no', 'warn']] },
      { note: 'Rent large buffers from ArrayPool instead of allocating them each time.', hot: { loh: 'ok' }, sub: { loh: 'ArrayPool buffers reused' }, hide: ['mode', 'bg'], rows: [['allocs', 'amortised', 'ok']] },
      { note: 'Buffers pinned for native I/O can’t move, so .NET 5 added a separate Pinned Object Heap for them.', hot: { poh: 'current' }, sub: { poh: 'GC.AllocateArray(pinned: true)' }, hide: ['mode', 'bg'], rows: [['POH', '.NET 5+']] },
    ]),
  ],
  modes: [
    'Workstation, server, background',
    gc([
      { note: 'Workstation GC uses one heap and runs collections on the thread that triggered them. Good for apps and small containers.', hot: { mode: 'current' }, rows: [['heaps', 1]] },
      { note: 'Server GC gives each core its own heap and GC thread: more throughput, more memory.', hot: { mode: 'write' }, sub: { mode: 'server: heap per core' }, rows: [['heaps', 'per core']] },
      { note: 'Background GC marks gen 2 concurrently while gen 0 and gen 1 collections keep running, so pauses stay short.', hot: { bg: 'ok', g2: 'current' }, sub: { mode: 'server: heap per core' }, rows: [['gen 2 pause', 'short', 'ok']] },
      { note: 'Measure before tuning: dotnet-counters shows GC counts, heap sizes and time in GC.', hot: { bg: 'current' }, sub: { bg: 'dotnet-counters monitor -p <pid>' }, rows: [['tool', 'dotnet-counters']] },
    ]),
  ],
});

// ---------------- value vs reference, boxing ----------------
traceDemo('cs-types', 'Value types, reference types & boxing', 'struct copies vs class references, and how boxing allocates when a value type becomes object.', {
  value: [
    'struct (value)',
    {
      codeTitle: 'Program.cs',
      code: ['struct Point { public int X, Y; }', 'var a = new Point { X = 1, Y = 2 };', 'var b = a;          // copies both fields', 'b.X = 9;', 'Console.WriteLine(a.X);   // 1'],
      details: { a: D('Value type', 'A struct is stored inline: on the stack, or inside the object or array holding it. Assignment copies the fields.', 'readonly record struct Point(int X, int Y);\n// keep structs small and immutable') },
      steps: [
        { note: 'a is a struct, stored inline in the stack frame.', line: 1, vars: [['a', '{X=1, Y=2}', 'write']], out: '' },
        { note: 'b = a copies the whole value: two independent Points.', line: 2, vars: [['a', '{X=1, Y=2}'], ['b', '{X=1, Y=2}', 'write']], out: '' },
        { note: 'Changing b leaves a untouched.', line: 3, vars: [['a', '{X=1, Y=2}'], ['b', '{X=9, Y=2}', 'write']], out: '' },
        { note: 'No heap allocation and no GC work, the reason small structs are fast.', line: 4, vars: [['a', '{X=1, Y=2}'], ['b', '{X=9, Y=2}']], out: '1' },
      ],
    },
  ],
  reference: [
    'class (reference)',
    {
      codeTitle: 'Program.cs',
      code: ['class Point { public int X, Y; }', 'var a = new Point { X = 1, Y = 2 };', 'var b = a;          // copies the reference', 'b.X = 9;', 'Console.WriteLine(a.X);   // 9'],
      details: { p: D('Reference type', 'A class instance lives on the managed heap with a header and a method-table pointer. Variables hold references to it.') },
      steps: [
        { note: 'new allocates the object on the heap, and a holds a reference to it.', line: 1, vars: [['a', 'ref', 'accent', 'p']], heap: [['p', 'Point {X=1, Y=2}', 'write', 'header + method table + fields']], out: '' },
        { note: 'b = a copies the reference, not the object.', line: 2, vars: [['a', 'ref', 'accent', 'p'], ['b', 'ref', 'accent', 'p']], heap: [['p', 'Point {X=1, Y=2}', 'read']], out: '' },
        { note: 'Writing through b changes the one shared object.', line: 3, vars: [['a', 'ref', 'accent', 'p'], ['b', 'ref', 'accent', 'p']], heap: [['p', 'Point {X=9, Y=2}', 'write']], out: '' },
        { note: 'So a.X prints 9. When no reference remains, the GC reclaims it.', line: 4, vars: [['a', 'ref', 'accent', 'p'], ['b', 'ref', 'accent', 'p']], heap: [['p', 'Point {X=9, Y=2}', 'read']], out: '9' },
      ],
    },
  ],
  boxing: [
    'Boxing',
    {
      codeTitle: 'Program.cs',
      code: ['int n = 42;', 'object o = n;        // box: heap copy', 'n = 7;', 'Console.WriteLine(o); // 42', 'var list = new ArrayList { 1, 2 }; // boxes each', 'var ok = new List<int> { 1, 2 };   // no boxing'],
      details: { box: D('Boxing', 'Converting a value type to object or an interface allocates a heap copy. Unboxing copies it back out.', 'object o = 42;      // box\nint n = (int)o;     // unbox\nIComparable c = 5;  // box too') },
      steps: [
        { note: 'n is a plain int on the stack.', line: 0, vars: [['n', '42', 'write']], out: '' },
        { note: 'Assigning it to object boxes it: a new heap object holding a copy of 42.', line: 1, vars: [['n', '42'], ['o', 'ref', 'accent', 'box']], heap: [['box', 'boxed int 42', 'write', '24 B on x64']], out: '' },
        { note: 'The box is a copy, so changing n doesn’t affect it.', line: [2, 3], vars: [['n', '7', 'write'], ['o', 'ref', 'accent', 'box']], heap: [['box', 'boxed int 42', 'read']], out: '42' },
        { note: 'Non-generic collections box every element, while List<int> stores ints inline. Boxing in hot loops shows up as GC pressure.', line: [4, 5], vars: [['n', '7'], ['o', 'ref', 'accent', 'box']], heap: [['box', 'boxed int 42', 'read'], ['b1', 'boxed 1', 'warn'], ['b2', 'boxed 2', 'warn']], out: '42' },
      ],
    },
  ],
});

// ---------------- async & LINQ ----------------
demo('cs-async', 'async/await & LINQ', 'async methods compile to state machines; SynchronizationContext deadlocks; LINQ runs lazily and re-runs per enumeration.', {
  statemachine: [
    'State machine',
    {
      panel: 'async',
      codeTitle: 'Program.cs',
      code: ['async Task<string> LoadAsync(HttpClient http) {', '  var html = await http.GetStringAsync(url);', '  return html.Trim();', '}'],
      nodes: [
        N('call', 355, 230, 290, 110, 'LoadAsync()'),
        N('sm', 40, 420, 440, 110, 'state machine', 'state = -1', { detail: D('Compiler-generated state machine', 'The method body is split at each await into a MoveNext() method. Locals become fields so they survive across awaits.', '// roughly what the compiler emits:\nstruct LoadAsyncSM : IAsyncStateMachine {\n  public int state;\n  public AsyncTaskMethodBuilder<string> b;\n  TaskAwaiter<string> awaiter;\n  public void MoveNext() { /* switch(state) */ }\n}') }),
        N('task', 520, 420, 440, 110, 'Task<string>', 'incomplete'),
        N('io', 40, 610, 440, 110, 'I/O completes', 'socket readable'),
        N('cont', 520, 610, 440, 110, 'continuation', 'MoveNext()'),
        N('tp', 40, 800, 920, 120, 'thread pool', 'no thread waits during I/O', { detail: D('No thread is blocked', 'While the request is in flight, no thread sits waiting. The OS completion wakes a pool thread to run the continuation.') }),
      ],
      edges: ['call>sm', 'call>task', 'io>cont'],
      beats: [
        { note: 'The compiler rewrites LoadAsync into a state machine struct.', hl: [0], hot: { call: 'current', sm: 'write', 'call>sm': 'accent' }, hide: ['task', 'io', 'cont', 'tp'], rows: [['state', -1]] },
        { note: 'It runs synchronously until the first await on an unfinished task, then returns an incomplete Task.', hl: [1], hot: { task: 'current', 'call>task': 'accent' }, sub: { sm: 'state = 0' }, hide: ['io', 'cont', 'tp'], rows: [['state', 0]] },
        { note: 'The calling thread is free again, and nothing waits on the request.', hot: { tp: 'ok' }, sub: { sm: 'state = 0' }, hide: ['io', 'cont'], rows: [['threads waiting', 0, 'ok']] },
        { note: 'When the response arrives, a pool thread calls MoveNext, which resumes after the await.', hl: [2], hot: { io: 'current', cont: 'write', 'io>cont': 'accent' }, sub: { sm: 'state = -2 (done)', task: 'completed' }, rows: [['resumed', 'yes']] },
      ],
    },
  ],
  context: [
    'Sync-over-async deadlock',
    {
      panel: 'async',
      codeTitle: 'Form1.cs',
      code: ['// UI thread (WinForms/WPF) or old ASP.NET', 'var s = LoadAsync(http).Result;   // blocks UI thread', '// continuation needs the UI thread: deadlock', 'await LoadAsync(http).ConfigureAwait(false); // libs'],
      nodes: [
        N('ui', 40, 260, 440, 120, 'UI thread', 'running click handler', { detail: D('SynchronizationContext', 'UI frameworks capture it at each await so the continuation runs back on the UI thread.') }),
        N('task', 520, 260, 440, 120, 'LoadAsync Task', 'waiting for I/O'),
        N('cont', 520, 460, 440, 120, 'continuation', 'queued for UI thread'),
        N('dl', 40, 660, 920, 120, 'deadlock', '—'),
        N('fix', 40, 840, 920, 120, 'fix', 'async all the way', { detail: D('Avoiding the deadlock', 'Await instead of blocking with .Result or .Wait(). In library code, ConfigureAwait(false) skips capturing the context.', 'private async void OnClick(object s, EventArgs e) {\n  label.Text = await LoadAsync(http);\n}') }),
      ],
      edges: ['ui>task', 'task>cont', 'cont>ui'],
      beats: [
        { note: '.Result blocks the UI thread until the task finishes.', hl: [1], hot: { ui: 'warn', 'ui>task': 'accent' }, sub: { ui: 'blocked on .Result' }, hide: ['cont', 'dl', 'fix'], rows: [['UI thread', 'blocked', 'warn']] },
        { note: 'The awaited I/O completes, and the continuation is queued to the UI thread’s context.', hl: [2], hot: { cont: 'write', 'task>cont': 'accent' }, sub: { ui: 'blocked on .Result', task: 'I/O done' }, hide: ['dl', 'fix'], rows: [['continuation', 'queued']] },
        { note: 'The UI thread waits for the task, and the task waits for the UI thread. Neither ever moves.', hot: { dl: 'fail', 'cont>ui': 'fail', ui: 'fail' }, sub: { ui: 'blocked on .Result', dl: 'both wait forever' }, hide: ['fix'], rows: [['state', 'deadlock', 'fail']] },
        { note: 'Await instead of blocking, and use ConfigureAwait(false) in libraries that don’t need the context.', hl: [3], hot: { fix: 'ok', ui: 'ok' }, sub: { ui: 'free', dl: '—' }, rows: [['rule', 'async all the way', 'ok']] },
      ],
    },
  ],
  linq: [
    'LINQ deferred execution',
    {
      panel: 'LINQ',
      codeTitle: 'Program.cs',
      code: ['var q = orders.Where(o => o.Total > 100)', '              .Select(o => o.Id);   // nothing runs yet', 'foreach (var id in q) Use(id);      // runs now', 'var n = q.Count();                  // runs again!', 'var ids = q.ToList();               // run once, keep'],
      nodes: [
        N('q', 355, 270, 290, 110, 'q', 'query, not data', { detail: D('Deferred execution', 'Where and Select return an IEnumerable that describes the work. It runs each time something enumerates it.') }),
        N('src', 40, 460, 290, 110, 'orders'),
        N('where', 355, 460, 290, 110, 'Where'),
        N('sel', 670, 460, 290, 110, 'Select'),
        N('runs', 40, 660, 920, 120, 'enumerations', '0'),
        N('list', 40, 840, 920, 120, 'ToList()', 'materialise once', { detail: D('Materialise', 'ToList, ToArray or ToDictionary run the query once and keep the results. EF Core queries hit the database on each enumeration otherwise.', 'var big = await db.Orders\n  .Where(o => o.Total > 100)\n  .ToListAsync(); // one SQL query') }),
      ],
      edges: ['src>where', 'where>sel', 'q>where'],
      beats: [
        { note: 'Building q runs nothing. It is a chain of iterators waiting to be pulled.', hl: [0, 1], hot: { q: 'current' }, rows: [['orders scanned', 0]] },
        { note: 'foreach pulls items through Where and Select one at a time.', hl: [2], hot: { src: 'write', where: 'write', sel: 'write', 'src>where': 'accent', 'where>sel': 'accent' }, sub: { runs: '1' }, rows: [['orders scanned', '1×']] },
        { note: 'Count() enumerates again and repeats all the work. Against a database, that is a second query.', hl: [3], hot: { runs: 'warn', where: 'warn' }, sub: { runs: '2' }, rows: [['orders scanned', '2×', 'warn']] },
        { note: 'Materialise once with ToList when you will use the results more than once.', hl: [4], hot: { list: 'ok' }, sub: { runs: '3, then none' }, rows: [['after ToList', 'cached', 'ok']] },
      ],
    },
  ],
});

// ---------------- namespaces, assemblies, NuGet ----------------
demo('cs-packages', 'Namespaces, assemblies & NuGet', 'using and namespaces vs assemblies and projects, PackageReference restore, transitive version resolution and lock files.', {
  assemblies: [
    'Namespaces & assemblies',
    {
      panel: 'Projects',
      nodes: [
        N('proj', 40, 40, 440, 110, 'Shop.Api.csproj', 'project', { detail: D('Project file', 'One project builds one assembly.', '<Project Sdk="Microsoft.NET.Sdk.Web">\n  <PropertyGroup>\n    <TargetFramework>net8.0</TargetFramework>\n  </PropertyGroup>\n  <ItemGroup>\n    <ProjectReference Include="../Shop.Core/Shop.Core.csproj" />\n  </ItemGroup>\n</Project>') }),
        N('dll', 520, 40, 440, 110, 'Shop.Api.dll', 'assembly'),
        N('ref', 40, 230, 440, 110, 'ProjectReference', 'Shop.Core.csproj'),
        N('core', 520, 230, 440, 110, 'Shop.Core.dll', 'namespace Shop.Orders'),
        N('using', 40, 430, 920, 120, 'using Shop.Orders;', 'imports a namespace, not a file', { detail: D('using', 'Lets you write Order instead of Shop.Orders.Order. Namespaces are logical and can span several assemblies.', 'global using Shop.Orders; // whole project\nusing static System.Math;  // Sqrt(2)\nusing Json = System.Text.Json.JsonSerializer;') }),
        N('int', 40, 630, 920, 120, 'internal', 'visible inside its assembly only', { detail: D('internal', 'The assembly is the privacy boundary. InternalsVisibleTo opens it for a test project.', '[assembly: InternalsVisibleTo("Shop.Core.Tests")]') }),
      ],
      edges: ['proj>dll', 'proj>ref', 'ref>core'],
      beats: [
        { note: 'A project compiles to one assembly, the physical unit you deploy and version.', hot: { proj: 'current', dll: 'write', 'proj>dll': 'accent' }, hide: ['ref', 'core', 'using', 'int'], rows: [['assemblies', 1]] },
        { note: 'ProjectReference adds another project’s assembly as a dependency.', hot: { ref: 'current', core: 'write', 'proj>ref': 'accent', 'ref>core': 'accent' }, hide: ['using', 'int'], rows: [['assemblies', 2]] },
        { note: 'using imports a namespace, a naming scope that isn’t tied to files or assemblies.', hot: { using: 'current' }, hide: ['int'], rows: [['namespace', 'logical']] },
        { note: 'Access control follows assemblies: internal types are invisible to other projects.', hot: { int: 'current' }, rows: [['boundary', 'assembly']] },
      ],
    },
  ],
  nuget: [
    'NuGet restore',
    {
      panel: 'NuGet',
      nodes: [
        N('pr', 40, 40, 920, 110, 'PackageReference', 'Serilog 3.1.1', { detail: D('PackageReference', 'Declares a NuGet dependency in the csproj.', 'dotnet add package Serilog --version 3.1.1\n\n<PackageReference Include="Serilog" Version="3.1.1" />') }),
        N('rst', 355, 230, 290, 110, 'dotnet restore'),
        N('feed', 670, 230, 290, 110, 'nuget.org', 'or a private feed'),
        N('cache', 40, 420, 440, 110, '~/.nuget/packages', 'global cache'),
        N('assets', 520, 420, 440, 110, 'project.assets.json', 'resolved graph'),
        N('build', 355, 610, 290, 110, 'dotnet build'),
        N('cfg', 40, 800, 920, 120, 'nuget.config', 'feeds & credentials', { detail: D('nuget.config', 'Lists package sources. Source mapping pins which feed each package may come from.', '<packageSources>\n  <add key="nuget" value="https://api.nuget.org/v3/index.json" />\n  <add key="corp" value="https://pkgs.corp/nuget" />\n</packageSources>') }),
      ],
      edges: ['pr>rst', 'rst>feed', 'rst>cache', 'rst>assets', 'assets>build'],
      beats: [
        { note: 'The csproj declares packages with PackageReference.', hot: { pr: 'current' }, hide: ['rst', 'feed', 'cache', 'assets', 'build', 'cfg'], rows: [['packages', 1]] },
        { note: 'dotnet restore resolves the full graph and downloads missing packages from the configured feeds.', hot: { rst: 'current', feed: 'write', 'pr>rst': 'accent', 'rst>feed': 'accent' }, hide: ['cache', 'assets', 'build'], rows: [['downloads', 'missing only']] },
        { note: 'Packages are unpacked once into the global cache and shared by all projects.', hot: { cache: 'ok', 'rst>cache': 'accent' }, hide: ['assets', 'build'], rows: [['cache', '~/.nuget/packages']] },
        { note: 'The resolved graph goes to obj/project.assets.json, which the build reads to find assemblies.', hot: { assets: 'current', build: 'ok', 'rst>assets': 'accent', 'assets>build': 'accent' }, rows: [['build', 'uses assets file']] },
      ],
    },
  ],
  transitive: [
    'Transitive versions',
    {
      panel: 'Resolution',
      nodes: [
        N('app', 355, 40, 290, 110, 'App'),
        N('a', 40, 230, 290, 110, 'LibA', 'Newtonsoft ≥ 12.0.1'),
        N('b', 670, 230, 290, 110, 'LibB', 'Newtonsoft ≥ 13.0.1'),
        N('pick', 355, 420, 290, 110, 'Newtonsoft.Json', '?'),
        N('warn', 40, 610, 920, 120, 'NU1605', 'detected package downgrade', { detail: D('Downgrade warning', 'A direct reference lower than what a dependency needs wins (nearest wins) but triggers NU1605, usually treated as an error.') }),
        N('lock', 40, 800, 920, 120, 'packages.lock.json', 'RestorePackagesWithLockFile', { detail: D('Lock file & central versions', 'Lock the full graph for repeatable restores, and keep versions in one Directory.Packages.props.', '<RestorePackagesWithLockFile>true</RestorePackagesWithLockFile>\n\n<!-- Directory.Packages.props -->\n<PackageVersion Include="Newtonsoft.Json" Version="13.0.3" />\n\n$ dotnet list package --include-transitive') }),
      ],
      edges: ['app>a', 'app>b', 'a>pick', 'b>pick'],
      beats: [
        { note: 'LibA needs Newtonsoft.Json 12.0.1 or later, LibB needs 13.0.1 or later.', hot: { a: 'write', b: 'write' }, hide: ['warn', 'lock'], rows: [['requirements', 2]] },
        { note: 'NuGet picks the lowest version that satisfies everyone: 13.0.1, one copy for the whole app.', hot: { pick: 'ok', 'a>pick': 'accent', 'b>pick': 'accent' }, sub: { pick: '13.0.1' }, hide: ['warn', 'lock'], rows: [['chosen', '13.0.1', 'ok']] },
        { note: 'If App references 12.0.1 directly, the nearest reference wins and LibB gets an older version, flagged as NU1605.', hot: { warn: 'fail', pick: 'warn' }, sub: { pick: '12.0.1 (downgrade)' }, hide: ['lock'], rows: [['warning', 'NU1605', 'fail']] },
        { note: 'A lock file and central package versions keep every project and every CI run on the same graph.', hot: { lock: 'ok' }, sub: { pick: '13.0.3 (central)' }, rows: [['repeatable', 'yes', 'ok']] },
      ],
    },
  ],
});
