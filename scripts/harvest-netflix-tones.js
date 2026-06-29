#!/usr/bin/env node
/**
 * Harvest Netflix microgenre ("altgenre") per-title membership and map it to our
 * tone-tag slugs, merging into src/tone-data/tone-netflix.json (keyed by TMDB movie
 * id → array of tone slugs). This lets a film Netflix files under e.g. "Deadpan
 * Comedies" carry our `deadpan` tone even when TMDB keywords miss it.
 *
 * Usage:
 *   node --env-file=.env.local scripts/harvest-netflix-tones.js
 *
 * Idempotent: re-runs merge into the existing file without removing entries; a
 * tmdb id may accumulate multiple slugs across runs.
 *
 * --------------------------------------------------------------------------
 * FEASIBILITY NOTE (read before assuming this is broken)
 * --------------------------------------------------------------------------
 * Netflix's *tonal* microgenres ("Deadpan Comedies" = code 1521, "Feel-Good",
 * "Cerebral", …) are the whole value of this feature — broad genres like plain
 * "Comedy" carry no tone. Those tonal category → title rosters live ONLY on
 * netflix.com/browse/genre/<code>, which is login-walled and returns nothing to
 * an anonymous request (even through our residential proxy). Public catalog
 * aggregators were probed and do not fill the gap:
 *
 *   - netflix.com/browse/genre/<code>  → login wall (proxiedText returns null)
 *   - whats-on-netflix.com/genres/     → proxy blocked / no per-title roster
 *   - reelgood.com (Netflix + genre)   → proxy blocked; only broad genres anyway
 *   - flixable.com (Netflix + genre)   → proxy blocked; only broad genres anyway
 *   - netflix-codes.com                → reachable, but only code↔name mapping,
 *                                        NO list of which titles belong to a code
 *
 * So per-title membership for *tonal* microgenres is not publicly obtainable
 * today, and this script writes an empty (but valid) map rather than fabricate
 * data — the feature degrades gracefully to TMDB-keyword tones (tone-keywords.json).
 *
 * The machinery below (microgenre→slug mapping, source attempts via proxiedText,
 * TMDB resolution with a worker pool, merge-preserving write) is real and ready:
 * if a public source of tonal-microgenre membership appears, add a SOURCE that
 * yields { title, year, microgenre } items and the rest works unchanged.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { proxiedText } from '../src/fetch.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(__dirname, '../src/tone-data/tone-netflix.json');

const API_KEY = process.env.TMDB_API_KEY;
const CONCURRENCY = 5;          // workers against TMDB
const MAX_LOOKUPS = 300;        // sanity cap on TMDB search calls per run

// ---------------------------------------------------------------------------
// Netflix microgenre name → tone slug(s)
// ---------------------------------------------------------------------------
// Each rule is [test-regex, slug]. A microgenre name maps to a slug only when it
// genuinely conveys that mood; ALL matching rules apply, so "Dark Suspenseful
// Movies" carries both `dark` and `suspenseful`. Purely descriptive categories
// ("Visually-striking", "Comedies", "Dramas") match nothing and are skipped.
const MICROGENRE_RULES = [
  [/\bdeadpan\b|\bunderstated\b|\bdry (?:wit|humou?r)\b/, 'deadpan'],
  [/\bfeel[- ]?good\b|\buplifting\b|\bcrowd[- ]?pleas/, 'feel-good'],
  [/\bheart(?:felt|warming)\b|\bemotional\b|\bsentimental\b|\bweep|\btearjerk|\bpoignant\b|\btouching\b/, 'heartfelt'],
  [/\bquirky\b|\boffbeat\b|\beccentric\b|\bwhimsical\b|\boddball\b/, 'quirky'],
  [/\bdark\b|\bbleak\b|\bnihilis|\bblack comed/, 'dark'],
  [/\bgritty\b|\bgrim\b|\bhard[- ]?boiled\b|\bneo[- ]?noir\b/, 'gritty'],
  [/\bsuspense|\btense\b|\bnail[- ]?biting\b|\bedge[- ]?of[- ]?your[- ]?seat\b/, 'suspenseful'],
  [/\bmind[- ]?bending\b|\bmind[- ]?f|\bsurreal\b|\breality[- ]?bending\b|\btwisty\b/, 'mind-bending'],
  [/\bwholesome\b|\bfamily[- ]?friendly\b|\binnocent\b/, 'wholesome'],
  [/\bcampy\b|\bb[- ]?movie|\bkitsch|\bcheesy\b|\bso bad/, 'campy'],
  [/\bmelanchol|\bsomber\b|\bsombre\b|\bwistful\b|\bennui\b/, 'melancholic'],
  [/\bsatir|\bspoof\b|\bparod|\blampoon\b/, 'satirical'],
  [/\birreverent\b|\braunchy\b|\braucous\b|\bsteamy\b|\bcrude\b|\bgross[- ]?out\b|\bvulgar\b/, 'irreverent'],
  [/\bcerebral\b|\bphilosophical\b|\bthought[- ]?provoking\b|\bintellectual\b|\bthinky\b/, 'cerebral'],
  [/\bcozy\b|\bcosy\b|\bcomfort\b|\bgentle\b|\bslice[- ]?of[- ]?life\b/, 'cozy'],
  [/\bromantic\b|\bromance\b|\blove stor|\bswoon/, 'romantic'],
];

/** Map a Netflix microgenre/category name to its tone slugs (deduped, possibly empty). */
export function microgenreToSlugs(name) {
  if (!name) return [];
  const n = name.toLowerCase();
  const slugs = new Set();
  for (const [re, slug] of MICROGENRE_RULES) {
    if (re.test(n)) slugs.add(slug);
  }
  return [...slugs];
}

