// Content-based taste model + candidate scoring (the Criticker-style part).
//
// Idea: from each user's ratings, learn which features (genres, keywords,
// director, top cast, decade) correlate with above-average liking. Then score
// unseen-but-streamable candidates by how many of those features they carry.
// Everything is per-user: profiles, candidate pools, caches, and prebuilds.
import { details, genres as tmdbGenres, tmdbConfigured, pickTrailers, personImdbId } from './tmdb.js';
import { getRatings, getDismissed, getWatchlistIds, getUserSetting, setUserSetting, cacheGet, cacheSet, listUsers,
  watchlistNeedingEnrichment, setWatchlistCard, getMovieToneSlugs, getMovieToneSlugsBatch } from './db.js';
import { tmdbLang, DEFAULT_LANGUAGE } from './locale.js';
import { allowedOriginFromValue } from './geo.js';
import { attachRatings } from './ratings.js';
import { gatherCandidates } from './sources.js';
import { isTone, orderTones, toneLabel } from './tones.js';
import { toneSlugs, tonesForMovie } from './tone-store.js';
import { resolveTones } from './tone-sources.js';
import { boundedRunner, mapPool } from './concurrency.js';
import { buildIdf, buildProfileVector, scoreCandidate, genreDistribution, rerank, bayesianQuality } from './scoring.js';
import { log } from './log.js';
import { dbCounters } from './perf.js';

const CAST_DEPTH = 5; // how many top-billed actors to consider

// TMDB company ids of the classic Hollywood majors and their in-house labels.
// The "indie" filter, when on, drops any title carrying one of these — our
// proxy for "not a major-studio production", since TMDB has no indie flag.
// Verified against live TMDB production_companies (see geo/taste tests); extend
// as new majors/labels appear.
const MAJOR_STUDIO_IDS = new Set([
  2,      // Walt Disney Pictures
  1,      // Lucasfilm
  3,      // Pixar
  6125,   // Walt Disney Animation Studios
  420,    // Marvel Studios
  7505,   // Marvel Entertainment
  174,    // Warner Bros. Pictures
  12,     // New Line Cinema
  33,     // Universal Pictures
  4,      // Paramount Pictures
  5,      // Columbia Pictures
  34,     // Sony Pictures
  2251,   // Sony Pictures Animation
  25,     // 20th Century Fox
  127928, // 20th Century Studios
  21,     // Metro-Goldwyn-Mayer
  1632,   // Lionsgate
  7,      // DreamWorks Pictures
  521,    // DreamWorks Animation
  923,    // Legendary Pictures
]);
// How much a Trakt collaborative hit can lift a score. Additive (not a re-weight)
// so candidates Trakt never mentions aren't penalised; saturates ~COLLAB_WEIGHT.
const COLLAB_WEIGHT = 15;

// Each feature an item carries, as [id, label]: `id` is the scoring key
// (genre:28, keyword:9663…), `label` its human name for the insights page. The
// id format lives only here so featuresOf (hot scoring path) and the insights
// labels stay in lock-step.
function featureEntries(movie, storedTonesFor = getMovieToneSlugs) {
  const e = [];
  for (const g of movie.genres || []) e.push([`genre:${g.id}`, g.name]);
  for (const k of movie.keywords?.keywords || []) e.push([`keyword:${k.id}`, k.name]);
  // Tone tags (heartfelt, deadpan…) derived from keywords + Netflix membership,
  // scored like any other feature so the profile learns a user's mood affinities.
  for (const s of toneSlugs(movie, 'movie', storedTonesFor)) e.push([`tone:${s}`, toneLabel(s)]);
  const crew = movie.credits?.crew || [];
  for (const d of crew.filter((c) => c.job === 'Director')) e.push([`director:${d.id}`, d.name]);
  for (const a of (movie.credits?.cast || []).slice(0, CAST_DEPTH)) e.push([`cast:${a.id}`, a.name]);
  const yr = Number((movie.release_date || '').slice(0, 4));
  if (yr) { const d = Math.floor(yr / 10) * 10; e.push([`decade:${d}`, `${d}s`]); }
  return e;
}

// Just the feature ids — what scoring works in. (featureEntries also carries the
// human labels the insights page needs.)
function featuresOf(movie, storedTonesFor = getMovieToneSlugs) {
  return featureEntries(movie, storedTonesFor).map(([id]) => id);
}

// node:sqlite is fully synchronous and warm TMDB cache hits resolve without real
// I/O, so a recommendation build otherwise runs as one unbroken microtask chain:
// the event loop never reaches its poll phase, starving /health and live
// requests until the whole build finishes. On a shared-CPU host that overruns
// the platform's 5s health-check timeout and the instance is killed mid-build (a
// boot/​use crash loop). Yielding to the macrotask queue every YIELD_EVERY units
// of work lets the loop service /health and real traffic between chunks. Output
// is unchanged — only the interleaving differs.
const YIELD_EVERY = 16;
const breathe = () => new Promise((resolve) => setImmediate(resolve));

