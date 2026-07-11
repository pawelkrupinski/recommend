// The request-priority channel between the server and the build worker. The server
// brackets a latency-sensitive request (a user's search) with enter/exit, which the
// worker parks on so the build steps off the shared CPU core for the duration. These
// tests pin: the counter arithmetic (main thread), the main-thread safety no-op, and —
// with a real worker — that the worker parks WHILE busy and resumes the instant it's idle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import {
  createBackpressure, enterLatencySensitive, exitLatencySensitive,
  inFlight, parkIfBusy, PARK_RECHECK_MS,
} from '../../src/build-backpressure.js';

test('enter/exit track the in-flight count; balanced pairs return to zero', () => {
  createBackpressure();
  assert.equal(inFlight(), 0);
  enterLatencySensitive();
  enterLatencySensitive();
  assert.equal(inFlight(), 2, 'two concurrent requests');
  exitLatencySensitive();
  assert.equal(inFlight(), 1);
  exitLatencySensitive();
  assert.equal(inFlight(), 0, 'back to idle');
});

test('parkIfBusy is a no-op on the main thread even when busy (never blocks serving)', () => {
  createBackpressure();
  enterLatencySensitive();
  const t = performance.now();
  const parked = parkIfBusy(); // Atomics.wait is illegal on main — must not throw or block
  assert.equal(parked, false);
  assert.ok(performance.now() - t < 5, 'returned immediately');
  exitLatencySensitive();
});

// The real behaviour: a worker thread parks while the server is busy and wakes on idle.
test('the worker parks while a request is in flight and resumes when it clears', async () => {
  const buffer = createBackpressure();
  const worker = new Worker(new URL('../helpers/backpressure-probe-worker.js', import.meta.url), {
    workerData: { backpressure: buffer },
  });
  const probe = () => new Promise((resolve) => {
    worker.once('message', resolve);
    worker.postMessage('go');
  });
  try {
    // Idle: the worker should not park at all.
    const idle = await probe();
    assert.equal(idle.parked, false, 'no park when the server is idle');
    assert.ok(idle.ms < PARK_RECHECK_MS, 'returns promptly when idle');

    // Busy: mark a request in flight, then clear it ~20ms later. The worker should park
    // and wake shortly after the clear — well before the MAX_PARK_MS re-check ceiling.
    enterLatencySensitive();
    const parkedProbe = probe();
    setTimeout(() => exitLatencySensitive(), 20);
    const busy = await parkedProbe;
    assert.equal(busy.parked, true, 'parked while busy');
    assert.ok(busy.ms >= 15, `stayed parked until the request cleared (was ${busy.ms.toFixed(1)}ms)`);
    assert.ok(busy.ms < PARK_RECHECK_MS + 30, 'woke on the exit notify, not just the timeout');
  } finally {
    await worker.terminate();
  }
});
