// Match a Discover card's streaming-service icon to the right MotN deep link.
//
// The icon is keyed by a TMDB provider (id + name); MotN returns its own service
// name per option, plus the TMDB provider id we tag server-side in /api/where.
// The catch: TMDB fragments one service into tier/reseller variants ("Paramount
// Plus Premium", "HBO Max Amazon Channel") and lags rebrands, so neither the id
// nor the raw name reliably lines up with MotN's plain "Paramount+" / "Max".
// Collapsing both sides to a brand key first (and only then falling back to the
// server-tagged id) is what lets "Showtime"/"Paramount Plus Premium" find MotN's
// "Paramount+" link instead of dropping to a generic TMDB page.

// Lowercase; drop "+"/"plus" and non-alphanumerics. Mirrors server `norm`.
// "Disney+" / "Disney Plus" -> "disney".
export const norm = (s) => String(s ?? '').toLowerCase().replace(/\+/g, '').replace(/\bplus\b/g, '').replace(/[^a-z0-9]/g, '');

// Tier / reseller qualifiers TMDB tacks onto a service name; stripping them
// collapses every variant of one brand together.
const VARIANT_WORDS = /premium|essential|standard|basic|withads|ads|amazonchannel|appletvchannel|rokuchannel|channel|kids/g;

// Collapse a service name to a single brand token shared by all its TMDB
// variants and MotN's name for it. Known rebrands/mergers fold in by hand:
// "Max" is HBO Max, and Showtime now ships inside Paramount+.
export function brandKey(name) {
  const n = norm(name).replace(VARIANT_WORDS, '');
  if (n === 'max' || n.includes('hbo')) return 'hbo';   // "Max" / "HBO Max" (not Cinemax)
  if (n.includes('showtime') || n.includes('paramount')) return 'paramount';
  return n;
}

// Given MotN's deep links (each `{ service, providerId, link, ... }`) and the
// clicked icon's `{ sid, sname }`, return the URL to open — or null when nothing
// is a confident match, so the caller can show every option instead of a
// misleading generic page. Prefer the exact server-tagged id, then the brand.
export function matchServiceLink(deepLinks, { sid, sname }) {
  const links = deepLinks || [];
  const byId = sid == null ? null : links.find((o) => o.providerId === sid);
  if (byId?.link) return byId.link;
  const brand = brandKey(sname);
  const byBrand = links.find((o) => brandKey(o.service) === brand);
  return byBrand?.link || null;
}
