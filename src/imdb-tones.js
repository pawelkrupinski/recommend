// IMDb keyword feeder (#2). Fetches a title's crowd-sourced keywords via the
// IMDb GraphQL API (through the residential proxy) and returns them as raw
// strings. The HTML /keywords/ page is Cloudflare-blocked even with a residential
// proxy and browser UA, but the GraphQL endpoint is not. The tone source
// (tone-sources.js) normalises each keyword and looks it up in map-imdb.json;
// only crosswalk hits become canonical tones, so plot/setting noise is dropped.
// Degrades to [] on any miss so a build never breaks on a scrape failure.
import { proxiedFetch, BROWSER_UA } from './fetch.js';

const GRAPHQL_URL = 'https://graphql.imdb.com/';
const KEYWORD_LIMIT = 100;

// Normalise an IMDb keyword to its crosswalk key: lowercased, hyphen-joined
// ("Dark Comedy" / "dark comedy" → "dark-comedy"), matching how map-imdb.json keys
// are stored. Keeps the crosswalk lookups dialect-stable.
export function normalizeImdbKeyword(s) {
  return String(s || '').toLowerCase().trim().replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '');
}

// The distinct raw keyword strings IMDb lists for `imdbId` (e.g. "tt0816692").
// Returns [] only when there's no id or the title genuinely lists no keywords.
// THROWS on a transient failure (non-OK status, network error, unexpected shape)
// so the caller records nothing and retries later — returning [] here would be
// stored as the "resolved, none" sentinel and suppress IMDb for the whole TTL.
export async function imdbKeywords(imdbId) {
  if (!imdbId) return [];
  const res = await proxiedFetch(GRAPHQL_URL, {
    method: 'POST',
    headers: { 'User-Agent': BROWSER_UA, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `{ title(id: "${imdbId}") { keywords(first: ${KEYWORD_LIMIT}) { edges { node { keyword { text { text } } } } } } }`,
    }),
  });
  if (!res.ok) throw new Error(`imdb graphql ${res.status}`);
  const edges = (await res.json())?.data?.title?.keywords?.edges;
  if (!Array.isArray(edges)) throw new Error('imdb graphql: unexpected response shape');
  return edges.map((e) => e?.node?.keyword?.text?.text).filter(Boolean);
}
