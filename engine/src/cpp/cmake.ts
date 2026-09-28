// CMake (group cpp-cmake): configure/generate/build, targets, dependencies, configs, presets, CI.
import type { Detail, Tone } from '../algo/frames';
import { boardDemo as demo, N } from '../machine/lib/board';
import type { Board } from '../machine/lib/board';

const all = (ids: string[], tone: Tone) => Object.fromEntries(ids.map((id) => [id, tone]));
const boardDemo = (slug: string, title: string, summary: string, boards: Record<string, [string, Board]>) => demo('cpp-cmake', slug, title, summary, boards, { ...COMMON, ...DETAILS[slug], ...EXTRA[slug] });

const EXTRA: Record<string, Record<string, Detail>> = {
  'cmake-deps': {
    github: { title: 'Remote source', text: 'Pin a tag or, better, a commit hash or URL_HASH so the download never changes.', code: 'FetchContent_Declare(json\n  URL https://github.com/nlohmann/json/releases/download/v3.11.3/json.tar.xz\n  URL_HASH SHA256=d6c65aca…)' },
    nlohmann_json: { title: 'Target from a fetched project', text: 'Built inside your build like your own targets.', code: 'target_link_libraries(app PRIVATE nlohmann_json::nlohmann_json)\n\n#include <nlohmann/json.hpp>\nauto j = nlohmann::json::parse(R"({"n": 1})");' },
    vcpkg: { title: 'vcpkg', text: 'Microsoft’s C++ package manager. Builds each package from source once per triplet, then caches it.', code: '$ git clone https://github.com/microsoft/vcpkg\n$ ./vcpkg/bootstrap-vcpkg.sh\n$ export VCPKG_ROOT=$PWD/vcpkg' },
    find_package: { title: 'find_package in manifest mode', text: 'The toolchain file points CMAKE_PREFIX_PATH at vcpkg_installed, so plain find_package calls just work.', code: 'find_package(fmt CONFIG REQUIRED)\nfind_package(OpenSSL REQUIRED)\nfind_package(gRPC CONFIG REQUIRED)\ntarget_link_libraries(app PRIVATE fmt::fmt OpenSSL::SSL gRPC::grpc++)' },
    'lib/libcore.a': { title: 'Installed library', text: 'Copied by install(TARGETS) into <prefix>/lib.', code: 'install(TARGETS core EXPORT calcTargets\n  ARCHIVE DESTINATION ${CMAKE_INSTALL_LIBDIR}\n  INCLUDES DESTINATION ${CMAKE_INSTALL_INCLUDEDIR})' },
    'include/core.h': { title: 'Installed headers', text: 'Only the public headers get installed.', code: 'install(DIRECTORY include/ DESTINATION ${CMAKE_INSTALL_INCLUDEDIR})' },
    'other project': { title: 'A consumer', text: 'Points CMAKE_PREFIX_PATH at your install prefix and finds the package.', code: 'cmake -B build -DCMAKE_PREFIX_PATH=/opt/calc\n\nfind_package(calc 1.2 REQUIRED)\ntarget_link_libraries(tool PRIVATE calc::core)' },
  },
  'cmake-config': {
    'get(v, 99)': { title: 'The example call', text: 'Index 99 in a 10-element vector: a bug that only Debug catches.', code: 'std::vector<int> v(10);\nget(v, 99);  // Debug: assert fires\n             // Release: undefined behaviour' },
    'Ninja, Makefiles': { title: 'Single-config generators', text: 'One build type per build directory, chosen at configure time.', code: 'cmake -B build-debug -G Ninja -DCMAKE_BUILD_TYPE=Debug\ncmake -B build-rel   -G Ninja -DCMAKE_BUILD_TYPE=Release' },
    'Xcode, VS, Ninja MC': { title: 'Multi-config generators', text: 'One build directory holds every config; pick one when building.', code: 'cmake -B build -G "Ninja Multi-Config"\ncmake --build build --config Debug\ncmake --build build --config Release' },
    laptop: { title: 'Developer machine', text: 'The same named preset as everyone else.', code: 'cmake --preset debug\ncmake --build --preset debug' },
    CI: { title: 'CI job', text: 'Runs a preset from the same file, so CI and laptops can’t drift.', code: '- run: cmake --preset asan\n- run: cmake --build --preset asan\n- run: ctest --preset asan' },
    'CMakeUserPresets.json': { title: 'Personal presets', text: 'Inherit shared presets and tweak locally; gitignored.', code: '{ "version": 6, "configurePresets": [\n  { "name": "mine", "inherits": "debug",\n    "cacheVariables": { "CMAKE_CXX_COMPILER": "clang++-18" } } ] }' },
    'pull request': { title: 'Trigger', text: 'Every pull request runs the whole matrix.', code: 'on:\n  pull_request:\njobs:\n  build:\n    strategy:\n      matrix: { preset: [gcc-asan, clang-tsan, msvc-release] }' },
  },
  'cmake-first': {
    'main.o': { title: 'main.o', text: 'Compiled main.cpp; it references greet but doesn’t define it.', code: '$ nm -C main.cpp.o\n0000 T main\n     U greet(std::string const&)' },
    '-- Configuring hello': { title: 'Configure output', text: 'message() levels: STATUS for progress, WARNING, SEND_ERROR, FATAL_ERROR to stop.', code: '$ cmake -S . -B build\n-- Configuring hello\n-- Configuring done' },
  },
  'cmake-layout': {
    greet: { title: 'greet target', text: 'A library target defined in greet/CMakeLists.txt, usable anywhere in the project.', code: 'add_library(greet STATIC src/greet.cpp)\ntarget_include_directories(greet PUBLIC include)' },
    'CMakePresets.json': { title: 'Shared presets', text: 'Named setups everyone uses.', code: 'cmake --list-presets' },
    'build/': { title: 'Build directories', text: 'Out of source and ignored by git; one per configuration if you like.', code: '# .gitignore\nbuild*/\nout/' },
  },
  'cmake-options': {
    'compile command': { title: 'Resulting command', text: 'What actually runs, visible with cmake --build build -v.', code: 'c++ -std=gnu++17 -Wall -Wextra -o main.o -c main.cpp' },
    'cmake -B build -DENABLE_GREETING=OFF': { title: 'Setting options', text: '-D writes the value into the cache; it sticks for later runs.', code: '$ cmake -B build -DENABLE_GREETING=OFF\n$ grep ENABLE build/CMakeCache.txt\nENABLE_GREETING:BOOL=OFF' },
    find_package: { title: 'find_package(Threads)', text: 'Uses the FindThreads module shipped with CMake.', code: 'set(THREADS_PREFER_PTHREAD_FLAG ON)\nfind_package(Threads REQUIRED)' },
  },
  'cmake-test-install': {
    'out/bin/hello': { title: 'Installed executable', text: 'Lands in <prefix>/bin, per install(TARGETS … DESTINATION bin).', code: '$ ls out/bin\nhello\n$ ./out/bin/hello' },
    hello_test: { title: 'Test executable', text: 'Just a program; CTest only looks at its exit code.', code: 'add_executable(hello_test test.cpp)\nadd_test(NAME hello_test COMMAND hello_test)' },
    'exit code ≠ 0': { title: 'A failing test', text: 'assert() aborts with a non-zero code, which CTest reports as a failure.', code: '1/1 Test #1: hello_test ...***Failed  0.01 sec\nAssertion failed: (add(2, 3) == 6)' },
    db_stop: { title: 'Cleanup fixture', text: 'Runs after all tests requiring db, even if they failed.', code: 'set_tests_properties(db_stop PROPERTIES\n  FIXTURES_CLEANUP db)' },
  },
  'cmake-advanced': {
    'generate time': { title: 'When genexes evaluate', text: 'After all CMakeLists.txt have run, per target and config, while writing build files.', code: 'file(GENERATE OUTPUT paths-$<CONFIG>.txt\n  CONTENT "$<TARGET_FILE:hello>")' },
    'same pattern': { title: 'Protobuf codegen', text: 'protobuf ships a CMake function built on add_custom_command.', code: 'find_package(Protobuf REQUIRED)\nadd_library(msgs msg.proto)\nprotobuf_generate(TARGET msgs)\ntarget_link_libraries(msgs PUBLIC protobuf::libprotobuf)' },
  },
  'cmake-toolchain': {
    'build host': { title: 'Build host', text: 'The machine running CMake and the compiler.', code: '$ uname -m\nx86_64' },
    target: { title: 'Target', text: 'The machine the binary will run on.', code: '$ ssh pi uname -m\naarch64' },
    'message(DEBUG)': { title: 'Printing variables', text: 'DEBUG messages show only with --log-level=DEBUG.', code: 'message(DEBUG "deps: ${DEPS}")\ninclude(CMakePrintHelpers)\ncmake_print_variables(CMAKE_BUILD_TYPE CMAKE_CXX_COMPILER)' },
  },
};

