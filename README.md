# Distributed

iOS app (bare React Native, no Expo) for building distributed systems out of
real cloud components and breaking them on purpose.

- Drag-drop components (gateways, LBs, services, DBs, caches, queues,
  consensus groups, IdPs…) and wire them
- Fire traffic — steady, burst, flash crowd, hot key, per-tenant — or a
  single traced request
- Inject faults — kill, partition, slow, packet loss, clock skew, AZ/region
  down, split brain, poison messages
- **Learn**: 16 topics (caching, sharding, consistency, consensus,
  distributed transactions, rate limiting, microservices, DDD,
  multi-tenant, serverless…) as runnable lessons
- **Problems**: TinyURL, YouTube, Google Maps, WhatsApp, KV store, ticket
  booking… with reference designs and pass/fail challenges
- **Algorithms**: step-through Dijkstra, A*, consistent hashing, geohash,
  Bloom filter, Merkle tree, Raft log…

Status: implementation in progress. Design: start at [docs/design/mobile-app/DESIGN.md](docs/design/mobile-app/DESIGN.md),
then [UIUX_DESIGN.md](docs/design/mobile-app/UIUX_DESIGN.md) and
[IMPLEMENT_PLAN.md](docs/design/mobile-app/IMPLEMENT_PLAN.md).

The earlier web prototype lives in `deprecated/` for reference.

## Develop

```
make install        # app deps + pods, engine + scripts deps (all local)
make test           # content build + validation, engine tests (jest)
make ios-build      # Release build for a physical iPhone, JS bundled in
make ios-run        # install + launch on the phone (DEVICE=<udid>, or in gitignored Local.mk)
make tour           # debug snapshot tour on the phone → PNGs in /tmp/dsims-tour/
```

- `engine/` pure-TS discrete-event simulator, algorithm + machine-level frame demos
- `content/` YAML: catalog, chaos, templates, lessons, problems → `content/dist` via `make content`
- `app/` bare React Native (no Expo), Skia canvas
- Signing: put `DEVELOPMENT_TEAM = <team id>` in `app/ios/Local.xcconfig` (gitignored)
- Frame previews without a device: `cd app && npx tsx scripts/preview-frames.ts /tmp/frames dijkstra`

## License

MIT — see [LICENSE](LICENSE).
