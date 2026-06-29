#!/usr/bin/env node
/**
 * Harvest TMDB keyword IDs for each tone-tag slug and merge into
 * src/tone-data/map-tmdb.json.
 *
 * Two complementary techniques:
 *   1. SYNONYM SEARCH   – query TMDB keyword search for per-tone mood synonyms
 *                         (expanded term lists vs. the original script).
 *   2. CO-OCCURRENCE    – discover popular films via existing tone keywords,
 *                         tally which OTHER keyword IDs co-occur most often on
 *                         those films, and add any whose name is itself
 *                         tonal/mood-bearing (same precision gate).
 *
 * Idempotent: re-runs merge into the existing file without removing entries.
 *
 * Usage:
 *   node --env-file=.env.local scripts/harvest-tmdb-tones.js
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(__dirname, '../src/tone-data/map-tmdb.json');

// ---------------------------------------------------------------------------
// Tone slug → search terms (extended from original).
// ---------------------------------------------------------------------------
const TONES = {
  'heartfelt': [
    'heartwarming', 'heartfelt', 'touching', 'tearjerker', 'bittersweet',
    'emotional', 'poignant', 'moving', 'inspirational', 'sentimental',
    'nostalgic', 'tear-jerking', 'emotionally moving',
  ],
  'feel-good': [
    'feel-good', 'feel good movie', 'uplifting', 'crowd pleaser',
    'life-affirming', 'joyful', 'optimistic', 'lighthearted', 'cheerful',
    'crowd-pleasing',
  ],
  'deadpan': [
    'deadpan', 'dry humor', 'dry humour', 'deadpan comedy', 'awkward humor',
    'deadpan humor', 'deadpan humour', 'understatement humor',
    'straight-faced comedy', 'awkward comedy',
  ],
  'quirky': [
    'quirky', 'offbeat', 'eccentric', 'whimsical', 'oddball',
    'zany', 'unconventional humor', 'quirky humor', 'idiosyncratic',
    'quirky comedy',
  ],
  'dark': [
    'dark comedy', 'black comedy', 'bleak', 'nihilism', 'dark humor',
    'dark humour', 'gloomy', 'nihilistic', 'dark atmosphere', 'dark tone',
    'bleak comedy', 'dark satire', 'darkly comic',
  ],
  'gritty': [
    'gritty', 'grim', 'hard boiled', 'neo-noir', 'grimdark',
    'visceral', 'brutal', 'uncompromising', 'raw', 'noir atmosphere',
    'gritty realism', 'hard-boiled', 'grim realism',
  ],
  'suspenseful': [
    'suspense', 'tension', 'edge of your seat', 'nail-biting',
    'gripping', 'thrilling', 'tense atmosphere', 'foreboding', 'ominous',
    'slow burn thriller', 'psychological tension', 'white-knuckle',
  ],
  'mind-bending': [
    'mind-bending', 'mindfuck', 'nonlinear timeline', 'surreal', 'plot twist',
    'reality bending', 'unreliable narrator', 'psychedelic', 'dreamlike',
    'disorienting', 'twist ending', 'kafkaesque', 'narrative twist',
    'reality distortion', 'surrealism',
  ],
  'wholesome': [
    'wholesome', 'family-friendly', 'innocent', 'uplifting family',
    'feel good family', 'positive message', 'feel-good family',
  ],
  'campy': [
    'camp', 'campy', 'b movie', "so bad it's good", 'kitsch', 'cheesy',
    'cult classic', 'schlocky', 'over the top', 'b-movie',
    'trashy', 'low budget horror', 'exploitation film',
  ],
  'melancholic': [
    'melancholy', 'loneliness', 'existentialism', 'ennui', 'wistful', 'somber',
    'brooding', 'tragic', 'grief', 'mourning', 'heartbreak', 'mournful',
    'bittersweet melancholy', 'despairing', 'melancholic atmosphere',
    'atmosphere of sadness',
  ],
  'satirical': [
    'satire', 'social satire', 'political satire', 'parody', 'lampoon',
    'biting satire', 'social commentary', 'political commentary',
    'mockumentary', 'social criticism',
  ],
  'irreverent': [
    'irreverent', 'raunchy', 'crude humor', 'vulgar', 'gross-out',
    'inappropriate humor', 'edgy humor', 'transgressive humor',
    'gross out comedy', 'shock humor',
  ],
  'cerebral': [
    'cerebral', 'philosophical', 'thought-provoking', 'intellectual',
    'meditative', 'contemplative', 'introspective', 'complex narrative',
    'slow burn', 'intellectually stimulating', 'philosophy', 'ideas-driven',
  ],
  'cozy': [
    'cozy', 'comfort', 'slice of life', 'gentle', 'charming',
    'cosy', 'warm atmosphere', 'comfortable', 'feel cozy', 'warm and fuzzy',
    'feel-cozy', 'heartwarming atmosphere',
  ],
  'romantic': [
    'romantic', 'swoon', 'love story', 'romance', 'sweeping romance',
    'slow burn romance', 'romantic tension', 'passionate romance',
    'falling in love', 'love triangle', 'romantic atmosphere',
  ],
};

// ---------------------------------------------------------------------------
// Co-occurrence settings
// ---------------------------------------------------------------------------
const COOC_FILMS_PER_TONE = 80;  // films to sample per tone (4 discover pages)
const COOC_MIN_FREQUENCY = 3;    // keyword must co-occur in ≥3 sampled films
const COOC_TOP_N = 50;           // top N candidates per tone before name filter

// Vocabulary that marks a keyword name as tonal/mood-bearing.
// A co-occurrence candidate must have at least one of these as a whole word.
const TONAL_WORDS = new Set([
  // warmth / joy
  'heartwarming', 'heartfelt', 'uplifting', 'wholesome', 'lighthearted',
  'optimistic', 'hopeful', 'cheerful', 'joyful', 'cozy', 'cosy',
  'life-affirming', 'charming', 'delightful',
  // sad / melancholy
  'melancholy', 'melancholic', 'mournful', 'wistful', 'bittersweet',
  'sentimental', 'poignant', 'nostalgic', 'nostalgia', 'brooding',
  'somber', 'sombre', 'desolate', 'foreboding', 'haunting', 'ominous',
  'sinister', 'bleak', 'gloomy', 'nihilistic', 'nihilism', 'grimdark',
  'despairing', 'tragic', 'grief', 'mournful',
  // tension / suspense
  'suspenseful', 'thrilling', 'gripping', 'anxiety', 'anxious', 'menacing',
  // humor styles
  'satirical', 'ironic', 'sarcastic', 'absurdist', 'absurdism', 'deadpan',
  'irreverent', 'raunchy', 'vulgar', 'crude', 'comedy', 'comedic',
  'comical', 'humorous', 'humor', 'humour', 'parody', 'satirize',
  'witty', 'wry', 'biting',
  // dark / grim
  'dark', 'gritty', 'grim', 'noir', 'visceral', 'uncompromising', 'brutal',
  // mind-bending / surreal
  'surreal', 'surrealist', 'psychedelic', 'dreamlike', 'kafkaesque',
  'disorienting', 'enigmatic',
  // cerebral
  'philosophical', 'cerebral', 'meditative', 'contemplative', 'introspective',
  'existential', 'existentialism', 'intellectual',
  // quirky
  'quirky', 'eccentric', 'whimsical', 'oddball', 'zany', 'idiosyncratic', 'offbeat',
  // campy
  'campy', 'kitschy', 'kitsch', 'schlocky', 'trashy', 'cheesy',
  // romantic
  'romantic', 'passionate',
  // general emotion
  'tearjerker', 'inspirational', 'moving', 'emotional',
  'atmospheric', 'moody', 'absurd',
]);

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

/**
 * Determine if a keyword name is tonal/mood-bearing.
 * Used to gate co-occurrence candidates: co-occurrence frequency alone is
 * not sufficient — the name must read as a mood/tone descriptor.
 *
 * Accepts if:
 *   (a) any whole word in the name is in TONAL_WORDS, OR
 *   (b) the name prefix-matches any search term in TONES (same gate as Phase 1).
 */
