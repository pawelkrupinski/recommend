// Unit tests for the read-through cache spine (src/cache.js) that the Trakt,
// MotN and IMDb/Metacritic clients now share. Uses the real SQLite cache via
// freshDbEnv() (a throwaway db), since that's the boring backing store the helper
// reads/writes — the behaviour under test is the read/produce/negative/transient
// semantics those clients depend on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDbEnv } from '../helpers/env.js';

freshDbEnv();
const { readThrough, DAY } = await import('../../src/cache.js');

test('DAY is one day in milliseconds', () => {
  assert.equal(DAY, 24 * 60 * 60 * 1000);
});

test('produces once on a miss, then serves the cached value', async () => {
  let calls = 0;
  const produce = async () => { calls++; return { v: 42 }; };
  assert.deepEqual(await readThrough('k:hit', DAY, produce), { v: 42 });
  assert.deepEqual(await readThrough('k:hit', DAY, produce), { v: 42 });
  assert.equal(calls, 1, 'second call served from cache, produce not re-run');
});

test('caches a negative result (null) so it is not re-produced', async () => {
  let calls = 0;
  const produce = async () => { calls++; return null; };
  assert.equal(await readThrough('k:neg', DAY, produce), null);
  assert.equal(await readThrough('k:neg', DAY, produce), null);
  assert.equal(calls, 1, 'the cached null short-circuits the second call');
});

test('a throwing produce yields null and is NOT cached (retries next time)', async () => {
  let calls = 0;
  const produce = async () => { calls++; if (calls === 1) throw new Error('blip'); return 'ok'; };
  assert.equal(await readThrough('k:throw', DAY, produce), null, 'transient fault → null');
  assert.equal(await readThrough('k:throw', DAY, produce), 'ok', 'left uncached → produce retried');
  assert.equal(calls, 2);
});
