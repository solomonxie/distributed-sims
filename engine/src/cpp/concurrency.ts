// Concurrency (group cpp-concurrency): threads, races & mutexes, deadlock, condition variables, futures, pools, atomics, shared_mutex, design.
import type { Detail, Frame, Tone } from '../algo/frames';
import { machineDemo } from '../machine/lib/draw';
import { boardFrames, N } from '../machine/lib/board';
import type { Board } from '../machine/lib/board';
import { traceFrames } from '../machine/lib/trace';
import type { Trace } from '../machine/lib/trace';
import { Mem } from '../machine/lib/mem';

const G = 'cpp-concurrency';
const all = (ids: string[], tone: Tone) => Object.fromEntries(ids.map((id) => [id, tone]));

const D: Record<string, Detail> = {
  'thread A': { title: 'std::thread', text: 'A thread of execution with its own stack, sharing the heap and globals with every other thread. It starts running as soon as it is constructed.', code: '#include <thread>\n\nstd::thread a([] { work(); });\na.join();  // wait for it to finish' },
  'thread B': { title: 'std::thread', text: 'The OS scheduler decides when each thread runs and on which core. You can’t predict the interleaving.', code: 'std::thread b(work);\nstd::cout << b.get_id();\nb.join();' },
  counter: { title: 'Shared variable', text: 'A plain int that two threads write without synchronisation. That is a data race, which is undefined behaviour.', code: 'int counter = 0;  // shared, unprotected\n\nvoid work() {\n  for (int i = 0; i < 1000000; ++i)\n    ++counter;  // load, add, store\n}' },
  'std::mutex': { title: 'std::mutex', text: 'Only one thread can hold it. Others calling lock() block until it is unlocked. Always lock through an RAII guard.', code: 'std::mutex m;\n\nvoid work() {\n  std::lock_guard lk(m);  // lock\n  ++counter;\n}                          // unlock' },
  'std::atomic': { title: 'std::atomic<int>', text: 'Each operation is indivisible. fetch_add compiles to one lock xadd on x86, no mutex needed.', code: 'std::atomic<int> counter{0};\n\ncounter.fetch_add(1, std::memory_order_relaxed);\nint n = counter.load();' },
  result: { title: 'Result', text: 'What the program prints after both threads join.', code: 'a.join(); b.join();\nstd::cout << counter << "\\n";' },
  m1: { title: 'Mutex m1', text: 'Protects account 1. Deadlock happens when two threads take m1 and m2 in opposite order.', code: 'std::mutex m1, m2;\n\n// thread A          // thread B\nm1.lock();           m2.lock();\nm2.lock(); // waits  m1.lock(); // waits' },
  m2: { title: 'Mutex m2', text: 'Protects account 2. A global lock order (always m1 before m2) makes the cycle impossible.', code: 'void transfer(Acct& a, Acct& b, int n) {\n  std::scoped_lock lk(a.m, b.m);  // both, no deadlock\n  a.bal -= n;\n  b.bal += n;\n}' },
  producer: { title: 'Producer', text: 'Pushes work into the queue under the mutex, then notifies one waiting consumer.', code: '{\n  std::lock_guard lk(m);\n  q.push(job);\n}\ncv.notify_one();' },
  consumer: { title: 'Consumer', text: 'Waits on the condition variable with a predicate, so spurious wakeups and missed notifies are handled.', code: 'std::unique_lock lk(m);\ncv.wait(lk, [&] { return !q.empty() || stop; });\nif (stop && q.empty()) return;\nJob j = std::move(q.front());\nq.pop();\nlk.unlock();\nj();' },
  queue: { title: 'Shared queue', text: 'A std::queue guarded by a mutex. Bound its size so a fast producer can’t grow it without limit.', code: 'std::mutex m;\nstd::condition_variable cv;\nstd::queue<Job> q;\nbool stop = false;' },
  condvar: { title: 'std::condition_variable', text: 'Lets a thread sleep until another thread changes shared state. Always used with a mutex and a predicate.', code: 'cv.wait(lk, pred);  // loop: while (!pred()) wait\ncv.notify_one();\ncv.notify_all();' },
  promise: { title: 'std::promise', text: 'The write end of a one-shot channel. set_value or set_exception exactly once.', code: 'std::promise<int> p;\nstd::future<int> f = p.get_future();\nstd::thread t([&p] { p.set_value(42); });\nstd::cout << f.get();  // 42\nt.join();' },
  future: { title: 'std::future', text: 'The read end. get() blocks until the value is ready, and rethrows if the producer stored an exception.', code: 'std::future<int> f = std::async(compute);\n// ... other work ...\nint v = f.get();  // waits, may throw' },
  'std::async': { title: 'std::async', text: 'Runs a callable and returns a future. With launch::async it gets its own thread; the default may defer it until get().', code: 'auto f = std::async(std::launch::async,\n                    [] { return load(); });\nauto v = f.get();' },
  packaged_task: { title: 'std::packaged_task', text: 'Wraps a callable so that calling it fills a future. The building block for thread pools that return results.', code: 'std::packaged_task<int()> t(compute);\nauto f = t.get_future();\npool.post(std::move(t));\nint v = f.get();' },
  'work queue': { title: 'Work queue', text: 'Tasks wait here until a worker is free. One queue with N workers keeps all cores busy without creating a thread per task.', code: 'std::queue<std::function<void()>> tasks;\nstd::mutex m;\nstd::condition_variable cv;' },
  worker: { title: 'Worker thread', text: 'Loops forever: wait for a task, run it, repeat. Exits when stop is set and the queue is empty.', code: 'for (;;) {\n  std::function<void()> job;\n  {\n    std::unique_lock lk(m);\n    cv.wait(lk, [&] { return stop || !tasks.empty(); });\n    if (stop && tasks.empty()) return;\n    job = std::move(tasks.front());\n    tasks.pop();\n  }\n  job();\n}' },
  'cache line': { title: 'Cache line (64 B)', text: 'Cores share memory in 64-byte lines. Two hot variables in one line make cores fight over it even if they never touch the same variable.', code: 'struct Stats {\n  alignas(64) std::atomic<long> a;\n  alignas(64) std::atomic<long> b;\n};  // one line each' },
  'shared_mutex': { title: 'std::shared_mutex', text: 'Many readers or one writer. Readers use shared_lock, writers use unique_lock.', code: 'std::shared_mutex rw;\n\nint get(K k) {\n  std::shared_lock lk(rw);\n  return map.at(k);\n}\nvoid put(K k, int v) {\n  std::unique_lock lk(rw);\n  map[k] = v;\n}' },
  snapshot: { title: 'Immutable snapshot', text: 'Readers grab a shared_ptr to a const config and use it without locks. A writer builds a new one and swaps the pointer.', code: 'std::atomic<std::shared_ptr<const Cfg>> cur;\n\nauto c = cur.load();      // reader\nauto n = std::make_shared<Cfg>(*c);\nn->limit = 10;\ncur.store(n);             // writer' },
  'shared state': { title: 'Shared state', text: 'A heap block owned jointly by the promise and future: the value or exception, a ready flag, and a way to wake get().', code: 'auto f = p.get_future();  // allocates it\np.set_value(1);           // fills + notifies' },
  'main thread': { title: 'Main thread', text: 'The thread running main(). When main returns, the process exits and any threads still running are killed.', code: 'int main() {\n  std::thread t(work);\n  t.join();  // before returning!\n}' },
  cfg: { title: 'Plain data being published', text: 'Ordinary memory written before the flag. Only a release/acquire pair guarantees the reader sees it complete.', code: 'cfg = new Config{...};\nready.store(true, std::memory_order_release);' },
  ready: { title: 'Atomic flag', text: 'The signal the reader polls. The acquire load synchronises with the release store.', code: 'while (!ready.load(std::memory_order_acquire))\n  std::this_thread::yield();\nuse(cfg);' },
  max: { title: 'Atomic max', text: 'Updated with a compare_exchange loop. On failure, cur is refreshed with the current value.', code: 'int cur = m.load();\nwhile (cur < v &&\n       !m.compare_exchange_weak(cur, v)) {}' },
  'routing table': { title: 'Read-mostly data', text: 'Looked up constantly, changed rarely. The ideal case for a shared_mutex or copy-on-write snapshot.', code: 'std::unordered_map<std::string, Route> routes;' },
  'owner thread': { title: 'Owner thread (actor)', text: 'The only thread that touches the state, handling one message at a time.', code: 'for (;;) {\n  Msg m = inbox.pop();  // blocks\n  std::visit(handler, m);\n}' },
  'account state': { title: 'Shared mutable object', text: 'Touched by several threads, so every access needs the same mutex. Easy to get wrong as code grows.', code: 'struct Account {\n  std::mutex m;\n  long balance;\n};' },
  'OS run queue': { title: 'Run queue', text: 'The kernel’s list of threads ready to run. More runnable threads than cores means time-slicing and context switches.', code: '$ vmstat 1   # r = runnable, cs = switches/s' },
  'submit(task)': { title: 'Submitting work', text: 'Any thread can enqueue a task. The pool returns a future when the caller needs the result.', code: 'auto f = pool.submit([] { return parse(buf); });\nauto doc = f.get();' },
  reader: { title: 'Reader thread', text: 'Only reads the shared data, so it can run alongside other readers.', code: 'std::shared_lock lk(rw);\nauto r = table.find(k);' },
  writer: { title: 'Writer thread', text: 'Changes the data, so it needs exclusive access or a fresh copy.', code: 'std::unique_lock lk(rw);\ntable[k] = r;' },
  mailbox: { title: 'Mailbox / channel', text: 'One thread owns the state; others send it messages. No shared mutable data, so no data races by design.', code: 'Channel<Msg> inbox;\n// owner thread\nwhile (auto m = inbox.pop()) handle(*m);\n// any thread\ninbox.push(Deposit{42});' },
};

