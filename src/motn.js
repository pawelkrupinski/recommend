// Movie of the Night — "Streaming Availability API".
// Supports BOTH the direct API (keys look like "motn-…", host api.movieofthenight.com)
// and the RapidAPI proxy (host streaming-availability.p.rapidapi.com). The key prefix
// decides which. Used to enrich a single title with deep links on demand.
//
// FREE TIER IS 500 REQUESTS/MONTH — cache hard, call lazily, never in bulk. This is
// why MotN is now the *fallback* availability source behind JustWatch (free, deep
// links) — see availability.js; it only runs when a RapidAPI/MotN key is set.
import { getSetting } from './db.js';
import { fetchWithTimeout } from './fetch.js';
import { readThrough, DAY } from './cache.js';
import { appLink } from './deeplinks.js';

const TTL = 15 * DAY; // deep links rarely change

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

// Low-level cached GET against whichever MotN API the key belongs to.
async function motnGet(path, cacheKey) {
  const ep = endpoint(path);
  if (!ep) return null;
  return readThrough(cacheKey, TTL, async () => {
    const res = await fetchWithTimeout(ep.url, { headers: ep.headers });
    return res.ok ? await res.json() : null;
  });
}

// Per-service streaming options (with deep links) for one title in one country.
// Shape: [{ service, serviceId, type, link, quality }] or null. The 4th arg
// (language) is accepted for a uniform availability-source signature but unused —
// MotN keys purely on the TMDB id.
export async function streamingOptions(tmdbId, mediaType, country, _language) {
  const c = country.toLowerCase();
  const data = await motnGet(`/shows/${mediaType}/${tmdbId}?country=${c}`, `motn:show:${mediaType}:${tmdbId}:${c}`);
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
