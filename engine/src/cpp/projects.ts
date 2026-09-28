// Large C++ projects (group cpp-projects): architecture, build times, static/shared libraries, ABI & ODR.
import type { Detail, Tone } from '../algo/frames';
import { boardDemo as demo, N } from '../machine/lib/board';
import type { Board } from '../machine/lib/board';

const all = (ids: string[], tone: Tone) => Object.fromEntries(ids.map((id) => [id, tone]));
const boardDemo = (slug: string, title: string, summary: string, boards: Record<string, [string, Board]>) => demo('cpp-projects', slug, title, summary, boards, { ...DETAILS[slug], ...EXTRA[slug] });

const EXTRA: Record<string, Record<string, Detail>> = {
  'cpp-libs': {
    'log.o': { title: 'Object pulled in', text: 'core.o calls log::write, so the linker also takes log.o from the archive.', code: '$ nm -C log.o\n0000 T log::write(char const*)' },
    'util.o': { title: 'Object left out', text: 'Nothing references its symbols, so a static link skips it entirely.', code: '$ nm -C util.o\n0000 T util::unused_helper()' },
    app2: { title: 'Second executable', text: 'With static linking it carries its own copy of core; with shared, it maps the same .so.', code: '$ size app1 app2\n   text  data  bss  filename\n 184320  4096  512  app1\n 176128  4096  512  app2' },
  },
  'cpp-abi': {
    'v1 vtable': { title: 'Old vtable layout', text: 'Slot numbers are baked into every caller compiled against v1.', code: 'mov rax, [rdi]      ; vptr\ncall [rax+8]        ; slot 1 = stop()' },
    'v2 vtable': { title: 'New vtable layout', text: 'Inserting pause() shifted stop() to slot 2.', code: '0: start()\n1: pause()   ← old callers land here\n2: stop()' },
    libA: { title: 'libA', text: 'Vendors its own copy of a header-only JSON library.', code: 'third_party/json-3.10/json.hpp\n#include "json-3.10/json.hpp"' },
    libB: { title: 'libB', text: 'Uses a newer copy of the same library with a different object layout.', code: 'find_package(nlohmann_json 3.11 REQUIRED)' },
    'one toolchain, one flag set': { title: 'Consistent toolchain', text: 'Every library in the graph built with the same compiler, standard library and ABI flags.', code: '# vcpkg triplet, e.g. x64-linux.cmake\nset(VCPKG_TARGET_ARCHITECTURE x64)\nset(VCPKG_CRT_LINKAGE dynamic)\nset(VCPKG_LIBRARY_LINKAGE static)' },
  },
  'cpp-testing': {
    SystemClock: { title: 'Production implementation', text: 'The real thing, used by main().', code: 'struct SystemClock : Clock {\n  int64_t now() const override {\n    using namespace std::chrono;\n    return duration_cast<milliseconds>(\n      steady_clock::now().time_since_epoch()).count();\n  }\n};' },
    'flaky test': { title: 'Quarantine', text: 'Label it so CI skips it, file a bug, fix it; never just retry forever.', code: 'set_tests_properties(net_reconnect PROPERTIES LABELS quarantine)\nctest -LE quarantine' },
    coverage: { title: 'Coverage report', text: 'Compile with coverage flags, run tests, generate a report.', code: 'target_compile_options(core PRIVATE --coverage)\ntarget_link_options(core PRIVATE --coverage)\n$ ctest && gcovr -r .. --html-details cov.html' },
  },
  'cpp-debugging': {
    SIGSEGV: { title: 'Segmentation fault', text: 'The CPU faulted on an address not mapped for that access, here through a null pointer.', code: 'Session* s = nullptr;\ns->on_read(buf);   // reads this->fd_ at address 0x8' },
    'same binary': { title: 'Matching binary', text: 'A core only makes sense with the exact build that produced it; keep released binaries and symbols.', code: '$ eu-unstrip -n --core core.4121\n0x400000+0x2000 3f2a9c… server' },
    'crash report': { title: 'Raw addresses', text: 'What a stripped binary’s crash handler can capture.', code: 'Crash at pc=0x4011a6\n#0 0x4011a6\n#1 0x401f02\n#2 0x7f3a1c029d90' },
  },
  'cpp-profiling': {
    'CPU running app': { title: 'Sampling', text: 'A timer interrupt fires; the profiler records the stack of whatever runs.', code: '$ perf record -F 999 -g ./app' },
    handle_request: { title: 'Parent frame', text: 'Its width includes everything it calls.', code: 'void handle_request(Req& r) {\n  auto doc = parse_json(r.body);\n  log(doc);\n}' },
    malloc: { title: 'Allocation cost', text: 'Many small allocations show up as a wide malloc bar.', code: 'std::vector<Field> fields;\nfields.reserve(n);  // one allocation instead of log2(n)' },
    rules: { title: 'Benchmark hygiene', text: 'Noise hides small differences.', code: '$ ./bench --benchmark_repetitions=10 \\\n    --benchmark_report_aggregates_only=true\n# pin CPU frequency, close other apps' },
  },
  'cpp-sanitizers': {
    'shadow memory': { title: 'How ASan works', text: 'Every 8 bytes of memory have a shadow byte saying how many are addressable; each load checks it.', code: 'shadow = (addr >> 3) + 0x7fff8000;\nif (*shadow != 0) report_error(addr);' },
    hits: { title: 'The shared variable', text: 'Plain int, touched by two threads without synchronisation.', code: 'std::atomic<int> hits{0};\nhits.fetch_add(1, std::memory_order_relaxed);' },
    fix: { title: 'Fix', text: 'Atomic for a counter, a mutex for anything bigger.', code: 'std::mutex m;\n{ std::lock_guard g(m); ++hits; }' },
    'asan preset': { title: 'ASan preset', text: 'One configure preset per sanitizer build.', code: '{ "name": "asan", "inherits": "debug",\n  "cacheVariables": { "SANITIZE": "address,undefined" } }' },
  },
  'cpp-errors': {
    'forgot the check': { title: 'The failure mode', text: 'The value is unspecified after an error, and nothing stops you using it.', code: 'std::error_code ec;\nauto n = fs::file_size(p, ec);\nbuf.resize(n);   // n == (uintmax_t)-1 → bad_alloc' },
    'and_then / transform': { title: 'Monadic operations', text: 'and_then takes a function returning expected; transform maps the value.', code: 'std::expected<Config, Error> validate(Config);\nConfig apply_defaults(Config);\n\nload(p).and_then(validate).transform(apply_defaults);' },
    core: { title: 'Contracts', text: 'A broken invariant means a bug; continuing would corrupt state.', code: 'void Account::withdraw(Money m) {\n  assert(m > Money{0});\n  assert(balance_ >= m);\n  balance_ -= m;\n}' },
  },
  'cpp-observability': {
    'async sink': { title: 'Async logger', text: 'The hot thread enqueues; a background thread formats and writes.', code: 'spdlog::init_thread_pool(8192, 1);\nauto log = spdlog::create_async<spdlog::sinks::basic_file_sink_mt>(\n  "app", "app.log");' },
    context: { title: 'Request id', text: 'Carried through the call chain and printed on every line.', code: 'thread_local std::string g_req_id;\nspdlog::info("[{}] order placed", g_req_id);' },
    counter: { title: 'Counter', text: 'Monotonic; rates are computed by the collector.', code: 'requests_total.Increment();' },
    'crash handler': { title: 'Out-of-process handler', text: 'A separate process captures the crashed one, since the crashed process can’t be trusted.', code: 'crashpad_handler --database=/var/crash \\\n  --url=https://crash.example.com/submit' },
  },
  'cpp-versioning': {
    '2.4.1': { title: 'Version triple', text: 'MAJOR.MINOR.PATCH.', code: 'project(calc VERSION 2.4.1)\nmessage(STATUS "${PROJECT_VERSION_MAJOR}")  # 2' },
    'libcore.so.3': { title: 'New major ABI', text: 'A different SONAME, so old and new apps each load the one they were built for.', code: 'set_target_properties(core PROPERTIES\n  VERSION 3.0.0 SOVERSION 3)' },
    'core.dll': { title: 'DLL', text: 'Holds the code; loaded at startup from the exe directory, system dirs or PATH.', code: 'install(TARGETS core RUNTIME DESTINATION bin\n  ARCHIVE DESTINATION lib)  # dll → bin, .lib → lib' },
    codesign: { title: 'Code signing', text: 'Gatekeeper refuses unsigned or broken signatures; sign nested dylibs first.', code: '$ codesign --force --timestamp -s "Developer ID" \\\n    MyApp.app/Contents/Frameworks/libcore.dylib\n$ codesign --verify --deep MyApp.app' },
  },
  'cpp-codebase': {
    'include/calc/': { title: 'Public headers', text: 'Installed and visible to users.', code: '#include <calc/core.h>' },
    'namespace calc': { title: 'Project namespace', text: 'Wrap everything; never put using namespace in a header.', code: 'namespace calc {\nclass Engine { … };\n}  // namespace calc' },
    seams: { title: 'Seam', text: 'A place where behaviour can change without editing the code, usually an interface or parameter.', code: '// before: reads global g_db\nint price(Item i);\n// after: dependency passed in\nint price(Item i, const PriceTable& t);' },
    strangler: { title: 'Strangler pattern', text: 'New implementation behind the old entry point; switch callers over gradually, then delete the old code.', code: 'int price(Item i) {\n  if (flags::new_pricing) return pricing::v2(i);\n  return legacy_price(i);\n}' },
  },
};

const DETAILS: Record<string, Record<string, Detail>> = {
  'cpp-architecture': {
    app: { title: 'app (composition root)', text: 'Creates the concrete objects and wires them together. The only layer that knows every implementation.', code: 'int main() {\n  net::HttpClient http{cfg.url};\n  storage::Db db{cfg.db};\n  core::Orders orders{http, db};  // interfaces\n  return run(orders);\n}' },
    net: { title: 'net library', text: 'HTTP and sockets. Depends on core for domain types, implements core interfaces.', code: 'class HttpClient : public core::Transport {\n public:\n  void send(const core::Message&) override;\n};' },
    storage: { title: 'storage library', text: 'Databases and files behind core-defined interfaces.', code: 'class Db : public core::OrderRepo { … };' },
    scheduler: { title: 'scheduler library', text: 'Timers and background jobs. A sibling of net, never including it.', code: 'target_link_libraries(scheduler PUBLIC core)' },
    core: { title: 'core library', text: 'Domain types and rules, pure C++, no I/O. Fast to build and to test.', code: 'namespace core {\nstruct Transport {\n  virtual ~Transport() = default;\n  virtual void send(const Message&) = 0;\n};\n}' },
    platform: { title: 'platform layer', text: 'Thin wrappers over OS and third-party APIs, so the rest never includes them directly.', code: 'namespace platform {\nstd::string env(std::string_view key);\nvoid set_thread_name(std::string_view);\n}' },
    'third party': { title: 'Third-party dependencies', text: 'Pulled in by one layer each. Swapping one touches that layer only.', code: 'find_package(fmt 10 REQUIRED)\nfind_package(absl REQUIRED)\ntarget_link_libraries(platform PRIVATE fmt::fmt absl::strings)' },
    FakeTransport: { title: 'Fake for tests', text: 'Implements the interface in memory and records what was sent.', code: 'struct FakeTransport : core::Transport {\n  std::vector<core::Message> sent;\n  void send(const core::Message& m) override {\n    sent.push_back(m);\n  }\n};' },
    core_test: { title: 'core_test', text: 'Links core and the fake only: no network, runs in milliseconds.', code: 'TEST(Orders, SendsConfirmation) {\n  FakeTransport t;\n  core::Orders o{t};\n  o.place({42});\n  EXPECT_EQ(t.sent.size(), 1);\n}' },
  },
  'cpp-rebuild': {
    'common.h': { title: 'A header everyone includes', text: 'Any edit here rebuilds every translation unit.', code: '#pragma once\n#include <map>\n#include <string>\n#include <vector>\nconstexpr int kMaxUsers = 1000;  // edit → 20 rebuilds' },
    'widget.h': { title: 'widget.h', text: 'Included by 20 files. What it includes, they all include.', code: '#pragma once\nclass Engine;              // forward declaration\nclass Widget {\n  Engine* engine_;         // pointer: no full type needed\n};' },
    'engine.h': { title: 'engine.h', text: 'Large and often edited. Only files that call Engine methods should include it.', code: '#pragma once\n#include <unordered_map>\n#include "physics.h"\nclass Engine { /* 400 lines */ };' },
    'widget.cpp': { title: 'Pimpl implementation', text: 'The Impl struct is only visible here.', code: 'struct Widget::Impl { Cache c; Pool p; Stats s; };\nWidget::Widget() : p_(std::make_unique<Impl>()) {}\nWidget::~Widget() = default;  // Impl complete here\nvoid Widget::draw() { p_->c.touch(); }' },
    toolchain: { title: 'Compiler launcher', text: 'ccache wraps every compile; hits skip the compiler entirely.', code: 'set(CMAKE_CXX_COMPILER_LAUNCHER ccache)\n\n$ ccache -s\ncache hit rate  92.4 %' },
  },
  'cpp-libs': {
    'core.o': { title: 'Object file', text: 'One compiled .cpp.', code: '$ nm -C core.o\n0000 T core::run()\n     U log::write(char const*)' },
    'libcore.a': { title: 'Static archive', text: 'A bundle of .o files with an index. The linker pulls members that resolve undefined symbols.', code: '$ ar t libcore.a\ncore.o\nlog.o\nutil.o' },
    'libcore.so': { title: 'Shared library', text: 'A loadable file with a dynamic symbol table and a SONAME.', code: '$ readelf -d libcore.so | grep SONAME\n SONAME  [libcore.so.1]\n$ nm -D --defined-only libcore.so | head -3' },
    app1: { title: 'Executable', text: 'Check what it needs at run time with ldd (otool -L on macOS).', code: '$ ldd app1\n  libcore.so.1 => /usr/lib/libcore.so.1\n  libc.so.6 => /lib/x86_64-linux-gnu/libc.so.6' },
    'ld.so': { title: 'Dynamic loader', text: 'Maps shared libraries at startup and resolves symbols. LD_DEBUG shows what it does.', code: '$ LD_DEBUG=libs ./app1\n  find library=libcore.so.1; searching\n   search path=/opt/app/lib (RUNPATH)\n  trying file=/opt/app/lib/libcore.so.1' },
    RAM: { title: 'Shared pages', text: 'Read-only code pages of a .so are mapped once and shared between processes.', code: '$ grep libcore /proc/$(pidof app1)/maps\n7f3a…000 r-xp … /usr/lib/libcore.so.1' },
  },
  'cpp-abi': {
    'libcore.so': { title: 'Library upgraded in place', text: 'Apps built against the old headers keep their old assumptions.', code: '$ abidiff libcore.so.1.0 libcore.so.1.1\nFunctions changes summary: 0 Removed, 1 Changed\n  type size changed from 64 to 320 (in bits)' },
    'v1 layout': { title: 'Layout the app compiled in', text: 'Offsets are constants in the app’s machine code.', code: 'mov eax, DWORD PTR [rdi+4]   ; cfg.timeout' },
    'v2 layout': { title: 'New layout', text: 'Same field names, different offsets.', code: 'static_assert(sizeof(Config) == 40);\nstatic_assert(offsetof(Config, timeout) == 36);' },
    'std::string': { title: 'std::string ABI', text: 'libstdc++ has two string layouts selected by _GLIBCXX_USE_CXX11_ABI; the new one is tagged [abi:cxx11] in symbol names.', code: '$ nm -C libcore.so | grep set_name\nT set_name(std::__cxx11::basic_string<…> const&)' },
    linker: { title: 'Duplicate inline symbols', text: 'Inline and template functions are emitted as weak symbols; the linker keeps any one copy without an error.', code: '$ nm -C libA.a libB.a | grep "json::parse"\nW nlohmann::json::parse(...)\nW nlohmann::json::parse(...)' },
  },
};

