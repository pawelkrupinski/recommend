// SQLite persistence using Node's built-in driver (no native deps).
import './env.js'; // load secrets / DB_PATH before we read them
import { config, isAdminEmail } from './env.js';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createKvCache } from './kv-cache.js';

// DB_PATH lets the host point us at a persistent disk (e.g. Render); default to
// the in-repo data dir for local dev.
const DB_PATH = process.env.DB_PATH || new URL('../data/recommend.db', import.meta.url).pathname;
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);

// WAL mode is required for Litestream's continuous replication (prod durability
// on hosts without a persistent disk) and improves read/write concurrency.
// busy_timeout avoids spurious SQLITE_BUSY errors under light contention.
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA busy_timeout = 5000');

// Performance tuning — all safe under WAL on this Litestream-replicated,
// regenerable DB (a crash can at worst lose the last few committed txns, which
// the replica restores).
//   synchronous = NORMAL — fsync only at WAL checkpoints, not on every commit;
//     the binding write cost on the slow shared-CPU Fly disk.
//   cache_size  = -64000 — 64 MB page cache (negative value = KiB) so hot
//     pages/indices stay in memory instead of re-reading from disk.
//   mmap_size   = 30000000 — ~30 MB memory-mapped reads, skipping read()
//     syscalls for the hot region.
db.exec('PRAGMA synchronous = NORMAL');
db.exec('PRAGMA cache_size = -64000');
db.exec('PRAGMA mmap_size = 30000000');

// ---- schema ---------------------------------------------------------------
// Per-user tables carry user_id in their primary key. Fresh installs get these
// straight away; existing single-user DBs are upgraded by migrate() below.
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    email        TEXT UNIQUE,
    name         TEXT,
    picture      TEXT,
    provider     TEXT,
    -- The login provider's stable user id (Google "sub" / Facebook user_id).
    -- Needed to honour Facebook's data-deletion callback, which identifies the
    -- user only by this id (never by email).
    provider_sub TEXT,
    is_admin     INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT DEFAULT (datetime('now'))
  );

  -- Global, admin-managed settings (API keys live here).
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  -- Per-user settings (country, providers, recGen…).
  CREATE TABLE IF NOT EXISTS user_settings (
    user_id INTEGER NOT NULL,
    key     TEXT NOT NULL,
    value   TEXT,
    PRIMARY KEY (user_id, key)
  );

  CREATE TABLE IF NOT EXISTS ratings (
    user_id    INTEGER NOT NULL,
    tmdb_id    INTEGER NOT NULL,
    media_type TEXT    NOT NULL DEFAULT 'movie',
    rating     REAL    NOT NULL,
    title      TEXT,
    year       INTEGER,
    source     TEXT,
    rated_at   TEXT    DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, tmdb_id, media_type)
  );

  CREATE TABLE IF NOT EXISTS dismissed (
    user_id    INTEGER NOT NULL,
    tmdb_id    INTEGER NOT NULL,
    media_type TEXT    NOT NULL DEFAULT 'movie',
    PRIMARY KEY (user_id, tmdb_id, media_type)
  );

  CREATE TABLE IF NOT EXISTS not_seen (
    user_id    INTEGER NOT NULL,
    tmdb_id    INTEGER NOT NULL,
    media_type TEXT    NOT NULL DEFAULT 'movie',
    PRIMARY KEY (user_id, tmdb_id, media_type)
  );

  -- Titles the user saved to watch later. Carries enough to render a card
  -- (title/year/poster) without a TMDB round-trip per item, plus a "card" JSON
  -- blob of the richer Discover-card fields (services, ratings, genres, runtime,
  -- synopsis, credits) so a saved title's card and detail popup look exactly like
  -- a Discover pick. Captured from the Discover card at save time; null for rows
  -- saved before that, which backfillWatchlistCards() enriches in the background.
  CREATE TABLE IF NOT EXISTS watchlist (
    user_id     INTEGER NOT NULL,
    tmdb_id     INTEGER NOT NULL,
    media_type  TEXT    NOT NULL DEFAULT 'movie',
    title       TEXT,
    year        INTEGER,
    poster_path TEXT,
    card        TEXT,
    added_at    TEXT    DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, tmdb_id, media_type)
  );

  -- Generic response cache so we stay inside TMDB / RapidAPI rate limits.
  CREATE TABLE IF NOT EXISTS cache (
    key        TEXT PRIMARY KEY,
    value      TEXT,
    fetched_at INTEGER
  );

  -- Per-title tone tags ("heartfelt", "deadpan"…), one row per (title, source,
  -- slug). A film's mood vocabulary accumulates across feeders (IMDb keywords,
  -- Letterboxd nanogenres, the local model) with provenance: each source owns its
  -- rows, so one can be re-derived or audited without disturbing the others, and a
  -- title's tones are the union across sources. Global (a tone is a property of the
  -- title, not the user). TMDB-keyword tones aren't stored here — they're derived
  -- live from the cached /movie detail. See tone-store.js / tone-sources.js.
  CREATE TABLE IF NOT EXISTS movie_tones (
    tmdb_id    INTEGER NOT NULL,
    media_type TEXT    NOT NULL DEFAULT 'movie',
    source     TEXT    NOT NULL,
    slug       TEXT    NOT NULL,
    updated_at INTEGER,
    PRIMARY KEY (tmdb_id, media_type, source, slug)
  );
