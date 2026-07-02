import { matchServiceLink, serviceSearchLink } from './service-match.js';
import { t, setLanguage, getLanguage, applyStatic, LANGUAGES } from './i18n.js';
import { sortWatchlist } from './watchlist-sort.js';
import { presentTones, filterByTone, presentGenres, filterByGenre, filterByType, genreLabels } from './watchlist-filters.js';
import { newPicks, pickKey } from './recs-queue.js';

const IMG = 'https://image.tmdb.org/t/p';
const $ = (s, el = document) => el.querySelector(s);
// Render's free tier spins the service down when idle; the first requests after
// a wake hit a cold origin and come back as gateway 502/503/504 (or a dropped
// connection) for up to ~a minute while it boots. Without a retry, a single
// cold-start blip during init() throws straight through loadSettings(), leaving
// e.g. the Settings country dropdown empty (no options) and no services until a
// manual reload. Retry idempotent GETs across the wake-up window with capped
// backoff; mutations (POST/DELETE) still surface the error so a save is never
// silently double-submitted.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TRANSIENT_STATUS = new Set([502, 503, 504]);
// The writes the server treats as invalidating a user's recommendation pools —
// it bumps their recGen on exactly these (see server.js), so any cached picks we
// hold afterwards are stale. Mirroring that list here lets Discover reuse its
// cached grid across navigation (picks are deterministic) yet still rebuild the
// moment the user does something that could change them. Method-specific:
// removing from the watchlist or marking "not seen" doesn't bump recGen, so it
// isn't here.
const INVALIDATING_WRITES = [
  ['POST', '/api/ratings'], ['DELETE', '/api/ratings'],
  ['POST', '/api/dismiss'], ['POST', '/api/watchlist'], ['POST', '/api/settings'],
];
let picksStale = true; // no picks cached yet → the first Discover load must fetch
const api = async (path, opts) => {
  const method = (opts?.method || 'GET').toUpperCase();
  const idempotent = method === 'GET';
  for (let attempt = 0; ; attempt++) {
    const canRetry = idempotent && attempt < 8;
    let res;
    try {
      res = await fetch(path, opts);
    } catch (e) {
      if (!canRetry) throw e; // origin unreachable (cold start / dropped) — wait and retry
      await sleep(Math.min(500 * 2 ** attempt, 8000));
      continue;
    }
    if (canRetry && TRANSIENT_STATUS.has(res.status)) {
      await sleep(Math.min(500 * 2 ** attempt, 8000));
      continue;
    }
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
    const data = await res.json();
    const route = path.split('?')[0];
    if (INVALIDATING_WRITES.some(([m, p]) => m === method && p === route)) picksStale = true;
    return data;
  }
};
const poster = (p) => (p ? `${IMG}/w342${p}` : 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg"/%3E');

// Minutes → "1h 47m" / "47m". Empty string when runtime is missing or zero.
const runtime = (min) => (min ? `${min >= 60 ? `${Math.floor(min / 60)}h ` : ''}${min % 60}m`.trim() : '');

// A title's "length" for the meta line: a film shows its runtime, a series its
// season count (its equivalent at-a-glance scale). Empty when neither is known.
function lengthLabel(m) {
  if (m.media_type === 'tv') {
    return m.seasons ? t(m.seasons === 1 ? 'card.season' : 'card.seasons', { n: m.seasons }) : '';
  }
  return runtime(m.runtime);
}

// IMDb (0–10) + Metacritic (0–100) badges, each a link out to its source. MC uses
// its own green/yellow/red tiers (≥61 good, 40–60 mixed, ≤39 bad). Each badge only
// shows when present. The IMDb badge deep-links to the title page when we know its
// id; both fall back to an on-site title search keyed on the film's name.
const mcTier = (n) => (n >= 61 ? 'good' : n >= 40 ? 'mixed' : 'bad');
const imdbTitleHref = (m) => (m.imdb_id
  ? `https://www.imdb.com/title/${m.imdb_id}/`
  : `https://www.imdb.com/find/?s=tt&q=${encodeURIComponent(m.title || '')}`);
const metacriticHref = (m) => `https://www.metacritic.com/search/${encodeURIComponent(m.title || '')}/`;
function ratingBadges(m) {
  const imdb = m.imdbRating != null
    ? `<a class="rb imdb" href="${imdbTitleHref(m)}" target="_blank" rel="noopener" title="View on IMDb">IMDb ${m.imdbRating.toFixed(1)}</a>` : '';
  const mc = m.metascore != null
    ? `<a class="rb mc ${mcTier(m.metascore)}" href="${metacriticHref(m)}" target="_blank" rel="noopener" title="View on Metacritic">MC ${m.metascore}</a>` : '';
  return imdb || mc ? `<div class="ratings">${imdb}${mc}</div>` : '';
}

// "2021 · ⭐ 7.8 · 1h 47m" — year, community rating and runtime, each shown only
// when present so a not-yet-enriched card degrades cleanly instead of "· ⭐ 0.0".
function metaLine(m) {
  const parts = [m.year || ''];
  if (m.vote_average != null) parts.push(`⭐ ${m.vote_average.toFixed(1)}`);
  const length = lengthLabel(m);
  if (length) parts.push(length);
  return parts.filter(Boolean).join(' · ');
}

// Poster + meta block shared by Discover picks and Watchlist cards: poster, title
// beside its service icons, the year/rating/runtime line, external rating badges
// and genres. Discover wraps it with a score badge + rate row, Watchlist with a
// Remove button — the card itself is identical so both render the same.
function posterAndMeta(m) {
  return `
    <img src="${poster(m.poster_path)}" loading="lazy" />
    <div class="meta">
      <div class="title-row">
        <div class="title">${esc(m.title || m.tmdb_id)}</div>
        ${m.media_type === 'tv' ? `<span class="type-tag">${esc(t('card.series'))}</span>` : ''}
        ${serviceIcons(m)}
      </div>
      <div class="year">${metaLine(m)}</div>
      ${ratingBadges(m)}
      <div class="genres">${genreLabels(m, genreByName, genreLabel).slice(0, 3).map(esc).join(' · ')}</div>
    </div>`;
}

// ---- tabs -----------------------------------------------------------------
// Each tab is a real URL path (/ratings, /settings…) — not a #hash — so the nav
// links and card service buttons are genuine anchors you can ctrl/middle-click
// into a new tab. A refresh stays on the same tab and back/forward navigate
// between them; the server serves the SPA shell for every app path.
const tabs = $('#tabs');
const TAB_NAMES = ['discover', 'watchlist', 'ratings', 'settings'];

// The path is the tab (/discover, /watchlist…) and the query carries the Discover
// filters, e.g. "/discover?genre=28&origin=c:EU&excludeUs=1". Parse it into
// { tab, genre, origin, excludeUs, indie, sort } so a refresh, shared link or
// back/forward restores the tab plus the Discover filter set and the Watchlist
// sort order.
function parseRoute() {
  const tab = location.pathname.replace(/^\/+/, '').split('/')[0];
  const params = new URLSearchParams(location.search);
  return {
    tab: TAB_NAMES.includes(tab) ? tab : 'discover',
    genre: params.get('genre') || '',
    origin: params.get('origin') || '',
    tag: params.get('tag') || '',
    type: params.get('type') || '',
    excludeUs: params.get('excludeUs') === '1',
    indie: params.get('indie') === '1',
    sort: params.get('sort') || '',
  };
}

function activateTab(t) {
  if (!TAB_NAMES.includes(t)) t = 'discover';
  for (const b of tabs.children) b.classList.toggle('active', b.dataset.tab === t);
  for (const s of document.querySelectorAll('.tab')) s.classList.toggle('active', s.id === t);
  if (t === 'discover') loadDiscover();
  if (t === 'watchlist') loadWatchlist();
  if (t === 'ratings') loadRatings();
  if (t === 'settings') loadSettings();
}

// Navigate to an in-app path without a full page load, then activate its tab.
function navigate(path) {
  history.pushState(null, '', path);
  activateTab(parseRoute().tab);
}

// A plain left-click on a nav link is intercepted for SPA navigation; a modifier
// or middle click falls through to the browser, which opens the real href (the
// server serves the SPA shell there too, so a new tab boots straight into it).
tabs.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-tab]');
  if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  navigate(a.getAttribute('href'));
});
window.addEventListener('popstate', () => activateTab(parseRoute().tab));

