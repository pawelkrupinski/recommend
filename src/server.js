import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import './env.js';
import {
  db,
  getUserSetting, setUserSetting,
  getRatings, upsertRating, deleteRating, dismiss, getDismissed,
  markNotSeen, getNotSeen,
  deleteAccount,
} from './db.js';
import * as tmdb from './tmdb.js';
import { motnConfigured, streamingOptions, countryServices } from './motn.js';
import { recommend, invalidateRecommendations, warmRecommendations } from './taste.js';
import { handleAuth, currentUser, enabledProviders, sessionClearingCookie } from './auth.js';
import { handleFacebook } from './facebook.js';

const PORT = process.env.PORT || 9002;
const PUBLIC = new URL('../public/', import.meta.url).pathname;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

const json = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};
const readBody = (req) =>
  new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => resolve(b));
  });

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

// Merge a curated primary list (MotN) with TMDB's region providers to reach the
// top N: drop storefronts and reseller/tier variants, dedupe by provider id, by
// normalized name, and by recognized brand (so we don't show "Netflix" twice),
// then order by recognized popularity (majorRank) with dp as a tie-breaker.
export function topServices(primary, tmdbProviders) {
  const haveId = new Set(primary.filter((p) => p.id != null).map((p) => p.id));
  const haveName = new Set(primary.map((p) => norm(p.name)));
  const haveBrand = new Set(primary.map((p) => majorRank(p.name)).filter((r) => r < 1000));
  const extras = [];
  for (const p of tmdbProviders) {
    const name = p.provider_name;
    if (haveId.has(p.provider_id) || haveName.has(norm(name))) continue;
    if (STORE_RE.test(name) || VARIANT_RE.test(name)) continue;
    const brand = majorRank(name);
    if (brand < 1000) { if (haveBrand.has(brand)) continue; haveBrand.add(brand); }
    extras.push({ id: p.provider_id, name, logo: p.logo_path, dp: p.display_priority ?? 99, source: 'tmdb' });
  }
  return [...primary, ...extras]
    .sort((a, b) => majorRank(a.name) - majorRank(b.name) || a.dp - b.dp)
    .slice(0, TOP_SERVICES)
    .map(({ dp, ...p }) => p);
}

// Build the Settings provider picker for a region. When a MotN key is present we use
// MotN's clean per-country service list (1 cached request) and map each service to a
// TMDB provider id (needed for the free /discover filtering). Otherwise we fall back
// to TMDB's own list, de-prioritizing its quirky niche-heavy ordering.
async function providerPicker(region) {
  const tmdbData = await tmdb.providersForRegion(region, 'movie');
  const tmdbProviders = tmdbData.results || [];

  if (motnConfigured()) {
    const services = await countryServices(region);
    if (services?.length) {
      // MotN's curated names/logos for this country, then topped up from TMDB's
      // region list (MotN's free tier omits some majors, e.g. Player/Canal+ in PL).
      const motn = services.map((s) => {
        const t = matchTmdb(s.name, tmdbProviders);
        return { id: t?.provider_id ?? null, name: s.name, logo: t?.logo_path ?? null,
          dp: t?.display_priority ?? 9999, source: 'motn' };
      });
      return { providers: topServices(motn, tmdbProviders), source: 'movieofthenight' };
    }
  }

  // Fallback (no MotN key): same filtering/ordering over TMDB's list alone.
  return { providers: topServices([], tmdbProviders), source: 'tmdb' };
}

