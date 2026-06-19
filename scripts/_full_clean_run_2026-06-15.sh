#!/usr/bin/env bash
# Session 2026-06-15 headline deliverable: full clean-DB + redeploy + on-device
# 39-flow Maestro tally. Orchestrates the three proven scripts in sequence and
# stops at the first failing stage so the failure is diagnosable.
#
#   Stage 1  reset-e2e.sh           clean DB (down -v + reseed) + backend redeploy
#   Stage 2  rebuild-all-apks.sh    rebuild + install 5 release APKs on the device
#   Stage 3  _retally_full_*.sh     full 39-flow on-device Maestro tally
#
# Output: /tmp/full_clean_run_2026-06-15.out (tee'd). Device 9ede6d09, BFF 8082.
set -u
ROOT=/home/nucjd/dev/Terrio/terrio-e2e-tests
OUT=/tmp/full_clean_run_2026-06-15.out
export PATH="$HOME/.maestro/bin:$HOME/Android/Sdk/platform-tools:$PATH"
export BFF_URL=http://localhost:8082
cd "$ROOT"
: > "$OUT"

stage() { echo "" | tee -a "$OUT"; echo "==================== $* ====================" | tee -a "$OUT"; date | tee -a "$OUT"; }

stage "STAGE 1/3 — clean DB reset + backend redeploy (reset-e2e.sh)"
if ! BFF_URL=http://localhost:8082 bash scripts/reset-e2e.sh >>"$OUT" 2>&1; then
  echo "STAGE 1 FAILED — aborting" | tee -a "$OUT"; exit 1
fi
echo "STAGE 1 OK" | tee -a "$OUT"

stage "STAGE 2/3 — rebuild + install 5 release APKs (rebuild-all-apks.sh --release)"
if ! bash scripts/rebuild-all-apks.sh --release >>"$OUT" 2>&1; then
  echo "STAGE 2 FAILED — aborting" | tee -a "$OUT"; exit 1
fi
echo "STAGE 2 OK" | tee -a "$OUT"

stage "STAGE 3/3 — full 39-flow on-device Maestro tally (_retally_full_2026-06-04.sh)"
bash _retally_full_2026-06-04.sh >>"$OUT" 2>&1
echo "STAGE 3 done (see TALLY below)" | tee -a "$OUT"

stage "FINAL TALLY"
grep -E "FULL TALLY|^PASS|^FAIL|PASS=|FAIL=" /tmp/maestro_full_2026-06-04.txt 2>/dev/null | tail -45 | tee -a "$OUT"
tail -5 /tmp/maestro_full_2026-06-04.txt 2>/dev/null | tee -a "$OUT"
echo "ALL STAGES COMPLETE" | tee -a "$OUT"
