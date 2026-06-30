// Watchlist filter helpers (pure). The Watchlist tab offers two client-side view
// filters over the already-loaded saved titles — a tone dropdown and a genre
// ("category") dropdown — each listing only the values actually present on saved
// titles and narrowing the cards to the chosen one. Saved cards carry `tones` as
// a list of { slug, label } and `genres` as a list of name strings (the same
// shapes a Discover pick captured at save time).

// The distinct tones present across `items`, in the canonical `order` of slugs
// (the full vocabulary from /api/tones). A tone not in `order` — e.g. one added
// after this client loaded — sinks to the end in first-seen order rather than
// vanishing. Deduped by slug; first label seen wins.
export function presentTones(items, order = []) {
  const labels = new Map();
  for (const it of items) for (const tn of it.tones || []) if (!labels.has(tn.slug)) labels.set(tn.slug, tn.label);
  const rank = new Map(order.map((slug, i) => [slug, i]));
  return [...labels]
    .map(([slug, label]) => ({ slug, label }))
    .sort((a, b) => (rank.get(a.slug) ?? Infinity) - (rank.get(b.slug) ?? Infinity));
}

// The saved titles carrying tone `slug`; the whole list unchanged when no tone
// is selected ('' / falsy).
export function filterByTone(items, slug) {
  if (!slug) return items;
  return items.filter((it) => (it.tones || []).some((tn) => tn.slug === slug));
}

// The distinct genre names present across `items`, alphabetical (locale-aware).
// Genres have no canonical vocabulary like tones — they're plain TMDB names in
// whatever language the card was saved under — so a stable A→Z order is the most
// predictable. Deduped, blanks dropped.
export function presentGenres(items) {
  const names = new Set();
  for (const it of items) for (const g of it.genres || []) if (g) names.add(g);
  return [...names].sort((a, b) => a.localeCompare(b));
}

// The saved titles tagged with genre `name`; the whole list unchanged when no
// genre is selected ('' / falsy).
export function filterByGenre(items, name) {
  if (!name) return items;
  return items.filter((it) => (it.genres || []).includes(name));
}