// ---------------- architecture ----------------
const ARCH_NODES = [
  N('app', 355, 40, 290, 110, 'app', 'main, wiring'),
  N('net', 40, 230, 290, 110, 'net', 'HTTP, sockets'),
  N('store', 355, 230, 290, 110, 'storage', 'DB, files'),
  N('sched', 670, 230, 290, 110, 'scheduler', 'jobs, timers'),
  N('core', 355, 420, 290, 110, 'core', 'domain types, logic'),
  N('plat', 355, 610, 290, 110, 'platform', 'OS, threads, time'),
  N('tp', 40, 800, 920, 110, 'third party', 'fmt · abseil · openssl · grpc'),
];
const ARCH_EDGES = ['app>net', 'app>store', 'app>sched', 'net>core', 'store>core', 'sched>core', 'core>plat', 'plat>tp'];

boardDemo('cpp-architecture', 'Large codebase architecture', 'Layered library graph, dependency cycles and breaking them with interfaces, and per-library tests.', {
  layers: [
    'Layers',
    {
      panel: 'Architecture',
      nodes: ARCH_NODES,
      edges: ARCH_EDGES,
      rows: [['libraries', 6], ['cycles', 0, 'ok']],
      beats: [
        { note: 'A large codebase is a graph of libraries. Keep it layered, each library depending only downward.', hot: all(ARCH_EDGES, 'accent') },
        { note: 'core holds domain types and logic with no I/O, so it compiles and tests in seconds.', hot: { core: 'current' } },
        { note: 'Services build on core side by side and don’t know about each other.', hot: { net: 'current', store: 'current', sched: 'current' } },
        { note: 'app sits on top and wires services together. It is the only place that sees everything.', hot: { app: 'current', 'app>net': 'accent', 'app>store': 'accent', 'app>sched': 'accent' } },
        { note: 'Third-party code sits behind your own platform layer, so swapping a library touches one place.', hot: { plat: 'current', tp: 'warn', 'plat>tp': 'accent' } },
      ],
    },
  ],
  cycle: [
    'Dependency cycle',
    {
      panel: 'Architecture',
      nodes: ARCH_NODES,
      edges: [...ARCH_EDGES, 'core>net'],
      beats: [
        { note: 'core needs to send a message, so someone includes net/client.h in core.', hot: { 'core>net': 'fail', core: 'warn' }, rows: [['cycles', 1, 'fail']] },
        { note: 'Now core and net depend on each other. Neither can be built, tested or reused alone.', hot: { 'core>net': 'fail', 'net>core': 'fail', core: 'fail', net: 'fail' }, rows: [['cycles', 1, 'fail']] },
        { note: 'Any change in net now rebuilds core, and with it everything above core.', hot: { net: 'warn', core: 'write', store: 'write', sched: 'write', app: 'write' }, rows: [['rebuilt on net edit', 5, 'warn']] },
        { note: 'Fix by inversion: core declares an abstract Transport interface, and net implements it.', hot: { core: 'ok', 'net>core': 'ok' }, sub: { core: 'interface Transport' }, hide: ['core>net'], rows: [['cycles', 0, 'ok']] },
        { note: 'app creates the net client and hands it to core. Every arrow points down again.', hot: { app: 'current', 'app>net': 'accent' }, sub: { core: 'interface Transport' }, hide: ['core>net'], rows: [['cycles', 0, 'ok']] },
      ],
    },
  ],
  tests: [
    'Tests per library',
    {
      panel: 'Tests',
      nodes: [...ARCH_NODES, N('fake', 40, 420, 290, 110, 'FakeTransport', 'in-memory'), N('tcore', 670, 420, 290, 110, 'core_test', 'gtest')],
      edges: [...ARCH_EDGES, 'fake>core', 'tcore>core'],
      beats: [
        { note: 'Each library gets its own test executable, linked against just that library.', hot: { tcore: 'current', 'tcore>core': 'accent' }, hide: ['fake'], rows: [['test binaries', 5]] },
        { note: 'core_test can’t use the real network, so it plugs a fake into the Transport seam.', hot: { fake: 'write', 'fake>core': 'accent', tcore: 'current' }, sub: { core: 'interface Transport' }, rows: [['network in tests', 'none', 'ok']] },
        { note: 'add_test registers each binary, and ctest -j runs them all in parallel.', hot: { tcore: 'ok' }, sub: { core: 'interface Transport' }, rows: [['ctest -j8', '5 passed', 'ok']] },
        { note: 'A change in net reruns only net’s tests and app’s, because the graph says what can be affected.', hot: { net: 'warn', app: 'write', core: 'visited', tcore: 'visited' }, sub: { core: 'interface Transport' }, rows: [['tests rerun', 2]] },
      ],
    },
  ],
});

// ---------------- build times ----------------
const TU_NAMES = ['main', 'http', 'router', 'json', 'db', 'cache', 'auth', 'user', 'order', 'cart', 'search', 'index', 'log', 'config', 'metrics', 'queue', 'worker', 'mail', 'report', 'admin'];
const TUS = TU_NAMES.map((n, i) => N(`tu${i}`, 40 + (i % 5) * 186, 250 + Math.floor(i / 5) * 130, 170, 110, `${n}.cpp`));
const tuIds = TUS.map((n) => n.id);
const tuBoard = (h1: string, h2: string, beats: Board['beats']): Board => ({
  panel: 'Rebuild',
  nodes: [N('h1', 40, 40, 440, 150, h1), N('h2', 520, 40, 440, 150, h2), ...TUS, N('sm', 40, 810, 920, 140, 'rebuilt')],
  edges: [],
  beats,
});
const rebuilt = (n: number, of = 20) => ({ sm: `${n} / ${of} rebuilt` });
const USES_ENGINE = ['tu0', 'tu10', 'tu16'];

boardDemo('cpp-rebuild', 'Build times at scale', 'Header fan-out, forward declarations, pimpl as a compilation firewall, and ccache / PCH / unity builds / modules.', {
  fanout: [
    'Header fan-out',
    tuBoard('common.h', 'every .cpp', [
      { note: '20 translation units, and every one includes common.h.', sub: { h1: 'included by 20', h2: 'includes common.h' }, label: rebuilt(0), rows: [['TUs', 20]] },
      { note: 'Add one constant to common.h and all 20 recompile.', hot: { h1: 'warn', ...all(tuIds, 'write'), sm: 'warn' }, sub: { h1: 'edited' }, label: rebuilt(20), rows: [['rebuilt', 20, 'warn'], ['time', '~3 min', 'warn']] },
      { note: 'Each TU re-parses every header it pulls in, often 100k+ lines after #include expansion.', hot: all(tuIds, 'write'), sub: { h1: '+ <vector> <string> <map>…' }, label: rebuilt(20), rows: [['lines per TU', '~120k']] },
      { note: 'Headers included everywhere must change rarely. Split them by topic so edits stay local.', hot: { h1: 'ok', sm: 'ok' }, sub: { h1: 'ids.h · limits.h · time.h' }, label: rebuilt(4), rows: [['rebuilt', 4, 'ok']] },
    ]),
  ],
  fwd: [
    'Forward declarations',
    tuBoard('widget.h', 'engine.h', [
      { note: 'widget.h includes engine.h just to hold an Engine* member.', hot: { h2: 'current' }, sub: { h1: '#include "engine.h"', h2: 'big, changes often' }, label: rebuilt(0), rows: [['widget.h users', 20]] },
      { note: 'So all 20 users of widget.h also depend on engine.h. Edit engine.h and all 20 rebuild.', hot: { h2: 'warn', ...all(tuIds, 'write'), sm: 'warn' }, sub: { h1: '#include "engine.h"', h2: 'edited' }, label: rebuilt(20), rows: [['rebuilt', 20, 'warn']] },
      { note: 'For pointers and references, a forward declaration, class Engine;, is enough.', hot: { h1: 'ok' }, sub: { h1: 'class Engine;', h2: 'big, changes often' }, label: rebuilt(0), rows: [['includes removed', 1]] },
      { note: 'Now editing engine.h rebuilds only the 3 files that actually call into Engine.', hot: { h2: 'warn', ...all(tuIds, 'visited'), ...all(USES_ENGINE, 'write'), sm: 'ok' }, sub: { h1: 'class Engine;', h2: 'edited' }, label: rebuilt(3), rows: [['rebuilt', 3, 'ok']] },
      { note: 'include-what-you-use and clang-tidy flag includes that could be forward declarations.', hot: all(USES_ENGINE, 'write'), sub: { h1: 'class Engine;' }, label: rebuilt(3), rows: [['tools', 'iwyu, clang-tidy']] },
    ]),
  ],
  pimpl: [
    'Pimpl firewall',
    tuBoard('widget.h', 'widget.cpp', [
      { note: 'widget.h declares Widget with its private members, so they are part of the header.', hot: { h1: 'current' }, sub: { h1: 'private: Cache c; Pool p;' }, label: rebuilt(0), rows: [['sizeof(Widget)', '96 B']] },
      { note: 'Adding a private field edits the header, so all 20 users recompile. Their object layout changed too.', hot: { h1: 'warn', ...all(tuIds, 'write'), sm: 'warn' }, sub: { h1: 'private: + Stats s;' }, label: rebuilt(20), rows: [['rebuilt', 20, 'warn'], ['sizeof(Widget)', '128 B', 'warn']] },
      { note: 'Pimpl moves the members into widget.cpp behind a std::unique_ptr<Impl>.', hot: { h1: 'ok', h2: 'current' }, sub: { h1: 'std::unique_ptr<Impl> p;', h2: 'struct Widget::Impl {…}' }, label: rebuilt(0), rows: [['sizeof(Widget)', '8 B', 'ok']] },
      { note: 'Private changes now rebuild one file, and Widget’s size never changes.', hot: { h2: 'write', ...all(tuIds, 'visited'), sm: 'ok' }, sub: { h1: 'std::unique_ptr<Impl> p;', h2: 'Impl: + Stats s;' }, label: rebuilt(1, 21), rows: [['rebuilt', 1, 'ok'], ['sizeof(Widget)', '8 B', 'ok']] },
      { note: 'The cost is a heap allocation and a pointer hop per call. Use it at library boundaries, not in hot small types.', hot: { h2: 'warn' }, sub: { h1: 'std::unique_ptr<Impl> p;', h2: 'new Impl per Widget' }, label: rebuilt(1, 21), rows: [['extra cost', 'alloc + indirection', 'warn']] },
    ]),
  ],
  cache: [
    'ccache, PCH, unity, modules',
    tuBoard('clean build', 'toolchain', [
      { note: 'A clean build recompiles everything, even files nobody changed.', hot: { ...all(tuIds, 'write'), sm: 'warn' }, sub: { h1: 'new CI runner', h2: 'g++ -O2' }, label: rebuilt(20), rows: [['compiled', 20, 'warn']] },
      { note: 'ccache hashes each preprocessed TU with its flags. A match replays the cached object instantly.', hot: { ...all(tuIds, 'ok'), h2: 'current', sm: 'ok' }, sub: { h1: 'new CI runner', h2: 'COMPILER_LAUNCHER=ccache' }, label: { sm: '20 / 20 cache hits' }, rows: [['compiled', 0, 'ok'], ['cache hits', 20, 'ok']] },
      { note: 'Precompiled headers parse the heavy common headers once per target, via target_precompile_headers.', hot: { h2: 'current' }, sub: { h1: '<vector> <string> <map>…', h2: 'pch: parsed once' }, label: rebuilt(20), rows: [['header parsing', '−60%', 'ok']] },
      { note: 'Unity builds glue several .cpp files into one TU, cutting repeated header parsing.', hot: { ...all(tuIds.slice(0, 5), 'read'), ...all(tuIds.slice(5, 10), 'write'), ...all(tuIds.slice(10, 15), 'protocol'), ...all(tuIds.slice(15), 'accent') }, sub: { h2: 'UNITY_BUILD ON' }, label: { sm: '4 unity TUs' }, rows: [['TUs compiled', 4, 'ok'], ['risk', 'name clashes', 'warn']] },
      { note: 'C++20 modules compile an interface once and import it, fixing the root cause. Toolchain support is still maturing.', hot: { h1: 'ok', h2: 'current' }, sub: { h1: 'import app.core;', h2: 'module interface' }, label: { sm: 'parse once, import everywhere' }, rows: [['CMake', '≥ 3.28 + Ninja']] },
    ]),
  ],
});

