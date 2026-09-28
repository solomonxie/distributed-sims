// C++ at project scale (group 'machine-cpp'): CMake, dependencies, configs & CI, architecture, build times, libraries, ABI.
import type { Tone } from '../algo/frames';
import { machineDemo } from './lib/draw';
import { boardFrames } from './lib/board';
import type { Board, BoardNode } from './lib/board';

const G = 'machine-cpp';
const N = (id: string, x: number, y: number, w: number, h: number, label: string, sub?: string, dashed?: boolean): BoardNode => ({ id, x, y, w, h, label, sub, dashed });
const all = (ids: string[], tone: Tone) => Object.fromEntries(ids.map((id) => [id, tone]));

function boardDemo(slug: string, title: string, summary: string, boards: Record<string, [label: string, board: Board]>) {
  machineDemo({
    slug,
    title,
    group: G,
    summary,
    linkedFrom: ['C++'],
    inputs: Object.entries(boards).map(([id, [label]]) => ({ id, label, data: { k: id } })),
    build: ({ k }: { k: string }) => boardFrames(boards[k][1]),
  });
}

// ---------------- CMake: configure, generate, build ----------------
const PIPE_NODES = [
  N('src', 40, 200, 280, 110, 'source tree', 'CMakeLists.txt, *.cpp'),
  N('cfg', 360, 200, 280, 110, 'configure', 'cmake -S . -B build'),
  N('cache', 680, 200, 280, 110, 'CMakeCache.txt', 'compiler, options'),
  N('gen', 360, 380, 280, 110, 'generate', 'build/build.ninja'),
  N('bld', 360, 560, 280, 110, 'build', 'cmake --build build'),
  N('o1', 40, 760, 260, 110, 'main.o'),
  N('o2', 370, 760, 260, 110, 'math.o'),
  N('exe', 700, 760, 260, 110, 'calc', 'executable'),
];
const PIPE: Omit<Board, 'beats'> = {
  panel: 'CMake',
  code: ['cmake_minimum_required(VERSION 3.25)', 'project(calc LANGUAGES CXX)', 'add_executable(calc main.cpp math.cpp)'],
  nodes: PIPE_NODES,
  edges: ['src>cfg', 'cfg>cache', 'cfg>gen', 'gen>bld', 'bld>o1', 'bld>o2', 'bld>exe'],
};
const stale = { o1: 'visited', o2: 'visited', exe: 'visited' } as const;