const EMPTY_PROFILE = () => ({
  pos: new Map(), neg: new Map(), counts: new Map(), mean: 7, count: 0,
  ratedFeatureSets: [], genreLists: [],
});

// Accumulate raw per-feature evidence from a user's rated films. Splits each
// film's rating delta (rating − user_mean) into positive/negative buckets so the
// scoring layer can damp negatives (feedback asymmetry), and keeps the rated
// films' feature sets and genre lists so the pool builder can derive IDF weights
// and the calibration target. No weighting/squashing happens here — that's
// scoring.js, which needs the candidate corpus to compute IDF.
// Pass a `labels` Map to also capture each feature's human label (id → name) as
// the films are walked — the insights page needs it; the hot scoring path omits
// it and pays nothing.
export async function buildProfile(userId, { labels } = {}) {
  const ratings = getRatings(userId).filter((r) => r.media_type === 'movie');
  if (!ratings.length) return EMPTY_PROFILE();

  // Resolve every rated title's stored tones in one query, like the candidate
  // pool, so featureEntries below isn't a per-rating N+1.
  const ratedTones = getMovieToneSlugsBatch(ratings.map((r) => r.tmdb_id));
  const storedTonesFor = (id) => ratedTones.get(id) || [];

  const mean = ratings.reduce((s, r) => s + r.rating, 0) / ratings.length;
  const pos = new Map(), neg = new Map(), counts = new Map();
  const ratedFeatureSets = [], genreLists = [];

  let processed = 0;
  for (const r of ratings) {
    if (++processed % YIELD_EVERY === 0) await breathe();
    let movie;
    try { movie = await details(r.tmdb_id, 'movie'); } catch { continue; }
    const delta = r.rating - mean; // liked-vs-typical signal
    const entries = featureEntries(movie, storedTonesFor);
    if (labels) for (const [id, label] of entries) labels.set(id, label);
    const feats = entries.map(([id]) => id);
    ratedFeatureSets.push(feats);
    genreLists.push((movie.genres || []).map((g) => g.id));
    for (const feat of feats) {
      if (delta >= 0) pos.set(feat, (pos.get(feat) || 0) + delta);
      else neg.set(feat, (neg.get(feat) || 0) + delta);
      counts.set(feat, (counts.get(feat) || 0) + 1);
    }
  }
  return { pos, neg, counts, mean, count: ratings.length, ratedFeatureSets, genreLists };
}

// Mean community rating across the candidates that have votes — the global prior
// C the Bayesian quality term shrinks thin-voted films toward. Falls back to a
// neutral 6.5 when nothing in the pool has votes.
function meanVoteAverage(movies) {
  let sum = 0, n = 0;
  for (const m of movies) {
    if ((m.vote_count || 0) > 0 && m.vote_average != null) { sum += m.vote_average; n += 1; }
  }
  return n ? sum / n : 6.5;
}

// ---- origin / indie candidate filters -------------------------------------
// Hard filters applied to every candidate (whatever source surfaced it) the
// same way the genre filter is — a non-matching title is dropped, not down-ranked.
// All operate on TMDB's /movie detail shape (production_countries, companies).

// True when the title's origin satisfies the user's geography filter:
//  - excludeUs drops anything with the US among its production countries (the
//    "non-US / non-Hollywood" toggle), and
//  - a non-empty `allowed` set requires at least one production country in it
//    (the continent + country picker; empty set = no country restriction).
export function matchesOrigin(movie, { allowed, excludeUs } = {}) {
  const countries = (movie.production_countries || []).map((c) => c.iso_3166_1);
  if (excludeUs && countries.includes('US')) return false;
  if (allowed?.size && !countries.some((c) => allowed.has(c))) return false;
  return true;
}

// True when no production company is one of the Hollywood majors — our "indie"
// proxy. A title with no listed companies counts as indie (unknown ≠ major).
export function isIndie(movie) {
  return !(movie.production_companies || []).some((c) => MAJOR_STUDIO_IDS.has(c.id));
}

// Resolve the Discover filter controls into the shape the pool builder and
// cache key consume. These are live, per-request browse controls (like the
// genre filter), passed as query params — not saved preferences. `origin` is
// the single picker's type-tagged value ('c:<continent>' | 'k:<country>' | '');
// see geo.js allowedOriginFromValue. Defaults (no args) mean "no filtering".
export function resolveFilters({ origin = '', excludeUs = false, indie = false, tone = '' } = {}) {
  // An unknown tone is dropped to '' (no filter) so a stale/typo'd ?tag= can't
  // build an empty pool — same lenient stance the other controls take.
  return { allowed: allowedOriginFromValue(origin), excludeUs: !!excludeUs, indie: !!indie, tone: isTone(tone) ? tone : '' };
}

// Stable signature of a filter set for the pool cache key, so each distinct
// origin/indie combination caches its own pool (like region and providers do).
export function filterSig({ allowed, excludeUs, indie, tone } = {}) {
  const origins = [...(allowed || [])].sort().join(',');
  return `${excludeUs ? 'nous' : ''}.${indie ? 'indie' : ''}.${tone ? `t-${tone}` : ''}.${origins || 'any'}`;
}