function demo(slug: string, title: string, summary: string, inputs: Record<string, [label: string, build: () => Frame[]]>) {
  machineDemo({
    slug,
    title,
    group: G,
    summary,
    inputs: Object.entries(inputs).map(([id, [label]]) => ({ id, label, data: { k: id } })),
    build: ({ k }: { k: string }) => inputs[k][1](),
    details: D,
  });
}
const B = (b: Board) => () => boardFrames(b);
const T = (t: Trace) => () => traceFrames(t);

// ---------------- threads ----------------
demo('conc-threads', 'Threads & lifetime', 'std::thread start and join, detach and dangling references, std::jthread with stop_token.', {
  join: [
    'join',
    T({
      code: ['void hello(int id) {', '  std::cout << "hi from " << id << "\\n";', '}', 'int main() {', '  std::thread t1(hello, 1);', '  std::thread t2(hello, 2);', '  t1.join();', '  t2.join();', '}'],
      stackTitle: 'threads',
      details: {
        t1: { title: 'std::thread t1', text: 'Constructing the thread starts it immediately, running hello(1) on its own stack.', code: 'std::thread t1(hello, 1);  // args are copied\nt1.join();' },
        t2: D['thread B'],
        out: { title: 'Interleaved output', text: 'Both threads write to std::cout. Each << is thread-safe, but lines from different threads can interleave.', code: 'std::osyncstream(std::cout) << "hi\\n";  // C++20: whole line' },
      },
      steps: [
        { note: 'main starts two threads. Each one begins running as soon as it is constructed.', line: [4, 5], vars: [['t1', 'running'], ['t2', 'running']], out: '', rows: [['threads', 3]] },
        { note: 'The OS decides who runs first, so output order changes from run to run.', line: 1, vars: [['t1', 'running', 'current'], ['t2', 'running', 'current']], out: 'hi from 2\nhi from 1', rows: [['order', 'unpredictable', 'warn']] },
        { note: 'join() waits for the thread to finish and releases its resources.', line: [6, 7], vars: [['t1', 'joined', 'ok'], ['t2', 'joined', 'ok']], out: 'hi from 2\nhi from 1', rows: [['joined', 2, 'ok']] },
        { note: 'Destroying a thread that is still joinable calls std::terminate. Every std::thread must be joined or detached.', vars: [['t1', 'joined', 'ok'], ['t2', 'joined', 'ok']], out: 'hi from 2\nhi from 1', rows: [['rule', 'join or detach']] },
      ],
    }),
  ],
  detach: [
    'detach: dangling',
    T({
      code: ['void start() {', '  std::string name = "job";', '  std::thread t([&] { log(name); });', '  t.detach();', '}   // name destroyed here', '// thread still running...'],
      details: {
        name: { title: 'Local captured by reference', text: 'The lambda holds a reference to a local. Once start() returns, the reference dangles.', code: '// fix: capture by value\nstd::thread t([name] { log(name); });' },
        t: { title: 'Detached thread', text: 'detach() lets the thread run on with no handle. Nothing waits for it, not even program exit.', code: 't.detach();  // fire and forget: rarely right' },
      },
      steps: [
        { note: 'The lambda captures name by reference.', line: [1, 2], vars: [['name', '"job"'], ['t', 'running']], rows: [['captures', '&name', 'warn']] },
        { note: 'detach() lets the thread outlive the function.', line: 3, vars: [['name', '"job"'], ['t', 'detached', 'warn']] },
        { note: 'start() returns and name is destroyed while the thread may still read it.', line: 4, vars: [['name', 'destroyed', 'fail'], ['t', 'reads &name', 'fail']], rows: [['bug', 'use-after-scope', 'fail']] },
        { note: 'Capture by value, or join before the data dies. TSan and ASan both report this one.', line: 2, vars: [['name', '"job" (copy)', 'ok'], ['t', 'running', 'ok']], rows: [['fix', 'capture by value', 'ok']] },
      ],
    }),
  ],
  jthread: [
    'jthread + stop_token',
    T({
      code: ['std::jthread t([](std::stop_token st) {', '  while (!st.stop_requested()) poll();', '});', '// ...', '}  // ~jthread: request_stop(), then join()'],
      details: {
        t: { title: 'std::jthread (C++20)', text: 'Joins automatically in its destructor and carries a stop_source, so cancellation is cooperative and built in.', code: 'std::jthread t(worker);\nt.request_stop();  // optional, dtor does it too' },
        st: { title: 'std::stop_token', text: 'The thread checks it in its loop. You can also register a std::stop_callback to wake a blocked wait.', code: 'std::condition_variable_any cv;\ncv.wait(lk, st, [&] { return ready; });' },
      },
      steps: [
        { note: 'jthread passes a stop_token to the function, which polls it.', line: [0, 1], vars: [['t', 'running'], ['st', 'not requested']], rows: [['C++', '20']] },
        { note: 'When t goes out of scope, its destructor requests stop.', line: 4, vars: [['t', 'stopping', 'warn'], ['st', 'requested', 'current']] },
        { note: 'The loop sees it and returns, and the destructor joins. No terminate, no leak.', line: 1, vars: [['t', 'joined', 'ok'], ['st', 'requested']], rows: [['manual join', 'none', 'ok']] },
      ],
    }),
  ],
});

