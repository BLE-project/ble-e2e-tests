#!/usr/bin/env bash
# Live Maestro e2e smoke — 2026-05-16. Physical device 9ede6d09 + e2e Docker stack UP.
# Orchestration helper (not repo code). Reinstalls each app from the previewLocal
# APK (localhost-wired via adb reverse) so the login flow starts token-free.
DEV=9ede6d09
ADB=/usr/bin/adb
MAESTRO="$HOME/.maestro/bin/maestro"
APKDIR=/home/nucjd/dev/give-group/Terrio/apks
FLOWDIR=/home/nucjd/dev/give-group/Terrio/terrio-e2e-tests/maestro
RES=/home/nucjd/dev/give-group/Terrio/_e2e_smoke_results_2026-05-16.txt
export MAESTRO_CLI_NO_ANALYTICS=1 MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED=true
: > "$RES"

# FU-16: the e2e gateway container is published on host :8082 (GATEWAY_PORT),
# not :8080 — host :8080 is squatted by an unrelated WordPress install. The
# apps call localhost:8080, so reverse the device :8080 onto host :8082.
"$ADB" -s "$DEV" reverse --remove-all 2>/dev/null || true
"$ADB" -s "$DEV" reverse tcp:8080 tcp:8082   # gateway  (device :8080 -> host :8082)
"$ADB" -s "$DEV" reverse tcp:8180 tcp:8180   # keycloak (device :8180 -> host :8180)

echo "e2e smoke start $(date -u +%H:%M:%S)" | tee -a "$RES"

# app : pkg : apk-basename : space-separated flow list
APPS=(
 "consumer-mobile:it.terrio.consumer:ble-consumer-previewLocal-fresh.apk:login navigation beacon-scan registration-first-scan"
 "merchant-mobile:it.terrio.merchant:ble-merchant-previewLocal-fresh.apk:login navigation"
 "tenant-mobile:it.terrio.tenant:ble-tenant-previewLocal-fresh.apk:login navigation"
 "territory-mobile:it.terrio.territory:ble-territory-previewLocal-fresh.apk:login navigation"
 "sales-agent-mobile:it.terrio.salesagent:ble-sales-agent-previewLocal-fresh.apk:login navigation requests"
)
PASS=0; FAIL=0; SKIP=0
for entry in "${APPS[@]}"; do
  IFS=':' read -r app pkg apk flows <<<"$entry"
  echo "=== $app ===" | tee -a "$RES"
  apkpath="$APKDIR/$apk"
  if [ -f "$apkpath" ]; then
    "$ADB" -s "$DEV" uninstall "$pkg" >/dev/null 2>&1 || true
    if "$ADB" -s "$DEV" install -r -g "$apkpath" >/dev/null 2>&1; then
      echo "  install $apk OK" | tee -a "$RES"
    else
      echo "  install $apk FAIL — flows will SKIP" | tee -a "$RES"
    fi
  else
    echo "  APK missing: $apkpath — flows will SKIP" | tee -a "$RES"
  fi
  for fl in $flows; do
    flow="$FLOWDIR/$app/$fl.yaml"
    if [ ! -f "$flow" ]; then echo "  $fl SKIP (no flow file)" | tee -a "$RES"; SKIP=$((SKIP+1)); continue; fi
    log="/tmp/maestro-$app-$fl-0516.log"
    # FU-54: flows needing a logged-out cold-install state get a fresh
    # reinstall first. Neither Maestro `clearState` nor `adb shell pm clear`
    # works on this device — both are denied CLEAR_APP_USER_DATA — so
    # uninstall+install (which the shell uid IS allowed to do) is the only
    # way to reset the package.
    case "$fl" in
      registration-first-scan)
        "$ADB" -s "$DEV" uninstall "$pkg" >/dev/null 2>&1 || true
        "$ADB" -s "$DEV" install -r -g "$apkpath" >/dev/null 2>&1 || true
        ;;
    esac
    # FU-56: single retry on failure — the on-device Maestro driver flakes
    # transiently (empty logs, pass<->fail on identical reruns). Re-assert the
    # adb-reverse tunnels and force-stop before the retry.
    rc=1
    for attempt in 1 2; do
      if timeout 240 "$MAESTRO" --device "$DEV" test "$flow" > "$log" 2>&1; then rc=0; break; fi
      if [ "$attempt" = 1 ]; then
        echo "  $fl attempt 1 failed — retrying" | tee -a "$RES"
        "$ADB" -s "$DEV" shell am force-stop "$pkg" >/dev/null 2>&1 || true
        "$ADB" -s "$DEV" reverse tcp:8080 tcp:8082 >/dev/null 2>&1 || true
        "$ADB" -s "$DEV" reverse tcp:8180 tcp:8180 >/dev/null 2>&1 || true
        sleep 5
      fi
    done
    if [ "$rc" -eq 0 ]; then
      echo "  $fl PASS" | tee -a "$RES"; PASS=$((PASS+1))
    else
      echo "  $fl FAIL (log: $log)" | tee -a "$RES"; FAIL=$((FAIL+1))
    fi
    "$ADB" -s "$DEV" shell am force-stop "$pkg" >/dev/null 2>&1 || true
    sleep 2
  done
done
echo "RESULT: $PASS pass / $FAIL fail / $SKIP skip" | tee -a "$RES"
echo "e2e smoke done $(date -u +%H:%M:%S)" | tee -a "$RES"
