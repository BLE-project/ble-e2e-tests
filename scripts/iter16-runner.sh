#!/bin/bash
# iter16-runner.sh — adds device-side maestro_agent pre-clean to fix the
# tcp:7001 dadb poisoning that surfaced in iter15.
#
# Iter15 regressed from iter14's 13/15 baseline because the very first flow
# inherited a stale maestro_agent on the device (tcp:7001 LISTEN), which
# caused the maestro CLI's dadb forwarder to throw `Command failed (tcp:7001):
# closed`. The iter14 robustness fixes (timeout, post-install settle,
# inter-flow agent reset) all assume a clean starting state. They reset the
# device-side agent BETWEEN flows of the SAME app, but NOT before the first
# flow and NOT at the boundary between apps (where reinstall_app runs but
# does not reset the agent).
#
# iter16 changes vs iter15:
#  1. Device-side maestro_agent pkill at runner START, so the first flow
#     gets a fresh agent.
#  2. reset_maestro_agent() called at every flow start, BEFORE deciding
#     whether to reinstall_app or just continue. This collapses the
#     login-vs-other branch into a uniform: reset agent → maybe reinstall
#     APK → run flow.
# No other changes vs iter15.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WORK_ROOT="$(cd "$REPO_ROOT/.." && pwd)"
ADB="$ANDROID_HOME/platform-tools/adb"
MAESTRO_HOME="$HOME/.maestro"
DEVICE="${DEVICE:-9ede6d09}"
FLOW_TIMEOUT_SEC="${FLOW_TIMEOUT_SEC:-600}"

export PATH="$PATH:$MAESTRO_HOME/bin"
export MAESTRO_CLI_NO_ANALYTICS=1
export MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED=true

OUT_DIR="$REPO_ROOT/test-results/iter16-2026-05-04"
mkdir -p "$OUT_DIR"

# Pre-clean any stale Maestro JVM from a prior killed session (host side).
if command -v powershell.exe >/dev/null 2>&1; then
  powershell.exe -NoProfile -Command "Get-WmiObject Win32_Process -Filter \"Name='java.exe'\" | Where-Object { \$_.CommandLine -like '*maestro.cli.AppKt*' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force -ErrorAction SilentlyContinue }" >/dev/null 2>&1 || true
fi
sleep 1

APPS=(
  "consumer-mobile:com.terrio.consumer:terrio-consumer-mobile"
  "merchant-mobile:com.terrio.merchant:terrio-merchant-mobile"
  "tenant-mobile:com.terrio.tenant:terrio-tenant-mobile"
  "sales-agent-mobile:com.terrio.salesagent:terrio-sales-agent-mobile"
  "territory-mobile:com.terrio.territory:terrio-territory-mobile"
)

FLOW_ORDER=(login navigation logout)

PASS=0
FAIL=0
RESULTS=()

find_apk() {
  local repo_dir="$1"
  local rel="$WORK_ROOT/$repo_dir/android/app/build/outputs/apk/release/app-release.apk"
  local dbg="$WORK_ROOT/$repo_dir/android/app/build/outputs/apk/debug/app-debug.apk"
  if   [ -f "$rel" ]; then echo "$rel"
  elif [ -f "$dbg" ]; then echo "$dbg"
  else return 1
  fi
}

# Iter14 robustness fix #2 (preserved): post-install settle to let
# PackageManager drain its PACKAGE_ADDED broadcast queue before maestro
# tries `am start`.
reinstall_app() {
  local pkg="$1" apk="$2"
  if [ -f "$apk" ]; then
    "$ADB" -s "$DEVICE" shell am force-stop "$pkg" >/dev/null 2>&1 || true
    "$ADB" -s "$DEVICE" uninstall "$pkg" >/dev/null 2>&1 || true
    "$ADB" -s "$DEVICE" install -r "$apk" >/dev/null 2>&1 || true
    sleep 10
  fi
}

# Iter14 robustness fix #3 (preserved + iter16-extended): kill maestro_agent
# between flows AND at runner start so a poisoned gRPC channel from any
# previous Maestro session does not leak into this run.
#
# Iter16 correction (2026-05-04): `pkill -9 maestro_agent` returns
# "Operation not permitted" because the on-device maestro test runner
# is the package `dev.mobile.maestro` running as a per-app Android user
# (u0_a*), not root, and the adb shell user has no authority to signal
# foreign-uid processes. The functionally correct mechanism is
# `am force-stop dev.mobile.maestro` which goes through ActivityManager
# and has the authority to terminate any package. Verified post-iter15:
# `am force-stop` reliably clears tcp:7001 LISTEN within 1 s.
reset_maestro_agent() {
  "$ADB" -s "$DEVICE" shell am force-stop dev.mobile.maestro >/dev/null 2>&1 || true
  "$ADB" -s "$DEVICE" shell am force-stop dev.mobile.maestro.test >/dev/null 2>&1 || true
  # pkill kept as belt-and-braces; harmless when permission denied.
  "$ADB" -s "$DEVICE" shell pkill -9 maestro_agent >/dev/null 2>&1 || true
  sleep 1
}

