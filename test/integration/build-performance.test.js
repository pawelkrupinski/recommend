// Performance guardrails for the cold recommendation build — the work behind the
// "Building your picks…" spinner. Two properties keep it fast, and both are easy
// to regress silently by adding candidate sources (e.g. a new media type):
//
//   1. The foreground HEAD build must STOP EARLY — fetch details for only enough
//      candidates to fill a page (survivorTarget), NOT the whole gathered pool.
//      Detail fetches are ~95% of a build's wall time, so an unbounded head fetch
//      is the slow path. We flood the gather with 400 candidates and assert the
//      head fetches a small fraction of them.
//   2. The gather fan-out (the TMDB list calls before any detail fetch) must stay
//      bounded. A per-genre Discover sweep is ~one call per genre; registering a
//      second full fan-out (a per-media-type one) roughly doubles the cold gather
//      load and the detail-cache working set. We cap the TMDB list-call count.
//
// Driven over a real (non-stub) fetch fake, the same seam corpus-fetch-concurrency
// uses, so the counts reflect the actual source registry.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshDbEnv } from '../helpers/env.js';

const env = freshDbEnv();
delete process.env.TMDB_STUB; // real fetch path so the source fan-out is observable
const { createAnonUser, setSetting, setUserSetting } = await import('../../src/db.js');
const { buildProfile, buildAndCache } = await import('../../src/taste.js');

const realFetch = globalThis.fetch;
after(() => { globalThis.fetch = realFetch; env.cleanup(); });

const respond = (body) => ({ ok: true, status: 200, headers: { get: () => null }, async json() { return body; }, async text() { return ''; } });
const onNetflix = { results: { PL: { flatrate: [{ provider_id: 8, provider_name: 'Netflix Test', logo_path: '/n.png' }] } } };
const movieDetail = (id) => ({ id, title: `M${id}`, release_date: '2020-01-01', runtime: 100, vote_average: 7, vote_count: 500, genres: [{ id: 100, name: 'G' }], production_countries: [{ iso_3166_1: 'US' }], production_companies: [{ id: 9, name: 'x' }], keywords: { keywords: [] }, credits: { crew: [], cast: [] }, external_ids: {}, 'watch/providers': onNetflix, videos: { results: [] } });
const tvDetail = (id) => ({ id, name: `T${id}`, first_air_date: '2019-01-01', number_of_seasons: 2, number_of_episodes: 10, vote_average: 8, vote_count: 400, genres: [{ id: 200, name: 'G' }], origin_country: ['US'], production_companies: [{ id: 9, name: 'x' }], keywords: { results: [] }, credits: { crew: [], cast: [] }, external_ids: {}, 'watch/providers': onNetflix, videos: { results: [] } });

// Big page-1 pools so a full fetch (the regression) is plainly distinguishable
// from a bounded head fetch. All stream on provider 8, so every candidate survives.
const MOVIE_POOL = Array.from({ length: 200 }, (_, i) => ({ id: 1000 + i, title: `M${i}`, genre_ids: [100] }));
const TV_POOL = Array.from({ length: 200 }, (_, i) => ({ id: 5000 + i, name: `T${i}`, genre_ids: [200] }));
const MOVIE_GENRES = Array.from({ length: 19 }, (_, i) => ({ id: 100 + i, name: `MG${i}` }));
const TV_GENRES = Array.from({ length: 16 }, (_, i) => ({ id: 200 + i, name: `TG${i}` }));

test('the fast head gathers lean (no per-genre fan-out); the full build keeps it', async () => {
  setSetting('tmdbKey', 'test-key');

  let detailCalls = 0;      // /movie/:id + /tv/:id — the dominant per-title cost
  let tmdbListCalls = 0;    // TMDB discover/genre/trending — the gather fan-out
  let genreFanoutCalls = 0; // per-genre Discover sweeps (with_genres=…) — the priciest
  globalThis.fetch = async (url) => {
    const s = String(url);
    const path = s.replace('https://api.themoviedb.org/3', '');
    const m = path.match(/^\/movie\/(\d+)\?/); if (m) { detailCalls++; return respond(movieDetail(Number(m[1]))); }
    const t = path.match(/^\/tv\/(\d+)\?/); if (t) { detailCalls++; return respond(tvDetail(Number(t[1]))); }
    if (s.startsWith('https://api.themoviedb.org')) {
      tmdbListCalls++;
      if (path.startsWith('/discover/movie')) {
        if (path.includes('with_genres=')) genreFanoutCalls++;
        return respond({ page: 1, total_pages: 1, results: MOVIE_POOL });
      }
      if (path.startsWith('/discover/tv')) {
        if (path.includes('with_genres=')) genreFanoutCalls++;
        return respond({ page: 1, total_pages: 1, results: TV_POOL });
      }
      if (path.startsWith('/genre/movie/list')) return respond({ genres: MOVIE_GENRES });
      if (path.startsWith('/genre/tv/list')) return respond({ genres: TV_GENRES });
      return respond({ page: 1, total_pages: 1, results: [] });
    }
    return respond({ page: 1, total_pages: 1, results: [] }); // scraper hosts: inert
  };

  const user = createAnonUser();
  setUserSetting(user.id, 'country', 'PL');
  setUserSetting(user.id, 'providers', [8]);
  const profile = await buildProfile(user.id);

  // ── fast foreground HEAD build: lean HEAD_SOURCES, stops early ──────────────
  detailCalls = 0; tmdbListCalls = 0; genreFanoutCalls = 0;
  const head = await buildAndCache({
    userId: user.id, region: 'PL', providerIds: [8], genreId: undefined,
    profile, ratings: [], language: 'en-US', filters: {}, survivorTarget: 60,
  });
  assert.ok(head.pool.length >= 60, `head build filled a page (pool=${head.pool.length})`);
  // Stops near survivorTarget, not the whole ~400-candidate pool (the slow regression).
  assert.ok(detailCalls < 120, `head build fetched ${detailCalls} details — expected it to stop near 60`);
  // The head gathers from the lean HEAD_SOURCES (provider-scoped Discover + trending
  // only), so it does the priciest source — the per-genre Discover fan-out — ZERO
  // times. This is the cold-build speedup; a regression re-adds the fan-out here.
  assert.equal(genreFanoutCalls, 0, `head must skip the per-genre fan-out (did ${genreFanoutCalls})`);
  const headListCalls = tmdbListCalls;

  // ── deep background FULL build: rich ALL_SOURCES, keeps the fan-out ──────────
  detailCalls = 0; tmdbListCalls = 0; genreFanoutCalls = 0;
  await buildAndCache({
    userId: user.id, region: 'PL', providerIds: [8], genreId: undefined,
    profile, ratings: [], language: 'en-US', filters: {}, // no survivorTarget → full build
  });
  assert.ok(genreFanoutCalls > 0, 'the full build still does the per-genre fan-out for breadth');
  assert.ok(headListCalls < tmdbListCalls, `head gather (${headListCalls}) must be leaner than full (${tmdbListCalls})`);
  // Guard against a SECOND full per-genre fan-out (e.g. for TV) creeping into the
  // full build and roughly doubling its cold gather cost.
  assert.ok(genreFanoutCalls < 25, `full build genre fan-out unexpectedly large (${genreFanoutCalls})`);
});
