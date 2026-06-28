// Filmweb candidate source — the Polish-market taste signal.
//
// Filmweb's Top-500 ranking page renders server-side (no Cloudflare challenge),
// listing films with title + release year but NO TMDB/IMDb id. We extract
// title+year and resolve each to a TMDB id via search (TMDB indexes localized
// titles, so the Polish ranking title resolves to the same film as its original).
// Routed through the residential proxy so a datacenter IP isn't blocked in prod.
import { proxiedFetch } from './fetch.js';
import { searchId } from './tmdb.js';

const RANKING_URL = 'https://www.filmweb.pl/ranking/film';
// Cap how many ranked films we resolve — each is one (cached) TMDB search, and
// the top of the ranking is the strongest signal anyway.
const MAX_FILMS = 25;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// Pull (title, year) for each ranked film from the page HTML. Each ranking row is
// `…rankingType__title">…<a href="/film/…">Title</a>…rankingType__year…content="YYYY"…`;
// the lazy gaps tie each title to its own (first-following) year.
export function parseFilmwebRanking(html) {
  const out = [];
  const re = /class="rankingType__title">.*?<a href="\/film\/[^"]+"[^>]*>([^<]+)<\/a>.*?rankingType__year"[^>]*content="(\d{4})/gs;
  let m;
  while ((m = re.exec(html)) !== null && out.length < MAX_FILMS) {
    out.push({ title: m[1].trim(), year: Number(m[2]) });
  }
  return out;
}

// Top ranked films resolved to TMDB ids: [{ id, title, year }]. Resolution
// failures (no TMDB match) are dropped; a fetch failure degrades the source to [].
export async function filmwebCandidates(language) {
  let html;
  try {
    const res = await proxiedFetch(RANKING_URL, { headers: { 'User-Agent': UA } });
    if (!res.ok) return [];
    html = await res.text();
  } catch {
    return [];
  }
  const films = parseFilmwebRanking(html);
  const resolved = await Promise.all(films.map(async (f) => {
    try {
      const id = await searchId(f.title, f.year, language);
      return id ? { id, title: f.title, year: f.year } : null;
    } catch {
      return null;
    }
  }));
  return resolved.filter(Boolean);
}
