import { test, expect } from '@playwright/test';
import { login, uniqEmail } from './helpers.js';

// Open the Rate tab and wait for the (stubbed) popular titles to load.
async function openRateTab(page) {
  await page.locator('#tabs button[data-tab="rate"]').click();
  await expect(page.locator('#rate-grid .card').first()).toBeVisible();
}

const card = (title) => `#rate-grid .card:has(.title:text-is("${title}"))`;

test('rating a title removes it and it does not return after reload', async ({ page }) => {
  await login(page, uniqEmail('rate'));
  await openRateTab(page);

  await expect(page.locator(card('Stub Popular One'))).toBeVisible();
  // Click the 8/10 star — the handler rates it and drops the card.
  await page.locator(`${card('Stub Popular One')} .stars span[data-n="8"]`).click();
  await expect(page.locator(card('Stub Popular One'))).toHaveCount(0);

  await page.reload();
  await openRateTab(page);
  // The rated title must stay gone; untouched ones are still offered.
  await expect(page.locator(card('Stub Popular One'))).toHaveCount(0);
  await expect(page.locator(card('Stub Popular Two'))).toBeVisible();
});

test('dismissing a title via the where-to-watch modal keeps it out of the queue', async ({ page }) => {
  // This is the regression for the reported bug: dismissed titles used to come
  // back on reload because the rate queue never consulted the dismissed table.
  await login(page, uniqEmail('dismiss'));
  await openRateTab(page);

  await page.locator(`${card('Stub Popular Three')} img`).click();
  await expect(page.locator('#modal')).toBeVisible();
  await page.locator('#modal #dismiss').click();
  await expect(page.locator('#modal')).toBeHidden();

  await page.reload();
  await openRateTab(page);
  await expect(page.locator(card('Stub Popular Three'))).toHaveCount(0);
});

test('"Haven\'t seen" removes a title from the queue for good', async ({ page }) => {
  await login(page, uniqEmail('notseen'));
  await openRateTab(page);

  await page.locator(`${card('Stub Popular Four')} .skip`).click();
  await expect(page.locator(card('Stub Popular Four'))).toHaveCount(0);

  await page.reload();
  await openRateTab(page);
  await expect(page.locator(card('Stub Popular Four'))).toHaveCount(0);
});
