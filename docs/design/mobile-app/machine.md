# Machine level — CPU, memory, buses, paging

The layer under every box: what one host actually does. Same zoom as
composites (`technologies.md`): **system → service ⤢ → host ⤢ → chip**.
The latency numbers a service uses (cache hit, RAM, SSD, NIC) come from
here, so the levels explain each other.

Engine: **step models**, not request DES — `engine/src/machine/<model>.ts`
as frame generators (same protocol as `algorithms.md`), cycle/ns-accurate
at teaching fidelity. Content: `content/machine/<slug>.yaml`.

## Host view (drill-in from any compute/data node)

```
 ┌ host: api-3 ─────────────────────────────────────────┐
 │  ┌ CPU socket 0 ───────────────┐   ┌ DRAM ────────┐  │
 │  │ core0  core1  core2  core3  │   │ DIMM 0  1    │  │
 │  │ L1 L2  L1 L2  L1 L2  L1 L2  │   │ 64 GB        │  │
 │  │ ────── L3 (shared) ──────── │   └──────┬───────┘  │
 │  │ memory controller · IOMMU   │══════════╛ mem bus  │
 │  └─────────────┬───────────────┘                     │
 │                │ PCIe root complex                   │
 │        ┌───────┼──────────┐                          │
 │      NVMe SSD  NIC 25G   GPU                         │
 └──────────────────────────────────────────────────────┘
 live: per-core util, run queue, cache miss %, page faults/s, IO wait
```

Service behaviour maps onto it: threads → cores, heap → RAM pages, DB
reads → page cache / NVMe, requests → NIC interrupts. "CPU hog" or "memory
leak" chaos is visible here as run-queue growth or page-fault storms.

## Models (v1)

### CPU
- **Pipeline** — 5-stage fetch/decode/execute/mem/writeback; hazards,
  stalls, forwarding; branch misprediction flush
- **Caches** — L1/L2/L3 hit/miss walk, cache lines (64B), associativity,
  eviction; array row-vs-column traversal (the classic 10× demo)
- **Cache coherence** — MESI states across cores; false sharing
  ping-pong on one line
- **Multicore scheduling** — run queue, time slices, context switch cost,
  thread oversubscription, lock contention / spinlock vs mutex
- **Interrupts & syscalls** — user → kernel mode, interrupt handling, NIC
  softirq, why syscalls cost
- **SIMD / out-of-order** (overview) — why "one instruction per cycle" is
  wrong

### Memory
- **Hierarchy** — register → L1 → L2 → L3 → DRAM → SSD → network, with
  latencies scaled to human time (1ns = 1s: RAM ≈ 1.5 min, SSD ≈ 1 day,
  cross-region ≈ 5 years)
- **Virtual memory & paging** — virtual address split (page number |
  offset), 4-level page table walk, TLB hit/miss, page fault → OS loads
  page, dirty bit, huge pages
- **Page replacement** — FIFO / LRU / Clock on a frame table; thrashing
  when working set > RAM; swap
- **Page cache** — file reads cached in RAM; `fsync`; why DB buffer pools
  exist; mmap
- **Allocation & GC** — stack vs heap, malloc arenas, fragmentation;
  generational GC pause (links to "GC pause" chaos)
- **NUMA** — local vs remote node memory, cross-socket penalty

### Chips & buses
- **Bus cycle** — address bus, data bus, control lines; one read
  transaction step by step (address out → decode → data back → ack)
- **DRAM internals** — banks, rows, columns; RAS/CAS; row buffer hit vs
  miss; refresh
- **Interconnects** — PCIe lanes & packets, memory channels, QPI/UPI /
  Infinity Fabric between sockets; bandwidth vs latency
- **DMA** — NIC/SSD writes straight to RAM, CPU notified by interrupt;
  zero-copy
- **Storage devices** — SSD (flash pages/blocks, FTL, write
  amplification, GC) vs HDD (seek + rotation)
- **Networking on the wire** — NIC ring buffers → kernel → socket buffer
  → app; where latency hides

### Languages (progressive tracks)
Each language is a topic; lessons go fundamentals → advanced, each
opening one demo whose steps switch its inputs (`step.input`).
Engine: `engine/src/machine/{asm,cpp}.ts`; `lib/x86.ts` is a small
x86-64 interpreter (Intel syntax, integer subset, flags, stack) so asm
demos step real code; `lib/code.ts` maps source lines ↔ compiler output.

- **Assembly** (`machine-asm`, x86-64 primary, ARM64 noted) — registers
  & mov · flags · addressing · branches · loops & arrays · stack &
  call/ret · calling convention & frames · SIMD · reading compiler
  output. Demos: `asm-registers`, `asm-memory`, `asm-branches`,
  `asm-stack` (code + registers + flags + memory/stack, stepped per
  instruction), `asm-simd` (scalar/SSE/AVX lanes), `asm-compiler`
  (C → -O0/-O2/ARM64).
- **C++** (`machine-cpp`) — compile & link · layout & padding · pointers
  · stack/heap lifetime · RAII · copy vs move · templates & zero-cost ·
  vector & cache · vtables · atomics & memory model · UB. Demos:
  `cpp-build` (TU → .o symbols → link errors), `cpp-layout` (byte grid),
  `cpp-memory` / `cpp-raii` / `cpp-move` (frames + heap blocks, pointers
  as arrows), `cpp-vector` (growth, invalidation, vector vs list lines),
  `cpp-vtable`, `cpp-atomics` (race / lock xadd + MESI / release-acquire),
  `cpp-codegen` (templates, range-for, UB → asm).

## UI

Reuses the algorithm player chrome (playback bar, narration, step back) —
see `uiux/tech.md → Machine`. Two view kinds: **host view** (live, driven
by the running system) and **model view** (stepped, standalone demo).

## In the Learn track

Topic group **Machine level**: CPU · Memory · Paging · Chips & buses ·
Storage devices · Host networking · Assembly · C++. Algo lessons open the
player with a lesson card on top (step title/body/watch, Next/Finish,
marks progress); a step's `input` switches the demo preset. "Bridge" lessons connect up:
- "Why is my p99 bad?" → service node → host → GC pause / page faults
- "Why is Redis fast?" → RAM vs SSD on the hierarchy scale
- "Why does Kafka love sequential IO?" → page cache + disk model
