// Go (group lang-go): scheduler, channels, GC, escape analysis & stacks, interfaces, packages, modules.
import type { Detail, Tone } from '../algo/frames';
import { boardDemo, N } from '../machine/lib/board';
import type { Board } from '../machine/lib/board';
import { machineDemo } from '../machine/lib/draw';
import { traceFrames } from '../machine/lib/trace';
import type { Trace } from '../machine/lib/trace';

const G = 'lang-go';
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

// ---------------- scheduler ----------------
const SCHED_NODES = [
  N('gq', 40, 40, 920, 100, 'global run queue', 'G7 G8', {
    detail: D('Global run queue', 'Goroutines not on any P yet: overflow from full local queues and Gs woken by the netpoller. Every P checks it every 61 scheduling ticks so it never starves.', '// GODEBUG=schedtrace=1000 ./app\nSCHED 1004ms: gomaxprocs=2 idleprocs=0\n  threads=5 runqueue=2 [3 0]\n// runqueue = global, [..] = per-P local'),
  }),
  N('p0', 40, 210, 440, 110, 'P0', 'local: G2 G3 G4', {
    detail: D('P — processor', 'A scheduling context: a local run queue (up to 256 Gs) plus a memory cache. A thread must hold a P to run Go code, and there are GOMAXPROCS of them.', 'import "runtime"\n\nfunc main() {\n  fmt.Println(runtime.GOMAXPROCS(0)) // = CPUs\n  fmt.Println(runtime.NumGoroutine())\n}'),
  }),
  N('p1', 520, 210, 440, 110, 'P1', 'local: G5 G6', { detail: D('P — processor', 'Each P has its own run queue, so most scheduling needs no global lock.') }),
  N('m0', 40, 390, 440, 110, 'M0 (OS thread)', 'running G1', {
    detail: D('M — machine (OS thread)', 'A real kernel thread. The runtime starts extra Ms when some block in syscalls, but only GOMAXPROCS run Go code at once.', '// 100k goroutines, a handful of threads:\nfor i := 0; i < 100_000; i++ {\n  go work(i) // ~2 KB stack each\n}\n// an OS thread reserves ~1 MB or more'),
  }),
  N('m1', 520, 390, 440, 110, 'M1 (OS thread)', 'running G5', { detail: D('M — machine (OS thread)', 'Another kernel thread, holding P1.') }),
  N('c0', 40, 570, 440, 90, 'CPU core 0', undefined, { detail: D('CPU core', 'The OS decides which core an M runs on; Go does not pin threads.') }),
  N('c1', 520, 570, 440, 90, 'CPU core 1', undefined, { detail: D('CPU core', 'The OS decides which core an M runs on; Go does not pin threads.') }),
  N('np', 40, 760, 440, 110, 'netpoller', 'epoll / kqueue', {
    detail: D('netpoller', 'One epoll (Linux) or kqueue (macOS) per process. A goroutine blocked on a socket parks here and frees its thread.', 'conn, _ := ln.Accept()\nbuf := make([]byte, 4096)\n// looks blocking, but parks only the G:\nn, err := conn.Read(buf)'),
  }),
  N('sys', 520, 760, 440, 110, 'blocking syscall', 'read(file)', {
    detail: D('Blocking syscall', 'File I/O and cgo calls block the whole thread. sysmon notices and hands the P to another M, so other goroutines keep running.', 'f, _ := os.Open("big.log")\nf.Read(buf) // this M is stuck in the kernel;\n            // its P moves to a spare M'),
  }),
];
const SCHED_EDGES = ['gq>p0', 'gq>p1', 'p0>m0', 'p1>m1', 'm0>c0', 'm1>c1', 'p0>p1', 'c0>np', 'c0>sys'];
const sched = (beats: Board['beats']): Board => ({ panel: 'Scheduler', nodes: SCHED_NODES, edges: SCHED_EDGES, beats });
const IO = ['np', 'sys', 'c0>np', 'c0>sys'];

demo('go-sched', 'Goroutine scheduler (GMP)', 'Many goroutines on few threads: Ps with local run queues, work stealing, syscall handoff and the netpoller.', {
  gmp: [
    'G, M and P',
    sched([
      { note: 'Go multiplexes many goroutines (G) onto a few OS threads (M). A P is the right to run Go code, and there are GOMAXPROCS of them.', hide: [...IO, 'p0>p1'], rows: [['G', 8], ['M', 2], ['P', 2]] },
      { note: 'go f() puts a new G on the current P’s local run queue, with a 2 KB stack.', hot: { p0: 'write' }, sub: { p0: 'local: G2 G3 G4 G9' }, hide: [...IO, 'p0>p1'], rows: [['G', 9], ['new G cost', '~2 KB']] },
      { note: 'M0 holds P0 and runs G1 on core 0. When G1 blocks on a channel, M0 just picks the next G from P0’s queue.', hot: { m0: 'current', c0: 'current', 'p0>m0': 'accent', 'm0>c0': 'accent' }, sub: { p0: 'local: G2 G3 G4 G9' }, hide: [...IO, 'p0>p1'], rows: [['switch cost', '~100 ns, no kernel']] },
      { note: 'Every 61 ticks a P also takes work from the global queue, so nothing starves.', hot: { gq: 'current', 'gq>p0': 'accent', 'gq>p1': 'accent' }, sub: { gq: 'G7 → P0, G8 → P1' }, hide: [...IO, 'p0>p1'], rows: [['global queue', 0]] },
    ]),
  ],
  steal: [
    'Work stealing',
    sched([
      { note: 'P1 runs out of goroutines, so M1 would sit idle.', hot: { p1: 'warn', m1: 'warn' }, sub: { p0: 'local: G2 G3 G4 G9', p1: 'local: —', m1: 'idle' }, hide: IO, rows: [['P0 queue', 4], ['P1 queue', 0, 'warn']] },
      { note: 'It steals half of P0’s queue: G4 and G9 move over.', hot: { 'p0>p1': 'accent', p1: 'write' }, sub: { p0: 'local: G2 G3', p1: 'local: G4 G9', m1: 'idle' }, hide: IO, rows: [['P0 queue', 2], ['P1 queue', 2, 'ok']] },
      { note: 'Both cores run goroutines again. Stealing balances load without a central lock.', hot: { m0: 'current', m1: 'current', c0: 'ok', c1: 'ok' }, sub: { p0: 'local: G2 G3', p1: 'local: G9', m1: 'running G4' }, hide: IO, rows: [['busy cores', 2, 'ok']] },
    ]),
  ],
  syscall: [
    'Syscalls & netpoller',
    sched([
      { note: 'G1 does a blocking file read, so M0 is stuck in the kernel.', hot: { sys: 'fail', 'c0>sys': 'fail', m0: 'warn' }, sub: { m0: 'blocked in read()' }, rows: [['M blocked', 1, 'warn']] },
      { note: 'sysmon notices after about 20 µs and hands P0 to a spare thread, so G2 and G3 keep running.', hot: { p0: 'ok', m1: 'ok' }, sub: { m0: 'blocked in read()', m1: 'took P0, runs G2' }, rows: [['threads', 3]] },
      { note: 'Network reads don’t block a thread at all. The socket goes to the netpoller and only the goroutine sleeps.', hot: { np: 'current', 'c0>np': 'accent' }, sub: { np: 'watching 10k sockets' }, rows: [['threads for 10k conns', 'GOMAXPROCS']] },
      { note: 'When epoll reports data, the G goes back on a run queue. That’s how one Go process serves 100k connections.', hot: { np: 'ok', gq: 'write' }, sub: { gq: 'G1 (ready)' }, rows: [['model', 'blocking code, async runtime', 'ok']] },
    ]),
  ],
});