boardDemo('cmake-pipeline', 'CMake: configure, generate, build', 'CMakeLists.txt → configure (cache) → generate build.ninja → Ninja compiles and links; incremental rebuilds; cache pitfalls.', {
  basic: [
    'First build',
    {
      ...PIPE,
      beats: [
        { note: 'A CMakeLists.txt describes targets, not commands. CMake turns it into a real build system.', hide: ['cfg', 'cache', 'gen', 'bld', 'o1', 'o2', 'exe'], rows: [['step', 'source'], ['build dir', 'none']] },
        { note: 'Configure finds the compiler, probes its features and stores the answers in CMakeCache.txt.', hl: [0, 1], hot: { cfg: 'current', cache: 'write', 'cfg>cache': 'accent' }, hide: ['gen', 'bld', 'o1', 'o2', 'exe'], rows: [['step', 'configure'], ['build dir', 'build/']] },
        { note: 'Generate writes build.ninja, with every compile and link command spelled out.', hl: [2], hot: { gen: 'current', 'cfg>gen': 'accent' }, hide: ['bld', 'o1', 'o2', 'exe'], rows: [['step', 'generate'], ['targets', 1]] },
        { note: 'cmake --build runs Ninja, which compiles each .cpp into an object file in parallel.', hot: { bld: 'current', o1: 'write', o2: 'write', 'bld>o1': 'accent', 'bld>o2': 'accent' }, hide: ['exe'], rows: [['step', 'compile'], ['compiled', 2]] },
        { note: 'Then it links the objects into calc. Everything lives in build/, so the source tree stays clean.', hot: { exe: 'ok', 'bld>exe': 'ok' }, rows: [['step', 'link'], ['compiled', 2], ['linked', 'calc', 'ok']] },
      ],
    },
  ],
  incremental: [
    'Incremental rebuild',
    {
      ...PIPE,
      beats: [
        { note: 'Second build with nothing changed. Ninja compares timestamps and has nothing to do.', hot: { bld: 'current', ...stale }, sub: { o1: 'up to date', o2: 'up to date' }, rows: [['edited', '—'], ['compiled', 0], ['relinked', 'no']] },
        { note: 'Edit math.cpp: only math.o is stale, so one compile and a relink.', hot: { src: 'warn', bld: 'current', o1: 'visited', o2: 'write', exe: 'ok' }, sub: { src: 'math.cpp edited', o1: 'up to date', o2: 'recompiled' }, rows: [['edited', 'math.cpp'], ['compiled', 1], ['relinked', 'yes']] },
        { note: 'Edit math.h: the depfiles the compiler wrote show both .cpp files include it, so both recompile.', hot: { src: 'warn', bld: 'current', o1: 'write', o2: 'write', exe: 'ok' }, sub: { src: 'math.h edited', o1: 'recompiled', o2: 'recompiled' }, rows: [['edited', 'math.h'], ['compiled', 2, 'warn'], ['relinked', 'yes']] },
        { note: 'Edit CMakeLists.txt: the build notices and reruns configure and generate first.', hl: [2], hot: { src: 'warn', cfg: 'current', gen: 'current', bld: 'current' }, sub: { src: 'CMakeLists.txt edited' }, rows: [['edited', 'CMakeLists.txt'], ['reconfigured', 'yes']] },
        { note: 'Header edits are what make big builds slow. See Build times at scale.', hot: { o1: 'write', o2: 'write' }, rows: [['cost driver', 'header fan-out', 'warn']] },
      ],
    },
  ],
  cache: [
    'Cache pitfalls',
    {
      ...PIPE,
      beats: [
        { note: 'cmake -B build -DCMAKE_BUILD_TYPE=Release stores the value in CMakeCache.txt.', hot: { cfg: 'current', cache: 'write' }, sub: { cache: 'BUILD_TYPE=Release' }, rows: [['BUILD_TYPE', 'Release']] },
        { note: 'Later runs reuse cached values even when you drop the flag. The cache beats defaults in CMakeLists.txt.', hot: { cache: 'warn' }, sub: { cache: 'BUILD_TYPE=Release', cfg: 'cmake -B build' }, rows: [['BUILD_TYPE', 'Release (cached)', 'warn']] },
        { note: 'Switching compiler in the same build dir fails: the compiler is fixed at the first configure.', hot: { cache: 'fail', cfg: 'fail' }, sub: { cache: 'CXX=/usr/bin/g++', cfg: 'CXX=clang++' }, rows: [['compiler', 'stale', 'fail']] },
        { note: 'Use cmake --fresh, or one build dir per setup: build-debug, build-release, build-asan.', hot: { cfg: 'ok', cache: 'ok' }, sub: { cfg: 'cmake --fresh', cache: 'rebuilt' }, rows: [['build dirs', 'one per setup', 'ok']] },
      ],
    },
  ],
});

// ---------------- targets & usage requirements ----------------
const TGT_NODES = [
  N('app', 360, 340, 280, 110, 'app', 'main.cpp'),
  N('net', 360, 520, 280, 110, 'net', 'net.h includes core.h'),
  N('core', 360, 700, 280, 110, 'core', 'include/core.h'),
  N('fmt', 700, 700, 260, 110, 'fmt::fmt', 'third party'),
  N('fa', 40, 340, 280, 110, 'app compiles with', '—'),
  N('fn', 40, 520, 280, 110, 'net compiles with', '—'),
  N('fc', 40, 700, 280, 110, 'core compiles with', '—'),
];
const tgtCode = (netDep: string) => [
  'add_library(core src/core.cpp)',
  'target_include_directories(core PUBLIC include)',
  'target_link_libraries(core PRIVATE fmt::fmt)',
  'add_library(net src/net.cpp)',
  `target_link_libraries(net ${netDep} core)`,
  'add_executable(app main.cpp)',
  'target_link_libraries(app PRIVATE net)',
];
const TGT_EDGES = ['app>net', 'net>core', 'core>fmt'];

