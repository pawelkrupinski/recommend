// External critic/audience ratings: IMDb + Metacritic.
//
// Both sources are KEY-FREE — no extra API key to configure, in keeping with
// the project's zero-setup philosophy. Ported from ~/projects/movies:
//   - IMDb:       the public GraphQL CDN that imdb.com itself renders the
//                 title page from (caching.graphql.imdb.com). Returns the same
//                 aggregate rating you see on the site (0–10).
//   - Metacritic: the Metascore (0–100 critic aggregate) published in the
//                 movie page's schema.org `<script type="application/ld+json">`
//                 block, reached by probing MC's canonical `/movie/<slug>/` URL.
//
// Results are cached hard (14 days; scores barely move) and negative results
// are cached too, so a title without a match isn't re-fetched every Discover load.
import { cacheGet, cacheSet } from './db.js';

const TTL = 14 * 24 * 60 * 60 * 1000; // 14 days
// A browser-ish UA: IMDb's CDN and Metacritic both 403 obvious bots.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
// Mirror TMDB/IMDb suppression: a rating backed by <5 votes is noise.
const MIN_VOTES = 5;

// ---- IMDb -----------------------------------------------------------------
const IMDB_GRAPHQL = 'https://caching.graphql.imdb.com/';
const IMDB_QUERY = 'query Rating($id:ID!){title(id:$id){ratingsSummary{aggregateRating voteCount}}}';

// Live IMDb rating (0–10) for a tt-id, or null when unrated / too few votes /
// unknown. Cached; transient network faults are not cached so they retry later.
export async function imdbRating(imdbId) {
  if (!imdbId) return null;
  const ck = `imdb:rating:${imdbId}`;
  const cached = cacheGet(ck, TTL);
  if (cached !== undefined) return cached;
  try {
    const res = await fetch(IMDB_GRAPHQL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': UA },
      body: JSON.stringify({ query: IMDB_QUERY, variables: { id: imdbId } }),
    });
    if (!res.ok) { cacheSet(ck, null); return null; }
    const json = await res.json();
    const s = json?.data?.title?.ratingsSummary;
    const r = Number(s?.aggregateRating);
    const votes = Number(s?.voteCount) || 0;
    const val = Number.isFinite(r) && r > 0 && votes >= MIN_VOTES ? r : null;
    cacheSet(ck, val);
    return val;
  } catch {
    return null; // network blip — leave uncached so it retries next time
  }
}

// ---- Metacritic -----------------------------------------------------------
const MC_SITE = 'https://www.metacritic.com';

// Metacritic-style slug: lowercase, accents stripped, apostrophes dropped
// ("Schindler's List" -> "schindlers-list"); all other non-alphanumerics
// collapse to a single hyphen. (MC keeps "!" in slugs but we never need it here.)
export function slugify(title) {
  return String(title)
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip diacritics
    .replace(/ł/gi, 'l') // NFD misses the Polish ł
    .toLowerCase()
    .replace(/['’‘]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Some titles index without their leading article on MC, so probe that too.
function candidateSlugs(title) {
  const primary = slugify(title);
  if (!primary) return [];
  const m = primary.match(/^(the|a|an)-(.+)$/);
  return m ? [primary, m[2]] : [primary];
}

// Pull the Metascore (0–100 critic aggregate) out of a page's JSON-LD. MC
// publishes it in an `aggregateRating` block with bestRating 100 / name
// "Metascore"; prefer that over the audience-score block (bestRating 10).
export function parseMetascore(html) {
  const blocks = html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  const found = [];
  for (const b of blocks) {
    let data;
    try { data = JSON.parse(b[1].trim()); } catch { continue; }
    for (const node of Array.isArray(data) ? data : [data]) {
      const ar = node?.aggregateRating;
      const val = Number(ar?.ratingValue);
      if (Number.isFinite(val)) found.push({ val, best: Number(ar.bestRating), name: ar.name });
    }
  }
  const pick = found.find((c) => c.best === 100 || /metascore/i.test(c.name || '')) || found[0];
  if (!pick) return null;
  const v = Math.round(pick.val);
  return v >= 0 && v <= 100 ? v : null;
}

// Metascore (0–100) for a film title, or null when MC has no scored page for
// it. Probes the canonical slug (and de-articled variant); first 200 with a
// score wins. Cached, negatives included.
export async function metacriticScore(title) {
  if (!title?.trim()) return null;
  const ck = `mc:score:${slugify(title)}`;
  const cached = cacheGet(ck, TTL);
  if (cached !== undefined) return cached;
  for (const slug of candidateSlugs(title)) {
    try {
      const res = await fetch(`${MC_SITE}/movie/${slug}/`, { headers: { 'user-agent': UA } });
      if (!res.ok) continue;
      const score = parseMetascore(await res.text());
      if (score != null) { cacheSet(ck, score); return score; }
    } catch {
      return null; // network blip — leave uncached so it retries next time
    }
  }
  cacheSet(ck, null);
  return null;
}

// ---- enrichment -----------------------------------------------------------
// Attach { imdbRating, metascore } to each item (needs item.imdb_id + .title),
// fetched concurrently but capped so we don't hammer either source. Mutates and
// returns `items`. Failures degrade to null — a missing rating just hides its badge.
export async function attachRatings(items, concurrency = 6) {
  // In test mode skip the live IMDb/Metacritic lookups entirely — they'd hit the
  // network and slow the suite; a missing rating just hides its badge anyway.
  if (process.env.TMDB_STUB === '1') return items;
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const it = items[next++];
      const [imdb, mc] = await Promise.all([imdbRating(it.imdb_id), metacriticScore(it.title)]);
      it.imdbRating = imdb;
      it.metascore = mc;
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return items;
}
