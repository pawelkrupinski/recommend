import { test, expect } from '@playwright/test';
import { login, uniqEmail, enterPicks } from './helpers.js';

// Regression for the ~0.5s lag between clicking "Not interested" / a rating and
// the card actually disappearing. The handlers used to `await` the POST before
// removing the card, so the grid sat frozen for a whole network round-trip. The
// removal is now optimistic (commitCard): the card leaves the grid on click and
// the write follows in the background. We prove it by stalling the write for 3s
// and asserting the card is gone long before the response could arrive.
test('dismissing a pick removes the card without waiting on the server', async ({ page }) => {
  await login(page, uniqEmail('optimistic'));
  await enterPicks(page);

  // Hold the dismiss write open for 3s — far longer than any real round-trip.
  await page.route('**/api/dismiss', async (route) => {
    await new Promise((r) => setTimeout(r, 3000));
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });

  const first = page.locator('#recs .card').first();
  const id = await first.getAttribute('data-id');
  const started = Date.now();
  await first.locator('.dismiss-btn').click({ force: true });

  // The card must detach while the POST is still in flight. With the old blocking
  // code this only happened after the 3s stall, so a 1s budget fails before the
  // change and passes after.
  await expect(page.locator(`#recs .card[data-id="${id}"]`)).toHaveCount(0, { timeout: 1000 });
  expect(Date.now() - started).toBeLessThan(2000);
});

// Same regression for the "+" save button, which used to `await` the POST (with the
// button disabled) before dropping the card — so saving a pick felt frozen for a
// whole round-trip ("adding to watchlist takes ages") while dismiss/rate on the same
// card were instant. The save is now optimistic too (commitCard).
test('saving a pick to the watchlist removes the card without waiting on the server', async ({ page }) => {
  await login(page, uniqEmail('optimistic-watch'));
  await enterPicks(page);

  // Hold the watchlist write open for 3s — far longer than any real round-trip.
  await page.route('**/api/watchlist', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    await new Promise((r) => setTimeout(r, 3000));
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });

  const first = page.locator('#recs .card').first();
  const id = await first.getAttribute('data-id');
  const started = Date.now();
  await first.locator('.watch-btn').click({ force: true });

  // The card must detach while the POST is still in flight. The old blocking code
  // only removed it after the 3s stall, so a 1s budget fails before the change.
  await expect(page.locator(`#recs .card[data-id="${id}"]`)).toHaveCount(0, { timeout: 1000 });
  expect(Date.now() - started).toBeLessThan(2000);
});
