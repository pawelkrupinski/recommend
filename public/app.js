const IMG = 'https://image.tmdb.org/t/p';
const $ = (s, el = document) => el.querySelector(s);
const api = async (path, opts) => {
  const res = await fetch(path, opts);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.json();
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

// ---- tabs -----------------------------------------------------------------
// Each tab is a URL hash (#ratings, #settings…) so a refresh stays on the same
// tab instead of dropping back to Discover, and back/forward navigate between tabs.
const tabs = $('#tabs');
const TAB_NAMES = ['discover', 'watchlist', 'ratings', 'settings'];

// The hash carries the tab plus any tab-specific state as a query string,
// e.g. "#discover?genre=28". Parse it into { tab, genre } so a refresh or
// back/forward restores both the tab and the chosen genre.
function parseHash() {
  const [tab, query] = location.hash.slice(1).split('?');
  const params = new URLSearchParams(query || '');
  return { tab: tab || 'discover', genre: params.get('genre') || '' };
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

// Clicks just set the hash; hashchange does the actual switching.
tabs.addEventListener('click', (e) => {
  const t = e.target.dataset.tab;
  if (t) location.hash = t;
});
window.addEventListener('hashchange', () => activateTab(parseHash().tab));

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
// Genre switches read the prebuilt cache (instant); only "Refresh picks" forces
// a fresh rebuild of the current genre. The choice goes into the URL hash so it
// survives refresh/back-forward; hashchange then drives the reload.
$('#genre-filter').onchange = () => {
  const g = $('#genre-filter').value;
  location.hash = g ? `discover?genre=${g}` : 'discover';
};

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

// The genre filter and Refresh button only make sense for the picks grid; hide
// them during the onboarding rate queue.
function showRecsControls(show) {
  $('#genre-filter').classList.toggle('hidden', !show);
  $('#refresh').classList.toggle('hidden', !show);
}

async function loadDiscover(force = false) {
  await loadGenres();
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
    ? `Rate films you've seen so we can learn your taste — ${left} more to go.`
    : 'Building your personalized picks…';
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
  if (!added && reset) $('#discover-info').textContent =
    "You've rated everything we had to show — switching to your personalized picks.";
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
  info.textContent = 'Building your picks…';
  grid.innerHTML = '';
  try {
    // Restore the genre from the URL (options exist now that loadGenres ran).
    $('#genre-filter').value = parseHash().genre;
    const genre = $('#genre-filter').value;
    const params = new URLSearchParams();
    if (genre) params.set('genre', genre);
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
    grid.innerHTML = genre
      ? '<p class="empty">No picks in this genre on your services. Try “All genres” or another genre.</p>'
      : '<p class="empty">No picks yet. Add your TMDB key + streaming services in Settings, then rate some films.</p>';
    return;
  }
  const inGenre = genre ? ` in ${$('#genre-filter').selectedOptions[0].textContent}` : '';
  info.textContent = `${picks.length} picks${inGenre} from a taste profile of ${profileSize} rated films.`;
  grid.innerHTML = '';
  for (const m of picks) grid.append(recCard(m));
}
// Shown when the last Discover card leaves the grid — whether it was rated,
// dismissed, or saved to the watchlist.
const PICKS_EMPTY = 'No more picks here — hit “Refresh picks” for more.';
function recCard(m) {
  const el = document.createElement('div');
  el.className = 'card';
  const hi = m.score >= 75 ? 'hi' : '';
  el.innerHTML = `
    <div class="score ${hi}">${m.score}</div>
    ${watchBtnMarkup()}
    <img src="${poster(m.poster_path)}" loading="lazy" />
    <div class="meta">
      <div class="title">${esc(m.title)}</div>
      <div class="year">${m.year || ''} · ⭐ ${(m.vote_average || 0).toFixed(1)}${runtime(m.runtime) ? ` · ${runtime(m.runtime)}` : ''}</div>
      ${ratingBadges(m)}
      <div class="genres">${(m.genres || []).slice(0, 3).join(' · ')}</div>
    </div>
    ${ratingRow()}`;
  el.querySelector('img').onclick = () => openWhere(m);
  wireWatch(el, m);
  // Rating or dismissing removes the card; the API also excludes it from future picks.
  wireRating(el, m, () => removeCard(el, PICKS_EMPTY));
  return el;
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
    <button class="skip dismiss-btn">Not interested / seen it</button>`;
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
  const btn = document.querySelector(`#tabs button[data-tab="${tab}"]`);
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
      await api('/api/watchlist', { method: 'POST', body: JSON.stringify({
        tmdb_id: m.tmdb_id, media_type: 'movie', title: m.title, year: m.year, poster_path: m.poster_path }) });
      watchlistIds.add(m.tmdb_id);
      flashTab('watchlist');
      removeCard(el, PICKS_EMPTY);
    } finally { btn.disabled = false; }
  };
}

