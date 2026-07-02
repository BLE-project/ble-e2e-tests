#!/usr/bin/env bash
# Sonar scan helper for one Node/TS Terrio repo via sonar-scanner-cli docker image.
# Invoked from the orchestrator session as: bash _sonar_scan_node.sh <repo>
set -u
# BASH_ENV (~/.claude/.secrets/github-env.sh) re-sources the secrets on every
# non-interactive bash startup and resets SONAR_HOST_URL to the wrong :9001.
# Re-assert :9011 here in the script body — runs AFTER BASH_ENV sourcing.
export SONAR_HOST_URL=http://localhost:9011
repo="$1"
src_path="/home/nucjd/dev/give-group/Terrio/$repo"
[ -d "$src_path" ] || { echo "[$repo] missing dir"; exit 2; }
log="/home/nucjd/dev/give-group/Terrio/_sonar_${repo}.log"
echo "[$(date +%H:%M:%S)] [$repo] start" | tee -a "$log"
src="src"
[ -d "$src_path/app" ] && src="src,app"
[ ! -d "$src_path/src" ] && [ -d "$src_path/lib" ] && src="lib"

# SQ-3 (#181) fix: generate lcov coverage BEFORE the sonar-scanner run.
# Without this the lcov.info file is missing and Sonar reports 0% coverage
# even though reportPaths points to a valid path. Skips silently when
# the repo has no test script (some web/mobile repos still TBD).
if [ -f "$src_path/package.json" ] && grep -q '"test"' "$src_path/package.json"; then
  (
    cd "$src_path"
    # Prefer the canonical Terrio coverage script when present; otherwise
    # fall back to a generic `npm test -- --coverage` invocation.
    if grep -q '"test:cov"' package.json; then
      npm run test:cov >> "$log" 2>&1
    elif grep -qE '"test":[[:space:]]*"[^"]*vitest' package.json; then
      # vitest rejects the jest-only --watchAll flag; `run` forces non-watch.
      npx --no-install vitest run --coverage >> "$log" 2>&1
    else
      CI=true npm test -- --coverage --watchAll=false >> "$log" 2>&1
    fi
  )
  test_rc=$?
  echo "[$(date +%H:%M:%S)] [$repo] coverage-gen rc=$test_rc" | tee -a "$log"
else
  echo "[$(date +%H:%M:%S)] [$repo] no test script — skipping coverage gen" | tee -a "$log"
fi

docker run --rm --network host \
  -e SONAR_HOST_URL="${SONAR_HOST_URL:-http://localhost:9011}" \
  -e SONAR_TOKEN="$SONAR_TOKEN" \
  -v "${src_path}:/usr/src" \
  sonarsource/sonar-scanner-cli:latest \
  -Dsonar.projectKey="$repo" \
  -Dsonar.projectName="$repo" \
  -Dsonar.sources="$src" \
  -Dsonar.exclusions='**/node_modules/**,**/dist/**,**/build/**,**/*.test.ts,**/*.test.tsx,**/*.spec.ts,**/__mocks__/**,**/coverage/**' \
  -Dsonar.javascript.lcov.reportPaths='coverage/lcov.info' \
  -Dsonar.typescript.lcov.reportPaths='coverage/lcov.info' \
  >> "$log" 2>&1
rc=$?
echo "[$(date +%H:%M:%S)] [$repo] done rc=$rc" | tee -a "$log"
exit $rc
