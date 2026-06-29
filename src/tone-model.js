// The local tone model (#1) — a dependency-free, key-free text classifier that
// resolves a title's moods from its synopsis. It learns word→tone weights from the
// films the *explicit* sources (TMDB/IMDb/Letterboxd crosswalks) already tag, then
// generalises to films those sources miss. No external API, no quota: a committed
// model file (src/tone-data/model.json) holds per-tone token weights; this module
// only scores text against them. Retraining (scripts/train-tone-model.js) widens
// coverage as the explicit sources tag more films — that's the sustainability loop.
//
// Model: presence-based log-odds (a naïve-Bayes lexicon). For each tone we keep a
// bias plus the most discriminative tokens; a title scores per tone = bias + Σ
// weights of the tokens it contains, and we assign the top few tones that clear 0.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { isTone } from './tones.js';

const modelPath = join(dirname(fileURLToPath(import.meta.url)), 'tone-data', 'model.json');
function loadModel() {
  try { return JSON.parse(readFileSync(modelPath, 'utf8')); }
  catch { return { version: 0, bias: {}, weights: {} }; } // untrained → classify() yields []
}
const MODEL = loadModel();

// Common words that carry no tone signal — dropped before scoring so the model
// keys on mood-bearing vocabulary. Kept deliberately small; the training step's
// rarity weighting handles the long tail.
const STOP = new Set(('the a an and or but of to in into on at by for with from as is are was were be been '
  + 'his her their its he she they them his hers him who whom that this these those it itself one two '
  + 'when while after before during over under out up down off about against between through story film '
  + 'movie life man woman men women boy girl new york world city town must find finds tries help help '
  + 'young old back home time year years day days way get gets take takes make makes go goes come comes '
  + 'set based true').split(/\s+/));

// Text → the set of distinct mood-candidate tokens (lowercased, letters only,
// 3+ chars, de-stopworded). Shared with the trainer so training and inference
// tokenise identically — a fake that diverged here would silently break the model.
export function tokenize(text) {
  const toks = String(text || '').toLowerCase().match(/[a-z][a-z']{2,}/g) || [];
  return [...new Set(toks.filter((w) => !STOP.has(w)))];
}

// True once a model has been trained (has token weights); gates the model source
// so an untrained deploy simply contributes nothing rather than mis-tagging.
export const modelReady = () => Object.keys(MODEL.weights || {}).length > 0;

// Classify text into canonical tone slugs: per-tone score = bias + Σ token weights,
// keep tones scoring above `threshold`, return the strongest `max` (capping noise).
// `model` is injectable so tests score against a tiny fixed model, not the committed one.
export function classify(text, { model = MODEL, max = 4, threshold = 0 } = {}) {
  const weights = model?.weights || {};
  const bias = model?.bias || {};
  const tokens = tokenize(text);
  const scored = [];
  for (const slug of Object.keys(weights)) {
    if (!isTone(slug)) continue;
    let s = bias[slug] || 0;
    for (const tk of tokens) s += weights[slug][tk] || 0;
    if (s > threshold) scored.push([slug, s]);
  }
  scored.sort((a, b) => b[1] - a[1]);
  return scored.slice(0, max).map(([slug]) => slug);
}