boardDemo('cmake-targets', 'Targets & usage requirements', 'PUBLIC / PRIVATE / INTERFACE: how include dirs, flags and link deps propagate through the target graph.', {
  public: [
    'PUBLIC vs PRIVATE',
    {
      panel: 'Targets',
      code: tgtCode('PUBLIC'),
      nodes: TGT_NODES,
      edges: TGT_EDGES,
      beats: [
        { note: 'A target is sources plus usage requirements: what anyone who links it also needs.', rows: [['targets', 4]] },
        { note: 'core’s include dir is PUBLIC: core compiles with it, and so does whoever links core.', hl: [0, 1], hot: { core: 'current', fc: 'write' }, sub: { fc: '-I core' }, rows: [['core', '-I core']] },
        { note: 'fmt is PRIVATE: core.cpp uses it, but fmt never leaks into core’s users.', hl: [2], hot: { fmt: 'current', 'core>fmt': 'accent', fc: 'write' }, sub: { fc: '-I core -I fmt' }, rows: [['core', '-I core -I fmt']] },
        { note: 'net links core PUBLIC because net.h includes core.h. The requirement flows on through net.', hl: [3, 4], hot: { net: 'current', 'net>core': 'accent', fn: 'write' }, sub: { fc: '-I core -I fmt', fn: '-I core' }, rows: [['net', '-I core']] },
        { note: 'app links only net, yet gets core’s headers. It never sees fmt.', hl: [5, 6], hot: { app: 'ok', 'app>net': 'accent', fa: 'write' }, sub: { fc: '-I core -I fmt', fn: '-I core', fa: '-I core' }, rows: [['app', '-I core'], ['fmt visible to app', 'no', 'ok']] },
      ],
    },
  ],
  private: [
    'Too PRIVATE',
    {
      panel: 'Targets',
      code: tgtCode('PRIVATE'),
      nodes: TGT_NODES,
      edges: TGT_EDGES,
      beats: [
        { note: 'Same graph, but net links core PRIVATE.', hl: [4], hot: { 'net>core': 'warn' }, rows: [['net → core', 'PRIVATE', 'warn']] },
        { note: 'net itself builds fine, since it has core’s include dir.', hot: { net: 'ok', fn: 'write' }, sub: { fn: '-I core' }, rows: [['net', 'builds', 'ok']] },
        { note: 'app includes net.h, which includes core.h, but app never got -I core.', hl: [6], hot: { app: 'fail', fa: 'fail' }, sub: { fn: '-I core', fa: 'core.h: not found' }, rows: [['app', 'compile error', 'fail']] },
        { note: 'Rule: used in your public headers means PUBLIC, used only in .cpp files means PRIVATE.', hl: [4], hot: { 'net>core': 'ok', app: 'ok' }, sub: { fn: '-I core', fa: '-I core' }, rows: [['fix', 'net PUBLIC core', 'ok']] },
      ],
    },
  ],
  interface: [
    'INTERFACE & static libs',
    {
      panel: 'Targets',
      code: [
        'add_library(units INTERFACE)',
        'target_include_directories(units INTERFACE include)',
        'target_compile_features(units INTERFACE cxx_std_20)',
        'add_library(core STATIC src/core.cpp)',
        'target_link_libraries(core PRIVATE units fmt::fmt)',
        'add_executable(app main.cpp)',
        'target_link_libraries(app PRIVATE core)',
      ],
      nodes: [
        N('app', 360, 340, 280, 110, 'app', 'main.cpp'),
        N('core', 360, 520, 280, 110, 'core', 'libcore.a'),
        N('units', 40, 700, 280, 110, 'units', 'header-only'),
        N('fmt', 680, 700, 280, 110, 'fmt::fmt', 'libfmt.a'),
        N('lk', 200, 860, 600, 110, 'app link line', 'main.o libcore.a'),
      ],
      edges: ['app>core', 'core>units', 'core>fmt'],
      beats: [
        { note: 'A header-only library has nothing to compile. INTERFACE gives it requirements for its users only.', hl: [0, 1, 2], hot: { units: 'current' }, hide: ['lk'], rows: [['units sources', 0]] },
        { note: 'core uses units privately: core gets -I units/include and C++20, app gets neither.', hl: [3, 4], hot: { core: 'current', 'core>units': 'accent' }, hide: ['lk'], rows: [['core', 'C++20, -I units']] },
        { note: 'But libcore.a is just an archive of core’s objects, without fmt’s code.', hot: { core: 'warn', 'core>fmt': 'warn' }, hide: ['lk'], rows: [['fmt code in libcore.a', 'no', 'warn']] },
        { note: 'So CMake still puts fmt on app’s link line. Headers stay private, link dependencies don’t.', hl: [6], hot: { lk: 'ok', 'app>core': 'accent' }, sub: { lk: 'main.o libcore.a libfmt.a' }, rows: [['app links', 'core + fmt', 'ok']] },
      ],
    },
  ],
  global: [
    'Directory-wide flags',
    {
      panel: 'Targets',
      code: [
        'include_directories(core/include net/include)',
        'add_definitions(-DNET_DEBUG)',
        'set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -Wall")',
        'add_library(core src/core.cpp)',
        'add_library(net src/net.cpp)',
        'add_executable(app main.cpp)',
        'target_link_libraries(app net core)',
      ],
      nodes: TGT_NODES,
      edges: TGT_EDGES,
      beats: [
        { note: 'Old-style CMake sets flags per directory, for every target below it.', hl: [0, 1, 2], hide: ['fmt'], rows: [['scope', 'directory', 'warn']] },
        { note: 'core now compiles with net’s headers and NET_DEBUG, which it never asked for.', hl: [3], hot: { core: 'warn', fc: 'warn' }, sub: { fc: '-I core -I net -DNET…' }, hide: ['fmt'], rows: [['core', 'sees net', 'warn']] },
        { note: 'Nothing breaks until core.cpp includes net.h by accident, and core can no longer be built alone.', hot: { core: 'fail', fc: 'fail' }, sub: { core: 'needs net.h', fc: '-I core -I net -DNET…' }, hide: ['fmt'], rows: [['hidden deps', 1, 'fail']] },
        { note: 'Use only target_* commands. The target graph then documents the real dependencies.', hot: { core: 'ok', fc: 'ok' }, sub: { fc: '-I core' }, hide: ['fmt'], rows: [['scope', 'target', 'ok']] },
      ],
    },
  ],
});

