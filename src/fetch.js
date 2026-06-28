// Outbound HTTP with a hard timeout. Node's global `fetch` has NO default
// timeout: a hung upstream (an OAuth provider, IMDb, Metacritic, MotN, Trakt,
// TMDB) leaves the request promise pending indefinitely. Under load those stall
// the handlers waiting on them, connections pile up, and the instance stops
// answering — which Cloudflare/Render surface as intermittent 502/503. Aborting
// after `ms` turns a hung upstream into a normal rejection the callers already
// treat as a transient failure (cache a negative, retry, or degrade gracefully).
const DEFAULT_TIMEOUT_MS = 10_000;

export function fetchWithTimeout(url, options = {}, ms = DEFAULT_TIMEOUT_MS) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(ms) });
}
