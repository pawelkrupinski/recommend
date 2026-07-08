// Unit tests for the TMDB watch-page deep-link scraper's pure parser
// (src/tmdb-watch-links.js) against a recorded real page fragment
// (test/fixtures/tmdb-watch-interstellar-gb.html — Interstellar's GB "Where to
// Watch" block, captured live), plus the /api/where merge helpers that fold the
// scraped links into the primary options (src/server.js). No network: the fetch +
// cache orchestration is a thin shell over these, the same convention the other
// scraped sources follow.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { freshDbEnv } from '../helpers/env.js';

// Point DB_PATH at a throwaway db BEFORE importing — the import chain
// (→ cache.js → db.js) opens SQLite at module load (see justwatch.test.js).
freshDbEnv();
const { parseWatchLinks } = await import('../../src/tmdb-watch-links.js');
const { needsWatchScrape, gapLinks } = await import('../../src/server.js');

const html = readFileSync(
  fileURLToPath(new URL('../fixtures/tmdb-watch-interstellar-gb.html', import.meta.url)),
  'utf8',
);

test('parseWatchLinks extracts one subscription option per flatrate service, with its per-title deep link', () => {
  const opts = parseWatchLinks(html);
  // The GB block lists 4 flatrate services (the rest of its anchors are rent/buy).
  assert.deepEqual(opts.map((o) => o.service).sort(),
    ['HBO Max', 'HBO Max Amazon Channel', 'Now TV Cinema', 'Sky Go']);
  assert.ok(opts.every((o) => o.type === 'subscription'), 'flatrate maps to subscription');
  // The link is the JustWatch redirect's `r=` target — the real per-title deep link.
  const byName = Object.fromEntries(opts.map((o) => [o.service, o.link]));
  assert.match(byName['HBO Max'], /^https:\/\/www\.hbomax\.com\/gb\/en\/movies\/interstellar\//);
  assert.match(byName['Sky Go'], /^https:\/\/www\.sky\.com\/watch\/sky-go\//);
});

test('parseWatchLinks drops rent/buy anchors and dedups a service repeated across quality tiers', () => {
  const anchors = (html.match(/click\.justwatch\.com\/a\?cx=/g) || []).length;
  const opts = parseWatchLinks(html);
  assert.ok(anchors > opts.length,
    `parsed ${opts.length} subscription options from ${anchors} anchors — rent/buy + tier dups removed`);
  const ids = opts.map((o) => o.serviceId);
  assert.equal(new Set(ids).size, ids.length, 'no provider appears twice');
});

test('parseWatchLinks normalises deep-link hosts for the app handoff (appLink)', () => {
  // A *.max.com link (post-rebrand redirect host) must be rewritten to
  // play.hbomax.com so the iOS/Android app handoff still fires — proving the
  // parser routes links through appLink, not raw.
  const cx = Buffer.from(JSON.stringify({
    data: [{ schema: 'iglu:com.justwatch/clickout_context/jsonschema/1-3-2',
      data: { provider: 'HBO Max', monetizationType: 'flatrate', providerId: 1899 } }],
  })).toString('base64');
  const r = encodeURIComponent('https://play.max.com/movie/xyz');
  const synthetic = `<a href="https://click.justwatch.com/a?cx=${cx}&r=${r}&uct_country=us">`;
  const [opt] = parseWatchLinks(synthetic);
  assert.equal(opt.link, 'https://play.hbomax.com/movie/xyz');
});

test('parseWatchLinks skips an anchor whose cx payload does not decode, without throwing', () => {
  const good = parseWatchLinks(html).length;
  const withGarbage = `<a href="https://click.justwatch.com/a?cx=!!notbase64!!&r=${encodeURIComponent('https://x.test/')}">` + html;
  assert.equal(parseWatchLinks(withGarbage).length, good, 'the undecodable anchor is skipped, the real ones survive');
});

// ---- /api/where merge helpers (fold scraped links into primary options) -----

// A title on Netflix (TMDB provider 8) in this region.
const regionProviders = [{ provider_id: 8, provider_name: 'Netflix' }, { provider_id: 29, provider_name: 'Sky Go' }];

test('needsWatchScrape is true when a chosen provider has no linked primary option', () => {
  const chosen = new Set([8]);
  // The free TMDB source reported Netflix as streamable but link-less.
  const primary = [{ service: 'Netflix', serviceId: 8, type: 'subscription', link: null }];
  assert.equal(needsWatchScrape(primary, regionProviders, chosen), true);
});

test('needsWatchScrape is false when every chosen provider already has a deep link', () => {
  const chosen = new Set([8]);
  const primary = [{ service: 'Netflix', serviceId: 8, type: 'subscription', link: 'https://netflix.com/title/1' }];
  assert.equal(needsWatchScrape(primary, regionProviders, chosen), false,
    'JustWatch already covered the only chosen logo — no scrape needed');
});

test('gapLinks adds only scraped links for services the primary list left unlinked', () => {
  const primary = [{ service: 'Netflix', serviceId: 8, type: 'subscription', link: 'https://netflix.com/title/1' }];
  const scraped = [
    { service: 'Netflix', serviceId: 8, type: 'subscription', link: 'https://netflix.com/dup' }, // already linked → skip
    { service: 'Sky Go', serviceId: 29, type: 'subscription', link: 'https://sky.com/x' },        // new → keep
    { service: 'Broken', serviceId: 99, type: 'subscription', link: null },                        // no link → skip
  ];
  assert.deepEqual(gapLinks(primary, scraped), [
    { service: 'Sky Go', serviceId: 29, type: 'subscription', link: 'https://sky.com/x' },
  ]);
});
