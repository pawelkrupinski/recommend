// The movie_tones batch read (getMovieToneSlugsBatch) that kills the per-title
// N+1 in a build. Proves it resolves a whole candidate set in ONE query — using
// the dbCounters() instrumentation to count calls — and returns the same slugs
// the per-title getMovieToneSlugs() does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDbEnv } from '../helpers/env.js';

freshDbEnv(); // unique throwaway DB before db.js opens its file at import
const { setMovieToneSource, getMovieToneSlugs, getMovieToneSlugsBatch } = await import('../../src/db.js');
const { dbCounters } = await import('../../src/perf.js');

setMovieToneSource(101, 'movie', 'model', ['gritty', 'bleak']);
setMovieToneSource(102, 'movie', 'imdb', ['heartfelt']);
// 103 deliberately has no stored tones.

test('getMovieToneSlugsBatch resolves the whole set in a single query', () => {
  const before = dbCounters();
  const map = getMovieToneSlugsBatch([101, 102, 103]);
  const after = dbCounters();
  assert.deepEqual([...(map.get(101) || [])].sort(), ['bleak', 'gritty'], 'all of 101’s slugs');
  assert.deepEqual(map.get(102), ['heartfelt']);
  assert.equal(map.get(103), undefined, 'a title with no stored tones is simply absent');
  assert.equal(after.calls - before.calls, 1, 'one query for the whole set, not one per title');
});

test('the per-title path is the N+1 the batch collapses', () => {
  const before = dbCounters();
  getMovieToneSlugs(101);
  getMovieToneSlugs(102);
  getMovieToneSlugs(103);
  const after = dbCounters();
  assert.equal(after.calls - before.calls, 3, 'one query per title — what the build prefetch replaces with one');
});
