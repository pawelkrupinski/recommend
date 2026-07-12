import { test, expect } from '@playwright/test';
import { login, uniqEmail } from './helpers.js';

// While the picks are still building, the Discover status line ("Building your
// picks…") reads yellow to signal work in progress. We hold the /api/recommend
// response open so the building state stays on screen long enough to measure,
// then assert both the text and its computed colour (the accent yellow). Once
// the picks land the line reverts to the default-coloured summary.
test('the "Building your picks…" status line is yellow while building', async ({ page }) => {
  await login(page, uniqEmail('building-yellow'));

  // Seed a picks-ready account: a stub provider plus enough ratings to pass the
  // rate goal, so Discover goes straight to personalized picks (and the
  // "Building your picks…" message) rather than the onboarding queue.
  await page.evaluate(async () => {
    await fetch('/api/settings', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ providers: [8] }) });
    for (let i = 0; i < 10; i++) {
      await fetch('/api/ratings', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tmdb_id: 900 + i, rating: 8, title: `Seed ${i}`, year: 2020 }) });
    }
  });

  // Hold the recommend build open so the building state is observable.
  let release;
  const held = new Promise((r) => { release = r; });
  await page.route('**/api/recommend*', async (route) => { await held; await route.continue(); });

  await page.goto('/discover');

  const info = page.locator('#discover-info');
  await expect(info).toHaveText('Building your picks…');
  const colour = await info.evaluate((el) => getComputedStyle(el).color);
  expect(colour).toBe('rgb(245, 197, 24)'); // --accent, the yellow

  // Let the build finish: the line settles into the picks summary, no longer yellow.
  release();
  await expect(info).toContainText('picks from a taste profile');
  const settled = await info.evaluate((el) => getComputedStyle(el).color);
  expect(settled).not.toBe('rgb(245, 197, 24)');
});
