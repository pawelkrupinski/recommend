// Tone tags — the mood/feel vocabulary ("heartfelt", "deadpan", …) layered on
// top of TMDB's structured genres. A title's tones are *derived*, not stored:
//   1. from its TMDB keywords (already on the /movie detail we fetch) via a
//      keyword-id → tone map harvested from TMDB (scripts/harvest-tmdb-tones.js),
//   2. from Netflix microgenre membership via a tmdb-id → tone map scraped from
//      Netflix (scripts/harvest-netflix-tones.js).
// Both maps are committed JSON under src/data so derivation needs no extra
// network call and no DB table — it rides on the TMDB detail computePool already
// has. The harvesters only *expand* the seed maps; the seeds keep the feature
// (and its tests) working before/independently of a harvest run.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Committed under src/tone-data (NOT src/data — .gitignore excludes any data/
// dir, which would strand these maps out of the deploy and silently disable tones).
const dataDir = join(dirname(fileURLToPath(import.meta.url)), 'tone-data');
function loadMap(name) {
  try { return JSON.parse(readFileSync(join(dataDir, name), 'utf8')); }
  catch { return {}; } // a missing/empty harvest file just means "no tones from this source"
}

// The canonical vocabulary. `slug` is the URL/feature token (?tag=, tone:<slug>);
// `label` is what the filter and the popup chips show. Order here is the order
// chips render in. Extend by adding a row + harvesting ids/membership for it.
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
const KEYWORD_TONES = loadMap('tone-keywords.json'); // { "<tmdbKeywordId>": ["slug", …] }
const NETFLIX_TONES = loadMap('tone-netflix.json');   // { "<tmdbId>": ["slug", …] }

// A known tone slug? Guards the ?tag= filter so an unknown value is ignored
// (no pool built for it) rather than silently returning an empty grid.
export const isTone = (slug) => LABELS.has(slug);
// The vocabulary for the client (filter datalist) — slug + display label.
export const toneList = () => TONES.map(({ slug, label }) => ({ slug, label }));

// Every tone slug a movie carries: the union of keyword-derived and Netflix
// membership tones, deduped. `full` is a TMDB /movie detail (id + appended
// keywords). The maps are injectable so unit tests don't depend on the harvest.
export function toneSlugs(full, { keywordMap = KEYWORD_TONES, netflixMap = NETFLIX_TONES } = {}) {
  const slugs = new Set();
  for (const k of full?.keywords?.keywords || []) {
    for (const s of keywordMap[k.id] || []) if (LABELS.has(s)) slugs.add(s);
  }
  for (const s of netflixMap[full?.id] || []) if (LABELS.has(s)) slugs.add(s);
  return [...slugs];
}

// The movie's tones as { slug, label } in canonical TONES order — what the
// Discover/Watchlist card carries so the popup can render chips.
export function tonesForMovie(full, opts) {
  const have = new Set(toneSlugs(full, opts));
  return TONES.filter((t) => have.has(t.slug)).map(({ slug, label }) => ({ slug, label }));
}
