#!/usr/bin/env bash
# Run the Android JVM unit suite (Compose/Robolectric tests included — no emulator).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"
dispatch "$REPO_ROOT/android" "Android unit tests" ./gradlew --no-daemon testDebugUnitTest
