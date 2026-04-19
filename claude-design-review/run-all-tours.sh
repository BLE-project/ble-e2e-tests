#!/usr/bin/env bash
# Claude Design UX/UI review — run all 5 Maestro tours sequentially.
# Requires: Maestro CLI, Android device or emulator, all 5 APKs installed.
#
# Output: ./screenshots/<app>/*.png — one per tour step
#
# Usage:  ./run-all-tours.sh           # all 5 apps
#         ./run-all-tours.sh consumer  # single app

set -e
cd "$(dirname "$0")/flows"

APPS=("consumer" "merchant" "tenant" "sales-agent" "territory")
if [ -n "$1" ]; then APPS=("$1"); fi

for app in "${APPS[@]}"; do
  echo "═══════════════════════════════════════════════════════════════════"
  echo "  Tour: $app"
  echo "═══════════════════════════════════════════════════════════════════"
  maestro test "${app}-tour.yaml" || echo "⚠ $app tour failed — continuing"
done

echo ""
echo "✓ All tours done. Screenshots in: $(pwd)/../screenshots/"
ls -la "$(pwd)/../screenshots/" || true
