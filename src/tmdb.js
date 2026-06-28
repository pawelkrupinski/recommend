// TMDB client. Free API key from https://www.themoviedb.org/settings/api
// Supports either a v3 API key (?api_key=) or a v4 read access token (Bearer).
import { cacheGet, cacheSet, getSetting } from './db.js';
import { config } from './env.js';
import { fetchWithTimeout } from './fetch.js';
import { DAY } from './cache.js';

const BASE = 'https://api.themoviedb.org/3';
export const IMG = 'https://image.tmdb.org/t/p';

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

export const search = (query, year, language) =>
  tmdb('/search/movie', { query, ...(year ? { year } : {}), ...(language ? { language } : {}) });

// Resolve a free-text title (+ optional year) to its best-match TMDB movie id, or
// null. Scraped sources that only yield titles (Filmweb) lean on this; TMDB
// indexes localized titles, so a Polish ranking title resolves to the same id as
// its English original. Cached through tmdb().
export async function searchId(title, year, language) {
  if (!title) return null;
  const res = await search(title, year, language);
  return res.results?.[0]?.id ?? null;
}

export const findByImdb = (imdbId) =>
  tmdb(`/find/${imdbId}`, { external_source: 'imdb_id' });

// A person's IMDb id (nm…) for an exact name link in the detail popup. TMDB only
// exposes it per-person (the movie credits carry just the TMDB person id), so
// this is resolved on demand when a popup opens. A person's IMDb id never
// changes, so cache it far longer than the default day.
export async function personImdbId(personId) {
  const ext = await tmdb(`/person/${personId}/external_ids`, {}, { cacheMs: 30 * DAY });
  return ext.imdb_id || null;
}

// Full feature set for the recommender in one call. external_ids carries the
// IMDb tt-id, used to look up IMDb/Metacritic ratings (see ratings.js).
// watch/providers lets the recommender drop titles that aren't streamable on the
// user's services or for free (see taste.js); appended here to avoid a 2nd call.
// videos carries the YouTube trailers shown in the detail popup (see
// pickTrailers); include_video_language widens the videos block beyond the main
// `language` so the trailer can fall back to English when there's no localized
// one (TMDB otherwise returns only videos tagged with `language`).
export const details = (id, mediaType = 'movie', language) =>
  tmdb(`/${mediaType}/${id}`, {
    append_to_response: 'keywords,credits,external_ids,watch/providers,videos',
    include_video_language: videoLanguages(language),
    ...(language ? { language } : {}),
  });

// `include_video_language` value for a detail fetch: the user's language (the
// 2-letter ISO-639-1 code TMDB tags videos with), English, and language-neutral
// (`null`) artwork. English is always present so pickTrailers' fallback has
// something to find; deduped so an English user doesn't send `en,en,null`.
function videoLanguages(language) {
  const lang = langCode(language);
  return [...new Set([lang, 'en', 'null'].filter(Boolean))].join(',');
}

// The ISO-639-1 code TMDB tags videos/overviews with, extracted from a full
// `pl-PL`/`en-US` locale tag. null/undefined → undefined (caller omits it).
const langCode = (language) => language?.slice(0, 2).toLowerCase();

