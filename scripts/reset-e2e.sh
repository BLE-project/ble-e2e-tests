#!/usr/bin/env bash
# Reset the E2E stack + data to a clean, fully-seeded state.
#
# Wipes the compose volumes (Postgres / Keycloak / ClickHouse), clears the
# host-side seed cache (test-results/.seed-data.json survives `down -v` and would
# otherwise feed a stale token into the next seed — see ble-e2e-tests#76), brings
# the stack back up, and runs the full base seed. Use before a from-scratch
# Maestro suite run to avoid false negatives from accumulated state.
#
#   BFF_URL=http://localhost:8082 scripts/reset-e2e.sh
set -euo pipefail
BFF_URL="${BFF_URL:-http://localhost:8082}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE_DIR="${COMPOSE_DIR:-$ROOT/../terrio-e2e-compose}"

echo "==> docker compose down --volumes"
( cd "$COMPOSE_DIR" && docker compose down --volumes --remove-orphans )

echo "==> clear stale seed cache"
rm -f "$ROOT/test-results/.seed-data.json"

echo "==> docker compose up -d --wait"
( cd "$COMPOSE_DIR" && docker compose up -d --wait --wait-timeout 300 ) || \
  echo "::warning:: compose --wait timed out on a non-critical service; continuing (the seed verifies BFF/KC/core-registry)."

echo "==> base seed (fixtures/seed-all.ts)"
( cd "$ROOT" && BFF_URL="$BFF_URL" npx tsx fixtures/seed-all.ts )

echo "==> reset complete — stack up + clean seeded state"
