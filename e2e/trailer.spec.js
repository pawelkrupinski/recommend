import { test, expect } from '@playwright/test';
import { login, uniqEmail, enterPicks } from './helpers.js';

test('a Discover pick popup embeds the YouTube trailer in the user language', async ({ page }) => {
  await login(page, uniqEmail('trailer'));
  await enterPicks(page);

  // Open the where-to-watch popup from a Discover card (poster tap).
  const card = page.locator('#recs .card').first();
  const id = await card.getAttribute('data-id');
  await card.locator('img').first().click(); // the poster (a service-icon img also lives in the card)
  await expect(page.locator('#modal')).toBeVisible();

  // The trailer plays inline as a YouTube embed. The default language is English,
  // so the stub's English trailer (yt-en-<id>) is the one selected server-side.
  const embed = page.locator('#modal-body .trailer-embed');
  await expect(embed).toBeVisible();
  await expect(embed).toHaveAttribute('src', new RegExp(`youtube-nocookie\\.com/embed/yt-en-${id}`));
});
