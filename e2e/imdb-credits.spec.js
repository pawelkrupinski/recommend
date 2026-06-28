import { test, expect } from '@playwright/test';
import { login, uniqEmail, enterPicks } from './helpers.js';

test('the popup links the director and cast names to their exact IMDb pages (new tab)', async ({ page }) => {
  await login(page, uniqEmail('imdb-credits'));
  await enterPicks(page);

  // Open the where-to-watch popup from a Discover card (poster tap).
  const card = page.locator('#recs .card').first();
  await card.locator('img').first().click();
  await expect(page.locator('#modal')).toBeVisible();

  // Director (stub person 500) resolves to an exact IMDb name link once /api/where
  // returns the title's person ids. The href auto-retry waits for that re-render.
  const director = page.locator('#modal-body .credit a.imdb-name', { hasText: 'Stub Director' });
  await expect(director).toHaveAttribute('href', 'https://www.imdb.com/name/nm1000500/');
  await expect(director).toHaveAttribute('target', '_blank');
  await expect(director).toHaveAttribute('rel', 'noopener');

  // Cast (stub person 600) likewise links straight to its IMDb page.
  const actor = page.locator('#modal-body .credit a.imdb-name', { hasText: 'Stub Actor' });
  await expect(actor).toHaveAttribute('href', 'https://www.imdb.com/name/nm1000600/');
  await expect(actor).toHaveAttribute('target', '_blank');
});
