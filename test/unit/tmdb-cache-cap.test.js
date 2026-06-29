// The TMDB detail/list cache is global (keyed by request URL) and shared across
// every user's build, so its row cap is really "how many distinct titles can stay
// warm across the active users' pools at once". When the cap is smaller than that
// working set, builds keep evicting and re-fetching the same popular titles — the
// thrash that pinned cold-build detailsMs into the tens of seconds. This pins the
// cap at a size that holds a realistic multi-user working set (well over the old
// 5000): fill past 5000 and assert nothing was evicted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createKvCache } from '../../src/kv-cache.js';
import { TMDB_CACHE_MAX_ROWS } from '../../src/tmdb-cache.js';

test('the TMDB cache cap holds a multi-user working set without eviction', () => {
  // A monotonic clock so eviction order is deterministic (no wall-clock ties).
  let tick = 0;
  const db = new DatabaseSync(':memory:');
  const cache = createKvCache(db, { maxRows: TMDB_CACHE_MAX_ROWS, now: () => ++tick });

  // ~6000 distinct titles — more than one user's pool, the scale a few users
  // browsing the all-genres pool plus a genre or two reach. Comfortably over the
  // old 5000 default, comfortably under the new one.
  const WORKING_SET = 6000;
  for (let i = 0; i < WORKING_SET; i++) cache.set(`tmdb:/movie/${i}`, { id: i });
  cache.evictNow();

  assert.ok(
    TMDB_CACHE_MAX_ROWS >= WORKING_SET,
    `cap ${TMDB_CACHE_MAX_ROWS} is below the ${WORKING_SET}-title working set this guards`,
  );
  assert.equal(
    cache.count(), WORKING_SET,
    'every title in the working set stayed cached — the cap did not evict and force re-fetches',
  );
  assert.ok(cache.get('tmdb:/movie/0'), 'the oldest title is still warm (not evicted)');
});
