import { test, expect } from '@playwright/test';
import { login, uniqEmail, enterPicks } from './helpers.js';

// The Watchlist tab gains a genre ("category") dropdown that lists ONLY the
// genres actually present on saved titles, and filters the cards to the chosen
// one. Of the stub picks, 201 ("Stub Streamable One") is Action and 202 ("Stub
// Streamable Two") is Comedy — so saving both offers exactly "Action" + "Comedy".
test('the watchlist genre dropdown lists only present genres and filters the cards', async ({ page }) => {
  await login(page, uniqEmail('wlgenre'));
  await enterPicks(page);

  // Save an Action title (201) and a Comedy one (202).
  await page.locator('#recs .card[data-id="201"] .watch-btn').click();
  await page.locator('#recs .card[data-id="202"] .watch-btn').click();

  await page.locator('#tabs a[data-tab="watchlist"]').click();
  await expect(page.locator('#watchlist-grid .card')).toHaveCount(2);

  // The dropdown is shown and offers exactly "All genres" + the two present genres (A→Z).
  const genre = page.locator('#watchlist-genre');
  await expect(genre).toBeVisible();
  await expect(genre.locator('option')).toHaveText(['All genres', 'Action', 'Comedy']);

  // Filtering to Action keeps only the Action title (201); the saved count is
  // unchanged (it's a view filter, not a delete).
  await genre.selectOption('Action');
  await expect(page.locator('#watchlist-grid .card')).toHaveCount(1);
  await expect(page.locator('#watchlist-grid .card[data-id="201"]')).toBeVisible();
  await expect(page.locator('#watchlist-grid .card[data-id="202"]')).toHaveCount(0);
  await expect(page.locator('#watchlist-count')).toHaveText(/2/);

  // Back to "All genres" restores both cards.
  await genre.selectOption('');
  await expect(page.locator('#watchlist-grid .card')).toHaveCount(2);
});

// Every film carries a genre, so a lone genre is shared by all saved titles and
// filtering would be a no-op — the dropdown hides below two distinct genres. Stub
// picks 201 and 203 are both Action, so saving them leaves nothing to filter.
test('the watchlist genre dropdown is hidden when saved titles share one genre', async ({ page }) => {
  await login(page, uniqEmail('wlonegenre'));
  await enterPicks(page);
  await page.locator('#recs .card[data-id="201"] .watch-btn').click();
  await page.locator('#recs .card[data-id="203"] .watch-btn').click();
  await page.locator('#tabs a[data-tab="watchlist"]').click();
  await expect(page.locator('#watchlist-grid .card')).toHaveCount(2);
  await expect(page.locator('#watchlist-genre')).toBeHidden();
});

// The genre dropdown must look identical to its neighbours, not fall back to the
// browser's default <select> chrome. The watchlist selects are styled by an
// id-list rule (panel background + 1px line border), so a new control is only
// styled if it's added to that list — assert it matches the tone select's
// computed background and border rather than a bare native widget.
test('the watchlist genre dropdown is styled the same as the tone dropdown', async ({ page }) => {
  await login(page, uniqEmail('wlgenrestyle'));
  await enterPicks(page);
  await page.locator('#recs .card[data-id="201"] .watch-btn').click(); // Action
  await page.locator('#recs .card[data-id="202"] .watch-btn').click(); // Comedy
  await page.locator('#tabs a[data-tab="watchlist"]').click();

  const styleOf = (sel) => page.locator(sel).evaluate((el) => {
    const s = getComputedStyle(el);
    return { background: s.backgroundColor, border: `${s.borderWidth} ${s.borderStyle} ${s.borderColor}` };
  });
  const [genre, tone] = await Promise.all([styleOf('#watchlist-genre'), styleOf('#watchlist-tone')]);

  expect(genre.background).toBe(tone.background);
  expect(genre.border).toBe(tone.border);
});

// Saved cards keep genre NAMES localized to the language they were saved under, so
// a title saved in Polish carries 'Akcja' where an English one carries 'Action'.
// The dropdown must treat those as ONE genre (same TMDB id) — labelled in the
// current language — not split them in two. We seed the watchlist directly with
// mixed-language genres (the POST stores client-provided card fields) to stage
// exactly that without a locale round-trip.
test('the watchlist genre dropdown consolidates the same genre saved in different languages', async ({ page }) => {
  await login(page, uniqEmail('wlgenrei18n'));
  await page.evaluate(async () => {
    const save = (tmdb_id, title, genres) => fetch('/api/watchlist', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tmdb_id, title, genres }),
    });
    await save(201, 'Saved In English', ['Action']);  // English label
    await save(203, 'Zapisane Po Polsku', ['Akcja']); // Polish label, SAME genre (id 28)
    await save(202, 'A Comedy', ['Comedy']);          // a second, distinct genre
  });

  await page.locator('#tabs a[data-tab="watchlist"]').click();
  await expect(page.locator('#watchlist-grid .card')).toHaveCount(3);

  // Two canonical genres, labelled in the current language (English) — 'Akcja' is
  // folded into 'Action', NOT listed separately.
  const genre = page.locator('#watchlist-genre');
  await expect(genre.locator('option')).toHaveText(['All genres', 'Action', 'Comedy']);

  // Filtering Action (canonical id 28) keeps BOTH the English- and Polish-saved
  // action titles — the consolidation the whole change is for.
  await genre.selectOption({ label: 'Action' });
  await expect(page.locator('#watchlist-grid .card')).toHaveCount(2);
  await expect(page.locator('#watchlist-grid .card[data-id="201"]')).toBeVisible();
  await expect(page.locator('#watchlist-grid .card[data-id="203"]')).toBeVisible();
  await expect(page.locator('#watchlist-grid .card[data-id="202"]')).toHaveCount(0);
});

// The genre line ON the card must show the CURRENT language too, not the language
// the title was saved under — otherwise an English user sees 'Akcja' on a card they
// saved during a Polish session. Resolved from canonical genreIds (or the stored
// name via byName) through the current-language vocabulary.
test('a card saved with Polish genres shows the genre line in the current language', async ({ page }) => {
  await login(page, uniqEmail('wlcardgenre'));
  await page.evaluate(async () => {
    const save = (tmdb_id, title, body) => fetch('/api/watchlist', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tmdb_id, title, ...body }),
    });
    // Backfilled card: Polish display names but canonical ids alongside.
    await save(201, 'Backfilled', { genres: ['Akcja'], genreIds: [28] });
    // Legacy card: Polish name only, no ids (resolved via byName).
    await save(202, 'Legacy', { genres: ['Komedia'] });
  });

  await page.locator('#tabs a[data-tab="watchlist"]').click();
  await expect(page.locator('#watchlist-grid .card')).toHaveCount(2);
  // English labels on both cards, NOT the stored Polish 'Akcja'/'Komedia'.
  await expect(page.locator('#watchlist-grid .card[data-id="201"] .genres')).toHaveText('Action');
  await expect(page.locator('#watchlist-grid .card[data-id="202"] .genres')).toHaveText('Comedy');
});
