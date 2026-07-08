// Unit tests for src/streaming-apps.js `androidPackage` — the map from a MotN
// service name to the Android package the client force-opens (Intent.setPackage)
// so a deep link reaches the installed app instead of the browser. Matched with
// the same normalise-and-substring rules as serviceSearchLink, so the same
// name variants and rebrands resolve.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { androidPackage } from '../../src/streaming-apps.js';

test('androidPackage maps the mainstream services to their store package', () => {
  assert.equal(androidPackage('Netflix'), 'com.netflix.mediaclient');
  assert.equal(androidPackage('Disney+'), 'com.disney.disneyplus');
  assert.equal(androidPackage('Prime Video'), 'com.amazon.avod.thirdpartyclient');
  assert.equal(androidPackage('Hulu'), 'com.hulu.plus');
  assert.equal(androidPackage('Peacock'), 'com.peacocktv.peacockandroid');
});

test('androidPackage folds rebrands and tier variants like the web link matcher', () => {
  // "Max" and "HBO Max" are the same app; a plain "Max" must still resolve.
  assert.equal(androidPackage('Max'), 'com.wbd.hbomax');
  assert.equal(androidPackage('HBO Max'), 'com.wbd.hbomax');
  // Showtime now ships inside Paramount+, so it targets the Paramount+ app.
  assert.equal(androidPackage('Paramount+'), 'com.cbs.app');
  assert.equal(androidPackage('Showtime'), 'com.cbs.app');
});

test('androidPackage keeps SkyShowtime distinct from Paramount/Showtime', () => {
  // brand overlap: "SkyShowtime" contains "showtime", so it must be tested first
  // or it would wrongly resolve to the Paramount+ package.
  assert.equal(androidPackage('SkyShowtime'), 'com.skyshowtime.skyshowtime');
});

test('androidPackage returns null for a service without a known native app', () => {
  assert.equal(androidPackage('Some Regional Streamer'), null);
  assert.equal(androidPackage(''), null);
  assert.equal(androidPackage(null), null);
});
