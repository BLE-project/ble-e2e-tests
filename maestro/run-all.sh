#!/bin/bash
# Sequential Maestro test runner for all 4 mobile apps on a physical device
# Usage: ./maestro/run-all.sh [--skip-install]
# Prerequisites: device connected via USB, release APKs built, backend stack running

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ADB="$ANDROID_HOME/platform-tools/adb"

export PATH="$PATH:$HOME/.maestro/bin"
export MAESTRO_CLI_NO_ANALYTICS=1
export MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED=true

APPS=(
  "consumer-mobile:com.terrio.consumer:terrio-consumer-mobile"
  "merchant-mobile:com.terrio.merchant:terrio-merchant-mobile"
  "tenant-mobile:com.terrio.tenant:terrio-tenant-mobile"
  "sales-agent-mobile:com.terrio.salesagent:terrio-sales-agent-mobile"
)

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

# ── Setup adb reverse for backend access (BFF on 8080) ────────────────────
"$ADB" reverse tcp:8080 tcp:8080 >/dev/null 2>&1
echo "adb reverse 8080 → 8080 configured"
echo ""

# ── Install release APKs ──────────────────────────────────────────────────
if [[ "${1:-}" != "--skip-install" ]]; then
  echo "=== Installing release APKs ==="
  for entry in "${APPS[@]}"; do
    IFS=':' read -r _ pkg dir <<<"$entry"
    apk="$REPO_ROOT/$dir/android/app/build/outputs/apk/release/app-release.apk"
    if [ ! -f "$apk" ]; then
      echo "  SKIP: $dir (no release APK — run gradlew assembleRelease first)"
      continue
    fi
    # Uninstall old version to avoid signature conflicts
    "$ADB" uninstall "$pkg" >/dev/null 2>&1 || true
    "$ADB" install -r "$apk" 2>&1 | tail -1
    echo "  $pkg installed"
  done
  echo ""
fi

# ── Run Maestro flows sequentially ────────────────────────────────────────
for entry in "${APPS[@]}"; do
  IFS=':' read -r app_name pkg _ <<<"$entry"
  echo "=== Running $app_name flows ==="
  for flow in "$SCRIPT_DIR/$app_name"/*.yaml; do
    [ -f "$flow" ] || continue
    flow_name=$(basename "$flow" .yaml)
    echo -n "  $flow_name ... "
    if maestro test "$flow" 2>&1 | tail -20 | grep -q "✅\|passed"; then
      echo "PASS"
      PASS=$((PASS+1))
      RESULTS+=("PASS:$app_name/$flow_name")
    else
      echo "FAIL"
      FAIL=$((FAIL+1))
      RESULTS+=("FAIL:$app_name/$flow_name")
    fi
    # Force stop between flows to ensure clean state
    "$ADB" shell am force-stop "$pkg" >/dev/null 2>&1 || true
  done
  echo ""
done

# ── Summary ───────────────────────────────────────────────────────────────
echo "════════════════════════════════════════"
echo "RESULT: $PASS passed, $FAIL failed"
echo "════════════════════════════════════════"
for r in "${RESULTS[@]}"; do echo "  $r"; done

[ "$FAIL" -eq 0 ]