// ---------------- static vs shared ----------------
const LIB_NODES = [
  N('o1', 40, 40, 290, 110, 'core.o'),
  N('o2', 355, 40, 290, 110, 'log.o'),
  N('o3', 670, 40, 290, 110, 'util.o'),
  N('lib', 355, 230, 290, 110, 'libcore.a'),
  N('a1', 40, 420, 440, 110, 'app1'),
  N('a2', 520, 420, 440, 110, 'app2'),
  N('ld', 355, 610, 290, 110, 'ld.so', 'dynamic loader'),
  N('mem', 40, 800, 920, 130, 'RAM'),
];
const LIB_EDGES = ['o1>lib', 'o2>lib', 'o3>lib', 'lib>a1', 'lib>a2', 'ld>mem'];
const so = { lib: 'libcore.so' };

boardDemo('cpp-libs', 'Static vs shared libraries', 'Archives copied at link time vs .so loaded by ld.so; library search paths and RPATH; symbol visibility.', {
  static: [
    'Static (.a)',
    {
      panel: 'Libraries',
      nodes: LIB_NODES,
      edges: LIB_EDGES,
      beats: [
        { note: 'A static library is just an archive of object files, made with ar.', hot: { lib: 'current', 'o1>lib': 'accent', 'o2>lib': 'accent', 'o3>lib': 'accent' }, hide: ['a1', 'a2', 'ld', 'mem'], rows: [['objects', 3]] },
        { note: 'The linker copies only the objects app1 actually uses into app1.', hot: { a1: 'ok', o1: 'write', o2: 'write', o3: 'visited', 'lib>a1': 'accent' }, sub: { o3: 'not needed', a1: 'core.o + log.o inside' }, hide: ['a2', 'ld', 'mem'], rows: [['copied', 2]] },
        { note: 'Each executable gets its own copy. A fix in core means relinking every app.', hot: { a1: 'ok', a2: 'ok', 'lib>a2': 'accent', 'lib>a1': 'accent' }, sub: { a1: 'own copy', a2: 'own copy' }, hide: ['ld', 'mem'], rows: [['copies', 2], ['runtime deps', 0, 'ok']] },
        { note: 'GNU ld reads archives in order, so users come before providers: -lnet -lcore. target_link_libraries orders it for you.', hot: { lib: 'current' }, sub: { a1: 'ld … -lnet -lcore' }, hide: ['ld', 'mem'], rows: [['link order', 'matters', 'warn']] },
      ],
    },
  ],
  shared: [
    'Shared (.so)',
    {
      panel: 'Libraries',
      nodes: LIB_NODES,
      edges: [...LIB_EDGES, 'a1>ld', 'a2>ld'],
      beats: [
        { note: 'A shared library is linked once into one file: libcore.so, libcore.dylib or core.dll.', label: so, hot: { lib: 'current' }, hide: ['a1', 'a2', 'ld', 'mem'], rows: [['files', 1]] },
        { note: 'Linking app1 only records NEEDED libcore.so. No code is copied.', label: so, hot: { a1: 'current', 'lib>a1': 'accent' }, sub: { a1: 'NEEDED libcore.so' }, hide: ['a2', 'ld', 'mem'], rows: [['copied', 0]] },
        { note: 'At startup ld.so finds and maps libcore.so, then binds calls through the PLT and GOT.', label: so, hot: { ld: 'current', 'a1>ld': 'accent', 'a2>ld': 'accent' }, sub: { a1: 'NEEDED libcore.so', a2: 'NEEDED libcore.so' }, hide: ['mem'], rows: [['resolved at', 'load time']] },
        { note: 'Both apps share one copy of its code pages, and a fixed libcore.so reaches both without relinking, if the ABI holds.', label: so, hot: { mem: 'ok', 'ld>mem': 'accent' }, sub: { mem: 'one copy of libcore.so text' }, rows: [['copies in RAM', 1, 'ok']] },
      ],
    },
  ],
  notfound: [
    'Library not found',
    {
      panel: 'Loader',
      nodes: LIB_NODES,
      edges: [...LIB_EDGES, 'a1>ld'],
      beats: [
        { note: 'app1 runs fine from build/ but fails once installed: cannot open shared object libcore.so.', label: so, hot: { a1: 'fail', ld: 'fail', 'a1>ld': 'fail' }, hide: ['a2', 'mem'], rows: [['exit', 127, 'fail']] },
        { note: 'ld.so searches the binary’s RUNPATH, then LD_LIBRARY_PATH, then ld.so.cache and system dirs.', label: so, hot: { ld: 'current' }, sub: { ld: 'RUNPATH → env → cache' }, hide: ['a2', 'mem'], rows: [['RUNPATH', 'build/ (stripped)', 'warn']] },
        { note: 'CMake sets a build-tree RPATH and strips it on install. Set INSTALL_RPATH to $ORIGIN/../lib instead.', label: so, hot: { a1: 'ok', ld: 'ok', 'a1>ld': 'ok' }, sub: { a1: 'RUNPATH $ORIGIN/../lib' }, hide: ['a2', 'mem'], rows: [['RUNPATH', '$ORIGIN/../lib', 'ok']] },
        { note: 'macOS spells it @rpath and @loader_path. Keep LD_LIBRARY_PATH out of production.', label: so, hot: { ld: 'ok' }, sub: { ld: '@rpath on macOS' }, hide: ['a2', 'mem'], rows: [['relocatable', 'yes', 'ok']] },
      ],
    },
  ],
  visibility: [
    'Symbol visibility',
    {
      panel: 'Symbols',
      nodes: LIB_NODES,
      edges: LIB_EDGES,
      beats: [
        { note: 'By default every non-static function in libcore.so is exported, internals included.', label: so, hot: { lib: 'warn' }, sub: { lib: '4,812 exported' }, hide: ['a2', 'ld', 'mem'], rows: [['exported', 4812, 'warn']] },
        { note: 'That slows loading, blocks inlining across the library, and lets users depend on internals.', label: so, hot: { lib: 'warn', a1: 'warn' }, sub: { lib: '4,812 exported', a1: 'calls detail::parse()' }, hide: ['a2', 'ld', 'mem'], rows: [['exported', 4812, 'warn']] },
        { note: 'Build with CXX_VISIBILITY_PRESET hidden and mark the public API with an export macro.', label: so, hot: { lib: 'ok' }, sub: { lib: '37 exported (CORE_API)' }, hide: ['a2', 'ld', 'mem'], rows: [['exported', 37, 'ok']] },
        { note: 'The exported list is now your ABI, on purpose. Windows DLLs work this way by default.', label: so, hot: { lib: 'ok', a1: 'ok' }, sub: { lib: '37 exported (CORE_API)', a1: 'public API only' }, hide: ['a2', 'ld', 'mem'], rows: [['macro', 'GenerateExportHeader']] },
      ],
    },
  ],
});

// ---------------- ABI ----------------
const ABI_NODES = [
  N('app', 40, 300, 440, 120, 'app', 'built against v1'),
  N('lib', 520, 300, 440, 120, 'libcore.so', 'v1'),
  N('v1', 40, 480, 440, 140, 'v1 layout'),
  N('v2', 520, 480, 440, 140, 'v2 layout'),
  N('res', 40, 690, 920, 140, 'result'),
];

boardDemo('cpp-abi', 'ABI & ODR', 'Binary compatibility across shared-library upgrades: struct layout, vtable slots, std::string ABI, and silent ODR violations.', {
  layout: [
    'Struct layout',
    {
      panel: 'ABI',
      codeTitle: 'config.h in libcore',
      code: ['// v1                  // v2', 'struct Config {        struct Config {', '  int port;              std::string host;', '  int timeout;           int port;', '};                       int timeout;', '                       };'],
      nodes: ABI_NODES,
      edges: ['app>lib'],
      beats: [
        { note: 'app was compiled against v1, so sizeof(Config) = 8 and timeout at offset 4 are baked into its code.', hot: { app: 'current', v1: 'write' }, sub: { v1: 'port +0 · timeout +4', app: 'reads [cfg+4]' }, hide: ['v2', 'res'], rows: [['sizeof v1', '8 B']] },
        { note: 'v2 adds a std::string at the front. Ops upgrade libcore.so and don’t rebuild app.', hl: [2, 3, 4], hot: { lib: 'warn', v2: 'write' }, sub: { lib: 'v2', v2: 'host +0 · port +32 · timeout +36', app: 'reads [cfg+4]' }, hide: ['res'], rows: [['sizeof v2', '40 B', 'warn']] },
        { note: 'app still allocates 8 bytes and reads offset 4, which is now inside host. It crashes or reads garbage.', hot: { app: 'fail', res: 'fail', 'app>lib': 'fail' }, sub: { lib: 'v2', v2: 'host +0 · port +32 · timeout +36', res: 'heap overflow, wrong timeout' }, rows: [['result', 'corruption', 'fail']] },
        { note: 'It linked and loaded fine, since nothing checks layouts at run time.', hot: { res: 'fail' }, sub: { lib: 'v2', res: 'no error from ld.so' }, rows: [['detected by', 'nothing', 'fail']] },
        { note: 'Never change exposed layouts in a minor release: use pimpl, or bump the SONAME to libcore.so.2.', hot: { lib: 'ok', res: 'ok' }, sub: { lib: 'SONAME libcore.so.2', res: 'old app keeps libcore.so.1' }, rows: [['fix', 'pimpl / SONAME', 'ok']] },
      ],
    },
  ],
  vtable: [
    'Vtable slots',
    {
      panel: 'ABI',
      codeTitle: 'plugin.h in libcore',
      code: ['// v1                    // v2', 'struct Plugin {          struct Plugin {', '  virtual void start();    virtual void start();', '  virtual void stop();     virtual void pause();', '};                         virtual void stop();', '                         };'],
      nodes: ABI_NODES,
      edges: ['app>lib'],
      beats: [
        { note: 'app calls p->stop() through vtable slot 1, fixed when app was compiled.', hot: { app: 'current', v1: 'write' }, label: { v1: 'v1 vtable', v2: 'v2 vtable' }, sub: { app: 'call [vptr+8]', v1: '0 start · 1 stop' }, hide: ['v2', 'res'], rows: [['slot of stop', 1]] },
        { note: 'v2 inserts pause() before stop(). Every later slot shifts by one.', hl: [3, 4], hot: { lib: 'warn', v2: 'write' }, label: { v1: 'v1 vtable', v2: 'v2 vtable' }, sub: { lib: 'v2', app: 'call [vptr+8]', v1: '0 start · 1 stop', v2: '0 start · 1 pause · 2 stop' }, hide: ['res'], rows: [['slot of stop', 2, 'warn']] },
        { note: 'The old app still jumps to slot 1 and now calls pause(). No crash, just wrong behaviour.', hot: { app: 'fail', res: 'fail' }, label: { v1: 'v1 vtable', v2: 'v2 vtable', res: 'stop() runs pause()' }, sub: { lib: 'v2', app: 'call [vptr+8]', v1: '0 start · 1 stop', v2: '0 start · 1 pause · 2 stop', res: 'silent misbehaviour' }, rows: [['result', 'wrong call', 'fail']] },
        { note: 'Only append new virtuals at the end, or keep virtual interfaces out of your stable ABI.', hot: { res: 'ok' }, label: { v1: 'v1 vtable', v2: 'v2 vtable', res: 'append only' }, sub: { lib: 'v2', v1: '0 start · 1 stop', v2: '0 start · 1 stop · 2 pause' }, rows: [['fix', 'append virtuals', 'ok']] },
      ],
    },
  ],
  stdlib: [
    'std:: types across a boundary',
    {
      panel: 'ABI',
      codeTitle: 'core.h, exported from libcore.so',
      code: ['void set_name(const std::string& name);'],
      nodes: [
        N('lib', 40, 150, 440, 120, 'libcore.so', 'new string ABI'),
        N('app', 520, 150, 440, 120, 'app', 'new string ABI'),
        N('str', 40, 340, 920, 140, 'std::string', 'part of set_name’s ABI'),
        N('res', 40, 560, 920, 140, 'link'),
        N('fix', 40, 780, 920, 140, 'one toolchain, one flag set'),
      ],
      edges: ['app>lib'],
      beats: [
        { note: 'set_name takes a std::string, so the library’s std::string layout is part of its ABI.', hl: [0], hot: { str: 'current' }, hide: ['res', 'fix'], rows: [['boundary type', 'std::string']] },
        { note: 'app was built with _GLIBCXX_USE_CXX11_ABI=0, the old libstdc++ string, the library with the new one.', hot: { app: 'warn', str: 'warn' }, sub: { app: 'old string ABI', str: '8 B COW vs 32 B SSO' }, hide: ['res', 'fix'], rows: [['string ABIs', 2, 'warn']] },
        { note: 'The mangled names differ, so the link fails with undefined reference to set_name. Other mismatches link and crash.', hot: { res: 'fail', 'app>lib': 'fail' }, sub: { app: 'old string ABI', res: 'undefined reference: set_name' }, hide: ['fix'], rows: [['link', 'failed', 'fail']] },
        { note: 'Same story for MSVC Debug vs Release runtimes, and for libc++ vs libstdc++.', hot: { res: 'fail' }, sub: { res: '/MDd vs /MD · libc++ vs libstdc++' }, hide: ['fix'], rows: [['mix', 'never', 'fail']] },
        { note: 'Build the whole graph with one toolchain and one flag set, or expose only a C API across the boundary.', hot: { fix: 'ok', app: 'ok', lib: 'ok' }, sub: { fix: 'vcpkg triplet or extern "C"' }, rows: [['fix', 'one toolchain', 'ok']] },
      ],
    },
  ],
  odr: [
    'ODR violation',
    {
      panel: 'ODR',
      nodes: [
        N('a', 40, 60, 440, 130, 'libA', 'vendors json 3.10'),
        N('b', 520, 60, 440, 130, 'libB', 'uses json 3.11'),
        N('app', 355, 290, 290, 120, 'app'),
        N('ld', 40, 500, 920, 140, 'linker', 'json::parse() × 2'),
        N('res', 40, 740, 920, 140, 'result'),
      ],
      edges: ['app>a', 'app>b', 'app>ld', 'ld>res'],
      beats: [
        { note: 'libA vendors json 3.10, libB pulls json 3.11, and app links both.', hot: { a: 'current', b: 'current' }, hide: ['ld', 'res'], rows: [['json versions', 2, 'warn']] },
        { note: 'Header-only code compiles to inline functions, emitted in both libraries under the same mangled names.', hot: { ld: 'current', 'app>ld': 'accent' }, hide: ['res'], rows: [['duplicate symbols', 'hundreds']] },
        { note: 'The linker silently keeps one copy per name. libB may now run 3.10 code on 3.11 objects.', hot: { ld: 'warn', res: 'fail', 'ld>res': 'fail' }, sub: { ld: 'keeps libA’s copy' }, label: { res: 'memory corruption' }, rows: [['link errors', 0, 'fail']] },
        { note: 'That is an ODR violation: no error, just corruption far from the cause.', hot: { res: 'fail' }, label: { res: 'memory corruption' }, sub: { res: 'crash in unrelated code' }, rows: [['detected by', 'nothing', 'fail']] },
        { note: 'Allow one version of each dependency per build graph, which a package manager enforces. ASan and LTO’s -Wodr catch some cases.', hot: { res: 'ok', a: 'ok', b: 'ok' }, sub: { a: 'json 3.11', b: 'json 3.11' }, label: { res: 'one version' }, rows: [['json versions', 1, 'ok']] },
      ],
    },
  ],
});

