// Unit tests for the MotN client's caching behaviour under failure — the bit that
// guards the 500-req/month quota. A rate-limit / server fault must NOT be cached
// (the call retries later), while a confident 404 negative IS cached (no retry).
// Fetch is injected so a recorded response is replayed without spending quota.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDbEnv } from '../helpers/env.js';

freshDbEnv();
process.env.RAPIDAPI_KEY = 'motn-test-key'; // 'motn-' prefix → direct-API endpoint
const motn = await import('../../src/motn.js');

// A minimal MotN /shows response shaped like the real v4 API (streamingOptions
// keyed by lowercase country), enough to exercise the option mapper.
const showFixture = {
  streamingOptions: {
    pl: [{ service: { id: 'netflix', name: 'Netflix' }, type: 'subscription', link: 'https://netflix.com/title/1', quality: 'hd' }],
  },
};
const okFetch = async () => ({ status: 200, ok: true, json: async () => showFixture });

test('a 429 rate-limit is not cached — the next call retries instead of serving a poisoned negative', async () => {
  const r1 = await motn.streamingOptions(11, 'movie', 'PL', 'pl', async () => ({ status: 429, ok: false }));
  assert.equal(r1, null, 'a throttled call yields no availability');
  // Same title, now reachable: it must re-fetch (the 429 left the cache empty).
  const r2 = await motn.streamingOptions(11, 'movie', 'PL', 'pl', okFetch);
  assert.deepEqual(r2.map((o) => o.service), ['Netflix'], 'the retry succeeds, proving the 429 was never cached');
});

test('a 5xx server fault is likewise uncached', async () => {
  const r1 = await motn.streamingOptions(12, 'movie', 'PL', 'pl', async () => ({ status: 503, ok: false }));
  assert.equal(r1, null);
  const r2 = await motn.streamingOptions(12, 'movie', 'PL', 'pl', okFetch);
  assert.deepEqual(r2.map((o) => o.service), ['Netflix']);
});

test('a 404 negative IS cached — a title MotN does not know is not re-fetched (saves quota)', async () => {
  const a = await motn.streamingOptions(13, 'movie', 'PL', 'pl', async () => ({ status: 404, ok: false }));
  assert.equal(a, null);
  let called = false;
  const b = await motn.streamingOptions(13, 'movie', 'PL', 'pl', async () => { called = true; throw new Error('must not fetch'); });
  assert.equal(b, null);
  assert.equal(called, false, 'the cached 404 negative is served without a second network call');
});
