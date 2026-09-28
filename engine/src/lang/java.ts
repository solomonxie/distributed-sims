// Java (group lang-java): JVM architecture & bytecode, class loading & modules, JIT tiers, GC, memory model & threads, Maven/Gradle dependencies.
import type { Detail } from '../algo/frames';
import { boardDemo, N } from '../machine/lib/board';
import { codeMapFrames } from '../machine/lib/code';
import type { CodeMap } from '../machine/lib/code';
import { machineDemo } from '../machine/lib/draw';

const G = 'lang-java';
const D = (title: string, text: string, code?: string): Detail => ({ title, text, code });

// ---------------- JVM architecture ----------------
const JVM_DETAILS: Record<string, Detail> = {
  'Main.class': D('Class file', 'javac output: bytecode for a stack machine plus a constant pool of names and types. The same file runs on any OS.', '$ javac Main.java\n$ javap -c Main\n  public static void main(java.lang.String[]);\n    Code:\n       0: getstatic  #7  // System.out\n       3: ldc        #13 // "hi"\n       5: invokevirtual #15 // println'),
  'class loaders': D('Class loader subsystem', 'Finds .class bytes, verifies them and creates Class objects on first use.', 'Class<?> c = Class.forName("com.acme.App");\nSystem.out.println(c.getClassLoader());'),
  metaspace: D('Metaspace', 'Native memory for class metadata: methods, fields, constant pools. Leaking class loaders (hot redeploys) fills it.', '$ jcmd <pid> VM.metaspace'),
  heap: D('Heap', 'Every object and array, shared by all threads and managed by the garbage collector.', '$ java -Xms512m -Xmx2g -jar app.jar\n$ jcmd <pid> GC.heap_info'),
  'thread 1 stack': D('Thread stack', 'One frame per method call: local variables array, operand stack, and a link to the constant pool.', 'void f() {\n    int x = 1;        // in f\'s frame\n    Object o = new Object(); // ref in frame, object on heap\n}'),
  'thread 2 stack': D('Thread stack', 'Each thread has its own; a deep recursion overflows it (StackOverflowError). Size with -Xss.'),
  'PC registers': D('Program counter', 'Per thread: the bytecode index currently executing.'),
  'garbage collector': D('Garbage collector', 'Reclaims unreachable heap objects. Pick one with -XX:+UseG1GC, -XX:+UseZGC.', '$ java -Xlog:gc -jar app.jar'),
  'JNI / native': D('Native interface', 'Calls into C libraries via JNI or the newer Foreign Function & Memory API.'),
  interpreter: D('Interpreter', 'Executes bytecode one instruction at a time while counting how often each method runs.'),
  'JIT compiler': D('JIT compiler', 'Compiles hot methods to machine code: C1 quickly, C2 with heavy optimisation.', '$ java -XX:+PrintCompilation -jar app.jar'),
  'code cache': D('Code cache', 'Where compiled native code lives. If it fills up, compilation stops and performance drops.', '$ java -XX:ReservedCodeCacheSize=256m …'),
};
const JVM_NODES = [
  N('cls', 40, 40, 290, 110, 'Main.class', 'bytecode'),
  N('cl', 355, 40, 290, 110, 'class loaders'),
  N('meta', 670, 40, 290, 110, 'metaspace', 'class metadata'),
  N('st1', 40, 230, 290, 130, 'thread 1 stack', 'frames'),
  N('st2', 355, 230, 290, 130, 'thread 2 stack', 'frames'),
  N('heap', 670, 230, 290, 130, 'heap', 'all objects'),
  N('pc', 40, 430, 290, 100, 'PC registers', 'per thread'),
  N('native', 355, 430, 290, 100, 'JNI / native'),
  N('gc', 670, 430, 290, 100, 'garbage collector'),
  N('interp', 40, 620, 290, 110, 'interpreter'),
  N('jit', 355, 620, 290, 110, 'JIT compiler', 'C1, C2'),
  N('cc', 670, 620, 290, 110, 'code cache', 'native code'),
];
const JVM_EDGES = ['cls>cl', 'cl>meta', 'gc>heap', 'interp>jit', 'jit>cc'];

boardDemo(
  G,
  'java-jvm',
  'Inside the JVM',
  'Class loaders, metaspace, heap, per-thread stacks and PCs, and the execution engine (interpreter + JIT + code cache).',
  {
    areas: [
      'Memory areas',
      {
        panel: 'JVM',
        nodes: JVM_NODES,
        edges: JVM_EDGES,
        beats: [
          { note: 'javac compiles Main.java to Main.class, bytecode for a stack machine rather than native code.', hot: { cls: 'current' }, rows: [['native code', 'not yet']] },
          { note: 'Class loaders read class files and store their metadata in metaspace.', hot: { cl: 'current', meta: 'write', 'cls>cl': 'accent', 'cl>meta': 'accent' }, rows: [['classes loaded', 'on first use']] },
          { note: 'All objects live in one shared heap, managed by the garbage collector.', hot: { heap: 'current', gc: 'read', 'gc>heap': 'accent' }, rows: [['shared by', 'all threads']] },
          { note: 'Each thread gets its own stack of frames and its own program counter.', hot: { st1: 'current', st2: 'current', pc: 'write' }, rows: [['per thread', 'stack + PC']] },
        ],
      },
    ],
    run: [
      'Execution engine',
      {
        panel: 'JVM',
        nodes: JVM_NODES,
        edges: JVM_EDGES,
        beats: [
          { note: 'The execution engine starts by interpreting bytecode one instruction at a time.', hot: { interp: 'current' }, rows: [['mode', 'interpreted']] },
          { note: 'Methods that run often are compiled to machine code by the JIT, first C1 then C2.', hot: { jit: 'current', 'interp>jit': 'accent' }, rows: [['mode', 'compiling hot methods']] },
          { note: 'Compiled code goes into the code cache, and later calls jump straight there.', hot: { cc: 'ok', 'jit>cc': 'accent' }, rows: [['mode', 'native', 'ok']] },
          { note: 'Native libraries are reached through JNI or the Foreign Function API.', hot: { native: 'current' }, rows: [['escape hatch', 'JNI / FFM']] },
        ],
      },
    ],
  },
  JVM_DETAILS,
);

