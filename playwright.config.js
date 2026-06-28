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
  ],
  webServer: {
    command: 'node src/server.js',
    url: `http://127.0.0.1:${PORT}/health`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      PORT: String(PORT),
      DB_PATH,
      ALLOW_DEV_LOGIN: '1',
      TMDB_STUB: '1',
      APPLICATION_SECRET: 'e2e-secret-do-not-use-in-prod',
      ADMIN_ALLOWLIST: 'boss@example.com',
    },
  },
});
