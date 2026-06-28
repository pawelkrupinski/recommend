// Unit tests for the SQLite data layer (src/db.js). Runs against a throwaway
// database created per process; no network, no server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDbEnv } from '../helpers/env.js';

freshDbEnv();
const db = await import('../../src/db.js');

// A fresh user for each test that needs one, so tests stay independent.
let seq = 0;
function newUser(overrides = {}) {
  const email = `u${seq++}@example.com`;
  return db.upsertUserFromLogin({ email, name: 'U', provider: 'dev', provider_sub: `sub-${email}`, ...overrides });
}

test('upsertUserFromLogin inserts then updates the same row by email', () => {
  const a = db.upsertUserFromLogin({ email: 'Dup@Example.com', name: 'First', provider: 'google', provider_sub: 'g1' });
  const b = db.upsertUserFromLogin({ email: 'dup@example.com', name: 'Second', provider: 'google', provider_sub: 'g1' });
  assert.equal(a.id, b.id, 'same email (case-insensitive) reuses the row');
  assert.equal(b.name, 'Second', 'update overwrites name');
  assert.equal(b.email, 'dup@example.com', 'email is lower-cased');
});

test('getUserByEmail is case-insensitive; getUserById round-trips', () => {
  const u = newUser({ email: 'Case@Example.com' });
  assert.equal(db.getUserByEmail('CASE@EXAMPLE.COM').id, u.id);
  assert.equal(db.getUserById(u.id).email, 'case@example.com');
  assert.equal(db.getUserById(999999), undefined);
});

test('getUserByProviderSub matches on provider + sub, and guards null', () => {
  const u = db.upsertUserFromLogin({ email: 'fb@example.com', name: 'FB', provider: 'facebook', provider_sub: 'FBID' });
  assert.equal(db.getUserByProviderSub('facebook', 'FBID').id, u.id);
  assert.equal(db.getUserByProviderSub('google', 'FBID'), undefined, 'provider must match too');
  assert.equal(db.getUserByProviderSub('facebook', null), undefined);
});

test('admin allowlist promotes matching emails on login', async () => {
  // Re-import db with an allowlist set so isAdminEmail() sees it. A second import
  // of the same module is cached, so use a child db env instead.
  const u = newUser();
  assert.equal(u.is_admin, 0, 'non-allowlisted user is not admin by default');
  db.setUserAdmin(u.id, true);
  assert.equal(db.getUserById(u.id).is_admin, 1);
  db.setUserAdmin(u.id, false);
  assert.equal(db.getUserById(u.id).is_admin, 0);
});

test('countUsers / listUsers reflect inserts', () => {
  const before = db.countUsers();
  newUser(); newUser();
  assert.equal(db.countUsers(), before + 2);
  assert.ok(Array.isArray(db.listUsers()));
});

test('global settings JSON round-trip with fallback', () => {
  assert.equal(db.getSetting('missing', 'fb'), 'fb');
  db.setSetting('obj', { a: 1, b: [2, 3] });
  assert.deepEqual(db.getSetting('obj'), { a: 1, b: [2, 3] });
  db.setSetting('obj', 'replaced');
  assert.equal(db.getSetting('obj'), 'replaced', 'upsert replaces');
});

test('per-user settings are isolated by user', () => {
  const a = newUser(), b = newUser();
  db.setUserSetting(a.id, 'country', 'PL');
  db.setUserSetting(b.id, 'country', 'US');
  assert.equal(db.getUserSetting(a.id, 'country'), 'PL');
  assert.equal(db.getUserSetting(b.id, 'country'), 'US');
  assert.equal(db.getUserSetting(a.id, 'missing', 'def'), 'def');
});

