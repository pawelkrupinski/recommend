// Tests for the event-loop instrumentation (src/perf.js). We don't assert on
// exact lag numbers (timing-dependent) — only that the monitor wires up without
// throwing and emits the structured lines we grep for in prod, through the
// injectable log seam. A fake logger captures writes so no real stdout is hit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { startPerfMonitor } from '../../src/perf.js';

function fakeLog() {
  const lines = [];
  return {
    lines,
    info: (...a) => lines.push(['info', a.join(' ')]),
    warn: (...a) => lines.push(['warn', a.join(' ')]),
    error: () => {},
    debug: () => {},
  };
}

test('emits a structured event-loop-lag summary on its interval', async () => {
  const log = fakeLog();
  const stop = startPerfMonitor({ log, summaryMs: 10, stallTickMs: 1000 });
  await delay(60); // ~6 summary intervals — generous so the timer is sure to fire
  stop();
  const summary = log.lines.find(([, msg]) => msg.startsWith('[perf] event-loop-lag'));
  assert.ok(summary, 'a [perf] event-loop-lag line was emitted');
  assert.match(summary[1], /mean=[\d.]+ms p99=[\d.]+ms max=[\d.]+ms/);
  assert.equal(summary[0], 'info', 'the periodic summary logs at info level');
});

test('flags a single long stall at warn level, rate-limited', async () => {
  const log = fakeLog();
  // Tiny tick + zero threshold so any scheduling jitter trips the stall path;
  // a large min-gap means even a storm of stalls yields at most one line.
  const stop = startPerfMonitor({
    log, summaryMs: 100_000, stallTickMs: 5, stallThresholdMs: 0, stallLogMinGapMs: 100_000,
  });
  // Block the loop briefly so a tick fires late.
  const until = Date.now() + 30;
  while (Date.now() < until) { /* busy-wait to stall the loop */ }
  await delay(40);
  stop();
  const stalls = log.lines.filter(([, msg]) => msg.startsWith('[perf] event-loop-stall'));
  assert.ok(stalls.length >= 1, 'at least one stall was logged');
  assert.equal(stalls.length, 1, 'the rate-limit collapses a burst to a single line');
  assert.equal(stalls[0][0], 'warn', 'stalls log at warn level');
  assert.match(stalls[0][1], /lag=\d+ms \(>0ms\)/);
});

test('stop() is idempotent-safe and leaves no live timers', () => {
  const stop = startPerfMonitor({ log: fakeLog() });
  assert.doesNotThrow(stop);
});