// ---------------- bytecode ----------------
const BYTECODE: Record<string, CodeMap> = {
  add: {
    srcTitle: 'Main.java',
    asmTitle: 'javap -c',
    src: ['static int add(int a, int b) {', '    return a + b;', '}'],
    asm: ['static int add(int, int);', '  Code:', '     0: iload_0', '     1: iload_1', '     2: iadd', '     3: ireturn'],
    intro: 'A static method and its bytecode. The JVM is a stack machine.',
    steps: [
      { src: [0], asm: [0, 1], note: 'Parameters arrive in local variable slots 0 and 1.' },
      { src: [1], asm: [2, 3], note: 'iload pushes each int from its slot onto the operand stack.' },
      { src: [1], asm: [4], note: 'iadd pops two ints and pushes their sum. The i prefix means the type is fixed at compile time.' },
      { src: [1], asm: [5], note: 'ireturn pops the int and returns it to the caller.' },
    ],
    outro: 'Unlike Python bytecode, every instruction is typed, so the verifier and the JIT know exact types up front.',
  },
  loop: {
    srcTitle: 'Main.java',
    asmTitle: 'javap -c',
    src: ['int sum(int[] xs) {', '  int t = 0;', '  for (int x : xs) t += x;', '  return t;', '}'],
    asm: ['0: iconst_0', '1: istore_2', '2: aload_1', '3: astore_3', '4: aload_3', '5: arraylength', '6: istore 4', '8: iconst_0', '9: istore 5', '11: iload 5', '13: iload 4', '15: if_icmpge 35', '18: aload_3', '19: iload 5', '21: iaload', '22: istore 6', '24: iload_2', '25: iload 6', '27: iadd', '28: istore_2', '29: iinc 5, 1', '32: goto 11', '35: iload_2', '36: ireturn'],
    intro: 'An enhanced for loop over an array. Slot 0 is this, 1 is xs, 2 is t.',
    steps: [
      { src: [1], asm: [0, 1], note: 't = 0 stores the constant into slot 2.' },
      { src: [2], asm: [2, 3, 4, 5, 6, 7, 8], note: 'The for-each over an array compiles to a hidden copy, its length and an index counter.' },
      { src: [2], asm: [9, 10, 11], note: 'if_icmpge exits when the index reaches the length.' },
      { src: [2], asm: [12, 13, 14, 15, 16, 17, 18, 19], note: 'iaload reads xs[i], with a bounds check the JIT can later prove away.' },
      { src: [2], asm: [20, 21], note: 'iinc bumps the index and goto jumps back to the test.' },
      { src: [3], asm: [22, 23], note: 'Return t.' },
    ],
    outro: 'The JIT turns this into a tight, often vectorised machine-code loop once it is hot.',
  },
  object: {
    srcTitle: 'Main.java',
    asmTitle: 'javap -c',
    src: ['Point p = new Point(1, 2);', 'int x = p.x;'],
    asm: ['0: new #7          // class Point', '3: dup', '4: iconst_1', '5: iconst_2', '6: invokespecial #9 // Point.<init>', '9: astore_1', '10: aload_1', '11: getfield #13   // Point.x:I', '14: istore_2'],
    intro: 'Creating an object and reading a field.',
    steps: [
      { src: [0], asm: [0, 1], note: 'new allocates an uninitialised Point on the heap and pushes its reference, and dup keeps a copy.' },
      { src: [0], asm: [2, 3, 4], note: 'invokespecial runs the constructor <init> with the arguments 1 and 2.' },
      { src: [0], asm: [5], note: 'astore_1 keeps the reference in local slot 1, while the object itself stays on the heap.' },
      { src: [1], asm: [6, 7, 8], note: 'getfield follows the reference and reads x, resolved through constant pool entry #13.' },
    ],
    outro: 'Symbolic references like #13 are resolved on first use, which is part of class linking.',
  },
};

machineDemo({
  slug: 'java-bytecode',
  title: 'Java bytecode (javap)',
  group: G,
  summary: 'Java source next to the stack-machine bytecode javac emits: typed instructions, locals slots, loops, object creation.',
  inputs: [
    { id: 'add', label: 'Method', data: { k: 'add' } },
    { id: 'loop', label: 'for-each loop', data: { k: 'loop' } },
    { id: 'object', label: 'new & getfield', data: { k: 'object' } },
  ],
  build: ({ k }: { k: string }) => codeMapFrames(BYTECODE[k]),
});

