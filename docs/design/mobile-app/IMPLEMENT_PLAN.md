# Implementation plan — Distributed Sims (iOS)

Design: `DESIGN.md` · UI: `UIUX_DESIGN.md` + `uiux/` · specs: `engine.md`,
`catalog.md`, `chaos.md`, `topics.md`, `problems.md`, `algorithms.md`, `technologies.md`, `machine.md`.

## Target layout

```
app/          bare React Native (CLI), iOS only — ios/, src/
  src/canvas    Skia rendering + gestures
  src/screens   one file per screen (names match uiux/*.md)
  src/sheets    bottom sheets
  src/state     zustand stores (system doc, run, progress)
engine/       pure TS: kernel, behaviors/, algo/, rules/ — no RN imports
content/      YAML: catalog, chaos, traffic, topics/, problems/, algorithms/, templates/
scripts/      content → JSON build, validation
deprecated/   v0 web app, reference only
```

Stack: RN ≥ 0.81 (New Architecture), TypeScript, `@shopify/react-native-skia`,
`react-native-reanimated` + `react-native-gesture-handler`,
`@react-navigation/native-stack` + `bottom-tabs`, `@gorhom/bottom-sheet`,
`zustand`, `react-native-mmkv`, `@dr.pogodin/react-native-fs`,
`victory-native` (Skia charts). **No `expo` / `expo-*` package, ever.**
npm workspaces; run on physical iPhone.

Decisions made during the build:
- **No npm workspaces** — React Native native-module hoisting breaks pod paths. `app/` is its own npm project; it reaches `engine/src` and `content/dist` via Metro `watchFolders` + `extraNodeModules` and TS `paths` (`@dsims/engine`, `@dsims/content`).
- Icons: vanilla `lucide` icon data rendered as SVG (RN via react-native-svg, canvas via Skia) instead of `lucide-react-native` — one icon source for both.
- Rewind = deterministic rebuild + fast-forward (commands replayed at their times) instead of state snapshots: behaviour state holds closures that can't be cloned.
- Default particle budget 1500/s (Hermes has no JIT; bench: 62 nodes ≈ 48k events/sim-s, 1.1 ms/frame in Node).

## Phase 0: Rescope

Old web code parked so the new app starts clean but can still borrow
catalog data and icons.

- [x] T0.1 Move v0 web app, infra, docs into `deprecated/` — see `deprecated/` — depends: none
- [x] T0.2 Design, UI/UX, specs, this plan — see `docs/design/mobile-app/` — depends: none
- [x] T0.3 New root README — see `README.md` — depends: T0.2

## Phase 1: Foundations

Workspace and tooling first because every later package plugs into it;
then the three roots (app, engine, content) are independent and run in
parallel.

- [x] T1.1 Workspace root — npm workspaces, base tsconfig, eslint (ban `expo*` imports; ban `Math.random`/`Date.now` in `engine/`), prettier, Makefile (`make ios`, `make test`, `make content`), CI check `! grep -r expo package-lock.json` — see `/` — depends: none
- [x] T1.2 Bare RN app — `npx @react-native-community/cli init` into `app/`, delete `android/`, New Arch on, Metro `watchFolders` for workspaces, install stack deps + pods, blank screen runs on device; signing via gitignored `ios/Local.xcconfig` (no Team ID in git) — see `app/` — depends: T1.1
- [x] T1.3 Engine package + kernel — event heap `(time, seq)`, µs clock, xoshiro RNG with per-node fork, `step(until)`, jest in Node — see `engine.md → Shape` — depends: T1.1
- [x] T1.4 Content schemas + build — CI rejects any lesson/tech/model without an attached scenario or frames (Illustration rule, `technologies.md`); zod schemas for catalog/system/scenario/topic/problem/algo; `scripts/build-content` YAML → typed JSON; port `deprecated/catalog/catalog.yaml` + icons — see `catalog.md` — depends: T1.1

