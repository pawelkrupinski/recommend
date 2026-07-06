// The onboarding location cascade, server side. Two seams:
//   - /api/me seeds a brand-new visitor's country + language from a request
//     signal. The native app has no Cloudflare edge, so it sends its device
//     locale as `X-Device-Country` + `Accept-Language`; detection must honour
//     those exactly as it honours CF-IPCountry on the web.
//   - /api/geocode reverse-geocodes a browser GPS position to a country by
//     replaying a recorded provider response (no live HTTP).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshDbEnv, readFixture } from '../helpers/env.js';
import { serve, client } from '../helpers/http.js';

const env = freshDbEnv();
const { server } = await import('../../src/server.js');

let base, close;
before(async () => { ({ base, close } = await serve(server)); });
after(() => { close(); env.cleanup(); });

test('a fresh visitor is seeded from the app device-locale headers (no Cloudflare)', async () => {
  const app = client(base, { 'x-device-country': 'GB', 'accept-language': 'en-GB,en;q=0.9' });
  const { data } = await app.json('/api/me');
  assert.equal(data.detectedCountry, 'GB', 'device country becomes the detected country');
  assert.equal(data.country, 'GB', 'with nothing saved yet, country defaults to the detected one');
  assert.equal(data.language, 'en', 'GB has no localized UI language → English');
});

test('a Polish device seeds Polish as the interface language (from Accept-Language)', async () => {
  const app = client(base, { 'x-device-country': 'PL', 'accept-language': 'pl-PL,pl;q=0.9' });
  const { data } = await app.json('/api/me');
  assert.equal(data.detectedCountry, 'PL');
  assert.equal(data.detectedLanguage, 'pl');
  assert.equal(data.language, 'pl');
});

test('a phone whose region resolves to Poland defaults to a Polish interface', async () => {
  // Even from an English-locale device: a Poland region defaults the UI to Polish
  // (a default the user can switch in onboarding), matching the web edge behaviour.
  const app = client(base, { 'x-device-country': 'PL', 'accept-language': 'en-CA,en;q=0.9' });
  const { data } = await app.json('/api/me');
  assert.equal(data.detectedCountry, 'PL', 'streaming region follows the physical country');
  assert.equal(data.language, 'pl', 'Poland → Polish default');
});

test('/api/geocode reverse-geocodes a GPS position to a country', async () => {
  // Intercept only the outbound reverse-geocode call; let the test client's own
  // request to our server go through to real fetch.
  const real = globalThis.fetch;
  globalThis.fetch = async (u, opts) => (String(u).includes('bigdatacloud')
    ? { ok: true, json: async () => JSON.parse(readFixture('bigdatacloud-reverse-geocode.json')) }
    : real(u, opts));
  try {
    const { status, data } = await client(base).json('/api/geocode?lat=51.5&lng=-0.12');
    assert.equal(status, 200);
    assert.deepEqual(data, { country: 'GB' });
  } finally {
    globalThis.fetch = real;
  }
});

test('/api/geocode returns { country: null } for coordinates it can\'t resolve', async () => {
  const { data } = await client(base).json('/api/geocode?lat=999&lng=999');
  assert.deepEqual(data, { country: null }, 'bogus coordinates never hit the provider');
});
