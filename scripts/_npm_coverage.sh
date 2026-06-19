#!/usr/bin/env bash
# npm coverage helper for Node Terrio repos
set -u
repo="$1"
cd "/home/nucjd/dev/Terrio/$repo" || exit 2
log="/home/nucjd/dev/Terrio/_cov_${repo}.log"
echo "[$(date +%H:%M:%S)] [$repo] coverage start" | tee -a "$log"
timeout 600 npm test --silent -- --coverage --coverageReporters=lcov >> "$log" 2>&1
rc=$?
echo "[$(date +%H:%M:%S)] [$repo] coverage done rc=$rc" | tee -a "$log"
[ -f coverage/lcov.info ] && echo "[$repo] lcov.info OK" || echo "[$repo] lcov.info MISSING"
exit $rc
