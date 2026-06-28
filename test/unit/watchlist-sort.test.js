// Unit tests for the Watchlist "Top rated" ordering. averageRating blends the
// two external critic scores onto a single 0–10 scale (IMDb is already 0–10,
// Metacritic 0–100 is rescaled), and sortWatchlist reorders by it while keeping
// unrated titles last and leaving any non-rating sort untouched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { averageRating, sortWatchlist } from '../../public/watchlist-sort.js';

test('averageRating rescales Metacritic to 0–10 and averages both scores', () => {
  assert.equal(averageRating({ imdbRating: 8, metascore: 60 }), 7); // (8 + 6) / 2
});

test('averageRating uses whichever single score is present', () => {
  assert.equal(averageRating({ imdbRating: 7.4 }), 7.4);
  assert.equal(averageRating({ metascore: 90 }), 9);
});

test('averageRating is null when a title carries neither score', () => {
  assert.equal(averageRating({ title: 'Unenriched' }), null);
});

test('sortWatchlist orders by descending average rating', () => {
  const list = [
    { tmdb_id: 1, imdbRating: 6 },
    { tmdb_id: 2, imdbRating: 9, metascore: 90 },
    { tmdb_id: 3, imdbRating: 7.5 },
  ];
  assert.deepEqual(sortWatchlist(list, 'rating').map((m) => m.tmdb_id), [2, 3, 1]);
});

test('sortWatchlist sinks unrated titles to the bottom', () => {
  const list = [
    { tmdb_id: 1 },
    { tmdb_id: 2, imdbRating: 5 },
    { tmdb_id: 3 },
    { tmdb_id: 4, metascore: 80 },
  ];
  assert.deepEqual(sortWatchlist(list, 'rating').map((m) => m.tmdb_id), [4, 2, 1, 3]);
});

test('sortWatchlist does not mutate the input list', () => {
  const list = [{ tmdb_id: 1, imdbRating: 5 }, { tmdb_id: 2, imdbRating: 9 }];
  sortWatchlist(list, 'rating');
  assert.deepEqual(list.map((m) => m.tmdb_id), [1, 2]);
});

test('sortWatchlist leaves the server order untouched for any non-rating sort', () => {
  const list = [{ tmdb_id: 1, imdbRating: 5 }, { tmdb_id: 2, imdbRating: 9 }];
  assert.equal(sortWatchlist(list, 'added'), list);
  assert.equal(sortWatchlist(list, ''), list);
});
