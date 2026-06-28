// Unit tests for the pure helper behind the Discover card's streaming-service
// icons. userServices() turns TMDB's appended watch/providers block into the
// subset of the user's *chosen* services that carry a title — what each card
// badges and deep-links. Importing taste.js is side-effect-free (its TMDB/DB
// deps only act when their functions are called), but freshDbEnv() still runs
// first because db.js opens SQLite at import time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDbEnv } from '../helpers/env.js';

freshDbEnv();
const { userServices } = await import('../../src/taste.js');

const full = (results) => ({ 'watch/providers': { results } });

test('returns only the user\'s chosen services that carry the title', () => {
  const movie = full({ PL: { flatrate: [
    { provider_id: 8, provider_name: 'Netflix', logo_path: '/n.png' },
    { provider_id: 337, provider_name: 'Disney+', logo_path: '/d.png' },
  ] } });
  const out = userServices(movie, 'PL', new Set([8]));
  assert.deepEqual(out, [{ id: 8, name: 'Netflix', logo: '/n.png' }]);
});

test('counts free and ad-supported tiers, not just subscription flatrate', () => {
  const movie = full({ PL: {
    free: [{ provider_id: 8, provider_name: 'Netflix', logo_path: '/n.png' }],
    ads: [{ provider_id: 9, provider_name: 'Prime', logo_path: '/p.png' }],
  } });
  const out = userServices(movie, 'PL', new Set([8, 9]));
  assert.deepEqual(out.map((s) => s.id).sort(), [8, 9]);
});

test('dedupes a service that appears in more than one tier', () => {
  const movie = full({ PL: {
    flatrate: [{ provider_id: 8, provider_name: 'Netflix', logo_path: '/n.png' }],
    ads: [{ provider_id: 8, provider_name: 'Netflix', logo_path: '/n.png' }],
  } });
  assert.equal(userServices(movie, 'PL', new Set([8])).length, 1);
});

test('empty when the title is on no chosen service (the not-streamable gate)', () => {
  const movie = full({ PL: { flatrate: [{ provider_id: 337, provider_name: 'Disney+', logo_path: '/d.png' }] } });
  assert.deepEqual(userServices(movie, 'PL', new Set([8])), []);
});

test('empty when the region has no providers block at all', () => {
  assert.deepEqual(userServices(full({ US: { flatrate: [] } }), 'PL', new Set([8])), []);
  assert.deepEqual(userServices({}, 'PL', new Set([8])), []);
});

test('tolerates a missing logo (null, so the card can fall back to a glyph)', () => {
  const movie = full({ PL: { flatrate: [{ provider_id: 8, provider_name: 'Netflix' }] } });
  assert.deepEqual(userServices(movie, 'PL', new Set([8])), [{ id: 8, name: 'Netflix', logo: null }]);
});
