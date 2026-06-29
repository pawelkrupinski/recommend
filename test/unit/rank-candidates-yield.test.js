// Regression test for the watchlist-save (and /health) stall: the recommendation
// build's scoring + re-rank pass — IDF, a per-survivor card build, sort, MMR
// re-rank — used to run inline in computePool as one unbroken synchronous block.
// node:sqlite is synchronous and warm cache hits resolve without real I/O, so on a
// large candidate pool that block held the event loop for the whole scoring pass;
// every concurrent request (a POST /api/watchlist, a /health probe) was queued
// behind it and only answered once scoring finished — the up-to-10s "sluggish add"
// the users saw. (The sibling batch-tone-reads fix removed the synchronous DB N+1
// inside this loop; this guards the loop's remaining synchronous CPU.)
//
// rankCandidates() now yields to the macrotask queue every YIELD_EVERY cards, so
// the loop services live traffic between chunks. We assert that by the same
// ordering trick the build's event-loop regression test uses: a setTimeout(0)
// callback is a timers-phase macrotask that can only fire if the scoring pass
// releases the loop mid-run. Remove the `await breathe()` in rankCandidates and
// this fails (the probe fires only after the whole pass completes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDbEnv } from '../helpers/env.js';

freshDbEnv();
const { rankCandidates } = await import('../../src/taste.js');

// A computePool first-pass "survivor": its fetched TMDB detail, extracted feature
// ids, matched services and collab bonus. Minimal but real-shaped — enough for
// scoreCandidate, tonesForMovie and the card build to run.
const survivor = (id) => ({
  id,
  full: {
    id, title: `Movie ${id}`, release_date: '2020-01-01', runtime: 100,
    vote_average: 7, vote_count: 500, poster_path: null, overview: '',
    genres: [{ id: 28, name: 'Action' }],
    external_ids: { imdb_id: `tt${id}` },
    credits: { crew: [{ id: 9, job: 'Director', name: 'D' }], cast: [{ id: 5, name: 'A' }] },
    videos: { results: [] },
    keywords: { keywords: [] },
  },
  services: [],
  features: ['g:28'],
  collab: 0,
});

const profile = {
  pos: new Map(), neg: new Map(), counts: new Map(), mean: 7, count: 0,
  ratedFeatureSets: [], genreLists: [[28]],
};

test('rankCandidates yields the event loop while scoring a large survivor set', async () => {
  // More than YIELD_EVERY (16) survivors, so the scoring loop must hit at least
  // one yield point partway through.
  const survivors = Array.from({ length: 40 }, (_, i) => survivor(i + 1));

  let finished = false;
  let probeFiredMidRun = false;
  const probe = new Promise((resolve) => setTimeout(() => {
    probeFiredMidRun = !finished;
    resolve();
  }, 0));

  const ranked = rankCandidates(survivors, profile, 'en-US').then((r) => { finished = true; return r; });
  const [result] = await Promise.all([ranked, probe]);

  assert.ok(
    probeFiredMidRun,
    'the scoring pass held the event loop for its entire run — a concurrent watchlist save / health check would stall behind it',
  );
  // Sanity: every survivor scored and ranked (well under POOL_SIZE), output intact.
  assert.equal(result.length, 40);
  assert.ok(result.every((c) => typeof c.score === 'number' && c.tmdb_id != null));
});