// The user's chosen services that, in their region, stream this title — each as
// { id, name, logo } using TMDB ids/logos so the Discover card can badge it with
// the same icon the Settings picker shows. Both flatrate (subscription) and
// free/ads tiers of a chosen service count — what matters is that the user
// selected that service. An empty array also means "not streamable for this
// user": the Discover sources are already provider-scoped, but the seed/chart
// sources aren't, so this re-check is what gates them. `full` carries TMDB's
// appended watch/providers block (see tmdb.js details()).
export function userServices(full, region, userSet) {
  const wp = full['watch/providers']?.results?.[region];
  if (!wp) return [];
  const offered = [...(wp.flatrate || []), ...(wp.free || []), ...(wp.ads || [])];
  const byId = new Map();
  for (const p of offered) {
    if (userSet.has(p.provider_id) && !byId.has(p.provider_id)) {
      byId.set(p.provider_id, { id: p.provider_id, name: p.provider_name, logo: p.logo_path || null });
    }
  }
  return [...byId.values()];
}

// How many scored titles we keep per (user, region, services, genre) pool. We
// cache a surplus over what the UI shows (server asks for 36) so titles rated or
// dismissed mid-session can be filtered out at serve time without depleting it.
// Sized large because the served pool advances one title at a time as the user
// rates/dismisses/saves — so the pool depth IS how many picks a session yields.
// At 80 a heavy user exhausted the default "all genres" view after ~50 picks;
// 200 lets it run as deep as the per-genre pools collectively reach.
const POOL_SIZE = 200;
// Upper bound on candidates we fetch full details for per pool. With many
// sources the merged set can run large; this caps the per-build TMDB detail
// fetches (and latency) while still leaving ample headroom over POOL_SIZE after
// the streamability gate drops most candidates.
const CANDIDATE_CAP = 500;
// How many of each corpus's quality-ranked head get IMDb/Metacritic ratings +
// tone feeders attached during the (background) build. Wide enough that the ~36
// any profile actually shows — plus dismissal headroom — fall inside it, so a
// re-rank serves enriched cards without making those slow web lookups itself.
const ENRICH_COUNT = 50;

// The recommendation build is split into two layers so a rating doesn't pay for
// the whole thing. buildCorpus is the expensive, taste-independent layer (gather +
// ~500 detail fetches + enrichment); it barely moves when a user rates one more
// film — 12 of 15 candidate sources don't depend on the profile at all, and the
// seed-based three only shift if the rating cracks the top-10 seeds. rankCorpus is
// the cheap layer (IDF + scoring + rerank, ~100ms over the cached corpus). A rating
// re-runs only rankCorpus; the corpus is rebuilt with fresh seeds in the background.

