// Deep-link host normalisation, shared by every streaming-availability source
// (MotN, JustWatch). Both return per-service web URLs that mostly double as iOS
// Universal Links / Android App Links and open the native app directly — as long
// as the link is followed in the same tab (see public/app.js). A few services
// register a *different* host than the one the source hands back; rewrite those
// so the app handoff still fires.
export function appLink(link) {
  if (!link) return link;
  // HBO Max: the app-link host is play.hbomax.com — its AASA registers the
  // HBO Max app (com.wbd.hbomax) for path *. After the 2025 "Max" → "HBO Max"
  // rebrand reversion, *.max.com only 301-redirects here (play.max.com →
  // play.hbomax.com), and a redirect breaks the iOS Universal Link / Android
  // App Link handoff. Normalise any lingering *.max.com link to it so the app
  // still opens.
  link = link.replace(/^https:\/\/(?:www\.|play\.)?max\.com\//, 'https://play.hbomax.com/');
  // Prime Video: amazon.<tld>/gp/video/detail/{ASIN} is the *shopping* app's
  // domain and won't open the Prime Video app. app.primevideo.com has a
  // wildcard AASA + Android assetlinks for the production app, so /detail/{ASIN}
  // opens it (falling back to web otherwise). The ASIN carries over as-is; keep
  // the region-correct one the source returned (don't touch the rest of the URL).
  link = link.replace(
    /^https?:\/\/(?:www\.)?amazon\.[a-z.]+\/gp\/video\/detail\/([A-Z0-9]{10})\b.*$/i,
    'https://app.primevideo.com/detail/$1',
  );
  return link;
}
