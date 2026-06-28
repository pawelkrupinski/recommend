// Unit tests for shared deep-link host normalisation (src/deeplinks.js `appLink`).
// Streaming sources (MotN, JustWatch) return web URLs that mostly double as iOS
// Universal Links / Android App Links, but a few hosts need rewriting to the one
// whose AASA actually registers the app.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appLink } from '../../src/deeplinks.js';

test('appLink normalises any *.max.com host to play.hbomax.com', () => {
  // Post-2025 rebrand reversion: play.hbomax.com is the app-link host; *.max.com
  // only 301-redirects there, and a redirect breaks the app handoff on mobile.
  assert.equal(appLink('https://max.com/movie/abc'), 'https://play.hbomax.com/movie/abc');
  assert.equal(appLink('https://www.max.com/movie/abc'), 'https://play.hbomax.com/movie/abc');
  assert.equal(appLink('https://play.max.com/movie/abc'), 'https://play.hbomax.com/movie/abc');
});

test('appLink leaves an already-correct play.hbomax.com link untouched', () => {
  const url = 'https://play.hbomax.com/movie/837c49a2-a8de-4621-b9f3-7eb412986ead';
  assert.equal(appLink(url), url);
  // Cinemax is a different brand, not HBO Max — must not be rewritten.
  assert.equal(appLink('https://www.cinemax.com/movie/x'), 'https://www.cinemax.com/movie/x');
});

test('appLink redirects Amazon shopping-domain video links to the Prime Video app', () => {
  assert.equal(
    appLink('https://www.amazon.de/gp/video/detail/B0ABCDEFGH/ref=foo'),
    'https://app.primevideo.com/detail/B0ABCDEFGH',
  );
});

test('appLink passes through a falsy link', () => {
  assert.equal(appLink(null), null);
  assert.equal(appLink(''), '');
});