// ---- where to watch modal -------------------------------------------------
// Poster + title/year/director/cast/overview header shared by both render passes.
function movieHeader(m) {
  const director = m.director ? `<p class="credit"><span class="lbl">Director</span> ${esc(m.director)}</p>` : '';
  const cast = (m.cast && m.cast.length)
    ? `<p class="credit"><span class="lbl">Cast</span> ${esc(m.cast.join(', '))}</p>` : '';
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
  body.innerHTML = `${movieHeader(m)}<p>Loading availability…</p>`;
  try {
    const w = await api(`/api/where?id=${m.tmdb_id}&media_type=movie`);
    // On touch devices, navigate in the SAME tab: streaming-service URLs are
    // registered as iOS Universal Links / Android App Links and open the native
    // app — but only on a direct same-tab tap. target="_blank"/window.open
    // breaks that handoff and lands the user in the mobile browser instead.
    // On desktop keep _blank so the recommend tab stays open.
    const appTab = matchMedia('(pointer: coarse)').matches ? '' : ' target="_blank" rel="noopener"';
    const links = (w.deepLinks && w.deepLinks.length)
      ? w.deepLinks.map((o) => `<a href="${o.link}"${appTab}>▶ ${esc(o.service)} <span class="sub">${o.type}</span></a>`).join('')
      : (w.flatrate || []).map((f) => `<a href="${w.tmdbLink || '#'}" target="_blank"><img src="${IMG}/w92${f.logo}"/> ${esc(f.name)}</a>`).join('');
    body.innerHTML = `${movieHeader(m)}
      <div class="where">${links || '<p class="sub">Not on your subscription services in this country right now.</p>'}</div>
      <p style="margin-top:18px"><button id="dismiss">Not interested / seen it</button></p>`;
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
    <button class="skip">Haven't seen</button>`;
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
  const grid = $('#watchlist-grid');
  grid.innerHTML = watchlist.length ? '' : `<p class="empty">${WATCHLIST_EMPTY}</p>`;
  for (const w of watchlist) grid.append(watchCard(w));
}
const WATCHLIST_EMPTY = 'Your watchlist is empty. Hit + on a Discover pick to save it for later.';
function setWatchlistCount(n) {
  $('#watchlist-count').textContent = `${n} saved ${n === 1 ? 'title' : 'titles'}`;
}
function watchCard(w) {
  const m = { tmdb_id: w.tmdb_id, title: w.title, year: w.year, poster_path: w.poster_path };
  const el = document.createElement('div');
  el.className = 'card';
  el.innerHTML = `
    <img src="${poster(m.poster_path)}" loading="lazy" />
    <div class="meta">
      <div class="title">${esc(m.title || m.tmdb_id)}</div>
      <div class="year">${m.year || ''}</div>
    </div>
    <button class="skip watch-remove">Remove from watchlist</button>`;
  el.querySelector('img').onclick = () => openWhere(m);
  el.querySelector('.watch-remove').onclick = async () => {
    await api('/api/watchlist', { method: 'DELETE', body: JSON.stringify({ tmdb_id: m.tmdb_id, media_type: w.media_type || 'movie' }) });
    watchlistIds.delete(m.tmdb_id);
    setWatchlistCount(watchlistIds.size);
    removeCard(el, WATCHLIST_EMPTY);
  };
  return el;
}

// ---- my ratings -----------------------------------------------------------
async function loadRatings() {
  const { ratings } = await api('/api/ratings');
  $('#ratings-count').textContent = `${ratings.length} rated titles`;
  const list = $('#ratings-list');
  list.innerHTML = ratings.length ? '' : '<p class="empty">No ratings yet.</p>';
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
async function loadSettings() {
  const s = await api('/api/settings');
  const sel = $('#country');
  sel.innerHTML = COUNTRIES.map(([c, n]) => `<option value="${c}" ${c === s.country ? 'selected' : ''}>${n}</option>`).join('');
  sel.onchange = async () => { await saveSetting('country', sel.value); loadProviders(sel.value, s.providers); };
  await loadProviders(s.country, s.providers);
}
async function loadProviders(region, selected = [], box = $('#provider-list')) {
  box.parentElement.querySelectorAll('.src-note').forEach((n) => n.remove());
  box.innerHTML = '<p class="sub">Loading services…</p>';
  try {
    const { providers, source } = await api(`/api/providers?region=${region}`);
    const chosen = new Set((selected || []).map(Number));
    box.innerHTML = '';
    for (const p of providers) {
      const el = document.createElement('div');
      const unmatched = p.id == null; // MotN service with no TMDB id can't drive Discover
      el.className = 'prov' + (chosen.has(p.id) ? ' on' : '') + (unmatched ? ' disabled' : '');
      const logo = p.logo ? `<img src="${IMG}/w45${p.logo}"/>` : '<span class="nologo">🎞️</span>';
      el.innerHTML = `${logo} ${esc(p.name)}`;
      if (unmatched) el.title = 'No TMDB match — can’t filter recommendations by this service';
      else { el.onclick = () => el.classList.toggle('on'); el.dataset.id = p.id; }
      box.append(el);
    }
    const note = source === 'movieofthenight'
      ? 'Service list from Movie of the Night (1 cached request).'
      : 'Service list from TMDB.';
    box.insertAdjacentHTML('beforebegin', `<p class="sub src-note">${note}</p>`);
  } catch (e) { box.innerHTML = `<p class="sub">⚠ ${e.message} — set your TMDB key first.</p>`; }
}
$('#save-providers').onclick = async () => {
  const ids = [...$('#provider-list').querySelectorAll('.prov.on')].map((e) => Number(e.dataset.id));
  await saveSetting('providers', ids);
  $('#save-providers').textContent = '✓ Saved';
  setTimeout(() => ($('#save-providers').textContent = 'Save services'), 1500);
};
const saveSetting = (k, v) => api('/api/settings', { method: 'POST', body: JSON.stringify({ [k]: v }) });

// Permanently delete the signed-in account and all its data, then reload to the
// login gate (the server clears the session cookie in its response).
$('#delete-account').onclick = async () => {
  if (!confirm('Delete your account and all your ratings and preferences? This cannot be undone.')) return;
  const btn = $('#delete-account');
  btn.disabled = true; btn.textContent = 'Deleting…';
  try {
    await api('/api/me', { method: 'DELETE' });
    location.href = '/';
  } catch (e) {
    btn.disabled = false; btn.textContent = 'Delete account';
    alert('Could not delete account: ' + e.message);
  }
};

function esc(s) { return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// ---- auth / bootstrap -----------------------------------------------------
let ME = null;
const PROVIDER_LABELS = { google: 'Sign in with Google', facebook: 'Sign in with Facebook' };
function renderLogin(providers) {
  $('#login-buttons').innerHTML = providers.length
    ? providers.map((p) => `<a class="btn-oauth ${p}" href="/auth/${p}">${PROVIDER_LABELS[p] || ('Sign in with ' + p)}</a>`).join('')
    : '<p class="sub">No login providers are configured on the server yet.</p>';
  const err = new URLSearchParams(location.search).get('error');
  if (err) $('#login-error').textContent = '⚠ ' + err;
}
function renderUserbar(user) {
  const avatar = user.picture ? `<img src="${user.picture}" alt="" referrerpolicy="no-referrer" />` : '';
  $('#userbar').innerHTML =
    `${avatar}<span class="uname">${esc(user.name || user.email)}</span>`
    + `<a class="logout" href="/auth/logout">Sign out</a>`;
}
// ---- first-run onboarding -------------------------------------------------
// Brand-new accounts (onboarded=false) must pick their streaming services before
// reaching the app. Reuses the Settings provider picker against its own list.
async function startOnboarding() {
  const ob = $('#onboarding');
  ob.classList.remove('hidden');
  const sel = $('#ob-country');
  sel.innerHTML = COUNTRIES.map(([c, n]) => `<option value="${c}" ${c === 'PL' ? 'selected' : ''}>${n}</option>`).join('');
  // Services differ per country, so a country switch reloads with a clean slate.
  sel.onchange = () => loadProviders(sel.value, [], $('#ob-provider-list'));
  await loadProviders(sel.value, [], $('#ob-provider-list'));
  $('#ob-continue').onclick = async () => {
    const btn = $('#ob-continue');
    const ids = [...$('#ob-provider-list').querySelectorAll('.prov.on')].map((e) => Number(e.dataset.id));
    btn.disabled = true;
    try {
      await api('/api/settings', { method: 'POST', body: JSON.stringify({
        country: sel.value, providers: ids, onboarded: true }) });
    } catch (e) { btn.disabled = false; alert('⚠ ' + e.message); return; }
    ob.classList.add('hidden');
    enterApp();
  };
}

function enterApp() {
  $('#app').classList.remove('hidden');
  renderUserbar(ME.user);
  activateTab(parseHash().tab); // open whatever tab the URL points at (default Discover)
}

async function init() {
  try { ME = await api('/api/me'); } catch { ME = { user: null, providers: [] }; }
  if (!ME.user) {
    $('#login').classList.remove('hidden');
    renderLogin(ME.providers || []);
    return;
  }
  // Drop any ?error= left over from a failed prior attempt, keep the tab hash.
  if (location.search) history.replaceState(null, '', location.pathname + location.hash);
  if (!ME.onboarded) return startOnboarding();
  enterApp();
}
init();
