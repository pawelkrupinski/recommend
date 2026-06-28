// Unit tests for the pure helpers in src/ratings.js: the Metacritic slug builder
// and the JSON-LD Metascore parser. No network — these never call fetch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDbEnv } from '../helpers/env.js';

freshDbEnv();
const { slugify, parseMetascore } = await import('../../src/ratings.js');

test('slugify lowercases, strips apostrophes and collapses separators', () => {
  assert.equal(slugify("Schindler's List"), 'schindlers-list');
  assert.equal(slugify('The Lord of the Rings: Return of the King'), 'the-lord-of-the-rings-return-of-the-king');
  assert.equal(slugify('  Spaced   Out  '), 'spaced-out');
});

test('slugify strips diacritics and the Polish ł', () => {
  assert.equal(slugify('Amélie'), 'amelie');
  assert.equal(slugify('Pokłosie'), 'poklosie');
});

test('parseMetascore prefers the bestRating-100 / Metascore block', () => {
  const html = `
    <script type="application/ld+json">${JSON.stringify({
      aggregateRating: { ratingValue: 7.8, bestRating: 10, name: 'User Score' },
    })}</script>
    <script type="application/ld+json">${JSON.stringify({
      aggregateRating: { ratingValue: 84, bestRating: 100, name: 'Metascore' },
    })}</script>`;
  assert.equal(parseMetascore(html), 84);
});

test('parseMetascore returns null when there is no aggregateRating', () => {
  assert.equal(parseMetascore('<html><body>no json-ld here</body></html>'), null);
  assert.equal(parseMetascore('<script type="application/ld+json">{ not valid json </script>'), null);
});

test('parseMetascore rounds and bounds the value', () => {
  const html = `<script type="application/ld+json">${JSON.stringify({
    aggregateRating: { ratingValue: 72.6, bestRating: 100, name: 'Metascore' },
  })}</script>`;
  assert.equal(parseMetascore(html), 73);
});
