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

// Saved cards keep only genre NAMES, localized to whatever language they were
// saved under, so a title saved in Polish carries 'Akcja' where an English one
// carries 'Action'. To stop one genre splitting into two across a locale switch,
// collapse each name to a canonical key: its TMDB id (as a string) when the name
// is known in ANY interface language — via `byName`, the cross-language
// name→id map from /api/genres — else the lowercased name itself, a graceful
// bucket for a genre outside the loaded vocabulary.
function genreKey(name, byName) {
  const id = byName[name.toLowerCase()];
  return id != null ? String(id) : name.toLowerCase();
}

// The distinct genres present across `items`, consolidated by canonical key and
// labelled in the current language. `byName`: cross-language name→id map;
// `labelOf(key)`: the current-language name for a canonical key, or undefined for
// an out-of-vocabulary bucket (where the raw saved name stands in). A→Z by label.
export function presentGenres(items, byName = {}, labelOf = () => undefined) {
  const seen = new Map(); // key → label (first label seen wins)
  for (const it of items) for (const g of it.genres || []) {
    if (!g) continue;
    const key = genreKey(g, byName);
    if (!seen.has(key)) seen.set(key, labelOf(key) || g);
  }
  return [...seen]
    .map(([key, label]) => ({ key, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

// The saved titles whose genre resolves to canonical `key` (so it matches across
// languages); the whole list unchanged when no genre is selected ('' / falsy).
export function filterByGenre(items, key, byName = {}) {
  if (!key) return items;
  return items.filter((it) => (it.genres || []).some((g) => g && genreKey(g, byName) === key));
}
