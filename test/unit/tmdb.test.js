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
