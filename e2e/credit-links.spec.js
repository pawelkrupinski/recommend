import { test, expect } from '@playwright/test';
import { login, uniqEmail, enterPicks } from './helpers.js';

// Open the where-to-watch popup from the first Discover card (poster tap) and
// return once the modal is visible, so callers can assert on the credit links.
async function openFirstCard(page) {
  const card = page.locator('#recs .card').first();
  await card.locator('img').first().click();
  await expect(page.locator('#modal')).toBeVisible();
}

test('the popup links the director and cast names to their exact IMDb pages (new tab)', async ({ page }) => {
  await login(page, uniqEmail('imdb-credits'));
  await enterPicks(page);
  await openFirstCard(page);

  // Director (stub person 500) resolves to an exact IMDb name link once /api/where
  // returns the title's person ids. The href auto-retry waits for that re-render.
  const director = page.locator('#modal-body .credit a.credit-name', { hasText: 'Stub Director' });
  await expect(director).toHaveAttribute('href', 'https://www.imdb.com/name/nm1000500/');
  await expect(director).toHaveAttribute('target', '_blank');
  await expect(director).toHaveAttribute('rel', 'noopener');

  // Cast (stub person 600) likewise links straight to its IMDb page.
  const actor = page.locator('#modal-body .credit a.credit-name', { hasText: 'Stub Actor' });
  await expect(actor).toHaveAttribute('href', 'https://www.imdb.com/name/nm1000600/');
  await expect(actor).toHaveAttribute('target', '_blank');
});

test('for a Polish audience the popup links credits to Filmweb (name search) instead of IMDb', async ({ page }) => {
  await login(page, uniqEmail('filmweb-credits'));
  await enterPicks(page);
  // Switch the account to Poland, then reload so /api/me re-hydrates REGION='PL'
  // (the credit links are chosen from REGION at render time).
  await page.evaluate(() => fetch('/api/settings', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ country: 'PL' }),
  }));
  await page.goto('/discover');
  await expect(page.locator('#recs .card').first()).toBeVisible({ timeout: 20_000 });
  await openFirstCard(page);

  // No Filmweb person id exists to resolve, so both director and cast open a
  // Filmweb person-name search rather than an IMDb page.
  const director = page.locator('#modal-body .credit a.credit-name', { hasText: 'Stub Director' });
  await expect(director).toHaveAttribute('href', 'https://www.filmweb.pl/search#/person?query=Stub%20Director');
  await expect(director).toHaveAttribute('target', '_blank');
  await expect(director).toHaveAttribute('rel', 'noopener');

  const actor = page.locator('#modal-body .credit a.credit-name', { hasText: 'Stub Actor' });
  await expect(actor).toHaveAttribute('href', 'https://www.filmweb.pl/search#/person?query=Stub%20Actor');

  // And no IMDb credit link leaks through for the Polish audience.
  await expect(page.locator('#modal-body .credit a[href*="imdb.com/name"]')).toHaveCount(0);
});
