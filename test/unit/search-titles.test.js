// Unit tests for searchTitles() — the by-name title search. It runs a TMDB
// multi-search, drops person hits, shapes each film/series into the same card
// Discover serves (streaming services resolved for the user), and sorts titles
// on the user's chosen services ahead of the rest. Runs against the canned TMDB
// stub (TMDB_STUB=1 via freshDbEnv): /search/multi returns a fixed mixed set —
// a movie on the backfill provider (off a provider-8 user), a person, a series
// on TV_PROVIDER (off a movie user), and a movie on the default provider 8
// (on-service), in that order — so these assertions pin the filtering and the
// on-service-first re-sort. No network, no MotN quota.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDbEnv } from '../helpers/env.js';

freshDbEnv();
const { searchTitles } = await import('../../src/taste.js');

test('empty/blank query returns no results without hitting TMDB', async () => {
  assert.deepEqual(await searchTitles({ query: '', region: 'PL', providerIds: [8] }), []);
  assert.deepEqual(await searchTitles({ query: '   ', region: 'PL', providerIds: [8] }), []);
});

test('drops person hits; keeps movies and TV as cards', async () => {
  const out = await searchTitles({ query: 'stub', region: 'PL', providerIds: [8] });
  // Stub multi-search yields 3 movie/TV hits + 1 person; the person is dropped.
  assert.equal(out.length, 3);
  assert.ok(out.every((c) => c.media_type === 'movie' || c.media_type === 'tv'));
  assert.ok(out.every((c) => typeof c.title === 'string' && c.tmdb_id));
});

test('titles on the user\'s chosen services sort first', async () => {
  const out = await searchTitles({ query: 'stub', region: 'PL', providerIds: [8] });
  // Title 201 streams on provider 8 (the user's) → on-service, sorted to the front
  // even though the stub lists it last. The backfill movie (5001) and the series
  // (401) stream on providers the user didn't pick → off-service, no icons.
  assert.equal(out[0].tmdb_id, 201, 'on-service title first');
  assert.ok(out[0].services.length > 0, 'on-service card carries services');
  assert.ok(out.slice(1).every((c) => c.services.length === 0), 'off-service cards carry no services');
});

test('a card shapes into the Discover contract (poster, genres, no scraped badges)', async () => {
  const [onService] = await searchTitles({ query: 'stub', region: 'PL', providerIds: [8] });
  assert.equal(onService.media_type, 'movie');
  assert.ok(onService.poster_path, 'has a poster');
  assert.ok(Array.isArray(onService.genres) && Array.isArray(onService.genreIds));
  assert.deepEqual(onService.services, [{ id: 8, name: 'Netflix Test', logo: '/netflix.png' }]);
  // Rating badges are deliberately NOT resolved here (that is the client's /api/enrich
  // pass) — the shaped card leaves them unset so it never hammers the scrapers.
  assert.equal(onService.imdbRating, undefined);
  assert.equal(onService.metascore, undefined);
});

test('with no chosen services every hit is off-service but still returned', async () => {
  const out = await searchTitles({ query: 'stub', region: 'PL', providerIds: [] });
  assert.equal(out.length, 3, 'search never comes up empty for lack of a subscription');
  assert.ok(out.every((c) => c.services.length === 0));
});
