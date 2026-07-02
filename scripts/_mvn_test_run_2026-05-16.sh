#!/usr/bin/env bash
# Re-run Java backend unit tests fleet-wide — 2026-05-16, post Maven install (T10 unblock).
# Orchestration helper (not repo code). Mirrors _mvn_verify.sh conventions.
export SDKMAN_DIR="$HOME/.sdkman"
# sdkman-init.sh is not `set -u` safe (refs ZSH_VERSION) — source before enabling -u.
[ -s "$HOME/.sdkman/bin/sdkman-init.sh" ] && . "$HOME/.sdkman/bin/sdkman-init.sh"
set -u
ROOT=/home/nucjd/dev/give-group/Terrio
RESULTS="$ROOT/_mvn_test_results_2026-05-16.txt"
: > "$RESULTS"
echo "mvn test run start $(date -u +%H:%M:%S) — $(mvn -v 2>/dev/null | head -1)" | tee -a "$RESULTS"

# Step 1: publish platform-commons artifact so dependent services resolve it from .m2.
cd "$ROOT/terrio-platform-commons" 2>/dev/null && {
  mvn -B -ntp -DskipTests install > "$ROOT/_mvntest_terrio-platform-commons-install.log" 2>&1
  echo "platform-commons install rc=$?" | tee -a "$RESULTS"
}

# Step 2: per-repo mvn test (surefire = unit + @QuarkusTest). Failsafe/IT not run here.
for repo in platform-commons cashback-ledger identity-access core-registry api-gateway-bff event-ingestion stream-processing gamification notification-service reporting-pa; do
  d="$ROOT/terrio-$repo"
  log="$ROOT/_mvntest_terrio-$repo.log"
  [ -d "$d" ] || { echo "$repo: NO DIR" | tee -a "$RESULTS"; continue; }
  cd "$d" || continue
  echo "[$(date -u +%H:%M:%S)] $repo test start" | tee -a "$RESULTS"
  timeout 1200 mvn -B -ntp test > "$log" 2>&1
  rc=$?
  summary=$(grep -hE 'Tests run:' "$log" | tail -1)
  fails=$(grep -hcE '<<< (FAIL|ERROR)' "$log" 2>/dev/null || echo 0)
  echo "$repo rc=$rc fails~$fails | ${summary:-no-surefire-summary}" | tee -a "$RESULTS"
done
echo "mvn test run done $(date -u +%H:%M:%S)" | tee -a "$RESULTS"
