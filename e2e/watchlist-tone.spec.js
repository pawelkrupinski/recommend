import { test, expect } from '@playwright/test';
import { login, uniqEmail, enterPicks } from './helpers.js';

// The Watchlist tab gains a tone dropdown that lists ONLY the tones actually
// present on saved titles, and filters the cards to the chosen tone. Of the stub
// picks, only 202 ("Stub Streamable Two") carries a tone ("heartfelt"); 201 has
// none — so saving both leaves the dropdown offering exactly "Heartfelt".
test('the watchlist tone dropdown lists only present tones and filters the cards', async ({ page }) => {
  await login(page, uniqEmail('wltone'));
  await enterPicks(page);

  // Save a toned title (202) and an untoned one (201).
  await page.locator('#recs .card[data-id="202"] .watch-btn').click();
  await page.locator('#recs .card[data-id="201"] .watch-btn').click();

  await page.locator('#tabs a[data-tab="watchlist"]').click();
  await expect(page.locator('#watchlist-grid .card')).toHaveCount(2);

  // The dropdown is shown and offers exactly "All tones" + the one present tone.
  const tone = page.locator('#watchlist-tone');
  await expect(tone).toBeVisible();
  await expect(tone.locator('option')).toHaveText(['All tones', 'Heartfelt']);

  // Filtering to Heartfelt keeps only the heartfelt title (202); the count of
  // saved titles is unchanged (it's a view filter, not a delete).
  await tone.selectOption('heartfelt');
  await expect(page.locator('#watchlist-grid .card')).toHaveCount(1);
  await expect(page.locator('#watchlist-grid .card[data-id="202"]')).toBeVisible();
  await expect(page.locator('#watchlist-grid .card[data-id="201"]')).toHaveCount(0);
  await expect(page.locator('#watchlist-count')).toHaveText(/2/);

  // Back to "All tones" restores both cards.
  await tone.selectOption('');
  await expect(page.locator('#watchlist-grid .card')).toHaveCount(2);
});

test('the watchlist tone dropdown is hidden when no saved title has a tone', async ({ page }) => {
  await login(page, uniqEmail('wlnotone'));
  await enterPicks(page);
  // Save only the untoned title (201).
  await page.locator('#recs .card[data-id="201"] .watch-btn').click();
  await page.locator('#tabs a[data-tab="watchlist"]').click();
  await expect(page.locator('#watchlist-grid .card')).toHaveCount(1);
  await expect(page.locator('#watchlist-tone')).toBeHidden();
});
