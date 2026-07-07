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
check "deploy builds the releaseFast APK"  "$d" "assembleReleaseFast"
check "deploy points at prod by default"   "$d" "target base URL: https://filmowo.fly.dev"
check "deploy installs the releaseFast APK" "$d" "install -r -d app/build/outputs/apk/releaseFast/app-releaseFast.apk"
check "deploy launches the main activity"  "$d" "am start -n net.pawel.filmowo/pl.filmowo.MainActivity"
# The Gradle daemon is what makes the cable loop fast; --no-daemon (a cold JVM
# every deploy) must not creep back in.
if grep -qF -- "--no-daemon" <<<"$d"; then
  echo "  ✗ deploy must not pass --no-daemon (kills the daemon speedup)"; fail=1
else
  echo "  ✓ deploy keeps the gradle daemon (no --no-daemon)"
fi

dl="$(FILMOWO_BASE_URL=http://localhost:9002 bash "$HERE/scripts/deploy-android.sh")"
check "localhost base still reverses :9002" "$dl" "reverse tcp:9002 tcp:9002"

t="$(bash "$HERE/scripts/test-android.sh")"
check "tests run testDebugUnitTest"        "$t" "testDebugUnitTest"

i="$(bash "$HERE/scripts/deploy-ios.sh")"
check "iOS deploy builds the Filmowo scheme"  "$i" "xcodebuild -project"
check "iOS deploy builds once for any device" "$i" "-destination generic/platform=iOS"
check "iOS deploy skips the index store"      "$i" "COMPILER_INDEX_STORE_ENABLE=NO"
# Fans out install+launch to every device (self-test prints two placeholders).
check "iOS deploy installs on device 1"       "$i" "devicectl device install app --device <udid-1>"
check "iOS deploy installs on device 2"       "$i" "devicectl device install app --device <udid-2>"
check "iOS deploy launches on device 1"       "$i" "devicectl device process launch --device <udid-1> pl.filmowo.Filmowo"
check "iOS deploy launches on device 2"       "$i" "devicectl device process launch --device <udid-2> pl.filmowo.Filmowo"

if [[ $fail -eq 0 ]]; then echo "✓ all devpanel checks passed"; else echo "✗ devpanel checks failed"; exit 1; fi
