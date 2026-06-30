// Unit tests for the TMDB client's request building (src/tmdb.js). Runs with the
// stub off and global.fetch intercepted, so we assert the exact query TMDB is
// asked for without hitting the network.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshDbEnv } from '../helpers/env.js';

const env = freshDbEnv();
process.env.TMDB_STUB = '0';        // exercise the real request builder, not the stub
process.env.TMDB_API_KEY = 'test-key';
const tmdb = await import('../../src/tmdb.js');

after(() => env.cleanup());

// Capture the URL of the next fetch and return an empty-but-valid TMDB page.
async function captureRequest(run) {
  const realFetch = global.fetch;
  let captured;
  global.fetch = async (url) => {
    captured = url;
    return { ok: true, status: 200, json: async () => ({ page: 1, total_pages: 1, results: [] }) };
  };
  try { await run(); } finally { global.fetch = realFetch; }
  return new URL(captured);
}

test('acclaimed() seeds the rate queue with widely-rated, well-reviewed films across eras, not just recent releases', async () => {
  const url = await captureRequest(() => tmdb.acclaimed(2));

  assert.match(url.pathname, /\/discover\/movie$/,
    'uses Discover, not the recency-biased /movie/popular feed');
  assert.equal(url.searchParams.get('sort_by'), 'vote_count.desc',
    'orders by how many people rated it — the canonical popular-and-seen set, spanning decades');
  assert.ok(Number(url.searchParams.get('vote_average.gte')) >= 7,
    'keeps only acclaimed titles, not merely heavily watched ones');
  assert.ok(Number(url.searchParams.get('vote_count.gte')) >= 1000,
    'requires a large rating base so the average is trustworthy');
  assert.equal(url.searchParams.get('page'), '2',
    'passes the page through so the onboarding queue can keep paging');
  // No provider/region filter: the seed is a global acclaimed set the newcomer
  // is likely to have seen, independent of what they can stream.
  assert.equal(url.searchParams.get('with_watch_providers'), null,
    'does not constrain the seed to a streaming service');
});

test('discover() scopes to art-house distributors when given withCompanies', async () => {
  const url = await captureRequest(() => tmdb.discover({
    region: 'PL', providerIds: [8, 1899], withCompanies: '41077|90733',
    sortBy: 'vote_average.desc', voteCountGte: 20,
  }));
  assert.equal(url.searchParams.get('with_companies'), '41077|90733',
    'passes the distributor company ids straight through (pipe = OR)');
  assert.equal(url.searchParams.get('with_watch_providers'), '8|1899',
    'still streamability-gated to the user services');
  assert.equal(url.searchParams.get('vote_count.gte'), '20',
    'low vote floor — distributor curation is the quality gate, not vote count');
});

test('discover() caps the rating base with voteCountLte (hidden-gems band)', async () => {
  const url = await captureRequest(() => tmdb.discover({
    region: 'PL', providerIds: [8], sortBy: 'vote_average.desc',
    voteCountGte: 100, voteCountLte: 400,
  }));
  assert.equal(url.searchParams.get('vote_count.lte'), '400');
  assert.equal(url.searchParams.get('vote_count.gte'), '100');
});

test('discover() omits the indie params when not asked for', async () => {
  const url = await captureRequest(() => tmdb.discover({ region: 'PL', providerIds: [8] }));
  assert.equal(url.searchParams.get('with_companies'), null);
  assert.equal(url.searchParams.get('vote_count.lte'), null);
});

// normalizeDetail maps a TMDB /tv detail onto the movie-shaped object the rest of
// the recommender reads (taste.featureEntries, buildCorpus cards, the origin
// filter), so series flow through one code path. It's pure, so we test it directly.
test('normalizeDetail maps a TV detail onto the movie-shaped fields', () => {
  const tv = tmdb.normalizeDetail({
    id: 1399, name: 'Game of Stubs', first_air_date: '2011-04-17',
    number_of_seasons: 8, number_of_episodes: 73, origin_country: ['US'],
    keywords: { results: [{ id: 1, name: 'dragons' }] },
  }, 'tv');
  assert.equal(tv.media_type, 'tv');
  assert.equal(tv.title, 'Game of Stubs', 'name → title');
  assert.equal(tv.release_date, '2011-04-17', 'first_air_date → release_date');
  assert.equal(tv.seasons, 8);
  assert.equal(tv.episodes, 73);
  assert.deepEqual(tv.keywords.keywords, [{ id: 1, name: 'dragons' }], 'keywords.results → keywords.keywords');
  assert.deepEqual(tv.production_countries, [{ iso_3166_1: 'US' }], 'origin_country → production_countries for the origin filter');
});

test('normalizeDetail leaves a movie detail alone but tags its media_type', () => {
  const movie = tmdb.normalizeDetail({
    id: 550, title: 'Stub Club', release_date: '1999-10-15', runtime: 139,
    keywords: { keywords: [{ id: 2, name: 'soap' }] },
  }, 'movie');
  assert.equal(movie.media_type, 'movie');
  assert.equal(movie.title, 'Stub Club', 'a movie title is untouched');
  assert.equal(movie.runtime, 139);
  assert.equal(movie.seasons, undefined, 'no TV fields invented on a movie');
  assert.deepEqual(movie.keywords.keywords, [{ id: 2, name: 'soap' }]);
});

test('normalizeDetail collapses the TV seasons ARRAY to the season count', () => {
  // Real TMDB /tv detail ships `seasons` as per-season objects AND a
  // number_of_seasons scalar. The card needs the count; leaving the array makes it
  // render as "[object Object],…", so normalizeDetail must overwrite it.
  const tv = tmdb.normalizeDetail({
    id: 1396, name: 'Breaking Stub', number_of_seasons: 5, number_of_episodes: 62,
    seasons: [{ season_number: 0 }, { season_number: 1 }, { season_number: 2 }, { season_number: 3 }, { season_number: 4 }, { season_number: 5 }],
  }, 'tv');
  assert.equal(typeof tv.seasons, 'number', 'seasons is the scalar count, not the per-season array');
  assert.equal(tv.seasons, 5);
  assert.equal(tv.episodes, 62);
});
