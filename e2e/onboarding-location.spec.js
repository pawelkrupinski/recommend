import { test, expect } from '@playwright/test';
import { login, uniqEmail } from './helpers.js';

// The onboarding location cascade + the sign-in entry point on the start screen.

test.describe('GPS grant resolves the country', () => {
  test.use({ geolocation: { latitude: 51.5, longitude: -0.12 }, permissions: ['geolocation'] });

  test('a granted GPS fix preselects its geocoded country', async ({ page }) => {
    // Reverse-geocode runs server-side; stub it so the test never leaves the box.
    await page.route('**/api/geocode**', (route) =>
      route.fulfill({ json: { country: 'GB' } }));
    await login(page, uniqEmail('geo'), { onboarded: false });
    // The card paints on a synchronous default first, then upgrades to the GPS fix.
    await expect(page.locator('#ob-country')).toHaveValue('GB');
  });
});

test.describe('locale fallback when GPS is unavailable', () => {
  test.use({ locale: 'en-GB' }); // no geolocation permission → GPS resolves to null

  test('the browser locale region preselects the country', async ({ page }) => {
    await login(page, uniqEmail('loc'), { onboarded: false });
    await expect(page.locator('#ob-country')).toHaveValue('GB');
  });
});

test.describe('a Poland region defaults the language to Polish', () => {
  test.use({ locale: 'pl-PL' });

  test('onboarding preselects PL and Polish when the region resolves to Poland', async ({ page }) => {
    await login(page, uniqEmail('pl'), { onboarded: false });
    await expect(page.locator('#ob-country')).toHaveValue('PL');
    await expect(page.locator('#ob-lang')).toHaveValue('pl');
  });
});

test('the start screen offers Sign in, which opens the provider overlay', async ({ page }) => {
  await login(page, uniqEmail('signin'), { onboarded: false });
  await expect(page.locator('#login')).toBeHidden();
  await page.locator('#ob-signin').click();
  await expect(page.locator('#login')).toBeVisible();
  // The e2e server enables a dummy Google provider (see playwright.config.js).
  await expect(page.locator('#login-buttons a.google')).toHaveAttribute('href', '/auth/google');
});