// ---------------- testing ----------------
Object.assign(DETAILS, {
  'cpp-testing': {
    TEST: { title: 'TEST', text: 'A free-standing test case. EXPECT_* keeps going on failure, ASSERT_* stops the test.', code: 'TEST(Parser, RejectsEmpty) {\n  auto r = parse("");\n  ASSERT_FALSE(r.ok());\n  EXPECT_EQ(r.error(), Err::Empty);\n}' },
    TEST_F: { title: 'TEST_F with a fixture', text: 'A new fixture object is built for every test, so tests can’t leak state into each other.', code: 'class CartTest : public ::testing::Test {\n protected:\n  void SetUp() override { cart.add(apple); }\n  Cart cart;\n};\nTEST_F(CartTest, Total) { EXPECT_EQ(cart.total(), 3); }' },
    core_test: { title: 'Test binary', text: 'Filter while iterating, repeat to hunt flakiness, shuffle to catch order dependence.', code: '$ ./core_test --gtest_filter=Cart*\n$ ./core_test --gtest_repeat=100 --gtest_shuffle' },
    gtest_discover_tests: { title: 'CTest integration', text: 'Registers every TEST as its own ctest entry after the binary builds.', code: 'include(GoogleTest)\nadd_executable(core_test core_test.cpp)\ntarget_link_libraries(core_test PRIVATE core GTest::gtest_main)\ngtest_discover_tests(core_test)' },
    Clock: { title: 'A seam', text: 'A small interface for something the code shouldn’t control directly.', code: 'struct Clock {\n  virtual ~Clock() = default;\n  virtual int64_t now() const = 0;\n};' },
    FakeClock: { title: 'Fake', text: 'The test sets the time; no sleeping.', code: 'FakeClock clock;\nSession s{clock};\nclock.t += 31 * 60 * 1000;\nEXPECT_TRUE(s.expired());' },
    Session: { title: 'Code under test', text: 'Takes the interface by reference, so production and tests pass different clocks.', code: 'class Session {\n public:\n  explicit Session(const Clock& c) : clock_(c) {}\n  bool expired() const;\n private:\n  const Clock& clock_;\n};' },
    'gMock': { title: 'gMock', text: 'Generates mocks with call expectations.', code: 'class MockClock : public Clock {\n public:\n  MOCK_METHOD(int64_t, now, (), (const, override));\n};\nEXPECT_CALL(clk, now()).WillOnce(Return(0));' },
  },
});

boardDemo('cpp-testing', 'Testing at scale', 'GoogleTest cases and fixtures, fakes behind interfaces, and the test pyramid with CTest labels.', {
  gtest: [
    'GoogleTest',
    {
      panel: 'Tests',
      codeTitle: 'core_test.cpp',
      code: ['TEST(Parser, ParsesNumber) {', '  EXPECT_EQ(parse("42"), 42);', '}', 'class CartTest : public ::testing::Test {', ' protected:', '  void SetUp() override { cart.add(apple); }', '  Cart cart;', '};', 'TEST_F(CartTest, Total) { EXPECT_EQ(cart.total(), 3); }'],
      nodes: [N('t1', 40, 400, 440, 110, 'TEST', 'one case'), N('fx', 520, 400, 440, 110, 'TEST_F', 'fresh fixture each'), N('run', 40, 580, 920, 110, 'core_test', '--gtest_filter=Cart*'), N('disc', 40, 760, 920, 110, 'gtest_discover_tests', 'each TEST → one ctest')],
      edges: ['t1>run', 'fx>run', 'run>disc'],
      beats: [
        { note: 'GoogleTest turns each TEST into a registered case with readable failure messages.', hl: [0, 1, 2], hot: { t1: 'current' }, hide: ['run', 'disc'], rows: [['cases', 1]] },
        { note: 'A fixture class builds fresh state in SetUp for every TEST_F, so tests never share state.', hl: [3, 4, 5, 6, 7, 8], hot: { fx: 'current' }, hide: ['run', 'disc'], rows: [['cases', 2]] },
        { note: 'One test binary per library, and --gtest_filter runs a subset while you iterate.', hot: { run: 'current', 't1>run': 'accent', 'fx>run': 'accent' }, hide: ['disc'], rows: [['binaries', 'one per lib']] },
        { note: 'gtest_discover_tests registers every case with CTest, so ctest -j spreads them over all cores.', hot: { disc: 'ok', 'run>disc': 'accent' }, rows: [['ctest -j16', '1,240 tests, 9 s', 'ok']] },
      ],
    },
  ],
  mock: [
    'Fakes & mocks',
    {
      panel: 'Seams',
      codeTitle: 'clock.h',
      code: ['struct Clock {', '  virtual ~Clock() = default;', '  virtual int64_t now() const = 0;', '};', 'class FakeClock : public Clock {', ' public:', '  int64_t t = 0;', '  int64_t now() const override { return t; }', '};'],
      nodes: [N('iface', 355, 400, 290, 110, 'Clock', 'interface'), N('real', 40, 580, 440, 110, 'SystemClock', 'production'), N('fake', 520, 580, 440, 110, 'FakeClock', 'tests'), N('sess', 355, 760, 290, 110, 'Session', 'takes Clock&'), N('gm', 40, 900, 920, 90, 'gMock', 'generated mocks')],
      edges: ['real>iface', 'fake>iface', 'sess>iface'],
      beats: [
        { note: 'Code that reads the clock, network or disk is hard to test directly.', hot: { sess: 'warn' }, hide: ['iface', 'fake', 'gm', 'real'], sub: { sess: 'calls system_clock' }, rows: [['testable', 'no', 'warn']] },
        { note: 'Depend on a small interface instead, and pass it in.', hl: [0, 1, 2, 3], hot: { iface: 'current', sess: 'write', real: 'ok', 'sess>iface': 'accent', 'real>iface': 'accent' }, hide: ['fake', 'gm'], rows: [['seams', 1]] },
        { note: 'Tests pass a fake they control, so a 30-minute timeout is tested in microseconds.', hl: [4, 5, 6, 7, 8], hot: { fake: 'ok', 'fake>iface': 'accent' }, hide: ['gm'], rows: [['test time', '0.2 ms', 'ok']] },
        { note: 'gMock generates such doubles with call expectations, but a hand-written fake is often clearer.', hot: { gm: 'current' }, rows: [['prefer', 'fakes, then mocks']] },
      ],
    },
  ],
  pyramid: [
    'Test pyramid',
    {
      panel: 'Suite',
      nodes: [N('e2e', 355, 60, 290, 120, 'end-to-end', 'few, slow'), N('integ', 200, 230, 600, 120, 'integration', 'real DB, files'), N('unit', 40, 400, 920, 130, 'unit', 'thousands, ms each'), N('flaky', 40, 600, 440, 120, 'flaky test', 'quarantine + fix'), N('cov', 520, 600, 440, 120, 'coverage', 'gcov / llvm-cov'), N('ci', 40, 800, 920, 120, 'CI', 'unit on push · rest nightly')],
      edges: [],
      beats: [
        { note: 'Most tests should be fast unit tests, fewer integration tests, and a handful end to end.', hot: { unit: 'ok', integ: 'current', e2e: 'warn' }, hide: ['flaky', 'cov', 'ci'], rows: [['unit', 1200], ['integration', 80], ['e2e', 6]] },
        { note: 'Integration tests touch real databases or files, so they get labels and fixtures.', hot: { integ: 'current' }, hide: ['flaky', 'cov', 'ci'], rows: [['label', 'integration']] },
        { note: 'A flaky test is a bug: quarantine it with a label, then fix the race or timing it depends on.', hot: { flaky: 'warn' }, hide: ['cov', 'ci'], rows: [['flaky', 2, 'warn']] },
        { note: 'Coverage shows untested code, not tested behaviour, so use it to find gaps rather than as a target.', hot: { cov: 'current' }, hide: ['ci'], rows: [['line coverage', '78%']] },
        { note: 'CI runs unit tests on every push and the slower tiers on merge or nightly.', hot: { ci: 'ok', unit: 'ok' }, rows: [['push feedback', '< 5 min', 'ok']] },
      ],
    },
  ],
});

// ---------------- debugging & post-mortem ----------------
Object.assign(DETAILS, {
  'cpp-debugging': {
    'Cart::total()': { title: 'Frame #0', text: 'The function executing when the program stopped. info locals shows its variables.', code: '(gdb) frame 0\n(gdb) info locals\nsum = 7\ni = 3' },
    lldb: { title: 'gdb ↔ lldb', text: 'Same concepts, different spelling.', code: 'gdb              lldb\nbreak f          b f\nrun              r\nbt               bt\nprint x          p x\nnext / step      n / s\nwatch x          w s v x' },
    'core file': { title: 'Core dump', text: 'The dead process’s memory, written by the kernel. Where it goes is set by core_pattern.', code: '$ cat /proc/sys/kernel/core_pattern\n|/usr/lib/systemd/systemd-coredump …\n$ coredumpctl gdb server' },
    'gdb server core': { title: 'Post-mortem session', text: 'No live process: you can inspect but not continue.', code: '$ gdb ./server core.4121\n(gdb) bt\n(gdb) frame 1\n(gdb) print *this' },
    'app.debug': { title: 'Separate debug info', text: 'DWARF split from the binary, matched by build-id.', code: '$ readelf -n app | grep "Build ID"\n  Build ID: 3f2a9c…\n$ ls /usr/lib/debug/.build-id/3f/2a9c….debug' },
    symbolized: { title: 'Symbolized stack', text: 'Addresses mapped back to code.', code: '$ addr2line -e app.debug -f -C 0x4011a6 0x401f02\nCart::total()\n/src/cart.cpp:41\ncheckout(Cart&)\n/src/order.cpp:17' },
  },
});

