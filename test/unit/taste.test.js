// Unit tests for the pure helper behind the Discover card's streaming-service
// icons. userServices() turns TMDB's appended watch/providers block into the
// subset of the user's *chosen* services that carry a title — what each card
// badges and deep-links. Importing taste.js is side-effect-free (its TMDB/DB
// deps only act when their functions are called), but freshDbEnv() still runs
// first because db.js opens SQLite at import time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDbEnv } from '../helpers/env.js';

freshDbEnv();
const { userServices, matchesOrigin, isIndie, filterSig, resolveFilters } = await import('../../src/taste.js');

// Build a TMDB-detail-shaped movie with the fields the origin/indie filters read.
const movieFrom = (countries, companyIds = []) => ({
  production_countries: countries.map((iso_3166_1) => ({ iso_3166_1 })),
  production_companies: companyIds.map((id) => ({ id, name: `Co ${id}` })),
});

test('matchesOrigin: excludeUs drops any title with US among its countries', () => {
  assert.equal(matchesOrigin(movieFrom(['US']), { excludeUs: true }), false);
  assert.equal(matchesOrigin(movieFrom(['US', 'FR']), { excludeUs: true }), false, 'US co-production still excluded');
  assert.equal(matchesOrigin(movieFrom(['FR']), { excludeUs: true }), true);
});

test('matchesOrigin: a non-empty allowed set requires a matching country', () => {
  const allowed = new Set(['FR', 'DE']);
  assert.equal(matchesOrigin(movieFrom(['FR']), { allowed }), true);
  assert.equal(matchesOrigin(movieFrom(['JP']), { allowed }), false);
  // Empty allowed set = no country restriction.
  assert.equal(matchesOrigin(movieFrom(['JP']), { allowed: new Set() }), true);
});

test('matchesOrigin: no filters and missing country data pass through', () => {
  assert.equal(matchesOrigin(movieFrom(['JP']), {}), true);
  assert.equal(matchesOrigin({}, { excludeUs: true }), true, 'unknown origin is not assumed US');
});

test('isIndie: true unless a production company is a Hollywood major', () => {
  assert.equal(isIndie(movieFrom(['US'], [174])), false, '174 = Warner Bros (a major)');
  assert.equal(isIndie(movieFrom(['FR'], [99999])), true, 'unknown company counts as indie');
  assert.equal(isIndie(movieFrom(['JP'], [])), true, 'no companies counts as indie');
  assert.equal(isIndie(movieFrom(['US'], [99999, 4])), false, 'any major (4 = Paramount) disqualifies');
});

test('filterSig is stable regardless of allowed-set order and varies by toggle', () => {
  const a = filterSig({ allowed: new Set(['FR', 'DE']), excludeUs: false, indie: false });
  const b = filterSig({ allowed: new Set(['DE', 'FR']), excludeUs: false, indie: false });
  assert.equal(a, b, 'order-independent');
  assert.notEqual(a, filterSig({ allowed: new Set(['FR', 'DE']), excludeUs: true, indie: false }));
  assert.notEqual(a, filterSig({ allowed: new Set(['FR', 'DE']), excludeUs: false, indie: true }));
  assert.notEqual(a, filterSig({ allowed: new Set(['FR']), excludeUs: false, indie: false }));
});

test('filterSig varies by tone so each tone caches its own pool', () => {
  const base = filterSig({ allowed: new Set(), excludeUs: false, indie: false });
  const heartfelt = filterSig({ allowed: new Set(), excludeUs: false, indie: false, tone: 'heartfelt' });
  const deadpan = filterSig({ allowed: new Set(), excludeUs: false, indie: false, tone: 'deadpan' });
  assert.notEqual(base, heartfelt, 'a tone changes the signature');
  assert.notEqual(heartfelt, deadpan, 'different tones get different signatures');
});

test('resolveFilters keeps a known tone and drops an unknown one to ""', () => {
  assert.equal(resolveFilters({ tone: 'heartfelt' }).tone, 'heartfelt');
  assert.equal(resolveFilters({ tone: 'bogus-tone' }).tone, '', 'unknown tone is ignored, not filtered on');
  assert.equal(resolveFilters({}).tone, '', 'no tone by default');
});

test('resolveFilters keeps movie/tv and drops anything else to ""', () => {
  assert.equal(resolveFilters({ type: 'movie' }).type, 'movie');
  assert.equal(resolveFilters({ type: 'tv' }).type, 'tv');
  assert.equal(resolveFilters({ type: 'both' }).type, '', 'a bogus type is no filter, not an empty pool');
  assert.equal(resolveFilters({}).type, '', 'no type by default');
});

test('filterSig varies by media type so each type caches its own pool', () => {
  const both = filterSig({ allowed: new Set(), excludeUs: false, indie: false });
  const movie = filterSig({ allowed: new Set(), excludeUs: false, indie: false, type: 'movie' });
  const tv = filterSig({ allowed: new Set(), excludeUs: false, indie: false, type: 'tv' });
  assert.notEqual(both, movie, 'a type changes the signature');
  assert.notEqual(movie, tv, 'movies-only and tv-only get different signatures');
});

const full = (results) => ({ 'watch/providers': { results } });

test('returns only the user\'s chosen services that carry the title', () => {
  const movie = full({ PL: { flatrate: [
    { provider_id: 8, provider_name: 'Netflix', logo_path: '/n.png' },
    { provider_id: 337, provider_name: 'Disney+', logo_path: '/d.png' },
  ] } });
  const out = userServices(movie, 'PL', new Set([8]));
  assert.deepEqual(out, [{ id: 8, name: 'Netflix', logo: '/n.png' }]);
});

test('counts free and ad-supported tiers, not just subscription flatrate', () => {
  const movie = full({ PL: {
    free: [{ provider_id: 8, provider_name: 'Netflix', logo_path: '/n.png' }],
    ads: [{ provider_id: 9, provider_name: 'Prime', logo_path: '/p.png' }],
  } });
  const out = userServices(movie, 'PL', new Set([8, 9]));
  assert.deepEqual(out.map((s) => s.id).sort(), [8, 9]);
});

test('dedupes a service that appears in more than one tier', () => {
  const movie = full({ PL: {
    flatrate: [{ provider_id: 8, provider_name: 'Netflix', logo_path: '/n.png' }],
    ads: [{ provider_id: 8, provider_name: 'Netflix', logo_path: '/n.png' }],
  } });
  assert.equal(userServices(movie, 'PL', new Set([8])).length, 1);
});

test('empty when the title is on no chosen service (the not-streamable gate)', () => {
  const movie = full({ PL: { flatrate: [{ provider_id: 337, provider_name: 'Disney+', logo_path: '/d.png' }] } });
  assert.deepEqual(userServices(movie, 'PL', new Set([8])), []);
});

test('empty when the region has no providers block at all', () => {
  assert.deepEqual(userServices(full({ US: { flatrate: [] } }), 'PL', new Set([8])), []);
  assert.deepEqual(userServices({}, 'PL', new Set([8])), []);
});

test('tolerates a missing logo (null, so the card can fall back to a glyph)', () => {
  const movie = full({ PL: { flatrate: [{ provider_id: 8, provider_name: 'Netflix' }] } });
  assert.deepEqual(userServices(movie, 'PL', new Set([8])), [{ id: 8, name: 'Netflix', logo: null }]);
});