test('ratings upsert/get/delete and per-user isolation', () => {
  const a = newUser(), b = newUser();
  db.upsertRating({ user_id: a.id, tmdb_id: 10, rating: 8, title: 'X', year: 2000 });
  db.upsertRating({ user_id: a.id, tmdb_id: 10, rating: 9, title: 'X2', year: 2001 }); // conflict → update
  db.upsertRating({ user_id: b.id, tmdb_id: 10, rating: 3, title: 'Y' });

  const aRatings = db.getRatings(a.id);
  assert.equal(aRatings.length, 1, 'conflict updates in place, no duplicate row');
  assert.equal(aRatings[0].rating, 9);
  assert.equal(aRatings[0].title, 'X2');
  assert.equal(db.getRatings(b.id).length, 1, "other user's rating is separate");

  db.deleteRating(a.id, 10);
  assert.equal(db.getRatings(a.id).length, 0);
  assert.equal(db.getRatings(b.id).length, 1, 'delete is scoped to the user');
});

test('dismiss is idempotent and per-user', () => {
  const a = newUser(), b = newUser();
  db.dismiss(a.id, 55);
  db.dismiss(a.id, 55); // INSERT OR IGNORE — no error, no dup
  db.dismiss(b.id, 55);
  assert.deepEqual(db.getDismissed(a.id).map((d) => d.tmdb_id), [55]);
  assert.equal(db.getDismissed(b.id).length, 1);
});

test('markNotSeen is idempotent and per-user', () => {
  const a = newUser();
  db.markNotSeen(a.id, 77);
  db.markNotSeen(a.id, 77);
  assert.deepEqual(db.getNotSeen(a.id).map((d) => d.tmdb_id), [77]);
});

test('deleteAccount cascades all per-user rows and is idempotent', () => {
  const u = newUser();
  db.upsertRating({ user_id: u.id, tmdb_id: 1, rating: 5 });
  db.dismiss(u.id, 2);
  db.markNotSeen(u.id, 3);
  db.setUserSetting(u.id, 'country', 'PL');

  assert.equal(db.deleteAccount(u.id), true);
  assert.equal(db.getUserById(u.id), undefined);
  assert.equal(db.getRatings(u.id).length, 0);
  assert.equal(db.getDismissed(u.id).length, 0);
  assert.equal(db.getNotSeen(u.id).length, 0);
  assert.equal(db.getUserSetting(u.id, 'country', 'gone'), 'gone');
  assert.equal(db.deleteAccount(u.id), false, 'second delete is a no-op');
});

test('createAnonUser makes a fresh, email-less account each call', () => {
  const a = db.createAnonUser();
  const b = db.createAnonUser();
  assert.ok(a.id && b.id && a.id !== b.id, 'distinct rows');
  assert.equal(a.email, null, 'anonymous users carry no email');
  assert.equal(a.provider, 'anon');
});

test('hasUserContent counts ratings/watchlist but not settings alone', () => {
  const u = newUser();
  assert.equal(db.hasUserContent(u.id), false, 'fresh user has no content');
  db.setUserSetting(u.id, 'country', 'PL');
  assert.equal(db.hasUserContent(u.id), false, 'settings alone are not content');
  db.upsertRating({ user_id: u.id, tmdb_id: 1, rating: 5 });
  assert.equal(db.hasUserContent(u.id), true, 'a rating is content');

  const w = newUser();
  db.addToWatchlist({ user_id: w.id, tmdb_id: 9, title: 'Saved' });
  assert.equal(db.hasUserContent(w.id), true, 'a watchlist item is content');
});

test('mergeUserData folds rows in without clobbering the target', () => {
  const anon = db.createAnonUser(), acct = newUser();
  // Target already has its own take on tmdb 1 and a country; anon adds tmdb 2.
  db.upsertRating({ user_id: acct.id, tmdb_id: 1, rating: 4, title: 'Keep mine' });
  db.setUserSetting(acct.id, 'country', 'US');
  db.upsertRating({ user_id: anon.id, tmdb_id: 1, rating: 9, title: 'Anon dupe' });
  db.upsertRating({ user_id: anon.id, tmdb_id: 2, rating: 8, title: 'Anon new' });
  db.addToWatchlist({ user_id: anon.id, tmdb_id: 3, title: 'Anon saved' });
  db.setUserSetting(anon.id, 'country', 'PL');
  db.setUserSetting(anon.id, 'providers', [8]);

  const moved = db.mergeUserData(anon.id, acct.id);
  assert.ok(moved > 0, 'reports how many rows came across');

  const ratings = db.getRatings(acct.id).sort((x, y) => x.tmdb_id - y.tmdb_id);
  assert.equal(ratings.length, 2, 'anon-only rating added, conflicting one not duplicated');
  assert.equal(ratings[0].title, 'Keep mine', "target's own rating is preserved on conflict");
  assert.equal(ratings[1].title, 'Anon new');
  assert.equal(db.getWatchlist(acct.id).length, 1, 'anon watchlist folded in');
  assert.equal(db.getUserSetting(acct.id, 'country'), 'US', 'existing setting not overwritten');
  assert.deepEqual(db.getUserSetting(acct.id, 'providers'), [8], 'new setting carried over');
});

