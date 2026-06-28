// Watchlist ordering. The list arrives from the server newest-first (added_at
// DESC); the only alternative offered is "Top rated", which reorders by a
// title's average critic rating.

// Average of a title's external ratings, normalised to a 0–10 scale. IMDb is
// already 0–10; Metacritic is 0–100, so it's rescaled by /10. Averages whichever
// are present and returns null when neither is — those titles have no rating to
// sort on and sink to the bottom (see sortWatchlist).
export function averageRating(m) {
  const scores = [];
  if (m.imdbRating != null) scores.push(m.imdbRating);
  if (m.metascore != null) scores.push(m.metascore / 10);
  if (!scores.length) return null;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

// A sorted copy of the watchlist for the given sort key. 'rating' orders by
// averageRating descending with unrated titles last; any other key (incl.
// 'added') leaves the server's added_at-DESC order untouched.
export function sortWatchlist(list, sort) {
  if (sort !== 'rating') return list;
  return [...list].sort((a, b) => {
    const ra = averageRating(a);
    const rb = averageRating(b);
    if (ra == null && rb == null) return 0;
    if (ra == null) return 1;
    if (rb == null) return -1;
    return rb - ra;
  });
}