// ---------------- class loading, packages & modules ----------------
const CL_DETAILS: Record<string, Detail> = {
  'load com.acme.App': D('Loading a class', 'Triggered on first active use: new, a static call, or Class.forName.', 'App app = new App();   // loads App if needed'),
  'app class loader': D('Application class loader', 'Loads your classes from the classpath (-cp) or module path (-p).', '$ java -cp app.jar:libs/* com.acme.App'),
  'platform loader': D('Platform class loader', 'Loads JDK modules outside java.base, like java.sql and java.net.http.'),
  'bootstrap loader': D('Bootstrap class loader', 'Built into the JVM (C++). Loads java.base: java.lang, java.util, …', 'System.out.println(String.class.getClassLoader());\n// null  (bootstrap)'),
  'app.jar': D('JAR file', 'A zip of .class files and resources plus META-INF/MANIFEST.MF.', '$ jar tf app.jar\nMETA-INF/MANIFEST.MF\ncom/acme/App.class'),
  load: D('Load', 'Read the bytes and create the java.lang.Class object.'),
  link: D('Link', 'Verify the bytecode is safe, prepare static fields with default values, resolve symbolic references (often lazily).'),
  initialize: D('Initialize', 'Run static initialisers and static field assignments, exactly once, on first active use.', 'class Config {\n    static final Map<String, String> M = load();\n    static { System.out.println("init"); }\n}'),
  use: D('Use', 'The class is ready. If its initialiser threw, every later use throws NoClassDefFoundError.'),
};
const CL_NODES = [
  N('req', 355, 40, 290, 110, 'load com.acme.App'),
  N('app', 355, 220, 290, 110, 'app class loader', 'classpath'),
  N('jar', 670, 220, 290, 110, 'app.jar', 'com/acme/App.class'),
  N('plat', 355, 400, 290, 110, 'platform loader', 'java.sql, …'),
  N('boot', 355, 580, 290, 110, 'bootstrap loader', 'java.base'),
  N('ld', 40, 800, 210, 110, 'load'),
  N('lk', 275, 800, 210, 110, 'link', 'verify, prepare'),
  N('init', 510, 800, 210, 110, 'initialize', '<clinit>'),
  N('use', 745, 800, 215, 110, 'use'),
];
const CL_EDGES = ['req>app', 'app>plat', 'plat>boot', 'app>jar', 'ld>lk', 'lk>init', 'init>use'];
const LIFE = ['ld', 'lk', 'init', 'use'];

boardDemo(
  G,
  'java-classload',
  'Class loading, packages & modules',
  'Parent-first delegation, load → link → initialize, imports as compile-time names, classpath vs JPMS module path.',
  {
    delegation: [
      'Delegation',
      {
        panel: 'Class loading',
        nodes: CL_NODES,
        edges: CL_EDGES,
        beats: [
          { note: 'Loading com.acme.App starts at the application class loader.', hot: { req: 'current', app: 'read', 'req>app': 'accent' }, hide: LIFE, rows: [['asked', 'app loader']] },
          { note: 'It first delegates to its parent, the platform loader, which delegates to bootstrap.', hot: { plat: 'read', boot: 'read', 'app>plat': 'accent', 'plat>boot': 'accent' }, hide: LIFE, rows: [['order', 'parent first']] },
          { note: 'Neither parent knows com.acme, so the app loader finds App.class in app.jar itself.', hot: { plat: 'visited', boot: 'visited', app: 'ok', jar: 'ok', 'app>jar': 'accent' }, hide: LIFE, rows: [['loaded by', 'app loader', 'ok']] },
          { note: 'Parent-first stops your code from replacing java.lang.String. A class is identified by its name plus its loader.', hot: { boot: 'ok', app: 'ok' }, hide: LIFE, rows: [['identity', 'name + loader']] },
        ],
      },
    ],
    lifecycle: [
      'Load, link, init',
      {
        panel: 'Class loading',
        nodes: CL_NODES,
        edges: CL_EDGES,
        beats: [
          { note: 'Loading reads the bytes and creates the Class object.', hot: { ld: 'current', jar: 'read' }, rows: [['phase', 'load']] },
          { note: 'Linking verifies the bytecode, gives static fields default values and resolves references.', hot: { lk: 'current', 'ld>lk': 'accent' }, rows: [['phase', 'link']] },
          { note: 'Initialization runs static initialisers, lazily, on first active use.', hot: { init: 'current', 'lk>init': 'accent' }, rows: [['phase', 'initialize']] },
          { note: 'A static initialiser that throws leaves the class unusable, and later uses throw NoClassDefFoundError.', hot: { init: 'fail', use: 'fail', 'init>use': 'fail' }, rows: [['phase', 'broken', 'fail']] },
        ],
      },
    ],
    imports: [
      'Packages & imports',
      {
        panel: 'Packages',
        nodes: CL_NODES,
        edges: CL_EDGES,
        beats: [
          { note: 'import com.acme.util.Strings is only a compile-time shortcut for the full class name.', label: { req: 'import …Strings' }, hot: { req: 'current' }, hide: LIFE, rows: [['runtime effect', 'none']] },
          { note: 'The bytecode names com/acme/util/Strings directly, and nothing is loaded until first use.', label: { req: 'Strings.trim(s)' }, hot: { req: 'current', app: 'read' }, hide: LIFE, rows: [['loaded', 'on first use']] },
          { note: 'Packages map to directories inside the JAR, and a wildcard import never includes subpackages.', label: { req: 'import com.acme.*' }, hot: { jar: 'current' }, sub: { jar: 'com/acme/util/…' }, hide: LIFE, rows: [['package', 'directory']] },
        ],
      },
    ],
    modules: [
      'Modules (JPMS)',
      {
        panel: 'Modules',
        nodes: CL_NODES,
        edges: CL_EDGES,
        beats: [
          { note: 'On the classpath every public class is visible to every other, in one flat namespace.', hot: { app: 'warn' }, hide: LIFE, rows: [['boundaries', 'none', 'warn']] },
          { note: 'A module declares what it requires and exports in module-info.java.', label: { jar: 'module com.acme' }, sub: { jar: 'module-info.java', app: 'module path' }, hot: { jar: 'current' }, hide: LIFE, rows: [['descriptor', 'module-info']] },
          { note: 'Packages that aren’t exported stay hidden even when public, and a missing requires fails at start-up.', label: { jar: 'module com.acme' }, sub: { jar: 'exports com.acme.api', app: 'module path' }, hot: { jar: 'ok', app: 'ok' }, hide: LIFE, rows: [['encapsulation', 'strong', 'ok']] },
          { note: 'Two modules containing the same package is an error, instead of one silently shadowing the other.', label: { jar: 'split package' }, sub: { app: 'module path' }, hot: { jar: 'fail' }, hide: LIFE, rows: [['split packages', 'rejected']] },
        ],
      },
    ],
  },
  CL_DETAILS,
);

