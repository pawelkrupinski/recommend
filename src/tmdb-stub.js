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
const DISCOVER = [
  { id: 201, title: 'Stub Streamable One', genreId: 28 },
  { id: 202, title: 'Stub Streamable Two', genreId: 35 },
  { id: 203, title: 'Stub Streamable Three', genreId: 28 },
];

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
  const known = [...POPULAR, ...DISCOVER].find((m) => m.id === id);
  const title = known?.title || `Stub Movie ${id}`;
  const genreId = known?.genreId || 28;
  return {
    id,
    title,
    release_date: '2020-01-01',
    runtime: 107,
    poster_path: `/poster${id}.jpg`,
    overview: overviewFor(title, language),
    vote_average: 7.5,
    genres: [{ id: genreId, name: GENRES.find((g) => g.id === genreId)?.name || 'Action' }],
    keywords: { keywords: [{ id: 9000, name: 'stub-keyword' }] },
    credits: {
      crew: [{ id: 500, job: 'Director', name: 'Stub Director' }],
      cast: [{ id: 600, name: 'Stub Actor' }],
    },
    external_ids: { imdb_id: `tt${1000000 + id}` },
    'watch/providers': {
      results: { [REGION]: { flatrate: [{ provider_id: PROVIDER_ID, provider_name: 'Netflix Test', logo_path: '/netflix.png' }] } },
    },
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
    // The recommender filters Discover by streaming provider; the onboarding
    // rate queue (acclaimed seed) does not. Serve the matching pool for each.
    const pool = params.with_watch_providers ? DISCOVER : POPULAR;
    return { page, total_pages: 1, results: pool.map((m) => card(m, params.language)) };
  }
  const rec = path.match(/^\/movie\/(\d+)\/recommendations$/);
  if (rec) return { page: 1, total_pages: 1, results: [] };

  const wp = path.match(/^\/movie\/(\d+)\/watch\/providers$/);
  if (wp) {
    return { results: { [REGION]: { link: 'https://example.test/watch',
      flatrate: [{ provider_name: 'Netflix Test', logo_path: '/netflix.png' }] } } };
  }
  const det = path.match(/^\/movie\/(\d+)$/);
  if (det) return details(Number(det[1]), params.language);

  throw new Error(`tmdb-stub: no fixture for ${path}`);
}
