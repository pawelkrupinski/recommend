import { test, expect } from '@playwright/test';
import { login, uniqEmail, enterPicks } from './helpers.js';

// Space below the popup stars minus the space above them, within the tray —
// ~0 when the padding reads symmetric (positive = bottom-heavy).
const trayGapDelta = (page) => page.evaluate(() => {
  const tray = document.querySelector('.rate-watched .rate-stars').getBoundingClientRect();
  const stars = document.querySelector('.rate-watched .stars').getBoundingClientRect();
  return (tray.bottom - stars.bottom) - (stars.top - tray.top);
});

test('saving a Discover pick removes its card, flashes the tab, and lands in the Watchlist', async ({ page }) => {
  await login(page, uniqEmail('watchlist'));
  await enterPicks(page);

  // The stub yields 4 streamable picks (3 Discover + 1 trending-only). Wait for
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

test('the Watchlist sort dropdown reorders cards by average rating and persists in the URL', async ({ page }) => {
  await login(page, uniqEmail('watch-sort'));

  // Seed three saved titles with distinct critic scores straight through the API
  // (the card fields persist). Averages on a 0–10 scale: Low 5.0, Mid 7.0
  // ((8+6)/2), High 9.5 (metascore 95). They're saved High → Low → Mid, a >1s gap
  // apart so added_at (second-resolution) strictly increases — the default
  // added-DESC order (Mid, Low, High) is then deterministic and differs from the
  // rating order, proving the sort actually reorders rather than coinciding.
  await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const save = (b) => fetch('/api/watchlist', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
    await save({ tmdb_id: 703, title: 'High', year: 2003, metascore: 95 });
    await sleep(1100);
    await save({ tmdb_id: 701, title: 'Low', year: 2001, imdbRating: 5 });
    await sleep(1100);
    await save({ tmdb_id: 702, title: 'Mid', year: 2002, imdbRating: 8, metascore: 60 });
  });

  // Default order is newest-first (added_at DESC).
  await page.goto('/watchlist');
  const titles = page.locator('#watchlist-grid .card .title');
  await expect(titles).toHaveText(['Mid', 'Low', 'High']);

  // Choosing "Top rated" reorders by descending average and records ?sort=rating.
  await page.locator('#watchlist-sort').selectOption('rating');
  await expect(page).toHaveURL(/\/watchlist\?sort=rating$/);
  await expect(titles).toHaveText(['High', 'Mid', 'Low']);

  // The sort survives a reload because it lives in the URL.
  await page.reload();
  await expect(page.locator('#watchlist-sort')).toHaveValue('rating');
  await expect(titles).toHaveText(['High', 'Mid', 'Low']);

  // Switching back to "Recently added" drops the query and restores added order.
  await page.locator('#watchlist-sort').selectOption('added');
  await expect(page).toHaveURL(/\/watchlist$/);
  await expect(titles).toHaveText(['Mid', 'Low', 'High']);
});

test('the Watchlist remembers the last chosen sort on a fresh visit (no URL query)', async ({ page }) => {
  await login(page, uniqEmail('watch-remember'));
  await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const save = (b) => fetch('/api/watchlist', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
    await save({ tmdb_id: 703, title: 'High', year: 2003, metascore: 95 });
    await sleep(1100);
    await save({ tmdb_id: 701, title: 'Low', year: 2001, imdbRating: 5 });
    await sleep(1100);
    await save({ tmdb_id: 702, title: 'Mid', year: 2002, imdbRating: 8, metascore: 60 });
  });

  await page.goto('/watchlist');
  await page.locator('#watchlist-sort').selectOption('rating');
  const titles = page.locator('#watchlist-grid .card .title');
  await expect(titles).toHaveText(['High', 'Mid', 'Low']);

  // A bare /watchlist with no ?sort (a fresh app boot, like clicking the nav tab)
  // must still come up "Top rated" because the choice was saved server-side.
  await page.goto('/watchlist');
  await expect(page.locator('#watchlist-sort')).toHaveValue('rating');
  await expect(titles).toHaveText(['High', 'Mid', 'Low']);
});

