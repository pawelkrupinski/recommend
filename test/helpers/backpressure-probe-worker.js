// Worker-side probe for build-backpressure.test.js. Adopts the shared channel from
// workerData, then on each 'go' message calls parkIfBusy() and reports how long it
// blocked — so the test can prove the worker parks while the server is "busy" and
// returns immediately when it's idle. Kept trivial (a boring test double per the
// project's fake conventions): all real logic lives in build-backpressure.js.
import { parentPort, workerData } from 'node:worker_threads';
import { installBackpressure, parkIfBusy } from '../../src/build-backpressure.js';

installBackpressure(workerData.backpressure);

parentPort.on('message', () => {
  const t = performance.now();
  const parked = parkIfBusy();
  parentPort.postMessage({ parked, ms: performance.now() - t });
});
