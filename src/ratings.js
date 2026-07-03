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
// Results are cached for a few hours (scores drift slowly but a revisit should
// pick up a newer one) and negative results are cached too, so a title without a
// match isn't re-fetched on every Discover load within the window.
//
// The scores are cached DURABLY (db.js, not the ephemeral capped store): the
// recommendation prior now reads them (see scoring.qualityPrior), and a corpus
// build bakes them onto cards from cache with no fetch (taste.buildCorpus), so
// they must survive a restart and a prefetch pass's writes must persist. The rows
// are tiny scalars ({rating,votes} or a 0–100 score), so this stays within the
// "keep the durable DB tiny" rule — the capped store remains for big TMDB blobs.
import { fetchWithTimeout, BROWSER_UA } from './fetch.js';
import { readThrough, HOUR } from './cache.js';
import { cacheGet } from './db.js';
import { resolveImdbId } from './resolve-ratings.js';

// Exported so a test can assert the cache refreshes within hours, not days.
export const RATINGS_TTL = 6 * HOUR;
// Mirror TMDB/IMDb suppression: a rating backed by <5 votes is noise.
const MIN_VOTES = 5;

// ---- IMDb -----------------------------------------------------------------
const IMDB_GRAPHQL = 'https://caching.graphql.imdb.com/';
const IMDB_QUERY = 'query Rating($id:ID!){title(id:$id){ratingsSummary{aggregateRating voteCount}}}';

const imdbRatingKey = (imdbId) => `imdb:rating:${imdbId}`;

