import { test, expect } from '@playwright/test';

// Films and TV series read as distinct types: a film card is tinted gold (the
// accent) and a TV card blue (--link), and that type colour is shared by the
// card's meta strip, its rating-stars tray and its "Not interested" bar. This
// drives the real stylesheet in a browser (jsdom can't compute styles) and
// asserts the per-type backgrounds, which were a single gold/red scheme before.

test('film and TV cards carry distinct type-coloured backgrounds', async ({ page }) => {
  await page.goto('/'); // loads the real styles.css; no login needed to measure styles

  const s = await page.evaluate(() => {
    const stars = [1, 2, 3, 4, 5].map((n) => `<span data-n="${n}">★</span>`).join('');
    const html = `
      <div class="meta"><div class="title">T</div></div>
      <div class="rate-stars"><div class="stars">${stars}</div><span class="rating-num"></span></div>
      <button class="skip dismiss-btn">Not interested / seen it</button>`;
    document.querySelector('#app').classList.remove('hidden');
    const grid = document.querySelector('#recs');
    grid.innerHTML = '';
    const make = (cls) => { const el = document.createElement('div'); el.className = cls; el.innerHTML = html; grid.append(el); return el; };
    const movie = make('card');
    const tv = make('card tv');
    const bg = (el, sel) => getComputedStyle(el.querySelector(sel)).backgroundColor;
    const read = (el) => ({ meta: bg(el, '.meta'), tray: bg(el, '.rate-stars'), skip: bg(el, '.skip') });
    return { movie: read(movie), tv: read(tv) };
  });

  const GOLD = (a) => `rgba(245, 197, 24, ${a})`;
  const BLUE = (a) => `rgba(90, 162, 255, ${a})`;

  // Films are gold across meta, stars tray and dismiss bar.
  expect(s.movie.meta).toBe(GOLD('0.05'));
  expect(s.movie.tray).toBe(GOLD('0.12'));
  expect(s.movie.skip).toBe(GOLD('0.13'));
  // TV is blue across the same three.
  expect(s.tv.meta).toBe(BLUE('0.06'));
  expect(s.tv.tray).toBe(BLUE('0.14'));
  expect(s.tv.skip).toBe(BLUE('0.13'));
  // The two types are distinct everywhere, including the shared stars/dismiss bg.
  expect(s.movie.meta).not.toBe(s.tv.meta);
  expect(s.movie.tray).not.toBe(s.tv.tray);
  expect(s.movie.skip).not.toBe(s.tv.skip);
});
