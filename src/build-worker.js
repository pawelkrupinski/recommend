// Worker-thread entry for the recommendation build. Runs the heavy, synchronous
// build (gather → candidate detail fetches → score) off the main event loop so
// /watchlist, /health and live requests stay responsive while a build runs.
// (Rating/tone enrichment is no longer part of the build — see taste.enrichPicks.)
//
// The worker opens its OWN node:sqlite connection (db.js does this at import,
// keyed off the inherited DB_PATH) and writes the finished pool straight into the
// shared WAL DB via buildAndCache → cacheSet. The main thread then reads it back
// with cacheGet — so only the small {id, args} request and {id, ok} reply cross
// the thread boundary, never the pool itself.
//
// Critically, the worker calls buildAndCache directly and NEVER setBuildRunner —
// its own dispatcher stays on the inline default, so there is no recursion (the
// worker doesn't spawn another worker to do its build).
import { parentPort } from 'node:worker_threads';
import { buildAndCache } from './taste.js';

parentPort.on('message', async ({ id, args }) => {
  try {
    await buildAndCache(args);
    parentPort.postMessage({ id, ok: true });
  } catch (e) {
    parentPort.postMessage({ id, ok: false, error: e.message });
  }
});
