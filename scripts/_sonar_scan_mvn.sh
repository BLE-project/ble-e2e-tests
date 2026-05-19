#!/usr/bin/env bash
# Sonar scan helper for one Java/Maven Terrio repo.
# Invoked from the orchestrator session as: bash _sonar_scan_mvn.sh <repo>
set -u
# BASH_ENV (~/.claude/.secrets/github-env.sh) re-sources the secrets on every
# non-interactive bash startup and resets SONAR_HOST_URL to the wrong :9001.
# Re-assert :9011 here in the script body — runs AFTER BASH_ENV sourcing.
export SONAR_HOST_URL=http://localhost:9011
repo="$1"
cd "/home/nucjd/dev/Terrio/$repo" || { echo "[$repo] missing dir"; exit 2; }
log="/home/nucjd/dev/Terrio/_sonar_${repo}.log"
echo "[$(date +%H:%M:%S)] [$repo] start" | tee -a "$log"

# SQ-3 (#181) fix: generate jacoco coverage BEFORE sonar:sonar so the
# xmlReportPaths param finds a non-empty report. Without this the scan
# uploads 0% coverage even though the param points to a valid path.
# -DfailIfNoTests=false guards against empty-test modules aborting the
# chain (some early-stage repos still have stub tests only).
mvn -B -ntp \
  -DfailIfNoTests=false \
  -Pcoverage \
  test jacoco:report >> "$log" 2>&1
test_rc=$?
echo "[$(date +%H:%M:%S)] [$repo] coverage-gen rc=$test_rc" | tee -a "$log"

# Sonar scan with coverage report uploaded. -DskipTests because the test
# phase already ran above; skipping prevents a second slow run.
mvn -B -ntp -DskipTests \
  -Dsonar.host.url="${SONAR_HOST_URL:-http://localhost:9011}" \
  -Dsonar.token="$SONAR_TOKEN" \
  -Dsonar.projectKey="$repo" \
  -Dsonar.projectName="$repo" \
  -Dsonar.projectBaseDir=. \
  -Dsonar.sources=src/main \
  -Dsonar.tests=src/test \
  -Dsonar.java.binaries=target/classes \
  -Dsonar.coverage.jacoco.xmlReportPaths=target/jacoco-report/jacoco.xml,target/site/jacoco/jacoco.xml \
  compile sonar:sonar >> "$log" 2>&1
rc=$?
echo "[$(date +%H:%M:%S)] [$repo] done rc=$rc" | tee -a "$log"
exit $rc
