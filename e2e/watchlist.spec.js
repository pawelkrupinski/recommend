import { test, expect } from '@playwright/test';
import { login, uniqEmail, enterPicks } from './helpers.js';

test('saving a Discover pick removes its card, flashes the tab, and lands in the Watchlist', async ({ page }) => {
  await login(page, uniqEmail('watchlist'));
  await enterPicks(page);

  const before = await page.locator('#recs .card').count();
  const card = page.locator('#recs .card').first();
  const title = await card.locator('.title').textContent();
  const watchTab = page.locator('#tabs button[data-tab="watchlist"]');

  // Clicking + saves the title, pulses the Watchlist tab, and drops the card.
  await card.locator('.watch-btn').click();
  await expect(watchTab).toHaveClass(/flash/);
  await expect(page.locator('#recs .card')).toHaveCount(before - 1);
  await expect(page.locator('#recs .card', { hasText: title })).toHaveCount(0);

  // It now lives under the Watchlist tab.
  await watchTab.click();
  const saved = page.locator('#watchlist-grid .card', { hasText: title });
  await expect(saved).toBeVisible();
  await expect(page.locator('#watchlist-count')).toContainText('1 saved');

  // Removing it there empties the list.
  await saved.locator('.watch-remove').click();
  await expect(page.locator('#watchlist-grid')).toContainText('Your watchlist is empty');
});

test('a watchlisted title stays out of the Discover grid after a reload', async ({ page }) => {
  await login(page, uniqEmail('watch-hide'));
  await enterPicks(page);

  const title = await page.locator('#recs .card .title').first().textContent();
  await page.locator('#recs .card').first().locator('.watch-btn').click();
  await expect(page.locator('#recs .card', { hasText: title })).toHaveCount(0);

  // The recommender still returns the title on a fresh load (the watchlist isn't
  // a server-side exclusion), so the client must keep it out of the grid itself.
  await page.reload();
  await expect(page.locator('#recs .card').first()).toBeVisible();
  await expect(page.locator('#recs .card', { hasText: title })).toHaveCount(0);
});
