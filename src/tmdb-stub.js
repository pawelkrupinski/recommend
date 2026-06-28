// Canned TMDB responses for tests. Activated by TMDB_STUB=1 (see tmdb.js), this
// lets the whole app run offline and deterministically: no API key, no network,
// stable data. The shapes mirror the real TMDB v3 endpoints closely enough for
// the recommender (taste.js), the rate queue, the provider picker and the
// where-to-watch view to work end to end.
//
// Provider 8 ("Netflix Test") is the one our fixture titles stream on in PL, so
// a user who picks it in onboarding/settings gets real Discover picks back.

const PROVIDER_ID = 8;
const REGION = 'PL';

// Two pools of titles: "popular" (the acclaimed seed that drives the Rate
// queue, served via provider-less Discover) and "discover" (streamable on the
// test provider; drives Discover recommendations).
const POPULAR = [
  { id: 101, title: 'Stub Popular One' },
  { id: 102, title: 'Stub Popular Two' },
  { id: 103, title: 'Stub Popular Three' },
  { id: 104, title: 'Stub Popular Four' },
  { id: 105, title: 'Stub Popular Five' },
];
// `country` is the title's production country and `companyId` a production
// company id — the inputs to the origin/non-US/indie filters (taste.js). One is
// a US major-studio film, the rest non-US indies, so the filter tests can tell
// them apart. 174 = Warner Bros. (a MAJOR_STUDIO_IDS member); 99999 is unknown
// (treated as indie).
const DISCOVER = [
  { id: 201, title: 'Stub Streamable One', genreId: 28, country: 'US', companyId: 174 },
  { id: 202, title: 'Stub Streamable Two', genreId: 35, country: 'FR', companyId: 99999 },
  { id: 203, title: 'Stub Streamable Three', genreId: 28, country: 'JP', companyId: 99999 },
];
// A title only the /trending source surfaces (no Discover/recommendations path
// reaches it) — lets tests prove a non-Discover candidate source feeds the pool.
// Tagged US + major studio (like 201) so the origin/indie filters drop it too,
// keeping their expectations simple: it's present by default, gone once filtered.
const TRENDING = [
  { id: 301, title: 'Stub Trending One', genreId: 28, country: 'US', companyId: 174 },
];
// A large pool of generated streamable titles that stream ONLY on BACKFILL_PROVIDER
// (not the default test provider 8), so they're invisible to the provider-8 tests
// — which still see exactly the canonical streamable set — yet give a user who
// picks that provider a pool well over the ~36 the UI shows at once. That surplus
// is what the picks grid's background refill surfaces as cards leave.
const BACKFILL_PROVIDER = 9; // Amazon Prime Test (see PROVIDERS)
// Over POOL_SIZE (200) so a provider-9 user's pool is capped by POOL_SIZE, not by
// the stub running short — that's what the pool-depth test asserts against.
const DEEP_DISCOVER = Array.from({ length: 220 }, (_, i) => ({ id: 5001 + i, title: `Stub Deep ${i + 1}` }));

const GENRES = [
  { id: 28, name: 'Action' },
  { id: 35, name: 'Comedy' },
];

const PROVIDERS = [
  { provider_id: PROVIDER_ID, provider_name: 'Netflix Test', logo_path: '/netflix.png', display_priority: 1 },
  { provider_id: 337, provider_name: 'Disney Plus Test', logo_path: '/disney.png', display_priority: 2 },
  { provider_id: 9, provider_name: 'Amazon Prime Test', logo_path: '/prime.png', display_priority: 3 },
];

// Echo the requested TMDB `language` into the overview when present, so tests
// can assert the param was forwarded end to end (the real API would return a
// localized synopsis here). Titles stay untouched — the e2e suite pins them.
const overviewFor = (title, language) =>
  `Overview for ${title}.${language ? ` [${language}]` : ''}`;

const card = (m, language) => ({
  id: m.id,
  title: m.title,
  release_date: '2020-01-01',
  poster_path: `/poster${m.id}.jpg`,
  overview: overviewFor(m.title, language),
  vote_average: 7.5,
  genre_ids: m.genreId ? [m.genreId] : [28],
});

