// Unit tests for the provider-picker helpers in src/server.js (the logic behind
// commit "Provider picker: cap to top 20 services by popularity"). Importing
// server.js is side-effect-free here: it only binds a port when run as the
// entrypoint, not when imported.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDbEnv } from '../helpers/env.js';

freshDbEnv();
const { norm, majorRank, matchTmdb, topServices } = await import('../../src/server.js');

test('norm strips +/plus and non-alphanumerics, lowercases', () => {
  assert.equal(norm('Disney+'), 'disney');
  assert.equal(norm('Disney Plus'), 'disney');
  assert.equal(norm('HBO Max'), 'hbomax');
  assert.equal(norm('Apple TV+'), 'appletv');
});

test('majorRank orders known brands ahead of unknowns', () => {
  assert.equal(majorRank('Netflix'), 0);
  assert.ok(majorRank('Disney+') < majorRank('Hulu'));
  assert.equal(majorRank('Some Niche Channel'), 1000, 'unknown brand sinks to the bottom');
});

test('matchTmdb prefers an exact normalized match over a substring', () => {
  const providers = [
    { provider_id: 1, provider_name: 'Netflix Kids' },
    { provider_id: 2, provider_name: 'Netflix' },
  ];
  assert.equal(matchTmdb('Netflix', providers).provider_id, 2);
});

test('matchTmdb falls back to the shortest substring match', () => {
  const providers = [
    { provider_id: 1, provider_name: 'HBO Max Amazon Channel' },
    { provider_id: 2, provider_name: 'HBO Max' },
  ];
  assert.equal(matchTmdb('HBO Max', providers).provider_id, 2, 'shortest containing name wins');
});

test('matchTmdb returns null when nothing matches', () => {
  assert.equal(matchTmdb('Nonexistent', [{ provider_id: 1, provider_name: 'Netflix' }]), null);
});

test('topServices drops storefronts and reseller/tier variants', () => {
  const tmdb = [
    { provider_id: 8, provider_name: 'Netflix', display_priority: 1 },
    { provider_id: 10, provider_name: 'Amazon Video', display_priority: 2 }, // store
    { provider_id: 11, provider_name: 'Google Play Movies', display_priority: 3 }, // store
    { provider_id: 12, provider_name: 'Netflix Standard with Ads', display_priority: 4 }, // variant
    { provider_id: 13, provider_name: 'HBO Max Amazon Channel', display_priority: 5 }, // variant
  ];
  const names = topServices([], tmdb).map((p) => p.name);
  assert.deepEqual(names, ['Netflix'], 'only the real subscription service survives');
});

test('topServices dedupes by brand and caps at 20', () => {
  // 25 distinct niche channels + a duplicate Netflix brand.
  const tmdb = [
    { provider_id: 8, provider_name: 'Netflix', display_priority: 1 },
    { provider_id: 9, provider_name: 'Netflix basic', display_priority: 2 }, // same brand → dropped
    ...Array.from({ length: 25 }, (_, i) => ({
      provider_id: 100 + i, provider_name: `Niche Channel ${i}`, display_priority: 10 + i,
    })),
  ];
  const out = topServices([], tmdb);
  assert.equal(out.length, 20, 'capped to the top 20');
  const netflixCount = out.filter((p) => /netflix/i.test(p.name)).length;
  assert.equal(netflixCount, 1, 'brand dedupe keeps a single Netflix');
  assert.equal(out[0].name, 'Netflix', 'recognized major sorts first');
  assert.ok(!('dp' in out[0]), 'internal display_priority field is stripped from output');
});

test('topServices keeps the curated primary list and tops up from TMDB', () => {
  const primary = [{ id: 999, name: 'Canal+ Test', logo: '/c.png', dp: 1, source: 'motn' }];
  const tmdb = [{ provider_id: 8, provider_name: 'Netflix', display_priority: 1 }];
  const out = topServices(primary, tmdb);
  const names = out.map((p) => p.name);
  assert.ok(names.includes('Canal+ Test'), 'primary entry retained');
  assert.ok(names.includes('Netflix'), 'TMDB extra added');
});