## Phase 2: Engine core (headless)

Simulator must be correct and fast before any UI depends on its output;
fully testable in Node without a device.

- [x] T2.1 System graph model — nodes, edges, containers, config merge (skin → type defaults → instance) — see `engine/src/model` — depends: T1.3, T1.4
- [x] T2.2 Behavior interface + resource model + generic `service` — slots, queue, lognormal service time, timeout, retry, health — see `engine.md → Nodes` — depends: T2.1
- [x] T2.3 Links — placement latency, jitter, loss, bandwidth, partition (sym/asym) — see `engine.md → Links` — depends: T2.1
- [x] T2.4 Traffic sources + weighted particles + tracing — shapes from `chaos.md`, key distributions, adaptive weight, 1-in-N traces — see `engine.md → Weighted particles` — depends: T2.2
- [x] T2.5 Metrics store + alerts — log histograms, 1s buckets, ring buffer, SLO, alert rules — see `engine.md → Metrics` — depends: T2.2
- [x] T2.6 Chaos API — apply/heal, duration, scheduled vs live, node/edge/container targets — see `chaos.md` — depends: T2.2, T2.3
- [x] T2.7 Run facade — `createRun(system, scenario, seed)` → `step`, `snapshot`, `command`, `events`; snapshot/rewind; determinism tests (same seed ⇒ same log) — see `engine.md → Time control` — depends: T2.4, T2.5, T2.6
- [x] T2.8 Bench suite — 60 nodes / 20k ev/s budget, run in CI on Node, on-device later — see `engine.md → Performance budget` — depends: T2.7

## Phase 3: App shell & Build mode

Build mode needs only the graph model (T2.1), so it runs parallel to the
rest of Phase 2. Exit test: build the TinyURL v2 graph by hand on an iPhone.

- [ ] T3.1 Navigation shell + theme — 4 tabs, stacks, placeholder screens, tokens (dark/light, type, space, motion) — see `uiux/visual.md`, `uiux/home.md` — depends: T1.2
- [ ] T3.2 System document store — zustand doc, selection, undo/redo, autosave debounce — see `app/src/state` — depends: T2.1, T1.2
- [ ] T3.3 Skia canvas render — nodes, edges, containers, grid, pan/zoom, semantic zoom — see `uiux/components.md → Node/Edge/Container` — depends: T3.2
- [ ] T3.4 Canvas gestures — select, drag, snap, port-drag connect, long-press menu, multi-select — see `uiux/editor.md → Connect` — depends: T3.3
- [ ] T3.5 Palette sheet + drag-to-canvas + skin popover — see `uiux/editor.md → Palette sheet` — depends: T3.4, T1.4
- [ ] T3.6 Inspector / Edge sheets (CONFIG tab) — forms generated from catalog knob schema — see `uiux/editor.md → Inspector sheet` — depends: T3.2, T3.1
- [ ] T3.7 Persistence + Mine tab — `.dsim.json` in Documents (`UIFileSharingEnabled`), list, duplicate/delete, share sheet export, Files import, schema version check — see `uiux/home.md → Mine tab` — depends: T3.2, T3.1

## Phase 4: Run mode

Joins engine and canvas; needs the run facade (T2.7) and the canvas (T3.3).

