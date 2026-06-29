import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import './env.js';
import { send, serveStatic, readBody } from './http.js';
import {
  db,
  getUserSetting, setUserSetting,
  getRatings, upsertRating, deleteRating, dismiss, getDismissed,
  markNotSeen, getNotSeen,
  addToWatchlist, getWatchlist, removeFromWatchlist,
  deleteAccount,
} from './db.js';
import * as tmdb from './tmdb.js';
import { streamingOptions } from './availability.js';
import { recommend, resolveFilters, invalidateRecommendations, warmRecommendations, backfillWatchlistCards, creditImdbIds } from './taste.js';
import { toneList } from './tones.js';
import { handleAuth, getOrCreateUser, enabledProviders, sessionClearingCookie } from './auth.js';
import { handleFacebook } from './facebook.js';
import { detectCountry, detectLanguage, isSupportedLanguage, tmdbLang } from './locale.js';
import { CONTINENTS } from './geo.js';
import { log } from './log.js';

const PORT = process.env.PORT || 9002;
const PUBLIC = new URL('../public/', import.meta.url).pathname;

// The client-routed tab paths. A GET to any of these serves the SPA shell
// (index.html) so the app can boot into that tab — mirrors TAB_NAMES in app.js.
const APP_ROUTES = new Set(['/discover', '/watchlist', '/ratings', '/settings']);

// JSON responses go through send(): brotli/gzip when the client accepts it, plus
// an ETag so an unchanged GET (e.g. a ratings list that didn't move) costs a 304
// rather than re-shipping the body. `cacheControl` defaults to a private,
// always-revalidate policy — safe for the per-user payloads this API returns.
const json = (req, res, code, body, cacheControl = 'private, no-cache') =>
  send(req, res, JSON.stringify(body), {
    status: code,
    type: 'application/json; charset=utf-8',
    cacheControl: code === 200 ? cacheControl : undefined,
  });

// The effective interface language for this user as an app code ('en'/'pl'):
// their saved choice, or — for someone who hasn't chosen yet — the language
// detected from the request (Cloudflare country header / Accept-Language).
const langFor = (uid, req) =>
  getUserSetting(uid, 'language', detectLanguage(req, detectCountry(req)));

// Normalize a service name for cross-source matching: lowercase, drop "+"/"plus"
// and any non-alphanumerics. "Disney+" / "Disney Plus" -> "disney".
export const norm = (s) => String(s).toLowerCase().replace(/\+/g, '').replace(/\bplus\b/g, '').replace(/[^a-z0-9]/g, '');

// Match a MotN service name to a TMDB provider (exact normalized match preferred,
// then shortest substring match to avoid "… Store"/"… Channel" variants).
export function matchTmdb(motnName, tmdbProviders) {
  const m = norm(motnName);
  let exact = null, sub = null;
  for (const p of tmdbProviders) {
    const t = norm(p.provider_name);
    if (t === m) { exact = p; break; }
    if (t.includes(m) || m.includes(t)) {
      if (!sub || norm(p.provider_name).length < norm(sub.provider_name).length) sub = p;
    }
  }
  return exact || sub;
}

// Both the onboarding screen and Settings show this list; keep it to the top
// services so the picker stays scannable instead of a wall of niche channels.
const TOP_SERVICES = 20;

// Transactional / rental storefronts we don't want in a "your subscriptions"
// picker — they pollute the list and can't represent a subscription anyway.
const STORE_RE = /\b(store|google ?play|rakuten|youtube|chili|maxdome|microsoft|amazon video|vudu|fandango|redbox)\b/i;

// TMDB reseller channels and ad/kids sub-tiers ("HBO Max Amazon Channel",
// "Netflix Standard with Ads", "Disney+ Kids") — duplicates of a real service.
const VARIANT_RE = /(amazon channel|apple ?tv channel|with ads|\bkids\b)/i;

