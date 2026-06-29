// Letterboxd nanogenre feeder (#3). Letterboxd (via Nanocrowd) tags titles with
// mood/tone "nanogenres" built from the language of reviews — e.g. "Deadpan, Dry,
// Sardonic", "Eerie, Bizarre, Madness". This scrapes them (through the residential
// proxy) and returns the raw nanogenre names; the tone source generalises them onto
// canonical slugs via the Letterboxd crosswalk (src/tone-data/map-letterboxd.json).
// Degrades to [] on any miss. A title is reached by its TMDB id
// (letterboxd.com/tmdb/<id>/), so no title/year matching is needed.
import { proxiedText } from './fetch.js';

// The raw nanogenre/theme names Letterboxd lists for a title, by TMDB id. Returns
// [] when the film isn't on Letterboxd, has no nanogenres, or the fetch fails.
// NOTE: filled in by the Letterboxd-feeder build step (scrapes the film's
// /nanogenres/ via the letterboxd.com/tmdb/<id>/ entry point).
export async function letterboxdNanogenres({ tmdbId } = {}) {
  if (!tmdbId) return [];
  void proxiedText; // wired up by the feeder implementation
  return [];
}