// ---------------- JIT ----------------
const JIT_DETAILS: Record<string, Detail> = {
  'tier 0': D('Interpreter', 'Every method starts here. Cheap to start, slow to run.'),
  'tier 3': D('C1 with profiling', 'Fast compile with counters for branches, call targets and types seen.', '$ java -XX:+PrintCompilation -jar app.jar\n  312   45   3   Shape::area (8 bytes)'),
  'tier 4': D('C2', 'Slow, aggressive compile using the profile: inlining, escape analysis, loop unrolling, vectorisation.', '  980   61   4   Shape::area (8 bytes)'),
  deoptimize: D('Deoptimization', 'When an assumption breaks, the JVM throws away the compiled code and resumes in the interpreter.', '  1502  61   4   Shape::area (8 bytes)   made not entrant'),
  profile: D('Profile', 'Per-call-site data: which receiver classes appeared, which branches were taken.'),
  inlining: D('Inlining', 'Copying a small callee into its caller, which unlocks almost every other optimisation.', '$ java -XX:+UnlockDiagnosticVMOptions -XX:+PrintInlining …\n  @ 3  Circle::area (12 bytes)   inline (hot)'),
  'code cache': D('Code cache', 'Holds compiled methods. Watch for "CodeCache is full" warnings.'),
  throughput: D('Throughput', 'Requests per second as code warms up.', '// benchmark with JMH, which handles warm-up\n@Benchmark\npublic double area() { return shape.area(); }'),
};
const JIT_NODES = [
  N('t0', 40, 100, 210, 130, 'tier 0', 'interpreter'),
  N('t3', 275, 100, 210, 130, 'tier 3', 'C1 + profiling'),
  N('t4', 510, 100, 210, 130, 'tier 4', 'C2 optimized'),
  N('deopt', 745, 100, 215, 130, 'deoptimize', 'back to tier 0'),
  N('prof', 275, 330, 210, 120, 'profile', 'counts, types'),
  N('inl', 510, 330, 210, 120, 'inlining', 'hot callees'),
  N('cc', 510, 540, 210, 120, 'code cache'),
  N('perf', 40, 760, 920, 120, 'throughput', '—'),
];
const JIT_EDGES = ['t0>t3', 't3>t4', 't4>deopt', 't3>prof', 't4>inl', 'inl>cc'];

boardDemo(
  G,
  'java-jit',
  'JIT: tiers, inlining & deopt',
  'Interpreter → C1 with profiling → C2; inlining from type profiles; deoptimization when assumptions break; warm-up.',
  {
    tiers: [
      'Tiered compilation',
      {
        panel: 'JIT',
        nodes: JIT_NODES,
        edges: JIT_EDGES,
        beats: [
          { note: 'Every method starts in the interpreter, which mostly counts how often it runs.', hot: { t0: 'current' }, sub: { perf: '40k ops/s' }, rows: [['tier', 0]] },
          { note: 'After a couple of hundred calls C1 compiles it quickly, with profiling counters.', hot: { t3: 'current', prof: 'write', 't0>t3': 'accent', 't3>prof': 'accent' }, sub: { perf: '400k ops/s' }, rows: [['tier', 3]] },
          { note: 'After thousands more, C2 recompiles it using the profile: fast code that is slow to produce.', hot: { t4: 'current', cc: 'write', 't3>t4': 'accent' }, sub: { perf: '2M ops/s' }, rows: [['tier', 4]] },
          { note: 'Throughput climbs in steps as hot methods move up the tiers.', hot: { perf: 'ok', t4: 'ok' }, sub: { perf: '40k → 400k → 2M ops/s' }, rows: [['speedup', '50×', 'ok']] },
        ],
      },
    ],
    inline: [
      'Inlining',
      {
        panel: 'JIT',
        nodes: JIT_NODES,
        edges: JIT_EDGES,
        beats: [
          { note: 'The profile shows that shape.area() has only ever seen a Circle.', hot: { prof: 'current' }, sub: { prof: 'Circle 100%' }, rows: [['receivers', 'Circle']] },
          { note: 'C2 inlines Circle’s area straight into the caller behind a cheap class check.', hot: { inl: 'current', t4: 'write', 't4>inl': 'accent' }, sub: { prof: 'Circle 100%' }, rows: [['virtual call', 'gone', 'ok']] },
          { note: 'Inlining unlocks the rest: loop unrolling, and escape analysis that removes allocations.', hot: { inl: 'ok', cc: 'ok', 'inl>cc': 'accent' }, sub: { perf: 'no call, no alloc' }, rows: [['allocations', 'eliminated', 'ok']] },
        ],
      },
    ],
    deopt: [
      'Deoptimization',
      {
        panel: 'JIT',
        nodes: JIT_NODES,
        edges: JIT_EDGES,
        beats: [
          { note: 'The optimised code assumes only Circle ever reaches this call.', hot: { t4: 'current' }, sub: { prof: 'Circle 100%' }, rows: [['assumption', 'monomorphic']] },
          { note: 'A Square arrives, the class check fails, and the JVM deoptimizes back to the interpreter.', hot: { deopt: 'fail', t0: 'warn', 't4>deopt': 'fail' }, sub: { perf: 'latency spike' }, rows: [['state', 'made not entrant', 'fail']] },
          { note: 'It re-profiles and recompiles with a two-way check. Sudden latency spikes often trace back to this.', hot: { t3: 'current', t4: 'ok' }, sub: { prof: 'Circle 70% · Square 30%' }, rows: [['recompiled', 'bimorphic', 'ok']] },
        ],
      },
    ],
    warmup: [
      'Warm-up',
      {
        panel: 'JIT',
        nodes: JIT_NODES,
        edges: JIT_EDGES,
        beats: [
          { note: 'A freshly started JVM runs interpreted, so its first requests are slow.', hot: { t0: 'current', perf: 'warn' }, sub: { perf: 'p99 high for first minute' }, rows: [['state', 'cold', 'warn']] },
          { note: 'Benchmarks must discard the warm-up phase, which JMH does for you.', hot: { perf: 'read' }, sub: { perf: 'measure after warm-up' }, rows: [['tool', 'JMH']] },
          { note: 'CDS and AOT caches, or CRaC checkpoints, cut start-up for short-lived services.', hot: { cc: 'ok', perf: 'ok' }, sub: { perf: 'start warm' }, rows: [['start-up', 'faster', 'ok']] },
        ],
      },
    ],
  },
  JIT_DETAILS,
);

