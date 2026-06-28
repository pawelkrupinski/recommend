import { test, expect } from '@playwright/test';
import { login, uniqEmail } from './helpers.js';

test('tab navigation activates sections and updates the URL hash', async ({ page }) => {
  await login(page, uniqEmail('nav'));

  for (const tab of ['rate', 'ratings', 'settings', 'discover']) {
    await page.locator(`#tabs button[data-tab="${tab}"]`).click();
    await expect(page.locator(`#${tab}`)).toHaveClass(/active/);
    await expect(page.locator(`#tabs button[data-tab="${tab}"]`)).toHaveClass(/active/);
    await expect(page).toHaveURL(new RegExp(`#${tab}`));
  }
});

test('the active tab survives a reload (hash-driven)', async ({ page }) => {
  await login(page, uniqEmail('nav'));
  await page.locator('#tabs button[data-tab="settings"]').click();
  await expect(page.locator('#settings')).toHaveClass(/active/);

  await page.reload();
  await expect(page.locator('#settings')).toHaveClass(/active/);
  await expect(page.locator('#discover')).not.toHaveClass(/active/);
});
