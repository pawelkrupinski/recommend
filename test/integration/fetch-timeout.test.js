import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fetchWithTimeout } from '../../src/fetch.js';

// Stand up a throwaway HTTP server, run `fn` with its base URL, then tear it
// down (dropping any lingering sockets so the test process can exit).
async function withServer(handler, fn) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://localhost:${server.address().port}`;
  try {
    return await fn(base);
  } finally {
    server.closeAllConnections?.();
    server.close();
  }
}

test('fetchWithTimeout aborts a request the upstream never answers', async () => {
  await withServer(
    () => { /* deliberately never responds */ },
    async (base) => {
      await assert.rejects(
        () => fetchWithTimeout(base, {}, 50),
        (e) => e.name === 'TimeoutError' || e.name === 'AbortError',
      );
    },
  );
});

test('fetchWithTimeout resolves a response that arrives within the timeout', async () => {
  await withServer(
    (req, res) => res.end('ok'),
    async (base) => {
      const res = await fetchWithTimeout(base, {}, 1000);
      assert.equal(await res.text(), 'ok');
    },
  );
});
