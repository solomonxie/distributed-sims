# Working in this repo

## Running the app

- **Physical iPhone only.** Never build for, install on, launch, or screenshot a
  simulator — not to check a change, not as a fallback. Only when explicitly
  asked, that one time.
- Install: `make ios-build ios-run` (or `cd app && npm run ios` — Release build, JS embedded.
- **No dev server.** No Metro server, no `npm start`, no `run-ios` without
  `--no-packager`. `AppDelegate.bundleURL` always reads the embedded
  `main.jsbundle`; install to see a change. (Metro still runs inside the Xcode
  build phase as the bundler — a build step, not a server.)
- **No device connected → stop and say so.** Don't fall back to a simulator.
- Everything else (typecheck, tests, lint, reading code) is the default way to
  verify a change.
