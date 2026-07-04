#!/usr/bin/env bash
# DevPanel test: compile + headless self-test of the Swift app, then verify each
# action script emits the expected command shape under DEVPANEL_PRINT_ONLY.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
fail=0
check() { # <desc> <haystack> <needle>
  if grep -qF -- "$3" <<<"$2"; then echo "  ✓ $1"; else echo "  ✗ $1 — missing: $3"; fail=1; fi
}

echo "▶ Swift self-test (compile + headless runtime)"
BIN="$(mktemp -d)/DevPanel"
swiftc -O -o "$BIN" "$HERE/DevPanel/main.swift"
if out="$(DEVPANEL_SELFTEST=1 "$BIN")" && [[ "$out" == SELFTEST_OK* ]]; then
  echo "  ✓ $out"
else
  echo "  ✗ selftest failed: $out"; fail=1
fi

echo "▶ Script command shapes (DEVPANEL_PRINT_ONLY)"
export DEVPANEL_PRINT_ONLY=1 DEVPANEL_REPO_ROOT="$REPO_ROOT" DEVPANEL_ADB=adb

d="$(bash "$HERE/scripts/deploy-android.sh")"
check "deploy builds the debug APK"        "$d" "assembleDebug"
check "deploy sets up adb reverse :9002"   "$d" "reverse tcp:9002 tcp:9002"
check "deploy installs the debug APK"      "$d" "install -r -d app/build/outputs/apk/debug/app-debug.apk"
check "deploy launches the main activity"  "$d" "am start -n net.pawel.filmowo/pl.filmowo.MainActivity"

s="$(bash "$HERE/scripts/run-server.sh")"
check "server runs npm run dev"            "$s" "npm run dev"

t="$(bash "$HERE/scripts/test-android.sh")"
check "tests run testDebugUnitTest"        "$t" "testDebugUnitTest"

if [[ $fail -eq 0 ]]; then echo "✓ all devpanel checks passed"; else echo "✗ devpanel checks failed"; exit 1; fi
