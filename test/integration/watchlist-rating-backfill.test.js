// Watchlist ratings are PERSISTED (in the saved row's card) and the boot-time
// backfill now also targets rows that were enriched before title·year IMDb-id
// resolution existed — i.e. carry trailers/tones but no rating. This wires that
// at the DB seam (no network): the broadened work-list query, the full-card
// rewrite that persists a rating without wiping other fields, and removal taking
// the persisted rating with the row.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { freshDbEnv } from '../helpers/env.js';

freshDbEnv();
const db = await import('../../src/db.js');

let uid;
before(() => { uid = db.upsertUserFromLogin({ email: 'wl@e2e.test', name: 'W', provider: 'dev', provider_sub: 's' }).id; });

const save = (tmdb_id, extra) =>
  db.addToWatchlist({ user_id: uid, tmdb_id, title: `T${tmdb_id}`, year: 2018, poster_path: '/p.jpg', ...extra });

test('watchlistNeedingEnrichment targets a rating-less row but skips a rated one', () => {
  // Fully enriched (incl. genreIds) AND rated — must be skipped.
  save(11, { trailers: [], tones: [], genres: ['Drama'], genreIds: [18], imdbRating: 7.7, metascore: 80 });
  // Enriched (trailers+tones present) but never rated — the NEW case to backfill.
  save(22, { trailers: [], tones: [], genres: ['Drama'] });

  const ids = db.watchlistNeedingEnrichment(uid).map((r) => r.tmdb_id);
  assert.ok(ids.includes(22), 'a trailers/tones row with no rating is now picked up');
  assert.ok(!ids.includes(11), 'a row that already carries a rating is left alone');
});

test('a full-card rewrite persists the rating WITHOUT wiping other fields', () => {
  // Simulate backfill rewriting the whole enriched card (enrichWatchlistItem
  // rebuilds every field, then setWatchlistCard persists it).
  db.setWatchlistCard(uid, 22, 'movie', { genres: ['Drama'], genreIds: [18], services: [{ id: 8, name: 'Netflix' }], trailers: [], tones: [], imdbRating: 6.9, metascore: 71 });
  const row = db.getWatchlist(uid).find((w) => w.tmdb_id === 22);
  assert.equal(row.imdbRating, 6.9, 'the resolved rating is now persisted');
  assert.deepEqual(row.genres, ['Drama'], 'genres survived the rewrite');
  assert.equal(row.services[0].name, 'Netflix', 'services survived the rewrite');
  assert.ok(!db.watchlistNeedingEnrichment(uid).some((r) => r.tmdb_id === 22), 'and the row no longer needs enrichment');
});

test('removing a title takes its persisted rating with the row', () => {
  assert.ok(db.getWatchlist(uid).some((w) => w.tmdb_id === 11));
  db.removeFromWatchlist(uid, 11, 'movie');
  assert.ok(!db.getWatchlist(uid).some((w) => w.tmdb_id === 11), 'row (and its stored rating) is gone');
});
