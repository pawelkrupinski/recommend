import { test, expect } from '@playwright/test';
import { login, uniqEmail, enterPicks } from './helpers.js';

// Tone tags ("heartfelt", "deadpan"…) layer mood onto the structured genres.
// The Discover bar gains a tone dropdown, and the detail popup shows a
// title's tones as chips that link to Discover filtered to that tone. Of the
// stub picks (201/202/203/301) only 202 ("Stub Streamable Two") carries the
// keyword that resolves to the "heartfelt" tone (see tmdb-stub.js).

test('the tone filter narrows the picks live and survives a reload', async ({ page }) => {
  await login(page, uniqEmail('tonefilter'));
  await enterPicks(page);

  await expect(page.locator('#recs .card')).toHaveCount(4);
  const tone = page.locator('#tag-filter');
  await expect(tone).toBeVisible();

  // Pick a tone from the dropdown (change fires, rewriting the URL).
  await tone.selectOption('heartfelt');
  await expect(page).toHaveURL(/tag=heartfelt/);
  await expect(page.locator('#recs .card')).toHaveCount(1, { timeout: 20_000 });
  await expect(page.locator('#recs .card')).toContainText('Stub Streamable Two');

  // The choice lives in the URL, so a reload restores both the dropdown and the filter.
  await page.reload();
  await expect(page.locator('#tag-filter')).toHaveValue('heartfelt');
  await expect(page.locator('#recs .card')).toHaveCount(1, { timeout: 20_000 });

  // Back to "Any tone" returns to the full set of picks.
  await page.locator('#tag-filter').selectOption('');
  await expect(page).toHaveURL(/\/discover(\?|$)/);
  await expect(page.locator('#recs .card')).toHaveCount(4, { timeout: 20_000 });
});

test('the detail popup shows tone chips that link to the filtered Discover view', async ({ page }) => {
  await login(page, uniqEmail('tonechips'));
  await enterPicks(page);

  // Open the popup for title 202 — the one with a tone.
  await page.locator('#recs .card[data-id="202"] > img').click();
  const chip = page.locator('#modal-body .tone-tag', { hasText: 'Heartfelt' });
  await expect(chip).toBeVisible();
  await expect(chip).toHaveAttribute('href', /\/discover\?tag=heartfelt/);

  // A plain click filters Discover to that tone in-app: modal closes, URL + grid update.
  await chip.click();
  await expect(page.locator('#modal')).toBeHidden();
  await expect(page).toHaveURL(/tag=heartfelt/);
  await expect(page.locator('#recs .card')).toHaveCount(1, { timeout: 20_000 });
  await expect(page.locator('#tag-filter')).toHaveValue('heartfelt');
});

test('the tone filter shares the dark filter-bar styling', async ({ page }) => {
  await login(page, uniqEmail('tonestyle'));
  await enterPicks(page);
  const bgOf = (sel) => page.locator(sel).evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(await bgOf('#tag-filter')).toBe(await bgOf('#genre-filter'));
  expect(await bgOf('#tag-filter')).toBe('rgb(31, 36, 45)'); // var(--panel2)
});
