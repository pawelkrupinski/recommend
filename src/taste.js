// Content-based taste model + candidate scoring (the Criticker-style part).
//
// Idea: from each user's ratings, learn which features (genres, keywords,
// director, top cast, decade) correlate with above-average liking. Then score
// unseen-but-streamable candidates by how many of those features they carry.
// Everything is per-user: profiles, candidate pools, caches, and prebuilds.
import { details, genres as tmdbGenres, tmdbConfigured } from './tmdb.js';
import { getRatings, getDismissed, getUserSetting, setUserSetting, cacheGet, cacheSet, listUsers,
  watchlistNeedingCard, setWatchlistCard } from './db.js';
import { tmdbLang, DEFAULT_LANGUAGE } from './locale.js';
import { allowedOriginFromValue } from './geo.js';
import { attachRatings } from './ratings.js';
import { gatherCandidates } from './sources.js';
import { log } from './log.js';

// Relative trust in each feature family. Keywords are specific (strong signal);
// genres are broad (weak). Tunable.
const FAMILY_WEIGHT = { keyword: 1.0, director: 1.4, cast: 0.5, genre: 0.6, decade: 0.4 };
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

// Build { weights: Map<feature, score>, mean } from a user's rated movies.
export async function buildProfile(userId) {
  const ratings = getRatings(userId).filter((r) => r.media_type === 'movie');
  if (!ratings.length) return { weights: new Map(), mean: 7, count: 0 };

  const mean = ratings.reduce((s, r) => s + r.rating, 0) / ratings.length;
  const weights = new Map();
  const counts = new Map();

  let processed = 0;
  for (const r of ratings) {
    if (++processed % YIELD_EVERY === 0) await breathe();
    let movie;
    try { movie = await details(r.tmdb_id, 'movie'); } catch { continue; }
    const delta = r.rating - mean; // liked-vs-typical signal
    for (const feat of featuresOf(movie)) {
      weights.set(feat, (weights.get(feat) || 0) + delta);
      counts.set(feat, (counts.get(feat) || 0) + 1);
    }
  }

  // Shrink toward zero for features seen only once or twice (low confidence).
  for (const [feat, w] of weights) {
    const n = counts.get(feat);
    weights.set(feat, w * (n / (n + 1)));
  }
  return { weights, mean, count: ratings.length };
}

