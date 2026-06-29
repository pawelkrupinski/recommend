// Movie of the Night — "Streaming Availability API".
// Supports BOTH the direct API (keys look like "motn-…", host api.movieofthenight.com)
// and the RapidAPI proxy (host streaming-availability.p.rapidapi.com). The key prefix
// decides which. Used to enrich a single title with deep links on demand.
//
// FREE TIER IS 500 REQUESTS/MONTH — cache hard, call lazily, never in bulk. This is
// why MotN is now the *last-resort* availability source, behind JustWatch (free,
// deep links) and TMDB watch providers (free) — see availability.js; it only runs
// when a RapidAPI/MotN key is set and both free sources came up empty.
import { getSetting } from './db.js';
import { fetchWithTimeout } from './fetch.js';
import { readThrough, DAY } from './cache.js';
import { appLink } from './deeplinks.js';
import { log } from './log.js';

const TTL = 30 * DAY; // deep links rarely change; cache long to spare the quota

export const name = 'motn';

const motnKey = () => getSetting('rapidApiKey', process.env.RAPIDAPI_KEY || '');

// MotN can only answer when a key is configured; without one it has no backend.
export const configured = () => !!motnKey();

function endpoint(path) {
  const key = motnKey();
  if (!key) return null;
  if (key.startsWith('motn-')) {
    return { url: `https://api.movieofthenight.com/v4${path}`, headers: { 'X-Api-Key': key } };
  }
  const HOST = 'streaming-availability.p.rapidapi.com';
  return { url: `https://${HOST}${path}`, headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': HOST } };
}

// Low-level cached GET against whichever MotN API the key belongs to. `fetchImpl`
// is injectable so a recorded MotN response can be replayed in tests without
// spending the monthly quota (no live HTTP). A successful body (incl. a "no
// availability" one) is cached; a 404 caches as a confident negative. But a
// rate-limit/server fault (429/5xx) THROWS so readThrough leaves it uncached — a
// throttled call must retry later, never poison the cache as "not available".
async function motnGet(path, cacheKey, fetchImpl) {
  const ep = endpoint(path);
  if (!ep) return null;
  return readThrough(cacheKey, TTL, async () => {
    log.info(`motn: spending quota on ${path}`);
    const res = await fetchImpl(ep.url, { headers: ep.headers });
    if (res.status === 429 || res.status >= 500) throw new Error(`MotN ${res.status}`);
    return res.ok ? await res.json() : null;
  });
}

// Per-service streaming options (with deep links) for one title in one country.
// Shape: [{ service, serviceId, type, link, quality }] or null. The 4th arg
// (language) is accepted for a uniform availability-source signature but unused —
// MotN keys purely on the TMDB id. `fetchImpl` is injectable for tests (replayed
// fixture instead of live HTTP); production uses the default.
export async function streamingOptions(tmdbId, mediaType, country, _language, fetchImpl = fetchWithTimeout) {
  const c = country.toLowerCase();
  const data = await motnGet(`/shows/${mediaType}/${tmdbId}?country=${c}`, `motn:show:${mediaType}:${tmdbId}:${c}`, fetchImpl);
  if (!data) return null;
  const opts = (data.streamingOptions?.[c] || [])
    // Only show subscription-style access, not buy/rent purchases.
    .filter((o) => o.type !== 'buy' && o.type !== 'rent')
    .map((o) => ({
      service: o.service?.name || o.service?.id,
      serviceId: o.service?.id,
      type: o.type, // subscription | free | addon
      link: appLink(o.link),
      quality: o.quality,
    }));
  return opts;
}