// Well-known subscription services, roughly by reach (global first, then common
// regional players). TMDB's display_priority is a poor popularity signal past the
// top few, so we use this to order the picker and let dp only break ties; niche
// channels not listed here sink to the bottom and merely fill out the top 20.
const MAJOR = ['netflix', 'disney', 'hbo max', 'max', 'hulu', 'prime video', 'amazon prime',
  'apple tv', 'paramount', 'peacock', 'skyshowtime', 'now', 'sky go', 'canal+', 'player',
  'viaplay', 'filmbox', 'mubi', 'crunchyroll', 'britbox', 'starz', 'showtime', 'curiosity', 'zee5'];
export const majorRank = (name) => {
  const n = String(name).toLowerCase();
  const i = MAJOR.findIndex((m) => n.includes(m));
  return i === -1 ? 1000 : i;
};

// Curate TMDB's region providers down to the top N: drop storefronts and
// reseller/tier variants, dedupe by recognized brand (so we don't show
// "Netflix" twice), then order by recognized popularity (majorRank) with dp as
// a tie-breaker.
export function topServices(tmdbProviders) {
  const haveBrand = new Set();
  const extras = [];
  for (const p of tmdbProviders) {
    const name = p.provider_name;
    if (STORE_RE.test(name) || VARIANT_RE.test(name)) continue;
    const brand = majorRank(name);
    if (brand < 1000) { if (haveBrand.has(brand)) continue; haveBrand.add(brand); }
    extras.push({ id: p.provider_id, name, logo: p.logo_path, dp: p.display_priority ?? 99, source: 'tmdb' });
  }
  return extras
    .sort((a, b) => majorRank(a.name) - majorRank(b.name) || a.dp - b.dp)
    .slice(0, TOP_SERVICES)
    .map(({ dp, ...p }) => p);
}

// Build the Settings provider picker for a region from TMDB's region list,
// curated down to the top services (see topServices) so the picker stays
// scannable rather than a wall of niche channels.
async function providerPicker(region) {
  const tmdbData = await tmdb.providersForRegion(region, 'movie');
  return { providers: topServices(tmdbData.results || []), source: 'tmdb' };
}

