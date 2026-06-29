#!/usr/bin/env node
/**
 * Harvest TMDB keyword IDs for each tone-tag slug and merge into
 * src/tone-data/tone-keywords.json.
 *
 * Usage:
 *   node --env-file=.env.local scripts/harvest-tmdb-tones.js
 *
 * Idempotent: re-runs merge into the existing file without removing entries.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(__dirname, '../src/tone-data/tone-keywords.json');

// Tone slug → search terms to submit to TMDB keyword search.
const TONES = {
  'heartfelt':    ['heartwarming', 'heartfelt', 'touching', 'tearjerker', 'bittersweet', 'emotional', 'poignant'],
  'feel-good':    ['feel-good', 'feel good movie', 'uplifting', 'crowd pleaser'],
  'deadpan':      ['deadpan', 'dry humor', 'dry humour', 'deadpan comedy', 'awkward humor'],
  'quirky':       ['quirky', 'offbeat', 'eccentric', 'whimsical', 'oddball'],
  'dark':         ['dark comedy', 'black comedy', 'bleak', 'nihilism', 'dark humor'],
  'gritty':       ['gritty', 'grim', 'hard boiled', 'neo-noir', 'grimdark'],
  'suspenseful':  ['suspense', 'tension', 'edge of your seat', 'nail-biting'],
  'mind-bending': ['mind-bending', 'mindfuck', 'nonlinear timeline', 'surreal', 'plot twist', 'reality bending'],
  'wholesome':    ['wholesome', 'family-friendly', 'innocent'],
  'campy':        ['camp', 'campy', 'b movie', "so bad it's good", 'kitsch', 'cheesy'],
  'melancholic':  ['melancholy', 'loneliness', 'existentialism', 'ennui', 'wistful', 'somber'],
  'satirical':    ['satire', 'social satire', 'political satire', 'parody', 'lampoon'],
  'irreverent':   ['irreverent', 'raunchy', 'crude humor', 'vulgar', 'gross-out'],
  'cerebral':     ['cerebral', 'philosophical', 'thought-provoking', 'intellectual'],
  'cozy':         ['cozy', 'comfort', 'slice of life', 'gentle', 'charming'],
  'romantic':     ['romantic', 'swoon', 'love story', 'romance', 'sweeping romance'],
};

const CONCURRENCY = 6;
const API_KEY = process.env.TMDB_API_KEY;

// ---------------------------------------------------------------------------
// Matching helpers
// ---------------------------------------------------------------------------

/** Lowercase + collapse hyphens/underscores to spaces. */
function normalize(s) {
  return s.toLowerCase().replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * A keyword name matches a search term if the normalised term appears
 * as a prefix word-boundary match in the normalised name:
 *   - exact equality, OR
 *   - name starts with "<term> " (term is at the beginning)
 *
 * This avoids false positives like "summer camp" for term "camp",
 * "bromance" for term "romance", "sexual tension" for term "tension".
 */
function keywordMatchesTerm(keywordName, searchTerm) {
  const n = normalize(keywordName);
  const t = normalize(searchTerm);
  return n === t || n.startsWith(t + ' ');
}

// ---------------------------------------------------------------------------
// TMDB API helpers
// ---------------------------------------------------------------------------

let totalRequests = 0;

async function tmdbGet(query, page) {
  const url =
    `https://api.themoviedb.org/3/search/keyword` +
    `?api_key=${API_KEY}` +
    `&query=${encodeURIComponent(query)}` +
    `&page=${page}`;
  const resp = await fetch(url);
  totalRequests++;
  if (resp.status === 429) {
    // Back off and retry once.
    await new Promise(r => setTimeout(r, 2000));
    const retry = await fetch(url);
    totalRequests++;
    if (!retry.ok) throw new Error(`TMDB 429 retry failed for "${query}" p${page}`);
    return retry.json();
  }
  if (!resp.ok) throw new Error(`TMDB ${resp.status} for "${query}" p${page}`);
  return resp.json();
}

/** Fetch every page for a single search term and return all matching keyword objects. */
async function fetchMatchingKeywords(slug, term) {
  const first = await tmdbGet(term, 1);
  const totalPages = first.total_pages ?? 1;
  const allResults = [...first.results];

  // Remaining pages (sequential per term to avoid hammering a single query).
  for (let p = 2; p <= totalPages; p++) {
    const data = await tmdbGet(term, p);
    allResults.push(...data.results);
  }

  const matched = allResults.filter(kw => keywordMatchesTerm(kw.name, term));
  return matched;
}

// ---------------------------------------------------------------------------
// Concurrency pool
// ---------------------------------------------------------------------------

/**
 * Run `tasks` (array of async functions) with at most `concurrency` in flight.
 * Returns results in the same order as tasks.
 */
async function withPool(tasks, concurrency) {
  const results = new Array(tasks.length);
  let next = 0;

  async function worker() {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, tasks.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (!API_KEY) {
    console.error('TMDB_API_KEY is not set. Run with --env-file=.env.local');
    process.exit(1);
  }

  const start = Date.now();

  // Load existing map (preserve all current entries).
  const existing = JSON.parse(readFileSync(OUTPUT_PATH, 'utf8'));

  // Build flat list of (slug, term) work items.
  const workItems = [];
  for (const [slug, terms] of Object.entries(TONES)) {
    for (const term of terms) {
      workItems.push({ slug, term });
    }
  }

  console.log(`Querying TMDB for ${workItems.length} terms across ${Object.keys(TONES).length} slugs…`);

  // Fetch in parallel with pool.
  const tasks = workItems.map(({ slug, term }) => () => {
    process.stdout.write('.');
    return fetchMatchingKeywords(slug, term).then(keywords => ({ slug, term, keywords }));
  });

  const results = await withPool(tasks, CONCURRENCY);
  console.log(); // newline after dots

  // Merge into the existing map.
  // map: keywordId (string) → Set<slug>
  const merged = {};

  // Seed with existing entries.
  for (const [id, slugs] of Object.entries(existing)) {
    merged[id] = new Set(slugs);
  }

  // Add newly discovered mappings.
  let newIds = 0;
  let newMappings = 0;
  for (const { slug, keywords } of results) {
    for (const kw of keywords) {
      const id = String(kw.id);
      const isNew = !merged[id];
      if (isNew) {
        merged[id] = new Set();
        newIds++;
      }
      if (!merged[id].has(slug)) {
        merged[id].add(slug);
        if (!isNew) newMappings++;
      }
    }
  }

  // Serialise: sort keys numerically, values as sorted arrays.
  const sortedKeys = Object.keys(merged).sort((a, b) => Number(a) - Number(b));
  const output = {};
  for (const id of sortedKeys) {
    output[id] = [...merged[id]].sort();
  }

  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2) + '\n');

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const reqPerSec = (totalRequests / (elapsed || 1)).toFixed(1);

  const totalIds = sortedKeys.length;
  console.log(`\nDone in ${elapsed}s, ${totalRequests} requests (~${reqPerSec} req/s)`);
  console.log(`Total keyword IDs in output: ${totalIds} (${newIds} new IDs, ${newMappings} new slug mappings on existing IDs)`);

  // Per-slug counts.
  const slugCounts = {};
  for (const slug of Object.keys(TONES)) slugCounts[slug] = 0;
  for (const slugSet of Object.values(merged)) {
    for (const slug of slugSet) {
      if (slug in slugCounts) slugCounts[slug]++;
    }
  }

  console.log('\nPer-slug keyword counts:');
  const empty = [];
  for (const [slug, count] of Object.entries(slugCounts)) {
    const bar = '█'.repeat(Math.min(count, 40));
    console.log(`  ${slug.padEnd(14)} ${String(count).padStart(3)}  ${bar}`);
    if (count === 0) empty.push(slug);
  }

  if (empty.length > 0) {
    console.log(`\nWARNING: no keywords found for: ${empty.join(', ')}`);
  }

  // Sanity check: 319357 must stay mapped to heartfelt.
  const check = output['319357'];
  if (!check || !check.includes('heartfelt')) {
    console.error('\nERROR: 319357→heartfelt mapping is missing! Aborting.');
    process.exit(1);
  }
  console.log('\n319357→heartfelt preserved ✓');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
