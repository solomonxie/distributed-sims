# UI/UX — Distributed Sims (iOS)

Product reasoning: `DESIGN.md`. Written against the `uiux` skill
(`notation.md`, `text-figma.md`, `mobile.md`). iPhone first, 60-col mocks.
Drawings live in `uiux/`; this file is the map, flows and rules.

## Screen map

```
                ┌──────────── tab bar ─────────────┐
                │ Learn │ Problems │ Algos │ Mine  │
                └──┬────────┬──────────┬───────┬───┘
                   │        │          │       │
             Topic list  Problem    Algo list  My systems ──⚙──▶ Settings
                   │     list          │       │
                   ▼        ▼          ▼       │  [ + New ] / open
             Topic page  Problem     Algo      │
                   │     brief       player    │
                   │        │                  │
                   └──tap lesson / design──────┴──────▶ Editor (page)
                                                          │
                     ┌────────────────────────────────────┤
                     │ sheets over the canvas             │ mode
                     ▼                                    ▼
            Palette · Inspector · Edge          Build ◀──▶ Run
            Container · Traffic · Chaos                    │
            Timeline · Event log              ┌────────────┼────────────┐
                                              ▼            ▼            ▼
                                         Metrics      Trace /      Result sheet
                                         (page)       Sequence     (challenge)
                                                      (sheet)
     [share sheet] [Files import]  ← OS-owned
```

## Surfaces

| Surface | Kind | Why |
|---|---|---|
| Tabs: Learn · Problems · Algorithms · Mine | tab pages | four equal entry points; Mine = sandbox |
| Topic page, Problem brief | pushed page | read-heavy, scrolls, has its own children |
| Editor | full-screen page, tab bar hidden | canvas needs every pixel |
| Palette, Inspector, Edge, Container, Traffic, Chaos | bottom sheet, 3 detents | keep canvas visible above; one-handed |
| Timeline | docked bar → expands to sheet | always-on in Run, cheap glance |
| Event log, Trace/Sequence | sheet (large) | transient deep-dive, back to canvas |
| Metrics | pushed page | multi-chart, scrolls, rotates to landscape |
| Algorithm player | pushed page | own canvas + playback bar |
| Challenge result | sheet (medium) | end-of-run summary, one action |
| Settings | pushed page | standard list |

## Core flows

```
Learn a pattern
 Learn ─▶ Consensus ─▶ "Raft election" ─▶ Editor(Run, guide card 1/4)
   └ guide: "Kill the leader" ─▶ tap ⚡ ─▶ Kill ─▶ tap n1 ─▶ election plays
   └ check passes ─▶ ✓ card ─▶ Next lesson ›      error: n/a (sim)

Solve a problem
 Problems ─▶ TinyURL ─▶ brief ─▶ [ Start from v1 ] ─▶ Editor(Build)
   ─▶ add Redis, wire ─▶ ▶ Run challenge ─▶ Result: ✗ p99 212ms > 50ms
   ─▶ ( Try again ) / ( See reference v2 )

Build from scratch
 Mine ─▶ [ + New ] ─▶ Editor(empty) ─▶ + ─▶ drag "service" to canvas
   ─▶ drag port ● to DB ─▶ edge sheet ─▶ ▶ ─▶ default traffic 100 rps

Break things live
 Run ─▶ ⚡ ─▶ Partition ─▶ tap node A, tap node B ─▶ ⟂ drawn on edge
   ─▶ alerts toast ─▶ tap toast ─▶ node inspector (Run tab)
   ─▶ ⏪ rewind 10s on timeline ─▶ try a different fix

Visualize an algorithm
 Algos ─▶ Dijkstra ─▶ player(sample graph) ─▶ ▶ / step › ─▶ path lit
   └ Google Maps brief "Routing ⓘ" ─▶ same player, city graph
```

## Interaction rules

- **Animation speed, not simulation speed.** One unit everywhere: at 1× every dot moves 140 pt/s (min 250 ms per hop); the user picks 0.1×–10×. Featured requests replay hop by hop; protocol messages (heartbeats, votes) are drawn live at the same pace. Sim clock runs at 0.15× (challenges 0.5×), scaled by the same control.

- **Drag from palette**: long-press a tile ⇒ sheet drops to peek, a ghost
  follows the finger; release on canvas = node placed; release on sheet =
  cancel. Tap a tile = place at canvas centre (accessibility path).
- **Connect**: every selected node shows a port `●`; drag it to another
  node. Tap-tap alternative: `Connect` in the node menu, then tap target.
- **Canvas**: 1-finger pan on empty space, pinch zoom, tap select,
  long-press node = context menu, double-tap container = collapse/expand.
- **Semantic zoom**: < 40% zoom ⇒ nodes become dots + label, containers
  show aggregate health; particles fade to edge heat.
- **Targeting mode** (chaos): canvas dims, valid targets glow, banner on
  top says what to tap; `Cancel` in banner.
- **Undo/redo**: build edits only. Run is undone by rewinding the timeline.
- Haptics: light on snap/connect, warning on alert fire, success on pass.
- Rotation: Editor and Metrics support landscape; tab pages portrait only.
- Explanations behind ⓘ (per `mobile.md`), never under every heading.

## Files

| File | Covers |
|---|---|
| `uiux/visual.md` | colour, type, space, motion, canvas rendering, chrome — the look |
| `uiux/components.md` | node, edge, particle, container, port, HUD chips, sheet header, toasts |
| `uiux/home.md` | the four tabs, topic page, problem brief, settings |
| `uiux/editor.md` | Build mode: canvas, toolbar, palette, inspector, edge, container sheets |
| `uiux/run.md` | Run mode: HUD, traffic, chaos + targeting, timeline, alerts, event log |
| `uiux/insights.md` | Metrics page, trace + sequence view, challenge result |
| `uiux/tech.md` | Under the hood + Machine level: drill-in, tech topic page, host view, model players |
| `uiux/algorithms.md` | algorithm list + player |

## Visual language

"Night-shift control room": dark calm canvas, floating glass chrome, only
live things glow. Full spec: `uiux/visual.md`.

## Accessibility

- VoiceOver: every node is an element: "orders-db, Postgres, degraded, p99
  840 milliseconds". Canvas has a rotor "Nodes" list as a non-spatial path.
- Every drag has a tap path (palette tap-to-place, Connect menu item).
- Reduce Motion ⇒ particles off, edge heat only.
- Dynamic Type on all sheets/pages; canvas labels capped at XL.

## Deviations from the `uiux` skill

- Palette/Inspector are **sheets**, not in-place pickers: they're not form
  fields, and the canvas above them is the context to keep visible (the
  skill's own exception: "a control that isn't part of a form").
- Otherwise none.