async function api(req, res, url) {
  const p = url.pathname;
  try {
    // No login required: an anonymous account (and session cookie) is minted on
    // demand, so `user` is always present — anon or signed-in alike.
    const user = getOrCreateUser(req, res);
    const uid = user.id;

    // ---- who am I (auth probe; open to everyone) ----------------------
    if (p === '/api/me' && req.method === 'GET') {
      const detectedCountry = detectCountry(req);
      return json(req, res, 200, {
        user: { id: user.id, email: user.email, name: user.name, picture: user.picture },
        anonymous: user.provider === 'anon',
        onboarded: !!getUserSetting(uid, 'onboarded', false),
        providers: enabledProviders(),
        // The user's country (saved choice, else detected) — the client uses it to
        // aim a service icon's search link at the right regional storefront.
        country: getUserSetting(uid, 'country', detectedCountry),
        // Effective UI language (saved choice, else detected) plus the raw
        // detection so onboarding can preselect country/language for newcomers.
        language: langFor(uid, req),
        // The watchlist sort the user last chose, so it's restored on load.
        watchlistSort: getUserSetting(uid, 'watchlist_sort', 'added'),
        detectedCountry,
        detectedLanguage: detectLanguage(req, detectedCountry),
      });
    }

    // ---- delete my account + all my data (right to erasure) -----------
    // For an anonymous user this is "clear everything and start fresh".
    if (p === '/api/me' && req.method === 'DELETE') {
      deleteAccount(uid);
      res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': sessionClearingCookie(req) });
      return res.end(JSON.stringify({ ok: true }));
    }

    // ---- settings -----------------------------------------------------
    if (p === '/api/settings' && req.method === 'GET') {
      return json(req, res, 200, {
        country: getUserSetting(uid, 'country', 'PL'),
        providers: getUserSetting(uid, 'providers', []),
        language: langFor(uid, req),
      });
    }
    if (p === '/api/settings' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      // Only per-user streaming/country preferences are settable here.
      let userScopeChanged = false;
      for (const [k, v] of Object.entries(body)) {
        if (k === 'country' || k === 'providers') { setUserSetting(uid, k, v); userScopeChanged = true; }
        // Language has its own per-language recommendation pool (see taste.js
        // poolKey), so switching it needs no rec invalidation — just save it.
        else if (k === 'language') { if (isSupportedLanguage(v)) setUserSetting(uid, 'language', v); }
        else if (k === 'onboarded') setUserSetting(uid, k, !!v);
        // Watchlist ordering is a pure display choice — no rec invalidation.
        else if (k === 'watchlistSort') setUserSetting(uid, 'watchlist_sort', v === 'rating' ? 'rating' : 'added');
      }
      if (userScopeChanged) invalidateRecommendations(uid);
      return json(req, res, 200, { ok: true });
    }

    // ---- movie-origin reference (continents + countries for the picker) ----
    // Immutable reference data, like /api/genres — let the browser hold it a day.
    if (p === '/api/origins' && req.method === 'GET') {
      return json(req, res, 200, { continents: CONTINENTS }, 'private, max-age=86400');
    }

    // ---- provider picker for the chosen region ------------------------
    if (p === '/api/providers' && req.method === 'GET') {
      const region = url.searchParams.get('region') || getUserSetting(uid, 'country', 'PL');
      const list = await providerPicker(region);
      // Region service lists barely move — hold for an hour.
      return json(req, res, 200, list, 'private, max-age=3600');
    }

    // ---- ratings ------------------------------------------------------
    if (p === '/api/ratings' && req.method === 'GET') return json(req, res, 200, { ratings: getRatings(uid) });
    if (p === '/api/ratings' && req.method === 'POST') {
      const b = JSON.parse((await readBody(req)) || '{}');
      upsertRating({ ...b, user_id: uid, source: 'app' });
      invalidateRecommendations(uid);
      return json(req, res, 200, { ok: true });
    }
    if (p === '/api/ratings' && req.method === 'DELETE') {
      const b = JSON.parse((await readBody(req)) || '{}');
      deleteRating(uid, b.tmdb_id, b.media_type || 'movie');
      invalidateRecommendations(uid);
      return json(req, res, 200, { ok: true });
    }
    if (p === '/api/dismiss' && req.method === 'POST') {
      const b = JSON.parse((await readBody(req)) || '{}');
      dismiss(uid, b.tmdb_id, b.media_type || 'movie');
      invalidateRecommendations(uid);
      return json(req, res, 200, { ok: true });
    }
    // "Haven't seen" from the rate queue — remembered and filtered out there.
    if (p === '/api/not-seen' && req.method === 'POST') {
      const b = JSON.parse((await readBody(req)) || '{}');
      markNotSeen(uid, b.tmdb_id, b.media_type || 'movie');
      return json(req, res, 200, { ok: true });
    }

    // ---- watchlist (saved to watch later) -----------------------------
    if (p === '/api/watchlist' && req.method === 'GET') return json(req, res, 200, { watchlist: getWatchlist(uid) });
    if (p === '/api/watchlist' && req.method === 'POST') {
      const b = JSON.parse((await readBody(req)) || '{}');
      addToWatchlist({ ...b, user_id: uid });
      // Saving a pick removes it from Discover (it's now a handled title the pool
      // excludes), so invalidate to schedule a background rebuild that backfills
      // its slot with a fresh title — same replenishment rating/dismissing get.
      invalidateRecommendations(uid);
      return json(req, res, 200, { ok: true });
    }
    if (p === '/api/watchlist' && req.method === 'DELETE') {
      const b = JSON.parse((await readBody(req)) || '{}');
      removeFromWatchlist(uid, b.tmdb_id, b.media_type || 'movie');
      return json(req, res, 200, { ok: true });
    }

    // ---- in-app rating queue: acclaimed titles to rate ----------------
    if (p === '/api/rate-queue' && req.method === 'GET') {
      const page = Number(url.searchParams.get('page') || 1);
      const data = await tmdb.acclaimed(page, tmdbLang(langFor(uid, req)));
      const hidden = new Set([
        ...getRatings(uid).map((r) => r.tmdb_id),
        ...getNotSeen(uid).map((r) => r.tmdb_id),
        ...getDismissed(uid).map((r) => r.tmdb_id),
      ]);
      const items = (data.results || [])
        .filter((m) => !hidden.has(m.id))
        .map((m) => ({
          tmdb_id: m.id, title: m.title,
          year: Number((m.release_date || '').slice(0, 4)) || null,
          poster_path: m.poster_path, overview: m.overview, vote_average: m.vote_average,
        }));
      return json(req, res, 200, { items, totalPages: data.total_pages || 1 });
    }

    // ---- genre list (for the Discover filter) ------------------------
    // Effectively immutable reference data — let the browser hold it for a day.
    if (p === '/api/genres' && req.method === 'GET') {
      const { genres = [] } = await tmdb.genres('movie', tmdbLang(langFor(uid, req)));
      return json(req, res, 200, { genres }, 'private, max-age=86400');
    }

    // ---- tone tags (for the Discover tone filter + popup chips) -------
    // The mood/feel vocabulary (heartfelt, deadpan…); a fixed code-defined list,
    // so the browser can hold it for a day like the genre list.
    if (p === '/api/tones' && req.method === 'GET') {
      return json(req, res, 200, { tones: toneList() }, 'private, max-age=86400');
    }

    // ---- recommendations ---------------------------------------------
    if (p === '/api/recommend' && req.method === 'GET') {
      const region = getUserSetting(uid, 'country', 'PL');
      const providerIds = (getUserSetting(uid, 'providers', []) || []).map(Number);
      const genreId = Number(url.searchParams.get('genre')) || undefined;
      const force = url.searchParams.get('refresh') === '1';
      const language = tmdbLang(langFor(uid, req));
      // Live origin/indie browse controls from the Discover bar (like genre).
      const filters = resolveFilters({
        origin: url.searchParams.get('origin') || '',
        excludeUs: url.searchParams.get('excludeUs') === '1',
        indie: url.searchParams.get('indie') === '1',
        tone: url.searchParams.get('tag') || '',
      });
      const out = await recommend({ userId: uid, region, providerIds, genreId, limit: 36, force, language, filters });
      return json(req, res, 200, out);
    }

    // ---- where to watch (TMDB providers + availability deep links) ----
    if (p === '/api/where' && req.method === 'GET') {
      const id = Number(url.searchParams.get('id'));
      const mt = url.searchParams.get('media_type') || 'movie';
      const region = getUserSetting(uid, 'country', 'PL');
      // Resolve the title's IMDb person ids (director + top cast) alongside the
      // provider lookup so the popup can link each name straight to IMDb.
      const [wp, credits] = await Promise.all([tmdb.watchProviders(id, mt), creditImdbIds(id, mt)]);
      const r = wp.results?.[region] || {};
      const flatrate = (r.flatrate || []).map((x) => ({ name: x.provider_name, logo: x.logo_path }));
      // Tag each availability deep link with the matching TMDB provider id
      // (matched by name against this title's own region providers) so a Discover
      // card's service icon — keyed by TMDB id — can find its link without
      // name-matching.
      const regionProviders = [...(r.flatrate || []), ...(r.free || []), ...(r.ads || [])];
      const deepLinks = (await streamingOptions(id, mt, region.toLowerCase()) || [])
        .map((o) => ({ ...o, providerId: matchTmdb(o.service, regionProviders)?.provider_id ?? null }));
      return json(req, res, 200, { region, tmdbLink: r.link || null, flatrate, deepLinks, credits });
    }

    return json(req, res, 404, { error: 'not found' });
  } catch (e) {
    // An oversized body throws with err.status = 413; everything else is a 500.
    const status = e.status || 500;
    // A 5xx is our bug; a 4xx (e.g. 413) is a client mistake — log it quieter.
    if (status >= 500) log.error(`${req.method} ${url.pathname} →`, e);
    else log.warn(`${req.method} ${url.pathname} → ${status}:`, e.message);
    return json(req, res, status, { error: e.message });
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (url.pathname === '/health') { res.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' }); return res.end('ok'); }
    if (url.pathname.startsWith('/auth/') && (await handleAuth(req, res, url))) return;
    if (url.pathname.startsWith('/facebook/') && (await handleFacebook(req, res, url))) return;
    if (url.pathname.startsWith('/api/')) return api(req, res, url);
    // Clean URL for the privacy policy (linked from the app and the Meta dashboard).
    if (url.pathname === '/privacy') url.pathname = '/privacy.html';
    // Client-routed tabs are real paths (/discover, /watchlist…), not #hashes, so
    // serve the SPA shell for each — a refresh, shared link or ctrl-clicked nav
    // link lands here and the app boots straight into that tab. '/' already maps
    // to index.html via serveStatic.
    else if (APP_ROUTES.has(url.pathname)) url.pathname = '/index.html';
    // serveStatic compresses, caches (in-memory, pre-built variants) and serves a
    // 304 on a matching ETag; returns false when the file is missing.
    if (await serveStatic(req, res, PUBLIC, url.pathname)) return;
    res.writeHead(404).end('Not found');
  } catch (e) {
    log.error('request error:', e);
    if (!res.headersSent) { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: e.message })); }
  }
});

