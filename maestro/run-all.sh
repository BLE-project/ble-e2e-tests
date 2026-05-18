#!/bin/bash
# Sequential Maestro test runner for all 5 mobile apps on a physical device.
# Usage: ./maestro/run-all.sh [--skip-install]
# Prerequisites: device connected via USB, APKs built (debug or release),
# backend stack running.
#
# APK discovery order: release/app-release.apk (signed, production-like), then
# debug/app-debug.apk (what scripts/rebuild-all-apks.sh produces by default).
# The fallback lets developers run Maestro without setting up a release
# signing config — debug APKs are functionally equivalent for UI testing.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
# adb resolution: prefer one already on PATH (Linux/macOS package install),
# fall back to the Android SDK location used on Windows dev machines.
if command -v adb >/dev/null 2>&1; then
  ADB="$(command -v adb)"
elif [ -n "${ANDROID_HOME:-}" ] && [ -x "$ANDROID_HOME/platform-tools/adb" ]; then
  ADB="$ANDROID_HOME/platform-tools/adb"
else
  echo "ERROR: adb not found — install Android platform-tools or set ANDROID_HOME"
  exit 1
fi
MAESTRO_HOME="$HOME/.maestro"

export PATH="$PATH:$MAESTRO_HOME/bin"
export MAESTRO_CLI_NO_ANALYTICS=1
export MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED=true

# ── Kill stale Maestro Java zombies before starting ──────────────────────
# Stale Maestro JVMs keep port 7001 bound which silently breaks `adb forward`
# and causes every flow to fail with a gRPC DEADLINE_EXCEEDED after 120s.
# Clean up orphans before binding the port ourselves. The match targets the
# Maestro CLI main class (maestro.cli.AppKt), so this script is never hit.
case "$(uname -s)" in
  Linux|Darwin)
    # pkill -f matches the full command line; pkill never kills itself.
    pkill -f 'maestro\.cli\.AppKt' 2>/dev/null || true
    ;;
  MINGW*|MSYS*|CYGWIN*)
    if command -v powershell.exe >/dev/null 2>&1; then
      set +e
      powershell.exe -NoProfile -Command "Get-WmiObject Win32_Process -Filter \"Name='java.exe'\" | Where-Object { \$_.CommandLine -like '*maestro.cli.AppKt*' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force -ErrorAction SilentlyContinue }" >/dev/null 2>&1
      set -e
    fi
    ;;
esac
# Give the OS a moment to release the socket.
sleep 1
# Hard-fail if port 7001 is still bound by something we can't kill.
# Linux/macOS: ss or lsof; Windows (Git Bash): netstat. The listening state
# is "LISTEN" on Linux/macOS and "LISTENING" on Windows — matched case-insensitively.
port_7001_busy() {
  if command -v ss >/dev/null 2>&1; then
    ss -ltn 2>/dev/null | grep -q ':7001 '
  elif command -v lsof >/dev/null 2>&1; then
    lsof -iTCP:7001 -sTCP:LISTEN >/dev/null 2>&1
  else
    netstat -an 2>/dev/null | grep -E '[:.]7001[^0-9]' | grep -qi 'listen'
  fi
}
if port_7001_busy; then
  echo "ERROR: port 7001 is still in use after zombie cleanup"
  echo "       identify the holder:  ss -ltnp | grep 7001   (or: lsof -i :7001)"
  exit 1
fi

# ── Ensure Maestro driver APKs are installed on the device ───────────────
# Maestro normally auto-installs these on first run, but if a previous run
# was interrupted before the driver finished installing, the device will be
# missing dev.mobile.maestro and every test will time out. Extract the APKs
# bundled in maestro-client.jar and install them ourselves.
ensure_maestro_driver() {
  local pkg1 pkg2
  pkg1=$("$ADB" shell pm list packages 2>/dev/null | grep -c "^package:dev.mobile.maestro$" || true)
  pkg2=$("$ADB" shell pm list packages 2>/dev/null | grep -c "^package:dev.mobile.maestro.test$" || true)
  if [ "${pkg1:-0}" = "1" ] && [ "${pkg2:-0}" = "1" ]; then
    return 0
  fi
  echo "  Installing Maestro driver APKs (one-time setup)..."
  local tmp="$(mktemp -d 2>/dev/null || echo /tmp/maestro-driver-$$)"
  mkdir -p "$tmp"
  if ! (cd "$tmp" && unzip -o -q "$MAESTRO_HOME/lib/maestro-client.jar" maestro-app.apk maestro-server.apk 2>/dev/null); then
    echo "  WARNING: could not extract driver APKs from maestro-client.jar"
    return 0
  fi
  "$ADB" install -r -g "$tmp/maestro-app.apk" >/dev/null 2>&1 || true
  "$ADB" install -r -g "$tmp/maestro-server.apk" >/dev/null 2>&1 || true
  rm -rf "$tmp" 2>/dev/null || true
}