// ---------------- races & mutexes ----------------

const RD: Record<string, Detail> = {
  counter: D.counter,
  m: D['std::mutex'],
  ra: { title: 'Register (core 0)', text: 'Arithmetic happens in registers, not in memory. ++counter is load, add, store.', code: 'mov eax, [counter]\nadd eax, 1\nmov [counter], eax' },
  rb: { title: 'Register (core 1)', text: 'Thread B’s own copy of the value. Nothing tells it A already loaded the same number.', code: 'mov eax, [counter]\nadd eax, 1\nmov [counter], eax' },
};

function threeRows(title: string) {
  return new Mem({ panel: title, details: RD }).region('A', 'thread A · core 0 register').region('mem', 'shared memory').region('B', 'thread B · core 1 register');
}

function raceScene() {
  const m = threeRows('Race');
  m.v('ra', 'A', 1, 'eax', 'core 0', '—').v('counter', 'mem', 1, 'counter', '0x900', '41').v('rb', 'B', 1, 'eax', 'core 1', '—');
  m.snap('counter is 41, and both threads are about to run ++counter.', '++counter;   // in thread A and thread B', { rows: [['expected', 43]] });
  m.set('ra', '41').snap('++counter is three steps. First A loads 41 into its register.', 'mov eax, [counter]   ; A', { fly: ['counter', 'ra'] });
  m.set('rb', '41').snap('Before A writes back, B loads too. It also sees 41.', 'mov eax, [counter]   ; B', { fly: ['counter', 'rb'], hot: { rb: 'warn' } });
  m.set('ra', '42').set('rb', '42').snap('Each adds 1 in its own register: 42 and 42.', 'add eax, 1   ; A and B');
  m.set('counter', '42').snap('A stores 42.', 'mov [counter], eax   ; A', { fly: ['ra', 'counter'] });
  m.set('counter', '42').snap('B stores 42 on top. Two increments, but counter only went up by one.', 'mov [counter], eax   ; B', { fly: ['rb', 'counter'], hot: { counter: 'fail' }, rows: [['expected', 43], ['got', 42, 'fail']] });
  m.snap('Over a million loops thousands vanish. It is a data race, undefined behaviour; TSan reports it.', 'g++ -fsanitize=thread race.cpp', { hot: { counter: 'fail' }, rows: [['counter', '1,318,442 of 2,000,000', 'fail'], ['detector', 'TSan']] });
  return m;
}

function mutexScene() {
  const m = threeRows('Mutex');
  m.v('ra', 'A', 1, 'eax', 'core 0', '—').v('counter', 'mem', 1, 'counter', '0x900', '41').v('m', 'mem', 3, 'mutex m', '0x940', 'free').v('rb', 'B', 1, 'eax', 'core 1', '—');
  m.snap('Same counter, now guarded by a mutex.', 'std::mutex m;');
  m.set('m', 'A holds').snap('A locks m first.', 'std::lock_guard lk(m);   // A', { hot: { m: 'accent' } });
  m.set('rb', 'waiting').snap('B calls lock() too. m is taken, so B sleeps.', 'std::lock_guard lk(m);   // B', { hot: { m: 'accent', rb: 'warn' }, rows: [['B', 'blocked', 'warn']] });
  m.set('ra', '42').snap('A loads 41 and adds 1, with no one to interfere.', 'mov eax, [counter]; add eax, 1   ; A', { fly: ['counter', 'ra'], hot: { m: 'accent', rb: 'warn' } });
  m.set('counter', '42').snap('A stores 42.', 'mov [counter], eax   ; A', { fly: ['ra', 'counter'], hot: { m: 'accent', rb: 'warn' } });
  m.set('m', 'B holds').set('rb', '—').snap('A’s guard unlocks at the brace. B wakes up and takes m.', '}   // ~lock_guard: unlock', { hot: { m: 'accent' } });
  m.set('rb', '43').snap('B loads 42, so it computes 43.', 'mov eax, [counter]; add eax, 1   ; B', { fly: ['counter', 'rb'], hot: { m: 'accent' } });
  m.set('counter', '43').set('m', 'free').snap('Nothing lost. The price: a lock and unlock per ++, and m bouncing between cores.', 'mov [counter], eax   ; B', { fly: ['rb', 'counter'], hot: { counter: 'ok' }, rows: [['counter', 43, 'ok'], ['cost', '~13× slower here', 'warn']] });
  return m;
}

function atomicScene() {
  const m = threeRows('Atomic');
  m.v('ra', 'A', 1, 'eax', 'core 0', '—').v('counter', 'mem', 1, 'counter', '0x900', '41').v('rb', 'B', 1, 'eax', 'core 1', '—');
  m.snap('counter is now a std::atomic<int>.', 'std::atomic<int> counter{41};');
  m.set('counter', '42').set('ra', 'old 41').snap('fetch_add is one instruction. The core locks the cache line, then reads, adds and writes.', 'lock xadd [counter], eax   ; A', { hot: { counter: 'write' } });
  m.set('rb', 'waits').snap('B’s fetch_add has to wait for that line. It can’t slip in between.', 'lock xadd [counter], eax   ; B', { hot: { rb: 'warn' } });
  m.set('counter', '43').set('rb', 'old 42').snap('Then B runs and sees 42. Both increments count, with no mutex.', 'lock xadd [counter], eax   ; B', { hot: { counter: 'ok' }, rows: [['counter', 43, 'ok']] });
  m.snap('Perfect for one counter or flag. When several variables must change together, use a mutex.', 'counter.fetch_add(1, std::memory_order_relaxed);', { rows: [['use for', 'counters, flags'], ['not for', 'multi-field updates', 'warn']] });
  return m;
}

demo('conc-race', 'Data races & mutexes', 'counter++ from two threads loses updates; lock_guard and std::atomic fix it at different costs.', {
  race: ['Data race', () => raceScene().frames()],
  mutex: ['lock_guard', () => mutexScene().frames()],
  atomic: ['std::atomic', () => atomicScene().frames()],
});