`);

// ---- indices --------------------------------------------------------------
// Cover the hot "most-recent-first per user" reads and the cache eviction sweep
// so the planner walks an index in order instead of full-scanning + building a
// TEMP B-TREE to sort (event-loop time on the shared CPU). Column ORDER matches
// each query's ORDER BY direction exactly so the index is actually chosen:
//   - watchlist / ratings: ORDER BY <ts> DESC after a user_id filter.
//   - cache eviction (kv-cache.js): ORDER BY fetched_at DESC, key — so the
//     index is (fetched_at DESC, key) and the sweep scans it as a covering
//     index with no temp b-tree.
// movie_tones needs no extra index: its primary key already prefixes every
// lookup (tmdb_id, media_type[, source]), so those SEARCH via the autoindex.
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_watchlist_user_added ON watchlist(user_id, added_at DESC);
  CREATE INDEX IF NOT EXISTS idx_ratings_user_rated   ON ratings(user_id, rated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_cache_fetched_key    ON cache(fetched_at DESC, key);
`);
// Give the planner row-count stats so it picks the new indices. Once at load.
db.exec('ANALYZE');

// ---- migration: single-user → multi-user ----------------------------------
// A v1 DB has ratings/dismissed/not_seen WITHOUT a user_id column (the CREATE IF
// NOT EXISTS above was a no-op for them). Rebuild each, backfilling every row to
// the seeded admin account, and move the old global country/providers settings
// into that admin's per-user settings.
function tableColumns(table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name);
}
function legacy(table) {
  const cols = tableColumns(table);
  return cols.length && !cols.includes('user_id');
}

function migrate() {
  if (!(legacy('ratings') || legacy('dismissed') || legacy('not_seen'))) return;

  // Seed the admin user the legacy data will be attributed to.
  const email = config.adminAllowlist[0] || 'admin@local';
  db.prepare(
    'INSERT OR IGNORE INTO users (email, name, provider, is_admin) VALUES (?, ?, ?, 1)'
  ).run(email, 'Admin', 'seed');
  const adminId = db.prepare('SELECT id FROM users WHERE email = ?').get(email).id;

  const rebuild = (table, cols) => {
    if (!legacy(table)) return;
    db.exec(`ALTER TABLE ${table} RENAME TO ${table}_legacy`);
    db.exec(`
      CREATE TABLE ${table} (
        user_id INTEGER NOT NULL,
        ${cols}
      )`);
    const list = tableColumns(`${table}_legacy`).join(', ');
    db.prepare(`INSERT INTO ${table} (user_id, ${list}) SELECT ?, ${list} FROM ${table}_legacy`).run(adminId);
    db.exec(`DROP TABLE ${table}_legacy`);
  };

  rebuild('ratings', `
    tmdb_id INTEGER NOT NULL, media_type TEXT NOT NULL DEFAULT 'movie', rating REAL NOT NULL,
    title TEXT, year INTEGER, source TEXT, rated_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, tmdb_id, media_type)`);
  rebuild('dismissed', `
    tmdb_id INTEGER NOT NULL, media_type TEXT NOT NULL DEFAULT 'movie',
    PRIMARY KEY (user_id, tmdb_id, media_type)`);
  rebuild('not_seen', `
    tmdb_id INTEGER NOT NULL, media_type TEXT NOT NULL DEFAULT 'movie',
    PRIMARY KEY (user_id, tmdb_id, media_type)`);

  // Move the old per-user-ish settings to the admin; keep API keys global.
  for (const key of ['country', 'providers', 'recGen']) {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    if (row) {
      db.prepare(
        'INSERT OR REPLACE INTO user_settings (user_id, key, value) VALUES (?, ?, ?)'
      ).run(adminId, key, row.value);
      db.prepare('DELETE FROM settings WHERE key = ?').run(key);
    }
  }
}
migrate();

