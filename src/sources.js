// Candidate sources — the front of the recommendation pipeline.
//
// A *candidate source* answers one question: "which titles might this user want
// to see?" It does NOT score, filter by streamability, or shape cards — that all
// lives centrally in taste.js (buildCorpus), so every source shares one set of
// rules and a new source can't accidentally re-implement (and diverge on) them.
// A source only knows how to fetch ids.
//
// Contract — each source is a plain object:
//   {
//     name: string,                       // for logging / dedup attribution
//     configured(): boolean,              // is its backend usable right now?
//     fetch(ctx): Promise<Candidate[]>,   // ctx = { region, providerIds,
//                                         //         genreId, ratings, language }
//   }
// where Candidate = { id, title?, year?, collab? }. `id` is the TMDB movie id.
// `collab` (optional) is a crowd-co-watch hit count that the scorer folds in as
// an additive bonus; gatherCandidates sums it across every source and duplicate.
//
// Adding a source is open/closed: write one object, drop it in ALL_SOURCES. No
// switch to edit, no change to buildCorpus.
import { discover, recommendations, similar, trending, details, genres as movieGenres, tmdbConfigured } from './tmdb.js';
import { traktConfigured, relatedMovies, traktChart } from './trakt.js';
import { letterboxdCandidates } from './letterboxd.js';
import { filmwebCandidates } from './filmweb.js';
import { log } from './log.js';

// How many of a user's rated films seed the per-title expansion sources
// (recommendations, similar, trakt-related). Highest-rated first.
const SEED_COUNT = 10;
const seeds = (ratings) =>
  (ratings || [])
    .filter((r) => r.media_type === 'movie')
    .sort((a, b) => b.rating - a.rating)
    .slice(0, SEED_COUNT);

// Walk Discover pages via `fetchPage(page)` until `want` candidates the user
// hasn't already handled have been surfaced — or the source runs out
// (page >= total_pages) or we hit `ceil`. Pure over its page-fetcher, so the
// stop logic is unit-testable without TMDB. Returns bare { id, title };
// buildCorpus re-fetches full details for scoring, so sources need only the id.
//
// Why "until enough fresh" instead of a fixed page count: fixed depth starved
// power users. Once they'd rated/dismissed/shelved the popular head, the first
// few pages were all already-handled and the pool came up empty. Counting *fresh*
// titles lets a light user stop after one page while a heavy user pages deeper
// into the freshly-streamable long tail. `consumed` = ids already handled.
const DISCOVER_PAGE_CEIL = 40;     // TMDB caps /discover at 500 pages; stay modest.
export async function pageUntilFresh({ fetchPage, want, consumed, ceil = DISCOVER_PAGE_CEIL }) {
  const out = [];
  let fresh = 0;
  for (let page = 1; page <= ceil; page++) {
    const res = await fetchPage(page);
    for (const m of res.results || []) {
      out.push({ id: m.id, title: m.title });
      if (!consumed?.has(m.id)) fresh++;
    }
    if (fresh >= want || page >= (res.total_pages || 1)) break;
  }
  return out;
}
const discoverFresh = ({ region, providerIds, genreId, language, sortBy, voteCountGte, voteCountLte, withCompanies, want, consumed }) =>
  pageUntilFresh({
    want, consumed,
    fetchPage: (page) => discover({ region, providerIds, genreId, mediaType: 'movie', page, sortBy, voteCountGte, voteCountLte, withCompanies, language }),
  });

// How many not-yet-handled candidates each provider-scoped sweep aims to surface
// — enough that the merged pool still fills POOL_SIZE after the streamability gate
// and de-duplication. Popularity carries the bulk; the acclaimed sweep tops up.
// Sized well over POOL_SIZE so a heavy user who has rated/dismissed the popular
// head still gets a deep "all genres" pool instead of running dry after ~50 picks.
const DISCOVER_FRESH_TARGET = 160;
const DISCOVER_TOP_RATED_TARGET = 80;

// Expand each seed film through a TMDB list endpoint (recommendations | similar),
// collecting every result. A dud seed is skipped, not fatal.
async function expandSeeds(ratings, language, listFn) {
  const out = [];
  for (const r of seeds(ratings)) {
    try {
      const res = await listFn(r.tmdb_id, 'movie', language);
      for (const m of res.results || []) out.push({ id: m.id, title: m.title });
    } catch { /* skip this seed */ }
  }
  return out;
}

// ---- TMDB sources ---------------------------------------------------------

// Mainstream: what's popular and streamable on the user's services, by genre.
// Pages as deep as needed to surface DISCOVER_FRESH_TARGET titles the user hasn't
// already rated, dismissed or shelved — so the picks don't run dry as they watch
// through the head (this replaces the old fixed-depth "deep" backfill source).
export const tmdbDiscover = {
  name: 'tmdb-discover',
  configured: tmdbConfigured,
  fetch: (ctx) => ctx.providerIds?.length
    ? discoverFresh({ ...ctx, sortBy: 'popularity.desc', voteCountGte: 50, want: DISCOVER_FRESH_TARGET })
    : Promise.resolve([]),
};

