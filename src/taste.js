// Content-based taste model + candidate scoring (the Criticker-style part).
//
// Idea: from each user's ratings, learn which features (genres, keywords,
// director, top cast, decade) correlate with above-average liking. Then score
// unseen-but-streamable candidates by how many of those features they carry.
// Everything is per-user: profiles, candidate pools, caches, and prebuilds.
import { details, recommendations, discover, genres as tmdbGenres, tmdbConfigured } from './tmdb.js';
import { getRatings, getDismissed, getUserSetting, setUserSetting, cacheGet, cacheSet, listUsers } from './db.js';
import { attachRatings } from './ratings.js';
import { traktConfigured, relatedMovies } from './trakt.js';

// Relative trust in each feature family. Keywords are specific (strong signal);
// genres are broad (weak). Tunable.
const FAMILY_WEIGHT = { keyword: 1.0, director: 1.4, cast: 0.5, genre: 0.6, decade: 0.4 };
const CAST_DEPTH = 5; // how many top-billed actors to consider
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

// Build { weights: Map<feature, score>, mean } from a user's rated movies.
export async function buildProfile(userId) {
  const ratings = getRatings(userId).filter((r) => r.media_type === 'movie');
  if (!ratings.length) return { weights: new Map(), mean: 7, count: 0 };

  const mean = ratings.reduce((s, r) => s + r.rating, 0) / ratings.length;
  const weights = new Map();
  const counts = new Map();

  for (const r of ratings) {
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

// Keep a candidate only if, in the user's region, it streams on a service they
// picked in Settings. Pool 1 (discover) already satisfies this, but pools 2 & 3
// don't, so we re-check here. Both flatrate (subscription) and free/ads tiers of
// a chosen service count — what matters is that the user selected that service.
// `full` carries TMDB's appended watch/providers block (see tmdb.js details()).
function streamableForUser(full, region, userSet) {
  const wp = full['watch/providers']?.results?.[region];
  if (!wp) return false;
  const offered = [...(wp.flatrate || []), ...(wp.free || []), ...(wp.ads || [])];
  return offered.some((p) => userSet.has(p.provider_id));
}

// How many scored titles we keep per (user, region, services, genre) pool. We
// cache a surplus over what the UI shows (server asks for 36) so titles rated or
// dismissed mid-session can be filtered out at serve time without depleting it.
const POOL_SIZE = 80;
// How many of each pool's top titles get IMDb/Metacritic ratings attached during
// the (background) build. Enough to cover the ~36 shown plus dismissal headroom,
// so serving never has to make those slow web lookups itself.
const ENRICH_COUNT = 50;

// Build the scored candidate pool for one genre (or all genres when genreId is
// undefined). Heavy part — many TMDB calls — so its output gets cached.
async function computePool({ userId, region, providerIds, genreId, profile, ratings }) {
  const seen = new Set(ratings.map((r) => `${r.media_type}:${r.tmdb_id}`));
  for (const d of getDismissed(userId)) seen.add(`${d.media_type}:${d.tmdb_id}`);

  // Candidate pool 1: what's streamable in-country on the user's services.
  const candidates = new Map();
  if (providerIds?.length) {
    for (let page = 1; page <= 3; page++) {
      const res = await discover({ region, providerIds, genreId, mediaType: 'movie', page });
      for (const m of res.results || []) candidates.set(m.id, m);
      if (page >= (res.total_pages || 1)) break;
    }
  }
  // Candidate pool 2: TMDB recommendations seeded from your rated films. We seed
  // from all of them (highest-rated first), not just those above your average, so
  // every pick contributes — costs more TMDB/Trakt calls up front but is broader.
  const top = ratings
    .filter((r) => r.media_type === 'movie')
    .sort((a, b) => b.rating - a.rating)
    .slice(0, 10);
  for (const r of top) {
    try {
      const rec = await recommendations(r.tmdb_id, 'movie');
      for (const m of rec.results || []) if (!candidates.has(m.id)) candidates.set(m.id, m);
    } catch { /* ignore */ }
  }
  // Candidate pool 3 (optional): Trakt's community "related" titles, seeded from
  // the same top-rated films. collab[tmdbId] counts how many loved films each
  // candidate is related to — a crowd signal scoreMovie() folds in as a bonus.
  const collab = new Map();
  if (traktConfigured()) {
    for (const r of top) {
      let imdbId;
      try { imdbId = (await details(r.tmdb_id, 'movie')).external_ids?.imdb_id; } catch { continue; }
      for (const m of await relatedMovies(imdbId)) {
        collab.set(m.tmdb_id, (collab.get(m.tmdb_id) || 0) + 1);
        if (!candidates.has(m.tmdb_id)) candidates.set(m.tmdb_id, { id: m.tmdb_id, title: m.title });
      }
    }
  }

  // Score each candidate on its full feature set.
  const userSet = new Set(providerIds || []);
  const scored = [];
  for (const m of candidates.values()) {
    if (seen.has(`movie:${m.id}`)) continue;
    let full;
    try { full = await details(m.id, 'movie'); } catch { continue; }
    // When a genre is selected, keep only titles tagged with it (pools 2 & 3
    // aren't genre-constrained at the source, so filter here too).
    if (genreId && !(full.genres || []).some((g) => g.id === genreId)) continue;
    // Drop titles not on a chosen service in the user's region.
    if (!streamableForUser(full, region, userSet)) continue;
    const crew = full.credits?.crew || [];
    scored.push({
      tmdb_id: m.id,
      imdb_id: full.external_ids?.imdb_id || null,
      title: full.title,
      year: Number((full.release_date || '').slice(0, 4)) || null,
      overview: full.overview,
      poster_path: full.poster_path,
      vote_average: full.vote_average,
      genres: (full.genres || []).map((g) => g.name),
      director: crew.filter((c) => c.job === 'Director').map((c) => c.name).join(', ') || null,
      cast: (full.credits?.cast || []).slice(0, CAST_DEPTH).map((c) => c.name),
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

function poolKey(userId, region, providerIds, genreId) {
  const provs = [...(providerIds || [])].map(Number).sort((a, b) => a - b).join('-');
  return `recpool:${userId}:${region}:${provs}:${genreId || 'all'}`;
}
const currentGen = (userId) => getUserSetting(userId, 'recGen', 0);

// Compute one pool and store it under the user's current generation.
async function buildAndCache({ userId, region, providerIds, genreId, profile, ratings }) {
  profile = profile || (await buildProfile(userId));
  ratings = ratings || getRatings(userId);
  const pool = await computePool({ userId, region, providerIds, genreId, profile, ratings });
  // Enrich the top of the pool with IMDb/Metacritic ratings here (background) so
  // serving is a pure cache read — these lookups hit the web on a cold cache.
  await attachRatings(pool.slice(0, ENRICH_COUNT));
  const value = { gen: currentGen(userId), profileSize: profile.count, pool };
  cacheSet(poolKey(userId, region, providerIds, genreId), value);
  return value;
}

// Serve a user's recommendations: read the cached pool (already enriched during
// its build), drop anything rated/dismissed since, then take the top `limit`.
// Stale-while-revalidate: an out-of-date pool is served immediately with a
// background rebuild scheduled; we only block when there's no cached pool at all
// (a genre the warm hasn't reached) or when force=true (Refresh).
export async function recommend({ userId, region, providerIds, genreId, limit = 30, force = false }) {
  let cached = cacheGet(poolKey(userId, region, providerIds, genreId));
  if (!cached || force) {
    cached = await buildAndCache({ userId, region, providerIds, genreId });
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
  const profile = await buildProfile(userId);
  const ratings = getRatings(userId);
  await buildAndCache({ userId, region, providerIds, genreId: undefined, profile, ratings });
  let list = [];
  try { list = (await tmdbGenres('movie')).genres || []; } catch { return; }
  for (const g of list) {
    try { await buildAndCache({ userId, region, providerIds, genreId: g.id, profile, ratings }); }
    catch (e) { console.error(`prebuild genre ${g.name} failed for user ${userId}:`, e.message); }
  }
}

// Debounced background prebuild, keyed per user so one user's burst of ratings
// triggers just one rebuild and never blocks another user's.
const timers = new Map();       // userId -> timeout
const running = new Set();       // userIds currently prebuilding
const pendingDirty = new Set();  // userIds asked to rerun while running
function schedulePrebuild(userId, delay = 4000) {
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
  catch (e) { console.error('prebuild failed:', e.message); }
  finally { running.delete(userId); if (pendingDirty.has(userId)) schedulePrebuild(userId, 1000); }
}

// Call when a user's ratings/dismissals/settings change: marks their pools stale
// and schedules a fresh prebuild for them in the background.
export function invalidateRecommendations(userId) {
  setUserSetting(userId, 'recGen', currentGen(userId) + 1);
  schedulePrebuild(userId);
}

// Call once at startup to warm every user's caches if a TMDB key is configured.
export function warmRecommendations() {
  if (!tmdbConfigured()) return;
  for (const u of listUsers()) schedulePrebuild(u.id, 1500);
}