const COMMON: Record<string, Detail> = {
  app: { title: 'app', text: 'The executable target of the example project.', code: 'add_executable(app main.cpp)\ntarget_link_libraries(app PRIVATE fmt::fmt)' },
  'main.cpp': { title: 'main.cpp', text: 'The file holding main(), where the program starts. It usually just wires the pieces together.', code: '#include "math.h"\n#include <iostream>\n\nint main() {\n  std::cout << square(3) << "\\n";  // 9\n}' },
  'CMakeLists.txt': { title: 'CMakeLists.txt', text: 'The build description CMake reads. One per directory; the top one starts with cmake_minimum_required and project.', code: 'cmake_minimum_required(VERSION 3.25)\nproject(calc LANGUAGES CXX)\n\nadd_executable(calc main.cpp math.cpp)' },
};

const SAN: Record<string, string> = { asan: 'AddressSanitizer + UBSan: memory errors and UB.', tsan: 'ThreadSanitizer: data races. Needs its own build.', release: 'The shipping configuration, with its real optimisations.' };
const CI_DETAILS = Object.fromEntries(['gcc', 'clang', 'msvc'].flatMap((c) => Object.keys(SAN).map((k) => [`${c} · ${k}`, { title: `${c} · ${k}`, text: SAN[k], code: `cmake --preset ${c}-${k}\ncmake --build --preset ${c}-${k}\nctest --preset ${c}-${k} -j8` }])));

const DETAILS: Record<string, Record<string, Detail>> = {
  'cmake-pipeline': {
    'source tree': { title: 'Source tree', text: 'Your checked-in files. CMake never writes here when you build out of source with -B build.', code: 'calc/\n├── CMakeLists.txt\n├── main.cpp\n├── math.cpp\n└── math.h' },
    configure: { title: 'Configure step', text: 'Runs your CMakeLists.txt as a script: detects the compiler, evaluates if()/find_package(), records results in the cache.', code: '$ cmake -S . -B build -G Ninja\n-- The CXX compiler identification is AppleClang 16\n-- Detecting CXX compiler ABI info - done\n-- Configuring done (0.4s)\n-- Generating done (0.0s)\n-- Build files written to: build' },
    'CMakeCache.txt': { title: 'CMakeCache.txt', text: 'Key=value answers from configure, reused on every later run. Edit with -D, ccmake or cmake-gui, not by hand.', code: '// build/CMakeCache.txt (excerpt)\nCMAKE_BUILD_TYPE:STRING=Release\nCMAKE_CXX_COMPILER:FILEPATH=/usr/bin/c++\nCMAKE_GENERATOR:INTERNAL=Ninja\nCMAKE_INSTALL_PREFIX:PATH=/usr/local' },
    generate: { title: 'Generate step', text: 'Turns the target graph into files for a real build tool. Pick one with -G.', code: '$ cmake -G Ninja ...        # build.ninja\n$ cmake -G "Unix Makefiles"  # Makefile\n$ cmake -G Xcode ...         # calc.xcodeproj' },
    build: { title: 'Build step', text: 'cmake --build calls the generated tool for you, so the same command works for Ninja, Make or Xcode.', code: '# build/build.ninja (excerpt)\nbuild CMakeFiles/calc.dir/math.cpp.o: CXX_COMPILER math.cpp\n  DEP_FILE = CMakeFiles/calc.dir/math.cpp.o.d\n  FLAGS = -O3 -DNDEBUG -std=gnu++17\nbuild calc: CXX_EXECUTABLE_LINKER main.cpp.o math.cpp.o\n\n$ cmake --build build -j8' },
    'main.o': { title: 'main.o (object file)', text: 'Machine code for one .cpp, with a symbol table of what it defines (T) and still needs (U).', code: '$ nm -C build/CMakeFiles/calc.dir/main.cpp.o\n0000000000000000 T main\n                 U square(int)\n                 U std::cout' },
    'math.o': { title: 'math.o (object file)', text: 'Defines square(int). The linker uses it to satisfy main.o\'s undefined reference.', code: '$ nm -C math.cpp.o\n0000000000000000 T square(int)' },
    calc: { title: 'calc (executable)', text: 'The linked program: all objects plus the libraries they need, with addresses resolved.', code: '$ ./build/calc\n9\n$ file build/calc\nbuild/calc: Mach-O 64-bit executable arm64' },
  },
  'cmake-targets': {
    app: { title: 'app target', text: 'The executable. It links net and inherits everything net marks PUBLIC.', code: 'add_executable(app main.cpp)\ntarget_link_libraries(app PRIVATE net)' },
    net: { title: 'net target', text: 'A library whose public header includes core.h, so it must pass core on to its users.', code: '// net/include/net.h\n#pragma once\n#include "core.h"   // → net needs core PUBLIC\n\nstruct Client { core::Config cfg; };' },
    core: { title: 'core target', text: 'The bottom library. Its include/ dir is PUBLIC, its use of fmt is an implementation detail.', code: 'add_library(core src/core.cpp)\ntarget_include_directories(core PUBLIC include)\ntarget_link_libraries(core PRIVATE fmt::fmt)' },
    'fmt::fmt': { title: 'fmt::fmt (imported target)', text: 'A third-party library as a target. Linking it brings its include path and library file.', code: '#include <fmt/core.h>\n\nstd::string hello(int n) {\n  return fmt::format("hello #{}", n);\n}' },
    'app compiles with': { title: 'Effective flags of app', text: 'What CMake computes for app after walking the link graph. Check it with a verbose build.', code: '$ cmake --build build -v | grep main.cpp\nc++ -I/src/core/include -O2 -c main.cpp' },
    'net compiles with': { title: 'Effective flags of net', text: 'Own flags plus the PUBLIC/INTERFACE ones of everything net links.', code: 'c++ -I/src/core/include -c net.cpp' },
    'core compiles with': { title: 'Effective flags of core', text: 'PRIVATE and PUBLIC requirements both apply to the target itself.', code: 'c++ -I/src/core/include -I/deps/fmt/include \\\n    -c core.cpp' },
    units: { title: 'INTERFACE library', text: 'No sources, no output file. Only usage requirements for whoever links it.', code: 'add_library(units INTERFACE)\ntarget_include_directories(units INTERFACE include)\ntarget_compile_features(units INTERFACE cxx_std_20)' },
    'app link line': { title: 'Final link command', text: 'Static libraries are just object archives, so their dependencies must appear on the final link line too.', code: 'c++ main.o -o app libcore.a libfmt.a' },
  },
  'cmake-deps': {
    '/opt/homebrew': { title: 'Search prefix', text: 'find_package looks under each prefix for <pkg>Config.cmake in lib/cmake/<pkg>/ and similar paths.', code: '/opt/homebrew/lib/cmake/fmt/fmt-config.cmake\n/opt/homebrew/lib/cmake/fmt/fmt-config-version.cmake' },
    '/usr/local': { title: 'Search prefix', text: 'Add your own prefixes with CMAKE_PREFIX_PATH; they are searched before system ones.', code: 'cmake -B build -DCMAKE_PREFIX_PATH="$HOME/sdk;/usr/local"' },
    'fmtConfig.cmake': { title: 'Package config file', text: 'Shipped by the package itself. It creates imported targets and checks the version you asked for.', code: '# lib/cmake/fmt/fmt-config.cmake (simplified)\ninclude("${CMAKE_CURRENT_LIST_DIR}/fmt-targets.cmake")\n# defines: add_library(fmt::fmt STATIC IMPORTED)' },
    'fmt::fmt': { title: 'Imported target', text: 'A target that describes prebuilt files. You link it like your own targets.', code: 'find_package(fmt 10 REQUIRED CONFIG)\ntarget_link_libraries(app PRIVATE fmt::fmt)' },
    carries: { title: 'Usage requirements', text: 'Everything a consumer needs, bundled into the target instead of copy-pasted paths.', code: 'INTERFACE_INCLUDE_DIRECTORIES /usr/local/include\nIMPORTED_LOCATION /usr/local/lib/libfmt.a\nINTERFACE_COMPILE_DEFINITIONS FMT_SHARED' },
    'build/_deps': { title: 'FetchContent download dir', text: 'Sources land in build/_deps/<name>-src and build in <name>-build. Delete the build dir to refetch.', code: 'build/_deps/\n├── json-src/\n├── json-build/\n└── json-subbuild/' },
    'add_subdirectory': { title: 'add_subdirectory', text: 'Processes another CMakeLists.txt as part of your build, so its targets join your graph.', code: 'add_subdirectory(third_party/json)\ntarget_link_libraries(app PRIVATE nlohmann_json::nlohmann_json)' },
    'vcpkg.json': { title: 'vcpkg manifest', text: 'Lists dependencies and a baseline commit that pins their versions.', code: '{\n  "dependencies": ["fmt", "openssl",\n    { "name": "grpc", "features": ["codegen"] }],\n  "builtin-baseline": "3426db05b9…"\n}' },
    'binary cache': { title: 'Binary cache', text: 'Built packages keyed by a hash of version, triplet and flags. CI and laptops reuse each other\'s builds.', code: 'export VCPKG_BINARY_SOURCES=\\\n  "clear;files,/mnt/cache,readwrite"' },
    vcpkg_installed: { title: 'Installed tree', text: 'One prefix per triplet with include/, lib/ and share/<pkg>/ config files.', code: 'build/vcpkg_installed/x64-linux/\n├── include/fmt/\n├── lib/libfmt.a\n└── share/fmt/fmt-config.cmake' },
    'calcConfig.cmake': { title: 'Your package config', text: 'Generated at install. Lets others find_package(calc) and get calc::core.', code: '@PACKAGE_INIT@\ninclude(CMakeFindDependencyMacro)\nfind_dependency(fmt 10)\ninclude("${CMAKE_CURRENT_LIST_DIR}/calcTargets.cmake")' },
    'calc::core': { title: 'Exported target', text: 'The namespace makes typos a configure error instead of a silent -lcore.', code: 'find_package(calc 1.2 REQUIRED)\ntarget_link_libraries(tool PRIVATE calc::core)' },
  },
  'cmake-config': {
    Debug: { title: 'Debug', text: 'No optimisation, full debug info, asserts active. Step through it in a debugger.', code: '-O0 -g\n// assert(i < v.size()) is checked' },
    Release: { title: 'Release', text: 'Full optimisation and NDEBUG, so assert() compiles to nothing.', code: '-O3 -DNDEBUG\n// #define NDEBUG → assert(x) becomes ((void)0)' },
    RelWithDebInfo: { title: 'RelWithDebInfo', text: 'Optimised with symbols. Profilers and crash reports can name functions and lines.', code: '-O2 -g -DNDEBUG' },
    MinSizeRel: { title: 'MinSizeRel', text: 'Optimise for size. Useful for embedded targets and small downloads.', code: '-Os -DNDEBUG' },
    'CMakePresets.json': { title: 'CMakePresets.json', text: 'Named configure/build/test setups, checked in and understood by IDEs.', code: '$ cmake --list-presets\n  "debug"\n  "asan"\n$ cmake --preset debug\n$ cmake --build --preset debug\n$ ctest --preset debug' },
    'clang-tidy': { title: 'clang-tidy', text: 'Static analysis using the exact flags from compile_commands.json.', code: 'set(CMAKE_EXPORT_COMPILE_COMMANDS ON)\n# or per target:\nset_target_properties(core PROPERTIES\n  CXX_CLANG_TIDY "clang-tidy;-checks=bugprone-*")' },
    ...CI_DETAILS,
    'warnings as errors': { title: 'Warnings as errors', text: 'CMake 3.24+ has a switch for it, so presets can enable it for CI only.', code: 'set_target_properties(core PROPERTIES COMPILE_WARNING_AS_ERROR ON)\n# CI: cmake --preset ci --compile-no-warning-as-error=OFF' },
  },
};

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


