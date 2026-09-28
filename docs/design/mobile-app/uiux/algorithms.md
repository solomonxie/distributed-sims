# Algorithm visualizer

Algos tab → list → player. Spec: `../algorithms.md`.

## List — `AlgorithmsScreen`

```
 Algorithms
 ────────────────────────────────────────
 🔍 Search
 GRAPH
 ╭──────────────────────────────────────╮
 │ Dijkstra shortest path             › │
 │ A* search                          › │
 │ BFS / DFS                          › │
 │ Contraction hierarchies            › │
 │ Topological sort                   › │
 ╰──────────────────────────────────────╯
 PARTITIONING
 Consistent hashing · Rendezvous       ›
 GEO · PROBABILISTIC · STORAGE · DISTRIBUTED · RATE LIMIT
 …
```

## Player — `AlgorithmPlayerScreen` (Dijkstra)

```
 ‹ Algos     Dijkstra        ⓘ  ✎
 ────────────────────────────────────────
         4          (B)──── 3 ────(E)
   (A)━━━━━━━━━━(C)   ╲            │
  src 0    ╲      2    ╲ 1         │ 2
            ╲ 7         ╲          │
             (D)───── 1 ─(F)─────(T)
              7           5      dst ∞
 ━ settled path   ─ unvisited   ◉ current
 A=0 · C=4 ◉ · B=∞ · D=7 · F=∞ · E=∞ · T=∞
 ────────────────────────────────────────
 Step 3 / 14
 Pop C (dist 4). Relax C→B: 4+2=6 < ∞,
 so B = 6. Relax C→F: 4+1=5, F = 5.
 ────────────────────────────────────────
 PRIORITY QUEUE   F:5  B:6  D:7
 ────────────────────────────────────────
  ⏮    ‹    ▶    ›    ×1 ⌄
```

- `✎` = edit mode: tap empty = add node, drag node→node = edge, tap edge =
  weight stepper, long-press node = set source / target / delete.
- Input presets (menu on title): Small graph · City grid · Negative edge
  (shows why Dijkstra fails → link to Bellman-Ford).

- Tap-to-explain: a box with a `detail` (title, text, sample code) shows a
  small accent `i` in its corner; tapping it pauses playback and opens a
  bottom sheet. Caption under the note: "Tap a box marked i for details
  and sample code." Hit-test = topmost detail box under the tap.

```
 ╭ main.cpp — a source file        ✕ ╮
 │ Plain text you write. The compiler │
 │ reads it plus every header …       │
 │ ┌────────────────────────────────┐ │
 │ │ #include "math.h"              │ │
 │ │ int main() { … square(3) … }   │ │
 │ └────────────────────────────────┘ │
```

- List has three segments: Algorithms · Machine · C++ (`cpp-*` groups and
  `machine-cpp`).

States:
```
done       T reached: path lit, "Shortest A→T = 10 via C, F"
no path    "T is unreachable from A" — unreachable nodes greyed
edit       playback bar replaced by ( Reset ) [[ Done ]]
```

## Other primitives, same player chrome

```
 ring (consistent hashing)            bit array (Bloom filter)
        n1                            k=3  m=16  n=5  FP≈4.2%
     ●───────●  n2                    ┌┬┬┬┬┬┬┬┬┬┬┬┬┬┬┬┐
   ●    k7◦    ●                      │1│0│1│1│0│0│1│0│1│0│0│1│0│1│0│0│
  n4  ◦k3       ●  n2'  ← vnode      └┴┴┴┴┴┴┴┴┴┴┴┴┴┴┴┘
   ●          ●                       add "cat" → h1=0 h2=3 h6 lit
     ●───────●  n3                    query "dog" → 1,1,1 → maybe ⚠ FP
 [ + Add node ]  moved keys: 12 / 100
```
