// Content-based taste model + candidate scoring (the Criticker-style part).
//
// Idea: from each user's ratings, learn which features (genres, keywords,
// director, top cast, decade) correlate with above-average liking. Then score
// unseen-but-streamable candidates by how many of those features they carry.
// Everything is per-user: profiles, candidate pools, caches, and prebuilds.
import { details, tmdbConfigured, pickTrailers, personImdbId, searchMulti, watchProviders, genres } from './tmdb.js';
import { getRatings, getDismissed, getWatchlistIds, getUserSetting, setUserSetting, cacheGet, cacheSet, listUsers,
  watchlistNeedingEnrichment, setWatchlistCard, getMovieToneSlugs, getMovieToneSlugsBatch, toCount } from './db.js';
import { tmdbLang, DEFAULT_LANGUAGE } from './locale.js';
import { allowedOriginFromValue } from './geo.js';
import { attachRatings, cachedImdbDetail, cachedMetascore } from './ratings.js';
import { gatherCandidates, sourcesFor, headSourcesFor, mediaKey } from './sources.js';
import { isTone, toneLabel } from './tones.js';
import { toneSlugs, tonesForMovie } from './tone-store.js';
import { resolveTones } from './tone-sources.js';
import { boundedRunner, mapPool } from './concurrency.js';
import { buildProfileVector, scoreCandidate, genreDistribution, rerank } from './scoring.js';
import { recordSeen, globalIdf, globalMeanRating } from './global-stats.js';
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
// `mediaType` ('movie' | 'tv') tags the title so its stored tones are read from
// the right provenance rows (a movie and a series can share a tmdb id). Genres,
// keywords and cast carry no media prefix on purpose: a genre/person the user
// likes counts the same whether it shows up in a film or a series, so taste
// transfers across the two.
function featureEntries(item, mediaType = 'movie', storedTonesFor = getMovieToneSlugs) {
  const e = [];
  for (const g of item.genres || []) e.push([`genre:${g.id}`, g.name]);
  for (const k of item.keywords?.keywords || []) e.push([`keyword:${k.id}`, k.name]);
  // Tone tags (heartfelt, deadpan…) derived from keywords + Netflix membership,
  // scored like any other feature so the profile learns a user's mood affinities.
  for (const s of toneSlugs(item, mediaType, storedTonesFor)) e.push([`tone:${s}`, toneLabel(s)]);
  const crew = item.credits?.crew || [];
  for (const d of crew.filter((c) => c.job === 'Director')) e.push([`director:${d.id}`, d.name]);
  for (const a of (item.credits?.cast || []).slice(0, CAST_DEPTH)) e.push([`cast:${a.id}`, a.name]);
  const yr = Number((item.release_date || '').slice(0, 4));
  if (yr) { const d = Math.floor(yr / 10) * 10; e.push([`decade:${d}`, `${d}s`]); }
  return e;
}

// Just the feature ids — what scoring works in. (featureEntries also carries the
// human labels the insights page needs.)
function featuresOf(item, mediaType = 'movie', storedTonesFor = getMovieToneSlugs) {
  return featureEntries(item, mediaType, storedTonesFor).map(([id]) => id);
}