- [ ] T4.1 Run controller — frame loop, engine step with ms budget, snapshot → Reanimated shared values, speed/pause/step, overload detection — see `app/src/state/run.ts` — depends: T2.7, T3.3
- [ ] T4.2 Live canvas overlays — particles, edge heat, node sparklines/health/badges, Reduce Motion — see `uiux/components.md` — depends: T4.1
- [ ] T4.3 HUD + timeline bar/sheet + scrub/rewind — see `uiux/run.md → Timeline` — depends: T4.1
- [ ] T4.4 Traffic sheet + source editor + quick fire — see `uiux/run.md → Traffic sheet` — depends: T4.1
- [ ] T4.5 Chaos sheet + targeting mode + Build-mode scheduling — see `uiux/run.md → Chaos sheet` — depends: T4.1, T4.3
- [ ] T4.6 Alert toasts + event log sheet + haptics — see `uiux/run.md → Event log` — depends: T4.1
- [ ] T4.7 Send one + trace waterfall sheet — see `uiux/run.md → Send one`, `uiux/insights.md → Trace sheet` — depends: T4.2
- [ ] T4.8 Metrics page — system/nodes/edges charts, anomalies, cost — see `uiux/insights.md → Metrics page` — depends: T4.1
- [ ] T4.9 Inspector RUN + ALERTS tabs — see `uiux/editor.md → Inspector sheet` — depends: T4.1, T3.6

## Phase 5: Behavior library

One task per catalog group, each in `engine/src/behaviors/<group>/` with
unit tests and a tiny demo system in `content/templates/`. Needs only the
run facade, so it overlaps Phases 3–4. T5.3 first among data tasks: the
sampled keyspace is what sharding, caching and transactions build on.

- [x] T5.1 Edge — DNS (TTL, geo, failover), CDN, WAF, LB (RR/least-conn/P2C/hash, health checks), API gateway, rate limiter (5 algos, local vs shared store), sidecar + circuit breaker — see `catalog.md → Edge` — depends: T2.7
- [x] T5.2 Compute — monolith (layer tags), serverless (cold start, concurrency, throttle), worker, cron, container-group autoscale — see `catalog.md → Compute` — depends: T2.7
- [x] T5.3 Data core — sampled keyspace, replication sync/async, consistency levels, N/R/W, anomaly counter; relational-db, kv-store, document-db — see `engine.md → Data model` — depends: T2.7
- [x] T5.4 Sharding — hash/range/ring/directory maps, rebalance, scatter-gather — see `topics.md → Sharding` — depends: T5.3
- [x] T5.5 Cache — aside/through/behind, LRU/LFU/TTL, stampede + coalescing, invalidation — see `topics.md → Caching` — depends: T5.3
- [x] T5.6 Messaging — queue (visibility, DLQ), log-stream (partitions, groups, ISR), pub-sub, ordering, ack modes — see `topics.md → Message queue` — depends: T2.7
- [x] T5.7 Coordination — Raft, Paxos single-decree, leader lease, lock service + fencing, id-generator, gossip — see `engine.md → Protocol behaviours` — depends: T2.7
- [x] T5.8 Transactions — 2PC/3PC coordinator, saga (orch/choreo), outbox relay, idempotency keys — see `topics.md → Distributed transaction` — depends: T5.3, T5.6
- [x] T5.9 Security — IdP (session/JWT/revocation/JWKS), KMS quotas, secrets, TLS/mTLS CPU cost — see `topics.md → Encryption, Authentication` — depends: T2.7
- [x] T5.10 Specialised stores + observability — search-index, TSDB, object-store, graph-db, collectors with drop-on-overload — see `catalog.md → Data, Observability` — depends: T5.3
- [x] T5.11 Geo — geo-index (geohash/quadtree), routing-engine — see `catalog.md → Geo` — depends: T2.7
- [x] T5.13 Composite components — `internals:` sub-graph, port map, collapsed aggregate metrics, drill-in targets — see `technologies.md → Composite component model` — depends: T2.7
- [x] T5.14 Kafka internals — brokers, partitions, ISR, KRaft controller, producer acks/batching, consumer groups + rebalance — see `technologies.md → Kafka` — depends: T5.13, T5.6, T5.7
- [x] T5.15 Spark internals — driver/DAG/stages/tasks, executors, shuffle, skew, lineage recompute — see `technologies.md → Spark` — depends: T5.13
- [x] T5.16 Airflow + Celery internals — scheduler, executors, metadata DB, task states; broker, prefetch, acks_late, beat — see `technologies.md → Airflow, Celery` — depends: T5.13, T5.6
- [x] T5.18 Redis + nginx internals — event loop, epoll, encodings, fork/COW persistence; master/workers, sendfile, keepalive; side-by-side "why fast" comparisons (Apache prefork, disk DB) — see `technologies.md → Redis, nginx` — depends: T5.13, T5.5
- [x] T5.17 Temporal internals — frontend/history/matching, event history, deterministic replay, activities, timers — see `technologies.md → Temporal` — depends: T5.13, T5.3
- [x] T5.12 Special — external-api (SLA, quota), anti-corruption-layer, CRDT counters — see `catalog.md → Special` — depends: T2.7