// ---------------- deadlock ----------------
const DL_NODES = [
  N('ta', 40, 280, 280, 110, 'thread A', 'transfer(x, y)'),
  N('tb', 680, 280, 280, 110, 'thread B', 'transfer(y, x)'),
  N('m1', 200, 520, 260, 120, 'm1', 'account x'),
  N('m2', 540, 520, 260, 120, 'm2', 'account y'),
  N('res', 40, 800, 920, 130, 'result'),
];
demo('conc-deadlock', 'Deadlock & lock ordering', 'Two threads take two mutexes in opposite order and wait forever; lock ordering and std::scoped_lock.', {
  deadlock: [
    'Deadlock',
    B({
      panel: 'Locks',
      codeTitle: 'bank.cpp',
      code: ['void transfer(Acct& from, Acct& to, int n) {', '  std::lock_guard a(from.m);', '  std::lock_guard b(to.m);', '  from.bal -= n; to.bal += n;', '}'],
      nodes: DL_NODES,
      edges: ['ta>m1', 'tb>m2', 'ta>m2', 'tb>m1'],
      beats: [
        { note: 'transfer locks the source account, then the target.', hl: [1, 2], hide: ['ta>m1', 'tb>m2', 'ta>m2', 'tb>m1', 'res'], rows: [['locks per call', 2]] },
        { note: 'A transfers x to y and locks m1. At the same moment B transfers y to x and locks m2.', hl: [1], hot: { 'ta>m1': 'ok', 'tb>m2': 'ok', m1: 'write', m2: 'write' }, sub: { m1: 'held by A', m2: 'held by B' }, hide: ['ta>m2', 'tb>m1', 'res'], rows: [['held', 2]] },
        { note: 'A waits for m2, held by B. B waits for m1, held by A.', hl: [2], hot: { 'ta>m1': 'ok', 'tb>m2': 'ok', 'ta>m2': 'fail', 'tb>m1': 'fail', ta: 'warn', tb: 'warn' }, sub: { m1: 'held by A', m2: 'held by B', ta: 'waits for m2', tb: 'waits for m1' }, hide: ['res'], rows: [['cycle', 'A → m2 → B → m1 → A', 'fail']] },
        { note: 'Neither can proceed, ever. The process hangs at 0% CPU with no error.', hot: { ta: 'fail', tb: 'fail', res: 'fail', 'ta>m2': 'fail', 'tb>m1': 'fail' }, sub: { m1: 'held by A', m2: 'held by B', ta: 'blocked', tb: 'blocked' }, label: { res: 'deadlock: hung forever' }, rows: [['CPU', '0%', 'fail']] },
      ],
    }),
  ],
  order: [
    'Lock ordering',
    B({
      panel: 'Locks',
      codeTitle: 'bank.cpp',
      code: ['void transfer(Acct& from, Acct& to, int n) {', '  auto [lo, hi] = from.id < to.id ? std::tie(from, to)', '                                 : std::tie(to, from);', '  std::lock_guard a(lo.m), b(hi.m);', '  from.bal -= n; to.bal += n; }'],
      nodes: DL_NODES,
      edges: ['ta>m1', 'tb>m1', 'ta>m2'],
      beats: [
        { note: 'Rule: always lock in one global order, here by account id.', hl: [1, 2], hot: { m1: 'current' }, sub: { m1: 'account x (id 1)', m2: 'account y (id 2)' }, hide: ['ta>m1', 'tb>m1', 'ta>m2', 'res'], rows: [['order', 'id ascending']] },
        { note: 'Both threads now go for m1 first. A wins, B waits on m1 while holding nothing.', hl: [3], hot: { 'ta>m1': 'ok', 'tb>m1': 'warn', m1: 'write' }, sub: { m1: 'held by A', tb: 'waits for m1' }, hide: ['ta>m2', 'res'], rows: [['B holds', 'nothing', 'ok']] },
        { note: 'A takes m2, finishes, and releases both. Then B runs.', hot: { 'ta>m2': 'ok', m2: 'write', res: 'ok' }, sub: { m1: 'held by A', m2: 'held by A' }, label: { res: 'no cycle possible' }, rows: [['deadlocks', 0, 'ok']] },
      ],
    }),
  ],
  scoped: [
    'std::scoped_lock',
    B({
      panel: 'Locks',
      codeTitle: 'bank.cpp',
      code: ['void transfer(Acct& from, Acct& to, int n) {', '  std::scoped_lock lk(from.m, to.m);', '  from.bal -= n; to.bal += n;', '}'],
      nodes: DL_NODES,
      edges: ['ta>m1', 'tb>m2'],
      beats: [
        { note: 'std::scoped_lock takes several mutexes at once with a deadlock-avoidance algorithm.', hl: [1], hide: ['ta>m1', 'tb>m2', 'res'], rows: [['C++', '17']] },
        { note: 'If it can’t get all of them, it releases what it holds and retries. No thread sits on half the locks.', hot: { 'ta>m1': 'ok', 'tb>m2': 'warn', m1: 'write' }, sub: { m1: 'held by A', tb: 'backs off m2' }, hide: ['res'], rows: [['hold and wait', 'never', 'ok']] },
        { note: 'Prefer it whenever a function needs two locks. Better still, design so it needs only one.', hot: { res: 'ok' }, label: { res: 'deadlock-free' }, rows: [['tools', 'TSan lock-order-inversion']] },
      ],
    }),
  ],
});

