// Unit tests for the Discover card's icon→deep-link matcher. The bug this guards
// against: TMDB names a service by tier/reseller variant ("Paramount Plus
// Premium") while MotN returns the plain brand ("Paramount+"), so an exact id or
// name match misses and the click used to fall back to a generic TMDB page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { brandKey, matchServiceLink } from '../../public/service-match.js';

test('brandKey collapses TMDB tier/reseller variants onto one brand', () => {
  assert.equal(brandKey('Paramount Plus Premium'), 'paramount');
  assert.equal(brandKey('Paramount Plus Essential'), 'paramount');
  assert.equal(brandKey('Paramount+ Amazon Channel'), 'paramount');
  assert.equal(brandKey('Paramount+'), 'paramount');
  // Showtime now ships inside Paramount+, so it folds in too.
  assert.equal(brandKey('Showtime'), 'paramount');
});

test('brandKey folds the HBO Max / Max rebrand together but spares Cinemax', () => {
  assert.equal(brandKey('HBO Max'), 'hbo');
  assert.equal(brandKey('Max'), 'hbo');
  assert.equal(brandKey('HBO Max Amazon Channel'), 'hbo');
  assert.notEqual(brandKey('Cinemax'), 'hbo');
});

test('matchServiceLink prefers an exact server-tagged provider id', () => {
  const links = [
    { service: 'Netflix', providerId: 8, link: 'https://netflix/x' },
    { service: 'Max', providerId: 1899, link: 'https://hbo/x' },
  ];
  assert.equal(matchServiceLink(links, { sid: 1899, sname: 'HBO Max' }), 'https://hbo/x');
});

test('matchServiceLink falls back to a brand match when the id differs', () => {
  // The card icon is the "Premium" tier (id 2303); MotN tagged its option with a
  // different tier id, so only the brand key bridges them.
  const links = [{ service: 'Paramount+', providerId: 2616, link: 'https://paramount/x' }];
  assert.equal(matchServiceLink(links, { sid: 2303, sname: 'Paramount Plus Premium' }), 'https://paramount/x');
});

test('matchServiceLink bridges a Showtime icon to the Paramount+ link', () => {
  const links = [{ service: 'Paramount+', providerId: 531, link: 'https://paramount/x' }];
  assert.equal(matchServiceLink(links, { sid: 37, sname: 'Showtime' }), 'https://paramount/x');
});

test('matchServiceLink returns null when nothing is a confident match', () => {
  const links = [{ service: 'Disney+', providerId: 337, link: 'https://disney/x' }];
  assert.equal(matchServiceLink(links, { sid: 8, sname: 'Netflix' }), null);
  assert.equal(matchServiceLink([], { sid: 8, sname: 'Netflix' }), null);
  assert.equal(matchServiceLink(undefined, { sid: 8, sname: 'Netflix' }), null);
});
