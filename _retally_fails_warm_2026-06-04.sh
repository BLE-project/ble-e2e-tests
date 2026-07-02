#!/usr/bin/env bash
# Warm re-run of the 10 flows that failed the 2026-06-04 cold pm-clear tally
# (uniform "loading state" hint). One settle launch per app, no per-flow pm clear
# → separates real regressions from cold-start flake.
set -u
export PATH="$HOME/.maestro/bin:$PATH"
export MAESTRO_CLI_NO_ANALYTICS=1
DEV=9ede6d09
OUT=/tmp/maestro_fails_warm_2026-06-04.txt
cd /home/nucjd/dev/give-group/Terrio/terrio-e2e-tests
adb -s "$DEV" reverse tcp:8080 tcp:8082 >/dev/null 2>&1
: > "$OUT"

declare -A PKG=(
  [consumer-mobile]=it.terrio.consumer
  [merchant-mobile]=it.terrio.merchant
  [tenant-mobile]=it.terrio.tenant
  [sales-agent-mobile]=it.terrio.salesagent
  [territory-mobile]=it.terrio.territory
)

FAILS=(
  consumer-mobile/registration-first-scan.yaml
  merchant-mobile/bcn-map-gps-capture.yaml
  merchant-mobile/cashback-config.yaml
  tenant-mobile/login.yaml
  sales-agent-mobile/bcn-map-gps-capture.yaml
  sales-agent-mobile/moderation-budget-degraded.yaml
  territory-mobile/login.yaml
  territory-mobile/navigation.yaml
  territory-mobile/territory-crud.yaml
  territory-mobile/territory-list.yaml
)

# Warm every app whose flows we re-run (ART/dexopt) once up front.
for app in "${!PKG[@]}"; do
  pkg=${PKG[$app]}
  for rel in "${FAILS[@]}"; do
    [ "${rel%%/*}" = "$app" ] || continue
    adb -s "$DEV" shell monkey -p "$pkg" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
    sleep 4; adb -s "$DEV" shell am force-stop "$pkg" >/dev/null 2>&1
    break
  done
done

pass=0; fail=0
for rel in "${FAILS[@]}"; do
  app=${rel%%/*}; pkg=${PKG[$app]}
  adb -s "$DEV" shell am force-stop "$pkg" >/dev/null 2>&1; sleep 1
  if timeout 240 maestro --device "$DEV" test "maestro/$rel" >/tmp/_warm.log 2>&1; then
    echo "PASS  $rel" | tee -a "$OUT"; pass=$((pass+1))
  else
    step=$(grep -E '\.\.\. FAILED$' /tmp/_warm.log | tail -1 | sed 's/\.\.\. FAILED$//' | tr -s ' ' | cut -c1-95)
    echo "FAIL  $rel   :: $step" | tee -a "$OUT"; fail=$((fail+1))
  fi
done
echo "" | tee -a "$OUT"
echo "WARM-RERUN TALLY: PASS=$pass FAIL=$fail TOTAL=$((pass+fail))" | tee -a "$OUT"
