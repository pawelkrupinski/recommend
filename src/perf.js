// Always-on, lightweight event-loop instrumentation. One responsibility: make
// event-loop contention visible in the logs so we can confirm (from Fly logs
// alone) whether slow first-byte times are the shared CPU stalling under
// synchronous work, rather than guessing.
//
// Two signals, both cheap and non-blocking:
//   - a periodic summary of loop lag (mean / p99 / max) from
//     perf_hooks.monitorEventLoopDelay(), which samples in the C++ layer and
//     costs us nothing per tick;
//   - an immediate, rate-limited alert when a single tick fires far later than
//     scheduled (a stall the percentile summary would smooth away).
//
// Both timers are unref()'d so this never keeps the process alive, and the log
// seam is injectable so a test can assert the emitted lines without real stdout.
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { log as defaultLog } from './log.js';

// nanoseconds → milliseconds, one decimal. An empty histogram reports NaN for
// mean/percentile; render that as 0.0 so a quiet interval never logs "NaNms".
const ms = (nanos) => (Number.isFinite(nanos) ? nanos / 1e6 : 0).toFixed(1);

// Start sampling. Returns a stop() that clears the timers and disables the
// histogram — used by tests; production starts it once and lets it run.
export function startPerfMonitor({
  log = defaultLog,
  summaryMs = 60_000,        // how often to emit the lag summary
  stallTickMs = 1_000,       // delta-timer cadence for catching single stalls
  stallThresholdMs = 250,    // a tick this late means the loop was blocked
  stallLogMinGapMs = 5_000,  // rate-limit the stall lines so a storm can't spam
} = {}) {
  const histogram = monitorEventLoopDelay({ resolution: 20 });
  histogram.enable();

  const summary = setInterval(() => {
    log.info(
      `[perf] event-loop-lag mean=${ms(histogram.mean)}ms ` +
      `p99=${ms(histogram.percentile(99))}ms max=${ms(histogram.max)}ms`,
    );
    histogram.reset();
  }, summaryMs);

  // A self-correcting delta timer: each tick measures how late it fired versus
  // when it was scheduled — lateness ≈ how long the loop was blocked just now.
  let expected = Date.now() + stallTickMs;
  let lastStallLog = 0;
  const stall = setInterval(() => {
    const now = Date.now();
    const lag = now - expected;
    expected = now + stallTickMs;
    if (lag > stallThresholdMs && now - lastStallLog >= stallLogMinGapMs) {
      lastStallLog = now;
      log.warn(`[perf] event-loop-stall lag=${lag}ms (>${stallThresholdMs}ms)`);
    }
  }, stallTickMs);

  summary.unref();
  stall.unref();

  return () => {
    clearInterval(summary);
    clearInterval(stall);
    histogram.disable();
  };
}
