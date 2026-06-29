// Integration tests for the tone provenance store + resolution + aggregation.
// The store keeps one set of slugs per (title, source); resolveTones writes through
// it with a TTL guard; tone-store unions a title's live (TMDB-keyword) tones with
// everything the per-title feeders stored. Driven with a deterministic fake source
// so there's no network — exactly the seam production uses (toneSources is just the
// default argument).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { freshDbEnv } from '../helpers/env.js';

freshDbEnv();
const db = await import('../../src/db.js');
const { toneSlugs, tonesForMovie } = await import('../../src/tone-store.js');
const { resolveTones } = await import('../../src/tone-sources.js');

const fakeSource = (name, slugs) => ({ name, configured: () => true, resolve: async () => slugs });

test('a title\'s stored tones are the union across sources; each source replaces only its own', () => {
  db.setMovieToneSource(700, 'movie', 'imdb', ['deadpan', 'dark']);
  db.setMovieToneSource(700, 'movie', 'letterboxd', ['dark', 'gritty']);
  assert.deepEqual(db.getMovieToneSlugs(700).sort(), ['dark', 'deadpan', 'gritty'], 'union, deduped');

  // Re-resolving imdb replaces just its rows; letterboxd's survive.
  db.setMovieToneSource(700, 'movie', 'imdb', ['cozy']);
  assert.deepEqual(db.getMovieToneSlugs(700).sort(), ['cozy', 'dark', 'gritty'], 'imdb swapped, letterboxd kept');
});

test('an empty resolve records "resolved, none" (sentinel) without surfacing a tone', () => {
  db.setMovieToneSource(701, 'movie', 'model', []);
  assert.deepEqual(db.getMovieToneSlugs(701), [], 'no real tone surfaces');
  assert.ok(db.movieToneResolvedAt(701, 'movie', 'model') > 0, 'but the source counts as resolved (TTL set)');
});

test('resolveTones persists each configured source and is TTL-skipped on re-run', async () => {
  await resolveTones({ tmdb_id: 800, title: 'X', overview: '' }, 'movie', [fakeSource('imdb', ['gritty', 'deadpan'])]);
  assert.deepEqual(db.getMovieToneSlugs(800).sort(), ['deadpan', 'gritty']);
  assert.ok(db.movieToneResolvedAt(800, 'movie', 'imdb') > 0);

  // A second run within the TTL must NOT overwrite (the source is skipped).
  await resolveTones({ tmdb_id: 800, title: 'X', overview: '' }, 'movie', [fakeSource('imdb', ['cozy'])]);
  assert.deepEqual(db.getMovieToneSlugs(800).sort(), ['deadpan', 'gritty'], 'unchanged — TTL skip');
});

test('an unconfigured source contributes nothing', async () => {
  await resolveTones({ tmdb_id: 801, title: 'Y' }, 'movie',
    [{ name: 'off', configured: () => false, resolve: async () => ['dark'] }]);
  assert.deepEqual(db.getMovieToneSlugs(801), []);
});

test('tonesForMovie unions a title\'s live TMDB-keyword tones with its stored tones', () => {
  // 319357 = heartwarming → heartfelt (live, from the committed TMDB map).
  const full = { id: 900, keywords: { keywords: [{ id: 319357 }] } };
  assert.deepEqual(toneSlugs(full), ['heartfelt'], 'live only, before any feeder');

  db.setMovieToneSource(900, 'movie', 'model', ['gritty']);
  assert.deepEqual(toneSlugs(full).sort(), ['gritty', 'heartfelt'], 'live ∪ stored');
  assert.deepEqual(tonesForMovie(full), [
    { slug: 'heartfelt', label: 'Heartfelt' },
    { slug: 'gritty', label: 'Gritty' },
  ], 'ordered {slug,label} in canonical order');
});