// ---------------- dependencies ----------------
boardDemo('cmake-deps', 'Dependencies & packaging', 'find_package with imported targets, FetchContent, vcpkg manifests, and installing your own library as a package.', {
  find: [
    'find_package',
    {
      panel: 'Dependencies',
      code: ['find_package(fmt 10 REQUIRED CONFIG)', 'add_executable(app main.cpp)', 'target_link_libraries(app PRIVATE fmt::fmt)'],
      nodes: [
        N('p1', 40, 200, 290, 110, '/opt/homebrew', 'fmt 9.1'),
        N('p2', 355, 200, 290, 110, '/usr/local', 'fmt 10.2'),
        N('p3', 670, 200, 290, 110, '/usr', 'no fmt'),
        N('cf', 355, 400, 290, 110, 'fmtConfig.cmake', 'fmt 10.2'),
        N('tgt', 355, 600, 290, 110, 'fmt::fmt', 'imported target'),
        N('req', 690, 600, 270, 110, 'carries', 'include, lib, defs'),
        N('app', 355, 800, 290, 110, 'app'),
      ],
      edges: ['p2>cf', 'cf>tgt', 'tgt>req', 'tgt>app'],
      beats: [
        { note: 'find_package looks for the fmtConfig.cmake file that an installed fmt ships.', hl: [0], hide: ['cf', 'tgt', 'req', 'app'], rows: [['wanted', 'fmt ≥ 10']] },
        { note: 'It walks CMAKE_PREFIX_PATH, then system prefixes. fmt 9.1 is skipped because 10 was required.', hl: [0], hot: { p1: 'fail', p2: 'ok', cf: 'current', 'p2>cf': 'accent' }, sub: { p1: 'fmt 9.1: too old' }, hide: ['tgt', 'req', 'app'], rows: [['found', '/usr/local', 'ok']] },
        { note: 'The config file defines an imported target, fmt::fmt.', hot: { cf: 'current', tgt: 'write', 'cf>tgt': 'accent' }, hide: ['req', 'app'], rows: [['targets', 'fmt::fmt']] },
        { note: 'Linking fmt::fmt brings its include dirs, library file and defines in one go.', hl: [2], hot: { tgt: 'current', req: 'write', app: 'ok', 'tgt>app': 'accent', 'tgt>req': 'accent' }, rows: [['raw paths', 0, 'ok']] },
        { note: 'Without a version, whichever fmt comes first wins. Different machines then build different code.', hot: { p1: 'warn', p2: 'warn' }, rows: [['pin', 'min version', 'warn']] },
      ],
    },
  ],
  fetch: [
    'FetchContent',
    {
      panel: 'Dependencies',
      code: [
        'include(FetchContent)',
        'FetchContent_Declare(json',
        '  GIT_REPOSITORY https://github.com/nlohmann/json',
        '  GIT_TAG v3.11.3)',
        'FetchContent_MakeAvailable(json)',
        'target_link_libraries(app PRIVATE nlohmann_json::nlohmann_json)',
      ],
      nodes: [
        N('remote', 40, 300, 290, 110, 'github', 'nlohmann/json'),
        N('deps', 355, 300, 290, 110, 'build/_deps', 'json-src'),
        N('sub', 355, 480, 290, 110, 'add_subdirectory', 'your compiler, flags'),
        N('tgt', 355, 660, 290, 110, 'nlohmann_json', 'real target'),
        N('app', 355, 840, 290, 110, 'app'),
      ],
      edges: ['remote>deps', 'deps>sub', 'sub>tgt', 'tgt>app'],
      beats: [
        { note: 'FetchContent downloads a dependency at configure time into build/_deps.', hl: [0, 1, 2, 3], hot: { remote: 'current', deps: 'write', 'remote>deps': 'accent' }, hide: ['sub', 'tgt', 'app'], rows: [['when', 'configure']] },
        { note: 'Pin a tag or commit hash. A branch name makes the build change under you.', hl: [3], hot: { deps: 'current' }, hide: ['sub', 'tgt', 'app'], rows: [['pinned', 'v3.11.3', 'ok']] },
        { note: 'MakeAvailable adds it with add_subdirectory, built with your compiler and flags as part of your graph.', hl: [4], hot: { sub: 'current', tgt: 'write', 'deps>sub': 'accent', 'sub>tgt': 'accent' }, hide: ['app'], rows: [['built by', 'you']] },
        { note: 'Great for small or header-only deps. Big ones add minutes to every clean build and CI run.', hl: [5], hot: { app: 'ok', 'tgt>app': 'accent' }, rows: [['cost', 'clean-build time', 'warn']] },
      ],
    },
  ],
  manager: [
    'vcpkg manifest',
    {
      panel: 'Dependencies',
      codeTitle: 'vcpkg.json + configure',
      code: [
        '{ "dependencies": ["fmt", "openssl", "grpc"],',
        '  "builtin-baseline": "3426db05b9…" }',
        '',
        'cmake -B build -DCMAKE_TOOLCHAIN_FILE=',
        '  $VCPKG_ROOT/scripts/buildsystems/vcpkg.cmake',
      ],
      nodes: [
        N('man', 40, 260, 290, 110, 'vcpkg.json', 'deps + baseline'),
        N('vc', 355, 260, 290, 110, 'vcpkg', 'resolve versions'),
        N('bc', 670, 260, 290, 110, 'binary cache', 'prebuilt libs'),
        N('inst', 355, 450, 290, 110, 'vcpkg_installed', 'x64-linux triplet'),
        N('fp', 355, 640, 290, 110, 'find_package', 'grpc, fmt, openssl'),
        N('app', 355, 830, 290, 110, 'app'),
      ],
      edges: ['man>vc', 'vc>bc', 'vc>inst', 'inst>fp', 'fp>app'],
      beats: [
        { note: 'A package manager handles what FetchContent can’t: big trees like gRPC, OpenSSL and Boost.', hl: [0], hot: { man: 'current' }, hide: ['bc', 'inst', 'fp', 'app'], rows: [['direct deps', 3]] },
        { note: 'The baseline pins every version, transitive ones too, so all machines resolve the same set.', hl: [1], hot: { vc: 'current', 'man>vc': 'accent' }, hide: ['bc', 'inst', 'fp', 'app'], rows: [['resolved', '14 packages']] },
        { note: 'At configure, the toolchain file installs them, from the binary cache when it can.', hl: [3, 4], hot: { bc: 'ok', inst: 'write', 'vc>bc': 'accent', 'vc>inst': 'accent' }, hide: ['fp', 'app'], rows: [['cache hits', '14 / 14', 'ok']] },
        { note: 'The triplet fixes arch, compiler and static or shared for every package, so their ABIs match.', hot: { inst: 'current' }, hide: ['fp', 'app'], rows: [['triplet', 'x64-linux']] },
        { note: 'Your CMake stays plain find_package, so the project also builds with Conan or system packages.', hot: { fp: 'current', app: 'ok', 'inst>fp': 'accent', 'fp>app': 'accent' }, rows: [['CMake changes', 'none', 'ok']] },
      ],
    },
  ],
  export: [
    'Install & export',
    {
      panel: 'Packaging',
      code: [
        'install(TARGETS core EXPORT calcTargets)',
        'install(DIRECTORY include/ DESTINATION include)',
        'install(EXPORT calcTargets NAMESPACE calc::',
        '        DESTINATION lib/cmake/calc)',
        '// + calcConfig.cmake via configure_package_config_file',
      ],
      nodes: [
        N('core', 40, 260, 290, 110, 'core', 'your library'),
        N('lib', 355, 260, 290, 110, 'lib/libcore.a'),
        N('inc', 670, 260, 290, 110, 'include/core.h'),
        N('cfg', 355, 450, 290, 110, 'calcConfig.cmake', 'lib/cmake/calc'),
        N('other', 355, 640, 290, 110, 'other project', 'find_package(calc)'),
        N('tgt', 355, 830, 290, 110, 'calc::core', 'imported target'),
      ],
      edges: ['core>lib', 'lib>cfg', 'cfg>other', 'other>tgt'],
      beats: [
        { note: 'To reuse core from other repos, install it together with its usage requirements.', hl: [0, 1], hot: { core: 'current', lib: 'write', inc: 'write', 'core>lib': 'accent' }, hide: ['cfg', 'other', 'tgt'], rows: [['installed', 'lib + headers']] },
        { note: 'install(EXPORT) writes calcTargets.cmake, describing core as an imported target with includes and deps.', hl: [2, 3, 4], hot: { cfg: 'write', 'lib>cfg': 'accent' }, hide: ['other', 'tgt'], rows: [['package', 'calc']] },
        { note: 'Another project runs find_package(calc) and links calc::core, exactly like fmt::fmt.', hot: { other: 'current', tgt: 'ok', 'cfg>other': 'accent', 'other>tgt': 'accent' }, rows: [['consumers', 'any CMake project', 'ok']] },
        { note: 'Use GNUInstallDirs and relative paths, so the package works under any install prefix.', hot: { cfg: 'ok' }, rows: [['relocatable', 'yes', 'ok']] },
      ],
    },
  ],
});

