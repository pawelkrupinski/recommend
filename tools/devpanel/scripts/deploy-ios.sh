#!/usr/bin/env bash
# Build the Filmowo iOS app once and install+launch it on EVERY available iOS
# device (iPhone and iPad, cabled or on the local network) via `xcodebuild` +
# `xcrun devicectl`. One universal, team-signed generic build serves them all —
# and a single locked device can't fail the build. Set FILMOWO_IOS_UDID=<udid>
# to target just one. Signs with the local Apple Development team (auto-detected,
# override FILMOWO_DEV_TEAM); -allowProvisioningUpdates keeps the team profile
# current. Base URL defaults to prod; set FILMOWO_BASE_URL=http://<mac-lan-ip>:3000
# for the Mac's local dev server (a device can't reach the Mac's localhost).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

BUNDLE_ID="pl.filmowo.Filmowo"
SCHEME="Filmowo"
PROJECT="$REPO_ROOT/ios/Filmowo.xcodeproj"
DERIVED="$REPO_ROOT/ios/build/device"
APP="$DERIVED/Build/Products/Debug-iphoneos/Filmowo.app"
export FILMOWO_BASE_URL="${FILMOWO_BASE_URL:-https://filmowo.fly.dev}"
printf '▶ target base URL: %s\n' "$FILMOWO_BASE_URL"

build_once() { # <team>
  # A generic device build (not tied to one device) signed with the team's
  # development profile: installs on any registered device, and doesn't fail
  # just because one device happens to be locked. The persistent derivedDataPath
  # ($DERIVED) makes this incremental — unchanged files aren't recompiled — and
  # COMPILER_INDEX_STORE_ENABLE=NO skips the index store a CLI build doesn't need.
  step xcodebuild -project "$PROJECT" -scheme "$SCHEME" -configuration Debug \
    -destination "generic/platform=iOS" -derivedDataPath "$DERIVED" \
    -allowProvisioningUpdates DEVELOPMENT_TEAM="$1" \
    COMPILER_INDEX_STORE_ENABLE=NO build
}

# needs_build — true if there's no built app yet, or any source (app, core, or
# the project file) changed since it was last built. Lets a re-deploy with no
# code change (e.g. to a second device, or after unlocking one) skip the ~4-5s
# no-op rebuild and go straight to install.
needs_build() {
  local bin="$APP/Filmowo"
  [[ -x "$bin" ]] || return 0
  [[ -n "$(find "$REPO_ROOT/ios/Filmowo" "$REPO_ROOT/ios/FilmowoCore" \
             "$PROJECT/project.pbxproj" -type f -newer "$bin" -print -quit 2>/dev/null)" ]]
}
install_to() { step xcrun devicectl device install app --device "$1" "$APP"; }
launch_on()  { step xcrun devicectl device process launch --device "$1" "$BUNDLE_ID"; }

# Dry run for the DevPanel self-test: print the shapes for a two-device fan-out.
if [[ "${DEVPANEL_PRINT_ONLY:-}" == "1" ]]; then
  build_once "<team>"
  for udid in "<udid-1>" "<udid-2>"; do install_to "$udid"; launch_on "$udid"; done
  exit 0
fi

TEAM="$(ios_team)"
if [[ -z "$TEAM" ]]; then
  echo "✋ No Apple Development signing identity found. Add your Apple ID in"
  echo "   Xcode ▸ Settings ▸ Accounts, or set FILMOWO_DEV_TEAM=<teamid>."
  exit 1
fi

# Targets: the override, else every available iOS device.
if [[ -n "${FILMOWO_IOS_UDID:-}" ]]; then
  udids="$FILMOWO_IOS_UDID"
else
  udids="$(ios_devices | cut -f1)"
fi
if [[ -z "$udids" ]]; then
  echo "🔌 No paired iOS device found. Connect/pair an iPhone or iPad, unlock it,"
  echo "   trust this Mac, then retry."
  exit 1
fi
echo "▶ devices:"; ios_devices | awk -F'\t' '{print "    · "$4" ("$2", "$3")"}'
printf '▶ signing team: %s\n' "$TEAM"

if needs_build; then
  if ! build_once "$TEAM"; then
    echo "✋ Build failed — see the xcodebuild output above."
    exit 1
  fi
else
  echo "▶ app is up to date — skipping the build."
fi

ok=0; failed=()
while IFS= read -r udid; do
  [[ -z "$udid" ]] && continue
  name="$(ios_device_name "$udid")"
  printf '\n\033[1m▶ deploy → %s\033[0m\n' "$name"
  if ! install_to "$udid"; then
    echo "  ✗ install failed (device locked, not registered, or Developer Mode off)."
    failed+=("$name"); continue
  fi
  # Launch is best-effort — a locked device declines it.
  launch_on "$udid" || echo "  ⚠️ installed, but launch was declined — unlock the device and open Filmowo."
  ok=$((ok + 1))
done <<< "$udids"

echo
echo "▶ done: installed on $ok device(s)."
if [[ ${#failed[@]} -gt 0 ]]; then
  echo "  not installed on: ${failed[*]}"
  echo "  → unlock the device + enable Developer Mode (Settings ▸ Privacy &"
  echo "    Security ▸ Developer Mode), or register it once via Xcode, then retry."
  [[ $ok -eq 0 ]] && exit 1
fi
