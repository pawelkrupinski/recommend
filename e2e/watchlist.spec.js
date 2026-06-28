import { test, expect } from '@playwright/test';
import { login, uniqEmail, enterPicks } from './helpers.js';

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
