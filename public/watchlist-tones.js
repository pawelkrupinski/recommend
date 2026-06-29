// Watchlist tone-filter helpers (pure). The Watchlist tab offers a tone dropdown
// listing only the tones actually present on saved titles, and filtering keeps
// the titles carrying the chosen tone. Saved cards carry `tones` as a list of
// { slug, label } (the same shape a Discover pick captured at save time).

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
