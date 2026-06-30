// IMDb/Metacritic ratings are no longer built into the recommendation pool —
// they're resolved off the build's critical path via /api/enrich, which the
// client fetches for the cards it shows and patches into the rating badges. This
// proves the deferral is wired: Discover fires /api/enrich for the visible ids and
// the cards render regardless (enrichment is inert under the stub, so the test
// asserts the request + intact rendering, not the badge values).
import { test, expect } from '@playwright/test';
import { login, uniqEmail, enterPicks } from './helpers.js';

test('Discover defers rating enrichment to /api/enrich after the cards paint', async ({ page }) => {
  await login(page, uniqEmail('enrich'));
  // Register the waiter before the Discover load that triggers the request.
  const enrichReq = page.waitForRequest(
    (r) => r.url().includes('/api/enrich') && r.method() === 'GET',
    { timeout: 20_000 },
  );
  await enterPicks(page);

  const req = await enrichReq;
  expect(new URL(req.url()).searchParams.get('ids')).toMatch(/\d+/);
  // The deferral must not break rendering: cards are present and the request
  // resolving to null ratings under the stub leaves them cleanly badge-less.
  await expect(page.locator('#recs .card').first()).toBeVisible();
});
