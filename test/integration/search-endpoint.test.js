// GET /api/search — by-name title lookup over TMDB's whole catalogue, each hit
// returned as a Discover-shaped card with the user's chosen streaming services
// resolved onto it, on-service titles first. Runs against the canned TMDB stub
// (its /search/multi returns a fixed movie+TV+person set), so we assert the
// contract end to end: person hits dropped, per-user providers/region honoured,
// on-service ordering, and that a blank query is a cheap empty response. Rating
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

test('returns movie+TV cards, on-service first, honouring the chosen providers', async () => {
  const c = client(base);
  await c.json('/api/settings', { method: 'POST', body: { providers: [8], country: 'PL' } });

  const { status, data } = await c.json('/api/search?q=stub');
  assert.equal(status, 200);
  assert.equal(data.results.length, 3, 'the person hit is dropped; 2 movies + 1 series remain');
  assert.ok(data.results.every((r) => r.media_type === 'movie' || r.media_type === 'tv'));

  const [first, ...rest] = data.results;
  assert.equal(first.tmdb_id, 201, 'the title on the user\'s service sorts to the front');
  assert.deepEqual(first.services, [{ id: 8, name: 'Netflix Test', logo: '/netflix.png' }]);
  assert.ok(rest.every((r) => r.services.length === 0), 'off-service cards carry no streaming icons');
  // The client fills these via /api/enrich; the search response must not block on scrapes.
  assert.ok(!('imdbRating' in first), 'no scraped rating badge on the search card');
});

test('providers gate what counts as on-service — a different subscription reorders results', async () => {
  const c = client(base);
  // TV_PROVIDER (350) is the series\' service; now the series is on-service and leads.
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
