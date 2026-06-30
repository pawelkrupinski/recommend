// TV series surface in Discover alongside films: a series card shows its season
// count where a film shows runtime, and rating it sends media_type:'tv' (so the
// right title is recorded and excluded). Drives the real app over the TMDB stub,
// whose series stream on provider 350 (see src/tmdb-stub.js).
import { test, expect } from '@playwright/test';
import { login, uniqEmail } from './helpers.js';

// Like enterPicks(), but subscribes to the TV test provider too so the mixed
// movie+TV feed is built.
async function enterMixedPicks(page) {
  await page.evaluate(async () => {
    await fetch('/api/settings', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ providers: [8, 350] }) });
    for (let i = 0; i < 10; i++) {
      await fetch('/api/ratings', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tmdb_id: 900 + i, rating: 8, title: `Seed ${i}`, year: 2020 }) });
    }
  });
  await page.goto('/discover');
  await expect(page.locator('#recs .card').first()).toBeVisible({ timeout: 20_000 });
}

test('a TV pick renders its season COUNT (not the raw seasons array) and is visually tagged', async ({ page }) => {
  await login(page, uniqEmail('tv'));
  await enterMixedPicks(page);

  const series = page.locator('#recs .card[data-key^="tv:"]').first();
  await expect(series).toBeVisible();
  // A film's slot here is its runtime ("1h 47m"); a series shows its season count.
  // The stub series has 3 seasons — assert the COUNT renders, and explicitly that
  // the per-season array didn't leak through as "[object Object]" (the bug).
  await expect(series.locator('.year')).toContainText('3 seasons');
  await expect(series.locator('.year')).not.toContainText('[object Object]');
  await expect(series.locator('.title')).toContainText('Stub Series');
  // Visual distinction from films: the series tint class + the "Series" tag.
  await expect(series).toHaveClass(/\btv\b/);
  await expect(series.locator('.type-tag')).toBeVisible();
  // A movie card carries neither the tint class nor the tag.
  const film = page.locator('#recs .card[data-key^="movie:"]').first();
  await expect(film).not.toHaveClass(/\btv\b/);
  await expect(film.locator('.type-tag')).toHaveCount(0);
});

test('rating a TV pick sends media_type:tv and removes the card', async ({ page }) => {
  await login(page, uniqEmail('tv'));
  await enterMixedPicks(page);

  const series = page.locator('#recs .card[data-key^="tv:"]').first();
  await expect(series).toBeVisible();
  const key = await series.getAttribute('data-key');

  const rated = page.waitForRequest((r) =>
    r.url().includes('/api/ratings') && r.method() === 'POST'
    && (r.postData() || '').includes('"media_type":"tv"'));
  await series.locator('.stars span[data-n="9"]').click();
  await rated; // the POST carried media_type:'tv' — the series, not a same-id film

  // Optimistic UI: that exact series leaves the grid immediately (and the
  // exclusion key keeps it from being refilled back in).
  await expect(page.locator(`#recs .card[data-key="${key}"]`)).toHaveCount(0);
});