// ---------------------------------------------------------------------------
// Sources: each returns an array of { title, year, microgenre } items scraped
// through the residential proxy. A source that is blocked/empty returns [] so
// the harvest degrades cleanly. Add a working tonal-microgenre source here.
// ---------------------------------------------------------------------------

/**
 * Attempt to read tonal-microgenre title rosters from a public source. Currently
 * none expose this (see the feasibility note at the top): every probed page is
 * either login-walled, proxy-blocked, or carries only code↔name mappings with no
 * title roster. Returns [] until a viable source exists.
 */
async function harvestTonalMicrogenres() {
  const items = [];
  // Probe the one reachable public page so a re-run re-confirms the obstacle
  // rather than silently assuming it. netflix-codes.com lists tonal category
  // names but, crucially, no titles under them — so it yields zero memberships.
  const html = await proxiedText('https://www.netflix-codes.com/');
  if (!html) {
    console.log('  netflix-codes.com: unreachable through proxy (no roster source available).');
    return items;
  }
  console.log('  netflix-codes.com: reachable but lists code↔name only, no per-title roster.');
  return items;
}

const SOURCES = [harvestTonalMicrogenres];

// ---------------------------------------------------------------------------
// TMDB title → id resolution
// ---------------------------------------------------------------------------

let totalRequests = 0;

async function searchTmdbId(title, year) {
  const url =
    `https://api.themoviedb.org/3/search/movie` +
    `?api_key=${API_KEY}` +
    `&query=${encodeURIComponent(title)}` +
    (year ? `&year=${encodeURIComponent(year)}` : '') +
    `&page=1`;

  for (let attempt = 0; attempt < 4; attempt++) {
    const resp = await fetch(url);
    totalRequests++;
    if (resp.status === 429 || resp.status === 503) {
      const wait = Number(resp.headers.get('retry-after')) * 1000 || 1000 * 2 ** attempt;
      await new Promise(r => setTimeout(r, wait));
      continue;
    }
    if (!resp.ok) throw new Error(`TMDB ${resp.status} for "${title}" (${year ?? '?'})`);
    const data = await resp.json();
    return data.results?.[0]?.id ?? null;
  }
  throw new Error(`TMDB rate-limited resolving "${title}"`);
}

