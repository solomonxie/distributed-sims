# The editor

Desktop-only, one screen. Five regions.

## Empty — nothing on the canvas yet

```
┌──────────────────────────────────────────────────────────────────────┐
│ ◆ Distributed Systems Simulator   Untitled System                    │ 56px
│                            [ Presets ] [ Cost estimate ] [[ ▶ Run ]]·│
├──────────────┬──────────────────────────────────┬────────────────────┤
│ 🔍 Search    │                                  │ Nothing selected   │
│  components… │                                  │ Click a component  │
│              │        ⌁ Drag a component here   │ on the canvas to   │
│ TRAFFIC      │        or start from a preset    │ inspect it.        │
│ SOURCES      │                                  │                    │
│ ┌╌╌╌╌╌╌╌╌┐   │        · · · · · · · · · ·       │                    │
│ ╎ ⚡ Load  ╎   │        · dotted grid · · ·       │                    │
│ ╎ Generator╎  │        · · · · · · · · · ·       │                    │
│ └╌╌╌╌╌╌╌╌┘   │                                  │                    │
│  ↑ dashed: not│                                 │                    │
│  a catalog    │                                 │                    │
│  entry — it   │                                 │                    │
│  configures a │                                 │                    │
│  scenario     │                                 │                    │
│ COMPONENTS    │                                 │                    │
│ ⌄ client      │                                 │                    │
│   ⚛ react-spa │                                 │                    │
│ ⌄ networking  │                                 │                    │
│   🦍 kong     │                                 │                    │
│   ☁ aws-api-  │                                 │                    │
│      gateway  │                                 │                    │
│   ▲ nginx-lb  │                                 │                    │
│ › compute     │                                 │                    │
│ › microservices                                 │                    │
│ › database    │                                 │                    │
│ › messaging   │                                 │                    │
│ › etl         │                                 │                    │
│ › serverless  │                                 │                    │
│ › orchestration                                 │                    │
├──────────────┴──────────────────────────────────┴────────────────────┤
│ Load a scenario to simulate traffic                            ·     │ 68px
└──────────────────────────────────────────────────────────────────────┘
  220px           infinite pan/zoom                  300px
```

Every node shows its **real catalog icon**, never a generic box — the
canvas has to read as real infrastructure. Ten palette groups, in
`catalog.yaml`'s own order; 31 components today.

## Running — a simulation playing, an alert firing

```
┌──────────────────────────────────────────────────────────────────────┐
│ ◆ Distributed Systems Simulator   Sample E-commerce Microservices    │
│                            [ Presets ] [ Cost estimate ] [[ ⏸ Pause ]]│
├──────────────┬──────────────────────────────────┬────────────────────┤
│ 🔍 Search…   │  ┌╌╌╌╌╌╌╌╌╌╌╌╌┐                  │ orders-db          │
│ TRAFFIC      │  ╎ Normal users╎──▶ ⚛ react-spa   │ postgres ·         │
│ SOURCES      │  ╎ 80 req/s ·  ╎      │           │ relational-db      │
│ ┌╌╌╌╌╌╌╌╌┐   │  ╎ 12 concurr. ╎      ▼           │ ───────────────    │
│ ╎ ⚡ Load  ╎  │  ╎ ├──●────────╎  🦍 kong         │ SPECS              │
│ └╌╌╌╌╌╌╌╌┘   │  └╌╌╌╌╌╌╌╌╌╌╌╌┘      │           │ avg response  500  │
│ COMPONENTS   │  ┌╌╌╌╌╌╌╌╌╌╌╌╌┐      ▼           │ ms                 │
│ …            │  ╎ Mobile burst╎  ⚙ order-svc     │ max rps       200  │
│              │  ╎ 310 req/s · ╎      │           │ pool size      20  │
│              │  ╎ 64 concurr. ╎      ▼           │ ───────────────    │
│              │  ╎ ├────────●──╎  🐘 orders-db ⛔  │ ALERTS             │
│              │  └╌╌╌╌╌╌╌╌╌╌╌╌┘  p99 640ms ·      │ Orders DB Latency  │
│              │   ↑ each token is one named       │ Spike              │
│              │     traffic profile; they sum     │ firing · critical  │
│              │     into the entrypoint's rps     │ p99 > 500ms        │
│              │  ⛔ CRITICAL  Orders DB Latency    │ ───────────────    │
│              │     Spike — p99 640ms             │ [ + Add alert rule]│
├──────────────┴──────────────────────────────────┴────────────────────┤
│ ⏸  ⏭  incident-orders-db-slow                                        │
│ ├────────────●────────────────────────────┤  ▁▂▃▅▇▅▃  390 rps  1m 12s│
└──────────────────────────────────────────────────────────────────────┘
```

Dragging a token's rps slider **while it runs** re-drives the tick loop
live — the same as editing a spec. There is no "apply".

## Interactions, drawn

```
 palette component ──drag──▶ canvas      instance at that point, catalog
                                          defaults
 ⚡ Load Generator ──drag──▶ entrypoint    a traffic source feeding it;
                                          drag off-canvas to remove
 node edge handle ──drag──▶ node          ┌────────────────────┐
                                          │ Protocol   HTTP  ▾ │ popover,
                                          │ Payload    2 KB    │ asks before
                                          │ ( Cancel ) [[ Add ]]│ committing
                                          └────────────────────┘
 click node   ⇒ inspector: specs + alerts
 click edge   ⇒ inspector: protocol + payload
 drag empty canvas ⇒ marquee multi-select (bulk move / delete)
 right-click node  ⇒ Duplicate · Delete · Add alert rule
 Delete/Backspace remove · ⌘D duplicate · ⌘Z / ⇧⌘Z undo/redo
 Space+drag pan · ⌘+scroll zoom
```

## States

```
 empty              the drop hint above
 populated-static   topology, nothing running; ▶ Run enabled
 simulation-running ⏸ in the top bar, accent indicator, live timeline
 component-selected / edge-selected   inspector fills
 alert-firing       per node, independent of selection
 preset-gallery-open  modal + scrim, canvas dimmed
 cost-panel-open    a 340px drawer replaces the inspector rail
 loading            skeleton rails; the canvas keeps its grid
 validation-error   inline at the offending node/edge — never a blocking
                    modal (an edge to a deleted component, a bad scenario
                    reference)
```

## Alert severity — three steps, reserved

```
 ok        no badge at all       ← an alert that isn't firing is invisible,
                                   not green: a healthy system shows no
                                   badge noise
 warning   ▲ amber badge + amber callout
 critical  ⛔ red badge + red callout
```

Nothing else in the UI uses saturated colour except the single accent
(primary actions, selection, the running indicator), so alert colour
carries all the semantic weight.

## Type

```
 IBM Plex Sans   UI text
 IBM Plex Mono   every numeric / spec / tech value (500 ms, 94%, p99 640ms)
 neutral gray / off-white base; light and dark both first-class from day one
```