// ---------------- GC ----------------
const GC_DETAILS: Record<string, Detail> = {
  'GC roots': D('GC roots', 'Where tracing starts: references in thread stacks, static fields, JNI handles.'),
  eden: D('Eden', 'New objects are bump-allocated here from per-thread buffers (TLABs), nearly free.', 'var list = new ArrayList<String>();  // eden'),
  'survivor 0': D('Survivor space', 'Objects that lived through a minor GC are copied here and aged.'),
  'survivor 1': D('Survivor space', 'The other half: survivors bounce between the two, one of which is always empty.'),
  'old generation': D('Old generation', 'Promoted long-lived objects: caches, pools, sessions. Collected less often.', '$ jstat -gcutil <pid> 1000\n  S0   S1   E    O    M   YGC  FGC\n  0.0 45.2 61.3 72.8 95.1  128   2'),
  pause: D('Pause', 'Time application threads are stopped for the collector.', '$ java -Xlog:gc -jar app.jar\n[gc] GC(12) Pause Young (Normal) 512M->64M(1024M) 4.2ms'),
};
const GC_NODES = [
  N('roots', 40, 40, 440, 110, 'GC roots', 'stacks, statics'),
  N('eden', 40, 200, 440, 140, 'eden', 'new objects'),
  N('s0', 520, 200, 210, 140, 'survivor 0'),
  N('s1', 750, 200, 210, 140, 'survivor 1'),
  N('old', 40, 420, 920, 140, 'old generation', 'long-lived'),
  N('pause', 40, 660, 920, 120, 'pause', '—'),
];
const GC_EDGES = ['roots>eden', 'eden>s0', 's0>s1', 's1>old'];

boardDemo(
  G,
  'java-gc',
  'JVM garbage collection',
  'Generational heap: eden, survivors, promotion, old gen; G1 regions with pause goals; ZGC concurrent relocation.',
  {
    young: [
      'Minor GC',
      {
        panel: 'GC',
        nodes: GC_NODES,
        edges: GC_EDGES,
        beats: [
          { note: 'new Object() bumps a pointer in eden, which is almost free.', hot: { eden: 'current' }, sub: { eden: '85% full' }, rows: [['alloc cost', '~10 ns', 'ok']] },
          { note: 'When eden fills, a minor GC traces live objects starting from the GC roots.', hot: { roots: 'current', eden: 'warn', 'roots>eden': 'accent' }, sub: { eden: 'full', pause: 'young pause' }, rows: [['trigger', 'eden full']] },
          { note: 'Live objects are copied to a survivor space, and eden is wiped in one go.', hot: { s0: 'write', eden: 'ok', 'eden>s0': 'accent' }, sub: { eden: 'empty', s0: '3% of eden' }, rows: [['copied', 'survivors only']] },
          { note: 'Most objects are already dead, so the copy is small: that is the generational hypothesis.', hot: { pause: 'ok' }, sub: { pause: '4 ms' }, rows: [['pause', '4 ms', 'ok']] },
        ],
      },
    ],
    promote: [
      'Promotion',
      {
        panel: 'GC',
        nodes: GC_NODES,
        edges: GC_EDGES,
        beats: [
          { note: 'Objects that survive several minor GCs age by bouncing between the two survivor spaces.', hot: { s0: 'read', s1: 'write', 's0>s1': 'accent' }, sub: { s1: 'age 5' }, rows: [['age', 5]] },
          { note: 'Past the tenuring threshold they are promoted to the old generation.', hot: { old: 'write', 's1>old': 'accent' }, sub: { old: 'caches, sessions' }, rows: [['threshold', 'up to 15']] },
          { note: 'Old-gen collections are rarer and longer, so a leak shows as old gen growing after every full GC.', hot: { old: 'warn', pause: 'warn' }, sub: { old: '72% → 81% → 90%', pause: 'full GC 800 ms' }, rows: [['leak sign', 'old keeps growing', 'warn']] },
        ],
      },
    ],
    g1: [
      'G1',
      {
        panel: 'G1',
        nodes: GC_NODES,
        edges: GC_EDGES,
        beats: [
          { note: 'G1, the default collector, splits the heap into equal regions tagged eden, survivor, old or humongous.', label: { eden: 'eden regions', old: 'old + humongous regions' }, hot: { eden: 'current', old: 'read' }, sub: { eden: '2 MB each' }, rows: [['regions', '~2048']] },
          { note: 'It collects the regions holding the most garbage first, hence Garbage First.', label: { eden: 'eden regions', old: 'old + humongous regions' }, hot: { old: 'current' }, sub: { old: 'mostly-garbage regions first' }, rows: [['strategy', 'garbage first']] },
          { note: 'It sizes each collection to meet a pause goal set with -XX:MaxGCPauseMillis, 200 ms by default.', label: { eden: 'eden regions', old: 'old + humongous regions' }, hot: { pause: 'ok' }, sub: { pause: '≤ 200 ms goal' }, rows: [['pause goal', '200 ms']] },
        ],
      },
    ],
    zgc: [
      'ZGC',
      {
        panel: 'ZGC',
        nodes: GC_NODES,
        edges: GC_EDGES,
        beats: [
          { note: 'ZGC marks and moves objects while your threads keep running.', label: { old: 'generational ZGC' }, hot: { old: 'current', eden: 'current' }, sub: { pause: 'concurrent' }, rows: [['work', 'concurrent']] },
          { note: 'Load barriers on reference reads fix up pointers to objects that have moved.', label: { old: 'generational ZGC' }, hot: { roots: 'current', old: 'write' }, sub: { roots: 'load barriers' }, rows: [['cost', 'barrier per load', 'warn']] },
          { note: 'Pauses stay under a millisecond even with terabyte heaps, at the cost of some CPU.', label: { old: 'generational ZGC' }, hot: { pause: 'ok' }, sub: { pause: '< 1 ms' }, rows: [['pause', '< 1 ms', 'ok']] },
        ],
      },
    ],
  },
  GC_DETAILS,
);

