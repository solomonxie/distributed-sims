# Visual system

Direction: **"night-shift control room"** — a dark, calm canvas where the
only bright things are what's alive: traffic, health, alerts. Chrome
floats in glass over the canvas and gets out of the way. Tokens live in
`app/src/theme/tokens.ts`; nothing hard-codes a colour or number.

## Principles

- **Canvas is the hero.** No full-width bars in the editor: nav and dock
  are floating glass pills; the canvas runs edge to edge under them.
- **Light = activity.** Idle things are muted greys; motion, glow and
  saturation are reserved for traffic, health changes and alerts.
- **Calm chrome.** Neutral near-black surfaces, one soft indigo accent for
  the primary action and progress, muted status colours. Tile icons stay
  neutral; colour marks only progress and completion. Semantic colours
  (health, op types) never double as accents.
- **Numbers never jitter.** Tabular SF Mono for every live figure.
- **Everything springs, nothing fades in slow.** 200–350ms, spring-based.

## Colour tokens

Two palettes (`theme/tokens.ts`): `palette` for app chrome (`useTheme().c`)
and `canvasPalette` for the animations (`useTheme().k`: algorithm frames,
system canvas). The canvas palette keeps the original neon set until the
animations get their own pass. Dark only for now.

```
 chrome (palette)      dark             light (parked)
 bg.canvas             #0F1012          #F6F6F4
 surface.1  (cards)    #17181B          #FFFFFF
 surface.2  (raised)   #1F2023          #F0F0EE
 glass                 #17181B @ 78% + blur
 stroke.hairline       #FFFFFF @ 7%     #000000 @ 6%
 text.primary          #ECECEE          #1C1C1E
 text.secondary        #9B9CA2          #6B6B70
 text.tertiary         #64656B          #A1A1A6
 accent                #A3AEF5          #4F5BD5   (on-accent #111217 / #FFF)
 health ok/warn/fail   #86C3A3 #DDB679 #E39494
 op read/write/proto   #96B4E0 #DFAA85 #B7A8E6

 canvas (canvasPalette, unchanged)
 bg #0A0D14 · accent/read #5CE1FF · write #FF9F5C · protocol #B28CFF
 ok #3DDC97 · warn #FFB547 · fail #FF5C6C
```

Contrast: text.primary / secondary on surface.1 ≥ 7:1 / 4.5:1. Health
colours always paired with a glyph (✓ ⚠ ✕ ⟂) — colour-blind safe.

## Type

```
 display   SF Pro Display  34 / bold      tab page titles (large title)
 title     SF Pro Display  22 / semibold  sheet titles, brief headings
 headline  SF Pro Text     17 / semibold  row titles, node names (canvas 13)
 body      SF Pro Text     15 / regular
 caption   SF Pro Text     12 / medium, +2% tracking, UPPERCASE section headers
 mono      SF Mono         13 / medium, tabular — every metric, clock, id
```

Dynamic Type on everything but canvas labels (capped at XL).

## Space, radius, elevation

```
 space   4 · 8 · 12 · 16 · 24 · 32         (4-pt grid)
 radius  node 14 · card 16 · sheet 28 · pill 999 · chip 10
 hit     ≥ 44×44 everywhere; ports have a 44pt invisible hit halo
 elev    canvas 0 · node 1 (soft shadow) · glass chrome 2 · sheet 3 · toast 4
```

## Canvas rendering (Skia)

```
 node       ╭──────────────╮   surface.1, 1px hairline, radius 14
            │ ◉ 🐘  ordDB  │   ◉ = health ring around the icon:
            │    12ms  64% │       stroke 2pt, sweep = utilisation
            ╰──────────────╯   selected: 2pt accent outline + outer glow 12
 container  dashed 1pt hairline, 8% tinted fill, header chip top-left
 edge       1.5pt text.tertiary; running: gradient in op colour @ 40%
 particle   2–7pt disc + additive glow (blur 6, 60%); trails 120ms
 alert      node pulses: glow in health.fail, 1.2s ease, ≤ 3 pulses then steady
 grid       dots every 24pt at 100%; fade out below 40% zoom
```

Particles and glows cap at 800 on screen; beyond that, edge heat
(width 1.5→6pt ∝ log rps).

## Chrome

```
 floating nav pill (editor)          floating dock (editor, bottom)
 ╭───────────────────────────────╮   ╭─────────────────────────────╮
 │ ‹  Checkout v3 ⌄     ↶ ↷      │   │  +   ⇢   ▦   ≋  │ ▶  Run   │
 ╰───────────────────────────────╯   ╰─────────────────────────────╯
  glass, 12pt from safe area          glass, 12pt above home indicator;
                                      Run = accent filled segment
```

Sheets: glass background, 28 radius, grabber, large title left-aligned.
Tab pages: standard iOS large titles, surface.1 cards, 16 radius.

## Motion

| Thing | Motion |
|---|---|
| Sheet detent change | spring (damping 22, stiffness 240) |
| Node placed | scale 0.85 → 1, spring; haptic light |
| Connect snap | edge draws from source to target 180ms; haptic light |
| Mode Build → Run | dock morphs (shared-element), grid dims 30%, HUD chips slide down |
| Chaos fired | shock ring from target, 400ms; haptic heavy |
| Alert fires | node pulse + toast drop; haptic warning |
| Challenge pass | ★ scales in with confetti of particles in accent (1s) |

Reduce Motion: no pulses, no trails, no confetti; crossfades only.

## Thumbnails

Every lesson / problem / system card shows a **live mini-render** of its
preset graph (Skia, static frame, health colours, 2–3 particles frozen
mid-edge). Cards look like the thing they open — no stock icons.

## Icons

SF Symbols for chrome (`plus`, `arrow.triangle.branch`, `square.dashed`,
`waveform.path`, `bolt.fill`, `play.fill`…). Brand icons for component
skins (SVG, monochrome-tinted in text.primary; brand colour only on
selection). Emoji in mockups stand in for these.

## App icon

Dark tile, three nodes in a triangle joined by cyan edges, one violet
particle mid-edge. No text.
