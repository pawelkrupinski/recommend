// Pure recommendation-scoring math. No TMDB/DB/HTTP knowledge: callers pass
// plain feature-id arrays (see taste.js featuresOf) and numbers. Everything here
// is deterministic and synchronously testable.
//
// The model is content-based with a quality prior, redesigned away from the old
// ad-hoc "Σ weight×family_weight then tanh" blend. The pieces, and why:
//
//  - IDF feature weights (buildIdf): a feature's weight is its inverse document
//    frequency over the corpus, so a broad tag ("murder", in thousands of films)
//    carries little and a rare one ("courtroom jury drama") carries a lot —
//    derived from data, not the hand-tuned FAMILY_WEIGHT table it replaces.
//  - Mean-centred cosine match (cosineMatch): the user profile and the candidate
//    are idf-weighted vectors; their cosine is naturally bounded and
//    length-normalised, so a 30-keyword film can't out-score an 8-keyword one
//    just by carrying more terms (which tanh(Σ/12) did).
//  - Asymmetric, clamped weights (buildProfileVector): a low rating is weaker,
//    noisier evidence than a high one (often "wrong mood", not "this feature is
//    bad"), so negative contributions are damped by BETA_NEG; and no single
//    feature may swamp the vector (CLAMP).
//  - Confidence blend with a Bayesian quality prior (scoreCandidate): when the
//    profile says little about a film (little feature overlap) the score defers
//    to the prior instead of asserting a confident "meh" at 50. This is also the
//    cold-start behaviour — a sparse profile overlaps few films, so popular/
//    acclaimed titles surface until the profile earns trust.
//  - Quality prior from IMDb + Metacritic, NOT TMDB (qualityPrior): IMDb's
//    weighted rating (with its vote count) is the backbone, pulled a fixed
//    fraction toward Metacritic's critic score when we have one. Crucially the
//    prior is SKIPPED for a film we hold no IMDb/MC rating for — that card scores
//    on taste match alone rather than borrowing TMDB's crowd number — so quality
//    only enters the score when a real critic/audience rating backs it. Ratings
//    are prefetched into the durable cache off the build's critical path (see
//    taste.js), so coverage grows and fewer films fall through to the skip path.
//  - Bayesian quality prior (bayesianQuality): IMDb's weighted-rating shrinks a
//    thinly-voted film toward the global mean, so 8.5-from-40-votes ranks below
//    8.5-from-400k.
//  - Discovery bonus (discoveryBonus): a small, bounded exploration lift that
//    counteracts that shrinkage for acclaimed-but-obscure films, so indie/festival
//    titles aren't buried under mass-market ones of equal merit (gated by a rating
//    floor and to non-disliked films).
//  - Calibrated + diversified re-rank (rerank): the served head is reordered to
//    keep the genre mix close to the user's history (Steck, RecSys'18) and to
//    avoid near-duplicate neighbours (MMR, Carbonell & Goldstein '98).

// Tunable constants, named and grouped so the model's knobs live in one place.
export const SCORING = {
  BETA_NEG: 0.5,       // a disliked feature counts half a liked one (feedback asymmetry)
  CLAMP: 4,            // cap on |per-feature pre-idf weight| so no tag dominates
  SHRINK_ADD: 1,       // Laplace-style shrink: w*(n/(n+SHRINK_ADD)) for n sightings
  CONF_K: 12,          // idf-overlap mass at which film-level confidence hits 0.5
  CONF_MAX: 0.85,      // confidence ceiling: critical consensus always keeps ≥15% weight
  MATCH_K: 8,          // idf-mass prior that shrinks a thin-overlap match toward neutral
  MATCH_TEMP: 2,       // tanh temperature mapping mean feature-affinity to a 0..100 match
  PRIOR_M: 150,        // vote-count at which the quality prior trusts R over the global mean
  MC_WEIGHT: 0.25,     // how far the IMDb-based prior is pulled toward the Metacritic critic score
  IMDB_GLOBAL_MEAN: 6.9, // fallback IMDb mean when a corpus carries no IMDb ratings to average
  RERANK_N: 60,        // how many top candidates get the calibrated/diversified re-rank
  RERANK_LAMBDA: 0.75, // re-rank: relevance vs. MMR diversity (1 = pure relevance)
  CALIB_WEIGHT: 0.15,  // re-rank: pull toward the user's genre mix (0 = off)
  CALIB_ALPHA: 0.01,   // KL smoothing so an unseen genre doesn't blow up the divergence
  DISCOVERY_MAX: 8,          // max exploration lift (score points) for an acclaimed-but-obscure film
  DISCOVERY_MIN_RATING: 6.8, // rating floor below which no lift (don't surface thinly-voted junk)
  DISCOVERY_VOTE_CAP: 1000,  // vote count at/above which a film needs no discovery help
};