// Full /movie/:id detail with the appended blocks taste.js reads.
function details(id, language) {
  const known = [...POPULAR, ...DISCOVER, ...TRENDING].find((m) => m.id === id);
  const title = known?.title || `Stub Movie ${id}`;
  const genreId = known?.genreId || 28;
  const country = known?.country || 'US';
  const companyId = known?.companyId || 99999;
  // Backfill titles stream on BACKFILL_PROVIDER; everything else on the default 8.
  const provider = id >= DEEP_DISCOVER[0].id
    ? { provider_id: BACKFILL_PROVIDER, provider_name: 'Amazon Prime Test', logo_path: '/prime.png' }
    : { provider_id: PROVIDER_ID, provider_name: 'Netflix Test', logo_path: '/netflix.png' };
  return {
    id,
    title,
    release_date: '2020-01-01',
    runtime: 107,
    poster_path: `/poster${id}.jpg`,
    overview: overviewFor(title, language),
    vote_average: 7.5,
    genres: [{ id: genreId, name: GENRES.find((g) => g.id === genreId)?.name || 'Action' }],
    production_countries: [{ iso_3166_1: country, name: country }],
    production_companies: [{ id: companyId, name: `Company ${companyId}` }],
    keywords: { keywords: [{ id: 9000, name: 'stub-keyword' }] },
    credits: {
      crew: [{ id: 500, job: 'Director', name: 'Stub Director' }],
      cast: [{ id: 600, name: 'Stub Actor' }],
    },
    external_ids: { imdb_id: `tt${1000000 + id}` },
    'watch/providers': { results: { [REGION]: { flatrate: [provider] } } },
  };
}

// Map a TMDB path + params to a fixture. Throws on unknown paths so a typo in a
// test surfaces loudly rather than silently returning undefined.
export function stub(path, params = {}) {
  const page = Number(params.page) || 1;

  if (path === '/genre/movie/list') {
    return { genres: GENRES };
  }
  if (path === '/watch/providers/movie') {
    return { results: PROVIDERS };
  }
  if (path === '/discover/movie') {
    // The onboarding rate queue (acclaimed seed) is provider-less → POPULAR. The
    // recommender filters Discover by streaming provider: serve the canonical
    // titles plus the backfill pool, all on one page. The candidate sources walk
    // pages until they've found enough fresh titles, and computePool's
    // streamability gate keeps only those on the *user's* services — so a
    // provider-8 user sees just the canonical set while a backfill-provider user
    // gets the large pool the refill draws from.
    if (!params.with_watch_providers) {
      return { page, total_pages: 1, results: POPULAR.map((m) => card(m, params.language)) };
    }
    // The big backfill pool only streams on BACKFILL_PROVIDER, so only surface it
    // when that provider is the one being queried — keeping the provider-8 tests'
    // candidate set small (just DISCOVER) while a provider-9 user gets the depth.
    const providers = String(params.with_watch_providers).split('|').map(Number);
    const deep = providers.includes(BACKFILL_PROVIDER) ? DEEP_DISCOVER : [];
    return { page, total_pages: 1, results: [...DISCOVER, ...deep].map((m) => card(m, params.language)) };
  }
  if (path === '/trending/movie/week') {
    return { page, total_pages: 1, results: TRENDING.map((m) => card(m, params.language)) };
  }
  const rec = path.match(/^\/movie\/(\d+)\/recommendations$/);
  if (rec) return { page: 1, total_pages: 1, results: [] };

  // Content-overlap list; empty in the stub (the seed expansion is exercised via
  // recommendations) — present so the source's call resolves instead of throwing.
  const sim = path.match(/^\/movie\/(\d+)\/similar$/);
  if (sim) return { page: 1, total_pages: 1, results: [] };

  const wp = path.match(/^\/movie\/(\d+)\/watch\/providers$/);
  if (wp) {
    return { results: { [REGION]: { link: 'https://example.test/watch',
      flatrate: [{ provider_name: 'Netflix Test', logo_path: '/netflix.png' }] } } };
  }
  const det = path.match(/^\/movie\/(\d+)$/);
  if (det) return details(Number(det[1]), params.language);

  throw new Error(`tmdb-stub: no fixture for ${path}`);
}
