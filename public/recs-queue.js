// The personalized-picks grid tops itself up in the background as cards leave
// (rated, dismissed or saved) so Discover never dead-ends on an empty grid — the
// same top-up the onboarding rate queue does, for picks.
//
// A pick's identity is its (media_type, tmdb id) pair — a film and a series can
// carry the same tmdb id (the two namespaces overlap), so every on-screen/saved
// check keys on the pair, never the bare id. The one place that rule lives.
export const pickKey = (m) => `${m.media_type || 'movie'}:${m.tmdb_id}`;

// newPicks() is the pure decision behind that refill: given a fresh
// /api/recommend response, the keys already on screen, and the watchlisted keys,
// it returns the titles to append — those not already shown and not saved — in
// the server's (score) order. Kept here, framework-free, so it's unit-tested
// without a DOM (see test/unit/recs-queue.test.js).
export function newPicks(results, shownKeys, watchlistKeys) {
  return (results || []).filter(
    (m) => !shownKeys.has(pickKey(m)) && !watchlistKeys.has(pickKey(m)),
  );
}