// Smoothed inverse document frequency over a corpus of feature sets (each set =
// one film's features). The sklearn "smooth_idf" form: never zero or negative,
// so a feature in every film still contributes a little and a feature in one
// film contributes a lot. Returns Map<feature, idf>.
export function buildIdf(corpusFeatureSets) {
  const df = new Map();
  for (const feats of corpusFeatureSets) {
    for (const f of new Set(feats)) df.set(f, (df.get(f) || 0) + 1);
  }
  const n = corpusFeatureSets.length;
  const idf = new Map();
  for (const [f, d] of df) idf.set(f, Math.log((n + 1) / (d + 1)) + 1);
  return idf;
}

// Build the user's taste vector from per-feature evidence accumulated over their
// rated films: pos[f]/neg[f] are the summed positive/negative rating deltas
// (rating − user_mean) for films carrying f, counts[f] how many films. We damp
// negatives (BETA_NEG), shrink low-sighting features toward 0, clamp magnitude,
// then scale by idf. Returns Map<feature, weight>; features with zero weight or
// no idf are dropped. `over` overrides constants in tests.
export function buildProfileVector({ pos, neg, counts }, idf, over = {}) {
  const { BETA_NEG, CLAMP, SHRINK_ADD } = { ...SCORING, ...over };
  const vec = new Map();
  for (const [f, n] of counts) {
    const w = (pos.get(f) || 0) + BETA_NEG * (neg.get(f) || 0);
    const shrunk = w * (n / (n + SHRINK_ADD));
    const clamped = Math.max(-CLAMP, Math.min(CLAMP, shrunk));
    const idfF = idf.get(f);
    if (!idfF || clamped === 0) continue;
    vec.set(f, clamped * idfF);
  }
  return vec;
}

// Personalised match: the idf-weighted MEAN affinity over the features the film
// shares with the profile — "averaged across the features I have an opinion on,
// does this film lean toward what you like or dislike?" — squashed to [0,100]
// with 50 = neutral. Crucially this normalises by the FILM's overlapping idf
// mass, not the profile's norm: a cosine against a dense profile vector is always
// near-zero for a sparse film and collapses every score toward 50, whereas this
// mean preserves spread (a film full of liked features scores high regardless of
// how many features the profile has). Features the profile has no opinion on
// don't enter the average — their dilution is handled separately by confidence().
// MATCH_K is an idf-mass prior in the denominator: a film overlapping on only one
// or two features can't earn a confident match (its affinity is shrunk toward
// neutral), so a single liked actor/keyword on an otherwise unknown film doesn't
// spike it. Once the overlap mass is large the shrinkage is negligible.
export function affinityMatch(profileVec, itemFeatures, idf, over = {}) {
  const { MATCH_K, MATCH_TEMP } = { ...SCORING, ...over };
  let num = 0, den = 0;
  for (const f of new Set(itemFeatures)) {
    const u = profileVec.get(f);       // u = clamped weight × idf
    if (u === undefined) continue;
    num += u;                          // Σ clamped·idf over the overlap
    den += idf.get(f) || 0;            // Σ idf over the overlap
  }
  if (!den) return 50;
  const affinity = num / (den + MATCH_K); // idf-weighted mean clamped weight, shrunk
  return 50 + 50 * Math.tanh(affinity / MATCH_TEMP);
}

// Total idf mass of the features an item shares with the profile — how much the
// profile actually "knows" about this film. Drives confidence().
export function overlapMass(profileVec, itemFeatures, idf) {
  let mass = 0;
  for (const f of new Set(itemFeatures)) {
    if (profileVec.has(f)) mass += idf.get(f) || 0;
  }
  return mass;
}

// Per-film confidence in the personalised match: shrinkage on overlap evidence,
// mass/(mass+K) ∈ [0,1), then capped at CONF_MAX. Near 0 when the profile shares
// little with the film (defer to the quality prior), rising with overlap but
// never to 1 — a sparse keyword-based taste profile should never wholly override
// critical consensus, so the prior always retains at least (1−CONF_MAX) weight.
export function confidence(mass, over = {}) {
  const { CONF_K, CONF_MAX } = { ...SCORING, ...over };
  return Math.min(CONF_MAX, mass / (mass + CONF_K));
}

