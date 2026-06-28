import { test, expect } from '@playwright/test';
import { login, uniqEmail } from './helpers.js';

// Regression for "I've run out of recommendations": the personalized-picks grid
// used to dead-end on an empty grid once the user cleared the ~36 cards it shows
// at once — only a manual Refresh brought more. Now it tops itself up in the
// background as cards leave (refillPicks). The stub serves a large backfill pool
// on provider 9 (220 titles, well beyond the 36 shown), so dismissing past the
// initial batch must keep surfacing fresh cards instead of emptying.
test('the picks grid refills itself instead of dead-ending when cleared', async ({ page }) => {
  await login(page, uniqEmail('refill'));

  // Pick the backfill provider (its catalog is the large stub pool) and rate
  // enough to leave onboarding for personalized picks.
  await page.evaluate(async () => {
    await fetch('/api/settings', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ providers: [9] }) });
    for (let i = 0; i < 12; i++) {
      await fetch('/api/ratings', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tmdb_id: 900 + i, rating: 8, title: `Seed ${i}`, year: 2020 }) });
    }
  });
  await page.goto('/discover');

  const cards = page.locator('#recs .card');
  // Cold /api/recommend build over the stub — give it a backend-sized budget.
  await expect(cards.first()).toBeVisible({ timeout: 20_000 });
  // The grid shows the server's per-request cap (36), with the rest of the pool
  // held in reserve behind it.
  await expect(cards).toHaveCount(36, { timeout: 20_000 });

  // Clear past the initial batch. Each dismiss is excluded server-side, so a
  // refill never re-adds it; wait for the dismissed id to detach before the next.
  for (let i = 0; i < 30; i++) {
    const first = cards.first();
    const id = await first.getAttribute('data-id');
    // force: the grid reflows constantly as cards leave and the refill appends,
    // so the button is rarely "stable" — we just need the click to land.
    await first.locator('.dismiss-btn').click({ force: true });
    await expect(page.locator(`#recs .card[data-id="${id}"]`)).toHaveCount(0);
  }

  // Without the refill the grid would be down to ~6 cards (36 − 30); the
  // background top-up keeps it stocked from the backfill pool instead of
  // dead-ending on an empty grid.
  await expect
    .poll(async () => cards.count(), { timeout: 15_000 })
    .toBeGreaterThan(12);
  await expect(page.locator('#recs .empty')).toHaveCount(0);
});
