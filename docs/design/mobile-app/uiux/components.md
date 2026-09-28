# Components

Reusable parts, all variants. Built in `app/src/canvas/` (Skia) and
`app/src/ui/` (RN views).

## Node

```
 build, idle          selected             running, ok
 ╭──────────╮        ╭══════════╮●        ╭──────────╮
 │ 🐘       │        ║ 🐘       ║  ← port  │ 🐘   ▂▃▅ │ ← sparkline rps
 │ orders-db│        ║ orders-db║          │ orders-db│
 ╰──────────╯        ╰══════════╯         ╰──────────╯
  postgres            postgres              12ms · 64%   ← p99 · util

 warn                 fail / alert         down            partitioned
 ╭──────────╮ ⚠      ╭──────────╮ 🔔2     ╭╱╱╱╱╱╱╱╱╱╱╮    ╭──────────╮ ⟂
 │ 🐘   ▅▇█ │ amber  │ 🐘   ███ │ red     │ 🐘  DOWN │    │ 🐘       │
 │ orders-db│        │ orders-db│         │ orders-db│    │ orders-db│
 ╰──────────╯        ╰──────────╯         ╰╱╱╱╱╱╱╱╱╱╱╯    ╰──────────╯
  240ms · 91%         1.2s · 100% · 8% err  killed 0:42     cut from 2 peers

 role badges (consensus / replication)
 ╭──────────╮ 👑     ╭──────────╮ R      ╭──────────╮ C
 │ etcd-1   │ leader │ db-r1    │ replica │ coord    │ coordinator
 ╰──────────╯ T4     ╰──────────╯ lag 2s  ╰──────────╯
               ← term

 far zoom (< 40%)
  ● orders-db     ← dot coloured by health, label only
```

Long name: `payments-reconcil…` (truncate middle-out at 18 chars on node,
full name in inspector).

## Edge

```
 idle         ─────────────▶
 running      ══•══•═══════▶      ← two lanes, right-hand traffic:
              ═════◦═══◦═══       requests (solid, op colour) one side,
                                  replies (smaller, green) the other
 heat         ━━━━━━━━━━━━━▶       ← width ∝ rps (far zoom / Reduce Motion)
 errors       ──•──✕──•──✕─▶ red
 slow         ─ ─ ─ ─ ─ ─ ─▶ amber  (+latency injected)
 partitioned  ──────⟂──────        no arrow: nothing gets through
 async (queue)┄┄┄┄┄┄┄┄┄┄┄┄▶       dotted = fire-and-forget
 breaker      ─────[◐]─────▶       circuit breaker: ● closed ◐ half ○ open
 rule warning ─────⚠───────▶       e.g. layer skip, cross-context DB
```

## Container

```
 expanded                                 collapsed (double-tap)
 ┌ us-east-1 ─────────────────────── ⌄ ┐  ┌ us-east-1 ─── (7) ›┐
 │ ┌ az-a ──────────┐ ┌ az-b ────────┐ │  │ ▂▃▅  p99 40ms  ok  │
 │ │  [svc] [db]    │ │  [svc] [db-r]│ │  └────────────────────┘
 │ └────────────────┘ └──────────────┘ │
 └─────────────────────────────────────┘
 kinds by header chip:  🌎 region  ◫ AZ  ⬡ bounded context
                        ≡ layer   👥 tenant  ▦ cell  🔒 VPC
```

## Particle

```
 •  read   ◦  write   ◆ protocol (w=1)   ✕ error   ⦿ traced (tap → trace)
 size: w=1 3pt → w≥1000 8pt
```

## HUD chip

```
 ⏱ 00:42.310  ×4       ← sim clock · speed
 ⚠ 3                    ← active alerts (tap → event log, filtered)
 ⚡ 2 active             ← chaos in effect (tap → Heal list)
 ⊘ 14 anomalies         ← stale / lost / duplicate (tap → breakdown)
 🎯 p99 38ms / 50ms ✓   ← challenge target, live
```

## Sheet header

```
 ▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁
 orders-db                      ✕
 Postgres · relational-db  ⓘ
 [ CONFIG | RUN | ALERTS ]
```

## Toast & banner

```
 ⌐ 🔔 orders-db p99 > 500ms       ( View ) ¬   alert, 4s, haptic warning
 ⌐ Partition healed                        ¬   info, 2s
 ┌────────────────────────────────────────┐
 │ Tap the first node to partition   ( Cancel ) │  targeting banner, sticky
 └────────────────────────────────────────┘
```

## Guide card (lessons)

```
 ╭────────────────────────────────────────╮
 │ 2 / 4   Kill the leader                │
 │ Tap ⚡ → Kill, then tap the 👑 node.    │
 │ Watch: followers time out, one wins.   │
 │                  ( Hide )  [ Next › ]· │ ← disabled until step's check passes
 ╰────────────────────────────────────────╯
```
