import { test, expect } from '@playwright/test';
import { login, uniqEmail, enterPicks } from './helpers.js';

// The two poster-corner badges swapped sides: the match-score number now sits
// top-LEFT and the +/✓ watchlist toggle top-RIGHT. Assert their geometry (not
// just the CSS) so the layout can't silently flip back.
test('the score badge is top-left and the + watch button is top-right', async ({ page }) => {
  await login(page, uniqEmail('corners'));
  await enterPicks(page);

  const card = page.locator('#recs .card').first();
  const cardBox = await card.boundingBox();
  const scoreBox = await card.locator('.score').boundingBox();
  const watchBox = await card.locator('.watch-btn').boundingBox();

  const cardMidX = cardBox.x + cardBox.width / 2;
  // Score sits in the left half; the + button in the right half.
  expect(scoreBox.x + scoreBox.width).toBeLessThan(cardMidX);
  expect(watchBox.x).toBeGreaterThan(cardMidX);
  // And the + is to the right of the score, not overlapping it.
  expect(watchBox.x).toBeGreaterThan(scoreBox.x + scoreBox.width);
});
