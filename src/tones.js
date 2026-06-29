// Tone vocabulary + the cross-service crosswalk (pure; no DB, no network — so it
// unit-tests without a database).
//
// One canonical vocabulary (TONES) sits above every source. Each source speaks
// its own dialect — TMDB keyword ids, IMDb keyword strings, Letterboxd nanogenre
// names, Netflix microgenre membership — and a per-source *crosswalk* maps those
// raw tags onto canonical slugs. So TMDB keyword 212569, IMDb "deadpan-humor",
// Letterboxd "Deadpan, Dry, Sardonic" and the local model all collapse to `deadpan`.
//
// Crosswalk files live under src/tone-data as map-<service>.json. Two shapes:
//   - vocabulary maps (raw tag → [slug]): map-tmdb (keyword id), map-imdb
//     (keyword string), map-letterboxd (nanogenre name);
//   - membership maps (tmdb id → [slug]): map-netflix.
// The harvest scripts only *expand* these; the committed seeds keep tones working
// before/independently of a harvest, and the loaders degrade to {} when a file is
// absent. The DB-backed aggregation (live ∪ stored per-title sources) is in
// tone-store.js; the feeders that fill the store are in tone-sources.js.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Committed under src/tone-data (NOT src/data — .gitignore excludes any data/
// dir, which would strand these maps out of the deploy and silently disable tones).
const dataDir = join(dirname(fileURLToPath(import.meta.url)), 'tone-data');
function loadMap(name) {
  try { return JSON.parse(readFileSync(join(dataDir, name), 'utf8')); }
  catch { return {}; } // a missing/empty map just means "no tones from this source"
}

// The canonical vocabulary. `slug` is the URL/feature token (?tag=, tone:<slug>);
// `label` is what the filter and the popup chips show. Order here is the order
// chips render in. Extend by adding a row + a crosswalk entry across the sources.
export const TONES = [
  { slug: 'heartfelt', label: 'Heartfelt' },
  { slug: 'feel-good', label: 'Feel-good' },
  { slug: 'deadpan', label: 'Deadpan' },
  { slug: 'quirky', label: 'Quirky' },
  { slug: 'dark', label: 'Dark' },
  { slug: 'gritty', label: 'Gritty' },
  { slug: 'suspenseful', label: 'Suspenseful' },
  { slug: 'mind-bending', label: 'Mind-bending' },
  { slug: 'wholesome', label: 'Wholesome' },
  { slug: 'campy', label: 'Campy' },
  { slug: 'melancholic', label: 'Melancholic' },
  { slug: 'satirical', label: 'Satirical' },
  { slug: 'irreverent', label: 'Irreverent' },
  { slug: 'cerebral', label: 'Cerebral' },
  { slug: 'cozy', label: 'Cozy' },
  { slug: 'romantic', label: 'Romantic' },
];

const LABELS = new Map(TONES.map((t) => [t.slug, t.label]));
const TMDB_KEYWORD_MAP = loadMap('map-tmdb.json');   // { "<tmdbKeywordId>": ["slug", …] }
const NETFLIX_MEMBERSHIP = loadMap('map-netflix.json'); // { "<tmdbId>": ["slug", …] }

// Per-source crosswalks the scraper/model feeders use to generalise their raw
// tags into canonical slugs (see tone-sources.js). Exposed as data so a feeder
// stays a thin scrape + one mapRawTags() call.
export const crosswalks = {
  tmdb: TMDB_KEYWORD_MAP,
  imdb: loadMap('map-imdb.json'),             // { "<imdb keyword>": ["slug", …] }
  letterboxd: loadMap('map-letterboxd.json'), // { "<nanogenre name>": ["slug", …] }
};

// A known tone slug? Guards the ?tag= filter so an unknown value is ignored
// (no pool built for it) rather than silently returning an empty grid.
export const isTone = (slug) => LABELS.has(slug);
// The vocabulary for the client (filter datalist) — slug + display label.
export const toneList = () => TONES.map(({ slug, label }) => ({ slug, label }));
// Human display label for a tone slug (the insights page labels learned tones);
// falls back to the slug for anything outside the vocabulary.
export const toneLabel = (slug) => LABELS.get(slug) || slug;

// Generalise raw tags into canonical slugs via a crosswalk: look each raw key up,
// keep only slugs that are in the vocabulary, dedupe. The shared primitive every
// feeder uses. `rawKeys` are whatever the source speaks (keyword ids, normalised
// keyword strings, nanogenre names); the source normalises before calling.
export function mapRawTags(crosswalk, rawKeys) {
  const slugs = new Set();
  for (const key of rawKeys || []) for (const s of (crosswalk || {})[key] || []) if (LABELS.has(s)) slugs.add(s);
  return [...slugs];
}

// Tones derivable with zero I/O from a TMDB /movie detail we already hold: its
// keywords (via the TMDB crosswalk) plus Netflix membership (by tmdb id). The
// always-available layer the stored per-title sources add to.
export function liveToneSlugs(full) {
  const slugs = new Set(mapRawTags(TMDB_KEYWORD_MAP, (full?.keywords?.keywords || []).map((k) => k.id)));
  for (const s of NETFLIX_MEMBERSHIP[full?.id] || []) if (LABELS.has(s)) slugs.add(s);
  return [...slugs];
}

// Order a bag of slugs into the canonical [{slug,label}] the card/popup render.
export function orderTones(slugs) {
  const have = new Set(slugs);
  return TONES.filter((t) => have.has(t.slug)).map(({ slug, label }) => ({ slug, label }));
}
