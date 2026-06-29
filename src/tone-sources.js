// The tone feeder registry + per-title resolution (write side of the provenance
// store). Each feeder turns a title into canonical tone slugs in its own way —
// IMDb keywords and Letterboxd nanogenres via their crosswalks, the local model
// straight from the synopsis — and resolveTones() persists each source's set under
// its own name in movie_tones. Open/closed: a new service is a new entry here plus
// a crosswalk file; nothing downstream changes (tone-store.js unions them all).
import { crosswalks, mapRawTags } from './tones.js';
import { setMovieToneSource, movieToneResolvedAt } from './db.js';
import { proxyConfigured } from './fetch.js';
import { imdbKeywords, normalizeImdbKeyword } from './imdb-tones.js';
import { letterboxdNanogenres } from './letterboxd-tones.js';
import { classify, modelReady } from './tone-model.js';
import { log } from './log.js';

// Re-check a source's tones for a title at most this often. Long, because a film's
// mood vocabulary barely changes — and this TTL is what stops the enrichment pass
// from re-scraping IMDb/Letterboxd for titles it already resolved.
const RESOLVE_TTL_MS = 45 * 24 * 60 * 60 * 1000; // ~45 days

// The per-title feeders. configured() gates a source so a missing proxy or an
// untrained model contributes nothing rather than erroring. The scrapers return
// raw tags that mapRawTags() generalises onto canonical slugs; the model emits
// slugs directly. `ctx` is a card-shaped object (tmdbId, imdbId, title, overview).
export const toneSources = [
  {
    name: 'imdb',
    configured: () => proxyConfigured(),
    resolve: async ({ imdbId }) =>
      mapRawTags(crosswalks.imdb, (await imdbKeywords(imdbId)).map(normalizeImdbKeyword)),
  },
  {
    name: 'letterboxd',
    configured: () => proxyConfigured(),
    resolve: async ({ tmdbId }) => mapRawTags(crosswalks.letterboxd, await letterboxdNanogenres({ tmdbId })),
  },
  {
    name: 'model',
    configured: () => modelReady(),
    resolve: async ({ title, overview }) => classify(`${title || ''}. ${overview || ''}`),
  },
];

// Resolve and persist every configured source's tones for one title, skipping any
// source resolved within the TTL (so repeat builds are cheap). Writes through the
// provenance store; per-source failures are swallowed so one flaky scrape can't
// fail the title or the build. `item` is a Discover/Watchlist card-shaped object;
// `sources` is injectable so tests drive resolution with a deterministic fake.
export async function resolveTones(item, mediaType = 'movie', sources = toneSources) {
  const ctx = { tmdbId: item.tmdb_id, imdbId: item.imdb_id || null, title: item.title, year: item.year, overview: item.overview };
  for (const src of sources) {
    if (!src.configured()) continue;
    if (Date.now() - movieToneResolvedAt(item.tmdb_id, mediaType, src.name) < RESOLVE_TTL_MS) continue;
    try {
      setMovieToneSource(item.tmdb_id, mediaType, src.name, await src.resolve(ctx));
    } catch (e) { log.warn(`tone source ${src.name} failed for ${item.tmdb_id}:`, e.message); }
  }
}
