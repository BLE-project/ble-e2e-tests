#!/usr/bin/env bash
# Re-tally the full on-device Maestro suite after the RLS interceptor fix
# (PR #71/#72/#73). Per-flow pm-clear for an accurate tally.
set -u
export PATH="$HOME/.maestro/bin:$PATH"
DEV=9ede6d09
OUT=/tmp/maestro_tally_2026-06-02.txt
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

pass=0; fail=0
for app in consumer-mobile merchant-mobile tenant-mobile sales-agent-mobile territory-mobile; do
  pkg=${PKG[$app]}
  for f in maestro/$app/*.yaml; do
    base=$(basename "$f")
    case "$base" in _*) continue;; esac   # skip subflows (_gates.yaml etc.)
    adb -s "$DEV" shell pm clear "$pkg" >/dev/null 2>&1
    sleep 1
    if timeout 220 maestro --device "$DEV" test "$f" >/tmp/_flow.log 2>&1; then
      echo "PASS  $app/$base" | tee -a "$OUT"; pass=$((pass+1))
    else
      laststep=$(grep -E 'FAILED|Assertion' /tmp/_flow.log | tail -1 | tr -s ' ' | cut -c1-90)
      echo "FAIL  $app/$base   :: $laststep" | tee -a "$OUT"; fail=$((fail+1))
    fi
  done
done
echo "" | tee -a "$OUT"
echo "TALLY: PASS=$pass FAIL=$fail TOTAL=$((pass+fail))" | tee -a "$OUT"