APPS=(
  "consumer-mobile:it.terrio.consumer:terrio-consumer-mobile"
  "merchant-mobile:it.terrio.merchant:terrio-merchant-mobile"
  "tenant-mobile:it.terrio.tenant:terrio-tenant-mobile"
  "sales-agent-mobile:it.terrio.salesagent:terrio-sales-agent-mobile"
  "territory-mobile:it.terrio.territory:terrio-territory-mobile"
)

# Returns the preferred APK path for a repo: release if present, else debug.
# Empty string + non-zero exit if neither exists.
find_apk() {
  local repo_dir="$1"
  local rel="$repo_dir/android/app/build/outputs/apk/release/app-release.apk"
  local dbg="$repo_dir/android/app/build/outputs/apk/debug/app-debug.apk"
  if   [ -f "$rel" ]; then echo "$rel"
  elif [ -f "$dbg" ]; then echo "$dbg"
  else return 1
  fi
}

# Flows run in this fixed order per app, regardless of filesystem order.
# login MUST run first (it asserts the logged-out state); other flows are
# tolerant of either state via conditional runFlow blocks.
# `beacon-reconfig-switch` must run AFTER any flow that depends on the Alpha
# beacon living in Territory A — this flow mutates it to Territory B.
# Fase 3.5: `beacon-scan-background` runs immediately after `beacon-scan`
# to reuse the already-permissioned state and exercise the AppState handoff
# introduced in Fase 3.4 (src/ble/backgroundScanner.ts on consumer-mobile).
# Fase 4.3: `custom-branding` runs AFTER login so the consumer is already
# in an authenticated tenant context when the branding fetch kicks in.
# It relies on the E2E fixture seeded by seed-custom-branding-fixtures.ts
# being applied on the active tenant before the suite starts.
FLOW_ORDER=(login custom-branding navigation beacon-scan beacon-scan-background beacons beacon-reconfig-switch cashback-config pos-scan requests territory-list territory-crud logout)

PASS=0
FAIL=0
RESULTS=()

# ── Verify device ──────────────────────────────────────────────────────────
if ! "$ADB" devices | grep -q "device$"; then
  echo "ERROR: No Android device connected"
  exit 1
fi
DEVICE=$("$ADB" devices | grep "device$" | head -1 | awk '{print $1}')
echo "Device: $DEVICE"

# ── Pre-check: awake and unlocked ─────────────────────────────────────────
# If the device is dozing or on a PIN/pattern lockscreen, Maestro's on-device
# driver install will hang for ~120s per flow with a gRPC DEADLINE_EXCEEDED
# error. Fail fast instead of wasting 30+ minutes on a broken run.
"$ADB" -s "$DEVICE" shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1
sleep 1
wake_state=$("$ADB" -s "$DEVICE" shell dumpsys power 2>&1 | grep -oE 'mWakefulness=\w+' | head -1 | cut -d= -f2 | tr -d '\r')
if [ "$wake_state" != "Awake" ]; then
  echo "ERROR: Device is not awake (mWakefulness=$wake_state)"
  echo "HINT: physically tap the device to wake it, then re-run"
  exit 1
fi
# Dump UI hierarchy and look for lockscreen indicators — works across locales.
"$ADB" -s "$DEVICE" shell 'uiautomator dump /data/local/tmp/ui-precheck.xml' >/dev/null 2>&1 || true
lock_xml=$("$ADB" -s "$DEVICE" shell cat /data/local/tmp/ui-precheck.xml 2>/dev/null || echo "")
if echo "$lock_xml" | grep -qE 'Inserisci il PIN|Enter PIN|Enter password|Draw pattern|Disegna la sequenza|CHIAMATA DI EMERGENZA|Emergency call|com\.android\.systemui.*keyguard'; then
  echo "ERROR: Device is on lockscreen (PIN/pattern/password required)"
  echo "HINT: Settings → Security → Screen Lock → None (restore after testing)"
  exit 1
fi
echo "Device state: awake, unlocked"

# ── Ensure Maestro driver is installed on the device ─────────────────────
ensure_maestro_driver

# ── Keep device awake for the entire suite run ────────────────────────────
# Without this, the device may doze after ~1 minute of "inactivity" (Maestro
# interacts via UIAutomator gRPC, which Android doesn't count as user input).
# `svc power stayon usb` keeps the screen on while USB-connected, no side
# effects, automatically cleared on EXIT.
"$ADB" -s "$DEVICE" shell svc power stayon usb >/dev/null 2>&1 || true
cleanup() {
  "$ADB" -s "$DEVICE" shell svc power stayon false >/dev/null 2>&1 || true
}
trap cleanup EXIT

# ── Setup adb reverse for backend access (BFF on 8080) ────────────────────
"$ADB" -s "$DEVICE" reverse tcp:8080 tcp:8080 >/dev/null 2>&1
echo "adb reverse 8080 → 8080 configured"
echo ""

