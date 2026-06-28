// Unit test for the Filmweb ranking parser, replayed against a recorded slice of
// the real Top-500 page (test/fixtures/filmweb-ranking.html — server-rendered, no
// live HTTP). filmweb.js -> tmdb.js -> db.js opens SQLite at import, so
// freshDbEnv() must run before the dynamic import.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freshDbEnv } from '../helpers/env.js';

freshDbEnv();
const { parseFilmwebRanking } = await import('../../src/filmweb.js');
const html = readFileSync(new URL('../fixtures/filmweb-ranking.html', import.meta.url), 'utf8');

test('extracts a title and 4-digit year for each ranked film', () => {
  const films = parseFilmwebRanking(html);
  assert.ok(films.length >= 10, 'parses the ranking rows in the fixture');
  for (const f of films) {
    assert.equal(typeof f.title, 'string');
    assert.ok(f.title.length > 0, 'non-empty title');
    assert.ok(f.year >= 1900 && f.year <= 2100, `plausible year, got ${f.year}`);
  }
});

test('reads the #1 ranked film and ties it to its own year', () => {
  const [first] = parseFilmwebRanking(html);
  // The fixture is led by Filmweb's #1: "Skazani na Shawshank" (1994).
  assert.equal(first.title, 'Skazani na Shawshank');
  assert.equal(first.year, 1994);
});

test('caps the number of films parsed (bounds downstream TMDB resolution)', () => {
  // Even fed a huge page, the parser never returns more than its MAX_FILMS cap.
  assert.ok(parseFilmwebRanking(html).length <= 25);
});

test('returns [] for markup with no ranking rows', () => {
  assert.deepEqual(parseFilmwebRanking('<html><body>no ranking here</body></html>'), []);
});
