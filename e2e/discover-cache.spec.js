import { test, expect } from '@playwright/test';
import { login, uniqEmail } from './helpers.js';

// Discover picks are deterministic — the same view with unchanged ratings rebuilds
// to the identical grid. So tabbing away and back used to clear the grid, show a
// "building" line and refetch /api/recommend for a byte-identical result. The
// client now reuses the grid across navigation and only refetches once the user
// does something (rate/dismiss/watchlist/settings) that could actually change the
// picks. These two tests pin both halves of that contract.

// Drive a fresh account into personalized picks on the large backfill pool
// (provider 9, 220 titles) so the grid fills to the server's 36-card cap — well
// above the refill threshold, so a single dismiss never triggers its own refetch.
async function seedAndOpen(page) {
  await page.evaluate(async () => {
    await fetch('/api/settings', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ providers: [9] }) });
    for (let i = 0; i < 12; i++) {
      await fetch('/api/ratings', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tmdb_id: 900 + i, rating: 8, title: `Seed ${i}`, year: 2020 }) });
    }
  });
  await page.goto('/discover');
  await expect(page.locator('#recs .card')).toHaveCount(36, { timeout: 20_000 });
}

test('returning to Discover with nothing changed reuses the grid (no rebuild)', async ({ page }) => {
  await login(page, uniqEmail('rec-cache'));

  let recCalls = 0;
  page.on('request', (r) => { if (r.url().includes('/api/recommend')) recCalls++; });

  await seedAndOpen(page); // cold build: the one /api/recommend we expect
  const firstId = await page.locator('#recs .card').first().getAttribute('data-id');

  // Tab away and back without touching any rating/filter.
  recCalls = 0;
  await page.locator('#tabs a[data-tab="ratings"]').click();
  await expect(page.locator('#ratings')).toHaveClass(/active/);
  await page.locator('#tabs a[data-tab="discover"]').click();
  await expect(page.locator('#discover')).toHaveClass(/active/);

  // The exact same cards are still there — no clear, no spinner — and crucially no
  // second /api/recommend fired. A brief settle catches any stray async refetch.
  await expect(page.locator('#recs .card').first()).toHaveAttribute('data-id', firstId);
  await page.waitForTimeout(500);
  expect(recCalls).toBe(0);
  await expect(page.locator('#recs .card')).toHaveCount(36);
});

test('a dismiss marks the picks stale so the next visit rebuilds', async ({ page }) => {
  await login(page, uniqEmail('rec-cache-stale'));

  let recCalls = 0;
  page.on('request', (r) => { if (r.url().includes('/api/recommend')) recCalls++; });

  await seedAndOpen(page);
  const cards = page.locator('#recs .card');

  // Dismiss one pick (POST /api/dismiss bumps the server's recGen and the client's
  // stale flag). 35 cards left is well above the refill threshold, so this dismiss
  // doesn't itself refetch — isolating the rebuild to the tab-back below.
  const id = await cards.first().getAttribute('data-id');
  await cards.first().locator('.dismiss-btn').click({ force: true });
  await expect(page.locator(`#recs .card[data-id="${id}"]`)).toHaveCount(0);

  // Now a tab-away-and-back MUST rebuild — the picks could legitimately differ.
  recCalls = 0;
  await page.locator('#tabs a[data-tab="ratings"]').click();
  await expect(page.locator('#ratings')).toHaveClass(/active/);
  await page.locator('#tabs a[data-tab="discover"]').click();
  await expect(page.locator('#discover')).toHaveClass(/active/);

  await expect.poll(() => recCalls, { timeout: 10_000 }).toBeGreaterThanOrEqual(1);
});