// ---------------- condition variables ----------------
const CV_NODES = [
  N('p', 40, 300, 280, 120, 'producer', 'push jobs'),
  N('q', 360, 300, 280, 120, 'queue', '[]'),
  N('c', 680, 300, 280, 120, 'consumer', 'pop jobs'),
  N('cv', 360, 500, 280, 110, 'condvar', 'no waiters'),
  N('cpu', 40, 700, 920, 110, 'consumer CPU'),
];
const CV_CODE = ['std::unique_lock lk(m);', 'cv.wait(lk, [&] { return !q.empty(); });', 'Job j = std::move(q.front()); q.pop();', 'lk.unlock(); j();'];
demo('conc-condvar', 'Condition variables', 'Busy-waiting vs cv.wait with a predicate; spurious wakeups and lost notifies; bounded queues for backpressure.', {
  busy: [
    'Busy wait',
    B({
      panel: 'Queue',
      codeTitle: 'consumer.cpp',
      code: ['while (true) {', '  std::lock_guard lk(m);', '  if (!q.empty()) { run(q.front()); q.pop(); }', '}  // spins'],
      nodes: CV_NODES,
      edges: ['p>q', 'q>c'],
      beats: [
        { note: 'The consumer checks the queue in a loop, taking the lock each time.', hl: [0, 1, 2], hot: { c: 'current' }, hide: ['cv'], label: { cpu: '100% of one core' }, rows: [['checks/sec', '~20M', 'warn']] },
        { note: 'The queue is empty almost always, so it burns a whole core doing nothing.', hot: { cpu: 'fail', c: 'warn' }, hide: ['cv'], label: { cpu: '100% of one core' }, rows: [['useful work', '0%', 'fail']] },
        { note: 'It also steals the mutex from the producer. Waiting should sleep, not spin.', hot: { p: 'warn', cpu: 'fail' }, sub: { p: 'can’t get m' }, hide: ['cv'], label: { cpu: '100% of one core' }, rows: [['fix', 'condition_variable']] },
      ],
    }),
  ],
  cv: [
    'wait + notify',
    B({
      panel: 'Queue',
      codeTitle: 'consumer.cpp',
      code: CV_CODE,
      nodes: CV_NODES,
      edges: ['p>q', 'q>c', 'cv>c'],
      beats: [
        { note: 'The consumer locks, finds the queue empty, and calls wait.', hl: [0, 1], hot: { c: 'current', cv: 'write' }, sub: { cv: 'consumer asleep' }, label: { cpu: '0% while waiting' }, rows: [['consumer', 'asleep', 'ok']] },
        { note: 'wait atomically unlocks the mutex and sleeps, so the producer can get in.', hot: { p: 'current', q: 'write', 'p>q': 'accent' }, sub: { q: '[job1]', cv: 'consumer asleep' }, label: { cpu: '0% while waiting' }, rows: [['mutex', 'free while asleep']] },
        { note: 'The producer pushes a job and calls notify_one.', hot: { cv: 'current', 'cv>c': 'accent' }, sub: { q: '[job1]', cv: 'notify_one()' }, label: { cpu: '0% while waiting' }, rows: [['notify', 'one']] },
        { note: 'The consumer wakes, relocks, rechecks the predicate, and pops the job.', hl: [1, 2], hot: { c: 'ok', 'q>c': 'accent' }, sub: { q: '[]', cv: 'no waiters' }, label: { cpu: 'runs job1' }, rows: [['jobs done', 1, 'ok']] },
        { note: 'Run the job after unlocking, so the producer is never blocked by slow work.', hl: [3], hot: { c: 'ok', p: 'ok' }, label: { cpu: 'work outside the lock' }, rows: [['lock held', 'microseconds', 'ok']] },
      ],
    }),
  ],
  spurious: [
    'Why the predicate',
    B({
      panel: 'Queue',
      codeTitle: 'buggy.cpp',
      code: ['std::unique_lock lk(m);', 'cv.wait(lk);            // no predicate', 'Job j = q.front();      // q may be empty!', 'q.pop();'],
      nodes: CV_NODES,
      edges: ['p>q', 'q>c', 'cv>c'],
      beats: [
        { note: 'Without a predicate, wait can return with the queue still empty. Spurious wakeups are allowed by the standard.', hl: [1], hot: { cv: 'warn', c: 'warn' }, sub: { cv: 'spurious wakeup' }, hide: ['cpu'], rows: [['queue', 'empty', 'warn']] },
        { note: 'q.front() on an empty queue is undefined behaviour.', hl: [2], hot: { c: 'fail', q: 'fail' }, sub: { c: 'front() of []' }, hide: ['cpu'], rows: [['result', 'UB', 'fail']] },
        { note: 'The opposite bug: notify fires before the consumer waits, and with no state to check, it sleeps forever.', hot: { p: 'current', cv: 'fail', c: 'fail' }, sub: { cv: 'notify lost', c: 'asleep forever' }, hide: ['cpu'], rows: [['lost wakeup', 1, 'fail']] },
        { note: 'wait(lk, pred) loops until the state is really ready. Always wait on state, never on the signal alone.', hot: { c: 'ok', cv: 'ok' }, sub: { cv: 'wait(lk, pred)' }, hide: ['cpu'], rows: [['fix', 'predicate', 'ok']] },
      ],
    }),
  ],
  bounded: [
    'Bounded queue',
    B({
      panel: 'Queue',
      codeTitle: 'bounded.cpp',
      code: ['void push(Job j) {', '  std::unique_lock lk(m);', '  not_full.wait(lk, [&] { return q.size() < cap; });', '  q.push(std::move(j)); not_empty.notify_one(); }'],
      nodes: CV_NODES,
      edges: ['p>q', 'q>c', 'cv>p'],
      beats: [
        { note: 'The producer is faster than the consumer. With an unbounded queue, memory grows until OOM.', hot: { p: 'current', q: 'fail' }, sub: { q: '1.2M jobs', c: 'slow' }, label: { cpu: 'RSS 3.9 GB and rising' }, rows: [['queue', 'unbounded', 'fail']] },
        { note: 'Cap the queue. When it is full the producer waits on a second condvar, not_full.', hl: [2], hot: { q: 'warn', cv: 'write', 'cv>p': 'accent', p: 'warn' }, sub: { q: '1024 / 1024', cv: 'producer waits' }, label: { cpu: 'RSS flat' }, rows: [['cap', 1024]] },
        { note: 'Each pop notifies not_full, and the producer resumes. The slow stage sets the pace: backpressure.', hot: { q: 'ok', p: 'ok', c: 'ok' }, sub: { q: '1023 / 1024' }, label: { cpu: 'RSS flat' }, rows: [['memory', 'bounded', 'ok']] },
      ],
    }),
  ],
});

