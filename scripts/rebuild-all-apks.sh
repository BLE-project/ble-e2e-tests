#!/usr/bin/env bash
# GAP-QA-007 (v7.9.17) — rebuild and install all 5 Terrio mobile APKs from HEAD.
#
# Context: the pre-installed APKs on the test device were compiled before
# v7.9.9 client.ts default URL change (10.0.2.2 → localhost). From a physical
# USB-tethered device, 10.0.2.2 is unreachable. Login fails with
# "Network request failed".
#
# This script:
#   1. Runs `npx expo prebuild --clean --platform android` for each app
#      (regenerates the android/ folder with the current JS bundle config)
#   2. Runs `./gradlew assembleDebug` to produce the APK
#   3. Installs via `adb install -r` (keeps user data)
#
# Prerequisites:
#   - Android SDK + Gradle + JDK 21
#   - adb device connected (verify: `adb devices`)
#   - expo-cli available via npx
#   - node + npm installed at each app
#
# Usage:
#   ./rebuild-all-apks.sh           # all 5
#   ./rebuild-all-apks.sh consumer  # single app
#
# Wall time expected: ~30-60 min total (5-12 min per app).

set -euo pipefail

APPS=(consumer merchant tenant sales-agent territory)
if [ $# -gt 0 ]; then APPS=("$@"); fi

BASE="$(cd "$(dirname "$0")/../.." && pwd)"
DEVICE="${ADB_DEVICE:-}"
ADB_FLAGS=""
if [ -n "$DEVICE" ]; then ADB_FLAGS="-s $DEVICE"; fi

echo "═══════════════════════════════════════════════════════════════════"
echo "  Rebuilding ${#APPS[@]} mobile APKs from HEAD"
echo "  Base dir: $BASE"
echo "  ADB device: ${DEVICE:-<default>}"
echo "═══════════════════════════════════════════════════════════════════"

for app in "${APPS[@]}"; do
  dir="$BASE/terrio-${app}-mobile"
  if [ ! -d "$dir" ]; then
    echo "⚠  $app: $dir not found — skipping"
    continue
  fi

  echo ""
  echo "── $app ──────────────────────────────────────────────────────────"

  pushd "$dir" > /dev/null

  echo "  [1/4] npm install"
  npm install --no-audit --no-fund --silent || { echo "  ❌ npm install failed"; popd > /dev/null; continue; }

  echo "  [2/4] expo prebuild --clean --platform android"
  npx expo prebuild --clean --platform android --non-interactive \
    || { echo "  ❌ prebuild failed"; popd > /dev/null; continue; }

  echo "  [3/4] gradlew assembleDebug"
  (cd android && ./gradlew assembleDebug --no-daemon) \
    || { echo "  ❌ gradle build failed"; popd > /dev/null; continue; }

  apk="android/app/build/outputs/apk/debug/app-debug.apk"
  if [ ! -f "$apk" ]; then
    echo "  ❌ APK not produced at $apk"
    popd > /dev/null
    continue
  fi

  echo "  [4/4] adb install -r $apk"
  adb $ADB_FLAGS install -r "$apk" \
    || { echo "  ❌ adb install failed"; popd > /dev/null; continue; }

  echo "  ✅ $app installed — $(stat -c%s "$apk" 2>/dev/null || wc -c < "$apk") bytes"

  popd > /dev/null
done

echo ""
echo "═══════════════════════════════════════════════════════════════════"
echo "  Done. Verify with: adb $ADB_FLAGS shell pm list packages | grep com.terrio"
echo "═══════════════════════════════════════════════════════════════════"
