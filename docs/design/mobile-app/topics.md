# Learn track — topics & lessons

Source: `content/topics/<topic>.yaml`. Lesson = preset system + scenario +
guided steps ("fire X, watch Y") + optional check (a pass condition).
Format per line: **lesson** — setup → fire → watch.

## 1. Caching
- Cache-aside — svc + Redis + DB → cold start → hit ratio climbs, DB load falls
- Write-through vs write-behind — two copies side by side → DB slow → write latency vs data-loss window on crash
- Stampede — hot key TTL expires → 1k concurrent misses → DB spike; fix: request coalescing / jittered TTL
- Eviction — LRU vs LFU under scan traffic → hit ratio collapse under LRU
- CDN — edge + origin shield → purge → origin burst
- Invalidation — update DB, stale cache → stale-read counter; fix: delete-on-write, versioned keys

## 2. Sharding
- Hash vs range — same keys, two maps → sequential IDs → range hot shard
- Consistent hashing — ring + vnodes → add node → only ~1/N keys move (links to algo demo)
- Hot key / celebrity — zipf 1.2 → one shard saturates; fix: key salting, read replicas
- Resharding — directory-based → online move → dual-read window
- Cross-shard query — scatter-gather → tail latency ∝ shard count

## 3. Consistency
- Replication lag — async replica → read-after-write → stale reads
- Quorum N/R/W — Dynamo-style 3 nodes → partition → R+W>N vs not, anomalies count
- Consistency ladder — same run at eventual / read-your-writes / monotonic / linearizable → latency vs anomalies chart
- Sync vs async replication — primary crash → lost acknowledged writes (async) vs latency (sync)
- CAP under partition — partition the cluster → choose CP (reject) or AP (diverge), watch both
- Conflict resolution — LWW vs vector clocks vs CRDT counter → concurrent writes

## 4. Consensus
- Raft election — 5 nodes → kill leader → election timeout, new term
- Log replication — client writes → commit index advances on majority
- Split vote — 4 nodes, tight timeouts → repeated elections; fix: randomized timeouts
- Partition minority — 3|2 split → minority can't commit; heal → log reconciliation
- Leader lease & stale leader — clock skew + lease → stale read
- Paxos single-decree — proposers race → promise/accept messages (sequence view)

## 5. Distributed transaction
- 2PC happy path — coordinator + 3 participants → prepare/commit messages
- 2PC blocking — kill coordinator after prepare → participants hold locks
- Saga (orchestrated) — order → payment → inventory → payment fails → compensations
- Saga (choreographed) — same via events → harder to trace (trace view)
- Transactional outbox — dual-write bug vs outbox relay → lost events counter
- Idempotency keys — at-least-once + retry → double charge vs dedupe

## 6. Rate limit
- Token bucket vs leaky bucket — burst 20× → allowed/rejected shape
- Fixed vs sliding window — boundary burst → 2× allowed at window edge
- Distributed limiter — 3 gateway nodes, local vs Redis-backed → over-admission
- Per-tenant limits — noisy tenant → others protected or not
- Backpressure & load shedding — queue bound + priority shed → p99 held

## 7. Microservices
- Monolith → microservices — same load, both shapes → latency, blast radius, deploy
- Cascading failure — slow downstream → thread pools fill upstream
- Circuit breaker — open/half-open/closed, visible state on edge
- Retries + timeouts — retry storm amplification (3 layers × 3 retries = 27×)
- Bulkheads — separate pools per dependency
- Service discovery & health checks — kill instance → LB drains

## 8. Migration
- Strangler fig — route % from monolith to new service → shift traffic slider
- DB migration — dual-write → backfill → verify → cutover; anomalies if skipped
- Blue/green vs canary — bad deploy → error rate scope
- Schema change under load — locking ALTER vs online migration
- Region move — replicate → switch DNS → TTL lag

## 9. Message queue
- Queue vs stream — SQS vs Kafka → replay, consumer groups
- At-least-once & duplicates — consumer crash before ack → redelivery
- Ordering — partitions by key vs round-robin → out-of-order counter
- DLQ & poison message — poison → retries → DLQ
- Consumer lag & autoscaling — burst → lag → scale workers
- Fan-out — pub/sub to N subscribers, one slow

## 10. Network
- Latency geography — same app, 1 vs 3 regions → client p99 per region
- TCP/connection pools — pool exhaustion under slow DB
- Packet loss & tail latency — 1% loss → retransmit → p99
- Partitions — asymmetric partition → split brain
- DNS failover — region down → TTL-bound recovery
- L4 vs L7 load balancing — long-lived connections imbalance
- Socket accept queue — burst fills listen backlog → SYN drops → 1s/3s retries; bigger backlog only moves waiting
- Site-to-site VPN — tunnel hop + encryption, throughput cap, tunnel down → standby tunnel
- NAT gateway port exhaustion — new conn per call → 55k ports/destination gone → pooling fixes
- Keep-alive vs new connections — TCP+TLS handshake round trips; gap grows with distance

## 11. Proximity
- Geohash buckets — drivers in cells → nearby query → neighbour cells
- Quadtree — density-adaptive split (algo demo)
- Geo-sharding — shard by region → cross-border queries
- Location updates at scale — 1M drivers × 4s pings → write path design

## 12. Search (Elasticsearch)
- Inverted index — ingest docs → query (algo demo)
- Shards & replicas — query fan-out → slowest shard sets latency
- Refresh interval — write then search → not visible yet
- Indexing pipeline — DB → CDC → Kafka → ES → lag

## 13. Encryption
- TLS termination points — edge vs mTLS everywhere → CPU/latency cost
- Envelope encryption — KMS quota → throttling under burst; fix: data-key caching
- At-rest vs in-transit — toggles, what an attacker node can read (packet inspector)
- Key rotation — rotate → re-encrypt job load

## 14. Authentication
- Session vs JWT — IdP down → sessions fail vs JWTs keep working until expiry
- Token revocation — revoke → JWT still accepted until TTL; fix: short TTL + denylist
- OAuth2 code flow — sequence view of redirects/tokens
- JWKS caching — IdP key rotation → validation errors window
- API gateway auth offload — authN at gateway vs each service

## 15. Observability
- Golden signals — latency, traffic, errors, saturation dashboards
- Tracing — follow one request across 8 services; find the slow span
- Sampling — head vs tail sampling → which errors you'd miss
- Alert design — noisy vs SLO burn-rate alerts during an incident
- Telemetry overload — collector drops under burst

## 16. System paradigms
- Layered — monolith with layers → rule violations flagged on skip-layer calls
- Microservices — (links topic 7)
- API gateway — routing, auth, aggregation; gateway as SPOF
- Load balancer — algorithms under uneven instances (RR vs least-conn vs P2C)
- BFF — mobile vs web backends
- Service mesh — sidecars add latency, give retries/mTLS
- Event-driven — services talk only via events → decoupling vs traceability
- CQRS — write model + read projections → projection lag
- Event sourcing — rebuild state from log → snapshot speedup
- DDD — bounded contexts, ACL, domain events; shared DB across contexts flagged
- Multi-tenant — pool vs silo vs bridge → noisy neighbour, cost per tenant
- Serverless — cold starts, concurrency limit throttles, downstream DB connection storm
- Cell-based — cell router, cell failure → blast radius %
- Hexagonal / ports & adapters — swap adapter (DB → queue) without core change
