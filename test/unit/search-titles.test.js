// Unit tests for searchTitles() — the by-name title search. It runs one TMDB
// multi-search, drops person hits, and shapes each film/series into a card using
// ONLY the caches (no blocking per-title network): a title whose full detail is
// already cached (it was in the user's recommendations/watchlist) comes back rich;
// one whose providers are cached comes back with streaming services; an unseen one
// paints from the list fields alone and is queued for a background provider warm.
// On-service titles sort first. Runs against the canned TMDB stub (TMDB_STUB=1),
// which honours the cache both ways so these paths are exercised without a network.
//
// Stub /search/multi returns a fixed set: movie 5001 (on backfill provider 9),
// person 601 (dropped), series 401 (on TV provider 350), movie 201 (on provider 8).
// A provider-8 user has only 201 on-service.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDbEnv } from '../helpers/env.js';

freshDbEnv();
const { searchTitles, setSearchWarmer } = await import('../../src/taste.js');
const { details, watchProviders } = await import('../../src/tmdb.js');
const { stubCalls, resetStubCalls } = await import('../../src/tmdb-stub.js');

// Stub out the background warmer so the hot path is observed in isolation (no real
// stub calls from warming) and its miss list can be asserted. Reset before each use.
let warmedMisses = null;
setSearchWarmer((misses) => { warmedMisses = misses; });

test('empty/blank query returns no results without hitting TMDB', async () => {
  resetStubCalls();
  assert.deepEqual(await searchTitles({ query: '', region: 'PL', providerIds: [8] }), []);
  assert.deepEqual(await searchTitles({ query: '   ', region: 'PL', providerIds: [8] }), []);
  assert.deepEqual(stubCalls, [], 'a blank query touches no TMDB endpoint at all');
});

// This test runs FIRST against the file's fresh (empty) cache, so it sees the true
// cold path — nothing pre-warmed. The warming tests below populate the cache.
test('cold cache: makes ZERO blocking per-title fetches; every hit off-service and queued to warm', async () => {
  resetStubCalls();
  warmedMisses = null;
  const out = await searchTitles({ query: 'stub', region: 'PL', providerIds: [8] });

  assert.equal(out.length, 3, 'person dropped; 2 movies + 1 series remain');
  assert.ok(out.every((c) => c.services.length === 0), 'nothing resolves on-service on a cold cache');

  // The hot path's only stub calls are the multi-search and the (cached-forever) genre
  // lists — NO /movie/:id or /tv/:id detail, NO per-title /watch/providers. Those are
  // cacheOnly reads, which never reach the stub, so the search adds no network round-trips.
  assert.ok(stubCalls.includes('/search/multi'));
  const perTitle = /^\/(movie|tv)\/\d+(\/watch\/providers)?$/;
  assert.deepEqual(stubCalls.filter((p) => perTitle.test(p)), [], 'no blocking per-title network on the hot path');

  // Every unresolved title is handed to the background warmer for next time.
  assert.deepEqual(new Set(warmedMisses.map((m) => m.id)), new Set([5001, 401, 201]));
});

test('drops person hits; keeps movies and TV as cards', async () => {
  const out = await searchTitles({ query: 'stub', region: 'PL', providerIds: [8] });
  assert.equal(out.length, 3);
  assert.ok(out.every((c) => c.media_type === 'movie' || c.media_type === 'tv'));
  assert.ok(out.every((c) => typeof c.title === 'string' && c.tmdb_id));
});

test('once a title\'s providers are warm, it resolves on-service and sorts first', async () => {
  // Simulate the background warm having populated the provider cache for the hits.
  await watchProviders(201, 'movie');
  await watchProviders(401, 'tv');
  await watchProviders(5001, 'movie');

  const out = await searchTitles({ query: 'stub', region: 'PL', providerIds: [8] });
  assert.equal(out[0].tmdb_id, 201, 'the provider-8 title sorts to the front');
  assert.deepEqual(out[0].services, [{ id: 8, name: 'Netflix Test', logo: '/netflix.png' }]);
  assert.ok(out.slice(1).every((c) => c.services.length === 0), 'off-service cards carry no streaming icons');
  // Providers-only warm gives a list card, not a full detail one (no cast yet).
  assert.deepEqual(out[0].cast, undefined);
});

test('a title with cached full detail comes back as a rich card (recommendations/watchlist case)', async () => {
  // A title the user already saw in Discover/watchlist had its full detail fetched by
  // the build, so search reuses it verbatim — cast/director/runtime and all.
  await details(201, 'movie');

  const [first] = await searchTitles({ query: 'stub', region: 'PL', providerIds: [8] });
  assert.equal(first.tmdb_id, 201);
  assert.equal(first.director, 'Stub Director', 'rich card carries the director');
  assert.deepEqual(first.cast, ['Stub Actor'], 'and the cast');
  assert.equal(first.runtime, 107, 'and the runtime');
  assert.deepEqual(first.services, [{ id: 8, name: 'Netflix Test', logo: '/netflix.png' }]);
  // Still no scraped IMDb/MC badges — those remain the client's /api/enrich job.
  assert.equal(first.imdbRating ?? undefined, undefined);
});

test('with no chosen services every hit is off-service but still returned', async () => {
  // Even though 201's providers/detail are cached from the tests above, an empty
  // chosen set means nothing is on-service.
  const out = await searchTitles({ query: 'stub', region: 'PL', providerIds: [] });
  assert.equal(out.length, 3, 'search never comes up empty for lack of a subscription');
  assert.ok(out.every((c) => c.services.length === 0));
});
