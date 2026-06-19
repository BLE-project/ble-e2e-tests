#!/usr/bin/env bash
# mvn verify helper for one Java/Maven Terrio repo (Phase B coverage gen).
# Invoked from orchestrator session as: bash _mvn_verify.sh <repo>
set -u
repo="$1"
cd "/home/nucjd/dev/Terrio/$repo" || { echo "[$repo] missing dir"; exit 2; }
log="/home/nucjd/dev/Terrio/_verify_${repo}.log"
echo "[$(date +%H:%M:%S)] [$repo] verify start" | tee -a "$log"
timeout 600 mvn -B -ntp -q -DskipITs verify >> "$log" 2>&1
rc=$?
echo "[$(date +%H:%M:%S)] [$repo] verify done rc=$rc" | tee -a "$log"
exit $rc