// Build the candidate corpus for one genre (or all genres when genreId is
// undefined): gather → fetch details → hard-filter → per-survivor scoring-ready
// cards, with a wide head enriched (IMDb/Metacritic + tone feeders). The heavy
// part — many TMDB calls — so its output is cached under a key WITHOUT the recGen
// stamp (see corpusKey): a rating re-ranks it rather than rebuilding it.
async function buildCorpus({ userId, region, providerIds, genreId, ratings, language, filters = {} }) {
  // Titles the user has already handled — rated, dismissed, or saved to their
  // watchlist — must never be recommended. Movies only (the whole catalogue here),
  // keyed by bare tmdb id since that's the unit candidate sources and the cap work
  // in. Saved titles were the missing case: without them the pool filled with
  // films already on the watchlist that the UI then stripped out, starving Discover.
  const consumed = new Set();
  for (const r of ratings) if (r.media_type === 'movie') consumed.add(r.tmdb_id);
  for (const d of getDismissed(userId)) if (d.media_type === 'movie') consumed.add(d.tmdb_id);
  for (const w of getWatchlistIds(userId)) if (w.media_type === 'movie') consumed.add(w.tmdb_id);

  // Assemble candidates from every configured source (TMDB discover variants,
  // recommendations, similar, trending; Trakt related + charts). Each yields ids
  // only; scoring, the genre filter and the streamability gate below are the one
  // shared place those rules live. `consumed` also tells the provider-scoped
  // Discover sources how deep to page — past titles already handled until they've
  // surfaced enough fresh ones. collab[id] = crowd co-watch hits, an additive bonus.
  const tGather = performance.now();
  const { candidates, collab } = await gatherCandidates({ region, providerIds, genreId, ratings, language, consumed });
  const gatherMs = performance.now() - tGather;

  // Drop handled titles BEFORE the cap, so the (capped) detail-fetch budget is
  // spent on candidates that can actually become picks rather than re-fetching
  // titles we'd only discard. The registry is priority-ordered and the Map
  // preserves it, so the strongest fresh sources fill the budget first.
  const pool = [...candidates.values()].filter((m) => !consumed.has(m.id)).slice(0, CANDIDATE_CAP);

  // Prefetch every candidate's stored tones in ONE query, then read them from the
  // map below (filter, features, scoring). Per-title getMovieToneSlugs() here was
  // a CANDIDATE_CAP-sized N+1 — the measured ~11s of synchronous DB per build.
  const candidateTones = getMovieToneSlugsBatch(pool.map((m) => m.id));
  const storedTonesFor = (id) => candidateTones.get(id) || [];

  // Fetch details, apply the hard filters + streamability gate, and collect each
  // survivor's features/votes. Scoring happens later (rankCorpus) because the IDF
  // feature weights depend on the whole candidate corpus.
  const userSet = new Set(providerIds || []);
  const survivors = [];
  let processed = 0;
  const tDetails = performance.now();
  for (const m of pool) {
    if (++processed % YIELD_EVERY === 0) await breathe();
    let full;
    try { full = await details(m.id, 'movie', language); } catch { continue; }
    // When a genre is selected, keep only titles tagged with it (the seed/chart
    // sources aren't genre-constrained at source, so filter here too).
    if (genreId && !(full.genres || []).some((g) => g.id === genreId)) continue;
    // Origin (continent/country/non-US) and indie filters — same hard-drop
    // model as the genre filter, applied uniformly to every candidate source.
    if (!matchesOrigin(full, filters)) continue;
    if (filters.indie && !isIndie(full)) continue;
    // Tone filter (the Discover "tone" control / a ?tag= deep link): hard-drop
    // titles that don't carry the chosen tone, same model as the genre filter.
    if (filters.tone && !toneSlugs(full, 'movie', storedTonesFor).includes(filters.tone)) continue;
    // Drop titles not on a chosen service in the user's region; otherwise keep
    // the matched services so the card can show (and deep-link) each one.
    const services = userServices(full, region, userSet);
    if (!services.length) continue;
    survivors.push({ full, services, collab: collab.get(m.id) || 0 });
  }
  const detailsMs = performance.now() - tDetails;

  const globalMean = meanVoteAverage(survivors.map((s) => s.full));
  // Scoring-ready cards: everything the ranking pass and the UI need, minus the
  // score itself (recomputed per profile in rankCorpus). features/genreIds/
  // voteCount/collab are scoring inputs that rankCorpus strips before serving.
  // A breathe()-yielding loop because building a card per survivor (up to
  // CANDIDATE_CAP) is otherwise an unbroken synchronous block — with node:sqlite
  // synchronous and warm cache hits resolving without real I/O — that starves
  // /health and live traffic. storedTonesFor keeps the tone reads batched.
  const cards = [];
  let built = 0;
  for (const s of survivors) {
    if (++built % YIELD_EVERY === 0) await breathe();
    const crew = s.full.credits?.crew || [];
    cards.push({
      tmdb_id: s.full.id,
      imdb_id: s.full.external_ids?.imdb_id || null,
      title: s.full.title,
      year: Number((s.full.release_date || '').slice(0, 4)) || null,
      runtime: s.full.runtime || null,
      overview: s.full.overview,
      poster_path: s.full.poster_path,
      vote_average: s.full.vote_average,
      voteCount: s.full.vote_count,
      genres: (s.full.genres || []).map((g) => g.name),
      genreIds: (s.full.genres || []).map((g) => g.id),
      tones: tonesForMovie(s.full, 'movie', storedTonesFor),
      features: featuresOf(s.full, storedTonesFor),
      director: crew.filter((c) => c.job === 'Director').map((c) => c.name).join(', ') || null,
      cast: (s.full.credits?.cast || []).slice(0, CAST_DEPTH).map((c) => c.name),
      trailers: pickTrailers(s.full.videos, language),
      services: s.services,
      collab: s.collab,
    });
  }

  // Enrich a wide head with IMDb/Metacritic ratings + tone feeders. Because the
  // corpus outlives any one profile, the head is chosen by a taste-independent
  // quality proxy (the Bayesian prior) rather than the personalised rank — so the
  // cache holds across ratings. The tradeoff: a rare niche pick that out-scores
  // this band on personal match alone may show without its badges until the next
  // (background) corpus rebuild. attachRatings/resolveToneTags are TTL-skipped
  // internally, so repeat corpus builds across genres re-fetch nothing.
  const tEnrich = performance.now();
  const enrichHead = [...cards]
    .sort((a, b) => bayesianQuality(b.vote_average, b.voteCount, globalMean) - bayesianQuality(a.vote_average, a.voteCount, globalMean))
    .slice(0, ENRICH_COUNT);
  await attachRatings(enrichHead);
  await resolveToneTags(enrichHead);
  const enrichMs = performance.now() - tEnrich;

  // Phase split for the corpus build: gather (source fan-out, mostly cached
  // TMDB/Trakt), details (per-candidate detail fetch + sync JSON parse), enrich
  // (the two web-enrichment passes over the quality head).
  log.info(
    `[perf] corpus phases user=${userId} genre=${genreId ?? 'all'} gatherMs=${gatherMs.toFixed(0)} ` +
    `detailsMs=${detailsMs.toFixed(0)} enrichMs=${enrichMs.toFixed(0)} ` +
    `candidates=${pool.length} survivors=${survivors.length}`,
  );
  return { cards, globalMean };
}