boardDemo('cpp-debugging', 'Debugging & post-mortem', 'gdb/lldb breakpoints and backtraces, core dumps from crashed processes, split debug info and addr2line.', {
  gdb: [
    'Live debugging',
    {
      panel: 'Debugger',
      codeTitle: 'gdb session',
      code: ['$ gdb ./app', '(gdb) break Cart::total', '(gdb) run', '(gdb) bt', '#0  Cart::total() at cart.cpp:41', '#1  checkout(Cart&) at order.cpp:17', '#2  main at main.cpp:9', '(gdb) print items_.size()', '$1 = 3'],
      nodes: [N('f0', 40, 420, 920, 100, 'Cart::total()', 'cart.cpp:41'), N('f1', 40, 540, 920, 100, 'checkout(Cart&)', 'order.cpp:17'), N('f2', 40, 660, 920, 100, 'main', 'main.cpp:9'), N('cmds', 40, 830, 920, 120, 'lldb', 'b · r · bt · p · n · s · finish')],
      edges: ['f2>f1', 'f1>f0'],
      beats: [
        { note: 'A debugger stops a live program so you can look inside. Build Debug or RelWithDebInfo so it has symbols.', hl: [0], hide: ['f0', 'f1', 'f2', 'cmds'], rows: [['symbols', '-g']] },
        { note: 'break stops at a function or file:line, and run starts the program.', hl: [1, 2], hot: { f0: 'current' }, hide: ['f1', 'f2', 'cmds'], rows: [['stopped at', 'cart.cpp:41']] },
        { note: 'bt prints the call stack: who called whom to get here.', hl: [3, 4, 5, 6], hot: { f0: 'current', f1: 'write', f2: 'write', 'f2>f1': 'accent', 'f1>f0': 'accent' }, hide: ['cmds'], rows: [['frames', 3]] },
        { note: 'print evaluates expressions in the stopped frame, and up and down move between frames.', hl: [7, 8], hot: { f0: 'current' }, hide: ['cmds'], rows: [['items_.size()', 3]] },
        { note: 'lldb on macOS has the same ideas with shorter spellings.', hot: { cmds: 'current' }, rows: [['tools', 'gdb, lldb, IDE']] },
      ],
    },
  ],
  core: [
    'Core dumps',
    {
      panel: 'Post-mortem',
      codeTitle: 'terminal',
      code: ['$ ulimit -c unlimited', '$ ./server', 'Segmentation fault (core dumped)', '$ gdb ./server core.4121', '#0  0x0 in ?? ()', '#1  Session::on_read (this=0x0) at session.cpp:88', '(gdb) frame 1', '(gdb) print this', '$1 = (Session *) 0x0'],
      nodes: [N('crash', 40, 400, 440, 110, 'SIGSEGV', 'null this'), N('core', 520, 400, 440, 110, 'core file', 'memory snapshot'), N('bin', 40, 580, 440, 110, 'same binary', '+ debug symbols'), N('gdb', 520, 580, 440, 110, 'gdb server core'), N('fix', 40, 780, 920, 120, 'root cause', 'Session freed during read')],
      edges: ['crash>core', 'core>gdb', 'bin>gdb', 'gdb>fix'],
      beats: [
        { note: 'A production crash can’t be stepped through, but it can leave a core dump.', hl: [0, 1, 2], hot: { crash: 'fail', core: 'write', 'crash>core': 'accent' }, hide: ['bin', 'gdb', 'fix'], rows: [['signal', 'SIGSEGV', 'fail']] },
        { note: 'The core file is the process memory at the moment it died.', hot: { core: 'current' }, hide: ['bin', 'gdb', 'fix'], rows: [['core size', '1.2 GB']] },
        { note: 'Load it with the exact same binary and its symbols, and bt shows where it died.', hl: [3, 4, 5], hot: { gdb: 'current', bin: 'current', 'core>gdb': 'accent', 'bin>gdb': 'accent' }, hide: ['fix'], rows: [['crashed in', 'on_read']] },
        { note: 'this is null in on_read: the Session was destroyed while a read was still in flight.', hl: [6, 7, 8], hot: { fix: 'warn', 'gdb>fix': 'accent' }, rows: [['bug', 'use-after-free', 'warn']] },
        { note: 'On servers, systemd-coredump collects cores automatically, and coredumpctl opens them.', hot: { core: 'ok' }, sub: { core: 'coredumpctl gdb' }, rows: [['collection', 'automatic', 'ok']] },
      ],
    },
  ],
  symbols: [
    'Symbols & addr2line',
    {
      panel: 'Symbols',
      codeTitle: 'terminal',
      code: ['$ objcopy --only-keep-debug app app.debug', '$ strip --strip-debug app', '$ objcopy --add-gnu-debuglink=app.debug app', '$ addr2line -e app.debug -f -C 0x4011a6', 'Cart::total()', '/src/cart.cpp:41'],
      nodes: [N('full', 40, 300, 290, 110, 'app + DWARF', '48 MB'), N('str', 355, 300, 290, 110, 'app (stripped)', '6 MB, shipped'), N('dbg', 670, 300, 290, 110, 'app.debug', 'kept by you'), N('trace', 40, 490, 920, 110, 'crash report', '0x4011a6 0x401f02 …'), N('sym', 40, 670, 920, 110, 'symbolized', 'Cart::total() cart.cpp:41'), N('bid', 40, 850, 920, 110, 'build-id', 'binary ↔ symbols')],
      edges: ['full>str', 'str>dbg', 'trace>sym'],
      beats: [
        { note: 'Debug info is large, so release binaries ship stripped.', hl: [0, 1], hot: { full: 'current', str: 'write', 'full>str': 'accent' }, hide: ['dbg', 'trace', 'sym', 'bid'], rows: [['shipped size', '6 MB', 'ok']] },
        { note: 'The debug info goes into a separate file, linked to the binary by a build-id.', hl: [2], hot: { dbg: 'write', 'str>dbg': 'accent' }, hide: ['trace', 'sym', 'bid'], rows: [['kept', 'app.debug']] },
        { note: 'A crash report from the field contains only raw addresses.', hot: { trace: 'warn' }, hide: ['sym', 'bid'], rows: [['readable', 'no', 'warn']] },
        { note: 'addr2line or a symbol server maps them back to function, file and line.', hl: [3, 4, 5], hot: { sym: 'ok', 'trace>sym': 'accent' }, hide: ['bid'], rows: [['readable', 'yes', 'ok']] },
        { note: 'Archive symbols for every released build, or old crash reports become unreadable.', hot: { bid: 'current', dbg: 'ok' }, rows: [['archive', 'per release']] },
      ],
    },
  ],
});

// ---------------- profiling ----------------
const SAMPLES = ['parse', 'parse', 'hash', 'parse', 'alloc', 'parse', 'hash', 'parse', 'log', 'parse'];
const SAMPLE_NODES = SAMPLES.map((f, i) => N(`s${i}`, 40 + i * 92, 300, 84, 90, f));
const sampleIds = SAMPLE_NODES.map((n) => n.id);
Object.assign(DETAILS, {
  'cpp-profiling': {
    'perf record -g ./app': { title: 'perf', text: 'Linux sampling profiler. -g records call stacks; build with frame pointers or DWARF unwinding.', code: '$ perf record -g --call-graph dwarf ./app\n$ perf report --no-children\n  60.1%  app  parse_json\n  19.8%  app  hash_key' },
    'parse_json': { title: 'A wide bar', text: 'Width is the share of samples where this function was on the stack.', code: 'for (auto& tok : tokens)\n  fields.push_back(std::string(tok));  // copy per token\n// fix: std::string_view into the buffer' },
    'std::string ctor': { title: 'Hidden cost', text: 'Allocations and copies show up as constructors and malloc under your function.', code: 'std::string key = std::string(tok);  // alloc\nstd::string_view key = tok;          // free' },
    'Tracy / Perfetto': { title: 'Timeline profilers', text: 'Show each instrumented scope on a per-thread timeline.', code: '#include <tracy/Tracy.hpp>\nvoid handle(Request& r) {\n  ZoneScoped;\n  parse(r);\n}' },
    'BM_Sum/1024': { title: 'Benchmark output', text: 'Time per iteration, CPU time, and iterations run.', code: 'Benchmark           Time     CPU  Iterations\nBM_Sum/1024        85 ns   85 ns     8230511\nBM_Sum/1048576  98012 ns 97990 ns       7143' },
    'without DoNotOptimize': { title: 'Dead-code elimination', text: 'An unused result lets the compiler delete the loop, so you measure nothing.', code: 'for (auto _ : s)\n  std::accumulate(v.begin(), v.end(), 0);  // removed!' },
  },
});

boardDemo('cpp-profiling', 'Profiling', 'Sampling profilers and flame graphs, instrumented timelines, and micro-benchmarks with Google Benchmark.', {
  sampling: [
    'Sampling',
    {
      panel: 'Profile',
      nodes: [N('cpu', 40, 120, 920, 120, 'CPU running app', 'interrupted ~1000×/s'), ...SAMPLE_NODES, N('r1', 40, 460, 920, 100, 'parse() 60%'), N('r2', 40, 580, 920, 100, 'hash() 20%'), N('r3', 40, 700, 920, 100, 'alloc() 10% · log() 10%'), N('cmd', 40, 860, 920, 110, 'perf record -g ./app')],
      edges: [],
      beats: [
        { note: 'A sampling profiler interrupts the program about 1000 times a second and records where it is.', hot: { cpu: 'current' }, hide: [...sampleIds, 'r1', 'r2', 'r3', 'cmd'], rows: [['samples', 0]] },
        { note: 'Each sample is one call stack. It is cheap, and the program runs almost unmodified.', hot: all(sampleIds, 'write'), hide: ['r1', 'r2', 'r3', 'cmd'], rows: [['samples', 10], ['overhead', '~2%', 'ok']] },
        { note: 'Count samples per function: where most samples land is where the time goes.', hot: { ...all(sampleIds.filter((_, i) => SAMPLES[i] === 'parse'), 'fail'), r1: 'fail', r2: 'warn', r3: 'current' }, hide: ['cmd'], rows: [['hottest', 'parse()', 'fail']] },
        { note: 'perf on Linux, Instruments on macOS, and VTune or WPA on Windows all work this way.', hot: { cmd: 'current' }, rows: [['tool', 'perf / Instruments']] },
      ],
    },
  ],
  flame: [
    'Flame graphs',
    {
      panel: 'Flame graph',
      nodes: [N('cmd', 40, 60, 920, 110, 'perf script | flamegraph.pl'), N('str', 40, 400, 300, 90, 'std::string ctor'), N('parse', 40, 500, 420, 90, 'parse_json'), N('alloc', 470, 500, 270, 90, 'malloc'), N('handle', 40, 600, 700, 90, 'handle_request'), N('log', 760, 600, 200, 90, 'log'), N('run', 40, 700, 920, 90, 'run_server'), N('main', 40, 800, 920, 90, 'main')],
      edges: [],
      beats: [
        { note: 'A flame graph stacks sampled call stacks, callers at the bottom and callees on top.', hot: { cmd: 'current', main: 'current', run: 'current' }, rows: [['samples', '48,210']] },
        { note: 'Width is time. parse_json and malloc under handle_request take most of it.', hot: { parse: 'warn', alloc: 'warn', handle: 'current' }, rows: [['handle_request', '76%']] },
        { note: 'Look for wide plateaus: std::string construction inside parse_json copies every token.', hot: { str: 'fail', parse: 'warn' }, rows: [['string copies', '31%', 'fail']] },
        { note: 'Fix the widest bar first; narrow towers don’t matter however deep they are.', hot: { str: 'ok', parse: 'ok' }, sub: { str: 'string_view: 2%' }, rows: [['handle_request', '48%', 'ok']] },
      ],
    },
  ],
  instrument: [
    'Instrumentation',
    {
      panel: 'Timeline',
      codeTitle: 'timer.h',
      code: ['struct ScopedTimer {', '  const char* name; Clock::time_point t0 = Clock::now();', '  ~ScopedTimer() { record(name, Clock::now() - t0); }', '};', 'void handle(Request& r) {', '  ScopedTimer t{"handle"};', '  parse(r); query(r);', '}'],
      nodes: [N('ev1', 40, 400, 920, 100, 'handle', '2.1 ms'), N('ev2', 40, 520, 580, 100, 'parse', '1.6 ms'), N('ev3', 640, 520, 320, 100, 'db', '0.4 ms'), N('tool', 40, 700, 920, 110, 'Tracy / Perfetto', 'timeline per thread'), N('cost', 40, 860, 920, 110, 'cost', '~20 ns per scope')],
      edges: [],
      beats: [
        { note: 'Instrumentation measures exactly the scopes you mark, with RAII timers.', hl: [0, 1, 2, 3], hide: ['ev1', 'ev2', 'ev3', 'tool', 'cost'], rows: [['scopes', 3]] },
        { note: 'Every request gets its own timeline, so you see what one slow request did, not an average.', hl: [4, 5, 6, 7], hot: { ev1: 'current', ev2: 'warn', ev3: 'write' }, hide: ['tool', 'cost'], rows: [['slowest part', 'parse']] },
        { note: 'Tracy or Perfetto draw these per thread, which exposes lock waits and idle gaps.', hot: { tool: 'current' }, hide: ['cost'], rows: [['threads', 8]] },
        { note: 'Each timer costs some nanoseconds, so instrument coarse scopes and sample the rest.', hot: { cost: 'warn' }, rows: [['overhead', '~20 ns / scope', 'warn']] },
      ],
    },
  ],
  bench: [
    'Micro-benchmarks',
    {
      panel: 'Benchmark',
      codeTitle: 'bench.cpp',
      code: ['static void BM_Sum(benchmark::State& s) {', '  std::vector<int> v(s.range(0), 1);', '  for (auto _ : s) {', '    int sum = std::accumulate(v.begin(), v.end(), 0);', '    benchmark::DoNotOptimize(sum);', '  }', '}', 'BENCHMARK(BM_Sum)->Range(1 << 10, 1 << 20);'],
      nodes: [N('b1', 40, 400, 920, 100, 'BM_Sum/1024', '85 ns'), N('b2', 40, 520, 920, 100, 'BM_Sum/1048576', '98 µs'), N('trap', 40, 660, 920, 110, 'without DoNotOptimize', '0.3 ns: loop deleted'), N('rules', 40, 820, 920, 120, 'rules', 'Release · quiet CPU · repeat')],
      edges: [],
      beats: [
        { note: 'Google Benchmark runs a loop body many times and reports the cost per iteration.', hl: [2, 3, 4, 5], hide: ['b1', 'b2', 'trap', 'rules'], rows: [['framework', 'google/benchmark']] },
        { note: 'Range runs several input sizes, showing how cost grows with the data.', hl: [7], hot: { b1: 'ok', b2: 'current' }, hide: ['trap', 'rules'], rows: [['scaling', 'linear']] },
        { note: 'If the result is unused, the optimiser deletes the work; DoNotOptimize keeps it alive.', hl: [4], hot: { trap: 'fail' }, hide: ['rules'], rows: [['bogus result', '0.3 ns', 'fail']] },
        { note: 'Benchmark Release builds on a quiet machine, and repeat runs before trusting a 5% difference.', hot: { rules: 'ok' }, rows: [['--benchmark_repetitions', 10]] },
      ],
    },
  ],
});