/** Run async task factories with at most `concurrency` in flight; halves on 429/503. */
async function withPool(tasks, concurrency) {
  const results = new Array(tasks.length);
  let next = 0;
  let limit = concurrency;

  async function worker() {
    while (next < tasks.length) {
      const i = next++;
      try {
        results[i] = await tasks[i]();
      } catch (e) {
        if (/429|503|rate-limited/.test(e.message) && limit > 1) {
          limit = Math.max(1, Math.floor(limit / 2));
          await new Promise(r => setTimeout(r, 1000));
        }
        results[i] = null;
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length || 1) }, () => worker());
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const start = Date.now();

  // Load existing map (preserve all current entries).
  const existing = JSON.parse(readFileSync(OUTPUT_PATH, 'utf8'));

  // 1. Harvest microgenre memberships from every source.
  console.log('Harvesting Netflix tonal-microgenre memberships…');
  const rawItems = [];
  for (const source of SOURCES) {
    rawItems.push(...await source());
  }

  // 2. Keep only items whose microgenre maps to at least one tone slug.
  const tonal = [];
  for (const it of rawItems) {
    const slugs = microgenreToSlugs(it.microgenre);
    if (slugs.length) tonal.push({ ...it, slugs });
  }
  console.log(`Harvested ${rawItems.length} memberships, ${tonal.length} carry a tone slug.`);

  // 3. Dedupe by (title, year) so each title is resolved to a tmdb id once;
  //    union the slugs of every membership for that title.
  const byTitle = new Map();
  for (const it of tonal) {
    const key = `${it.title.toLowerCase()}|${it.year ?? ''}`;
    const slot = byTitle.get(key) || { title: it.title, year: it.year, slugs: new Set() };
    for (const s of it.slugs) slot.slugs.add(s);
    byTitle.set(key, slot);
  }
  let unique = [...byTitle.values()];
  if (unique.length > MAX_LOOKUPS) {
    console.log(`Capping TMDB lookups at ${MAX_LOOKUPS} (had ${unique.length}).`);
    unique = unique.slice(0, MAX_LOOKUPS);
  }

  // 4. Resolve each title → tmdb id (5-worker pool). Skip if no API key and
  //    nothing to resolve — an empty harvest still produces a valid file.
  let resolved = [];
  if (unique.length) {
    if (!API_KEY) {
      console.error('TMDB_API_KEY is not set. Run with --env-file=.env.local');
      process.exit(1);
    }
    const tasks = unique.map(u => async () => {
      process.stdout.write('.');
      const id = await searchTmdbId(u.title, u.year);
      return id ? { id: String(id), slugs: [...u.slugs] } : null;
    });
    resolved = (await withPool(tasks, CONCURRENCY)).filter(Boolean);
    console.log();
  }

  // 5. Merge into existing map (preserve; only add). id → Set<slug>.
  const merged = {};
  for (const [id, slugs] of Object.entries(existing)) merged[id] = new Set(slugs);

  let newIds = 0;
  let newMappings = 0;
  for (const { id, slugs } of resolved) {
    const isNew = !merged[id];
    if (isNew) { merged[id] = new Set(); newIds++; }
    for (const slug of slugs) {
      if (!merged[id].has(slug)) {
        merged[id].add(slug);
        if (!isNew) newMappings++;
      }
    }
  }

  // 6. Serialise: numeric-sorted keys, sorted slug arrays.
  const sortedKeys = Object.keys(merged).sort((a, b) => Number(a) - Number(b));
  const output = {};
  for (const id of sortedKeys) output[id] = [...merged[id]].sort();
  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2) + '\n');

  // 7. Summary + throughput.
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const reqPerSec = (totalRequests / (Number(elapsed) || 1)).toFixed(1);
  console.log(`\nDone in ${elapsed}s, ${totalRequests} TMDB requests (~${reqPerSec} req/s)`);
  console.log(`Output: ${sortedKeys.length} tmdb ids (${newIds} new, ${newMappings} new slug mappings on existing ids)`);
  if (sortedKeys.length === 0) {
    console.log('No per-title tonal-microgenre membership is publicly scrapeable; wrote empty map {}.');
    console.log('Feature degrades to TMDB-keyword tones (src/tone-data/tone-keywords.json).');
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