// ---------------- build types, generator expressions, presets, CI ----------------
const CI_GRID = ['gcc', 'clang', 'msvc'].flatMap((c, r) => ['asan', 'tsan', 'release'].map((k, i) => N(`${c}-${k}`, 40 + i * 315, 250 + r * 150, 290, 120, `${c} · ${k}`)));
const gridIds = CI_GRID.map((n) => n.id);

boardDemo('cmake-config', 'Build types, presets & CI', 'Debug/Release flags, generator expressions and multi-config generators, CMakePresets.json, and a CI matrix with sanitizers.', {
  types: [
    'Build types',
    {
      panel: 'Config',
      codeTitle: 'main.cpp',
      code: ['int get(const std::vector<int>& v, size_t i) {', '  assert(i < v.size());', '  return v[i];', '}'],
      nodes: [
        N('d', 40, 260, 440, 150, 'Debug', '-O0 -g'),
        N('r', 520, 260, 440, 150, 'Release', '-O3 -DNDEBUG'),
        N('rw', 40, 450, 440, 150, 'RelWithDebInfo', '-O2 -g -DNDEBUG'),
        N('ms', 520, 450, 440, 150, 'MinSizeRel', '-Os -DNDEBUG'),
        N('res', 40, 660, 920, 150, 'get(v, 99)', 'v has 10 elements'),
      ],
      edges: [],
      beats: [
        { note: 'CMAKE_BUILD_TYPE picks one of four built-in flag sets.', rows: [['configs', 4]] },
        { note: 'Debug: no optimisation, full symbols, asserts on. get(v, 99) stops at the assert.', hl: [1], hot: { d: 'current', res: 'fail' }, sub: { res: 'Assertion failed: i < v.size()' }, rows: [['asserts', 'on'], ['speed', 'slow']] },
        { note: 'Release defines NDEBUG, so the assert is gone and get(v, 99) reads past the buffer.', hl: [2], hot: { r: 'current', res: 'warn' }, sub: { res: 'reads garbage, no error' }, rows: [['asserts', 'off', 'warn'], ['speed', 'fast']] },
        { note: 'RelWithDebInfo is what you usually ship and profile: optimised, with symbols for stack traces.', hot: { rw: 'current', res: 'ok' }, sub: { res: 'fast + readable crash dumps' }, rows: [['symbols', 'yes', 'ok']] },
        { note: 'Develop and test in Debug with sanitizers on, and benchmark only optimised builds.', hot: { d: 'ok', rw: 'ok' }, rows: [['benchmark in', 'Release / RelWithDebInfo']] },
      ],
    },
  ],
  genex: [
    'Generator expressions',
    {
      panel: 'Config',
      code: [
        'target_compile_options(app PRIVATE',
        '  $<$<CONFIG:Debug>:-fsanitize=address>',
        '  $<$<CXX_COMPILER_ID:MSVC>:/W4>',
        '  $<$<NOT:$<CXX_COMPILER_ID:MSVC>>:-Wall -Wextra>)',
        'if(CMAKE_BUILD_TYPE STREQUAL "Debug")   # wrong',
      ],
      nodes: [
        N('single', 40, 300, 440, 130, 'Ninja, Makefiles', 'config set at configure'),
        N('multi', 520, 300, 440, 130, 'Xcode, VS, Ninja MC', 'config set at build'),
        N('gen', 40, 490, 920, 130, 'generated build files', 'flags resolved per config'),
        N('cmd', 40, 680, 920, 130, 'cmake --build build --config Debug'),
      ],
      edges: ['single>gen', 'multi>gen', 'gen>cmd'],
      beats: [
        { note: 'Generator expressions $<…> are evaluated at generate time, per target and per config.', hl: [0, 1], hot: { gen: 'current' }, rows: [['evaluated', 'generate time']] },
        { note: 'They switch flags by config or compiler without if() blocks.', hl: [2, 3], hot: { gen: 'write' }, rows: [['compilers', 'gcc, clang, msvc']] },
        { note: 'Single-config generators fix the config at configure time, so if(CMAKE_BUILD_TYPE) works there.', hl: [4], hot: { single: 'current', 'single>gen': 'accent' }, rows: [['if()', 'works', 'ok']] },
        { note: 'Multi-config generators pick it at build time and leave CMAKE_BUILD_TYPE empty. The if() silently does nothing.', hl: [4], hot: { multi: 'fail', cmd: 'current', 'multi>gen': 'accent' }, rows: [['if()', 'ignored', 'fail']] },
        { note: 'Genexes work with both. Use them for every per-config setting.', hl: [1], hot: { single: 'ok', multi: 'ok' }, rows: [['genex', 'works', 'ok']] },
      ],
    },
  ],
  presets: [
    'CMakePresets.json',
    {
      panel: 'Presets',
      codeTitle: 'CMakePresets.json',
      code: [
        '{ "configurePresets": [',
        '  { "name": "debug", "generator": "Ninja",',
        '    "binaryDir": "build/debug",',
        '    "cacheVariables": { "CMAKE_BUILD_TYPE": "Debug" } },',
        '  { "name": "asan", "inherits": "debug",',
        '    "binaryDir": "build/asan",',
        '    "cacheVariables": { "SANITIZE": "address" } } ] }',
      ],
      nodes: [
        N('file', 355, 330, 290, 110, 'CMakePresets.json', 'checked in'),
        N('dev', 40, 520, 290, 110, 'laptop', '--preset debug'),
        N('ide', 355, 520, 290, 110, 'IDE', 'VS Code, CLion'),
        N('ci', 670, 520, 290, 110, 'CI', '--preset asan'),
        N('user', 40, 720, 920, 110, 'CMakeUserPresets.json', 'personal, gitignored'),
      ],
      edges: ['file>dev', 'file>ide', 'file>ci', 'user>dev'],
      beats: [
        { note: 'Long cmake command lines drift apart between laptops, CI and IDEs.', hot: { dev: 'warn', ide: 'warn', ci: 'warn' }, hide: ['file', 'user'], rows: [['setups', 'ad hoc', 'warn']] },
        { note: 'CMakePresets.json names each setup once and lives in git.', hl: [0, 1, 2, 3], hot: { file: 'current' }, hide: ['user'], rows: [['presets', 2]] },
        { note: 'Everyone configures with cmake --preset debug, and CI with --preset asan.', hl: [4, 5, 6], hot: { dev: 'ok', ide: 'ok', ci: 'ok', 'file>dev': 'accent', 'file>ide': 'accent', 'file>ci': 'accent' }, hide: ['user'], rows: [['setups', 'identical', 'ok']] },
        { note: 'Personal tweaks go in CMakeUserPresets.json, which is gitignored.', hot: { user: 'current', 'user>dev': 'accent' }, rows: [['personal', 'user presets']] },
        { note: 'Build and test presets exist too, so ctest --preset asan runs the same everywhere.', hot: { ci: 'ok', dev: 'ok' }, rows: [['preset kinds', 'configure, build, test']] },
      ],
    },
  ],
  ci: [
    'CI matrix',
    {
      panel: 'CI',
      nodes: [
        N('pr', 40, 40, 290, 110, 'pull request'),
        N('cfg', 355, 40, 290, 110, 'cmake --preset'),
        N('tst', 670, 40, 290, 110, 'ctest -j'),
        ...CI_GRID,
        N('tidy', 40, 720, 440, 110, 'clang-tidy', 'compile_commands.json'),
        N('werr', 520, 720, 440, 110, 'warnings as errors', 'CI only'),
        N('merge', 355, 870, 290, 110, 'merge'),
      ],
      edges: ['pr>cfg', 'cfg>tst'],
      beats: [
        { note: 'Big C++ codebases stay healthy by building every change several ways.', hot: { pr: 'current' }, rows: [['jobs', 9]] },
        { note: 'Each cell is one preset: compilers disagree on warnings, and each sanitizer finds a different bug class.', hot: { cfg: 'current', tst: 'current', ...all(gridIds, 'write'), 'pr>cfg': 'accent', 'cfg>tst': 'accent' }, rows: [['jobs', 9], ['running', 9]] },
        { note: 'ASan finds use-after-free and overflows, TSan finds data races. TSan can’t share a build with ASan.', hot: { ...all(gridIds.filter((i) => i.endsWith('asan')), 'fail'), ...all(gridIds.filter((i) => i.endsWith('tsan')), 'warn') }, rows: [['asan', 'heap-use-after-free', 'fail'], ['tsan', 'data race', 'warn']] },
        { note: 'CMAKE_EXPORT_COMPILE_COMMANDS writes compile_commands.json, which clangd and clang-tidy read.', hot: { tidy: 'current' }, rows: [['static analysis', 'clang-tidy']] },
        { note: '-Werror only in CI, so a new compiler’s new warning doesn’t break users’ builds.', hot: { werr: 'current' }, rows: [['-Werror', 'CI only']] },
        { note: 'Merge only when the whole matrix is green.', hot: { ...all(gridIds, 'ok'), tidy: 'ok', werr: 'ok', merge: 'ok' }, rows: [['green', '9 / 9', 'ok']] },
      ],
    },
  ],
});

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
