// The recommendation build runs in a worker thread; on the single-shared-CPU box the
// worker and the main process time-slice one core. A bare setImmediate never
// relinquishes the core (the worker's loop just re-queues), so a CPU-heavy build
// starves request handling — measured in prod as 10–60s request stalls. makeBreathe(true)
// (the worker's yield) must PARK on a real timer so the OS hands the core back to the
// serving process; makeBreathe(false) (the main-thread yield) must stay a cheap
// setImmediate that adds no wall-clock latency to the request it's serving.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDbEnv } from '../helpers/env.js';

freshDbEnv();
const { makeBreathe } = await import('../../src/taste.js');

const elapsed = async (breathe, n) => {
  const t = performance.now();
  for (let i = 0; i < n; i++) await breathe();
  return performance.now() - t;
};

test('worker breathe parks on a real timer; main-thread breathe does not', async () => {
  const N = 5;
  const workerMs = await elapsed(makeBreathe(true), N);   // 5 × setTimeout(4) ≥ ~20ms
  const mainMs = await elapsed(makeBreathe(false), N);    // 5 × setImmediate ≈ ~0ms

  assert.ok(workerMs >= 10, `worker breathe should park (was ${workerMs.toFixed(1)}ms for ${N} yields)`);
  assert.ok(mainMs < 10, `main breathe should not add latency (was ${mainMs.toFixed(1)}ms for ${N} yields)`);
  assert.ok(workerMs > mainMs, 'the worker yield is strictly the slower, thread-parking one');
});
