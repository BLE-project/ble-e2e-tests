#!/usr/bin/env bash
# Full 39-flow Android Maestro re-tally — clean sequential baseline (FU-TI-1..4).
#
#   FU-TI-1  realm-ble.json accessTokenLifespan=1800 (rebuild KC) so a persisted
#            merchant session token survives a long batch (no mid-flow 401).
#   FU-TI-2  re-seed the moderation queue before each sales-agent moderation flow
#   FU-TI-3  restart the Maestro driver + bounce adb BEFORE EVERY flow (not just
#            per batch) so the driver never accumulates flakiness.
#   FU-TI-4  re-seed merchant ADVs before each adv-* flow (adv-takedown consumes
#            the APPROVED ADV); tenant/beacons uses a per-run random identity.
set -u
export PATH="$HOME/.maestro/bin:$HOME/Android/Sdk/platform-tools:$PATH"
export MAESTRO_CLI_NO_ANALYTICS=1
DEV=9ede6d09
BFF=http://localhost:8082
OUT=/tmp/maestro_full_2026-06-04.txt
cd /home/nucjd/dev/Terrio/terrio-e2e-tests
: > "$OUT"

declare -A PKG=(
  [consumer-mobile]=it.terrio.consumer
  [merchant-mobile]=it.terrio.merchant
  [sales-agent-mobile]=it.terrio.salesagent
  [tenant-mobile]=it.terrio.tenant
  [territory-mobile]=it.terrio.territory
)
APPS=(consumer-mobile merchant-mobile sales-agent-mobile tenant-mobile territory-mobile)

reverse_setup() {
  adb -s "$DEV" reverse tcp:8080 tcp:8082 >/dev/null 2>&1
  adb -s "$DEV" reverse tcp:8180 tcp:8180 >/dev/null 2>&1
}

# FU-TI-3: bounce the Maestro driver + adb before every flow.
restart_driver() {
  pkill -f maestro.cli.AppKt >/dev/null 2>&1
  adb kill-server >/dev/null 2>&1; sleep 2
  adb start-server >/dev/null 2>&1; sleep 2
  adb -s "$DEV" wait-for-device
  reverse_setup
}

# FU-TI-2 / FU-TI-4: re-seed the data a flow consumes, just before it runs.
reseed_for() {
  case "$1" in
    sales-agent-mobile/moderation-*)   BFF_URL="$BFF" npx tsx fixtures/seed-cli.ts moderation        >/dev/null 2>&1 ;;
    tenant-mobile/moderation-tenant-review.yaml) BFF_URL="$BFF" npx tsx fixtures/seed-cli.ts moderation >/dev/null 2>&1 ;;
    merchant-mobile/adv-*)             BFF_URL="$BFF" npx tsx fixtures/seed-cli.ts merchant-adv      >/dev/null 2>&1 ;;
    tenant-mobile/beacons.yaml)        BFF_URL="$BFF" npx tsx fixtures/seed-cli.ts tenant-beacon     >/dev/null 2>&1 ;;
    consumer-mobile/custom-branding.yaml) BFF_URL="$BFF" npx tsx fixtures/seed-cli.ts consumer-branding >/dev/null 2>&1 ;;
  esac
}

pass=0; fail=0
for app in "${APPS[@]}"; do
  pkg=${PKG[$app]}
  echo "===== BATCH $app =====" | tee -a "$OUT"
  for f in maestro/$app/*.yaml; do
    base=$(basename "$f")
    case "$base" in _*|*subflow*) continue;; esac
    restart_driver                       # FU-TI-3
    reseed_for "$app/$base"              # FU-TI-2 / FU-TI-4
    adb -s "$DEV" shell am force-stop "$pkg" >/dev/null 2>&1; sleep 1
    if timeout 240 maestro --device "$DEV" test "$f" >/tmp/_full.log 2>&1; then
      echo "PASS  $app/$base" | tee -a "$OUT"; pass=$((pass+1))
    else
      step=$(grep -E '\.\.\. FAILED$' /tmp/_full.log | tail -1 | sed 's/\.\.\. FAILED$//' | tr -s ' ' | cut -c1-80)
      echo "FAIL  $app/$base   :: $step" | tee -a "$OUT"; fail=$((fail+1))
    fi
  done
done
echo "" | tee -a "$OUT"
echo "FULL TALLY: PASS=$pass FAIL=$fail TOTAL=$((pass+fail))" | tee -a "$OUT"