// ---------------- memory model & threads ----------------
const MM_DETAILS: Record<string, Detail> = {
  'thread A': D('Writer thread', 'Sets the flag that tells the worker to stop.', 'void stop() { running = false; }'),
  'thread B': D('Worker thread', 'Spins on the flag.', 'void run() {\n    while (running) { work(); }\n}'),
  'cache A': D('Core-local view', 'Registers, store buffers and caches let each core see writes late unless the memory model forces ordering.'),
  'cache B': D('Core-local view', 'The JIT may even keep the flag in a register and never reload it.'),
  'main memory': D('Shared memory', 'Where the flag lives. Visibility rules decide when other threads see a write.', 'volatile boolean running = true;'),
  monitor: D('Monitor', 'Every object has one. synchronized acquires it, releasing it publishes all writes made inside.', 'synchronized (lock) {\n    count++;\n}'),
  'virtual threads': D('Virtual threads', 'Lightweight threads scheduled by the JVM, cheap enough for one per request.', 'try (var ex = Executors.newVirtualThreadPerTaskExecutor()) {\n    for (int i = 0; i < 1_000_000; i++)\n        ex.submit(() -> fetch(i));\n}'),
  'carrier threads': D('Carrier threads', 'Platform threads, one per core, that run whichever virtual thread is mounted.'),
  scheduler: D('Scheduler', 'A ForkJoinPool that mounts and unmounts virtual threads on carriers.'),
};
const MM_NODES = [
  N('t1', 40, 60, 290, 120, 'thread A', 'core 1'),
  N('mon', 355, 60, 290, 120, 'monitor', 'lock object'),
  N('t2', 670, 60, 290, 120, 'thread B', 'core 2'),
  N('c1', 40, 280, 290, 110, 'cache A'),
  N('c2', 670, 280, 290, 110, 'cache B'),
  N('mem', 355, 480, 290, 120, 'main memory', 'running = true'),
];
const MM_EDGES = ['t1>c1', 't2>c2', 'c1>mem', 'c2>mem'];