## Phase 6: Containers, paradigms, protocol view

Paradigms (layered, DDD, multi-tenant, cells) are containers + rules on top
of working behaviours, so they come after Phase 5's core.

- [x] T6.1 Container semantics — region/AZ latency, AZ/region down, cell router, tenant tagging + pool/silo/bridge + noisy neighbour — see `catalog.md → Containers` — depends: T2.3, T2.6
- [x] T6.2 Rules checker — layered, DDD contexts, shared-DB smell, tenant isolation; warnings on edges — see `engine.md → Rules checker` — depends: T2.1
- [ ] T6.3 Container UI — group sheet, collapse/expand with aggregate metrics, rule-warning chip — see `uiux/editor.md → Group` — depends: T3.4, T6.1, T6.2
- [ ] T6.4 Sequence view — protocol swimlanes from engine message log — see `uiux/insights.md → Sequence view` — depends: T4.7, T5.7
- [x] T6.5 Templates — 3-tier, layered monolith, microservices, API gateway + LB, serverless, event-driven, CQRS, DDD, multi-tenant, cell-based — see `content/templates/` — depends: T6.1, T5.1, T5.2, T5.6

## Phase 7: Algorithm visualizer

Independent of the simulator; only needs the app shell. Can start as soon
as T3.1 lands.

- [ ] T7.1 Frame protocol + player screen — generator → cached frames, playback bar, step back, narration, input presets — see `uiux/algorithms.md → Player` — depends: T3.1, T1.3
- [ ] T7.2 Renderers — graph, grid, ring, tree, bit array, cluster, bucket — see `algorithms.md → Primitives` — depends: T7.1
- [x] T7.3 Graph algos — Dijkstra, A*, BFS/DFS, Bellman-Ford, contraction hierarchies, topo sort — see `algorithms.md → Demos` — depends: T7.1
- [x] T7.4 Partitioning + geo — consistent/rendezvous hashing, geohash, quadtree — see `algorithms.md → Demos` — depends: T7.1
- [x] T7.5 Probabilistic + storage — Bloom, count-min, HLL, LSM, B-tree, Merkle, trie top-K, inverted index — see `algorithms.md → Demos` — depends: T7.1
- [x] T7.6 Distributed + rate limit — gossip, Lamport/vector clocks, Raft log, CRDT merge, snowflake, buckets/windows — see `algorithms.md → Demos` — depends: T7.1
- [x] T7.8 Machine: CPU models — pipeline, caches, MESI, scheduling, interrupts — see `machine.md → CPU`, `uiux/tech.md` — depends: T7.1, T7.2
- [x] T7.9 Machine: memory models — hierarchy scale, virtual memory + page table walk + TLB, page replacement, page cache, GC, NUMA — see `machine.md → Memory` — depends: T7.1, T7.2
- [x] T7.10 Machine: chips & buses — bus cycle, DRAM, PCIe, DMA, SSD/HDD, NIC path — see `machine.md → Chips & buses` — depends: T7.1, T7.2
- [ ] T7.7 Graph edit mode + Algos tab list — see `uiux/algorithms.md` — depends: T7.2

## Phase 8: Learn & Problems

Content sits on top of everything: it needs behaviours, run UI, and
algorithm demos to link to. Runtimes first, then content fans out wide.

