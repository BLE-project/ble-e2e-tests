#!/usr/bin/env bash
# DS-MOB-004 — best-effort BFF reachability probe FROM the emulator's network
# namespace. `adb reverse tcp:8080` maps the emulator's localhost:8080 onto the
# runner-host stack; the mobile apps fall back to http://localhost:8080 when no
# EXPO_PUBLIC_GATEWAY_URL is baked in, so this confirms whether the app's
# bootstrap HTTP calls can actually reach the backend — the prime suspect for
# the home screen never rendering (login-btn / scan-status never appear).
#
# Informational ONLY: it never fails the step (the trailing `|| echo` swallows a
# missing HTTP client). Lives in a script file (not inline in the
# emulator-runner `script:` block) to avoid the embedded-sh syntax footgun.
set -u
DEVICE="${DEVICE:-emulator-5554}"
URL="${1:-http://localhost:8080/q/health/ready}"
echo "=== BFF reachability from emulator ($DEVICE): $URL ==="
adb -s "$DEVICE" shell "curl -s -m 5 -o /dev/null -w 'emulator->host HTTP %{http_code}\n' '$URL' 2>/dev/null || echo 'no usable HTTP client in emulator shell (probe inconclusive)'"
