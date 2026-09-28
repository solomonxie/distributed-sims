# Engine — simulation model

`engine/` — pure TypeScript, no React Native imports, deterministic. The app
only calls its API and reads snapshots.

## Shape

```
          Scenario ──┐                 ┌──▶ Snapshot (per frame) ──▶ canvas
 System (graph) ─────┼──▶  Kernel  ────┼──▶ Metrics store      ──▶ charts / HUD
 Chaos cmds (live) ──┘   event queue   ├──▶ Event log          ──▶ log sheet
                         + clock       └──▶ Traces / protocol  ──▶ sequence view
                         + seeded RNG
```

- **Kernel**: binary-heap event queue keyed by `(time, seq)`; virtual clock
  in µs; `step(untilVirtualTime)` runs events up to a bound.
- **RNG**: one seeded PRNG (xoshiro128**) per run, forked per node so adding a
  node doesn't reshuffle others. Same seed + system + scenario ⇒ same run.
- No `Date.now`, no `Math.random` inside `engine/` (lint rule).

## Weighted particles

Every event is a **message** `{id, from, to, kind, weight, key?, op?, tenant?,
size, traceId?, deadline, hops}`.

- Protocol messages (Raft RPCs, 2PC prepare/commit, gossip, lock grants):
  always `weight = 1`.
- Bulk traffic: a source emitting R req/s with event budget B/s emits
  particles of `weight = ceil(R / B_source)`. A node treats a particle as
  `weight` requests for capacity, queueing and metrics.
- Keys are sampled per particle from the source's distribution (uniform,
  zipf(s), hot-key %) — so hot shards emerge naturally.
- **Traced** particles (1 in N, default 1 in 50) carry `traceId`; every hop
  is recorded → per-request trace + the animated dots you actually see.
- Budget: ≤ 20k events/s virtual at 1×; weight adapts every 1s virtual.

## Nodes

```ts
interface Behavior<S, C> {
  type: string                      // catalog type, e.g. 'relational-db'
  init(cfg: C, ctx: Ctx): S
  onMessage(s: S, m: Msg, ctx: Ctx): void   // ctx.send / ctx.schedule / ctx.reply
  onTimer?(s: S, t: Timer, ctx: Ctx): void  // heartbeats, TTLs, compaction
  onChaos?(s: S, e: ChaosEvent, ctx: Ctx): void
}
```

Shared resource model (every behaviour gets it for free, via `ctx`):

| Resource | Model |
|---|---|
| Concurrency | `instances × slots`; busy slots hold for service time |
| Service time | lognormal(p50, p99) from config; scaled by CPU pressure |
| Queue | bounded FIFO (or LIFO / priority); overflow → reject 503 |
| Timeout | per edge; expiry → caller sees error, callee may still work (wasted) |
| Retry | per edge: count, backoff, jitter — the retry-storm lever |
| Memory / disk | counters; full ⇒ behaviour-defined failure (OOM kill, write reject) |
| Health | `up · degraded · down · partitioned`; LB/health checks read it |
| Autoscale | optional: target util, cooldown, cold-start delay (serverless) |

## Links (edges)

`{latency (dist), bandwidth, lossRate, protocol, timeout, retry, partitioned}`.
Default latency from placement: same host 0.05ms · same AZ 0.5ms · cross-AZ
1ms · cross-region 60–150ms (by region pair) · client↔edge 20–80ms.
Partition = messages dropped (or held, for "asymmetric/flaky" mode).

## Data model — sampled keyspace

Data nodes track a **sampled keyspace**: K logical keys (default 1024), each
`{value, version, writer, ts}`; bulk weight scales metrics but not keyspace.

- Replication: per-replica copies + lag queue ⇒ **stale reads**, **lost
  updates**, **divergence after split brain** become countable events.
- Consistency levels on reads/writes: ONE · QUORUM · ALL · leader-only ·
  read-your-writes · linearizable (via leader lease).
- Sharding: shard map (hash / range / consistent-hash ring / directory);
  rebalance moves key ranges over time, visible.
- **Anomaly counter**: stale read, lost update, dirty read, duplicate
  delivery, out-of-order, double-spend (ticket booking). Shown in HUD.

## Protocol behaviours (w=1, exact)

Raft (election, log replication, commit index) · Paxos (single-decree demo) ·
leader lease · 2PC / 3PC · Saga (orchestrated / choreographed, compensations) ·
transactional outbox · gossip (SWIM-lite) · distributed lock (lease + fencing
token) · vector clocks · CRDT counter (G/PN). Each records its messages for
the sequence view.

## Metrics

Per node, per 1s virtual bucket: rps in/out, errors by kind, latency
histogram (log buckets → p50/p95/p99), queue depth, utilisation, memory,
cost/hr. Per edge: rps, errors, bytes. System: SLO (availability, p99) of
each entry point. Ring buffer of last 10 min virtual.

## Alerts

`{node|edge|system, metric, op, threshold, for: duration}` → fires/resolves
events. Presets ship sensible ones.

## Time control & replay

- Speed 0.1× – 100×; pause; step (next event / +100ms / +1s).
- Snapshots every 5s virtual (structural clone of state + RNG). Rewind =
  restore nearest snapshot + re-run. Live chaos commands are appended to the
  scenario with their timestamp, so a rewound run replays them.

## Rules checker (static, not simulated)

Runs on the graph while editing: layered (no upward / skip-layer calls),
DDD (cross-context calls must go through an ACL/API or events; no shared DB
across contexts), microservices (shared DB smell), multi-tenant (pool without
tenant isolation). Violations = warnings on edges.

## Scoring (Problems track)

Challenge = `{scenario, pass: [p99 < X at entry, availability ≥ Y,
anomalies == 0, cost ≤ $Z]}`. Evaluated at run end; best result stored.

## Performance budget

iPhone 12-class, 1× speed, 60 nodes, 20k events/s: engine ≤ 6ms/frame on
JS thread; snapshot for canvas ≤ 1ms. Bench suite in `engine/bench`.