- [ ] T8.1 Lesson runtime — guide card, step checks (engine predicates), progress store (mmkv) — see `uiux/components.md → Guide card` — depends: T4.5, T4.6
- [ ] T8.2 Learn tab + topic page — see `uiux/home.md → Learn tab, Topic page` — depends: T8.1
- [ ] T8.3 Challenge runtime — scoring, result sheet, stars, best result — see `engine.md → Scoring`, `uiux/insights.md → Challenge result` — depends: T4.8
- [ ] T8.4 Problems tab + brief — see `uiux/home.md → Problem brief` — depends: T8.3
- [x] T8.5 Lessons: Caching, Sharding, Consistency — see `topics.md 1–3` — depends: T8.1, T5.4, T5.5
- [x] T8.6 Lessons: Consensus, Distributed transaction — see `topics.md 4–5` — depends: T8.1, T5.7, T5.8, T6.4
- [x] T8.7 Lessons: Rate limit, Microservices, Migration — see `topics.md 6–8` — depends: T8.1, T5.1, T5.2
- [x] T8.8 Lessons: Message queue, Network, Proximity, Search — see `topics.md 9–12` — depends: T8.1, T5.6, T5.10, T5.11
- [x] T8.9 Lessons: Encryption, Authentication, Observability — see `topics.md 13–15` — depends: T8.1, T5.9, T5.10
- [x] T8.10 Lessons: System paradigms — see `topics.md 16` — depends: T8.1, T6.5
- [x] T8.11 Problems: Classic 1–5 (email, temp email, RSS, TinyURL, KV) — see `problems.md` — depends: T8.3, T5.4, T5.5, T5.6
- [x] T8.12 Problems: Product 6–10 (Craigslist, WhatsApp, Facebook, tickets, Yelp) — see `problems.md` — depends: T8.3, T5.8, T5.10, T5.11
- [x] T8.13 Problems: Product 11–14 (Google Maps, YouTube, Twitch, Figma) — see `problems.md` — depends: T8.3, T5.11, T5.12, T7.3
- [x] T8.14 Problems: Infra 15–20 (crawler, rate limiter, telemetry, autocomplete, notifications, MQ) — see `problems.md` — depends: T8.3, T5.1, T5.6, T5.10

- [ ] T8.15 Drill-in UI — ⤢ on composite nodes, zoom transition, breadcrumb — see `uiux/tech.md` — depends: T5.13, T3.4
- [x] T8.16 Lessons: Under the hood (Kafka, Spark, Airflow, Celery, Temporal, Redis, nginx + compare lessons) — see `technologies.md` — depends: T8.1, T8.15, T5.14, T5.15, T5.16, T5.17, T5.18
- [ ] T8.18 Host view — drill service/data node → host; live per-core, RAM, page faults, IO driven by engine resource model — see `uiux/tech.md → Machine — host view` — depends: T8.15, T4.1
- [x] T8.19 Lessons: Machine level + bridge lessons — see `machine.md → In the Learn track` — depends: T8.1, T8.18, T7.8, T7.9, T7.10
- [ ] T8.17 v1.1 techs (Flink, RabbitMQ, Redis Cluster, Cassandra, Elasticsearch, Kubernetes, Postgres, ZooKeeper/etcd, DynamoDB) — behaviours + lessons — see `technologies.md → v1.1` — depends: T8.16

## Phase 9: Polish & ship

Only meaningful once content exists to test against real usage.