async function api(req, res, url) {
  const p = url.pathname;
  try {
    const user = currentUser(req);

    // ---- who am I (auth probe; open to everyone) ----------------------
    if (p === '/api/me' && req.method === 'GET') {
      return json(res, 200, {
        user: user && { id: user.id, email: user.email, name: user.name, picture: user.picture },
        onboarded: user ? !!getUserSetting(user.id, 'onboarded', false) : false,
        providers: enabledProviders(),
      });
    }

    // ---- delete my account + all my data (right to erasure) -----------
    if (p === '/api/me' && req.method === 'DELETE') {
      if (!user) return json(res, 401, { error: 'login required' });
      deleteAccount(user.id);
      res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': sessionClearingCookie(req) });
      return res.end(JSON.stringify({ ok: true }));
    }

    // Everything below requires a signed-in user.
    if (!user) return json(res, 401, { error: 'login required' });
    const uid = user.id;

    // ---- settings -----------------------------------------------------
    if (p === '/api/settings' && req.method === 'GET') {
      return json(res, 200, {
        country: getUserSetting(uid, 'country', 'PL'),
        providers: getUserSetting(uid, 'providers', []),
      });
    }
    if (p === '/api/settings' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      // Only per-user streaming/country preferences are settable here.
      let userScopeChanged = false;
      for (const [k, v] of Object.entries(body)) {
        if (k === 'country' || k === 'providers') { setUserSetting(uid, k, v); userScopeChanged = true; }
        else if (k === 'onboarded') setUserSetting(uid, k, !!v);
      }
      if (userScopeChanged) invalidateRecommendations(uid);
      return json(res, 200, { ok: true });
    }

    // ---- provider picker for the chosen region ------------------------
    if (p === '/api/providers' && req.method === 'GET') {
      const region = url.searchParams.get('region') || getUserSetting(uid, 'country', 'PL');
      const list = await providerPicker(region);
      return json(res, 200, list);
    }

    // ---- ratings ------------------------------------------------------
    if (p === '/api/ratings' && req.method === 'GET') return json(res, 200, { ratings: getRatings(uid) });
    if (p === '/api/ratings' && req.method === 'POST') {
      const b = JSON.parse((await readBody(req)) || '{}');
      upsertRating({ ...b, user_id: uid, source: 'app' });
      invalidateRecommendations(uid);
      return json(res, 200, { ok: true });
    }
    if (p === '/api/ratings' && req.method === 'DELETE') {
      const b = JSON.parse((await readBody(req)) || '{}');
      deleteRating(uid, b.tmdb_id, b.media_type || 'movie');
      invalidateRecommendations(uid);
      return json(res, 200, { ok: true });
    }
    if (p === '/api/dismiss' && req.method === 'POST') {
      const b = JSON.parse((await readBody(req)) || '{}');
      dismiss(uid, b.tmdb_id, b.media_type || 'movie');
      invalidateRecommendations(uid);
      return json(res, 200, { ok: true });
    }
    // "Haven't seen" from the rate queue — remembered and filtered out there.
    if (p === '/api/not-seen' && req.method === 'POST') {
      const b = JSON.parse((await readBody(req)) || '{}');
      markNotSeen(uid, b.tmdb_id, b.media_type || 'movie');
      return json(res, 200, { ok: true });
    }

    // ---- in-app rating queue: popular titles to rate ------------------
    if (p === '/api/rate-queue' && req.method === 'GET') {
      const page = Number(url.searchParams.get('page') || 1);
      const data = await tmdb.popular('movie', page);
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
      return json(res, 200, { items });
    }

    // ---- genre list (for the Discover filter) ------------------------
    if (p === '/api/genres' && req.method === 'GET') {
      const { genres = [] } = await tmdb.genres('movie');
      return json(res, 200, { genres });
    }

    // ---- recommendations ---------------------------------------------
    if (p === '/api/recommend' && req.method === 'GET') {
      const region = getUserSetting(uid, 'country', 'PL');
      const providerIds = (getUserSetting(uid, 'providers', []) || []).map(Number);
      const genreId = Number(url.searchParams.get('genre')) || undefined;
      const force = url.searchParams.get('refresh') === '1';
      const out = await recommend({ userId: uid, region, providerIds, genreId, limit: 36, force });
      return json(res, 200, out);
    }

    // ---- where to watch (TMDB providers + MotN deep links) -----------
    if (p === '/api/where' && req.method === 'GET') {
      const id = Number(url.searchParams.get('id'));
      const mt = url.searchParams.get('media_type') || 'movie';
      const region = getUserSetting(uid, 'country', 'PL');
      const wp = await tmdb.watchProviders(id, mt);
      const r = wp.results?.[region] || {};
      const flatrate = (r.flatrate || []).map((x) => ({ name: x.provider_name, logo: x.logo_path }));
      const deepLinks = await streamingOptions(id, mt, region.toLowerCase());
      return json(res, 200, { tmdbLink: r.link || null, flatrate, deepLinks });
    }

    return json(res, 404, { error: 'not found' });
  } catch (e) {
    return json(res, 500, { error: e.message });
  }
}

async function serveStatic(req, res, url) {
  let path = url.pathname === '/' ? '/index.html' : url.pathname;
  try {
    const buf = await readFile(PUBLIC + path.slice(1));
    res.writeHead(200, { 'content-type': MIME[extname(path)] || 'application/octet-stream' });
    res.end(buf);
  } catch {
    res.writeHead(404).end('Not found');
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (url.pathname === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }
    if (url.pathname.startsWith('/auth/') && (await handleAuth(req, res, url))) return;
    if (url.pathname.startsWith('/facebook/') && (await handleFacebook(req, res, url))) return;
    if (url.pathname.startsWith('/api/')) return api(req, res, url);
    // Clean URL for the privacy policy (linked from the app and the Meta dashboard).
    if (url.pathname === '/privacy') url.pathname = '/privacy.html';
    return serveStatic(req, res, url);
  } catch (e) {
    console.error('request error:', e.message);
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
  console.log(`\n${signal} received — shutting down…`);
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
    console.error('server error:', err.message);
    process.exit(1);
  });

  server.listen(PORT, () => {
    console.log(`\n  🎬  recommend running →  http://localhost:${PORT}\n`);
    if (!tmdb.tmdbConfigured()) console.log('  ⚠  No TMDB key yet — set TMDB_API_KEY in the environment.\n');
    if (!enabledProviders().length) console.log('  ⚠  No OAuth providers configured — set GOOGLE_CLIENT_ID/SECRET and/or FACEBOOK_APP_ID/SECRET.\n');
    // Warm each user's per-genre recommendation caches in the background so the
    // first Discover load and genre switches are instant.
    warmRecommendations();
  });

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // A single bad request shouldn't take the whole service down. Log and keep
  // serving on unhandled rejections; on a truly fatal uncaught error, exit so
  // launchd restarts a fresh process.
  process.on('unhandledRejection', (reason) => {
    console.error('unhandledRejection:', reason);
  });
  process.on('uncaughtException', (err) => {
    console.error('uncaughtException:', err);
    shutdown('uncaughtException');
  });
}
