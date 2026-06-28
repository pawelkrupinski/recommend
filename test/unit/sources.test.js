// Unit tests for the candidate-source registry (src/sources.js). gatherCandidates
// is the merge/dedup/resilience seam every source flows through; we drive it with
// boring fake sources (the contract is just {name, configured, fetch}) so no
// network or TMDB/Trakt key is involved. Importing sources.js pulls in db.js
// (opens SQLite at import), so freshDbEnv() runs first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDbEnv } from '../helpers/env.js';

freshDbEnv();
const { gatherCandidates } = await import('../../src/sources.js');

// A minimal source: always configured, returns a fixed list.
const src = (name, items) => ({ name, configured: () => true, fetch: async () => items });

test('merges candidates from several sources, de-duplicating by id', async () => {
  const { candidates } = await gatherCandidates({}, [
    src('a', [{ id: 1, title: 'One' }, { id: 2, title: 'Two' }]),
    src('b', [{ id: 2, title: 'Two again' }, { id: 3, title: 'Three' }]),
  ]);
  assert.deepEqual([...candidates.keys()], [1, 2, 3], 'unique ids, first-seen wins order');
  assert.equal(candidates.get(2).title, 'Two', 'the first source to surface an id keeps its title');
});

test('skips sources that report themselves unconfigured', async () => {
  const off = { name: 'off', configured: () => false, fetch: async () => { throw new Error('should never run'); } };
  const { candidates } = await gatherCandidates({}, [off, src('on', [{ id: 7 }])]);
  assert.deepEqual([...candidates.keys()], [7]);
});

test('a source that throws is skipped without sinking the others', async () => {
  const boom = { name: 'boom', configured: () => true, fetch: async () => { throw new Error('upstream 500'); } };
  const { candidates } = await gatherCandidates({}, [
    src('a', [{ id: 1 }]),
    boom,
    src('b', [{ id: 2 }]),
  ]);
  assert.deepEqual([...candidates.keys()].sort((x, y) => x - y), [1, 2],
    'the healthy sources still contribute when one fails');
});

test('sums the collab signal across duplicate ids and sources', async () => {
  const { collab } = await gatherCandidates({}, [
    src('a', [{ id: 5, collab: 1 }, { id: 5, collab: 1 }]),
    src('b', [{ id: 5, collab: 1 }, { id: 6, collab: 1 }]),
  ]);
  assert.equal(collab.get(5), 3, 'three related-hits for the same title across sources/dupes');
  assert.equal(collab.get(6), 1);
});

test('candidates without a collab hit carry no collab entry', async () => {
  const { collab } = await gatherCandidates({}, [src('a', [{ id: 9, title: 'no-collab' }])]);
  assert.equal(collab.has(9), false);
});

test('ignores entries with no id', async () => {
  const { candidates } = await gatherCandidates({}, [src('a', [{ title: 'orphan' }, { id: 4 }])]);
  assert.deepEqual([...candidates.keys()], [4]);
});
