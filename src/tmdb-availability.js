// TMDB Watch Providers as a streaming-availability source. Free and uncapped
// (JustWatch-sourced data), it sits between the JustWatch scraper and MotN in the
// availability seam (see availability.js): when JustWatch comes up empty, a TMDB
// provider hit asserts the title IS streamable and spares MotN's 500 req/month
// quota — MotN is reached only when TMDB also knows nothing.
//
// TMDB exposes WHICH services carry a title but only one region-level link (its own
// "watch" page), never per-service deep links. So options here carry no `link`:
// /api/where filters link-less options out of `deepLinks` and renders these via the
// `flatrate` field instead (service logos + per-service search links). Their job in
// the seam is purely to short-circuit the paid fallback, not to supply deep links.
import { watchProviders, tmdbConfigured } from './tmdb.js';

export const name = 'tmdb';

// Available whenever TMDB is (the where-to-watch view already requires a TMDB key).
export const configured = () => tmdbConfigured();

// TMDB monetization bucket → the shared type vocabulary the frontend renders.
// Subscription-style access only, matching the other sources (rent/buy dropped).
const TYPES = { flatrate: 'subscription', free: 'free', ads: 'free' };

// Pure: collapse a region's provider buckets to one subscription-style option per
// service. A provider can repeat across buckets (e.g. flatrate + ads); keep the
// first (highest-tier) by provider id. `serviceId` is the TMDB provider id — the
// same namespace the Settings picker and /api/where's provider tagging use — and
// `link` is null, since TMDB has no per-service deep link (see header).
export function regionToOptions(region) {
  if (!region) return [];
  const out = [];
  const seen = new Set();
  for (const [bucket, type] of Object.entries(TYPES)) {
    for (const p of region[bucket] || []) {
      if (p.provider_id == null || seen.has(p.provider_id)) continue;
      seen.add(p.provider_id);
      out.push({ service: p.provider_name, serviceId: p.provider_id, type, link: null });
    }
  }
  return out;
}

// Per-service streaming options for one title in one country. Same shape MotN/JW
// return: [{ service, serviceId, type, link }] — or null on a transient fault so
// the seam falls through to MotN. A confidently-empty region is [].
export async function streamingOptions(tmdbId, mediaType = 'movie', country = 'US', _language) {
  let data;
  try {
    data = await watchProviders(tmdbId, mediaType);
  } catch {
    return null; // transient — let the seam fall back to MotN
  }
  return regionToOptions(data?.results?.[country.toUpperCase()]);
}