// ---------------- first projects (hello_cmake 1–4) ----------------
Object.assign(DETAILS, {
  'cmake-first': {
    hello: { title: 'hello (executable target)', text: 'The target add_executable declares. Its name is the output file name.', code: '$ cmake -S . -B build && cmake --build build\n$ ./build/hello\nHello, CMake!' },
    'build/': { title: 'Build directory', text: 'Everything CMake and the compiler produce. Delete it any time to start clean.', code: 'build/\n├── CMakeCache.txt\n├── CMakeFiles/\n├── build.ninja\n└── hello' },
    APP_NAME: { title: 'A CMake variable', text: 'Every value is a string. Lists are strings separated by semicolons.', code: 'set(APP_NAME hello)\nset(SRCS main.cpp greet.cpp)   # "main.cpp;greet.cpp"\nmessage(STATUS "srcs: ${SRCS}")' },
    GREETING: { title: 'String variable', text: 'Quote values with spaces. ${GREETING} expands inside other strings too.', code: 'set(GREETING "Hello from CMake")' },
    '-DGREETING="Hello from CMake"': { title: 'Compile definition', text: 'The flag target_compile_definitions adds. The preprocessor sees it as #define GREETING "Hello from CMake".', code: '// main.cpp\n#include <iostream>\nint main() { std::cout << GREETING << "\\n"; }' },
    'greet.h': { title: 'greet.h (declaration)', text: 'Says greet exists and what it takes, so other files can call it.', code: '#pragma once\n#include <string>\n\nstd::string greet(const std::string& name);' },
    'greet.cpp': { title: 'greet.cpp (definition)', text: 'The one place the body lives.', code: '#include "greet.h"\n\nstd::string greet(const std::string& name) {\n  return "Hello, " + name + "!";\n}' },
    'greet.o': { title: 'greet.o', text: 'Compiled greet.cpp: defines greet(std::string const&).', code: '$ nm -C greet.cpp.o | grep greet\n0000000000000000 T greet(std::string const&)' },
    'libgreet.a': { title: 'Static library', text: 'An archive of object files, made once and linked into any number of targets.', code: '$ ar t build/libgreet.a\ngreet.cpp.o' },
    hello_test: { title: 'Second consumer', text: 'Links the same library without recompiling greet.cpp.', code: 'add_executable(hello_test test.cpp)\ntarget_link_libraries(hello_test PRIVATE greet)' },
  },
});

boardDemo('cmake-first', 'First CMake projects', 'hello_cmake steps 1–4: minimal project, variables and message(), several sources, a static library.', {
  minimal: [
    'Minimal project',
    {
      panel: 'Project',
      code: ['cmake_minimum_required(VERSION 3.10)', 'project(hello_cmake_01)', 'add_executable(hello main.cpp)'],
      nodes: [N('main', 40, 220, 280, 110, 'main.cpp'), N('cml', 360, 220, 280, 110, 'CMakeLists.txt'), N('bdir', 680, 220, 280, 110, 'build/', 'out-of-source'), N('exe', 360, 440, 280, 110, 'hello', 'executable'), N('out', 40, 680, 920, 120, 'Hello, CMake!', '$ ./build/hello')],
      edges: ['main>exe', 'cml>exe', 'exe>out'],
      beats: [
        { note: 'Step 1: one source file and a three-line CMakeLists.txt.', hot: { main: 'current', cml: 'current' }, hide: ['bdir', 'exe', 'out'], rows: [['files', 2]] },
        { note: 'cmake_minimum_required pins CMake behaviour to a version, and project names the project and enables C/C++.', hl: [0, 1], hot: { cml: 'current' }, hide: ['bdir', 'exe', 'out'], rows: [['project', 'hello_cmake_01']] },
        { note: 'add_executable declares one target: the program hello, built from main.cpp.', hl: [2], hot: { exe: 'write', 'main>exe': 'accent', 'cml>exe': 'accent' }, hide: ['bdir', 'out'], rows: [['targets', 1]] },
        { note: 'cmake -S . -B build configures into build/, then cmake --build build compiles and links.', hot: { bdir: 'current', exe: 'ok' }, hide: ['out'], rows: [['build dir', 'build/']] },
        { note: 'Run ./build/hello. The same two commands work on Linux, macOS and Windows.', hot: { out: 'ok', 'exe>out': 'ok' }, rows: [['result', 'runs', 'ok']] },
      ],
    },
  ],
  variables: [
    'Variables & message',
    {
      panel: 'Variables',
      code: ['set(APP_NAME hello)', 'set(GREETING "Hello from CMake")', 'message(STATUS "Configuring ${APP_NAME}")', 'add_executable(${APP_NAME} main.cpp)', 'target_compile_definitions(${APP_NAME}', '  PRIVATE GREETING="${GREETING}")'],
      nodes: [
        N('v1', 40, 300, 440, 110, 'APP_NAME', 'hello'),
        N('v2', 520, 300, 440, 110, 'GREETING', '"Hello from CMake"'),
        N('log', 40, 470, 920, 100, '-- Configuring hello', 'printed by cmake'),
        N('mac', 40, 620, 920, 110, '-DGREETING="Hello from CMake"', 'compiler flag'),
        N('cpp', 40, 790, 920, 110, 'std::cout << GREETING', 'main.cpp'),
      ],
      edges: ['v2>mac', 'mac>cpp'],
      beats: [
        { note: 'set() makes a variable. Every CMake value is a string; lists are strings with semicolons.', hl: [0, 1], hot: { v1: 'write', v2: 'write' }, hide: ['log', 'mac', 'cpp'], rows: [['variables', 2]] },
        { note: '${NAME} expands a variable anywhere, and message(STATUS) prints while configuring.', hl: [2, 3], hot: { log: 'current' }, hide: ['mac', 'cpp'], rows: [['output', 'configure log']] },
        { note: 'target_compile_definitions turns a CMake value into a C++ macro for one target.', hl: [4, 5], hot: { mac: 'write', 'v2>mac': 'accent' }, hide: ['cpp'], rows: [['defines', 'GREETING']] },
        { note: 'main.cpp sees GREETING like a #define. CMake variables reach C++ only through such flags or generated headers.', hot: { cpp: 'ok', 'mac>cpp': 'accent' }, rows: [['prints', 'Hello from CMake', 'ok']] },
        { note: 'Variables are scoped per directory and function: set() in a child stays local unless you add PARENT_SCOPE.', hot: { v1: 'warn' }, sub: { v1: 'scope: this dir + children' }, rows: [['scope', 'directory / function', 'warn']] },
      ],
    },
  ],
  sources: [
    'Several sources',
    {
      panel: 'Sources',
      code: ['add_executable(hello main.cpp greet.cpp)'],
      nodes: [N('main', 40, 180, 280, 110, 'main.cpp', 'calls greet()'), N('gh', 360, 180, 280, 110, 'greet.h', 'declares'), N('gc', 680, 180, 280, 110, 'greet.cpp', 'defines'), N('mo', 40, 420, 280, 110, 'main.o'), N('go', 680, 420, 280, 110, 'greet.o'), N('exe', 360, 660, 280, 110, 'hello')],
      edges: ['main>mo', 'gc>go', 'gh>mo', 'gh>go', 'mo>exe', 'go>exe'],
      beats: [
        { note: 'Step 3 splits the code: greet.h declares greet(), greet.cpp defines it, main.cpp calls it.', hot: { gh: 'current' }, hide: ['mo', 'go', 'exe'], rows: [['sources', 2], ['headers', 1]] },
        { note: 'List every .cpp in add_executable. Headers are found through #include, not listed.', hl: [0], hot: { main: 'write', gc: 'write' }, hide: ['mo', 'go', 'exe'], rows: [['listed', 'main.cpp greet.cpp']] },
        { note: 'Each .cpp compiles on its own; both include greet.h, so both agree on greet’s signature.', hot: { mo: 'write', go: 'write', 'gh>mo': 'accent', 'gh>go': 'accent' }, hide: ['exe'], rows: [['objects', 2]] },
        { note: 'The linker joins main.o and greet.o. Leave greet.cpp out and you get an undefined reference.', hot: { exe: 'ok', 'mo>exe': 'ok', 'go>exe': 'ok' }, rows: [['linked', 'hello', 'ok']] },
      ],
    },
  ],
  static: [
    'Static library',
    {
      panel: 'Library',
      code: ['add_library(greet STATIC greet.cpp)', 'add_executable(hello main.cpp)', 'target_link_libraries(hello PRIVATE greet)'],
      nodes: [N('gc', 40, 220, 280, 110, 'greet.cpp'), N('lib', 40, 440, 280, 110, 'libgreet.a', 'archive'), N('main', 680, 220, 280, 110, 'main.cpp'), N('exe', 680, 440, 280, 110, 'hello'), N('other', 360, 680, 280, 110, 'hello_test', 'reuses greet')],
      edges: ['gc>lib', 'main>exe', 'lib>exe', 'lib>other'],
      beats: [
        { note: 'add_library with STATIC compiles greet.cpp once into an archive, libgreet.a.', hl: [0], hot: { lib: 'write', 'gc>lib': 'accent' }, hide: ['exe', 'other'], rows: [['libraries', 1]] },
        { note: 'The executable lists only main.cpp and links the library by target name.', hl: [1, 2], hot: { exe: 'current', 'lib>exe': 'accent' }, hide: ['other'], rows: [['hello links', 'greet']] },
        { note: 'Any number of targets can link greet without recompiling it.', hot: { other: 'ok', 'lib>other': 'accent' }, rows: [['consumers', 2]] },
        { note: 'Use target names, not file paths: CMake knows where libgreet.a lands and puts it on the link line.', hot: { exe: 'ok', lib: 'ok' }, rows: [['paths written', 0, 'ok']] },
      ],
    },
  ],
});

