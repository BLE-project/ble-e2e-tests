# consumer-mobile Maestro flows

## Batch flows (run by `maestro test maestro/consumer-mobile/`)

6 flow, lexicographic order (Maestro default):

1. `beacon-scan-background.yaml`
2. `beacon-scan.yaml`
3. `custom-branding.yaml`
4. `login.yaml`
5. `logout.yaml`
6. `navigation.yaml`

All include the S55–S56 hardening: federation auto-switch dismiss,
location permission prompt handling, error modal dismiss, tab regex
matching on content-desc (bottom bar labels render with bounds [0,0]).

## Manual-only flows

- **`beacon-notification-background.yaml.manual`** — S56, end-to-end
  beacon → local notification verification. Intentionally NOT in the
  batch suite because it:
  - Backgrounds the app with `pressKey Home`,
  - Opens the system notification shade,
  - Corrupts the app state for any flow run after it.

  Run it in isolation:

  ```bash
  adb install apk-output/ble-consumer-dev.apk
  maestro test maestro/consumer-mobile/beacon-notification-background.yaml.manual
  ```

  Produces `beacon-notif-shade.png` in the repo root (captured via
  `takeScreenshot`). See `artifacts/README.md` for the current
  recorded artifact and its honest technical caveats (the bundled
  APK is in BLE stub-mode because it lacks react-native-ble-plx —
  the screenshot in `artifacts/beacon-notification-s56.png` was
  produced via `adb shell cmd notification post` as a UI proxy).

## Known regressions (S56)

- `navigation.yaml` passes 4/9 tabs (Wallet, Discover, History, Nearby
  back to home). The remaining 5 tabs (Territory, Prefs, Offers,
  Profilo, Report) trigger downstream API calls that 401-logout the
  session silently. Deferred to session 57 (KI-S56-04).
