// The IMDb-id resolver's matching logic — the zero-false-positive guarantee.
// A wrong id lends a different film's rating to this card, so the headline cases
// here are the REJECTIONS: a near-miss must resolve to null, not a guess. The
// pure matchers (parseSuggestions / pickByTitleYear / pickByPeople) carry the
// rules and are tested directly; resolveImdbId is exercised once end-to-end with
// an injected fetcher (no network) over a real recorded suggestion response.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDbEnv, readFixture } from '../helpers/env.js';

freshDbEnv();
const { parseSuggestions, pickByTitleYear, pickByPeople, resolveImdbId } =
  await import('../../src/resolve-ratings.js');

const MATRIX_BODY = readFixture('imdb-suggestion-matrix.json');

test('parseSuggestions keeps only tt movie entries with their year/rank/cast', () => {
  const cands = parseSuggestions(MATRIX_BODY);
  assert.ok(cands.length >= 3);
  assert.ok(cands.every((c) => c.id.startsWith('tt')), 'drops the franchise (in…) and people entries');
  const matrix = cands.find((c) => c.id === 'tt0133093');
  assert.deepEqual(
    { title: matrix.title, year: matrix.year },
    { title: 'The Matrix', year: 1999 },
  );
  assert.match(matrix.people, /Keanu Reeves/);
});

// ---- rule A: title-exact + year ------------------------------------------
const MATRIX_CANDS = parseSuggestions(MATRIX_BODY);

test('pickByTitleYear accepts the exact title at the matching year', () => {
  assert.equal(pickByTitleYear(MATRIX_CANDS, 'The Matrix', 1999), 'tt0133093');
  assert.equal(pickByTitleYear(MATRIX_CANDS, 'Amélie'.replace('é', 'e'), 1999), null); // sanity: wrong film
});

test('pickByTitleYear REJECTS a franchise-substring neighbour', () => {
  // "The Matrix" must never resolve to "The Matrix Reloaded"/"Resurrections".
  const id = pickByTitleYear(MATRIX_CANDS, 'The Matrix', 1999);
  assert.equal(id, 'tt0133093', 'the exact 1999 title, not a 2003/2021 sequel');
});

test('pickByTitleYear REJECTS the same title at the wrong year', () => {
  assert.equal(pickByTitleYear(MATRIX_CANDS, 'The Matrix', 2010), null, 'no candidate within a year');
});

test('pickByTitleYear REJECTS a different film that merely shares the year (no exact title)', () => {
  const cands = [
    { id: 'tt_other', title: 'Notting Hill', year: 1999, rank: 1, people: 'Hugh Grant' },
    { id: 'tt_x', title: 'Election', year: 1999, rank: 2, people: 'Reese Witherspoon' },
  ];
  assert.equal(pickByTitleYear(cands, 'The Matrix', 1999), null, 'never the #1 same-year title');
});

test('pickByTitleYear REJECTS when the card has no year to gate on', () => {
  assert.equal(pickByTitleYear(MATRIX_CANDS, 'The Matrix', null), null);
});

// ---- rule B: people-corroborated (foreign/localised titles) --------------
test('pickByPeople accepts a single year+cast match when the title differs', () => {
  const cands = [{ id: 'tt2683136', title: 'Cold War', year: 2018, rank: 5, people: 'Joanna Kulig, Tomasz Kot' }];
  assert.equal(pickByPeople(cands, { cast: ['Joanna Kulig'], director: 'Paweł Pawlikowski' }, 2018), 'tt2683136');
});

test('pickByPeople REJECTS when two candidates both corroborate (ambiguous)', () => {
  const cands = [
    { id: 'tt_a', title: 'Foo', year: 2018, rank: 1, people: 'Joanna Kulig' },
    { id: 'tt_b', title: 'Bar', year: 2018, rank: 2, people: 'Joanna Kulig' },
  ];
  assert.equal(pickByPeople(cands, { cast: ['Joanna Kulig'] }, 2018), null);
});

test('pickByPeople REJECTS with no people, no year, or only a shared first name', () => {
  const cands = [{ id: 'tt_a', title: 'Foo', year: 2018, rank: 1, people: 'Joanna Kulig' }];
  assert.equal(pickByPeople(cands, {}, 2018), null, 'no people to corroborate on');
  assert.equal(pickByPeople(cands, { cast: ['Joanna Kulig'] }, null), null, 'no year to gate on');
  assert.equal(pickByPeople(cands, { cast: ['Joanna Smith'] }, 2018), null, 'a shared first name is not a match');
});

// ---- end-to-end with an injected fetcher (no network) --------------------
const fakeRes = (body) => ({ ok: true, text: async () => body });

test('resolveImdbId resolves a real title via the suggestion endpoint', async () => {
  const id = await resolveImdbId(
    { title: 'The Matrix', year: 1999, cast: ['Keanu Reeves'] },
    { fetcher: async () => fakeRes(MATRIX_BODY) },
  );
  assert.equal(id, 'tt0133093');
});

test('resolveImdbId bails (no fetch) when the card has no year', async () => {
  let called = false;
  const id = await resolveImdbId(
    { title: 'The Matrix', cast: ['Keanu Reeves'] },
    { fetcher: async () => { called = true; return fakeRes(MATRIX_BODY); } },
  );
  assert.equal(id, null);
  assert.equal(called, false, 'nothing to disambiguate on → never hits the network');
});
