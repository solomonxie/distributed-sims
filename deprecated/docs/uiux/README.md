# UI/UX mockups — Distributed Systems Simulator

> The editor is **designed, not built yet** (`src/App.tsx` is a placeholder).
> These drawings are the spec's own layout, states and interactions, drawn —
> the same thing `design/mockups/*.dc.html` renders in HTML.

`../../DESIGN.md` carries the architecture and schemas; `../../UX.md` the
rules and the reasoning. These files carry the pictures.

Glyphs follow the `uiux` skill (`references/notation.md` + `text-figma.md`):
`[[ x ]]` primary · `[ x ]` secondary · `▶/⏸` run state · `⌄`/`›` open /
collapsed · `←` annotation · `·` disabled.

## Screen map

```
 one desktop screen, five regions
 ┌ top bar ──────────────────────────────────────────────┐
 │ palette │            canvas            │  inspector   │
 │  rail   │                              │  ↔ cost      │
 │         │                              │    drawer    │
 ├─────────┴──────────────────────────────┴──────────────┤
 │ timeline rail                                         │
 └───────────────────────────────────────────────────────┘
 modals: preset gallery (scrim over a dimmed canvas)
 popovers: connection protocol/payload, node context menu
```

## Files

| File | Covers |
|---|---|
| `editor.md` | the five regions, empty → populated → running |
| `inspector.md` | component specs, alerts, edges, cost drawer, presets |
