import { test, expect } from '@playwright/test';

// The rating stars and the "Not interested" button used to blend into the card
// (no background behind the stars; the button shared the card's panel tone).
// They're now visually distinct: the stars sit in a recessed --bg tray with
// per-star cells, and the dismiss button is its own recessed --bg bar. This
// drives the real stylesheet in a browser (jsdom can't compute styles) and
// asserts the computed backgrounds, which were transparent / panel-toned before.

test('the rating stars and dismiss button have distinct backgrounds', async ({ page }) => {
  await page.goto('/'); // loads the real styles.css; no login needed to measure styles

  const s = await page.evaluate(() => {
    // Minimal card mirroring ratingRow() in public/app.js: the stars tray and the
    // dismiss button, dropped into the live #recs grid so the real CSS applies.
    const stars = [1, 2, 3, 4, 5].map((n) => `<span data-n="${n}">★</span>`).join('');
    document.querySelector('#app').classList.remove('hidden');
    const grid = document.querySelector('#recs');
    grid.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div class="rate-stars"><div class="stars">${stars}</div><span class="rating-num"></span></div>
      <button class="skip dismiss-btn">Not interested / seen it</button>`;
    grid.append(card);

    const bg = (sel) => getComputedStyle(card.querySelector(sel)).backgroundColor;
    const tray = card.querySelector('.rate-stars');
    return {
      trayBg: bg('.rate-stars'),
      trayBorder: getComputedStyle(tray).borderTopWidth,
      starBg: bg('.stars span'),
      skipBg: bg('.skip'),
    };
  });

  const GOLD = 'rgba(245, 197, 24, 0.12)'; // accent-tinted stars tray
  const RED = 'rgba(248, 113, 113, 0.14)'; // --bad-tinted dismiss bar
  const TRANSPARENT = 'rgba(0, 0, 0, 0)';

  // The stars sit in a gold-tinted tray with a border.
  expect(s.trayBg).toBe(GOLD);
  expect(s.trayBorder).not.toBe('0px');
  // Each star carries its own cell background (was transparent).
  expect(s.starBg).not.toBe(TRANSPARENT);
  // The dismiss button is red-tinted — a distinct colour from the gold tray.
  expect(s.skipBg).toBe(RED);
  expect(s.skipBg).not.toBe(s.trayBg);
});
