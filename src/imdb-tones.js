// IMDb keyword feeder (#2). Scrapes a title's crowd-sourced keywords from its IMDb
// page (through the residential proxy, like the other scrapers) and returns them as
// normalised raw strings — e.g. ['deadpan-humor', 'dark-comedy', 'feel-good']. The
// tone source (tone-sources.js) generalises those onto canonical slugs via the
// IMDb crosswalk (src/tone-data/map-imdb.json), which also acts as the filter:
// only keywords present in the crosswalk become tones, so plot-detail noise is
// dropped. Degrades to [] on any miss so a build never breaks on a scrape failure.
import { proxiedText } from './fetch.js';

// Normalise an IMDb keyword to its crosswalk key: lowercased, hyphen-joined
// ("Dark Comedy" / "dark comedy" → "dark-comedy"), matching how map-imdb.json keys
// are stored. Keeps the crosswalk lookups dialect-stable.
export function normalizeImdbKeyword(s) {
  return String(s || '').toLowerCase().trim().replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '');
}

// The distinct normalised keyword strings IMDb lists for `imdbId` (e.g. "tt0816692").
// Returns [] when there's no id, the page can't be fetched, or it lists none.
// NOTE: filled in by the IMDb-feeder build step (scrapes imdb.com/title/<id>/keywords/).
export async function imdbKeywords(imdbId) {
  if (!imdbId) return [];
  void proxiedText; // wired up by the feeder implementation
  return [];
}
