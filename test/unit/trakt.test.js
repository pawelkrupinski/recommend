// Unit tests for Trakt's pure response parsers. No network — these feed captured
// response shapes straight through the parser, the way ratings.test.js exercises
// parseMetascore. trakt.js -> db.js opens SQLite at import time, so point at a
// throwaway db first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDbEnv } from '../helpers/env.js';

freshDbEnv();
const { parseChart } = await import('../../src/trakt.js');

test('parseChart reads the flat shape /movies/popular returns', () => {
  // /popular returns movie objects directly (no wrapper).
  const out = parseChart([
    { title: 'Heat', year: 1995, ids: { trakt: 1, tmdb: 949, slug: 'heat-1995' } },
    { title: 'Sicario', year: 2015, ids: { trakt: 2, tmdb: 273481 } },
  ]);
  assert.deepEqual(out, [
    { tmdb_id: 949, title: 'Heat', year: 1995 },
    { tmdb_id: 273481, title: 'Sicario', year: 2015 },
  ]);
});

test('parseChart unwraps the .movie envelope /trending and /anticipated use', () => {
  // /trending wraps each entry as { watchers, movie }; /anticipated as { list_count, movie }.
  const out = parseChart([
    { watchers: 120, movie: { title: 'Dune', year: 2021, ids: { tmdb: 438631 } } },
    { list_count: 99, movie: { title: 'Dune: Part Two', year: 2024, ids: { tmdb: 693134 } } },
  ]);
  assert.deepEqual(out.map((m) => m.tmdb_id), [438631, 693134]);
  assert.equal(out[0].title, 'Dune');
});

test('parseChart drops entries with no TMDB id (we key everything on TMDB)', () => {
  const out = parseChart([
    { title: 'No TMDB', year: 2000, ids: { trakt: 5, slug: 'no-tmdb' } },
    { title: 'Has TMDB', year: 2001, ids: { tmdb: 42 } },
  ]);
  assert.deepEqual(out, [{ tmdb_id: 42, title: 'Has TMDB', year: 2001 }]);
});

test('parseChart tolerates a non-array (network blip returns null)', () => {
  assert.deepEqual(parseChart(null), []);
  assert.deepEqual(parseChart(undefined), []);
});
