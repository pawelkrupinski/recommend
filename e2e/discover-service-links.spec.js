import { test, expect } from '@playwright/test';
import { login, uniqEmail, enterPicks } from './helpers.js';

// Discover cards badge each pick with the chosen streaming services it's on —
// the same TMDB logo the Settings picker uses — and each icon deep-links into
// the title on that service. The stub streams every title on Netflix (id 8),
// the provider enterPicks selects, so every card carries exactly that icon.

test('each Discover card shows its chosen streaming-service icon', async ({ page }) => {
  await login(page, uniqEmail('svc-icons'));
  await enterPicks(page);

  const card = page.locator('#recs .card').first();
  const icon = card.locator('.svc-ico');
  await expect(icon).toHaveCount(1);
  await expect(icon).toHaveAttribute('title', 'Watch on Netflix Test');
  await expect(icon).toHaveAttribute('aria-label', 'Watch on Netflix Test');
  // The same logo as the Settings picker (TMDB w45 path).
  await expect(icon.locator('img')).toHaveAttribute('src', /w45\/netflix\.png$/);

  // The icon lives next to the title — on the title's row (above the year line),
  // to its right — not down below the genres.
  const titleBox = await card.locator('.title').boundingBox();
  const yearBox = await card.locator('.year').boundingBox();
  const iconBox = await icon.boundingBox();
  expect(iconBox.x, 'icon sits to the right of the title').toBeGreaterThan(titleBox.x);
  expect(iconBox.y, 'icon sits on the title row, above the year line').toBeLessThan(yearBox.y);
});

test('clicking a service icon deep-links into the title on that service', async ({ page }) => {
  await login(page, uniqEmail('svc-link'));
  await enterPicks(page);

  // The live /api/where can't reach MotN in tests; stand in a deep link tagged
  // with the icon's TMDB provider id (8) pointing at a same-origin page so the
  // navigation is observable without leaving the test server.
  await page.route('**/api/where**', (route) => route.fulfill({
    json: { tmdbLink: '/privacy', flatrate: [], deepLinks: [
      { service: 'Netflix Test', serviceId: 'netflix', type: 'subscription', link: '/privacy', providerId: 8 },
    ] },
  }));

  await page.locator('#recs .card').first().locator('.svc-ico').click();
  await page.waitForURL('**/privacy');
  expect(page.url()).toMatch(/\/privacy$/);
});

test('an unmatched service opens the where-to-watch modal, not a TMDB page', async ({ page }) => {
  await login(page, uniqEmail('svc-nomatch'));
  await enterPicks(page);

  // MotN has no deep link that matches the card's Netflix icon. The click must
  // NOT navigate to the generic tmdbLink — it should open the modal listing the
  // real options instead, so the user is never dumped on a TMDB page.
  await page.route('**/api/where**', (route) => route.fulfill({
    json: { tmdbLink: 'https://tmdb.example/should-not-go-here', flatrate: [], deepLinks: [
      { service: 'Disney+', serviceId: 'disney', type: 'subscription', link: 'https://disney/x', providerId: 337 },
    ] },
  }));

  await page.locator('#recs .card').first().locator('.svc-ico').click();
  await expect(page.locator('#modal')).toBeVisible();
  // Stayed in the app — no navigation to the TMDB fallback.
  expect(page.url()).toMatch(/#discover/);
});