// `collabHits` = how many of the user's loved films Trakt lists this title as
// related to (0 when Trakt is off or has no link). It rides on top of the
// content+quality blend as a saturating bonus rather than a re-weighted term.
function scoreMovie(movie, profile, collabHits = 0) {
  let raw = 0;
  for (const feat of featuresOf(movie)) {
    const w = profile.weights.get(feat);
    if (!w) continue;
    const family = feat.split(':')[0];
    raw += w * (FAMILY_WEIGHT[family] ?? 1);
  }
  // Squash to a 0..100 "match score" and nudge by TMDB community rating.
  const match = 50 + 50 * Math.tanh(raw / 12);
  const quality = (movie.vote_average || 6) * 10; // 0..100
  const base = 0.75 * match + 0.25 * quality;
  const collab = COLLAB_WEIGHT * Math.tanh(collabHits / 2); // 1 hit ≈ +7, saturates ≈ +15
  return Math.min(100, Math.round(base + collab));
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
export function resolveFilters({ origin = '', excludeUs = false, indie = false } = {}) {
  return { allowed: allowedOriginFromValue(origin), excludeUs: !!excludeUs, indie: !!indie };
}

// Stable signature of a filter set for the pool cache key, so each distinct
// origin/indie combination caches its own pool (like region and providers do).
export function filterSig({ allowed, excludeUs, indie } = {}) {
  const origins = [...(allowed || [])].sort().join(',');
  return `${excludeUs ? 'nous' : ''}.${indie ? 'indie' : ''}.${origins || 'any'}`;
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
const POOL_SIZE = 80;
// Upper bound on candidates we fetch full details for per pool. With many
// sources the merged set can run large; this caps the per-build TMDB detail
// fetches (and latency) while still leaving ample headroom over POOL_SIZE after
// the streamability gate drops most candidates.
const CANDIDATE_CAP = 250;
// How many of each pool's top titles get IMDb/Metacritic ratings attached during
// the (background) build. Enough to cover the ~36 shown plus dismissal headroom,
// so serving never has to make those slow web lookups itself.
const ENRICH_COUNT = 50;

// Build the scored candidate pool for one genre (or all genres when genreId is
// undefined). Heavy part — many TMDB calls — so its output gets cached.
async function computePool({ userId, region, providerIds, genreId, profile, ratings, language, filters = {} }) {
  const seen = new Set(ratings.map((r) => `${r.media_type}:${r.tmdb_id}`));
  for (const d of getDismissed(userId)) seen.add(`${d.media_type}:${d.tmdb_id}`);

  // Assemble candidates from every configured source (TMDB discover variants,
  // recommendations, similar, trending; Trakt related + charts). Each yields ids
  // only; scoring, the genre filter and the streamability gate below are the one
  // shared place those rules live. collab[id] = crowd co-watch hits for scoreMovie.
  const { candidates, collab } = await gatherCandidates({ region, providerIds, genreId, ratings, language });

  // Cap the merged set before the expensive per-title detail fetch. The registry
  // is priority-ordered and the Map preserves it, so the strongest sources fill
  // the budget first; the broad charts only top it up.
  const pool = [...candidates.values()].slice(0, CANDIDATE_CAP);

  // Score each candidate on its full feature set.
  const userSet = new Set(providerIds || []);
  const scored = [];
  let processed = 0;
  for (const m of pool) {
    if (++processed % YIELD_EVERY === 0) await breathe();
    if (seen.has(`movie:${m.id}`)) continue;
    let full;
    try { full = await details(m.id, 'movie', language); } catch { continue; }
    // When a genre is selected, keep only titles tagged with it (the seed/chart
    // sources aren't genre-constrained at source, so filter here too).
    if (genreId && !(full.genres || []).some((g) => g.id === genreId)) continue;
    // Origin (continent/country/non-US) and indie filters — same hard-drop
    // model as the genre filter, applied uniformly to every candidate source.
    if (!matchesOrigin(full, filters)) continue;
    if (filters.indie && !isIndie(full)) continue;
    // Drop titles not on a chosen service in the user's region; otherwise keep
    // the matched services so the card can show (and deep-link) each one.
    const services = userServices(full, region, userSet);
    if (!services.length) continue;
    const crew = full.credits?.crew || [];
    scored.push({
      tmdb_id: m.id,
      imdb_id: full.external_ids?.imdb_id || null,
      title: full.title,
      year: Number((full.release_date || '').slice(0, 4)) || null,
      runtime: full.runtime || null,
      overview: full.overview,
      poster_path: full.poster_path,
      vote_average: full.vote_average,
      genres: (full.genres || []).map((g) => g.name),
      director: crew.filter((c) => c.job === 'Director').map((c) => c.name).join(', ') || null,
      cast: (full.credits?.cast || []).slice(0, CAST_DEPTH).map((c) => c.name),
      services,
      score: scoreMovie(full, profile, collab.get(m.id) || 0),
    });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, POOL_SIZE);
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
// triggers just one rebuild and never blocks another user's.
const timers = new Map();       // userId -> timeout
const running = new Set();       // userIds currently prebuilding
const pendingDirty = new Set();  // userIds asked to rerun while running
// Tests run against a single-process server and assert on the deterministic
// on-demand build that /api/recommend does. Background prebuilds (all-genres +
// one pool per genre) would otherwise pile up on that one process and starve
// those foreground builds, making render timings race. Off in e2e, on in prod.
const PREBUILD_DISABLED = process.env.DISABLE_REC_PREBUILD === '1';
function schedulePrebuild(userId, delay = 4000) {
  if (PREBUILD_DISABLED) return;
  if (timers.has(userId)) clearTimeout(timers.get(userId));
  timers.set(userId, setTimeout(() => { timers.delete(userId); runPrebuild(userId); }, delay));
}
// Like schedulePrebuild but never pushes back an already-pending/running rebuild
// — used on the stale-serve path so browsing genres can't starve the refresh.
function ensurePrebuild(userId) {
  if (!timers.has(userId) && !running.has(userId)) schedulePrebuild(userId);
}
async function runPrebuild(userId) {
  if (running.has(userId)) { pendingDirty.add(userId); return; }
  running.add(userId); pendingDirty.delete(userId);
  try { await prebuildRecommendations(userId); }
  catch (e) { log.error('prebuild failed:', e.message); }
  finally { running.delete(userId); if (pendingDirty.has(userId)) schedulePrebuild(userId, 1000); }
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
    director: crew.filter((c) => c.job === 'Director').map((c) => c.name).join(', ') || null,
    cast: (full.credits?.cast || []).slice(0, CAST_DEPTH).map((c) => c.name),
    services: userServices(full, region, new Set((providerIds || []).map(Number))),
  };
  await attachRatings([item]); // adds imdbRating + metascore (or leaves them null)
  return item;
}

// Background one-off at startup: enrich every saved title that predates save-time
// capture so the Watchlist tab matches Discover. Naturally idempotent — it only
// touches rows whose `card` is still null, so a re-run after everything's filled
// is a cheap empty query. Gentle on TMDB: one user at a time, yielding between
// items so /health and live traffic aren't starved (see the breathe() rationale).
export async function backfillWatchlistCards() {
  if (!tmdbConfigured()) return;
  for (const u of listUsers()) {
    const rows = watchlistNeedingCard(u.id);
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
