#!/usr/bin/env bash
# Start the frontend dev servers (Vite) that Playwright's
# admin-web/tenant-web/merchant-portal projects need.
#
# Diagnosed 2026-07-01: the E2E full-reset CI job only ever started the
# backend/BFF stack — the 134 ECONNREFUSED failures on :5173/:5174/:5175
# were dev servers that were never launched, not an app bug. This script
# starts them as background processes (persist across CI steps in the
# same job) and waits until each responds before returning.
#
# marketing-site (Astro, :4321) is intentionally NOT started here: Astro 6
# requires Node >=22.12 while the 3 Vite apps below pin Node 20, so this
# script stays Node-20/Vite-only. In CI, marketing-site is built and
# previewed by a dedicated Node 22 step in e2e-full-reset.yml (before the
# job switches to Node 20) — see that workflow's header.
#
# Repos are expected as siblings of this repo's parent dir, same
# convention as terrio-e2e-compose (see scripts/reset-e2e.sh):
#   REPOS_ROOT/terrio-backoffice-admin-web   (vite, :5174)
#   REPOS_ROOT/terrio-backoffice-tenant-web  (vite, :5173)
#   REPOS_ROOT/terrio-merchant-portal        (vite, :5175)
#
#   REPOS_ROOT=.. scripts/start-frontends.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPOS_ROOT="${REPOS_ROOT:-$ROOT/..}"
LOG_DIR="${LOG_DIR:-$ROOT/test-results/frontend-logs}"
mkdir -p "$LOG_DIR"

# name:dir:port:url
apps=(
  "admin-web:terrio-backoffice-admin-web:5174:http://localhost:5174"
  "tenant-web:terrio-backoffice-tenant-web:5173:http://localhost:5173"
  "merchant-portal:terrio-merchant-portal:5175:http://localhost:5175"
)

for entry in "${apps[@]}"; do
  IFS=':' read -r name dir port url <<< "$entry"
  app_dir="$REPOS_ROOT/$dir"
  if [ ! -d "$app_dir" ]; then
    echo "::warning:: $name — $app_dir not found, skipping (checkout step must clone it first)"
    continue
  fi

  echo "==> $name: env + npm ci"
  ( cd "$app_dir" && [ -f .env.local ] || { [ -f .env.example ] && cp .env.example .env.local; } )
  ( cd "$app_dir" && npm ci --no-audit --no-fund )

  echo "==> $name: starting dev server on :$port (log: $LOG_DIR/$name.log)"
  ( cd "$app_dir" && nohup npm run dev -- --port "$port" --strictPort > "$LOG_DIR/$name.log" 2>&1 & disown )
done

echo "==> waiting for frontend dev servers to respond"
for entry in "${apps[@]}"; do
  IFS=':' read -r name dir port url <<< "$entry"
  app_dir="$REPOS_ROOT/$dir"
  [ -d "$app_dir" ] || continue

  ready=0
  for i in $(seq 1 60); do
    code=$(curl -fsS -o /dev/null -w '%{http_code}' "$url" 2>/dev/null || echo 000)
    if [ "$code" != "000" ]; then
      ready=1; echo "    $name ready after ${i} check(s) (HTTP $code)"; break
    fi
    sleep 2
  done
  if [ "$ready" != "1" ]; then
    echo "::error:: $name not responding on $url after 120s"
    echo "---- $LOG_DIR/$name.log (tail 100) ----"
    tail -n 100 "$LOG_DIR/$name.log" 2>/dev/null || echo "(no log file)"
    exit 1
  fi
done

echo "==> all frontend dev servers ready"
