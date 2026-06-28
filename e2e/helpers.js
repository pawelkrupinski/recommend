// Shared e2e helpers. The login() helper is the login-gate workaround: it hits
// the dev-login bypass endpoint (enabled by ALLOW_DEV_LOGIN=1 in the test
// webServer) to obtain a real signed session cookie without any OAuth UI.
import { expect } from '@playwright/test';

// Sign in as `email` via the dev-login bypass, then land in the app (or the
// onboarding screen when onboarded:false). Returns once the expected screen is
// visible so callers can act immediately.
export async function login(page, email, { admin = false, onboarded = true } = {}) {
  const q = new URLSearchParams({ email });
  if (admin) q.set('admin', '1');
  if (!onboarded) q.set('onboarded', '0');
  // dev-login sets the session cookie and 302s to '/'; Playwright follows it.
  await page.goto(`/auth/dev-login?${q}`);
  if (onboarded) {
    await expect(page.locator('#app')).toBeVisible();
  } else {
    await expect(page.locator('#onboarding')).toBeVisible();
  }
}

// A unique-ish email per test so the shared e2e database stays free of
// cross-test interference (ratings/dismissals are per-user).
let n = 0;
export const uniqEmail = (tag) => `${tag}-${process.pid}-${n++}@e2e.test`;
