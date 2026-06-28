// Internationalization wiring: country/language detection on /api/me, the
// language setting round-trip, and that the chosen language is forwarded to TMDB
// (proved by the stub echoing it into the synopsis). Boots the real server with
// the TMDB stub, same pattern as api.test.js.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshDbEnv } from '../helpers/env.js';

const env = freshDbEnv();
process.env.DISABLE_REC_PREBUILD = '1'; // keep background builds off the test process
const { server } = await import('../../src/server.js');

let base;
before(async () => {
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); env.cleanup(); });

// Like api.test.js's client, but lets a test send extra request headers (so we
// can simulate Cloudflare's CF-IPCountry / a browser's Accept-Language).
function client(extraHeaders = {}) {
  let cookie = '';
  return {
    async raw(path, { method = 'GET', body } = {}) {
      const res = await fetch(base + path, {
        method,
        redirect: 'manual',
        headers: {
          ...extraHeaders,
          ...(cookie ? { cookie } : {}),
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const set = res.headers.getSetCookie?.() || [];
      if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
      return res;
    },
    async json(path, opts) {
      const res = await this.raw(path, opts);
      return { status: res.status, data: await res.json().catch(() => null) };
    },
  };
}

test('GET /api/me detects country + language from the Cloudflare header', async () => {
  const c = client({ 'cf-ipcountry': 'PL' });
  const { data } = await c.json('/api/me');
  assert.equal(data.detectedCountry, 'PL');
  assert.equal(data.detectedLanguage, 'pl');
  assert.equal(data.language, 'pl', 'a user who has not chosen yet defaults to the detected language');
});

test('GET /api/me falls back to English with no geo signal', async () => {
  const c = client();
  const { data } = await c.json('/api/me');
  assert.equal(data.detectedCountry, null);
  assert.equal(data.language, 'en');
});

test('the language setting round-trips and is validated', async () => {
  const c = client();
  await c.json('/api/me'); // mint the anonymous session
  await c.json('/api/settings', { method: 'POST', body: { language: 'pl' } });
  assert.equal((await c.json('/api/settings')).data.language, 'pl', 'saved language is returned');

  // An unsupported language is ignored, leaving the prior choice intact.
  await c.json('/api/settings', { method: 'POST', body: { language: 'fr' } });
  assert.equal((await c.json('/api/settings')).data.language, 'pl', 'invalid language is rejected');
});

test('the chosen language is forwarded to TMDB for the synopsis', async () => {
  // A fresh visitor with no signal gets English synopses (en-US).
  const en = client();
  const enItems = (await en.json('/api/rate-queue?page=1')).data.items;
  assert.ok(enItems[0].overview.includes('[en-US]'),
    `default English request should carry en-US, got: ${enItems[0].overview}`);

  // After choosing Polish, the synopsis comes back localized (pl-PL forwarded).
  const pl = client();
  await pl.json('/api/me');
  await pl.json('/api/settings', { method: 'POST', body: { language: 'pl' } });
  const plItems = (await pl.json('/api/rate-queue?page=1')).data.items;
  assert.ok(plItems[0].overview.includes('[pl-PL]'),
    `Polish request should carry pl-PL, got: ${plItems[0].overview}`);
});
