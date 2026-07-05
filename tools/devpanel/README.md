# DevPanel

A small always-on-top macOS palette of dev actions for this repo, adapted from
the movies app's DevPanel. Run it with `./runDevPanel.sh` from the repo root.

It's an accessory app (no Dock icon): a floating panel top-right of the screen
plus a ☰ menu-bar icon (left-click show/hide, right-click for a quit menu). The
close button quits; the yellow button hides the panel.

## Buttons

- **Android → device** — build the non-debug `releaseFast` APK and install +
  launch it on the cabled Android device (`net.pawel.filmowo/.MainActivity`).
  `releaseFast` is the release build type (non-debuggable, R8 off for speed),
  signed with the debug keystore so it installs without a release keystore. By
  default the build points at prod (`https://filmowo.fly.dev`) so the installed
  app always loads; set `FILMOWO_BASE_URL=http://localhost:9002` to point it at
  the Mac's local dev server instead (wired over `adb reverse tcp:9002`).
  Handles the unauthorized/locked device wait and the signature-mismatch reinstall.
- **Android tests** — `./gradlew testDebugUnitTest` (JVM + Robolectric, no emulator).

Long-press (or right-click) any button to run it on a specific git worktree.
The header shows the Mac's LAN IP so you can reach a local `npm run dev` server
(started in your own terminal) from a phone on the same Wi-Fi.

## How it works

`build.sh` compiles `DevPanel/main.swift` (single-file AppKit, `swiftc -O`) into
`build/DevPanel.app` and bakes the absolute `scripts/` path into Info.plist
(`DevPanelScriptsDir`). Each button runs a script in `scripts/` as a subprocess,
streaming output into an in-panel console. `scripts/lib.sh` resolves adb, picks
the device, and waits for unlock.

## Test

`./test.sh` compiles + runs the Swift headless self-test (`DEVPANEL_SELFTEST=1`)
and asserts each action script's command shape via `DEVPANEL_PRINT_ONLY=1`.
