// Playwright config. The webServer below boots the real app with:
//   ALLOW_DEV_LOGIN=1  → the /auth/dev-login bypass (no OAuth round-trip)
//   TMDB_STUB=1        → canned TMDB data, so the app runs offline/deterministically
//   DB_PATH            → a throwaway database, fresh per run
import { defineConfig, devices } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = process.env.E2E_PORT || 9123;
const DB_PATH = join(tmpdir(), `recommend-e2e-${process.pid}-${Date.now()}.db`);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // iPad Safari (WebKit) catches iOS-specific stacking/layout bugs the desktop
    // Chromium run can't — e.g. the sign-in overlay painting *under* the app.
    // Scoped to the login-overlay spec so the rest of the suite stays chromium.
    {
      name: 'webkit-ipad',
      use: { ...devices['iPad (gen 7)'] },
      testMatch: /login-overlay\.spec\.js/,
    },
  ],
  webServer: {
    // Build the fingerprinted bundle first, then serve it — so e2e exercises the
    // minified production assets (the import graph collapsed into one module),
    // not the raw dev files. Catches any bundling/minification breakage in a real
    // browser, which is exactly what ships.
    command: 'npm run build && node src/server.js',
    url: `http://127.0.0.1:${PORT}/health`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      PORT: String(PORT),
      DB_PATH,
      ALLOW_DEV_LOGIN: '1',
      TMDB_STUB: '1',
      // Skip background recommendation prebuilds: on this single-process test
      // server they'd contend with the on-demand /api/recommend build the UI
      // actually waits on, making pick-render timings nondeterministic.
      DISABLE_REC_PREBUILD: '1',
      // Blank the Movie of the Night key so the provider picker uses the TMDB
      // stub. Without this, a local .env.local RAPIDAPI_KEY leaks in (real env
      // wins in env.js) and the onboarding test gets live data instead of the
      // stubbed "Netflix Test" list. CI has no .env.local, so it already passes.
      RAPIDAPI_KEY: '',
      APPLICATION_SECRET: 'e2e-secret-do-not-use-in-prod',
      ADMIN_ALLOWLIST: 'boss@example.com',
      // Enable a (dummy) OAuth provider so the optional "Sign in" affordance the
      // anonymous-mode tests assert on actually renders. We never complete the
      // real OAuth round-trip in tests — dev-login is the bypass for that.
      GOOGLE_CLIENT_ID: 'e2e-google-id',
      GOOGLE_CLIENT_SECRET: 'e2e-google-secret',
    },
  },
});
