// The homepage must carry an Open Graph / Twitter card so links shared on
// Facebook, Slack, iMessage… render a rich preview (mirrors ../movies' og tags),
// and the preview image it points at must actually be served as a PNG.
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

test('homepage exposes Open Graph + Twitter preview tags', async () => {
  const html = await (await fetch(base + '/')).text();

  // The crawler reads the card off the served HTML, so assert the tags are present.
  assert.match(html, /<meta property="og:title" content="recommend[^"]*"/);
  assert.match(html, /<meta property="og:type" content="website"/);
  assert.match(html, /<meta property="og:image" content="https:\/\/[^"]+\/og-home\.png"/);
  assert.match(html, /<meta property="og:image:width" content="1200"/);
  assert.match(html, /<meta property="og:image:height" content="630"/);
  assert.match(html, /<meta name="twitter:card" content="summary_large_image"/);
  assert.match(html, /<meta name="twitter:image" content="https:\/\/[^"]+\/og-home\.png"/);
  // Canonical + favicon, to match ../movies' head.
  assert.match(html, /<link rel="canonical" href="https:\/\/[^"]+\/"/);
  assert.match(html, /<link rel="icon" type="image\/svg\+xml" href="\/favicon\.svg"/);
});

test('the crawler-facing absolute URLs point at the live Fly host', async () => {
  // og:url / canonical / og:image must be absolute (crawlers reject relative)
  // and must name the host that's actually serving — the app moved off Render,
  // so a lingering onrender.com link would 404 the preview image and split the
  // canonical from where the page really lives.
  const html = await (await fetch(base + '/')).text();
  assert.doesNotMatch(html, /onrender\.com/, 'no links to the decommissioned Render host');
  assert.match(html, /<meta property="og:url" content="https:\/\/filmowo\.fly\.dev\/"/);
  assert.match(html, /<link rel="canonical" href="https:\/\/filmowo\.fly\.dev\/"/);
  assert.match(html, /<meta property="og:image" content="https:\/\/filmowo\.fly\.dev\/og-home\.png"/);
});

test('the og:image is served as a PNG', async () => {
  const res = await fetch(base + '/og-home.png');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  const bytes = new Uint8Array(await res.arrayBuffer());
  // PNG magic number — proves it's a real image, not an HTML 404 fallback.
  assert.deepEqual([...bytes.slice(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
});

test('the default homepage is English and advertises the Polish alternate', async () => {
  const res = await fetch(base + '/');
  const html = await res.text();
  assert.match(html, /<meta property="og:title" content="recommend[^"]*"/);
  assert.match(html, /<meta property="og:locale" content="en_US"/);
  assert.match(html, /<meta property="og:locale:alternate" content="pl_PL"/);
  // `private` so Cloudflare never caches one language's shell for everyone.
  assert.match(res.headers.get('cache-control'), /\bprivate\b/);
});

// A Polish preview is served when the request signals Polish — Facebook's
// ?fb_locale re-scrape, the Cloudflare country header, or Accept-Language.
for (const [label, init, path] of [
  ['?fb_locale=pl_PL', {}, '/?fb_locale=pl_PL'],
  ['CF-IPCountry: PL', { headers: { 'cf-ipcountry': 'PL' } }, '/'],
  ['Accept-Language: pl', { headers: { 'accept-language': 'pl-PL,pl;q=0.9' } }, '/'],
]) {
  test(`homepage is localized to Polish for ${label}`, async () => {
    const html = await (await fetch(base + path, init)).text();
    assert.match(html, /<meta property="og:title" content="Filmowo — co obejrzeć[^"]*"/);
    assert.match(html, /<meta property="og:site_name" content="Filmowo"/);
    assert.match(html, /<meta property="og:image" content="https:\/\/[^"]+\/og-home-pl\.png"/);
    assert.match(html, /<meta property="og:locale" content="pl_PL"/);
    assert.match(html, /<html lang="pl"/);
  });
}

test('the Polish og:image is served as a PNG', async () => {
  const res = await fetch(base + '/og-home-pl.png');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  const bytes = new Uint8Array(await res.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
});

test('robots.txt is served as text and allows crawlers (Facebook needs it)', async () => {
  // A missing robots.txt 404s, which Facebook's crawler reports as a robots
  // block and refuses to scrape. Serve an explicit allow-all instead.
  const res = await fetch(base + '/robots.txt');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/plain/);
  const body = await res.text();
  assert.match(body, /User-agent:\s*\*/i);
  assert.match(body, /Allow:\s*\//i);
  assert.doesNotMatch(body, /Disallow:\s*\/\s*$/im, 'must not blanket-disallow the site');
});

test('the favicon is served as an SVG', async () => {
  const res = await fetch(base + '/favicon.svg');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/svg+xml');
  assert.match(await res.text(), /<svg/);
});
