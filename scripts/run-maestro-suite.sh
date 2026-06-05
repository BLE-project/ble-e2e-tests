#!/usr/bin/env bash
# Run the full Maestro suite deterministically (the FU-TI-1..4 logic, CI-ready).
#
# Mirrors the local _retally_full driver but adapted for a CI emulator:
#   - per-flow isolation via `pm clear` (the emulator shell HOLDS
#     CLEAR_APP_USER_DATA, unlike the physical test device) → every flow starts
#     cold + logged-out, so no cross-flow state contamination (FU-TI-3 / the
#     pm-clear-denied logout-first need both dissolve on the emulator);
#   - per-flow re-seed of shared backend data before the flows that consume it
#     (FU-TI-2 / FU-TI-4) via fixtures/seed-cli.ts;
#   - the realm token TTL (FU-TI-1) is baked into the compose stack's
#     realm-ble.json, so nothing to do here.
#
# Usage:
#   DEVICE=emulator-5554 BFF_URL=http://localhost:8080 scripts/run-maestro-suite.sh [app ...]
# With no app args it runs all five. Exits non-zero if any flow fails.
set -u
DEVICE="${DEVICE:-emulator-5554}"
BFF_URL="${BFF_URL:-http://localhost:8080}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

declare -A PKG=(
  [consumer-mobile]=it.terrio.consumer
  [merchant-mobile]=it.terrio.merchant
  [sales-agent-mobile]=it.terrio.salesagent
  [tenant-mobile]=it.terrio.tenant
  [territory-mobile]=it.terrio.territory
)

APPS=("$@")
[ ${#APPS[@]} -eq 0 ] && APPS=(consumer-mobile merchant-mobile sales-agent-mobile tenant-mobile territory-mobile)

# FU-TI-2 / FU-TI-4: refresh the data a flow consumes, just before it runs.
reseed_for() {
  case "$1" in
    sales-agent-mobile/moderation-*)      seed moderation ;;
    merchant-mobile/adv-*)                seed merchant-adv ;;
    tenant-mobile/beacons.yaml)           seed tenant-beacon ;;
    consumer-mobile/custom-branding.yaml) seed consumer-branding ;;
  esac
}
seed() { BFF_URL="$BFF_URL" npx tsx fixtures/seed-cli.ts "$1" >/dev/null 2>&1 || echo "::warning::seed $1 failed"; }

pass=0; fail=0; failed=()
for app in "${APPS[@]}"; do
  pkg=${PKG[$app]}
  echo "::group::BATCH $app"
  for f in maestro/$app/*.yaml; do
    base=$(basename "$f")
    case "$base" in _*|*subflow*) continue;; esac
    # FU-TI-3 equivalent: cold per-flow isolation (emulator allows pm clear).
    adb -s "$DEVICE" shell pm clear "$pkg" >/dev/null 2>&1 || adb -s "$DEVICE" shell am force-stop "$pkg" >/dev/null 2>&1
    reseed_for "$app/$base"
    if maestro --device "$DEVICE" test "$f" --flatten-debug-output; then
      echo "PASS  $app/$base"; pass=$((pass+1))
    else
      echo "FAIL  $app/$base"; fail=$((fail+1)); failed+=("$app/$base")
    fi
  done
  echo "::endgroup::"
done

echo "FULL TALLY: PASS=$pass FAIL=$fail TOTAL=$((pass+fail))"
if [ "$fail" -gt 0 ]; then printf '::error::Maestro flow failed: %s\n' "${failed[@]}"; exit 1; fi
