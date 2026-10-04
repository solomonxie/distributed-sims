# Publishing Distributed — step by step

Every field below is ready to paste. `TODO` = only you can supply it.
App Store Connect paths start at **Apps → Distributed → Distribution →**.

| | |
|---|---|
| Bundle ID | `PRODUCT_BUNDLE_IDENTIFIER` in `app/ios/Local.xcconfig`, else `dev.distributedsims.app` |
| SKU | `distributedsims-ios` |
| Version | `1.0` (`MARKETING_VERSION`) |
| Build | timestamp, set by `make release` |
| Devices | iPhone only (`TARGETED_DEVICE_FAMILY = 1`) — no iPad screenshots needed |
| Min iOS | 15.1 |
| Privacy Policy URL | `https://github.com/solomonxie/distributed-sims/blob/master/docs/release/privacy-policy.md` |
| Support URL | `https://github.com/solomonxie/distributed-sims/issues` |

---

## 1. Apple Developer account

- [ ] developer.apple.com → Account → membership **active** (paid, Individual is fine).
- [ ] App Store Connect → **Business** (Agreements, Tax, and Banking) → no pending agreement banner. Free app: no Paid Apps agreement or banking needed.

## 2. Xcode

- [ ] Xcode → Settings → **Accounts** → signed in with the developer Apple ID; the team shows under it.
- [ ] `app/ios/Local.xcconfig` has `DEVELOPMENT_TEAM` (template: `Local.xcconfig.example`). Gitignored — never commit it; the repo is public.
- [ ] `make install` succeeds. The pod base-configuration warning is expected — `app/ios/Debug.xcconfig` / `Release.xcconfig` `#include` the Pods one, then `Signing.xcconfig` → `Local.xcconfig`. Leave it.

## 3–4. Bundle ID

Created by automatic signing on the first device build. Verify at
developer.apple.com → Certificates, Identifiers & Profiles → Identifiers → your bundle ID exists.
No capabilities needed (no iCloud, push, or App Groups).

## 5. Run on the iPhone

- [ ] `make ios-build ios-run` → Release build on the paired iPhone. Smoke-test: Home scrolls, open a System design topic → a lesson runs, a Problem → a challenge, an animation steps, New system → add components, wire, Run, Break it… → a fault, Metrics, Settings → Export, My systems → import a `.json`. Only the editor and Metrics rotate to landscape.

## 6. Create the app in App Store Connect

**Apps → + → New App**

| Field | Value |
|---|---|
| Platforms | iOS |
| Name | `Distributed: System Design Sim` |
| Primary Language | English (U.S.) |
| Bundle ID | yours (dropdown) |
| SKU | `distributedsims-ios` |
| User Access | Full Access |

If the name is taken: `Distributed Systems Sandbox` (27), `Distributed – Systems Lab` (25).
The Home Screen label stays `Distributed` (`CFBundleDisplayName`).

## 7. Listing content

