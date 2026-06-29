// Letterboxd nanogenre feeder (#3). Letterboxd (via Nanocrowd) tags titles with
// mood/tone themes in the Genres tab: longer descriptive phrases like "Dreamlike,
// quirky, and surreal storytelling" or "Twisted dark psychological thriller". This
// scrapes them (through the residential proxy) and returns the raw theme labels;
// the tone source generalises them onto canonical slugs via the Letterboxd crosswalk
// (src/tone-data/map-letterboxd.json). Degrades to [] on any miss.
//
// Entry point: letterboxd.com/tmdb/<id>/ redirects to the film page. Theme labels
// live in the #tab-panel-genres div, under the <h3>Themes</h3> heading, as <a
// class="text-slug"> links with /films/theme/ or /films/mini-theme/ hrefs.
//
// Normalization: decode core HTML entities (&amp; &#039; &hellip;), trim, collapse
// whitespace. Crosswalk keys in map-letterboxd.json use the same normalization.
import { proxiedText } from './fetch.js';

function decodeEntities(s) {
  return s
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&hellip;/g, '…')
    .replace(/&[a-z]+;/g, '');
}

function normalizeLabel(raw) {
  return decodeEntities(raw).replace(/\s+/g, ' ').trim();
}

// The theme/nanogenre labels Letterboxd lists for a title, by TMDB id. Returns []
// only when the film genuinely lists no themes (so that's recorded as "resolved,
// none"). THROWS when the page can't be fetched (proxiedText null) so a transient
// proxy/Cloudflare blip retries later instead of being cached as the empty sentinel.
export async function letterboxdNanogenres({ tmdbId } = {}) {
  if (!tmdbId) return [];
  const html = await proxiedText(`https://letterboxd.com/tmdb/${tmdbId}/`);
  if (!html) throw new Error('letterboxd fetch failed (transient)');

  // The genres tab panel holds Genres + Themes; a film with no panel has no themes.
  const panelStart = html.indexOf('id="tab-panel-genres"');
  if (panelStart < 0) return [];
  const panelEnd = html.indexOf('id="tab-panel-releases"', panelStart);
  const panel = html.slice(panelStart, panelEnd > 0 ? panelEnd : panelStart + 6000);

  // Only the /films/theme/ and /films/mini-theme/ links (the Nanocrowd themes),
  // not the plain /films/genre/ links in the same panel.
  const re = /href="\/films\/(?:mini-theme|theme)\/[^"]+?"[^>]*class="text-slug"[^>]*>([^<]+)<\/a>/g;
  const labels = [];
  for (let m = re.exec(panel); m; m = re.exec(panel)) {
    const label = normalizeLabel(m[1]);
    if (label) labels.push(label);
  }
  return labels.slice(0, 15);
}
