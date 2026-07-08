import { test, expect } from '@playwright/test';

// The "Not interested / seen it" button lives at the bottom of every Discover
// card. Cards carry variable meta — a title of 1–2 lines, optional IMDb /
// Metacritic badges, an optional genre line — so without a fixed card height the
// button lands at a different spot on each card. Then dismissing one pick (which
// removes its card and slides the next into the same slot) shifts the button out
// from under the cursor, and you can't keep clicking it.
//
// This drives the real stylesheet in a real browser (jsdom can't compute layout,
// and the TMDB stub's Discover titles are all the same height so they wouldn't
// exercise the variance). We build two deliberately mismatched cards in the live
// #recs grid and assert the button sits at the same place on both.

test('Discover cards keep the "Not interested" button at a constant height', async ({ page }) => {
  await page.goto('/'); // loads the real styles.css; no login needed to measure layout

  const m = await page.evaluate(() => {
    // Markup mirrors recCard()/ratingRow() in public/app.js: poster, a .meta
    // block (title, year, optional .ratings badges, optional .genres) and the
    // dismiss button. `tall` toggles the long title + badges + genre line so the
    // two cards have very different natural content height.
    const cardHTML = (tall) => {
      const title = tall
        ? 'A Very Long Movie Title That Wraps Onto Several Lines And Then Some More'
        : 'Short';
      const badges = tall
        ? '<div class="ratings"><span class="rb imdb">IMDb 8.2</span><span class="rb mc good">MC 81</span></div>'
        : '';
      const genres = tall ? '<div class="genres">Action · Comedy · Drama</div>' : '';
      const stars = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => `<span data-n="${n}">★</span>`).join('');
      return `
        <div class="score">88</div>
        <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E" />
        <div class="meta">
          <div class="title">${title}</div>
          <div class="year">2020 · 1h 47m</div>
          ${badges}
          ${genres}
        </div>
        <div class="rate-stars"><div class="stars">${stars}</div><span class="rating-num"></span></div>
        <button class="skip dismiss-btn">Not interested / seen it</button>`;
    };

    // Reveal the (normally hidden-until-login) app so #recs can lay out, then
    // fill the real grid with one short and one tall card, side by side.
    document.querySelector('#app').classList.remove('hidden');
    const grid = document.querySelector('#recs');
    grid.innerHTML = '';
    for (const tall of [false, true]) {
      const el = document.createElement('div');
      el.className = 'card';
      el.innerHTML = cardHTML(tall);
      grid.append(el);
    }

    const measure = (c) => {
      const card = c.getBoundingClientRect();
      const btn = c.querySelector('.dismiss-btn').getBoundingClientRect();
      // buttonOffset = button position relative to its own card's top — the
      // offset that must match so the button stays put as cards swap slots.
      return { height: card.height, buttonOffset: btn.top - card.top };
    };
    const [short, long] = [...grid.querySelectorAll('.card')].map(measure);
    return { short, long };
  });

  // Both cards are the same height, so the grid rows never shift…
  expect(Math.abs(m.short.height - m.long.height)).toBeLessThan(1);
  // …and the dismiss button sits at the same offset on each, so it stays under
  // the cursor while you dismiss pick after pick.
  expect(Math.abs(m.short.buttonOffset - m.long.buttonOffset)).toBeLessThan(1);
});
