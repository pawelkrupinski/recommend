// The fast foreground "head" build stops fetching candidate details once enough
// survive to fill a page (buildCorpus survivorTarget), so picks paint after a
// fraction of the full ~500-candidate fetch; the deeper background build (no
// target) fetches them all and replaces it. We prove the contrast over the stub's
// large provider-9 candidate set: the head pool is shallower and flagged partial,
// the full pool is deeper and complete, and the head still fills a page.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshDbEnv } from '../helpers/env.js';

const env = freshDbEnv();
process.env.DISABLE_REC_PREBUILD = '1'; // no background rebuild racing the assertions
const { createAnonUser, upsertRating } = await import('../../src/db.js');
const { buildAndCache } = await import('../../src/taste.js');
after(() => env.cleanup());

const REGION = 'PL', PROVIDERS = [9]; // the stub backfills a large streamable set here

test('a head build stops early (shallower + partial); the full build is deep + complete', async () => {
  const user = createAnonUser();
  for (let i = 0; i < 12; i++) {
    upsertRating({ user_id: user.id, tmdb_id: 900 + i, rating: 8, title: `Seed ${i}`, year: 2019 });
  }

  const head = await buildAndCache({ userId: user.id, region: REGION, providerIds: PROVIDERS, survivorTarget: 60 });
  const full = await buildAndCache({ userId: user.id, region: REGION, providerIds: PROVIDERS });

  assert.equal(full.partial, false, 'the full build fetched the whole candidate set');
  assert.equal(head.partial, true, 'the head build stopped early with candidates still unfetched');
  assert.ok(head.pool.length >= 36, `the head still fills a page (got ${head.pool.length})`);
  assert.ok(
    head.pool.length < full.pool.length,
    `the head pool (${head.pool.length}) is shallower than the full pool (${full.pool.length})`,
  );
});