// Stored tones for a mixed movie+TV pool, returned as a lookup keyed by the
// (media_type, id) pair so a film and a series sharing a tmdb id don't cross-
// pollinate tones. One batched IN-scan per media type — the same single-query
// shape getMovieToneSlugsBatch gives, split by type — so the hot build path keeps
// its N+1 fix. The returned fn matches storedTonesFor's (id, mediaType) contract.
function poolTonesLookup(items) {
  const map = new Map();
  for (const mt of new Set(items.map((m) => m.media_type || 'movie'))) {
    const ids = items.filter((m) => (m.media_type || 'movie') === mt).map((m) => m.id);
    for (const [id, slugs] of getMovieToneSlugsBatch(ids, mt)) map.set(mediaKey(mt, id), slugs);
  }
  return (id, mediaType = 'movie') => map.get(mediaKey(mediaType, id)) || [];
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
// films' feature sets and genre lists — the feature sets seed which features the
// ranking pass looks up an IDF for (weights come from the global corpus stats,
// global-stats.js), the genre lists are the calibration target. No weighting/
// squashing happens here — that's scoring.js.
// Pass a `labels` Map to also capture each feature's human label (id → name) as
// the films are walked — the insights page needs it; the hot scoring path omits
// it and pays nothing.
export async function buildProfile(userId, { labels } = {}) {
  // Movie AND TV ratings both shape one taste profile — a genre or actor the user
  // loves counts whichever medium it came from (see featureEntries).
  const ratings = getRatings(userId);
  if (!ratings.length) return EMPTY_PROFILE();

  // Resolve every rated title's stored tones in one query per media type, like the
  // candidate pool, so featureEntries below isn't a per-rating N+1.
  const storedTonesFor = poolTonesLookup(ratings.map((r) => ({ id: r.tmdb_id, media_type: r.media_type })));

  const mean = ratings.reduce((s, r) => s + r.rating, 0) / ratings.length;
  const pos = new Map(), neg = new Map(), counts = new Map();
  const ratedFeatureSets = [], genreLists = [];

  let processed = 0;
  for (const r of ratings) {
    if (++processed % YIELD_EVERY === 0) await breathe();
    let movie;
    try { movie = await details(r.tmdb_id, r.media_type); } catch { continue; }
    const delta = r.rating - mean; // liked-vs-typical signal
    const entries = featureEntries(movie, r.media_type, storedTonesFor);
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
export function resolveFilters({ origin = '', excludeUs = false, indie = false, tone = '', type = '' } = {}) {
  // An unknown tone/type is dropped to '' (no filter) so a stale/typo'd query
  // can't build an empty pool — same lenient stance the other controls take.
  return {
    allowed: allowedOriginFromValue(origin), excludeUs: !!excludeUs, indie: !!indie,
    tone: isTone(tone) ? tone : '', type: (type === 'movie' || type === 'tv') ? type : '',
  };
}

// Stable signature of a filter set for the pool cache key, so each distinct
// origin/indie combination caches its own pool (like region and providers do).
export function filterSig({ allowed, excludeUs, indie, tone, type } = {}) {
  const origins = [...(allowed || [])].sort().join(',');
  return `${excludeUs ? 'nous' : ''}.${indie ? 'indie' : ''}.${tone ? `t-${tone}` : ''}.${type || 'both'}.${origins || 'any'}`;
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
// How many candidate detail fetches run at once during a corpus build. The detail
// fetch is the build's dominant cost (~95% of cold-cache wall time), so it must
// fan out rather than await one title at a time; 8 keeps it well under TMDB's
// limits (the convention's 5-10 band) while collapsing the fetch phase ~8x.
const DETAIL_FETCH_CONCURRENCY = 16;
// How many survivors the fast foreground "head" build stops at before serving (see
// buildCorpus survivorTarget). Comfortably over the 36 a page shows — with margin
// for rate/dismiss/watchlist exclusions and the diversity rerank — so the first
// paint is a full grid, while the remaining ~CANDIDATE_CAP candidates are fetched
// by the deeper background rebuild the cold serve schedules. On a cold cache this
// is the difference between waiting on ~60 detail fetches and ~500.
const FAST_HEAD = 60;
// A ceiling on how many candidate details the head build fetches, independent of
// survivorTarget. The origin/indie/tone hard filters run AFTER the detail fetch
// (fetchSurvivor), so a view that drops most of what it fetches — the non-US origin
// toggle over a US-heavy region catalog is the worst case — never reaches
// survivorTarget and, without this, walks the whole ~500-candidate pool: exactly
// the full-build latency the head exists to avoid ("non-US picks take ages"). Cap
// the fetch COUNT too; whatever survived within it serves, the rest is deepened in
// the background. Comfortably over FAST_HEAD so a healthy (dense) head still stops
// on survivors, well under CANDIDATE_CAP so a sparse filter stays bounded.
const HEAD_FETCH_BUDGET = 160;
// The full (background) build bails once it has probed STARVATION_PROBE candidates
// and fewer than STARVATION_MIN survived — the pool is starved (a heavy account
// whose streamable catalogue is all consumed), so fetching the rest of the
// CANDIDATE_CAP just wastes tens of seconds finding nothing and pins the shared CPU.
const STARVATION_PROBE = 160;
const STARVATION_MIN = 12;
// The recommendation build is split into two layers so a rating doesn't pay for
// the whole thing. buildCorpus is the expensive, taste-independent layer (gather +
// ~500 detail fetches + enrichment); it barely moves when a user rates one more
// film — 12 of 15 candidate sources don't depend on the profile at all, and the
// seed-based three only shift if the rating cracks the top-10 seeds. rankCorpus is
// the cheap layer (IDF + scoring + rerank, ~100ms over the cached corpus). A rating
// re-runs only rankCorpus; the corpus is rebuilt with fresh seeds in the background.

// Build the candidate corpus for one genre (or all genres when genreId is
// undefined): gather → fetch details → hard-filter → per-survivor scoring-ready
// cards. The heavy part is the many TMDB detail fetches, so the output is cached
// under a key WITHOUT the recGen stamp (see corpusKey): a rating re-ranks it
// rather than rebuilding it. With `survivorTarget` set, the detail fetch stops once
// that many candidates survive — the fast foreground "head" build that lets picks
// paint after a fraction of the full ~500-candidate fetch, leaving the rest to the
// deeper background rebuild. `complete` in the result says whether the whole
// candidate set was fetched (full depth) or the build stopped early (a head).
async function buildCorpus({ userId, region, providerIds, genreId, ratings, language, filters = {}, survivorTarget }) {
  // Titles the user has already handled — rated, dismissed, or saved to their
  // watchlist — must never be recommended. Keyed by the (media_type, tmdb id) pair
  // since that's the unit candidate sources and the cap work in, and a movie and a
  // series can share a tmdb id. Saved titles were the missing case: without them
  // the pool filled with films already on the watchlist that the UI then stripped
  // out, starving Discover.
  const consumed = new Set();
  for (const r of ratings) consumed.add(mediaKey(r.media_type, r.tmdb_id));
  for (const d of getDismissed(userId)) consumed.add(mediaKey(d.media_type, d.tmdb_id));
  for (const w of getWatchlistIds(userId)) consumed.add(mediaKey(w.media_type, w.tmdb_id));

  // Assemble candidates from every configured source (TMDB discover variants,
  // recommendations, similar, trending; Trakt related + charts). Each yields ids
  // only; scoring, the genre filter and the streamability gate below are the one
  // shared place those rules live. `consumed` also tells the provider-scoped
  // Discover sources how deep to page — past titles already handled until they've
  // surfaced enough fresh ones. collab[id] = crowd co-watch hits, an additive bonus.
  const tGather = performance.now();
  // A media-type filter narrows the source set HERE — before the cap — so a
  // one-type pool fills entirely with the wanted type instead of starving (see
  // sourcesFor). No filter keeps the full mixed registry.
  //
  // The fast foreground HEAD build (survivorTarget) of the unfiltered / type-only
  // view gathers from the lean HEAD_SOURCES — the provider-scoped Discover + trending
  // sweeps only — skipping the gather's slow, high-fan-out sources (per-genre
  // Discover, per-rated seeds, letterboxd/Trakt scrapers) that dominate a cold
  // build's wall time. The background full build (no survivorTarget) keeps the rich
  // ALL_SOURCES for breadth and replaces the head. A genre/tone/origin/indie head
  // still needs those source-scoped sweeps, so it keeps sourcesFor.
  const leanHead = survivorTarget && !genreId && !filters.tone
    && !filters.excludeUs && !filters.indie && !(filters.allowed && filters.allowed.length);
  const sources = leanHead ? headSourcesFor(filters.type) : sourcesFor(filters.type);
  const { candidates, collab } = await gatherCandidates(
    { region, providerIds, genreId, tone: filters.tone, ratings, language, consumed }, sources);
  const gatherMs = performance.now() - tGather;

  // Drop handled titles BEFORE the cap, so the (capped) detail-fetch budget is
  // spent on candidates that can actually become picks rather than re-fetching
  // titles we'd only discard. The registry is priority-ordered and the Map
  // preserves it, so the strongest fresh sources fill the budget first.
  //
  // When a genre is selected, drop candidates whose list-level genre_ids already
  // rule it out — BEFORE the detail fetch — for the same "don't spend the budget on
  // titles we'd only discard" reason. The provider Discover sweeps are already
  // genre-scoped server-side (with_genres), but the seed/chart sources aren't, so a
  // sparse genre (Documentary) otherwise fills the whole fetch budget with titles
  // dropped post-fetch at fetchSurvivor — the "genre takes ages" head. TMDB list
  // items carry genre_ids; a candidate without them (Trakt/scraped) is kept for the
  // authoritative full.genres check in fetchSurvivor.
  const genrePlausible = (m) => !genreId || !Array.isArray(m.genre_ids) || m.genre_ids.includes(genreId);
  const pool = [...candidates.values()]
    .filter((m) => !consumed.has(mediaKey(m.media_type, m.id)) && genrePlausible(m))
    .slice(0, CANDIDATE_CAP);

  // Prefetch every candidate's stored tones in ONE query per media type, then read
  // them from the map below (filter, features, scoring). Per-title getMovieToneSlugs()
  // here was a CANDIDATE_CAP-sized N+1 — the measured ~11s of synchronous DB per build.
  const storedTonesFor = poolTonesLookup(pool);

  // Fetch details, apply the hard filters + streamability gate, and collect each
  // survivor. Scoring happens later (rankCorpus) because the IDF feature weights
  // depend on the whole candidate corpus.
  const userSet = new Set(providerIds || []);
  // Fetch one candidate's details (the build's dominant cost — ~95% of cold-cache
  // wall time, prod detailsMs ~30-57s) and apply the genre/origin/indie/tone hard
  // filters + the streamability gate inline (all synchronous). Returns the survivor
  // or null; a failed fetch is isolated (null) so one bad title never stalls a batch.
  const fetchSurvivor = async (m) => {
    // Media-type filter: sourcesFor already excludes the other type, but the
    // seed/chart sources can surface a stray, so guard before the detail fetch.
    if (filters.type && m.media_type !== filters.type) return null;
    let full;
    try { full = await details(m.id, m.media_type, language); } catch { return null; }
    // When a genre is selected, keep only titles tagged with it (the seed/chart
    // sources aren't genre-constrained at source, so filter here too). The genre
    // dropdown carries movie genre ids, whose namespace differs from TV's, so a
    // genre-scoped view is film-led — the all-genres default is the mixed feed.
    if (genreId && !(full.genres || []).some((g) => g.id === genreId)) return null;
    // Origin (continent/country/non-US) and indie filters — same hard-drop model
    // as the genre filter, applied uniformly to every candidate source.
    if (!matchesOrigin(full, filters)) return null;
    if (filters.indie && !isIndie(full)) return null;
    // Tone filter (the Discover "tone" control / a ?tag= deep link).
    if (filters.tone && !toneSlugs(full, m.media_type, storedTonesFor).includes(filters.tone)) return null;
    // Drop titles not on a chosen service; otherwise keep the matched services so
    // the card can badge (and deep-link) each one.
    const services = userServices(full, region, userSet);
    if (!services.length) return null;
    return { full, services, collab: collab.get(mediaKey(m.media_type, m.id)) || 0 };
  };
  const tDetails = performance.now();
  let survivors, complete;
  if (survivorTarget) {
    // Fast "head" build: fetch in source-priority order, DETAIL_FETCH_CONCURRENCY at
    // a time, and STOP once survivorTarget candidates survive — so the foreground
    // serve waits on only a fraction of the fetch. complete is false when candidates
    // remained unfetched (a head to deepen later), true when we exhausted them anyway
    // (a small candidate set is already full depth, nothing to deepen).
    survivors = [];
    let fetched = 0;
    for (let i = 0; i < pool.length && survivors.length < survivorTarget && fetched < HEAD_FETCH_BUDGET; i += DETAIL_FETCH_CONCURRENCY) {
      const batch = pool.slice(i, i + DETAIL_FETCH_CONCURRENCY);
      for (const s of await Promise.all(batch.map(fetchSurvivor))) if (s) survivors.push(s);
      fetched += batch.length;
    }
    complete = fetched >= pool.length;
  } else {
    // Full build (the background rebuild): keep DETAIL_FETCH_CONCURRENCY fetches in
    // flight continuously via the bounded pool for max throughput, writing each
    // survivor into its candidate slot so the corpus keeps source-priority order no
    // matter which fetch lands first. mapPool isolates failures and yields the loop
    // at every await, so the build keeps the event loop breathing.
    //
    // BUT bail if the pool is starved: a heavy account whose streamable candidates
    // are all already consumed yields almost no survivors, and walking the whole
    // CANDIDATE_CAP to find nothing wastes tens of seconds and pins the shared CPU
    // (prod: ~94s of detail fetches for 0 survivors). After probing STARVATION_PROBE
    // candidates, if fewer than STARVATION_MIN survived, skip the rest — later
    // fetchSurvivor calls return null without a network round-trip, so the pool
    // completes fast. A healthy (dense) pool clears the probe and walks the lot.
    const slots = new Array(pool.length);
    let fetched = 0, survived = 0, starved = false;
    await mapPool(pool, DETAIL_FETCH_CONCURRENCY, async (m, i) => {
      if (starved) return; // probe already found the pool hopeless — don't fetch
      const s = await fetchSurvivor(m);
      slots[i] = s;
      fetched += 1;
      if (s) survived += 1;
      if (!starved && fetched >= STARVATION_PROBE && survived < STARVATION_MIN) starved = true;
    });
    survivors = slots.filter(Boolean);
    // A bailed (starved) pool is treated as fully explored — deepening it would just
    // re-waste the fetches — so it's `complete`, not a partial head to deepen.
    complete = true;
  }
  const detailsMs = performance.now() - tDetails;

  // Scoring-ready cards: everything the ranking pass and the UI need, minus the
  // score itself (recomputed per profile in rankCorpus). features/collab and the
  // baked IMDb/Metacritic rating inputs are scoring-only — rankCorpus strips them
  // before serving. A breathe()-yielding loop because building a card per survivor (up to
  // CANDIDATE_CAP) is otherwise an unbroken synchronous block — with node:sqlite
  // synchronous and warm cache hits resolving without real I/O — that starves
  // /health and live traffic. storedTonesFor keeps the tone reads batched.
  const cards = [];
  let built = 0;
  for (const s of survivors) {
    if (++built % YIELD_EVERY === 0) await breathe();
    const crew = s.full.credits?.crew || [];
    const imdbId = s.full.external_ids?.imdb_id || null;
    const year = Number((s.full.release_date || '').slice(0, 4)) || null;
    // Bake the quality prior's inputs — IMDb (rating + vote count) and the
    // Metacritic score — from the DURABLE cache only, no network: whatever a past
    // enrich or the background prefetch pass has already resolved. A miss leaves
    // them null and the film scores on taste alone (scoring.qualityPrior skips the
    // prior). imdb_id keys IMDb reliably; a localised title may miss its MC key
    // (indexed under the English title), which only costs the MC nudge, not IMDb.
    const imdb = cachedImdbDetail(imdbId);
    cards.push({
      tmdb_id: s.full.id,
      media_type: s.full.media_type,
      imdb_id: imdbId,
      title: s.full.title,
      year,
      runtime: s.full.runtime || null,
      // TV-only: shown on the card in place of a film's runtime. Coerce to a
      // count — a raw TMDB seasons array here would poison a strict client's parse.
      seasons: toCount(s.full.seasons),
      episodes: toCount(s.full.episodes),
      overview: s.full.overview,
      poster_path: s.full.poster_path,
      vote_average: s.full.vote_average, // displayed as the ⭐ meta line; NOT a scoring input
      // Scoring-only rating inputs, baked from the durable cache; rankCorpus strips
      // them before serving so the client still enriches badges live (its trigger is
      // imdbRating===undefined), now hitting the warm cache these writes filled.
      imdbRating: imdb?.rating ?? null,
      imdbVotes: imdb?.votes ?? null,
      metascore: cachedMetascore(s.full.title, year),
      genres: (s.full.genres || []).map((g) => g.name),
      genreIds: (s.full.genres || []).map((g) => g.id),
      tones: tonesForMovie(s.full, s.full.media_type, storedTonesFor),
      features: featuresOf(s.full, s.full.media_type, storedTonesFor),
      director: crew.filter((c) => c.job === 'Director').map((c) => c.name).join(', ') || null,
      cast: (s.full.credits?.cast || []).slice(0, CAST_DEPTH).map((c) => c.name),
      trailers: pickTrailers(s.full.videos, language),
      services: s.services,
      collab: s.collab,
    });
  }
  // Feed the global corpus statistics that IDF and the quality-prior baseline are
  // derived from — but only from a COMPLETE build, so partial "head" builds don't
  // skew the document frequencies with a truncated candidate set. recordSeen dedups
  // by title, so a title recurring across builds counts once. The global mean IMDb
  // rating is then read back from those accumulated stats (pool-independent),
  // replacing the old per-pool average that made a title's prior drift with the
  // filter. Best-effort: a DB hiccup writing stats (e.g. SQLITE_BUSY under a
  // Litestream checkpoint) must degrade to slightly staler stats, never fail the
  // build.
  if (complete) {
    try { await recordSeen(cards); }
    catch (e) { log.warn(`global-stats recordSeen failed for user ${userId}:`, e.message); }
  }
  const globalMean = globalMeanRating();

  // Ratings baked above are cache-only; the LIVE IMDb/Metacritic fetch (and any
  // freshly-scraped tones) still happen off the critical path in the on-demand
  // /api/enrich endpoint (enrichPicks) for the cards the client shows, and in the
  // background prefetch pass (prefetchCorpusRatings) that fills the durable cache
  // for the next build to bake. Both persist durably, so coverage compounds.

  // Phase split for the corpus build: gather (source fan-out, mostly cached
  // TMDB/Trakt) and details (per-candidate detail fetch + sync JSON parse).
  log.info(
    `[perf] corpus phases user=${userId} genre=${genreId ?? 'all'} gatherMs=${gatherMs.toFixed(0)} ` +
    `detailsMs=${detailsMs.toFixed(0)} candidates=${pool.length} survivors=${survivors.length} complete=${complete}`,
  );
  return { cards, globalMean, complete };
}

// Rank a cached corpus for one profile: IDF from the global corpus stats, a
// profile vector, per-card score, then the genre-calibration/diversity rerank.
// The only I/O is a handful of indexed reads for the IDF lookup — this is still
// the cheap pass a rating re-runs over the cached corpus, in place of the whole
// buildCorpus. Yields the event loop every YIELD_EVERY scores: even alone it's a
// synchronous stretch over up to CANDIDATE_CAP cards that would otherwise starve
// /health on the per-rating path.
export async function rankCorpus({ cards, globalMean }, profile) {
  // IDF from the accumulated global document frequencies (global-stats.js), so a
  // feature's weight is its rarity across every title we've scored — broad tags
  // weak, distinctive tags strong — and, crucially, INDEPENDENT of which titles
  // this particular pool holds. That pool-independence is what keeps a title's
  // score stable across the type/genre/origin filters. We look up only the
  // features the profile and these candidates actually use.
  const featureUniverse = new Set();
  for (const feats of profile.ratedFeatureSets) for (const f of feats) featureUniverse.add(f);
  for (const c of cards) for (const f of c.features) featureUniverse.add(f);
  const idf = globalIdf(featureUniverse);
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
      imdbRating: c.imdbRating, imdbVotes: c.imdbVotes, metascore: c.metascore, globalMean,
    });
    const collabBonus = COLLAB_WEIGHT * Math.tanh(c.collab / 2);
    scored.push({ ...c, score: Math.min(100, Math.round(base + collabBonus)) });
  }

  // Order by relevance, then re-rank the served head for genre calibration (keep
  // the mix close to the user's history) and diversity (no near-duplicate
  // neighbours). features/collab and the IMDb/MC scoring inputs are scoring-only —
  // strip them before returning, keeping the score. Stripping the ratings also
  // keeps the client's badge enrichment firing (its trigger is imdbRating===
  // undefined). genreIds stays: it's the canonical, language-independent genre key
  // the watchlist filter consolidates on once a pick is saved.
  scored.sort((a, b) => b.score - a.score);
  const profileGenreDist = genreDistribution(profile.genreLists);
  const ranked = rerank(
    scored.map((s) => ({ score: s.score, features: s.features, genres: s.genreIds, card: s })),
    profileGenreDist, idf,
  ).map((r) => r.card);
  return ranked.slice(0, POOL_SIZE).map(({ features, imdbRating, imdbVotes, metascore, collab, ...card }) => card);
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
// The filter signature of the default, unfiltered Discover view — the "landing"
// pool, the only one warmed ahead of time (prebuild). Every cold view now serves a
// fast head first; this signature only distinguishes HOW the head is deepened: the
// landing pool rides the capped prebuilder, a genre/origin/indie/tone pool deepens
// its own exact pool (recommend()).
const LANDING_SIG = filterSig(resolveFilters());

// Rebuild a user's corpus from scratch and rank it — the full, expensive build,
// run on a cold cache, a forced Refresh, and the background prebuild (so frozen
// seeds self-heal). Caches both layers: the corpus (reused across ratings) and the
// ranked pool stamped with the current generation.
export async function buildAndCache({ userId, region, providerIds, genreId, profile, ratings, language, filters, survivorTarget }) {
  profile = profile || (await buildProfile(userId));
  ratings = ratings || getRatings(userId);
  filters = filters || resolveFilters();
  const tCorpus = performance.now();
  const corpus = await buildCorpus({ userId, region, providerIds, genreId, ratings, language, filters, survivorTarget });
  cacheSet(corpusKey(userId, region, providerIds, genreId, language, filters), corpus);
  const corpusMs = performance.now() - tCorpus;
  const tRank = performance.now();
  const pool = await rankCorpus(corpus, profile);
  const rankMs = performance.now() - tRank;
  // Where the build's wall-time goes: corpus (gather + details — the part a rating
  // now skips) vs rank (the pure-CPU scoring pass it re-runs).
  log.info(
    `[perf] build phases user=${userId} genre=${genreId ?? 'all'} ` +
    `corpusMs=${corpusMs.toFixed(0)} rankMs=${rankMs.toFixed(0)}`,
  );
  // `partial` flags a fast head build that stopped short of the full candidate set:
  // recommend() serves it immediately and schedules the deeper rebuild to replace it.
  const value = { gen: currentGen(userId), profileSize: profile.count, pool, partial: !corpus.complete };
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
      // No corpus yet. Serve a fast HEAD for EVERY cold foreground build — the
      // unfiltered landing pool AND any genre/origin/indie/tone filter: fetch details
      // for just enough candidates to fill a page, rank those, serve, then deepen to
      // the full corpus in the background so the user isn't blocked on the whole
      // ~500-candidate fetch. Gating the head on the landing signature was why any
      // filter (notably the non-US origin toggle) fell back to the slow full build.
      // A forced Refresh still pays the full build up front. Dispatched through
      // runBuild so it runs in the worker (off the main loop) in prod; the result is
      // read back from the shared DB once it lands.
      const head = !force;
      await runBuild({ userId, region, providerIds, genreId, language, filters, survivorTarget: head ? FAST_HEAD : undefined });
      cached = cacheGet(poolKey(userId, region, providerIds, genreId, language, filters));
      if (head && cached?.partial) {
        // Deepen the head in the background. The landing pool is warmed by the capped
        // prebuilder (shared with the rating-invalidation path); a genre/filter pool
        // isn't prebuilt, so deepen that exact pool directly.
        if (!genreId && filterSig(filters) === LANDING_SIG) ensurePrebuild(userId);
        else deepenPool({ userId, region, providerIds, genreId, language, filters });
      }
      mode = 'built';
    } else {
      // The ranking is stale but the corpus isn't — re-rank the cached candidates
      // over the fresh profile (cheap, no I/O) and refresh the corpus's seeds in the
      // background. `partial` rides along so a head corpus keeps deepening.
      const profile = await buildProfile(userId);
      const pool = await rankCorpus(corpus, profile);
      cached = { gen: currentGen(userId), profileSize: profile.count, pool, partial: !corpus.complete };
      cacheSet(poolKey(userId, region, providerIds, genreId, language, filters), cached);
      ensurePrebuild(userId);
      mode = 'reranked';
    }
  }
  const excluded = new Set([
    ...getRatings(userId).map((r) => mediaKey(r.media_type, r.tmdb_id)),
    ...getDismissed(userId).map((d) => mediaKey(d.media_type, d.tmdb_id)),
    ...getWatchlistIds(userId).map((w) => mediaKey(w.media_type, w.tmdb_id)),
  ]);
  const results = cached.pool
    .filter((m) => !excluded.has(mediaKey(m.media_type || 'movie', m.tmdb_id)))
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
  // Off the critical path: top up this corpus's IMDb/Metacritic ratings in the
  // durable cache so the next build bakes them into the quality prior. No-op unless
  // a complete corpus exists and it hasn't been swept recently.
  schedulePrefetchRatings(userId, region, providerIds, genreId, language, filters);
  return { profileSize: cached.profileSize, results };
}

