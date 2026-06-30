// Unit tests for the pure helpers in src/ratings.js: the Metacritic slug builder
// and the JSON-LD Metascore parser. No network — these never call fetch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDbEnv, readFixture } from '../helpers/env.js';

freshDbEnv();
const { slugify, foldTitle, parseMetascore, parseMetacriticPage, metacriticMatches } =
  await import('../../src/ratings.js');

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

test('foldTitle folds accents/ł and reduces to a comparable form; slugify hyphenates it', () => {
  assert.equal(foldTitle('Amélie'), 'amelie');
  assert.equal(foldTitle('Pokłosie'), 'poklosie');
  assert.equal(foldTitle("Schindler's List"), 'schindlers list');
  assert.equal(slugify("Schindler's List"), 'schindlers-list'); // unchanged behaviour
});

test('parseMetacriticPage pulls the score plus the verifiable name + year', () => {
  const page = parseMetacriticPage(readFixture('metacritic-the-matrix.html'));
  assert.deepEqual(page, { score: 73, name: 'The Matrix', year: 1999 });
});

test('parseMetacriticPage is null when the page carries no Metascore', () => {
  assert.equal(parseMetacriticPage('<html><body>nothing</body></html>'), null);
});

test('metacriticMatches accepts the right film and REJECTS a slug collision', () => {
  const page = { score: 73, name: 'The Matrix', year: 1999 };
  assert.equal(metacriticMatches(page, 'The Matrix', 1999), true);
  assert.equal(metacriticMatches(page, 'The Matrix', null), true, 'name match alone passes when year unknown');
  // A remake/reissue whose slug collides: same name, wrong year → no borrowed score.
  assert.equal(metacriticMatches(page, 'The Matrix', 2030), false);
  // A different film whose slug happened to resolve → name mismatch rejects it.
  assert.equal(metacriticMatches({ score: 80, name: 'The Matrix Reloaded', year: 2003 }, 'The Matrix', 1999), false);
});