// ---------------- channels ----------------
const CHAN_NODES = [
  N('g1', 40, 260, 280, 120, 'G1 (sender)', undefined, { detail: D('Sending goroutine', 'ch <- v blocks until a receiver takes the value or the buffer has room.', 'go func() {\n  for _, j := range jobs {\n    ch <- j\n  }\n  close(ch) // receivers see ok == false\n}()') }),
  N('ch', 360, 260, 280, 120, 'hchan', 'no buffer', {
    detail: D('hchan', 'The runtime struct behind a channel: a lock, an optional ring buffer, and two wait queues of parked goroutines.', '// runtime/chan.go (simplified)\ntype hchan struct {\n  qcount   uint           // items in buf\n  dataqsiz uint           // buf capacity\n  buf      unsafe.Pointer // ring buffer\n  sendq    waitq          // blocked senders\n  recvq    waitq          // blocked receivers\n  lock     mutex\n}'),
  }),
  N('g2', 680, 260, 280, 120, 'G2 (receiver)', undefined, { detail: D('Receiving goroutine', 'v := <-ch blocks until a value is there. v, ok := <-ch reports whether the channel was closed.', 'for v := range ch { // ends when ch is closed\n  use(v)\n}') }),
  N('sq', 40, 470, 280, 110, 'sendq', 'empty', { detail: D('sendq', 'Senders parked on this channel, in arrival order, each holding the value it wants to send.') }),
  N('buf', 360, 470, 280, 110, 'ring buffer', '—', { detail: D('Ring buffer', 'Only buffered channels have one. make(chan T, n) allocates n slots; sends copy into it and receives copy out.', 'ch := make(chan int, 2)\nch <- 1\nch <- 2   // still no receiver needed\nfmt.Println(len(ch), cap(ch)) // 2 2') }),
  N('rq', 680, 470, 280, 110, 'recvq', 'empty', { detail: D('recvq', 'Receivers parked on this channel. A sender hands its value straight to the first one.') }),
];
const chan = (code: string[], beats: Board['beats']): Board => ({ panel: 'Channel', codeTitle: 'main.go', code, nodes: CHAN_NODES, edges: ['g1>ch', 'ch>g2', 'g1>sq', 'ch>buf', 'g2>rq'], beats });

