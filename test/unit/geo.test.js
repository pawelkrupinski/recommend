// Unit tests for the origin-geography reference (geo.js): the continent →
// country mapping that both the Settings picker and the recommendation origin
// filter derive from.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONTINENTS, countriesInContinent, allowedOriginSet } from '../../src/geo.js';

test('every continent has a unique code and at least one country', () => {
  const codes = CONTINENTS.map((c) => c.code);
  assert.equal(new Set(codes).size, codes.length, 'continent codes are unique');
  for (const c of CONTINENTS) assert.ok(c.countries.length > 0, `${c.code} has countries`);
});

test('countriesInContinent returns the continent members, [] for unknown', () => {
  assert.ok(countriesInContinent('EU').includes('FR'));
  assert.ok(countriesInContinent('EU').includes('PL'));
  assert.ok(countriesInContinent('NA').includes('US'));
  assert.deepEqual(countriesInContinent('ZZ'), []);
  assert.deepEqual(countriesInContinent(''), []);
});

test('allowedOriginSet unions the chosen continent with explicit countries', () => {
  const na = allowedOriginSet({ continent: 'NA' });
  assert.ok(na.has('US') && na.has('CA') && na.has('MX'));

  // Continent EU plus an explicit Asian country broadens the set across both.
  const mixed = allowedOriginSet({ continent: 'EU', countries: ['JP'] });
  assert.ok(mixed.has('FR'), 'continent member present');
  assert.ok(mixed.has('JP'), 'explicit country present');
});

test('allowedOriginSet is empty when nothing is chosen (no restriction)', () => {
  assert.equal(allowedOriginSet({}).size, 0);
  assert.equal(allowedOriginSet({ continent: '', countries: [] }).size, 0);
  assert.equal(allowedOriginSet().size, 0);
});