// ---------------- layout & subdirectories (hello_cmake 5–6) ----------------
Object.assign(DETAILS, {
  'cmake-layout': {
    'include/greet.h': { title: 'Public header', text: 'What users of greet may include. Keep it minimal: declarations, no implementation details.', code: '#pragma once\n#include <string>\nstd::string greet(const std::string& name);' },
    'src/greet.cpp': { title: 'Private source', text: 'Implementation, invisible to consumers.', code: '#include "greet.h"\nstd::string greet(const std::string& n) {\n  return "Hello, " + n;\n}' },
    'src/main.cpp': { title: 'main.cpp', text: 'Includes greet.h by name; the -I flag from greet makes that work.', code: '#include "greet.h"\n#include <iostream>\nint main() { std::cout << greet("CMake") << "\\n"; }' },
    '-I include': { title: 'Include path', text: 'Added to greet and, because it is PUBLIC, to every target that links greet.', code: 'c++ -I/src/include -c src/main.cpp' },
    'greet/CMakeLists.txt': { title: 'Child CMakeLists.txt', text: 'Runs only when the parent calls add_subdirectory(greet). Relative paths are relative to greet/.', code: 'add_library(greet STATIC src/greet.cpp)\ntarget_include_directories(greet PUBLIC include)' },
    'variable scope': { title: 'Directory scope', text: 'A child directory gets a copy of the parent variables. Changes stay in the child unless pushed up.', code: '# greet/CMakeLists.txt\nset(GREET_VERSION 2)               # local\nset(GREET_VERSION 2 PARENT_SCOPE)  # visible to parent' },
    'CMakeLists.txt (top)': { title: 'Top-level CMakeLists.txt', text: 'Project, options, then one add_subdirectory per part.', code: 'cmake_minimum_required(VERSION 3.25)\nproject(calc VERSION 1.4.0 LANGUAGES CXX)\noption(CALC_BUILD_TESTS "Build tests" ${PROJECT_IS_TOP_LEVEL})\nadd_subdirectory(src)\nadd_subdirectory(apps)\nif(CALC_BUILD_TESTS)\n  enable_testing()\n  add_subdirectory(tests)\nendif()' },
    'cmake/': { title: 'cmake/ helpers', text: 'Reusable functions, find modules and toolchain files, added via CMAKE_MODULE_PATH.', code: 'cmake/\n├── CompilerWarnings.cmake\n├── Sanitizers.cmake\n└── toolchains/rpi.cmake\n\nlist(APPEND CMAKE_MODULE_PATH ${PROJECT_SOURCE_DIR}/cmake)\ninclude(CompilerWarnings)' },
    'include/calc/': { title: 'Namespaced public headers', text: 'The extra calc/ level keeps includes unambiguous once installed next to other libraries.', code: 'include/calc/core.h\ninclude/calc/net.h\n\n#include <calc/core.h>' },
    'src/': { title: 'src/', text: 'Library sources and private headers, one CMakeLists.txt defining the library targets.', code: 'add_library(calc_core core.cpp parse.cpp)\nadd_library(calc::core ALIAS calc_core)\ntarget_include_directories(calc_core PUBLIC\n  $<BUILD_INTERFACE:${PROJECT_SOURCE_DIR}/include>)' },
    'apps/': { title: 'apps/', text: 'Thin executables that link the libraries. Logic lives in the libraries so it can be tested.', code: 'add_executable(calc-cli main.cpp)\ntarget_link_libraries(calc-cli PRIVATE calc::core)' },
    'tests/': { title: 'tests/', text: 'One test binary per library, registered with CTest.', code: 'add_executable(core_test core_test.cpp)\ntarget_link_libraries(core_test PRIVATE calc::core GTest::gtest_main)\ngtest_discover_tests(core_test)' },
    'third_party/': { title: 'third_party/', text: 'Vendored code or FetchContent declarations. Prefer a package manager for big dependencies.', code: 'FetchContent_Declare(json URL https://…/json.tar.xz\n  URL_HASH SHA256=…)\nFetchContent_MakeAvailable(json)' },
  },
});

const REAL = [
  N('top', 40, 60, 440, 120, 'CMakeLists.txt (top)', 'project, options'),
  N('cm', 520, 60, 440, 120, 'cmake/', 'modules, toolchains'),
  N('inc', 40, 230, 440, 120, 'include/calc/', 'public headers'),
  N('src', 520, 230, 440, 120, 'src/', 'library sources'),
  N('apps', 40, 400, 440, 120, 'apps/', 'executables'),
  N('tests', 520, 400, 440, 120, 'tests/', 'unit tests'),
  N('tp', 40, 570, 440, 120, 'third_party/', 'vendored / fetched'),
  N('pre', 520, 570, 440, 120, 'CMakePresets.json', 'shared setups'),
  N('bld', 40, 760, 920, 120, 'build/', 'never committed', { dashed: true }),
];

