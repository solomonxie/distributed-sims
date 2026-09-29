# Editor — Build mode

`EditorScreen`, full screen, tab bar hidden. Reached from: Mine, problem
brief, lesson (opens in Run), import.

## Anatomy — populated

Canvas edge to edge; nav and dock float in glass (`visual.md → Chrome`).

```
 · · · · · · · · · · · · · · · · · · · · ·
 ·╭──────────────────────────────────────╮·
 ·│ ‹   Checkout v3 ⌄           ↶   ↷    │·  ← glass nav pill
 ·╰──────────────────────────────────────╯·
 · · · · ╭────────────╮ · · · · · · · · · ·
 · · · · │ ◯ 📱 iOS   │ · · · · · · · · · ·
 · · · · ╰─────┬──────╯ · · · · · · · · · ·
 · · · · · · · ▼ · · · · · · · · · · · · · ·
 · ╭────────────╮   ╭────────────╮ · · · · ·
 · │ ◯ ☁ ALB    │──▶│ ◯ ⬡ api    │──┐ · · ·
 · ╰────────────╯   ╰────────────╯  │ · · ·
 · ┌╌ ⬡ Orders ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┐   │ · · ·
 · ╎ ╭──────────╮  ╭───────────╮ ╎◀──┘ · · ·
 · ╎ │ ◯ ⬡ order│─▶│ ◯ 🐘 ordDB│ ╎ · · · · ·
 · ╎ ╰──────────╯  ╰───────────╯ ╎ · · · · ·
 · └╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┘ · · · · ·
 · · · · · · · · · · · · · · · · · ⚠ 1 · · ·  ← rule warnings chip
 · ╭────────────────────────────────────╮ · ·
 · │  +    ⇢    ▦    ≋  │ [[ ▶ Run ]]   │ · ·  ← glass dock
 · ╰────────────────────────────────────╯ · ·
      Add Connect Group Traffic
```

- Dock icons get labels under them on first 3 launches, then icons only
  (long-press any = tooltip).
- `▶ Run` switches to Run (`run.md`); the dock morphs in place. With no
  traffic source yet, adds a default 100 rps source on every client and
  toasts that.
- Chaos lives in Run only (fire now). In Build, schedule it from the
  timeline (`≋` Traffic sheet → "Schedule…").

```
✗ full-width top bar + 5-button bottom toolbar
  two opaque bars eat ~20% of a 6.1" screen; canvas felt boxed in
```

## States

```
empty    · · · · · · · · · · · · · · · · ·
         ·       ⌁ Tap + to add a       ·
         ·       component, or start    ·
         ·       from a template.       ·
         ·   [[ Add component ]]        ·
         ·   ( Templates… )             ·
         · · · · · · · · · · · · · · · · ·
         ▶ disabled · "Add a client and a service to run"
one node ▶ disabled until a client (traffic origin) exists
invalid  edge rule warning: chip ⚠ n → tap → list, tap row → select edge
huge     > 150 nodes: toast "Large system — particles reduced"
```

## Palette sheet — `PaletteSheet`

Opened by `+`. Detents: medium (default) · large.

```
 ▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁
 Add component                  ✕
 🔍 Search 45 components
 [ ALL | Edge | Compute | Data | Msg | Coord | Sec | Obs | Geo ]
 CLIENTS
 ┌───────┬───────┬───────┬───────┐
 │  🌐   │  📱   │  📡   │  🤖   │
 │  Web  │  iOS  │  IoT  │  Bot  │
 └───────┴───────┴───────┴───────┘
 EDGE
 ┌───────┬───────┬───────┬───────┐
 │  🌍   │  ☁    │  🦍   │  ⚖    │
 │  DNS  │  CDN  │Gateway│  LB   │
 ├───────┼───────┼───────┼───────┤
 │  ⏲    │  🛡   │  ⬢    │       │
 │ Rate  │  WAF  │Sidecar│       │
 │limiter│       │       │       │
 └───────┴───────┴───────┴───────┘
 CONTAINERS
 🌎 Region · ◫ AZ · ⬡ Context · ≡ Layer · 👥 Tenant · ▦ Cell
```

Tile = type; long-press tile → skin picker popover (Postgres · MySQL ·
Aurora…) or drag straight out with the default skin.

