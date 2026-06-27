// Trakt API — collaborative "related" signal to complement TMDB's content features.
//
// The content model in taste.js only sees a film's own attributes (genres,
// keywords, people). Trakt adds the crowd dimension the content model is blind
// to: given films you love, /related surfaces what the wider Trakt community
// actually watches alongside them — a "people who liked X also liked Y" signal.
//
// Read-only endpoints like /related need only a Client ID (Trakt calls it the
// "API key") — no OAuth, no user login. Free: create an app at
// https://trakt.tv/oauth/applications and copy its Client ID.
//
// Cached hard (7 days; related lists drift slowly) with negative results cached
// too, so a seed Trakt doesn't know stays cheap to ask about.
import { cacheGet, cacheSet, getSetting } from './db.js';

const BASE = 'https://api.trakt.tv';
const TTL = 7 * 24 * 60 * 60 * 1000; // 7 days
// Trakt sits behind Cloudflare, which 403s requests with no User-Agent (Node's
// fetch sends none). Same trick ratings.js uses for IMDb/Metacritic.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export const traktConfigured = () => !!getSetting('traktKey', process.env.TRAKT_KEY || '');

function headers() {
  const key = getSetting('traktKey', process.env.TRAKT_KEY || '');
  if (!key) return null;
  // Trakt requires the API version and the Client ID on every request; the UA
  // keeps Cloudflare from 403-ing us.
  return { 'Content-Type': 'application/json', 'trakt-api-version': '2', 'trakt-api-key': key, 'User-Agent': UA };
}

// Low-level cached GET. Returns parsed JSON, or null when unconfigured / not
// found / a network blip (the latter left uncached so it retries next time).
async function traktGet(path, cacheKey) {
  const h = headers();
  if (!h) return null;
  const cached = cacheGet(cacheKey, TTL);
  if (cached !== undefined) return cached; // includes cached nulls (negative results)
  try {
    const res = await fetch(`${BASE}${path}`, { headers: h });
    if (!res.ok) { cacheSet(cacheKey, null); return null; }
    const json = await res.json();
    cacheSet(cacheKey, json);
    return json;
  } catch {
    return null;
  }
}

function parseRelated(data) {
  if (!Array.isArray(data)) return [];
  return data
    .map((m) => ({ tmdb_id: m.ids?.tmdb ?? null, title: m.title, year: m.year ?? null }))
    .filter((m) => m.tmdb_id);
}

// Resolve an IMDb tt-id to its Trakt slug. Trakt's /related accepts an IMDb id
// directly *most* of the time, but the lookup occasionally misses; resolving the
// canonical slug first is the reliable path. Returns the slug, or null. Cached.
async function slugForImdb(imdbId) {
  const data = await traktGet(`/search/imdb/${imdbId}?type=movie`, `trakt:imdb:${imdbId}`);
  return Array.isArray(data) ? (data[0]?.movie?.ids?.slug ?? null) : null;
}

// Films the Trakt community watches alongside a given one. `imdbId` is the
// tt-id straight from TMDB's external_ids. Tries a direct IMDb lookup, then
// falls back to slug resolution if that comes back empty (Trakt sometimes
// misses on raw tt-ids). Returns [{ tmdb_id, title, year }] (TMDB id present
// only), or []. All calls cached.
export async function relatedMovies(imdbId, limit = 20) {
  if (!imdbId) return [];
  let out = parseRelated(
    await traktGet(`/movies/${imdbId}/related?limit=${limit}`, `trakt:related:${imdbId}:${limit}`)
  );
  if (out.length) return out;
  const slug = await slugForImdb(imdbId);
  if (!slug) return [];
  return parseRelated(
    await traktGet(`/movies/${slug}/related?limit=${limit}`, `trakt:related:${slug}:${limit}`)
  );
}
