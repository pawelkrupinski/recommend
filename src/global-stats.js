// Global, filter-independent corpus statistics that keep a title's score stable
// across the Discover filters. The old model rebuilt the IDF feature weights and
// the quality prior's baseline (the mean IMDb rating, C) over EACH request's
// candidate pool, so the SAME title scored differently depending on which filter
// shaped that pool: adding TV to a movies-only view raised every movie-distinctive
// feature's IDF (rarer within the mixed pool) and shifted the rating baseline, so
// the same movie appeared with a different — usually higher — score. Here we
// accumulate document frequencies and IMDb-rating sums over every distinct title
// we've ever scored (deduped by media_type:tmdb_id) and derive IDF + the global
// mean from THAT accumulated corpus. The numbers a title gets no longer depend on
// the pool it happened to land in — only which titles survive to a given view
// still varies (that's the filter doing its job).
//
// Lives on the durable, Litestream-replicated DB (persists across restarts, which
// is the whole point — a cold table would make scores unstable again until warm).
// Absent features are treated as document-frequency 0 (maximally rare), so the
// long tail can be pruned later without corrupting the scores of what remains.
import { db } from './db.js';
import { idfValue, SCORING } from './scoring.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS global_feature_df (
    feature   TEXT PRIMARY KEY,
    doc_count INTEGER NOT NULL DEFAULT 0
  ) WITHOUT ROWID;
  CREATE TABLE IF NOT EXISTS global_seen_titles (
    title_key TEXT PRIMARY KEY
  ) WITHOUT ROWID;
  CREATE TABLE IF NOT EXISTS global_corpus_meta (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    total_docs INTEGER NOT NULL DEFAULT 0,
    imdb_sum   REAL    NOT NULL DEFAULT 0,
    imdb_count INTEGER NOT NULL DEFAULT 0
  );
`);
db.prepare(
  'INSERT OR IGNORE INTO global_corpus_meta (id, total_docs, imdb_sum, imdb_count) VALUES (1, 0, 0, 0)'
).run();

// INSERT OR IGNORE returns changes:0 when the title was already counted — the
// atomic dedup gate, so a title that recurs across builds (or two builds racing
// on it) contributes to the global corpus exactly once.
const _addSeen = db.prepare('INSERT OR IGNORE INTO global_seen_titles (title_key) VALUES (?)');
const _bumpFeature = db.prepare(
  'INSERT INTO global_feature_df (feature, doc_count) VALUES (?, 1) ' +
  'ON CONFLICT(feature) DO UPDATE SET doc_count = doc_count + 1'
);
const _bumpMeta = db.prepare(
  'UPDATE global_corpus_meta SET total_docs = total_docs + 1, ' +
  'imdb_sum = imdb_sum + ?, imdb_count = imdb_count + ? WHERE id = 1'
);
const _meta = db.prepare('SELECT total_docs, imdb_sum, imdb_count FROM global_corpus_meta WHERE id = 1');

// SQLite's parameter limit is 32766; stay well under it per IN-list query. A pool
// is ~200-500 cards × ~15-40 features, so the union is a few thousand ids — a
// handful of chunks.
const IN_CHUNK = 900;
// Fold DB writes into transactions of this many cards so a cold build's thousands
// of upserts commit in a few WAL frames, not one-per-statement, and yields the
// event loop between chunks (this runs on the background full-build path).
const WRITE_CHUNK = 200;

// Record a completed build's candidate cards into the global corpus: each title
// new to global_seen_titles bumps the document frequency of every feature it
// carries and folds its IMDb rating into the mean. Already-seen titles are skipped
// (dedup), so after the catalogue is warm most builds write nothing and this is
// ~one indexed lookup per card. Each card needs { media_type, tmdb_id, features,
// imdbRating }. Async: yields between write chunks.
export async function recordSeen(cards) {
  for (let i = 0; i < cards.length; i += WRITE_CHUNK) {
    const batch = cards.slice(i, i + WRITE_CHUNK);
    db.exec('BEGIN');
    try {
      for (const c of batch) {
        if (!_addSeen.run(`${c.media_type}:${c.tmdb_id}`).changes) continue; // already counted
        for (const f of new Set(c.features)) _bumpFeature.run(f);
        // Only titles we hold an IMDb rating for feed the prior's C baseline —
        // the same gate meanImdbRating used — but every title counts toward the df
        // corpus regardless.
        const rated = c.imdbRating != null;
        _bumpMeta.run(rated ? c.imdbRating : 0, rated ? 1 : 0);
      }
      db.exec('COMMIT');
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch { /* ignore */ }
      throw e;
    }
    if (i + WRITE_CHUNK < cards.length) await new Promise((r) => setImmediate(r));
  }
}

// Smoothed IDF for the given features, derived from the global document-frequency
// table (not any request's pool). Returns Map<feature, idf> covering every id
// asked for — a feature absent from the table is scored at document-frequency 0
// (maximally rare). Same formula and scale as buildIdf, so the scoring constants
// (MATCH_K, CONF_K) tuned against per-corpus IDF still apply: a feature's IDF
// tracks its n/d RATIO, which is stable whether n is a 500-card pool or the whole
// accumulated corpus — only pool-specific prevalence swings (the filter effect we
// are removing) change it.
export function globalIdf(features) {
  const uniq = [...new Set(features)];
  const total = _meta.get().total_docs;
  const df = new Map();
  for (let i = 0; i < uniq.length; i += IN_CHUNK) {
    const slice = uniq.slice(i, i + IN_CHUNK);
    const placeholders = slice.map(() => '?').join(',');
    const rows = db.prepare(
      `SELECT feature, doc_count FROM global_feature_df WHERE feature IN (${placeholders})`,
    ).all(...slice);
    for (const { feature, doc_count } of rows) df.set(feature, doc_count);
  }
  const idf = new Map();
  for (const f of uniq) idf.set(f, idfValue(df.get(f) || 0, total));
  return idf;
}

// The global mean IMDb rating — the prior C the Bayesian quality term shrinks
// thin-voted titles toward, now accumulated over the whole corpus rather than
// recomputed per pool. Falls back to IMDB_GLOBAL_MEAN (matching the old
// meanImdbRating) before any IMDb-rated title has been recorded.
export function globalMeanRating() {
  const { imdb_sum, imdb_count } = _meta.get();
  return imdb_count ? imdb_sum / imdb_count : SCORING.IMDB_GLOBAL_MEAN;
}
