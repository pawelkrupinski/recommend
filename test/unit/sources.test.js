// Unit tests for the candidate-source registry (src/sources.js). gatherCandidates
// is the merge/dedup/resilience seam every source flows through; we drive it with
// boring fake sources (the contract is just {name, configured, fetch}) so no
// network or TMDB/Trakt key is involved. Importing sources.js pulls in db.js
// (opens SQLite at import), so freshDbEnv() runs first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDbEnv } from '../helpers/env.js';

freshDbEnv();
const { gatherCandidates, pageUntilFresh, curatedIndieProviderIds } = await import('../../src/sources.js');

// A fake paginated Discover endpoint: `pages` is an array of result arrays (one
// per page). total_pages is the real length, so the walker knows when it's run
// dry. Records which pages were fetched so tests can assert how deep it paged.
const pager = (pages) => {
  const fetched = [];
  const fetchPage = async (page) => {
    fetched.push(page);
    return { page, total_pages: pages.length, results: pages[page - 1] || [] };
  };
  return { fetchPage, fetched };
};
const titles = (...ids) => ids.map((id) => ({ id, title: `T${id}` }));

test('pageUntilFresh: stops after one page once enough fresh candidates are found', async () => {
  const { fetchPage, fetched } = pager([titles(1, 2, 3, 4, 5), titles(6, 7)]);
  const out = await pageUntilFresh({ fetchPage, want: 3, consumed: new Set() });
  assert.deepEqual(fetched, [1], 'page 1 alone met the fresh target, so page 2 is never fetched');
  assert.deepEqual(out.map((m) => m.id), [1, 2, 3, 4, 5]);
});

test('pageUntilFresh: pages deeper past an already-consumed head until fresh titles appear', async () => {
  // The user has handled the whole popular head (pages 1–2); fresh titles only
  // start on page 3. Fixed 1-page paging would have returned nothing usable.
  const { fetchPage, fetched } = pager([titles(1, 2, 3), titles(4, 5, 6), titles(7, 8, 9)]);
  const consumed = new Set([1, 2, 3, 4, 5, 6]);
  const out = await pageUntilFresh({ fetchPage, want: 2, consumed });
  assert.deepEqual(fetched, [1, 2, 3], 'kept paging through the consumed head to reach fresh titles');
  assert.deepEqual(out.filter((m) => !consumed.has(m.id)).map((m) => m.id), [7, 8, 9]);
});

test('pageUntilFresh: stops when the source runs out before the target is met', async () => {
  const { fetchPage, fetched } = pager([titles(1, 2), titles(3, 4)]);
  const out = await pageUntilFresh({ fetchPage, want: 80, consumed: new Set() });
  assert.deepEqual(fetched, [1, 2], 'exhausted total_pages rather than spinning to the ceiling');
  assert.deepEqual(out.map((m) => m.id), [1, 2, 3, 4]);
});

test('pageUntilFresh: never pages past the ceiling', async () => {
  // 10 pages available, every title consumed, target never met — ceil must bound it.
  const pages = Array.from({ length: 10 }, (_, i) => titles(i + 1));
  const { fetchPage, fetched } = pager(pages);
  await pageUntilFresh({ fetchPage, want: 80, consumed: new Set(pages.flat().map((m) => m.id)), ceil: 2 });
  assert.deepEqual(fetched, [1, 2], 'gave up at the ceiling instead of fetching all 10 pages');
});

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

test('curatedIndieProviderIds keeps only the user’s art-house services', async () => {
  // MUBI (11) and Criterion (258) are curated; Netflix (8) / HBO Max (1899) aren't.
  assert.deepEqual(curatedIndieProviderIds([8, 11, 1899, 258]), [11, 258]);
  assert.deepEqual(curatedIndieProviderIds([8, 1899]), [], 'no curated service → source stays off');
  assert.deepEqual(curatedIndieProviderIds([]), []);
  assert.deepEqual(curatedIndieProviderIds(undefined), []);
  // Provider ids may arrive as strings from user settings — match numerically.
  assert.deepEqual(curatedIndieProviderIds(['11', '8']), ['11'], 'string id still recognised');
});
