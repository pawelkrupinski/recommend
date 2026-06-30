// /api/enrich resolves IMDb/Metacritic ratings + tone tags for a screenful of
// pick ids on demand — the slow web lookups that used to run inline during the
// recommendation build, now deferred off its critical path so picks paint fast.
// We assert the response shape and that seeded stored tones come back; the
// IMDb/Metacritic scrapes are inert under the TMDB stub (they'd hit the network),
// exactly as in a built pool, so we assert their keys are present, not values.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshDbEnv } from '../helpers/env.js';

const env = freshDbEnv();
const { server } = await import('../../src/server.js');
const { setMovieToneSource } = await import('../../src/db.js');
const { serve, client } = await import('../helpers/http.js');

let base, close;
before(async () => { ({ base, close } = await serve(server)); });
after(() => { close(); env.cleanup(); });

test('GET /api/enrich returns ratings + tones keyed by media_type:id, surfacing seeded stored tones', async () => {
  // Seed a stored tone for one title so the tone path returns real data even
  // though the scraper feeders are inert under the stub (no proxy / no model).
  setMovieToneSource(101, 'movie', 'model', ['heartfelt']);
  const c = client(base); // an anonymous session is enough; enrichment is per-title

  // A bare id is taken as a movie (back-compat); `tv:401` enriches the series. The
  // response keys by media_type:id so a film and a show sharing a tmdb id don't clash.
  const { status, data } = await c.json('/api/enrich?ids=101,102,tv:401');
  assert.equal(status, 200);
  for (const key of ['movie:101', 'movie:102', 'tv:401']) {
    assert.ok(data[key], `an entry for ${key}`);
    assert.ok('imdbRating' in data[key] && 'metascore' in data[key], 'rating keys present (null under the stub)');
    assert.ok(Array.isArray(data[key].tones), 'tones is an array');
  }
  assert.ok(data['movie:101'].tones.some((t) => t.slug === 'heartfelt'), 'the seeded stored tone surfaces');
});

test('GET /api/enrich ignores blank/garbage ids and returns {} for none', async () => {
  const c = client(base);
  const { status, data } = await c.json('/api/enrich?ids=,,abc');
  assert.equal(status, 200);
  assert.deepEqual(data, {}, 'no valid ids → empty map, not an error');
});
