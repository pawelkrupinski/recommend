// Unit tests for the persisted global corpus statistics (src/global-stats.js):
// document-frequency accumulation with once-per-title dedup, and the IDF derived
// from it. These are what make a title's score filter-invariant (see
// scoring-filter-invariance.test.js for the end-to-end guarantee). Needs a real
// SQLite file — freshDbEnv points DB_PATH at a throwaway one BEFORE the dynamic
// import, since global-stats.js creates its tables at load. The whole file shares
// one DB (node --test runs it in its own process), so ids are kept distinct per
// test and the cold-mean fallback is asserted before anything is recorded.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { SCORING } from '../../src/scoring.js';
import { freshDbEnv } from '../helpers/env.js';

let env, recordSeen, globalIdf, globalMeanRating;

before(async () => {
  env = freshDbEnv();
  ({ recordSeen, globalIdf, globalMeanRating } = await import('../../src/global-stats.js'));
});
after(() => env.cleanup());

// A card as global-stats consumes it: only the fields recordSeen reads.
const card = (media_type, tmdb_id, features, imdbRating = 7) =>
  ({ media_type, tmdb_id, features, imdbRating });

test('a cold table has no mean yet, so the prior defers to the IMDb fallback', () => {
  assert.equal(globalMeanRating(), SCORING.IMDB_GLOBAL_MEAN);
});

test('a recurring title is counted once (dedup by media_type:tmdb_id)', async () => {
  await recordSeen([card('movie', 1, ['keyword:99'])]);
  await recordSeen([card('movie', 1, ['keyword:99'])]); // same title, a later build
  await recordSeen([card('movie', 2, ['keyword:solo'])]); // a second distinct title
  // Both keywords occur in exactly one distinct title, so with correct dedup they
  // share a document frequency of 1 and thus an identical idf. Had title 1 been
  // counted twice, keyword:99's df would be 2 and its idf strictly lower.
  const idf = globalIdf(['keyword:99', 'keyword:solo']);
  assert.equal(idf.get('keyword:99'), idf.get('keyword:solo'));
});

test('a ubiquitous feature gets a lower idf than a rare one', async () => {
  const common = 'genre:common';
  await recordSeen([
    card('movie', 101, [common, 'keyword:rareA']),
    card('movie', 102, [common]),
    card('movie', 103, [common]),
    card('tv', 104, [common]),
  ]);
  const idf = globalIdf([common, 'keyword:rareA']);
  assert.ok(idf.get('keyword:rareA') > idf.get(common), 'rare keyword outweighs the broad genre');
});

test('an unseen feature is treated as maximally rare (df 0)', () => {
  const idf = globalIdf(['genre:common', 'never:seen:before']);
  assert.ok(idf.get('never:seen:before') > idf.get('genre:common'),
    'a feature absent from the table scores above one present in several titles');
});
