# Design — Distributed Sims (iOS)

## Problem

Distributed-systems behaviour — cascades, split brain, stale reads, retry storms,
hot shards — is learned from prose and static diagrams. Nobody gets to *poke* a
system: drop a partition between two Raft nodes, fire a 20× burst at a
rate-limited gateway, kill a 2PC coordinator mid-commit, and watch what
happens. Whiteboard tools draw boxes that don't behave; real chaos tooling
needs real infra.

The v0 web canvas (`deprecated/`) proved the idea but was desktop-only and
stopped at load/latency propagation. This rescope makes it a phone/tablet app
covering patterns and protocols, not just throughput.

## Goals

- Drag-drop real cloud components onto a canvas, wire them, run it.
- Fire traffic (steady, ramp, burst, diurnal, hot key, per-tenant) and
  individual messages; watch them flow, animated.
- Inject destructive events any time: kill, partition, slow, lose packets,
  skew clocks, fill disks, drop a region, flush a cache, poison a queue.
- Model **patterns**, not just boxes: sharding, replication + consistency
  levels, consensus, distributed transactions, rate limiting, caching
  strategies, queues/streams, auth, encryption, proximity, search,
  observability, migration.
- Model **paradigms/architectures**: monolith, layered, microservices,
  API gateway, load balancer, BFF, service mesh, event-driven, CQRS,
  event sourcing, DDD (bounded contexts), multi-tenant, serverless, cell-based.
- **Learn** track: one topic → short lessons, each a preset system + scenario
  + "what to watch".
- **Problems** track: real system-design problems (TinyURL, YouTube, Google
  Maps, WhatsApp, KV store…) as presets with requirements, reference designs
  and pass/fail challenges.
- **Under the hood**: how real systems work inside — Kafka, Spark,
  Airflow, Celery, Temporal, Redis, nginx (why they're fast) (then Flink, RabbitMQ, Redis Cluster,
  Cassandra, Elasticsearch, Kubernetes, Postgres…). Each is a composite
  node you can drill into and break at the internals level.
- **Machine level**: CPU (pipeline, caches, coherence, scheduling),
  memory (hierarchy, virtual memory, paging, TLB, page cache, NUMA),
  chips & buses (bus cycles, DRAM, PCIe, DMA), storage devices. Reached
  by zooming system → service → host → chip.
- **Every example is illustrated**: animated + interactive in the app's
  own canvas/players, never text-only (`technologies.md → Illustration rule`).
- **Algorithm visualizer**: step-through animations of the algorithms these
  systems rely on (Dijkstra/A*, consistent hashing, geohash/quadtree, Bloom
  filter, Merkle tree, gossip, token bucket…).
- iOS first (iPhone, then iPad layout). Runs fully offline, on device.

## Non-goals

- Real infra: no deploying, no real network calls, no cloud account linking.
- Byte-accurate emulation of any product. Postgres ≠ its wire protocol here;
  it's a relational-db behaviour with Postgres defaults and icon.
- Freeform drawing. Only catalog components and containers.
- Android in v1 (RN keeps it cheap later; not designed or tested now).
- Accounts, backend, multiplayer, cloud sync in v1.
- Cost estimation beyond a rough $/month badge (was a v0 feature; demoted).
- Expo in any form — no Expo Go, no EAS, no `expo-*` modules.

## Options considered

| Option | Deciding factor |
|---|---|
| Keep the web app, add PWA | Touch drag-drop + 60fps particles on mobile Safari are poor; not an app |
| Swift / SwiftUI native | Best iOS feel, but no Android path; engine would need rewrite for web later |
| **React Native (bare CLI) + Skia** | One TS engine for app, tests, and a future web build; Skia gives GPU canvas; bare = full native control |
| React Native + Expo | Explicitly excluded by owner; also hides native build config we need (Skia, worklets) |
| Flutter | Good canvas, but loses the existing TS/React code and ecosystem |