// ---- discover -------------------------------------------------------------
// The genre vocabulary, fetched once: `genreList` is the current-language id↔name
// list (Discover dropdown + watchlist labels); `genreByName` is the cross-language
// name→id map the watchlist uses to consolidate genres saved under another
// language. genreLabel resolves a canonical key (id) to its current-language name.
let genreList = [];
let genreByName = {};
let genresLoaded = false;
async function loadGenres() {
  if (genresLoaded) return;
  genresLoaded = true;
  try {
    const { genres = [], byName = {} } = await api('/api/genres');
    genreList = genres;
    genreByName = byName;
    const sel = $('#genre-filter');
    for (const g of genres) sel.append(new Option(g.name, g.id));
  } catch { genresLoaded = false; /* allow a retry next open */ }
}
const genreLabel = (key) => (genreList.find((g) => String(g.id) === String(key)) || {}).name;
// Populate the origin filter once, lazily — a single dropdown mixing continents
// and countries. Each continent is an <optgroup> whose first row ("All of …")
// selects the whole continent; its countries follow. Values are type-tagged
// ('c:'/'k:') so the server can tell a continent from a country (see geo.js).
let originsLoaded = false;
async function loadOrigins() {
  if (originsLoaded) return;
  originsLoaded = true;
  try {
    const { continents } = await api('/api/origins');
    const sel = $('#origin-filter');
    for (const c of continents) {
      const group = document.createElement('optgroup');
      group.label = c.name;
      const all = new Option(t('origin.allOf', { name: c.name }), `c:${c.code}`);
      group.append(all);
      for (const [code, name] of c.countries) group.append(new Option(name, `k:${code}`));
      sel.append(group);
    }
  } catch { originsLoaded = false; /* allow a retry next open */ }
}
// The tone vocabulary (heartfelt, deadpan…) backing the Discover tone dropdown,
// fetched once. Each option's value is the tone slug — the value sent as ?tag= —
// and its text the display label.
let tones = [];
let tonesLoaded = false;
async function loadTones() {
  if (tonesLoaded) return;
  tonesLoaded = true;
  try {
    tones = (await api('/api/tones')).tones;
    const sel = $('#tag-filter');
    for (const tn of tones) sel.append(new Option(tn.label, tn.slug));
  } catch { tonesLoaded = false; tones = []; /* allow a retry next open */ }
}

// The Discover filters (genre, origin, tone, the two toggles) live in the URL
// query so a choice survives refresh/back-forward; navigate() then drives the
// reload. Switching reads the prebuilt cache where possible; only "Refresh picks"
// forces a fresh rebuild. Every control rewrites the path's query from the full set.
function syncDiscoverFilters() {
  const params = new URLSearchParams();
  const g = $('#genre-filter').value; if (g) params.set('genre', g);
  const o = $('#origin-filter').value; if (o) params.set('origin', o);
  const tag = $('#tag-filter').value; if (tag) params.set('tag', tag);
  const type = $('#type-filter').value; if (type) params.set('type', type);
  if ($('#exclude-us').checked) params.set('excludeUs', '1');
  if ($('#indie').checked) params.set('indie', '1');
  const qs = params.toString();
  navigate(qs ? `/discover?${qs}` : '/discover');
}
for (const id of ['#genre-filter', '#origin-filter', '#tag-filter', '#type-filter', '#exclude-us', '#indie']) {
  $(id).onchange = syncDiscoverFilters;
}

// Discover is adaptive. A new account (fewer than RATE_GOAL rated films) gets an
// onboarding rate queue of acclaimed titles right here, so there's something to do
// before the engine knows enough to suggest anything good. Once enough ratings
// land, the personalized picks — which the engine has been prebuilding in the
// background as ratings arrived — are swapped in seamlessly: no spinner, no empty
// "rate some films first" screen.
const RATE_GOAL = 10;
const QUEUE_MIN = 15;        // keep at least this many cards in either rate grid
// tmdb_ids already on the user's watchlist, so a Discover card's + button can
// render in the right state. Kept in sync as the user toggles, refreshed
// whenever Discover or the Watchlist tab loads.
let watchlistIds = new Set();
let discoverMode = null;     // 'rate' (onboarding) | 'recs' (personalized picks)
let obRated = 0;             // how many films the user has rated (drives the countdown)
let obPage = 0;              // onboarding rate-queue paging
let obPages = Infinity;      // last known page count (stop paging once reached)
let obFilling = false;       // guard against overlapping refills
let swapping = false;        // guard so the background recs build/swap kicks off once

// The filter controls and Refresh button only make sense for the picks grid;
// hide them during the onboarding rate queue.
function showRecsControls(show) {
  for (const id of ['#genre-filter', '#origin-filter', '#tag-filter', '#exclude-us', '#indie', '#refresh']) {
    $(id).classList.toggle('hidden', !show);
  }
  // The toggles' labels wrap the checkboxes — hide the whole label, not just the box.
  for (const id of ['#exclude-us', '#indie']) $(id).closest('.toggle').classList.toggle('hidden', !show);
}

async function loadDiscover(force = false) {
  await Promise.all([loadGenres(), loadOrigins(), loadTones()]);
  // How many films has the user rated? Below the goal we onboard; at/above it (or
  // on a forced Refresh) we show the real picks.
  let count = RATE_GOAL;
  try { count = (await api('/api/ratings')).ratings.length; } catch { /* show picks (with its own error) */ }
  if (count >= RATE_GOAL || force) {
    discoverMode = 'recs';
    showRecsControls(true);
    return loadRecs(force);
  }
  discoverMode = 'rate';
  swapping = false;
  obRated = count;
  showRecsControls(false);
  $('#recs').innerHTML = '';
  updateOnboardInfo();
  await fillOnboardQueue(true);
}

// Header line for the onboarding queue: how many more ratings until picks appear.
function updateOnboardInfo() {
  const left = Math.max(0, RATE_GOAL - obRated);
  $('#discover-info').textContent = left
    ? t('discover.onboardCountdown', { left })
    : t('discover.buildingPersonalized');
}

// Pull acclaimed titles to rate into the Discover grid, skipping pages already
// fully covered by rated/skipped titles, until the grid holds at least QUEUE_MIN
// cards (capped so we never spin forever). Stop once the last page is reached so
// we never re-fetch it and duplicate cards. The guard stops overlapping refills
// from racing as several cards resolve in quick succession.
async function fillOnboardQueue(reset) {
  if (obFilling) return;
  obFilling = true;
  const grid = $('#recs');
  if (reset) { obPage = 0; obPages = Infinity; grid.innerHTML = ''; }
  let added = 0;
  try {
    for (let tries = 0; tries < 10 && grid.children.length < QUEUE_MIN && obPage < obPages; tries++) {
      obPage++;
      const { items, totalPages } = await api(`/api/rate-queue?page=${obPage}`);
      obPages = totalPages || 1;
      for (const m of items) grid.append(queueCard(m, onboardResolve));
      added += items.length;
    }
  } finally { obFilling = false; }
  if (!added && reset) $('#discover-info').textContent = t('discover.ratedEverything');
}

// An onboarding-queue card's write landed (rated or "haven't seen"): track the
// count, top the grid back up if it dipped below QUEUE_MIN, and once the goal is
// hit, swap in the picks. The card itself was already removed optimistically on
// click (commitCard), so this is pure post-save bookkeeping.
function onboardResolve(kind) {
  if (kind === 'rated') { obRated++; updateOnboardInfo(); maybeSwap(); }
  if ($('#recs').children.length < QUEUE_MIN) fillOnboardQueue(false);
}

