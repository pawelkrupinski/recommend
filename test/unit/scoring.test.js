// Unit tests for the pure scoring math (src/scoring.js). Each block pins one of
// the redesign's fixes: IDF down-weighting broad tags, bounded cosine match,
// asymmetric/clamped negatives, the Bayesian quality prior, the confidence blend
// that lets acclaimed-but-unfamiliar films score on quality, and the
// calibrated/diversified re-rank. No DB/TMDB — these are deterministic functions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildIdf, buildProfileVector, affinityMatch, overlapMass, confidence,
  bayesianQuality, scoreCandidate, genreDistribution, klDivergence,
  itemSimilarity, rerank, SCORING,
} from '../../src/scoring.js';

// A profile vector with one strongly-liked feature (a) and one strongly-disliked
// (d), each seen often enough to clear the shrinkage, sharing one idf scale.
const likeDislikeProfile = (idf) => buildProfileVector({
  pos: new Map([['a', 6]]), neg: new Map([['d', -6]]),
  counts: new Map([['a', 10], ['d', 10]]),
}, idf);

// ---- IDF: broad features weigh less than rare ones (pathology #1, #3) -------

test('buildIdf gives a rare feature a higher weight than a ubiquitous one', () => {
  // "murder" in every film, a rare keyword in one.
  const corpus = [
    ['g:drama', 'murder', 'rare'],
    ['g:drama', 'murder'],
    ['g:drama', 'murder'],
    ['g:drama', 'murder'],
  ];
  const idf = buildIdf(corpus);
  assert.ok(idf.get('rare') > idf.get('murder'), 'rare keyword outweighs the broad one');
  assert.ok(idf.get('murder') > 0, 'smoothed idf is never zero, even for a feature in every doc');
});

// ---- profile vector: asymmetric, clamped negatives (pathology #5, #7) -------

test('buildProfileVector damps negative evidence relative to positive', () => {
  const idf = new Map([['liked', 1], ['disliked', 1]]);
  // Equal magnitude of evidence, opposite sign, each seen many times (no shrink bias).
  const profile = {
    pos: new Map([['liked', 4]]),
    neg: new Map([['disliked', -4]]),
    counts: new Map([['liked', 10], ['disliked', 10]]),
  };
  const vec = buildProfileVector(profile, idf);
  assert.ok(vec.get('liked') > 0 && vec.get('disliked') < 0);
  assert.ok(Math.abs(vec.get('disliked')) < Math.abs(vec.get('liked')),
    'a disliked feature pulls less hard than an equally-strong liked one');
  // BETA_NEG is exactly the ratio (shrinkage and idf cancel at equal counts/idf).
  assert.ok(Math.abs(Math.abs(vec.get('disliked') / vec.get('liked')) - SCORING.BETA_NEG) < 1e-9);
});

test('buildProfileVector clamps any single feature so one tag cannot dominate', () => {
  const idf = new Map([['huge', 1]]);
  // A feature with enormous accumulated weight, seen often.
  const profile = { pos: new Map([['huge', 1000]]), neg: new Map(), counts: new Map([['huge', 50]]) };
  const vec = buildProfileVector(profile, idf);
  assert.ok(vec.get('huge') <= SCORING.CLAMP + 1e-9, 'clamped to CLAMP × idf');
});

// ---- affinity match: bounded, spread-preserving, shrunk (pathology #3) ------

test('affinityMatch returns 50 (neutral) when the film shares no profile feature', () => {
  const idf = new Map([['a', 4], ['d', 4], ['x', 4]]);
  assert.equal(affinityMatch(likeDislikeProfile(idf), ['x'], idf), 50);
});

test('affinityMatch preserves spread: liked ≫ neutral ≫ disliked', () => {
  // The compression bug a cosine-vs-dense-profile match caused (everything ≈50):
  // a film of liked features must score well above one of disliked features.
  const idf = new Map([['a', 4], ['d', 4], ['x', 4]]);
  const vec = likeDislikeProfile(idf);
  const liked = affinityMatch(vec, ['a'], idf);
  const disliked = affinityMatch(vec, ['d'], idf);
  const unknown = affinityMatch(vec, ['x'], idf);
  assert.ok(liked > 70, `liked-feature film scores high, got ${liked}`);
  assert.ok(disliked < 35, `disliked-feature film scores low, got ${disliked}`);
  assert.ok(liked - disliked > 40, 'real spread between liked and disliked, not a 50-collapse');
  assert.equal(unknown, 50, 'no-opinion film sits at neutral');
});

test('affinityMatch shrinks a thin overlap toward neutral (one liked tag cannot spike a film)', () => {
  // Profile likes six distinct features equally; a film overlapping on more of
  // them earns a stronger match than one sharing just one (MATCH_K shrinkage).
  const ids = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'];
  const idf = new Map(ids.map((id) => [id, 2]));
  const vec = buildProfileVector(
    { pos: new Map(ids.map((id) => [id, 6])), neg: new Map(), counts: new Map(ids.map((id) => [id, 10])) }, idf);
  const thin = affinityMatch(vec, ['a1'], idf);
  const rich = affinityMatch(vec, ids, idf);
  assert.ok(thin < rich, 'thin overlap is shrunk toward 50 relative to a saturated one');
  assert.ok(thin < 75, `a single liked tag does not spike the match, got ${thin}`);
});

