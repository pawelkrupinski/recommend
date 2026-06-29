// Integrity checks on the committed tone data — the crosswalks every feeder maps
// through and the trained model. A typo'd slug or a stray weight would silently
// mis-tag films, so this guards the data the way the code is guarded: every mapped
// slug must be in the vocabulary, and the shapes must hold.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { crosswalks, isTone } from '../../src/tones.js';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '../../src/tone-data');
const load = (f) => JSON.parse(readFileSync(join(dataDir, f), 'utf8'));

for (const name of ['tmdb', 'imdb', 'letterboxd']) {
  test(`the ${name} crosswalk maps every raw tag to a non-empty list of valid tone slugs`, () => {
    const cw = crosswalks[name];
    assert.ok(Object.keys(cw).length > 0, `${name} crosswalk is populated`);
    for (const [key, slugs] of Object.entries(cw)) {
      assert.ok(Array.isArray(slugs) && slugs.length, `${name}["${key}"] is a non-empty array`);
      for (const s of slugs) assert.ok(isTone(s), `${name}["${key}"] → "${s}" is a known tone`);
    }
  });
}

test('the Netflix membership map keys tones by tmdb id with valid slugs', () => {
  for (const [id, slugs] of Object.entries(load('map-netflix.json'))) {
    assert.match(id, /^\d+$/, 'keyed by numeric tmdb id');
    for (const s of slugs) assert.ok(isTone(s), `netflix[${id}] → "${s}" is a known tone`);
  }
});

test('the trained model weights are valid slugs with finite numeric weights', () => {
  const model = load('model.json');
  const tones = Object.keys(model.weights);
  assert.ok(tones.length > 0, 'a trained model is committed');
  for (const slug of tones) {
    assert.ok(isTone(slug), `model weights for "${slug}" is a known tone`);
    for (const [tok, w] of Object.entries(model.weights[slug])) {
      assert.ok(Number.isFinite(w), `weight ${slug}.${tok} is finite`);
    }
  }
});

test('wholesome was decontaminated — crime keywords no longer map to it', () => {
  // Regression guard: an "innocent…" synonym once dragged crime keywords into the
  // wholesome tone (and the model). Only genuine wholesome keyword ids should remain.
  const wholesome = Object.entries(crosswalks.tmdb).filter(([, s]) => s.includes('wholesome')).map(([id]) => id);
  assert.deepEqual(wholesome.sort(), ['317983', '335803', '377619'], 'only family-friendly / wholesome / wholesome-comedy');
});
