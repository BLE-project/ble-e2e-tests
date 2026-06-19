#!/usr/bin/env bash
# Full on-device Maestro re-tally — 2026-06-03, post moderation-budget-degraded
# (ble-notification-service#83 + ble-e2e-tests#59 merged). Per-flow pm-clear for
# an accurate tally, with a one-time warm launch of every app first to avoid the
# cold-start/dexopt false-fail on the first flow.
set -u
export PATH="$HOME/.maestro/bin:$PATH"
export MAESTRO_CLI_NO_ANALYTICS=1
DEV=9ede6d09
OUT=/tmp/maestro_tally_2026-06-03.txt
cd /home/nucjd/dev/Terrio/terrio-e2e-tests
adb -s "$DEV" reverse tcp:8080 tcp:8082 >/dev/null 2>&1
: > "$OUT"

declare -A PKG=(
  [consumer-mobile]=it.terrio.consumer
  [merchant-mobile]=it.terrio.merchant
  [tenant-mobile]=it.terrio.tenant
  [sales-agent-mobile]=it.terrio.salesagent
  [territory-mobile]=it.terrio.territory
)

# ── Warm every app once (dexopt / ART compile) so the first real flow per app
#    isn't penalised by a cold launch ───────────────────────────────────────
echo "warming apps..." | tee -a "$OUT"
for app in "${!PKG[@]}"; do
  pkg=${PKG[$app]}
  adb -s "$DEV" shell monkey -p "$pkg" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
  sleep 4
  adb -s "$DEV" shell am force-stop "$pkg" >/dev/null 2>&1
done

pass=0; fail=0
for app in consumer-mobile merchant-mobile tenant-mobile sales-agent-mobile territory-mobile; do
  pkg=${PKG[$app]}
  for f in maestro/$app/*.yaml; do
    base=$(basename "$f")
    case "$base" in _*) continue;; esac   # skip subflows (_gates.yaml etc.)
    adb -s "$DEV" shell pm clear "$pkg" >/dev/null 2>&1
    sleep 1
    if timeout 240 maestro --device "$DEV" test "$f" >/tmp/_flow.log 2>&1; then
      echo "PASS  $app/$base" | tee -a "$OUT"; pass=$((pass+1))
    else
      laststep=$(grep -E 'FAILED|Assertion|Element|not visible' /tmp/_flow.log | tail -1 | tr -s ' ' | cut -c1-100)
      echo "FAIL  $app/$base   :: $laststep" | tee -a "$OUT"; fail=$((fail+1))
    fi
  done
done
echo "" | tee -a "$OUT"
echo "TALLY: PASS=$pass FAIL=$fail TOTAL=$((pass+fail))" | tee -a "$OUT"