// ---- Bayesian quality prior (pathology #4, #6) ------------------------------

test('bayesianQuality shrinks a thinly-voted film toward the global mean', () => {
  const C = 6.5;
  const fewVotes = bayesianQuality(8.5, 40, C);
  const manyVotes = bayesianQuality(8.5, 400000, C);
  assert.ok(manyVotes > fewVotes, 'same rating ranks higher with more votes behind it');
  assert.ok(fewVotes < 85 && fewVotes > C * 10, 'pulled toward the mean but still above it');
  assert.ok(manyVotes > 84.9, 'a heavily-voted 8.5 sits near 85');
});

// ---- confidence blend: acclaimed-but-unfamiliar films (pathology #2) --------

test('scoreCandidate defers to the quality prior when there is no feature overlap', () => {
  // The 12 Angry Men case: a high-quality film sharing nothing with the profile
  // must NOT collapse to a confident 50 — it should track its (high) prior.
  const idf = new Map([['a', 2], ['b', 2], ['classic', 5]]);
  const profileVec = buildProfileVector(
    { pos: new Map([['a', 3], ['b', 3]]), neg: new Map(), counts: new Map([['a', 5], ['b', 5]]) }, idf);
  const score = scoreCandidate({
    profileVec, itemFeatures: ['classic'], idf,
    voteAverage: 8.5, voteCount: 500000, globalMean: 6.5,
  });
  assert.ok(score > 70, `unfamiliar acclaimed film scores on quality, got ${score}`);
});

test('scoreCandidate lets a strong personal match lift a mediocre-but-liked film', () => {
  // Many liked features → high (capped) confidence → match pulls the score up
  // even though critics are lukewarm.
  const ids = ['a', 'b', 'c', 'd', 'e'];
  const idf = new Map(ids.map((id) => [id, 5]));
  const profileVec = buildProfileVector(
    { pos: new Map(ids.map((id) => [id, 6])), neg: new Map(), counts: new Map(ids.map((id) => [id, 10])) }, idf);
  const score = scoreCandidate({
    profileVec, itemFeatures: ids, idf,
    voteAverage: 5.0, voteCount: 100000, globalMean: 6.5,
  });
  assert.ok(score > 60, `strong taste match lifts a low-rated film, got ${score}`);
});

test('confidence rises with overlap mass, is capped, and overlapMass sums shared idf', () => {
  const idf = new Map([['a', 2], ['b', 3]]);
  const vec = new Map([['a', 1], ['b', 1]]);
  assert.equal(overlapMass(vec, ['a', 'b', 'z'], idf), 5);
  assert.ok(confidence(20) > confidence(2), 'more shared evidence = more confidence');
  assert.equal(confidence(0), 0);
  assert.ok(confidence(1e6) <= SCORING.CONF_MAX + 1e-9,
    'capped so the quality prior always keeps weight — a sparse profile never fully overrides critics');
});

// ---- calibration + diversity re-rank (pathology #4) -------------------------

test('genreDistribution and klDivergence: identical mixes have zero divergence', () => {
  const p = genreDistribution([[18], [18, 80], [80]]);
  assert.ok(Math.abs([...p.values()].reduce((s, v) => s + v, 0) - 1) < 1e-9, 'normalised to 1');
  assert.ok(Math.abs(klDivergence(p, p)) < 1e-9, 'KL(p‖p) = 0');
  const skewed = genreDistribution([[18], [18], [18]]);
  assert.ok(klDivergence(p, skewed) > 0, 'a mismatched mix has positive divergence');
});

test('itemSimilarity is 1 for identical feature sets and 0 for disjoint', () => {
  const idf = new Map([['a', 2], ['b', 2], ['c', 2]]);
  assert.ok(Math.abs(itemSimilarity(['a', 'b'], ['a', 'b'], idf) - 1) < 1e-9);
  assert.equal(itemSimilarity(['a'], ['c'], idf), 0);
});

test('rerank demotes a near-duplicate of the top pick in favour of variety', () => {
  const idf = new Map([['x', 2], ['y', 2], ['z', 2]]);
  const p = genreDistribution([[1], [2]]); // user likes a balanced mix
  // Top item, its near-clone (same features+genre), and a distinct alternative
  // with a slightly lower score. Diversity should pull the distinct one above the clone.
  const items = [
    { score: 90, features: ['x', 'y'], genres: [1], card: 'top' },
    { score: 88, features: ['x', 'y'], genres: [1], card: 'clone' },
    { score: 80, features: ['z'], genres: [2], card: 'distinct' },
  ];
  const order = rerank(items, p, idf, { RERANK_N: 3 }).map((i) => i.card);
  assert.equal(order[0], 'top', 'highest relevance still leads');
  assert.equal(order[1], 'distinct', 'a varied pick beats a near-duplicate of the leader');
  assert.equal(order[2], 'clone');
});

test('rerank leaves the score-ordered tail beyond RERANK_N untouched', () => {
  const idf = new Map([['x', 2]]);
  const p = genreDistribution([[1]]);
  const items = Array.from({ length: 5 }, (_, i) => ({
    score: 100 - i, features: ['x'], genres: [1], card: i,
  }));
  const order = rerank(items, p, idf, { RERANK_N: 2 }).map((i) => i.card);
  assert.deepEqual(order.slice(2), [2, 3, 4], 'tail stays in score order');
});