// ---- migration: add users.provider_sub to pre-existing DBs ------------------
// Older databases created the users table without this column. Add it once so
// the Facebook data-deletion callback can match accounts by provider user id.
function addProviderSubColumn() {
  if (tableColumns('users').includes('provider_sub')) return;
  db.exec('ALTER TABLE users ADD COLUMN provider_sub TEXT');
}
addProviderSubColumn();

// ---- migration: add watchlist.card to pre-existing DBs ----------------------
// Older databases stored only title/year/poster per saved title. Add the JSON
// `card` column once; existing rows stay null until backfillWatchlistCards()
// enriches them so their cards match Discover picks.
function addWatchlistCardColumn() {
  if (tableColumns('watchlist').includes('card')) return;
  db.exec('ALTER TABLE watchlist ADD COLUMN card TEXT');
}
addWatchlistCardColumn();

// NOTE: purging the legacy `tmdb:` rows from this cache (they now live in the
// separate ephemeral cache, tmdb-cache.js) is deliberately NOT done on the boot
// path. Deleting ~24k large rows + VACUUM on the slow prod disk takes minutes
// and runs *before* the server listens, which stalled boot into a health-check
// loop. The one-time cleanup is an out-of-band maintenance op (scripts/) run
// against the live, already-listening app instead.

// ---- backfill: grandfather existing users past first-run onboarding --------
// The streaming-services picker only gates genuinely new accounts. Mark every
// user that exists at upgrade time as onboarded so they aren't sent back through
// it. Guarded by a settings flag so it runs exactly once.
function backfillOnboarded() {
  const FLAG = '_onboarded_backfill_v1';
  if (db.prepare('SELECT 1 FROM settings WHERE key = ?').get(FLAG)) return;
  const ins = db.prepare(
    `INSERT INTO user_settings (user_id, key, value) VALUES (?, 'onboarded', 'true')
     ON CONFLICT(user_id, key) DO NOTHING`
  );
  for (const u of db.prepare('SELECT id FROM users').all()) ins.run(u.id);
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(FLAG, 'true');
}
backfillOnboarded();