// Goal reached: fetch the personalized picks in the background (the engine has
// been prebuilding them as ratings landed, so this is usually instant via the
// cache) and swap the grid over with no loading state. If the pool comes back
// empty (e.g. no streaming services chosen yet) we stay in the rate queue and
// retry on the next rating.
async function maybeSwap() {
  if (obRated < RATE_GOAL || swapping || discoverMode !== 'rate') return;
  swapping = true;
  try {
    const { results, profileSize } = await api('/api/recommend');
    if (discoverMode !== 'rate') return;                 // user navigated away mid-build
    if (!results.length) { swapping = false; return; }   // pool not ready — keep rating
    await loadWatchlistIds();
    discoverMode = 'recs';
    showRecsControls(true);
    renderRecs(results, profileSize, '');
    // The swap fetched the unfiltered (all-genres) pool with no controls set, so
    // this grid IS the default Discover view — register it so a tab-back reuses it.
    renderedPicksKey = discoverParams();
    picksStale = false;
  } catch { swapping = false; }
}

// The current Discover view as an /api/recommend query string, read straight from
// the live filter controls — shared by a full load and the background refill so
// both fetch exactly the same slice. `refresh` forces a server-side pool rebuild.
function discoverParams({ refresh = false } = {}) {
  const params = new URLSearchParams();
  const genre = $('#genre-filter').value;
  if (genre) params.set('genre', genre);
  const origin = $('#origin-filter').value;
  if (origin) params.set('origin', origin);
  const tag = $('#tag-filter').value;
  if (tag) params.set('tag', tag);
  const type = $('#type-filter').value;
  if (type) params.set('type', type);
  if ($('#exclude-us').checked) params.set('excludeUs', '1');
  if ($('#indie').checked) params.set('indie', '1');
  if (refresh) params.set('refresh', '1');
  return params.toString();
}

// The view (filters minus the refresh flag) whose picks are currently in the
// grid, so a no-op revisit can recognise it. Picks are deterministic — the same
// view with unchanged ratings rebuilds to the identical grid — so when this
// matches and nothing the user did since could have changed them (picksStale),
// loadRecs reuses the grid instead of clearing and refetching /api/recommend.
let renderedPicksKey = null;

async function loadRecs(force = false) {
  const info = $('#discover-info'), grid = $('#recs');
  // Restore the filters from the URL (options exist now that loadGenres /
  // loadOrigins ran) so a refresh or back/forward repaints the same view.
  const h = parseRoute();
  $('#genre-filter').value = h.genre;
  $('#origin-filter').value = h.origin;
  $('#tag-filter').value = h.tag || '';
  $('#type-filter').value = h.type || '';
  $('#exclude-us').checked = h.excludeUs;
  $('#indie').checked = h.indie;
  const genre = $('#genre-filter').value;
  const key = discoverParams();
  // Same view, no rating/dismiss/watchlist/settings change since, grid intact →
  // the rebuild would be byte-identical. Skip it: no clear, no spinner, no fetch.
  if (!force && !picksStale && renderedPicksKey === key && grid.children.length) return;
  info.textContent = t('discover.building');
  grid.innerHTML = '';
  try {
    const qs = discoverParams({ refresh: force });
    const [{ results, profileSize }] = await Promise.all([
      api('/api/recommend' + (qs ? `?${qs}` : '')),
      loadWatchlistIds(),
    ]);
    renderRecs(results, profileSize, genre);
    renderedPicksKey = key;
    picksStale = false;
  } catch (e) {
    info.textContent = '';
    grid.innerHTML = `<p class="empty">⚠ ${e.message}</p>`;
  }
}

// Paint the personalized picks grid — shared by a normal Discover load and the
// seamless onboarding→picks swap.
function renderRecs(results, profileSize, genre) {
  const info = $('#discover-info'), grid = $('#recs');
  // Titles already on the watchlist have been dealt with — keep them out of the
  // picks grid rather than showing a card the user has to dismiss again.
  const picks = results.filter((m) => !watchlistIds.has(pickKey(m)));
  if (!picks.length) {
    info.textContent = '';
    grid.innerHTML = `<p class="empty">${t(genre ? 'discover.emptyGenre' : 'discover.emptyNoPicks')}</p>`;
    return;
  }
  info.textContent = genre
    ? t('discover.picksSummaryGenre', { count: picks.length, genre: $('#genre-filter').selectedOptions[0].textContent, profile: profileSize })
    : t('discover.picksSummary', { count: picks.length, profile: profileSize });
  grid.innerHTML = '';
  for (const m of picks) grid.append(recCard(m));
  enrichVisible();
}

// IMDb/Metacritic ratings are no longer built into the pool — they're resolved
// off the recommendation build's critical path so picks paint fast. After cards
// land, fetch /api/enrich for the ones we haven't resolved yet and patch each
// card's rating badges in place (and refresh popup tones if newly scraped). The
// server bounds and TTL-caches the lookups, so this stays cheap as the user
// advances and refillPicks adds more cards. Shared by Discover and the Watchlist
// (both carry `_pick` cards), so a saved title missing a badge fills in too.
//
// /api/enrich streams NDJSON — one line per title as it resolves — so each card
// lights up the moment its rating lands, not after the slowest title in the
// chunk. We patch per line; once a chunk's stream completes, any title that never
// streamed a line resolved to nothing, so we mark it badge-less too.
async function enrichGrid(grid) {
  if (!grid) return;
  const pending = [...grid.querySelectorAll('.card')].filter((c) => c._pick && c._pick.imdbRating === undefined);
  if (!pending.length) return;
  // The endpoint caps at a screenful of ids; chunk so a long watchlist isn't
  // silently truncated to the first 40.
  for (let i = 0; i < pending.length; i += 40) {
    const chunk = pending.slice(i, i + 40);
    // Ids travel as `media_type:tmdb_id` tokens (a film and a series can share an
    // id) and each streamed line keys by the same pair — see pickKey.
    const byKey = new Map(chunk.map((c) => [pickKey(c._pick), c]));
    try {
      await streamEnrich(chunk.map((c) => pickKey(c._pick)), (key, d) => {
        const c = byKey.get(key);
        if (c) applyEnrichment(c, d);
      });
    } catch { continue; } // stream failed: leave cards unresolved so a later pass retries
    // Stream finished: a title with no line resolved to no badges.
    for (const c of chunk) if (c._pick.imdbRating === undefined) applyEnrichment(c, {});
  }
}
const enrichVisible = () => enrichGrid($('#recs'));

// Patch one card from a streamed enrichment payload (empty `{}` = resolved with
// no badges). Records the resolution on `_pick` so the card isn't refetched and
// repaints its badge row.
function applyEnrichment(c, d) {
  c._pick.imdbRating = d.imdbRating ?? null;   // mark resolved (even null) so we don't refetch it
  c._pick.metascore = d.metascore ?? null;
  if (d.imdb_id) c._pick.imdb_id = d.imdb_id;   // adopt a freshly-resolved id so the badge deep-links
  if (d.tones && d.tones.length) c._pick.tones = d.tones;
  refreshRatings(c);
}

// Fetch /api/enrich for `keys` and invoke `onItem(key, payload)` for each NDJSON
// line as it arrives. Throws on a non-OK / bodyless response so the caller can
// leave the chunk for a later retry.
async function streamEnrich(keys, onItem) {
  const res = await fetch('/api/enrich?ids=' + keys.join(','));
  if (!res.ok || !res.body) throw new Error('enrich ' + res.status);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const flush = (line) => {
    if (!line) return;
    let obj; try { obj = JSON.parse(line); } catch { return; }
    const { key, ...payload } = obj;
    onItem(key, payload);
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) { flush(buf.slice(0, nl)); buf = buf.slice(nl + 1); }
  }
  flush((buf + decoder.decode()).trim()); // any trailing line without a newline
}

