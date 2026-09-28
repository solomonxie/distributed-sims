# Problems track — real-world system design presets

Source: `content/problems/<slug>.yaml`. Each problem ships:

- **Brief** — functional + non-functional requirements, scale numbers
  (DAU, QPS read/write, storage, latency SLO).
- **Designs** — `v1` naive (works at small scale) and `v2` reference
  (scaled); user can fork either or start blank.
- **Challenges** — scenarios with pass conditions (engine.md → Scoring).
- **Key ideas** — the 3–5 concepts it teaches, linked to lessons / algo demos.

| # | Problem | Key ideas | Signature challenge |
|---|---|---|---|
| 1 | Send email notification | queue, retries, idempotency, provider failover | SendGrid outage → 0 lost, ≤1 duplicate |
| 2 | Temporary email system | TTL storage, inbound SMTP fan-in, cleanup jobs | 10× inbound spam burst, p99 < 1s |
| 3 | RSS news feed | fetch scheduler, dedupe, fan-out on read | 50k feeds, polite crawl rate |
| 4 | TinyURL | ID gen (base62 / snowflake), read-heavy cache, 301 vs 302 | 100:1 read burst, hot link, p99 < 50ms |
| 5 | KV store (distributed) | consistent hashing, N/R/W quorum, hinted handoff, Merkle anti-entropy | partition + node loss, 0 lost acks |
| 6 | Craigslist | CRUD + search index, regional sharding, images on object store | search freshness < 5s |
| 7 | WhatsApp | persistent connections, message ordering, delivery receipts, offline queue | gateway node kill, no reordering |
| 8 | Facebook news feed | fan-out on write vs read, celebrity problem | celebrity post, p99 feed < 300ms |
| 9 | Ticket booking | inventory locking, double-sell prevention, queue/waiting room | flash crowd 100×, 0 double-sell |
| 10 | Yelp | geo index, read-heavy, reviews write path | nearby query p99 < 100ms |
| 11 | Google Maps | tiles CDN, routing engine (Dijkstra/A*/CH), ETA, location pings | routing burst, region down |
| 12 | YouTube | upload → transcode pipeline, object store, CDN, view counters | viral video: CDN miss storm |
| 13 | Twitch | live ingest, transcoding, low-latency CDN, chat fan-out | 1M viewers join in 10s |
| 14 | Figma | real-time collab, CRDT / OT, websocket fan-out, snapshots | server kill, no lost edits |
| 15 | Web crawler | URL frontier, politeness, dedupe (Bloom filter), DNS cache | trap site, bounded frontier |
| 16 | Rate limiter | distributed token bucket, Redis, per-tenant | 3 gateways, ≤ 5% over-admit |
| 17 | Telemetry system | ingest, Kafka, TSDB, downsampling, backpressure | 10× metric cardinality burst |
| 18 | Autocomplete | trie / top-K, precomputed shards, cache | p99 < 30ms under typing burst |
| 19 | Notification system | multi-channel (push/SMS/email), priorities, dedupe | APNs slow, SMS unaffected |
| 20 | Distributed message queue | partitions, replication (ISR), consumer groups | broker loss, 0 lost committed |

Order in app = order above (owner's list), grouped: Classic (1–5) · Product
(6–14) · Infrastructure (15–20).

Stretch (post-v1): Uber/ride matching, Dropbox, payment system, stock
exchange, ad click aggregation, hotel reservation, Google Docs, leaderboard.
