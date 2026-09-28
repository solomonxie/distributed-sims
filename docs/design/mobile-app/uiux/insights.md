# Metrics, trace & sequence, challenge result

## Metrics page — `MetricsScreen`

Pushed from Run `📈` or Inspector "Open metrics". Keeps running behind.

```
 ‹ Run        Metrics       ×4 ⏸
 ────────────────────────────────────────
 [ SYSTEM | Nodes | Edges ]
 ENTRY: ALB                   SLO 99.9%
 availability  99.2 %  ✗     ← red: under SLO
 ╭──────────────────────────────────────╮
 │ p99 ms                          840  │
 │ 900┤                    ╭──╮         │
 │    │              ╭─────╯  ╰─        │
 │  50┤──────────────╯                  │
 │    └──────⚡────────⚡─────────────   │ ← chaos markers on x-axis
 │     0:00          0:30        1:00   │
 ╰──────────────────────────────────────╯
 ╭──────────────────────────────────────╮
 │ rps · errors                         │
 │   (stacked: ok / 5xx / timeout / 429)│
 ╰──────────────────────────────────────╯
 ANOMALIES   stale 11 · lost 0 · dup 3    ›
 COST        ≈ $2,140 / mo                ›
```

`Nodes` tab: sortable list (p99 · util · err), each row a sparkline → tap
= that node's charts. Landscape = 2-column chart grid.

States: `< 2s data` → "Collecting…" skeleton charts.

## Trace sheet — `TraceSheet`

From "Open trace" or tapping a ⦿ particle.

```
 ▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁
 Trace 7f3a · 812 ms · ✓ 200    ✕
 [ WATERFALL | Sequence ]
 0         200       400      800
 📱 iOS      ▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇  812
 ☁ ALB        ▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇  790
 ⬡ api         ▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇  780
 🐘 ordDB         ▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇  804 ⚠ queue 610
 ⬡ api → ☰ ev         ▇ 2  (async)
 tap span → node selected on canvas
```

## Sequence view — protocol messages

Same sheet, `Sequence` tab; also opened from a consensus/txn node
("Show protocol"). Swimlane per node, time down.

```
 ▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁
 2PC · order 5521                ✕
   coord     pay       inv      ship
     │ prepare ▶│         │        │
     │ prepare ─┼───────▶ │        │
     │ prepare ─┼─────────┼──────▶ │
     │◀ yes ────│         │        │
     │◀ yes ────┼──────── │        │
     ☠ killed (chaos 0:12)         │
     ┆          │🔒 locked │🔒      │🔒 ← blocked, holding locks
     ┆          │  12s…   │        │
 ▶ Play   step ›   ⏪
```

Empty (no protocol nodes): "No protocol messages in this system."

## Challenge result — `ResultSheet`

Medium sheet at scenario end.

```
 ▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁
 Viral link — not yet          ✕
 ✗ p99 at entry     212 ms  > 50 ms
 ✓ availability    99.97 %  ≥ 99.9 %
 ✓ anomalies           0   = 0
 ✓ cost          $3.1k/mo  ≤ $5k
 Worst hop: 🐘 urls-db, 96% of latency ⓘ
 ( See reference v2 )   [[ Try again ]]
```

```
 pass
 ★ Viral link — passed
 ✓ p99 38 ms · ✓ 99.99% · ✓ 0 · ✓ $2.4k
 Best: 38 ms (previous 212 ms)
 ( Back to brief )   [[ Next challenge › ]]
```