// ---------------- futures ----------------
const FUT_NODES = [
  N('main', 40, 300, 280, 110, 'main thread'),
  N('pr', 360, 300, 280, 110, 'promise'),
  N('st', 360, 480, 280, 110, 'shared state', 'empty'),
  N('fu', 680, 480, 280, 110, 'future'),
  N('wk', 40, 480, 280, 110, 'worker'),
  N('res', 40, 700, 920, 130, 'result'),
];
demo('conc-futures', 'Futures, promises & async', 'One-shot results across threads: promise/future, std::async launch policies, packaged_task, exceptions through get().', {
  promise: [
    'promise / future',
    B({
      panel: 'Future',
      codeTitle: 'future.cpp',
      code: ['std::promise<int> p;', 'std::future<int> f = p.get_future();', 'std::thread t([&p] { p.set_value(compute()); });', 'int v = f.get();   // blocks until set', 't.join();'],
      nodes: FUT_NODES,
      edges: ['pr>st', 'st>fu', 'wk>pr'],
      beats: [
        { note: 'A promise and its future share one heap-allocated slot for a single value.', hl: [0, 1], hot: { st: 'current' }, hide: ['wk', 'res', 'wk>pr'], rows: [['values', 1]] },
        { note: 'main calls get() and blocks. The worker is still computing.', hl: [2, 3], hot: { main: 'warn', fu: 'warn', wk: 'current' }, sub: { main: 'f.get() waits' }, hide: ['res'], rows: [['main', 'blocked', 'warn']] },
        { note: 'The worker calls set_value(42), which fills the slot and wakes get().', hot: { pr: 'write', st: 'write', 'wk>pr': 'accent', 'pr>st': 'accent' }, sub: { st: '42', main: 'f.get() waits' }, hide: ['res'], rows: [['state', 'ready', 'ok']] },
        { note: 'get() returns 42. It can be called only once; use shared_future for many readers.', hot: { fu: 'ok', main: 'ok', res: 'ok', 'st>fu': 'accent' }, sub: { st: '42' }, label: { res: 'v = 42' }, rows: [['get()', 'once']] },
        { note: 'If the worker throws and calls set_exception, get() rethrows it in main. Errors cross threads cleanly.', hot: { st: 'fail', res: 'warn' }, sub: { st: 'exception_ptr' }, label: { res: 'get() throws std::runtime_error' }, rows: [['errors', 'propagated', 'ok']] },
      ],
    }),
  ],
  async: [
    'std::async',
    B({
      panel: 'Future',
      codeTitle: 'async.cpp',
      code: ['auto f = std::async(std::launch::async, load);', 'render_ui();', 'auto data = f.get();', 'std::async(std::launch::async, log_it);  // gotcha'],
      nodes: [N('main', 40, 300, 440, 110, 'main thread'), N('as', 520, 300, 440, 110, 'std::async', 'new thread'), N('fu', 280, 480, 440, 110, 'future'), N('res', 40, 700, 920, 130, 'result')],
      edges: ['as>fu'],
      beats: [
        { note: 'std::async runs load on another thread and hands back a future.', hl: [0], hot: { as: 'current' }, hide: ['res'], rows: [['policy', 'launch::async']] },
        { note: 'main keeps working, then collects the result with get().', hl: [1, 2], hot: { main: 'current', fu: 'ok', 'as>fu': 'accent' }, hide: ['res'], rows: [['overlap', 'yes', 'ok']] },
        { note: 'Without a policy the call may be deferred and run lazily inside get(). Pass launch::async when you want parallelism.', hot: { as: 'warn' }, sub: { as: 'maybe deferred' }, hide: ['res'], rows: [['default policy', 'async | deferred', 'warn']] },
        { note: 'A discarded future from async blocks in its destructor, so line 4 runs synchronously.', hl: [3], hot: { res: 'fail', main: 'warn' }, label: { res: '~future() waits for log_it' }, rows: [['fire and forget', 'no', 'fail']] },
      ],
    }),
  ],
  packaged: [
    'packaged_task',
    B({
      panel: 'Future',
      codeTitle: 'task.cpp',
      code: ['std::packaged_task<int()> task(compute);', 'std::future<int> f = task.get_future();', 'pool.post(std::move(task));', 'int v = f.get();'],
      nodes: [N('pt', 40, 300, 440, 110, 'packaged_task'), N('wq', 520, 300, 440, 110, 'work queue'), N('wk', 520, 480, 440, 110, 'worker'), N('fu', 40, 480, 440, 110, 'future'), N('res', 40, 700, 920, 130, 'result')],
      edges: ['pt>wq', 'wq>wk', 'wk>fu'],
      beats: [
        { note: 'packaged_task wraps a callable together with a promise.', hl: [0, 1], hot: { pt: 'current', fu: 'write' }, hide: ['res'], rows: [['wraps', 'compute']] },
        { note: 'Post it to a queue; some worker runs it later.', hl: [2], hot: { wq: 'current', 'pt>wq': 'accent' }, hide: ['res'], rows: [['queued', 1]] },
        { note: 'Running the task stores its return value, or its exception, in the future.', hot: { wk: 'current', 'wq>wk': 'accent', 'wk>fu': 'accent', fu: 'ok' }, hide: ['res'], rows: [['state', 'ready', 'ok']] },
        { note: 'This is how thread pools return results: submit() hands back a future.', hl: [3], hot: { res: 'ok' }, label: { res: 'auto f = pool.submit(compute);' }, rows: [['pattern', 'submit → future']] },
      ],
    }),
  ],
});

// ---------------- thread pool ----------------
const WORKERS = [0, 1, 2, 3].map((i) => N(`w${i}`, 40 + i * 235, 520, 215, 110, 'worker', `core ${i}`));
const wIds = WORKERS.map((w) => w.id);
demo('conc-pool', 'Thread pools', 'A fixed pool of workers on a shared queue vs thread-per-task oversubscription; clean shutdown.', {
  pool: [
    'Pool',
    B({
      panel: 'Pool',
      nodes: [N('sub', 40, 60, 920, 110, 'submit(task)', 'any thread'), N('q', 200, 280, 600, 120, 'work queue', '8 tasks'), ...WORKERS, N('res', 40, 760, 920, 130, 'throughput')],
      edges: ['sub>q', ...wIds.map((w) => `q>${w}`)],
      beats: [
        { note: 'A pool starts N workers once, typically one per core.', hot: all(wIds, 'current'), sub: { q: 'empty' }, hide: ['res'], rows: [['workers', 4], ['cores', 4]] },
        { note: 'Tasks go into one queue. Each idle worker waits on the queue’s condvar.', hot: { q: 'write', sub: 'current', 'sub>q': 'accent' }, hide: ['res'], rows: [['queued', 8]] },
        { note: 'Workers pull tasks as they free up, so all cores stay busy.', hot: { ...all(wIds, 'ok'), ...all(wIds.map((w) => `q>${w}`), 'accent') }, sub: { q: '4 left' }, hide: ['res'], rows: [['running', 4, 'ok']] },
        { note: 'No thread creation per task, and at most N threads compete for N cores.', hot: { res: 'ok' }, sub: { q: 'empty' }, label: { res: '4 threads, 0 context-switch storm' }, rows: [['threads created', 4, 'ok']] },
      ],
    }),
  ],
  oversub: [
    'Thread per task',
    B({
      panel: 'Pool',
      nodes: [N('sub', 40, 60, 920, 110, 'std::thread per task'), N('q', 200, 280, 600, 120, 'OS run queue', '2,000 threads'), ...WORKERS, N('res', 40, 760, 920, 130, 'throughput')],
      edges: ['sub>q', ...wIds.map((w) => `q>${w}`)],
      beats: [
        { note: 'Spawning a thread per task feels simpler.', hot: { sub: 'warn' }, hide: ['res'], rows: [['threads', 2000, 'warn']] },
        { note: 'Each thread costs a stack (8 MB virtual by default) and a kernel object, and creation takes microseconds.', hot: { q: 'warn' }, hide: ['res'], rows: [['stacks', '16 GB virtual', 'warn']] },
        { note: 'With 2,000 runnable threads on 4 cores, the CPU spends its time switching and refilling caches.', hot: { ...all(wIds, 'fail'), q: 'fail' }, sub: { w0: 'switching', w1: 'switching', w2: 'switching', w3: 'switching' }, hide: ['res'], rows: [['context switches/s', '400k', 'fail']] },
        { note: 'Throughput drops and latency explodes. Bound concurrency with a pool.', hot: { res: 'fail' }, label: { res: '3× slower than a 4-thread pool' }, rows: [['fix', 'fixed pool', 'ok']] },
      ],
    }),
  ],
  shutdown: [
    'Shutdown',
    B({
      panel: 'Pool',
      codeTitle: 'pool.cpp',
      code: ['~Pool() {', '  { std::lock_guard lk(m); stop = true; }', '  cv.notify_all();', '  for (auto& t : workers) t.join();', '}'],
      nodes: [N('q', 200, 260, 600, 120, 'work queue', '3 tasks'), ...WORKERS.map((w) => ({ ...w, y: 450 })), N('res', 40, 700, 920, 130, 'shutdown')],
      edges: wIds.map((w) => `q>${w}`),
      beats: [
        { note: 'The destructor sets stop under the lock.', hl: [1], hot: { q: 'warn' }, sub: { q: 'stop = true' }, hide: ['res'], rows: [['stop', 'true']] },
        { note: 'notify_all wakes every sleeping worker. notify_one would leave some asleep forever.', hl: [2], hot: all(wIds, 'current'), sub: { q: 'stop = true' }, hide: ['res'], rows: [['woken', 4]] },
        { note: 'Workers drain what’s left, see stop with an empty queue, and return.', hot: all(wIds, 'ok'), sub: { q: 'empty' }, hide: ['res'], rows: [['drained', 3, 'ok']] },
        { note: 'join waits for each one. Decide and document: drain queued work, or drop it.', hl: [3], hot: { res: 'ok' }, label: { res: 'all workers joined' }, rows: [['policy', 'drain', 'ok']] },
      ],
    }),
  ],
});

