// Unit tests for summarizeProfile — the pure transform behind the hidden
// /insights page. It turns accumulated taste evidence (the same pos/neg/counts
// buildProfile produces) plus a feature→label map into the grouped, signed
// weight summary the page renders. No I/O, so we feed it a hand-built profile.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeProfile } from '../../src/insights.js';
import { SCORING } from '../../src/scoring.js';

// A small but representative profile: Action liked, Drama disliked, a liked tone
// and a weakly-liked actor, plus one feature with no rating evidence (dropped).
const profile = () => ({
  mean: 7.5,
  count: 3,
  ratedFeatureSets: [
    ['genre:28', 'tone:dark', 'keyword:1'],
    ['genre:28', 'genre:18', 'cast:600'],
    ['genre:18', 'tone:dark'],
  ],
  genreLists: [[28], [28, 18], [18]],
  pos: new Map([['genre:28', 3], ['tone:dark', 2], ['cast:600', 0.5]]),
  neg: new Map([['genre:18', -2]]),
  counts: new Map([['genre:28', 2], ['genre:18', 2], ['tone:dark', 2], ['cast:600', 1], ['keyword:1', 1]]),
});
const labels = () => new Map([
  ['genre:28', 'Action'], ['genre:18', 'Drama'], ['tone:dark', 'Dark'], ['cast:600', 'Some Actor'],
]);

const find = (cats, type) => cats.find((c) => c.type === type);

test('summarizeProfile reports the headline counts', () => {
  const s = summarizeProfile(profile(), labels());
  assert.equal(s.ratedCount, 3);
  assert.equal(s.meanRating, 7.5);
  // genre:28, genre:18, tone:dark, cast:600 survive; keyword:1 (no evidence) is dropped.
  assert.equal(s.distinctFeatures, 4);
});

test('summarizeProfile splits liked vs disliked features by weight sign', () => {
  const s = summarizeProfile(profile(), labels());
  const genre = find(s.features, 'genre');
  assert.ok(genre, 'a genre category is present');
  assert.deepEqual(genre.liked.map((f) => f.label), ['Action']);
  assert.deepEqual(genre.disliked.map((f) => f.label), ['Drama']);
  assert.ok(genre.liked[0].weight > 0 && genre.disliked[0].weight < 0);
});

test('summarizeProfile labels features and carries idf + sighting count', () => {
  const s = summarizeProfile(profile(), labels());
  const action = find(s.features, 'genre').liked[0];
  assert.equal(action.label, 'Action');
  assert.equal(action.count, 2, 'seen in two rated films');
  assert.ok(action.idf > 0, 'idf weight attached for the bar/tooltip');
});

test('summarizeProfile orders categories genres → tones → people', () => {
  const s = summarizeProfile(profile(), labels());
  assert.deepEqual(s.features.map((c) => c.type), ['genre', 'tone', 'cast']);
});

test('summarizeProfile derives the genre calibration distribution', () => {
  const s = summarizeProfile(profile(), labels());
  const byLabel = Object.fromEntries(s.genres.map((g) => [g.label, g.prob]));
  assert.equal(byLabel.Action, 0.5);
  assert.equal(byLabel.Drama, 0.5);
});

test('summarizeProfile exposes the scoring knobs in effect', () => {
  const s = summarizeProfile(profile(), labels());
  assert.equal(s.scoring.BETA_NEG, SCORING.BETA_NEG);
});

test('summarizeProfile handles a user with no ratings', () => {
  const empty = { mean: 7, count: 0, ratedFeatureSets: [], genreLists: [], pos: new Map(), neg: new Map(), counts: new Map() };
  const s = summarizeProfile(empty, new Map());
  assert.equal(s.ratedCount, 0);
  assert.deepEqual(s.features, []);
  assert.deepEqual(s.genres, []);
  assert.equal(s.distinctFeatures, 0);
});
