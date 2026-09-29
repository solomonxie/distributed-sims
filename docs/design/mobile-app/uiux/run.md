# Editor — Run mode

Same `EditorScreen`; toolbar and HUD swap. Reached from `▶` in Build, or a
lesson/challenge (starts running).

## Anatomy — running, one alert, one chaos active

Build dock morphs into the Run dock; HUD chips drop under the nav pill.

```
 · · · · · · · · · · · · · · · · · · · · ·
 ·╭──────────────────────────────────────╮·
 ·│ ■   Checkout v3     ⏱ 00:42.3  ×4 ⌄  │·  ← ■ = stop, back to Build
 ·╰──────────────────────────────────────╯·
 ·  (⚠ 3)  (⚡ 1)  (⊘ 14)          · · · · ·  ← HUD chips, glass
 · · · · ╭────────────╮ · · · · · · · · · ·
 · · · · │ ◔ 📱 iOS   │ 1.2k rps · · · · · ·  ← ring sweep = util
 · · · · ╰─────┬──────╯ · · · · · · · · · ·
 · · · · · · · • · · · · · · · · · · · · · ·
 · · · · · · · ◦ ▼ · · · · · · · · · · · · ·
 · ╭────────────╮   ╭────────────╮ · · · · ·
 · │ ◔ ☁ ALB    │•─▶│ ◕ ⬡ api    │─•─┐ · ·
 · ╰────────────╯   ╰────────────╯ ✕ │ · ·
 · · · · · · · · · ·  320ms · 97%    │ · ·
 · ┌╌ ⬡ Orders ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┐   │ · ·
 · ╎ ╭──────────╮  ╭───────────╮ ╎◀──┘ · ·
 · ╎ │ ◕ ⬡ order│─▶│ ● 🐘 ordDB│⚠╎ ← red pulse
 · ╎ ╰──────────╯  ╰───────────╯ ╎ · · · · ·
 · └╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┘ · · · · ·
 · ⌐ 🔔 ordDB p99 > 500ms     ( View ) ¬ · ·
 · ╭────────────────────────────────────╮ · ·
 · │ ⏸  ├───────●──⚡──⚡──────────┤ 0:42 │ · ·  ← timeline strip
 · ├────────────────────────────────────┤ · ·
 · │  ≋     ✉     ☰     📈  │ [[ ⚡ ]]   │ · ·  ← Chaos = big, fail-red
 · ╰────────────────────────────────────╯ · ·
   Traffic Send  Log  Metrics  Break
```

Chaos gets the primary slot in Run: breaking things is the point.

## You fire the requests

Background traffic runs unseen (it sets the conditions: bursts, overload). The canvas shows only requests you send.

```
 ╭─ ● Link cache is 96% busy ─────────────────╮  ← status line
 · · · ╭──────────╮ · · · · · · · · · · · · ·
 · · · │  users   │ · · · · · · · · · · · · ·
 · · · ╰────┬─────╯ · · · · · · · · · · · · ·
 · · · ╔════╧═════╗  ← waiting: box pulses,  ·
 · · · ║ URL svc  ║    bar fills over the wait ·
 · · · ╚══════════╝ ▁▁▁▁▁▁▂▂▂ · · · · · · · · ·
 ╭──────────────────────────────────────────╮
 │ ● WAITING  ━━━━━━━━━░░░░░░  5/12       ✕ │  ← tip docks on the half
 │ Inside URL service: 480 ms               │    away from the request
 │ It is nearly full, so requests wait in   │
 │ line before they are handled.            │
 │ [97% busy] [traffic ×20]                 │
 │ ❶❷❸❹(5)⑥⑦⑧⑨⑩⑪⑫                         │  ← every step; tap one for details
 ╰──────────────────────────────────────────╯
```
 (‹)(⋯)   (⏮) ╭──────────────╮        (➤)
               │ ⏭ Next step  │            ← Next centred and largest;
               │    4 of 17   │              Prev small beside it
               ╰──────────────╯
