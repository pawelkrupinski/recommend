// The shared-detail warmer pre-fetches the popular head candidates' details into
// the GLOBAL (cross-user) TMDB cache, once per distinct (region, providers,
// language) config — so a user's cold head build hits warm details instead of
// re-paying the dominant per-title fetch cost (~95% of a build's wall time), and
// a deploy that wipes the ephemeral cache re-warms proactively. Driven over a real
// (non-stub) fetch fake, the same seam the build uses.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshDbEnv } from '../helpers/env.js';

const env = freshDbEnv();
delete process.env.TMDB_STUB;
const { createAnonUser, upsertRating, setSetting, setUserSetting } = await import('../../src/db.js');
const { buildProfile, buildAndCache, warmConfigDetails, distinctWarmConfigs } = await import('../../src/taste.js');

const realFetch = globalThis.fetch;
after(() => { globalThis.fetch = realFetch; env.cleanup(); });

const respond = (body) => ({ ok: true, status: 200, headers: { get: () => null }, async json() { return body; }, async text() { return ''; } });
const onNetflix = { results: { PL: { flatrate: [{ provider_id: 8, provider_name: 'Netflix Test', logo_path: '/n.png' }] } } };
const movieDetail = (id) => ({ id, title: `M${id}`, release_date: '2020-01-01', runtime: 100, vote_average: 7, vote_count: 500, genres: [{ id: 100, name: 'G' }], production_countries: [{ iso_3166_1: 'US' }], production_companies: [{ id: 9 }], keywords: { keywords: [] }, credits: { crew: [], cast: [] }, external_ids: {}, 'watch/providers': onNetflix, videos: { results: [] } });
const tvDetail = (id) => ({ id, name: `T${id}`, first_air_date: '2019-01-01', number_of_seasons: 2, number_of_episodes: 10, vote_average: 8, vote_count: 400, genres: [{ id: 200, name: 'G' }], origin_country: ['US'], production_companies: [{ id: 9 }], keywords: { results: [] }, credits: { crew: [], cast: [] }, external_ids: {}, 'watch/providers': onNetflix, videos: { results: [] } });
const MOVIE_POOL = Array.from({ length: 200 }, (_, i) => ({ id: 1000 + i, title: `M${i}`, genre_ids: [100] }));
const TV_POOL = Array.from({ length: 200 }, (_, i) => ({ id: 5000 + i, name: `T${i}`, genre_ids: [200] }));

let detailCalls = 0;
globalThis.fetch = async (url) => {
  const s = String(url);
  const path = s.replace('https://api.themoviedb.org/3', '');
  const m = path.match(/^\/movie\/(\d+)\?/); if (m) { detailCalls++; return respond(movieDetail(Number(m[1]))); }
  const t = path.match(/^\/tv\/(\d+)\?/); if (t) { detailCalls++; return respond(tvDetail(Number(t[1]))); }
  if (s.startsWith('https://api.themoviedb.org')) {
    if (path.startsWith('/discover/movie')) return respond({ page: 1, total_pages: 1, results: MOVIE_POOL });
    if (path.startsWith('/discover/tv')) return respond({ page: 1, total_pages: 1, results: TV_POOL });
    return respond({ page: 1, total_pages: 1, results: [] });
  }
  return respond({ page: 1, total_pages: 1, results: [] });
};

test('distinctWarmConfigs dedupes ready users by (region, providers, language)', () => {
  setSetting('tmdbKey', 'test-key');
  const a = createAnonUser(); setUserSetting(a.id, 'country', 'PL'); setUserSetting(a.id, 'providers', [8]);
  const b = createAnonUser(); setUserSetting(b.id, 'country', 'PL'); setUserSetting(b.id, 'providers', [8]);        // same config as a
  const c = createAnonUser(); setUserSetting(c.id, 'country', 'US'); setUserSetting(c.id, 'providers', [8, 337]);   // different
  const d = createAnonUser(); setUserSetting(d.id, 'country', 'PL'); setUserSetting(d.id, 'providers', []);         // no services → skipped
  for (const u of [a, b, c, d]) for (let i = 0; i < 12; i++) upsertRating({ user_id: u.id, tmdb_id: 900 + i, rating: 8, title: 'x', year: 2019 });

  const configs = [...distinctWarmConfigs().values()];
  assert.equal(configs.length, 2, `two distinct configs (a/b share one, c is another, d skipped) — got ${configs.length}`);
});

test('warming a config makes a subsequent head build hit the warm shared cache', async () => {
  setSetting('tmdbKey', 'test-key');
  const user = createAnonUser();
  setUserSetting(user.id, 'country', 'PL');
  setUserSetting(user.id, 'providers', [8]);
  for (let i = 0; i < 12; i++) upsertRating({ user_id: user.id, tmdb_id: 900 + i, rating: 8, title: 'x', year: 2019 });

  const profile = await buildProfile(user.id); // fetch the rated titles' details once, up front
  const cfg = [...distinctWarmConfigs().values()].find((c) => c.region === 'PL');

  detailCalls = 0;
  const warmed = await warmConfigDetails(cfg);
  assert.ok(warmed > 0 && detailCalls > 0, `the warm fetched candidate details (pool=${warmed}, fetched=${detailCalls})`);

  // Now the head build for a user on that config should re-fetch ~nothing.
  detailCalls = 0;
  const head = await buildAndCache({
    userId: user.id, region: cfg.region, providerIds: cfg.providerIds, genreId: undefined,
    profile, ratings: [], language: cfg.language, filters: {}, survivorTarget: 60,
  });
  assert.ok(head.pool.length >= 60, `head still fills a page (pool=${head.pool.length})`);
  assert.ok(detailCalls < 10, `head build hit the warm shared cache (fetched ${detailCalls} details, expected ~0)`);
});