demo('go-chan', 'Channels & select', 'hchan internals: unbuffered rendezvous, buffered ring buffer and wait queues, select across channels.', {
  unbuffered: [
    'Unbuffered',
    chan(['ch := make(chan int)      // unbuffered', 'go func() { ch <- 42 }()  // G1', 'v := <-ch                 // G2', 'fmt.Println(v)            // 42'], [
      { note: 'An unbuffered channel has no storage: a send and a receive must meet.', hl: [0], hot: { ch: 'current' }, hide: ['buf'], rows: [['cap', 0]] },
      { note: 'G1 sends first, finds no receiver, and parks on the channel’s sendq.', hl: [1], hot: { g1: 'warn', sq: 'write', 'g1>sq': 'warn' }, sub: { sq: 'G1 holding 42' }, hide: ['buf'], rows: [['parked', 'G1', 'warn']] },
      { note: 'G2 receives: it copies 42 straight from G1 and makes G1 runnable again.', hl: [2], hot: { g2: 'ok', g1: 'ok', 'ch>g2': 'accent' }, sub: { g2: 'v = 42' }, hide: ['buf'], rows: [['parked', 0, 'ok']] },
      { note: 'Neither side moved on until the other arrived. Unbuffered channels synchronise as well as pass data.', hl: [3], hot: { ch: 'ok' }, sub: { g2: 'v = 42' }, hide: ['buf'], rows: [['output', 42]] },
    ]),
  ],
  buffered: [
    'Buffered',
    chan(['ch := make(chan int, 2)', 'ch <- 1; ch <- 2  // fill the buffer', 'ch <- 3           // blocks: buffer full', '<-ch              // gets 1, and 3 moves in'], [
      { note: 'make(chan int, 2) allocates an hchan with a two-slot ring buffer.', hl: [0], hot: { buf: 'current' }, sub: { ch: 'cap 2', buf: '[ _ _ ]' }, rows: [['len', 0], ['cap', 2]] },
      { note: 'Two sends just copy into the buffer, and nobody blocks.', hl: [1], hot: { buf: 'write', 'g1>ch': 'accent', 'ch>buf': 'accent' }, sub: { ch: 'cap 2', buf: '[1 2] full' }, rows: [['len', 2]] },
      { note: 'The third send finds it full, so G1 parks on sendq holding 3.', hl: [2], hot: { g1: 'warn', sq: 'write', 'g1>sq': 'warn' }, sub: { ch: 'cap 2', buf: '[1 2] full', sq: 'G1 holding 3' }, rows: [['len', 2, 'warn'], ['parked', 'G1']] },
      { note: 'A receive takes 1, moves G1’s 3 into the freed slot, and wakes G1.', hl: [3], hot: { g2: 'ok', g1: 'ok', buf: 'write' }, sub: { ch: 'cap 2', buf: '[2 3]', g2: 'got 1' }, rows: [['len', 2], ['parked', 0, 'ok']] },
      { note: 'A buffer absorbs bursts, not a consumer that is always slower. Then it fills and the sender blocks anyway.', hot: { buf: 'warn' }, sub: { ch: 'cap 2', buf: '[2 3]' }, rows: [['rule', 'size buffers for bursts']] },
    ]),
  ],
  select: [
    'select',
    {
      panel: 'select',
      codeTitle: 'worker.go',
      code: ['select {', 'case job := <-jobs:   handle(job)', 'case <-ctx.Done():    return', 'case <-time.After(time.Second): log.Print("idle")', '}'],
      nodes: [
        N('g', 360, 280, 280, 120, 'G (select)', undefined, { detail: D('select', 'Waits on several channel operations and runs exactly one ready case.', 'for {\n  select {\n  case j := <-jobs:\n    handle(j)\n  case <-ctx.Done():\n    return ctx.Err()\n  default: // makes it non-blocking\n  }\n}') }),
        N('jobs', 40, 500, 280, 110, 'jobs', 'chan Job', { detail: D('jobs channel', 'Work arriving from producers. Setting a channel variable to nil disables its case, since a nil channel blocks forever.') }),
        N('done', 360, 500, 280, 110, 'ctx.Done()', 'closed on cancel', { detail: D('ctx.Done()', 'A channel closed when the context is cancelled or times out. A closed channel is always ready, so every waiter wakes.', 'ctx, cancel := context.WithTimeout(ctx, 2*time.Second)\ndefer cancel()') }),
        N('tmr', 680, 500, 280, 110, 'time.After', 'fires once', { detail: D('time.After', 'Returns a channel that receives once after the duration. In a hot loop prefer a reusable time.Timer.') }),
        N('res', 40, 720, 920, 120, 'outcome', 'waiting'),
      ],
      edges: ['jobs>g', 'done>g', 'tmr>g'],
      beats: [
        { note: 'select waits on several channel operations at once.', hl: [0], hot: { g: 'current' }, rows: [['cases', 3]] },
        { note: 'No case is ready, so G parks on all three channels’ wait queues at once.', hot: { jobs: 'warn', done: 'warn', tmr: 'warn' }, sub: { res: 'G asleep on 3 queues' }, rows: [['parked on', 3]] },
        { note: 'A job arrives first: that case runs, and G is removed from the other queues.', hl: [1], hot: { jobs: 'ok', 'jobs>g': 'ok', g: 'ok' }, sub: { res: 'handle(job)' }, rows: [['winner', 'jobs', 'ok']] },
        { note: 'If several cases are ready, Go picks one at random so none starves. A default case makes select non-blocking.', hot: { g: 'current', jobs: 'write', done: 'write' }, sub: { res: 'random among ready' }, rows: [['fairness', 'random']] },
        { note: 'Set jobs to nil and its case can never fire. That is the idiom for switching a case off.', hl: [1], hot: { jobs: 'visited' }, sub: { jobs: 'nil = disabled', res: 'waits on done, timer' }, rows: [['cases live', 2]] },
      ],
    },
  ],
});

// ---------------- GC ----------------
const OBJ = ['A', 'B', 'C', 'D', 'E', 'F'];
const GC_NODES = [
  N('roots', 40, 40, 920, 100, 'roots', 'goroutine stacks · globals', { detail: D('GC roots', 'Where marking starts: every goroutine stack and every global variable.') }),
  ...OBJ.map((o, i) => N(o, 40 + (i % 3) * 320, 230 + Math.floor(i / 3) * 200, 280, 110, o, 'white', { detail: D(`Object ${o}`, 'A heap object. White = not reached yet, grey = reached but children not scanned, black = reached and scanned.') })),
  N('phase', 40, 660, 920, 120, 'phase', 'idle', { detail: D('GC phases', 'Mark setup (short stop-the-world), concurrent mark, mark termination (short stop), then concurrent sweep.', '// GODEBUG=gctrace=1 ./app\ngc 7 @2.1s 3%: 0.02+1.3+0.01 ms clock,\n  12->13->6 MB, 14 MB goal, 8 P\n// STW + concurrent mark + STW') }),
  N('mut', 40, 840, 920, 120, 'mutator', 'your goroutines keep running', { detail: D('Mutator', 'GC jargon for your program. Go’s GC runs alongside it, taking about 25% of CPU while marking.') }),
];
const col = (m: Record<string, 'white' | 'grey' | 'black' | 'freed'>) => ({
  hot: Object.fromEntries(Object.entries(m).map(([k, v]) => [k, (v === 'grey' ? 'warn' : v === 'black' ? 'accent' : v === 'freed' ? 'fail' : 'default') as Tone])),
  sub: Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v])),
});
const merge = (a: ReturnType<typeof col>, hot: Record<string, Tone> = {}, sub: Record<string, string> = {}) => ({ hot: { ...a.hot, ...hot }, sub: { ...a.sub, ...sub } });

