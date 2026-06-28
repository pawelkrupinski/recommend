import { test, expect } from '@playwright/test';
import { login, uniqEmail } from './helpers.js';

test.describe('login gate', () => {
  test('shows the login screen and hides the app when logged out', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#login')).toBeVisible();
    await expect(page.locator('#app')).toBeHidden();
    await expect(page.locator('#onboarding')).toBeHidden();
  });

  test('dev-login bypass signs in and reveals the app', async ({ page }) => {
    const email = uniqEmail('gate');
    await login(page, email);
    await expect(page.locator('#login')).toBeHidden();
    await expect(page.locator('#app')).toBeVisible();
    await expect(page.locator('#userbar')).toContainText('Test User');
  });

  test('signing out returns to the login gate', async ({ page }) => {
    await login(page, uniqEmail('gate'));
    await page.locator('#userbar a.logout').click();
    await expect(page.locator('#login')).toBeVisible();
    await expect(page.locator('#app')).toBeHidden();
  });
});
