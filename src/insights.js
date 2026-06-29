// Turn a user's learned taste profile into a human-readable summary of what the
// recommender has inferred — the per-feature weights, the genre calibration
// target, and the scoring knobs in effect. Backs the hidden /insights page.
//
// What's shown IS what scoring uses: this rebuilds the profile vector the same
// way computePool does (idf over the rated corpus, then buildProfileVector), so
// the page is a faithful window onto the model, not a parallel estimate.
import { buildProfile } from './taste.js';
import { buildIdf, buildProfileVector, genreDistribution, SCORING } from './scoring.js';

// Display names for each feature family (the prefix on a feature id).
const TYPE_LABELS = {
  genre: 'Genres', tone: 'Tones', keyword: 'Keywords',
  director: 'Directors', cast: 'Cast', decade: 'Decades',
};
// Reading order for the categories: broad taste → mood → people → era.
const TYPE_ORDER = ['genre', 'tone', 'keyword', 'director', 'cast', 'decade'];
// How many of the strongest liked / disliked features to surface per category,
// so a heavy rater's keyword list doesn't render thousands of rows.
const PER_GROUP = 15;

const round = (n) => Math.round(n * 1000) / 1000;

// Pure: accumulated taste evidence (+ feature labels) → the grouped weight
// summary the page renders. No I/O, so it's directly unit-testable.
export function summarizeProfile(profile, labels) {
  const idf = buildIdf(profile.ratedFeatureSets);
  const vec = buildProfileVector(profile, idf);

  const groups = new Map();
  for (const [id, weight] of vec) {
    const type = id.slice(0, id.indexOf(':'));
    if (!groups.has(type)) groups.set(type, []);
    groups.get(type).push({
      label: labels.get(id) || id,
      weight: round(weight),
      idf: round(idf.get(id) || 0),
      count: profile.counts.get(id) || 0,
    });
  }

  const features = [...groups.entries()]
    .map(([type, items]) => {
      items.sort((a, b) => b.weight - a.weight);
      return {
        type,
        label: TYPE_LABELS[type] || type,
        // Strongest positives first; strongest negatives first (most-disliked).
        liked: items.filter((i) => i.weight > 0).slice(0, PER_GROUP),
        disliked: items.filter((i) => i.weight < 0).slice(-PER_GROUP).reverse(),
      };
    })
    .filter((g) => g.liked.length || g.disliked.length)
    .sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type));

  const genres = [...genreDistribution(profile.genreLists)]
    .map(([id, prob]) => ({ label: labels.get(`genre:${id}`) || `genre:${id}`, prob: round(prob) }))
    .sort((a, b) => b.prob - a.prob);

  return {
    ratedCount: profile.count,
    meanRating: round(profile.mean),
    distinctFeatures: vec.size,
    genres,
    features,
    scoring: SCORING,
  };
}

// Build the learned-taste summary for one user: assemble their profile (also
// capturing each feature's human label), then summarize it. The heavy part is
// buildProfile's TMDB detail fetches — all cache hits after a warm build.
export async function learnedProfile(userId) {
  const labels = new Map();
  const profile = await buildProfile(userId, { labels });
  return summarizeProfile(profile, labels);
}
