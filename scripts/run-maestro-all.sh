#!/bin/bash
# Run Maestro smoke suite for all 5 mobile apps against a device.
# Session 55: added after APK rebuild to align com.ble.* → com.terrio.*.

set -u
ADB="$ANDROID_HOME/platform-tools/adb"
MAESTRO="$HOME/.maestro/bin/maestro"
APK_DIR="C:/Users/giand/Claude/apk-output"
E2E_DIR="C:/Users/giand/Claude/terrio-e2e-tests"

declare -A PACKAGE_MAP=(
  [consumer]=com.terrio.consumer
  [merchant]=com.terrio.merchant
  [tenant]=com.terrio.tenant
  [sales-agent]=com.terrio.salesagent
  [territory]=com.terrio.territory
)
declare -A FOLDER_MAP=(
  [consumer]=consumer-mobile
  [merchant]=merchant-mobile
  [tenant]=tenant-mobile
  [sales-agent]=sales-agent-mobile
  [territory]=territory-mobile
)

# Legacy package cleanup (one-time after rebrand)
echo "=== Cleanup old packages ==="
for pkg in com.ble.consumer com.ble.merchant com.ble.tenant com.ble.salesagent; do
  "$ADB" uninstall "$pkg" >/dev/null 2>&1 && echo "  removed $pkg" || true
done

# ADB port forwards for localhost access from device
"$ADB" reverse tcp:8080 tcp:8080 >/dev/null
"$ADB" reverse tcp:8180 tcp:8180 >/dev/null

PASSED_APPS=()
FAILED_APPS=()

for APP in consumer merchant tenant sales-agent territory; do
  PKG="${PACKAGE_MAP[$APP]}"
  FOLDER="${FOLDER_MAP[$APP]}"
  APK="$APK_DIR/ble-$APP-dev.apk"

  if [ ! -f "$APK" ]; then
    echo "=== SKIP $APP (APK missing) ==="
    FAILED_APPS+=("$APP (APK missing)")
    continue
  fi

  echo "=== $APP ==="
  "$ADB" uninstall "$PKG" >/dev/null 2>&1 || true
  "$ADB" install "$APK" 2>&1 | tail -1

  # FIX-S56-001: pre-grant runtime permissions so native Android
  # permission prompts (location, BLE, notifications) never block the
  # Maestro flows. Without these, the first navigation to a
  # location-aware screen triggers a prompt that Maestro cannot
  # dismiss (native widget outside the RN accessibility tree).
  for perm in ACCESS_FINE_LOCATION ACCESS_COARSE_LOCATION BLUETOOTH_SCAN \
              BLUETOOTH_CONNECT BLUETOOTH_ADVERTISE POST_NOTIFICATIONS; do
    "$ADB" shell pm grant "$PKG" "android.permission.$perm" 2>/dev/null || true
  done

  cd "$E2E_DIR"
  "$MAESTRO" test "maestro/$FOLDER/" 2>&1 | tee "/tmp/maestro-$APP.log" | tail -5

  # FIX-S56-002: correct pass/fail detection — match "Flows Failed" (plural)
  # which is what Maestro prints in the batch summary. The previous "Flow
  # Failed" (singular) token never matched so every app reported "Passed"
  # regardless of actual failures.
  if grep -qE "[0-9]+/[0-9]+ Flows Failed" "/tmp/maestro-$APP.log"; then
    FAILED_APPS+=("$APP")
  else
    PASSED_APPS+=("$APP")
  fi
done

echo ""
echo "============================================"
echo "Maestro Summary — Session 55"
echo "============================================"
echo "Passed: ${#PASSED_APPS[@]} (${PASSED_APPS[*]})"
echo "Failed: ${#FAILED_APPS[@]} (${FAILED_APPS[*]})"
echo "============================================"
