// Content-based taste model + candidate scoring (the Criticker-style part).
//
// Idea: from each user's ratings, learn which features (genres, keywords,
// director, top cast, decade) correlate with above-average liking. Then score
// unseen-but-streamable candidates by how many of those features they carry.
// Everything is per-user: profiles, candidate pools, caches, and prebuilds.
import { details, genres as tmdbGenres, tmdbConfigured, pickTrailers, personImdbId } from './tmdb.js';
import { getRatings, getDismissed, getWatchlistIds, getUserSetting, setUserSetting, cacheGet, cacheSet, listUsers,
  watchlistNeedingEnrichment, setWatchlistCard } from './db.js';
import { tmdbLang, DEFAULT_LANGUAGE } from './locale.js';
import { allowedOriginFromValue } from './geo.js';
import { attachRatings } from './ratings.js';
import { gatherCandidates } from './sources.js';
import { toneSlugs, tonesForMovie, isTone } from './tones.js';
import { boundedRunner } from './concurrency.js';
import { buildIdf, buildProfileVector, scoreCandidate, genreDistribution, rerank } from './scoring.js';
import { log } from './log.js';

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

function featuresOf(movie) {
  const f = [];
  for (const g of movie.genres || []) f.push(`genre:${g.id}`);
  for (const k of movie.keywords?.keywords || []) f.push(`keyword:${k.id}`);
  // Tone tags (heartfelt, deadpan…) derived from keywords + Netflix membership,
  // scored like any other feature so the profile learns a user's mood affinities.
  for (const s of toneSlugs(movie)) f.push(`tone:${s}`);
  const crew = movie.credits?.crew || [];
  for (const d of crew.filter((c) => c.job === 'Director')) f.push(`director:${d.id}`);
  for (const a of (movie.credits?.cast || []).slice(0, CAST_DEPTH)) f.push(`cast:${a.id}`);
  const yr = Number((movie.release_date || '').slice(0, 4));
  if (yr) f.push(`decade:${Math.floor(yr / 10) * 10}`);
  return f;
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
export async function buildProfile(userId) {
  const ratings = getRatings(userId).filter((r) => r.media_type === 'movie');
  if (!ratings.length) return EMPTY_PROFILE();

  const mean = ratings.reduce((s, r) => s + r.rating, 0) / ratings.length;
  const pos = new Map(), neg = new Map(), counts = new Map();
  const ratedFeatureSets = [], genreLists = [];

  let processed = 0;
  for (const r of ratings) {
    if (++processed % YIELD_EVERY === 0) await breathe();
    let movie;
    try { movie = await details(r.tmdb_id, 'movie'); } catch { continue; }
    const delta = r.rating - mean; // liked-vs-typical signal
    const feats = featuresOf(movie);
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
// How many of each pool's top titles get IMDb/Metacritic ratings attached during
// the (background) build. Enough to cover the ~36 shown plus dismissal headroom,
// so serving never has to make those slow web lookups itself.
const ENRICH_COUNT = 50;

// Build the scored candidate pool for one genre (or all genres when genreId is
// undefined). Heavy part — many TMDB calls — so its output gets cached.
async function computePool({ userId, region, providerIds, genreId, profile, ratings, language, filters = {} }) {
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
  const { candidates, collab } = await gatherCandidates({ region, providerIds, genreId, ratings, language, consumed });

  // Drop handled titles BEFORE the cap, so the (capped) detail-fetch budget is
  // spent on candidates that can actually become picks rather than re-fetching
  // titles we'd only discard. The registry is priority-ordered and the Map
  // preserves it, so the strongest fresh sources fill the budget first.
  const pool = [...candidates.values()].filter((m) => !consumed.has(m.id)).slice(0, CANDIDATE_CAP);

  // First pass: fetch details, apply the hard filters + streamability gate, and
  // collect each survivor's features/votes. We score in a second pass because the
  // IDF feature weights depend on the whole candidate corpus.
  const userSet = new Set(providerIds || []);
  const survivors = [];
  let processed = 0;
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
    if (filters.tone && !toneSlugs(full).includes(filters.tone)) continue;
    // Drop titles not on a chosen service in the user's region; otherwise keep
    // the matched services so the card can show (and deep-link) each one.
    const services = userServices(full, region, userSet);
    if (!services.length) continue;
    survivors.push({ id: m.id, full, services, features: featuresOf(full), collab: collab.get(m.id) || 0 });
  }

  // IDF over the corpus the user's rated films + these candidates form, so a
  // feature's weight is its rarity (broad tags weak, distinctive tags strong) —
  // data-derived, not a hand-tuned family table. The profile vector and the
  // Bayesian quality prior's global mean both come from this same corpus.
  const idf = buildIdf([...profile.ratedFeatureSets, ...survivors.map((s) => s.features)]);
  const profileVec = buildProfileVector(profile, idf);
  const globalMean = meanVoteAverage(survivors.map((s) => s.full));

  const scored = survivors.map((s) => {
    const crew = s.full.credits?.crew || [];
    // Confidence-weighted blend of personalised match and quality prior, with the
    // discovery lift for acclaimed-but-obscure films folded in; the Trakt co-watch
    // bonus still rides additively on top (1 hit ≈ +7, ~+15 cap).
    const base = scoreCandidate({
      profileVec, itemFeatures: s.features, idf,
      voteAverage: s.full.vote_average, voteCount: s.full.vote_count, globalMean,
    });
    const collabBonus = COLLAB_WEIGHT * Math.tanh(s.collab / 2);
    return {
      tmdb_id: s.id,
      imdb_id: s.full.external_ids?.imdb_id || null,
      title: s.full.title,
      year: Number((s.full.release_date || '').slice(0, 4)) || null,
      runtime: s.full.runtime || null,
      overview: s.full.overview,
      poster_path: s.full.poster_path,
      vote_average: s.full.vote_average,
      genres: (s.full.genres || []).map((g) => g.name),
      genreIds: (s.full.genres || []).map((g) => g.id),
      tones: tonesForMovie(s.full),
      features: s.features,
      director: crew.filter((c) => c.job === 'Director').map((c) => c.name).join(', ') || null,
      cast: (s.full.credits?.cast || []).slice(0, CAST_DEPTH).map((c) => c.name),
      trailers: pickTrailers(s.full.videos, language),
      services: s.services,
      score: Math.min(100, Math.round(base + collabBonus)),
    };
  });

  // Order by relevance, then re-rank the served head for genre calibration (keep
  // the mix close to the user's history) and diversity (no near-duplicate
  // neighbours). genreIds/features are scoring-only — strip before returning.
  scored.sort((a, b) => b.score - a.score);
  const profileGenreDist = genreDistribution(profile.genreLists);
  const ranked = rerank(
    scored.map((s) => ({ score: s.score, features: s.features, genres: s.genreIds, card: s })),
    profileGenreDist, idf,
  ).map((r) => r.card);
  return ranked.slice(0, POOL_SIZE).map(({ genreIds, features, ...card }) => card);
}

// ---- recommendation cache + prebuild --------------------------------------
// Pools are precomputed per user for "all genres" + every genre and cached so
// selecting a genre is instant. Each cached blob is stamped with that user's
// recGen; bumping it (on any of their rating/dismiss/settings changes) marks
// their pools stale without touching anyone else's.

function poolKey(userId, region, providerIds, genreId, language, filters) {
  const provs = [...(providerIds || [])].map(Number).sort((a, b) => a - b).join('-');
  // Language is part of the key so each language caches its own (localized)
  // pool — switching language lazily builds the other rather than clobbering it.
  // The filter signature joins it so each origin/indie combination caches apart.
  return `recpool:${userId}:${region}:${provs}:${genreId || 'all'}:${language || 'en-US'}:${filterSig(filters)}`;
}
const currentGen = (userId) => getUserSetting(userId, 'recGen', 0);

// Compute one pool and store it under the user's current generation.
async function buildAndCache({ userId, region, providerIds, genreId, profile, ratings, language, filters }) {
  profile = profile || (await buildProfile(userId));
  ratings = ratings || getRatings(userId);
  filters = filters || resolveFilters();
  const pool = await computePool({ userId, region, providerIds, genreId, profile, ratings, language, filters });
  // Enrich the top of the pool with IMDb/Metacritic ratings here (background) so
  // serving is a pure cache read — these lookups hit the web on a cold cache.
  await attachRatings(pool.slice(0, ENRICH_COUNT));
  const value = { gen: currentGen(userId), profileSize: profile.count, pool };
  cacheSet(poolKey(userId, region, providerIds, genreId, language, filters), value);
  return value;
}

// Serve a user's recommendations: read the cached pool (already enriched during
// its build), drop anything rated/dismissed since, then take the top `limit`.
// Stale-while-revalidate: an out-of-date pool is served immediately with a
// background rebuild scheduled; we only block when there's no cached pool at all
// (a genre the warm hasn't reached) or when force=true (Refresh).
export async function recommend({ userId, region, providerIds, genreId, limit = 30, force = false, language, filters }) {
  filters = filters || resolveFilters();
  let cached = cacheGet(poolKey(userId, region, providerIds, genreId, language, filters));
  if (!cached || force) {
    cached = await buildAndCache({ userId, region, providerIds, genreId, language, filters });
  } else if (cached.gen !== currentGen(userId)) {
    ensurePrebuild(userId); // refresh in the background; serve the stale pool now
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
  await buildAndCache({ userId, region, providerIds, genreId: undefined, profile, ratings, language, filters });
  let list = [];
  try { list = (await tmdbGenres('movie')).genres || []; }
  catch (e) { log.warn(`prebuild: genre list fetch failed for user ${userId}:`, e.message); return; }
  for (const g of list) {
    await breathe(); // let /health + live requests through between genres
    try { await buildAndCache({ userId, region, providerIds, genreId: g.id, profile, ratings, language, filters }); }
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
// like a fresh Discover pick — same fields computePool() produces, minus score
// (a saved title has no recommendation rank). Hits TMDB details (cached) + the
// IMDb/Metacritic scrape; no MotN quota is spent.
export async function enrichWatchlistItem({ tmdb_id, region, providerIds, language }) {
  const full = await details(tmdb_id, 'movie', language);
  const crew = full.credits?.crew || [];
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
      } catch (e) { log.warn(`watchlist backfill failed for user ${u.id}/${r.tmdb_id}:`, e.message); }
    }
  }
}
