#!/usr/bin/env bash
# Warm re-run of the 15 flows that failed the 2026-06-03 cold pm-clear tally with
# the uniform "Element may be temporarily unavailable due to loading state" error.
# No per-flow pm clear: keeps ART warm + lets the screen settle, to separate real
# regressions from cold-start/loading-state flake. One settle launch per app.
set -u
export PATH="$HOME/.maestro/bin:$PATH"
export MAESTRO_CLI_NO_ANALYTICS=1
DEV=9ede6d09
OUT=/tmp/maestro_fails_warm_2026-06-03.txt
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
  consumer-mobile/beacon-scan-background.yaml
  consumer-mobile/custom-branding.yaml
  consumer-mobile/merchant-landing.yaml
  consumer-mobile/notification-preferences.yaml
  consumer-mobile/registration-first-scan.yaml
  merchant-mobile/adv-appeal.yaml
  merchant-mobile/adv-list-filter.yaml
  merchant-mobile/adv-submit.yaml
  merchant-mobile/adv-takedown.yaml
  merchant-mobile/bcn-map-gps-capture.yaml
  tenant-mobile/login.yaml
  tenant-mobile/moderation-tenant-review.yaml
  sales-agent-mobile/bcn-map-gps-capture.yaml
  sales-agent-mobile/moderation-approve.yaml
  sales-agent-mobile/moderation-reject.yaml
)

pass=0; fail=0
for rel in "${FAILS[@]}"; do
  app=${rel%%/*}
  pkg=${PKG[$app]}
  # warm-launch the app (ART already compiled from the full run) + settle
  adb -s "$DEV" shell monkey -p "$pkg" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
  sleep 4
  adb -s "$DEV" shell am force-stop "$pkg" >/dev/null 2>&1
  sleep 1
  if timeout 240 maestro --device "$DEV" test "maestro/$rel" >/tmp/_flow.log 2>&1; then
    echo "PASS  $rel" | tee -a "$OUT"; pass=$((pass+1))
  else
    laststep=$(grep -E 'FAILED|Assertion|Element|not visible' /tmp/_flow.log | tail -1 | tr -s ' ' | cut -c1-110)
    echo "FAIL  $rel   :: $laststep" | tee -a "$OUT"; fail=$((fail+1))
  fi
done
echo "" | tee -a "$OUT"
echo "WARM-RERUN TALLY: PASS=$pass FAIL=$fail TOTAL=$((pass+fail))" | tee -a "$OUT"
