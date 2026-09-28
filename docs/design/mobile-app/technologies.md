# Under the hood — real systems, internals simulated

Goal: know how Kafka, Spark, Airflow, Celery, Temporal… **actually work**,
not just where the box goes. Each is a **composite component**: one node
on your system; tap ⤢ to drill into its internals, which are real engine
nodes you can load, watch and break.

Source: `content/tech/<slug>.yaml` (internals graph + defaults + lessons);
behaviours in `engine/src/behaviors/tech/<slug>/`.

## Illustration rule (applies to every example in the app)

Nothing is taught in text alone. Every lesson, tech, machine model,
problem and algorithm ships an **animated, interactive illustration in
the app's own tools** (system canvas, drill-in, algorithm/machine player):
- each claim ("single thread", "zero-copy", "ISR shrinks") is a step you
  watch happen, with the moving part highlighted;
- every "why fast/slow" has a side-by-side run (Redis vs disk DB, nginx
  vs thread-per-connection, Celery acks early vs late);
- every "break it" is fireable chaos with a visible consequence;
- narration ≤ 2 sentences per step; the picture carries the rest.
Content CI rejects a lesson with no scenario/frames attached.

## Composite component model

- Skin declares `internals:` — a sub-graph (nodes, edges, containers) plus
  a **port map** (which outer edge lands on which inner node).
- Collapsed: runs the internals anyway, shows aggregate metrics (so a Kafka
  node on the TinyURL canvas behaves like real Kafka, ISR and all).
- Expanded (drill-in): canvas zooms into the sub-graph; breadcrumb
  `Checkout v3 › events (Kafka)`; chaos targets inner nodes.
- Every tech ships: **anatomy** (labelled internals), **lifecycle**
  (one unit of work traced end to end — a record, a task, a job),
  **knobs** that matter in real life, **failure lessons**.

## Tech list (v1)

### Kafka — distributed log
- Internals: brokers · topics → partitions → replicas (leader + followers,
  ISR) · KRaft controller quorum · producers (batching, `acks`,
  idempotence) · consumer groups (coordinator, offsets topic, assignment)
- Lifecycle: produce → leader append → followers fetch → high watermark
  → consumer fetch → offset commit
- Knobs: partitions, RF, `min.insync.replicas`, `acks=0/1/all`,
  `linger.ms`, `batch.size`, retention, `max.poll.interval.ms`
- Break it: kill partition leader (election, unclean vs clean) · slow
  follower drops from ISR (`acks=all` stalls when ISR < min) · consumer
  slow → rebalance storm · hot partition from skewed key · commit before
  process → loss; process before commit → duplicates · controller loss

### Spark — batch/stream compute
- Internals: driver (DAG scheduler → stages → task scheduler) · cluster
  manager · executors (cores, memory: storage vs execution) · shuffle
  service · block manager
- Lifecycle: action → job → DAG split at shuffle boundaries → stages →
  tasks per partition → shuffle write/read → result
- Knobs: executors × cores, partitions, `spark.sql.shuffle.partitions`,
  broadcast threshold, dynamic allocation, speculation
- Break it: data skew (one straggler task) · executor lost mid-shuffle
  (stage recompute via lineage) · OOM / spill to disk · driver death
  (job lost) · too few / too many partitions · speculation saving a
  straggler

### Airflow — workflow scheduler
- Internals: scheduler (DAG parsing, run creation, task queuing) ·
  executor (Local / Celery / Kubernetes) · workers · metadata DB ·
  webserver · triggerer (deferrable tasks)
- Lifecycle: DAG file parsed → DagRun created at schedule → task instance
  states `scheduled → queued → running → success/failed/up_for_retry`
- Knobs: `parallelism`, pool slots, `max_active_runs`, retries + delay,
  catchup, sensors poke vs reschedule
- Break it: metadata DB slow → whole scheduler stalls · worker killed →
  zombie task detection · catchup=True backfill flood · sensors eating
  all slots · non-idempotent task retried · scheduler HA (two schedulers,
  row locks)

### Celery — task queue
- Internals: producer app · broker (Redis / RabbitMQ) · workers (pool:
  prefork / threads, concurrency, prefetch) · result backend · beat
- Lifecycle: `delay()` → message on queue → worker reserves (prefetch) →
  execute → ack (early vs late) → result stored
- Knobs: concurrency, `prefetch_multiplier`, `acks_late`, visibility
  timeout, retries/backoff, routing to queues, time limits
