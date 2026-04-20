# Maestro full tour — end-to-end runbook

Single-command procedure to rebuild + install + run the complete Maestro
suite across all 5 Terrio mobile apps on a physical Android device.

## Prerequisites

**Hardware:**
- Android phone/tablet (API 28+)
- USB cable + USB debugging enabled in Developer Options
- Screen lock disabled (PIN/pattern blocks Maestro's driver install)

**Toolchain:**
- JDK 21 (for Android Gradle Plugin — *not* required for Maestro itself)
- Android SDK (`ANDROID_HOME` env var set)
- Node 20+ + npm
- Maestro CLI: `curl -Ls "https://get.maestro.mobile.dev" | bash`

**Services:**
- Backend docker-compose stack running (`docker compose up -d` in
  terrio-e2e-tests). Port 8080 must be reachable.
- Seeds applied (auto-applied by `global-setup.ts` on first Playwright run,
  or manually via `npx tsx fixtures/seed-e2e-fixtures.ts`).

## One-command execution

```bash
cd terrio-e2e-tests

# 1. Rebuild + install 5 APKs from HEAD (~30-60 min first time,
#    ~8-15 min when npm cache + gradle cache are warm)
./scripts/rebuild-all-apks.sh

# 2. Run the full Maestro tour (~15-25 min)
./maestro/run-all.sh --skip-install   # APKs already installed by step 1
```

Both scripts exit non-zero if anything fails. The Maestro runner prints
a summary table at the end with PASS/FAIL per flow.

## Script variants

| Command | Effect |
|---|---|
| `rebuild-all-apks.sh` | all 5 apps, debug flavour, install to device |
| `rebuild-all-apks.sh consumer merchant` | subset by app name |
| `rebuild-all-apks.sh --skip-install` | build only (CI, no device attached) |
| `rebuild-all-apks.sh --release` | assembleRelease (requires signing config) |
| `run-all.sh` | default: install APKs then run all flows |
| `run-all.sh --skip-install` | run flows only (APKs already on device) |

## APK flavour discovery

`run-all.sh` picks the APK in this order:
1. `android/app/build/outputs/apk/release/app-release.apk`
2. `android/app/build/outputs/apk/debug/app-debug.apk`

Debug is the default because release requires a signing config that isn't
committed to the repo. For Maestro UI testing the two are functionally
equivalent — behaviour and testID selectors don't differ between flavours.

## Flow inventory

Per-app flows listed in `FLOW_ORDER` in `run-all.sh`. Current totals:

| App | Flows | Notes |
|---|---|---|
| consumer-mobile | 8 | login, nav, beacon-scan ×2, merchant-landing, custom-branding, notif-pref, logout |
| merchant-mobile | 9 | login, nav, pos-scan, adv- ×4, cashback-config, logout |
| tenant-mobile | 5 | login, nav, beacons, moderation-tenant-review, logout |
| sales-agent-mobile | 9 | login, nav, requests, beacon-first-config, moderation ×4, logout |
| territory-mobile | 5 | login, nav, territory-list, territory-crud, logout |

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `port 7001 is still in use` | stale Maestro JVM | script auto-kills on Windows; on Linux/Mac: `lsof -ti:7001 \| xargs kill -9` |
| `No Android device connected` | adb not authorised | accept USB-debugging prompt on device, then `adb kill-server && adb devices` |
| `Device is on lockscreen` | PIN/pattern enabled | Settings → Security → None (restore after) |
| `Unable to launch app` | first-run flake | script retries once automatically |
| `Network request failed` on login | wrong BFF URL in app bundle | re-run `rebuild-all-apks.sh` (picks up `client.ts` current URL) |

## CI integration (deferred)

The scripts are designed to run on a Mac Mini CI runner with a physical
Pixel 6 tethered. GitHub Actions integration is **not yet deployed** — it
lives in `terrio-platform-docs/ci-templates/` as a planned template once
the meta-repo `GH_PAT` is provisioned. Target cadence: nightly.

## Related

- `maestro/README.md` — general Maestro-specific conventions + device setup
- `maestro/README-ios.md` — iOS port strategy + current parity matrix
- `terrio-platform-docs/TASKS/RELEASE_NOTES_v8.0.0-SNAPSHOT.3.md` — session
  7 recap, including the resume checklist that produced this document
