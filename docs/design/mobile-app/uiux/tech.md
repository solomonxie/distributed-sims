# Under the hood & Machine level

Specs: `../technologies.md`, `../machine.md`. Look: `visual.md`.

## Drill-in — composite node

```
 before (system canvas)               tap ⤢ ↓  (or pinch-out on node)
 ╭────────────────╮                   node grows to fill screen,
 │ ◕ ☰ events  ⤢ │ ← ⤢ on composites  neighbours slide off (350ms spring)
 │   Kafka · 3 br │
 ╰────────────────╯

 after (internals)
 ·╭──────────────────────────────────────╮·
 ·│ ‹  Checkout v3 › events (Kafka)      │·  ← breadcrumb; ‹ = zoom out
 ·╰──────────────────────────────────────╯·
 · ┌╌ broker-1 ╌╌╌╌╌┐ ┌╌ broker-2 ╌╌╌╌╌┐ · ·
 · ╎ p0 👑 ████▌    ╎ ╎ p0 R ████      ╎ · ·  ← partition log bars,
 · ╎ p1 R  ███      ╎ ╎ p1 👑 ███▌     ╎ · ·    👑 leader, R replica
 · └╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┘ └╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┘ · ·
 · ┌╌ broker-3 ╌╌╌╌╌┐   ◆ controller (KRaft) ·
 · ╎ p0 R ███ ⚠ ISR╎ · ← dropped from ISR
 · └╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┘ · · · · · · · · · · · ·
 · producers ─•─▶ leaders    consumers ◀─•─ ·
 · group "orders" · lag 1.2k · gen 7        ·
 · ╭────────────────────────────────────╮ · ·
 · │  ≋     ✉     ☰     📈  │ [[ ⚡ ]]   │ · ·
 · ╰────────────────────────────────────╯ · ·
```

States: `collapsed ⇄ expanded` only; chaos fired inside shows on the
collapsed node as `⚡` badge. Nested drill (Kafka › broker-1 › host) keeps
one breadcrumb.

## Tech topic page — `TechTopicScreen`

```
 ‹ Learn            Kafka
 ────────────────────────────────────────
 ┌──────────────────────────────────────┐
 │  ●─●─●   brokers · partitions · ISR  │ ← live mini-render
 └──────────────────────────────────────┘
 A replicated, partitioned commit log. ⓘ
 ╭──────────────────────────────────────╮
 │ ◯ Anatomy tour                2 min › │
 │ ◯ One record, end to end      4 min › │
 │ ◯ Kill a partition leader     4 min › │
 │ ◯ acks=all and a slow follower 5 min ›│
 │ ◯ Rebalance storm             5 min › │
 │ ◯ Duplicates vs loss          5 min › │
 ╰──────────────────────────────────────╯
 COMPARE
 Kafka vs RabbitMQ vs SQS              ›
```

Learn tab gains two groups below TOPICS, same 2-col card grid:
`UNDER THE HOOD` (Kafka · Spark · Airflow · Celery · Temporal · Redis · nginx) and
`MACHINE LEVEL` (CPU · Memory · Paging · Chips & buses · Storage · Host
networking).

## Machine — host view

Drill-in from a compute/data node (⤢ → "Host").

```
 ·╭──────────────────────────────────────╮·
 ·│ ‹  Checkout v3 › api › host api-3    │·
 ·╰──────────────────────────────────────╯·
 ╭──────────────────────────────────────╮
 │ CPU  ▇▇▇▇ ▇▇▇▁ ▇▇▇▇ ▇▇▁▁  run-q 14 ⚠ │ ← per-core bars
 │ L3 miss 18%       ctx sw 42k/s       │
 ├──────────────────────────────────────┤
 │ RAM  ██████████████░░  56 / 64 GB    │
 │ page faults 3.1k/s ⚠   swap 0        │
 ├──────────────────────────────────────┤
 │ NVMe ▂▃▅  iowait 4%    NIC ▅▅▆ 8 Gb/s│
 ╰──────────────────────────────────────╯
 [ Diagram | Metrics ]   ← Diagram = chip layout in machine.md
```

## Machine — model player (paging)

Same chrome as `algorithms.md → Player`.

```
 ‹ Paging      Page table walk     ⓘ
 ────────────────────────────────────────
 virtual 0x0000_7F3A_2C41
   ┌ VPN 0x7F3A2 ─────────┐┌ offset C41 ┐
 TLB  [ 7F3A1→12 | 0044→03 | … ]  miss ✕
   ▼
 PML4[0] → PDPT[1] → PD[505] → PT[418]
                                   │
                                   ▼ frame 0x9C
 RAM frames  ┌──┬──┬──┬──┬──┬──┐
             │03│12│9C│  │  │  │  ← 9C lit
             └──┴──┴──┴──┴──┴──┘
 physical 0x9C C41   · 4 memory reads for 1
 ────────────────────────────────────────
 Step 4 / 7
 TLB missed, so the CPU walks 4 table
 levels — 4 extra RAM reads (~400ns).
 ────────────────────────────────────────
  ⏮    ‹    ▶    ›    ×1 ⌄
```

## Machine — model player (bus cycle)

```
 CPU ──address bus (0x1F40)──▶ mem ctrl ──▶ DRAM bank 2 row 88
     ◀──data bus (64B line)─── ◀──────────  row buffer: MISS
     ── control: RD ─────────▶               ACT → RD → PRE
 clock │▔│_│▔│_│▔│_│▔│_│▔│_│    ← cycles tick with playback
```
