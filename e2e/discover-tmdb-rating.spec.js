import { test, expect } from '@playwright/test';
import { login, uniqEmail, enterPicks } from './helpers.js';

// The TMDB community rating (a "⭐ 8.0" in the card's year/runtime meta line) was
// dropped from the card — the IMDb pill and Metacritic badge below it are the
// ratings we surface now. The stub Discover titles carry a vote_average (8.0 /
// 7.5), so before the change this meta line rendered the star; assert it no
// longer does, while the year still shows.
test('the Discover card meta line drops the TMDB ⭐ rating but keeps the year', async ({ page }) => {
  await login(page, uniqEmail('no-tmdb-rating'));
  await enterPicks(page);

  const meta = await page.locator('#recs .card').first().locator('.year').innerText();
  expect(meta).toMatch(/\b(19|20)\d{2}\b/); // the year is still there
  expect(meta).not.toContain('⭐'); // …but the TMDB rating star is gone
});
