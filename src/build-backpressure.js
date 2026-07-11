// Request-priority backpressure between the main server thread and the build worker.
// They share ONE CPU core on the Fly box, so a running recommendation build starves
// request handling (measured: 10–60s stalls). This gives the worker a way to get OUT of
// the way the instant a latency-sensitive request — a user's search — is being served:
// the server brackets such a request with enterLatencySensitive/exit, bumping a shared
// counter; the worker, at each build yield point, PARKS its thread (Atomics.wait, which
// frees the core) while that counter is > 0 and resumes the moment it hits zero. So the
// build runs full-speed while nobody's interacting, and steps aside only during a request.
//
// The channel is a one-cell SharedArrayBuffer created on the main thread and handed to
// the worker via workerData, so both threads' Int32Array views address the same memory.
// A bounded re-check timeout (MAX_PARK_MS) means a leaked counter can never wedge builds.
import { isMainThread } from 'node:worker_threads';

const INFLIGHT = 0;     // the one shared cell: count of latency-sensitive requests in flight
const MAX_PARK_MS = 50; // worker re-check ceiling — a leaked counter can't stall builds forever

let cells = null; // Int32Array over the shared buffer; null until wired at the composition root

// Main thread: allocate the shared channel and return the buffer to hand to the worker.
export function createBackpressure() {
  cells = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
  return cells.buffer;
}

// Worker thread: adopt the buffer the main thread shared (via workerData). No-op if the
// worker was spawned without one (e.g. a plain test import).
export function installBackpressure(buffer) {
  if (buffer) cells = new Int32Array(buffer);
}

// Main thread: bracket a latency-sensitive request so the build yields the core to it.
// Safe no-ops when the channel isn't wired (tests, or before setup). Always pair them in
// a try/finally so a throwing handler can't leak the counter.
export function enterLatencySensitive() {
  if (cells) Atomics.add(cells, INFLIGHT, 1);
}
export function exitLatencySensitive() {
  if (!cells) return;
  Atomics.sub(cells, INFLIGHT, 1);
  Atomics.notify(cells, INFLIGHT); // wake the parked worker so it re-checks (and resumes once at 0)
}

// The count of latency-sensitive requests currently being served — the value the worker
// parks on. Readable from either thread (Atomics.load is allowed on the main thread).
export function inFlight() {
  return cells ? Atomics.load(cells, INFLIGHT) : 0;
}

// Worker thread only: if the server is busy, PARK this thread until the in-flight count
// changes (a request finished) or MAX_PARK_MS elapses, then return true. Returns false
// immediately when idle or unwired. Never parks on the main thread — Atomics.wait is
// illegal there — so a stray main-thread call is just a cheap no-op (which is also what
// keeps the on-main foreground head build from ever blocking itself).
export function parkIfBusy() {
  if (!cells || isMainThread) return false;
  const busy = Atomics.load(cells, INFLIGHT);
  if (busy <= 0) return false;
  Atomics.wait(cells, INFLIGHT, busy, MAX_PARK_MS);
  return true;
}

export const PARK_RECHECK_MS = MAX_PARK_MS; // exposed for tests
