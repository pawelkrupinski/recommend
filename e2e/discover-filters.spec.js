import { test, expect } from '@playwright/test';
import { login, uniqEmail, enterPicks } from './helpers.js';

// The origin dropdown (continents + countries in one list) and the Non-US /
// Indie toggles live on the Discover bar and filter the picks live, like the
// genre filter. The stub picks span the axes: 201 US/major, 202 FR/indie,
// 203 JP/indie, plus trending-only 301 US/major (see tmdb-stub.js).
test('origin dropdown and toggles filter the Discover picks live', async ({ page }) => {
  await login(page, uniqEmail('discfilter'));
  await enterPicks(page);

  // All four stub picks show, and the controls are present in picks mode.
  await expect(page.locator('#recs .card')).toHaveCount(4);
  await expect(page.locator('#origin-filter')).toBeVisible();
  await expect(page.locator('#exclude-us')).toBeVisible();
  await expect(page.locator('#indie')).toBeVisible();

  // Pick France (a country value) — only the French stub title remains, and the
  // choice is reflected in the URL so it survives refresh/back-forward.
  await page.locator('#origin-filter').selectOption('k:FR');
  await expect(page).toHaveURL(/origin=k%3AFR/);
  await expect(page.locator('#recs .card')).toHaveCount(1, { timeout: 20_000 });
  await expect(page.locator('#recs .card')).toContainText('Stub Streamable Two');

  // Back to any origin, then exclude US — both US/major titles (201, 301) drop,
  // the two non-US picks remain.
  await page.locator('#origin-filter').selectOption('');
  await page.locator('#exclude-us').check();
  await expect(page).toHaveURL(/excludeUs=1/);
  await expect(page.locator('#recs .card')).toHaveCount(2, { timeout: 20_000 });

  // The filter state persists across a reload (driven by the URL path's query).
  await page.reload();
  await expect(page.locator('#exclude-us')).toBeChecked();
  await expect(page.locator('#recs .card')).toHaveCount(2, { timeout: 20_000 });
});

test('the Discover filter controls share one dark, consistent style', async ({ page }) => {
  await login(page, uniqEmail('discstyle'));

  const bgOf = (sel) => page.locator(sel).evaluate((el) => getComputedStyle(el).backgroundColor);
  const genreBg = await bgOf('#genre-filter');
  const originBg = await bgOf('#origin-filter');
  // Both dropdowns share the dark panel colour rather than the browser default.
  expect(originBg).toBe(genreBg);
  expect(originBg).toBe('rgb(31, 36, 45)'); // var(--panel2)

  // The Non-US / Indie checkboxes are tinted to the app accent, not native blue.
  const accent = await page.locator('#exclude-us').evaluate((el) => getComputedStyle(el).accentColor);
  expect(accent).toBe('rgb(245, 197, 24)'); // var(--accent)
});