```

- No play or replay button. Next's label follows the state: "Send & step" (nothing in flight: sends one request and plays its first hop) · "Next step · i of n" (+ "· halfway" while the dot waits mid-link) · "Stop here" (while playing through) · "Run ended" (disabled; ⋯ → Replay from the start).
- ➤ (small, outlined) sends without stepping; long-press: read / write / 5, 20, 100 at once / send from another client.
- ⋯ holds the rest: Replay from the start · Play through (no stops) / Stop at every step · Speed… · Pause / Resume simulation, then the usual items.
- One request at a time, on its own clock: it holds at the start of every step until Next. A travelling dot (request, response, protocol message) also stops halfway along its link: tap it for its details, Next again carries it to the target (two Nexts per hop; waits inside a component and Done take one). The button caption adds "halfway" while it waits there. The simulation keeps running underneath (metrics, lesson checks) but nothing else is drawn while stepping: background protocol dots (heartbeats, fetch loops, votes) appear only in play-through.
- Steps: TCP handshake (SYN → SYN-ACK → ACK) the first time a connection is used in the run (every call when the edge has keepAlive off) · each call · time inside a component · protocol messages it sent for this request (2PC PREPARE → votes → COMMIT → acks, saga steps / compensations, Kafka Produce → follower Fetch → ack) · each response · Done · then "After the reply" steps (↳): async work the request set off (replication, consumer fetch + offset commit, queue delivery + ack). The sim runs ahead until the request's messages go quiet (1.5 s sim, max 8 s) before playing.
- ≣ in the tip → "This request, step by step": the numbered list, current step marked; tap → details. Tapping a dot also holds it and opens its details.
- Details: curl-style request/response plus NETWORK LAYERS, nested: L2 Ethernet (MACs) ⊃ L3 IP (addresses, TTL) ⊃ L4 TCP (ports, flags, seq/ack) ⊃ L7 payload (HTTP line, SQL, RESP, or `PREPARE TRANSACTION 'id'`).
- Speed: ⋯ → Speed… lists 0.1×–10×.

- Send (➤) sends one request from the client (the one with traffic, else the first). Long-press: read (GET) / write (POST) / 5, 20 or 100 at once / send from another client.
- Tap a client (users, devices, bots) → inspector SEND REQUESTS: Read/Write + ( ➤ Send ) ( ×5 ) ( ×20 ) ( ×100 ) from that client.
- Break: no dock button. Tap a component or region → inspector "Break it…", or long-press it → "Break it…"; both open that target's faults. ⋯ has none.
- The request's fate is resolved first (sim runs ahead), then it plays beat by beat: travel, wait inside (only when ≥ 5 ms), reply, and a final "Done: 301 in 41 ms".
- No answer (component down, packet dropped): dot reaches the dead component, the caller waits ("Waiting for Link cache…" until its timeout), then a red return; every layer above fails in turn.
- Tip phases: REQUEST (blue) · WAITING (amber) · RESPONSE (green) · FAILED (red) · DONE. Chips: down, ⚡ fault, % busy, queue, traffic ×N. Tap → full curl-style details. ✕ hides; ⋯ → Show request tips.
- Requests you send queue and play one after another; a request you send takes over from one a lesson picked.
- Same everywhere: lessons, challenges, sandbox. Nothing travels until you Send or tap Next.
- Every design has its own API (`wire` in the template): host, read/write route, table, cache key, topic.
- Protocol dots (heartbeats, votes, 2PC prepare/commit) only on consensus / coordination designs, max 24: one per connection at a time, 0.6× request speed, each drawn whole from its start; ones older than ~2 s are skipped.

## Stepping

```
 ╭──────────────────────────────╮
 │  ⏮     ⏸     ⏭  │   1×    │
 │ Back  Pause  Next │ Speed   │
 ╰──────────────────────────────╯
```

- One step = the followed (bright) request moves to its next component, then pauses. Other dots move by the same time.
- ⏭ plays until that arrival; ⏮ returns to the previous arrival (engine replays to that moment, same seed).
- Checkpoints are taken at every arrival, while playing too (last 60).
- Not ±10 s skips: sim time is abstract here, and a jump loses the request you're following. Time jumps live in the event log (tap an event).

## States

```
starting   ⟳ Warming up…  (first 1s virtual, metrics hidden)
paused     ⏸ → ▶ ; particles frozen; canvas still pannable; tap node = Inspector RUN tab
fast       ×10+  particles → edge heat automatically; HUD shows "×40 · heat view"
overload   engine behind real time: ⏱ chip turns amber "×4 → ×2.3 actual"
all dead   every entry point erroring: banner "Nothing is getting through" ( Heal all )
ended      scenario end reached: auto-pause; challenge → Result sheet (insights.md)
```

## Traffic sheet — `TrafficSheet`

```
 ▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁
 Traffic                        ✕
 SOURCES
 ╭──────────────────────────────╮
 │ 📱 iOS app    1.2k rps  ▂▃▅ ›│
 │ 🌐 Web          400 rps  ▅▅▅ ›│
 ╰──────────────────────────────╯
 QUICK FIRE → iOS app ⌄
 ┌──────────┬──────────┬──────────┐
 │ ⇈ Burst  │ ↗ Ramp   │ ⚡ Flash  │
 │ 20× · 5s │ ×3 · 30s │  crowd   │
 ├──────────┼──────────┼──────────┤
 │ 🔥 Hot   │ 🤖 Bots  │ 🔁 Herd  │
 │ key 40%  │ DDoS     │ retries  │
 └──────────┴──────────┴──────────┘
 ( Edit schedule on timeline… )
```

Source detail (push inside the sheet):

```
 ‹ Traffic      iOS app
 Shape    [ CONSTANT | Ramp | Diurnal | Replay ]
 Rate                ├──────●────┤ 1.2k rps
 Reads / writes      ├───────●───┤ 90 / 10
 Keys        [ Uniform | ZIPF | Hot key ]   s = 1.1 ›
 Tenants     acme 60% · globex 30% · tiny 10%   ›
 Regions     us 70% · eu 30%                   ›
 Auth        valid 98% · expired 2%            ›
