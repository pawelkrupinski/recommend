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
});

test('the og:image is served as a PNG', async () => {
  const res = await fetch(base + '/og-home.png');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  const bytes = new Uint8Array(await res.arrayBuffer());
  // PNG magic number — proves it's a real image, not an HTML 404 fallback.
  assert.deepEqual([...bytes.slice(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
});
