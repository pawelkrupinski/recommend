// The recommendation build (gather → ~500 detail fetches → score → enrich) is
// synchronous enough to block the main event loop for seconds, stalling /health
// and live requests. taste.js exposes a build-runner seam (setBuildRunner) so the
// composition root can move that build onto a worker thread; these tests exercise
// that seam end to end with the TMDB stub (offline, deterministic) + a throwaway
// DB, and prove the default stays inline and concurrent builds coalesce.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshDbEnv } from '../helpers/env.js';

const env = freshDbEnv();                 // TMDB_STUB=1 + a throwaway DB
process.env.DISABLE_REC_PREBUILD = '1';   // no background prebuild racing the test
const { createAnonUser, upsertRating, getRatings, cacheGet, cacheSet } = await import('../../src/db.js');
const { recommend, buildProfile, setBuildRunner, resetBuildRunner, poolKey, resolveFilters } =
  await import('../../src/taste.js');
const { createWorkerBuildRunner } = await import('../../src/build-worker-client.js');

after(() => env.cleanup());

const REGION = 'PL', PROVIDERS = [8]; // provider 8 = the stub's streamable service in PL
const FILTERS = resolveFilters();
const cachedPool = (userId, genreId) =>
  cacheGet(poolKey(userId, REGION, PROVIDERS, genreId, undefined, FILTERS));

// 12 ratings clears RATE_GOAL so a real taste profile + candidate seeds exist.
function seedUser() {
  const user = createAnonUser();
  for (let i = 0; i < 12; i++) {
    upsertRating({ user_id: user.id, tmdb_id: 900 + i, rating: 8, title: `Seed ${i}`, year: 2019 });
  }
  return user;
}

test('the worker build runner builds a pool off-thread and recommend serves it', async () => {
  const runner = createWorkerBuildRunner();
  setBuildRunner(runner);
  try {
    const user = seedUser();
    const { results } = await recommend({ userId: user.id, region: REGION, providerIds: PROVIDERS, limit: 36 });
    assert.ok(results.length > 0, 'the worker-built pool is non-empty');
    assert.ok(results.some((r) => /^Stub /.test(r.title)), 'served the deterministic stub titles');
    // The worker built on its own thread + DB connection and wrote the pool to the
    // shared WAL DB; the main thread reads it straight back under the same key.
    assert.ok(cachedPool(user.id)?.pool?.length > 0, 'the worker persisted the pool to the shared SQLite DB');
  } finally {
    await runner.terminate();
    resetBuildRunner();
  }
});

test('the worker accepts a structured-cloned profile (Maps + arrays) from prebuild', async () => {
  const runner = createWorkerBuildRunner();
  setBuildRunner(runner);
  try {
    const user = seedUser();
    const profile = await buildProfile(user.id);
    assert.ok(profile.pos instanceof Map && Array.isArray(profile.ratedFeatureSets),
      'the profile carries Maps + arrays that must survive postMessage');
    // Drive the runner exactly as prebuild does — handing profile/ratings across the
    // thread boundary. A non-clonable field would throw DataCloneError on postMessage.
    await runner({ userId: user.id, region: REGION, providerIds: PROVIDERS, genreId: undefined,
      profile, ratings: getRatings(user.id), filters: FILTERS });
    assert.ok(cachedPool(user.id)?.pool?.length > 0, 'the worker built + cached the pool from the cloned profile');
  } finally {
    await runner.terminate();
    resetBuildRunner();
  }
});

test('the default build runner is inline — recommend builds with no worker wired', async () => {
  resetBuildRunner(); // the module default; no createWorkerBuildRunner() was called
  const user = seedUser();
  const { results } = await recommend({ userId: user.id, region: REGION, providerIds: PROVIDERS, limit: 36 });
  assert.ok(results.length > 0, 'the inline default build yields a pool');
  assert.ok(results.some((r) => /^Stub /.test(r.title)), 'served the deterministic stub titles');
});

test('concurrent identical builds share one runner invocation (dedup by poolKey)', async () => {
  const user = seedUser();
  let calls = 0;
  setBuildRunner(async (args) => {
    calls++;
    await new Promise((r) => setTimeout(r, 40)); // hold so both requests overlap in-flight
    cacheSet(
      poolKey(args.userId, args.region, args.providerIds, args.genreId, args.language, args.filters || resolveFilters()),
      { gen: 0, profileSize: 1, pool: [{ tmdb_id: 424242, title: 'Deduped Pick' }] },
    );
  });
  try {
    const [a, b] = await Promise.all([
      recommend({ userId: user.id, region: REGION, providerIds: PROVIDERS, limit: 5, force: true }),
      recommend({ userId: user.id, region: REGION, providerIds: PROVIDERS, limit: 5, force: true }),
    ]);
    assert.equal(calls, 1, 'the two racing builds coalesced into one runner call');
    assert.ok(a.results.length && b.results.length, 'both callers got the shared, freshly-built pool');
    assert.equal(a.results[0].title, 'Deduped Pick');
  } finally {
    resetBuildRunner();
  }
});