demo('go-gc', 'Garbage collector', 'Concurrent tri-colour mark & sweep, the write barrier, and GOGC / GOMEMLIMIT pacing.', {
  tricolor: [
    'Tri-colour marking',
    {
      panel: 'GC',
      nodes: GC_NODES,
      edges: ['roots>A', 'roots>C', 'A>B', 'A>D', 'C>F'],
      beats: [
        { note: 'Every object starts white. Marking finds what the roots can reach.', ...merge(col({ A: 'white', B: 'white', C: 'white', D: 'white', E: 'white', F: 'white' }), { phase: 'current' }, { phase: 'mark start' }), rows: [['white', 6]] },
        { note: 'Objects the roots point to turn grey: reached, children not yet scanned.', ...merge(col({ A: 'grey', C: 'grey' }), { 'roots>A': 'accent', 'roots>C': 'accent' }, { phase: 'concurrent mark' }), rows: [['grey', 2], ['white', 4]] },
        { note: 'Scanning A greys its children B and D, and A turns black.', ...merge(col({ A: 'black', B: 'grey', C: 'grey', D: 'grey' }), { 'A>B': 'accent', 'A>D': 'accent' }, { phase: 'concurrent mark' }), rows: [['black', 1], ['grey', 3]] },
        { note: 'Repeat until nothing is grey. Every black object is live.', ...merge(col({ A: 'black', B: 'black', C: 'black', D: 'black', F: 'black' }), { 'C>F': 'accent' }, { phase: 'mark termination' }), rows: [['black', 5], ['white', 1]] },
        { note: 'E is still white, so nothing reaches it and the sweep frees its memory.', ...merge(col({ A: 'black', B: 'black', C: 'black', D: 'black', F: 'black', E: 'freed' }), { phase: 'ok' }, { phase: 'sweep', E: 'white → freed' }), rows: [['freed', 1, 'ok']] },
      ],
    },
  ],
  barrier: [
    'Write barrier',
    {
      panel: 'GC',
      nodes: GC_NODES,
      edges: ['roots>A', 'roots>C', 'A>B', 'A>D', 'C>F', 'A>E'],
      beats: [
        { note: 'Marking runs concurrently with your code. A is black, C is grey, E is still white.', ...merge(col({ A: 'black', B: 'grey', C: 'grey', D: 'grey', E: 'white', F: 'white' }), { mut: 'current' }, { phase: 'concurrent mark' }), hide: ['A>E'], rows: [['GC CPU', '~25%']] },
        { note: 'Your code stores a pointer to E into black A.', ...merge(col({ A: 'black', B: 'grey', C: 'grey', D: 'grey', E: 'white', F: 'white' }), { 'A>E': 'accent', mut: 'write' }, { mut: 'a.child = e' }), rows: [['new pointer', 'A → E']] },
        { note: 'Black objects are never rescanned, so without help E would be freed while still in use.', ...merge(col({ A: 'black', B: 'grey', C: 'grey', D: 'grey', E: 'freed', F: 'white' }), { 'A>E': 'fail' }, { E: 'would be freed' }), rows: [['bug', 'use after free', 'fail']] },
        { note: 'The write barrier shades E grey during that pointer store, so marking still reaches it.', ...merge(col({ A: 'black', B: 'grey', C: 'grey', D: 'grey', E: 'grey', F: 'white' }), { 'A>E': 'ok', mut: 'current' }, { E: 'grey (barrier)', mut: 'write barrier on' }), rows: [['barrier', 'on while marking']] },
        { note: 'E ends up black and survives. The price is a few instructions on each pointer write during GC.', ...merge(col({ A: 'black', B: 'black', C: 'black', D: 'black', E: 'black', F: 'black' }), { phase: 'ok' }, { phase: 'mark done' }), rows: [['freed', 0, 'ok']] },
      ],
    },
  ],
  pacing: [
    'GOGC & GOMEMLIMIT',
    {
      panel: 'Pacer',
      nodes: [
        N('live', 40, 60, 440, 130, 'live heap', '50 MB', { detail: D('Live heap', 'What survived the last GC. The next goal is computed from it.') }),
        N('goal', 520, 60, 440, 130, 'GC goal', '100 MB (GOGC=100)', { detail: D('GOGC', 'Next GC starts when the heap reaches live × (1 + GOGC/100). GOGC=off disables it.', 'GOGC=200 ./app          # fewer GCs, more RAM\ndebug.SetGCPercent(50)  // more GCs, less RAM') }),
        N('alloc', 40, 290, 920, 130, 'allocated since GC', '0 MB'),
        N('lim', 40, 520, 920, 130, 'GOMEMLIMIT', 'unset', { detail: D('GOMEMLIMIT', 'A soft memory cap (Go 1.19+). As the heap nears it, GC runs more often regardless of GOGC.', 'GOMEMLIMIT=400MiB ./app\n// or: debug.SetMemoryLimit(400 << 20)') }),
        N('cpu', 40, 750, 920, 130, 'GC CPU', 'idle'),
      ],
      edges: ['live>goal', 'alloc>lim'],
      beats: [
        { note: 'After a GC, 50 MB is live. With GOGC=100, the next cycle is due when the heap doubles.', hot: { live: 'current', goal: 'write' }, rows: [['next GC at', '100 MB']] },
        { note: 'Your program allocates and the heap grows toward the goal.', hot: { alloc: 'write' }, sub: { alloc: '40 MB' }, rows: [['heap', '90 MB']] },
        { note: 'The pacer starts marking early so the cycle finishes before the heap overshoots.', hot: { goal: 'warn', cpu: 'current' }, sub: { alloc: '45 MB', cpu: '~25% while marking' }, rows: [['heap', '95 MB', 'warn']] },
        { note: 'GOGC=200 means fewer cycles and more memory. GOGC=50 means the opposite.', hot: { goal: 'current' }, sub: { goal: '150 MB (GOGC=200)' }, rows: [['trade-off', 'CPU vs RAM']] },
        { note: 'In a container, set GOMEMLIMIT a bit below the limit so GC works harder instead of the process being OOM-killed.', hot: { lim: 'ok' }, sub: { lim: '400 MiB soft cap' }, rows: [['container limit', '512 MiB']] },
      ],
    },
  ],
});

