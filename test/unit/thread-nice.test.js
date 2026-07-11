// The build worker drops its OS priority (os.setPriority(19)) so the Linux scheduler
// preemptively favours the main thread serving requests on the shared core. That is only
// SAFE if `nice` is per-THREAD — otherwise renicing the worker would also deprioritise the
// serving thread, losing the core to noisy neighbours. Linux nice IS per-thread; macOS/BSD
// is per-process. build-worker.js guards the call with `process.platform === 'linux'`; this
// test pins that platform split by construction, running on the SAME OS as prod in CI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { Worker } from 'node:worker_threads';

// Spawn a worker that renices ITSELF to 19 and reports its own priority; meanwhile read
// the main thread's priority to see whether it moved too.
const reniceInWorker = () => new Promise((resolve, reject) => {
  const code = `
    const os = require('node:os');
    const { parentPort } = require('node:worker_threads');
    const before = os.getPriority();
    let err = null;
    try { os.setPriority(19); } catch (e) { err = String(e); }
    parentPort.postMessage({ before, after: os.getPriority(), err });
  `;
  const w = new Worker(code, { eval: true });
  w.once('message', (m) => { w.terminate(); resolve(m); });
  w.once('error', reject);
});

test('os.setPriority in a worker deprioritises only that thread on Linux (per-thread nice)', async () => {
  const mainBefore = os.getPriority();
  const worker = await reniceInWorker();
  const mainAfter = os.getPriority();

  assert.equal(worker.err, null, 'lowering priority needs no privilege');
  assert.equal(worker.after, 19, 'the worker actually reniced itself');

  if (process.platform === 'linux') {
    // The guarded prod path: per-thread, so the serving thread is untouched — safe to ship.
    assert.equal(mainAfter, mainBefore, 'main thread priority is unchanged (nice is per-thread on Linux)');
  } else {
    // Documents WHY build-worker.js restricts the renice to Linux: elsewhere it's per-process
    // and would drag the serving thread down with it.
    assert.equal(mainAfter, 19, 'non-Linux nice is per-process — the whole process moved');
  }
});
