// Unit tests for the pure scoring math (src/scoring.js). Each block pins one of
// the redesign's fixes: IDF down-weighting broad tags, bounded cosine match,
// asymmetric/clamped negatives, the Bayesian quality prior, the confidence blend
// that lets acclaimed-but-unfamiliar films score on quality, and the
// calibrated/diversified re-rank. No DB/TMDB — these are deterministic functions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildIdf, buildProfileVector, affinityMatch, overlapMass, confidence,
  bayesianQuality, qualityPrior, scoreCandidate, discoveryBonus, genreDistribution,
  klDivergence, itemSimilarity, rerank, SCORING,
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

// ---- quality prior from IMDb + Metacritic, never TMDB -----------------------

test('qualityPrior uses IMDb as the backbone and pulls it toward Metacritic', () => {
  const imdbOnly = qualityPrior({ imdbRating: 8.0, imdbVotes: 500000, globalMean: 6.9 });
  const withHighMc = qualityPrior({ imdbRating: 8.0, imdbVotes: 500000, metascore: 95, globalMean: 6.9 });
  const withLowMc = qualityPrior({ imdbRating: 8.0, imdbVotes: 500000, metascore: 50, globalMean: 6.9 });
  assert.ok(withHighMc > imdbOnly, 'a strong critic score lifts the IMDb-backed prior');
  assert.ok(withLowMc < imdbOnly, 'a weak critic score drags it down');
  // The pull is exactly MC_WEIGHT of the gap between the IMDb prior and the metascore.
  assert.ok(Math.abs(withHighMc - ((1 - SCORING.MC_WEIGHT) * imdbOnly + SCORING.MC_WEIGHT * 95)) < 1e-9);
});

test('qualityPrior falls back to the raw critic score with only Metacritic, and is null with neither', () => {
  assert.equal(qualityPrior({ metascore: 82, globalMean: 6.9 }), 82, 'MC-only prior is the critic score');
  assert.equal(qualityPrior({ globalMean: 6.9 }), null, 'no IMDb and no MC → no prior (skip signal)');
  assert.equal(qualityPrior({ imdbRating: null, metascore: null, globalMean: 6.9 }), null);
});

test('scoreCandidate never reads TMDB: a vote_average passed in cannot move the score', () => {
  // The old prior was TMDB-driven; the new one must ignore it entirely. Same
  // IMDb/MC-less card with a wildly different TMDB vote_average scores identically.
  const idf = new Map([['a', 2]]);
  const profileVec = buildProfileVector(
    { pos: new Map([['a', 3]]), neg: new Map(), counts: new Map([['a', 5]]) }, idf);
  const base = { profileVec, itemFeatures: ['a'], idf, globalMean: 6.9 };
  const lowTmdb = scoreCandidate({ ...base, vote_average: 2.0, voteCount: 500000 });
  const highTmdb = scoreCandidate({ ...base, vote_average: 9.5, voteCount: 500000 });
  assert.equal(lowTmdb, highTmdb, 'TMDB fields are inert — quality comes from IMDb/MC only');
});

test('scoreCandidate skips the prior when unrated: the score is the taste match alone', () => {
  // A film with no IMDb/MC and no feature overlap sits at neutral 50 (not ~80),
  // so it can never outrank a rated film on borrowed crowd quality.
  const idf = new Map([['a', 2], ['x', 2]]);
  const profileVec = buildProfileVector(
    { pos: new Map([['a', 6]]), neg: new Map(), counts: new Map([['a', 10]]) }, idf);
  const unratedUnknown = scoreCandidate({ profileVec, itemFeatures: ['x'], idf, globalMean: 6.9 });
  assert.equal(unratedUnknown, 50, 'unrated + no taste opinion → neutral, no quality anchor');
  // But taste still moves an unrated film the profile likes.
  const unratedLiked = scoreCandidate({ profileVec, itemFeatures: ['a'], idf, globalMean: 6.9 });
  assert.ok(unratedLiked > 60, `an unrated but well-matched film still rises on taste, got ${unratedLiked}`);
});

