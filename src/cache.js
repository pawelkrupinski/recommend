// Read-through helpers over the SQLite cache table (db.js).
//
// Several external clients (TMDB, Trakt, MotN, IMDb, Metacritic) share one cache
// shape: look the key up; on a miss, fetch+parse and store the result — caching
// negative results (a `null`) too, but leaving a transient network fault
// *uncached* so it retries next call. readThrough() is that spine; each client
// differs only in how it fetches+parses inside `produce`.
import { cacheGet, cacheSet } from './db.js';

// Common cache lifetime unit. External ratings/availability barely move, so the
// clients cache for whole multiples of a day.
export const DAY = 24 * 60 * 60 * 1000;

// Return the cached value (including a cached `null` negative result) when still
// fresh; otherwise run `produce`, cache its result, and return it. `produce`
// returning `null` caches the negative; `produce` throwing (a transient fault)
// yields `null` and is NOT cached, so the next call retries.
export async function readThrough(cacheKey, ttl, produce) {
  const cached = cacheGet(cacheKey, ttl);
  if (cached !== undefined) return cached; // includes cached nulls (negative results)
  try {
    const value = await produce();
    cacheSet(cacheKey, value);
    return value;
  } catch {
    return null; // transient — leave uncached so it retries next time
  }
}
