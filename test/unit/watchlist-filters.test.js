// Unit tests for the Watchlist filter helpers: presentTones/presentGenres surface
// only the values saved titles actually carry, and filterByTone/filterByGenre
// narrow the list to titles carrying the chosen one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { presentTones, filterByTone, presentGenres, filterByGenre } from '../../public/watchlist-filters.js';

const ORDER = ['heartfelt', 'deadpan', 'gritty', 'romantic'];
const item = (id, tones) => ({ tmdb_id: id, tones: tones.map((slug) => ({ slug, label: slug[0].toUpperCase() + slug.slice(1) })) });
const items = [
  item(1, ['gritty', 'heartfelt']),
  item(2, ['heartfelt']),
  item(3, []),            // a title with no tones at all
  item(4, ['romantic']),
];

test('presentTones lists only tones present, deduped, in canonical order', () => {
  assert.deepEqual(presentTones(items, ORDER), [
    { slug: 'heartfelt', label: 'Heartfelt' },
    { slug: 'gritty', label: 'Gritty' },
    { slug: 'romantic', label: 'Romantic' },
  ], 'deadpan absent (no title has it); the rest ordered by ORDER');
});

test('presentTones is empty when no saved title carries a tone', () => {
  assert.deepEqual(presentTones([item(1, []), { tmdb_id: 2 }], ORDER), []);
});

test('presentTones sinks tones outside the known order to the end', () => {
  const out = presentTones([item(1, ['romantic']), item(2, ['mystery-vibe'])], ORDER);
  assert.deepEqual(out.map((t) => t.slug), ['romantic', 'mystery-vibe'], 'unknown tone last, not dropped');
});

test('filterByTone keeps only titles carrying the tone', () => {
  assert.deepEqual(filterByTone(items, 'heartfelt').map((i) => i.tmdb_id), [1, 2]);
  assert.deepEqual(filterByTone(items, 'romantic').map((i) => i.tmdb_id), [4]);
  assert.deepEqual(filterByTone(items, 'deadpan'), [], 'no match → empty');
});

test('filterByTone returns the whole list when no tone is selected', () => {
  assert.equal(filterByTone(items, ''), items, 'same reference, unfiltered');
});

const gItem = (id, genres) => ({ tmdb_id: id, genres });
const gItems = [
  gItem(1, ['Action', 'Comedy']),
  gItem(2, ['Comedy']),
  gItem(3, []),               // a title with no genres
  gItem(4, ['Drama']),
];

test('presentGenres lists distinct genres present, deduped, alphabetical', () => {
  assert.deepEqual(presentGenres(gItems), ['Action', 'Comedy', 'Drama']);
});

test('presentGenres is empty when no saved title carries a genre', () => {
  assert.deepEqual(presentGenres([gItem(1, []), { tmdb_id: 2 }]), []);
});

test('filterByGenre keeps only titles tagged with the genre', () => {
  assert.deepEqual(filterByGenre(gItems, 'Comedy').map((i) => i.tmdb_id), [1, 2]);
  assert.deepEqual(filterByGenre(gItems, 'Drama').map((i) => i.tmdb_id), [4]);
  assert.deepEqual(filterByGenre(gItems, 'Horror'), [], 'no match → empty');
});

test('filterByGenre returns the whole list when no genre is selected', () => {
  assert.equal(filterByGenre(gItems, ''), gItems, 'same reference, unfiltered');
});
