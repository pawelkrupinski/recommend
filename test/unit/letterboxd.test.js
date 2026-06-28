// Unit test for the Letterboxd RSS parser, replayed against a recorded raw feed
// (test/fixtures/letterboxd-rss.xml — real <letterboxd:…>/<tmdb:movieId> prefixes,
// no live HTTP). letterboxd.js -> fetch.js -> env.js (no SQLite), but freshDbEnv()
// keeps env deterministic and matches the other suites.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDbEnv, readFixture } from '../helpers/env.js';

freshDbEnv();
const { parseLetterboxdRss, ACCOUNTS } = await import('../../src/letterboxd.js');
const xml = readFixture('letterboxd-rss.xml');

test('curated account list is unique and carries the art-house feeds', () => {
  assert.equal(new Set(ACCOUNTS).size, ACCOUNTS.length, 'no duplicate usernames');
  // The indie lean: MUBI's feed plus two indie-film publications (verified live to
  // return film activity RSS with TMDB ids).
  for (const a of ['mubi', 'filmcomment', 'thefilmstage']) assert.ok(ACCOUNTS.includes(a));
});

test('extracts the TMDB id, title and year from each watched-film item', () => {
  const out = parseLetterboxdRss(xml);
  assert.ok(out.length >= 5, 'parses the feed items');
  // The fixture leads with Dave Vis re-watching the Toy Story films.
  const toy4 = out.find((m) => m.id === 301528);
  assert.deepEqual(toy4, { id: 301528, title: 'Toy Story 4', year: 2019 },
    'TMDB id comes straight from <tmdb:movieId> — no resolution needed');
});

test('every parsed candidate carries a numeric TMDB id', () => {
  for (const m of parseLetterboxdRss(xml)) {
    assert.equal(typeof m.id, 'number');
    assert.ok(Number.isInteger(m.id) && m.id > 0);
  }
});

test('skips items that carry no <tmdb:movieId> (lists, non-film activity)', () => {
  const xmlNoId = '<item> <title>A list</title> <letterboxd:filmTitle>X</letterboxd:filmTitle> </item>'
    + '<item> <tmdb:movieId>42</tmdb:movieId> <letterboxd:filmTitle>Keeper</letterboxd:filmTitle> <letterboxd:filmYear>2001</letterboxd:filmYear> </item>';
  assert.deepEqual(parseLetterboxdRss(xmlNoId), [{ id: 42, title: 'Keeper', year: 2001 }]);
});

test('tolerates empty input', () => {
  assert.deepEqual(parseLetterboxdRss(''), []);
});
