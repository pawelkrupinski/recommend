// A key/value cache over a single SQLite table, shared by the durable response
// cache (db.js) and the ephemeral, size-capped TMDB cache (tmdb-cache.js). The
// two differ only in which database file backs them and whether a row cap is
// enforced — the get/set/TTL semantics live here once so a real and a "small"
// cache can't drift apart.
const SCHEMA = `CREATE TABLE IF NOT EXISTS cache (
  key TEXT PRIMARY KEY, value TEXT, fetched_at INTEGER
)`;

// createKvCache(db, { maxRows, evictEvery })
//   maxRows    — when > 0, set() keeps only the newest `maxRows` rows (by
//                fetched_at), evicting the overflow so the table can't grow
//                unbounded. 0 (default) = no cap (the durable cache).
//   evictEvery — run the eviction sweep at most once per this many writes, so a
//                hot write path doesn't pay a delete-scan on every set().
//   now        — clock seam (defaults to Date.now); injected by tests so TTL and
//                eviction order are deterministic.
export function createKvCache(db, { maxRows = 0, evictEvery = 256, now = Date.now } = {}) {
  db.exec(SCHEMA);
  const getStmt = db.prepare('SELECT value, fetched_at FROM cache WHERE key = ?');
  const setStmt = db.prepare(
    'INSERT INTO cache (key, value, fetched_at) VALUES (?, ?, ?) ' +
      'ON CONFLICT(key) DO UPDATE SET value = excluded.value, fetched_at = excluded.fetched_at'
  );
  // Keep the newest `maxRows` by fetched_at; `LIMIT -1 OFFSET n` selects every
  // row past the first n, so this deletes exactly the overflow. `key` breaks
  // fetched_at ties deterministically.
  const evictStmt = maxRows
    ? db.prepare(
        'DELETE FROM cache WHERE key IN ' +
          '(SELECT key FROM cache ORDER BY fetched_at DESC, key LIMIT -1 OFFSET ?)'
      )
    : null;
  let sinceEvict = 0;

  return {
    // Return the stored value (including a cached `null` negative result) when
    // still fresh; `undefined` on a miss or when older than maxAgeMs.
    get(key, maxAgeMs) {
      const row = getStmt.get(key);
      if (!row) return undefined;
      if (maxAgeMs && now() - row.fetched_at > maxAgeMs) return undefined;
      return JSON.parse(row.value);
    },
    set(key, value) {
      setStmt.run(key, JSON.stringify(value), now());
      if (evictStmt && ++sinceEvict >= evictEvery) {
        sinceEvict = 0;
        evictStmt.run(maxRows);
      }
    },
    // Force the eviction sweep now (used by tests and one-off maintenance).
    evictNow() {
      if (evictStmt) evictStmt.run(maxRows);
    },
    count() {
      return db.prepare('SELECT count(*) AS c FROM cache').get().c;
    },
  };
}