// Rank a cached corpus for one profile: IDF over the user's rated features + the
// corpus, a profile vector, per-card score, then the genre-calibration/diversity
// rerank. No I/O — this is the cheap pass a rating re-runs over the cached corpus,
// in place of the whole buildCorpus. Still yields the event loop every YIELD_EVERY
// scores: even alone it's a synchronous stretch over up to CANDIDATE_CAP cards
// that would otherwise starve /health on the per-rating path.
export async function rankCorpus({ cards, globalMean }, profile) {
  // IDF over the corpus the user's rated films + these candidates form, so a
  // feature's weight is its rarity (broad tags weak, distinctive tags strong) —
  // data-derived, not a hand-tuned family table.
  const idf = buildIdf([...profile.ratedFeatureSets, ...cards.map((c) => c.features)]);
  const profileVec = buildProfileVector(profile, idf);
  const scored = [];
  let processed = 0;
  for (const c of cards) {
    if (++processed % YIELD_EVERY === 0) await breathe();
    // Confidence-weighted blend of personalised match and quality prior, with the
    // discovery lift for acclaimed-but-obscure films folded in; the Trakt co-watch
    // bonus still rides additively on top (1 hit ≈ +7, ~+15 cap).
    const base = scoreCandidate({
      profileVec, itemFeatures: c.features, idf,
      voteAverage: c.vote_average, voteCount: c.voteCount, globalMean,
    });
    const collabBonus = COLLAB_WEIGHT * Math.tanh(c.collab / 2);
    scored.push({ ...c, score: Math.min(100, Math.round(base + collabBonus)) });
  }

  // Order by relevance, then re-rank the served head for genre calibration (keep
  // the mix close to the user's history) and diversity (no near-duplicate
  // neighbours). genreIds/features/voteCount/collab are scoring-only — strip them
  // before returning, keeping the score.
  scored.sort((a, b) => b.score - a.score);
  const profileGenreDist = genreDistribution(profile.genreLists);
  const ranked = rerank(
    scored.map((s) => ({ score: s.score, features: s.features, genres: s.genreIds, card: s })),
    profileGenreDist, idf,
  ).map((r) => r.card);
  return ranked.slice(0, POOL_SIZE).map(({ genreIds, features, voteCount, collab, ...card }) => card);
}

// ---- recommendation cache + prebuild --------------------------------------
// Two caches share this key shape per (user, region, services, genre, language,
// filters): `corpus:<tail>` holds the expensive taste-independent candidate corpus
// (NOT recGen-stamped — a rating re-ranks it), and `recpool:<tail>` holds the
// ranked, served pool stamped with the user's recGen so a rating/dismiss/settings
// change marks it stale without touching anyone else's. Language is part of the
// key so each language caches its own (localized) build; the filter signature
// joins it so each origin/indie/tone combination caches apart.
function keyTail(userId, region, providerIds, genreId, language, filters) {
  const provs = [...(providerIds || [])].map(Number).sort((a, b) => a - b).join('-');
  return `${userId}:${region}:${provs}:${genreId || 'all'}:${language || 'en-US'}:${filterSig(filters)}`;
}
const poolKey = (...args) => `recpool:${keyTail(...args)}`;
// Exported so tests can locate a user's cached corpus entry — the seam they use to
// prove a rating re-ranks the corpus in place rather than rebuilding it.
export const corpusKey = (...args) => `corpus:${keyTail(...args)}`;
const currentGen = (userId) => getUserSetting(userId, 'recGen', 0);

// How many tone resolutions run concurrently — small, so the scraper feeders stay
// well under IMDb/Letterboxd limits (the model feeder is local/instant).
const TONE_RESOLVE_CONCURRENCY = 5;
// Resolve the per-title tone feeders for a batch of cards, then fold the freshly
// stored slugs into each card's `tones` so the just-built pool reflects them
// immediately (later builds pick them up via tonesForMovie). resolveTones is
// TTL-skipped + per-source isolated, so this is cheap on warm titles and never
// fails a build. A no-op when no feeder is configured (no proxy, untrained model).
async function resolveToneTags(cards) {
  await mapPool(cards, TONE_RESOLVE_CONCURRENCY, async (card) => {
    await resolveTones(card);
    const slugs = new Set([...(card.tones || []).map((t) => t.slug), ...getMovieToneSlugs(card.tmdb_id)]);
    card.tones = orderTones([...slugs]);
  });
}

