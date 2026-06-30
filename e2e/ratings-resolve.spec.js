// The visible payoff: a card that paints WITHOUT rating badges (its ratings are
// resolved off the build) gains IMDb/Metacritic badges once /api/enrich returns.
// Under the stub the real lookups are inert, so we stub /api/enrich's response to
// stand in for a successful resolution and assert the badges appear — on Discover
// and on the Watchlist, which share the same deferred enrich path.
import { test, expect } from '@playwright/test';
import { login, uniqEmail, enterPicks } from './helpers.js';

// Make /api/enrich answer every requested id with a known rating, as a real
// resolution would. imdb_id stands in for a freshly title·year-resolved id.
async function stubEnrich(page) {
  await page.route('**/api/enrich**', async (route) => {
    const ids = (new URL(route.request().url()).searchParams.get('ids') || '').split(',').filter(Boolean);
    // /api/enrich streams NDJSON — one `{ key, ... }` line per resolved title.
    const body = ids
      .map((id) => JSON.stringify({ key: id, imdbRating: 7.8, metascore: 84, imdb_id: 'tt0133093', tones: [] }))
      .join('\n') + '\n';
    await route.fulfill({ contentType: 'application/x-ndjson', body });
  });
}

test('Discover cards gain IMDb/Metacritic badges once enrichment resolves', async ({ page }) => {
  await login(page, uniqEmail('resolve'));
  await stubEnrich(page);
  await enterPicks(page);

  const imdb = page.locator('#recs .card .ratings .rb.imdb').first();
  await expect(imdb).toBeVisible();
  await expect(imdb).toHaveText(/IMDb 7\.8/);
  await expect(page.locator('#recs .card .ratings .rb.mc').first()).toHaveText(/MC 84/);
});

test('a saved title with no badge gains one on the Watchlist when resolution lands', async ({ page }) => {
  await login(page, uniqEmail('resolve-wl'));
  await stubEnrich(page);
  // Save a title with no rating fields — exactly the case the resolver fills in.
  await page.evaluate(async () => {
    await fetch('/api/watchlist', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tmdb_id: 603, title: 'The Matrix', year: 1999, poster_path: '/p.jpg' }),
    });
  });

  await page.goto('/watchlist');
  const imdb = page.locator('#watchlist-grid .card .ratings .rb.imdb').first();
  await expect(imdb).toBeVisible();
  await expect(imdb).toHaveText(/IMDb 7\.8/);
});
