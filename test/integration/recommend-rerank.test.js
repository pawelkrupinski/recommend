// The recommendation build is split into two cached layers: an expensive,
// taste-independent CORPUS (candidate gather + ~500 detail fetches + enrichment)
// and a cheap RANKING pass over it. A rating invalidates only the ranking, so it
// re-ranks the cached corpus (~100ms) instead of paying the whole ~5s rebuild;
// only a missing corpus or a forced Refresh rebuilds it.
//
// We prove the seam with a sentinel: a card hand-injected into the cached corpus
// survives a re-rank (the corpus is reused) but vanishes on a forced rebuild (the
// corpus is regenerated from the source stub, which never produces it). The
// background prebuild — the other thing that would rebuild the corpus — is off.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshDbEnv } from '../helpers/env.js';

const env = freshDbEnv();              // sets TMDB_STUB=1 + a throwaway DB
process.env.DISABLE_REC_PREBUILD = '1'; // no background corpus rebuild during the test
const { createAnonUser, upsertRating, cacheGet, cacheSet } = await import('../../src/db.js');
const { recommend, invalidateRecommendations, resolveFilters, corpusKey } = await import('../../src/taste.js');
after(() => env.cleanup());

const REGION = 'PL', PROVIDERS = [8];
const ids = (out) => out.results.map((m) => m.tmdb_id);
// A high-quality card the source stub can never produce (id 999001), so its
// presence in the served pool means the cached corpus we planted it in was reused.
const SENTINEL = {
  tmdb_id: 999001, imdb_id: null, title: 'Corpus Sentinel', year: 2020, runtime: 100,
  overview: '', poster_path: null, vote_average: 9.6, voteCount: 500_000,
  genres: ['Action'], genreIds: [28], tones: [], features: [], director: null,
  cast: [], trailers: [], services: [{ id: 8, name: 'Netflix' }], collab: 0,
};

test('a rating re-ranks the cached corpus in place; a forced refresh rebuilds it', async () => {
  const user = createAnonUser();
  for (let i = 0; i < 12; i++) {
    upsertRating({ user_id: user.id, tmdb_id: 900 + i, rating: 8, title: `Seed ${i}`, year: 2019 });
  }

  // Cold build: populates both the corpus and the ranked-pool caches.
  const built = await recommend({ userId: user.id, region: REGION, providerIds: PROVIDERS, limit: 36 });
  assert.ok(built.results.length > 0, 'the cold build yields a non-empty pool');
  assert.ok(!ids(built).includes(SENTINEL.tmdb_id), 'the stub never produces the sentinel on its own');

  // Plant the sentinel inside the cached corpus, then bump recGen so the next
  // serve must re-rank (rather than return the already-cached ranked pool).
  const key = corpusKey(user.id, REGION, PROVIDERS, undefined, undefined, resolveFilters());
  const corpus = cacheGet(key);
  assert.ok(corpus?.cards?.length, 'the build cached a corpus under corpusKey');
  corpus.cards.unshift({ ...SENTINEL });
  cacheSet(key, corpus);
  invalidateRecommendations(user.id);

  // Re-rank path: reuses the (now sentinel-bearing) corpus → sentinel surfaces.
  const reranked = await recommend({ userId: user.id, region: REGION, providerIds: PROVIDERS, limit: 36 });
  assert.ok(
    ids(reranked).includes(SENTINEL.tmdb_id),
    'after a rating the cached corpus is re-ranked in place (sentinel survives) — no rebuild',
  );

  // Forced Refresh: rebuilds the corpus from the stub → the planted sentinel is gone.
  const refreshed = await recommend({ userId: user.id, region: REGION, providerIds: PROVIDERS, limit: 36, force: true });
  assert.ok(
    !ids(refreshed).includes(SENTINEL.tmdb_id),
    'a forced refresh rebuilds the corpus from source (sentinel dropped)',
  );
  assert.ok(refreshed.results.length > 0, 'the rebuilt pool is still non-empty');
});
