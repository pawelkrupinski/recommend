// TV series flow end to end through the real server + TMDB stub: a user
// subscribed to the TV test provider gets a feed that MIXES films and series, the
// series cards carry the normalized shape (title from `name`, year from
// `first_air_date`, season/episode counts, no runtime), and rating a series
// removes it from the feed — proving the (media_type, id) exclusion key works.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshDbEnv } from '../helpers/env.js';

const env = freshDbEnv();
const { server } = await import('../../src/server.js');
const { serve, client } = await import('../helpers/http.js');

let base, close;
before(async () => { ({ base, close } = await serve(server)); });
after(() => { close(); env.cleanup(); });

// Provider 8 streams the movie fixtures, 350 the TV ones (see tmdb-stub.js), so a
// user on both gets a genuinely mixed pool.
async function mixedUser() {
  const c = client(base);
  await c.login();
  await c.json('/api/settings', { method: 'POST', body: { providers: [8, 350] } });
  return c;
}

test('the Discover feed mixes movies and TV when the user streams both', async () => {
  const c = await mixedUser();
  const { status, data } = await c.json('/api/recommend');
  assert.equal(status, 200);
  const types = new Set(data.results.map((m) => m.media_type));
  assert.ok(types.has('movie'), 'films are in the pool');
  assert.ok(types.has('tv'), 'series are in the pool — one mixed feed');
});

test('a TV pick is normalized: title from name, year from first_air_date, seasons/episodes, no runtime', async () => {
  const c = await mixedUser();
  const { data } = await c.json('/api/recommend');
  const series = data.results.find((m) => m.media_type === 'tv' && m.tmdb_id === 401);
  assert.ok(series, 'the stub series surfaced as a pick');
  assert.equal(series.title, 'Stub Series One', 'TMDB `name` mapped to title');
  assert.equal(series.year, 2019, 'year derived from first_air_date');
  assert.equal(series.seasons, 3, 'season count carried for the card');
  assert.equal(series.episodes, 24, 'episode count carried for the card');
  assert.equal(series.runtime, null, 'a series has no film runtime');
});

test('rating a series removes it from the feed but leaves films (exclusion is per media_type:id)', async () => {
  const c = await mixedUser();
  const before = await c.json('/api/recommend');
  assert.ok(before.data.results.some((m) => m.media_type === 'tv' && m.tmdb_id === 401), 'series present before rating');

  await c.json('/api/ratings', { method: 'POST', body: { tmdb_id: 401, media_type: 'tv', rating: 9, title: 'Stub Series One' } });

  const after = await c.json('/api/recommend');
  assert.ok(!after.data.results.some((m) => m.media_type === 'tv' && m.tmdb_id === 401), 'the rated series is gone');
  assert.ok(after.data.results.some((m) => m.media_type === 'movie'), 'films are untouched');
});

test('?type=tv narrows the feed to series only — and is not starved to empty', async () => {
  const c = await mixedUser();
  const { status, data } = await c.json('/api/recommend?type=tv');
  assert.equal(status, 200);
  assert.ok(data.results.length, 'a TV-only pool still returns picks (sources narrowed before the cap, not starved)');
  assert.ok(data.results.every((m) => m.media_type === 'tv'), 'every pick is a series — no films leak through');
});

test('?type=movie narrows the feed to films only', async () => {
  const c = await mixedUser();
  const { data } = await c.json('/api/recommend?type=movie');
  assert.ok(data.results.length, 'a films-only pool returns picks');
  assert.ok(data.results.every((m) => m.media_type === 'movie'), 'every pick is a film — no series leak through');
});

test('a saved series persists its season counts on the watchlist card', async () => {
  const c = await mixedUser();
  const { data } = await c.json('/api/recommend');
  const series = data.results.find((m) => m.media_type === 'tv' && m.tmdb_id === 402);
  assert.ok(series, 'a second series to save');
  await c.json('/api/watchlist', { method: 'POST', body: { ...series } });

  const { data: wl } = await c.json('/api/watchlist');
  const saved = wl.watchlist.find((w) => w.tmdb_id === 402 && w.media_type === 'tv');
  assert.ok(saved, 'the series is on the watchlist as tv');
  assert.equal(saved.seasons, 3, 'season count round-trips through the persisted card');
  assert.equal(saved.episodes, 24, 'episode count round-trips too');
});