Fill the pages in [App Store Connect pages](#app-store-connect-pages) below. Screenshots: see [Screenshots](#screenshots).

## 8–9. Archive and upload

```
make release
```

Builds content, runs the tests and typecheck, archives Release, signs for App Store and uploads (`scripts/release-ios.sh`, `app/ios/ExportOptions.plist`) — no Xcode clicks.
Processing in App Store Connect: 15–60 min, then an email "build has completed processing".
An "Upload Symbols Failed" warning for `hermes`/React frameworks is harmless.

Fallback, Xcode GUI: open `app/ios/DistributedSims.xcworkspace` → destination **Any iOS Device (arm64)** → Product → **Archive** → Organizer → **Distribute App** → App Store Connect → Upload.

## 10. TestFlight

- [ ] App Store Connect → **TestFlight** → the build shows no "Missing Compliance" (see [Export compliance](#export-compliance)).
- [ ] Internal Testing → **+** group `Me` → add your Apple ID → install via the TestFlight app on the iPhone.
- [ ] Same smoke test as step 5, on the TestFlight build (this is the exact binary Apple reviews).

## 11. Submit

- [ ] `iOS App → 1.0 Prepare for Submission` → **Build** → **+** → pick the build.
- [ ] Every page in [App Store Connect pages](#app-store-connect-pages) filled; App Privacy published.
- [ ] **Add for Review** → **Submit for Review**.

## 12. App Review

- Typical: 24–48 h. Status: Waiting for Review → In Review → Pending Developer Release.
- Rejection → **Resolution Center**: reply there, or fix, re-run `make release` (new build number is automatic), attach the new build, resubmit.
- Likely questions: brand names and logos (notes explain nominative use), what the app is for (notes cover it).

### Guideline 2.1 "Information Needed" (new developer accounts)

Apple wants a screen recording plus answers 2–6. The answers are the App Review Notes further down — paste them into the reply **and** into App Review → Notes.

Record the build Apple will review. If it's a new build, upload it first (`make release`), pick it under **Build** on the `1.0` page, and install it from TestFlight.

Recording (the build Apple reviews, on the iPhone, current iOS):
1. iPhone Settings → Control Center → add **Screen Recording**. Turn on Do Not Disturb.
2. Swipe the app away so it cold-starts.
3. Start recording, then launch the app from the Home Screen.
4. ~2 minutes:
   1. Home: scroll the sections (System design, Problems, Languages, Algorithms, My systems).
   2. System design → Consensus → first lesson: the guide plays, requests flow, a node is killed, a new leader is elected.
   3. Back → Problems → TinyURL: the brief, a reference design, one challenge run to pass/fail.
   4. Algorithms → Dijkstra: step forward a few times.
   5. Home → New system → From a template (API behind a load balancer) → Run → Traffic → a burst → long-press a node → Break it… → Kill → watch errors → Heal → Metrics.
   6. Settings: options, Export all systems (share sheet shown, cancelled), Reset progress shown but cancelled.
5. Stop. Photos → trim → share the video.

Reply: `App Review` in App Store Connect → the message → **Reply**, attach the video (or an unlisted link if too large), paste:

```
Hello, thank you for the review. Answers below, and the same text is now in the App Review Information notes.

1. Screen recording attached, captured on an iPhone running the latest iOS, starting from launch. The app has no account registration or login (so no account deletion flow), no user-generated content shared with others, no in-app purchases and no network access.

[paste the App Review Notes block from PURPOSE AND AUDIENCE to the end]
```

## 13. Release

- [ ] Status **Pending Developer Release** → `1.0` page → **Release This Version**. Live in the store within ~24 h.
- [ ] `git tag v1.0 && git push --tags`.

---

## Screenshots

App Store Connect slot **iPhone 6.9" Display** takes `1320 × 2868` (required).
Upload in filename order; App Store Connect scales the 6.9" set for smaller phones.

**Captured 2026-10-02** (simulator, 9 shots in `docs/release/screenshots/`, JPEG q80). To recapture:

1. `make ios-build ios-run` (Release — no dev overlay). Fresh install or Settings → Reset progress, so no half-done checkmarks.
2. Either:
   - `make tour` (needs the `make ios-build` install; App Store/TestFlight builds ignore `dsims://tour`) → full-window PNGs of the screens below in `/tmp/dsims-tour/<time>/` (no system status bar — accepted), or
   - side button + Volume Up per shot; status bar: full battery, Wi-Fi, no notifications.
3. Portrait only. Shots, in upload order (rename `01-…png` … to set the order):
   1. **Home** — sections with thumbnails (tour `home`)
   2. **Run** — a template running, particles flowing between nodes (tour `editor-run-b`/`-c`)
   3. **Chaos** — a fault fired, red nodes, errors climbing (tour `editor-chaos-fired`)
   4. **Lesson** — Consensus guide over a live Raft cluster (tour `lesson`)
   5. **Problem** — TinyURL brief with challenges (tour `problem-brief`)
   6. **Algorithm** — Dijkstra mid-step (tour `player-dijkstra-step`)
   7. **Machine level** — paging animation (tour `player-paging-step`)
   8. **Metrics** — latency/throughput charts (tour `metrics`)
   9. **Palette** — component sheet with brand icons (tour `editor-palette`)
4. Copy the chosen PNGs into one folder, e.g. `~/Desktop/shots/`, then:

```
make screenshots SHOTS=~/Desktop/shots
```

Outputs JPEG (no alpha) into `docs/release/screenshots/`. Drag the 6.9 files into the 6.9" slot.

App Preview video: skip for 1.0.

---

## App Store Connect pages

### `iOS App → 1.0 Prepare for Submission`

| Field | Value |
|---|---|
| Previews and Screenshots | [Screenshots](#screenshots) |
| Promotional Text | below |
| Description | below |
| Keywords | below |
| Support URL | `https://github.com/solomonxie/distributed-sims/issues` |
| Marketing URL | leave blank |
| Version | `1.0` |
| Copyright | `2026 solomonxie` |
| Routing App Coverage File | leave blank |
| Build | the uploaded build (step 11) |
| App Review → Sign-In Required | Off |
| App Review → Contact First / Last Name | TODO |
| App Review → Phone | TODO (with country code, e.g. `+1 …`) |
| App Review → Email | TODO |
| App Review → Notes | below |
| App Review → Attachment | none |
| Version Release | **Manually release this version** |

Promotional Text (162/170):

```
Wire up load balancers, caches, queues and databases, fire real traffic at them, then kill a node or split the network and watch what breaks. Offline, no account.
```

Description:

```
Distributed is a hands-on simulator for learning how real systems behave — and how they fail. Drag components onto a canvas, wire them together, send traffic through them, and break them on purpose.

BUILD
• Gateways, load balancers, services, databases, caches, queues, consensus groups, identity providers and more
• Start from a blank canvas or one of 255 ready-made designs
• Tap any component to tune it: replicas, timeouts, capacity, partitions, retries

RUN
• Steady load, ramps, bursts, flash crowds, hot keys, bots, per-tenant traffic
• Follow a single traced request hop by hop, or step through it one message at a time
• Live metrics: throughput, latency percentiles, errors, queue depth

BREAK
• Kill a node, partition the network, add latency or packet loss
• Clock skew, zone and region outages, split brain, poison messages
• Heal it and watch the system recover — or not

LEARN
• 150 topics, 878 short runnable lessons: caching, sharding, consistency, consensus, distributed transactions, rate limiting, microservices, serverless, multi-tenant design and more
• Networking from links to TCP, TLS and QUIC; machine level from CPU and memory to paging and storage
• Programming languages under the hood: C++, Go, Python, Java, Rust, C# and functional programming
• Machine learning and LLM internals, from linear algebra to transformers, training and serving

PRACTICE
• 20 classic system design problems — URL shortener, video streaming, chat, maps, ticket booking, key-value store, web crawler and more
• Reference designs and 42 pass/fail challenges

ALGORITHMS
• Step-through animations: Dijkstra, A*, consistent hashing, geohash, Bloom filter, Merkle tree, Raft log and common coding-interview patterns

Everything runs on your iPhone. No account, no network access, no ads, no analytics. Free.
```

Keywords (96/100 — words already in the name/subtitle are omitted; no trademarks):

```
architecture,interview,backend,scalability,cache,sharding,consensus,raft,algorithm,network,chaos
```

App Review Notes (also the Guideline 2.1 answers):

```
No account or login. The app opens straight into the Home screen; all content is built in and works offline.

PURPOSE AND AUDIENCE
Distributed is an educational simulator for software engineers, computer science students and people preparing for system design interviews. It teaches how distributed systems (load balancers, caches, databases, queues, consensus) behave under load and under failure, which is hard to learn from text alone and expensive to try on real cloud infrastructure. Users build a system on a canvas, run simulated traffic through it, inject faults, and see the effect immediately.

HOW TO USE THE MAIN FEATURES (no setup needed)
- Home: sections for System design, Network, Machine level, Tech stack, Problems, Languages, Machine learning & LLMs, Algorithms, My systems. Tap any tile.
- Lessons (e.g. System design → Consensus → a lesson): a guide narrates while the simulation runs; tap Next to advance.
- Problems (e.g. TinyURL): read the brief, open a reference design, run a challenge for a pass/fail result.
- Algorithms (e.g. Dijkstra): step forward/back through the animation.
- My systems → New system or From a template: add components from the palette, connect them, tap Run. Use Traffic for load shapes, long-press a component → Break it… to inject a fault, then Heal. Metrics shows charts.
- Settings (gear icon on Home): simulation options, haptics, export all systems, reset progress.

EXTERNAL SERVICES
None. The app makes no network requests: no analytics, advertising, crash reporting, authentication, payment or content services. All lessons and simulations are bundled in the app binary; nothing is downloaded or executed from outside. Import/export of a user's own system files uses the standard iOS file picker and share sheet.

REGIONAL DIFFERENCES
None. The app is identical in every region and is English only.

REGULATION
Distributed is an educational tool. It does not operate or connect to real infrastructure, handle money, health data or personal data, and no field it touches is regulated. Simulations are illustrative models.

THIRD-PARTY NAMES AND LOGOS
Technology names (e.g. Redis, Kafka, PostgreSQL, AWS) and well-known products used as system design case studies (e.g. YouTube, WhatsApp) are referenced only descriptively, to teach how such systems work. The app is not affiliated with or endorsed by their owners. Logos come from Simple Icons (CC0) and Devicon (MIT).

All data (saved systems, progress, settings) is stored on the device. We operate no server and receive no user data.
```

What's New: not shown for a first version. From 1.1 on, write it here.

### `General → App Information`

| Field | Value |
|---|---|
| Name | `Distributed: System Design Sim` (30/30) |
| Subtitle (30/30) | `Build systems, then break them` |
| Category — Primary | Education |
| Category — Secondary | Developer Tools |
| Content Rights | **Yes**, it contains third-party content, and I have the necessary rights (brand icons: Simple Icons CC0, Devicon MIT; names used descriptively) |
| Age Rating | **Edit** → answer below → result **4+** |
| License Agreement | Apple standard EULA (default) |
| Privacy Policy URL | `https://github.com/solomonxie/distributed-sims/blob/master/docs/release/privacy-policy.md` |

Age rating questionnaire — every answer:

| Section | Answer |
|---|---|
| Parental controls / age assurance | No |
| Unrestricted web access | No |
| User-generated content | No (saved systems stay on the device; nothing is shared in-app) |
| Messaging and chat | No |
| Advertising | No |
| Violence, sexual content, profanity, horror, mature themes | None |
| Alcohol, tobacco, drugs | None |
| Medical or treatment information / health & wellness | None |
| Gambling, simulated gambling, contests, loot boxes | None / No |
| Made for Kids | No |

Regional (Korea, China Mainland, Vietnam) — leave unset.
**Digital Services Act** trader status: **Not a trader** (free, no monetization) — if App Store Connect blocks EU availability without it, answer this in Business → Compliance.

### `App Store → Trust & Safety → App Privacy`

| Field | Value |
|---|---|
| Privacy Policy URL | same as above |
| Do you or your third-party partners collect data from this app? | **No, we do not collect data from this app** |

Then **Publish**. Label shows "Data Not Collected". `PrivacyInfo.xcprivacy` already declares no collected data and no tracking.

Still true only while there's no network code or analytics/crash SDK — re-check before each submission:

```
grep -rnE "fetch\(|XMLHttpRequest|WebSocket\(|openURL" app/src app/App.tsx
grep -rniE "analytics|firebase|sentry|amplitude|mixpanel|posthog|bugsnag|crashlytics" app/package.json app/ios/Podfile.lock
```

### `App Store → Trust & Safety → App Accessibility`

Skip for 1.0 rather than over-claim.

### `App Store → Monetization → Pricing and Availability`

| Field | Value |
|---|---|
| Base Country or Region | United States (USD) |
| Price | **Free** ($0.00) |
| Availability | All countries or regions (no China-specific gating needed: no network, no AI, no maps data) |
| Tax Category | App Store software (default) |
| iPhone and iPad Apps on Apple Silicon Macs | **Off** for 1.0 (untested on Mac) |
| Apple Vision Pro | Off |

### Not needed for 1.0

In-App Purchases, Subscriptions, In-App Events, Custom Product Pages, Product Page Optimization, Promo Codes, Game Center, Featuring Nominations, Ratings and Reviews, History.

---

## Export compliance

No page for it in App Store Connect — nothing to fill in. `ITSAppUsesNonExemptEncryption = false`
in `app/ios/DistributedSims/Info.plist` answers it at upload (the app makes no network requests and uses no encryption).
Verify: TestFlight → the build is **not** marked "Missing Compliance".
Only if it is: **Manage** → **None of the algorithms mentioned above**.

---

## Localization

English only — the app UI and content have no translations, so no 简体中文 listing for 1.0.
