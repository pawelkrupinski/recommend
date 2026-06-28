import { test, expect } from '@playwright/test';
import { login, uniqEmail } from './helpers.js';

async function openSettings(page) {
  await page.locator('#tabs a[data-tab="settings"]').click();
  await expect(page.locator('#settings')).toHaveClass(/active/);
}

test('settings shows streaming services, no admin or API-key blocks', async ({ page }) => {
  await login(page, uniqEmail('plain'));
  await openSettings(page);
  await expect(page.locator('#country')).toBeVisible();
  // API keys and user management were removed from the app entirely.
  await expect(page.locator('#admin-keys')).toHaveCount(0);
  await expect(page.locator('#admin-users')).toHaveCount(0);
});

test('toggling a streaming service saves on change and persists across a reload', async ({ page }) => {
  await login(page, uniqEmail('services'));
  await openSettings(page);
  // No save button — there isn't one any more; each toggle persists itself.
  await expect(page.locator('#save-providers')).toHaveCount(0);

  const prov = page.locator('#provider-list .prov:not(.disabled)').first();
  await expect(prov).toBeVisible({ timeout: 10_000 });
  const wasOn = await prov.evaluate((e) => e.classList.contains('on'));

  // The click must fire a settings POST without any further action.
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/settings') && r.request().method() === 'POST'),
    prov.click(),
  ]);
  const nowOn = !wasOn;
  await expect(prov).toHaveClass(nowOn ? /\bon\b/ : /^(?!.*\bon\b)/);

  await page.reload();
  await openSettings(page);
  const same = page.locator('#provider-list .prov:not(.disabled)').first();
  await expect(same).toBeVisible({ timeout: 10_000 });
  await expect(same).toHaveClass(nowOn ? /\bon\b/ : /^(?!.*\bon\b)/);
});

test('changing country persists across a reload', async ({ page }) => {
  await login(page, uniqEmail('country'));
  await openSettings(page);
  await page.locator('#country').selectOption('US');
  await expect(page.locator('#country')).toHaveValue('US');

  await page.reload();
  await openSettings(page);
  await expect(page.locator('#country')).toHaveValue('US');
});

test('settings survives a cold-start 503 on /api/settings', async ({ page }) => {
  // Render's free tier returns gateway 5xx for the first requests after a
  // spin-down wake. A blip on the Settings GET must not leave the country
  // dropdown empty ("not chosen") with no services — api() retries idempotent
  // GETs, so the page recovers without a manual reload.
  await login(page, uniqEmail('cold'));
  let hits = 0;
  await page.route('**/api/settings', (route) => {
    if (route.request().method() === 'GET' && hits++ === 0) {
      return route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
    }
    return route.continue();
  });
  await page.goto('/settings');
  await expect(page.locator('#settings')).toHaveClass(/active/);
  await expect(page.locator('#country')).not.toHaveValue('');
  await expect(page.locator('#provider-list .prov').first()).toBeVisible({ timeout: 10_000 });
});

test('deleting the account drops to a fresh anonymous session', async ({ page }) => {
  await login(page, uniqEmail('doomed'));
  await openSettings(page);
  // The delete button asks for confirmation via a native dialog — accept it.
  page.on('dialog', (d) => d.accept());
  await page.locator('#delete-account').click();
  // The account is gone and we reload into a brand-new anonymous session, which
  // (being un-onboarded) lands on onboarding rather than any login gate.
  await expect(page.locator('#onboarding')).toBeVisible();
  await expect(page.locator('#app')).toBeHidden();
});