// IMDb's weighted-rating / true Bayesian estimate, rescaled to [0,100]:
//   WR = v/(v+m)·R + m/(v+m)·C
// R = film mean (vote_average, 0–10), v = its vote count, C = global mean,
// m = the vote count at which we trust R over C. Shrinks thin-voted films
// toward the global mean.
export function bayesianQuality(voteAverage, voteCount, globalMean, over = {}) {
  const { PRIOR_M: m } = { ...SCORING, ...over };
  const R = voteAverage ?? globalMean;
  const v = voteCount || 0;
  const wr = (v / (v + m)) * R + (m / (v + m)) * globalMean;
  return wr * 10;
}

// Exploration lift for acclaimed-but-obscure films. The Bayesian prior NECESSARILY
// shrinks a thinly-voted film toward the global mean, so an indie/festival title
// with a few hundred votes scores below a mass-market one of equal merit and gets
// buried under it — the very titles the indie candidate sources work to surface.
// This adds a small, bounded bonus, largest for the most obscure well-rated films,
// decaying to 0 by DISCOVERY_VOTE_CAP (a widely-seen film needs no help being
// found). Gated by a rating floor so it lifts hidden gems, not thinly-voted junk.
// Returns [0, DISCOVERY_MAX].
export function discoveryBonus(rating, votes, over = {}) {
  const { DISCOVERY_MAX, DISCOVERY_MIN_RATING, DISCOVERY_VOTE_CAP } = { ...SCORING, ...over };
  if (rating == null || rating < DISCOVERY_MIN_RATING) return 0;
  const v = votes || 0;
  if (v >= DISCOVERY_VOTE_CAP) return 0;
  const obscurity = 1 - v / DISCOVERY_VOTE_CAP;                       // 1 → 0 across [0, CAP)
  const quality = Math.min(1, (rating - DISCOVERY_MIN_RATING) / 1.5); // saturates +1.5 above the floor
  return DISCOVERY_MAX * obscurity * quality;
}

// The quality prior in [0,100], from IMDb and Metacritic ONLY — never TMDB.
// Returns null when we hold neither rating, the caller's signal to skip the prior
// and let the film score on taste match alone. IMDb (0–10 audience rating + its
// vote count) is the backbone, run through the Bayesian shrink and rescaled ×10;
// a Metacritic critic score (already 0–100) then pulls the prior a fixed fraction
// (MC_WEIGHT) toward the critics. With only Metacritic, the prior is the raw
// critic score (no vote count to shrink on).
export function qualityPrior({ imdbRating, imdbVotes, metascore, globalMean }, over = {}) {
  const { MC_WEIGHT } = { ...SCORING, ...over };
  const hasImdb = imdbRating != null;
  const hasMc = metascore != null;
  if (!hasImdb && !hasMc) return null;
  if (!hasImdb) return metascore;
  const q = bayesianQuality(imdbRating, imdbVotes, globalMean, over);
  return hasMc ? (1 - MC_WEIGHT) * q + MC_WEIGHT * metascore : q;
}

// Blend the personalised match with the IMDb/Metacritic quality prior by per-film
// confidence. No feature overlap → c≈0 → score ≈ prior (acclaim shows through);
// strong overlap → c≈1 → personal taste dominates. An exploration bonus then lifts
// acclaimed-but-obscure films so the prior's shrinkage doesn't bury them — but only
// when the profile doesn't predict a dislike (match ≥ neutral 50), so we never push
// a film the user's taste rejects.
//
// When we hold NO IMDb/Metacritic rating for the film (qualityPrior → null) the
// prior is skipped entirely: the score is the taste match alone (plus any bonus,
// which is itself 0 without an IMDb rating). So an unrated film the profile has no
// opinion on lands at neutral ~50 and sinks, while a rated one keeps its quality
// anchor — quality only moves the score when a real rating backs it. Returns an
// unrounded score.
export function scoreCandidate({ profileVec, itemFeatures, idf, imdbRating, imdbVotes, metascore, globalMean }, over = {}) {
  const mass = overlapMass(profileVec, itemFeatures, idf);
  const c = confidence(mass, over);
  const match = affinityMatch(profileVec, itemFeatures, idf, over);
  const prior = qualityPrior({ imdbRating, imdbVotes, metascore, globalMean }, over);
  const bonus = match >= 50 ? discoveryBonus(imdbRating, imdbVotes, over) : 0;
  if (prior == null) return match + bonus;
  return c * match + (1 - c) * prior + bonus;
}

