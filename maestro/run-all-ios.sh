#!/bin/bash
# Maestro iOS test runner for all 5 Terrio mobile apps on iOS Simulator.
# Usage: ./maestro/run-all-ios.sh [--skip-install] [--sim <udid>]
#
# Prerequisites:
#   - iOS Simulator booted (xcrun simctl boot <udid> or open Simulator.app)
#   - .app bundles built by scripts/ios-build-all.sh in ~/Claude/ios-builds/
#   - Maestro 2.x installed (~/.maestro/bin) with Java 17+
#   - Backend stack running (metro or BFF on 8080)
#
# Note: iOS Simulator does NOT receive real APNs push notifications.
# Use xcrun simctl push for local push payload simulation instead.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IOS_BUILDS="$HOME/Claude/ios-builds"
MAESTRO_HOME="$HOME/.maestro"

export PATH="$PATH:$MAESTRO_HOME/bin:/opt/homebrew/opt/openjdk@21/bin"
export MAESTRO_CLI_NO_ANALYTICS=1
export MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED=true

SKIP_INSTALL=false
SIM_UDID="booted"

for arg in "$@"; do
  case "$arg" in
    --skip-install) SKIP_INSTALL=true ;;
    --sim)          shift; SIM_UDID="$1" ;;
  esac
done

# Verify a simulator is booted
if ! xcrun simctl list devices | grep -q "Booted"; then
  echo "ERROR: No iOS Simulator booted."
  echo "HINT: Open Simulator.app or run: xcrun simctl boot <UDID>"
  exit 1
fi
BOOTED_SIM=$(xcrun simctl list devices | grep "Booted" | head -1)
echo "Simulator: $BOOTED_SIM"
echo ""

# Bundle IDs = ios.bundleIdentifier in each app.json (com.terrio.*).
# NOT the Android package (it.terrio.*) — they differ on this fleet.
APPS=(
  "consumer-mobile:com.terrio.consumer"
  "merchant-mobile:com.terrio.merchant"
  "tenant-mobile:com.terrio.tenant"
  "sales-agent-mobile:com.terrio.salesagent"
  "territory-mobile:com.terrio.territory"
)

# Flow execution order per app — mirrors run-all.sh for Android.
# login first (asserts clean state), logout last.
FLOW_ORDER=(login custom-branding navigation card-qr beacon-scan beacon-scan-background beacons beacon-first-config requests adv-list-filter adv-submit adv-appeal adv-takedown cashback-config pos-scan moderation-approve moderation-reject moderation-escalate moderation-budget-degraded moderation-tenant-review territory-list territory-crud merchant-landing notification-preferences logout)

PASS=0
FAIL=0
RESULTS=()

# Reinstall .app for a clean state before login flow
reinstall_app() {
  local bundle_id="$1" app_bundle="$2"
  if [ -d "$app_bundle" ]; then
    xcrun simctl uninstall "$SIM_UDID" "$bundle_id" 2>/dev/null || true
    xcrun simctl install "$SIM_UDID" "$app_bundle"
  fi
}

terminate_app() {
  local bundle_id="$1"
  xcrun simctl terminate "$SIM_UDID" "$bundle_id" 2>/dev/null || true
  sleep 1
}

run_flow() {
  local flow="$1" log_file="$2"
  if maestro test "$flow" >"$log_file" 2>&1; then
    return 0
  fi
  # One retry on launch failures
  if grep -q "Unable to launch app\|App not running" "$log_file" 2>/dev/null; then
    sleep 3
    maestro test "$flow" >"$log_file" 2>&1
    return $?
  fi
  return 1
}

# ── Install .app bundles ──────────────────────────────────────────────────
if [ "$SKIP_INSTALL" = false ]; then
  echo "=== Installing .app bundles ==="
  for entry in "${APPS[@]}"; do
    IFS=':' read -r app_name bundle_id <<< "$entry"
    app_bundle="$IOS_BUILDS/${app_name}.app"
    if [ ! -d "$app_bundle" ]; then
      echo "  SKIP: $app_name (no .app — run scripts/ios-build-all.sh first)"
      continue
    fi
    xcrun simctl uninstall "$SIM_UDID" "$bundle_id" 2>/dev/null || true
    xcrun simctl install "$SIM_UDID" "$app_bundle"
    echo "  $bundle_id installed"
  done
  echo ""
fi

# ── Run Maestro flows ─────────────────────────────────────────────────────
for entry in "${APPS[@]}"; do
  IFS=':' read -r app_name bundle_id <<< "$entry"
  ios_dir="$SCRIPT_DIR/${app_name}-ios"
  app_bundle="$IOS_BUILDS/${app_name}.app"

  if [ ! -d "$ios_dir" ]; then
    echo "SKIP: $app_name (no ios flow dir: $ios_dir)"
    continue
  fi

  echo "=== Running $app_name iOS flows ==="

  # Build the flow list: FLOW_ORDER first (state-critical ordering), then any
  # remaining *.yaml alphabetically — files absent from FLOW_ORDER must NOT be
  # silently skipped (same defect fixed on the Android runner in #159).
  flow_names=()
  for flow_name in "${FLOW_ORDER[@]}"; do
    [ -f "$ios_dir/${flow_name}.yaml" ] && flow_names+=("$flow_name")
  done
  for f in "$ios_dir"/*.yaml; do
    base=$(basename "$f" .yaml)
    case "$base" in _*|*subflow*) continue ;; esac
    listed=false
    for n in "${FLOW_ORDER[@]}"; do [ "$n" = "$base" ] && listed=true && break; done
    [ "$listed" = "false" ] && flow_names+=("$base")
  done

  for flow_name in "${flow_names[@]}"; do
    flow="$ios_dir/${flow_name}.yaml"

    echo -n "  $flow_name ... "
    log_file="/tmp/maestro-ios-${app_name}-${flow_name}.log"

    # Fresh install before login to clear SecureStore state. Honors
    # --skip-install (parity with run-all.sh #159): with it, the operator
    # pinned the installed builds — never swap them mid-suite.
    if [ "$flow_name" = "login" ] && [ "$SKIP_INSTALL" = false ]; then
      reinstall_app "$bundle_id" "$app_bundle"
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

    terminate_app "$bundle_id"
  done
  echo ""
done

# ── Summary ───────────────────────────────────────────────────────────────
echo "════════════════════════════════════════"
echo "RESULT: $PASS passed, $FAIL failed"
echo "════════════════════════════════════════"
for r in "${RESULTS[@]}"; do echo "  $r"; done

[ "$FAIL" -eq 0 ]
