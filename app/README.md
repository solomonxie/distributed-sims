# Distributed Sims App

Bare React Native iOS app. Physical iPhone only, no Metro server — the JS bundle is embedded at build time.

```sh
npm install && (cd ios && pod install)
npm run ios        # Release build → connected iPhone
```

Or from the repo root: `make ios-build ios-run`.