boardDemo('cmake-layout', 'Project layout & subdirectories', 'hello_cmake steps 5–6: include/ + src/, add_subdirectory and variable scope, and a real project tree.', {
  include: [
    'include/ + src/',
    {
      panel: 'Layout',
      code: ['add_library(greet STATIC src/greet.cpp)', 'target_include_directories(greet PUBLIC include)', 'add_executable(hello src/main.cpp)', 'target_link_libraries(hello PRIVATE greet)'],
      nodes: [N('inc', 40, 240, 440, 110, 'include/greet.h', 'public API'), N('src', 520, 240, 440, 110, 'src/greet.cpp', 'implementation'), N('lib', 40, 420, 440, 110, 'greet', 'library'), N('main', 520, 420, 440, 110, 'src/main.cpp'), N('flag', 40, 610, 920, 110, '-I include', 'PUBLIC include path'), N('exe', 360, 800, 280, 110, 'hello')],
      edges: ['src>lib', 'lib>flag', 'flag>exe'],
      beats: [
        { note: 'Step 5 moves the header to include/ and the sources to src/.', hot: { inc: 'current', src: 'current' }, hide: ['flag', 'exe'], rows: [['dirs', 'include/ src/']] },
        { note: 'Headers under include/ are the library’s public API; everything in src/ is private.', hot: { inc: 'ok', src: 'muted' }, hide: ['flag', 'exe'], rows: [['public', 'include/']] },
        { note: 'target_include_directories with PUBLIC adds -I include to greet and to everyone who links it.', hl: [1], hot: { flag: 'write', 'lib>flag': 'accent' }, hide: ['exe'], rows: [['greet gets', '-I include']] },
        { note: 'So main.cpp writes #include "greet.h" with no ../ paths, and hello gets the flag through the link.', hl: [2, 3], hot: { exe: 'ok', 'flag>exe': 'accent', main: 'ok' }, rows: [['hello gets', '-I include', 'ok']] },
        { note: 'Bigger projects add a level, include/greet/greet.h, so includes read <greet/greet.h> and never collide.', hot: { inc: 'current' }, sub: { inc: 'include/greet/greet.h' }, rows: [['include as', '<greet/greet.h>']] },
      ],
    },
  ],
  subdir: [
    'add_subdirectory',
    {
      panel: 'Subdirectories',
      code: ['# CMakeLists.txt', 'add_subdirectory(greet)', 'add_executable(hello main.cpp)', 'target_link_libraries(hello PRIVATE greet)', '# greet/CMakeLists.txt', 'add_library(greet STATIC src/greet.cpp)', 'target_include_directories(greet PUBLIC include)'],
      nodes: [N('top', 360, 340, 280, 110, 'CMakeLists.txt', 'top level'), N('child', 360, 510, 280, 110, 'greet/CMakeLists.txt'), N('tgt', 40, 690, 280, 110, 'greet', 'target'), N('exe', 680, 690, 280, 110, 'hello'), N('scope', 40, 860, 920, 110, 'variable scope', 'child copy of parent vars')],
      edges: ['top>child', 'child>tgt', 'top>exe', 'tgt>exe'],
      beats: [
        { note: 'add_subdirectory(greet) runs greet/CMakeLists.txt as a child, right at that line.', hl: [1], hot: { child: 'current', 'top>child': 'accent' }, hide: ['tgt', 'exe', 'scope'], rows: [['dirs processed', 2]] },
        { note: 'The child defines the greet target. Targets are global, so the parent can link it by name.', hl: [5, 6], hot: { tgt: 'write', 'child>tgt': 'accent' }, hide: ['exe', 'scope'], rows: [['targets', 'greet']] },
        { note: 'hello links greet exactly as if it were declared in the same file.', hl: [2, 3], hot: { exe: 'ok', 'tgt>exe': 'accent', 'top>exe': 'accent' }, hide: ['scope'], rows: [['targets', 'greet, hello']] },
        { note: 'Variables differ from targets: the child gets a copy, and its set() calls stay local.', hot: { scope: 'warn' }, sub: { scope: 'set(X 1 PARENT_SCOPE) to push up' }, rows: [['targets', 'global'], ['variables', 'per directory', 'warn']] },
        { note: 'Build output mirrors the source tree, so greet’s library lands in build/greet/.', hot: { tgt: 'ok' }, sub: { tgt: 'build/greet/libgreet.a' }, rows: [['output', 'build/greet/']] },
      ],
    },
  ],
  real: [
    'Real project tree',
    {
      panel: 'Layout',
      nodes: REAL,
      edges: [],
      beats: [
        { note: 'A real project separates public headers, sources, apps, tests and CMake helpers.', rows: [['top-level dirs', 7]] },
        { note: 'The top CMakeLists.txt sets the project and options, then calls add_subdirectory for each part.', hot: { top: 'current', src: 'write', apps: 'write', tests: 'write' }, rows: [['add_subdirectory', 3]] },
        { note: 'include/calc/ holds the public API under a project-named folder, so users write #include <calc/core.h>.', hot: { inc: 'current' }, rows: [['public headers', 'include/calc/']] },
        { note: 'Logic lives in libraries under src/, and apps/ stay thin, so tests/ can test the libraries directly.', hot: { src: 'ok', apps: 'current', tests: 'ok' }, rows: [['testable', 'libraries', 'ok']] },
        { note: 'Tests build only when this is the top-level project, so people who embed you skip them.', hot: { tests: 'warn', top: 'current' }, sub: { tests: 'if(PROJECT_IS_TOP_LEVEL)' }, rows: [['embedders build', 'libs only']] },
        { note: 'cmake/ keeps helper modules and toolchain files, and build/ stays out of git.', hot: { cm: 'current', bld: 'muted' }, rows: [['.gitignore', 'build*/']] },
      ],
    },
  ],
});

// ---------------- compile options, option() & configure_file, find_package(Threads) (hello_cmake 7, 9, 10) ----------------
Object.assign(DETAILS, {
  'cmake-options': {
    cxx_std_17: { title: 'Compile features', text: 'Ask for a language level; CMake picks the right flag per compiler. PUBLIC makes users compile at least that level too.', code: 'target_compile_features(core PUBLIC cxx_std_20)\n# gcc/clang: -std=gnu++20   MSVC: /std:c++20\nset(CMAKE_CXX_EXTENSIONS OFF)  # -std=c++20, no gnu' },
    '-Wall -Wextra': { title: 'Warnings', text: 'Warnings are cheap bug reports. Put them in a function so every target gets the same set.', code: 'function(set_warnings t)\n  target_compile_options(${t} PRIVATE\n    $<$<CXX_COMPILER_ID:MSVC>:/W4 /permissive->\n    $<$<NOT:$<CXX_COMPILER_ID:MSVC>>:\n      -Wall -Wextra -Wpedantic -Wshadow -Wconversion>)\nendfunction()' },
    MSVC: { title: 'MSVC flags', text: 'Different spelling for everything. Generator expressions keep one CMakeLists.txt for all compilers.', code: '/W4       ≈ -Wall -Wextra\n/WX       ≈ -Werror\n/std:c++17 ≈ -std=c++17' },
    warning: { title: 'A warning worth reading', text: 'The kind of bug -Wall catches.', code: 'main.cpp:4:7: warning: unused variable \'totl\'\n    int totl = 0;\n        ^\nmain.cpp:6:5: error: use of undeclared \'total\'' },
    ENABLE_GREETING: { title: 'option()', text: 'A cached ON/OFF switch with a help string. Users flip it with -D or in cmake-gui.', code: 'option(ENABLE_GREETING "Print a greeting" ON)\n\n$ cmake -B build -DENABLE_GREETING=OFF' },
    'config.h.in': { title: 'Template header', text: '@VAR@ is replaced by the variable value; #cmakedefine becomes #define or a commented #undef.', code: '#pragma once\n#define APP_VERSION "@PROJECT_VERSION@"\n#cmakedefine ENABLE_GREETING' },
    'build/config.h': { title: 'Generated header', text: 'Written into the build dir by configure_file, never committed.', code: '#pragma once\n#define APP_VERSION "1.2.0"\n#define ENABLE_GREETING' },
    'Threads::Threads': { title: 'Threads::Threads', text: 'Imported target for the platform thread library.', code: 'find_package(Threads REQUIRED)\ntarget_link_libraries(app PRIVATE Threads::Threads)\n\n#include <thread>\nstd::thread t([] { work(); });\nt.join();' },
    Linux: { title: 'Linux', text: 'glibc before 2.34 needed -pthread for std::thread; now it is built into libc, but the flag is still correct.', code: 'c++ -pthread main.cpp' },
  },
});

