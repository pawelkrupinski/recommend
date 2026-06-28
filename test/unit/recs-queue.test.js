// Unit tests for the picks-grid refill decision (public/recs-queue.js). Pure and
// DOM-free, so it imports directly with no env setup.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newPicks } from '../../public/recs-queue.js';

const m = (id) => ({ tmdb_id: id, title: `M${id}` });
const ids = (list) => list.map((x) => x.tmdb_id);

test('returns titles not already shown and not on the watchlist', () => {
  const out = newPicks([m(1), m(2), m(3)], new Set([1]), new Set([3]));
  assert.deepEqual(ids(out), [2], 'only the unseen, unsaved title is appended');
});

test('empty when every returned title is already shown or saved', () => {
  assert.deepEqual(newPicks([m(1), m(2)], new Set([1]), new Set([2])), []);
});

test('preserves the server (score) order of the fresh picks', () => {
  const out = newPicks([m(5), m(4), m(6)], new Set(), new Set());
  assert.deepEqual(ids(out), [5, 4, 6]);
});

test('tolerates a null/absent results list', () => {
  assert.deepEqual(newPicks(null, new Set(), new Set()), []);
});
