// The cold corpus build's dominant cost is its per-candidate TMDB detail fetch
// (prod: detailsMs ~32-57s, ~95% of a build). Fetching them one-at-a-time in a
// sequential await loop turns ~500 network round-trips into a serial wait. This
// asserts the detail fetch runs with bounded concurrency instead: we drive a real
// (non-stub) build over a deferred fetch fake and watch how many `/movie/:id`
// detail requests are in flight at once. Sequential → peak 1 (fails); a bounded
// pool → several (passes). We assert a conservative floor so the test pins the
// behaviour (parallel) without coupling to the exact pool size.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshDbEnv } from '../helpers/env.js';

const env = freshDbEnv();
delete process.env.TMDB_STUB; // take the real fetch path so concurrency is observable
const { createAnonUser, upsertRating, setSetting, setUserSetting } = await import('../../src/db.js');
const { buildProfile, buildAndCache } = await import('../../src/taste.js');

const realFetch = globalThis.fetch;
after(() => { globalThis.fetch = realFetch; env.cleanup(); });

// A streamable detail record on the user's provider (8) in their region (PL), so
// survivors > 0 and the build is realistic. Shape mirrors what buildCorpus reads.
const detailJson = (id) => ({
  id, title: `Movie ${id}`, release_date: '2020-01-01', runtime: 100,
  vote_average: 7, vote_count: 500, poster_path: null, overview: '',
  genres: [{ id: 28, name: 'Action' }],
  production_countries: [{ iso_3166_1: 'US', name: 'US' }],
  production_companies: [{ id: 99999, name: 'Indie' }],
  keywords: { keywords: [] },
  credits: { crew: [{ id: 9, job: 'Director', name: 'D' }], cast: [{ id: 5, name: 'A' }] },
  external_ids: { imdb_id: `tt${id}` },
  'watch/providers': { results: { PL: { flatrate: [{ provider_id: 8, provider_name: 'Netflix Test', logo_path: '/n.png' }] } } },
  videos: { results: [] },
});

// 40 candidate ids — comfortably more than any sane concurrency cap, so a parallel
// detail fetch shows a clear peak while a serial one never exceeds 1.
const CANDIDATE_IDS = Array.from({ length: 40 }, (_, i) => 201 + i);
const page = (results) => ({ page: 1, total_pages: 1, results });

test('buildCorpus fetches candidate details with bounded concurrency, not one-at-a-time', async () => {
  setSetting('tmdbKey', 'test-key'); // satisfy auth() on the real path

  let detailInFlight = 0;
  let peakDetailInFlight = 0;
  globalThis.fetch = async (url) => {
    const path = String(url);
    const respond = (body) => ({ ok: true, status: 200, headers: { get: () => null }, async json() { return body; }, async text() { return ''; } });

    const det = path.match(/\/movie\/(\d+)\?/);
    if (det) {
      detailInFlight++;
      peakDetailInFlight = Math.max(peakDetailInFlight, detailInFlight);
      // A real macrotask delay so overlapping fetches actually coexist in flight,
      // rather than each resolving on its own microtask before the next starts.
      await new Promise((r) => setTimeout(r, 5));
      detailInFlight--;
      return respond(detailJson(Number(det[1])));
    }
    if (path.includes('/discover/movie')) return respond(page(CANDIDATE_IDS.map((id) => ({ id, title: `Movie ${id}`, genre_ids: [28] }))));
    if (path.includes('/genre/movie/list')) return respond({ genres: [{ id: 28, name: 'Action' }] });
    if (path.includes('/watch/providers/movie')) return respond({ results: [{ provider_id: 8, provider_name: 'Netflix Test' }] });
    // Recommendations/similar/trending and any other source: empty, so candidates
    // come from Discover alone and the detail count is deterministic.
    return respond(page([]));
  };

  const user = createAnonUser();
  setUserSetting(user.id, 'country', 'PL');
  setUserSetting(user.id, 'providers', [8]);
  // A handful of ratings so the profile is non-trivial; ids disjoint from the
  // candidate set so none are filtered out of the corpus as "already handled".
  for (let id = 9001; id <= 9010; id++) {
    upsertRating({ user_id: user.id, tmdb_id: id, rating: 8, title: `Rated ${id}` });
  }

  // Build the profile first (it fetches the rated titles' details) so the peak we
  // measure below reflects the corpus build's candidate fetch, not the profile's.
  const profile = await buildProfile(user.id);
  peakDetailInFlight = 0;

  const result = await buildAndCache({
    userId: user.id, region: 'PL', providerIds: [8], genreId: undefined,
    profile, ratings: [], language: 'en-US', filters: {},
  });

  assert.ok(result.pool.length > 0, 'the build produced a non-empty pool (candidates survived)');
  assert.ok(
    peakDetailInFlight >= 5,
    `expected the candidate detail fetch to run several in parallel, but peak in-flight was ${peakDetailInFlight} ` +
    '(1 means the sequential await loop — the slow path this guards against)',
  );
});
