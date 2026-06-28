import { test, expect } from '@playwright/test';
import { login, uniqEmail } from './helpers.js';

// Drive a fresh account straight into Discover's personalized-picks mode: pick
// the stub streaming provider and seed 10 ratings via the API (the client only
// swaps the onboarding rate queue for real picks once RATE_GOAL is reached).
async function enterPicks(page) {
  await page.evaluate(async () => {
    await fetch('/api/settings', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ providers: [8] }) });
    for (let i = 0; i < 10; i++) {
      await fetch('/api/ratings', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tmdb_id: 900 + i, rating: 8, title: `Seed ${i}`, year: 2020 }) });
    }
  });
  await page.goto('/#discover');
  await expect(page.locator('#recs .card').first()).toBeVisible();
}

test('the + button on a Discover card saves the title to the Watchlist tab', async ({ page }) => {
  await login(page, uniqEmail('watchlist'));
  await enterPicks(page);

  // The first pick starts un-saved (+); clicking it saves (✓).
  const card = page.locator('#recs .card').first();
  const title = await card.locator('.title').textContent();
  const btn = card.locator('.watch-btn');
  await expect(btn).toHaveText('+');
  await btn.click();
  await expect(btn).toHaveText('✓');
  await expect(btn).toHaveClass(/on/);

  // It appears under the Watchlist tab.
  await page.locator('#tabs button[data-tab="watchlist"]').click();
  const saved = page.locator('#watchlist-grid .card', { hasText: title });
  await expect(saved).toBeVisible();
  await expect(page.locator('#watchlist-count')).toContainText('1 saved');

  // Removing it there empties the list.
  await saved.locator('.watch-remove').click();
  await expect(page.locator('#watchlist-grid')).toContainText('Your watchlist is empty');

  // Back on Discover the same card's button has reset to +.
  await page.locator('#tabs button[data-tab="discover"]').click();
  await expect(
    page.locator('#recs .card', { hasText: title }).locator('.watch-btn')
  ).toHaveText('+');
});