// Rebuild a user's corpus from scratch and rank it — the full, expensive build,
// run on a cold cache, a forced Refresh, and the background prebuild (so frozen
// seeds self-heal). Caches both layers: the corpus (reused across ratings) and the
// ranked pool stamped with the current generation.
export async function buildAndCache({ userId, region, providerIds, genreId, profile, ratings, language, filters }) {
  profile = profile || (await buildProfile(userId));
  ratings = ratings || getRatings(userId);
  filters = filters || resolveFilters();
  const tCorpus = performance.now();
  const corpus = await buildCorpus({ userId, region, providerIds, genreId, ratings, language, filters });
  cacheSet(corpusKey(userId, region, providerIds, genreId, language, filters), corpus);
  const corpusMs = performance.now() - tCorpus;
  const tRank = performance.now();
  const pool = await rankCorpus(corpus, profile);
  const rankMs = performance.now() - tRank;
  // Where the build's wall-time goes: corpus (gather + details + enrichment — the
  // part a rating now skips) vs rank (the pure-CPU scoring pass it re-runs).
  log.info(
    `[perf] build phases user=${userId} genre=${genreId ?? 'all'} ` +
    `corpusMs=${corpusMs.toFixed(0)} rankMs=${rankMs.toFixed(0)}`,
  );
  const value = { gen: currentGen(userId), profileSize: profile.count, pool };
  cacheSet(poolKey(userId, region, providerIds, genreId, language, filters), value);
  return value;
}

// ---- build dispatcher (main-thread inline by default, worker at the root) ---
// buildAndCache is the event-loop blocker we move off the main thread in
// production: its expensive layer (buildCorpus — gather + ~500 detail fetches +
// enrich) runs as a long synchronous-ish chain that starves /health and live
// requests (measured prod stall ~9s). The dispatcher is the SOLID seam for that —
// recommend()/prebuild() call runBuild() instead of buildAndCache() directly, and
// the composition root (server.js, isMain) swaps in a worker-thread runner via
// setBuildRunner(). Tests and plain imports never call setBuildRunner, so they
// keep the fast, deterministic inline default. The build's product is DB-backed:
// whichever runner builds, it cacheSet()s the pool under poolKey, and recommend()
// reads it back with cacheGet() — no large data crosses the thread boundary.
const inlineBuildRunner = (args) => buildAndCache(args);
let buildRunner = inlineBuildRunner;
export function setBuildRunner(fn) { buildRunner = fn; }
export function resetBuildRunner() { buildRunner = inlineBuildRunner; }
// Exported so the worker-path tests can locate (and seed) a user's cached pool —
// the same seam the worker writes to and recommend() reads from across threads.
export { poolKey };

// Coalesce concurrent builds of the same pool: a foreground recommend and a
// background prebuild (or two requests racing a cold genre) can ask for the same
// poolKey at once — without this they'd each pay the full gather+enrich. Keyed by
// poolKey and cleared on settle, so callers of an in-flight build share its one
// promise. The dedup sits above the runner so it holds whether the build runs
// inline or in the worker.
const inFlightBuilds = new Map(); // poolKey -> Promise
function runBuild(args) {
  const { userId, region, providerIds, genreId, language, filters } = args;
  const key = poolKey(userId, region, providerIds, genreId, language, filters || resolveFilters());
  const existing = inFlightBuilds.get(key);
  if (existing) return existing;
  const p = Promise.resolve(buildRunner(args)).finally(() => inFlightBuilds.delete(key));
  inFlightBuilds.set(key, p);
  return p;
}

// Serve a user's recommendations: read the cached pool (already enriched during
// its build), drop anything rated/dismissed since, then take the top `limit`.
// Three paths, cheapest first: a fresh cached pool is served as-is (`hit`); a pool
// invalidated by a rating/dismiss/settings change is re-ranked over the still-valid
// cached corpus (`reranked`, ~100ms, no external calls) while the corpus refreshes
// in the background; only a missing corpus or a forced Refresh pays the full
// gather+enrich rebuild (`built`).
export async function recommend({ userId, region, providerIds, genreId, limit = 30, force = false, language, filters }) {
  const t0 = performance.now();
  const db0 = dbCounters();
  filters = filters || resolveFilters();
  let cached = force ? null : cacheGet(poolKey(userId, region, providerIds, genreId, language, filters));
  let mode;
  if (cached && cached.gen === currentGen(userId)) {
    mode = 'hit';
  } else {
    const corpus = force ? null : cacheGet(corpusKey(userId, region, providerIds, genreId, language, filters));
    if (!corpus) {
      // The expensive gather+enrich rebuild — dispatched through runBuild so it
      // runs in the worker (off the main loop) in prod; read the result back from
      // the shared DB once it lands.
      await runBuild({ userId, region, providerIds, genreId, language, filters });
      cached = cacheGet(poolKey(userId, region, providerIds, genreId, language, filters));
      mode = 'built';
    } else {
      // The ranking is stale but the corpus isn't — re-rank the cached candidates
      // over the fresh profile (cheap, no I/O) and refresh the corpus's seeds +
      // enrichment in the background.
      const profile = await buildProfile(userId);
      const pool = await rankCorpus(corpus, profile);
      cached = { gen: currentGen(userId), profileSize: profile.count, pool };
      cacheSet(poolKey(userId, region, providerIds, genreId, language, filters), cached);
      ensurePrebuild(userId);
      mode = 'reranked';
    }
  }
  const excluded = new Set([
    ...getRatings(userId).map((r) => `${r.media_type}:${r.tmdb_id}`),
    ...getDismissed(userId).map((d) => `${d.media_type}:${d.tmdb_id}`),
    ...getWatchlistIds(userId).map((w) => `${w.media_type}:${w.tmdb_id}`),
  ]);
  const results = cached.pool
    .filter((m) => !excluded.has(`movie:${m.tmdb_id}`))
    .slice(0, limit)
    .map((m) => ({ ...m }));
  // A synchronous (cache-served) build is the suspected loop-blocker; logging ms
  // with mode= lets prod tell a cheap cache hit (hit) from a re-rank (reranked)
  // from a full rebuild (built), and dbMs/dbCalls (the share spent inside
  // synchronous SQLite) tells whether a stall is DB-bound or compute-bound — the
  // remote-DB-vs-worker-thread call.
  const dbMs = dbCounters().ms - db0.ms;
  const dbCalls = dbCounters().calls - db0.calls;
  log.info(
    `[perf] recommend build user=${userId} ms=${(performance.now() - t0).toFixed(0)} ` +
    `dbMs=${dbMs.toFixed(0)} dbCalls=${dbCalls} items=${results.length} mode=${mode}`,
  );
  return { profileSize: cached.profileSize, results };
}

