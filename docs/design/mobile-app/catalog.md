# Catalog — components & containers

Source: `content/catalog.yaml` (ported from `deprecated/catalog/catalog.yaml`).
Two levels, as in v0:

- **type** — behaviour the engine runs (`relational-db`, `cache`…). One
  `Behavior` module each.
- **skin** — concrete tech (Postgres, Redis, Kafka…): icon + default config
  on top of a type. Adding a skin = YAML only.

Every default number carries a `source:` comment in the YAML.

## Types

| Group | Type | Key knobs | Skins |
|---|---|---|---|
| Clients | `web-client` · `mobile-client` · `iot-device` · `bot` | think time, retries, region | React SPA, iOS app, sensor, crawler |
| Edge | `dns` | TTL, geo/latency routing, failover | Route 53, Cloudflare DNS |
| | `cdn` | hit ratio, TTL, origin shield | CloudFront, Fastly, Cloudflare |
| | `waf` | rule cost, block rate | AWS WAF |
| | `load-balancer` | L4/L7, algo (RR, least-conn, P2C, hash, weighted, failover), health check, sticky | ALB, NLB, nginx, HAProxy, Envoy |
| | `api-gateway` | routes, authN hook, rate limit, transforms, timeout | Kong, AWS API GW, Apigee |
| | `rate-limiter` | algo (token/leaky bucket, fixed/sliding window, sliding log), scope (global/user/tenant), store | Redis-backed, Envoy RLS |
| | `service-mesh-sidecar` | mTLS, retries, circuit breaker, outlier ejection | Envoy, Linkerd |
| | `vpn-gateway` · `vpn-tunnel` | active/standby tunnels, dead-peer detection; tunnel throughput, encrypt cost | — |
| | `nat-gateway` | ports per destination, port hold after close (callers' edge keep-alive) | — |
| Compute | `service` | instances, slots, p50/p99, CPU/mem, autoscale | generic, Go, Java (GC pauses) |
| | `monolith` | modules (layer tags), single DB pool | Rails, Spring |
| | `serverless-fn` | concurrency limit, cold start, timeout, memory | Lambda, Cloud Functions |
| | `worker` | pulls from queue, batch size, ack mode | Celery, Sidekiq |
| | `cron` | schedule, jitter | k8s CronJob |
| | `container-group` | pods, node capacity, scheduling delay | Kubernetes, ECS |
| Data | `relational-db` | primary/replicas, sync/async, pool size, isolation level, locks | Postgres, MySQL, Aurora |
| | `kv-store` | partitions, replicas, N/R/W, hinted handoff | DynamoDB, Cassandra, Riak |
| | `document-db` | shards, read pref, write concern | MongoDB |
| | `cache` | size, eviction (LRU/LFU/TTL), strategy (aside/through/behind), cluster mode | Redis, Memcached |
| | `object-store` | PUT/GET latency, consistency, size | S3, GCS |
| | `search-index` | shards, replicas, refresh interval, query fan-out | Elasticsearch, OpenSearch |
| | `time-series-db` | ingest rate, retention, downsampling | Prometheus TSDB, InfluxDB |
| | `graph-db` | traversal cost | Neo4j |
| | `blob-cdn-origin` | video segments, transcoding tier | — |
| Analytics | `columnar-db` | columns scanned, pruning, batch inserts, merges | ClickHouse, Druid, Pinot |
| | `data-warehouse` | warehouse size (credits), multi-cluster, auto-suspend/resume, result cache | Snowflake, BigQuery, Redshift |
| | `lakehouse` | Delta on object storage, autoscaling clusters, Photon, small files / OPTIMIZE | Databricks, Delta Lake |
| Messaging | `queue` | visibility timeout, DLQ, FIFO/standard, max receives | SQS, RabbitMQ |
| | `log-stream` | partitions, retention, consumer groups, acks | Kafka, Kinesis |
| | `pub-sub` | fan-out, delivery guarantee | SNS, Google Pub/Sub |
| Coordination | `consensus-group` | members, election timeout, heartbeat | etcd, ZooKeeper, Consul |
| | `lock-service` | lease TTL, fencing | Chubby-like, Redlock |
| | `id-generator` | snowflake / ticket server / UUID | — |
| | `txn-coordinator` | 2PC/3PC/saga, timeouts | — |
| Security | `identity-provider` | token TTL, JWKS cache, MFA latency | Auth0, Cognito, Keycloak |
| | `kms` | encrypt/decrypt latency, quota | AWS KMS, Vault |
| | `secrets-store` | rotation | Vault, Secrets Manager |
| Observability | `metrics-collector` · `log-pipeline` · `trace-collector` | sampling, drop on overload | Prometheus, Loki, Jaeger |
| Geo | `geo-index` | geohash / quadtree / S2, precision | PostGIS, Redis GEO |
| | `routing-engine` | graph size, algo (Dijkstra/A*/CH) | OSRM |
| Special | `external-api` | third-party SLA, quota | Stripe, SendGrid, APNs |
| | `anti-corruption-layer` | translation cost | — |
| | `outbox-relay` | poll interval, batch | Debezium |

## Composite skins

Kafka, Spark, Airflow, Celery, Temporal (v1) and more (v1.1) carry an
`internals:` sub-graph — see `technologies.md`. Their outer type stays
(`log-stream`, `worker`…) so they drop into any design.

## Containers

Group nodes; also affect behaviour (latency, blast radius, rules).

| Container | Effect |
|---|---|
| `region` | cross-region link latency; "region down" target |
| `availability-zone` | cross-AZ latency; "AZ down" target |
| `vpc` / `subnet` | public vs private; WAF/LB placement warnings |
| `bounded-context` | DDD rules (engine.md → Rules checker) |
| `layer` | presentation · application · domain · infrastructure; layered rules |
| `tenant` | tags traffic; pool / silo / bridge isolation; noisy-neighbour |
| `cell` | cell-based arch; cell router; blast radius |
| `k8s-namespace` | pod scheduling domain |

Collapsing a container on the canvas shows it as one node with aggregate
metrics — the answer to big diagrams on a phone.