// ---------------- sanitizers ----------------
Object.assign(DETAILS, {
  'cpp-sanitizers': {
    'ERROR: AddressSanitizer': { title: 'ASan report', text: 'Names the bad access, where the memory was freed, and where it was allocated.', code: '==4121==ERROR: AddressSanitizer: heap-use-after-free\nREAD of size 4 at 0x602000000010 thread T0\n    #0 main main.cpp:4\nfreed by thread T0 here:\n    #1 std::vector<int>::push_back main.cpp:3\npreviously allocated by thread T0 here:\n    #1 main main.cpp:1' },
    'WARNING: ThreadSanitizer': { title: 'TSan report', text: 'Shows both conflicting accesses with their stacks.', code: 'WARNING: ThreadSanitizer: data race\n  Write of size 4 by thread T2:\n    #0 lambda main.cpp:3\n  Previous write of size 4 by thread T1:\n    #0 lambda main.cpp:2' },
    'signed overflow': { title: 'UBSan report', text: 'One line per UB occurrence, with file and line.', code: 'avg.cpp:1:36: runtime error: signed integer overflow:\n2147483647 + 1 cannot be represented in type \'int\'' },
    ASAN_OPTIONS: { title: 'Runtime options', text: 'Environment variables tune each sanitizer.', code: 'ASAN_OPTIONS=detect_leaks=1:abort_on_error=1\nUBSAN_OPTIONS=print_stacktrace=1:halt_on_error=1\nTSAN_OPTIONS=second_deadlock_stack=1' },
    'msan / valgrind': { title: 'Uninitialized reads', text: 'MemorySanitizer (clang, Linux) or Valgrind catch reads of uninitialized memory. Valgrind needs no rebuild but runs 20-50x slower.', code: '$ valgrind --track-origins=yes ./app\nConditional jump depends on uninitialised value(s)' },
  },
});

boardDemo('cpp-sanitizers', 'Sanitizers in depth', 'ASan for memory errors, UBSan for undefined behaviour, TSan for data races, and wiring them into CMake and CI.', {
  asan: [
    'AddressSanitizer',
    {
      panel: 'ASan',
      code: ['std::vector<int> v = {1, 2, 3};', 'int* p = &v[0];', 'v.push_back(4);          // reallocates', 'std::cout << *p;         // use-after-free'],
      nodes: [N('old', 40, 240, 440, 110, 'old buffer', 'freed'), N('neu', 520, 240, 440, 110, 'new buffer', '1 2 3 4'), N('p', 40, 420, 440, 110, 'p', 'still → old'), N('rep', 40, 600, 920, 160, 'ERROR: AddressSanitizer', 'heap-use-after-free READ of size 4'), N('how', 40, 820, 920, 120, 'shadow memory', 'poisoned bytes')],
      edges: ['p>old'],
      beats: [
        { note: 'p points into the vector’s buffer.', hl: [0, 1], hot: { old: 'current', p: 'write', 'p>old': 'accent' }, label: { old: 'buffer' }, sub: { old: '1 2 3', p: '→ buffer' }, hide: ['neu', 'rep', 'how'], rows: [['capacity', 3]] },
        { note: 'push_back outgrows the capacity, moves the elements and frees the old buffer.', hl: [2], hot: { old: 'fail', neu: 'write' }, hide: ['rep', 'how'], rows: [['capacity', 6]] },
        { note: 'Reading *p is use-after-free, and without ASan it usually prints 1 and carries on.', hl: [3], hot: { p: 'warn', 'p>old': 'fail' }, hide: ['rep', 'how'], rows: [['visible bug', 'none', 'warn']] },
        { note: 'Built with -fsanitize=address, the read aborts with a report naming both the free and the use.', hot: { rep: 'fail' }, hide: ['how'], rows: [['caught', 'yes', 'ok']] },
        { note: 'ASan marks freed and out-of-bounds bytes in shadow memory, costing about 2x time and 3x memory.', hot: { how: 'current' }, rows: [['slowdown', '~2x'], ['memory', '~3x']] },
      ],
    },
  ],
  ubsan: [
    'UBSan',
    {
      panel: 'UBSan',
      code: ['int avg(int a, int b) { return (a + b) / 2; }', 'avg(INT_MAX, 1);', 'int arr[4]; int i = 4;', 'arr[i] = 1;', 'int x = 1 << 32;'],
      nodes: [N('u1', 40, 280, 920, 110, 'signed overflow', '2147483647 + 1 in int'), N('u2', 40, 430, 920, 110, 'index out of bounds', 'index 4 for int[4]'), N('u3', 40, 580, 920, 110, 'shift too large', 'shift exponent 32'), N('flag', 40, 780, 920, 120, '-fsanitize=undefined', '~20% slower')],
      edges: [],
      beats: [
        { note: 'UndefinedBehaviorSanitizer checks the operations the optimiser assumes never go wrong.', hide: ['u1', 'u2', 'u3'], hot: { flag: 'current' }, rows: [['checks', '~20 kinds']] },
        { note: 'Signed overflow in a + b is undefined, not wraparound.', hl: [0, 1], hot: { u1: 'fail' }, hide: ['u2', 'u3'], rows: [['reports', 1]] },
        { note: 'Out-of-bounds indexing and oversized shifts are reported at the exact line.', hl: [2, 3, 4], hot: { u1: 'fail', u2: 'fail', u3: 'fail' }, rows: [['reports', 3]] },
        { note: 'It is cheap, so many teams keep UBSan on in every test build.', hot: { flag: 'ok' }, rows: [['cost', 'low', 'ok']] },
      ],
    },
  ],
  tsan: [
    'ThreadSanitizer',
    {
      panel: 'TSan',
      code: ['int hits = 0;', 'std::thread a([&] { for (int i = 0; i < N; ++i) hits++; });', 'std::thread b([&] { for (int i = 0; i < N; ++i) hits++; });', 'a.join(); b.join();'],
      nodes: [N('ta', 40, 260, 440, 110, 'thread a', 'writes hits'), N('tb', 520, 260, 440, 110, 'thread b', 'writes hits'), N('mem', 280, 440, 440, 110, 'hits', '1374, not 2000'), N('rep', 40, 630, 920, 140, 'WARNING: ThreadSanitizer', 'data race on hits'), N('fix', 40, 830, 920, 110, 'fix', 'std::atomic<int> or a mutex')],
      edges: ['ta>mem', 'tb>mem'],
      beats: [
        { note: 'Two threads increment the same int without synchronisation.', hl: [1, 2], hot: { ta: 'current', tb: 'current' }, sub: { mem: '?' }, hide: ['rep', 'fix'], rows: [['threads', 2]] },
        { note: 'Updates get lost, and the result changes from run to run.', hl: [3], hot: { mem: 'fail', 'ta>mem': 'fail', 'tb>mem': 'fail' }, hide: ['rep', 'fix'], rows: [['expected', 2000], ['got', 1374, 'fail']] },
        { note: '-fsanitize=thread flags the race even on runs where the answer happens to be right.', hot: { rep: 'fail' }, hide: ['fix'], rows: [['races', 1, 'fail']] },
        { note: 'Make hits atomic or guard it with a mutex; TSan needs its own build and runs 5-15x slower.', hot: { fix: 'ok', mem: 'ok' }, sub: { mem: '2000' }, rows: [['races', 0, 'ok']] },
      ],
    },
  ],
  setup: [
    'In CMake & CI',
    {
      panel: 'Setup',
      code: ['option(SANITIZE "address,undefined or thread" "")', 'if(SANITIZE)', '  add_compile_options(-fsanitize=${SANITIZE}', '                      -fno-omit-frame-pointer)', '  add_link_options(-fsanitize=${SANITIZE})', 'endif()'],
      nodes: [N('a', 40, 320, 290, 110, 'asan preset', 'address,undefined'), N('t', 355, 320, 290, 110, 'tsan preset', 'thread'), N('m', 670, 320, 290, 110, 'msan / valgrind', 'uninit reads'), N('env', 40, 520, 920, 110, 'ASAN_OPTIONS', 'detect_leaks=1:abort_on_error=1'), N('rule', 40, 710, 920, 120, 'CI rule', 'all sanitizer jobs green')],
      edges: [],
      beats: [
        { note: 'Sanitizers are compile and link flags, so wire them through one CMake option for the whole build.', hl: [0, 1, 2, 3, 4, 5], hide: ['a', 't', 'm', 'env', 'rule'], rows: [['option', 'SANITIZE']] },
        { note: 'ASan and UBSan combine well, while TSan and MSan each need a separate build.', hot: { a: 'current', t: 'current', m: 'current' }, hide: ['env', 'rule'], rows: [['builds', 3]] },
        { note: 'Runtime options tune them, like leak detection or stopping at the first error.', hot: { env: 'current' }, hide: ['rule'], rows: [['leaks', 'detected']] },
        { note: 'Run the whole test suite under each sanitizer in CI, where they find bugs the tests alone miss.', hot: { rule: 'ok', a: 'ok', t: 'ok' }, rows: [['gate', 'required', 'ok']] },
      ],
    },
  ],
});

// ---------------- error handling ----------------
Object.assign(DETAILS, {
  'cpp-errors': {
    unwinding: { title: 'Stack unwinding', text: 'Every destructor between throw and catch runs, which is why RAII makes exceptions safe.', code: 'void f() {\n  std::lock_guard g(m);   // unlocked on throw\n  auto buf = std::make_unique<char[]>(n);  // freed\n  risky();                // throws\n}' },
    '[[nodiscard]]': { title: '[[nodiscard]]', text: 'The compiler warns when the result is dropped.', code: '[[nodiscard]] std::error_code save(const Doc&);\n\nsave(doc);  // warning: ignoring return value' },
    value: { title: 'std::expected', text: 'Holds a T or an E. Check with if (r), read with *r or r.error().', code: 'std::expected<int, std::string> parse_int(std::string_view s) {\n  int v;\n  auto [p, ec] = std::from_chars(s.begin(), s.end(), v);\n  if (ec != std::errc{}) return std::unexpected("bad int");\n  return v;\n}' },
    'I/O + third party': { title: 'Translate at the edge', text: 'Convert foreign errors into your own type once, at the boundary.', code: 'Error from_curl(CURLcode c) {\n  return {Err::Network, curl_easy_strerror(c)};\n}' },
    'app boundary': { title: 'Top-level handler', text: 'The last line of defence: log with context, exit with a clear status.', code: 'int main() try {\n  return run();\n} catch (const std::exception& e) {\n  log_fatal("unhandled: {}", e.what());\n  return 1;\n}' },
  },
});

boardDemo('cpp-errors', 'Error-handling strategy', 'Exceptions, error codes and std::expected: costs and guarantees of each, and a single policy per codebase layer.', {
  exceptions: [
    'Exceptions',
    {
      panel: 'Errors',
      code: ['Config load(const std::string& path) {', '  std::ifstream f(path);', '  if (!f) throw std::runtime_error("cannot open " + path);', '  return parse(f);            // may throw ParseError', '}', 'try { auto c = load("app.toml"); }', 'catch (const std::exception& e) { log(e.what()); }'],
      nodes: [N('main', 40, 360, 440, 100, 'main', 'try / catch'), N('l', 40, 480, 440, 100, 'load', 'throws'), N('p', 40, 600, 440, 100, 'parse'), N('un', 520, 420, 440, 160, 'unwinding', '~ifstream closes f'), N('cost', 40, 780, 920, 140, 'cost', '0 when not thrown, µs when thrown')],
      edges: ['main>l', 'l>p'],
      beats: [
        { note: 'An exception jumps from throw to the nearest matching catch, skipping every frame between.', hl: [2], hot: { l: 'fail', main: 'current' }, hide: ['un', 'cost'], rows: [['frames skipped', 1]] },
        { note: 'On the way, destructors run, so RAII objects like the ifstream still close.', hot: { un: 'current', l: 'fail' }, hide: ['cost'], rows: [['leaks', 0, 'ok']] },
        { note: 'Callers can’t silently ignore an exception, and constructors can use one to report failure.', hl: [5, 6], hot: { main: 'ok' }, hide: ['cost'], rows: [['ignorable', 'no', 'ok']] },
        { note: 'Throwing is slow and invisible in signatures, so reserve it for rare failures, not control flow.', hot: { cost: 'warn' }, rows: [['throw cost', '~1-10 µs', 'warn']] },
      ],
    },
  ],
  codes: [
    'Error codes',
    {
      panel: 'Errors',
      code: ['std::error_code ec;', 'auto size = std::filesystem::file_size(path, ec);', 'if (ec) {', '  log("stat failed: {}", ec.message());', '  return fallback;', '}'],
      nodes: [N('call', 40, 300, 440, 110, 'file_size', 'sets ec'), N('check', 520, 300, 440, 110, 'if (ec)', 'caller decides'), N('ign', 40, 480, 920, 110, 'forgot the check', 'size is garbage'), N('nod', 40, 660, 920, 110, '[[nodiscard]]', 'warn if ignored'), N('where', 40, 840, 920, 110, 'fits', 'hot paths, no-exceptions, C APIs')],
      edges: ['call>check'],
      beats: [
        { note: 'Error codes return failure as a value, and the caller must check it.', hl: [0, 1, 2, 3, 4, 5], hot: { call: 'current', check: 'ok', 'call>check': 'accent' }, hide: ['ign', 'nod', 'where'], rows: [['cost', 'a branch', 'ok']] },
        { note: 'Nothing forces the check, so a forgotten if (ec) silently carries on with garbage.', hot: { ign: 'fail' }, hide: ['nod', 'where'], rows: [['ignorable', 'yes', 'fail']] },
        { note: '[[nodiscard]] turns an ignored result into a compiler warning.', hot: { nod: 'ok' }, hide: ['where'], rows: [['ignorable', 'warning', 'ok']] },
        { note: 'Codes suit hot paths, code built without exceptions, and C interfaces.', hot: { where: 'current' }, rows: [['used by', 'filesystem, asio']] },
      ],
    },
  ],
  expected: [
    'std::expected',
    {
      panel: 'Errors',
      code: ['std::expected<Config, Error> load(std::string_view p);', '', 'auto cfg = load("app.toml")', '  .and_then(validate)', '  .transform(apply_defaults);', 'if (!cfg) return std::unexpected(cfg.error());'],
      nodes: [N('ok', 40, 320, 440, 110, 'value', 'Config'), N('err', 520, 320, 440, 110, 'error', 'Error{code, msg}'), N('chain', 40, 500, 920, 110, 'and_then / transform', 'skipped after an error'), N('sig', 40, 680, 920, 110, 'in the signature', 'callers see it can fail'), N('ver', 40, 850, 920, 110, 'C++23', 'tl::expected before that')],
      edges: [],
      beats: [
        { note: 'std::expected holds either a value or an error, and its type says both are possible.', hl: [0], hot: { ok: 'ok', err: 'fail' }, hide: ['chain', 'sig', 'ver'], rows: [['states', 2]] },
        { note: 'and_then and transform chain steps and skip the rest once one fails.', hl: [2, 3, 4, 5], hot: { chain: 'current' }, hide: ['sig', 'ver'], rows: [['steps', 3]] },
        { note: 'Failure is explicit in the signature yet cheap, with no unwinding.', hot: { sig: 'ok' }, hide: ['ver'], rows: [['visible', 'yes', 'ok'], ['cost', 'a branch', 'ok']] },
        { note: 'It is C++23; tl::expected or absl::StatusOr fill the gap on older compilers.', hot: { ver: 'current' }, rows: [['since', 'C++23']] },
      ],
    },
  ],
  policy: [
    'One policy per layer',
    {
      panel: 'Policy',
      nodes: [N('app', 40, 80, 920, 120, 'app boundary', 'catch all, log, exit code'), N('svc', 40, 260, 920, 120, 'services', 'recoverable: expected<T, Error>'), N('core', 40, 440, 920, 120, 'core', 'bugs: assert, fail fast'), N('io', 40, 620, 920, 120, 'I/O + third party', 'translate their errors'), N('rule', 40, 820, 920, 120, 'one written policy', 'enforced in review')],
      edges: ['io>svc', 'svc>app'],
      beats: [
        { note: 'A big codebase needs one error strategy per layer, written down.', hot: { rule: 'current' }, rows: [['layers', 4]] },
        { note: 'Wrap third-party errors at the edge into your own Error type, so they don’t leak upward.', hot: { io: 'current', 'io>svc': 'accent' }, rows: [['foreign error types above I/O', 0, 'ok']] },
        { note: 'Recoverable failures travel as values or exceptions, one choice for the whole codebase.', hot: { svc: 'current' }, rows: [['mixed styles', 'no', 'ok']] },
        { note: 'Bugs like a broken invariant aren’t errors to handle: assert and fail fast.', hot: { core: 'warn' }, rows: [['invariants', 'asserted']] },
        { note: 'At the top, catch everything, log it with context and exit with a clear status.', hot: { app: 'ok', 'svc>app': 'accent' }, rows: [['unhandled', 'logged', 'ok']] },
      ],
    },
  ],
});

