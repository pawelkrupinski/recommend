#!/usr/bin/env node
/**
 * scripts/train-tone-model.js — trains src/tone-data/model.json
 *
 * Fetches film overviews from TMDB discover (using tone keyword IDs from
 * src/tone-data/map-tmdb.json), then trains a naïve-Bayes log-odds lexicon
 * that src/tone-model.js uses to classify unseen overviews.
 *
 * Run:  node --env-file=/path/to/.env.local scripts/train-tone-model.js
 * Needs: TMDB_API_KEY in environment.
 *
 * Idempotent: re-running replaces model.json with a freshly trained version.
 * The discover results include `overview` directly — no per-film detail fetch.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tokenize, classify } from '../src/tone-model.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ── Config ────────────────────────────────────────────────────────────────────
const TMDB_MAP    = JSON.parse(readFileSync(join(ROOT, 'src/tone-data/map-tmdb.json'), 'utf8'));
const API_KEY     = process.env.TMDB_API_KEY;
const MAX_FILMS   = 300;  // per tone; OR-query across all keyword IDs for the tone
const CONCURRENCY = 6;    // max simultaneous TMDB requests in flight
const ALPHA       = 1;    // Laplace smoothing factor
const TOP_TOKENS  = 40;   // discriminative tokens kept per tone

if (!API_KEY) {
  console.error('ERROR: TMDB_API_KEY not set. Run with --env-file=.env.local');
  process.exit(1);
}

// Invert keyword map: slug → [keywordId, …]
const slugToKeywords = {};
for (const [kid, slugs] of Object.entries(TMDB_MAP)) {
  for (const slug of slugs) {
    (slugToKeywords[slug] ??= []).push(kid);
  }
}
const TONES = Object.keys(slugToKeywords).sort();

// ── Concurrency pool ──────────────────────────────────────────────────────────
// Runs at most `limit` tasks concurrently; returns results in input order.
// JavaScript's single-threaded event loop makes the next++ read atomic.
async function runPool(tasks, limit) {
  const results = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

// ── TMDB discover ─────────────────────────────────────────────────────────────
async function discoverPage(keywordIds, page, retries = 3) {
  const url = `https://api.themoviedb.org/3/discover/movie?api_key=${API_KEY}` +
    `&with_keywords=${keywordIds.join('|')}&sort_by=popularity.desc&vote_count.gte=50&page=${page}`;
  const res = await fetch(url);
  if (res.status === 429 && retries > 0) {
    const wait = Math.max(parseInt(res.headers.get('retry-after') || '5', 10), 2) * 1000;
    await new Promise(r => setTimeout(r, wait));
    return discoverPage(keywordIds, page, retries - 1);
  }
  if (!res.ok) throw new Error(`TMDB ${res.status} (page ${page})`);
  return res.json();
}

async function collectTone(slug) {
  const kwIds = slugToKeywords[slug];
  const maxPages = Math.ceil(MAX_FILMS / 20);

  const first = await discoverPage(kwIds, 1);
  const totalPages = Math.min(first.total_pages ?? 1, maxPages);

  const films = new Map(); // filmId → overview
  for (const f of first.results ?? []) {
    if (f.overview) films.set(f.id, f.overview);
  }

  if (totalPages > 1) {
    const pages = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);
    const responses = await runPool(pages.map(p => () => discoverPage(kwIds, p)), CONCURRENCY);
    for (const data of responses) {
      for (const f of data.results ?? []) {
        if (f.overview && !films.has(f.id) && films.size < MAX_FILMS) {
          films.set(f.id, f.overview);
        }
      }
    }
  }

  return films;
}

// ── Collect ───────────────────────────────────────────────────────────────────
console.log('Collecting films from TMDB discover...\n');
const filmTones    = new Map(); // filmId → Set<slug>
const filmOverviews = new Map(); // filmId → overview string

for (const slug of TONES) {
  process.stdout.write(`  ${slug.padEnd(15)}`);
  const films = await collectTone(slug);
  for (const [id, ov] of films) {
    if (!filmTones.has(id)) filmTones.set(id, new Set());
    filmTones.get(id).add(slug);
    filmOverviews.set(id, ov);
  }
  console.log(`${films.size} films  (${slugToKeywords[slug].length} keywords)`);
}
console.log(`\nTotal unique films: ${filmOverviews.size}`);

// ── Tokenize (once, shared with inference) ────────────────────────────────────
const filmTokens = new Map();
for (const [id, ov] of filmOverviews) {
  filmTokens.set(id, new Set(tokenize(ov)));
}

// ── Train ─────────────────────────────────────────────────────────────────────
console.log('\nTraining naïve-Bayes log-odds model...\n');
const allIds = [...filmOverviews.keys()];
const bias    = {};
const weights = {};

for (const slug of TONES) {
  const posIds = allIds.filter(id => filmTones.get(id).has(slug));
  const negIds = allIds.filter(id => !filmTones.get(id).has(slug));
  const N_pos  = posIds.length;
  const N_neg  = negIds.length;

  if (N_pos < 5) {
    console.log(`  SKIP ${slug}: only ${N_pos} positives`);
    continue;
  }

  // Document-frequency counts — O(N × avg_tokens) rather than O(vocab × N)
  const posDF = {};
  for (const id of posIds) for (const tok of filmTokens.get(id)) posDF[tok] = (posDF[tok] ?? 0) + 1;
  const negDF = {};
  for (const id of negIds) for (const tok of filmTokens.get(id)) negDF[tok] = (negDF[tok] ?? 0) + 1;

  // Log-odds weight per token with Laplace smoothing
  const vocab = new Set([...Object.keys(posDF), ...Object.keys(negDF)]);
  const scored = [];
  for (const tok of vocab) {
    const w = Math.log(((posDF[tok] ?? 0) + ALPHA) / (N_pos + 2 * ALPHA))
            - Math.log(((negDF[tok] ?? 0) + ALPHA) / (N_neg + 2 * ALPHA));
    scored.push([tok, w]);
  }

  // Keep the top-K most positively discriminative tokens, subject to two
  // frequency guards designed to eliminate franchise-specific proper nouns
  // (e.g. character names from a single popular series):
  //
  //   1. minPosDF: token must appear in ≥3% of positives (min 3 films).
  //
  //   2. minNegDF: token must appear in ≥2 negative films. Franchise proper
  //      nouns (detective character names, place-specific terms) appear in
  //      0-1 negative films; genuine mood vocabulary appears in at least a
  //      handful. This single guard eliminates most franchise contamination.
  const minPosDF = Math.max(3, Math.ceil(N_pos * 0.03));
  const minNegDF = 2;
  const candidates = scored.filter(([tok, w]) =>
    w > 0 &&
    (posDF[tok] ?? 0) >= minPosDF &&
    (negDF[tok] ?? 0) >= minNegDF,
  );
  candidates.sort((a, b) => b[1] - a[1]);
  const topTokens = candidates.slice(0, TOP_TOKENS);
  const tokWeights = Object.fromEntries(topTokens);

  // Bias calibration: negate the 75th-percentile raw score of neg films so
  // 75% of negative films score ≤ 0 after the bias is applied.
  // Floor at -0.8: even when p75_neg=0, a film needs a raw token sum ≥ 0.8
  // before the tone fires, preventing any single weak-weight token from
  // triggering a tone on unrelated overviews.
  const negRaw = negIds
    .map(id => [...filmTokens.get(id)].reduce((s, tok) => s + (tokWeights[tok] ?? 0), 0))
    .sort((a, b) => a - b);
  const p75 = negRaw[Math.floor(negRaw.length * 0.75)] ?? 0;
  bias[slug]    = -Math.max(p75, 0.8);
  weights[slug] = tokWeights;

  // Training recall (informational)
  const recall = posIds.filter(id => {
    const s = bias[slug] + [...filmTokens.get(id)].reduce((ss, t) => ss + (tokWeights[t] ?? 0), 0);
    return s > 0;
  }).length / N_pos;

  const top5 = topTokens.slice(0, 5).map(([t, w]) => `${t}:${w.toFixed(2)}`).join(' ');
  console.log(
    `  ${slug.padEnd(15)}` +
    ` pos=${String(N_pos).padStart(3)} neg=${String(N_neg).padStart(4)}` +
    ` tokens=${String(topTokens.length).padStart(2)}` +
    ` bias=${bias[slug].toFixed(2).padStart(6)}` +
    ` recall=${(recall * 100).toFixed(0).padStart(3)}%` +
    `  [${top5}]`
  );
}

// ── Write model.json ──────────────────────────────────────────────────────────
const model = { version: 1, bias, weights };
const modelPath = join(ROOT, 'src/tone-data/model.json');
writeFileSync(modelPath, JSON.stringify(model, null, 2));

const toneCount  = Object.keys(weights).length;
const tokenCount = Object.values(weights).reduce((s, w) => s + Object.keys(w).length, 0);
const vocabSize  = new Set(Object.values(weights).flatMap(Object.keys)).size;
console.log(`\nWrote model.json: ${toneCount} tones, ${tokenCount} weight entries, ${vocabSize} unique tokens`);

// ── Sanity checks ─────────────────────────────────────────────────────────────
// Overviews written in TMDB style (explicit plot language) to match vocabulary
// the model learned from TMDB discover results. These verified texts each
// fire the correct primary tone (≥1 points above threshold before secondary
// tones bleed through).
const SAMPLES = [
  { desc: 'romantic',    text: 'After a chance meeting, two people fall in love and their relationship blossoms into marriage, but both must decide if love is worth fighting for.' },
  { desc: 'suspenseful', text: 'A detective joins a team working a brutal case involving supernatural disappearances in a remote village, where children keep vanishing without trace.' },
  { desc: 'gritty',      text: 'An assassin seeks revenge for the death of his partner, hunting remote criminal cells across a deadly underworld that spans three continents.' },
  { desc: 'dark',        text: 'A small-time crook gets pulled deeper into a deadly game of money and lies, slowly unravelling the reality that the hit he carried out was only the beginning.' },
  { desc: 'melancholic', text: 'A late-stage father faces the prospect of leaving his son and children without a guide, confronting memories of a life shaped by absence and grief.' },
  { desc: 'cozy',        text: 'Two strangers form an unlikely friendship over shared dreams and a bond built on trust, proving that even small moments can change everything.' },
  { desc: 'campy',       text: 'The girls at a remote summer camp are picked off one by one in increasingly outrageous kills, in a schlocky series of over-the-top black comedy horror.' },
];

console.log('\nSanity checks:');
for (const { desc, text } of SAMPLES) {
  const tones = classify(text, { model, max: 3 });
  console.log(`  [${desc.padEnd(18)}] → [${tones.join(', ')}]`);
}
