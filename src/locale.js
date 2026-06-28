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

// The country Cloudflare resolved for this request, or null. CF sets
// `CF-IPCountry` to a 2-letter ISO code, or a non-geographic placeholder
// (`XX` unknown, `T1` Tor) we treat as "no signal".
export function detectCountry(req) {
  const raw = (req.headers['cf-ipcountry'] || '').toUpperCase();
  return /^[A-Z]{2}$/.test(raw) && raw !== 'XX' && raw !== 'T1' ? raw : null;
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
