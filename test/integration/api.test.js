// Integration tests: boot the real HTTP server in-process (on an ephemeral
// port) and drive it over fetch. Uses the dev-login bypass + TMDB stub so no
// OAuth round-trip and no network are needed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshDbEnv } from '../helpers/env.js';

const env = freshDbEnv();
const { server } = await import('../../src/server.js');

let base;
before(async () => {
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); env.cleanup(); });

// Minimal client: tracks one cookie string, follows nothing automatically.
function client() {
  let cookie = '';
  return {
    async raw(path, { method = 'GET', body } = {}) {
      const res = await fetch(base + path, {
        method,
        redirect: 'manual',
        headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const set = res.headers.getSetCookie?.() || [];
      if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
      return res;
    },
    async json(path, opts) {
      const res = await this.raw(path, opts);
      const data = await res.json().catch(() => null);
      return { status: res.status, data };
    },
    async login({ email = 'tester@example.com', admin = false, onboarded = true } = {}) {
      const q = new URLSearchParams({ email, ...(admin ? { admin: '1' } : {}), ...(onboarded ? {} : { onboarded: '0' }) });
      const res = await this.raw('/auth/dev-login?' + q);
      assert.equal(res.status, 302, 'dev-login redirects');
      return this;
    },
    get cookie() { return cookie; },
  };
}

test('GET /api/me mints an anonymous session for a first-time visitor', async () => {
  const c = client();
  const { status, data } = await c.json('/api/me');
  assert.equal(status, 200);
  assert.equal(data.anonymous, true, 'flagged anonymous');
  assert.ok(data.user.id, 'a real (anonymous) user row backs the session');
  assert.equal(data.user.email, null, 'anonymous users have no email');
  assert.ok(c.cookie, 'a session cookie was set so the identity persists');
  assert.ok(Array.isArray(data.providers));
});

test('data endpoints work anonymously — no login required', async () => {
  const c = client();
  let r = await c.json('/api/ratings');
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.ratings, [], 'fresh anon user starts with no ratings');
  r = await c.json('/api/ratings', { method: 'POST', body: { tmdb_id: 42, rating: 8, title: 'Anon Pick' } });
  assert.equal(r.status, 200);
  r = await c.json('/api/ratings');
  assert.equal(r.data.ratings.length, 1, 'the anonymous rating persisted via the session cookie');
});

test('signing in to a new (empty) account adopts the anonymous session', async () => {
  const c = client();
  // Build up an anonymous session first…
  await c.json('/api/ratings', { method: 'POST', body: { tmdb_id: 77, rating: 9, title: 'Pre-login Fave' } });
  await c.json('/api/watchlist', { method: 'POST', body: { tmdb_id: 88, title: 'Saved Anon' } });
  // …then sign in to a brand-new account (the client keeps the anon cookie).
  await c.login({ email: 'merger@example.com' });
  const me = await c.json('/api/me');
  assert.equal(me.data.anonymous, false, 'now a real account');
  assert.equal(me.data.user.email, 'merger@example.com');
  const ratings = await c.json('/api/ratings');
  assert.equal(ratings.data.ratings.length, 1, 'anonymous rating carried into the empty account');
  assert.equal(ratings.data.ratings[0].title, 'Pre-login Fave');
  const wl = await c.json('/api/watchlist');
  assert.equal(wl.data.watchlist.length, 1, 'anonymous watchlist carried over');
});

test('signing in to an account with content discards the anonymous session', async () => {
  // Establish an account that already has a rating of its own.
  const established = await client().login({ email: 'established@example.com' });
  await established.json('/api/ratings', { method: 'POST', body: { tmdb_id: 111, rating: 7, title: 'Account Film' } });
  // A different browser builds an anonymous session, then signs in to that account.
  const fresh = client();
  await fresh.json('/api/ratings', { method: 'POST', body: { tmdb_id: 222, rating: 10, title: 'Anon Film' } });
  await fresh.login({ email: 'established@example.com' });
  // The account's own data wins; the anonymous rating is thrown away, not merged.
  const ratings = await fresh.json('/api/ratings');
  assert.deepEqual(ratings.data.ratings.map((r) => r.tmdb_id), [111],
    'only the account rating remains — the anonymous one was discarded');
});

test('dev-login establishes a session usable by /api/me', async () => {
  const c = await client().login({ email: 'alice@example.com' });
  const { status, data } = await c.json('/api/me');
  assert.equal(status, 200);
  assert.equal(data.user.email, 'alice@example.com');
  assert.equal(data.onboarded, true);
});

test('ratings: create, list, delete', async () => {
  const c = await client().login({ email: 'rater@example.com' });
  let r = await c.json('/api/ratings', { method: 'POST', body: { tmdb_id: 500, rating: 9, title: 'Heat', year: 1995 } });
  assert.equal(r.status, 200);
  r = await c.json('/api/ratings');
  assert.equal(r.data.ratings.length, 1);
  assert.equal(r.data.ratings[0].title, 'Heat');
  await c.json('/api/ratings', { method: 'DELETE', body: { tmdb_id: 500, media_type: 'movie' } });
  r = await c.json('/api/ratings');
  assert.equal(r.data.ratings.length, 0);
});

test('watchlist: add, list, dedupe, remove', async () => {
  const c = await client().login({ email: 'watcher@example.com' });
  let r = await c.json('/api/watchlist', { method: 'POST', body: { tmdb_id: 603, title: 'The Matrix', year: 1999, poster_path: '/m.jpg' } });
  assert.equal(r.status, 200);
  r = await c.json('/api/watchlist');
  assert.equal(r.data.watchlist.length, 1);
  assert.equal(r.data.watchlist[0].title, 'The Matrix');
  assert.equal(r.data.watchlist[0].poster_path, '/m.jpg');
  // Re-adding the same title is idempotent (upsert on the primary key).
  await c.json('/api/watchlist', { method: 'POST', body: { tmdb_id: 603, title: 'The Matrix', year: 1999 } });
  r = await c.json('/api/watchlist');
  assert.equal(r.data.watchlist.length, 1, 'no duplicate row for the same title');
  await c.json('/api/watchlist', { method: 'DELETE', body: { tmdb_id: 603, media_type: 'movie' } });
  r = await c.json('/api/watchlist');
  assert.equal(r.data.watchlist.length, 0);
});

test('watchlist: save-time capture stores the rich card fields a Discover pick carries', async () => {
  const c = await client().login({ email: 'rich-save@example.com' });
  // The Discover card POSTs its whole pick; the server keeps the card fields.
  await c.json('/api/watchlist', { method: 'POST', body: {
    tmdb_id: 201, title: 'Stub Streamable One', year: 2020, poster_path: '/p201.jpg',
    vote_average: 7.5, runtime: 107, genres: ['Action'],
    services: [{ id: 8, name: 'Netflix Test', logo: '/netflix.png' }],
    overview: 'A pick.', director: 'Stub Director', cast: ['Stub Actor'], score: 88,
  } });
  const { data } = await c.json('/api/watchlist');
  const [w] = data.watchlist;
  assert.deepEqual(w.genres, ['Action'], 'genres persisted and returned as an array');
  assert.deepEqual(w.services, [{ id: 8, name: 'Netflix Test', logo: '/netflix.png' }]);
  assert.equal(w.vote_average, 7.5);
  assert.equal(w.runtime, 107);
  assert.equal(w.director, 'Stub Director');
  assert.equal(w.score, undefined, 'the recommendation score is not persisted');
});

test('watchlist: backfill enriches titles saved without card fields', async () => {
  const { backfillWatchlistCards } = await import('../../src/taste.js');
  const c = await client().login({ email: 'backfill@example.com' });
  await c.json('/api/settings', { method: 'POST', body: { providers: [8] } });
  // A legacy-style save: only title/year/poster, no card fields.
  await c.json('/api/watchlist', { method: 'POST', body: { tmdb_id: 201, title: 'Stub Streamable One', year: 2020 } });
  let { data } = await c.json('/api/watchlist');
  assert.equal(data.watchlist[0].genres, undefined, 'starts un-enriched');

  await backfillWatchlistCards(); // re-derives card fields from the TMDB stub

  ({ data } = await c.json('/api/watchlist'));
  const [w] = data.watchlist;
  assert.deepEqual(w.genres, ['Action'], 'genres filled from TMDB details');
  assert.deepEqual(w.services, [{ id: 8, name: 'Netflix Test', logo: '/netflix.png' }],
    "the user's chosen service that streams it is attached");
  assert.equal(w.runtime, 107, 'runtime filled');
  assert.equal(w.title, 'Stub Streamable One', 'title untouched by the backfill');
});

test('where-to-watch reports the user region so search links can target the right storefront', async () => {
  const c = await client().login({ email: 'where@example.com' });
  await c.json('/api/settings', { method: 'POST', body: { country: 'GB' } });
  const { data } = await c.json('/api/where?id=201&media_type=movie');
  assert.equal(data.region, 'GB', "the user's country drives the where lookup and Apple storefront");
  assert.ok(Array.isArray(data.deepLinks), 'deep links are present (empty without a MotN key)');
});

test('app paths serve the SPA shell so client routing works on refresh / deep link', async () => {
  const c = client();
  for (const path of ['/discover', '/watchlist', '/ratings', '/settings']) {
    const res = await c.raw(path);
    assert.equal(res.status, 200, `${path} serves 200`);
    assert.match(await res.text(), /id="app"/, `${path} returns the SPA shell`);
  }
});

test('GET /api/me reports the user country (for service-link storefronts)', async () => {
  const c = await client().login({ email: 'country@example.com' });
  await c.json('/api/settings', { method: 'POST', body: { country: 'FR' } });
  const me = await c.json('/api/me');
  assert.equal(me.data.country, 'FR');
});

test('rate-queue hides rated, dismissed and not-seen titles (dismissed regression)', async () => {
  const c = await client().login({ email: 'queue@example.com' });
  // The acclaimed seed (provider-less Discover) returns ids 101..105.
  await c.json('/api/ratings', { method: 'POST', body: { tmdb_id: 102, rating: 7, title: 'P2' } });
  await c.json('/api/dismiss', { method: 'POST', body: { tmdb_id: 101 } });
  await c.json('/api/not-seen', { method: 'POST', body: { tmdb_id: 103 } });

  const { data } = await c.json('/api/rate-queue?page=1');
  const ids = data.items.map((m) => m.tmdb_id);
  assert.ok(!ids.includes(101), 'dismissed title is filtered out (the bug this guards)');
  assert.ok(!ids.includes(102), 'rated title is filtered out');
  assert.ok(!ids.includes(103), 'not-seen title is filtered out');
  assert.deepEqual(ids.sort(), [104, 105], 'only the untouched popular titles remain');
  // totalPages lets the client stop paging at the last page instead of
  // re-fetching it and duplicating cards in the onboarding queue.
  assert.equal(data.totalPages, 1, 'exposes the page count from TMDB');
});

test('settings: per-user country defaults to PL and persists', async () => {
  const c = await client().login({ email: 'settings@example.com' });
  let r = await c.json('/api/settings');
  assert.equal(r.data.country, 'PL');
  await c.json('/api/settings', { method: 'POST', body: { country: 'US' } });
  r = await c.json('/api/settings');
  assert.equal(r.data.country, 'US');
});

test('recommendations carry runtime from TMDB details', async () => {
  const c = await client().login({ email: 'runtime@example.com' });
  // Pick the stub provider (id 8) so the discover candidate pool is non-empty.
  await c.json('/api/settings', { method: 'POST', body: { providers: [8] } });
  const { status, data } = await c.json('/api/recommend');
  assert.equal(status, 200);
  assert.ok(data.results.length, 'pool is non-empty with a provider selected');
  // Stub details() reports runtime: 107 for every title; it should survive
  // shaping, caching and serving.
  assert.ok(data.results.every((m) => m.runtime === 107), 'every pick carries runtime');
});

test('recommendations include titles only a non-Discover source surfaces', async () => {
  const c = await client().login({ email: 'trending@example.com' });
  await c.json('/api/settings', { method: 'POST', body: { providers: [8] } });
  const { status, data } = await c.json('/api/recommend');
  assert.equal(status, 200);
  // 301 ("Stub Trending One") exists only on the /trending endpoint — no Discover
  // page or recommendation list returns it. Its presence proves the multi-source
  // pipeline blends sources beyond Discover into the served pool.
  assert.ok(data.results.some((m) => m.tmdb_id === 301),
    'a trending-only candidate made it into the recommendations');
});

test('recommendations carry the chosen services that stream each pick', async () => {
  const c = await client().login({ email: 'services@example.com' });
  // Choose Netflix (id 8 — the stub's streamable provider). Disney (337) is also
  // chosen but no stub title streams on it, so it must never appear on a card.
  await c.json('/api/settings', { method: 'POST', body: { providers: [8, 337] } });
  const { status, data } = await c.json('/api/recommend');
  assert.equal(status, 200);
  assert.ok(data.results.length, 'pool is non-empty with a provider selected');
  for (const m of data.results) {
    assert.deepEqual(m.services, [{ id: 8, name: 'Netflix Test', logo: '/netflix.png' }],
      'each pick lists only the chosen services it streams on, with TMDB id/name/logo');
  }
});

// The stub's three streamable titles span the origin/indie filter axes:
//   201 — US, Warner Bros (major)   202 — FR, indie   203 — JP, indie
const idsOf = (data) => new Set(data.results.map((m) => m.tmdb_id));

// The origin/indie filters are live Discover query params on /api/recommend
// (like genre), not saved settings — so they're driven from the URL here.
test('excludeUs query param drops US-origin picks from recommendations', async () => {
  const c = await client().login({ email: 'nous@example.com' });
  await c.json('/api/settings', { method: 'POST', body: { providers: [8] } });
  // 301 is the trending-only pick (US/major, like 201); it rides along by default.
  assert.deepEqual(idsOf((await c.json('/api/recommend')).data), new Set([201, 202, 203, 301]), 'all four by default');

  const ids = idsOf((await c.json('/api/recommend?excludeUs=1')).data);
  assert.ok(!ids.has(201) && !ids.has(301), 'US titles (201, 301) excluded');
  assert.deepEqual(ids, new Set([202, 203]), 'non-US picks remain');
});

test('indie query param drops major-studio picks', async () => {
  const c = await client().login({ email: 'indie@example.com' });
  await c.json('/api/settings', { method: 'POST', body: { providers: [8] } });
  const ids = idsOf((await c.json('/api/recommend?indie=1')).data);
  assert.ok(!ids.has(201), 'Warner Bros title (201) excluded as non-indie');
  assert.deepEqual(ids, new Set([202, 203]), 'indie picks remain');
});

test('origin query param narrows the pool by continent or country', async () => {
  const c = await client().login({ email: 'continent@example.com' });
  await c.json('/api/settings', { method: 'POST', body: { providers: [8] } });
  // A continent value (c:EU) keeps only European titles.
  assert.deepEqual(idsOf((await c.json('/api/recommend?origin=c:EU')).data), new Set([202]), 'only the European (FR) title');
  // A country value (k:JP) keeps only that country's titles.
  assert.deepEqual(idsOf((await c.json('/api/recommend?origin=k:JP')).data), new Set([203]), 'only the Japanese title');
  // Filters combine: non-US European leaves the FR title; excluding it empties out.
  assert.deepEqual(idsOf((await c.json('/api/recommend?origin=c:NA&excludeUs=1')).data), new Set(), 'North America minus US is empty');
});

test('GET /api/origins lists continents with their countries', async () => {
  const c = await client().login({ email: 'origins-ref@example.com' });
  const { status, data } = await c.json('/api/origins');
  assert.equal(status, 200);
  const eu = data.continents.find((x) => x.code === 'EU');
  assert.ok(eu, 'Europe present');
  assert.ok(eu.countries.some(([code]) => code === 'FR'), 'France listed under Europe');
});

test('API key fields are ignored — keys come from the environment only', async () => {
  const c = await client().login({ email: 'plain@example.com' });
  // The settings endpoint no longer manages API keys; key fields are no-ops.
  const { status } = await c.json('/api/settings', { method: 'POST', body: { tmdbKey: 'sneaky' } });
  assert.equal(status, 200);
});

test('provider picker returns services for a region', async () => {
  const c = await client().login({ email: 'prov@example.com' });
  const { status, data } = await c.json('/api/providers?region=PL');
  assert.equal(status, 200);
  assert.ok(data.providers.some((p) => /netflix/i.test(p.name)), 'Netflix Test present from stub');
});

test('delete account erases the user and ends the session', async () => {
  const c = await client().login({ email: 'doomed@example.com' });
  await c.json('/api/ratings', { method: 'POST', body: { tmdb_id: 7, rating: 6, title: 'Se7en' } });
  await c.json('/api/watchlist', { method: 'POST', body: { tmdb_id: 8, title: 'Saved' } });
  const del = await c.raw('/api/me', { method: 'DELETE' });
  assert.equal(del.status, 200);
  // The signed-in account is gone; the cleared cookie now resolves to a fresh
  // anonymous session (the app no longer drops to a login gate) with no data.
  const me = await c.json('/api/me');
  assert.equal(me.data.anonymous, true, 'back to an anonymous session');
  assert.notEqual(me.data.user.email, 'doomed@example.com', 'the old account is gone');
  const ratings = await c.json('/api/ratings');
  assert.deepEqual(ratings.data.ratings, [], 'the deleted account left no data behind');
});

test('onboarded=0 dev-login leaves the user needing onboarding', async () => {
  const c = await client().login({ email: 'fresh@example.com', onboarded: false });
  const { data } = await c.json('/api/me');
  assert.equal(data.user.email, 'fresh@example.com');
  assert.equal(data.onboarded, false);
});
