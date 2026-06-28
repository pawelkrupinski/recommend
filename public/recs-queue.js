// The personalized-picks grid tops itself up in the background as cards leave
// (rated, dismissed or saved) so Discover never dead-ends on an empty grid — the
// same top-up the onboarding rate queue does, for picks.
//
// newPicks() is the pure decision behind that refill: given a fresh
// /api/recommend response, the tmdb ids already on screen, and the watchlisted
// ids, it returns the titles to append — those not already shown and not saved —
// in the server's (score) order. Kept here, framework-free, so it's unit-tested
// without a DOM (see test/unit/recs-queue.test.js).
export function newPicks(results, shownIds, watchlistIds) {
  return (results || []).filter(
    (m) => !shownIds.has(m.tmdb_id) && !watchlistIds.has(m.tmdb_id),
  );
}