```
 drag out
 long-press ↓           drag ▲ onto canvas          release
 sheet → peek           ghost follows finger         node placed, selected,
 ▁▁▁▁▁▁▁▁▁▁▁▁           snap guides to grid          Inspector opens (peek)
 🐘 Postgres ▲          ┆ ╭────────╮ ┆
                        ┆ │ 🐘 db  │ ┆  haptic tick on snap
```

## Inspector sheet — `InspectorSheet`

Tap a node. Detents: peek · medium · large. Tabs: CONFIG · RUN · ALERTS.

```
 peek
 ▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁
 🐘 orders-db   Postgres      ✕
 2 replicas · async · pool 100

 medium, CONFIG
 ▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁
 🐘 orders-db                   ✕
 Postgres · relational-db  ⓘ
 [ CONFIG | Run | Alerts ]
 ╭──────────────────────────────╮
 │ Name              orders-db ›│
 │ Skin               Postgres ›│
 │ Replicas          [−] 2 [+] │
 │ Replication  [ ASYNC | Sync ]│
 │ Pool size         [−] 100 [+]│
 │ Read latency p50      2 ms  ›│
 │ Read latency p99     12 ms  ›│
 │ Isolation   Read committed  ⌄│ ← unfolds in place (mobile.md)
 │ Storage            500 GB   ›│
 ╰──────────────────────────────╯
 ADVANCED                      ›
 ≈ $412 / mo  ⓘ
 ( Duplicate )  ( Connect… )  [ Delete ]!
```

```
 RUN tab (only while running)        ALERTS tab
 p99  ▁▂▂▃▅▇█  840 ms  ⚠             ╭──────────────────────────────╮
 rps  ▅▅▅▅▅▆▆  1.2k                  │ p99 > 500ms for 10s     ─●  │
 err  ▁▁▁▁▂▅▇  8.1 %                 │ error rate > 1%         ─●  │
 util ▇▇▇███   100 %                 │ replica lag > 5s        ○─  │
 queue          412                  ╰──────────────────────────────╯
 Role  primary · lag r1 2.1s         + Add alert…
 ( Open metrics › )  ( Break it… )
```

Node long-press → context menu:

```
 ╭────────╮
 │ 🐘 db  │↖ ┌──────────────────┐
 ╰────────╯  │ Connect to…      │
             │ Duplicate        │
             │ Move to group…   │
             │ Send one request │ ← Run only
             │ Break it…      ▸ │
             ├──────────────────┤
             │ Delete         ! │
             └──────────────────┘
```

## Connect & Edge sheet — `EdgeSheet`

```
 drag port ●                  release on target        edge sheet opens
 ╭──────╮●                    ╭──────╮   ╭──────╮      (peek)
 │ api  │ ╲                   │ api  │──▶│ db   │
 ╰──────╯  ╲ ┄┄┄▶ ╭──────╮    ╰──────╯   ╰──────╯
               ▲  │ db   │  valid targets glow; invalid (e.g. DB → client) dim
                  ╰──────╯
```

```
 ▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁
 api → orders-db                ✕
 ╭──────────────────────────────╮
 │ Protocol           SQL/TCP  ⌄│
 │ Call         [ SYNC | Async ]│
 │ Timeout              2 s    ›│
 │ Retries   [−] 2 [+]  expo+jit│
 │ Circuit breaker          ─● │
 │ mTLS                     ○─ │
 │ Latency (placement)  0.5 ms  │ ← from containers, read-only
 ╰──────────────────────────────╯
 ⚠ Crosses bounded context "Orders" → "Billing"
   directly into its database. ⓘ
 [ Delete edge ]!
```

## Group — `ContainerSheet`

`▦ Group` enters multi-select (tap nodes, `Done`) → pick kind.

```
 ▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁
 Group 3 components             ✕
 (•) 🌎 Region        us-east-1 ⌄
 ( ) ◫ Availability zone
 ( ) ⬡ Bounded context
 ( ) ≡ Layer
 ( ) 👥 Tenant  [ POOL | Silo | Bridge ]
 ( ) ▦ Cell
 [[ Group ]]
```

## Landscape

Canvas fills; toolbar moves to a left rail; sheets become a right-side
panel (40% width). Same content.
