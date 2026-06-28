// Unit tests for JustWatch's pure mappers (src/justwatch.js) against a recorded
// real GraphQL response (test/fixtures/justwatch-dune.json — a "Dune Part Two" PL
// search, captured live). No network: the orchestration (search + cache) is a thin
// shell over these, the same convention the other scraped sources follow.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { offersToOptions, pickNode } from '../../src/justwatch.js';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../fixtures/justwatch-dune.json', import.meta.url)), 'utf8'),
);
// The fixture's first edge is "Diuna: Część druga" (Dune: Part Two), tmdb 693134.
const duneTwo = () => pickNode(fixture, { tmdbId: 693134, imdbId: 'tt15239678', mediaType: 'movie' });

test('pickNode selects the node whose TMDB id matches — not the top hit', () => {
  const node = duneTwo();
  assert.equal(node.content.externalIds.tmdbId, '693134');
  assert.equal(node.content.title, 'Diuna: Część druga');
});

test('pickNode matches Dune (2021) — a different result in the same response', () => {
  // The same search returned several "Diuna" titles; id-matching must pick the
  // 2021 film, not the 2024 one, proving it keys on id rather than search rank.
  const node = pickNode(fixture, { tmdbId: 438631, imdbId: 'tt1160419', mediaType: 'movie' });
  assert.equal(node.content.originalReleaseYear, 2021);
});

test('pickNode falls back to IMDb id when TMDB id is absent', () => {
  const node = pickNode(fixture, { tmdbId: 999999999, imdbId: 'tt15239678', mediaType: 'movie' });
  assert.equal(node.content.externalIds.tmdbId, '693134');
});

test('pickNode returns null rather than guess when nothing matches', () => {
  assert.equal(pickNode(fixture, { tmdbId: 1, imdbId: 'tt0000000', mediaType: 'movie' }), null);
});

test('pickNode respects media type — a movie id must not match a SHOW node', () => {
  // "Diuna: Proroctwo" (90228) is a SHOW in the fixture; asking for a movie skips it.
  assert.equal(pickNode(fixture, { tmdbId: 90228, mediaType: 'movie' }), null);
  assert.ok(pickNode(fixture, { tmdbId: 90228, mediaType: 'tv' }));
});

test('offersToOptions keeps only subscription-style access (drops rent/buy)', () => {
  // Dune Part Two PL: Player is FLATRATE; everything else is RENT/BUY.
  const opts = offersToOptions(duneTwo().offers);
  assert.deepEqual(opts.map((o) => o.service), ['Player']);
  assert.equal(opts[0].type, 'subscription');
  assert.equal(opts[0].serviceId, 505);
  assert.equal(opts[0].link, 'https://player.pl/filmy-online/diuna-czesc-druga,270434');
});

test('offersToOptions collapses repeated quality tiers to one row per service', () => {
  // Dune (2021) PL has FLATRATE on Player AND HBO Max, each repeated per quality.
  const dune2021 = pickNode(fixture, { tmdbId: 438631, mediaType: 'movie' });
  const opts = offersToOptions(dune2021.offers);
  const services = opts.map((o) => o.service);
  assert.deepEqual(services, ['Player', 'HBO Max']); // exactly one each, no dups
});

test('offersToOptions returns [] for a title with no offers', () => {
  const noOffers = pickNode(fixture, { tmdbId: 1170608, mediaType: 'movie' }); // Dune Part Three (2026)
  assert.deepEqual(offersToOptions(noOffers.offers), []);
});
