# Home, see-all pages, topic page, problem brief, settings

## Home — `HomeScreen` (single page, no tab bar)

```
 Distributed Sims                     ⚙
 🔍 Search lessons, problems, animations
 ╭──────────────────────────────────────╮
 │ ▶  Continue · Consensus              │
 │    Split vote     ██████░░░░         │
 ╰──────────────────────────────────────╯
 SYSTEM DESIGN 16              See all ›
 ╭─────────────────╮ ╭─────────────────╮
 │ [◈]             │ │ [◈]          ✓  │  ← uniform tile:
 │ Caching         │ │ Sharding        │    icon · 2-line title ·
 │ ████░░  2/6     │ │ ██████  5/5     │    one meta line
 ╰─────────────────╯ ╰─────────────────╯
 ╭─────────────────╮ ╭─────────────────╮   max 2 rows (4 tiles)
 │ Consistency     │ │ Consensus       │   per section
 ╰─────────────────╯ ╰─────────────────╯
 UNDER THE HOOD · MACHINE LEVEL · C++      (same pattern)
 PROBLEMS 21        tiles: 1/3 ★ · classic
 ANIMATIONS 180     tiles = demo groups: "12 animations"
 MY SYSTEMS 3       [+ New system] then systems (parts · edited)
```

- "See all ›" pushes a page with the full grid (header title = section).
  Pages: `TopicsScreen` (group), `ProblemsScreen` (category filter),
  `AlgorithmsScreen` (all groups by Algorithms / Machine level / C++;
  a group tile → its animation list), `MySystemsScreen` (`+` in header).
- Search replaces the sections with one result list: lessons, problems,
  animations (max 40).
- Tile colours: topics accent (ok when complete), problems warn,
  animations protocol, systems write, create tiles ok.

States:
```
first-run   Continue card replaced by
            "New here? Start with Caching › Cache-aside"  ( ✕ ) [[ Start ]]
search      no match → "Nothing matches "raft2"" + ( Clear )
no systems  MY SYSTEMS: [+ New system] [From a template]
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

## Problems — `ProblemsScreen` (see all)

```
 ‹ Home         Problems
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

## My systems — `MySystemsScreen` (see all)

```
 ‹ Home        My systems              +
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
 Feedback                        2 open ›
 Version 0.1.0 (12)
```

Feedback → `FeedbackScreen`: multiline add, list (text, date, status chip, agent note); tap chip = status, long-press = delete. Stored in `Documents/feedback.json` (app-feedback contract).
