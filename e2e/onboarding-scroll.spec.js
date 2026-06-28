import { test, expect } from '@playwright/test';
import { login, uniqEmail } from './helpers.js';

// On a small phone (e.g. Samsung S24) the onboarding card — language + country
// selects plus the full Movie of the Night service grid (PL alone has ~20
// services) — is taller than the viewport. The .login overlay centres its card
// with `align-items: center` and never scrolls, so a too-tall card is clipped at
// both ends with no way to reach the Continue button. This drives the real
// stylesheet in a real (short) viewport and asserts the button is reachable.

test('onboarding card scrolls so Continue stays reachable on a short viewport', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 600 });
  await login(page, uniqEmail('onboard-scroll'), { onboarded: false });
  await expect(page.locator('#ob-provider-list .prov').first()).toBeVisible();

  // Pad the service grid so the card definitely overflows the short viewport,
  // mirroring a long country's service list on a small screen.
  await page.evaluate(() => {
    const box = document.querySelector('#ob-provider-list');
    for (let i = 0; i < 40; i++) {
      const el = document.createElement('div');
      el.className = 'prov';
      el.textContent = 'Filler service ' + i;
      box.append(el);
    }
  });

  const m = await page.evaluate(() => {
    const card = document.querySelector('.onboarding-card');
    const btn = document.querySelector('#ob-continue');
    // Bring the bottom-most control into view the way a user (or the browser)
    // would. With a non-scrollable centred overlay this is a no-op.
    btn.scrollIntoView({ block: 'end' });
    const cr = card.getBoundingClientRect();
    const br = btn.getBoundingClientRect();
    return { cardHeight: cr.height, vh: window.innerHeight, btnTop: br.top, btnBottom: br.bottom };
  });

  // Sanity: the card really is taller than the viewport, so scrolling matters.
  expect(m.cardHeight).toBeGreaterThan(m.vh);
  // The Continue button must end up fully inside the viewport once scrolled to.
  expect(m.btnTop).toBeGreaterThanOrEqual(0);
  expect(m.btnBottom).toBeLessThanOrEqual(m.vh + 1);
});
