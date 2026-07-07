#!/usr/bin/env bash
# Build, sign, install and launch the Filmowo iOS app on a cabled/paired iPhone
# or iPad via `xcodebuild` + `xcrun devicectl`. Arg: iphone|ipad (default
# iphone). Signs with the local Apple Development identity's team (auto-detected,
# override with FILMOWO_DEV_TEAM); `-allowProvisioningUpdates` registers the
# device and mints a development profile on first run. By default the build
# points at prod (https://filmowo.fly.dev) so the app always loads even with no
# dev server running; set FILMOWO_BASE_URL=http://<mac-ip>:3000 to point a build
# at the Mac's local dev server (a real device can't reach the Mac's localhost,
# so use the LAN IP the panel header shows).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

KIND="${1:-iphone}"          # iphone | ipad
BUNDLE_ID="pl.filmowo.Filmowo"
SCHEME="Filmowo"
PROJECT="$REPO_ROOT/ios/Filmowo.xcodeproj"
DERIVED="$REPO_ROOT/ios/build/device"
APP="$DERIVED/Build/Products/Debug-iphoneos/Filmowo.app"
export FILMOWO_BASE_URL="${FILMOWO_BASE_URL:-https://filmowo.fly.dev}"
printf '▶ target device kind: %s\n' "$KIND"
printf '▶ target base URL: %s\n' "$FILMOWO_BASE_URL"

build_cmd() { # <udid> <team>
  step xcodebuild -project "$PROJECT" -scheme "$SCHEME" -configuration Debug \
    -destination "platform=iOS,id=$1" -derivedDataPath "$DERIVED" \
    -allowProvisioningUpdates DEVELOPMENT_TEAM="$2" build
}

# Dry run for the DevPanel self-test: print the command shapes with placeholders
# and touch neither devicectl nor the keychain.
if [[ "${DEVPANEL_PRINT_ONLY:-}" == "1" ]]; then
  build_cmd "<udid>" "<team>"
  step xcrun devicectl device install app --device "<udid>" "$APP"
  step xcrun devicectl device process launch --device "<udid>" "$BUNDLE_ID"
  exit 0
fi

TEAM="$(ios_team)"
UDID="$(ios_udid "$KIND")"
if [[ -z "$UDID" ]]; then
  echo "🔌 No paired $KIND found. Connect one over USB, unlock it, trust this Mac, then retry."
  echo "   (override with FILMOWO_IOS_UDID=<udid>)"
  exit 1
fi
if [[ -z "$TEAM" ]]; then
  echo "✋ No Apple Development signing identity found. Add your Apple ID in"
  echo "   Xcode ▸ Settings ▸ Accounts, or set FILMOWO_DEV_TEAM=<teamid>."
  exit 1
fi
printf '▶ device udid: %s   signing team: %s\n' "$UDID" "$TEAM"

build_cmd "$UDID" "$TEAM"

step xcrun devicectl device install app --device "$UDID" "$APP"

# The app is installed by this point; auto-launch can still be declined if the
# device is locked or the developer isn't trusted yet. Don't hard-fail on it.
if ! step xcrun devicectl device process launch --device "$UDID" "$BUNDLE_ID"; then
  echo "⚠️  Installed OK, but auto-launch was declined."
  echo "    • Unlock the $KIND and reopen Filmowo from the Home Screen, and/or"
  echo "    • first install only: Settings ▸ General ▸ VPN & Device Management ▸"
  echo "      Apple Development: … ▸ Trust."
fi
