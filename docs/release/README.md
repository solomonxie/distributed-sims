# App Store Release

Bundle ID from `app/ios/Local.xcconfig` (default `dev.distributedsims.app`) · iOS 15.1+ · iPhone only.

- [`listing.md`](listing.md) — step-by-step plan and every App Store Connect field, ready to paste
- [`privacy-policy.md`](privacy-policy.md) — the policy; its GitHub URL is the Privacy Policy URL
- `screenshots/` — upload-ready, from `make screenshots SHOTS=<dir>` (not captured yet, see listing)

Signing: `app/ios/Local.xcconfig` (gitignored) holds `DEVELOPMENT_TEAM`, optionally `PRODUCT_BUNDLE_IDENTIFIER`;
`app/ios/Signing.xcconfig` has placeholders only. This repo is public — keep account identifiers out of it.

Upload a build: `make release` — content build + tests + typecheck, archive, sign, upload. No EAS, no Expo, nothing in Xcode.
Build number is a timestamp unless you pass `BUILD=`.

Versioning: `MARKETING_VERSION` in `project.pbxproj` is the user-visible version (also `VERSION` in
`SettingsScreen.tsx`); bump both per release. `CURRENT_PROJECT_VERSION` is set per upload by the script and never committed.