// ---------------- escape analysis & stacks ----------------
traceDemo('go-escape', 'Escape analysis & growable stacks', 'Values stay on the goroutine stack unless they escape; stacks start at 2 KB and grow by copying.', {
  stack: [
    'Stays on the stack',
    {
      codeTitle: 'main.go',
      code: ['func add(a, b int) int {', '  s := a + b   // stays on the stack', '  return s', '}', 'func main() {', '  x := add(2, 3)', '  fmt.Println(x)', '}'],
      details: { s: D('Local on the stack', 'The compiler proved s doesn’t outlive add, so it lives in the frame and costs the GC nothing.', '$ go build -gcflags=-m\n./main.go:2: s does not escape') },
      steps: [
        { note: 'main calls add. x will live in main’s stack frame.', line: 5, vars: [['x', '?']], out: '' },
        { note: 'add gets its own frame holding a, b and s. No heap allocation at all.', line: 1, vars: [['x', '?'], ['a', '2'], ['b', '3'], ['s', '5', 'write']], out: '' },
        { note: 'add returns; its frame is simply popped.', line: 2, vars: [['x', '5', 'write']], out: '' },
        { note: 'Stack values are free to allocate and free to discard. Nothing for the GC to track.', line: 6, vars: [['x', '5']], out: '5' },
      ],
    },
  ],
  escape: [
    'Escapes to the heap',
    {
      codeTitle: 'main.go',
      code: ['type User struct{ Name string }', 'func newUser(n string) *User {', '  u := User{Name: n}', '  return &u     // u escapes', '}', 'func main() {', '  p := newUser("ana")', '  fmt.Println(p.Name)', '}'],
      details: {
        u: D('Escaped value', 'Returning &u means u must outlive newUser, so the compiler allocates it on the heap. Legal in Go, unlike C.', '$ go build -gcflags=-m\n./main.go:3: moved to heap: u'),
        p: D('Pointer', 'p holds the heap address. When no pointer reaches the object any more, the GC frees it.'),
      },
      steps: [
        { note: 'In C, returning the address of a local is a bug. The Go compiler instead checks whether u outlives newUser.', line: [2, 3], vars: [['n', '"ana"']], out: '' },
        { note: 'It does, so escape analysis puts u on the heap.', line: 2, vars: [['n', '"ana"']], heap: [['u', 'User{Name: "ana"}', 'write', 'moved to heap']], out: '' },
        { note: 'main’s p points to the heap object after newUser’s frame is gone.', line: 6, vars: [['p', '0xc000010250', 'accent', 'u']], heap: [['u', 'User{Name: "ana"}', 'read']], out: '' },
        { note: 'Fewer escapes mean less GC work. Check with go build -gcflags=-m.', line: 7, vars: [['p', '0xc000010250', 'accent', 'u']], heap: [['u', 'User{Name: "ana"}', 'read']], out: 'ana' },
      ],
    },
  ],
  growth: [
    'Stack growth',
    {
      codeTitle: 'main.go',
      heapTitle: 'goroutine stack',
      code: ['func depth(n int) int {', '  var buf [512]byte // ~560 B per frame', '  if n == 0 { return 0 }', '  return 1 + depth(n-1)', '}', 'go depth(10)  // starts with a 2 KB stack'],
      details: { s1: D('Goroutine stack', 'Starts at 2 KB and lives on the heap. Grows by doubling and copying; can shrink during GC.'), s2: D('Grown stack', 'The runtime allocated twice the space, copied every frame, and fixed up pointers into the stack.') },
      steps: [
        { note: 'A new goroutine gets a 2 KB stack, not the 1 MB or more an OS thread reserves.', line: 5, vars: [['n', '10']], heap: [['s1', 'stack 2 KB', 'ok', '0 / 2048 B used']] },
        { note: 'Each call needs about 560 bytes, so the fourth frame won’t fit.', line: 3, vars: [['n', '7']], heap: [['s1', 'stack 2 KB', 'warn', '1680 / 2048 B used']] },
        { note: 'The function prologue sees the limit, and the runtime allocates a 4 KB stack and copies all frames over.', line: 0, vars: [['n', '7']], heap: [['s1', 'old 2 KB', 'visited', 'freed'], ['s2', 'stack 4 KB', 'write', '2240 / 4096 B used']] },
        { note: 'Pointers into the stack are fixed up during the copy, which is why Go never lets C keep one. Deep recursion just keeps doubling.', line: 3, vars: [['n', '3']], heap: [['s2', 'stack 8 KB', 'write', '4480 / 8192 B used']] },
      ],
    },
  ],
});