boardDemo('cmake-options', 'Compile options, option() & generated headers', 'hello_cmake steps 7, 9, 10: C++ standard and warnings per target, option() + configure_file, find_package(Threads).', {
  features: [
    'Standard & warnings',
    {
      panel: 'Flags',
      code: ['project(hello CXX)', 'add_executable(hello main.cpp)', 'target_compile_features(hello PRIVATE cxx_std_17)', 'target_compile_options(hello PRIVATE -Wall -Wextra)'],
      nodes: [N('std', 40, 240, 440, 120, 'cxx_std_17', '-std=gnu++17'), N('w', 520, 240, 440, 120, '-Wall -Wextra', 'this target only'), N('cmd', 40, 420, 920, 120, 'compile command', 'c++ -std=gnu++17 -Wall -Wextra -c main.cpp'), N('msvc', 40, 600, 920, 120, 'MSVC', '/std:c++17 /W4'), N('out', 40, 780, 920, 120, 'warning', 'unused variable \'totl\'')],
      edges: ['std>cmd', 'w>cmd'],
      beats: [
        { note: 'Compilers default to different C++ standards and print few warnings.', hl: [0, 1], hide: ['cmd', 'msvc', 'out'], rows: [['defaults', 'vary', 'warn']] },
        { note: 'target_compile_features with cxx_std_17 asks for at least C++17, and CMake picks the flag per compiler.', hl: [2], hot: { std: 'current', cmd: 'write', 'std>cmd': 'accent' }, hide: ['msvc', 'out'], rows: [['standard', 'C++17']] },
        { note: 'target_compile_options adds raw flags, here warnings, to this target only.', hl: [3], hot: { w: 'current', cmd: 'write', 'w>cmd': 'accent' }, hide: ['msvc', 'out'], rows: [['warnings', 'on']] },
        { note: 'Raw flags are compiler-specific: MSVC spells them /W4, so guard them with a generator expression.', hot: { msvc: 'warn' }, hide: ['out'], rows: [['portable', 'with genex', 'warn']] },
        { note: 'Warnings catch real bugs early; this one is a misspelled variable name.', hot: { out: 'warn' }, rows: [['found', '1 bug', 'ok']] },
      ],
    },
  ],
  option: [
    'option() + configure_file',
    {
      panel: 'Config',
      code: ['project(hello VERSION 1.2.0)', 'option(ENABLE_GREETING "Print a greeting" ON)', 'configure_file(config.h.in config.h)', 'target_include_directories(hello PRIVATE', '  ${CMAKE_CURRENT_BINARY_DIR})'],
      nodes: [N('opt', 40, 290, 440, 110, 'ENABLE_GREETING', 'ON'), N('tmpl', 520, 290, 440, 110, 'config.h.in', '@PROJECT_VERSION@'), N('gen', 280, 470, 440, 110, 'build/config.h', 'generated'), N('cpp', 280, 650, 440, 110, 'main.cpp', '#include "config.h"'), N('cli', 40, 840, 920, 110, 'cmake -B build -DENABLE_GREETING=OFF')],
      edges: ['opt>gen', 'tmpl>gen', 'gen>cpp'],
      beats: [
        { note: 'option() declares a user-facing ON/OFF switch, stored in the cache.', hl: [1], hot: { opt: 'current' }, hide: ['gen', 'cpp', 'cli'], rows: [['ENABLE_GREETING', 'ON']] },
        { note: 'config.h.in is a template with @VAR@ placeholders and #cmakedefine lines.', hot: { tmpl: 'current' }, hide: ['gen', 'cpp', 'cli'], rows: [['placeholders', 2]] },
        { note: 'configure_file fills it in at configure time and writes config.h into the build dir.', hl: [2], hot: { gen: 'write', 'opt>gen': 'accent', 'tmpl>gen': 'accent' }, hide: ['cpp', 'cli'], rows: [['APP_VERSION', '"1.2.0"']] },
        { note: 'The build dir goes on the include path, so main.cpp can include config.h like any header.', hl: [3, 4], hot: { cpp: 'ok', 'gen>cpp': 'accent' }, hide: ['cli'], rows: [['greeting', 'printed', 'ok']] },
        { note: 'Flip it with -DENABLE_GREETING=OFF: config.h is regenerated and main.cpp recompiles.', hot: { cli: 'current', opt: 'warn', gen: 'write', cpp: 'write' }, sub: { opt: 'OFF', gen: '/* #undef ENABLE_GREETING */' }, rows: [['ENABLE_GREETING', 'OFF', 'warn']] },
      ],
    },
  ],
  threads: [
    'find_package(Threads)',
    {
      panel: 'Threads',
      code: ['find_package(Threads REQUIRED)', 'add_executable(hello main.cpp)', 'target_link_libraries(hello PRIVATE Threads::Threads)'],
      nodes: [N('fp', 360, 200, 280, 110, 'find_package', 'Threads'), N('lin', 40, 380, 280, 110, 'Linux', '-pthread'), N('mac', 360, 380, 280, 110, 'macOS', 'in libSystem'), N('win', 680, 380, 280, 110, 'Windows', 'Win32 threads'), N('tgt', 360, 580, 280, 110, 'Threads::Threads'), N('exe', 360, 780, 280, 110, 'hello', 'uses std::thread')],
      edges: ['fp>lin', 'fp>mac', 'fp>win', 'lin>tgt', 'mac>tgt', 'win>tgt', 'tgt>exe'],
      beats: [
        { note: 'Step 9 uses std::thread, which on some platforms needs an extra flag or library.', hot: { exe: 'current' }, hide: ['fp', 'lin', 'mac', 'win', 'tgt'], rows: [['needs', 'threads']] },
        { note: 'find_package(Threads) checks what this platform needs.', hl: [0], hot: { fp: 'current', lin: 'write', mac: 'write', win: 'write' }, hide: ['tgt'], rows: [['platforms', 3]] },
        { note: 'The answer is wrapped in one imported target, Threads::Threads.', hot: { tgt: 'write', 'lin>tgt': 'accent', 'mac>tgt': 'accent', 'win>tgt': 'accent' }, rows: [['target', 'Threads::Threads']] },
        { note: 'Link the target, never a raw -lpthread, and the same CMakeLists.txt builds everywhere.', hl: [2], hot: { exe: 'ok', 'tgt>exe': 'accent' }, rows: [['portable', 'yes', 'ok']] },
      ],
    },
  ],
});

// ---------------- install & ctest (hello_cmake 11–12) ----------------
Object.assign(DETAILS, {
  'cmake-test-install': {
    'cmake --install': { title: 'cmake --install', text: 'Runs the install() rules. Set the prefix at install time or with CMAKE_INSTALL_PREFIX.', code: '$ cmake --install build --prefix ./out\n-- Installing: out/bin/hello\n-- Installing: out/share/hello/README.txt' },
    cpack: { title: 'CPack', text: 'Packages the install tree into archives or OS packages.', code: 'set(CPACK_GENERATOR "TGZ;DEB")\nset(CPACK_DEBIAN_PACKAGE_MAINTAINER "me")\ninclude(CPack)\n\n$ cpack --config build/CPackConfig.cmake' },
    'test.cpp': { title: 'A minimal test', text: 'Any program whose exit code says pass or fail.', code: '#include <cassert>\nint add(int a, int b) { return a + b; }\nint main() {\n  assert(add(2, 3) == 5);\n  return 0;\n}' },
    ctest: { title: 'ctest', text: 'Runs registered tests, in parallel with -j, filtered by name (-R) or label (-L).', code: '$ ctest --test-dir build -j8 --output-on-failure\n1/1 Test #1: hello_test ....   Passed  0.01 sec\n100% tests passed, 0 tests failed out of 1' },
    db_start: { title: 'Setup fixture', text: 'A test that prepares shared state for others.', code: 'set_tests_properties(db_start PROPERTIES\n  FIXTURES_SETUP db)' },
    db_query: { title: 'Test requiring a fixture', text: 'ctest adds db_start before and db_stop after, even when run alone.', code: '$ ctest -R db_query\n1/3 db_start  Passed\n2/3 db_query  Passed\n3/3 db_stop   Passed' },
    'ctest -L unit -j8': { title: 'Labels', text: 'Select tests by label; -LE excludes.', code: 'ctest -L unit -j8        # fast, every push\nctest -L integration     # nightly\nctest -LE slow           # all but slow' },
  },
});

