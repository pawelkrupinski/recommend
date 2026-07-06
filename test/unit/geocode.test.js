// reverseGeocode turns a browser GPS coordinate into an ISO country code by
// replaying a recorded provider response — no live HTTP. It must degrade to null
// (never throw) on bogus input, a non-200, or a network failure so the web
// onboarding cascade can fall through to its locale / server signal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reverseGeocode } from '../../src/geocode.js';
import { readFixture } from '../helpers/env.js';

const fixture = readFixture('bigdatacloud-reverse-geocode.json');

// Swap the global fetch for the duration of `fn` (the codebase's stub pattern).
async function withFetch(impl, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = impl;
  try { return await fn(); } finally { globalThis.fetch = real; }
}

test('reverseGeocode returns the provider country code for a valid position', async () => {
  const country = await withFetch(
    async () => ({ ok: true, json: async () => JSON.parse(fixture) }),
    () => reverseGeocode(51.5, -0.12),
  );
  assert.equal(country, 'GB');
});

test('reverseGeocode rejects out-of-range / non-finite coordinates before calling out', async () => {
  let called = false;
  await withFetch(async () => { called = true; return { ok: true, json: async () => ({}) }; }, async () => {
    assert.equal(await reverseGeocode(NaN, 0), null, 'NaN latitude → null');
    assert.equal(await reverseGeocode(91, 0), null, 'latitude past the pole → null');
    assert.equal(await reverseGeocode(0, 181), null, 'longitude past the antimeridian → null');
  });
  assert.equal(called, false, 'no lookup is attempted for bad coordinates');
});

test('reverseGeocode degrades to null on a non-200 or a thrown request', async () => {
  assert.equal(await withFetch(async () => ({ ok: false }), () => reverseGeocode(51.5, -0.12)), null);
  assert.equal(await withFetch(async () => { throw new Error('offline'); }, () => reverseGeocode(51.5, -0.12)), null);
});

test('reverseGeocode ignores a provider payload without a well-formed country code', async () => {
  const country = await withFetch(
    async () => ({ ok: true, json: async () => ({ countryCode: '' }) }),
    () => reverseGeocode(51.5, -0.12),
  );
  assert.equal(country, null);
});
