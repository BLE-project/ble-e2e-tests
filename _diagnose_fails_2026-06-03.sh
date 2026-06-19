#!/usr/bin/env bash
# Diagnose the 13 still-failing flows by capturing the ACTUAL failing step line
# (the "<step>... FAILED" line), not Maestro's generic "loading state" hint.
set -u
export PATH="$HOME/.maestro/bin:$PATH"
export MAESTRO_CLI_NO_ANALYTICS=1
DEV=9ede6d09
OUT=/tmp/maestro_diagnose_2026-06-03.txt
cd /home/nucjd/dev/Terrio/terrio-e2e-tests
adb -s "$DEV" reverse tcp:8080 tcp:8082 >/dev/null 2>&1
: > "$OUT"

declare -A PKG=(
  [consumer-mobile]=it.terrio.consumer
  [merchant-mobile]=it.terrio.merchant
  [tenant-mobile]=it.terrio.tenant
  [sales-agent-mobile]=it.terrio.salesagent
)

FAILS=(
  consumer-mobile/beacon-scan-background.yaml
  consumer-mobile/custom-branding.yaml
  consumer-mobile/merchant-landing.yaml
  consumer-mobile/notification-preferences.yaml
  merchant-mobile/adv-appeal.yaml
  merchant-mobile/adv-list-filter.yaml
  merchant-mobile/adv-submit.yaml
  merchant-mobile/adv-takedown.yaml
  merchant-mobile/bcn-map-gps-capture.yaml
  tenant-mobile/moderation-tenant-review.yaml
  sales-agent-mobile/bcn-map-gps-capture.yaml
  sales-agent-mobile/moderation-approve.yaml
  sales-agent-mobile/moderation-reject.yaml
)

for rel in "${FAILS[@]}"; do
  app=${rel%%/*}
  pkg=${PKG[$app]}
  adb -s "$DEV" shell am force-stop "$pkg" >/dev/null 2>&1
  sleep 1
  timeout 240 maestro --device "$DEV" test "maestro/$rel" >/tmp/_flow.log 2>&1
  # the real failing step is the LAST line ending in "FAILED"
  step=$(grep -E '\.\.\. FAILED$' /tmp/_flow.log | tail -1 | sed 's/\.\.\. FAILED$//' | tr -s ' ' | cut -c1-95)
  [ -z "$step" ] && step=$(grep -iE 'failed|error|timeout' /tmp/_flow.log | tail -1 | tr -s ' ' | cut -c1-95)
  echo "$rel :: ${step}" | tee -a "$OUT"
done
