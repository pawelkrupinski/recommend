// The asset build (esbuild) bundles + minifies + content-hashes the browser
// assets into public/dist/, and the server serves those fingerprinted files as
// `immutable` (safe: the URL changes when the bytes do) while the HTML shell
// keeps revalidating so a new deploy is picked up. This guards all three:
// the build shrinks the assets and fingerprints them, the generated shell
// points at the hashed names, and the server caches them correctly.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { freshDbEnv } from '../helpers/env.js';
import { buildAssets } from '../../scripts/build-assets.js';

const PUBLIC = new URL('../../public/', import.meta.url);
const DIST = new URL('../../public/dist/', import.meta.url);

// Build BEFORE importing the server: serveStatic resolves the dist/ shell once,
// so the fingerprinted index.html must already exist when the module loads.
const built = await buildAssets({ quiet: true });

const env = freshDbEnv();
const { server } = await import('../../src/server.js');

let base;
before(async () => {
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); env.cleanup(); });

// Combined bytes of the un-minified module graph (every .js under public/, which
// is exactly app.js + the siblings it imports) — robust to the graph growing.
async function rawGraphBytes() {
  const names = (await readdir(PUBLIC)).filter((n) => n.endsWith('.js'));
  let total = 0;
  for (const n of names) total += (await stat(new URL(n, PUBLIC))).size;
  return total;
}

test('emits a fingerprinted JS bundle smaller than its raw module graph', async () => {
  assert.match(built.jsName, /^app\.[0-9A-Za-z]+\.js$/, 'hashed app.<hash>.js name');
  const bundle = (await stat(new URL(built.jsName, DIST))).size;
  const raw = await rawGraphBytes();
  assert.ok(bundle < raw, `minified bundle ${bundle}B should be < raw graph ${raw}B`);
});

test('emits a fingerprinted, minified CSS file smaller than the source', async () => {
  assert.match(built.cssName, /^styles\.[0-9A-Za-z]+\.css$/, 'hashed styles.<hash>.css name');
  const min = (await stat(new URL(built.cssName, DIST))).size;
  const raw = (await stat(new URL('styles.css', PUBLIC))).size;
  assert.ok(min < raw, `minified css ${min}B should be < raw ${raw}B`);
});

test('the generated shell references the hashed asset names', async () => {
  const html = await readFile(new URL('index.html', DIST), 'utf8');
  assert.ok(html.includes(`/dist/${built.jsName}`), 'shell points at hashed JS');
  assert.ok(html.includes(`/dist/${built.cssName}`), 'shell points at hashed CSS');
  // No bare references to the un-hashed originals leak through.
  assert.ok(!/"\/app\.js"/.test(html) && !/"\/styles\.css"/.test(html), 'no un-hashed refs remain');
});

for (const kind of ['jsName', 'cssName']) {
  test(`serves the fingerprinted ${kind} asset as immutable`, async () => {
    const res = await fetch(`${base}/dist/${built[kind]}`);
    assert.equal(res.status, 200);
    // Content hash in the URL → cache for a year and never revalidate.
    assert.equal(res.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    // Compression of static text assets still applies to the hashed files.
    const br = await fetch(`${base}/dist/${built[kind]}`, { headers: { 'accept-encoding': 'br' } });
    assert.equal(br.headers.get('content-encoding'), 'br', 'brotli-compressed like other static text');
  });
}

test('the HTML shell stays revalidate-always so deploys are picked up', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'public, max-age=0, must-revalidate');
  // The served shell is the built one — it names the current hashed bundle.
  const body = await res.text();
  assert.ok(body.includes(`/dist/${built.jsName}`), 'serves the fingerprinted shell, not the raw template');
});
