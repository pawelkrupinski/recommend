// Streaming-availability seam. One question — "where can I watch this title?" —
// answered by an ordered list of sources. JustWatch (free, per-title deep links)
// leads; MotN (500 req/month) backs it up, running only when its key is set and
// JustWatch came up empty. Each source module exposes the same
// { name, configured, streamingOptions } contract, so adding or swapping one is
// open/closed — no change here or at the call site (/api/where).
import * as justwatch from './justwatch.js';
import * as motn from './motn.js';
import { log } from './log.js';

// Ordered most-preferred first. Injectable (like gatherCandidates' sources arg)
// so the seam's ordering/fallback can be unit-tested with fakes.
export const SOURCES = [justwatch, motn];

// First configured source to return a non-empty result wins; a source that's off,
// throws, or finds nothing falls through to the next. Mirrors gatherCandidates'
// resilience — one bad source never takes the answer down with it.
export async function streamingOptions(tmdbId, mediaType, country, language, sources = SOURCES) {
  for (const source of sources) {
    if (!source.configured()) continue;
    try {
      const opts = await source.streamingOptions(tmdbId, mediaType, country, language);
      if (opts && opts.length) return opts;
    } catch (e) {
      log.warn(`availability source ${source.name} failed: ${e.message}`);
    }
  }
  return [];
}