// Acclaimed-but-less-watched: same streamable catalog, ranked by rating instead
// of popularity (with a higher vote floor so it stays trustworthy). Surfaces the
// well-reviewed long tail the popularity sort buries.
export const tmdbDiscoverTopRated = {
  name: 'tmdb-discover-top-rated',
  configured: tmdbConfigured,
  fetch: (ctx) => ctx.providerIds?.length
    ? discoverFresh({ ...ctx, sortBy: 'vote_average.desc', voteCountGte: 300, want: DISCOVER_TOP_RATED_TARGET })
    : Promise.resolve([]),
};

// Per-genre depth for the "all genres" pool. The un-genre'd popularity sweep only
// reaches the globally-most-popular head; once a heavy user has handled it the
// pool runs dry. Each genre's OWN popularity ranking surfaces streamable titles
// the global one buries, so fanning the sweep across every genre lets the default
// view run as deep as the per-genre pools collectively do. Only active for the
// all-genres pool (a selected genre's own sweep already covers it) and when there
// are providers to scope by. Fresh titles only — `consumed` pages past handled ids.
const PER_GENRE_TARGET = 15;   // ~15 fresh × every genre ≫ POOL_SIZE after de-dup.
const movieGenreIds = async (language) =>
  ((await movieGenres('movie', language)).genres || []).map((g) => g.id);
export const tmdbDiscoverByGenre = {
  name: 'tmdb-discover-by-genre',
  configured: tmdbConfigured,
  async fetch(ctx) {
    if (ctx.genreId || !ctx.providerIds?.length) return [];
    const out = [];
    for (const genreId of await movieGenreIds(ctx.language)) {
      out.push(...await discoverFresh({ ...ctx, genreId, sortBy: 'popularity.desc', voteCountGte: 50, want: PER_GENRE_TARGET }));
    }
    return out;
  },
};

// ---- Indie / art-house sources -------------------------------------------
// Popularity and vote-floor sorts structurally bury small releases, so the broad
// pool skews mainstream. These three reach the indie catalogue from three angles
// — by distributor, by curated service, and by the acclaimed-but-obscure tail —
// all still streamability-gated to the user's services.

// Curated art-house distributors on TMDB (production-company ids, pipe = OR).
// Distributor IS the curation: the most precise indie signal we have. Verified
// live to return ~100+ streamable titles per major region (A24/NEON/IFC/Focus/
// Searchlight/Magnolia/MUBI/Janus). Indie films carry few votes, so the floor is
// low — the distributor, not vote count, is the quality gate here.
const ARTHOUSE_COMPANIES = [
  41077,   // A24
  90733,   // NEON
  307,     // IFC Films
  10146,   // Focus Features
  127929,  // Searchlight Pictures
  43,      //   (+ legacy Fox Searchlight back catalogue)
  1030,    // Magnolia Pictures
  288516,  // MUBI (distribution arm)
  198828,  // Janus Films / Criterion theatrical
].join('|');
const INDIE_FRESH_TARGET = 60;
export const tmdbIndieDistributors = {
  name: 'tmdb-indie-distributors',
  configured: tmdbConfigured,
  fetch: (ctx) => ctx.providerIds?.length
    ? discoverFresh({ ...ctx, withCompanies: ARTHOUSE_COMPANIES, sortBy: 'vote_average.desc', voteCountGte: 20, want: INDIE_FRESH_TARGET })
    : Promise.resolve([]),
};

// Curated art-house streaming services (TMDB provider ids). When the user
// subscribes to one, its WHOLE catalogue is indie-worthy — but a merged
// popularity sweep across all their services drowns it under the mass-market
// ones. So sweep each curated service the user actually has on its own.
const CURATED_INDIE_PROVIDERS = [
  11,   // MUBI
  258,  // Criterion Channel
  201,  // MUBI Amazon Channel
];
// Pure: which of the user's providers are curated art-house services. Exported
// for unit testing the gate.
export const curatedIndieProviderIds = (providerIds) =>
  (providerIds || []).filter((id) => CURATED_INDIE_PROVIDERS.includes(Number(id)));
const CURATED_FRESH_TARGET = 40;
export const tmdbCuratedProviders = {
  name: 'tmdb-curated-providers',
  configured: tmdbConfigured,
  fetch(ctx) {
    const indie = curatedIndieProviderIds(ctx.providerIds);
    return indie.length
      ? discoverFresh({ ...ctx, providerIds: indie, sortBy: 'popularity.desc', voteCountGte: 20, want: CURATED_FRESH_TARGET })
      : Promise.resolve([]);
  },
};

// Acclaimed long tail too obscure for the top-rated sweep: highly rated but on a
// SMALL rating base (100–400 votes), the band where festival/indie films sit. The
// main top-rated source floors at 300 votes and so structurally misses them.
const HIDDEN_GEMS_TARGET = 60;
export const tmdbHiddenGems = {
  name: 'tmdb-hidden-gems',
  configured: tmdbConfigured,
  fetch: (ctx) => ctx.providerIds?.length
    ? discoverFresh({ ...ctx, sortBy: 'vote_average.desc', voteCountGte: 100, voteCountLte: 400, want: HIDDEN_GEMS_TARGET })
    : Promise.resolve([]),
};

