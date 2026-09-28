# App Content

Source data for the app; compiled to `content/dist/` (gitignored), imported as `@dsims/content`.

- `catalog/<group>.yaml` — one group: types (knobs) + skins (brand defaults)
- `containers.yaml` — container kinds, header chips, knobs
- `chaos.yaml` — fault events (engine chaos kinds; traffic ones map to `TrafficEvent`)
- `traffic.yaml` — source shapes + quick-fire presets
- `templates/<slug>.json` — `SystemDoc` presets
- `topics/`, `problems/`, `tech/` — lessons; each lesson needs a `template`, `scenario` or `algo` (Illustration rule); an algo lesson's step may set `input` (demo preset id) to switch the player
- `icons/*.svg` — brand icons, referenced as `icon: brand:<file>`

Build: `cd scripts && npm install`, then from repo root `node scripts/build-content.mjs` (validates first, exits non-zero on errors; `--lenient` skips unparseable files). Validate only: `node scripts/validate-content.mjs`.
