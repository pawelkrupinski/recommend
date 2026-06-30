// Unit tests for the picks-grid refill decision (public/recs-queue.js). Pure and
// DOM-free, so it imports directly with no env setup.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newPicks, pickKey } from '../../public/recs-queue.js';

const m = (id) => ({ tmdb_id: id, title: `M${id}` });
const ids = (list) => list.map((x) => x.tmdb_id);
const keys = (...items) => new Set(items.map(pickKey));

test('returns titles not already shown and not on the watchlist', () => {
  const out = newPicks([m(1), m(2), m(3)], keys(m(1)), keys(m(3)));
  assert.deepEqual(ids(out), [2], 'only the unseen, unsaved title is appended');
});

test('empty when every returned title is already shown or saved', () => {
  assert.deepEqual(newPicks([m(1), m(2)], keys(m(1)), keys(m(2))), []);
});

test('a series is not hidden by a film that shares its tmdb id', () => {
  const film = { tmdb_id: 42, media_type: 'movie' };
  const series = { tmdb_id: 42, media_type: 'tv' };
  // The film is shown; the series with the same id must still be a fresh pick.
  const out = newPicks([series], keys(film), new Set());
  assert.deepEqual(out, [series], 'the (media_type, id) pair keeps them distinct');
});

test('preserves the server (score) order of the fresh picks', () => {
  const out = newPicks([m(5), m(4), m(6)], new Set(), new Set());
  assert.deepEqual(ids(out), [5, 4, 6]);
});

test('tolerates a null/absent results list', () => {
  assert.deepEqual(newPicks(null, new Set(), new Set()), []);
});