// Precompute one user's "all genres" pool plus one per TMDB genre, reusing a
// single taste profile across them. Sequential to stay gentle on TMDB.
export async function prebuildRecommendations(userId) {
  if (!tmdbConfigured()) return;
  const region = getUserSetting(userId, 'country', 'PL');
  const providerIds = (getUserSetting(userId, 'providers', []) || []).map(Number);
  const language = tmdbLang(getUserSetting(userId, 'language', DEFAULT_LANGUAGE));
  // Prebuild warms the unfiltered pools (all genres + per genre); origin/indie
  // filters are applied on demand at serve time from the Discover controls.
  const filters = resolveFilters();
  const profile = await buildProfile(userId);
  const ratings = getRatings(userId);
  await runBuild({ userId, region, providerIds, genreId: undefined, profile, ratings, language, filters });
  let list = [];
  try { list = (await tmdbGenres('movie')).genres || []; }
  catch (e) { log.warn(`prebuild: genre list fetch failed for user ${userId}:`, e.message); return; }
  for (const g of list) {
    await breathe(); // let /health + live requests through between genres
    try { await runBuild({ userId, region, providerIds, genreId: g.id, profile, ratings, language, filters }); }
    catch (e) { log.warn(`prebuild genre ${g.name} failed for user ${userId}:`, e.message); }
  }
}

// Debounced background prebuild, keyed per user so one user's burst of ratings
// triggers just one rebuild and never blocks another user's. A global cap bounds
// how many users build at once: at boot, warmRecommendations() submits every
// onboarded user, and without the cap they'd all fan out to TMDB/Trakt/scrapers
// at once and stampede the upstreams (cold-start "fetch failed"). The runner
// holds MAX_CONCURRENT_PREBUILDS in flight and queues the rest.
const timers = new Map();       // userId -> debounce timeout
const pendingDirty = new Set();  // userIds dirtied while their build was running
const MAX_CONCURRENT_PREBUILDS = 2;
const prebuildRunner = boundedRunner(MAX_CONCURRENT_PREBUILDS, async (userId) => {
  pendingDirty.delete(userId);
  try { await prebuildRecommendations(userId); }
  catch (e) { log.error('prebuild failed:', e.message); }
  // Re-run if the user's data changed while this build was in flight.
  if (pendingDirty.has(userId)) schedulePrebuild(userId, 1000);
});
// Tests run against a single-process server and assert on the deterministic
// on-demand build that /api/recommend does. Background prebuilds (all-genres +
// one pool per genre) would otherwise pile up on that one process and starve
// those foreground builds, making render timings race. Off in e2e, on in prod.
const PREBUILD_DISABLED = process.env.DISABLE_REC_PREBUILD === '1';
function schedulePrebuild(userId, delay = 4000) {
  if (PREBUILD_DISABLED) return;
  if (timers.has(userId)) clearTimeout(timers.get(userId));
  timers.set(userId, setTimeout(() => {
    timers.delete(userId);
    // Already building? mark dirty so it re-runs afterward with the latest data;
    // otherwise hand it to the capped runner (which may queue it behind others).
    if (prebuildRunner.isActive(userId)) pendingDirty.add(userId);
    else prebuildRunner.submit(userId);
  }, delay));
}
// Like schedulePrebuild but never pushes back an already-pending/running rebuild
// — used on the stale-serve path so browsing genres can't starve the refresh.
function ensurePrebuild(userId) {
  if (!timers.has(userId) && !prebuildRunner.has(userId)) schedulePrebuild(userId);
}

// Don't build any picks until a user has rated enough films for them to be
// meaningful — mirrors RATE_GOAL in the frontend, which onboards until the same
// count before swapping the rate queue for picks. Below this, every pick should
// still feed the first build, so we don't waste work (or serve a half-onboarded
// pool) on the way there; the build happens once, on demand, when the goal lands.
const RATE_GOAL = 10;
const readyForRecs = (userId) => getRatings(userId).length >= RATE_GOAL;