// Patch one card's IMDb/Metacritic badge row from its (now-enriched) pick object,
// inserting the row before the genres line when the card had no badges yet and
// removing it when enrichment found none.
function refreshRatings(el) {
  const meta = el.querySelector('.meta');
  if (!meta) return;
  const html = ratingBadges(el._pick);
  const existing = meta.querySelector('.ratings');
  if (existing) existing.outerHTML = html;        // '' removes the row; otherwise replaces it
  else if (html) meta.querySelector('.genres').insertAdjacentHTML('beforebegin', html);
}
// Shown when the last Discover card leaves the grid — whether it was rated,
// dismissed, or saved to the watchlist. A function (not a const) so it reflects
// the language chosen at init, not the default at module load.
const picksEmptyMsg = () => t('discover.picksEmptyMore');
function recCard(m) {
  const el = document.createElement('div');
  el.className = 'card';
  el.classList.toggle('tv', m.media_type === 'tv'); // cooler tint distinguishes series from films
  el.dataset.id = m.tmdb_id;   // lets refillPicks tell which titles are already on screen
  el.dataset.key = pickKey(m); // the (media_type, id) pair refillPicks dedups on
  el._pick = m;                // the pick object, so deferred /api/enrich can patch this card's badges
  const hi = m.score >= 75 ? 'hi' : '';
  el.innerHTML = `
    <div class="score ${hi}">${m.score}</div>
    ${watchBtnMarkup()}
    ${posterAndMeta(m)}
    ${ratingRow()}`;
  el.querySelector('img').onclick = () => openWhere(m);
  wireWatch(el, m);
  wireServiceLinks(el, m);
  // Rating or dismissing removes the card; the API also excludes it from future picks.
  wireRating(el, m);
  return el;
}

// Only the user's own chosen services that carry this title (the server filters
// to them) are shown, each as a small logo — the same TMDB icon the Settings
// picker uses. Each is a real link: its href is the service's own search for the
// title (serviceSearchLink, built synchronously — no quota), so it's genuinely
// ctrl/middle-clickable into a new tab. A plain click upgrades to the exact MotN
// deep link (see wireServiceLinks). A service with no known search URL renders
// without an href (plain click still opens the where-to-watch modal).
function serviceIcons(m) {
  if (!m.services || !m.services.length) return '';
  const icons = m.services.map((s) => {
    const inner = s.logo ? `<img src="${IMG}/w45${s.logo}" alt="${esc(s.name)}" />` : '<span class="nologo">🎞️</span>';
    const href = serviceSearchLink(s.name, m.title, REGION);
    return `<a class="svc-ico"${href ? ` href="${esc(href)}"` : ''} data-sid="${s.id}" data-sname="${esc(s.name)}"
      title="Watch on ${esc(s.name)}" aria-label="Watch on ${esc(s.name)}">${inner}</a>`;
  }).join('');
  return `<div class="svc">${icons}</div>`;
}
// Wire each service icon to deep-link into the title on that service. We resolve
// the per-service link lazily on click — one cached /api/where call (the same
// MotN lookup the poster's modal makes), so the picks grid spends no streaming
// quota up front. matchServiceLink bridges TMDB's tier/reseller provider names
// to MotN's plain ones (see service-match.js); we navigate in-tab so the
// streaming app's Universal Link can take over on mobile. When MotN has no
// direct title link for this service, fall back to that service's own search for
// the title (serviceSearchLink) rather than dumping the user on a generic TMDB
// page; only if even the service is unknown do we open the where-to-watch modal.
function wireServiceLinks(el, m, { dismissable = true } = {}) {
  el.querySelectorAll('.svc-ico').forEach((a) => {
    a.onclick = async (ev) => {
      // A modifier/middle click opens the href (the service search page) in a new
      // tab — let the browser handle it; only a plain click upgrades to the exact
      // deep link in-tab (so a streaming app's Universal Link can take over).
      if (ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
      ev.preventDefault();
      ev.stopPropagation();
      try {
        const w = await api(whereUrl(m));
        const url = matchServiceLink(w.deepLinks, { sid: Number(a.dataset.sid), sname: a.dataset.sname })
          || serviceSearchLink(a.dataset.sname, m.title, w.region);
        if (url) { location.href = url; return; }
      } catch { /* fall through to the modal */ }
      openWhere(m, { dismissable });
    };
  });
}

$('#refresh').onclick = () => loadRecs(true);

// ---- shared rate + dismiss widget -----------------------------------------
// Stars (1–10 → rating/10) plus a "Not interested / seen it" button.
// 10 rating stars, laid out by CSS as two rows of 5, with a hover "n / 10" readout.
const STAR_SPANS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => `<span data-n="${n}">★</span>`).join('');
const starsMarkup = () => `<div class="rate-stars"><div class="stars">${STAR_SPANS}</div><span class="rating-num"></span></div>`;
function ratingRow() {
  return `
    ${starsMarkup()}
    <button class="skip dismiss-btn">${t('card.notInterested')}</button>`;
}
// Wire the 1–10 star widget inside `el`: desktop hover and mobile touch-drag
// both preview the rating ("n / 10"); a click or finger-lift commits via
// commit(n). Shared by the Discover (wireRating) and onboarding (queueCard) cards.
function wireStars(el, commit) {
  const stars = el.querySelectorAll('.stars span');
  const starsBox = el.querySelector('.stars');
  const num = el.querySelector('.rating-num');
  // Light up stars 1..n and show the "n / 10" hint (n=0 clears).
  const preview = (n) => {
    stars.forEach((x, i) => x.classList.toggle('on', i < n));
    if (num) num.textContent = n ? `${n} / 10` : '';
  };
  stars.forEach((s) => {
    s.onmouseenter = () => preview(Number(s.dataset.n));
    s.onclick = (ev) => { ev.stopPropagation(); commit(Number(s.dataset.n)); };
  });
  el.querySelector('.rate-stars')?.addEventListener('mouseleave', () => preview(0));
  // Touch: dragging a finger over the stars previews the rating (like desktop
  // hover), lifting commits it. The star under the finger is found by
  // hit-testing, so the drag need not start on the eventual target.
  if (starsBox) {
    // The star under the finger, or 0 when the finger is off the stars.
    const starAt = (t) => {
      const hit = document.elementFromPoint(t.clientX, t.clientY);
      const span = hit && hit.closest('.stars span');
      return span && starsBox.contains(span) ? Number(span.dataset.n) : 0;
    };
    // A touch that starts on the stars is ambiguous: a horizontal drag rates,
    // a vertical drag should scroll the page (touch-action: pan-y lets the
    // browser do that). We watch the first few pixels of movement to decide.
    // mode: null = undecided, 'rate' = previewing, 'scroll' = handed to the page.
    let startX = 0, startY = 0, mode = null;
    const SLOP = 8; // px of travel before we commit to a direction
    const onStart = (ev) => {
      const t = ev.touches[0];
      startX = t.clientX; startY = t.clientY; mode = null;
      preview(starAt(t)); // immediate feedback on tap / before the drag resolves
    };
    const onMove = (ev) => {
      const t = ev.touches[0];
      if (mode === null) {
        const dx = t.clientX - startX, dy = t.clientY - startY;
        if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
        // Only a steeply vertical drag scrolls; a shallow or diagonal drag
        // across the stars (they wrap onto two rows) still rates.
        mode = Math.abs(dy) > Math.abs(dx) * 2 ? 'scroll' : 'rate';
        if (mode === 'scroll') preview(0); // let the page take the gesture
      }
      if (mode === 'rate') {
        ev.preventDefault();
        preview(starAt(t)); // clears the preview when dragged off
      }
    };
    starsBox.addEventListener('touchstart', onStart, { passive: true });
    starsBox.addEventListener('touchmove', onMove, { passive: false });
    starsBox.addEventListener('touchend', (ev) => {
      // A vertical (scroll) drag never rates, even if the finger lifts over a
      // star after the page moved under it.
      if (mode === 'scroll') { mode = null; return; }
      mode = null;
      ev.stopPropagation();
      ev.preventDefault(); // suppress the synthetic click that follows
      // Commit only if the finger lifted on a star; lifting outside the stars
      // cancels the drag (no rating, the card stays) rather than rating.
      const n = starAt(ev.changedTouches[0]);
      if (n) commit(n);
      else preview(0);
    });
    starsBox.addEventListener('touchcancel', () => { preview(0); mode = null; });
  }
}
// Wire the rate/dismiss widget inside `el` for movie `m`. Both actions are
// optimistic (commitCard): the card leaves the grid the instant you act, so the
// UI never waits on the round-trip; refillIfLow tops the grid back up once the
// write lands.
function wireRating(el, m) {
  wireStars(el, (rating) => commitCard(el, () => removeCard(el, picksEmptyMsg()),
    api('/api/ratings', { method: 'POST', body: JSON.stringify({
      tmdb_id: m.tmdb_id, media_type: m.media_type || 'movie', rating, title: m.title, year: m.year }) }),
    refillIfLow));
  el.querySelector('.dismiss-btn').onclick = (ev) => {
    ev.stopPropagation();
    commitCard(el, () => removeCard(el, picksEmptyMsg()),
      api('/api/dismiss', { method: 'POST', body: JSON.stringify({ tmdb_id: m.tmdb_id, media_type: m.media_type || 'movie' }) }),
      refillIfLow);
  };
}
// Remove a card; if its grid is now empty, show `emptyMsg`.
function removeCard(el, emptyMsg) {
  const grid = el.parentElement;
  el.remove();
  if (grid && !grid.children.length) grid.innerHTML = `<p class="empty">${esc(emptyMsg)}</p>`;
}
// Optimistic card action: `remove` takes the card out of the grid immediately and
// the write rides along in the background; `after` (refill / onboarding
// bookkeeping, which only makes sense once the write has landed) runs when it
// resolves. If the write fails we slot the card back so a rating or dismiss is
// never silently lost.
function commitCard(el, remove, saving, after = () => {}) {
  const grid = el.parentElement;
  remove();
  saving.then(after, () => {
    if (!grid) return;
    grid.querySelector('.empty')?.remove();   // clear a placeholder shown when the grid emptied
    grid.prepend(el);
  });
}

