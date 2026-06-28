import { test, expect } from '@playwright/test';
import { login, uniqEmail, enterPicks } from './helpers.js';

// Discover should keep itself stocked: when a pick leaves the grid (rated,
// dismissed or saved) and the visible count drops below the low-water mark, the
// client refetches the current view and tops the grid back up with the next
// titles — so picks don't silently run dry mid-session. The stub's small fixed
// catalogue can't show new cards appended, but it proves the trigger: removing a
// card below the threshold kicks off a fresh /api/recommend fetch.
test('removing a pick below the low-water mark triggers a refill fetch', async ({ page }) => {
  await login(page, uniqEmail('refill'));
  await enterPicks(page);
  await expect(page.locator('#recs .card')).toHaveCount(4);

  // Count only the fetches that happen after the grid is up, so the initial
  // load's request doesn't get miscredited to the refill.
  let refillFetches = 0;
  page.on('request', (r) => { if (r.url().includes('/api/recommend')) refillFetches++; });

  // Dismiss a card → 3 left, under PICKS_MIN (8) → a refill fetch must fire.
  await page.locator('#recs .card').first().locator('.dismiss-btn').click();
  await expect.poll(() => refillFetches, { timeout: 10_000 }).toBeGreaterThan(0);
  // The grid stays rendered (the refill must not blow it away).
  await expect(page.locator('#recs .card').first()).toBeVisible();
});
