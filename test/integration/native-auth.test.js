// Integration tests for the native-app OAuth handshake shared by Android and iOS:
// a native `platform` (android|ios) ends the OAuth dance by bouncing back into the
// app via the filmowo://auth-done deep link with a one-shot code, which the app
// trades at POST /auth/exchange for a session cookie in its OWN jar. The dev-login
// bypass drives the same code path, so these exercise it end-to-end without a real
// OAuth round-trip. The `filmowo://` scheme is OS-agnostic, so both platforms take
// the identical native branch.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshDbEnv } from '../helpers/env.js';
import { serve, client } from '../helpers/http.js';

const env = freshDbEnv();
const { server } = await import('../../src/server.js');

let base, close;
before(async () => { ({ base, close } = await serve(server)); });
after(() => { close(); env.cleanup(); });

// Pull the deep-link query param the native dev-login / callback redirects to.
async function nativeLogin(browser, platform, email) {
  const res = await browser.raw(`/auth/dev-login?platform=${platform}&email=${encodeURIComponent(email)}`);
  assert.equal(res.status, 302, `${platform} dev-login redirects to the deep link`);
  const loc = res.headers.get('location');
  assert.ok(loc.startsWith('filmowo://auth-done'), `deep link, got ${loc}`);
  return new URL(loc);
}

for (const platform of ['android', 'ios']) {
  test(`${platform}: the deep link carries a one-shot code and starts no browser session`, async () => {
    const browser = client(base);
    const url = await nativeLogin(browser, platform, `code-carrier-${platform}@example.com`);
    assert.ok(url.searchParams.get('code'), 'a code rides on the deep link');
    assert.equal(browser.cookie, '', 'no session cookie is set on the browser tab');
  });

  test(`${platform}: exchange trades the code for a session and adopts the app's anonymous data`, async () => {
    // The app builds anonymous history first (its own cookie jar).
    const app = client(base);
    await app.json('/api/me'); // mints the anon session
    await app.json('/api/ratings', { method: 'POST', body: { tmdb_id: 42, media_type: 'movie', rating: 9, title: 'Anon Fav', year: 2001 } });

    // A separate "browser" jar does the OAuth dance and yields the deep-link code.
    const url = await nativeLogin(client(base), platform, `merger-${platform}@example.com`);
    const code = url.searchParams.get('code');

    // The app redeems the code — this request carries the app's anon cookie.
    const ex = await app.json('/auth/exchange', { method: 'POST', body: { code } });
    assert.equal(ex.status, 200);
    assert.deepEqual(ex.data, { ok: true });

    // The app is now the real account, and its anonymous rating came along.
    const me = await app.json('/api/me');
    assert.equal(me.data.anonymous, false, 'the app holds a real session now');
    assert.equal(me.data.user.email, `merger-${platform}@example.com`);
    const ratings = await app.json('/api/ratings');
    assert.equal(ratings.data.ratings.length, 1, 'the anonymous rating was merged into the account');
    assert.equal(ratings.data.ratings[0].tmdb_id, 42);
  });
}

test('exchange rejects a malformed or unsigned code', async () => {
  const app = client(base);
  for (const code of ['', 'not-a-token', 'Zm9v.deadbeef']) {
    const { status } = await app.json('/auth/exchange', { method: 'POST', body: { code } });
    assert.equal(status, 400, `rejects ${JSON.stringify(code)}`);
  }
});
