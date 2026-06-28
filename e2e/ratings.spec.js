import { test, expect } from '@playwright/test';
import { login, uniqEmail } from './helpers.js';

test('a rated title appears in "My ratings" and can be deleted', async ({ page }) => {
  await login(page, uniqEmail('myratings'));

  // Rate a title from the Discover onboarding queue (a fresh account starts
  // here, with popular titles to rate before personalized picks kick in).
  const target = '#recs .card:has(.title:text-is("Stub Popular Five"))';
  await expect(page.locator(target)).toBeVisible();
  await page.locator(`${target} .stars span[data-n="9"]`).click();
  await expect(page.locator(target)).toHaveCount(0);

  // It shows up under My ratings with the score.
  await page.locator('#tabs button[data-tab="ratings"]').click();
  const row = page.locator('#ratings-list .rrow', { hasText: 'Stub Popular Five' });
  await expect(row).toBeVisible();
  await expect(row.locator('.r')).toHaveText('9');
  await expect(page.locator('#ratings-count')).toContainText('1 rated');

  // Delete it and the list empties.
  await row.locator('.del').click();
  await expect(page.locator('#ratings-list')).toContainText('No ratings yet');
});
