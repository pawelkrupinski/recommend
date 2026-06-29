// Main-thread client for the build worker (build-worker.js). createWorkerBuildRunner()
// returns the `(args) => Promise` that src/taste.js uses as its build runner once
// the composition root (server.js, isMain) wires it in via setBuildRunner(). The
// returned function resolves when the worker has finished the build and written the
// pool to the shared SQLite DB; the caller (recommend) then reads it back.
//
// Robustness: a build that throws inside the worker rejects only that one call. A
// worker that crashes ('error') or exits non-zero rejects every in-flight call and
// respawns a fresh worker, so a single bad build can't wedge all future ones.
import { Worker } from 'node:worker_threads';

export function createWorkerBuildRunner() {
  const pending = new Map(); // message id -> { resolve, reject }
  let worker;
  let nextId = 1;
  let terminated = false;

  // Reject everything still in flight when the worker dies — those builds will
  // never get a reply — so their callers fail fast rather than hang forever.
  function failAll(err) {
    for (const { reject } of pending.values()) reject(err);
    pending.clear();
  }

  function spawn() {
    worker = new Worker(new URL('./build-worker.js', import.meta.url));
    worker.on('message', ({ id, ok, error }) => {
      const entry = pending.get(id);
      if (!entry) return; // a reply for an already-failed/terminated call
      pending.delete(id);
      if (ok) entry.resolve();
      else entry.reject(new Error(error));
    });
    worker.on('error', (err) => {
      failAll(err);
      if (!terminated) spawn(); // one crash shouldn't disable all future builds
    });
    worker.on('exit', (code) => {
      if (terminated || code === 0) return;
      failAll(new Error(`build worker exited with code ${code}`));
      spawn();
    });
  }

  spawn();

  const run = (args) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, args });
  });
  // Tests terminate the worker so the process exits cleanly; the flag stops the
  // exit handler from respawning the worker we just asked to stop.
  run.terminate = async () => {
    terminated = true;
    await worker.terminate();
  };
  return run;
}
