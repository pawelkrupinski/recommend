// SQLite persistence using Node's built-in driver (no native deps).
import './env.js'; // load secrets / DB_PATH before we read them
import { config, isAdminEmail } from './env.js';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// DB_PATH lets the host point us at a persistent disk (e.g. Render); default to
// the in-repo data dir for local dev.
const DB_PATH = process.env.DB_PATH || new URL('../data/recommend.db', import.meta.url).pathname;
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);

// ---- schema ---------------------------------------------------------------
// Per-user tables carry user_id in their primary key. Fresh installs get these
// straight away; existing single-user DBs are upgraded by migrate() below.
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    email      TEXT UNIQUE,
    name       TEXT,
    picture    TEXT,
    provider   TEXT,
    is_admin   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
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

  -- Generic response cache so we stay inside TMDB / RapidAPI rate limits.
  CREATE TABLE IF NOT EXISTS cache (
    key        TEXT PRIMARY KEY,
    value      TEXT,
    fetched_at INTEGER
  );
`);

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

// ---- users ----------------------------------------------------------------
export function getUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).toLowerCase());
}
export function getUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
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
export function upsertUserFromLogin({ email, name, picture, provider }) {
  email = String(email).toLowerCase();
  const existing = getUserByEmail(email);
  if (existing) {
    db.prepare('UPDATE users SET name = ?, picture = ?, provider = ?, is_admin = ? WHERE id = ?')
      .run(name ?? existing.name, picture ?? existing.picture, provider ?? existing.provider,
        isAdminEmail(email) ? 1 : existing.is_admin, existing.id);
    return getUserById(existing.id);
  }
  db.prepare('INSERT INTO users (email, name, picture, provider, is_admin) VALUES (?, ?, ?, ?, ?)')
    .run(email, name ?? null, picture ?? null, provider ?? null, isAdminEmail(email) ? 1 : 0);
  return getUserByEmail(email);
}
export function setUserAdmin(userId, isAdmin) {
  db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(isAdmin ? 1 : 0, userId);
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

// ---- cache ----------------------------------------------------------------
const _getCache = db.prepare('SELECT value, fetched_at FROM cache WHERE key = ?');
const _setCache = db.prepare(
  'INSERT INTO cache (key, value, fetched_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, fetched_at = excluded.fetched_at'
);
export function cacheGet(key, maxAgeMs) {
  const row = _getCache.get(key);
  if (!row) return undefined;
  if (maxAgeMs && Date.now() - row.fetched_at > maxAgeMs) return undefined;
  return JSON.parse(row.value);
}
export function cacheSet(key, value) {
  _setCache.run(key, JSON.stringify(value), Date.now());
}
