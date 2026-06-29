#!/bin/bash
# iter17-runner.sh — verbatim copy of iter14-runner with new OUT_DIR.
# Rationale: iter15 regressed to 4/15 because the runner inherited a poisoned
# tcp:7001 from a prior session. iter16 tried to fix that by force-stopping
# `dev.mobile.maestro`, but that corrupted the system_server UiAutomation
# state and made every flow's first deviceInfo gRPC call hang for 120s.
# Lesson: do not try to manage the maestro test runner's lifecycle from
# outside. Let `maestro test` handle its own `am instrument` setup. iter14's
# robustness primitives (timeout, post-install settle, in-flow agent reset
# via the harmless pkill that returns "Operation not permitted") remain.
#
# Pre-condition for this iter: the device-side `dev.mobile.maestro` was
# verified to be in a fresh state at 08:57:17 (PID 20317, tcp:7001 LISTEN
# clean) — the prior iter16 cleanup naturally triggered a fresh respawn.
#
# Iter14 robustness fixes preserved verbatim:
#   (1) `timeout 600` per-flow hard cap.
#   (2) `sleep 10` post-install settle inside reinstall_app.
#   (3) `pkill -9 maestro_agent` between flows (best-effort, harmless when
#       permission denied).

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

OUT_DIR="$REPO_ROOT/test-results/iter17-2026-05-04"
mkdir -p "$OUT_DIR"

# Pre-clean any stale Maestro JVM from a prior killed session.
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

# Iter14 robustness fix #2: post-install settle to let PackageManager drain
# its PACKAGE_ADDED broadcast queue before maestro tries `am start`.
reinstall_app() {
  local pkg="$1" apk="$2"
  if [ -f "$apk" ]; then
    "$ADB" -s "$DEVICE" shell am force-stop "$pkg" >/dev/null 2>&1 || true
    "$ADB" -s "$DEVICE" uninstall "$pkg" >/dev/null 2>&1 || true
    "$ADB" -s "$DEVICE" install -r "$apk" >/dev/null 2>&1 || true
    sleep 10
  fi
}

# Iter14 robustness fix #3: kill maestro-agent between flows so a poisoned
# gRPC channel from one flow does not cascade-fail the next.
reset_maestro_agent() {
  "$ADB" -s "$DEVICE" shell pkill -9 maestro_agent >/dev/null 2>&1 || true
  "$ADB" -s "$DEVICE" shell pkill -9 -f dev.mobile.maestro >/dev/null 2>&1 || true
  sleep 1
}

RETRY_PATTERN='Unable to launch app|Native memory allocation \(malloc\) failed|insufficient memory for the Java Runtime Environment'

# Iter14 robustness fix #1: hard cap each flow at FLOW_TIMEOUT_SEC seconds.
# `timeout` sends SIGTERM at the deadline, then SIGKILL after a 30 s grace.
run_flow() {
  local flow="$1" log_file="$2"
  if timeout --kill-after=30s "${FLOW_TIMEOUT_SEC}s" maestro test "$flow" >"$log_file" 2>&1; then
    return 0
  fi
  local rc=$?
  # Exit codes: 124 = timed out (SIGTERM), 137 = killed (SIGKILL)
  if [ "$rc" -eq 124 ] || [ "$rc" -eq 137 ]; then
    echo "" >>"$log_file"
    echo "[iter17-runner] timeout fired after ${FLOW_TIMEOUT_SEC}s (rc=$rc) — Maestro JVM hard-killed" >>"$log_file"
    reset_maestro_agent
    return 1
  fi
  if grep -E -q "$RETRY_PATTERN" "$log_file"; then
    sleep 10
    "$ADB" -s "$DEVICE" wait-for-device >/dev/null 2>&1 || true
    timeout --kill-after=30s "${FLOW_TIMEOUT_SEC}s" maestro test "$flow" >"$log_file" 2>&1
    return $?
  fi
  return 1
}

"$ADB" -s "$DEVICE" shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1 || true
"$ADB" -s "$DEVICE" shell svc power stayon usb >/dev/null 2>&1 || true
"$ADB" -s "$DEVICE" reverse tcp:8080 tcp:8082 >/dev/null 2>&1 || true
"$ADB" -s "$DEVICE" reverse tcp:8180 tcp:8180 >/dev/null 2>&1 || true

cleanup() { "$ADB" -s "$DEVICE" shell svc power stayon false >/dev/null 2>&1 || true; }
trap cleanup EXIT

START_TIME=$(date +%s)
echo "iter17-runner started $(date -u +%FT%TZ)" | tee "$OUT_DIR/SUMMARY.txt"
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
    if [ "$flow_name" = "login" ] && [ -n "${apk:-}" ]; then
      reinstall_app "$pkg" "$apk"
    else
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
