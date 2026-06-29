// Unit tests for the TMDB watch-providers availability source (the free middle
// source that spares MotN's quota). The pure mapper turns a region's provider
// buckets into the shared availability-option shape — with no per-service deep
// link, since TMDB doesn't expose one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDbEnv } from '../helpers/env.js';

// tmdb-availability -> tmdb -> db.js opens SQLite at import; point at a throwaway db.
freshDbEnv();
const { regionToOptions } = await import('../../src/tmdb-availability.js');

test('maps flatrate/free buckets to subscription-style options with no deep link', () => {
  const out = regionToOptions({
    link: 'https://tmdb/watch',
    flatrate: [{ provider_id: 8, provider_name: 'Netflix' }],
    free: [{ provider_id: 2, provider_name: 'Pluto TV' }],
  });
  assert.deepEqual(out, [
    { service: 'Netflix', serviceId: 8, type: 'subscription', link: null },
    { service: 'Pluto TV', serviceId: 2, type: 'free', link: null },
  ]);
});

test('keeps one option per service when a provider repeats across buckets (highest tier wins)', () => {
  const out = regionToOptions({
    flatrate: [{ provider_id: 8, provider_name: 'Netflix' }],
    ads: [{ provider_id: 8, provider_name: 'Netflix' }],
  });
  assert.deepEqual(out, [{ service: 'Netflix', serviceId: 8, type: 'subscription', link: null }]);
});

test('drops providers with no id (cannot be tied to a service)', () => {
  assert.deepEqual(regionToOptions({ flatrate: [{ provider_name: 'Mystery' }] }), []);
});

test('an unknown region is empty, not an error', () => {
  assert.deepEqual(regionToOptions(undefined), []);
});