// Live IMDb rating detail for a tt-id: `{ rating (0–10), votes }`, or null when
// unrated / too few votes / unknown. The vote count is kept (not just the rating)
// because the quality prior shrinks a thinly-voted rating toward the mean
// (scoring.bayesianQuality). Cached durably; transient faults are not cached so
// they retry later.
export async function imdbRatingDetail(imdbId) {
  if (!imdbId) return null;
  return readThrough(imdbRatingKey(imdbId), RATINGS_TTL, async () => {
    const res = await fetchWithTimeout(IMDB_GRAPHQL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': BROWSER_UA },
      body: JSON.stringify({ query: IMDB_QUERY, variables: { id: imdbId } }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const s = json?.data?.title?.ratingsSummary;
    const r = Number(s?.aggregateRating);
    const votes = Number(s?.voteCount) || 0;
    return Number.isFinite(r) && r > 0 && votes >= MIN_VOTES ? { rating: r, votes } : null;
  });
}

// The IMDb rating alone (0–10), for the badge callers that don't need the vote
// count. Shares the same cached lookup as imdbRatingDetail.
export async function imdbRating(imdbId) {
  return (await imdbRatingDetail(imdbId))?.rating ?? null;
}

// Cache-only reads (no fetch) for the corpus build's rating bake: return whatever
// the durable cache already holds — `{rating,votes}` / a 0–100 score, or null when
// we hold nothing fresh (a miss and a cached negative both mean "no rating", the
// signal for scoring to skip the quality prior). Synchronous (SQLite), so the
// build loop can call them per card without awaiting the network.
export function cachedImdbDetail(imdbId) {
  if (!imdbId) return null;
  return cacheGet(imdbRatingKey(imdbId), RATINGS_TTL) ?? null;
}
export function cachedMetascore(title, year = null) {
  if (!title?.trim()) return null;
  return cacheGet(mcScoreKey(title, year), RATINGS_TTL) ?? null;
}

// ---- Metacritic -----------------------------------------------------------
const MC_SITE = 'https://www.metacritic.com';

// Accent-folded, lowercased, apostrophe-stripped title with every other run of
// non-alphanumerics collapsed to a single space — the canonical form for
// comparing two titles ("Amélie" === "amelie"). Shared by slugify and the IMDb-id
// resolver (resolve-ratings.js) so a title can't normalise two different ways.
export function foldTitle(title) {
  return String(title)
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip diacritics
    .replace(/ł/gi, 'l') // NFD misses the Polish ł
    .toLowerCase()
    .replace(/['’‘]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Metacritic-style slug: the folded title with spaces hyphenated
// ("Schindler's List" -> "schindlers-list").
export function slugify(title) {
  return foldTitle(title).replace(/ +/g, '-');
}

// Slugs to probe, most-specific first: the canonical slug, its de-articled form
// (some titles index without a leading article), and — for "Title: Subtitle" or
// "Title - Subtitle" — the main-title-only form. Each probed page is verified
// against the film's name+year before its score is trusted (metacriticMatches),
// so widening the probe can recover a near-miss slug without risking a wrong hit.
function candidateSlugs(title) {
  const slugs = new Set();
  const add = (s) => { if (s) slugs.add(s); };
  const primary = slugify(title);
  add(primary);
  const deArticled = primary.match(/^(?:the|a|an)-(.+)$/);
  if (deArticled) add(deArticled[1]);
  const main = String(title).split(/\s*[:–-]\s+/)[0];
  if (main && main !== title) add(slugify(main));
  return [...slugs];
}

// The MC movie page's JSON-LD also carries the film's name + datePublished next
// to its Metascore, so a probed page can be VERIFIED to be the right film before
// its score is trusted. Returns { score, name, year } or null when unscored.
export function parseMetacriticPage(html) {
  const score = parseMetascore(html);
  if (score == null) return null;
  let name = null, year = null;
  const blocks = html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const b of blocks) {
    let data;
    try { data = JSON.parse(b[1].trim()); } catch { continue; }
    for (const node of Array.isArray(data) ? data : [data]) {
      if (!node?.name || !/movie/i.test(String(node['@type'] || ''))) continue;
      name = node.name;
      year = Number(String(node.datePublished || '').slice(0, 4)) || null;
    }
  }
  return { score, name, year };
}

// Accept a probed MC page only when its name matches the film's title (folded)
// and, when both years are known, they're within a year — so a remake/reissue
// whose slug collides can't lend its score to the wrong film.
export function metacriticMatches(page, title, year) {
  if (!page.name || foldTitle(page.name) !== foldTitle(title)) return false;
  return !(year && page.year) || Math.abs(page.year - year) <= 1;
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

// Metascore (0–100) for a film, or null when MC has no scored page that
// verifiably matches it. Probes each candidate slug and accepts the first whose
// page's name+year confirm it's this film (metacriticMatches) — so a colliding
// slug can't lend a wrong score. Cached (capped, regenerable), negatives included.
const mcScoreKey = (title, year) => `mc:score:${slugify(title)}:${year ?? ''}`;

export async function metacriticScore(title, year = null) {
  if (!title?.trim()) return null;
  return readThrough(mcScoreKey(title, year), RATINGS_TTL, async () => {
    for (const slug of candidateSlugs(title)) {
      const res = await fetchWithTimeout(`${MC_SITE}/movie/${slug}/`, { headers: { 'user-agent': BROWSER_UA } });
      if (!res.ok) continue;
      const page = parseMetacriticPage(await res.text());
      if (page && metacriticMatches(page, title, year)) return page.score; // verified hit
    }
    return null; // no slug verifiably matched → cache the negative
  });
}

// ---- enrichment -----------------------------------------------------------
// Attach { imdbRating, metascore } to each item, fetched concurrently but capped
// so we don't hammer either source. Mutates and returns `items`. Failures degrade
// to null — a missing rating just hides its badge.
//
// The direct lookups use what the card already has: item.imdb_id for IMDb,
// item.title (+ year) for Metacritic. When IMDb has no id to look up (TMDB never
// carried one), we RESOLVE one strictly from title·year·people (resolveImdbId,
// zero false positives) and adopt it onto the item so the badge deep-links right.
// That resolution also hands back IMDb's canonical (English) title, which we then
// re-probe Metacritic with when the card's title was localised — MC indexes by
// the English title, so "Zimna wojna" only finds its score under "Cold War".
export async function attachRatings(items, concurrency = 6) {
  // In test mode skip the live IMDb/Metacritic lookups entirely — they'd hit the
  // network and slow the suite; a missing rating just hides its badge anyway.
  if (process.env.TMDB_STUB === '1') return items;
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const it = items[next++];
      let [imdb, mc] = await Promise.all([imdbRatingDetail(it.imdb_id), metacriticScore(it.title, it.year)]);
      if (imdb == null) {
        const match = await resolveImdbId(it); // strict title·year·people match, or null
        if (match) {
          it.imdb_id = match.id;
          imdb = await imdbRatingDetail(match.id);
          // Retry MC under IMDb's canonical title when ours was localised (the
          // probe still verifies name+year, so this stays a zero-false-positive hit).
          if (mc == null && foldTitle(match.title) !== foldTitle(it.title)) {
            mc = await metacriticScore(match.title, it.year ?? match.year);
          }
        }
      }
      it.imdbRating = imdb?.rating ?? null;
      it.imdbVotes = imdb?.votes ?? null;
      it.metascore = mc;
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return items;
}
