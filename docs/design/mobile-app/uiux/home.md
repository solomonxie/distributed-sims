# Home tabs, topic page, problem brief, settings

## Learn tab — `LearnScreen`

```
 Learn                                  
 🔍 Search topics and lessons
 CONTINUE
 ╭──────────────────────────────────────╮
 │ ┌──────────────┐ Consensus           │
 │ │ ●──◆──●      │ Split vote          │ ← live mini-render
 │ │  ╲   ╱  👑   │ 3/6 · 3 min left    │   of the lesson preset
 │ │   ●──●      │ ██████████░░░░░      │
 │ └──────────────┘         [[ Resume ]]│
 ╰──────────────────────────────────────╯
 TOPICS                         2 of 16 ✓
 ╭─────────────────╮ ╭─────────────────╮
 │ ●─•─●           │ │ ●   ●   ●       │  ← 2-col cards,
 │   ╲ ◉ cache     │ │ ╎   ╎   ╎  ▦    │    each thumbnail a
 │    ●            │ │ ●   ●   ●       │    real preset graph
 │ Caching         │ │ Sharding        │
 │ ████░░  2/6     │ │ ░░░░░░  0/5     │
 ╰─────────────────╯ ╰─────────────────╯
 ╭─────────────────╮ ╭─────────────────╮
 │ Consistency     │ │ Consensus       │
 │ ██░░░░  1/6     │ │ ████░░  2/6     │
 ╰─────────────────╯ ╰─────────────────╯
 … Distributed transaction · Rate limit ·
   Microservices · Migration · Message
   queue · Network · Proximity · Search ·
   Encryption · Authentication ·
   Observability · System paradigms
 ────────────────────────────────────────
  🎓 Learn   🧩 Problems   ◇ Algos   ▣ Mine
  ━━━━━━━━
```

Long title: "Distributed transaction" wraps to 2 lines in the card, never
truncates (cards grow to row max height).

States:
```
first-run   CONTINUE section hidden; banner:
            "New here? Start with Caching › Cache-aside"  ( ✕ )
search      no match → "No lessons match "raft2"" + ( Clear )
```

## Topic page — `TopicScreen`

```
 ‹ Learn          Consensus
 ────────────────────────────────────────
 How a cluster agrees on one value
 while nodes die and links fail.   ⓘ
 ╭──────────────────────────────────────╮
 │ ✓ Raft election             4 min    │
 │ ✓ Log replication           5 min    │
 │ ○ Split vote                3 min  › │ ← next up, bold
 │ ○ Partition minority        5 min  › │
 │ ○ Leader lease & stale le…  6 min  › │
 │ ○ Paxos single-decree       6 min  › │
 ╰──────────────────────────────────────╯
 ALGORITHMS
 Raft log replication (zoomed)        ›
 Lamport & vector clocks              ›
 USED IN PROBLEMS
 KV store · Distributed message queue ›
```

Tap lesson → Editor in Run mode, preset loaded, guide card 1/N.

## Problems tab — `ProblemsScreen`

```
 Problems
 ────────────────────────────────────────
 [ ALL | Classic | Product | Infra ]
 ╭──────────────────────────────────────╮
 │ ✉ Send email notification   ★★☆  › │ ← stars = challenges passed
 │ ⏳ Temporary email system    ☆☆☆  › │
 │ 📰 RSS news feed             ☆☆☆  › │
 │ 🔗 TinyURL                   ★☆☆  › │
 │ 🗄 KV store                  ☆☆☆  › │
 │ 📋 Craigslist                ☆☆☆  › │
 │ 💬 WhatsApp                  ☆☆☆  › │
 │ 👥 Facebook news feed        ☆☆☆  › │
 │ 🎟 Ticket booking            ☆☆☆  › │
 │ …  12 more                          │
 ╰──────────────────────────────────────╯
```

## Problem brief — `ProblemScreen`

```
 ‹ Problems        TinyURL
 ────────────────────────────────────────
 Shorten long URLs; redirect fast.
 REQUIREMENTS                         ⓘ
 • Create short link, redirect, expiry
 • 100M new links/day · 10B redirects/day
 • Redirect p99 < 50ms · 99.99% avail
 ESTIMATES                     ⌄
 Write 1.2k/s · Read 115k/s · 36 TB/5y
 DESIGNS
 ╭──────────────────────────────────────╮
 │ v1  Naive: app + one DB        ☆   › │
 │ v2  Reference: cache, ID gen   🔒  › │ ← unlocks after 1 attempt
 │ ✎   My design (edited 2h ago)      › │
 ╰──────────────────────────────────────╯
 CHALLENGES
 ╭──────────────────────────────────────╮
 │ ★ Launch day: 10k rps             ✓ │
 │ ☆ Viral link: hot key 40%         › │
 │ ☆ AZ down: keep 99.9%             › │
 ╰──────────────────────────────────────╯
 KEY IDEAS
 Snowflake IDs › · Base62 · Cache-aside › · 301 vs 302
 [[ Start from v1 ]]      ( Blank canvas )
```

## Mine tab — `MySystemsScreen`

```
 Mine                                ⚙  +
 ────────────────────────────────────────
 🔍 Search
 ╭──────────────────────────────────────╮
 │ ┌────┐ Checkout v3                   │
 │ │▫▫▫ │ 14 nodes · edited Sep 24      │ ← thumbnail
 │ └────┘                               │
 ├──────────────────────────────────────┤
 │ ┌────┐ TinyURL (my design)           │
 │ │▫▫  │ 6 nodes · edited 2h ago       │
 │ └────┘                               │
 ╰──────────────────────────────────────╯
 swipe ◀ : Duplicate · Share · Delete!
```

States:
```
empty    Nothing built yet.
         Start blank, or fork any problem's design.
         [[ New system ]]   ( Browse problems )
import   Files → .dsim.json opens here: "Imported "Checkout v3"" toast
bad file ⚠ Couldn't open "x.dsim.json": schema v9 is newer than this app.
```

`+` menu: New blank · From template (3-tier, microservices, serverless,
event-driven) · Import from Files…

## Settings — `SettingsScreen`

```
 ‹ Mine            Settings
 ────────────────────────────────────────
 SIMULATION
 Default speed                      ×1 ›
 Traced requests               1 in 50 ›
 Particle density          [ LOW | MED | HIGH ]
 APPEARANCE
 Theme                [ SYSTEM | Dark | Light ]
 Haptics                               ─●
 DATA
 Export all systems…
 Reset progress…                      !
 ABOUT
 Version 0.1.0 (12)
```
