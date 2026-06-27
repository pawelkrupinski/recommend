// Parse ratings exports (Letterboxd / IMDb / Criticker) and match titles to TMDB.
import { search, findByImdb } from './tmdb.js';
import { upsertRating } from './db.js';

// Minimal RFC-4180-ish CSV parser (handles quoted fields, commas, newlines).
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c === '\r') { /* skip */ }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const header = rows.shift().map((h) => h.trim());
  return rows
    .filter((r) => r.length > 1)
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

// Detect the export format and yield { name, year, imdbId, rating } (rating normalized 0..10).
function normalizeRows(records) {
  if (!records.length) return [];
  const cols = Object.keys(records[0]);
  // Letterboxd ratings.csv: Name, Year, Rating (0.5–5.0)
  if (cols.includes('Name') && cols.includes('Rating')) {
    return records
      .filter((r) => r.Rating)
      .map((r) => ({
        name: r.Name, year: Number(r.Year) || undefined,
        rating: Math.round(parseFloat(r.Rating) * 2 * 10) / 10, // 5★ -> 10
      }));
  }
  // IMDb ratings.csv: Const (tt…), Your Rating (1–10), Title, Year
  if (cols.includes('Your Rating')) {
    return records
      .filter((r) => r['Your Rating'])
      .map((r) => ({
        name: r.Title, year: Number(r.Year) || undefined,
        imdbId: r.Const, rating: parseFloat(r['Your Rating']),
      }));
  }
  // Criticker ratings export: Rating (0–100), Film Name, Year, IMDB ID
  if (cols.includes('Film Name')) {
    return records
      .filter((r) => r.Rating)
      .map((r) => {
        const imdb = (r['IMDB ID'] || '').trim();
        return {
          name: r['Film Name'], year: Number(r.Year) || undefined,
          // Season rows carry ids like tt9253284_s1, which aren't valid IMDb ids.
          imdbId: /^tt\d+$/.test(imdb) ? imdb : undefined,
          rating: parseFloat(r.Rating) / 10, // 100 -> 10
        };
      });
  }
  // Older Criticker export: Title, Year, Score (0–100)
  if (cols.includes('Score') || cols.includes('Tier')) {
    return records
      .filter((r) => r.Score || r.Tier)
      .map((r) => ({
        name: r.Title || r.FilmName, year: Number(r.Year) || undefined,
        rating: (parseFloat(r.Score) || parseFloat(r.Tier) * 10) / 10, // 100 -> 10
      }));
  }
  return [];
}

// Import a CSV string. Matches each row to TMDB and stores the rating.
// Returns { imported, skipped, total } and per-row results.
export async function importCsv(text, userId, { onProgress } = {}) {
  const records = parseCsv(text);
  const rows = normalizeRows(records);
  const results = [];
  let imported = 0, skipped = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      let movie;
      if (row.imdbId) {
        const found = await findByImdb(row.imdbId);
        movie = found.movie_results?.[0];
      }
      if (!movie) {
        const res = await search(row.name, row.year);
        movie = res.results?.[0];
      }
      if (movie) {
        upsertRating({
          user_id: userId,
          tmdb_id: movie.id, media_type: 'movie', rating: row.rating,
          title: movie.title, year: Number((movie.release_date || '').slice(0, 4)) || row.year,
          source: row.imdbId ? 'imdb' : 'import',
        });
        imported++;
        results.push({ name: row.name, matched: movie.title, rating: row.rating, ok: true });
      } else {
        skipped++;
        results.push({ name: row.name, ok: false });
      }
    } catch (e) {
      skipped++;
      results.push({ name: row.name, ok: false, error: e.message });
    }
    onProgress?.(i + 1, rows.length);
  }
  return { imported, skipped, total: rows.length, results };
}
