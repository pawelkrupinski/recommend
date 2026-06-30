import { test, expect } from '@playwright/test';

// Films and TV series read as distinct types via their card background: a film
// card's meta strip is tinted blue (--link), a TV card's gold (the accent). The
// rating-stars tray and "Not interested" bar share that same tint as the meta
// above them, so the meta strip and the controls read as one continuous panel —
// blue on films, gold on TV. This drives the real stylesheet in a browser (jsdom
// can't compute styles) and asserts both the distinct per-type tint and that the
// controls match their card's meta exactly.

test('the rate-stars tray and dismiss bar share the meta tint per type', async ({ page }) => {
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

  const BLUE = (a) => `rgba(90, 162, 255, ${a})`;
  const GOLD = (a) => `rgba(245, 197, 24, ${a})`;

  // Distinct card backgrounds: films blue, TV gold.
  expect(s.movie.meta).toBe(BLUE('0.1'));
  expect(s.tv.meta).toBe(GOLD('0.1'));
  expect(s.movie.meta).not.toBe(s.tv.meta);
  // The rate-stars tray and dismiss bar match their card's meta background exactly.
  expect(s.movie.tray).toBe(s.movie.meta);
  expect(s.movie.skip).toBe(s.movie.meta);
  expect(s.tv.tray).toBe(s.tv.meta);
  expect(s.tv.skip).toBe(s.tv.meta);
});

// Stars read only through their colour — neither lit nor unlit stars carry a cell
// background of their own, so they sit straight on the blue tray without tinting
// it.
test('stars carry no cell background, lit or unlit', async ({ page }) => {
  await page.goto('/');

  const s = await page.evaluate(() => {
    document.querySelector('#app').classList.remove('hidden');
    const grid = document.querySelector('#recs');
    grid.innerHTML = '<div class="card"><div class="stars"><span class="on">★</span><span>★</span></div></div>';
    const spans = document.querySelectorAll('#recs .stars span');
    return {
      on: getComputedStyle(spans[0]).backgroundColor,
      off: getComputedStyle(spans[1]).backgroundColor,
    };
  });

  expect(s.on).toBe('rgba(0, 0, 0, 0)');
  expect(s.off).toBe('rgba(0, 0, 0, 0)');
});
