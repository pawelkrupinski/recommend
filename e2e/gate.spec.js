import { test, expect } from '@playwright/test';
import { login, uniqEmail } from './helpers.js';

// There is no login gate any more: a first-time visitor is given an anonymous
// session and goes straight to onboarding, then into the app. Signing in is
// optional and offered from the userbar.
test.describe('no login gate', () => {
  test('a first-time visitor lands in onboarding, not a login screen', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#onboarding')).toBeVisible();
    await expect(page.locator('#login')).toBeHidden();
  });

  test('an anonymous visitor can finish onboarding and use the app, no sign-in', async ({ page }) => {
    await page.goto('/');
    await page.locator('#ob-provider-list .prov:not(.disabled)').first().click();
    await page.locator('#ob-continue').click();
    await expect(page.locator('#app')).toBeVisible();
    // The userbar offers an optional sign-in instead of an avatar/sign-out.
    await expect(page.locator('#userbar #show-signin')).toBeVisible();
  });

  test('the optional Sign in overlay opens from the userbar and dismisses', async ({ page }) => {
    await page.goto('/');
    await page.locator('#ob-provider-list .prov:not(.disabled)').first().click();
    await page.locator('#ob-continue').click();
    await page.locator('#userbar #show-signin').click();
    await expect(page.locator('#login')).toBeVisible();
    await page.locator('#login-close').click();
    await expect(page.locator('#login')).toBeHidden();
    // The app stays usable behind the dismissed overlay.
    await expect(page.locator('#app')).toBeVisible();
  });

  test('dev-login signs in and swaps the userbar for the account', async ({ page }) => {
    await login(page, uniqEmail('gate'));
    await expect(page.locator('#app')).toBeVisible();
    await expect(page.locator('#userbar')).toContainText('Test User');
    await expect(page.locator('#userbar #show-signin')).toHaveCount(0);
  });

  test('signing out drops to a fresh anonymous session, not a gate', async ({ page }) => {
    await login(page, uniqEmail('gate'));
    await page.locator('#userbar a.logout').click();
    // A brand-new anonymous session is not onboarded, so we land in onboarding.
    await expect(page.locator('#onboarding')).toBeVisible();
    await expect(page.locator('#login')).toBeHidden();
  });
});
