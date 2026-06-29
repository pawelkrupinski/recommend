// Ephemeral, size-capped cache for TMDB responses.
//
// Unlike the durable response cache (db.js), this lives in its OWN SQLite file
// that is NOT Litestream-replicated and is capped at TMDB_CACHE_MAX_ROWS. TMDB
// bodies are large (a detail call appends credits + all-country watch providers
// + videos, ~100 KB each) and fully regenerable, so caching them in the durable,
// replicated DB bloated production to 1.7 GB — blowing the page cache on a small
// host and dragging out every cold-start restore. Keeping them here instead
// means they never touch R2 and can't grow without bound; a fresh machine starts
// empty and warms up, and losing the cache only costs re-fetches (TMDB has no
// hard request quota, unlike MotN).
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createKvCache } from './kv-cache.js';

// Default to a sibling of the main DB on the same (ephemeral) disk, with a
// distinct filename so it's never the path litestream.yml replicates
// (${DB_PATH}). Overridable via TMDB_CACHE_PATH (tests point it at a temp file).
const DB_PATH = process.env.DB_PATH || new URL('../data/recommend.db', import.meta.url).pathname;
const TMDB_CACHE_PATH =
  process.env.TMDB_CACHE_PATH || DB_PATH.replace(/\.db$/, '') + '.tmdb-cache.db';
const MAX_ROWS = Number(process.env.TMDB_CACHE_MAX_ROWS) || 5000;

mkdirSync(dirname(TMDB_CACHE_PATH), { recursive: true });
const tmdbDb = new DatabaseSync(TMDB_CACHE_PATH);
tmdbDb.exec('PRAGMA journal_mode = WAL');
tmdbDb.exec('PRAGMA busy_timeout = 5000');

const cache = createKvCache(tmdbDb, { maxRows: MAX_ROWS });

export const tmdbCacheGet = (key, maxAgeMs) => cache.get(key, maxAgeMs);
export const tmdbCacheSet = (key, value) => cache.set(key, value);
// Exposed for tests / maintenance (row count, forced eviction).
export const tmdbCache = cache;