test('the IMDb and Metacritic badges are links out to their sources', async ({ page }) => {
  await login(page, uniqEmail('rating-badge-links'));

  // Save two titles: one carrying its IMDb id (deep-links to the title page) and
  // one without (falls back to an IMDb title search). Both carry a Metascore.
  await page.evaluate(async () => {
    const save = (b) => fetch('/api/watchlist', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
    await save({ tmdb_id: 603, title: 'The Matrix', year: 1999, imdb_id: 'tt0133093', imdbRating: 8.7, metascore: 73 });
    await save({ tmdb_id: 999, title: 'No Id Film', year: 2020, imdbRating: 6.1, metascore: 55 });
  });

  await page.goto('/watchlist');
  const withId = page.locator('#watchlist-grid .card', { hasText: 'The Matrix' });
  const noId = page.locator('#watchlist-grid .card', { hasText: 'No Id Film' });

  // Both badges render as real anchors (ctrl/middle-clickable into a new tab).
  await expect(withId.locator('a.rb.imdb')).toHaveAttribute('href', 'https://www.imdb.com/title/tt0133093/');
  await expect(withId.locator('a.rb.mc')).toHaveAttribute('href', /metacritic\.com\/search\/The%20Matrix/);
  await expect(withId.locator('a.rb.imdb')).toHaveAttribute('target', '_blank');

  // Without an IMDb id the badge falls back to an on-site title search.
  await expect(noId.locator('a.rb.imdb')).toHaveAttribute('href', /imdb\.com\/find\/\?s=tt&q=No%20Id%20Film/);
});

test('rating a saved title in its popup records the rating and drops it from the watchlist', async ({ page }) => {
  await login(page, uniqEmail('watch-rate'));

  // Seed one saved title straight through the API (card fields persist).
  await page.evaluate(async () => {
    await fetch('/api/watchlist', { method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tmdb_id: 555, title: 'Seen It', year: 2010 }) });
  });

  await page.goto('/watchlist');
  const saved = page.locator('#watchlist-grid .card', { hasText: 'Seen It' });
  await expect(saved).toBeVisible();

  // Open the where-to-watch popup; once availability loads it carries a
  // "watched it?" rate widget (the Discover popup has none).
  await saved.locator('> img').click();
  await expect(page.locator('#modal')).toBeVisible();
  const rate = page.locator('#modal-body .rate-watched');
  await expect(rate).toBeVisible();

  // On desktop all 10 stars sit in a single row (one distinct top edge).
  const rows = await rate.locator('.stars span').evaluateAll(
    (els) => new Set(els.map((e) => Math.round(e.getBoundingClientRect().top))).size);
  expect(rows).toBe(1);

  // The stars tray isn't bottom-heavy: the space below the stars matches the
  // space above (the "n / 10" readout reserves no blank line here).
  expect(Math.abs(await trayGapDelta(page))).toBeLessThanOrEqual(2);

  // Rating it 8/10 closes the modal and drops the title from the list…
  await rate.locator('.stars span[data-n="8"]').click();
  await expect(page.locator('#modal')).toBeHidden();
  await expect(page.locator('#watchlist-grid')).toContainText('Your watchlist is empty');
  await expect(page.locator('#watchlist-count')).toContainText('0 saved');

  // …and the rating was recorded (8 on the 1–10 star scale).
  const rated = await page.evaluate(async () => (await (await fetch('/api/ratings')).json()).ratings);
  expect(rated).toHaveLength(1);
  expect(rated[0]).toMatchObject({ tmdb_id: 555, rating: 8 });
});

// The popup lives in a scrollable modal-card; on mobile the shared stars widget's
// touch-action: pan-y let a rate-drag scroll the card under the finger (the stars
// "jitter"). In the popup the strip must opt out of native panning entirely.
test.describe('mobile', () => {
  test.use({ viewport: { width: 390, height: 620 }, hasTouch: true, isMobile: true });

  test('the popup rate stars opt out of touch panning so dragging to rate never scrolls the card', async ({ page }) => {
    await login(page, uniqEmail('watch-jitter'));
    await page.evaluate(async () => {
      await fetch('/api/watchlist', { method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tmdb_id: 555, title: 'Seen It', year: 2010 }) });
    });

    await page.goto('/watchlist');
    await page.locator('#watchlist-grid .card', { hasText: 'Seen It' }).locator('> img').click();
    const stars = page.locator('#modal-body .rate-watched .stars');
    await expect(stars).toBeVisible();
    // The rating strip takes no native pan (unlike the Discover card's pan-y stars).
    await expect(stars).toHaveCSS('touch-action', 'none');
    // And its tray padding reads symmetric on mobile too (top === bottom).
    expect(Math.abs(await trayGapDelta(page))).toBeLessThanOrEqual(2);
  });
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
