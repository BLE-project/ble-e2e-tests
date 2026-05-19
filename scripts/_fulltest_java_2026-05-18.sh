#!/usr/bin/env bash
# Full Java backend test + jacoco coverage + SonarQube scan — fleet-wide, 2026-05-18.
# Orchestration helper (not repo code). One pass per repo via _sonar_scan_mvn.sh
# (mvn test jacoco:report -> sonar:sonar). SONAR_HOST_URL forced to :9011 because
# the env var still points at the wrong :9001 (FU-6 secret-file fix not applied).
export SDKMAN_DIR="$HOME/.sdkman"
[ -s "$HOME/.sdkman/bin/sdkman-init.sh" ] && . "$HOME/.sdkman/bin/sdkman-init.sh"
set -u
ROOT=/home/nucjd/dev/Terrio
export SONAR_HOST_URL=http://localhost:9011
SUM="$ROOT/_fulltest_java_summary.txt"
: > "$SUM"
echo "java full-test+sonar start $(date -u +%H:%M:%S) — $(mvn -v 2>/dev/null | head -1)" | tee -a "$SUM"

# platform-commons is a dependency of the services — install to .m2 first.
cd "$ROOT/terrio-platform-commons" 2>/dev/null && {
  mvn -B -ntp -DskipTests install > "$ROOT/_ft_install_commons.log" 2>&1
  echo "platform-commons install rc=$?" | tee -a "$SUM"
}

for repo in terrio-platform-commons terrio-cashback-ledger terrio-identity-access \
            terrio-core-registry terrio-api-gateway-bff terrio-event-ingestion \
            terrio-stream-processing terrio-gamification terrio-notification-service \
            terrio-reporting-pa; do
  d="$ROOT/$repo"
  [ -d "$d" ] || { echo "$repo: NO DIR" | tee -a "$SUM"; continue; }
  : > "$ROOT/_sonar_${repo}.log"
  echo "[$(date -u +%H:%M:%S)] $repo start" | tee -a "$SUM"
  bash "$ROOT/_sonar_scan_mvn.sh" "$repo"
  scan_rc=$?
  log="$ROOT/_sonar_${repo}.log"
  tests=$(grep -hE 'Tests run:' "$log" | tail -1)
  fails=$(grep -hcE '<<< (FAIL|ERROR)' "$log" 2>/dev/null || echo 0)
  qg=$(grep -hiE 'QUALITY GATE|ANALYSIS SUCCESSFUL' "$log" | tail -1)
  echo "$repo scan_rc=$scan_rc fails~$fails | ${tests:-no-surefire-summary} | ${qg:-no-qg-line}" | tee -a "$SUM"
done
echo "java full-test done $(date -u +%H:%M:%S)" | tee -a "$SUM"
