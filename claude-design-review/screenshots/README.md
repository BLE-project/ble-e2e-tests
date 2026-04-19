# Screenshots directory

Raw PNG screenshots captured from Android device `9ede6d09` (Pixel-class,
6.1", API 33+, Terrio build v7.9.13+).

## Current contents (2026-04-19 baseline run)

Only **01-app-initial** per app at the moment — the full interactive tour
with Maestro (tap through every tab and feature) is deferred to the next
smoke cycle because the backend stack was in Liquibase first-boot phase at
capture time.

```
consumer/00-app-initial.png       (53 KB)
merchant/00-app-initial.png       (58 KB)
tenant/00-app-initial.png         (53 KB)
sales-agent/00-app-initial.png    (107 KB)
territory/00-app-initial.png      (55 KB)
```

Without a healthy Keycloak + BFF, the apps sit on their login screen after
`monkey -p <pkg> 1`. Those screens ARE meaningful for Claude Design:
- First-launch splash / onboarding
- Login form typography + tap target size
- Brand color usage (Terrio default `#6C3FCF` purple active)
- Splash screen background color per app

## How to extend to full tours (next session)

```bash
cd terrio-e2e-tests/claude-design-review
./run-all-tours.sh            # all 5 apps, each tour 10-30 screens
./run-all-tours.sh consumer   # single app
```

Prerequisites:
- Docker stack `make up-fresh` → all 20+ containers healthy
- Android device connected (`adb devices` shows one)
- All 5 Terrio APKs installed (verify: `adb shell pm list packages | grep com.terrio`)
- Maestro CLI 2.4+ (`maestro --version`)

The tours defined in `../flows/*.yaml` log-in with dev users (`dev-consumer`,
`dev-merchant`, etc.) and navigate each tab, triggering a `takeScreenshot`
after each state change.

## How to regenerate just baseline via adb (no backend needed)

```bash
for app in consumer merchant tenant salesagent territory ; do
  case $app in salesagent) pkg="com.terrio.salesagent"; out="sales-agent" ;;
             *) pkg="com.terrio.$app"; out="$app" ;; esac
  adb shell am force-stop $pkg
  adb shell monkey -p $pkg -c android.intent.category.LAUNCHER 1
  sleep 8
  adb exec-out screencap -p > "$out/00-app-initial.png"
done
```

## Sharing with Claude Design

Zip or upload this entire `claude-design-review/` directory — it contains
the prompt (CLAUDE_DESIGN_PROMPT.md), the Maestro flows used to generate
screens, and the screenshots themselves. No extra setup required on the
design reviewer's side.