RETRY_PATTERN='Unable to launch app|Native memory allocation \(malloc\) failed|insufficient memory for the Java Runtime Environment'

# Iter14 robustness fix #1 (preserved): hard cap each flow at FLOW_TIMEOUT_SEC seconds.
run_flow() {
  local flow="$1" log_file="$2"
  if timeout --kill-after=30s "${FLOW_TIMEOUT_SEC}s" maestro test "$flow" >"$log_file" 2>&1; then
    return 0
  fi
  local rc=$?
  if [ "$rc" -eq 124 ] || [ "$rc" -eq 137 ]; then
    echo "" >>"$log_file"
    echo "[iter16-runner] timeout fired after ${FLOW_TIMEOUT_SEC}s (rc=$rc) — Maestro JVM hard-killed" >>"$log_file"
    reset_maestro_agent
    return 1
  fi
  if grep -E -q "$RETRY_PATTERN" "$log_file"; then
    sleep 10
    "$ADB" -s "$DEVICE" wait-for-device >/dev/null 2>&1 || true
    reset_maestro_agent
    timeout --kill-after=30s "${FLOW_TIMEOUT_SEC}s" maestro test "$flow" >"$log_file" 2>&1
    return $?
  fi
  return 1
}

"$ADB" -s "$DEVICE" shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1 || true
"$ADB" -s "$DEVICE" shell svc power stayon usb >/dev/null 2>&1 || true
"$ADB" -s "$DEVICE" reverse tcp:8080 tcp:8080 >/dev/null 2>&1 || true
"$ADB" -s "$DEVICE" reverse tcp:8180 tcp:8180 >/dev/null 2>&1 || true

# Iter16 fix: kill device-side maestro_agent BEFORE first flow.
# Without this, the very first maestro test inherits whatever tcp:7001
# state the previous Maestro session left behind, manifesting as
# `IOException: Command failed (tcp:7001): closed` in the dadb forwarder.
reset_maestro_agent

cleanup() { "$ADB" -s "$DEVICE" shell svc power stayon false >/dev/null 2>&1 || true; }
trap cleanup EXIT

START_TIME=$(date +%s)
echo "iter16-runner started $(date -u +%FT%TZ)" | tee "$OUT_DIR/SUMMARY.txt"
echo "Device: $DEVICE  flow_timeout=${FLOW_TIMEOUT_SEC}s" | tee -a "$OUT_DIR/SUMMARY.txt"

for entry in "${APPS[@]}"; do
  IFS=':' read -r app_name pkg dir <<<"$entry"
  echo "" | tee -a "$OUT_DIR/SUMMARY.txt"
  echo "=== $app_name ===" | tee -a "$OUT_DIR/SUMMARY.txt"
  apk=$(find_apk "$dir" || true)
  for flow_name in "${FLOW_ORDER[@]}"; do
    flow="$REPO_ROOT/maestro/$app_name/$flow_name.yaml"
    [ -f "$flow" ] || continue
    log_file="$OUT_DIR/${app_name}-${flow_name}.log"
    echo -n "  $flow_name ... " | tee -a "$OUT_DIR/SUMMARY.txt"
    # Iter16: always reset agent before each flow. Then optionally reinstall
    # APK on the login flow.
    reset_maestro_agent
    if [ "$flow_name" = "login" ] && [ -n "${apk:-}" ]; then
      reinstall_app "$pkg" "$apk"
      # reinstall could have race-respawned an agent — reset once more to
      # be safe, since iter15 evidence shows a fresh install can leave a
      # half-bound agent socket if the prior install did.
      reset_maestro_agent
    fi
    if run_flow "$flow" "$log_file"; then
      echo "PASS" | tee -a "$OUT_DIR/SUMMARY.txt"
      PASS=$((PASS+1))
      RESULTS+=("PASS:$app_name/$flow_name")
    else
      echo "FAIL" | tee -a "$OUT_DIR/SUMMARY.txt"
      FAIL=$((FAIL+1))
      RESULTS+=("FAIL:$app_name/$flow_name")
    fi
    "$ADB" -s "$DEVICE" shell am force-stop "$pkg" >/dev/null 2>&1 || true
    sleep 3
  done
done

END_TIME=$(date +%s)
ELAPSED=$((END_TIME - START_TIME))
echo "" | tee -a "$OUT_DIR/SUMMARY.txt"
echo "============================================" | tee -a "$OUT_DIR/SUMMARY.txt"
echo "RESULT: $PASS passed, $FAIL failed (${ELAPSED}s)" | tee -a "$OUT_DIR/SUMMARY.txt"
echo "============================================" | tee -a "$OUT_DIR/SUMMARY.txt"
for r in "${RESULTS[@]}"; do echo "  $r" | tee -a "$OUT_DIR/SUMMARY.txt"; done

[ "$FAIL" -eq 0 ]