// Behaviour-based "more like the films you rated highly".
export const tmdbRecommendations = {
  name: 'tmdb-recommendations',
  configured: tmdbConfigured,
  fetch: ({ ratings, language }) => expandSeeds(ratings, language, recommendations),
};

// Content-overlap "similar to the films you rated highly" — a different angle on
// the same seeds than recommendations.
export const tmdbSimilar = {
  name: 'tmdb-similar',
  configured: tmdbConfigured,
  fetch: ({ ratings, language }) => expandSeeds(ratings, language, similar),
};

// Site-wide hot-this-week, independent of the user's taste.
export const tmdbTrending = {
  name: 'tmdb-trending',
  configured: tmdbConfigured,
  async fetch({ language }) {
    const res = await trending('movie', language);
    return (res.results || []).map((m) => ({ id: m.id, title: m.title }));
  },
};

// ---- Trakt sources --------------------------------------------------------

// Crowd co-watch: films the Trakt community watches alongside each seed. Each hit
// carries collab:1 so a title related to several of your loved films scores up.
export const traktRelated = {
  name: 'trakt-related',
  configured: traktConfigured,
  async fetch({ ratings, language }) {
    const out = [];
    for (const r of seeds(ratings)) {
      let imdbId;
      try { imdbId = (await details(r.tmdb_id, 'movie', language)).external_ids?.imdb_id; } catch { continue; }
      for (const m of await relatedMovies(imdbId)) {
        out.push({ id: m.tmdb_id, title: m.title, year: m.year, collab: 1 });
      }
    }
    return out;
  },
};

// Trakt's community charts — taste-independent fresh candidates.
const traktChartSource = (kind) => ({
  name: `trakt-${kind}`,
  configured: traktConfigured,
  async fetch() {
    return (await traktChart(kind)).map((m) => ({ id: m.tmdb_id, title: m.title, year: m.year }));
  },
});
export const traktTrending = traktChartSource('trending');
export const traktPopular = traktChartSource('popular');
export const traktAnticipated = traktChartSource('anticipated');

// ---- Scraped sources ------------------------------------------------------
// These hit live third-party sites (through the residential proxy) and parse
// HTML/RSS, so they must stay OFF under the deterministic test stub — only the
// pure parsers are unit-tested, against recorded fixtures. In real deployments
// they run; a blocked/changed site degrades to [] without touching the build.
const scrapersEnabled = () => process.env.TMDB_STUB !== '1';

// Letterboxd: recent watches from curated public accounts (direct TMDB ids).
export const letterboxd = {
  name: 'letterboxd',
  configured: scrapersEnabled,
  fetch: () => letterboxdCandidates(),
};

// Filmweb: the Polish Top-500 ranking, titles resolved to TMDB ids.
export const filmweb = {
  name: 'filmweb',
  configured: scrapersEnabled,
  fetch: ({ language }) => filmwebCandidates(language),
};

// Registry, ordered most-relevant-first. gatherCandidates preserves this order,
// and buildCorpus caps the merged set (CANDIDATE_CAP) before the expensive
// per-title detail fetch — so the highest-value sources fill the budget first and
// the broad charts top it up. The provider-scoped Discover sweeps lead: they're
// the candidates that survive the streamability gate, so spending the detail-fetch
// budget on them first (ahead of the taste/chart sources, most of whose titles the
// gate drops) is what lets the deep genre fan-out actually reach the served pool.
export const ALL_SOURCES = [
  tmdbDiscover,
  tmdbDiscoverTopRated,
  tmdbDiscoverByGenre,
  tmdbIndieDistributors,
  tmdbCuratedProviders,
  tmdbHiddenGems,
  tmdbRecommendations,
  tmdbSimilar,
  traktRelated,
  letterboxd,
  filmweb,
  tmdbTrending,
  traktTrending,
  traktPopular,
  traktAnticipated,
];

// Run every configured source concurrently and merge their candidates into a
// single de-duplicated Map (insertion order = source priority). Sources are
// independent: one that throws or times out is logged and skipped, never taking
// the others (or the build) down with it — the whole point of having many.
// Returns { candidates: Map<id, {id,title,year}>, collab: Map<id, hits> }.
export async function gatherCandidates(ctx, sources = ALL_SOURCES) {
  const active = sources.filter((s) => s.configured());
  const settled = await Promise.allSettled(active.map((s) => s.fetch(ctx)));

  const candidates = new Map();
  const collab = new Map();
  settled.forEach((res, i) => {
    if (res.status !== 'fulfilled') {
      log.warn(`candidate source ${active[i].name} failed: ${res.reason?.message}`);
      return;
    }
    for (const m of res.value || []) {
      if (m?.id == null) continue;
      if (!candidates.has(m.id)) candidates.set(m.id, { id: m.id, title: m.title, year: m.year });
      if (m.collab) collab.set(m.id, (collab.get(m.id) || 0) + m.collab);
    }
  });
  return { candidates, collab };
}