test('scoreCandidate ranks a high-IMDb / low-Metacritic film by its IMDb backbone', () => {
  // No overlap → the score tracks the prior. A film critics panned but audiences
  // love still scores respectably because IMDb leads and MC only nudges.
  const idf = new Map([['x', 3]]);
  const profileVec = buildProfileVector(
    { pos: new Map([['x', 3]]), neg: new Map(), counts: new Map([['x', 5]]) }, idf);
  const beloved = scoreCandidate({ profileVec, itemFeatures: ['unknown'], idf, imdbRating: 8.4, imdbVotes: 800000, metascore: 55, globalMean: 6.9 });
  const meh = scoreCandidate({ profileVec, itemFeatures: ['unknown'], idf, imdbRating: 6.2, imdbVotes: 800000, metascore: 55, globalMean: 6.9 });
  assert.ok(beloved > meh, 'the higher-IMDb film wins despite equal critic scores');
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
    imdbRating: 8.5, imdbVotes: 500000, globalMean: 6.5,
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
    imdbRating: 5.0, imdbVotes: 100000, globalMean: 6.5,
  });
  assert.ok(score > 60, `strong taste match lifts a low-rated film, got ${score}`);
});

// ---- discovery bonus: don't bury acclaimed-but-obscure indie films ----------

test('discoveryBonus lifts acclaimed-but-obscure films and fades as votes grow', () => {
  const obscure = discoveryBonus(7.8, 90);       // a hidden gem
  const lessObscure = discoveryBonus(7.8, 600);  // same rating, more seen
  assert.ok(obscure > 0, 'a well-rated, thinly-voted film gets a lift');
  assert.ok(obscure > lessObscure, 'the more obscure of two equally-rated films gets the bigger lift');
  assert.ok(obscure <= SCORING.DISCOVERY_MAX, 'bounded by DISCOVERY_MAX');
});

test('discoveryBonus stays out of the way for popular or weak films', () => {
  assert.equal(discoveryBonus(8.5, 400000), 0, 'a widely-seen film needs no discovery help');
  assert.equal(discoveryBonus(5.5, 80), 0, 'a thinly-voted LOW-rated film is junk, not a gem — no lift');
  assert.equal(discoveryBonus(null, 80), 0, 'no rating, no lift');
  assert.equal(discoveryBonus(8.0, 1000), 0, 'at the vote cap the lift has decayed to 0');
});

test('scoreCandidate lifts an obscure acclaimed film above its bare prior', () => {
  // No feature overlap → the score tracks the prior; the discovery bonus should
  // push a thinly-voted gem above where the shrunk prior alone would leave it.
  const idf = new Map([['x', 3]]);
  const profileVec = buildProfileVector(
    { pos: new Map([['x', 3]]), neg: new Map(), counts: new Map([['x', 5]]) }, idf);
  const gem = scoreCandidate({ profileVec, itemFeatures: ['unknown'], idf, imdbRating: 7.8, imdbVotes: 90, globalMean: 6.5 });
  const bare = bayesianQuality(7.8, 90, 6.5); // the same film scored on prior alone
  assert.ok(gem > bare, `discovery bonus lifts the obscure gem above its bare prior (${gem} > ${bare})`);
  assert.ok(gem - bare <= SCORING.DISCOVERY_MAX, 'but only by a bounded amount');
});

test('scoreCandidate withholds the discovery bonus from a predicted-disliked film', () => {
  // An obscure, well-rated film the profile predicts the user will dislike
  // (match < 50) gets NO lift — discovery never pushes against the user's taste.
  const idf = new Map([['d', 5]]);
  const profileVec = buildProfileVector(
    { pos: new Map(), neg: new Map([['d', -6]]), counts: new Map([['d', 10]]) }, idf);
  const feats = ['d'];
  assert.ok(affinityMatch(profileVec, feats, idf) < 50, 'premise: the profile predicts a dislike');
  const c = confidence(overlapMass(profileVec, feats, idf));
  const prior = bayesianQuality(7.8, 90, 6.5);
  const score = scoreCandidate({ profileVec, itemFeatures: feats, idf, imdbRating: 7.8, imdbVotes: 90, globalMean: 6.5 });
  assert.equal(score, c * affinityMatch(profileVec, feats, idf) + (1 - c) * prior,
    'score equals the bonus-free blend — no discovery lift for a below-neutral film');
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
