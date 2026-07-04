# DevPanel

A small always-on-top macOS palette of dev actions for this repo, adapted from
the movies app's DevPanel. Run it with `./runDevPanel.sh` from the repo root.

It's an accessory app (no Dock icon): a floating panel top-right of the screen
plus a ☰ menu-bar icon (left-click show/hide, right-click for a quit menu). The
close button quits; the yellow button hides the panel.

## Buttons

- **Android → device** — build the debug APK and install + launch it on the
  cabled Android device (`net.pawel.filmowo/.MainActivity`). By default the build
  points at the Mac's local dev server, reached over `adb reverse tcp:9002`, so
  you test your local server changes; set `FILMOWO_BASE_URL=https://filmowo.fly.dev`
  to deploy a prod-pointed build. Handles the unauthorized/locked device wait and
  the signature-mismatch reinstall.
- **Android tests** — `./gradlew testDebugUnitTest` (JVM + Robolectric, no emulator).
- **Dev server** — `npm run dev` with `ALLOW_DEV_LOGIN=1` (long-running; its
  console keeps scrollback; Stop to kill).

Long-press (or right-click) any button to run it on a specific git worktree.
The header shows the Mac's LAN IP so you can reach the dev server from a phone
on the same Wi-Fi.

## How it works

`build.sh` compiles `DevPanel/main.swift` (single-file AppKit, `swiftc -O`) into
`build/DevPanel.app` and bakes the absolute `scripts/` path into Info.plist
(`DevPanelScriptsDir`). Each button runs a script in `scripts/` as a subprocess,
streaming output into an in-panel console. `scripts/lib.sh` resolves adb, picks
the device, and waits for unlock.

## Test

`./test.sh` compiles + runs the Swift headless self-test (`DEVPANEL_SELFTEST=1`)
and asserts each action script's command shape via `DEVPANEL_PRINT_ONLY=1`.