// ---- users ----------------------------------------------------------------
export function getUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).toLowerCase());
}
export function getUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}
// Look up a user by their login provider's stable id. Used by the Facebook
// data-deletion callback, which only ever sends us the provider user id.
export function getUserByProviderSub(provider, sub) {
  if (!sub) return undefined;
  return db.prepare('SELECT * FROM users WHERE provider = ? AND provider_sub = ?')
    .get(provider, String(sub));
}
export function listUsers() {
  return db.prepare('SELECT id, email, name, picture, provider, is_admin, created_at FROM users ORDER BY created_at').all();
}
export function countUsers() {
  return db.prepare('SELECT COUNT(*) c FROM users').get().c;
}
// Create or update a user from an OAuth login. Allowlisted emails are always
// admins; otherwise a new user defaults to non-admin and existing admin toggles
// are preserved.
export function upsertUserFromLogin({ email, name, picture, provider, provider_sub }) {
  email = String(email).toLowerCase();
  const sub = provider_sub != null ? String(provider_sub) : null;
  const existing = getUserByEmail(email);
  if (existing) {
    db.prepare('UPDATE users SET name = ?, picture = ?, provider = ?, provider_sub = ?, is_admin = ? WHERE id = ?')
      .run(name ?? existing.name, picture ?? existing.picture, provider ?? existing.provider,
        sub ?? existing.provider_sub, isAdminEmail(email) ? 1 : existing.is_admin, existing.id);
    return getUserById(existing.id);
  }
  db.prepare('INSERT INTO users (email, name, picture, provider, provider_sub, is_admin) VALUES (?, ?, ?, ?, ?, ?)')
    .run(email, name ?? null, picture ?? null, provider ?? null, sub, isAdminEmail(email) ? 1 : 0);
  return getUserByEmail(email);
}
export function setUserAdmin(userId, isAdmin) {
  db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(isAdmin ? 1 : 0, userId);
}
// Create a fresh anonymous account — no email, no login, identified only by the
// session cookie. Lets a visitor use the app (rate, save, get picks) without
// signing in; if they later log in, mergeUserData() folds this account's data
// into the real one. email is UNIQUE but NULLs don't collide in SQLite, so any
// number of anon users coexist.
export function createAnonUser() {
  const info = db.prepare("INSERT INTO users (provider) VALUES ('anon')").run();
  return getUserById(info.lastInsertRowid);
}
// Does this user have content of their own (ratings or saved watchlist titles)?
// Sign-in uses this to decide whether an account is established enough that its
// data should win outright over an anonymous session's — settings alone (an
// onboarded-but-never-rated account) don't count as content.
export function hasUserContent(userId) {
  const row = db.prepare(
    `SELECT EXISTS(
       SELECT 1 FROM ratings   WHERE user_id = ?
       UNION ALL
       SELECT 1 FROM watchlist WHERE user_id = ?
     ) AS has`
  ).get(userId, userId);
  return !!row.has;
}
// Fold every per-user row of `fromId` into `toId` without overwriting anything
// `toId` already holds (INSERT OR IGNORE) — so when an empty account adopts an
// anonymous session it gets all of it, and any setting the account already set
// still wins. Returns the number of rows brought across so the caller can decide
// whether to rebuild recommendations.
export function mergeUserData(fromId, toId) {
  let moved = 0;
  for (const table of ['ratings', 'dismissed', 'not_seen', 'watchlist', 'user_settings']) {
    const cols = tableColumns(table);
    const select = cols.map((c) => (c === 'user_id' ? '?' : c)).join(', ');
    const info = db.prepare(
      `INSERT OR IGNORE INTO ${table} (${cols.join(', ')}) SELECT ${select} FROM ${table} WHERE user_id = ?`
    ).run(toId, fromId);
    moved += info.changes;
  }
  return moved;
}
// Permanently delete a user and every per-user row we hold for them. Used by
// both the in-app "delete account" action and the Facebook data-deletion
// callback. Idempotent: a no-op (returns false) if the user no longer exists.
export function deleteAccount(userId) {
  if (!getUserById(userId)) return false;
  for (const table of ['ratings', 'dismissed', 'not_seen', 'watchlist', 'user_settings']) {
    db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(userId);
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  return true;
}

// ---- global settings ------------------------------------------------------
const _getSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
const _setSetting = db.prepare(
  'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
);
export function getSetting(key, fallback = null) {
  const row = _getSetting.get(key);
  return row ? JSON.parse(row.value) : fallback;
}
export function setSetting(key, value) {
  _setSetting.run(key, JSON.stringify(value));
}
export function getAllSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)]));
}

// ---- per-user settings ----------------------------------------------------
const _getUserSetting = db.prepare('SELECT value FROM user_settings WHERE user_id = ? AND key = ?');
const _setUserSetting = db.prepare(
  'INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value'
);
export function getUserSetting(userId, key, fallback = null) {
  const row = _getUserSetting.get(userId, key);
  return row ? JSON.parse(row.value) : fallback;
}
export function setUserSetting(userId, key, value) {
  _setUserSetting.run(userId, key, JSON.stringify(value));
}