// ---------------- atomics in practice ----------------
demo('conc-atomics', 'Atomics & memory order in practice', 'Relaxed counters, release/acquire publishing, compare-exchange loops, and false sharing.', {
  publish: [
    'Publish with release',
    B({
      panel: 'Memory order',
      codeTitle: 'publish.cpp',
      code: ['Config* cfg; std::atomic<bool> ready{false};', '// writer', 'cfg = load(); ready.store(true, std::memory_order_release);', '// reader', 'if (ready.load(std::memory_order_acquire)) use(cfg);'],
      nodes: [N('w', 40, 300, 440, 110, 'writer'), N('r', 520, 300, 440, 110, 'reader'), N('cfg', 40, 480, 440, 110, 'cfg', 'Config*'), N('rd', 520, 480, 440, 110, 'ready', 'false'), N('res', 40, 700, 920, 130, 'result')],
      edges: ['w>cfg', 'r>rd'],
      beats: [
        { note: 'The writer fills cfg, then sets ready. The reader waits for ready, then uses cfg.', hl: [2, 4], hide: ['res'], rows: [['vars', 2]] },
        { note: 'With relaxed or plain stores, the CPU or compiler may make ready visible before cfg.', hot: { rd: 'warn', cfg: 'fail' }, sub: { rd: 'true', cfg: 'not yet visible' }, hide: ['res'], rows: [['ordering', 'none', 'fail']] },
        { note: 'A release store publishes every write before it. An acquire load that sees true sees them too.', hl: [2, 4], hot: { w: 'write', r: 'read', rd: 'ok', cfg: 'ok' }, sub: { rd: 'true', cfg: 'visible' }, hide: ['res'], rows: [['pair', 'release → acquire', 'ok']] },
        { note: 'This pairing is the core of every lock-free handoff. See under the hood for MESI.', hot: { res: 'ok' }, label: { res: 'reader always sees a full Config' }, rows: [['default', 'seq_cst (stronger)']] },
      ],
    }),
  ],
  cas: [
    'Compare-exchange',
    B({
      panel: 'CAS',
      codeTitle: 'max.cpp',
      code: ['void update_max(std::atomic<int>& m, int v) {', '  int cur = m.load();', '  while (cur < v && !m.compare_exchange_weak(cur, v)) {}', '}'],
      nodes: [N('a', 40, 280, 440, 110, 'thread A', 'v = 7'), N('b', 520, 280, 440, 110, 'thread B', 'v = 9'), N('m', 280, 460, 440, 110, 'max', '5'), N('res', 40, 700, 920, 130, 'result')],
      edges: ['a>m', 'b>m'],
      beats: [
        { note: 'Some updates can’t be one instruction, like keeping a running max.', hl: [0], hide: ['res'], rows: [['start', 5]] },
        { note: 'CAS writes only if the value is still what you read. A reads 5 and swaps in 7.', hl: [2], hot: { a: 'ok', m: 'write', 'a>m': 'accent' }, sub: { m: '7' }, hide: ['res'], rows: [['A', 'CAS 5 → 7', 'ok']] },
        { note: 'B had also read 5, so its CAS fails and reloads cur = 7. It retries and swaps in 9.', hot: { b: 'warn', m: 'write', 'b>m': 'accent' }, sub: { m: '9', b: 'retry: 7 → 9' }, hide: ['res'], rows: [['B', 'fail, retry, ok', 'warn']] },
        { note: 'Lock-free, but not wait-free: under heavy contention threads keep retrying. Measure before replacing a mutex.', hot: { res: 'ok' }, label: { res: 'max = 9' }, rows: [['pattern', 'load → compute → CAS']] },
      ],
    }),
  ],
  falseshare: [
    'False sharing',
    B({
      panel: 'Cache',
      codeTitle: 'stats.cpp',
      code: ['struct Stats { std::atomic<long> hits, misses; };', '// thread A: ++hits   thread B: ++misses', 'struct Padded {', '  alignas(64) std::atomic<long> hits;', '  alignas(64) std::atomic<long> misses; };'],
      nodes: [N('a', 40, 280, 440, 110, 'thread A', '++hits'), N('b', 520, 280, 440, 110, 'thread B', '++misses'), N('line', 200, 460, 600, 120, 'cache line', 'hits | misses'), N('line2', 520, 620, 440, 100, 'cache line', 'misses'), N('res', 40, 800, 920, 130, 'result')],
      edges: ['a>line', 'b>line'],
      beats: [
        { note: 'Each thread increments its own counter. No shared data, so it should scale.', hl: [0, 1], hide: ['line2', 'res'], rows: [['shared vars', 0]] },
        { note: 'But both counters sit in one 64-byte cache line. Each write takes the line away from the other core.', hot: { line: 'fail', 'a>line': 'fail', 'b>line': 'fail' }, sub: { line: 'bouncing A ↔ B' }, hide: ['line2', 'res'], rows: [['line transfers', '~50M/s', 'fail']] },
        { note: 'alignas(64) gives each counter its own line. Now the cores never interfere.', hl: [2, 3, 4], hot: { line: 'ok', line2: 'ok', 'a>line': 'ok' }, label: { line: 'cache line' }, sub: { line: 'hits' }, hide: ['b>line', 'res'], rows: [['line transfers', 0, 'ok']] },
        { note: 'Typical speedup is several times. Look for it in per-thread stats, queue head and tail, and lock arrays.', hot: { res: 'ok' }, label: { res: '6× faster with padding' }, rows: [['constant', 'hardware_destructive_interference_size']] },
      ],
    }),
  ],
});

