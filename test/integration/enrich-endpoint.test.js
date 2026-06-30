// /api/enrich resolves IMDb/Metacritic ratings + tone tags for a screenful of
// pick ids on demand — the slow web lookups that used to run inline during the
// recommendation build, now deferred off its critical path so picks paint fast.
// The response is NDJSON: one `{ key, imdbRating, metascore, imdb_id, tones }`
// line per title, streamed as it resolves so a card lights up without waiting on
// the slowest title. We assert the per-line shape and that seeded stored tones
// come back; the IMDb/Metacritic scrapes are inert under the TMDB stub (they'd
// hit the network), so we assert their keys are present, not values.
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

// Collect the streamed lines into a key→payload map for easy assertions.
const byKey = (rows) => Object.fromEntries(rows.map(({ key, ...payload }) => [key, payload]));

test('GET /api/enrich streams an NDJSON line per title, keyed by media_type:id, surfacing seeded stored tones', async () => {
  // Seed a stored tone for one title so the tone path returns real data even
  // though the scraper feeders are inert under the stub (no proxy / no model).
  setMovieToneSource(101, 'movie', 'model', ['heartfelt']);
  const c = client(base); // an anonymous session is enough; enrichment is per-title

  // A bare id is taken as a movie (back-compat); `tv:401` enriches the series. Each
  // line keys by media_type:id so a film and a show sharing a tmdb id don't clash.
  const { status, rows } = await c.ndjson('/api/enrich?ids=101,102,tv:401');
  assert.equal(status, 200);
  const data = byKey(rows);
  for (const key of ['movie:101', 'movie:102', 'tv:401']) {
    assert.ok(data[key], `a streamed line for ${key}`);
    assert.ok('imdbRating' in data[key] && 'metascore' in data[key], 'rating keys present (null under the stub)');
    assert.ok(Array.isArray(data[key].tones), 'tones is an array');
  }
  assert.ok(data['movie:101'].tones.some((t) => t.slug === 'heartfelt'), 'the seeded stored tone surfaces');
});

test('GET /api/enrich ignores blank/garbage ids and streams nothing for none', async () => {
  const c = client(base);
  const { status, rows } = await c.ndjson('/api/enrich?ids=,,abc');
  assert.equal(status, 200);
  assert.deepEqual(rows, [], 'no valid ids → empty stream, not an error');
});
