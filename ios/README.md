# Filmowo — iOS app (iPhone + iPad)

Native SwiftUI client for the Filmowo recommendation service, mirroring the
[Android app](../android) and web (`../public`). It speaks the same server
`/api/*` contract and OAuth deep-link handshake (`filmowo://auth-done` →
`POST /auth/exchange` → `rid` session cookie).

## Layout

- `Filmowo/` — the app: `Models/`, `Networking/`, `Auth/`, `Location/`,
  `Storage/`, `Views/`, `i18n/`. SwiftUI, `@main FilmowoApp`.
- `FilmowoTests/` — XCTest (client/stores driven through a `URLProtocol` stub).
- `FilmowoUITests/` — XCUITest flows (launch-env fixtures).
- `Package.swift` — a Foundation-only `FilmowoCore` library + tests, so the
  pure logic (models, decoding, i18n, region resolution) is testable with
  `swift test` on Linux — no Xcode. UI/CoreLocation/auth files are excluded
  from that target.

## The project file is generated

`Filmowo.xcodeproj` is generated from **`project.yml`** with
[XcodeGen](https://github.com/yonaskolb/XcodeGen), which is the single source of
truth for targets and build settings. The generated `.xcodeproj` is committed so
CI (and anyone without XcodeGen) can build directly. **After editing
`project.yml`, regenerate:**

```sh
brew install xcodegen   # once
cd ios && xcodegen generate
```

Adding/removing source files needs no `project.yml` edit — targets pull whole
folders. Just regenerate so the committed `.xcodeproj` reflects the new files.

## Build & test locally

```sh
cd ios
swift test                                                   # FilmowoCore logic (fast, no sim)
xcodebuild test -project Filmowo.xcodeproj -scheme Filmowo \
  -destination 'platform=iOS Simulator,name=iPhone 17' CODE_SIGNING_ALLOWED=NO
xcodebuild test -project Filmowo.xcodeproj -scheme Filmowo \
  -destination 'platform=iOS Simulator,name=iPad Pro 11-inch (M5)' CODE_SIGNING_ALLOWED=NO
```

Point the app at a local server by setting `FILMOWO_BASE_URL` (e.g.
`http://localhost:3000`) in the scheme's run environment; it defaults to
`https://filmowo.fly.dev`. Run the server with `ALLOW_DEV_LOGIN=1 npm run dev`
to use `/auth/dev-login` instead of real OAuth.

CI: `.github/workflows/ios.yml`.