# ── Install APKs (prefer release, fall back to debug) ────────────────────
if [[ "${1:-}" != "--skip-install" ]]; then
  echo "=== Installing APKs ==="
  for entry in "${APPS[@]}"; do
    IFS=':' read -r _ pkg dir <<<"$entry"
    if ! apk=$(find_apk "$REPO_ROOT/$dir"); then
      echo "  SKIP: $dir (no APK — run scripts/rebuild-all-apks.sh first)"
      continue
    fi
    flavour=$(basename "$(dirname "$apk")")   # "release" or "debug"
    # Uninstall old version to avoid signature conflicts
    "$ADB" uninstall "$pkg" >/dev/null 2>&1 || true
    "$ADB" install -r "$apk" 2>&1 | tail -1
    echo "  $pkg installed ($flavour)"
  done
  echo ""
fi

# Run a single Maestro flow with one retry on "Unable to launch app" — a
# known flake that occurs when adb force-stop from the previous flow races
# with the launchApp at the start of the next flow.
run_flow() {
  local flow="$1" log_file="$2"
  if maestro test "$flow" >"$log_file" 2>&1; then
    return 0
  fi
  if grep -q "Unable to launch app" "$log_file"; then
    sleep 2
    "$ADB" wait-for-device >/dev/null 2>&1 || true
    maestro test "$flow" >"$log_file" 2>&1
    return $?
  fi
  return 1
}

# Reinstall an APK to guarantee a clean SecureStore / app-data state before
# running the login flow (which asserts the logged-out starting state).
# Release APKs forbid `pm clear` from adb shell, so reinstall is the only
# reliable reset short of a factory wipe.
reinstall_app() {
  local pkg="$1" apk="$2"
  if [ -f "$apk" ]; then
    "$ADB" uninstall "$pkg" >/dev/null 2>&1 || true
    "$ADB" install -r "$apk" >/dev/null 2>&1 || true
  fi
}

# Fase 4.3: seed the custom-branding row on the E2E tenant BEFORE running
# the consumer-mobile custom-branding Maestro flow. The fixture is
# idempotent (PUT /api/v1/tenants/{id}/branding, PATCH semantics) so
# repeated runs are safe. Failures here are non-fatal — we log a warning
# and continue, because the custom-branding flow will then just fail
# loudly with a clearer signal than missing fixture state.
seed_custom_branding() {
  local fixture="$REPO_ROOT/terrio-e2e-tests/fixtures/seed-custom-branding-fixtures.ts"
  if [ ! -f "$fixture" ]; then
    echo "  WARN: $fixture not found — skipping custom-branding seed"
    return 0
  fi
  echo -n "  seeding custom-branding fixture ... "
  if (cd "$REPO_ROOT/terrio-e2e-tests" && npx -y tsx fixtures/seed-custom-branding-fixtures.ts >/tmp/seed-custom-branding.log 2>&1); then
    echo "OK"
  else
    echo "FAIL (log: /tmp/seed-custom-branding.log) — continuing"
  fi
}

# ── Run Maestro flows sequentially ────────────────────────────────────────
for entry in "${APPS[@]}"; do
  IFS=':' read -r app_name pkg dir <<<"$entry"
  echo "=== Running $app_name flows ==="
  # find_apk returns release if present, else debug — tolerate either
  apk=$(find_apk "$REPO_ROOT/$dir" || true)
  # Fase 4.3: ensure the custom-branding fixture is applied before the
  # consumer-mobile flows run. Scoped to consumer-mobile only because
  # the other apps never read /bff/v1/consumer/brand.
  if [ "$app_name" = "consumer-mobile" ]; then
    seed_custom_branding
  fi
  for flow_name in "${FLOW_ORDER[@]}"; do
    flow="$SCRIPT_DIR/$app_name/$flow_name.yaml"
    [ -f "$flow" ] || continue
    echo -n "  $flow_name ... "
    log_file="/tmp/maestro-${app_name}-${flow_name}.log"
    # The login flow must start from an uninstalled + reinstalled state so
    # that no prior SecureStore tokens auto-log-in the user.
    if [ "$flow_name" = "login" ]; then
      reinstall_app "$pkg" "$apk"
    fi
    if run_flow "$flow" "$log_file"; then
      echo "PASS"
      PASS=$((PASS+1))
      RESULTS+=("PASS:$app_name/$flow_name")
    else
      echo "FAIL"
      FAIL=$((FAIL+1))
      RESULTS+=("FAIL:$app_name/$flow_name  (log: $log_file)")
    fi
    # Force stop between flows to ensure clean state, then give Android a
    # moment to finish tearing down the process before the next launchApp.
    # Without this, maestro's next "stopApp + launchApp" can race and fail
    # with "Unable to launch app".
    "$ADB" shell am force-stop "$pkg" >/dev/null 2>&1 || true
    sleep 1
  done
  echo ""
done

# ── Summary ───────────────────────────────────────────────────────────────
echo "════════════════════════════════════════"
echo "RESULT: $PASS passed, $FAIL failed"
echo "════════════════════════════════════════"
for r in "${RESULTS[@]}"; do echo "  $r"; done

[ "$FAIL" -eq 0 ]
