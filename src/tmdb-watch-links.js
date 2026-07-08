// TMDB watch-page deep links — the per-service links that only live in the HTML.
//
// TMDB's /watch/providers API says WHICH services stream a title but hands back
// only one region-level link (its own "watch" page); the per-service deep links
// live only in that page's markup — the embedded JustWatch widget, keyed to this
// EXACT TMDB id. That makes it a more reliable source of a given logo's link than
// our by-title JustWatch search (justwatch.js), which can miss on a fuzzy title
// match. So when /api/where finds a chosen streaming logo with no deep link — the
// one case where a card icon would otherwise fall back to the region watch page —
// it scrapes that page here and folds the recovered link in.
//
// Each provider anchor is a `click.justwatch.com` redirect whose `r=` query param
// already carries the real per-title deep link unencoded (no redirect-follow
// needed) and whose base64 `cx` payload (a Snowplow envelope) names the provider
// and its monetization type. Cached hard (deep links rarely move) and OFF under
// the deterministic TMDB stub, like the other scraped sources — only the pure
// parser runs in tests, against a recorded fixture.
import { fetchWithTimeout, BROWSER_UA } from './fetch.js';
import { readThrough, DAY } from './cache.js';
import { appLink } from './deeplinks.js';

export const name = 'tmdb-watch';
const TTL = 30 * DAY; // deep links rarely change; cache long to limit scraping

// JustWatch monetization → the subscription-style vocabulary the frontend renders,
// matching the other availability sources (rent/buy/cinema dropped).
const SUBSCRIPTION_TYPES = { flatrate: 'subscription', free: 'free', ads: 'free' };

// Decode a click.justwatch.com anchor's base64 `cx` Snowplow envelope to its
// clickout context — { provider, monetizationType, providerId, … } — or null if it
// doesn't parse, so schema drift skips one anchor rather than the whole page.
function clickoutContext(cx) {
  try {
    const env = JSON.parse(Buffer.from(decodeURIComponent(cx), 'base64').toString('utf8'));
    return (env.data || []).find((d) => String(d.schema).includes('clickout_context'))?.data || null;
  } catch {
    return null;
  }
}

// Pure: from a watch page's HTML, one subscription-style option per streaming
// service — [{ service, serviceId, type, link }], the shape the availability seam
// returns. `link` is the JustWatch redirect's `r=` target (the real per-title deep
// link), host-normalised for the app handoff. Rent/buy/cinema anchors are dropped;
// a service repeated across quality tiers is deduped by its JustWatch provider id.
export function parseWatchLinks(html) {
  const out = [];
  const seen = new Set();
  for (const [, cx, r] of html.matchAll(/click\.justwatch\.com\/a\?cx=([^&"]+)&r=([^&"]+)/g)) {
    const co = clickoutContext(cx);
    if (!co) continue;
    const type = SUBSCRIPTION_TYPES[co.monetizationType];
    if (!type) continue; // drop RENT / BUY / CINEMA
    if (co.providerId == null || seen.has(co.providerId)) continue;
    seen.add(co.providerId);
    out.push({ service: co.provider, serviceId: co.providerId, type, link: appLink(decodeURIComponent(r)) });
  }
  return out;
}

// Off under the deterministic TMDB stub so the suite never scrapes (the stub only
// intercepts the TMDB API, not this www.themoviedb.org page).
export const configured = () => process.env.TMDB_STUB !== '1';

// GET the watch page directly — no residential proxy. Unlike the JustWatch /
// Letterboxd / Filmweb scrapers, TMDB's own site isn't ASN-blocked, so a plain
// datacenter fetch works; proxying it would only spend Decodo's per-IP auth cap on
// a host that doesn't need it AND tie these deep links to the proxy's health (a
// proxy outage would otherwise drop every logo back to the TMDB fallback — the very
// thing this recovers). Returns null on any non-200 or failure → caller degrades.
async function watchPageHtml(url) {
  try {
    const res = await fetchWithTimeout(url, { headers: { 'User-Agent': BROWSER_UA } });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

// Per-service deep links for one title in one country, scraped from the TMDB watch
// page and cached hard. A bare `/movie/{id}/watch?locale=CC` 301-redirects to the
// slug URL with the locale intact. Returns [] on any miss (not configured, non-200,
// empty/parse-nil) so the caller simply gets no extra links.
export async function watchPageLinks(tmdbId, mediaType = 'movie', country = 'US') {
  if (!configured()) return [];
  const cc = country.toUpperCase();
  return readThrough(`tmdb-watch:${mediaType}:${tmdbId}:${cc}`, TTL, async () => {
    const html = await watchPageHtml(`https://www.themoviedb.org/${mediaType}/${tmdbId}/watch?locale=${cc}`);
    return html ? parseWatchLinks(html) : [];
  });
}
