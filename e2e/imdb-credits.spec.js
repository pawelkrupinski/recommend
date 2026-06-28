import { test, expect } from '@playwright/test';
import { login, uniqEmail, enterPicks } from './helpers.js';

test('the popup links the director and cast names to IMDb name searches (new tab)', async ({ page }) => {
  await login(page, uniqEmail('imdb-credits'));
  await enterPicks(page);

  // Open the where-to-watch popup from a Discover card (poster tap).
  const card = page.locator('#recs .card').first();
  await card.locator('img').first().click();
  await expect(page.locator('#modal')).toBeVisible();

  // Director (stub: "Stub Director") is an IMDb name-search link opening a new tab.
  const director = page.locator('#modal-body .credit a.imdb-name', { hasText: 'Stub Director' });
  await expect(director).toBeVisible();
  await expect(director).toHaveAttribute('href', 'https://www.imdb.com/find/?s=nm&q=Stub%20Director');
  await expect(director).toHaveAttribute('target', '_blank');
  await expect(director).toHaveAttribute('rel', 'noopener');

  // Cast (stub: "Stub Actor") is likewise an IMDb name-search link.
  const actor = page.locator('#modal-body .credit a.imdb-name', { hasText: 'Stub Actor' });
  await expect(actor).toBeVisible();
  await expect(actor).toHaveAttribute('href', 'https://www.imdb.com/find/?s=nm&q=Stub%20Actor');
  await expect(actor).toHaveAttribute('target', '_blank');
});
