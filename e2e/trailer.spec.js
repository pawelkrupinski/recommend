import { test, expect } from '@playwright/test';
import { login, uniqEmail, enterPicks } from './helpers.js';

test('a Discover pick popup links to the YouTube trailer (new tab) and keeps "Not interested"', async ({ page }) => {
  await login(page, uniqEmail('trailer'));
  await enterPicks(page);

  // Open the where-to-watch popup from a Discover card (poster tap).
  const card = page.locator('#recs .card').first();
  const id = await card.getAttribute('data-id');
  await card.locator('img').first().click(); // the poster (a service-icon img also lives in the card)
  await expect(page.locator('#modal')).toBeVisible();

  // The trailer is a link that opens YouTube in a new tab (default language is
  // English → the stub's English trailer yt-en-<id>).
  const link = page.locator('#modal-body .trailer-link');
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', new RegExp(`youtube\\.com/watch\\?v=yt-en-${id}`));
  await expect(link).toHaveAttribute('target', '_blank');

  // Discover keeps the "Not interested / seen it" dismiss button.
  await expect(page.locator('#modal-body #dismiss')).toBeVisible();
});

test('a Watchlist popup shows the trailer link but NOT the "Not interested" button', async ({ page }) => {
  await login(page, uniqEmail('trailer-wl'));
  await enterPicks(page);

  // Save a Discover pick, then open its popup from the Watchlist tab.
  const pick = page.locator('#recs .card').first();
  const id = await pick.getAttribute('data-id');
  await pick.locator('.watch-btn').click();
  await page.locator('#tabs a[data-tab="watchlist"]').click();
  const saved = page.locator('#watchlist-grid .card').first();
  await saved.locator('img').first().click();
  await expect(page.locator('#modal')).toBeVisible();

  // The trailer link is present in the Watchlist popup too (trailers were captured
  // at save time and ride along in the saved card).
  const link = page.locator('#modal-body .trailer-link');
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', new RegExp(`youtube\\.com/watch\\?v=yt-en-${id}`));
  await expect(link).toHaveAttribute('target', '_blank');

  // But the dismiss button is gone — you don't "not interested" a title you saved.
  await expect(page.locator('#modal-body #dismiss')).toHaveCount(0);
});