// Drop a Discover pick (rated, dismissed, or saved), then keep the grid stocked:
// the server already excludes the handled title and, once below PICKS_MIN, we pull
// the next batch in so the picks never silently run dry mid-session.
const PICKS_MIN = 8;
let refilling = false;
const refillIfLow = () => { if ($('#recs').children.length < PICKS_MIN) refillPicks(); };
function removePick(el) {
  removeCard(el, picksEmptyMsg());
  refillIfLow();
}
// Fetch the current Discover view again and append picks not already on screen
// (or now on the watchlist). Cheap and idempotent: the server serves from the
// cached pool, so this just surfaces the next-ranked titles below what's shown —
// and the background rebuild that each removal scheduled keeps that pool fresh.
async function refillPicks() {
  if (refilling || discoverMode !== 'recs') return;
  refilling = true;
  try {
    const grid = $('#recs');
    const qs = discoverParams();
    const { results } = await api('/api/recommend' + (qs ? `?${qs}` : ''));
    const shown = new Set([...grid.querySelectorAll('.card')].map((c) => c.dataset.key));
    const fresh = newPicks(results, shown, watchlistIds);
    if (!fresh.length) return;
    if (grid.querySelector('.empty')) grid.innerHTML = '';   // clear a stale empty-state
    for (const m of fresh) grid.append(recCard(m));
    enrichVisible();
  } catch { /* leave the grid; the next removal retries */ }
  finally { refilling = false; }
}

// ---- watchlist toggle (the + button on Discover cards) --------------------
// Refresh the cached set of watchlisted ids; tolerate failure (cards just keep
// their last-known + / ✓ state).
async function loadWatchlistIds() {
  try { watchlistIds = new Set((await api('/api/watchlist')).watchlist.map(pickKey)); }
  catch { /* keep the previous set */ }
}
// The corner "+" save button for a Discover card. Cards only ever show for
// unsaved titles (watchlisted ones are filtered out of the grid and saving
// removes the card), so this never needs a saved/✓ state.
function watchBtnMarkup() {
  return '<button class="watch-btn" title="Add to watchlist" aria-label="Add to watchlist">+</button>';
}
// Briefly pulse a nav tab (CSS `.flash` animation) to draw the eye to where
// something just landed — e.g. the Watchlist tab when a pick is saved.
function flashTab(tab) {
  const btn = document.querySelector(`#tabs a[data-tab="${tab}"]`);
  if (!btn) return;
  btn.classList.remove('flash');
  void btn.offsetWidth; // reflow so re-adding restarts the animation mid-flash
  btn.classList.add('flash');
  btn.addEventListener('animationend', () => btn.classList.remove('flash'), { once: true });
}
// Wire the + button inside `el` for movie `m`: saves the title to the watchlist,
// drops the card from Discover and pulses the Watchlist tab so it's clear where
// the title went. Optimistic like rate/dismiss (commitCard): the card leaves the
// grid the instant you click and the write rides in the background — awaiting the
// POST first left the + button frozen for a whole round-trip ("adding takes ages").
function wireWatch(el, m) {
  const btn = el.querySelector('.watch-btn');
  if (!btn) return;
  btn.onclick = (ev) => {
    ev.stopPropagation();
    // Reflect the save immediately: mark the id watchlisted so a refill can't
    // re-surface it, and pulse the tab. Save the whole pick, not just
    // title/year/poster — the card already holds its services, ratings, genres,
    // runtime and synopsis, so storing them now lets the Watchlist card + popup
    // render exactly like this one for free, spending no extra API quota (the
    // server whitelists which fields persist). If the write fails, commitCard slots
    // the card back, so undo the optimistic id too.
    const saving = api('/api/watchlist', { method: 'POST', body: JSON.stringify({ ...m, media_type: m.media_type || 'movie' }) });
    saving.catch(() => watchlistIds.delete(pickKey(m)));
    watchlistIds.add(pickKey(m));
    flashTab('watchlist');
    commitCard(el, () => removeCard(el, picksEmptyMsg()), saving, refillIfLow);
  };
}