// ---------------- logging & observability ----------------
Object.assign(DETAILS, {
  'cpp-observability': {
    levels: { title: 'Log levels', text: 'Pick the level by audience: error for on-call, info for operators, debug for developers.', code: 'spdlog::set_level(spdlog::level::info);\nSPDLOG_DEBUG("cart={}", cart);  // compiled out if\n// SPDLOG_ACTIVE_LEVEL > DEBUG' },
    structured: { title: 'Structured logs', text: 'Key-value or JSON lines that log search tools can filter.', code: '{"ts":"2026-09-28T10:01:02Z","lvl":"info",\n "msg":"order placed","order":8812,"user":41,\n "req":"7f3a"}' },
    '/metrics': { title: 'Prometheus exposition', text: 'Plain text served over HTTP.', code: '# TYPE http_requests_total counter\nhttp_requests_total{code="200"} 18231\n# TYPE latency_seconds histogram\nlatency_seconds_bucket{le="0.05"} 17002\nlatency_seconds_bucket{le="0.1"} 18110' },
    histogram: { title: 'Histogram', text: 'Counts per latency bucket, so p99 can be computed later without storing every value.', code: 'latency.observe(elapsed_seconds);' },
    minidump: { title: 'Minidump', text: 'A small file with thread stacks and registers, a few hundred KB instead of a full core.', code: 'crashpad::CrashpadClient client;\nclient.StartHandler(handler, db, metrics,\n  "https://crash.example.com/submit", annotations, {}, true, true);' },
  },
});

boardDemo('cpp-observability', 'Logging & observability', 'Log levels, structured and async logging, metrics endpoints, and crash reporting with minidumps.', {
  logging: [
    'Logging',
    {
      panel: 'Logs',
      code: ['spdlog::info("order {} placed by user {}", id, uid);', 'spdlog::debug("cart={}", cart);   // compiled out', 'auto log = spdlog::rotating_logger_mt("app", "app.log",', '                                       10 << 20, 5);'],
      nodes: [N('lv', 40, 240, 440, 110, 'levels', 'trace … error'), N('st', 520, 240, 440, 110, 'structured', 'key=value / JSON'), N('as', 40, 420, 440, 110, 'async sink', 'no I/O on hot path'), N('rot', 520, 420, 440, 110, 'rotation', '10 MB × 5 files'), N('ctx', 40, 600, 920, 110, 'context', 'request id on every line'), N('bad', 40, 780, 920, 110, 'anti-pattern', 'logging in a tight loop')],
      edges: [],
      beats: [
        { note: 'Logs are read by people after the fact, so each line needs a level, a time and context.', hl: [0], hot: { lv: 'current' }, hide: ['as', 'rot', 'ctx', 'bad'], rows: [['level', 'info']] },
        { note: 'Structured fields make logs searchable by machines, not only by grep.', hot: { st: 'current' }, hide: ['as', 'rot', 'ctx', 'bad'], rows: [['format', 'JSON']] },
        { note: 'Format and write on a background thread, and rotate files so disks never fill.', hl: [2, 3], hot: { as: 'current', rot: 'current' }, hide: ['ctx', 'bad'], rows: [['disk use', '≤ 60 MB', 'ok']] },
        { note: 'Tag every line with a request id, so one request can be followed across threads.', hot: { ctx: 'ok' }, hide: ['bad'], rows: [['trace', 'by request id']] },
        { note: 'Logging costs time, so keep debug logs compiled out of hot paths.', hl: [1], hot: { bad: 'warn' }, rows: [['hot path logs', 0, 'ok']] },
      ],
    },
  ],
  metrics: [
    'Metrics',
    {
      panel: 'Metrics',
      nodes: [N('c', 40, 100, 290, 120, 'counter', 'requests_total'), N('g', 355, 100, 290, 120, 'gauge', 'open_connections'), N('h', 670, 100, 290, 120, 'histogram', 'latency buckets'), N('exp', 355, 320, 290, 110, '/metrics', 'Prometheus text'), N('scr', 355, 500, 290, 110, 'Prometheus', 'scrapes every 15 s'), N('dash', 355, 680, 290, 110, 'dashboard', 'p50 / p99, alerts'), N('cost', 40, 860, 920, 110, 'hot path', 'atomic add, no lock')],
      edges: ['c>exp', 'g>exp', 'h>exp', 'exp>scr', 'scr>dash'],
      beats: [
        { note: 'Metrics are numbers over time: counters only grow, gauges go up and down, histograms bucket latencies.', hot: { c: 'current', g: 'current', h: 'current' }, hide: ['exp', 'scr', 'dash', 'cost'], rows: [['kinds', 3]] },
        { note: 'The process exposes them on an HTTP endpoint in a simple text format.', hot: { exp: 'current', 'c>exp': 'accent', 'g>exp': 'accent', 'h>exp': 'accent' }, hide: ['scr', 'dash', 'cost'], rows: [['endpoint', '/metrics']] },
        { note: 'A collector scrapes them, and dashboards and alerts watch p99 latency, not averages.', hot: { scr: 'current', dash: 'ok', 'exp>scr': 'accent', 'scr>dash': 'accent' }, hide: ['cost'], rows: [['p99', '84 ms']] },
        { note: 'Updating a metric must be an atomic add, never a lock on the hot path.', hot: { cost: 'warn' }, rows: [['update', '~5 ns', 'ok']] },
      ],
    },
  ],
  crash: [
    'Crash reporting',
    {
      panel: 'Crashes',
      nodes: [N('sig', 40, 100, 440, 110, 'SIGSEGV', 'on a user machine'), N('hd', 520, 100, 440, 110, 'crash handler', 'Crashpad'), N('mini', 280, 290, 440, 110, 'minidump', 'stacks + registers'), N('up', 280, 470, 440, 110, 'upload', 'on next start'), N('srv', 280, 650, 440, 110, 'symbol server', 'symbolize'), N('grp', 40, 840, 920, 120, 'grouped reports', 'top crash: 312 users')],
      edges: ['sig>hd', 'hd>mini', 'mini>up', 'up>srv', 'srv>grp'],
      beats: [
        { note: 'Desktop and mobile apps can’t collect core dumps from users’ machines.', hot: { sig: 'fail' }, hide: ['hd', 'mini', 'up', 'srv', 'grp'], rows: [['cores', 'unavailable', 'warn']] },
        { note: 'A crash handler like Crashpad writes a small minidump from outside the dying process.', hot: { hd: 'current', mini: 'write', 'sig>hd': 'accent', 'hd>mini': 'accent' }, hide: ['up', 'srv', 'grp'], rows: [['dump size', '~300 KB']] },
        { note: 'It uploads later, and a server symbolizes it with the archived debug symbols.', hot: { up: 'current', srv: 'current', 'mini>up': 'accent', 'up>srv': 'accent' }, hide: ['grp'], rows: [['symbolized', 'yes', 'ok']] },
        { note: 'Reports group by stack, so you fix the crash hitting the most users first.', hot: { grp: 'ok', 'srv>grp': 'accent' }, rows: [['top crash', '312 users']] },
      ],
    },
  ],
});

// ---------------- versioning & cross-platform ----------------
Object.assign(DETAILS, {
  'cpp-versioning': {
    'calcConfigVersion.cmake': { title: 'Version file', text: 'Generated next to the package config; find_package asks it whether a version is acceptable.', code: 'include(CMakePackageConfigHelpers)\nwrite_basic_package_version_file(\n  calcConfigVersion.cmake\n  COMPATIBILITY SameMajorVersion)' },
    'libcore.so.2.4.1': { title: 'The real file', text: 'Named with the full release version.', code: '$ ls -l /usr/lib/libcore*\nlibcore.so -> libcore.so.2\nlibcore.so.2 -> libcore.so.2.4.1\nlibcore.so.2.4.1' },
    'libcore.so.2': { title: 'SONAME', text: 'Recorded inside the library and copied into apps as NEEDED.', code: '$ readelf -d libcore.so.2.4.1 | grep SONAME\n SONAME [libcore.so.2]\n$ readelf -d app | grep NEEDED\n NEEDED [libcore.so.2]' },
    CORE_EXPORT: { title: 'Export macro', text: 'Generated by GenerateExportHeader.', code: '#ifdef core_EXPORTS\n#  define CORE_EXPORT __declspec(dllexport)\n#else\n#  define CORE_EXPORT __declspec(dllimport)\n#endif' },
    'core.lib': { title: 'Import library', text: 'Tiny stubs the linker uses; calls jump into core.dll at run time.', code: '$ dumpbin /exports core.dll\n  1  0 00012A40 ?run@Engine@@QEAAXXZ' },
    'libcore.dylib': { title: 'Install name', text: 'The path baked into clients when they link. Inspect and fix with otool and install_name_tool.', code: '$ otool -D libcore.dylib\n@rpath/libcore.dylib\n$ otool -l app | grep -A2 LC_RPATH\n  path @executable_path/../Frameworks' },
  },
});

