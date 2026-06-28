const IMG = 'https://image.tmdb.org/t/p';
const $ = (s, el = document) => el.querySelector(s);
const api = async (path, opts) => {
  const res = await fetch(path, opts);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.json();
};
const poster = (p) => (p ? `${IMG}/w342${p}` : 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg"/%3E');

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
// Each tab is a URL hash (#rate, #ratings…) so a refresh stays on the same tab
// instead of dropping back to Discover, and back/forward navigate between tabs.
const tabs = $('#tabs');
const TAB_NAMES = ['discover', 'rate', 'import', 'ratings', 'settings'];

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
  if (t === 'discover') loadRecs();
  if (t === 'rate') loadRateQueue(true);
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

async function loadRecs(force = false) {
  await loadGenres();
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
    const { results, profileSize } = await api('/api/recommend' + (qs ? `?${qs}` : ''));
    if (!results.length) {
      info.textContent = '';
      grid.innerHTML = genre
        ? '<p class="empty">No picks in this genre on your services. Try “All genres” or another genre.</p>'
        : '<p class="empty">No picks yet. Add your TMDB key + streaming services in Settings, then rate or import some films.</p>';
      return;
    }
    const inGenre = genre ? ` in ${$('#genre-filter').selectedOptions[0].textContent}` : '';
    info.textContent = `${results.length} picks${inGenre} from a taste profile of ${profileSize} rated films.`;
    grid.innerHTML = '';
    for (const m of results) grid.append(recCard(m));
  } catch (e) {
    info.textContent = '';
    grid.innerHTML = `<p class="empty">⚠ ${e.message}</p>`;
  }
}
function recCard(m) {
  const el = document.createElement('div');
  el.className = 'card';
  const hi = m.score >= 75 ? 'hi' : '';
  el.innerHTML = `
    <div class="score ${hi}">${m.score}</div>
    <img src="${poster(m.poster_path)}" loading="lazy" />
    <div class="meta">
      <div class="title">${esc(m.title)}</div>
      <div class="year">${m.year || ''} · ⭐ ${(m.vote_average || 0).toFixed(1)}</div>
      ${ratingBadges(m)}
      <div class="genres">${(m.genres || []).slice(0, 3).join(' · ')}</div>
    </div>
    ${ratingRow()}`;
  el.querySelector('img').onclick = () => openWhere(m);
  // Rating or dismissing removes the card; the API also excludes it from future picks.
  wireRating(el, m, () => removeCard(el, 'No more picks here — hit “Refresh picks” for more.'));
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
// Wire the widget inside `el` for movie `m`; calls onResolve() after rate/dismiss.
function wireRating(el, m, onResolve) {
  const stars = el.querySelectorAll('.stars span');
  const num = el.querySelector('.rating-num');
  stars.forEach((s) => {
    s.onmouseenter = () => {
      stars.forEach((x, i) => x.classList.toggle('on', i < s.dataset.n));
      if (num) num.textContent = `${s.dataset.n} / 10`;
    };
    s.onclick = async (ev) => {
      ev.stopPropagation();
      await api('/api/ratings', { method: 'POST', body: JSON.stringify({
        tmdb_id: m.tmdb_id, media_type: 'movie', rating: Number(s.dataset.n), title: m.title, year: m.year }) });
      onResolve();
    };
  });
  el.querySelector('.rate-stars')?.addEventListener('mouseleave', () => {
    stars.forEach((x) => x.classList.remove('on'));
    if (num) num.textContent = '';
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

// ---- where to watch modal -------------------------------------------------
// Poster + title/year/director/cast/overview header shared by both render passes.
function movieHeader(m) {
  const director = m.director ? `<p class="credit"><span class="lbl">Director</span> ${esc(m.director)}</p>` : '';
  const cast = (m.cast && m.cast.length)
    ? `<p class="credit"><span class="lbl">Cast</span> ${esc(m.cast.join(', '))}</p>` : '';
  return `<div class="detail-head">
      <img class="detail-poster" src="${poster(m.poster_path)}" />
      <div class="detail-info">
        <h2>${esc(m.title)} <span class="sub">${m.year || ''}</span></h2>
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
    const links = (w.deepLinks && w.deepLinks.length)
      ? w.deepLinks.map((o) => `<a href="${o.link}" target="_blank">▶ ${esc(o.service)} <span class="sub">${o.type}</span></a>`).join('')
      : (w.flatrate || []).map((f) => `<a href="${w.tmdbLink || '#'}" target="_blank"><img src="${IMG}/w92${f.logo}"/> ${esc(f.name)}</a>`).join('');
    body.innerHTML = `${movieHeader(m)}
      <div class="where">${links || '<p class="sub">Not on your subscription services in this country right now.</p>'}</div>
      <p style="margin-top:18px"><button id="dismiss">Not interested / seen it</button></p>`;
    $('#dismiss').onclick = async () => {
      await api('/api/dismiss', { method: 'POST', body: JSON.stringify({ tmdb_id: m.tmdb_id }) });
      modal.classList.add('hidden'); loadRecs();
    };
  } catch (e) { body.innerHTML += `<p>⚠ ${e.message}</p>`; }
}
$('#modal').onclick = (e) => { if (e.target.id === 'modal') e.currentTarget.classList.add('hidden'); };

// ---- rate -----------------------------------------------------------------
let ratePage = 0, gone = 0;
async function loadRateQueue(reset) {
  if (reset) { ratePage = 0; gone = 0; $('#rate-grid').innerHTML = ''; }
  // Pages fully covered by rated/"haven't seen" titles come back empty, so keep
  // advancing until we get cards (cap the walk so we never spin forever).
  let added = 0;
  for (let tries = 0; tries < 10 && !added; tries++) {
    ratePage++;
    const { items } = await api(`/api/rate-queue?page=${ratePage}`);
    for (const m of items) $('#rate-grid').append(rateCard(m));
    added = items.length;
  }
  if (!added && reset) {
    $('#rate-grid').innerHTML = '<p class="empty">You’ve rated or skipped all the popular titles. Check back later for new releases.</p>';
  }
}
// A card leaves the queue when rated or marked unseen. Every 5 that go, pull a
// fresh batch of new titles so the grid keeps refilling.
function cardGone(el) {
  el.remove();
  if (++gone % 5 === 0) loadRateQueue(false);
}
function rateCard(m) {
  const el = document.createElement('div');
  el.className = 'card';
  el.innerHTML = `
    <img src="${poster(m.poster_path)}" loading="lazy" />
    <div class="meta"><div class="title">${esc(m.title)}</div><div class="year">${m.year || ''}</div></div>
    ${starsMarkup()}
    <button class="skip">Haven't seen</button>`;
  el.querySelector('img').onclick = () => openWhere(m); // poster → where-to-watch modal
  const stars = el.querySelectorAll('.stars span');
  const num = el.querySelector('.rating-num');
  stars.forEach((s) => {
    s.onmouseenter = () => {
      stars.forEach((x, i) => x.classList.toggle('on', i < s.dataset.n));
      if (num) num.textContent = `${s.dataset.n} / 10`;
    };
    s.onclick = async () => {
      await api('/api/ratings', { method: 'POST', body: JSON.stringify({
        tmdb_id: m.tmdb_id, media_type: 'movie', rating: Number(s.dataset.n), title: m.title, year: m.year }) });
      cardGone(el);
    };
  });
  el.querySelector('.rate-stars').onmouseleave = () => {
    stars.forEach((x) => x.classList.remove('on'));
    if (num) num.textContent = '';
  };
  el.querySelector('.skip').onclick = async () => {
    await api('/api/not-seen', { method: 'POST', body: JSON.stringify({ tmdb_id: m.tmdb_id, media_type: 'movie' }) });
    cardGone(el);
  };
  return el;
}
$('#more-rate').onclick = () => loadRateQueue(false);

// ---- import ---------------------------------------------------------------
$('#do-import').onclick = async () => {
  const file = $('#csv-file').files[0];
  const log = $('#import-log');
  if (!file) { log.textContent = 'Choose a CSV file first.'; return; }
  log.textContent = 'Importing… (matching each title to TMDB, this can take a minute)';
  try {
    const text = await file.text();
    const r = await api('/api/import', { method: 'POST', body: text });
    const misses = r.results.filter((x) => !x.ok).map((x) => x.name).slice(0, 20);
    log.textContent = `Imported ${r.imported}/${r.total} (skipped ${r.skipped}).`
      + (misses.length ? `\n\nUnmatched: ${misses.join(', ')}${r.skipped > 20 ? '…' : ''}` : '');
  } catch (e) { log.textContent = '⚠ ' + e.message; }
};

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
  // Admin-only blocks (API keys, user management) appear only for admins.
  document.querySelectorAll('.admin-only').forEach((el) => el.classList.toggle('hidden', !s.isAdmin));
  const sel = $('#country');
  sel.innerHTML = COUNTRIES.map(([c, n]) => `<option value="${c}" ${c === s.country ? 'selected' : ''}>${n}</option>`).join('');
  $('#key-status').textContent =
    `TMDB: ${s.tmdbConfigured ? '✓ set' : '✗ not set'} · Movie of the Night: ${s.motnConfigured ? '✓ set' : '— optional'}`
    + ` · Trakt: ${s.traktConfigured ? '✓ set' : '— optional'}`;
  sel.onchange = async () => { await saveSetting('country', sel.value); loadProviders(sel.value, s.providers); };
  await loadProviders(s.country, s.providers);
  if (s.isAdmin) loadUsers();
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
$('#save-keys').onclick = async () => {
  const body = {};
  if ($('#tmdbKey').value) body.tmdbKey = $('#tmdbKey').value.trim();
  if ($('#rapidApiKey').value) body.rapidApiKey = $('#rapidApiKey').value.trim();
  if ($('#traktKey').value) body.traktKey = $('#traktKey').value.trim();
  await api('/api/settings', { method: 'POST', body: JSON.stringify(body) });
  $('#tmdbKey').value = ''; $('#rapidApiKey').value = ''; $('#traktKey').value = '';
  loadSettings();
};
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

// ---- admin: user management -----------------------------------------------
async function loadUsers() {
  try {
    const { users } = await api('/api/admin/users');
    const box = $('#users-list');
    box.innerHTML = '';
    for (const u of users) {
      const row = document.createElement('div');
      row.className = 'urow';
      row.innerHTML = `<span>${esc(u.name || u.email)} <span class="sub">${esc(u.email || '')}${u.provider ? ' · ' + esc(u.provider) : ''}</span></span>
        <label class="adm"><input type="checkbox" ${u.is_admin ? 'checked' : ''}/> admin</label>`;
      row.querySelector('input').onchange = (e) =>
        api('/api/admin/users', { method: 'POST', body: JSON.stringify({ userId: u.id, is_admin: e.target.checked }) });
      box.append(row);
    }
  } catch (e) { $('#users-list').innerHTML = `<p class="sub">⚠ ${e.message}</p>`; }
}

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