// Precompute one user's unfiltered "all genres" pool — the Discover landing view,
// the only pool we warm ahead of time. Per-genre pools build lazily the first time
// a user actually selects that genre (recommend()'s cold-build path), then cache.
//
// Eagerly warming every TMDB genre used to fan ~17 sequential builds per user
// through the single build worker; on the shared-cpu-1x host that monopolised the
// one core for minutes (with a couple of users' prebuilds overlapping it pinned
// detailsMs/rankMs into the tens of seconds), so a foreground "give me my picks"
// request queued behind it — and it inflated the capped TMDB detail cache's
// working set ~17x, thrashing it. Most of those genre pools were never viewed.
// Warming just the landing pool keeps the worker free for the build users wait on
// and shrinks the cache working set to what's actually browsed.
export async function prebuildRecommendations(userId) {
  if (!tmdbConfigured()) return;
  const region = getUserSetting(userId, 'country', 'PL');
  const providerIds = (getUserSetting(userId, 'providers', []) || []).map(Number);
  const language = tmdbLang(getUserSetting(userId, 'language', DEFAULT_LANGUAGE));
  // origin/indie/tone filters are applied on demand at serve time from the
  // Discover controls, so the prebuilt pool is the unfiltered default.
  const filters = resolveFilters();
  const profile = await buildProfile(userId);
  const ratings = getRatings(userId);
  await runBuild({ userId, region, providerIds, genreId: undefined, profile, ratings, language, filters });
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
// on-demand build that /api/recommend does. A background prebuild (the all-genres
// landing pool) would otherwise pile up on that one process and starve those
// foreground builds, making render timings race. Off in e2e, on in prod.
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

// Deepen a specific genre- or filter-scoped head pool to the full ~500-candidate
// corpus in the background; the next serve picks up the complete pool in its place.
// Unlike the landing pool (warmed by the capped prebuilder), these pools aren't
// prebuilt, so the cold head serve schedules their own deepen. runBuild coalesces by
// poolKey, so a reload mid-deepen shares the one in-flight build rather than starting
// a second. Fire-and-forget: the head already served, this only replaces it. Off in
// tests/e2e (same gate as prebuild) so the deterministic on-demand build isn't raced.
function deepenPool(args) {
  if (PREBUILD_DISABLED) return;
  Promise.resolve(runBuild({ ...args, survivorTarget: undefined }))
    .catch((e) => log.error('deepen failed:', e.message));
}

// ---- background rating prefetch -------------------------------------------
// The quality prior is built from IMDb/Metacritic (scoring.qualityPrior), and
// buildCorpus bakes those onto cards from the DURABLE cache only — so a candidate
// nobody has enriched yet has no rating and scores on taste alone. This pass fills
// that gap proactively: for a freshly-built corpus it resolves every candidate's
// IMDb/Metacritic rating into the durable cache, so the NEXT build of that corpus
// bakes them into the prior. It runs OFF the request critical path (fire-and-forget)
// — the whole reason ratings were pulled out of the build — and attachRatings is
// cache-first, so a corpus that's already covered costs no network.

// Resolve+persist IMDb/Metacritic for a corpus's candidates. attachRatings writes
// each score to the durable cache (readThrough) as a side effect; the mutated items
// are throwaway. Best-effort: attachRatings isolates per-title failures itself.
export async function prefetchCorpusRatings(cards) {
  const items = cards.map((c) => ({
    tmdb_id: c.tmdb_id, imdb_id: c.imdb_id, title: c.title, year: c.year,
    director: c.director, cast: c.cast,
  }));
  await attachRatings(items, ENRICH_CONCURRENCY);
}

// The prefetcher is injected through this seam (same pattern as setBuildRunner) so a
// test can swap in a spy and assert the pass is scheduled off the critical path.
let ratingPrefetcher = prefetchCorpusRatings;
export function setRatingPrefetcher(fn) { ratingPrefetcher = fn; }
export function resetRatingPrefetcher() { ratingPrefetcher = prefetchCorpusRatings; }

// One prefetch at a time (it fans out to IMDb/Metacritic internally); re-submitting
// a corpus already in flight collapses. Reads the corpus straight from its cache key
// so no large data is threaded through the runner.
const RATING_PREFETCH_TTL = 6 * 60 * 60 * 1000; // re-sweep a corpus at most once per few hours
const lastRatingPrefetch = new Map(); // corpusKey -> ms of last sweep
const ratingPrefetchRunner = boundedRunner(1, async (key) => {
  const corpus = cacheGet(key);
  if (corpus?.cards?.length) await ratingPrefetcher(corpus.cards);
});

// Fire-and-forget top-up of a corpus's ratings after it's served. Gated off in
// tests/e2e (same switch as prebuild), skipped without TMDB or for a still-partial
// corpus, and rate-limited per corpus so a burst of requests can't re-sweep it.
// Returns whether a sweep was scheduled (testable, like warmLandingPool).
function schedulePrefetchRatings(userId, region, providerIds, genreId, language, filters) {
  if (PREBUILD_DISABLED || !tmdbConfigured()) return false;
  const key = corpusKey(userId, region, providerIds, genreId, language, filters);
  const corpus = cacheGet(key);
  if (!corpus?.complete) return false;
  if (Date.now() - (lastRatingPrefetch.get(key) || 0) < RATING_PREFETCH_TTL) return false;
  lastRatingPrefetch.set(key, Date.now());
  return ratingPrefetchRunner.submit(key);
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

// ---- shared detail warming (cross-user prefetch) --------------------------
// The TMDB detail cache is GLOBAL (keyed by request URL) and shared across every
// user — but it's ephemeral, wiped on each deploy/restart, so a cold build re-
// fetches the same popular titles' details (the ~95% of a build's wall time that
// another user just paid for). This pass warms it IN ADVANCE and ONCE per distinct
// (region, providers, language) config: it fetches the lean head candidates'
// details for each config, so every user on that config then gets cache-hit-fast
// head builds (the gather is already ~0.1s; the details were the cost). One config
// at a time so warming never stampedes TMDB or the shared CPU.
const WARM_DETAILS_POOL = 200;
const warmConfigs = new Map(); // key -> { region, providerIds, language }

// Fetch (and cache) the lean head candidates' details for one config. Awaitable so
// a test can prove the warm makes a subsequent build cache-hit-fast; the runner
// below fires it in the background.
export async function warmConfigDetails({ region, providerIds, language }) {
  const { candidates } = await gatherCandidates(
    { region, providerIds, language, consumed: new Set() }, headSourcesFor(''),
  );
  const pool = [...candidates.values()].slice(0, WARM_DETAILS_POOL);
  await mapPool(pool, DETAIL_FETCH_CONCURRENCY, async (m) => {
    try { await details(m.id, m.media_type, language); } catch { /* best effort — a miss just re-fetches later */ }
  });
  return pool.length;
}

const sharedWarmRunner = boundedRunner(1, async (key) => {
  const cfg = warmConfigs.get(key);
  if (cfg) await warmConfigDetails(cfg);
});

// The distinct (region, providers, language) configs across ready users — the
// working set worth warming. Users with no chosen services are skipped (nothing
// streamable to warm). Exported for the driver + tests.
export function distinctWarmConfigs() {
  const out = new Map();
  for (const u of listUsers()) {
    if (!readyForRecs(u.id)) continue;
    const providerIds = (getUserSetting(u.id, 'providers', []) || []).map(Number).sort((a, b) => a - b);
    if (!providerIds.length) continue;
    const region = getUserSetting(u.id, 'country', 'PL');
    const language = tmdbLang(getUserSetting(u.id, 'language', DEFAULT_LANGUAGE));
    const key = `${region}:${providerIds.join('-')}:${language}`;
    if (!out.has(key)) out.set(key, { region, providerIds, language });
  }
  return out;
}

// Queue a shared-detail warm for every distinct ready-user config. Returns how many
// configs were queued (testable). Call at boot and on an interval; the details TTL
// is a day, so re-warming every few hours keeps the working set hot and refreshes
// what a deploy or an eviction dropped. Off under the prebuild gate (tests/e2e).
export function warmSharedDetails() {
  if (PREBUILD_DISABLED || !tmdbConfigured()) return 0;
  let queued = 0;
  for (const [key, cfg] of distinctWarmConfigs()) {
    warmConfigs.set(key, cfg);
    if (sharedWarmRunner.submit(key)) queued += 1;
  }
  return queued;
}

// True when the user's default "all genres" landing pool is already cached and
// current (built, and not invalidated since) — the same check recommend()'s `hit`
// path makes. warmLandingPool uses it to avoid rebuilding a pool that's ready to
// serve. Exported so the arrival hook's decision is testable without the timer.
export function landingPoolFresh(userId, region, providerIds, language) {
  const cached = cacheGet(poolKey(userId, region, providerIds, undefined, language, resolveFilters()));
  return !!(cached && cached.gen === currentGen(userId));
}

// Warm a returning user's landing pool when they arrive (the SPA's /api/me boot
// probe), so their first Discover request is a cache hit rather than a cold
// gather+detail build. A no-op when TMDB isn't configured, the user hasn't rated
// enough to have picks, or the landing pool is already fresh — so the per-load
// /api/me polls don't re-trigger the expensive rebuild once it's warm. Returns
// whether a warm was scheduled. The build runs through the same debounced, capped
// prebuild runner a rating uses (ensurePrebuild won't push back a pending one).
export function warmLandingPool(userId) {
  if (!tmdbConfigured() || !readyForRecs(userId)) return false;
  const region = getUserSetting(userId, 'country', 'PL');
  const providerIds = (getUserSetting(userId, 'providers', []) || []).map(Number);
  const language = tmdbLang(getUserSetting(userId, 'language', DEFAULT_LANGUAGE));
  if (landingPoolFresh(userId, region, providerIds, language)) return false;
  ensurePrebuild(userId);
  return true;
}

// ---- watchlist card enrichment --------------------------------------------
// Shape a full TMDB detail into the movie-or-TV card the clients render — every
// field a Discover pick carries EXCEPT the score, the scraped IMDb/Metacritic
// badges, and the freshly-resolved tone feeders (the caller adds those when it
// wants them). Pure over the passed detail + user context: no network, no
// scrape, no MotN quota. Shared by watchlist backfill and by-name search so the
// two can't drift in what a card looks like. `services` is the user's chosen
// services that stream this title in their region (empty = not on any of them).
export function cardFromDetail(full, { region, providerIds, language }) {
  const crew = full.credits?.crew || [];
  return {
    tmdb_id: full.id,
    media_type: full.media_type,
    imdb_id: full.external_ids?.imdb_id || null, // attachRatings needs this; not stored
    title: full.title,                           // ditto (metacritic lookup keys on title)
    year: Number((full.release_date || '').slice(0, 4)) || null, // gates rating resolution; not stored
    poster_path: full.poster_path || null,
    runtime: full.runtime || null,
    seasons: full.seasons ?? null,   // TV-only — rendered in place of runtime
    episodes: full.episodes ?? null,
    overview: full.overview || null,
    vote_average: full.vote_average ?? null,
    genres: (full.genres || []).map((g) => g.name),
    genreIds: (full.genres || []).map((g) => g.id), // canonical, language-independent — the genre filter consolidates on these
    tones: tonesForMovie(full, full.media_type),
    director: crew.filter((c) => c.job === 'Director').map((c) => c.name).join(', ') || null,
    cast: (full.credits?.cast || []).slice(0, CAST_DEPTH).map((c) => c.name),
    trailers: pickTrailers(full.videos, language),
    services: userServices(full, region, new Set((providerIds || []).map(Number))),
  };
}

// Re-derive the rich card fields for one already-saved title, server side, so a
// title saved before save-time capture (or whose capture failed) renders exactly
// like a fresh Discover pick — same fields buildCorpus() produces, minus score
// (a saved title has no recommendation rank). Hits TMDB details (cached) + the
// IMDb/Metacritic scrape; no MotN quota is spent.
export async function enrichWatchlistItem({ tmdb_id, media_type = 'movie', region, providerIds, language }) {
  const full = await details(tmdb_id, media_type, language);
  // Resolve the per-title tone feeders for this saved title (TTL-skipped) so its
  // tones match a Discover pick's, then read them back (live ∪ stored) in cardFromDetail.
  await resolveTones({ tmdb_id, imdb_id: full.external_ids?.imdb_id || null, title: full.title,
    year: Number((full.release_date || '').slice(0, 4)) || null, overview: full.overview }, media_type);
  const item = cardFromDetail(full, { region, providerIds, language });
  await attachRatings([item]); // adds imdbRating + metascore (or leaves them null)
  return item;
}

// ---- by-name title search --------------------------------------------------
// How many multi-search hits we shape into cards — the top TMDB-popularity matches
// for the name, which is what a title lookup wants.
const SEARCH_RESULT_CAP = 12;
// Background provider-warm fan-out for the misses a search left off-service — a tiny
// TMDB-only call each, run OFF the response path, so the next search of the same term
// shows their icons. Kept modest so it can't pile CPU onto the shared-core box.
const SEARCH_WARM_CONCURRENCY = 6;

// id→name genre maps for both media types in the user's language, built from the
// hard-cached genres() lists (genres change ~never, so this is a couple of warm
// reads). Movie and TV have distinct id spaces, so each hit is mapped with the map
// for its own media type. Lets a search card show genre names without the full
// detail fetch — the multi-search list only carries `genre_ids`.
async function searchGenreMaps(language) {
  const [mv, tv] = await Promise.all([genres('movie', language), genres('tv', language)]);
  const toMap = (list) => new Map((list.genres || []).map((g) => [g.id, g.name]));
  return { movie: toMap(mv), tv: toMap(tv) };
}

// Shape one multi-search hit into a card from the LIST result alone (poster/title/
// year/overview/rating/genre_ids) plus whatever streaming providers we already have
// cached — never a network fetch. `wp` is the cached /watch/providers response, or
// null when we haven't looked this title up yet (→ no services, treated as
// off-service and queued for a background warm so the next search shows its icons).
// runtime/cast/trailers and the IMDb/MC badges fill in lazily elsewhere (detail sheet
// + /api/enrich), same as Discover.
function cardFromSearchHit(hit, wp, genreMap, region, providerSet) {
  const ids = hit.genre_ids || [];
  return {
    tmdb_id: hit.id,
    media_type: hit.media_type,
    title: hit.title ?? hit.name,
    year: Number((hit.release_date || hit.first_air_date || '').slice(0, 4)) || null,
    poster_path: hit.poster_path || null,
    overview: hit.overview || null,
    vote_average: hit.vote_average ?? null,
    genreIds: ids,
    genres: ids.map((id) => genreMap.get(id)).filter(Boolean),
    tones: [], // filled by the client's /api/enrich pass, like Discover
    services: userServices({ 'watch/providers': wp }, region, providerSet),
  };
}

// Resolve one hit into a card using ONLY the caches — no network on the hot path.
// Best case: the title's full detail is already cached (it was in the user's
// recommendations or watchlist, so the build fetched it) → a fully rich card, services
// and all. Next best: its /watch/providers is cached → a list card with services.
// Otherwise a list card with no services, and its id is returned via `misses` so the
// caller can warm the provider lookup in the background. Every read is cacheOnly, so
// this stays synchronous-fast even on a contended box.
async function searchCardCacheOnly(hit, genreMaps, region, providerSet, language, misses) {
  const full = await details(hit.id, hit.media_type, language, { cacheOnly: true }).catch(() => null);
  if (full) return cardFromDetail(full, { region, providerIds: [...providerSet], language });
  const wp = await watchProviders(hit.id, hit.media_type, { cacheOnly: true }).catch(() => null);
  if (!wp) misses.push({ id: hit.id, media_type: hit.media_type });
  return cardFromSearchHit(hit, wp, genreMaps[hit.media_type], region, providerSet);
}

// Warm the /watch/providers cache for the titles a search couldn't resolve on-service,
// off the response path — best-effort, bounded, failures ignored — so a repeat search
// of the same term paints their streaming icons. Overridable in tests (which run with
// no real network) via setSearchWarmer.
let warmSearchProviders = (misses) =>
  mapPool(misses, SEARCH_WARM_CONCURRENCY, (m) => watchProviders(m.id, m.media_type).catch(() => {}));
export function setSearchWarmer(fn) { warmSearchProviders = fn; }

// Find films and series by name and return them as ready-to-render cards, the user's
// chosen streaming services already resolved onto each. TMDB-only — spends NO MotN
// quota. Built to be sub-second even on the shared-CPU box: the hot path makes ZERO
// blocking per-title network calls — the only unavoidable fetch is the single
// /search/multi (cached per term), and every card is then shaped from caches. Titles
// the user has already seen in recommendations/watchlist come back as full rich cards
// instantly (their detail is warm); never-seen titles paint immediately from the list
// fields and have their providers warmed in the background for next time. Cards on one
// of the user's services sort first; the rest follow in TMDB popularity order so a
// search never comes up empty (rendered without streaming icons — empty `services`).
export async function searchTitles({ query, region, providerIds, language }) {
  if (!query?.trim()) return [];
  const res = await searchMulti(query.trim(), language);
  const hits = (res.results || [])
    .filter((r) => r.media_type === 'movie' || r.media_type === 'tv')
    .slice(0, SEARCH_RESULT_CAP);
  if (!hits.length) return [];
  const providerSet = new Set((providerIds || []).map(Number));
  const genreMaps = await searchGenreMaps(language);
  const misses = [];
  // All cache-only reads, so this whole map resolves without hitting the network.
  const cards = await Promise.all(hits.map((hit) =>
    searchCardCacheOnly(hit, genreMaps, region, providerSet, language, misses)));
  if (misses.length) warmSearchProviders(misses); // fire-and-forget; not awaited
  // Stable partition: on-service titles first, off-service after, each keeping
  // TMDB's popularity order.
  return cards.filter(Boolean).sort((a, b) => (b.services.length > 0) - (a.services.length > 0));
}

// How many of the visible cards we resolve ratings/tones for at once — the same
// small fan-out attachRatings uses, so the scraper feeders stay well under the
// IMDb/Metacritic/Letterboxd limits.
const ENRICH_CONCURRENCY = 6;

// On-demand enrichment for the cards the client is about to show: IMDb/Metacritic
// ratings + freshly-scraped tone tags, resolved OFF the build's critical path so
// "Building your picks" never waits on those slow web lookups. The client calls
// /api/enrich with the visible titles (as `media_type:tmdb_id` tokens, since a
// film and a series can share an id) and patches each card's rating badges (and
// tones) as it resolves. Each title's details are already TMDB-cached (the pool
// was just built from them) and the rating/tone lookups are TTL-cached, so repeat
// calls as the user advances through picks are cheap.
//
// Each title is emitted to `onItem(key, payload)` THE MOMENT it resolves — the
// pool fans out at ENRICH_CONCURRENCY, so a slow IMDb/Metacritic lookup on one
// title never holds up the badges of the titles already done. The endpoint
// streams those emissions to the client as they land. `key` is `media_type:id`;
// `payload` is { imdbRating, metascore, imdb_id, tones }. A title that fails to
// resolve is simply never emitted, leaving its card to render without badges.
export async function enrichPicks(items, { language, onItem } = {}) {
  await mapPool(items, ENRICH_CONCURRENCY, async ({ id, media_type = 'movie' }) => {
    let full;
    try { full = await details(id, media_type, language); } catch { return; }
    const crew = full.credits?.crew || [];
    const item = {
      tmdb_id: id,
      imdb_id: full.external_ids?.imdb_id || null,
      title: full.title,
      year: Number((full.release_date || '').slice(0, 4)) || null,
      overview: full.overview,
      // director + cast let attachRatings corroborate a title·year-resolved IMDb id.
      director: crew.filter((c) => c.job === 'Director').map((c) => c.name).join(', ') || null,
      cast: (full.credits?.cast || []).slice(0, CAST_DEPTH).map((c) => c.name),
    };
    await resolveTones(item, media_type); // persist any newly-scraped tone slugs (TTL-skipped)
    await attachRatings([item]);          // imdbRating + metascore (null when unmatched); may resolve item.imdb_id
    // imdb_id flows back so the client's badge deep-links to a freshly-resolved title.
    onItem?.(mediaKey(media_type, id), { imdbRating: item.imdbRating ?? null, metascore: item.metascore ?? null, imdb_id: item.imdb_id ?? null, tones: tonesForMovie(full, media_type) });
  });
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
        const item = await enrichWatchlistItem({ tmdb_id: r.tmdb_id, media_type: r.media_type, region, providerIds, language });
        setWatchlistCard(u.id, r.tmdb_id, r.media_type, item);
        enriched++;
      } catch (e) { log.warn(`watchlist backfill failed for user ${u.id}/${r.tmdb_id}:`, e.message); }
    }
  }
  // One line per boot-time pass: how long the enrichment ran and how much it
  // touched, so a slow backfill is visible against first-byte spikes in the log.
  log.info(`[perf] watchlist backfill done ms=${(performance.now() - t0).toFixed(0)} items=${enriched}`);
}
