// Regression test for the production health-check-kill loop: node:sqlite is
// fully synchronous and warm TMDB cache hits resolve without real I/O, so a
// recommendation build used to run as one unbroken microtask chain that never
// let the event loop reach its poll phase. /health (and live requests) were
// starved for the whole build; on a shared-CPU host that overran the platform's
// 5s health-check timeout and the instance was killed mid-build — a boot/use
// crash loop. The build must now yield periodically so the loop keeps breathing.
//
// We exercise the REAL synchronous cache path (not the TMDB_STUB fixture path,
// whose per-call dynamic import() incidentally schedules macrotasks and would
// mask the starvation): warm the cache once over a stubbed fetch, then assert
// the second, fully cache-served build hands control back to the event loop.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshDbEnv } from '../helpers/env.js';

const env = freshDbEnv();
delete process.env.TMDB_STUB; // take the real cacheGet path, not the stub
const { createAnonUser, upsertRating, setSetting } = await import('../../src/db.js');
const { buildProfile } = await import('../../src/taste.js');

const realFetch = globalThis.fetch;
after(() => { globalThis.fetch = realFetch; env.cleanup(); });

const detailJson = (id) => ({
  id, title: `Movie ${id}`, release_date: '2020-01-01', runtime: 100,
  vote_average: 7, poster_path: null, overview: '',
  genres: [{ id: 28, name: 'Action' }],
  keywords: { keywords: [{ id: 1, name: 'k' }] },
  credits: { crew: [{ id: 9, job: 'Director', name: 'D' }], cast: [{ id: 5, name: 'A' }] },
  external_ids: { imdb_id: `tt${id}` },
});

test('a fully cache-served build yields the event loop instead of starving it', async () => {
  setSetting('tmdbKey', 'test-key'); // satisfy auth() without TMDB_STUB
  // Stubbed network only for the one-time cache warm below.
  globalThis.fetch = async (url) => ({
    ok: true, status: 200,
    async json() { return detailJson(Number(String(url).match(/\/movie\/(\d+)/)[1])); },
    async text() { return ''; },
  });

  // Enough rated movies that the profile build's detail loop spans several
  // event-loop turns — the real-world starvation condition.
  const user = createAnonUser();
  for (let id = 1; id <= 50; id++) {
    upsertRating({ user_id: user.id, tmdb_id: id, rating: 8, title: `Movie ${id}` });
  }

  // Warm the TMDB cache so the measured run below is pure synchronous cache
  // reads (node:sqlite) with no network/import — exactly the prod hot path.
  await buildProfile(user.id);

  let buildFinished = false;
  let probeFiredDuringBuild = false;
  // A setTimeout callback is a timers-phase macrotask: it can only run if the
  // build releases the event loop. While the build holds the loop in an unbroken
  // microtask chain this stays pending until the build completes (buildFinished
  // already true). If the build yields, it fires mid-build instead.
  const probe = new Promise((resolve) => setTimeout(() => {
    probeFiredDuringBuild = !buildFinished;
    resolve();
  }, 0));

  const build = buildProfile(user.id).then(() => { buildFinished = true; });

  await Promise.all([build, probe]);

  assert.ok(
    probeFiredDuringBuild,
    'the event loop was starved for the entire build — /health would time out and the host would kill the instance',
  );
});
