// Unit tests for the bounded key/value cache (src/kv-cache.js) shared by the
// durable response cache and the ephemeral, size-capped TMDB cache. Backed by a
// throwaway in-memory SQLite db — the behaviour under test is get/set/TTL plus
// the row-cap eviction that keeps the TMDB cache from growing unbounded (the
// regression that bloated production to 1.7 GB).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createKvCache } from '../../src/kv-cache.js';

const freshDb = () => new DatabaseSync(':memory:');

test('round-trips values and serves a cached null negative', () => {
  const c = createKvCache(freshDb());
  c.set('a', { v: 1 });
  assert.deepEqual(c.get('a'), { v: 1 });
  c.set('n', null);
  assert.equal(c.get('n'), null, 'cached null is a hit, not a miss');
  assert.equal(c.get('missing'), undefined, 'absent key → undefined');
});

test('honours the TTL: entries older than maxAgeMs read as a miss', () => {
  let t = 0;
  const c = createKvCache(freshDb(), { now: () => t });
  c.set('k', 'v'); // fetched_at = 0
  t = 30_000;
  assert.equal(c.get('k', 60_000), 'v', 'age 30s within a 60s TTL');
  t = 100_000;
  assert.equal(c.get('k', 60_000), undefined, 'age 100s past a 60s TTL → miss');
  assert.equal(c.get('k'), 'v', 'no TTL given → always a hit when present');
});

test('caps the table at maxRows, evicting the oldest by fetched_at', () => {
  // evictEvery:1 → sweep on every write; injected clock gives each write a
  // distinct fetched_at so "oldest" is unambiguous.
  let t = 0;
  const c = createKvCache(freshDb(), { maxRows: 3, evictEvery: 1, now: () => (t += 1000) });
  for (const k of ['k0', 'k1', 'k2', 'k3', 'k4']) c.set(k, k);
  assert.equal(c.count(), 3, 'never exceeds the row cap');
  // The three most recently written survive; the two oldest were evicted.
  assert.equal(c.get('k0'), undefined, 'oldest evicted');
  assert.equal(c.get('k1'), undefined, 'second-oldest evicted');
  assert.equal(c.get('k4'), 'k4', 'newest retained');
  assert.equal(c.get('k2'), 'k2', 'within-cap retained');
});

test('no cap (maxRows 0) keeps everything — the durable cache', () => {
  const c = createKvCache(freshDb()); // default: uncapped
  for (let i = 0; i < 50; i++) c.set('k' + i, i);
  assert.equal(c.count(), 50, 'uncapped cache retains all rows');
});