boardDemo(
  G,
  'java-threads',
  'Java memory model & threads',
  'Visibility and happens-before: plain fields, volatile, synchronized; virtual threads mounted on carrier threads.',
  {
    visibility: [
      'Visibility bug',
      {
        panel: 'JMM',
        nodes: MM_NODES,
        edges: MM_EDGES,
        beats: [
          { note: 'Thread B loops while running is true, reading a plain boolean.', hot: { t2: 'current', c2: 'read', 't2>c2': 'accent' }, sub: { c2: 'running = true' }, hide: ['mon'], rows: [['field', 'plain boolean']] },
          { note: 'Thread A sets running = false, but nothing forces B to reread it.', hot: { t1: 'current', c1: 'write', mem: 'write', 't1>c1': 'accent', 'c1>mem': 'accent' }, sub: { c1: 'running = false', c2: 'running = true', mem: 'running = false' }, hide: ['mon'], rows: [['B sees', 'true', 'warn']] },
          { note: 'The JIT may hoist the read out of the loop entirely, so B spins forever.', hot: { t2: 'fail', c2: 'fail' }, sub: { c1: 'running = false', c2: 'running = true', mem: 'running = false' }, hide: ['mon'], rows: [['B stops', 'never', 'fail']] },
        ],
      },
    ],
    volatile: [
      'volatile',
      {
        panel: 'JMM',
        nodes: MM_NODES,
        edges: MM_EDGES,
        beats: [
          { note: 'Declare the field volatile boolean running.', hot: { mem: 'current' }, sub: { mem: 'volatile running' }, hide: ['mon'], rows: [['field', 'volatile']] },
          { note: 'A volatile write happens-before every later read of it, so B sees false and stops.', hot: { t1: 'write', t2: 'ok', 'c1>mem': 'accent', 'c2>mem': 'accent' }, sub: { mem: 'running = false', c2: 'rereads memory' }, hide: ['mon'], rows: [['B stops', 'yes', 'ok']] },
          { note: 'volatile gives visibility and ordering, not atomicity, so count++ on a volatile still races.', hot: { mem: 'warn' }, sub: { mem: 'count++ races' }, hide: ['mon'], rows: [['atomic ++', 'no', 'warn']] },
        ],
      },
    ],
    sync: [
      'synchronized',
      {
        panel: 'JMM',
        nodes: MM_NODES,
        edges: MM_EDGES,
        beats: [
          { note: 'synchronized (lock) lets one thread at a time into the block.', hot: { mon: 'current', t1: 'write' }, sub: { mon: 'owned by A' }, rows: [['owner', 'A']] },
          { note: 'Unlocking happens-before the next lock of the same monitor, so B sees everything A wrote inside.', hot: { mon: 'ok', t2: 'ok', mem: 'write' }, sub: { mon: 'owned by B', mem: 'count = 1' }, rows: [['owner', 'B'], ['visible', 'all writes', 'ok']] },
          { note: 'java.util.concurrent types like AtomicInteger and ConcurrentHashMap build on the same rules.', hot: { mem: 'ok' }, sub: { mem: 'AtomicInteger' }, rows: [['prefer', 'j.u.c types', 'ok']] },
        ],
      },
    ],
    virtual: [
      'Virtual threads',
      {
        panel: 'Loom',
        nodes: MM_NODES,
        edges: MM_EDGES,
        beats: [
          { note: 'Virtual threads are cheap JVM-scheduled threads, so one per request is fine even at a million.', label: { t1: 'virtual threads', mon: 'scheduler', t2: 'carrier threads' }, sub: { t1: '1,000,000', mon: 'ForkJoinPool', t2: 'one per core' }, hot: { t1: 'current' }, hide: ['c1', 'c2', 'mem'], rows: [['threads', '1M virtual']] },
          { note: 'When one blocks on I/O, the JVM unmounts it and its carrier runs another.', label: { t1: 'virtual threads', mon: 'scheduler', t2: 'carrier threads' }, sub: { t1: 'blocked ones parked', mon: 'ForkJoinPool', t2: 'always busy' }, hot: { mon: 'current', t2: 'ok' }, hide: ['c1', 'c2', 'mem'], rows: [['carriers', 'cores']] },
          { note: 'Before JDK 24, blocking inside synchronized pinned the carrier, so ReentrantLock was preferred there.', label: { t1: 'virtual threads', mon: 'scheduler', t2: 'carrier threads' }, sub: { t1: 'pinned', mon: 'ForkJoinPool', t2: 'stuck' }, hot: { t2: 'warn' }, hide: ['c1', 'c2', 'mem'], rows: [['pinning', 'fixed in 24', 'warn']] },
        ],
      },
    ],
  },
  MM_DETAILS,
);

// ---------------- Maven / Gradle ----------------
export interface Dep {
  name: string;
  version: string;
  deps?: Dep[];
}

/** Maven's "nearest wins": the version declared closest to the root, first declaration on ties. */
export function resolveNearest(root: Dep[]): Record<string, string> {
  const out: Record<string, string> = {};
  let level = root;
  while (level.length) {
    const next: Dep[] = [];
    for (const d of level) {
      if (!(d.name in out)) out[d.name] = d.version;
      next.push(...(d.deps ?? []));
    }
    level = next;
  }
  return out;
}

/** Gradle's default: highest requested version wins. */
export function resolveHighest(root: Dep[]): Record<string, string> {
  const out: Record<string, string> = {};
  const cmp = (a: string, b: string) => {
    const x = a.split('.').map(Number);
    const y = b.split('.').map(Number);
    for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
    return 0;
  };
  const walk = (ds: Dep[]) =>
    ds.forEach((d) => {
      if (!(d.name in out) || cmp(d.version, out[d.name]) > 0) out[d.name] = d.version;
      walk(d.deps ?? []);
    });
  walk(root);
  return out;
}

export const CONFLICT_TREE: Dep[] = [
  { name: 'lib-a', version: '1.0', deps: [{ name: 'guava', version: '30.0' }] },
  { name: 'lib-b', version: '2.0', deps: [{ name: 'guava', version: '32.1' }] },
];
const mvn = resolveNearest(CONFLICT_TREE).guava;
const gradle = resolveHighest(CONFLICT_TREE).guava;

const DEP_DETAILS: Record<string, Detail> = {
  'pom.xml': D('pom.xml', 'Maven’s project file: coordinates, dependencies, plugins.', '<dependency>\n  <groupId>com.google.guava</groupId>\n  <artifactId>guava</artifactId>\n  <version>33.2.1-jre</version>\n</dependency>'),
  '~/.m2': D('Local repository', 'Every downloaded artifact is cached here and shared by all projects.', '$ ls ~/.m2/repository/com/google/guava/guava/\n30.0-jre  32.1.3-jre'),
  'Maven Central': D('Remote repository', 'The public repository most artifacts come from. Companies proxy it with Nexus or Artifactory.'),
  app: D('Your project', 'Declares direct dependencies only.', '// build.gradle.kts\ndependencies {\n    implementation("com.acme:lib-a:1.0")\n    implementation("com.acme:lib-b:2.0")\n}'),
  'lib-a 1.0': D('Direct dependency', 'Brings its own dependencies along.'),
  'lib-b 2.0': D('Direct dependency', 'Compiled against guava 32.1, and may call methods older versions lack.'),
  'guava 30.0': D('Transitive dependency', 'Requested by lib-a.', '$ mvn dependency:tree\n[INFO] +- com.acme:lib-a:1.0\n[INFO] |  \\- com.google.guava:guava:30.0\n[INFO] \\- com.acme:lib-b:2.0'),
  'guava 32.1': D('Transitive dependency', 'Requested by lib-b, omitted by Maven for conflict with 30.0.', '[INFO]    \\- (guava:32.1 - omitted for conflict with 30.0)'),
  resolved: D('Resolved classpath', 'One version of each artifact. Force one explicitly when the default rule picks badly.', '<dependencyManagement>\n  <dependencies>\n    <dependency>\n      <groupId>com.google.guava</groupId>\n      <artifactId>guava</artifactId>\n      <version>32.1.3-jre</version>\n    </dependency>\n  </dependencies>\n</dependencyManagement>'),
};
const DEP_NODES = [
  N('pom', 40, 40, 290, 110, 'pom.xml', 'declared deps'),
  N('local', 355, 40, 290, 110, '~/.m2', 'local cache'),
  N('repo', 670, 40, 290, 110, 'Maven Central', 'remote repo'),
  N('app', 355, 220, 290, 110, 'app'),
  N('a', 40, 400, 290, 110, 'lib-a 1.0'),
  N('b', 670, 400, 290, 110, 'lib-b 2.0'),
  N('g1', 40, 600, 290, 110, 'guava 30.0'),
  N('g2', 670, 600, 290, 110, 'guava 32.1'),
  N('res', 355, 800, 290, 110, 'resolved', '—'),
];
const DEP_EDGES = ['pom>local', 'local>repo', 'app>a', 'app>b', 'a>g1', 'b>g2'];

