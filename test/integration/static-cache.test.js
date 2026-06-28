// Static assets must revalidate on every load. index.html references a bare
// /app.js and /styles.css (no fingerprint), so any caching that lets the browser
// skip revalidation leaves a returning user running an old app.js against a fresh
// index.html after a deploy — the exact mismatch that hid a newly-added tab.
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

for (const asset of ['/app.js', '/styles.css', '/index.html']) {
  test(`${asset} revalidates every load (no stale-asset window)`, async () => {
    const res = await fetch(base + asset);
    assert.equal(res.status, 200);
    // max-age=0 forces a conditional GET on every load rather than serving a
    // cached copy blind for some window.
    assert.equal(res.headers.get('cache-control'), 'public, max-age=0, must-revalidate');
    const etag = res.headers.get('etag');
    assert.ok(etag, 'carries an ETag for the conditional GET');

    // The revalidation is cheap: an unchanged asset comes back as a 304.
    const again = await fetch(base + asset, { headers: { 'if-none-match': etag } });
    assert.equal(again.status, 304, 'matching ETag yields a 304, not a re-shipped body');
  });
}
