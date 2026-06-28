// TMDB client. Free API key from https://www.themoviedb.org/settings/api
// Supports either a v3 API key (?api_key=) or a v4 read access token (Bearer).
import { cacheGet, cacheSet, getSetting } from './db.js';
import { config } from './env.js';
import { fetchWithTimeout } from './fetch.js';

const BASE = 'https://api.themoviedb.org/3';
export const IMG = 'https://image.tmdb.org/t/p';
const DAY = 24 * 60 * 60 * 1000;

function auth() {
  // Admin-set DB key wins; otherwise fall back to the environment (TMDB_API_KEY).
  const key = getSetting('tmdbKey', config.tmdbKey);
  if (!key) throw new Error('TMDB key not set — add it on the Settings page.');
  // v4 tokens are JWTs (three dot-separated parts); v3 keys are short hex.
  return key.split('.').length === 3
    ? { headers: { Authorization: `Bearer ${key}` }, query: '' }
    : { headers: {}, query: `api_key=${key}` };
}

async function tmdb(path, params = {}, { cacheMs = DAY } = {}) {
  // Test mode: serve canned fixtures instead of hitting the network, so the
  // suite runs offline and deterministically. Gated behind TMDB_STUB=1.
  if (process.env.TMDB_STUB === '1') {
    const { stub } = await import('./tmdb-stub.js');
    return stub(path, params);
  }
  const { headers, query } = auth();
  const usp = new URLSearchParams(params);
  if (query) usp.set(...query.split('=').map(decodeURIComponent));
  const url = `${BASE}${path}?${usp.toString()}`;

  const cacheKey = `tmdb:${url.replace(/api_key=[^&]+/, '')}`;
  const cached = cacheGet(cacheKey, cacheMs);
  if (cached) return cached;

  // Retry transient failures (network errors, 429 rate-limit, 5xx) with backoff.
  // TMDB allows retries freely; this keeps the recommender resilient to blips.
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetchWithTimeout(url, { headers });
      if (res.status === 429 || res.status >= 500) {
        const wait = Number(res.headers.get('retry-after')) * 1000 || 500 * 2 ** attempt;
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`TMDB ${res.status} on ${path}: ${body.slice(0, 200)}`);
      }
      const json = await res.json();
      cacheSet(cacheKey, json);
      return json;
    } catch (e) {
      lastErr = e;
      // Don't retry hard 4xx errors (bad key, not found) — only network faults.
      if (e.message?.startsWith('TMDB ')) throw e;
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }
  throw lastErr || new Error(`TMDB request failed: ${path}`);
}

export const tmdbConfigured = () =>
  process.env.TMDB_STUB === '1' || !!getSetting('tmdbKey', config.tmdbKey);

export const search = (query, year) =>
  tmdb('/search/movie', { query, ...(year ? { year } : {}) });

export const findByImdb = (imdbId) =>
  tmdb(`/find/${imdbId}`, { external_source: 'imdb_id' });

// Full feature set for the recommender in one call. external_ids carries the
// IMDb tt-id, used to look up IMDb/Metacritic ratings (see ratings.js).
// watch/providers lets the recommender drop titles that aren't streamable on the
// user's services or for free (see taste.js); appended here to avoid a 2nd call.
export const details = (id, mediaType = 'movie') =>
  tmdb(`/${mediaType}/${id}`, { append_to_response: 'keywords,credits,external_ids,watch/providers' });

export const recommendations = (id, mediaType = 'movie') =>
  tmdb(`/${mediaType}/${id}/recommendations`);

export const watchProviders = (id, mediaType = 'movie') =>
  tmdb(`/${mediaType}/${id}/watch/providers`);

// A canonical set of widely-seen, highly-rated films to seed a new user's rate
// queue. TMDB's /movie/popular is recency-biased — it surfaces whatever is
// trending this week — so a newcomer mostly sees films they haven't watched yet
// and can't rate. Discover sorted by vote count instead returns the movies the
// most people have ever rated (the canonical "everyone's seen it" set), spanning
// decades and genres; the rating/count floors keep them acclaimed, not just
// heavily watched.
export const acclaimed = (page = 1) =>
  tmdb('/discover/movie', {
    sort_by: 'vote_count.desc',
    'vote_average.gte': 7,
    'vote_count.gte': 1000,
    page,
  });

export const genres = (mediaType = 'movie') => tmdb(`/genre/${mediaType}/list`);

// Providers available in a region, e.g. to populate the Settings picker.
export const providersForRegion = (region, mediaType = 'movie') =>
  tmdb(`/watch/providers/${mediaType}`, { watch_region: region });

// Discover titles actually streamable on the user's services in their country.
export function discover({ region, providerIds, genreId, mediaType = 'movie', page = 1, sortBy = 'popularity.desc' }) {
  return tmdb(`/discover/${mediaType}`, {
    watch_region: region,
    with_watch_providers: providerIds.join('|'),
    with_watch_monetization_types: 'flatrate',
    ...(genreId ? { with_genres: String(genreId) } : {}),
    sort_by: sortBy,
    page,
    'vote_count.gte': 50,
  });
}
