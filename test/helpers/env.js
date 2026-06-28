// Shared test setup. Each test file calls freshDbEnv() BEFORE dynamically
// importing any app module, because db.js opens its SQLite file at import time —
// so the env must point at a throwaway database first.
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, readFileSync } from 'node:fs';

let counter = 0;

// Read a recorded fixture (test/fixtures/<name>) as UTF-8 text. `../fixtures`
// resolves the same from here (test/helpers) as from a test file (test/unit).
export function readFixture(name) {
  return readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');
}

// Point DB_PATH at a unique temp file and force deterministic, offline behaviour
// (fixed signing secret, TMDB fixtures, dev-login enabled). Returns the db path
// and a cleanup() that removes the db and its WAL sidecars.
export function freshDbEnv() {
  const path = join(tmpdir(), `recommend-test-${process.pid}-${counter++}-${Date.now()}.db`);
  process.env.DB_PATH = path;
  process.env.APPLICATION_SECRET = 'test-secret-do-not-use-in-prod';
  process.env.ADMIN_ALLOWLIST = '';
  process.env.TMDB_STUB = '1';
  process.env.ALLOW_DEV_LOGIN = '1';
  return {
    path,
    cleanup() {
      for (const suffix of ['', '-wal', '-shm']) {
        try { rmSync(path + suffix); } catch { /* may not exist */ }
      }
    },
  };
}
