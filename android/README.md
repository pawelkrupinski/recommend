# Filmowo — Android app

A native Android client for the recommend server (filmowo.fly.dev), reproducing
the web app's functionality: adaptive Discover (a rate-queue onboarding until the
rate goal, then personalized picks), the where-to-watch detail sheet, the
watchlist (with rate-to-remove), the ratings list, and settings (country,
streaming services, language, sign-in). It mirrors the stack and conventions of
the sibling `../movies` Android app.

## Stack

- **Kotlin + Jetpack Compose + Material3**, dark-only, single-activity.
- **MVVM + repository**, manual DI (composition root in `MainActivity`) — no DI
  framework. Navigation-Compose for the four bottom-nav tabs.
- **OkHttp 5 + kotlinx.serialization** (no Retrofit) for the JSON API
  (`net/FilmowoApi`). The session `rid` cookie is carried by a disk-backed
  `PersistentCookieJar` so sign-in survives restarts.
- **OAuth via Custom Tabs**: sign-in opens `/auth/<provider>?platform=android`;
  the server bounces back to the `filmowo://auth-done?code=…` deep link and the
  app redeems the one-shot code at `POST /auth/exchange` (see `auth/`).
- **Coil** for posters, **DataStore** for the cached UI language.
- AGP 9.2.1, Gradle 9.6, Kotlin 2.4.0, compileSdk 37, minSdk 26.

## Build & test

```sh
cd android
echo "sdk.dir=$ANDROID_HOME" > local.properties   # or your SDK path
./gradlew testDebugUnitTest    # JVM + Robolectric unit tests (no emulator)
./gradlew assembleDebug        # -> app/build/outputs/apk/debug/app-debug.apk
```

The app talks to `https://filmowo.fly.dev` by default. Point a debug build at a
local server (started with `ALLOW_DEV_LOGIN=1`) via the `FILMOWO_BASE_URL` env
var — e.g. `FILMOWO_BASE_URL=http://10.0.2.2:3000 ./gradlew assembleDebug` for
the emulator's view of the host machine.

## Tests

- `FilmowoApiTest` — the API client against MockWebServer (URLs, query params,
  JSON parsing, write payloads, NDJSON enrich stream).
- `FilmowoViewModelTest` — the view model over MockWebServer with fakes for the
  Context-bound collaborators: the onboarding-vs-picks decision, badge
  enrichment, optimistic rating.
- `PersistentCookieJarTest` — the session cookie survives a jar restart
  (Robolectric).
