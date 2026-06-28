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

test('dragging a finger over the stars previews the rating and lifting commits it', async ({ page }) => {
  await login(page, uniqEmail('touchdrag'));

  const target = '#recs .card:has(.title:text-is("Stub Popular Five"))';
  await expect(page.locator(target)).toBeVisible();
  const card = page.locator(target);

  // Simulate a touch drag from star 1 across to star 7 by dispatching real
  // TouchEvents at the on-screen centres of each star (the handler hit-tests
  // with elementFromPoint, mirroring desktop hover).
  const drag = async (fromN, toN, type) => {
    await card.locator('.stars').evaluate((box, { fromN, toN, type }) => {
      const centre = (n) => {
        const r = box.querySelector(`span[data-n="${n}"]`).getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      };
      const fire = (name, n) => {
        const { x, y } = centre(n);
        const t = new Touch({ identifier: 1, target: box, clientX: x, clientY: y });
        box.dispatchEvent(new TouchEvent(name, {
          touches: name === 'touchend' ? [] : [t], changedTouches: [t],
          bubbles: true, cancelable: true,
        }));
      };
      fire('touchstart', fromN);
      fire('touchmove', toN);
      if (type === 'commit') fire('touchend', toN);
    }, { fromN, toN, type });
  };

  // Drag without lifting: the hint reads "7 / 10" and 7 stars light up.
  await drag(1, 7, 'preview');
  await expect(card.locator('.rating-num')).toHaveText('7 / 10');
  await expect(card.locator('.stars span.on')).toHaveCount(7);

  // Lift the finger: the rating is committed and the card leaves Discover.
  await drag(1, 7, 'commit');
  await expect(page.locator(target)).toHaveCount(0);

  // It lands under My ratings with the dragged-to score.
  await page.locator('#tabs button[data-tab="ratings"]').click();
  const row = page.locator('#ratings-list .rrow', { hasText: 'Stub Popular Five' });
  await expect(row.locator('.r')).toHaveText('7');
});