boardDemo('cmake-test-install', 'Install rules & CTest', 'hello_cmake steps 11–12: install() and cmake --install, enable_testing/add_test, fixtures, labels, timeouts.', {
  install: [
    'install()',
    {
      panel: 'Install',
      code: ['add_executable(hello main.cpp)', 'install(TARGETS hello DESTINATION bin)', 'install(FILES README.txt DESTINATION share/hello)', '# cmake --install build --prefix ./out'],
      nodes: [N('exe', 40, 240, 440, 110, 'build/hello'), N('rd', 520, 240, 440, 110, 'README.txt'), N('inst', 280, 420, 440, 110, 'cmake --install'), N('ob', 40, 610, 440, 110, 'out/bin/hello'), N('os', 520, 610, 440, 110, 'out/share/hello/', 'README.txt'), N('pkg', 280, 800, 440, 110, 'cpack', '.tar.gz, .deb, .pkg')],
      edges: ['exe>inst', 'rd>inst', 'inst>ob', 'inst>os'],
      beats: [
        { note: 'Build outputs sit scattered inside build/. install() rules say what ships and where it goes.', hl: [1, 2], hot: { exe: 'current', rd: 'current' }, hide: ['inst', 'ob', 'os', 'pkg'], rows: [['rules', 2]] },
        { note: 'cmake --install copies them under a prefix, here ./out, in the standard bin/ and share/ layout.', hl: [3], hot: { inst: 'current', ob: 'write', os: 'write', 'inst>ob': 'accent', 'inst>os': 'accent' }, hide: ['pkg'], rows: [['prefix', './out']] },
        { note: 'Installing also rewrites RPATHs, so the installed binary finds installed libraries, not the build tree.', hot: { ob: 'ok' }, sub: { ob: 'RUNPATH $ORIGIN/../lib' }, hide: ['pkg'], rows: [['RPATH', 'rewritten', 'ok']] },
        { note: 'CPack turns the same install rules into archives and OS packages.', hot: { pkg: 'ok' }, rows: [['packages', 'tgz, deb, pkg']] },
      ],
    },
  ],
  ctest: [
    'enable_testing + add_test',
    {
      panel: 'CTest',
      code: ['add_executable(hello_test test.cpp)', 'enable_testing()', 'add_test(NAME hello_test COMMAND hello_test)', '# ctest --test-dir build --output-on-failure'],
      nodes: [N('t', 40, 240, 440, 110, 'test.cpp', 'assert(add(2,3) == 5)'), N('tb', 520, 240, 440, 110, 'hello_test', 'executable'), N('ct', 280, 420, 440, 110, 'ctest'), N('pass', 40, 610, 440, 110, 'exit code 0', 'Passed'), N('fail', 520, 610, 440, 110, 'exit code ≠ 0', 'Failed'), N('out', 40, 800, 920, 110, '100% tests passed', '0 failed out of 1')],
      edges: ['t>tb', 'tb>ct', 'ct>pass', 'ct>fail'],
      beats: [
        { note: 'Step 12 builds a test as a plain executable.', hl: [0], hot: { tb: 'write', 't>tb': 'accent' }, hide: ['ct', 'pass', 'fail', 'out'], rows: [['tests', 1]] },
        { note: 'enable_testing() turns on CTest, and add_test() registers a command for it to run.', hl: [1, 2], hot: { ct: 'current', 'tb>ct': 'accent' }, hide: ['pass', 'fail', 'out'], rows: [['registered', 'hello_test']] },
        { note: 'Exit code 0 means pass; any other code, or a crash, means fail.', hot: { pass: 'ok', fail: 'fail' }, hide: ['out'], rows: [['rule', 'exit code']] },
        { note: '--output-on-failure prints a failing test’s output, and -j runs tests in parallel.', hl: [3], hot: { out: 'ok', pass: 'ok' }, rows: [['result', '1 / 1 passed', 'ok']] },
      ],
    },
  ],
  fixtures: [
    'Fixtures, labels, timeouts',
    {
      panel: 'CTest',
      code: ['add_test(NAME db_start COMMAND start_db.sh)', 'add_test(NAME db_query COMMAND query_test)', 'add_test(NAME db_stop COMMAND stop_db.sh)', 'set_tests_properties(db_start PROPERTIES FIXTURES_SETUP db)', 'set_tests_properties(db_query PROPERTIES', '  FIXTURES_REQUIRED db LABELS integration TIMEOUT 30)', 'set_tests_properties(db_stop PROPERTIES FIXTURES_CLEANUP db)'],
      nodes: [N('s', 40, 340, 290, 110, 'db_start', 'setup'), N('q', 355, 340, 290, 110, 'db_query', 'needs db'), N('e', 670, 340, 290, 110, 'db_stop', 'cleanup'), N('u', 40, 540, 440, 110, 'unit tests', 'LABELS unit'), N('i', 520, 540, 440, 110, 'integration', 'LABELS integration'), N('cmd', 40, 740, 920, 110, 'ctest -L unit -j8')],
      edges: ['s>q', 'q>e'],
      beats: [
        { note: 'Real suites need setup, like starting a database before tests and stopping it after.', hl: [0, 1, 2], hide: ['u', 'i', 'cmd'], rows: [['tests', 3]] },
        { note: 'Fixtures order it: db_start runs before any test that requires db, and db_stop after.', hl: [3, 4, 5, 6], hot: { s: 'current', e: 'current', q: 'write', 's>q': 'accent', 'q>e': 'accent' }, hide: ['u', 'i', 'cmd'], rows: [['order', 'start → query → stop']] },
        { note: 'Running only db_query still pulls in its setup and cleanup.', hot: { q: 'ok', s: 'ok', e: 'ok' }, hide: ['u', 'i', 'cmd'], rows: [['ctest -R db_query', '3 run', 'ok']] },
        { note: 'Labels group tests, so CI runs fast unit tests on every push and integration tests less often.', hl: [5], hot: { u: 'current', i: 'current', cmd: 'current' }, rows: [['labels', 'unit, integration']] },
        { note: 'TIMEOUT kills a hung test instead of hanging the whole CI job.', hl: [5], hot: { q: 'warn' }, sub: { q: 'killed after 30 s' }, rows: [['timeout', '30 s', 'warn']] },
      ],
    },
  ],
});

// ---------------- advanced generator expressions & codegen (hello_cmake 14–15) ----------------
Object.assign(DETAILS, {
  'cmake-advanced': {
    'in-tree build': { title: 'BUILD_INTERFACE', text: 'Used while building this project and by projects that add_subdirectory it.', code: '$<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>\n→ -I/home/me/greet/include' },
    'installed package': { title: 'INSTALL_INTERFACE', text: 'Written into the exported targets file, relative to wherever the package is installed.', code: '# greetTargets.cmake (generated)\nINTERFACE_INCLUDE_DIRECTORIES "${_IMPORT_PREFIX}/include"' },
    'without genex': { title: 'The error you get', text: 'CMake stops an export that would leak an absolute source path.', code: 'CMake Error: Target "greet" INTERFACE_INCLUDE_DIRECTORIES\nproperty contains path "/home/me/greet/include"\nwhich is prefixed in the source directory.' },
    'custom command': { title: 'add_custom_command', text: 'A build rule: OUTPUT files, the COMMAND that makes them, and what they DEPEND on.', code: 'add_custom_command(\n  OUTPUT ${CMAKE_CURRENT_BINARY_DIR}/msg.pb.cc\n  COMMAND protobuf::protoc --cpp_out=. msg.proto\n  DEPENDS msg.proto)' },
    'build_info.h': { title: 'Generated header', text: 'Produced at build time in the build dir.', code: '#pragma once\n#define BUILD_INFO "generated by CMake"' },
    'gen_info.cmake': { title: 'CMake script', text: 'Run with cmake -P, so codegen works the same on every OS without shell quoting.', code: 'file(WRITE ${CMAKE_ARGV3}\n  "#pragma once\\n#define BUILD_INFO \\"generated by CMake\\"\\n")' },
    gen_info: { title: 'add_custom_target', text: 'A named target with no output file of its own; always considered out of date, so keep it cheap.', code: 'add_custom_target(gen_info DEPENDS build_info.h)\nadd_dependencies(hello gen_info)\n\n$ cmake --build build --target gen_info' },
  },
});

boardDemo('cmake-advanced', 'Generator expressions & code generation', 'hello_cmake steps 14–15: BUILD_INTERFACE / INSTALL_INTERFACE, $<TARGET_FILE>, POST_BUILD, add_custom_command / add_custom_target.', {
  iface: [
    'BUILD / INSTALL_INTERFACE',
    {
      panel: 'Genex',
      code: ['target_include_directories(greet PUBLIC', '  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>', '  $<INSTALL_INTERFACE:include>)'],
      nodes: [N('tree', 40, 220, 440, 120, 'in-tree build', '/home/me/greet/include'), N('inst', 520, 220, 440, 120, 'installed package', '<prefix>/include'), N('a1', 40, 420, 440, 110, 'hello', 'same repo'), N('a2', 520, 420, 440, 110, 'other project', 'find_package(greet)'), N('err', 40, 640, 920, 120, 'without genex', 'absolute path baked into export')],
      edges: ['tree>a1', 'inst>a2'],
      beats: [
        { note: 'A PUBLIC include path must mean different things before and after install.', hl: [0], hide: ['err'], rows: [['contexts', 2]] },
        { note: 'BUILD_INTERFACE applies while building inside this tree, as an absolute source path.', hl: [1], hot: { tree: 'current', a1: 'ok', 'tree>a1': 'accent' }, hide: ['err'], rows: [['in tree', 'source path']] },
        { note: 'INSTALL_INTERFACE applies to installed consumers, relative to their install prefix.', hl: [2], hot: { inst: 'current', a2: 'ok', 'inst>a2': 'accent' }, hide: ['err'], rows: [['installed', 'prefix/include']] },
        { note: 'Without them, install(EXPORT) refuses, because a source path can’t ship to other machines.', hot: { err: 'fail' }, rows: [['export', 'error', 'fail']] },
      ],
    },
  ],
  targetfile: [
    '$<TARGET_FILE> & POST_BUILD',
    {
      panel: 'Genex',
      code: ['add_custom_command(TARGET hello POST_BUILD', '  COMMAND ${CMAKE_COMMAND} -E echo', '          "Built: $<TARGET_FILE:hello>")', 'target_compile_definitions(hello PRIVATE', '  $<$<CONFIG:Debug>:VERBOSE_LOGGING>)'],
      nodes: [N('ev', 40, 290, 440, 110, 'configure time', 'path unknown'), N('gt', 520, 290, 440, 110, 'generate time', 'genex resolved'), N('lin', 40, 460, 920, 110, 'Ninja', 'build/hello'), N('xc', 40, 620, 920, 110, 'Xcode', 'build/Debug/hello'), N('out', 40, 800, 920, 110, 'Built: /src/build/hello', 'printed after link')],
      edges: ['ev>gt'],
      beats: [
        { note: 'A target’s output path depends on generator and config, so it isn’t known while CMakeLists.txt runs.', hot: { ev: 'warn' }, hide: ['lin', 'xc', 'out'], rows: [['path', 'unknown', 'warn']] },
        { note: '$<TARGET_FILE:hello> resolves later, per config, to the real file path.', hl: [2], hot: { gt: 'current', lin: 'write', xc: 'write', 'ev>gt': 'accent' }, hide: ['out'], rows: [['path', 'per generator']] },
        { note: 'POST_BUILD commands run right after hello links, with the path filled in.', hl: [0, 1, 2], hot: { out: 'ok' }, rows: [['runs', 'after link', 'ok']] },
        { note: 'The same mechanism makes config-specific macros: VERBOSE_LOGGING exists only in Debug builds.', hl: [3, 4], hot: { xc: 'current' }, rows: [['Debug defines', 'VERBOSE_LOGGING']] },
      ],
    },
  ],
  codegen: [
    'Code generation',
    {
      panel: 'Codegen',
      code: ['add_custom_command(', '  OUTPUT ${CMAKE_CURRENT_BINARY_DIR}/build_info.h', '  COMMAND ${CMAKE_COMMAND} -P gen_info.cmake build_info.h', '  DEPENDS gen_info.cmake)', 'add_custom_target(gen_info DEPENDS build_info.h)', 'add_dependencies(hello gen_info)'],
      nodes: [N('script', 40, 300, 290, 110, 'gen_info.cmake'), N('cmd', 355, 300, 290, 110, 'custom command'), N('hdr', 670, 300, 290, 110, 'build_info.h', 'generated'), N('tgt', 355, 490, 290, 110, 'gen_info', 'custom target'), N('exe', 355, 680, 290, 110, 'hello'), N('proto', 40, 860, 920, 110, 'same pattern', 'protobuf, flatbuffers, Qt moc')],
      edges: ['script>cmd', 'cmd>hdr', 'hdr>tgt', 'tgt>exe'],
      beats: [
        { note: 'Step 15 generates a header at build time instead of committing it.', hot: { hdr: 'current' }, hide: ['tgt', 'exe', 'proto'], rows: [['generated files', 1]] },
        { note: 'add_custom_command says which OUTPUT a COMMAND produces and what it DEPENDS on.', hl: [0, 1, 2, 3], hot: { cmd: 'current', hdr: 'write', 'script>cmd': 'accent', 'cmd>hdr': 'accent' }, hide: ['tgt', 'exe', 'proto'], rows: [['rule', 'OUTPUT ← COMMAND']] },
        { note: 'It reruns only when a dependency changes, like any other build rule.', hot: { script: 'warn', cmd: 'current' }, sub: { script: 'edited → rerun' }, hide: ['tgt', 'exe', 'proto'], rows: [['reruns', 'on change']] },
        { note: 'add_custom_target names the step, and add_dependencies makes hello wait for it.', hl: [4, 5], hot: { tgt: 'write', exe: 'ok', 'hdr>tgt': 'accent', 'tgt>exe': 'accent' }, hide: ['proto'], rows: [['order', 'gen_info → hello']] },
        { note: 'Protobuf, gRPC and Qt use exactly this to turn schema and UI files into C++.', hot: { proto: 'current' }, rows: [['used by', 'protoc, moc, flatc']] },
      ],
    },
  ],
});

