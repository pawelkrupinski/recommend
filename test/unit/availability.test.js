// Unit tests for the streaming-availability seam (src/availability.js): JustWatch
// leads, the free TMDB source backs it up, MotN is the last resort, and a source
// that's off / empty / throwing falls through to the next without taking the
// answer down.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDbEnv } from '../helpers/env.js';

// availability.js -> justwatch/tmdb/motn -> db.js opens SQLite at import; point at
// a throwaway db first.
freshDbEnv();
const { streamingOptions, SOURCES } = await import('../../src/availability.js');

const source = (name, configured, fn) => ({
  name,
  configured: () => configured,
  streamingOptions: fn,
});
const opt = (service) => [{ service, type: 'subscription', link: `https://x/${service}` }];

test('prefers the first configured source that returns a non-empty result', async () => {
  const sources = [
    source('jw', true, async () => opt('Canal+')),
    source('motn', true, async () => opt('Netflix')),
  ];
  const out = await streamingOptions(1, 'movie', 'PL', 'pl', sources);
  assert.deepEqual(out.map((o) => o.service), ['Canal+']); // JustWatch wins, MotN never called
});

test('falls back to the next source when the preferred one is empty', async () => {
  let motnCalled = false;
  const sources = [
    source('jw', true, async () => []), // configured but no offers
    source('motn', true, async () => { motnCalled = true; return opt('Netflix'); }),
  ];
  const out = await streamingOptions(1, 'movie', 'PL', 'pl', sources);
  assert.ok(motnCalled);
  assert.deepEqual(out.map((o) => o.service), ['Netflix']);
});

test('skips an unconfigured source (e.g. MotN with no key)', async () => {
  const sources = [
    source('jw', false, async () => { throw new Error('should not be called'); }),
    source('motn', true, async () => opt('Netflix')),
  ];
  const out = await streamingOptions(1, 'movie', 'PL', 'pl', sources);
  assert.deepEqual(out.map((o) => o.service), ['Netflix']);
});

test('a throwing source is logged and skipped, not fatal', async () => {
  const sources = [
    source('jw', true, async () => { throw new Error('justwatch 503'); }),
    source('motn', true, async () => opt('Netflix')),
  ];
  const out = await streamingOptions(1, 'movie', 'PL', 'pl', sources);
  assert.deepEqual(out.map((o) => o.service), ['Netflix']);
});

test('the real source order puts the free sources before the paid MotN', () => {
  assert.deepEqual(SOURCES.map((s) => s.name), ['justwatch', 'tmdb', 'motn']);
});

test('a TMDB provider hit short-circuits MotN, sparing its quota', async () => {
  let motnCalled = false;
  const sources = [
    source('jw', true, async () => []), // scraper came up empty
    // TMDB asserts availability but carries no per-service deep link.
    source('tmdb', true, async () => [{ service: 'Netflix', type: 'subscription', link: null }]),
    source('motn', true, async () => { motnCalled = true; return opt('Netflix'); }),
  ];
  const out = await streamingOptions(1, 'movie', 'PL', 'pl', sources);
  assert.equal(motnCalled, false, 'MotN is not reached once TMDB reports availability');
  assert.equal(out.length, 1);
});

test('returns [] when every source is off or empty', async () => {
  const sources = [
    source('jw', true, async () => []),
    source('motn', false, async () => opt('Netflix')),
  ];
  assert.deepEqual(await streamingOptions(1, 'movie', 'PL', 'pl', sources), []);
});
