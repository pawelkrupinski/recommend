// Language + country resolution. Single source of truth for which interface
// languages we ship, how a country maps to a default language, and how an
// incoming request's geo/Accept-Language hints become a sensible default for a
// brand-new visitor. Detection only ever seeds defaults — once a user saves a
// language/country it wins (see server.js).

// The interface languages we ship. `name` is the native label shown in the
// switcher. Adding a language is a data-only change here + a catalog entry in
// public/i18n.js (the unit suite asserts the two lists stay in sync).
export const SUPPORTED_LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'pl', name: 'Polski' },
];
export const DEFAULT_LANGUAGE = 'en';

// Default UI language for a detected country. Anything not listed falls back to
// DEFAULT_LANGUAGE, so most countries get English until we localize for them.
export const COUNTRY_TO_LANGUAGE = { PL: 'pl' };

// App language code → TMDB `language` parameter (ISO-639-1 + region). TMDB uses
// these to return localized titles and overviews.
const TMDB_LANG = { en: 'en-US', pl: 'pl-PL' };

export const isSupportedLanguage = (code) =>
  SUPPORTED_LANGUAGES.some((l) => l.code === code);

export const tmdbLang = (code) => TMDB_LANG[code] || TMDB_LANG[DEFAULT_LANGUAGE];

// A 2-letter ISO country code, or null for anything non-geographic. CF sets
// `CF-IPCountry` to a code or a placeholder (`XX` unknown, `T1` Tor); the app's
// device-locale header carries a code the same way.
const asCountry = (raw) => {
  const c = (raw || '').toUpperCase();
  return /^[A-Z]{2}$/.test(c) && c !== 'XX' && c !== 'T1' ? c : null;
};

// The country resolved for this request, or null. Prefer Cloudflare's
// `CF-IPCountry` (present on the web edge); fall back to the `X-Device-Country`
// hint the native app sends from its device locale (it talks to the origin
// directly, so there's no CF header). Detection only ever seeds defaults.
export function detectCountry(req) {
  return asCountry(req.headers['cf-ipcountry']) || asCountry(req.headers['x-device-country']);
}

// Best default language for a new visitor: their country's language if we
// localize for it, else the first supported language their browser asks for
// (Accept-Language), else DEFAULT_LANGUAGE.
export function detectLanguage(req, country = detectCountry(req)) {
  const byCountry = country && COUNTRY_TO_LANGUAGE[country];
  if (byCountry && isSupportedLanguage(byCountry)) return byCountry;

  const accept = req.headers['accept-language'] || '';
  for (const part of accept.split(',')) {
    const code = part.trim().split(';')[0].split('-')[0].toLowerCase();
    if (isSupportedLanguage(code)) return code;
  }
  return DEFAULT_LANGUAGE;
}
