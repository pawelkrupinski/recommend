// JustWatch — streaming availability with per-title deep links, via its
// undocumented GraphQL endpoint. The PRIMARY availability source (free, uncapped,
// real per-service deep links + prices), ahead of MotN (500 req/month). See
// availability.js for the seam that prefers this and falls back to MotN.
//
// JustWatch has no by-TMDB-id lookup, so we search by the title (from TMDB
// details, cached) and then pick the node whose externalIds match the TMDB/IMDb
// id — never the blind top hit, since a wrong title's offers are worse than none.
//
// This hits a live, unofficial API whose schema drifts and whose ToS forbids
// automated extraction; it's wrapped behind the availability seam and cached hard
// so it's swappable for JustWatch's licensed API and never hammered. Like the
// other scraped sources it stays OFF under the deterministic TMDB stub — only the
// pure mappers below run in tests, against a recorded fixture.
import { details } from './tmdb.js';
import { proxiedFetch, BROWSER_UA } from './fetch.js';
import { readThrough, DAY } from './cache.js';
import { appLink } from './deeplinks.js';

const ENDPOINT = 'https://apis.justwatch.com/graphql';
const TTL = 15 * DAY; // deep links rarely change

export const name = 'justwatch';

// Off under the deterministic TMDB stub so the test suite never hits the network.
export const configured = () => process.env.TMDB_STUB !== '1';

// JustWatch monetization → the MotN-style type vocabulary the frontend renders.
// Subscription-style access only (per product decision); rent/buy/cinema dropped.
const SUBSCRIPTION_TYPES = { FLATRATE: 'subscription', FREE: 'free', ADS: 'free' };

// Pure: collapse a node's raw offers to one subscription-style option per service,
// with the deep link normalised for the app handoff. JustWatch repeats an offer
// per quality tier (SD/HD/4K), so dedup by packageId keeps one row per service.
export function offersToOptions(offers) {
  const out = [];
  const seen = new Set();
  for (const o of offers || []) {
    const type = SUBSCRIPTION_TYPES[o.monetizationType];
    if (!type) continue; // drop RENT / BUY / CINEMA
    const pkg = o.package || {};
    if (pkg.packageId == null || seen.has(pkg.packageId)) continue;
    seen.add(pkg.packageId);
    out.push({ service: pkg.clearName, serviceId: pkg.packageId, type, link: appLink(o.standardWebURL) });
  }
  return out;
}

// Pure: from a GetSearchTitles response, pick the node that actually IS the title
// the caller asked for — matched on TMDB id (authoritative), then IMDb id. Returns
// null rather than guess, so a missed match yields no offers instead of wrong ones.
export function pickNode(data, { tmdbId, imdbId, mediaType = 'movie' }) {
  const wantType = mediaType === 'tv' ? 'SHOW' : 'MOVIE';
  const nodes = (data?.data?.popularTitles?.edges || [])
    .map((e) => e.node)
    .filter((n) => n?.objectType === wantType);
  const byTmdb = nodes.find((n) => Number(n.content?.externalIds?.tmdbId) === Number(tmdbId));
  if (byTmdb) return byTmdb;
  if (imdbId) {
    const byImdb = nodes.find((n) => n.content?.externalIds?.imdbId === imdbId);
    if (byImdb) return byImdb;
  }
  return null;
}

const QUERY =
  'query GetSearchTitles($searchTitlesFilter: TitleFilter!, $country: Country!, $language: Language!, $first: Int!) {' +
  ' popularTitles(country: $country, filter: $searchTitlesFilter, first: $first) { edges { node {' +
  ' id objectType content(country: $country, language: $language) {' +
  ' title originalReleaseYear externalIds { imdbId tmdbId } }' +
  ' offers(country: $country, platform: WEB) { monetizationType presentationType standardWebURL' +
  ' package { clearName packageId technicalName } } } } } }';

async function searchTitles({ query, country, language, first = 6 }) {
  const res = await proxiedFetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': BROWSER_UA },
    body: JSON.stringify({
      operationName: 'GetSearchTitles',
      query: QUERY,
      variables: { searchTitlesFilter: { searchQuery: query }, country, language, first },
    }),
  });
  if (!res.ok) throw new Error(`JustWatch ${res.status}`);
  return res.json();
}

// Per-service streaming options (with deep links) for one title in one country.
// Same shape MotN returns: [{ service, serviceId, type, link }] — or null on a
// transient fault (so the seam can fall back / retry). A confidently-empty result
// (title found, no subscription offers) is [] and gets cached.
export async function streamingOptions(tmdbId, mediaType = 'movie', country = 'US', language = 'en') {
  let detail;
  try {
    detail = await details(tmdbId, mediaType, language);
  } catch {
    return null; // couldn't resolve a title to search by — treat as transient
  }
  const title = detail?.title || detail?.name;
  if (!title) return null;
  const imdbId = detail?.external_ids?.imdb_id || null;
  const jwCountry = country.toUpperCase();
  const jwLanguage = (language || 'en').slice(0, 2).toLowerCase();

  return readThrough(`justwatch:${mediaType}:${tmdbId}:${jwCountry}`, TTL, async () => {
    const data = await searchTitles({ query: title, country: jwCountry, language: jwLanguage });
    const node = pickNode(data, { tmdbId, imdbId, mediaType });
    return node ? offersToOptions(node.offers) : [];
  });
}