// ---------------- readers/writers & snapshots ----------------
const RW_NODES = [
  N('r1', 40, 260, 280, 100, 'reader', '1'),
  N('r2', 360, 260, 280, 100, 'reader', '2'),
  N('wr', 680, 260, 280, 100, 'writer'),
  N('lk', 200, 450, 600, 120, 'shared_mutex', 'free'),
  N('data', 200, 650, 600, 120, 'routing table'),
];
demo('conc-rw', 'Readers, writers & snapshots', 'std::shared_mutex for read-mostly data, and lock-free readers with immutable snapshots.', {
  shared: [
    'shared_mutex',
    B({
      panel: 'RW lock',
      codeTitle: 'table.cpp',
      code: ['Route find(Key k) const { std::shared_lock lk(rw); ... }', 'void add(Key k, Route r) { std::unique_lock lk(rw); ... }'],
      nodes: RW_NODES,
      edges: ['r1>lk', 'r2>lk', 'wr>lk', 'lk>data'],
      beats: [
        { note: 'Lookups happen a million times a second, updates once a minute.', hl: [0, 1], hide: ['r1>lk', 'r2>lk', 'wr>lk'], rows: [['read:write', '10⁶ : 1']] },
        { note: 'Readers take the lock in shared mode, and many hold it at once.', hl: [0], hot: { r1: 'ok', r2: 'ok', lk: 'read', 'r1>lk': 'accent', 'r2>lk': 'accent' }, sub: { lk: '2 readers' }, hide: ['wr>lk'], rows: [['concurrent readers', 2, 'ok']] },
        { note: 'The writer needs exclusive mode, so it waits for readers to leave, then blocks new ones.', hl: [1], hot: { wr: 'write', lk: 'write', 'wr>lk': 'accent', data: 'write' }, sub: { lk: 'writer only' }, hide: ['r1>lk', 'r2>lk'], rows: [['readers', 'paused', 'warn']] },
        { note: 'Every read still writes the lock’s reader count, one contended cache line. At high core counts that bottleneck shows.', hot: { lk: 'warn' }, sub: { lk: 'reader count bouncing' }, rows: [['scales to', '~8 cores', 'warn']] },
      ],
    }),
  ],
  snapshot: [
    'Immutable snapshot',
    B({
      panel: 'Snapshot',
      codeTitle: 'table.cpp',
      code: ['std::atomic<std::shared_ptr<const Table>> cur;', 'auto t = cur.load();  t->find(k);          // reader', 'auto n = std::make_shared<Table>(*cur.load());', 'n->add(k, r);  cur.store(n);              // writer'],
      nodes: [...RW_NODES.slice(0, 3), N('lk', 200, 450, 600, 120, 'snapshot', 'v1'), N('data', 200, 650, 600, 120, 'routing table', 'v2 (new copy)')],
      edges: ['r1>lk', 'r2>lk', 'wr>data', 'data>lk'],
      beats: [
        { note: 'Readers load a shared_ptr to a const table and search it with no lock.', hl: [1], hot: { r1: 'ok', r2: 'ok', lk: 'read', 'r1>lk': 'accent', 'r2>lk': 'accent' }, hide: ['data', 'wr>data'], rows: [['reader locks', 0, 'ok']] },
        { note: 'The writer copies the table, edits the copy, and swaps the pointer.', hl: [2, 3], hot: { wr: 'write', data: 'write', 'wr>data': 'accent' }, rows: [['copy cost', 'per update', 'warn']] },
        { note: 'New readers see v2; old readers finish on v1, which is freed when the last one drops it.', hot: { lk: 'ok', 'data>lk': 'accent' }, sub: { lk: 'v2 (v1 alive while read)' }, rows: [['torn reads', 'impossible', 'ok']] },
        { note: 'Great for configs and routing tables: rare writes, constant reads. Wrong for data that changes every millisecond.', hot: { lk: 'ok' }, sub: { lk: 'v2' }, rows: [['fits', 'read-mostly']] },
      ],
    }),
  ],
});

// ---------------- design ----------------
demo('conc-design', 'Designing thread-safe code', 'Shared mutable state behind locks vs ownership with message passing; immutability; where to put the locks.', {
  shared: [
    'Shared state',
    B({
      panel: 'Design',
      nodes: [N('t1', 40, 60, 280, 110, 'thread A'), N('t2', 360, 60, 280, 110, 'thread B'), N('t3', 680, 60, 280, 110, 'thread C'), N('st', 200, 300, 600, 130, 'account state', 'balance, history'), N('mx', 200, 500, 600, 110, 'std::mutex', '3 threads contend'), N('res', 40, 720, 920, 130, 'risk')],
      edges: ['t1>st', 't2>st', 't3>st'],
      beats: [
        { note: 'Every thread touches the same object, guarded by a mutex.', hot: { st: 'current', mx: 'write' }, hide: ['res'], rows: [['owners', 3, 'warn']] },
        { note: 'Every access must remember the lock, including code written next year by someone else.', hot: { t3: 'fail', 't3>st': 'fail' }, sub: { t3: 'forgot the lock' }, hide: ['res'], rows: [['bugs', 'one missed lock', 'fail']] },
        { note: 'Invariants spanning two calls, like check then withdraw, need the lock held across both.', hot: { res: 'fail' }, label: { res: 'if (bal >= n) … bal -= n  ← race between' }, rows: [['fix', 'lock around both']] },
        { note: 'Shared state works when it’s small and wrapped in a class that locks internally. Don’t let the mutex leak into callers.', hot: { st: 'ok', mx: 'ok', res: 'ok' }, label: { res: 'class Account { std::mutex m; public: bool withdraw(int); }' }, rows: [['rule', 'encapsulate the lock', 'ok']] },
      ],
    }),
  ],
  message: [
    'Message passing',
    B({
      panel: 'Design',
      nodes: [N('t1', 40, 60, 280, 110, 'thread A'), N('t2', 360, 60, 280, 110, 'thread B'), N('t3', 680, 60, 280, 110, 'thread C'), N('mb', 200, 300, 600, 130, 'mailbox', 'queue of messages'), N('ow', 200, 500, 600, 110, 'owner thread', 'only one touching state'), N('res', 40, 720, 920, 130, 'result')],
      edges: ['t1>mb', 't2>mb', 't3>mb', 'mb>ow'],
      beats: [
        { note: 'One thread owns the state. Others send it messages instead of touching it.', hot: { ow: 'current' }, hide: ['res'], rows: [['owners', 1, 'ok']] },
        { note: 'The only shared structure is the queue, locked in one place you test once.', hot: { mb: 'write', 't1>mb': 'accent', 't2>mb': 'accent', 't3>mb': 'accent' }, hide: ['res'], rows: [['locks in app code', 0, 'ok']] },
        { note: 'The owner handles messages one at a time, so invariants hold without any locking.', hot: { ow: 'ok', 'mb>ow': 'accent' }, hide: ['res'], rows: [['data races', 'impossible', 'ok']] },
        { note: 'Replies come back as futures or messages. This is the actor model, and the event-loop servers in Network servers use it.', hot: { res: 'ok' }, label: { res: 'Deposit{42} → owner → future<bool>' }, rows: [['cost', 'queue hop latency', 'warn']] },
      ],
    }),
  ],
});