// ---- where to watch modal -------------------------------------------------
// Poster + title/year/director/cast/overview header shared by both render passes.
function movieHeader(m) {
  // Each credit name links to IMDb. The card carries only names, so we open with
  // an IMDb name search; once /api/where resolves the title's person ids (see
  // openWhere) `m.credits` maps name → nm-id and we link straight to the person.
  const imdbName = (name) => {
    const id = m.credits?.[name];
    const href = id
      ? `https://www.imdb.com/name/${id}/`
      : `https://www.imdb.com/find/?s=nm&q=${encodeURIComponent(name)}`;
    return `<a class="imdb-name" href="${href}" target="_blank" rel="noopener">${esc(name)}</a>`;
  };
  const names = (list) => list.map(imdbName).join(', ');
  const director = m.director ? `<p class="credit"><span class="lbl">${t('modal.director')}</span> ${names(m.director.split(', '))}</p>` : '';
  const cast = (m.cast && m.cast.length)
    ? `<p class="credit"><span class="lbl">${t('modal.cast')}</span> ${names(m.cast)}</p>` : '';
  return `<div class="detail-head">
      <img class="detail-poster" src="${poster(m.poster_path)}" />
      <div class="detail-info">
        <h2>${esc(m.title)} <span class="sub">${m.year || ''}${runtime(m.runtime) ? ` · ${runtime(m.runtime)}` : ''}</span></h2>
        ${ratingBadges(m)}
        ${director}${cast}
        ${toneTags(m)}
        <p class="sub">${esc(m.overview || '')}</p>
      </div>
    </div>${trailerSection(m)}`;
}
// The film's tone tags as chips, each a link to Discover filtered to that tone
// (/discover?tag=<slug>). Real anchors so they ctrl/middle-click into a new tab;
// a plain click is upgraded to in-app navigation (see the #modal-body handler).
// Empty string when the title carries no tones, so the layout is unchanged.
function toneTags(m) {
  const list = m.tones || [];
  if (!list.length) return '';
  const chip = (tn) =>
    `<a class="tone-tag" href="/discover?tag=${encodeURIComponent(tn.slug)}">${esc(tn.label)}</a>`;
  return `<p class="tone-tags">${list.map(chip).join('')}</p>`;
}
// YouTube trailers for the title (already language-resolved server-side; see
// pickTrailers). Each is a link that opens the trailer on YouTube in a new tab.
// Shared by the Discover and Watchlist popups (both render movieHeader). Empty
// string when the film has no trailer, so the modal layout is unchanged.
function trailerSection(m) {
  const trailers = m.trailers || [];
  if (!trailers.length) return '';
  // Use the youtu.be short host, not www.youtube.com/watch. If the user has
  // YouTube installed as a web-app (a PWA, common on macOS Chrome), Chrome's
  // link capturing routes any in-scope www.youtube.com URL into the addressbar-
  // less app window instead of a browser tab. youtu.be is outside that scope, so
  // the click stays in a normal new tab and only then redirects to the watch page.
  const watchUrl = (key) => `https://youtu.be/${encodeURIComponent(key)}`;
  const links = trailers
    .map((tr) => `<a class="trailer-link" href="${watchUrl(tr.key)}" target="_blank" rel="noopener">▶ ${esc(tr.name || t('modal.trailer'))}</a>`)
    .join('');
  return `<div class="trailers">${links}</div>`;
}
// `dismissable` adds the "Not interested / seen it" button that drops the title
// from Discover. Discover (and the onboarding queue) opt in; the Watchlist popup
// passes false — dismissing a title you've deliberately saved makes no sense there.
// The where-to-watch request for a title. Carries the user's region so the
// response (browser-cached for a week — availability barely moves) keys per
// country: changing country in Settings updates REGION, so the next lookup misses
// the stale-region cache entry and fetches fresh rather than reusing another
// country's availability.
function whereUrl(m) {
  const region = REGION ? `&region=${encodeURIComponent(REGION)}` : '';
  return `/api/where?id=${m.tmdb_id}&media_type=${m.media_type || 'movie'}${region}`;
}
async function openWhere(m, { dismissable = true } = {}) {
  const modal = $('#modal'), body = $('#modal-body');
  modal.classList.remove('hidden');
  body.innerHTML = `${movieHeader(m)}<p>${t('modal.loadingAvailability')}</p>`;
  try {
    const w = await api(whereUrl(m));
    // Now that the title's IMDb person ids are known, the re-render below links
    // each director/cast name straight to imdb.com/name/… (see movieHeader).
    m.credits = w.credits || {};
    // On touch devices, navigate in the SAME tab: streaming-service URLs are
    // registered as iOS Universal Links / Android App Links and open the native
    // app — but only on a direct same-tab tap. target="_blank"/window.open
    // breaks that handoff and lands the user in the mobile browser instead.
    // On desktop keep _blank so the recommend tab stays open.
    const appTab = matchMedia('(pointer: coarse)').matches ? '' : ' target="_blank" rel="noopener"';
    // No MotN deep links: link each TMDB-listed service to its own search for
    // the title (same app-handoff tab rules); only services we don't recognise
    // fall back to the generic TMDB watch page.
    const links = (w.deepLinks && w.deepLinks.length)
      ? w.deepLinks.map((o) => `<a href="${o.link}"${appTab}>▶ ${esc(o.service)} <span class="sub">${o.type}</span></a>`).join('')
      : (w.flatrate || []).map((f) => {
          const search = serviceSearchLink(f.name, m.title, w.region);
          const tab = search ? appTab : ' target="_blank"';
          return `<a href="${search || w.tmdbLink || '#'}"${tab}><img src="${IMG}/w92${f.logo}"/> ${esc(f.name)}</a>`;
        }).join('');
    const dismissBtn = dismissable
      ? `<p style="margin-top:18px"><button id="dismiss">${t('card.notInterested')}</button></p>` : '';
    body.innerHTML = `${movieHeader(m)}
      <div class="where">${links || `<p class="sub">${t('modal.notAvailable')}</p>`}</div>
      ${dismissBtn}`;
    if (dismissable) {
      $('#dismiss').onclick = async () => {
        await api('/api/dismiss', { method: 'POST', body: JSON.stringify({ tmdb_id: m.tmdb_id }) });
        modal.classList.add('hidden'); loadDiscover();
      };
    }
  } catch (e) { body.innerHTML += `<p>⚠ ${e.message}</p>`; }
}
// A plain left-click on a tone chip filters Discover to that tone in-app: close
// the modal and SPA-navigate to /discover?tag=…. A modifier/middle click falls
// through to the real href so it opens that filtered view in a new tab.
$('#modal-body').addEventListener('click', (e) => {
  const a = e.target.closest('a.tone-tag');
  if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  $('#modal').classList.add('hidden');
  navigate(a.getAttribute('href'));
});
// Dismiss the detail modal by tapping the backdrop, the ✕ button, or pressing Escape.
$('#modal').onclick = (e) => { if (e.target.id === 'modal') e.currentTarget.classList.add('hidden'); };
$('#modal-close').onclick = () => $('#modal').classList.add('hidden');
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') $('#modal').classList.add('hidden');
});

// ---- onboarding rate card -------------------------------------------------
// One rate-and-skip card: 1–10 stars (rating/10) + a "Haven't seen" button.
// Used by the Discover onboarding queue. `onResolve(el, kind)` fires after the
// POST settles, with kind 'rated' or 'skipped'.
function queueCard(m, onResolve) {
  const el = document.createElement('div');
  el.className = 'card';
  el.innerHTML = `
    <img src="${poster(m.poster_path)}" loading="lazy" />
    <div class="meta"><div class="title">${esc(m.title)}</div><div class="year">${m.year || ''}</div></div>
    ${starsMarkup()}
    <button class="skip">${t('card.notSeen')}</button>`;
  el.querySelector('img').onclick = () => openWhere(m); // poster → where-to-watch modal
  // Optimistic, like the picks cards: the card leaves the grid on click and the
  // write follows in the background (onResolve runs once it lands).
  wireStars(el, (rating) => commitCard(el, () => el.remove(),
    api('/api/ratings', { method: 'POST', body: JSON.stringify({
      tmdb_id: m.tmdb_id, media_type: 'movie', rating, title: m.title, year: m.year }) }),
    () => onResolve('rated')));
  el.querySelector('.skip').onclick = () => commitCard(el, () => el.remove(),
    api('/api/not-seen', { method: 'POST', body: JSON.stringify({ tmdb_id: m.tmdb_id, media_type: 'movie' }) }),
    () => onResolve('skipped'));
  return el;
}

