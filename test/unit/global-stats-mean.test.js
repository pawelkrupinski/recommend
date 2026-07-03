// The accumulated global mean IMDb rating (src/global-stats.js) — the quality
// prior's baseline C, now global rather than per-pool. In its own file so it runs
// in a fresh process with an empty mean, uncoupled from the df tests' recordings.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { SCORING } from '../../src/scoring.js';
import { freshDbEnv } from '../helpers/env.js';

let env, recordSeen, globalMeanRating;

before(async () => {
  env = freshDbEnv();
  ({ recordSeen, globalMeanRating } = await import('../../src/global-stats.js'));
});
after(() => env.cleanup());

test('the mean averages recorded IMDb ratings, excluding unrated titles', async () => {
  assert.equal(globalMeanRating(), SCORING.IMDB_GLOBAL_MEAN, 'fallback before any IMDb-rated title');
  await recordSeen([
    { media_type: 'movie', tmdb_id: 1, features: ['g:1'], imdbRating: 6 },
    { media_type: 'movie', tmdb_id: 2, features: ['g:2'], imdbRating: 8 },
    // No IMDb rating: contributes to the corpus/df but not to the rating mean.
    { media_type: 'movie', tmdb_id: 3, features: ['g:3'], imdbRating: null },
  ]);
  assert.equal(globalMeanRating(), 7, 'mean of 6 and 8; the unrated title is excluded');
});
