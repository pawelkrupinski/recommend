import { test, expect } from '@playwright/test';
import { login, uniqEmail } from './helpers.js';

test('tab navigation activates sections and updates the URL path', async ({ page }) => {
  await login(page, uniqEmail('nav'));

  for (const tab of ['ratings', 'settings', 'discover']) {
    await page.locator(`#tabs a[data-tab="${tab}"]`).click();
    await expect(page.locator(`#${tab}`)).toHaveClass(/active/);
    await expect(page.locator(`#tabs a[data-tab="${tab}"]`)).toHaveClass(/active/);
    await expect(page).toHaveURL(new RegExp(`/${tab}$`));
  }
});

test('the nav tabs are real links (a real href, no #), ctrl/middle-clickable', async ({ page }) => {
  await login(page, uniqEmail('nav-links'));
  // Each tab is an <a> pointing at its real path — not href="#" — so the browser
  // can open it in a new tab on a modifier/middle click.
  for (const tab of ['discover', 'watchlist', 'ratings', 'settings']) {
    await expect(page.locator(`#tabs a[data-tab="${tab}"]`)).toHaveAttribute('href', `/${tab}`);
  }
});

test('the active tab survives a reload (path-driven)', async ({ page }) => {
  await login(page, uniqEmail('nav'));
  await page.locator('#tabs a[data-tab="settings"]').click();
  await expect(page.locator('#settings')).toHaveClass(/active/);
  await expect(page).toHaveURL(/\/settings$/);

  await page.reload();
  await expect(page.locator('#settings')).toHaveClass(/active/);
  await expect(page.locator('#discover')).not.toHaveClass(/active/);
});

test('deep-linking straight to a tab path boots into it (SPA fallback)', async ({ page }) => {
  await login(page, uniqEmail('nav-deep'));
  // The server serves the SPA shell at /ratings, and the app boots into that tab.
  await page.goto('/ratings');
  await expect(page.locator('#ratings')).toHaveClass(/active/);
  await expect(page.locator('#discover')).not.toHaveClass(/active/);
});
