#!/usr/bin/env bash
# DS-MOB-004 — install the 5 debug APKs onto the CI emulator.
#
# Lives in a real script file (not inline in the emulator-runner `script:` block)
# because a multi-line for/if/else there is embedded in a way that breaks sh
# ("Syntax error: end of file unexpected (expecting done)"). Called as a single
# line from the workflow.
#
# actions/download-artifact@v4 extracts each artifact into a directory named
# after the artifact (apks/ble-<app>-dev.apk/app-debug.apk), so the .apk is
# INSIDE that directory.
set -u
DEVICE="${DEVICE:-emulator-5554}"
for app in consumer merchant tenant sales-agent territory; do
  apk=$(find "apks/ble-${app}-dev.apk" -name "*.apk" 2>/dev/null | head -1)
  if [ -n "$apk" ] && [ -f "$apk" ]; then
    echo "Installing ${app} from ${apk}"
    adb -s "$DEVICE" install -r "$apk" || echo "::warning::adb install failed for ${app}"
  else
    echo "::warning::no APK found for ${app} under apks/ble-${app}-dev.apk"
  fi
done
