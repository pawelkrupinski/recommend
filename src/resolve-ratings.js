// Recover an IMDb tt-id for a film that TMDB carried no external imdb_id for, so
// its IMDb badge can still resolve. Ported from ~/projects/movies' ImdbIdResolver
// but TIGHTENED for a hard zero-false-positive rule: a wrong id (a rating from a
// different film) is far worse than a missing badge, so a match is accepted only
// when strongly corroborated, else null.
//
// Source: IMDb's keyless suggestion endpoint, the same one the imdb.com search
// box calls. Each hit carries { id, l:title, y:year, rank, s:"Cast One, Cast
// Two" } — so a candidate's year AND principal cast come back inline, no second
// request needed to disambiguate.
import { fetchWithTimeout, BROWSER_UA } from './fetch.js';
import { readThroughCapped, DAY } from './cache.js';
import { foldTitle } from './ratings.js';

const SUGGEST = 'https://v3.sg.media-imdb.com/suggestion';
const TTL = 14 * DAY;
const YEAR_SLOP = 1; // release-vs-festival/region drift

// Parse the suggestion JSON into the movie candidates we'll match against:
// real titles (tt…) tagged as movies, with their year, rank and cast string.
export function parseSuggestions(body) {
  let json;
  try { json = typeof body === 'string' ? JSON.parse(body) : body; } catch { return []; }
  const entries = Array.isArray(json?.d) ? json.d : [];
  const out = [];
  for (const e of entries) {
    if (typeof e?.id !== 'string' || !e.id.startsWith('tt') || e.qid !== 'movie') continue;
    out.push({
      id: e.id,
      title: e.l || '',
      year: Number(e.y) || null,
      rank: Number(e.rank) || Infinity,
      people: e.s || '', // principal cast, comma-separated
    });
  }
  return out;
}

const yearMatches = (a, b) => a != null && b != null && Math.abs(a - b) <= YEAR_SLOP;

// Rule A — the strongest signal: a candidate whose title EXACTLY equals the
// query (folded; not a substring, so "The Ring" never matches "The Ring Two")
// and whose year is within a year. Ties break to the closest year, then rank.
export function pickByTitleYear(cands, title, year) {
  if (!year) return null; // nothing to gate an exact-title collision on
  const want = foldTitle(title);
  const hits = cands.filter((c) => foldTitle(c.title) === want && yearMatches(c.year, year));
  if (!hits.length) return null;
  hits.sort((a, b) => Math.abs(a.year - year) - Math.abs(b.year - year) || a.rank - b.rank);
  return hits[0].id;
}

// A film's known people (director(s) + top cast), folded to full names, as a set.
function peopleSet({ director, cast } = {}) {
  const names = [];
  if (director) names.push(...String(director).split(','));
  if (Array.isArray(cast)) names.push(...cast);
  return new Set(names.map((n) => foldTitle(n)).filter(Boolean));
}

// Does a suggestion's cast string name any of the film's known people?
// Full-name match (folded) so a shared first name alone never corroborates.
function sharesPerson(peopleStr, wanted) {
  return String(peopleStr).split(',').some((n) => wanted.has(foldTitle(n)));
}

// Rule B — for foreign/localised titles that differ from IMDb's: among
// candidates within a year of ours, the ONE whose cast names a person we know
// (director or cast). Exactly one qualifier accepts; two+ is ambiguous → reject.
export function pickByPeople(cands, film, year) {
  if (!year) return null;
  const wanted = peopleSet(film);
  if (!wanted.size) return null;
  const hits = cands.filter((c) => yearMatches(c.year, year) && sharesPerson(c.people, wanted));
  return hits.length === 1 ? hits[0].id : null;
}

// Resolve a film ({ title, year, director, cast }) to its matched IMDb
// candidate — { id, title, year } — or null when no candidate is corroborated
// strongly enough. Needs a year to gate on; with neither year nor a way to
// disambiguate, any match would be a guess, so we bail. The matched candidate's
// `title` is IMDb's canonical (usually English) name, which the Metacritic probe
// reuses to recover a localised-title film MC indexes under its English slug.
// Cached (capped/regenerable; negatives included). `fetcher` is injectable for tests.
export async function resolveImdbId(film = {}, { fetcher = fetchWithTimeout } = {}) {
  const { title, year } = film;
  if (!title?.trim() || !year) return null;
  const norm = foldTitle(title);
  return readThroughCapped(`imdb:resolve:${norm}:${year}`, TTL, async () => {
    const prefix = norm.match(/[a-z]/)?.[0] || 'x';
    const url = `${SUGGEST}/${prefix}/${encodeURIComponent(norm)}.json`;
    const res = await fetcher(url, { headers: { 'user-agent': BROWSER_UA } });
    if (!res.ok) return null;
    const cands = parseSuggestions(await res.text());
    const id = pickByTitleYear(cands, title, year) || pickByPeople(cands, film, year);
    const hit = id && cands.find((c) => c.id === id);
    return hit ? { id: hit.id, title: hit.title, year: hit.year } : null;
  });
}