// ---------------- toolchains & debugging CMake ----------------
Object.assign(DETAILS, {
  'cmake-toolchain': {
    'toolchain file': { title: 'Toolchain file', text: 'Read before project(), so compiler detection already targets the other machine.', code: 'set(CMAKE_SYSTEM_NAME Linux)\nset(CMAKE_SYSTEM_PROCESSOR aarch64)\nset(CMAKE_CXX_COMPILER aarch64-linux-gnu-g++)\nset(CMAKE_SYSROOT /opt/sysroots/rpi)\nset(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)\nset(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)' },
    sysroot: { title: 'Sysroot', text: 'A copy of the target root filesystem: its headers and libraries.', code: '/opt/sysroots/rpi/\n├── usr/include/\n└── usr/lib/aarch64-linux-gnu/libssl.so' },
    hello: { title: 'Cross-built binary', text: 'Runs on the target only.', code: '$ file build-rpi/hello\nELF 64-bit LSB executable, ARM aarch64\n$ ./build-rpi/hello\nexec format error' },
    'host tools': { title: 'Host tools', text: 'Build generators like protoc for the host first, then point the cross build at them.', code: 'cmake -B build-host && cmake --build build-host\ncmake -B build-rpi --toolchain rpi.cmake \\\n  -DProtobuf_PROTOC_EXECUTABLE=build-host/protoc' },
    '--trace-expand': { title: '--trace-expand', text: 'Prints every command with variables expanded. Filter to your file with --trace-source.', code: '/src/CMakeLists.txt(12):  target_link_libraries(app PRIVATE net )\n/src/CMakeLists.txt(13):  if(ON )' },
    '--graphviz': { title: 'Dependency graph', text: 'Writes the target graph as a dot file.', code: '$ cmake -B build --graphviz=deps.dot\n$ dot -Tpng deps.dot -o deps.png\n\ndigraph "calc" {\n  "app" -> "net"\n  "net" -> "core"\n  "core" -> "fmt::fmt"\n}' },
    'build -v': { title: 'Verbose build', text: 'Shows exact compiler and linker command lines.', code: '$ cmake --build build -v\n[1/3] c++ -I/src/core/include -O2 -std=c++20 \\\n      -c /src/core/core.cpp -o core.o' },
    cmake_print_properties: { title: 'Inspect a target', text: 'Prints properties a target carries, including inherited ones.', code: 'include(CMakePrintHelpers)\ncmake_print_properties(TARGETS net PROPERTIES\n  INTERFACE_INCLUDE_DIRECTORIES\n  INTERFACE_LINK_LIBRARIES)' },
  },
});

boardDemo('cmake-toolchain', 'Cross-compiling & debugging CMake', 'Toolchain files and sysroots for other targets; --trace-expand, --graphviz, verbose builds and inspecting targets.', {
  cross: [
    'Cross-compiling',
    {
      panel: 'Toolchain',
      codeTitle: 'toolchains/rpi.cmake',
      code: ['set(CMAKE_SYSTEM_NAME Linux)', 'set(CMAKE_SYSTEM_PROCESSOR aarch64)', 'set(CMAKE_CXX_COMPILER aarch64-linux-gnu-g++)', 'set(CMAKE_SYSROOT /opt/sysroots/rpi)', 'set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)', '# cmake -B build-rpi --toolchain toolchains/rpi.cmake'],
      nodes: [N('host', 40, 320, 290, 110, 'build host', 'x86-64 macOS'), N('tc', 355, 320, 290, 110, 'toolchain file'), N('target', 670, 320, 290, 110, 'target', 'aarch64 Linux'), N('sr', 355, 500, 290, 110, 'sysroot', 'target libs'), N('bin', 355, 680, 290, 110, 'hello', 'ELF aarch64'), N('gen', 40, 860, 920, 110, 'host tools', 'generators built for host')],
      edges: ['host>tc', 'tc>target', 'tc>sr', 'sr>bin'],
      beats: [
        { note: 'Cross-compiling means building on one machine for another, like a Raspberry Pi from a laptop.', hot: { host: 'current', target: 'current' }, hide: ['sr', 'bin', 'gen'], rows: [['host', 'x86-64'], ['target', 'aarch64']] },
        { note: 'A toolchain file names the target system and its compiler before project() runs.', hl: [0, 1, 2], hot: { tc: 'current', 'host>tc': 'accent', 'tc>target': 'accent' }, hide: ['sr', 'bin', 'gen'], rows: [['compiler', 'aarch64-linux-gnu-g++']] },
        { note: 'The sysroot supplies the target’s headers and libraries, so find_package finds ARM libraries, not the host’s.', hl: [3, 4], hot: { sr: 'current', 'tc>sr': 'accent' }, hide: ['bin', 'gen'], rows: [['libraries from', 'sysroot']] },
        { note: 'The result runs on the target, not on the machine that built it.', hot: { bin: 'ok', 'sr>bin': 'accent' }, hide: ['gen'], rows: [['runs on', 'target', 'ok']] },
        { note: 'Tools that run during the build, like code generators, must be built for the host in a separate build.', hot: { gen: 'warn' }, rows: [['builds', 'host + target', 'warn']] },
      ],
    },
  ],
  debug: [
    'Debugging CMake',
    {
      panel: 'Debug',
      codeTitle: 'terminal',
      code: ['cmake -B build --log-level=DEBUG', 'cmake -B build --trace-expand --trace-source=CMakeLists.txt', 'cmake -B build --graphviz=deps.dot', 'cmake --build build -v'],
      nodes: [N('m', 40, 260, 440, 110, 'message(DEBUG)', 'your variables'), N('tr', 520, 260, 440, 110, '--trace-expand', 'every command'), N('gv', 40, 430, 440, 110, '--graphviz', 'target graph'), N('v', 520, 430, 440, 110, 'build -v', 'real commands'), N('pp', 40, 600, 920, 110, 'cmake_print_properties', 'what a target carries'), N('q', 40, 790, 920, 120, 'usual culprits', 'scope · stale cache · PRIVATE')],
      edges: [],
      beats: [
        { note: 'When CMake does something surprising, make it show its work.', hide: ['pp', 'q'], rows: [['tools', 4]] },
        { note: 'message(DEBUG) with --log-level prints your own variables, and --trace-expand prints every command as it runs.', hl: [0, 1], hot: { m: 'current', tr: 'current' }, hide: ['pp', 'q'], rows: [['configure', 'traced']] },
        { note: '--graphviz writes the target dependency graph, which dot renders as a picture.', hl: [2], hot: { gv: 'current' }, hide: ['pp', 'q'], rows: [['graph', 'deps.dot']] },
        { note: 'build -v shows the exact compiler command lines, the ground truth for flags.', hl: [3], hot: { v: 'current', pp: 'write' }, hide: ['q'], rows: [['flags', 'visible']] },
        { note: 'Most surprises are a variable in the wrong scope, a stale cache value, or a PRIVATE that should be PUBLIC.', hot: { q: 'warn' }, rows: [['fix', 'check these first', 'warn']] },
      ],
    },
  ],
});
