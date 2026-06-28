import { matchServiceLink, serviceSearchLink } from '/service-match.js';
import { t, setLanguage, getLanguage, applyStatic, LANGUAGES } from './i18n.js';
import { sortWatchlist } from './watchlist-sort.js';

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
const api = async (path, opts) => {
  const idempotent = !opts?.method || opts.method.toUpperCase() === 'GET';
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
    return res.json();
  }
};
const poster = (p) => (p ? `${IMG}/w342${p}` : 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg"/%3E');

// Minutes → "1h 47m" / "47m". Empty string when runtime is missing or zero.
const runtime = (min) => (min ? `${min >= 60 ? `${Math.floor(min / 60)}h ` : ''}${min % 60}m`.trim() : '');

// IMDb (0–10) + Metacritic (0–100) badges. MC uses its own green/yellow/red
// tiers (≥61 good, 40–60 mixed, ≤39 bad). Each badge only shows when present.
const mcTier = (n) => (n >= 61 ? 'good' : n >= 40 ? 'mixed' : 'bad');
function ratingBadges(m) {
  const imdb = m.imdbRating != null
    ? `<span class="rb imdb" title="IMDb rating">IMDb ${m.imdbRating.toFixed(1)}</span>` : '';
  const mc = m.metascore != null
    ? `<span class="rb mc ${mcTier(m.metascore)}" title="Metacritic Metascore">MC ${m.metascore}</span>` : '';
  return imdb || mc ? `<div class="ratings">${imdb}${mc}</div>` : '';
}

// "2021 · ⭐ 7.8 · 1h 47m" — year, community rating and runtime, each shown only
// when present so a not-yet-enriched card degrades cleanly instead of "· ⭐ 0.0".
function metaLine(m) {
  const parts = [m.year || ''];
  if (m.vote_average != null) parts.push(`⭐ ${m.vote_average.toFixed(1)}`);
  if (runtime(m.runtime)) parts.push(runtime(m.runtime));
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
        ${serviceIcons(m)}
      </div>
      <div class="year">${metaLine(m)}</div>
      ${ratingBadges(m)}
      <div class="genres">${(m.genres || []).slice(0, 3).join(' · ')}</div>
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
// Populate the genre filter once, lazily, the first time Discover is opened.
let genresLoaded = false;
async function loadGenres() {
  if (genresLoaded) return;
  genresLoaded = true;
  try {
    const { genres } = await api('/api/genres');
    const sel = $('#genre-filter');
    for (const g of genres) {
      const o = document.createElement('option');
      o.value = g.id; o.textContent = g.name;
      sel.append(o);
    }
  } catch { genresLoaded = false; /* allow a retry next open */ }
}
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
// The Discover filters (genre, origin, the two toggles) live in the URL query so
// a choice survives refresh/back-forward; navigate() then drives the reload.
// Switching reads the prebuilt cache where possible; only "Refresh picks" forces
// a fresh rebuild. Every control rewrites the path's query from the full set.
function syncDiscoverFilters() {
  const params = new URLSearchParams();
  const g = $('#genre-filter').value; if (g) params.set('genre', g);
  const o = $('#origin-filter').value; if (o) params.set('origin', o);
  if ($('#exclude-us').checked) params.set('excludeUs', '1');
  if ($('#indie').checked) params.set('indie', '1');
  const qs = params.toString();
  navigate(qs ? `/discover?${qs}` : '/discover');
}
for (const id of ['#genre-filter', '#origin-filter', '#exclude-us', '#indie']) {
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
  for (const id of ['#genre-filter', '#origin-filter', '#exclude-us', '#indie', '#refresh']) {
    $(id).classList.toggle('hidden', !show);
  }
  // The toggles' labels wrap the checkboxes — hide the whole label, not just the box.
  for (const id of ['#exclude-us', '#indie']) $(id).closest('.toggle').classList.toggle('hidden', !show);
}

async function loadDiscover(force = false) {
  await Promise.all([loadGenres(), loadOrigins()]);
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

// A card in the onboarding queue resolved (rated or "haven't seen"): track the
// count, top the grid back up if it dipped below QUEUE_MIN, and once the goal is
// hit, swap in the picks.
function onboardResolve(el, kind) {
  el.remove();
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
  } catch { swapping = false; }
}

async function loadRecs(force = false) {
  const info = $('#discover-info'), grid = $('#recs');
  info.textContent = t('discover.building');
  grid.innerHTML = '';
  try {
    // Restore the filters from the URL (options exist now that loadGenres /
    // loadOrigins ran) so a refresh or back/forward repaints the same view.
    const h = parseRoute();
    $('#genre-filter').value = h.genre;
    $('#origin-filter').value = h.origin;
    $('#exclude-us').checked = h.excludeUs;
    $('#indie').checked = h.indie;
    const genre = $('#genre-filter').value;
    const params = new URLSearchParams();
    if (genre) params.set('genre', genre);
    if (h.origin) params.set('origin', h.origin);
    if (h.excludeUs) params.set('excludeUs', '1');
    if (h.indie) params.set('indie', '1');
    if (force) params.set('refresh', '1');
    const qs = params.toString();
    const [{ results, profileSize }] = await Promise.all([
      api('/api/recommend' + (qs ? `?${qs}` : '')),
      loadWatchlistIds(),
    ]);
    renderRecs(results, profileSize, genre);
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
  const picks = results.filter((m) => !watchlistIds.has(m.tmdb_id));
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
}
// Shown when the last Discover card leaves the grid — whether it was rated,
// dismissed, or saved to the watchlist. A function (not a const) so it reflects
// the language chosen at init, not the default at module load.
const picksEmptyMsg = () => t('discover.picksEmptyMore');
function recCard(m) {
  const el = document.createElement('div');
  el.className = 'card';
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
  wireRating(el, m, () => removeCard(el, picksEmptyMsg()));
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
function wireServiceLinks(el, m) {
  el.querySelectorAll('.svc-ico').forEach((a) => {
    a.onclick = async (ev) => {
      // A modifier/middle click opens the href (the service search page) in a new
      // tab — let the browser handle it; only a plain click upgrades to the exact
      // deep link in-tab (so a streaming app's Universal Link can take over).
      if (ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
      ev.preventDefault();
      ev.stopPropagation();
      try {
        const w = await api(`/api/where?id=${m.tmdb_id}&media_type=movie`);
        const url = matchServiceLink(w.deepLinks, { sid: Number(a.dataset.sid), sname: a.dataset.sname })
          || serviceSearchLink(a.dataset.sname, m.title, w.region);
        if (url) { location.href = url; return; }
      } catch { /* fall through to the modal */ }
      openWhere(m);
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
    const onMove = (ev) => {
      ev.preventDefault();
      preview(starAt(ev.touches[0])); // clears the preview when dragged off
    };
    starsBox.addEventListener('touchstart', onMove, { passive: false });
    starsBox.addEventListener('touchmove', onMove, { passive: false });
    starsBox.addEventListener('touchend', (ev) => {
      ev.stopPropagation();
      ev.preventDefault(); // suppress the synthetic click that follows
      // Commit only if the finger lifted on a star; lifting outside the stars
      // cancels the drag (no rating, the card stays) rather than rating.
      const n = starAt(ev.changedTouches[0]);
      if (n) commit(n);
      else preview(0);
    });
    starsBox.addEventListener('touchcancel', () => preview(0));
  }
}
// Wire the widget inside `el` for movie `m`; calls onResolve() after rate/dismiss.
function wireRating(el, m, onResolve) {
  wireStars(el, async (rating) => {
    await api('/api/ratings', { method: 'POST', body: JSON.stringify({
      tmdb_id: m.tmdb_id, media_type: 'movie', rating, title: m.title, year: m.year }) });
    onResolve();
  });
  el.querySelector('.dismiss-btn').onclick = async (ev) => {
    ev.stopPropagation();
    await api('/api/dismiss', { method: 'POST', body: JSON.stringify({ tmdb_id: m.tmdb_id, media_type: 'movie' }) });
    onResolve();
  };
}
// Remove a card; if its grid is now empty, show `emptyMsg`.
function removeCard(el, emptyMsg) {
  const grid = el.parentElement;
  el.remove();
  if (grid && !grid.children.length) grid.innerHTML = `<p class="empty">${esc(emptyMsg)}</p>`;
}

// ---- watchlist toggle (the + button on Discover cards) --------------------
// Refresh the cached set of watchlisted ids; tolerate failure (cards just keep
// their last-known + / ✓ state).
async function loadWatchlistIds() {
  try { watchlistIds = new Set((await api('/api/watchlist')).watchlist.map((w) => w.tmdb_id)); }
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
// then drops the card from Discover and pulses the Watchlist tab so it's clear
// where the title went.
function wireWatch(el, m) {
  const btn = el.querySelector('.watch-btn');
  if (!btn) return;
  btn.onclick = async (ev) => {
    ev.stopPropagation();
    btn.disabled = true;
    try {
      // Save the whole pick, not just title/year/poster: the card already holds
      // its services, ratings, genres, runtime and synopsis, so storing them now
      // lets the Watchlist card + popup render exactly like this one — for free,
      // spending no extra API quota. The server whitelists which fields persist.
      await api('/api/watchlist', { method: 'POST', body: JSON.stringify({ ...m, media_type: 'movie' }) });
      watchlistIds.add(m.tmdb_id);
      flashTab('watchlist');
      removeCard(el, picksEmptyMsg());
    } finally { btn.disabled = false; }
  };
}

// ---- where to watch modal -------------------------------------------------
// Poster + title/year/director/cast/overview header shared by both render passes.
function movieHeader(m) {
  const director = m.director ? `<p class="credit"><span class="lbl">${t('modal.director')}</span> ${esc(m.director)}</p>` : '';
  const cast = (m.cast && m.cast.length)
    ? `<p class="credit"><span class="lbl">${t('modal.cast')}</span> ${esc(m.cast.join(', '))}</p>` : '';
  return `<div class="detail-head">
      <img class="detail-poster" src="${poster(m.poster_path)}" />
      <div class="detail-info">
        <h2>${esc(m.title)} <span class="sub">${m.year || ''}${runtime(m.runtime) ? ` · ${runtime(m.runtime)}` : ''}</span></h2>
        ${ratingBadges(m)}
        ${director}${cast}
        <p class="sub">${esc(m.overview || '')}</p>
      </div>
    </div>`;
}
async function openWhere(m) {
  const modal = $('#modal'), body = $('#modal-body');
  modal.classList.remove('hidden');
  body.innerHTML = `${movieHeader(m)}<p>${t('modal.loadingAvailability')}</p>`;
  try {
    const w = await api(`/api/where?id=${m.tmdb_id}&media_type=movie`);
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
    body.innerHTML = `${movieHeader(m)}
      <div class="where">${links || `<p class="sub">${t('modal.notAvailable')}</p>`}</div>
      <p style="margin-top:18px"><button id="dismiss">${t('card.notInterested')}</button></p>`;
    $('#dismiss').onclick = async () => {
      await api('/api/dismiss', { method: 'POST', body: JSON.stringify({ tmdb_id: m.tmdb_id }) });
      modal.classList.add('hidden'); loadDiscover();
    };
  } catch (e) { body.innerHTML += `<p>⚠ ${e.message}</p>`; }
}
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
  wireStars(el, async (rating) => {
    await api('/api/ratings', { method: 'POST', body: JSON.stringify({
      tmdb_id: m.tmdb_id, media_type: 'movie', rating, title: m.title, year: m.year }) });
    onResolve(el, 'rated');
  });
  el.querySelector('.skip').onclick = async () => {
    await api('/api/not-seen', { method: 'POST', body: JSON.stringify({ tmdb_id: m.tmdb_id, media_type: 'movie' }) });
    onResolve(el, 'skipped');
  };
  return el;
}

// ---- watchlist tab --------------------------------------------------------
// Saved titles as poster cards: tap the poster for where-to-watch, "Remove" to
// take it off the list. Doubles as the refresh of the cached id set so the
// Discover + buttons stay accurate after edits here.
async function loadWatchlist() {
  const { watchlist } = await api('/api/watchlist');
  watchlistIds = new Set(watchlist.map((w) => w.tmdb_id));
  setWatchlistCount(watchlist.length);
  // An explicit ?sort=rating in the URL (refresh/back-forward/shared link) wins;
  // otherwise fall back to the order the user last chose, remembered server-side
  // on ME so a bare /watchlist (e.g. the nav tab) restores it.
  const sort = parseRoute().sort === 'rating' || ME?.watchlistSort === 'rating' ? 'rating' : 'added';
  $('#watchlist-sort').value = sort;
  const ordered = sortWatchlist(watchlist, sort);
  const grid = $('#watchlist-grid');
  grid.innerHTML = ordered.length ? '' : `<p class="empty">${t('watchlist.empty')}</p>`;
  for (const w of ordered) grid.append(watchCard(w));
}
// Changing the sort rewrites the path's query (navigate() reloads the tab) and
// persists the choice so it's remembered on the next visit.
$('#watchlist-sort').onchange = () => {
  const v = $('#watchlist-sort').value === 'rating' ? 'rating' : 'added';
  ME.watchlistSort = v;
  saveSetting('watchlistSort', v);
  navigate(v === 'rating' ? '/watchlist?sort=rating' : '/watchlist');
};
function setWatchlistCount(n) {
  $('#watchlist-count').textContent = t('watchlist.count', { n });
}
function watchCard(w) {
  const el = document.createElement('div');
  el.className = 'card';
  // Same card body as a Discover pick (the rich fields were captured when it was
  // saved), minus the score badge and rate widget; a Remove button stands in for
  // the rate row. Tapping the poster opens the same where-to-watch popup.
  el.innerHTML = `${posterAndMeta(w)}
    <button class="skip watch-remove">${t('watchlist.remove')}</button>`;
  el.querySelector('img').onclick = () => openWhere(w);
  wireServiceLinks(el, w); // deep-link each service icon, exactly like Discover
  el.querySelector('.watch-remove').onclick = async () => {
    await api('/api/watchlist', { method: 'DELETE', body: JSON.stringify({ tmdb_id: w.tmdb_id, media_type: w.media_type || 'movie' }) });
    watchlistIds.delete(w.tmdb_id);
    setWatchlistCount(watchlistIds.size);
    removeCard(el, t('watchlist.empty'));
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
  sel.onchange = async () => { await saveSetting('country', sel.value); loadProviders(sel.value, s.providers); };
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