// ---- watchlist tab --------------------------------------------------------
// Saved titles as poster cards: tap the poster for where-to-watch, "Remove" to
// take it off the list. Doubles as the refresh of the cached id set so the
// Discover + buttons stay accurate after edits here.
// The saved titles last loaded, kept client-side so the tone/genre filters and
// sort can re-render without re-fetching; active filters ('' = all).
let watchlistItems = [];
let watchlistTone = '';
let watchlistGenre = '';
let watchlistType = '';
async function loadWatchlist() {
  // The watchlist response carries its own genre vocabulary — labels (`genres`)
  // and the cross-language name→id consolidation map (`byName`) — because it's
  // never cached, so the map can't be served stale the way the day-cached
  // /api/genres can (a pre-`byName` copy there left the dropdown un-consolidated,
  // every language variant its own option). We still need the tone vocabulary for
  // the tone dropdown's canonical order.
  const [{ watchlist, genres = [], byName = {} }] = await Promise.all([api('/api/watchlist'), loadTones()]);
  genreList = genres;
  genreByName = byName;
  watchlistItems = watchlist;
  watchlistIds = new Set(watchlist.map(pickKey));
  setWatchlistCount(watchlist.length); // total saved, independent of the tone filter
  // An explicit ?sort=rating in the URL (refresh/back-forward/shared link) wins;
  // otherwise fall back to the order the user last chose, remembered server-side
  // on ME so a bare /watchlist (e.g. the nav tab) restores it.
  $('#watchlist-sort').value = parseRoute().sort === 'rating' || ME?.watchlistSort === 'rating' ? 'rating' : 'added';
  populateWatchlistTones();
  populateWatchlistGenres();
  populateWatchlistType();
  renderWatchlist();
}
// Show the movie/series filter only when the watchlist actually holds both types
// — with only one, filtering by it would be a no-op (same rule as the lone-genre
// case). The three options are fixed, so this just toggles visibility + resets a
// now-pointless selection.
function populateWatchlistType() {
  const types = new Set(watchlistItems.map((it) => it.media_type || 'movie'));
  if (watchlistType && !types.has(watchlistType)) watchlistType = '';
  const sel = $('#watchlist-type');
  sel.value = watchlistType;
  sel.classList.toggle('hidden', types.size < 2);
}
// Fill the tone dropdown with only the tones present on saved titles (canonical
// order), hiding it when none carry a tone. Preserves the current selection if it
// still applies, else falls back to "all" so a now-absent tone can't strand the list.
function populateWatchlistTones() {
  const present = presentTones(watchlistItems, tones.map((tn) => tn.slug));
  if (watchlistTone && !present.some((tn) => tn.slug === watchlistTone)) watchlistTone = '';
  const sel = $('#watchlist-tone');
  sel.innerHTML = `<option value="">${t('watchlist.allTones')}</option>`
    + present.map((tn) => `<option value="${esc(tn.slug)}">${esc(tn.label)}</option>`).join('');
  sel.value = watchlistTone;
  sel.classList.toggle('hidden', present.length === 0);
}
// Fill the genre ("category") dropdown with only the genres present on saved
// titles (A→Z), preserving the current selection if it still applies. Hidden
// below two genres: every film carries a genre, so a lone genre is shared by all
// saved titles and filtering by it would be a no-op (unlike a lone tone, which
// still meaningfully hides untoned titles).
function populateWatchlistGenres() {
  const present = presentGenres(watchlistItems, genreByName, genreLabel);
  if (watchlistGenre && !present.some((g) => g.key === watchlistGenre)) watchlistGenre = '';
  const sel = $('#watchlist-genre');
  sel.innerHTML = `<option value="">${t('genre.all')}</option>`
    + present.map((g) => `<option value="${esc(g.key)}">${esc(g.label)}</option>`).join('');
  sel.value = watchlistGenre;
  sel.classList.toggle('hidden', present.length < 2);
}
// Paint the grid from the cached items, applying the tone + genre filters then
// the sort.
function renderWatchlist() {
  const sort = $('#watchlist-sort').value === 'rating' ? 'rating' : 'added';
  const filtered = filterByType(
    filterByGenre(filterByTone(watchlistItems, watchlistTone), watchlistGenre, genreByName), watchlistType);
  const ordered = sortWatchlist(filtered, sort);
  const grid = $('#watchlist-grid');
  const emptyKey = watchlistTone || watchlistGenre || watchlistType ? 'watchlist.emptyFiltered' : 'watchlist.empty';
  grid.innerHTML = ordered.length ? '' : `<p class="empty">${t(emptyKey)}</p>`;
  for (const w of ordered) grid.append(watchCard(w));
  enrichGrid(grid); // fill in badges for saved titles enriched before rating resolution existed
}
// Changing the sort rewrites the path's query (navigate() reloads the tab) and
// persists the choice so it's remembered on the next visit.
$('#watchlist-sort').onchange = () => {
  const v = $('#watchlist-sort').value === 'rating' ? 'rating' : 'added';
  ME.watchlistSort = v;
  saveSetting('watchlistSort', v);
  navigate(v === 'rating' ? '/watchlist?sort=rating' : '/watchlist');
};
// The tone/genre filters are pure client-side views over the already-loaded
// titles, so they just re-render — no refetch, no URL change.
$('#watchlist-tone').onchange = () => { watchlistTone = $('#watchlist-tone').value; renderWatchlist(); };
$('#watchlist-genre').onchange = () => { watchlistGenre = $('#watchlist-genre').value; renderWatchlist(); };
$('#watchlist-type').onchange = () => { watchlistType = $('#watchlist-type').value; renderWatchlist(); };
function setWatchlistCount(n) {
  $('#watchlist-count').textContent = t('watchlist.count', { n });
}
function watchCard(w) {
  const el = document.createElement('div');
  el.className = 'card';
  el.classList.toggle('tv', w.media_type === 'tv'); // same series tint as Discover
  el.dataset.id = w.tmdb_id;
  el._pick = w;                // so deferred /api/enrich can patch this card's badges, as on Discover
  // Same card body as a Discover pick (the rich fields were captured when it was
  // saved), minus the score badge and rate widget; a Remove button stands in for
  // the rate row. Tapping the poster opens the same where-to-watch popup.
  el.innerHTML = `${posterAndMeta(w)}
    <button class="skip watch-remove">${t('watchlist.remove')}</button>`;
  el.querySelector('img').onclick = () => openWhere(w, { dismissable: false });
  wireServiceLinks(el, w, { dismissable: false }); // deep-link each service icon, exactly like Discover
  el.querySelector('.watch-remove').onclick = async () => {
    await api('/api/watchlist', { method: 'DELETE', body: JSON.stringify({ tmdb_id: w.tmdb_id, media_type: w.media_type || 'movie' }) });
    watchlistIds.delete(pickKey(w));
    watchlistItems = watchlistItems.filter((it) => pickKey(it) !== pickKey(w));
    setWatchlistCount(watchlistItems.length);
    // Re-derive both dropdowns (removing the last title of a tone/genre drops it)
    // and repaint, so the view stays consistent with the filters and remaining items.
    populateWatchlistTones();
    populateWatchlistGenres();
    renderWatchlist();
  };
  return el;
}

// ---- my ratings -----------------------------------------------------------
async function loadRatings() {
  const { ratings } = await api('/api/ratings');
  $('#ratings-count').textContent = t('ratings.count', { n: ratings.length });
  const list = $('#ratings-list');
  list.innerHTML = ratings.length ? '' : `<p class="empty">${t('ratings.empty')}</p>`;
  for (const r of ratings) {
    const row = document.createElement('div');
    row.className = 'rrow';
    row.innerHTML = `<span>${esc(r.title || r.tmdb_id)} <span class="sub">${r.year || ''} · ${r.source}</span></span>
      <span><span class="r">${r.rating}</span>/10 <button class="del">✕</button></span>`;
    row.querySelector('.del').onclick = async () => {
      await api('/api/ratings', { method: 'DELETE', body: JSON.stringify({ tmdb_id: r.tmdb_id, media_type: r.media_type }) });
      loadRatings();
    };
    list.append(row);
  }
}

// ---- settings -------------------------------------------------------------
const COUNTRIES = [['PL','Poland'],['US','United States'],['GB','United Kingdom'],['DE','Germany'],
  ['FR','France'],['ES','Spain'],['IT','Italy'],['NL','Netherlands'],['SE','Sweden'],['CA','Canada'],['AU','Australia']];
// Native-name options for the language switcher (shared by Settings + onboarding).
const langOptions = (selected) =>
  LANGUAGES.map(({ code, name }) => `<option value="${code}" ${code === selected ? 'selected' : ''}>${name}</option>`).join('');
