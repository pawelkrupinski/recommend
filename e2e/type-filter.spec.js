import { test, expect } from '@playwright/test';
import { login, uniqEmail } from './helpers.js';

// The Movies/Series type filter on Discover (server-side, re-fetches a one-type
// pool) and Watchlist (client-side, narrows the loaded list). TV cards carry the
// `.tv` class; films don't — so card type is observable in the DOM.

// Provider 8 streams the movie fixtures, 350 the TV ones (tmdb-stub.js), so a
// user on both gets a genuinely mixed feed to filter.
async function mixedPicks(page) {
  await page.evaluate(async () => {
    await fetch('/api/settings', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ providers: [8, 350] }) });
    for (let i = 0; i < 10; i++) {
      await fetch('/api/ratings', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tmdb_id: 900 + i, rating: 8, title: `Seed ${i}`, year: 2020 }) });
    }
  });
  await page.goto('/discover');
  await expect(page.locator('#recs .card').first()).toBeVisible({ timeout: 20_000 });
}

test('Discover: the type filter narrows picks to one media type', async ({ page }) => {
  await login(page, uniqEmail('type-discover'));
  await mixedPicks(page);

  // Series only → the URL carries the filter and every remaining card is a series.
  await page.selectOption('#type-filter', 'tv');
  await expect(page).toHaveURL(/type=tv/);
  await expect(page.locator('#recs .card').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('#recs .card:not(.tv)')).toHaveCount(0, { timeout: 20_000 });
  expect(await page.locator('#recs .card.tv').count()).toBeGreaterThan(0);

  // Movies only → no series card survives (proves the pool actually switched).
  await page.selectOption('#type-filter', 'movie');
  await expect(page).toHaveURL(/type=movie/);
  await expect(page.locator('#recs .card').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('#recs .card.tv')).toHaveCount(0, { timeout: 20_000 });
  expect(await page.locator('#recs .card').count()).toBeGreaterThan(0);
});

test('Watchlist: the type filter shows only the chosen media type', async ({ page }) => {
  await login(page, uniqEmail('type-watchlist'));
  await page.evaluate(async () => {
    const save = (b) => fetch('/api/watchlist', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
    await save({ tmdb_id: 1001, media_type: 'movie', title: 'A Film', year: 2020 });
    await save({ tmdb_id: 1002, media_type: 'tv', title: 'A Series', year: 2021 });
  });
  await page.goto('/watchlist');
  await expect(page.locator('#watchlist-grid .card')).toHaveCount(2);

  // Both types present → the filter appears (hidden otherwise).
  await expect(page.locator('#watchlist-type')).toBeVisible();

  await page.selectOption('#watchlist-type', 'movie');
  await expect(page.locator('#watchlist-grid .card')).toHaveCount(1);
  await expect(page.locator('#watchlist-grid .card.tv')).toHaveCount(0);

  await page.selectOption('#watchlist-type', 'tv');
  await expect(page.locator('#watchlist-grid .card')).toHaveCount(1);
  await expect(page.locator('#watchlist-grid .card.tv')).toHaveCount(1);
});
