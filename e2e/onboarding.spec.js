import { test, expect } from '@playwright/test';
import { login, uniqEmail } from './helpers.js';

test('first-run onboarding: pick a service, then enter the app', async ({ page }) => {
  await login(page, uniqEmail('onboard'), { onboarded: false });

  // The onboarding provider list is populated from the (stubbed) picker.
  const providers = page.locator('#ob-provider-list .prov');
  await expect(providers.first()).toBeVisible();
  await expect(page.locator('#ob-provider-list')).toContainText('Netflix Test');

  // Choose the first matchable service and continue.
  await page.locator('#ob-provider-list .prov:not(.disabled)').first().click();
  await page.locator('#ob-continue').click();

  await expect(page.locator('#onboarding')).toBeHidden();
  await expect(page.locator('#app')).toBeVisible();
});
