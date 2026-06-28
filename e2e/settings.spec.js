import { test, expect } from '@playwright/test';
import { login, uniqEmail } from './helpers.js';

async function openSettings(page) {
  await page.locator('#tabs button[data-tab="settings"]').click();
  await expect(page.locator('#settings')).toHaveClass(/active/);
}

test('settings shows streaming services, no admin or API-key blocks', async ({ page }) => {
  await login(page, uniqEmail('plain'));
  await openSettings(page);
  await expect(page.locator('#country')).toBeVisible();
  // API keys and user management were removed from the app entirely.
  await expect(page.locator('#admin-keys')).toHaveCount(0);
  await expect(page.locator('#admin-users')).toHaveCount(0);
});

test('changing country persists across a reload', async ({ page }) => {
  await login(page, uniqEmail('country'));
  await openSettings(page);
  await page.locator('#country').selectOption('US');
  await expect(page.locator('#country')).toHaveValue('US');

  await page.reload();
  await openSettings(page);
  await expect(page.locator('#country')).toHaveValue('US');
});

test('deleting the account returns to the login gate', async ({ page }) => {
  await login(page, uniqEmail('doomed'));
  await openSettings(page);
  // The delete button asks for confirmation via a native dialog — accept it.
  page.on('dialog', (d) => d.accept());
  await page.locator('#delete-account').click();
  await expect(page.locator('#login')).toBeVisible();
  await expect(page.locator('#app')).toBeHidden();
});