// ---- ratings (per user) ---------------------------------------------------
const _upsertRating = db.prepare(`
  INSERT INTO ratings (user_id, tmdb_id, media_type, rating, title, year, source)
  VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(user_id, tmdb_id, media_type) DO UPDATE SET
    rating = excluded.rating, title = excluded.title,
    year = excluded.year, source = excluded.source, rated_at = datetime('now')
`);
export function upsertRating({ user_id, tmdb_id, media_type = 'movie', rating, title, year, source }) {
  _upsertRating.run(user_id, tmdb_id, media_type, rating, title ?? null, year ?? null, source ?? 'app');
}
export function getRatings(userId) {
  return db.prepare('SELECT * FROM ratings WHERE user_id = ? ORDER BY rated_at DESC').all(userId);
}
export function deleteRating(userId, tmdb_id, media_type = 'movie') {
  db.prepare('DELETE FROM ratings WHERE user_id = ? AND tmdb_id = ? AND media_type = ?')
    .run(userId, tmdb_id, media_type);
}

// ---- dismissed (per user) -------------------------------------------------
export function dismiss(userId, tmdb_id, media_type = 'movie') {
  db.prepare('INSERT OR IGNORE INTO dismissed (user_id, tmdb_id, media_type) VALUES (?, ?, ?)')
    .run(userId, tmdb_id, media_type);
}
export function getDismissed(userId) {
  return db.prepare('SELECT tmdb_id, media_type FROM dismissed WHERE user_id = ?').all(userId);
}

// ---- not seen (per user; hidden from the rate queue only) -----------------
export function markNotSeen(userId, tmdb_id, media_type = 'movie') {
  db.prepare('INSERT OR IGNORE INTO not_seen (user_id, tmdb_id, media_type) VALUES (?, ?, ?)')
    .run(userId, tmdb_id, media_type);
}
export function getNotSeen(userId) {
  return db.prepare('SELECT tmdb_id, media_type FROM not_seen WHERE user_id = ?').all(userId);
}

// ---- watchlist (per user; saved to watch later) ---------------------------
// The richer Discover-card fields we persist alongside a saved title so its card
// and detail popup render identically to a Discover pick. Score is deliberately
// excluded — it's a per-build recommendation rank a saved title has no place in.
// The same shape is produced by the Discover card (captured at save time) and by
// enrichWatchlistItem (backfill), so both write through this one whitelist.
const CARD_FIELDS = ['imdb_id', 'vote_average', 'runtime', 'genres', 'tones', 'services', 'imdbRating', 'metascore', 'overview', 'director', 'cast', 'trailers'];
function pickCard(src) {
  const card = {};
  for (const k of CARD_FIELDS) if (src[k] != null) card[k] = src[k];
  return Object.keys(card).length ? JSON.stringify(card) : null;
}
// Flatten a stored row back into the shape the frontend card expects: the `card`
// JSON blob spread to top level (services/genres as arrays, ratings as numbers),
// the raw column dropped.
function rowToWatchItem({ card, ...row }) {
  return { ...row, ...(card ? JSON.parse(card) : {}) };
}

const _addToWatchlist = db.prepare(`
  INSERT INTO watchlist (user_id, tmdb_id, media_type, title, year, poster_path, card)
  VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(user_id, tmdb_id, media_type) DO UPDATE SET
    title = excluded.title, year = excluded.year, poster_path = excluded.poster_path,
    -- keep the existing enrichment if a sparse re-save carries no card fields
    card = COALESCE(excluded.card, watchlist.card)
`);
export function addToWatchlist({ user_id, tmdb_id, media_type = 'movie', title, year, poster_path, ...rest }) {
  _addToWatchlist.run(user_id, tmdb_id, media_type, title ?? null, year ?? null, poster_path ?? null, pickCard(rest));
}
export function getWatchlist(userId) {
  return db.prepare('SELECT * FROM watchlist WHERE user_id = ? ORDER BY added_at DESC').all(userId).map(rowToWatchItem);
}
// Just the identifiers — for the recommender, which needs to know which titles a
// user has already shelved (so it never re-recommends them) without paying to
// parse every stored card blob.
export function getWatchlistIds(userId) {
  return db.prepare('SELECT tmdb_id, media_type FROM watchlist WHERE user_id = ?').all(userId);
}
// Fill (or refresh) just the rich card fields of an already-saved title, leaving
// title/year/poster untouched — used by the background backfill of older rows.
const _setWatchlistCard = db.prepare(
  'UPDATE watchlist SET card = ? WHERE user_id = ? AND tmdb_id = ? AND media_type = ?'
);
export function setWatchlistCard(userId, tmdb_id, media_type, card) {
  _setWatchlistCard.run(pickCard(card), userId, tmdb_id, media_type);
}
// Saved titles still needing server-side enrichment — the backfill's work list
// for one user. A row qualifies when it was never enriched (card IS NULL — saved
// before save-time capture, or whose enrichment failed) or predates a card field
// that's since been added: it lacks a "trailers" key, or a "tones" key. Once a
// row carries both — even as empty arrays for a film with no trailer/tone — it's
// done and this query skips it, so the boot-time backfill settles to a no-op.
export function watchlistNeedingEnrichment(userId) {
  return db.prepare(
    `SELECT tmdb_id, media_type FROM watchlist
     WHERE user_id = ? AND (card IS NULL OR card NOT LIKE '%"trailers"%' OR card NOT LIKE '%"tones"%')`,
  ).all(userId);
}
export function removeFromWatchlist(userId, tmdb_id, media_type = 'movie') {
  db.prepare('DELETE FROM watchlist WHERE user_id = ? AND tmdb_id = ? AND media_type = ?')
    .run(userId, tmdb_id, media_type);
}

