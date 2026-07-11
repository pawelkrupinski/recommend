import { test, expect } from '@playwright/test';
import { login, uniqEmail } from './helpers.js';

// The header search box queries /api/search for any title on the user's chosen
// services (server-sorted on-service first) and renders the results as the same
// cards Discover uses — so they carry the streaming-service icon, the rate stars,
// and the add-to-watchlist button, and can be acted on right there. /api/search
// reaches TMDB + MotN live, so we stub it with two canned cards: one ON a service
// (a Netflix icon) and one OFF every service (no icon), exactly the two shapes the
// real endpoint returns.

const SEARCH_RESULTS = {
  results: [
    // On-service: streamable on the user's Netflix → carries a service icon.
    { tmdb_id: 603, media_type: 'movie', title: 'The Matrix', year: 1999, poster_path: '/matrix.png',
      runtime: 136, overview: 'A hacker learns the truth.', genres: ['Action'], genreIds: [28],
      tones: [], director: 'The Wachowskis', cast: ['Keanu Reeves'], trailers: [],
      services: [{ id: 8, name: 'Netflix Test', logo: '/netflix.png' }] },
    // Off-service: on none of the user's services → no service icon at all.
    { tmdb_id: 604, media_type: 'movie', title: 'The Matrix Reloaded', year: 2003, poster_path: '/reloaded.png',
      runtime: 138, overview: 'Neo continues.', genres: ['Action'], genreIds: [28],
      tones: [], director: 'The Wachowskis', cast: ['Keanu Reeves'], trailers: [], services: [] },
  ],
};

test('search renders result cards with service icons, rate stars and watchlist button', async ({ page }) => {
  await login(page, uniqEmail('search'));
  // Stub /api/search before typing so the box's fetch hits the canned results.
  await page.route('**/api/search**', (route) => route.fulfill({ json: SEARCH_RESULTS }));

  await page.fill('#search-box', 'matrix');

  // The results land in their own panel, not the Discover grid.
  const cards = page.locator('#search-panel.active #search-grid .card');
  await expect(cards).toHaveCount(2);

  // On-service card badges its Netflix icon; off-service card shows none.
  await expect(cards.nth(0).locator('.svc-ico')).toHaveCount(1);
  await expect(cards.nth(0).locator('.svc-ico')).toHaveAttribute('title', 'Watch on Netflix Test');
  await expect(cards.nth(1).locator('.svc-ico')).toHaveCount(0);

  // Each card is actionable: rate stars and the add-to-watchlist button are there.
  await expect(cards.nth(0).locator('.rate-stars span[data-n="8"]')).toHaveCount(1);
  await expect(cards.nth(0).locator('.watch-btn')).toHaveCount(1);
});

test('clearing the search box hides the panel and restores the previous tab', async ({ page }) => {
  await login(page, uniqEmail('search-clear'));
  await page.route('**/api/search**', (route) => route.fulfill({ json: SEARCH_RESULTS }));

  await page.fill('#search-box', 'matrix');
  await expect(page.locator('#search-panel')).toHaveClass(/active/);
  await expect(page.locator('#discover')).not.toHaveClass(/active/);

  await page.fill('#search-box', '');
  await expect(page.locator('#search-panel')).not.toHaveClass(/active/);
  await expect(page.locator('#discover')).toHaveClass(/active/);
});