function isTonalKeyword(keywordName) {
  const words = normalize(keywordName).split(/\s+/);
  if (words.some(w => TONAL_WORDS.has(w))) return true;
  for (const terms of Object.values(TONES)) {
    for (const term of terms) {
      if (keywordMatchesTerm(keywordName, term)) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// TMDB API helpers
// ---------------------------------------------------------------------------

let totalRequests = 0;

async function tmdbFetch(url) {
  const resp = await fetch(url);
  totalRequests++;
  if (resp.status === 429) {
    await new Promise(r => setTimeout(r, 3000));
    const retry = await fetch(url);
    totalRequests++;
    if (!retry.ok) throw new Error(`TMDB 429 retry failed: ${url}`);
    return retry.json();
  }
  if (!resp.ok) throw new Error(`TMDB ${resp.status}: ${url}`);
  return resp.json();
}

async function tmdbKeywordSearch(query, page) {
  const url =
    `https://api.themoviedb.org/3/search/keyword` +
    `?api_key=${API_KEY}` +
    `&query=${encodeURIComponent(query)}` +
    `&page=${page}`;
  return tmdbFetch(url);
}

/** Fetch every page for a single search term and return all matching keyword objects. */
async function fetchMatchingKeywords(term) {
  const first = await tmdbKeywordSearch(term, 1);
  const totalPages = first.total_pages ?? 1;
  const allResults = [...first.results];
  for (let p = 2; p <= totalPages; p++) {
    const data = await tmdbKeywordSearch(term, p);
    allResults.push(...data.results);
  }
  return allResults.filter(kw => keywordMatchesTerm(kw.name, term));
}

async function discoverFilmsPage(keywordIds, page) {
  // Use OR (|) logic: films tagged with ANY of these tone keywords.
  const kwParam = keywordIds.join('|');
  const url =
    `https://api.themoviedb.org/3/discover/movie` +
    `?api_key=${API_KEY}` +
    `&with_keywords=${kwParam}` +
    `&sort_by=popularity.desc` +
    `&vote_count.gte=50` +
    `&language=en-US` +
    `&page=${page}`;
  return tmdbFetch(url);
}

async function getMovieKeywords(movieId) {
  const url = `https://api.themoviedb.org/3/movie/${movieId}/keywords?api_key=${API_KEY}`;
  const data = await tmdbFetch(url);
  return data.keywords || [];
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

  // Record before-counts per slug.
  const beforeCounts = {};
  for (const slug of Object.keys(TONES)) beforeCounts[slug] = 0;
  for (const slugs of Object.values(existing)) {
    for (const slug of slugs) {
      if (slug in beforeCounts) beforeCounts[slug]++;
    }
  }
  const beforeTotal = Object.keys(existing).length;
  console.log(`Before: ${beforeTotal} total keyword IDs`);

  // Seed merged map with existing entries.
  const merged = {};
  for (const [id, slugs] of Object.entries(existing)) {
    merged[id] = new Set(slugs);
  }

  // -------------------------------------------------------------------------
  // Phase 1: Synonym search (expanded term lists)
  // -------------------------------------------------------------------------
  const workItems = [];
  for (const [slug, terms] of Object.entries(TONES)) {
    for (const term of terms) workItems.push({ slug, term });
  }

  console.log(`\n=== Phase 1: Synonym search (${workItems.length} terms across ${Object.keys(TONES).length} slugs) ===`);

  const synonymTasks = workItems.map(({ slug, term }) => () => {
    process.stdout.write('.');
    return fetchMatchingKeywords(term).then(keywords => ({ slug, keywords }));
  });
  const synonymResults = await withPool(synonymTasks, CONCURRENCY);
  console.log();

  let synonymNewIds = 0;
  let synonymNewMappings = 0;
  for (const { slug, keywords } of synonymResults) {
    for (const kw of keywords) {
      const id = String(kw.id);
      const isNew = !merged[id];
      if (isNew) { merged[id] = new Set(); synonymNewIds++; }
      if (!merged[id].has(slug)) {
        merged[id].add(slug);
        if (!isNew) synonymNewMappings++;
      }
    }
  }
  console.log(`Phase 1 added: ${synonymNewIds} new IDs, ${synonymNewMappings} new slug mappings on existing IDs`);

  // -------------------------------------------------------------------------
  // Phase 2: Co-occurrence expansion
  // -------------------------------------------------------------------------
  console.log(`\n=== Phase 2: Co-occurrence expansion ===`);

  // For each tone, build its keyword ID list from the merged map after Phase 1.
  const toneKwIds = {};
  for (const slug of Object.keys(TONES)) {
    toneKwIds[slug] = Object.entries(merged)
      .filter(([, slugSet]) => slugSet.has(slug))
      .map(([id]) => id);
  }

  // Phase 2a: discover films for each tone (parallelised, up to CONCURRENCY tones at once).
  console.log('  Discovering films per tone…');
  const discoverTasks = Object.entries(toneKwIds).map(([slug, kwIds]) => async () => {
    if (kwIds.length === 0) return { slug, filmIds: [] };
    const filmIds = [];
    const maxPages = Math.ceil(COOC_FILMS_PER_TONE / 20);
    for (let p = 1; p <= maxPages && filmIds.length < COOC_FILMS_PER_TONE; p++) {
      try {
        // Limit keyword IDs to 20 to keep URL reasonable; all are already precision-filtered.
        const data = await discoverFilmsPage(kwIds.slice(0, 20), p);
        filmIds.push(...(data.results || []).map(f => f.id));
        if (p >= (data.total_pages ?? 1)) break;
      } catch (e) {
        console.error(`\n  discover error for ${slug} p${p}: ${e.message}`);
        break;
      }
    }
    return { slug, filmIds: filmIds.slice(0, COOC_FILMS_PER_TONE) };
  });
  const discoverResults = await withPool(discoverTasks, CONCURRENCY);

  const slugFilmIds = {};
  for (const { slug, filmIds } of discoverResults) {
    slugFilmIds[slug] = filmIds;
    console.log(`  ${slug.padEnd(14)}: ${filmIds.length} films`);
  }

  // Phase 2b: fetch keywords for all unique films in one pool.
  const allFilmIds = [...new Set(Object.values(slugFilmIds).flat())];
  console.log(`\n  Fetching keywords for ${allFilmIds.length} unique films…`);

  const filmKeywordsMap = new Map(); // movieId → Keyword[]
  const filmKwTasks = allFilmIds.map(fid => async () => {
    process.stdout.write('.');
    const kws = await getMovieKeywords(fid);
    filmKeywordsMap.set(fid, kws);
  });
  await withPool(filmKwTasks, CONCURRENCY);
  console.log();

  // Phase 2c: tally co-occurrences per tone, filter, and merge.
  let coocNewIds = 0;
  let coocNewMappings = 0;
  const coocAddedBySlug = {};

  for (const [slug, filmIds] of Object.entries(slugFilmIds)) {
    if (filmIds.length === 0) continue;
    coocAddedBySlug[slug] = [];

    const coocMap = new Map(); // kwId → {name, count}
    for (const fid of filmIds) {
      for (const kw of (filmKeywordsMap.get(fid) || [])) {
        const id = String(kw.id);
        if (!coocMap.has(id)) coocMap.set(id, { name: kw.name, count: 0 });
        coocMap.get(id).count++;
      }
    }

    // Sort by frequency, take top candidates above threshold.
    const candidates = [...coocMap.entries()]
      .filter(([, { count }]) => count >= COOC_MIN_FREQUENCY)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, COOC_TOP_N);

    for (const [id, { name }] of candidates) {
      if (merged[id]?.has(slug)) continue;         // already mapped to this slug
      if (!isTonalKeyword(name)) continue;          // name not tonal → skip

      const isNew = !merged[id];
      if (isNew) { merged[id] = new Set(); coocNewIds++; }
      if (!merged[id].has(slug)) {
        merged[id].add(slug);
        coocAddedBySlug[slug].push(name);
        if (!isNew) coocNewMappings++;
      }
    }
  }
  console.log(`Phase 2 added: ${coocNewIds} new IDs, ${coocNewMappings} new slug mappings on existing IDs`);

  // Print a sample of co-occurrence additions for spot-checking.
  console.log('\nSample co-occurrence additions:');
  for (const [slug, names] of Object.entries(coocAddedBySlug)) {
    if (names.length > 0) {
      console.log(`  ${slug.padEnd(14)}: ${names.slice(0, 5).join(', ')}`);
    }
  }

  // -------------------------------------------------------------------------
  // Serialise: sort keys numerically, values as sorted arrays.
  // -------------------------------------------------------------------------
  const sortedKeys = Object.keys(merged).sort((a, b) => Number(a) - Number(b));
  const output = {};
  for (const id of sortedKeys) {
    output[id] = [...merged[id]].sort();
  }
  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2) + '\n');

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const afterTotal = sortedKeys.length;
  const reqPerSec = (totalRequests / parseFloat(elapsed || '1')).toFixed(1);

  console.log(`\nDone in ${elapsed}s, ${totalRequests} requests (~${reqPerSec} req/s)`);
  console.log(`\nTotal keyword IDs: ${beforeTotal} → ${afterTotal} (+${afterTotal - beforeTotal})`);
  console.log(`  Phase 1 (synonyms):     +${synonymNewIds} new IDs`);
  console.log(`  Phase 2 (co-occurrence): +${coocNewIds} new IDs`);

  // Per-slug after counts.
  const afterCounts = {};
  for (const slug of Object.keys(TONES)) afterCounts[slug] = 0;
  for (const slugSet of Object.values(merged)) {
    for (const slug of slugSet) {
      if (slug in afterCounts) afterCounts[slug]++;
    }
  }

  console.log('\nPer-slug keyword counts (before → after):');
  for (const slug of Object.keys(TONES)) {
    const b = beforeCounts[slug];
    const a = afterCounts[slug];
    const diff = a - b;
    const bar = '█'.repeat(Math.min(a, 50));
    console.log(`  ${slug.padEnd(14)} ${String(b).padStart(3)} → ${String(a).padStart(3)}  (+${diff})  ${bar}`);
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
