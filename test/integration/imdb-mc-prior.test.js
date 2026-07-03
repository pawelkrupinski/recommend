// The quality prior is built from IMDb + Metacritic, not TMDB (scoring.qualityPrior).
// Three seams make that work end-to-end:
//   (e) ratings are cached DURABLY (survive a restart) and now carry IMDb's vote
//       count, which the Bayesian shrink needs;
//   (f) a corpus build BAKES those cached ratings onto its cards with no network,
//       so rankCorpus can score on them;
//   (g) a background prefetch pass tops up a served corpus's ratings OFF the request
//       critical path, so the next build's bake covers more candidates.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshDbEnv } from '../helpers/env.js';

const env = freshDbEnv(); // TMDB_STUB=1 + a throwaway DB. Prebuild left enabled so the
                          // prefetch pass (same gate) is active for (g); force builds
                          // used throughout never schedule a background prebuild anyway.
const { createAnonUser, upsertRating, cacheGet, cacheSet } = await import('../../src/db.js');
const { tmdbCacheGet } = await import('../../src/tmdb-cache.js');
const { imdbRatingDetail, imdbRating, cachedImdbDetail, slugify, RATINGS_TTL } =
  await import('../../src/ratings.js');
const { recommend, resolveFilters, corpusKey, setRatingPrefetcher, resetRatingPrefetcher } =
  await import('../../src/taste.js');
after(() => { resetRatingPrefetcher(); env.cleanup(); });

const REGION = 'PL', PROVIDERS = [8];
const seedRatings = (userId) => {
  for (let i = 0; i < 12; i++) {
    upsertRating({ user_id: userId, tmdb_id: 900 + i, rating: 8, title: `Seed ${i}`, year: 2019 });
  }
};

// (e) --------------------------------------------------------------------------
test('imdbRatingDetail persists {rating,votes} to the DURABLE cache, not the capped store', async () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return { ok: true, json: async () => ({
      data: { title: { ratingsSummary: { aggregateRating: 8.7, voteCount: 1234567 } } },
    }) };
  };
  try {
    const detail = await imdbRatingDetail('tt0111161');
    // The vote count is the new bit the Bayesian prior needs — assert it's kept.
    assert.deepEqual(detail, { rating: 8.7, votes: 1234567 }, 'rating AND vote count captured');
    // Second lookup is served from cache (durable read-through), no second fetch.
    assert.deepEqual(await imdbRatingDetail('tt0111161'), detail);
    assert.equal(calls, 1, 'the rating was cached — no repeat network call');
    // The thin badge accessor derives the rating from the same cached detail.
    assert.equal(await imdbRating('tt0111161'), 8.7);
    // It lives in the DURABLE db cache (what buildCorpus bakes from), NOT the
    // ephemeral capped TMDB cache — so it survives a restart.
    assert.deepEqual(cacheGet('imdb:rating:tt0111161', RATINGS_TTL), { rating: 8.7, votes: 1234567 });
    assert.equal(tmdbCacheGet('imdb:rating:tt0111161', RATINGS_TTL), undefined,
      'not written to the ephemeral capped store');
    assert.deepEqual(cachedImdbDetail('tt0111161'), { rating: 8.7, votes: 1234567 },
      'the cache-only reader (used by the build bake) sees it');
  } finally {
    globalThis.fetch = realFetch;
  }
});

// (f) --------------------------------------------------------------------------
test('a corpus build bakes cached IMDb/Metacritic onto its cards, with no fetch', async () => {
  const user = createAnonUser();
  seedRatings(user.id);
  const key = corpusKey(user.id, REGION, PROVIDERS, undefined, undefined, resolveFilters());

  // Cold build to discover a real stub candidate + its imdb_id. Nothing is cached
  // yet, so its baked rating fields are null.
  await recommend({ userId: user.id, region: REGION, providerIds: PROVIDERS, limit: 36, force: true });
  const sample = cacheGet(key).cards.find((c) => c.imdb_id);
  assert.ok(sample, 'a candidate carries an imdb_id to key IMDb on');
  assert.equal(sample.imdbRating, null, 'nothing baked before the cache is seeded');
  assert.equal(sample.metascore, null);

  // Seed the DURABLE rating cache for that title (attachRatings is a no-op under the
  // TMDB stub, so the only way these can reach the card is the cache-only bake).
  cacheSet(`imdb:rating:${sample.imdb_id}`, { rating: 8.9, votes: 654321 });
  cacheSet(`mc:score:${slugify(sample.title)}:${sample.year ?? ''}`, 91);

  await recommend({ userId: user.id, region: REGION, providerIds: PROVIDERS, limit: 36, force: true });
  const baked = cacheGet(key).cards.find((c) => c.tmdb_id === sample.tmdb_id);
  assert.equal(baked.imdbRating, 8.9, 'IMDb rating baked from the durable cache');
  assert.equal(baked.imdbVotes, 654321, 'IMDb vote count baked (for the Bayesian shrink)');
  assert.equal(baked.metascore, 91, 'Metacritic score baked');
});

// (g) --------------------------------------------------------------------------
test('recommend schedules the rating prefetch OFF the critical path, over the corpus candidates', async () => {
  const user = createAnonUser();
  seedRatings(user.id);

  let captured = null;
  // A prefetcher that never resolves: if recommend awaited it, recommend would hang.
  setRatingPrefetcher((cards) => { captured = cards; return new Promise(() => {}); });

  const out = await recommend({ userId: user.id, region: REGION, providerIds: PROVIDERS, limit: 36, force: true });
  assert.ok(out.results.length > 0, 'recommend returned despite the prefetch never finishing — it is fire-and-forget');

  // Let the fire-and-forget microtask run.
  await new Promise((r) => setImmediate(r));
  assert.ok(captured?.length > 0, 'the prefetch pass was handed the corpus candidates');
  assert.ok(captured.every((c) => c.tmdb_id != null && 'imdb_id' in c && 'title' in c),
    'each candidate carries what attachRatings needs to resolve a rating');
});