async function loadSettings() {
  const s = await api('/api/settings');
  const lang = $('#lang');
  lang.innerHTML = langOptions(getLanguage());
  // Switching language reloads so genres, picks and synopses all refetch in the
  // new language (the tab is preserved via the URL path).
  lang.onchange = async () => { await saveSetting('language', lang.value); location.reload(); };
  const sel = $('#country');
  sel.innerHTML = COUNTRIES.map(([c, n]) => `<option value="${c}" ${c === s.country ? 'selected' : ''}>${n}</option>`).join('');
  sel.onchange = async () => {
    REGION = sel.value; // keep the where-to-watch region (and its cache key) in sync
    await saveSetting('country', sel.value);
    loadProviders(sel.value, s.providers);
  };
  await loadProviders(s.country, s.providers);
}
// `onToggle` runs after each service is toggled. In Settings it persists the
// change immediately; onboarding leaves it off and saves the whole set once at
// the end (see runOnboarding), so it passes a no-op.
async function loadProviders(region, selected = [], box = $('#provider-list'), onToggle = saveProviders) {
  box.parentElement.querySelectorAll('.src-note').forEach((n) => n.remove());
  box.innerHTML = `<p class="sub">${t('providers.loading')}</p>`;
  try {
    const { providers } = await api(`/api/providers?region=${region}`);
    const chosen = new Set((selected || []).map(Number));
    box.innerHTML = '';
    for (const p of providers) {
      const el = document.createElement('div');
      el.className = 'prov' + (chosen.has(p.id) ? ' on' : '');
      const logo = p.logo ? `<img src="${IMG}/w45${p.logo}"/>` : '<span class="nologo">🎞️</span>';
      el.innerHTML = `${logo} ${esc(p.name)}`;
      el.onclick = () => { el.classList.toggle('on'); onToggle(box); };
      el.dataset.id = p.id;
      box.append(el);
    }
    box.insertAdjacentHTML('beforebegin', `<p class="sub src-note">${t('providers.sourceTmdb')}</p>`);
  } catch (e) { box.innerHTML = `<p class="sub">${t('providers.errorSetKey', { msg: e.message })}</p>`; }
}
// Each service toggle persists immediately — no save button. We send the full
// set of chosen ids on every change so the server need not track diffs.
const saveProviders = (box = $('#provider-list')) =>
  saveSetting('providers', [...box.querySelectorAll('.prov.on')].map((e) => Number(e.dataset.id)));
const saveSetting = (k, v) => api('/api/settings', { method: 'POST', body: JSON.stringify({ [k]: v }) });

// Wipe all of the current account's data and reload (the server clears the
// session cookie, so an anonymous user simply starts fresh, a signed-in one is
// fully deleted). The confirm/label adapt to which kind of account it is.
$('#delete-account').onclick = async () => {
  const msg = t(ME.anonymous ? 'account.confirmAnon' : 'account.confirmUser');
  if (!confirm(msg)) return;
  const btn = $('#delete-account');
  btn.disabled = true; btn.textContent = t('account.deleting');
  try {
    await api('/api/me', { method: 'DELETE' });
    location.href = '/';
  } catch (e) {
    btn.disabled = false; btn.textContent = t('settings.deleteAccount');
    alert(t('account.deleteFailed', { msg: e.message }));
  }
};

function esc(s) { return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// ---- auth / bootstrap -----------------------------------------------------
let ME = null;
// The user's country (from /api/me), used to point a service icon's search-link
// href at the right regional storefront (only Apple TV varies by country today).
let REGION = '';
const PROVIDER_NAMES = { google: 'Google', facebook: 'Facebook' };
const providerLabel = (p) => t('auth.signInWith', { provider: PROVIDER_NAMES[p] || (p[0].toUpperCase() + p.slice(1)) });
// Populate the (optional) sign-in overlay's provider buttons. Called once at
// startup so the overlay is ready the moment an anonymous user taps "Sign in".
function renderLogin(providers) {
  $('#login-buttons').innerHTML = providers.length
    ? providers.map((p) => `<a class="btn-oauth ${p}" href="/auth/${p}">${providerLabel(p)}</a>`).join('')
    : `<p class="sub">${t('auth.noProviders')}</p>`;
  const err = new URLSearchParams(location.search).get('error');
  if (err) $('#login-error').textContent = '⚠ ' + err;
}
// Show/hide the sign-in overlay; an anonymous user can dismiss it and keep using
// the app, so it behaves like a modal rather than a gate.
const showLogin = () => $('#login').classList.remove('hidden');
const hideLogin = () => $('#login').classList.add('hidden');
$('#login-close').onclick = hideLogin;
$('#login').onclick = (e) => { if (e.target.id === 'login') hideLogin(); };

// The userbar offers "Sign in" while anonymous (only when a provider exists),
// and the avatar + "Sign out" once signed in.
function renderUserbar() {
  if (ME.anonymous) {
    $('#userbar').innerHTML = (ME.providers || []).length
      ? `<a class="logout" id="show-signin">${t('auth.signIn')}</a>` : '';
    const link = $('#show-signin');
    if (link) link.onclick = showLogin;
    return;
  }
  const user = ME.user;
  const avatar = user.picture ? `<img src="${user.picture}" alt="" referrerpolicy="no-referrer" />` : '';
  $('#userbar').innerHTML =
    `${avatar}<span class="uname">${esc(user.name || user.email)}</span>`
    + `<a class="logout" href="/auth/logout">${t('auth.signOut')}</a>`;
}
// ---- first-run onboarding -------------------------------------------------
// Brand-new accounts (onboarded=false) must pick their streaming services before
// reaching the app. Reuses the Settings provider picker against its own list.
async function startOnboarding() {
  const ob = $('#onboarding');
  ob.classList.remove('hidden');
  // Language switches the onboarding copy live (no data loaded yet to refetch).
  const lang = $('#ob-lang');
  lang.innerHTML = langOptions(getLanguage());
  lang.onchange = () => { setLanguage(lang.value); document.documentElement.lang = lang.value; applyStatic(); };
  // Preselect the detected country for a newcomer; fall back to PL if we don't
  // recognise it (or there was no geo signal).
  const detected = COUNTRIES.some(([c]) => c === ME.detectedCountry) ? ME.detectedCountry : 'PL';
  const sel = $('#ob-country');
  sel.innerHTML = COUNTRIES.map(([c, n]) => `<option value="${c}" ${c === detected ? 'selected' : ''}>${n}</option>`).join('');
  // Services differ per country, so a country switch reloads with a clean slate.
  const noSave = () => {}; // onboarding saves the full set once at the end
  sel.onchange = () => loadProviders(sel.value, [], $('#ob-provider-list'), noSave);
  await loadProviders(sel.value, [], $('#ob-provider-list'), noSave);
  $('#ob-continue').onclick = async () => {
    const btn = $('#ob-continue');
    const ids = [...$('#ob-provider-list').querySelectorAll('.prov.on')].map((e) => Number(e.dataset.id));
    btn.disabled = true;
    try {
      await api('/api/settings', { method: 'POST', body: JSON.stringify({
        country: sel.value, providers: ids, language: getLanguage(), onboarded: true }) });
    } catch (e) { btn.disabled = false; alert('⚠ ' + e.message); return; }
    ob.classList.add('hidden');
    enterApp();
  };
}

function enterApp() {
  $('#app').classList.remove('hidden');
  renderUserbar();
  activateTab(parseRoute().tab); // open whatever tab the URL points at (default Discover)
}

async function init() {
  // /api/me mints an anonymous session if there's none, so there is always a
  // user — no login gate. The overlay is prepared up front in case the user later
  // taps "Sign in" (e.g. to sync across devices); it surfaces any ?error= too.
  try { ME = await api('/api/me'); } catch { ME = { user: null, anonymous: true, providers: [] }; }
  REGION = ME.country || '';
  // Set the interface language (saved choice, else detected) and translate all
  // the static markup before any screen is shown.
  setLanguage(ME.language || 'en');
  document.documentElement.lang = getLanguage();
  applyStatic();
  renderLogin(ME.providers || []);
  const params = new URLSearchParams(location.search);
  if (params.get('error')) showLogin();
  // Drop any ?error= left over from a failed prior attempt, but keep the route
  // and its ?genre= (the path now carries the active tab, not a #hash).
  if (params.has('error')) {
    params.delete('error');
    const qs = params.toString();
    history.replaceState(null, '', location.pathname + (qs ? `?${qs}` : ''));
  }
  if (!ME.onboarded) return startOnboarding();
  enterApp();
}
init();
