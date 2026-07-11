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
import { parentPort, workerData } from 'node:worker_threads';
import os from 'node:os';
import { buildAndCache } from './taste.js';
import { installBackpressure } from './build-backpressure.js';

// Adopt the shared request-priority channel so parkIfBusy() (in taste.js's build yields)
// can see when the server is busy and step aside for it.
installBackpressure(workerData?.backpressure);

// On Linux, `nice` is a per-THREAD attribute, so dropping THIS worker thread's priority
// lets the scheduler preemptively favour the main thread serving requests on the shared
// core — a baseline that holds even between the build's cooperative yield points. Skipped
// off Linux (macOS/BSD nice is per-process and would wrongly deprioritise serving too);
// the per-thread-vs-process behaviour is pinned by test/unit/thread-nice.test.js. Lowering
// priority needs no privilege, but guard anyway so a hardened sandbox can't crash the worker.
if (process.platform === 'linux') { try { os.setPriority(19); } catch { /* not permitted; skip */ } }

parentPort.on('message', async ({ id, args }) => {
  try {
    await buildAndCache(args);
    parentPort.postMessage({ id, ok: true });
  } catch (e) {
    parentPort.postMessage({ id, ok: false, error: e.message });
  }
});
