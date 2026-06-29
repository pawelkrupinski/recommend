// Read/aggregate side of the tone provenance store. A title's tones are the
// union of the always-available live derivation (TMDB keywords + Netflix
// membership, see tones.js) and the slugs the per-title feeders stored in
// movie_tones (IMDb keywords, Letterboxd nanogenres, the local model — see
// tone-sources.js). This is the single read path scoring, the Discover/Watchlist
// cards and the ?tag= filter all go through, so every consumer sees every source.
import { liveToneSlugs, orderTones } from './tones.js';
import { getMovieToneSlugs } from './db.js';

// All tone slugs for a title: live ∪ stored, deduped. `full` is a TMDB /movie
// detail (needs id + keywords). A title with no stored rows just yields its live
// tones, so this stays correct before any feeder has run. `storedFor` is the
// source of the stored slugs, id → slug[] — defaulting to a per-title DB read.
// A build prefetches every candidate's tones in one query (getMovieToneSlugsBatch)
// and injects the map's lookup here, turning the per-title N+1 into one query.
export function toneSlugs(full, mediaType = 'movie', storedFor = getMovieToneSlugs) {
  const slugs = new Set(liveToneSlugs(full));
  if (full?.id != null) for (const s of storedFor(full.id, mediaType)) slugs.add(s);
  return [...slugs];
}

// The title's tones as ordered { slug, label } — what the card/popup render.
export function tonesForMovie(full, mediaType = 'movie', storedFor = getMovieToneSlugs) {
  return orderTones(toneSlugs(full, mediaType, storedFor));
}
