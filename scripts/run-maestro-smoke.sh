#!/usr/bin/env bash
# §18 / Sprint 39.3 — Maestro smoke runner con warm-up BFF.
#
# Lancia login + navigation flow per ogni mobile app (5 app × 2 flow = 10).
# Precondizioni:
#   - Docker stack up (docker compose up -d in terrio-e2e-compose)
#   - BFF Quarkus dev mode up su :8080 (via ./mvnw quarkus:dev in terrio-api-gateway-bff)
#   - Device con 5 com.terrio.* APK installati
#   - adb reverse configurato
#
# Gli eventuali fallimenti sono raccolti in /tmp/maestro-smoke-report.md e
# stampati alla fine.
#
# Output exit code:
#   0 — tutti i flow passed
#   >0 — numero di flow failed

set -u

ADB="${ANDROID_HOME:-$HOME/Android/Sdk}/platform-tools/adb.exe"
MAESTRO="$HOME/.maestro/bin/maestro"
REPORT="/tmp/maestro-smoke-report.md"

rm -f "$REPORT"
echo "# Maestro smoke report — $(date -Iseconds)" > "$REPORT"
echo "" >> "$REPORT"

# ── Warm BFF ────────────────────────────────────────────────────────────────
echo "▸ Warming BFF + identity-access..."
for i in 1 2 3; do
  curl -s -X POST http://localhost:8080/api/v1/auth/login \
    -H "Content-Type: application/json" \
    -d '{"username":"dev-tenant-admin","password":"dev-pass"}' \
    --max-time 30 -o /dev/null -w "  warmup-$i: %{http_code} %{time_total}s\n"
done

# ── adb reverse ────────────────────────────────────────────────────────────
echo "▸ Configuring adb reverse..."
"$ADB" reverse tcp:8080 tcp:8080
"$ADB" reverse tcp:8180 tcp:8180
"$ADB" reverse tcp:8087 tcp:8087

# ── Run flows ──────────────────────────────────────────────────────────────
PASS=0
FAIL=0
declare -a FAILED

for app in territory sales-agent merchant consumer tenant; do
  for flow in login navigation; do
    flowpath="maestro/${app}-mobile/${flow}.yaml"
    if [ ! -f "$flowpath" ]; then continue; fi

    case "$app" in
      sales-agent) pkg="com.terrio.salesagent" ;;
      *)           pkg="com.terrio.${app}"    ;;
    esac

    echo ""
    echo "▸ ${app} / ${flow}"
    "$ADB" shell am force-stop "$pkg" 2>/dev/null
    sleep 2

    result=$(timeout 180 "$MAESTRO" test "$flowpath" 2>&1)
    if echo "$result" | grep -qE "\[Failed\]|Assertion is false|Assertion '.*' failed"; then
      FAIL=$((FAIL+1))
      FAILED+=("$app/$flow")
      echo "  ❌ FAIL"
      echo "## ❌ $app / $flow" >> "$REPORT"
      echo '```' >> "$REPORT"
      echo "$result" | tail -10 >> "$REPORT"
      echo '```' >> "$REPORT"
      echo "" >> "$REPORT"
    else
      PASS=$((PASS+1))
      echo "  ✅ PASS"
    fi
  done
done

# ── Summary ────────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════════════════"
echo "  Maestro smoke results: ${PASS} passed / ${FAIL} failed"
echo "═══════════════════════════════════════════════════════════════════════"

if [ "$FAIL" -gt 0 ]; then
  echo ""
  echo "Failed flows:"
  for f in "${FAILED[@]}"; do echo "  - $f"; done
  echo ""
  echo "Full details: $REPORT"
fi

exit $FAIL
