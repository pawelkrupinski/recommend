// The background prebuild used to eagerly build a corpus for EVERY TMDB genre
// (all-genres + ~17 per-genre pools), run sequentially through the single build
// worker. On the shared-cpu-1x host that monopolised the one core (and the
// worker) for minutes, so a user's foreground "give me my picks" request queued
// behind it — and it inflated the capped TMDB detail cache's working set ~17x,
// thrashing it. Prebuild should warm only the unfiltered all-genres pool (the
// landing view); a specific genre builds lazily the first time it's actually
// viewed, then caches. This pins that: after a prebuild the all-genres corpus is
// warm but a per-genre corpus is not.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshDbEnv } from '../helpers/env.js';

const env = freshDbEnv();               // sets TMDB_STUB=1 + a throwaway DB
process.env.DISABLE_REC_PREBUILD = '1'; // we call prebuildRecommendations directly; don't also auto-schedule
const { createAnonUser, upsertRating, setUserSetting, cacheGet } = await import('../../src/db.js');
const { prebuildRecommendations, resolveFilters, corpusKey } = await import('../../src/taste.js');
const { tmdbLang, DEFAULT_LANGUAGE } = await import('../../src/locale.js');
after(() => env.cleanup());

const REGION = 'PL', PROVIDERS = [8], GENRE = 28; // 28 = Action, a genre the stub serves
const LANG = tmdbLang(DEFAULT_LANGUAGE);          // the language segment prebuild keys its corpora under

test('prebuild warms only the all-genres pool; per-genre pools stay lazy', async () => {
  const user = createAnonUser();
  setUserSetting(user.id, 'country', REGION);
  setUserSetting(user.id, 'providers', PROVIDERS);
  for (let i = 0; i < 12; i++) {
    upsertRating({ user_id: user.id, tmdb_id: 900 + i, rating: 8, title: `Seed ${i}`, year: 2019 });
  }

  await prebuildRecommendations(user.id);

  const filters = resolveFilters();
  const allGenres = cacheGet(corpusKey(user.id, REGION, PROVIDERS, undefined, LANG, filters));
  assert.ok(allGenres?.cards?.length, 'the all-genres corpus is warmed by prebuild');

  const perGenre = cacheGet(corpusKey(user.id, REGION, PROVIDERS, GENRE, LANG, filters));
  assert.ok(
    !perGenre,
    'a specific genre is NOT eagerly prebuilt — it builds on demand the first time it is viewed, ' +
    'so the single build worker is freed and the TMDB cache working set stays small',
  );
});
