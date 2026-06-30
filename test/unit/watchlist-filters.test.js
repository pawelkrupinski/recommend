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

// Cross-language genre vocabulary (the /api/genres `byName` map covers every
// interface language) and the current-language labels (here: English).
const BY_NAME = { action: 28, akcja: 28, comedy: 35, komedia: 35, drama: 18, dramat: 18 };
const LABEL = { 28: 'Action', 35: 'Comedy', 18: 'Drama' };
const labelOf = (key) => LABEL[key];

const gItem = (id, genres) => ({ tmdb_id: id, genres });
// Mixed-language saves: item 1 in English ('Action'/'Comedy'), item 2 a Polish
// comedy ('Komedia'), item 4 a Polish action ('Akcja') — the same two genres a
// locale switch would otherwise split into four.
const gItems = [
  gItem(1, ['Action', 'Comedy']),
  gItem(2, ['Komedia']),
  gItem(3, []),               // a title with no genres
  gItem(4, ['Akcja']),
];

test('presentGenres consolidates a genre across languages by id, labelled in the current language', () => {
  assert.deepEqual(presentGenres(gItems, BY_NAME, labelOf), [
    { key: '28', label: 'Action' },   // 'Action' + 'Akcja' → id 28, one entry
    { key: '35', label: 'Comedy' },   // 'Comedy' + 'Komedia' → id 35
  ]);
});

test('presentGenres is empty when no saved title carries a genre', () => {
  assert.deepEqual(presentGenres([gItem(1, []), { tmdb_id: 2 }], BY_NAME, labelOf), []);
});

test('presentGenres falls back to the raw name for a genre outside the vocabulary', () => {
  assert.deepEqual(presentGenres([gItem(1, ['Cyberpunk'])], BY_NAME, labelOf),
    [{ key: 'Cyberpunk', label: 'Cyberpunk' }]);
});

test('filterByGenre matches by canonical id regardless of the saved language', () => {
  assert.deepEqual(filterByGenre(gItems, '28', BY_NAME).map((i) => i.tmdb_id), [1, 4], 'Action: English + Polish');
  assert.deepEqual(filterByGenre(gItems, '35', BY_NAME).map((i) => i.tmdb_id), [1, 2], 'Comedy: English + Polish');
});

test('filterByGenre returns the whole list when no genre is selected', () => {
  assert.equal(filterByGenre(gItems, '', BY_NAME), gItems, 'same reference, unfiltered');
});

// Once an item is backfilled it carries canonical `genreIds`, so consolidation
// keys on those directly — no name, no byName lookup, no language ambiguity.
const idItem = (id, genreIds) => ({ tmdb_id: id, genreIds });
const mixed = [
  idItem(1, [28, 35]),          // backfilled: Action + Comedy by id
  idItem(2, [28]),              // backfilled: Action by id
  gItem(3, ['Akcja']),          // legacy (no genreIds): Polish Action → byName → 28
];

test('presentGenres consolidates stored genreIds and legacy names onto the same canonical key', () => {
  assert.deepEqual(presentGenres(mixed, BY_NAME, labelOf), [
    { key: '28', label: 'Action' }, // ids 28 + the legacy 'Akcja' all collapse
    { key: '35', label: 'Comedy' },
  ]);
});

test('filterByGenre matches stored genreIds without needing byName at all', () => {
  // No byName passed — genreId-bearing items still resolve; the legacy name item
  // can't (no map), proving the id path is independent of the cross-language map.
  assert.deepEqual(filterByGenre(mixed, '28').map((i) => i.tmdb_id), [1, 2]);
  assert.deepEqual(filterByGenre(mixed, '28', BY_NAME).map((i) => i.tmdb_id), [1, 2, 3], 'with byName, the legacy name joins too');
});
