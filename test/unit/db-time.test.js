// The DB-time counter (perf.js) and db.js's prepare wrapper: every synchronous
// statement call is timed into a monotonic total a build snapshots to report its
// DB-time vs compute-time share. Guards both the accounting and that wrapping
// db.prepare in a Proxy leaves query results untouched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDbEnv } from '../helpers/env.js';

freshDbEnv(); // unique throwaway DB before db.js opens its file at import
const { db } = await import('../../src/db.js');
const { dbCounters, recordDbTime } = await import('../../src/perf.js');

test('recordDbTime accrues a monotonic total the counter reports', () => {
  const before = dbCounters();
  recordDbTime(1.5);
  const after = dbCounters();
  assert.equal(after.calls, before.calls + 1, 'one more call counted');
  assert.ok(after.ms >= before.ms + 1.5 - 1e-9, 'the duration is added to the total');
});

test('every prepared-statement call is timed, and the wrapper preserves results', () => {
  const before = dbCounters();
  const row = db.prepare('SELECT 1 AS n').get();
  assert.equal(row.n, 1, 'the timing Proxy returns the real query result');
  const after = dbCounters();
  assert.ok(after.calls > before.calls, 'the query bumped the call count');
  assert.ok(after.ms >= before.ms, 'time is monotonic and non-negative');
});