// Call when a user's ratings/dismissals/settings change: marks their pools stale
// and (once they're past onboarding) schedules a fresh prebuild in the background.
export function invalidateRecommendations(userId) {
  setUserSetting(userId, 'recGen', currentGen(userId) + 1);
  if (readyForRecs(userId)) schedulePrebuild(userId);
}

// Call once at startup to warm every onboarded user's caches if a TMDB key is set.
export function warmRecommendations() {
  if (!tmdbConfigured()) return;
  for (const u of listUsers()) if (readyForRecs(u.id)) schedulePrebuild(u.id, 1500);
}

// ---- watchlist card enrichment --------------------------------------------
// Re-derive the rich card fields for one already-saved title, server side, so a
// title saved before save-time capture (or whose capture failed) renders exactly
// like a fresh Discover pick — same fields buildCorpus() produces, minus score
// (a saved title has no recommendation rank). Hits TMDB details (cached) + the
// IMDb/Metacritic scrape; no MotN quota is spent.
export async function enrichWatchlistItem({ tmdb_id, region, providerIds, language }) {
  const full = await details(tmdb_id, 'movie', language);
  const crew = full.credits?.crew || [];
  // Resolve the per-title tone feeders for this saved title (TTL-skipped) so its
  // tones match a Discover pick's, then read them back (live ∪ stored) below.
  await resolveTones({ tmdb_id, imdb_id: full.external_ids?.imdb_id || null, title: full.title,
    year: Number((full.release_date || '').slice(0, 4)) || null, overview: full.overview });
  const item = {
    imdb_id: full.external_ids?.imdb_id || null, // attachRatings needs this; not stored
    title: full.title,                           // ditto (metacritic lookup keys on title)
    runtime: full.runtime || null,
    overview: full.overview || null,
    vote_average: full.vote_average ?? null,
    genres: (full.genres || []).map((g) => g.name),
    tones: tonesForMovie(full),
    director: crew.filter((c) => c.job === 'Director').map((c) => c.name).join(', ') || null,
    cast: (full.credits?.cast || []).slice(0, CAST_DEPTH).map((c) => c.name),
    trailers: pickTrailers(full.videos, language),
    services: userServices(full, region, new Set((providerIds || []).map(Number))),
  };
  await attachRatings([item]); // adds imdbRating + metascore (or leaves them null)
  return item;
}

// Map each displayed credit name (director(s) + top cast) to its IMDb person id,
// so the detail popup can link names straight to imdb.com/name/nm…. Resolved on
// demand when a popup opens (see /api/where): the movie details are already
// cached from the card build, and per-person external_ids are long-cached in the
// DB (see personImdbId), so a title's links resolve once and are then served
// from cache. Names without a resolvable id are simply omitted — the frontend
// falls back to an IMDb name search for those.
export async function creditImdbIds(tmdbId, mediaType = 'movie') {
  let full;
  try { full = await details(tmdbId, mediaType); } catch { return {}; }
  const directors = (full.credits?.crew || []).filter((c) => c.job === 'Director');
  const cast = (full.credits?.cast || []).slice(0, CAST_DEPTH);
  const people = [...directors, ...cast];
  const ids = await Promise.all(people.map((p) => personImdbId(p.id).catch(() => null)));
  const map = {};
  people.forEach((p, i) => { if (ids[i]) map[p.name] = ids[i]; });
  return map;
}

// Background one-off at startup: enrich every saved title that predates save-time
// capture (or that predates trailer capture) so the Watchlist tab matches
// Discover. Naturally idempotent — it only touches rows that still lack a card
// or a trailers key, so once everything's filled a re-run is a cheap empty
// query. Gentle on TMDB: one user at a time, yielding between items so /health
// and live traffic aren't starved (see the breathe() rationale).
export async function backfillWatchlistCards() {
  if (!tmdbConfigured()) return;
  const t0 = performance.now();
  let enriched = 0;
  for (const u of listUsers()) {
    const rows = watchlistNeedingEnrichment(u.id);
    if (!rows.length) continue;
    const region = getUserSetting(u.id, 'country', 'PL');
    const providerIds = (getUserSetting(u.id, 'providers', []) || []).map(Number);
    const language = tmdbLang(getUserSetting(u.id, 'language', DEFAULT_LANGUAGE));
    for (const r of rows) {
      await breathe();
      try {
        const item = await enrichWatchlistItem({ tmdb_id: r.tmdb_id, region, providerIds, language });
        setWatchlistCard(u.id, r.tmdb_id, r.media_type, item);
        enriched++;
      } catch (e) { log.warn(`watchlist backfill failed for user ${u.id}/${r.tmdb_id}:`, e.message); }
    }
  }
  // One line per boot-time pass: how long the enrichment ran and how much it
  // touched, so a slow backfill is visible against first-byte spikes in the log.
  log.info(`[perf] watchlist backfill done ms=${(performance.now() - t0).toFixed(0)} items=${enriched}`);
}
