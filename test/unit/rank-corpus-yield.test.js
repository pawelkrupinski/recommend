// Regression test for the watchlist-save (and /health) stall: the recommendation
// build's scoring + re-rank pass — IDF, per-card score, sort, MMR re-rank — runs
// as a synchronous block. node:sqlite is synchronous and warm cache hits resolve
// without real I/O, so on a large candidate pool that block held the event loop
// for the whole pass; every concurrent request (a POST /api/watchlist, a /health
// probe) was queued behind it and only answered once scoring finished — the
// up-to-10s "sluggish add" the users saw. This pass is also the one a rating now
// re-runs over the cached corpus, so it stays on the interaction path.
//
// rankCorpus() yields to the macrotask queue every YIELD_EVERY cards, so the loop
// services live traffic between chunks. We assert that by the same ordering trick
// the build's event-loop regression test uses: a setTimeout(0) callback is a
// timers-phase macrotask that can only fire if the scoring pass releases the loop
// mid-run. Remove the `await breathe()` in rankCorpus and this fails (the probe
// fires only after the whole pass completes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDbEnv } from '../helpers/env.js';

freshDbEnv();
const { rankCorpus } = await import('../../src/taste.js');

// A cached-corpus card: the scoring-ready shape buildCorpus produces — feature
// ids, community votes, genre ids and collab bonus — minus the per-profile score
// rankCorpus computes. Minimal but real-shaped, enough for scoreCandidate, the
// sort and the MMR re-rank to run.
const card = (id) => ({
  tmdb_id: id, imdb_id: `tt${id}`, title: `Movie ${id}`, year: 2020, runtime: 100,
  overview: '', poster_path: null, vote_average: 7, voteCount: 500,
  genres: ['Action'], genreIds: [28], tones: [], features: ['genre:28'],
  director: 'D', cast: ['A'], trailers: [], services: [], collab: 0,
});

const profile = {
  pos: new Map(), neg: new Map(), counts: new Map(), mean: 7, count: 0,
  ratedFeatureSets: [], genreLists: [[28]],
};

test('rankCorpus yields the event loop while scoring a large corpus', async () => {
  // More than YIELD_EVERY (16) cards, so the scoring loop must hit at least one
  // yield point partway through.
  const corpus = { cards: Array.from({ length: 40 }, (_, i) => card(i + 1)), globalMean: 7 };

  let finished = false;
  let probeFiredMidRun = false;
  const probe = new Promise((resolve) => setTimeout(() => {
    probeFiredMidRun = !finished;
    resolve();
  }, 0));

  const ranked = rankCorpus(corpus, profile).then((r) => { finished = true; return r; });
  const [result] = await Promise.all([ranked, probe]);

  assert.ok(
    probeFiredMidRun,
    'the scoring pass held the event loop for its entire run — a concurrent watchlist save / health check would stall behind it',
  );
  // Sanity: every card scored and ranked (well under POOL_SIZE), output intact and
  // the scoring-only fields stripped from the served card.
  assert.equal(result.length, 40);
  assert.ok(result.every((c) => typeof c.score === 'number' && c.tmdb_id != null));
  assert.ok(result.every((c) => c.features === undefined && c.voteCount === undefined));
});
