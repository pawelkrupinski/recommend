// GET /api/search — by-name title lookup over TMDB's whole catalogue, each hit a
// Discover-shaped card with the user's chosen streaming services resolved onto it,
// on-service titles first. The endpoint is built to be instant: it shapes cards
// from caches only and never blocks on a per-title fetch, warming any unresolved
// title's providers in the BACKGROUND so a repeat search paints its icons. Against
// the canned TMDB stub the warm completes off the response path, so we assert the
// progressive flow: a cold first search, then an on-service second search. Rating
// badges are the client's later /api/enrich job, so they're absent here.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshDbEnv } from '../helpers/env.js';

const env = freshDbEnv();
const { server } = await import('../../src/server.js');
const { serve, client } = await import('../helpers/http.js');

let base, close;
before(async () => { ({ base, close } = await serve(server)); });
after(() => { close(); env.cleanup(); });

test('cold first search resolves nothing on-service; a repeat search paints icons and sorts on-service first', async () => {
  const c = client(base);
  await c.json('/api/settings', { method: 'POST', body: { providers: [8], country: 'PL' } });

  // First search: cold cache → 3 cards (person dropped), all off-service, and the
  // background provider warm kicked off (not awaited by the response).
  const first = await c.json('/api/search?q=stub');
  assert.equal(first.status, 200);
  assert.equal(first.data.results.length, 3, 'the person hit is dropped; 2 movies + 1 series remain');
  assert.ok(first.data.results.every((r) => r.media_type === 'movie' || r.media_type === 'tv'));
  assert.ok(first.data.results.every((r) => r.services.length === 0), 'cold cache resolves nothing on-service yet');
  assert.ok(!('imdbRating' in first.data.results[0]), 'no scraped rating badge on the search card');

  // Second search: the warm has populated the provider cache, so the provider-8
  // title now resolves on-service and sorts to the front.
  const second = await c.json('/api/search?q=stub');
  assert.equal(second.data.results[0].tmdb_id, 201, 'the title on the user\'s service sorts to the front');
  assert.deepEqual(second.data.results[0].services, [{ id: 8, name: 'Netflix Test', logo: '/netflix.png' }]);
  assert.ok(second.data.results.slice(1).every((r) => r.services.length === 0), 'off-service cards carry no icons');
});

test('providers gate what counts as on-service — a different subscription sees the series on-service', async () => {
  // The provider cache is warm from the test above (it's process-wide, user-independent),
  // so a TV_PROVIDER (350) user sees the series on-service on the first search.
  const c = client(base);
  await c.json('/api/settings', { method: 'POST', body: { providers: [350], country: 'PL' } });
  const { data } = await c.json('/api/search?q=stub');
  assert.equal(data.results[0].tmdb_id, 401, 'the series leads once its service is chosen');
  assert.equal(data.results[0].media_type, 'tv');
  assert.ok(data.results[0].services.length > 0);
});

test('a blank query is a cheap empty response, not an error', async () => {
  const c = client(base);
  const { status, data } = await c.json('/api/search?q=');
  assert.equal(status, 200);
  assert.deepEqual(data.results, []);
  const missing = await c.json('/api/search');
  assert.deepEqual(missing.data.results, [], 'no q param → empty, still 200');
});

test('works anonymously; with no chosen services nothing is on-service but results still come back', async () => {
  const c = client(base); // fresh anon session, no providers chosen
  const { status, data } = await c.json('/api/search?q=stub');
  assert.equal(status, 200);
  assert.equal(data.results.length, 3, 'search never comes up empty for lack of a subscription');
  assert.ok(data.results.every((r) => r.services.length === 0));
});