// Genre distribution p(g) from a list of per-film genre-id arrays. Each film
// splits one unit of mass equally across its genres (Steck §4.1), averaged over
// films, normalised to sum 1. Returns Map<genreId, prob>.
export function genreDistribution(genreLists) {
  const p = new Map();
  let total = 0;
  for (const gs of genreLists) {
    if (!gs || !gs.length) continue;
    const share = 1 / gs.length;
    for (const g of gs) p.set(g, (p.get(g) || 0) + share);
    total += 1;
  }
  if (!total) return p;
  for (const [g, m] of p) p.set(g, m / total);
  return p;
}

// KL divergence D(p‖q) with Steck's smoothing q̃ = (1−α)q + αp, so a genre the
// list lacks contributes a finite (not infinite) penalty. Lower = better
// calibrated to p.
export function klDivergence(p, q, over = {}) {
  const { CALIB_ALPHA: alpha } = { ...SCORING, ...over };
  let kl = 0;
  for (const [g, pg] of p) {
    if (pg <= 0) continue;
    const qg = (1 - alpha) * (q.get(g) || 0) + alpha * pg;
    if (qg > 0) kl += pg * Math.log(pg / qg);
  }
  return kl;
}

// Cosine similarity between two items' idf-weighted feature vectors, in [0,1]
// (features are non-negative, so the cosine is too). Used as the MMR redundancy
// signal — how much a candidate duplicates an already-selected pick.
export function itemSimilarity(aFeatures, bFeatures, idf) {
  const a = new Set(aFeatures), b = new Set(bFeatures);
  let dot = 0, na = 0, nb = 0;
  for (const f of a) { const w = idf.get(f); if (w) { na += w * w; if (b.has(f)) dot += w * w; } }
  for (const f of b) { const w = idf.get(f); if (w) nb += w * w; }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// Greedily re-rank the top RERANK_N items to balance three objectives: relevance
// (their score), diversity (MMR — penalise similarity to already-picked items),
// and calibration (keep the running genre mix close to the user's history p).
// Items below the head keep their score order and are appended unchanged, so the
// dismissal-headroom tail stays cheap and predictable. Each item needs
// { score, features, genres }. Pure: returns a new array, doesn't mutate input.
export function rerank(items, profileGenreDist, idf, over = {}) {
  const cfg = { ...SCORING, ...over };
  const headN = Math.min(cfg.RERANK_N, items.length);
  if (headN <= 1 || profileGenreDist.size === 0) return items.slice();

  const head = items.slice(0, headN);
  const tail = items.slice(headN);
  const maxScore = Math.max(...head.map((it) => it.score)) || 1;

  const remaining = new Set(head);
  const selected = [];
  const qCount = new Map(); // running genre mass over selected films
  let qFilms = 0;

  while (remaining.size) {
    let best = null, bestVal = -Infinity;
    for (const it of remaining) {
      const rel = it.score / maxScore; // 0..1
      let maxSim = 0;
      for (const s of selected) {
        const sim = itemSimilarity(it.features, s.features, idf);
        if (sim > maxSim) maxSim = sim;
      }
      // Calibration: KL of the genre mix if we add this item now (lower better).
      const q = new Map(qCount);
      if (it.genres && it.genres.length) {
        const share = 1 / it.genres.length;
        for (const g of it.genres) q.set(g, (q.get(g) || 0) + share);
      }
      const films = qFilms + 1;
      const qDist = new Map();
      for (const [g, m] of q) qDist.set(g, m / films);
      const kl = klDivergence(profileGenreDist, qDist, cfg);

      const val = cfg.RERANK_LAMBDA * rel
        - (1 - cfg.RERANK_LAMBDA) * maxSim
        - cfg.CALIB_WEIGHT * kl;
      if (val > bestVal) { bestVal = val; best = it; }
    }
    selected.push(best);
    remaining.delete(best);
    if (best.genres && best.genres.length) {
      const share = 1 / best.genres.length;
      for (const g of best.genres) qCount.set(g, (qCount.get(g) || 0) + share);
    }
    qFilms += 1;
  }
  return [...selected, ...tail];
}