boardDemo(
  G,
  'java-deps',
  'Maven, Gradle & dependencies',
  'Coordinates and repositories, the transitive dependency tree, version conflicts (nearest-wins vs highest), shading.',
  {
    coords: [
      'Coordinates',
      {
        panel: 'Build',
        nodes: DEP_NODES,
        edges: DEP_EDGES,
        beats: [
          { note: 'A dependency is named by coordinates groupId:artifactId:version.', hot: { pom: 'current' }, hide: ['a', 'b', 'g1', 'g2', 'res'], rows: [['example', 'com.google.guava:guava:33.2.1-jre']] },
          { note: 'Maven looks in the local ~/.m2 cache first and downloads from the remote repository on a miss.', hot: { local: 'current', repo: 'read', 'pom>local': 'accent', 'local>repo': 'accent' }, hide: ['a', 'b', 'g1', 'g2', 'res'], rows: [['cache', '~/.m2/repository']] },
          { note: 'Gradle uses the same repositories and coordinates with its own cache.', hot: { app: 'ok' }, hide: ['a', 'b', 'g1', 'g2', 'res'], rows: [['Gradle cache', '~/.gradle/caches']] },
        ],
      },
    ],
    tree: [
      'Transitive tree',
      {
        panel: 'Build',
        nodes: DEP_NODES,
        edges: DEP_EDGES,
        beats: [
          { note: 'app declares lib-a and lib-b.', hot: { app: 'current', a: 'write', b: 'write', 'app>a': 'accent', 'app>b': 'accent' }, hide: ['g1', 'g2', 'res'], rows: [['direct', 2]] },
          { note: 'Each brings its own dependencies, forming the transitive graph.', hot: { g1: 'write', g2: 'write', 'a>g1': 'accent', 'b>g2': 'accent' }, hide: ['res'], rows: [['transitive', 2]] },
          { note: 'mvn dependency:tree or gradle dependencies prints it, and most classpath surprises start here.', hot: { app: 'ok' }, hide: ['res'], rows: [['inspect', 'dependency:tree']] },
        ],
      },
    ],
    conflict: [
      'Version conflict',
      {
        panel: 'Build',
        nodes: DEP_NODES,
        edges: DEP_EDGES,
        beats: [
          { note: 'lib-a wants guava 30.0 and lib-b wants 32.1, but a classpath holds only one.', hot: { g1: 'warn', g2: 'warn' }, rows: [['guava requested', '30.0, 32.1', 'warn']] },
          { note: 'Maven picks the nearest declaration, and on a tie the first one declared wins.', hot: { g1: 'current', res: 'warn' }, sub: { res: `Maven: guava ${mvn}` }, rows: [['Maven picks', mvn, 'warn']] },
          { note: 'lib-b then calls a method added after 30.0 and dies at run time with NoSuchMethodError.', hot: { b: 'fail', res: 'fail' }, sub: { res: `Maven: guava ${mvn}` }, rows: [['error', 'NoSuchMethodError', 'fail']] },
          { note: 'Gradle picks the highest version instead, and either tool lets you force one in dependencyManagement or a BOM.', hot: { g2: 'ok', res: 'ok' }, sub: { res: `Gradle: guava ${gradle}` }, rows: [['Gradle picks', gradle, 'ok']] },
        ],
      },
    ],
    shade: [
      'Shading',
      {
        panel: 'Build',
        nodes: DEP_NODES,
        edges: DEP_EDGES,
        beats: [
          { note: 'Your library needs guava 32, but its users may have any guava on their classpath.', label: { a: 'your-lib', b: 'user app' }, hot: { a: 'current', g1: 'warn' }, sub: { g1: 'user’s guava 30' }, hide: ['res'], rows: [['risk', 'version clash', 'warn']] },
          { note: 'Shading copies guava into your JAR under a renamed package, com.acme.shaded.guava.', label: { a: 'your-lib', b: 'user app', res: 'your-lib.jar' }, hot: { res: 'current' }, sub: { res: 'shaded guava inside' }, rows: [['plugin', 'maven-shade / shadow']] },
          { note: 'Both versions now coexist. The cost is a bigger JAR and duplicated code.', label: { a: 'your-lib', b: 'user app', res: 'your-lib.jar' }, hot: { res: 'ok', g1: 'ok' }, sub: { res: '+3 MB' }, rows: [['conflict', 'none', 'ok']] },
        ],
      },
    ],
  },
  DEP_DETAILS,
);
