// Unit tests for the bounded async task runner (src/concurrency.js) — the cap
// that stops boot-time prebuild warming from stampeding the upstream APIs. Pure
// logic, no DB/network: jobs are hand-controlled promises so we can freeze them
// in flight and inspect concurrency.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boundedRunner, mapPool } from '../../src/concurrency.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

test('mapPool runs every item, never more than `limit` at once', async () => {
  let live = 0, maxLive = 0;
  const done = [];
  await mapPool([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
    live++; maxLive = Math.max(maxLive, live);
    await tick();
    done.push(n);
    live--;
  });
  assert.equal(maxLive, 3, 'concurrency capped at the limit');
  assert.deepEqual(done.sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7], 'every item ran');
});

test('mapPool isolates a throwing item — the batch still completes', async () => {
  const done = [];
  await mapPool([1, 2, 3], 2, async (n) => {
    if (n === 2) throw new Error('boom');
    done.push(n);
  });
  assert.deepEqual(done.sort((a, b) => a - b), [1, 3], 'the other items still ran');
});

test('mapPool over an empty list resolves immediately', async () => {
  await mapPool([], 4, async () => { throw new Error('should not run'); });
});

test('never runs more than `limit` jobs at once; the rest queue (FIFO)', async () => {
  const finishers = [];        // resolve fns for in-flight jobs, in start order
  const started = [];          // keys in the order they actually started
  let live = 0, maxLive = 0;
  const runner = boundedRunner(2, (key) => {
    started.push(key);
    live++; maxLive = Math.max(maxLive, live);
    return new Promise((resolve) => finishers.push(() => { live--; resolve(); }));
  });

  ['a', 'b', 'c', 'd', 'e'].forEach((k) => runner.submit(k));
  await Promise.resolve();                       // let the synchronous pump settle
  assert.equal(runner.activeCount, 2, 'only 2 started');
  assert.equal(runner.queuedCount, 3, 'the rest are queued');
  assert.deepEqual(started, ['a', 'b']);

  // Finish jobs oldest-first; each freed slot must admit exactly one queued key.
  while (finishers.length) { finishers.shift()(); await tick(); }

  assert.equal(maxLive, 2, 'concurrency never exceeded the cap');
  assert.deepEqual(started, ['a', 'b', 'c', 'd', 'e'], 'all ran, in submit order');
  assert.equal(runner.activeCount, 0);
});

test('dedups a key that is already running or queued', async () => {
  const finishers = [];
  let starts = 0;
  const runner = boundedRunner(1, () => { starts++; return new Promise((r) => finishers.push(r)); });

  assert.equal(runner.submit('x'), true, 'x accepted, starts running');
  assert.equal(runner.submit('x'), false, 'x already active → no-op');
  assert.equal(runner.submit('y'), true, 'y accepted, queued behind x');
  assert.equal(runner.submit('y'), false, 'y already queued → no-op');
  await Promise.resolve();

  assert.equal(starts, 1, 'only x is running; y waits its turn');
  assert.equal(runner.isActive('x'), true);
  assert.equal(runner.isActive('y'), false);
  assert.equal(runner.has('y'), true, 'y is known (queued) even if not active');

  while (finishers.length) { finishers.shift()(); await tick(); }
  assert.equal(starts, 2, 'y ran once x freed the slot');
});

test('a throwing job frees its slot so the queue keeps draining', async () => {
  const started = [];
  const runner = boundedRunner(1, (key) => {
    started.push(key);
    if (key === 'boom') throw new Error('kaboom');
    return Promise.resolve();
  });
  runner.submit('boom');
  runner.submit('after');
  await tick(); await tick();

  assert.deepEqual(started, ['boom', 'after'], 'the throw did not stall the next job');
  assert.equal(runner.activeCount, 0);
});