// ---------------- interfaces, errors, defer ----------------
demo('go-iface', 'Interfaces, nil & errors', 'Interface values as (itab, data) pairs, the typed-nil gotcha, and defer / panic / recover.', {
  itab: [
    'itab & dispatch',
    {
      panel: 'Interface',
      codeTitle: 'main.go',
      code: ['type Shape interface{ Area() float64 }', 'type Circle struct{ R float64 }', 'func (c Circle) Area() float64 { return 3.14 * c.R * c.R }', 'var s Shape = Circle{R: 2}', 'fmt.Println(s.Area())'],
      nodes: [
        N('iv', 40, 260, 440, 120, 'interface value s', '2 words', { detail: D('Interface value', 'Two machine words: tab (type and methods) and data (pointer to the value). An empty interface (any) stores the type instead of an itab.', 'var s Shape = Circle{R: 2}\nfmt.Printf("%T\\n", s) // main.Circle') }),
        N('tab', 40, 450, 440, 110, 'tab *itab'),
        N('data', 40, 620, 440, 110, 'data pointer'),
        N('itab', 520, 450, 440, 120, 'itab(Shape, Circle)', 'type · hash · fun[0]', { detail: D('itab', 'Built once per (interface, concrete type) pair and cached. fun[] holds the method pointers in interface order.') }),
        N('obj', 520, 620, 440, 110, 'Circle{R: 2}', 'copied'),
        N('fn', 520, 800, 440, 110, 'Circle.Area', 'machine code'),
      ],
      edges: ['iv>tab', 'tab>itab', 'data>obj', 'itab>fn'],
      beats: [
        { note: 'An interface value is two words: a pointer to an itab and a pointer to the data.', hl: [3], hot: { iv: 'current' }, rows: [['size', '16 B']] },
        { note: 'The itab pairs Shape with Circle and caches Circle’s method pointers. It is built once per pair and reused.', hot: { tab: 'current', itab: 'write', 'tab>itab': 'accent' }, rows: [['methods', 1]] },
        { note: 'Assigning Circle{R: 2} copies the value to memory the data word points at.', hot: { data: 'current', obj: 'write', 'data>obj': 'accent' }, rows: [['copy', 'yes']] },
        { note: 's.Area() loads fun[0] from the itab and calls it with the data pointer. One indirect call, like a C++ vtable.', hl: [4], hot: { itab: 'current', fn: 'ok', 'itab>fn': 'accent' }, rows: [['dispatch', 'indirect call']] },
        { note: 'Circle never declares that it implements Shape. Having the methods is enough.', hl: [2], hot: { fn: 'ok' }, rows: [['implements', 'implicitly', 'ok']] },
      ],
    },
  ],
  nilgotcha: [
    'Typed nil gotcha',
    {
      panel: 'Interface',
      codeTitle: 'main.go',
      code: ['type MyErr struct{}', 'func (*MyErr) Error() string { return "boom" }', 'func find() error {', '  var p *MyErr = nil', '  return p          // non-nil error!', '}', 'if err := find(); err != nil { /* taken */ }'],
      nodes: [
        N('iv', 40, 330, 440, 120, 'err (interface)', undefined, { detail: D('error interface', 'error is an interface, so it has a type word and a data word.') }),
        N('tab', 40, 510, 440, 110, 'type word', '—'),
        N('data', 40, 680, 440, 110, 'data word', '—'),
        N('cmp', 520, 330, 440, 120, 'err != nil', '?', { detail: D('Interface nil check', 'True unless both words are nil. A nil pointer of some concrete type still sets the type word.') }),
        N('fix', 520, 680, 440, 110, 'fix', 'return nil', { detail: D('Fix', 'Return a literal nil on the success path.', 'func find() error {\n  if notFound {\n    return &MyErr{}\n  }\n  return nil // not a typed nil pointer\n}') }),
      ],
      edges: ['iv>tab', 'tab>data'],
      beats: [
        { note: 'find returns a nil *MyErr through the error interface.', hl: [3, 4], hot: { iv: 'current' }, rows: [['p', 'nil']] },
        { note: 'The interface gets a type word of *MyErr and a nil data word.', hot: { tab: 'write', data: 'write' }, sub: { tab: '*MyErr', data: 'nil' }, rows: [['type', '*MyErr']] },
        { note: 'An interface is nil only if both words are nil, so err != nil is true.', hl: [6], hot: { cmp: 'fail' }, sub: { tab: '*MyErr', data: 'nil', cmp: 'true' }, rows: [['bug', 'error on success', 'fail']] },
        { note: 'Return a literal nil for the success path, never a typed nil pointer.', hot: { fix: 'ok', cmp: 'ok' }, sub: { tab: 'nil', data: 'nil', cmp: 'false' }, rows: [['fixed', 'yes', 'ok']] },
      ],
    },
  ],
  defer: [
    'defer, panic, recover',
    {
      panel: 'Errors',
      codeTitle: 'load.go',
      code: ['func load(f *os.File) (err error) {', '  defer func() {', '    if r := recover(); r != nil { err = wrap(r) }', '  }()', '  defer f.Close()', '  panic("bad header")', '}'],
      nodes: [
        N('d2', 40, 330, 440, 110, 'defer f.Close()', 'pushed 2nd', { detail: D('defer', 'Schedules a call for when the function returns, even by panic. Arguments are evaluated immediately.', 'f, err := os.Open(p)\nif err != nil {\n  return err\n}\ndefer f.Close()') }),
        N('d1', 40, 500, 440, 110, 'defer recover()', 'pushed 1st', { detail: D('recover', 'Only works inside a deferred function. Stops the panic and returns its value.') }),
        N('pan', 520, 330, 440, 110, 'panic', 'idle', { detail: D('panic', 'Unwinds the stack, running deferred calls. Unrecovered, it crashes the program with a stack trace.') }),
        N('ret', 520, 500, 440, 110, 'return', '—'),
        N('err', 40, 700, 920, 120, 'errors are values', 'if err != nil { return fmt.Errorf("load: %w", err) }', { detail: D('Errors are values', 'Ordinary failures return error. Wrap with %w and inspect with errors.Is / errors.As.', 'if err := load(f); err != nil {\n  if errors.Is(err, fs.ErrNotExist) {\n    return nil\n  }\n  return fmt.Errorf("init: %w", err)\n}') }),
      ],
      edges: ['pan>d2', 'd2>d1', 'd1>ret'],
      beats: [
        { note: 'Each defer pushes a call onto the function’s defer stack. They run last in, first out.', hl: [1, 4], hot: { d1: 'write', d2: 'write' }, rows: [['deferred', 2]] },
        { note: 'panic starts unwinding, and deferred calls still run, newest first: f.Close().', hl: [5], hot: { pan: 'fail', d2: 'current', 'pan>d2': 'fail' }, sub: { pan: '"bad header"' }, rows: [['state', 'panicking', 'fail']] },
        { note: 'The deferred closure calls recover, which stops the panic and turns it into err.', hl: [2], hot: { d1: 'ok', 'd2>d1': 'accent' }, sub: { pan: 'recovered' }, rows: [['state', 'recovered', 'ok']] },
        { note: 'load returns normally with err set. Panics are for bugs; ordinary failures return error values.', hot: { ret: 'ok', err: 'current', 'd1>ret': 'accent' }, sub: { ret: 'err = bad header', pan: 'recovered' }, rows: [['returned', 'error']] },
      ],
    },
  ],
});