// ---- cache ----------------------------------------------------------------
// The durable response cache (Trakt, MotN, IMDb/Metacritic ratings). TMDB no
// longer lives here — its large, regenerable bodies moved to a separate
// ephemeral, size-capped cache (tmdb-cache.js) so they can't bloat this
// replicated DB. No row cap here: the remaining entries are small and a few are
// quota-precious (MotN), so they're worth persisting in full.
const _cache = createKvCache(db);
export function cacheGet(key, maxAgeMs) {
  return _cache.get(key, maxAgeMs);
}
export function cacheSet(key, value) {
  _cache.set(key, value);
}

// ---- per-title tone tags (provenance store) -------------------------------
// Each feeder (imdb, letterboxd, model) owns its rows for a title; a re-resolve
// replaces just that source's set, leaving the others intact. A title's tones are
// the union of slugs across sources. See tone-store.js (read/aggregate) and
// tone-sources.js (resolve/write).

// Sentinel recorded when a source resolved a title but found no tones — so the TTL
// knows the title was checked (and won't re-scrape it every build) even at zero.
// Excluded from reads, so it never surfaces as a tone.
const NO_TONES = '_none';
const _delMovieToneSource = db.prepare('DELETE FROM movie_tones WHERE tmdb_id = ? AND media_type = ? AND source = ?');
const _insMovieTone = db.prepare(
  'INSERT OR REPLACE INTO movie_tones (tmdb_id, media_type, source, slug, updated_at) VALUES (?, ?, ?, ?, ?)'
);
// Replace one source's tones for a title with `slugs` (empty = resolved, none).
export function setMovieToneSource(tmdb_id, media_type, source, slugs) {
  _delMovieToneSource.run(tmdb_id, media_type, source);
  const now = Date.now();
  for (const slug of slugs.length ? slugs : [NO_TONES]) {
    _insMovieTone.run(tmdb_id, media_type, source, slug, now);
  }
}
const _getMovieToneSlugs = db.prepare(
  "SELECT DISTINCT slug FROM movie_tones WHERE tmdb_id = ? AND media_type = ? AND slug != '_none'"
);
// Distinct real tone slugs stored for a title across every source.
export function getMovieToneSlugs(tmdb_id, media_type = 'movie') {
  return _getMovieToneSlugs.all(tmdb_id, media_type).map((r) => r.slug);
}
const _movieToneSourceAge = db.prepare(
  'SELECT MAX(updated_at) AS at FROM movie_tones WHERE tmdb_id = ? AND media_type = ? AND source = ?'
);
// When `source` last resolved this title (ms epoch), or 0 if never — the TTL skip
// that keeps the enrichment pass from re-hitting IMDb/Letterboxd for fresh titles.
export function movieToneResolvedAt(tmdb_id, media_type, source) {
  return _movieToneSourceAge.get(tmdb_id, media_type, source)?.at || 0;
}
