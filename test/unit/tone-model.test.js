// Unit tests for the local tone model's inference (src/tone-model.js): tokenising
// and scoring text against an injected tiny model. The committed model is exercised
// only for "untrained → no tags"; the scoring logic is tested against a fixed model
// so it doesn't depend on a training run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, classify, modelReady } from '../../src/tone-model.js';

const MODEL = {
  bias: { deadpan: -1, heartfelt: -1, gritty: -1 },
  weights: {
    deadpan: { awkward: 2, sardonic: 2, monotone: 1.5 },
    heartfelt: { family: 2, love: 1.5, tears: 2 },
    gritty: { brutal: 2, crime: 1.5, violent: 1.5 },
  },
};

test('tokenize lowercases, keeps 3+ letter words, drops stopwords + duplicates', () => {
  const toks = tokenize('A brutal, BRUTAL crime of the city');
  assert.ok(toks.includes('brutal') && toks.includes('crime'));
  assert.ok(!toks.includes('the') && !toks.includes('of') && !toks.includes('city'), 'stopwords dropped');
  assert.equal(toks.filter((w) => w === 'brutal').length, 1, 'deduped');
});

test('classify returns the tones whose summed token weights clear the bias', () => {
  // "awkward + sardonic" → deadpan score -1+2+2 = 3 (>0); nothing else fires.
  assert.deepEqual(classify('An awkward, sardonic hero', { model: MODEL }), ['deadpan']);
  // A heartfelt synopsis.
  assert.deepEqual(classify('A story of family and love', { model: MODEL }), ['heartfelt']);
});

test('classify ranks by score and caps at `max`', () => {
  const text = 'awkward sardonic brutal violent crime family love tears';
  // deadpan: -1+4=3, gritty: -1+5=4, heartfelt: -1+5.5=4.5 → all fire; cap to 2 strongest.
  assert.deepEqual(classify(text, { model: MODEL, max: 2 }), ['heartfelt', 'gritty']);
});

test('classify yields nothing below threshold or with no matching tokens', () => {
  assert.deepEqual(classify('a quiet uneventful afternoon', { model: MODEL }), []);
  assert.deepEqual(classify('', { model: MODEL }), []);
});

test('classify ignores model weights for slugs outside the vocabulary', () => {
  const bad = { bias: {}, weights: { 'not-a-tone': { awkward: 9 } } };
  assert.deepEqual(classify('awkward', { model: bad }), [], 'unknown slug never surfaces');
});

test('the committed (untrained) model reports not-ready and classifies to nothing', () => {
  assert.equal(modelReady(), false, 'no weights shipped yet → not ready');
  assert.deepEqual(classify('awkward sardonic family love'), [], 'untrained model tags nothing');
});