// ---------------- packages & imports ----------------
const PKG_NODES = [
  N('mod', 355, 40, 290, 110, 'go.mod', 'example.com/app', { detail: D('go.mod', 'Marks the module root and names it; that path prefixes every import of its packages.', 'module example.com/app\n\ngo 1.22\n\nrequire github.com/lib/pq v1.10.9') }),
  N('cmd', 40, 230, 290, 110, 'cmd/app', 'package main', { detail: D('package main', 'A directory whose package is main builds a binary. go build ./cmd/app', 'package main\n\nimport "example.com/app/api"\n\nfunc main() { api.Serve(":8080") }') }),
  N('api', 355, 230, 290, 110, 'api/', 'package api', { detail: D('package api', 'All .go files in one directory form one package. Capitalised names are exported.', 'package api\n\nfunc Serve(addr string) error {} // exported\nfunc route() {}                  // private') }),
  N('store', 670, 230, 290, 110, 'internal/store', 'package store', { detail: D('internal/', 'Packages under internal/ can be imported only from the tree rooted at internal’s parent.', '// ok:   example.com/app/api\n// fail: example.com/other\n//   use of internal package not allowed') }),
  N('other', 670, 420, 290, 110, 'other module', 'example.com/x'),
  N('res', 40, 620, 920, 140, 'rules', 'package = directory'),
  N('init', 40, 820, 920, 140, 'init order', '—', { detail: D('Initialisation order', 'Imported packages initialise first. Within a package, var initialisers run in dependency order, then init() functions in file order. main runs last.', 'package store\n\nvar db = mustOpen() // 1\n\nfunc init() {       // 2\n  log.Print("store ready")\n}') }),
];
const pkg = (beats: Board['beats']): Board => ({ panel: 'Packages', nodes: PKG_NODES, edges: ['mod>cmd', 'mod>api', 'mod>store', 'cmd>api', 'api>store', 'other>store'], beats });

demo('go-packages', 'Packages & imports', 'Package = directory, exported capitals, internal/, no import cycles, and init order.', {
  layout: [
    'Layout & exports',
    pkg([
      { note: 'A package is one directory. A module is a tree of packages with go.mod at the root.', hot: { mod: 'current', 'mod>cmd': 'accent', 'mod>api': 'accent', 'mod>store': 'accent' }, hide: ['other', 'other>store', 'cmd>api', 'api>store', 'init'], rows: [['packages', 3]] },
      { note: 'cmd/app imports example.com/app/api, the module path plus the directory.', hot: { cmd: 'current', api: 'write', 'cmd>api': 'accent' }, sub: { res: 'import "example.com/app/api"' }, hide: ['other', 'other>store', 'api>store', 'init'], rows: [['import path', 'module + dir']] },
      { note: 'Only names starting with a capital letter are visible outside the package.', hot: { api: 'current' }, sub: { res: 'api.Serve ✓   api.route ✗' }, hide: ['other', 'other>store', 'api>store', 'init'], rows: [['exported', 'Capitalised']] },
      { note: 'No header files and no forward declarations. The compiler reads the imported package’s export data.', hot: { res: 'ok' }, sub: { res: 'go build ./...' }, hide: ['other', 'other>store', 'api>store', 'init'], rows: [['headers', 0, 'ok']] },
    ]),
  ],
  internal: [
    'internal/ & cycles',
    pkg([
      { note: 'api imports internal/store, which is allowed because both live under example.com/app.', hot: { api: 'current', store: 'ok', 'api>store': 'accent' }, hide: ['init', 'cmd>api'], rows: [['import', 'allowed', 'ok']] },
      { note: 'Another module importing internal/store fails to compile. internal is how you keep code private to your module.', hot: { other: 'fail', 'other>store': 'fail' }, sub: { res: 'use of internal package not allowed' }, hide: ['init', 'cmd>api'], rows: [['import', 'rejected', 'fail']] },
      { note: 'If store also imported api, the build stops with an import cycle. Go forbids cycles outright.', hot: { 'api>store': 'fail', api: 'fail', store: 'fail' }, sub: { res: 'import cycle not allowed' }, hide: ['init', 'cmd>api', 'other', 'other>store'], rows: [['cycles', 'forbidden', 'fail']] },
      { note: 'Fix by moving the shared types into a lower package, or by having store define a small interface that api implements.', hot: { store: 'ok', api: 'ok' }, sub: { res: 'store declares interface Notifier' }, hide: ['init', 'cmd>api', 'other', 'other>store'], rows: [['cycles', 0, 'ok']] },
    ]),
  ],
  init: [
    'init order',
    pkg([
      { note: 'Before main runs, every imported package is initialised exactly once.', hot: { init: 'current' }, sub: { init: 'store → api → main' }, hide: ['other', 'other>store'], rows: [['order', 'dependencies first']] },
      { note: 'store goes first because api imports it: package vars, then its init functions.', hot: { store: 'write', 'api>store': 'accent' }, sub: { init: '1. store vars, init()' }, hide: ['other', 'other>store'], rows: [['step', 1]] },
      { note: 'Then api, then main’s own vars and init, and finally main().', hot: { api: 'write', cmd: 'ok' }, sub: { init: '2. api   3. main   4. main()' }, hide: ['other', 'other>store'], rows: [['step', 4]] },
      { note: 'Keep init light: no network calls and no failure paths. Explicit constructors are easier to test.', hot: { init: 'warn' }, sub: { init: 'prefer store.Open(cfg)' }, hide: ['other', 'other>store'], rows: [['advice', 'avoid heavy init()', 'warn']] },
    ]),
  ],
});

