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

echo "==> ensure .env exists (fresh checkout has no .env, only .env.example)"
if [ ! -f "$COMPOSE_DIR/.env" ] && [ -f "$COMPOSE_DIR/.env.example" ]; then
  echo "    .env missing in $COMPOSE_DIR — copying from .env.example (dev-safe defaults, no real secrets)"
  cp "$COMPOSE_DIR/.env.example" "$COMPOSE_DIR/.env"
fi

echo "==> docker compose down --volumes"
( cd "$COMPOSE_DIR" && docker compose down --volumes --remove-orphans )

echo "==> clear stale seed cache"
rm -f "$ROOT/test-results/.seed-data.json"

echo "==> docker compose up -d --build --wait"
# --build is REQUIRED, not optional: `down --volumes` removes containers+volumes
# but NOT images. On a cache-warm/self-hosted runner the terrio/*:local images
# from a prior run persist, and a bare `up` reuses them — so merged backend code
# (e.g. identity-access#105 config-driven brute-force ceiling) never reaches the
# running stack and the E2E validates a stale jar. Forcing --build makes backend
# PRs deploy deterministically every run. (Root cause of ble-e2e-tests#146.)
( cd "$COMPOSE_DIR" && docker compose up -d --build --wait --wait-timeout 300 ) || \
  echo "::warning:: compose --wait timed out on a service; gating on critical-service readiness before seed."

# Gate the seed on the CRITICAL services being actually ready before running it.
# The base seed's merchant chain (ensureBeaconFirstConfig → budget-degraded →
# moderation → merchant-adv → branding → landing) runs ONCE and silently no-ops
# against a half-ready stack. Regression 2026-06-08: `up --wait` timed out, the
# seed ran cold, no merchant was created → every merchant-dependent Maestro flow
# failed (20/39 false-negative). Re-running on a warm stack gave 39/39. Poll BFF
# + Keycloak until UP so the seed never runs against a cold stack again.
KC_URL="${KC_URL:-http://localhost:8180}"
echo "==> wait for critical services (BFF + Keycloak) ready"
ready=0
for i in $(seq 1 60); do
  bff_ok=$(curl -fsS -o /dev/null -w '%{http_code}' "$BFF_URL/q/health/ready" 2>/dev/null || echo 000)
  kc_ok=$(curl -fsS -o /dev/null -w '%{http_code}' "$KC_URL/realms/master/.well-known/openid-configuration" 2>/dev/null || echo 000)
  if [ "$bff_ok" = "200" ] && [ "$kc_ok" = "200" ]; then
    ready=1; echo "    ready after ${i} check(s) (BFF=$bff_ok KC=$kc_ok)"; break
  fi
  sleep 5
done
if [ "$ready" != "1" ]; then
  echo "::error:: critical services not ready after 300s (BFF=${bff_ok:-?} KC=${kc_ok:-?}) — aborting to avoid a partial seed"
  echo "==> dumping docker compose state + logs for diagnosis"
  ( cd "$COMPOSE_DIR" && docker compose ps -a ) || true
  echo "==> logs: non-running/unhealthy containers"
  ( cd "$COMPOSE_DIR" && docker compose ps -a --format '{{.Service}}\t{{.State}}' ) | \
    while IFS=$'\t' read -r svc state; do
      case "$state" in
        running) ;;
        *)
          echo "---- docker compose logs --tail=200 $svc (state=$state) ----"
          ( cd "$COMPOSE_DIR" && docker compose logs --no-color --tail=200 "$svc" ) || true
          ;;
      esac
    done
  echo "==> logs: critical services (postgres, keycloak, api-gateway-bff) regardless of state"
  for svc in postgres keycloak api-gateway-bff; do
    echo "---- docker compose logs --tail=200 $svc ----"
    ( cd "$COMPOSE_DIR" && docker compose logs --no-color --tail=200 "$svc" ) || true
  done
  exit 1
fi

echo "==> base seed (fixtures/seed-all.ts)"
( cd "$ROOT" && BFF_URL="$BFF_URL" npx tsx fixtures/seed-all.ts )

echo "==> reset complete — stack up + clean seeded state"
