// Performance guardrail for the cold recommendation build of a FILTERED Discover
// view (the non-US origin toggle, indie, a tone, a selected genre). Properties that
// keep those views as fast as the unfiltered landing pool — all easy to regress:
//
//   1. A filtered cold build must serve a fast HEAD (survivorTarget), not the full
//      ~500-candidate build up front. recommend() used to gate the head on the
//      unfiltered LANDING signature, so ANY filter fell back to the slow full build
//      — the "non-US picks take ages" report.
//   2. The head's survivorTarget stop is unreachable when a hard filter drops most
//      of what it fetches (origin/indie/tone run AFTER the detail fetch). Without a
//      second bound the head walks the whole pool anyway. HEAD_FETCH_BUDGET caps the
//      head's fetch COUNT so a sparse filter can't reintroduce full-build latency.
//   3. A selected genre must pre-filter the pool by each candidate's list-level
//      genre_ids BEFORE the detail fetch — the seed/chart sources aren't genre-scoped
//      at source, so a sparse genre (Documentary) otherwise spends the whole fetch
//      budget on non-genre titles dropped post-fetch: the "genre takes ages" head.
//
// Driven over a real (non-stub) fetch fake — the same seam build-performance uses —
// so the detail-fetch counts reflect the actual source registry and build path.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshDbEnv } from '../helpers/env.js';

const env = freshDbEnv();
process.env.DISABLE_REC_PREBUILD = '1'; // no background deepen racing the fetch counts
delete process.env.TMDB_STUB;           // real fetch path so the build is observable
const { createAnonUser, setSetting, setUserSetting } = await import('../../src/db.js');
const { buildProfile, buildAndCache, recommend, resolveFilters } = await import('../../src/taste.js');

const realFetch = globalThis.fetch;
after(() => { globalThis.fetch = realFetch; env.cleanup(); });

const respond = (body) => ({ ok: true, status: 200, headers: { get: () => null }, async json() { return body; }, async text() { return ''; } });
const streamsOn = (providerId) => ({ results: { PL: { flatrate: [{ provider_id: providerId, provider_name: `Prov ${providerId}`, logo_path: '/p.png' }] } } });
// `country` drives the origin filter; the title streams on the test's provider so
// the streamability gate keeps whatever the origin filter lets through.
const movieDetail = (id, country, providerId) => ({ id, title: `M${id}`, release_date: '2020-01-01', runtime: 100, vote_average: 7, vote_count: 500, genres: [{ id: 100, name: 'G' }], production_countries: [{ iso_3166_1: country }], production_companies: [{ id: 9, name: 'x' }], keywords: { keywords: [] }, credits: { crew: [], cast: [] }, external_ids: {}, 'watch/providers': streamsOn(providerId), videos: { results: [] } });
const tvDetail = (id, providerId) => ({ id, name: `T${id}`, first_air_date: '2019-01-01', number_of_seasons: 1, number_of_episodes: 1, vote_average: 7, vote_count: 100, genres: [{ id: 200, name: 'G' }], origin_country: ['US'], production_companies: [{ id: 9, name: 'x' }], keywords: { results: [] }, credits: { crew: [], cast: [] }, external_ids: {}, 'watch/providers': streamsOn(providerId), videos: { results: [] } });

const MOVIE_GENRES = Array.from({ length: 19 }, (_, i) => ({ id: 100 + i, name: `MG${i}` }));

// Install a fetch fake whose discover pool is `poolSize` movies starting at
// `idBase`; `countryFor(i)` decides each title's production country (so a test can
// make survival sparse or dense). Each test uses its own idBase AND providerId so
// the process-wide tmdb caches (detail keyed by id, discover-list keyed by the
// provider-scoped URL) never serve one test's pool to another. Returns a live
// `counts` object the test reads after the build.
function installFetch(poolSize, countryFor, idBase, providerId) {
  const counts = { detail: 0 };
  const pool = Array.from({ length: poolSize }, (_, i) => ({ id: idBase + i, title: `M${i}`, genre_ids: [100] }));
  globalThis.fetch = async (url) => {
    const s = String(url);
    const path = s.replace('https://api.themoviedb.org/3', '');
    const m = path.match(/^\/movie\/(\d+)\?/); if (m) { counts.detail++; return respond(movieDetail(Number(m[1]), countryFor(Number(m[1]) - idBase), providerId)); }
    const t = path.match(/^\/tv\/(\d+)\?/); if (t) { counts.detail++; return respond(tvDetail(Number(t[1]), providerId)); }
    if (s.startsWith('https://api.themoviedb.org')) {
      if (path.startsWith('/discover/movie')) return respond({ page: 1, total_pages: 1, results: pool });
      if (path.startsWith('/discover/tv')) return respond({ page: 1, total_pages: 1, results: [] });
      if (path.startsWith('/genre/movie/list')) return respond({ genres: MOVIE_GENRES });
      if (path.startsWith('/genre/tv/list')) return respond({ genres: [] });
      return respond({ page: 1, total_pages: 1, results: [] });
    }
    return respond({ page: 1, total_pages: 1, results: [] }); // scraper hosts: inert
  };
  return counts;
}

