// Movie of the Night — "Streaming Availability API".
// Supports BOTH the direct API (keys look like "motn-…", host api.movieofthenight.com)
// and the RapidAPI proxy (host streaming-availability.p.rapidapi.com). The key prefix
// decides which. Used to (a) list a country's services for the picker and (b) enrich
// a single title with deep links on demand.
//
// FREE TIER IS 500 REQUESTS/MONTH — cache hard, call lazily, never in bulk.
import { cacheGet, cacheSet, getSetting } from './db.js';
import { fetchWithTimeout } from './fetch.js';

const TTL = 15 * 24 * 60 * 60 * 1000; // 15 days — deep links & service lists rarely change

export const motnConfigured = () => !!getSetting('rapidApiKey', process.env.RAPIDAPI_KEY || '');

function endpoint(path) {
  const key = getSetting('rapidApiKey', process.env.RAPIDAPI_KEY || '');
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
  const cached = cacheGet(cacheKey, TTL);
  if (cached !== undefined) return cached; // includes cached nulls (negative results)
  try {
    const res = await fetchWithTimeout(ep.url, { headers: ep.headers });
    if (!res.ok) { cacheSet(cacheKey, null); return null; }
    const json = await res.json();
    cacheSet(cacheKey, json);
    return json;
  } catch {
    return null;
  }
}

// The streaming services available in a country, e.g. for the Settings picker.
// Returns [{ id, name }] (MotN ids), or null if unavailable. 1 request, cached 30 days.
export async function countryServices(country) {
  const c = country.toLowerCase();
  const data = await motnGet(`/countries/${c}`, `motn:countries:${c}`);
  if (!data?.services) return null;
  return data.services.map((s) => ({ id: s.id, name: s.name }));
}

// Per-service streaming options (with deep links) for one title in one country.
// Shape: [{ service, serviceId, type, link, quality }] or null.
export async function streamingOptions(tmdbId, mediaType, country) {
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

// MotN only ever returns web URLs, but most are registered as iOS Universal
// Links / Android App Links and open the native app directly (no custom scheme
// needed) — as long as the link is followed in the same tab (see public/app.js).
// A few services register a *different* host than the one MotN hands back;
// rewrite those so the app handoff still fires.
export function appLink(link) {
  if (!link) return link;
  // HBO Max: the app-link host is play.hbomax.com — its AASA registers the
  // HBO Max app (com.wbd.hbomax) for path *. After the 2025 "Max" → "HBO Max"
  // rebrand reversion, *.max.com only 301-redirects here (play.max.com →
  // play.hbomax.com), and a redirect breaks the iOS Universal Link / Android
  // App Link handoff. MotN already returns play.hbomax.com today, but normalise
  // any lingering *.max.com link to it so the app still opens.
  link = link.replace(/^https:\/\/(?:www\.|play\.)?max\.com\//, 'https://play.hbomax.com/');
  // Prime Video: amazon.<tld>/gp/video/detail/{ASIN} is the *shopping* app's
  // domain and won't open the Prime Video app. app.primevideo.com has a
  // wildcard AASA + Android assetlinks for the production app, so /detail/{ASIN}
  // opens it (falling back to web otherwise). The ASIN carries over as-is; keep
  // the region-correct one MotN returned (don't touch the rest of the URL).
  link = link.replace(
    /^https?:\/\/(?:www\.)?amazon\.[a-z.]+\/gp\/video\/detail\/([A-Z0-9]{10})\b.*$/i,
    'https://app.primevideo.com/detail/$1',
  );
  return link;
}
