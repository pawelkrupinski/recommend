// Integration tests: boot the real HTTP server in-process (on an ephemeral
// port) and drive it over fetch. Uses the dev-login bypass + TMDB stub so no
// OAuth round-trip and no network are needed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshDbEnv } from '../helpers/env.js';

const env = freshDbEnv();
const { server } = await import('../../src/server.js');

let base;
before(async () => {
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); env.cleanup(); });

// Minimal client: tracks one cookie string, follows nothing automatically.
function client() {
  let cookie = '';
  return {
    async raw(path, { method = 'GET', body } = {}) {
      const res = await fetch(base + path, {
        method,
        redirect: 'manual',
        headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const set = res.headers.getSetCookie?.() || [];
      if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
      return res;
    },
    async json(path, opts) {
      const res = await this.raw(path, opts);
      const data = await res.json().catch(() => null);
      return { status: res.status, data };
    },
    async login({ email = 'tester@example.com', admin = false, onboarded = true } = {}) {
      const q = new URLSearchParams({ email, ...(admin ? { admin: '1' } : {}), ...(onboarded ? {} : { onboarded: '0' }) });
      const res = await this.raw('/auth/dev-login?' + q);
      assert.equal(res.status, 302, 'dev-login redirects');
      return this;
    },
    get cookie() { return cookie; },
  };
}

test('GET /api/me is open and reports no user when logged out', async () => {
  const { status, data } = await client().json('/api/me');
  assert.equal(status, 200);
  assert.equal(data.user, null);
  assert.ok(Array.isArray(data.providers));
});

test('protected endpoints 401 without a session', async () => {
  const { status, data } = await client().json('/api/ratings');
  assert.equal(status, 401);
  assert.equal(data.error, 'login required');
});

test('dev-login establishes a session usable by /api/me', async () => {
  const c = await client().login({ email: 'alice@example.com' });
  const { status, data } = await c.json('/api/me');
  assert.equal(status, 200);
  assert.equal(data.user.email, 'alice@example.com');
  assert.equal(data.onboarded, true);
});

test('ratings: create, list, delete', async () => {
  const c = await client().login({ email: 'rater@example.com' });
  let r = await c.json('/api/ratings', { method: 'POST', body: { tmdb_id: 500, rating: 9, title: 'Heat', year: 1995 } });
  assert.equal(r.status, 200);
  r = await c.json('/api/ratings');
  assert.equal(r.data.ratings.length, 1);
  assert.equal(r.data.ratings[0].title, 'Heat');
  await c.json('/api/ratings', { method: 'DELETE', body: { tmdb_id: 500, media_type: 'movie' } });
  r = await c.json('/api/ratings');
  assert.equal(r.data.ratings.length, 0);
});

test('rate-queue hides rated, dismissed and not-seen titles (dismissed regression)', async () => {
  const c = await client().login({ email: 'queue@example.com' });
  // Stub /movie/popular returns ids 101..105.
  await c.json('/api/ratings', { method: 'POST', body: { tmdb_id: 102, rating: 7, title: 'P2' } });
  await c.json('/api/dismiss', { method: 'POST', body: { tmdb_id: 101 } });
  await c.json('/api/not-seen', { method: 'POST', body: { tmdb_id: 103 } });

  const { data } = await c.json('/api/rate-queue?page=1');
  const ids = data.items.map((m) => m.tmdb_id);
  assert.ok(!ids.includes(101), 'dismissed title is filtered out (the bug this guards)');
  assert.ok(!ids.includes(102), 'rated title is filtered out');
  assert.ok(!ids.includes(103), 'not-seen title is filtered out');
  assert.deepEqual(ids.sort(), [104, 105], 'only the untouched popular titles remain');
  // totalPages lets the client stop paging at the last page instead of
  // re-fetching it and duplicating cards in the onboarding queue.
  assert.equal(data.totalPages, 1, 'exposes the page count from TMDB');
});

test('settings: per-user country defaults to PL and persists', async () => {
  const c = await client().login({ email: 'settings@example.com' });
  let r = await c.json('/api/settings');
  assert.equal(r.data.country, 'PL');
  await c.json('/api/settings', { method: 'POST', body: { country: 'US' } });
  r = await c.json('/api/settings');
  assert.equal(r.data.country, 'US');
});

test('API key fields are ignored — keys come from the environment only', async () => {
  const c = await client().login({ email: 'plain@example.com' });
  // The settings endpoint no longer manages API keys; key fields are no-ops.
  const { status } = await c.json('/api/settings', { method: 'POST', body: { tmdbKey: 'sneaky' } });
  assert.equal(status, 200);
});

test('provider picker returns services for a region', async () => {
  const c = await client().login({ email: 'prov@example.com' });
  const { status, data } = await c.json('/api/providers?region=PL');
  assert.equal(status, 200);
  assert.ok(data.providers.some((p) => /netflix/i.test(p.name)), 'Netflix Test present from stub');
});

test('delete account erases the user and ends the session', async () => {
  const c = await client().login({ email: 'doomed@example.com' });
  await c.json('/api/ratings', { method: 'POST', body: { tmdb_id: 7, rating: 6, title: 'Se7en' } });
  const del = await c.raw('/api/me', { method: 'DELETE' });
  assert.equal(del.status, 200);
  // The same (now cleared/invalid) cookie no longer resolves to a user.
  const me = await c.json('/api/me');
  assert.equal(me.data.user, null);
});

test('onboarded=0 dev-login leaves the user needing onboarding', async () => {
  const c = await client().login({ email: 'fresh@example.com', onboarded: false });
  const { data } = await c.json('/api/me');
  assert.equal(data.user.email, 'fresh@example.com');
  assert.equal(data.onboarded, false);
});
