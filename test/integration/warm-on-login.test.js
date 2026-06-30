// Warming the landing pool on arrival: when a returning, onboarded user hits the
// app, /api/me schedules a background corpus prebuild so their first Discover
// request is a cache hit rather than a cold gather+detail build — but only when
// the "all genres" landing pool isn't already cached fresh, so repeated /api/me
// polls (and freshly-served pools) don't re-trigger the expensive rebuild.
//
// We prove the decision (landingPoolFresh) deterministically rather than racing on
// the debounced timer: no fresh pool → warm wanted; after a build → fresh, skip;
// after an invalidating write → stale again, warm wanted.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshDbEnv } from '../helpers/env.js';

const env = freshDbEnv();               // TMDB_STUB=1 + a throwaway DB
process.env.DISABLE_REC_PREBUILD = '1'; // the warm's timer is off; we assert the decision
const { createAnonUser, upsertRating, setUserSetting } = await import('../../src/db.js');
const { recommend, invalidateRecommendations, landingPoolFresh } = await import('../../src/taste.js');
after(() => env.cleanup());

const REGION = 'PL', PROVIDERS = [8];

test('the landing pool is fresh only after it is built, and goes stale on a write', async () => {
  const user = createAnonUser();
  setUserSetting(user.id, 'country', REGION);
  setUserSetting(user.id, 'providers', PROVIDERS);
  for (let i = 0; i < 12; i++) {
    upsertRating({ user_id: user.id, tmdb_id: 900 + i, rating: 8, title: `Seed ${i}`, year: 2019 });
  }

  // Nothing built yet → the landing pool is not fresh, so arrival should warm it.
  assert.equal(landingPoolFresh(user.id, REGION, PROVIDERS), false, 'no pool yet → not fresh');

  // Build the all-genres landing pool (genreId undefined) the way a cold serve does.
  await recommend({ userId: user.id, region: REGION, providerIds: PROVIDERS, limit: 36 });
  assert.equal(landingPoolFresh(user.id, REGION, PROVIDERS), true, 'after the build the landing pool is fresh');

  // A rating bumps recGen → the cached pool is stale, so arrival should warm again.
  invalidateRecommendations(user.id);
  assert.equal(landingPoolFresh(user.id, REGION, PROVIDERS), false, 'an invalidating write makes it stale again');
});