// ---------------- modules ----------------
demo('go-modules', 'Modules & dependencies', 'go.mod requirements, minimal version selection, go.sum, GOPROXY and the checksum database, replace and vendoring.', {
  mvs: [
    'Minimal version selection',
    {
      panel: 'Modules',
      nodes: [
        N('app', 355, 40, 290, 110, 'app', 'go.mod', { detail: D('Requirements', 'go.mod lists minimum versions, including indirect ones.', 'require (\n  example.com/a v1.2.0\n  example.com/b v1.1.0\n  example.com/c v1.4.0 // indirect\n)') }),
        N('a', 40, 230, 290, 110, 'A v1.2.0'),
        N('b', 670, 230, 290, 110, 'B v1.1.0'),
        N('c13', 40, 420, 290, 110, 'C ≥ v1.3.0'),
        N('c14', 670, 420, 290, 110, 'C ≥ v1.4.0'),
        N('pick', 355, 610, 290, 110, 'build list', '?', { detail: D('Build list', 'The one version of each module used for the build.', '$ go list -m all\nexample.com/app\nexample.com/a v1.2.0\nexample.com/b v1.1.0\nexample.com/c v1.4.0') }),
        N('sum', 40, 800, 920, 120, 'go.sum', 'hash of every module version', { detail: D('go.sum', 'Cryptographic hashes for each module version and its go.mod. Commit it.', 'example.com/c v1.4.0 h1:3qT1...=\nexample.com/c v1.4.0/go.mod h1:Zx9...=') }),
      ],
      edges: ['app>a', 'app>b', 'a>c13', 'b>c14', 'c13>pick', 'c14>pick'],
      beats: [
        { note: 'app requires A v1.2.0 and B v1.1.0.', hot: { app: 'current', a: 'write', b: 'write' }, rows: [['direct', 2]] },
        { note: 'A needs at least C v1.3.0, and B needs at least C v1.4.0.', hot: { c13: 'warn', c14: 'warn', 'a>c13': 'accent', 'b>c14': 'accent' }, rows: [['C wanted', 'v1.3, v1.4']] },
        { note: 'Minimal version selection takes the highest of those minimums, C v1.4.0, and never a newer release nobody asked for.', hot: { pick: 'ok', 'c14>pick': 'ok' }, sub: { pick: 'C v1.4.0' }, rows: [['C chosen', 'v1.4.0', 'ok']] },
        { note: 'So builds are reproducible without a separate lock file. go.sum adds a hash per version to catch tampering.', hot: { sum: 'current' }, sub: { pick: 'C v1.4.0' }, rows: [['lock file', 'not needed']] },
        { note: 'go get example.com/c@v1.5.0 raises the minimum, and go mod tidy removes requirements you no longer use.', hot: { app: 'write' }, sub: { pick: 'C v1.5.0' }, rows: [['upgrade', 'explicit only']] },
      ],
    },
  ],
  proxy: [
    'Proxy, sumdb, replace, vendor',
    {
      panel: 'Downloads',
      nodes: [
        N('dev', 40, 40, 290, 110, 'go build', 'needs C v1.4.0'),
        N('cache', 355, 40, 290, 110, 'module cache', '$GOPATH/pkg/mod', { detail: D('Module cache', 'Read-only, shared by every project on the machine.', 'go env GOMODCACHE\ngo clean -modcache  # wipe it') }),
        N('proxy', 670, 40, 290, 110, 'GOPROXY', 'proxy.golang.org', { detail: D('GOPROXY', 'A cache of public module zips. Faster than cloning, and a module stays available if its repo disappears.', 'go env -w GOPROXY=https://proxy.golang.org,direct') }),
        N('sumdb', 355, 230, 290, 110, 'GOSUMDB', 'sum.golang.org', { detail: D('Checksum database', 'A public, append-only log of module hashes. A tag re-pushed with different code is detected.') }),
        N('vcs', 670, 230, 290, 110, 'source repo', 'github.com/…'),
        N('rep', 40, 440, 290, 110, 'replace', '=> ../c-fork', { detail: D('replace', 'Points a module path at a local directory or another version. Only honoured in the main module.', 'replace example.com/c => ../c-fork') }),
        N('vend', 355, 440, 290, 110, 'vendor/', 'go mod vendor', { detail: D('Vendoring', 'Copies all dependencies into vendor/ so builds need no network.', 'go mod vendor\ngo build -mod=vendor ./...') }),
        N('priv', 670, 440, 290, 110, 'GOPRIVATE', 'corp.com/*', { detail: D('GOPRIVATE', 'Module paths fetched directly from source and never checked against the public sumdb.', 'go env -w GOPRIVATE=corp.example.com/*') }),
        N('graph', 40, 660, 920, 130, 'inspect', 'go mod graph · go mod why', { detail: D('Inspecting dependencies', 'See who requires what, and why a module is in your build.', '$ go mod why example.com/c\n# example.com/c\nexample.com/app\nexample.com/b\nexample.com/c') }),
      ],
      edges: ['dev>cache', 'cache>proxy', 'proxy>vcs', 'proxy>sumdb'],
      beats: [
        { note: 'go build needs C v1.4.0, which isn’t in the module cache yet.', hot: { dev: 'current', cache: 'warn', 'dev>cache': 'accent' }, hide: ['rep', 'vend', 'priv', 'graph'], rows: [['cache', 'miss', 'warn']] },
        { note: 'It asks GOPROXY, which fetched the module from its source repo once and serves the same zip to everyone.', hot: { proxy: 'current', vcs: 'visited', 'cache>proxy': 'accent', 'proxy>vcs': 'accent' }, hide: ['rep', 'vend', 'priv', 'graph'], rows: [['source', 'proxy']] },
        { note: 'The hash is checked against the public checksum database, so a silently changed tag is caught.', hot: { sumdb: 'ok', 'proxy>sumdb': 'accent' }, hide: ['rep', 'vend', 'priv', 'graph'], rows: [['verified', 'yes', 'ok']] },
        { note: 'The zip lands read-only in the module cache, shared by every project.', hot: { cache: 'ok', dev: 'ok' }, hide: ['rep', 'vend', 'priv', 'graph'], rows: [['cache', 'hit next time', 'ok']] },
        { note: 'replace points at a local fork, vendor/ copies deps into the repo, and GOPRIVATE skips the proxy for company code.', hot: { rep: 'current', vend: 'current', priv: 'current', graph: 'write' }, rows: [['tools', 'replace, vendor, GOPRIVATE']] },
      ],
    },
  ],
});