// From a TMDB `videos` block, pick the YouTube trailers to show in the detail
// popup, honouring the user's language. Preference order: trailers in the
// requested language, else English, else any — the language→English fallback is
// one-directional (an English-language user is never *preferred* a Polish
// trailer; only the last-resort "any" tier surfaces a foreign trailer, and only
// when nothing else exists, so every film with a trailer still shows one).
// Returns ALL distinct trailers in the winning language tier (a film can have
// several), real Trailers before Teasers and official before fan uploads, each
// as `{ key, name }`. Empty when the film has no usable YouTube trailer.
export function pickTrailers(videos, language) {
  const all = (videos?.results || []).filter(
    (v) => v?.site === 'YouTube' && (v.type === 'Trailer' || v.type === 'Teaser') && v.key,
  );
  if (!all.length) return [];
  const lang = langCode(language) || 'en';
  const inLang = (code) => all.filter((v) => (v.iso_639_1 || '').toLowerCase() === code);
  // Requested language first; English fallback (skipped when the user IS English
  // — the first tier already is English, so we never reach past it to another
  // language); then any language so coverage wins over an empty trailer slot.
  let tier = inLang(lang);
  if (!tier.length && lang !== 'en') tier = inLang('en');
  if (!tier.length) tier = all;
  // Trailers before Teasers, official before fan uploads; stable within a rank.
  const rank = (v) => (v.type === 'Trailer' ? 0 : 2) + (v.official ? 0 : 1);
  const seen = new Set();
  return tier
    .slice()
    .sort((a, b) => rank(a) - rank(b))
    .filter((v) => (seen.has(v.key) ? false : seen.add(v.key)))
    .map((v) => ({ key: v.key, name: v.name || '' }));
}

export const recommendations = (id, mediaType = 'movie', language) =>
  tmdb(`/${mediaType}/${id}/recommendations`, language ? { language } : {});

// TMDB's content-overlap "similar" list (shared genres/keywords). A second
// seed-expansion angle distinct from /recommendations, which is behaviour-based
// ("people who watched X also watched Y") — together they reach more candidates.
export const similar = (id, mediaType = 'movie', language) =>
  tmdb(`/${mediaType}/${id}/similar`, language ? { language } : {});

// Site-wide "hot this week" chart — fresh, taste-independent candidates that the
// per-seed recommendation lists can't reach (they only orbit films you've rated).
export const trending = (mediaType = 'movie', language) =>
  tmdb(`/trending/${mediaType}/week`, language ? { language } : {});

export const watchProviders = (id, mediaType = 'movie') =>
  tmdb(`/${mediaType}/${id}/watch/providers`);

// A canonical set of widely-seen, highly-rated films to seed a new user's rate
// queue. TMDB's /movie/popular is recency-biased — it surfaces whatever is
// trending this week — so a newcomer mostly sees films they haven't watched yet
// and can't rate. Discover sorted by vote count instead returns the movies the
// most people have ever rated (the canonical "everyone's seen it" set), spanning
// decades and genres; the rating/count floors keep them acclaimed, not just
// heavily watched.
export const acclaimed = (page = 1, language) =>
  tmdb('/discover/movie', {
    sort_by: 'vote_count.desc',
    'vote_average.gte': 7,
    'vote_count.gte': 1000,
    page,
    ...(language ? { language } : {}),
  });

export const genres = (mediaType = 'movie', language) =>
  tmdb(`/genre/${mediaType}/list`, language ? { language } : {});

// Providers available in a region, e.g. to populate the Settings picker.
export const providersForRegion = (region, mediaType = 'movie') =>
  tmdb(`/watch/providers/${mediaType}`, { watch_region: region });

// Discover titles actually streamable on the user's services in their country.
// `sortBy`/`voteCountGte` are overridable so the same endpoint backs several
// candidate sources: popularity.desc for the mainstream pool, vote_average.desc
// (with a higher vote floor) for the acclaimed-but-less-watched pool.
// `voteCountLte` caps the rating base (the "hidden gems" band where indie films
// live); `withCompanies` is a pipe-joined OR of production-company ids that scopes
// the sweep to art-house distributors (the indie-distributor source).
export function discover({ region, providerIds, genreId, mediaType = 'movie', page = 1, sortBy = 'popularity.desc', voteCountGte = 50, voteCountLte, withCompanies, language }) {
  return tmdb(`/discover/${mediaType}`, {
    watch_region: region,
    with_watch_providers: providerIds.join('|'),
    with_watch_monetization_types: 'flatrate',
    ...(genreId ? { with_genres: String(genreId) } : {}),
    ...(withCompanies ? { with_companies: withCompanies } : {}),
    sort_by: sortBy,
    page,
    'vote_count.gte': voteCountGte,
    ...(voteCountLte ? { 'vote_count.lte': voteCountLte } : {}),
    ...(language ? { language } : {}),
  });
}