boardDemo('cpp-versioning', 'Versioning & cross-platform libraries', 'SemVer and package version files, SONAME and symlinks, Windows DLL export and import libraries, macOS install names and @rpath.', {
  semver: [
    'Semantic versioning',
    {
      panel: 'Versions',
      nodes: [N('v', 355, 60, 290, 120, '2.4.1'), N('maj', 40, 260, 290, 120, 'MAJOR', 'breaks API or ABI'), N('min', 355, 260, 290, 120, 'MINOR', 'adds, compatible'), N('pat', 670, 260, 290, 120, 'PATCH', 'fixes only'), N('cm', 40, 460, 920, 110, 'project(calc VERSION 2.4.1)'), N('cfgv', 40, 640, 920, 110, 'calcConfigVersion.cmake', 'SameMajorVersion'), N('user', 40, 820, 920, 110, 'find_package(calc 2.3)', '2.4.1 accepted, 3.0 rejected')],
      edges: ['v>maj', 'v>min', 'v>pat'],
      beats: [
        { note: 'A version number is a promise about compatibility, not a counter.', hot: { v: 'current' }, hide: ['maj', 'min', 'pat', 'cm', 'cfgv', 'user'], rows: [['version', '2.4.1']] },
        { note: 'Bump MAJOR for breaking changes, MINOR for additions and PATCH for fixes.', hot: { maj: 'warn', min: 'ok', pat: 'ok' }, hide: ['cm', 'cfgv', 'user'], rows: [['breaking', 'MAJOR only']] },
        { note: 'project() records the version, and the version file tells find_package what is compatible.', hot: { cm: 'current', cfgv: 'write' }, hide: ['user'], rows: [['policy', 'SameMajorVersion']] },
        { note: 'A consumer asking for 2.3 gets any 2.x from 2.3 up, never 3.0.', hot: { user: 'ok' }, rows: [['2.4.1', 'ok', 'ok'], ['3.0.0', 'rejected', 'fail']] },
      ],
    },
  ],
  soname: [
    'SONAME',
    {
      panel: 'SONAME',
      code: ['set_target_properties(core PROPERTIES', '  VERSION 2.4.1 SOVERSION 2)', '# libcore.so.2.4.1   real file', '# libcore.so.2 ->    SONAME, used at run time', '# libcore.so ->      used at link time'],
      nodes: [N('real', 40, 290, 440, 110, 'libcore.so.2.4.1', 'the file'), N('son', 520, 290, 440, 110, 'libcore.so.2', 'SONAME link'), N('app', 40, 470, 440, 110, 'app', 'NEEDED libcore.so.2'), N('dev', 520, 470, 440, 110, 'libcore.so', 'link-time link'), N('v3', 40, 660, 920, 110, 'libcore.so.3', 'new SONAME'), N('both', 40, 840, 920, 110, 'side by side', 'old apps keep .so.2')],
      edges: ['son>real', 'dev>son', 'app>son'],
      beats: [
        { note: 'SOVERSION is the ABI version, separate from the release version.', hl: [0, 1], hot: { real: 'current' }, hide: ['son', 'app', 'dev', 'v3', 'both'], rows: [['VERSION', '2.4.1'], ['SOVERSION', 2]] },
        { note: 'CMake builds the real file plus two symlinks.', hl: [2, 3, 4], hot: { son: 'write', dev: 'write', 'son>real': 'accent', 'dev>son': 'accent' }, hide: ['app', 'v3', 'both'], rows: [['files', 3]] },
        { note: 'The linker copies the SONAME into app, so at run time app asks for libcore.so.2.', hot: { app: 'current', 'app>son': 'accent' }, hide: ['v3', 'both'], rows: [['NEEDED', 'libcore.so.2']] },
        { note: 'A compatible fix replaces the real file behind the same SONAME, with no relinking.', hot: { real: 'ok', app: 'ok' }, label: { real: 'libcore.so.2.4.2' }, hide: ['v3', 'both'], rows: [['relinked', 'no', 'ok']] },
        { note: 'A breaking change bumps SOVERSION to 3, and both versions can be installed side by side.', hot: { v3: 'current', both: 'ok' }, label: { real: 'libcore.so.2.4.2' }, rows: [['installed', '.so.2 + .so.3', 'ok']] },
      ],
    },
  ],
  windows: [
    'Windows DLLs',
    {
      panel: 'Windows',
      code: ['include(GenerateExportHeader)', 'generate_export_header(core)   # core_export.h', '// core.h', '#include "core_export.h"', 'class CORE_EXPORT Engine { public: void run(); };'],
      nodes: [N('dll', 40, 290, 440, 110, 'core.dll', 'code'), N('lib', 520, 290, 440, 110, 'core.lib', 'import library'), N('exp', 40, 470, 920, 110, 'CORE_EXPORT', 'dllexport / dllimport'), N('app', 280, 650, 440, 110, 'app.exe', 'links core.lib'), N('load', 40, 840, 920, 110, 'at run time', 'core.dll next to app.exe or on PATH')],
      edges: ['lib>app', 'dll>app'],
      beats: [
        { note: 'On Windows, nothing is exported from a DLL unless it is marked.', hot: { dll: 'current' }, hide: ['lib', 'exp', 'app', 'load'], rows: [['exported', 0, 'warn']] },
        { note: 'generate_export_header writes a macro that exports while building core and imports when using it.', hl: [0, 1, 2, 3, 4], hot: { exp: 'write' }, hide: ['lib', 'app', 'load'], rows: [['exported', 'Engine']] },
        { note: 'Linking uses a small import library, core.lib, while the code stays in core.dll.', hot: { lib: 'current', app: 'ok', 'lib>app': 'accent' }, hide: ['load'], rows: [['link against', 'core.lib']] },
        { note: 'There is no RPATH, so DLLs are found next to the exe or on PATH.', hot: { load: 'warn', 'dll>app': 'accent' }, rows: [['search', 'exe dir, PATH', 'warn']] },
      ],
    },
  ],
  macos: [
    'macOS dylibs',
    {
      panel: 'macOS',
      code: ['set_target_properties(core PROPERTIES', '  INSTALL_NAME_DIR "@rpath")', 'set_target_properties(app PROPERTIES', '  INSTALL_RPATH "@executable_path/../Frameworks")', '# otool -L app → @rpath/libcore.dylib'],
      nodes: [N('dy', 40, 290, 440, 110, 'libcore.dylib', 'install name'), N('app', 520, 290, 440, 110, 'app', 'LC_RPATH'), N('bundle', 40, 480, 920, 110, 'MyApp.app/Contents', 'MacOS/app · Frameworks/libcore.dylib'), N('sign', 40, 660, 920, 110, 'codesign', 'every dylib signed'), N('uni', 40, 840, 920, 110, 'universal', 'arm64 + x86_64')],
      edges: ['app>dy'],
      beats: [
        { note: 'A dylib carries an install name, the path its clients will load it from.', hl: [0, 1], hot: { dy: 'current' }, hide: ['bundle', 'sign', 'uni'], rows: [['install name', '@rpath/libcore.dylib']] },
        { note: '@rpath in that name defers to the app’s own LC_RPATH list.', hl: [2, 3, 4], hot: { app: 'current', 'app>dy': 'accent' }, hide: ['bundle', 'sign', 'uni'], rows: [['LC_RPATH', '@executable_path/../Frameworks']] },
        { note: 'App bundles ship dylibs in Frameworks/, found relative to the executable.', hot: { bundle: 'ok' }, hide: ['sign', 'uni'], rows: [['relocatable', 'yes', 'ok']] },
        { note: 'Every shipped dylib must be code-signed, and universal builds need both architectures.', hot: { sign: 'warn', uni: 'current' }, sub: { uni: 'CMAKE_OSX_ARCHITECTURES' }, rows: [['archs', 'arm64;x86_64']] },
      ],
    },
  ],
});

// ---------------- codebase hygiene: layout, review gates, legacy ----------------
Object.assign(DETAILS, {
  'cpp-codebase': {
    'calc::detail': { title: 'detail namespace', text: 'A convention: visible because templates need it, but not part of the API.', code: 'namespace calc::detail {\ntemplate <class T> T clamp_add(T a, T b);\n}\n// users: never touch detail::' },
    'anonymous namespace': { title: 'Internal linkage', text: 'Names only this .cpp can see; two files can both have a helper() without clashing.', code: '// parse.cpp\nnamespace {\nint helper(int x) { return x * 2; }\n}' },
    'include order': { title: 'Own header first', text: 'If core.h forgot an include it needs, core.cpp fails to compile right away.', code: '// core.cpp\n#include "calc/core.h"   // first\n\n#include <string>\n#include <vector>\n\n#include "detail/parse.h"' },
    'clang-format': { title: '.clang-format', text: 'Checked in, run by editors and CI.', code: 'BasedOnStyle: Google\nColumnLimit: 100\nIncludeBlocks: Regroup\n\n$ clang-format --dry-run -Werror src/*.cpp' },
    'clang-tidy': { title: '.clang-tidy', text: 'Bug-prone patterns, modernization, performance.', code: 'Checks: >\n  bugprone-*, performance-*,\n  modernize-use-override,\n  -modernize-use-trailing-return-type\nWarningsAsErrors: bugprone-*' },
    CODEOWNERS: { title: 'CODEOWNERS', text: 'Maps paths to reviewers who must approve.', code: '/src/net/      @team-net\n/src/storage/  @team-data\n/cmake/        @build-owners' },
    'characterization tests': { title: 'Characterization tests', text: 'Record current outputs for many inputs, then refactor while they stay green.', code: 'TEST(LegacyPricing, Snapshot) {\n  for (auto& c : load_cases("pricing_cases.json"))\n    EXPECT_EQ(legacy_price(c.in), c.out) << c.name;\n}' },
    'clang-tidy modernize-*': { title: 'Automated modernization', text: 'Mechanical rewrites applied with -fix, reviewed like any change.', code: '$ run-clang-tidy -checks=modernize-use-nullptr,\\\n    modernize-use-override -fix src/legacy/' },
  },
});

boardDemo('cpp-codebase', 'Codebase layout, review gates & legacy code', 'Headers vs sources and namespaces, automated gates before review, and modernizing a legacy module safely.', {
  layout: [
    'Headers & namespaces',
    {
      panel: 'Layout',
      codeTitle: 'include/calc/core.h + src/core.cpp',
      code: ['// include/calc/core.h', 'namespace calc {', 'class Engine { public: int run(); };', 'namespace detail { int step(int); }  // not API', '}', '// src/core.cpp', 'namespace { int helper(int x) { return x * 2; } }'],
      nodes: [N('pub', 40, 320, 440, 110, 'include/calc/', 'public, installed'), N('src', 520, 320, 440, 110, 'src/', 'private'), N('ns', 40, 500, 440, 110, 'namespace calc', 'no collisions'), N('det', 520, 500, 440, 110, 'calc::detail', 'visible, not API'), N('anon', 40, 680, 920, 110, 'anonymous namespace', 'one .cpp only'), N('inc', 40, 850, 920, 110, 'include order', 'own header first')],
      edges: [],
      beats: [
        { note: 'Public headers live under include/<project>/, sources and private headers under src/.', hl: [0, 5], hot: { pub: 'current', src: 'current' }, hide: ['ns', 'det', 'anon', 'inc'], rows: [['public headers', 'include/calc/']] },
        { note: 'Everything goes in the project namespace, so Engine never collides with anyone else’s.', hl: [1, 2, 4], hot: { ns: 'current' }, hide: ['det', 'anon', 'inc'], rows: [['namespace', 'calc']] },
        { note: 'Templates force some internals into headers, and a detail namespace marks them off-limits.', hl: [3], hot: { det: 'warn' }, hide: ['anon', 'inc'], rows: [['internal in headers', 'calc::detail']] },
        { note: 'Helpers used by one .cpp go in an anonymous namespace: internal linkage, no clashes.', hl: [6], hot: { anon: 'ok' }, hide: ['inc'], rows: [['linkage', 'internal', 'ok']] },
        { note: 'Each .cpp includes its own header first, which proves the header is self-contained.', hot: { inc: 'current' }, rows: [['self-contained', 'checked', 'ok']] },
      ],
    },
  ],
  gates: [
    'Review gates',
    {
      panel: 'Gates',
      nodes: [N('pr', 40, 60, 920, 110, 'pull request'), N('fmt', 40, 240, 290, 110, 'clang-format', 'style, auto-fixed'), N('tidy', 355, 240, 290, 110, 'clang-tidy', 'bug patterns'), N('build', 670, 240, 290, 110, 'build matrix', 'gcc · clang · msvc'), N('test', 40, 420, 440, 110, 'tests + sanitizers'), N('rev', 520, 420, 440, 110, 'human review', 'design, naming, API'), N('own', 40, 600, 920, 110, 'CODEOWNERS', 'module owners approve'), N('merge', 355, 800, 290, 110, 'merge')],
      edges: ['pr>fmt', 'pr>tidy', 'pr>build', 'own>merge'],
      beats: [
        { note: 'Every change passes the same automatic gates before a person looks at it.', hot: { pr: 'current' }, rows: [['gates', 5]] },
        { note: 'clang-format settles style mechanically, so review never argues about spaces.', hot: { fmt: 'ok', 'pr>fmt': 'accent' }, rows: [['style comments', 0, 'ok']] },
        { note: 'clang-tidy and the build matrix catch bug patterns and portability problems.', hot: { tidy: 'ok', build: 'ok', 'pr>tidy': 'accent', 'pr>build': 'accent' }, rows: [['compilers', 3]] },
        { note: 'Tests run under sanitizers, and owners of each module must approve changes to it.', hot: { test: 'ok', own: 'current' }, rows: [['approvals', 'owner required']] },
        { note: 'People then review what tools can’t: design, API shape and naming.', hot: { rev: 'ok', merge: 'ok', 'own>merge': 'accent' }, rows: [['merged', 'yes', 'ok']] },
      ],
    },
  ],
  legacy: [
    'Legacy code',
    {
      panel: 'Modernize',
      nodes: [N('old', 40, 60, 920, 130, 'legacy module', 'raw new/delete, globals, no tests'), N('t', 40, 260, 440, 120, 'characterization tests', 'pin current behaviour'), N('seam', 520, 260, 440, 120, 'seams', 'interfaces around globals'), N('mod', 40, 460, 440, 120, 'modernize', 'unique_ptr, span, RAII'), N('tidy', 520, 460, 440, 120, 'clang-tidy modernize-*', 'mechanical, reviewed'), N('strang', 40, 660, 920, 120, 'strangler', 'new code behind the same API'), N('done', 40, 860, 920, 110, 'one module at a time')],
      edges: [],
      beats: [
        { note: 'Code without tests can’t be refactored safely, so don’t start with a rewrite.', hot: { old: 'warn' }, hide: ['t', 'seam', 'mod', 'tidy', 'strang', 'done'], rows: [['tests', 0, 'warn']] },
        { note: 'First write characterization tests that pin what it does today, bugs included.', hot: { t: 'current' }, hide: ['seam', 'mod', 'tidy', 'strang', 'done'], rows: [['snapshot cases', 400]] },
        { note: 'Cut seams, interfaces around globals and I/O, so pieces can be tested alone.', hot: { seam: 'current' }, hide: ['mod', 'tidy', 'strang', 'done'], rows: [['seams', 3]] },
        { note: 'Modernize in small mechanical steps, many of them done by clang-tidy’s modernize checks.', hot: { mod: 'write', tidy: 'current' }, hide: ['strang', 'done'], rows: [['raw new/delete', '212 → 0', 'ok']] },
        { note: 'Replace larger parts behind the existing API, module by module, never in one big rewrite.', hot: { strang: 'current', done: 'ok' }, rows: [['big-bang rewrites', 0, 'ok']] },
      ],
    },
  ],
});