// Exported so tests can drive the server in-process (listen on an ephemeral
// port, fetch against it, close) without the production boot side effects below.
export { server };

// ---- resilience -----------------------------------------------------------
// Graceful shutdown: stop accepting connections, flush the DB, then exit 0 so
// launchd doesn't treat a normal stop as a crash.
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info(`${signal} received — shutting down…`);
  server.close(() => {
    try { db.close(); } catch { /* already closed */ }
    process.exit(0);
  });
  // Don't hang forever if a connection is stuck.
  setTimeout(() => process.exit(0), 5000).unref();
}

// Only boot the listener + process-wide handlers when run as the entrypoint
// (`node src/server.js`). When imported by a test, the module just exposes
// `server` and its handlers without binding a port or trapping signals.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  server.on('error', (err) => {
    // e.g. EADDRINUSE — exit non-zero so launchd's KeepAlive restarts us cleanly.
    log.error('server error:', err);
    process.exit(1);
  });

  server.listen(PORT, () => {
    log.info(`🎬  recommend running →  http://localhost:${PORT}`);
    if (!tmdb.tmdbConfigured()) log.warn('No TMDB key yet — set TMDB_API_KEY in the environment.');
    if (!enabledProviders().length) log.warn('No OAuth providers configured — set GOOGLE_CLIENT_ID/SECRET and/or FACEBOOK_APP_ID/SECRET.');
    // Warm each user's per-genre recommendation caches in the background so the
    // first Discover load and genre switches are instant.
    warmRecommendations();
    // Backfill rich card fields for titles saved before save-time capture so the
    // Watchlist tab matches Discover. Fire-and-forget; only touches stale rows.
    backfillWatchlistCards().catch((e) => log.warn('watchlist backfill failed:', e.message));
  });

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // A single bad request shouldn't take the whole service down. Log and keep
  // serving on unhandled rejections; on a truly fatal uncaught error, exit so
  // launchd restarts a fresh process.
  process.on('unhandledRejection', (reason) => {
    log.error('unhandledRejection:', reason);
  });
  process.on('uncaughtException', (err) => {
    log.error('uncaughtException:', err);
    shutdown('uncaughtException');
  });
}
