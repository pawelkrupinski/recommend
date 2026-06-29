// Unit tests for the pure tone vocabulary + crosswalk primitives (no DB). The
// DB-backed aggregation (live ∪ stored across sources) is covered in the
// integration suite; here we test the building blocks: generalising raw service
// tags into canonical slugs, the live (zero-I/O) derivation, and ordering.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapRawTags, liveToneSlugs, orderTones, isTone, toneList, TONES } from '../../src/tones.js';

test('mapRawTags generalises raw tags to canonical slugs via a crosswalk', () => {
  const cw = { 'deadpan-humor': ['deadpan'], 'feel-good': ['feel-good', 'heartfelt'], 'plot': ['not-a-tone'] };
  assert.deepEqual(mapRawTags(cw, ['deadpan-humor']), ['deadpan']);
  assert.deepEqual(mapRawTags(cw, ['feel-good']).sort(), ['feel-good', 'heartfelt']);
});

test('mapRawTags dedupes, drops unknown keys, and rejects slugs outside the vocabulary', () => {
  const cw = { a: ['deadpan'], b: ['deadpan'], c: ['bogus-tone'] };
  assert.deepEqual(mapRawTags(cw, ['a', 'b']), ['deadpan'], 'two keys → one slug, deduped');
  assert.deepEqual(mapRawTags(cw, ['c']), [], 'a slug not in TONES is dropped');
  assert.deepEqual(mapRawTags(cw, ['missing']), [], 'an unmapped key contributes nothing');
  assert.deepEqual(mapRawTags(undefined, ['a']), [], 'no crosswalk → no slugs');
});

test('liveToneSlugs derives tones from a movie\'s TMDB keywords (committed map)', () => {
  // 319357 ("heartwarming") is the hand-seeded TMDB keyword → heartfelt.
  const movie = { id: 1, keywords: { keywords: [{ id: 319357, name: 'heartwarming' }, { id: 1, name: 'x' }] } };
  assert.deepEqual(liveToneSlugs(movie), ['heartfelt']);
  assert.deepEqual(liveToneSlugs({ id: 2 }), [], 'no keywords → no live tones');
  assert.deepEqual(liveToneSlugs({}), []);
});

test('orderTones returns {slug,label} in canonical TONES order', () => {
  assert.deepEqual(orderTones(['romantic', 'heartfelt']), [
    { slug: 'heartfelt', label: 'Heartfelt' },
    { slug: 'romantic', label: 'Romantic' },
  ]);
  assert.deepEqual(orderTones(['nope']), [], 'unknown slugs are dropped');
});

test('isTone recognises the vocabulary and rejects anything else', () => {
  assert.ok(isTone('heartfelt') && isTone('deadpan'));
  assert.equal(isTone('not-a-tone'), false);
  assert.equal(isTone(''), false);
});

test('toneList exposes every tone as {slug,label} for the client', () => {
  const list = toneList();
  assert.equal(list.length, TONES.length);
  assert.ok(list.some((t) => t.slug === 'deadpan' && t.label === 'Deadpan'));
});
