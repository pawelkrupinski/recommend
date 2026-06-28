// Candidate sources — the front of the recommendation pipeline.
//
// A *candidate source* answers one question: "which titles might this user want
// to see?" It does NOT score, filter by streamability, or shape cards — that all
// lives centrally in taste.js (computePool), so every source shares one set of
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
// `collab` (optional) is a crowd-co-watch hit count that scoreMovie() folds in as
// a bonus; gatherCandidates sums it across every source and duplicate.
//
// Adding a source is open/closed: write one object, drop it in ALL_SOURCES. No
// switch to edit, no change to computePool.
import { discover, recommendations, similar, trending, details, tmdbConfigured } from './tmdb.js';
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

// One genre-aware Discover sweep, walking pages until TMDB runs out or we've
// taken `pages` of them. Returns bare { id, title } — computePool re-fetches full
// details for scoring regardless, so sources need only surface the id.
async function discoverPages({ region, providerIds, genreId, language, sortBy, voteCountGte, startPage, pages }) {
  const out = [];
  for (let page = startPage; page < startPage + pages; page++) {
    const res = await discover({ region, providerIds, genreId, mediaType: 'movie', page, sortBy, voteCountGte, language });
    for (const m of res.results || []) out.push({ id: m.id, title: m.title });
    if (page >= (res.total_pages || 1)) break;
  }
  return out;
}
const DISCOVER_PAGES = 3;

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
export const tmdbDiscover = {
  name: 'tmdb-discover',
  configured: tmdbConfigured,
  fetch: (ctx) => ctx.providerIds?.length
    ? discoverPages({ ...ctx, sortBy: 'popularity.desc', voteCountGte: 50, startPage: 1, pages: DISCOVER_PAGES })
    : Promise.resolve([]),
};

// Deeper into the same popularity-ranked catalog — the titles below the head
// that the original 3-page cap never reached (the main "few recs after a while"
// fix: this is where backfill comes from as the user's seen-set grows).
export const tmdbDiscoverDeep = {
  name: 'tmdb-discover-deep',
  configured: tmdbConfigured,
  fetch: (ctx) => ctx.providerIds?.length
    ? discoverPages({ ...ctx, sortBy: 'popularity.desc', voteCountGte: 50, startPage: DISCOVER_PAGES + 1, pages: DISCOVER_PAGES })
    : Promise.resolve([]),
};

// Acclaimed-but-less-watched: same streamable catalog, ranked by rating instead
// of popularity (with a higher vote floor so it stays trustworthy). Surfaces the
// well-reviewed long tail the popularity sort buries.
export const tmdbDiscoverTopRated = {
  name: 'tmdb-discover-top-rated',
  configured: tmdbConfigured,
  fetch: (ctx) => ctx.providerIds?.length
    ? discoverPages({ ...ctx, sortBy: 'vote_average.desc', voteCountGte: 300, startPage: 1, pages: DISCOVER_PAGES })
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
// and computePool caps the merged set (CANDIDATE_CAP) before the expensive
// per-title detail fetch — so the highest-value sources fill the budget first and
// the broad charts top it up.
export const ALL_SOURCES = [
  tmdbDiscover,
  tmdbRecommendations,
  tmdbSimilar,
  tmdbDiscoverTopRated,
  traktRelated,
  letterboxd,
  filmweb,
  tmdbTrending,
  traktTrending,
  traktPopular,
  traktAnticipated,
  tmdbDiscoverDeep,
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
