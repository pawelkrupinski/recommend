// Performance-tuning regression tests for the SQLite data layer (src/db.js):
// the WAL-safe pragmas and the covering indices that keep the hot per-user
// reads + cache eviction off a full table scan. These guard against the
// indices/pragmas being dropped — each assertion fails on the pre-change schema
// (TEMP B-TREE / default pragma values) and passes once they're applied.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDbEnv } from '../helpers/env.js';

const env = freshDbEnv();
const { db } = await import('../../src/db.js');

const plan = (sql, ...params) =>
  db.prepare('EXPLAIN QUERY PLAN ' + sql).all(...params).map((r) => r.detail).join(' | ');
const pragma = (name) => db.prepare(`PRAGMA ${name}`).get()[name];

test('WAL-safe performance pragmas are applied at open', () => {
  assert.equal(pragma('synchronous'), 1, 'synchronous = NORMAL (1)');
  assert.equal(pragma('cache_size'), -64000, '64 MB page cache');
  assert.equal(pragma('mmap_size'), 30000000, '~30 MB memory-mapped I/O');
});

test('the watchlist read walks an index instead of sorting in a temp b-tree', () => {
  const p = plan('SELECT * FROM watchlist WHERE user_id = ? ORDER BY added_at DESC', 1);
  assert.match(p, /USING INDEX idx_watchlist_user_added/);
  assert.doesNotMatch(p, /TEMP B-TREE/, 'no sort: the index supplies added_at DESC order');
});

test('the ratings read walks an index instead of sorting in a temp b-tree', () => {
  const p = plan('SELECT * FROM ratings WHERE user_id = ? ORDER BY rated_at DESC', 1);
  assert.match(p, /USING INDEX idx_ratings_user_rated/);
  assert.doesNotMatch(p, /TEMP B-TREE/);
});

test('the cache eviction sweep scans a covering index, not the whole table', () => {
  // Exactly the eviction query from kv-cache.js (ORDER BY fetched_at DESC, key).
  const p = plan('SELECT key FROM cache ORDER BY fetched_at DESC, key LIMIT -1 OFFSET ?', 5);
  assert.match(p, /USING COVERING INDEX idx_cache_fetched_key/);
  assert.doesNotMatch(p, /TEMP B-TREE/);
});

test('ANALYZE ran, so the planner has row-count stats for the new indices', () => {
  // ANALYZE populates sqlite_stat1; its presence means the stats exist.
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sqlite_stat1'").get();
  assert.ok(row, 'sqlite_stat1 exists after ANALYZE');
});

test.after(() => env.cleanup());
