# C++ section

Learn tab group `cpp` (title "C++"): ten topics, beginner → project scale.
Goal: enough depth to run real, complex C++ codebases. Source ideas:
`~/workspace/cpp-references` (lessons, language_features, design_patterns,
hello_cmake, hello_webserver, c10k-challenge).

| # | Topic id | Title | Engine file |
|---|----------|-------|-------------|
| 1 | `cpp-basics` | Basics | `engine/src/cpp/basics.ts` |
| 2 | `machine-cpp` | C++ under the hood | `engine/src/machine/cpp.ts` |
| 3 | `cpp-oop` | Classes & OOP | `oop.ts` |
| 4 | `cpp-stl` | STL | `stl.ts` |
| 5 | `cpp-modern` | Modern C++ | `modern.ts` |
| 6 | `cpp-concurrency` | Concurrency | `concurrency.ts` |
| 7 | `cpp-cmake` | CMake | `cmake.ts` |
| 8 | `cpp-projects` | Large C++ projects | `projects.ts` |
| 9 | `cpp-patterns` | Design patterns & idioms | `patterns.ts` |
| 10 | `cpp-network` | Network servers → C10K | `network.ts` |

- Demo group = topic id (`machine-cpp` keeps its own); Algorithms tab
  shows them under the C++ segment.
- Every lesson opens one demo; steps switch its presets (`step.input`).
- Drawing helpers (`engine/src/machine/lib/`): `trace.ts` (code + stack +
  heap + output), `board.ts` (box/arrow scenes, `boardDemo`, `N`),
  `code.ts` (source ↔ asm).
- Tap-to-explain: boxes carry `detail` { title, text, code }. Set on
  board nodes, trace vars/blocks, or `machineDemo({ details })` keyed by
  box label.
- Tests: `engine/test/cpp.test.ts` (all `cpp-*` demos: frames, bounds,
  ≤ 2-sentence notes, detail shape); lesson → demo/input references in
  `machine.test.ts`.