// (1) When a hard filter drops (almost) everything, the head's survivorTarget stop
// never trips — the fetch budget must stop it before it walks the whole pool.
test('a sparse filtered head build stops at the fetch budget, not the whole pool', async () => {
  setSetting('tmdbKey', 'test-key');
  const counts = installFetch(300, () => 'US', 1000, 8); // every candidate US → excludeUs drops all

  const user = createAnonUser();
  setUserSetting(user.id, 'country', 'PL');
  setUserSetting(user.id, 'providers', [8]);
  const profile = await buildProfile(user.id);
  counts.detail = 0;

  const result = await buildAndCache({
    userId: user.id, region: 'PL', providerIds: [8], genreId: undefined,
    profile, ratings: [], language: 'en-US', filters: resolveFilters({ excludeUs: true }), survivorTarget: 60,
  });

  // No US candidate survives excludeUs, so the survivor stop is unreachable. The
  // head must still stop at the budget (~160 + at most one concurrency batch),
  // NOT fetch all 300 (the full-build latency this guards against).
  assert.ok(
    counts.detail <= 168,
    `sparse filtered head fetched ${counts.detail} details — expected it to stop at the fetch budget, not walk the whole ~300-candidate pool`,
  );
  assert.equal(result.partial, true, 'a budget-capped head left candidates unfetched (partial → to be deepened)');
});

// (2) recommend() must serve a fast HEAD for a filtered view too, not the slow full
// build — the "non-US picks take ages" regression. With survivors present the head
// stops at survivorTarget, fetching a small fraction of the pool.
test('recommend() serves a fast head for a filtered (non-US) view, not the full build', async () => {
  setSetting('tmdbKey', 'test-key');
  // Half the pool is non-US (FR) so the excludeUs view has plenty of survivors and
  // the head stops on survivorTarget well before the pool is exhausted.
  const counts = installFetch(300, (i) => (i % 2 === 0 ? 'FR' : 'US'), 4000, 9);

  const user = createAnonUser();
  setUserSetting(user.id, 'country', 'PL');
  setUserSetting(user.id, 'providers', [9]);
  await buildProfile(user.id);
  counts.detail = 0;

  const { results } = await recommend({
    userId: user.id, region: 'PL', providerIds: [9], genreId: undefined,
    language: 'en-US', filters: resolveFilters({ excludeUs: true }),
  });

  assert.ok(results.length > 0, 'the filtered head still returns picks');
  // A full build would fetch all ~300; a head stops near survivorTarget (60) plus a
  // concurrency batch. < 150 proves recommend() took the head path for the filter.
  assert.ok(
    counts.detail < 150,
    `filtered recommend() fetched ${counts.detail} details — expected the fast head (~60), not the full ~300-candidate build`,
  );
});

// (3) A selected genre must drop non-genre candidates by their list-level genre_ids
// BEFORE the detail fetch. The seed/chart sources aren't genre-scoped, so a sparse
// genre otherwise fetches the whole HEAD_FETCH_BUDGET of non-genre titles only to
// drop them post-fetch — the "genre takes ages" head. Install a mixed pool where a
// small minority carries the target genre; the build must fetch ~only those.
const DOC_GENRE = 99, ACTION_GENRE = 28, DOC_COUNT = 40;
// Discover pool whose items carry per-item genre_ids (as TMDB list responses do):
// the first DOC_COUNT are Documentaries, the rest Action. Details echo the same
// single genre, so the authoritative post-fetch check agrees with the list tag.
function installGenreFetch(poolSize, idBase, providerId) {
  const counts = { detail: 0 };
  const genreOf = (i) => (i < DOC_COUNT ? DOC_GENRE : ACTION_GENRE);
  const pool = Array.from({ length: poolSize }, (_, i) => ({ id: idBase + i, title: `M${i}`, genre_ids: [genreOf(i)] }));
  globalThis.fetch = async (url) => {
    const s = String(url);
    const path = s.replace('https://api.themoviedb.org/3', '');
    const m = path.match(/^\/movie\/(\d+)\?/);
    if (m) { counts.detail++; const id = Number(m[1]); return respond({ ...movieDetail(id, 'FR', providerId), genres: [{ id: genreOf(id - idBase), name: 'G' }] }); }
    const t = path.match(/^\/tv\/(\d+)\?/); if (t) { counts.detail++; return respond(tvDetail(Number(t[1]), providerId)); }
    if (s.startsWith('https://api.themoviedb.org')) {
      if (path.startsWith('/discover/movie')) return respond({ page: 1, total_pages: 1, results: pool });
      if (path.startsWith('/discover/tv')) return respond({ page: 1, total_pages: 1, results: [] });
      if (path.startsWith('/genre/movie/list')) return respond({ genres: MOVIE_GENRES });
      if (path.startsWith('/genre/tv/list')) return respond({ genres: [] });
      return respond({ page: 1, total_pages: 1, results: [] });
    }
    return respond({ page: 1, total_pages: 1, results: [] });
  };
  return counts;
}

test('a genre view pre-filters by genre_ids and fetches ~only the genre, not the whole budget', async () => {
  setSetting('tmdbKey', 'test-key');
  // 300 candidates, only DOC_COUNT (40) tagged Documentary. A full head would fetch
  // the whole HEAD_FETCH_BUDGET (~160) — 40 docs never reach survivorTarget (60).
  const counts = installGenreFetch(300, 6000, 11);

  const user = createAnonUser();
  setUserSetting(user.id, 'country', 'PL');
  setUserSetting(user.id, 'providers', [11]);
  await buildProfile(user.id);
  counts.detail = 0;

  const { results } = await recommend({
    userId: user.id, region: 'PL', providerIds: [11], genreId: DOC_GENRE,
    language: 'en-US', filters: resolveFilters({ type: 'movie' }),
  });

  assert.ok(results.length > 0, 'the genre view still returns picks');
  // With the pre-filter the pool is the 40 docs, so the head fetches ~only those.
  // Without it, non-doc candidates get fetched then dropped post-fetch until the
  // budget (~160) — the regression. Allow the 40 docs plus one concurrency batch.
  assert.ok(
    counts.detail <= DOC_COUNT + 8,
    `genre view fetched ${counts.detail} details — expected ~${DOC_COUNT} (pre-filtered to the genre), not the full ~160 fetch budget`,
  );
});
