import { test, expect } from '@playwright/test';

// Regression: on iPad Safari the optional sign-in overlay opened *under* the app
// content instead of on top of it, so its buttons were unclickable. Runs on the
// webkit-ipad project (see playwright.config.js) which reproduces the iOS
// stacking behaviour desktop Chromium hides.
test.describe('sign-in overlay stacking', () => {
  // Open the sign-in overlay from the first-run onboarding screen's "Already have
  // an account? Sign in" link — the start-screen path where the overlay opened
  // *under* the still-visible onboarding card.
  async function openLogin(page) {
    await page.goto('/');
    await expect(page.locator('#onboarding')).toBeVisible();
    await page.locator('#ob-signin').click();
    await expect(page.locator('#login')).toBeVisible();
  }

  test('the overlay paints above the app and its buttons are on top', async ({ page }) => {
    await openLogin(page);

    // The Google button must be the topmost element at its own centre — if the
    // overlay pops under, elementFromPoint returns app content behind it.
    const onTop = await page.evaluate(() => {
      const btn = document.querySelector('#login-buttons a.google');
      const r = btn.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { covered: !hit || !btn.contains(hit) && hit !== btn, hitId: hit?.closest('[id]')?.id };
    });
    expect(onTop.covered, `sign-in button is covered by #${onTop.hitId}`).toBe(false);
  });

  test('the sign-in button is actually clickable (not obscured)', async ({ page }) => {
    await openLogin(page);
    // Playwright's actionability check fails if the target is covered by another
    // element — a trial click asserts the overlay genuinely receives the tap.
    await page.locator('#login-buttons a.google').click({ trial: true });
  });
});