- Break it: worker crash with `acks_late=False` → task lost · prefetch
  hoards tasks behind one long task · Redis visibility timeout → task
  runs twice · broker down · beat running twice → duplicate schedules ·
  result backend fills up

### Temporal — durable execution
- Internals: frontend · history service (shards, event history) ·
  matching service (task queues) · persistence (Cassandra / Postgres) ·
  your workers (workflow + activity)
- Lifecycle: start workflow → history events → workflow task → worker
  replays history deterministically → schedules activity → activity task
  → result event → … → completed
- Knobs: task queue, activity timeouts (start-to-close, heartbeat),
  retry policy, history shard count, worker slots
- Break it: worker killed mid-workflow → another worker **replays** and
  continues (the "aha") · non-deterministic code change → replay failure ·
  activity heartbeat timeout · history DB slow · signal / timer (sleep 30
  days, survives restarts) · saga compensation in workflow code

### Redis — why it's so fast
- Internals: single-threaded event loop (epoll) · in-memory keyspace
  (dict + specialised encodings: listpack, intset, skiplist) · I/O threads
  (6.0+) · RDB snapshot via `fork()` + copy-on-write · AOF + fsync policy ·
  replicas (async) · Sentinel / Cluster (16384 slots)
- Lifecycle: client cmd → socket readable → event loop parses RESP →
  O(1)/O(log n) op in RAM → reply buffered → written on writable
- Why fast (each an animated step): RAM not disk (links machine
  hierarchy) · no locks, no context switches (one thread) · epoll
  multiplexes 10k sockets · compact encodings fit CPU caches ·
  pipelining amortises round trips
- Knobs: `maxmemory` + eviction policy, `appendfsync`, io-threads,
  pipelining depth
- Break it: one `KEYS *` / big `DEL` blocks everyone (single thread) ·
  `fork()` on a 50 GB instance → COW page copying, latency spike (links
  paging) · `appendfsync always` on slow disk · hot key on one slot ·
  primary dies before replicating → lost writes

### nginx — why it's so fast
- Internals: master process · one worker per core (`worker_processes
  auto`) · per-worker event loop (epoll, non-blocking sockets) ·
  connection pool · upstream keepalive · `sendfile` / zero-copy ·
  shared memory zones (rate limit, cache)
- Lifecycle: accept → request parsed → location match → static file
  (sendfile: disk → page cache → NIC via DMA, no user-space copy) or proxy
  to upstream → response streamed
- Why fast: event-driven, not thread-per-connection — side by side with
  Apache prefork at 10k connections (memory, context switches) · no
  locks between workers · zero-copy file serving · keepalive reuse
- Knobs: workers, `worker_connections`, keepalive, buffers, cache,
  `limit_req`
- Break it: blocking module/upstream stalls a worker's whole loop · too
  few `worker_connections` · slow clients (slowloris) · upstream without
  keepalive → port exhaustion · config reload (graceful: old workers
  drain)

### v1.1 (same model, after the seven above)
- **Flink** — job manager, task managers, checkpoints (barriers), watermarks, exactly-once sinks
- **RabbitMQ** — exchanges (direct/topic/fanout), queues, acks, quorum queues
- **Redis Cluster** (deep) — resharding, MOVED/ASK, gossip bus
- **Cassandra** — ring, gossip, coordinator, hinted handoff, read repair, compaction
- **Elasticsearch** — master, data nodes, shards, refresh/flush, translog
- **Kubernetes** — API server, etcd, scheduler, controllers, kubelet, pods, HPA
- **Postgres** — WAL, MVCC, vacuum, streaming replication, connection pool (PgBouncer)
- **ZooKeeper / etcd** — ensemble, zxid / Raft, watches, sessions, ephemeral nodes
- **DynamoDB** — partitions, adaptive capacity, GSIs, hot partition throttling
- **Columnar & warehouses** — row vs column scans, pruning, Snowflake warehouses (sizing, queueing, multi-cluster, auto-suspend, result cache), Databricks lakehouse (Delta, small files, OPTIMIZE, spot loss)

## In the Learn track

New topic group **Under the hood** (after the 16 topics), one topic per
tech; each topic = 1 anatomy tour + 1 lifecycle lesson + 3–6 break-it
lessons listed above. "Compare" lessons: Celery vs Airflow vs Temporal
(same job, three engines: what survives a worker crash) · Kafka vs
RabbitMQ vs SQS.