| Simulation model | Deciding factor |
|---|---|
| Fixed-tick fluid flow (v0) | Can't express protocols (Raft votes, 2PC) or per-request traces |
| Pure per-request DES | Exact, but 50k rps × 60s = millions of events; too slow on phone |
| **Weighted-particle DES** | Every event is a message with weight *w*; protocol messages w=1 (exact), bulk traffic batched so event rate stays under budget. One engine for both |

## Decision

- **Bare React Native (CLI template), TypeScript, New Architecture, iOS only.**
  No Expo packages anywhere; CI check greps for `expo`.
- **Engine = pure TS package** (`engine/`), zero RN imports, deterministic
  (seeded RNG), headless-testable in Node. The app is a view over it.
- **Weighted-particle discrete-event simulation** — see `engine.md`.
- **Content is data, not code**: components, chaos events, lessons, problems,
  algorithm demos are YAML in `content/`, compiled to JSON at build. Adding a
  lesson or problem is a content PR, not an app release.
- **Behaviours are pluggable modules**: each component type implements one
  interface; patterns are component configs + containers + scenarios, not
  special cases in the engine.
- Offline, local-first: systems saved as `.dsim.json` in the app's Documents
  (visible in Files), shared via share sheet.

## Scope — content in v1

Detailed lists live in sibling specs; one-line summary here.

| Spec | Holds |
|---|---|
| `catalog.md` | component types (~45) + concrete skins (Postgres, Redis, Kafka…) + containers |
| `chaos.md` | traffic shapes and destructive events |
| `topics.md` | Learn track: 16 topics → lessons (the owner's topic list + paradigms) |
| `problems.md` | Problems track: 20 real-world system-design presets |
| `algorithms.md` | Algorithm visualizer demos |
| `machine.md` | Machine level: host view + CPU/memory/bus/paging models |
| `technologies.md` | Under the hood: composite components with simulated internals |
| `engine.md` | simulation model, metrics, determinism, performance budget |

Topic list (owner-specified): Caching · Sharding · Consistency · Consensus ·
Distributed Transaction · Rate limit · Microservices · Migration · Message
Queue · Network · Proximity · Search (Elasticsearch) · Encryption ·
Authentication · Observability · System Paradigms.

Paradigms (owner-specified, must ship): microservices, layered, API gateway,
load balancer, multi-tenant, DDD, serverless, DB consistency, DB sharding,
consensus, distributed transaction.

## Data & integrations

- **System** (`.dsim.json`): nodes, edges, containers, per-node config,
  alert rules, attached scenarios. Versioned schema (`schemaVersion`).
- **Scenario**: traffic sources + timed chaos events; embedded in a system or
  standalone.
- **Run**: not persisted by default; "Save run" keeps seed + scenario (replay
  is deterministic, so no event log needed).
- **Progress**: lesson/problem completion, best scores — local key-value store.
- No network calls. No analytics in v1. Nothing leaves the device except via
  the share sheet.

## Risks / open questions

- **Phone canvas size.** 20+ node problems (YouTube) on a 6" screen: rely on
  containers that collapse to one node, and semantic zoom. Validate early
  with the TinyURL + YouTube presets (Phase 3 exit test).
- **Engine perf on JS thread.** Budget: 20k events/s virtual at 1× on iPhone
  12-class. If it misses, move engine to a worklet runtime
  (`react-native-worklets`) — the pure-TS boundary makes that a move, not a rewrite.
- **Credibility of numbers.** Defaults must be plausible (cross-AZ ~1ms,
  cross-region 60–150ms, SSD read ~100µs…). Each default cites a source in
  `catalog.md`; wrong-looking numbers kill trust fast.
- **Consistency modelling depth.** Stale reads / lost updates via a sampled
  keyspace (engine.md). Full linearizability checking (Jepsen-style) is out;
  a simple anomaly counter is in.
- Open: iPad gets a 3-column layout (palette · canvas · inspector) in
  Phase 10; until then it runs the iPhone layout scaled. Full editing must
  work on iPhone regardless.
