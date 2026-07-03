// The guarantee this whole change exists for: a title's score does NOT depend on
// which filter shaped the candidate pool it was ranked in. We rank the SAME movie
// twice — once among other movies, once among TV shows — and assert it comes out
// with an identical score. Before the fix rankCorpus rebuilt IDF (and the quality
// prior's baseline) over each pool, so the movie's feature weights shifted with
// the pool's composition and the two scores differed; deriving both from the
// global corpus stats (global-stats.js) makes them equal.
//
// Needs a real DB (global-stats persists there) — freshDbEnv before the imports.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshDbEnv } from '../helpers/env.js';

let env, recordSeen, globalMeanRating, rankCorpus;

before(async () => {
  env = freshDbEnv();
  ({ recordSeen, globalMeanRating } = await import('../../src/global-stats.js'));
  ({ rankCorpus } = await import('../../src/taste.js'));
});
after(() => env.cleanup());

// The scoring-relevant fields of a candidate card (rankCorpus fills in the rest).
// A shared IMDb rating (well-voted, no discovery bonus) so the prior is identical
// across the two pools and any score difference can only come from the IDF.
const card = (media_type, tmdb_id, features, genreIds = [18]) => ({
  media_type, tmdb_id, features, genreIds,
  imdbRating: 6.0, imdbVotes: 5000, metascore: null, collab: 0,
  title: `t${tmdb_id}`, genres: ['Drama'],
});

const scoreOf = (ranked, tmdb_id) => ranked.find((c) => c.tmdb_id === tmdb_id).score;

// Five keywords the profile strongly likes. They saturate the OTHER movies below
// (common within a movies-only pool → low per-pool IDF) but appear in none of the
// TV shows (rare within a mixed pool → high per-pool IDF). Under the old model
// that swing moved movieA's confidence AND its match, so its score differed by
// several points between the two pools; the assertion pins them equal.
const KW = ['keyword:heist', 'keyword:crime', 'keyword:vault', 'keyword:getaway', 'keyword:crew'];

test('a movie scores the same among movies as among TV shows', async () => {
  const movieA = card('movie', 1, [...KW, 'genre:18', 'cast:100']);
  const otherMovies = [2, 3, 4, 5].map((id) => card('movie', id, [...KW, 'genre:18', `cast:${id}`]));
  const tvShows = [12, 13, 14].map((id) =>
    card('tv', id, [`keyword:tv${id}`, 'genre:35', `cast:${id}`], [35]));

  // Establish the global corpus (df + mean) over every title, once.
  await recordSeen([movieA, ...otherMovies, ...tvShows]);
  const globalMean = globalMeanRating();

  // A profile that strongly likes all five keywords (rated several such films high).
  const strong = (v) => new Map(KW.map((k) => [k, v]));
  const profile = {
    pos: strong(6), neg: new Map(), counts: strong(4),
    mean: 8, count: 4,
    ratedFeatureSets: [[...KW, 'genre:18'], [...KW, 'genre:18'], [...KW, 'genre:18']],
    genreLists: [[18], [18], [18]],
  };

  const amongMovies = await rankCorpus({ cards: [movieA, ...otherMovies], globalMean }, profile);
  const amongTv = await rankCorpus({ cards: [movieA, ...tvShows], globalMean }, profile);

  assert.equal(scoreOf(amongMovies, 1), scoreOf(amongTv, 1),
    'movieA must score identically regardless of the pool it was ranked in');
});
