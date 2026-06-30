// Read-through helpers over the SQLite caches.
//
// Several external clients (TMDB, Trakt, MotN, IMDb, Metacritic) share one cache
// shape: look the key up; on a miss, fetch+parse and store the result — caching
// negative results (a `null`) too, but leaving a transient network fault
// *uncached* so it retries next call. readThrough() is that spine; each client
// differs only in how it fetches+parses inside `produce`.
//
// Two backing stores, same spine: the DURABLE cache (db.js — Litestream-
// replicated, kept tiny: Trakt + quota-precious MotN) and the EPHEMERAL capped
// cache (tmdb-cache.js — not replicated). Regenerable values that we never want
// bloating the replicated DB (IMDb/Metacritic scores, IMDb-id resolutions) use
// readThroughCapped; only a saved title's ratings persist durably, and then on
// its own watchlist row, not here.
import { cacheGet, cacheSet } from './db.js';
import { tmdbCacheGet, tmdbCacheSet } from './tmdb-cache.js';

// Common cache lifetime units. Availability and id-resolution barely move, so
// those clients cache for whole multiples of a day; rating scores refresh on the
// order of hours, so a Discover/Watchlist revisit picks up a newer score.
export const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;

// The read-through spine, parameterised by its backing store's get/set so the
// durable and capped variants can't drift in their negative-cache / transient-
// skip semantics.
async function readThroughVia(get, set, cacheKey, ttl, produce) {
  const cached = get(cacheKey, ttl);
  if (cached !== undefined) return cached; // includes cached nulls (negative results)
  try {
    const value = await produce();
    set(cacheKey, value);
    return value;
  } catch {
    return null; // transient — leave uncached so it retries next time
  }
}

// Return the cached value (including a cached `null` negative result) when still
// fresh; otherwise run `produce`, cache its result, and return it. `produce`
// returning `null` caches the negative; `produce` throwing (a transient fault)
// yields `null` and is NOT cached, so the next call retries.
export function readThrough(cacheKey, ttl, produce) {
  return readThroughVia(cacheGet, cacheSet, cacheKey, ttl, produce);
}

// Same contract as readThrough, but cached in the ephemeral, size-capped store
// (tmdb-cache.js) so regenerable values never touch the durable replicated DB.
export function readThroughCapped(cacheKey, ttl, produce) {
  return readThroughVia(tmdbCacheGet, tmdbCacheSet, cacheKey, ttl, produce);
}
