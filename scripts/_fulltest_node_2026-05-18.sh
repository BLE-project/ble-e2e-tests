#!/usr/bin/env bash
# Full Node/web/mobile test + coverage + SonarQube scan — fleet-wide, 2026-05-18.
# Orchestration helper (not repo code). One pass per repo via _sonar_scan_node.sh
# (npm test --coverage -> dockerised sonar-scanner-cli). automation-agents (python)
# handled separately with pytest --cov.
set -u
ROOT=/home/nucjd/dev/Terrio
export SONAR_HOST_URL=http://localhost:9011
SUM="$ROOT/_fulltest_node_summary.txt"
: > "$SUM"
echo "node full-test+sonar start $(date -u +%H:%M:%S) — node $(node -v)" | tee -a "$SUM"

for repo in terrio-backoffice-admin-web terrio-backoffice-tenant-web terrio-merchant-portal \
            terrio-consumer-mobile terrio-merchant-mobile terrio-tenant-mobile \
            terrio-territory-mobile terrio-sales-agent-mobile; do
  d="$ROOT/$repo"
  [ -d "$d" ] || { echo "$repo: NO DIR" | tee -a "$SUM"; continue; }
  : > "$ROOT/_sonar_${repo}.log"
  echo "[$(date -u +%H:%M:%S)] $repo start" | tee -a "$SUM"
  bash "$ROOT/_sonar_scan_node.sh" "$repo"
  scan_rc=$?
  log="$ROOT/_sonar_${repo}.log"
  tests=$(grep -hiE 'Tests:|Test Files|Test Suites' "$log" | tail -2 | tr '\n' ' / ')
  cov=$(grep -hE 'All files' "$log" | tail -1)
  echo "$repo scan_rc=$scan_rc | tests: ${tests:-?} | cov: ${cov:-?}" | tee -a "$SUM"
done

# automation-agents — python pytest with coverage.
# pytest-cov may be absent (rc=4 "unrecognized arguments: --cov"); install it,
# and fall back to a plain run so pass/fail is still captured either way.
cd "$ROOT/terrio-automation-agents" 2>/dev/null && {
  pylog="$ROOT/_ft_automation-agents.log"
  : > "$pylog"
  python3 -m pip install -q pytest-cov >> "$pylog" 2>&1
  python3 -m pytest --cov --cov-report=xml --cov-report=term -q >> "$pylog" 2>&1
  py_rc=$?
  if [ "$py_rc" -eq 4 ]; then
    python3 -m pytest -q >> "$pylog" 2>&1
    py_rc=$?
  fi
  pysum=$(grep -hiE '[0-9]+ (passed|failed|error)' "$pylog" | tail -1)
  echo "automation-agents pytest rc=$py_rc | ${pysum:-no-summary}" | tee -a "$SUM"
}
echo "node full-test done $(date -u +%H:%M:%S)" | tee -a "$SUM"
