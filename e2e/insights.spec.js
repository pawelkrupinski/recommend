import { test, expect } from '@playwright/test';
import { login, uniqEmail } from './helpers.js';

// Rate a spread of stub titles at varied scores so the profile carries non-zero
// (signed) feature weights — uniform ratings would net to a flat delta and learn
// nothing. 201 = Action, 202 = Comedy in the stub, so the two genres land on
// opposite sides of the user's mean.
async function seedVariedRatings(page) {
  await page.evaluate(async () => {
    const ratings = [[201, 10], [202, 3], [203, 8], [101, 9], [102, 5], [103, 7]];
    for (const [tmdb_id, rating] of ratings) {
      await fetch('/api/ratings', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tmdb_id, rating, title: `Film ${tmdb_id}`, year: 2020 }) });
    }
  });
}

// The hidden /insights page is reachable only by typing the URL — it isn't linked
// from the nav, so a fresh account never stumbles onto it.
test('the insights page is not linked from the app nav', async ({ page }) => {
  await login(page, uniqEmail('insights-hidden'));
  await expect(page.locator('#tabs a[href="/insights"]')).toHaveCount(0);
});

test('insights shows an empty state before anything is rated', async ({ page }) => {
  await login(page, uniqEmail('insights-empty'));
  await page.goto('/insights');
  await expect(page.getByRole('heading', { name: /what the algorithm learned/i })).toBeVisible();
  await expect(page.locator('.empty')).toContainText(/rate some films/i);
});

test('insights renders the learned weights once a user has rated films', async ({ page }) => {
  await login(page, uniqEmail('insights-full'));
  await seedVariedRatings(page);
  await page.goto('/insights');

  // Headline stats reflect the seeded ratings…
  await expect(page.locator('.stats .stat').first()).toContainText('6');
  // …and the learned feature weights render as labelled categories with bars.
  await expect(page.locator('.cat h3').first()).toBeVisible();
  await expect(page.locator('.feat .bar').first()).toBeVisible();
  // The scoring knobs are exposed too.
  await expect(page.locator('table.knobs')).toContainText('BETA_NEG');
});