```

## Chaos sheet — `ChaosSheet`

```
 ▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁
 Break something                ✕
 🔍 Search 38 events
 ACTIVE (1)
 ⟂ Partition api ⟂ ordDB  0:12 left ( Heal )
 NODE
 ┌──────────┬──────────┬──────────┐
 │ ☠ Kill   │ 🐢 Slow  │ ♻ GC     │
 │          │ ×10      │ pause 2s │
 ├──────────┼──────────┼──────────┤
 │ 💾 Disk  │ 🧠 Leak  │ 🐛 Bad   │
 │ full     │ → OOM    │ deploy   │
 └──────────┴──────────┴──────────┘
 NETWORK
 ⟂ Partition · +Latency · Loss % · DNS fail · Cert expired
 DATA
 🔥 Hot key · Replica lag · Cache flush · Split brain · Lost write
 TIME   ⏰ Clock skew · Clock jump
 INFRA  ◫ AZ down · 🌎 Region down · External API outage
 PROTOCOL  👑 Kill leader · Kill coordinator after prepare
 [ Heal all ]
```

Tile tap → optional params popover (duration, magnitude; defaults
pre-filled) → targeting mode:

```
 targeting (2 targets: partition)
 ┌──────────────────────────────────────┐
 │ ⟂ Tap the first side     ( Cancel )  │
 └──────────────────────────────────────┘
 · canvas dimmed · valid targets glow ·
 tap api ↓                     tap ordDB ↓
 "Tap the other side"          ⟂ drawn, toast "Partitioned for 30s"
```

Build mode: same sheet, title "Schedule chaos", plus `At 0:30` field;
result is a marker on the timeline instead of firing.

## Timeline — `TimelineBar` / `TimelineSheet`

```
 bar (docked)
 ⏮ ⏸ ⏭  ├──≋────●──⚡──⚡────────┤ 0:42 / 2:00
          ↑ traffic change   ↑ chaos markers; drag ● = scrub (rewind)

 expanded (swipe up on bar)
 ▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁
 Timeline                  ×4 ⌄ ✕
 0:00      0:30      1:00     1:30
 ≋ iOS  ━━━━━━━━╱▔▔▔▔▔╲━━━━━━━━━  ← ramp
 ⚡      ·     ⟂━━━━━┥   ☠        ← chaos lanes
 ⚠      ·        ▮▮▮▮▮▮▮          ← alerts fired
                  ●               ← playhead
 + Add at playhead…
 Seed 48213  ( Replay same run )
```

Scrubbing back: canvas shows "⏪ Rewinding…" ≤ 300ms, then paused at that
time; live chaos fired earlier stays as markers.

## Send one — trace a single request

```
 tap ✉ → targeting "Tap a client"  → tap 📱
 ⦿ one large traced particle, camera follows, others dim to 30%
 each hop pops a label: "ALB 1ms" "api 22ms" "ordDB 804ms ⚠"
 end → toast "812ms · 4 hops"  ( Open trace › )
```

## Event log sheet — `EventLogSheet`

```
 ▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁
 Events                         ✕
 [ ALL | Alerts | Chaos | Protocol ]
 0:42.1 🔔 ordDB p99 > 500ms
 0:30.0 ⟂ Partition api ⟂ ordDB (30s)
 0:18.4 👑 etcd-2 elected leader, term 4
 0:18.2 🗳 etcd-3 voted etcd-2 (term 4)
 0:12.0 ☠ etcd-1 killed
 tap row → timeline jumps there (paused), node selected
```

Empty: "Nothing yet. Fire traffic or chaos to see events."

## Dot details (curl-style)

Tap a dot → pause → what's on the wire, in the destination's own protocol.

```
 ⤶  Response · 301                        ✕
    users → cdn · HTTP/2
 REQUEST
 ┌───────────────────────────────────────┐
 │ > GET /pFqEwDz HTTP/2                 │
 │ > host: sho.rt                        │
 │ > user-agent: Mozilla/5.0 (iPhone…)   │
 └───────────────────────────────────────┘
 RESPONSE · 3.2 ms   ● this dot
 ┌───────────────────────────────────────┐ ← outlined in green / red
 │ < HTTP/2 301 Moved Permanently        │
 │ < location: https://blog…/posts/1234  │
 │ < x-cache: Hit from cloudfront        │
 └───────────────────────────────────────┘
 Whole request: 41 ms · succeeded
 [ Follow this request end to end ]
```

- Format by destination type: HTTP (edge, services), RESP (cache), SQL (relational), KV (Dynamo-style), Kafka, gRPC (id-gen, coordination), ES, S3.
- Values come from the sim: key, op, value, version, stale, error kind, time inside, cache hit/miss (did it call further?).
- Errors read like the real tool: `curl: (28) … timed out`, `Connection refused`, `503`, `FATAL: too many clients`, `DEADLINE_EXCEEDED`.
- Per-design API shape in the template's `wire` block (host, paths, status, table, cache prefix); generic `/api/items/{key}` otherwise.
- Code: `app/src/sheets/wire.ts`.

## Break a client = more traffic

⚡ → tap a client → MORE TRAFFIC tiles (Burst, Flash crowd, Hot key, Ramp, Bots…) above its faults.
