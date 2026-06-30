import { test, expect } from '@playwright/test';

// Every dropdown in a toolbar (.bar) must share the one dark control style, so a
// newly-added select can't ship looking like a raw browser default — the failure
// this guards against. We compare the new type selects' computed appearance to a
// long-standing sibling (#genre-filter). Driven in a real browser since the rule
// is CSS the stylesheet must actually apply.

test('the new type selects match the existing toolbar select style', async ({ page }) => {
  await page.goto('/'); // loads the real styles.css; no login needed to read styles

  const s = await page.evaluate(() => {
    const style = (sel) => {
      const c = getComputedStyle(document.querySelector(sel));
      return {
        background: c.backgroundColor,
        border: `${c.borderTopWidth} ${c.borderTopStyle} ${c.borderTopColor}`,
        radius: c.borderTopLeftRadius,
        padding: `${c.paddingTop} ${c.paddingLeft}`,
      };
    };
    return {
      ref: style('#genre-filter'),       // the established toolbar select
      discoverType: style('#type-filter'),
      watchlistType: style('#watchlist-type'),
    };
  });

  // A styled select isn't transparent — proves the rule applied, not a default.
  expect(s.ref.background).not.toBe('rgba(0, 0, 0, 0)');
  expect(s.discoverType).toEqual(s.ref);
  expect(s.watchlistType).toEqual(s.ref);
});