- [ ] T9.1 Accessibility — VoiceOver node elements + rotor, tap paths for every drag, Dynamic Type — see `UIUX_DESIGN.md → Accessibility` — depends: T4.2, T3.5
- [ ] T9.2 Performance pass on device — Instruments, frame budget, particle caps — see `engine.md → Performance budget` — depends: T4.2, T2.8
- [ ] T9.3 Landscape + iPad 3-column layout — see `uiux/editor.md → Landscape` — depends: T3.6, T4.8
- [ ] T9.4 First-run banner, empty states audit — see `uiux/home.md` — depends: T8.2, T8.4
- [ ] T9.5 Release — Xcode archive + TestFlight via `xcodebuild`/fastlane (no EAS), signing from gitignored config — see `app/ios` — depends: T9.1, T9.2 (blocked: needs App Store Connect access/API key from the owner; dev builds install straight to the phone via `make ios-build ios-run`)

## Phase 10: Visual polish loop

"Works" isn't "looks great". Needs every screen to exist, so it's last; it
repeats until a full screenshot pass finds nothing worth fixing. No
simulator: screenshots come from the physical iPhone.

- [ ] T10.1 Snapshot tour (debug builds only) — deep-link `dsims://tour` walks every screen/sheet/state with seeded demo data, captures each via `react-native-view-shot` to the app's Documents; pulled with `xcrun devicectl device copy from --domain-type appDataContainer` — see `app/src/debug/tour.ts` — depends: T9.4
- [ ] T10.2 Review pass — compare every capture against `uiux/*.md` + `uiux/visual.md`; log gaps (alignment, spacing, contrast, truncation, empty states, hierarchy) as T10.x fix tasks here — see `uiux/visual.md` — depends: T10.1
- [ ] T10.3 Canvas craft — glow, trails, health rings, edge heat, pulse, semantic-zoom transitions tuned on device at 60fps — see `uiux/visual.md → Canvas rendering` — depends: T10.1
- [ ] T10.4 Motion + haptics — springs, dock morph Build↔Run, chaos shock ring, pass confetti, Reduce Motion variants — see `uiux/visual.md → Motion` — depends: T10.1
- [ ] T10.5 Live thumbnails on cards (Learn, Problems, Mine) — see `uiux/visual.md → Thumbnails` — depends: T10.1
- [x] T10.6 App icon + launch screen per `uiux/visual.md → App icon` — see `app/ios` — depends: none
- [ ] T10.7 Repeat T10.1 → T10.2 until a pass yields no fixes; reinstall on phone after each — depends: T10.2–T10.6

## Phase 11: Understand & debug (backlog)

From symptom back to cause. Needs a stable run view first (Phase 10), so it's last. Prototype: `/tmp/dsims-diagnose.ts` ranked 106 single-fault runs of the URL shortener in 28 s on the Mac.

- [ ] T11.1 System series keeps error kinds (timeout / 5xx / 503 …), not just error rate — see `engine/src/world.ts`, `metrics.ts` — depends: none
- [ ] T11.2 Merge Metrics + Events + Timeline into one "What happened" sheet (Numbers | Events); drop Edges/Nodes tabs; Protocol view moves to consensus components — see `app/src/screens/MetricsScreen.tsx`, `sheets/RunSheets.tsx` — depends: none
- [ ] T11.3 "Why?" chain on a failing/slow component — rank causes from failing traces' spans, utilisation, queues, active faults — see `app/src/sheets/Inspector.tsx` — depends: T11.1
- [ ] T11.4 "What could cause this?" — pick symptom (504/timeout, 5xx, slow, stale) + where; instant usual-suspects table, then headless single-fault runs on the request path, ranked, streamed; "tell them apart" checks; "Try the top one" — depends: T11.1, T11.3
- [ ] T11.5 Incident drills — hidden fault, symptoms only, pick root cause, scored on correctness + time — see `content/problems` — depends: T11.2, T11.4
- [ ] T11.6 A/B compare — same seed, one change, side-by-side p99 / load / cost — depends: none
- [ ] T11.7 Predict step in lessons — "what happens when…?" choice before the fault fires — see `content/topics` — depends: none
- [ ] T11.8 Queue maths in component details (Little's law: rate × latency vs slots) — see `app/src/sheets/Inspector.tsx` — depends: none
