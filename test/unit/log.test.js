// Unit tests for the leveled logger (src/log.js). No real streams: we pass fake
// stdout/stderr and a controllable threshold through the makeLogger seam.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeLogger } from '../../src/log.js';

// A fake writable that records what it was given, standing in for a real stream.
function fakeStream() {
  const lines = [];
  return { write: (s) => lines.push(s), lines, text: () => lines.join('') };
}

function loggerAt(level) {
  const levels = { error: 0, warn: 1, info: 2, debug: 3 };
  const stdout = fakeStream();
  const stderr = fakeStream();
  const log = makeLogger({ streams: { stdout, stderr }, getThreshold: () => levels[level] });
  return { log, stdout, stderr };
}

test('errors and warnings go to stderr; info and debug go to stdout', () => {
  const { log, stdout, stderr } = loggerAt('debug');
  log.error('boom');
  log.warn('careful');
  log.info('hello');
  log.debug('details');
  assert.match(stderr.text(), /boom/);
  assert.match(stderr.text(), /careful/);
  assert.match(stdout.text(), /hello/);
  assert.match(stdout.text(), /details/);
  assert.doesNotMatch(stderr.text(), /hello/);
});

test('LOG_LEVEL=warn suppresses info and debug but keeps errors and warnings', () => {
  const { log, stdout, stderr } = loggerAt('warn');
  log.error('boom');
  log.warn('careful');
  log.info('hello');
  log.debug('details');
  assert.match(stderr.text(), /boom/);
  assert.match(stderr.text(), /careful/);
  assert.equal(stdout.text(), '', 'nothing below the threshold is written');
});

test('each line carries an ISO timestamp and the level tag', () => {
  const { log, stderr } = loggerAt('error');
  log.error('boom');
  assert.match(stderr.lines[0], /^\d{4}-\d{2}-\d{2}T[\d:.]+Z ERROR boom\n$/);
});

test('an Error argument is rendered with its stack', () => {
  const { log, stderr } = loggerAt('error');
  log.error('request error:', new Error('kaboom'));
  assert.match(stderr.text(), /request error:/);
  assert.match(stderr.text(), /Error: kaboom/);
  assert.match(stderr.text(), /at /, 'includes a stack frame');
});
