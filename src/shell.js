// Localizes the SPA shell's social-preview metadata (Open Graph / Twitter card,
// <title>, <html lang>) per interface language. The link preview a crawler
// scrapes — Facebook, Slack, iMessage… — is hardcoded English in the static
// public/index.html; this overlays the right language onto it at serve time so a
// Polish visitor (or Facebook re-scraping with ?fb_locale=pl_PL) gets Polish copy
// and the Polish brand. The English template stays a valid standalone page, so
// localizeShell(html, 'en') only adds the og:locale tags and is otherwise a
// no-op — non-JS consumers and the dev e2e shell are unaffected.

import { SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE, isSupportedLanguage } from './locale.js';

// The marketing copy and brand per language — the single source of truth the
// preview tags are built from. The Polish build is branded "Filmowo" (the app's
// domain); English keeps "recommend". `image` is the og-image basename committed
// under public/; `ogLocale` is Facebook's `language_TERRITORY` form.
export const SHELL_META = {
  en: {
    siteName: 'recommend',
    title: 'recommend — what to watch tonight',
    description: 'Personalised film & TV picks across the streaming services you actually have. Rate, discover, and build your watchlist.',
    image: 'og-home.png',
    ogLocale: 'en_US',
  },
  pl: {
    siteName: 'Filmowo',
    title: 'Filmowo — co obejrzeć dziś wieczorem',
    description: 'Spersonalizowane propozycje filmów i seriali z serwisów streamingowych, które naprawdę masz. Oceniaj, odkrywaj i buduj listę do obejrzenia.',
    image: 'og-home-pl.png',
    ogLocale: 'pl_PL',
  },
};

// Set the `content` of one <meta> by its property/name attribute, leaving the
// rest of the tag untouched. Function replacer so a `$` in the copy is literal.
const setMeta = (html, attr, name, value) =>
  html.replace(new RegExp(`(<meta ${attr}="${name}" content=")[^"]*(")`), (_, a, b) => a + value + b);

// Map a fb_locale query value (Facebook re-scrapes the alternates as
// ?fb_locale=pl_PL) to a supported app language code, or null when absent/unknown.
export function fbLocaleLang(url) {
  const fb = url.searchParams.get('fb_locale');
  if (!fb) return null;
  const code = fb.split(/[_-]/)[0].toLowerCase();
  return isSupportedLanguage(code) ? code : null;
}

// Return the shell HTML with its preview metadata rendered for `lang`. The copy
// is controlled static text with no `"`/`<`, so it's inlined without escaping to
// mirror the template's existing convention (the raw `&` in the English copy).
export function localizeShell(html, lang) {
  const code = isSupportedLanguage(lang) ? lang : DEFAULT_LANGUAGE;
  const meta = SHELL_META[code];

  let out = html
    .replace(/(<html lang=")[^"]*(")/, (_, a, b) => a + code + b)
    .replace(/(<title>)[^<]*(<\/title>)/, (_, a, b) => a + meta.title + b);

  out = setMeta(out, 'name', 'description', meta.description);
  out = setMeta(out, 'property', 'og:title', meta.title);
  out = setMeta(out, 'property', 'og:description', meta.description);
  out = setMeta(out, 'property', 'og:site_name', meta.siteName);
  out = setMeta(out, 'name', 'twitter:title', meta.title);
  out = setMeta(out, 'name', 'twitter:description', meta.description);

  // Swap the og-image basename in og:image + twitter:image (preserving the
  // absolute origin the template hardcodes). English keeps og-home.png — no-op.
  if (meta.image !== SHELL_META[DEFAULT_LANGUAGE].image)
    out = out.replaceAll(SHELL_META[DEFAULT_LANGUAGE].image, meta.image);

  // Advertise this page's locale and its translated alternates, so Facebook
  // shows each user the variant matching their Facebook UI language. Injected
  // right after og:site_name, which the template always carries.
  const locales = `  <meta property="og:locale" content="${meta.ogLocale}" />\n`
    + SUPPORTED_LANGUAGES
        .filter((l) => l.code !== code)
        .map((l) => `  <meta property="og:locale:alternate" content="${SHELL_META[l.code].ogLocale}" />\n`)
        .join('');
  out = out.replace(/(<meta property="og:site_name"[^>]*>\n)/, (_, tag) => tag + locales);

  return out;
}
