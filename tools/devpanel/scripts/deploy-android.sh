#!/usr/bin/env bash
# Build the non-debug `releaseFast` APK and install+launch it on the cabled
# Android device (net.pawel.filmowo/pl.filmowo.MainActivity). releaseFast is the
# release build type (non-debuggable) with R8 off for speed, signed with the
# debug keystore so it installs without a release keystore. By default the build
# points at the Mac's local dev server, reached over `adb reverse tcp:9002`; set
# FILMOWO_BASE_URL=https://filmowo.fly.dev to deploy a prod-pointed build instead.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

APP_ID="net.pawel.filmowo"
COMPONENT="net.pawel.filmowo/pl.filmowo.MainActivity"
APK="app/build/outputs/apk/releaseFast/app-releaseFast.apk"
PORT="${FILMOWO_PORT:-9002}"
export FILMOWO_BASE_URL="${FILMOWO_BASE_URL:-http://localhost:$PORT}"

serial=""
[[ "${DEVPANEL_PRINT_ONLY:-}" != "1" ]] && serial="$(android_serial)"
adb="$(resolve_adb)"; [[ -z "$adb" ]] && adb="adb"
sflag=(); [[ -n "$serial" ]] && sflag=(-s "$serial")

# adb install with recovery: a differently-signed net.pawel.filmowo already on
# the device (e.g. a release build) can't be updated in place — uninstall + retry.
install_apk() {
  if [[ "${DEVPANEL_PRINT_ONLY:-}" == "1" ]]; then
    step "$adb" ${sflag[@]+"${sflag[@]}"} install -r -d "$APK"; return 0
  fi
  printf '\n\033[1m▶ install %s\033[0m\n' "$APK"
  local out; out="$("$adb" ${sflag[@]+"${sflag[@]}"} install -r -d "$APK" 2>&1)"; echo "$out"
  if grep -q INSTALL_FAILED_UPDATE_INCOMPATIBLE <<<"$out"; then
    echo "↻ signature mismatch — uninstalling $APP_ID and reinstalling (clears app data)…"
    "$adb" ${sflag[@]+"${sflag[@]}"} uninstall "$APP_ID" || true
    "$adb" ${sflag[@]+"${sflag[@]}"} install -r -d "$APK"
  fi
}

wait_for_android_unlock "$serial"
cd "$REPO_ROOT/android"

step ./gradlew --no-daemon assembleReleaseFast
# Point the device's localhost at the Mac's dev server (no-op for a remote base).
case "$FILMOWO_BASE_URL" in
  *localhost*|*127.0.0.1*) step "$adb" ${sflag[@]+"${sflag[@]}"} reverse "tcp:$PORT" "tcp:$PORT" ;;
esac
install_apk
step "$adb" ${sflag[@]+"${sflag[@]}"} shell am start -n "$COMPONENT"
