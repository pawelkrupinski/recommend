import { test, expect } from '@playwright/test';
import { login, uniqEmail } from './helpers.js';

async function openSettings(page) {
  await page.locator('#tabs button[data-tab="settings"]').click();
  await expect(page.locator('#settings')).toHaveClass(/active/);
}

const discoverTab = (page) => page.locator('#tabs button[data-tab="discover"]');

test('switching language in Settings translates the interface (and persists)', async ({ page }) => {
  await login(page, uniqEmail('i18n'));
  // Default is English.
  await expect(discoverTab(page)).toHaveText('Discover');

  await openSettings(page);
  // Pick Polish; the app saves the choice and reloads.
  await page.locator('#lang').selectOption('pl');
  await expect(discoverTab(page)).toHaveText('Odkrywaj');
  // Settings copy is localized too.
  await openSettings(page);
  await expect(page.locator('#settings h3').first()).toHaveText('Język interfejsu');

  // The choice survives a fresh load.
  await page.goto('/#discover');
  await expect(discoverTab(page)).toHaveText('Odkrywaj');

  // And it can be switched back to English.
  await openSettings(page);
  await page.locator('#lang').selectOption('en');
  await expect(discoverTab(page)).toHaveText('Discover');
});
