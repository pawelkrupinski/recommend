import { test, expect } from '@playwright/test';
import { login, uniqEmail, enterPicks } from './helpers.js';

// The where-to-watch popup must advertise only the streaming services the user
// chose in Settings — never a provider they don't subscribe to. enterPicks picks
// Netflix (id 8), the one service the stub streams the fixture titles on, so the
// popup shows exactly that and nothing else.

test('the where-to-watch popup lists only the chosen streaming services', async ({ page }) => {
  await login(page, uniqEmail('where-chosen'));
  await enterPicks(page);

  const card = page.locator('#recs .card').first();
  // Opening the popup (poster tap) fetches /api/where. That request must fold the
  // chosen services into its cache key (sv=8) so a later Settings change busts the
  // week-long browser cache instead of serving a stale, wrongly-filtered set.
  const [req] = await Promise.all([
    page.waitForRequest('**/api/where**'),
    card.locator('img').first().click(),
  ]);
  expect(new URL(req.url()).searchParams.get('sv')).toBe('8');
  await expect(page.locator('#modal')).toBeVisible();

  // The popup advertises Netflix (chosen + the stub streams the title there) and
  // only Netflix — the two providers the picker also carries (Disney, Amazon) are
  // not subscribed, so they must not appear.
  const where = page.locator('#modal .where');
  await expect(where.locator('a', { hasText: 'Netflix Test' })).toHaveCount(1);
  await expect(where.locator('a', { hasText: /Disney|Amazon/ })).toHaveCount(0);
});
