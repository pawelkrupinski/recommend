// Unit tests for the origin-geography reference (geo.js): the continent →
// country mapping and the type-tagged value parser that the Discover origin
// picker and the recommendation origin filter both derive from.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONTINENTS, countriesInContinent, allowedOriginFromValue } from '../../src/geo.js';

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

test('allowedOriginFromValue: a continent value expands to all its countries', () => {
  const na = allowedOriginFromValue('c:NA');
  assert.ok(na.has('US') && na.has('CA') && na.has('MX'));
  assert.equal(allowedOriginFromValue('c:EU').has('FR'), true);
});

test('allowedOriginFromValue: a country value yields just that country', () => {
  assert.deepEqual([...allowedOriginFromValue('k:FR')], ['FR']);
  // The 'k:' tag disambiguates a country whose code collides with a continent
  // code: 'SA' is South America as a continent but Saudi Arabia as a country.
  assert.deepEqual([...allowedOriginFromValue('k:SA')], ['SA']);
  assert.ok(allowedOriginFromValue('c:SA').size > 1, 'continent SA expands to many');
});

test('allowedOriginFromValue is empty for blank/unknown/untagged values', () => {
  assert.equal(allowedOriginFromValue('').size, 0);
  assert.equal(allowedOriginFromValue().size, 0);
  assert.equal(allowedOriginFromValue('FR').size, 0, 'untagged value ignored');
  assert.equal(allowedOriginFromValue('c:ZZ').size, 0, 'unknown continent');
  assert.equal(allowedOriginFromValue('k:').size, 0, 'empty country code');
});
