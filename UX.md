# UI/UX Spec

Companion to [DESIGN.md](DESIGN.md) — that doc covers architecture and data
schemas, this one covers the editor's screens, states, and interactions.
Mockup: [Topology Editor Mockup](https://claude.ai/code/artifact/2f2e1468-4a05-407e-b87a-d3bd721d7e53).

## Layout

Desktop-first, one screen (see "Non-goals"). Five regions, top to bottom /
left to right:

- **Top bar** (56px) — product mark, editable system-name field, then
  Presets / Cost estimate / Run (▶ idle → ⏸ while a simulation plays).
- **Palette rail** (220px, left, collapsible) — a search box, then two
  sections: **Traffic Sources** (just Load Generator — see below) and
  **Components**, grouped exactly as `catalog/catalog.yaml`'s comment
  groups (client, networking, compute, database, messaging, etl,
  serverless, orchestration & mesh). Traffic sources are visually distinct
  (dashed icon frame) since they aren't catalog entries — they configure a
  scenario, not a system.
- **Canvas** — infinite pan/zoom, dotted-grid background, nodes and edges.
- **Inspector rail** (300px, right, collapsible) — empty placeholder when
  nothing is selected; otherwise the selected component's editable specs
  and alert rules. Replaced by the **cost drawer** (340px) when cost
  estimate is open.
- **Timeline rail** (bottom, collapsed/disabled with no scenario loaded,
  ~68px expanded) — play/pause/step, scenario name, scrubber + playhead, a
  live rps sparkline, elapsed sim time.

## Interaction patterns

- **Drag a component from the palette onto the canvas** → creates an
  instance at that position with the catalog's default specs.
- **Drag a Load Generator token onto an entrypoint (or the canvas near
  one)** → creates a traffic source feeding that node. Each token is one
  named traffic profile (e.g. "Normal users", "Mobile burst") with a slider
  for request rate and a paired concurrency figure; multiple tokens can
  feed the same entrypoint and compose (their rps sums into the engine's
  `baseline`/`timeline` for that entrypoint — this is the visual authoring
  surface for the scenario YAML in DESIGN.md §6, so a token maps 1:1 to a
  timeline segment). Dragging the slider while a simulation runs re-drives
  the tick loop live, same as editing a spec. Remove a token by dragging it
  off-canvas or its context menu.
- **Click a node** → selects it, opens the inspector on its specs/alerts.
  **Click an edge** → selects it, inspector shows protocol/payload.
- **Drag from a node's edge handle to another node** → creates a
  `connects_to` connection; a small popover asks for protocol + payload
  size before committing.
- **Marquee-select** (drag on empty canvas) → multi-select for bulk
  move/delete. **Right-click a node** → context menu (duplicate, delete,
  add alert rule).
- **Keyboard**: Delete/Backspace removes the selection, Cmd/Ctrl+D
  duplicates it, Cmd/Ctrl+Z / Shift+Z undo/redo, Space+drag pans,
  Cmd/Ctrl+scroll zooms.
- **Live tweak**: editing any spec field in the inspector while a
  simulation is running re-computes and re-animates downstream effects
  immediately — no separate "apply" step. This is the core "bump 50ms to
  500ms and watch it cascade" mechanic from the mission.

## States

`empty` · `populated-static` (topology exists, nothing running) ·
`simulation-running` · `component-selected` · `edge-selected` ·
`alert-firing` (per-component, independent of selection) ·
`preset-gallery-open` (modal + scrim over a dimmed canvas) ·
`cost-panel-open` (drawer replaces the inspector rail) · `loading` ·
`validation-error` (e.g. an edge to a deleted component, a malformed
scenario reference — surfaced inline at the offending node/edge, not a
blocking modal).

## Alert severity

Three steps only, reserved exclusively for alert state so they stay
legible: **ok** (no badge — an alert that isn't firing is invisible, not
green, to avoid badge noise on a healthy system), **warning** (amber
badge + amber callout), **critical** (red badge + red callout). Nothing
else in the UI uses saturated color except the single accent (primary
actions, selection, the running-simulation indicator).

## Visual language

IBM Plex Sans for UI text, IBM Plex Mono for numeric/spec/tech values —
a technical-workbench tone (Figma/Linear/Excalidraw-adjacent), neutral
gray/off-white base so alert colors carry all the semantic weight. Every
node shows its real catalog icon (see `public/icons/`), not a generic
box — grounding the canvas in real infra rather than abstract shapes.
Light and dark are both first-class (the mockup's `dark` tweak toggles
between them); the real app should ship both from day one, not backfill
dark mode later.

## Non-goals (v1)

- No mobile/responsive canvas — this is a desktop tool, like the design
  tools it's modeled on.
- No real-time multi-user collaboration.
- No theme *toggle* required in v1 — light is the default; dark can follow
  the system preference, but a manual switch isn't essential yet.