test('watchlist persists rich card fields and returns them flattened', () => {
  const u = newUser();
  db.addToWatchlist({
    user_id: u.id, tmdb_id: 603, title: 'The Matrix', year: 1999, poster_path: '/m.jpg',
    vote_average: 8.2, runtime: 136, genres: ['Action', 'Sci-Fi'],
    services: [{ id: 8, name: 'Netflix', logo: '/n.png' }],
    imdbRating: 8.7, metascore: 73, overview: 'A hacker learns the truth.',
    director: 'The Wachowskis', cast: ['Keanu Reeves'],
    score: 91, // not a card field — must not be stored
  });
  const [w] = db.getWatchlist(u.id);
  assert.equal(w.title, 'The Matrix');
  assert.equal(w.vote_average, 8.2);
  assert.equal(w.runtime, 136);
  assert.deepEqual(w.genres, ['Action', 'Sci-Fi']);
  assert.deepEqual(w.services, [{ id: 8, name: 'Netflix', logo: '/n.png' }]);
  assert.equal(w.imdbRating, 8.7);
  assert.equal(w.metascore, 73);
  assert.equal(w.director, 'The Wachowskis');
  assert.equal(w.score, undefined, 'score is not a stored card field');
  assert.equal(w.card, undefined, 'the raw JSON column is not leaked to callers');
});

test('a sparse re-save keeps the existing rich card (COALESCE)', () => {
  const u = newUser();
  db.addToWatchlist({ user_id: u.id, tmdb_id: 7, title: 'Rich', genres: ['Drama'], vote_average: 7.0 });
  // A later save with no card fields (e.g. a merge) must not wipe the enrichment.
  db.addToWatchlist({ user_id: u.id, tmdb_id: 7, title: 'Rich', year: 2001 });
  const [w] = db.getWatchlist(u.id);
  assert.deepEqual(w.genres, ['Drama'], 'genres survive a sparse re-save');
  assert.equal(w.year, 2001, 'plain columns still update');
});

test('setWatchlistCard fills card fields without touching title/year/poster', () => {
  const u = newUser();
  db.addToWatchlist({ user_id: u.id, tmdb_id: 12, title: 'Old Save', year: 1980, poster_path: '/o.jpg' });
  const pending = db.watchlistNeedingCard(u.id);
  assert.equal(pending.length, 1, 'an un-enriched row is on the backfill work list');
  assert.equal(pending[0].tmdb_id, 12);

  db.setWatchlistCard(u.id, 12, 'movie', { genres: ['Horror'], vote_average: 6.5, runtime: 90 });
  const [w] = db.getWatchlist(u.id);
  assert.equal(w.title, 'Old Save', 'title preserved');
  assert.equal(w.poster_path, '/o.jpg', 'poster preserved');
  assert.deepEqual(w.genres, ['Horror'], 'card fields filled');
  assert.equal(db.watchlistNeedingCard(u.id).length, 0, 'no longer needs backfill');
});

test('cache honours maxAge expiry', () => {
  db.cacheSet('k', { v: 1 });
  assert.deepEqual(db.cacheGet('k'), { v: 1 }, 'no maxAge → always fresh');
  assert.deepEqual(db.cacheGet('k', 60_000), { v: 1 }, 'within maxAge → hit');
  assert.equal(db.cacheGet('k', -1), undefined, 'past maxAge → miss');
  assert.equal(db.cacheGet('nope'), undefined, 'unknown key → undefined');
});
