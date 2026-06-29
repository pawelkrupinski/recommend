// Unit tests for tone derivation: turning a TMDB /movie detail into its mood
// tags. The keyword→tone and tmdb-id→tone maps are injected so these don't
// depend on the harvested data files; a couple of cases also assert against the
// committed defaults (the seeded keyword 319357 → heartfelt).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toneSlugs, tonesForMovie, toneList, isTone, TONES } from '../../src/tones.js';

// A TMDB-detail-shaped movie carrying the fields tone derivation reads.
const movie = (id, keywordIds = []) => ({
  id,
  keywords: { keywords: keywordIds.map((kid) => ({ id: kid, name: `kw${kid}` })) },
});
const maps = {
  keywordMap: { 100: ['deadpan'], 101: ['heartfelt'], 102: ['heartfelt', 'romantic'] },
  netflixMap: { 700: ['gritty'], 100: ['cerebral'] },
};

test('toneSlugs maps TMDB keyword ids to tone slugs', () => {
  assert.deepEqual(toneSlugs(movie(1, [100]), maps), ['deadpan']);
  assert.deepEqual(toneSlugs(movie(1, [102]), maps).sort(), ['heartfelt', 'romantic']);
});

test('toneSlugs unions keyword-derived and Netflix-membership tones, deduped', () => {
  // id 700 has a Netflix tone (gritty) and a keyword tone (heartfelt via 101).
  assert.deepEqual(toneSlugs(movie(700, [101]), maps).sort(), ['gritty', 'heartfelt']);
  // id 100 appears in both maps; the same movie carrying keyword 100 → deadpan,
  // and being Netflix id 100 → cerebral: both, no duplicates.
  assert.deepEqual(toneSlugs(movie(100, [100]), maps).sort(), ['cerebral', 'deadpan']);
});

test('toneSlugs ignores keywords/ids with no tone and unknown slugs', () => {
  assert.deepEqual(toneSlugs(movie(1, [999]), maps), [], 'unmapped keyword → no tone');
  assert.deepEqual(toneSlugs(movie(999, []), maps), [], 'unmapped id → no tone');
  // A map pointing at a slug outside the vocabulary is dropped, not surfaced.
  assert.deepEqual(toneSlugs(movie(1, [5]), { keywordMap: { 5: ['not-a-real-tone'] } }), []);
});

test('toneSlugs tolerates a movie with no keywords block', () => {
  assert.deepEqual(toneSlugs({ id: 1 }, maps), []);
  assert.deepEqual(toneSlugs({}, maps), []);
});

test('tonesForMovie returns {slug,label} in canonical TONES order', () => {
  // 102 → heartfelt + romantic; heartfelt precedes romantic in TONES.
  const out = tonesForMovie(movie(1, [102]), maps);
  assert.deepEqual(out, [
    { slug: 'heartfelt', label: 'Heartfelt' },
    { slug: 'romantic', label: 'Romantic' },
  ]);
});

test('the committed keyword map resolves the seeded heartwarming keyword', () => {
  // 319357 ("heartwarming") is hand-seeded → heartfelt, and the e2e/integration
  // fixtures rely on it. This guards the seed against a harvest that drops it.
  assert.deepEqual(toneSlugs(movie(1, [319357])), ['heartfelt']);
});

test('isTone recognises the vocabulary and rejects anything else', () => {
  assert.ok(isTone('heartfelt'));
  assert.ok(isTone('deadpan'));
  assert.equal(isTone('not-a-tone'), false);
  assert.equal(isTone(''), false);
});

test('toneList exposes every tone as {slug,label} for the client', () => {
  const list = toneList();
  assert.equal(list.length, TONES.length);
  assert.ok(list.every((t) => typeof t.slug === 'string' && typeof t.label === 'string'));
  assert.ok(list.some((t) => t.slug === 'deadpan' && t.label === 'Deadpan'));
});
