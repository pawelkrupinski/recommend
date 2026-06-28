import { test, expect } from '@playwright/test';
import { login, uniqEmail, enterPicks } from './helpers.js';

test('saving a Discover pick removes its card, flashes the tab, and lands in the Watchlist', async ({ page }) => {
  await login(page, uniqEmail('watchlist'));
  await enterPicks(page);

  // The stub yields 4 streamable picks (3 from discover + 1 trending). Wait for
  // the grid to finish painting all of them before counting, so `before` is the
  // settled total rather than a mid-build value (the picks build can lag under
  // full-suite load).
  await expect(page.locator('#recs .card')).toHaveCount(4);
  const before = await page.locator('#recs .card').count();
  const card = page.locator('#recs .card').first();
  const title = await card.locator('.title').textContent();
  const watchTab = page.locator('#tabs a[data-tab="watchlist"]');

  // Clicking + saves the title, pulses the Watchlist tab, and drops the card.
  await card.locator('.watch-btn').click();
  await expect(watchTab).toHaveClass(/flash/);
  await expect(page.locator('#recs .card')).toHaveCount(before - 1);
  await expect(page.locator('#recs .card', { hasText: title })).toHaveCount(0);

  // It now lives under the Watchlist tab.
  await watchTab.click();
  const saved = page.locator('#watchlist-grid .card', { hasText: title });
  await expect(saved).toBeVisible();
  await expect(page.locator('#watchlist-count')).toContainText('1 saved');

  // The saved card mirrors a Discover pick: it carries the same service icons and
  // genre line (captured at save time) — but no score badge and no rate widget.
  await expect(saved.locator('.svc-ico')).toHaveCount(1);
  // The service icon is a real link to the service's search (not href="#"), so it
  // can be ctrl/middle-clicked into a new tab.
  await expect(saved.locator('.svc-ico')).toHaveAttribute('href', /^https:\/\//);
  await expect(saved.locator('.genres')).toContainText('Action');
  await expect(saved.locator('.score')).toHaveCount(0);
  await expect(saved.locator('.rate-stars')).toHaveCount(0);

  // Tapping the poster opens the same where-to-watch popup, now with the rich
  // detail header (synopsis) a Discover card's popup shows.
  await saved.locator('> img').click();
  await expect(page.locator('#modal')).toBeVisible();
  await expect(page.locator('#modal-body .detail-head')).toContainText('Overview for');
  await page.locator('#modal-close').click();

  // Removing it there empties the list.
  await saved.locator('.watch-remove').click();
  await expect(page.locator('#watchlist-grid')).toContainText('Your watchlist is empty');
});

test('a watchlisted title stays out of the Discover grid after a reload', async ({ page }) => {
  await login(page, uniqEmail('watch-hide'));
  await enterPicks(page);

  const title = await page.locator('#recs .card .title').first().textContent();
  await page.locator('#recs .card').first().locator('.watch-btn').click();
  await expect(page.locator('#recs .card', { hasText: title })).toHaveCount(0);

  // The recommender still returns the title on a fresh load (the watchlist isn't
  // a server-side exclusion), so the client must keep it out of the grid itself.
  await page.reload();
  await expect(page.locator('#recs .card').first()).toBeVisible();
  await expect(page.locator('#recs .card', { hasText: title })).toHaveCount(0);
});
