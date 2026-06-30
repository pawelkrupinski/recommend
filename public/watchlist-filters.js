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

// The canonical genre keys for one saved item, as strings (an <option> value
// round-trips them). A card stores `genreIds` — the TMDB ids, language-independent
// — so those ARE the keys directly: no lookup, no language ambiguity. A card saved
// before genreIds were stored (until the backfill fills it) carries only localized
// `genres` names; map each through `byName` (the cross-language name→id map) to the
// same id key, or keep the raw name as a graceful bucket for a genre outside the
// loaded vocabulary. Either way 'Akcja' and 'Action' resolve to the one key '28'.
function genreKeys(item, byName) {
  if (Array.isArray(item.genreIds) && item.genreIds.length) return item.genreIds.map(String);
  return (item.genres || []).filter(Boolean).map((name) => {
    const id = byName[name.toLowerCase()];
    return id != null ? String(id) : name;
  });
}

// The genre labels to DISPLAY on a card, in the CURRENT language — what stops a
// title saved in Polish showing 'Akcja' to an English user. A backfilled card maps
// each canonical id to its current-language label; if the vocabulary isn't loaded
// yet (no label), it falls back to the stored localized name at the same position
// (genreIds and genres are built in the same order) so a bare id never shows. A
// card without genreIds maps its stored names through `byName` to the current
// label, else keeps the original name. `labelOf(key)`: current-language name for a
// canonical id key, or undefined.
export function genreLabels(item, byName = {}, labelOf = () => undefined) {
  const names = item.genres || [];
  if (Array.isArray(item.genreIds) && item.genreIds.length) {
    return item.genreIds.map((id, i) => labelOf(String(id)) || names[i] || String(id));
  }
  return names.filter(Boolean).map((name) => labelOf(String(byName[name.toLowerCase()])) || name);
}

// The distinct genres present across `items`, consolidated by canonical key and
// labelled in the current language. `byName`: cross-language name→id map (for
// not-yet-backfilled cards); `labelOf(key)`: the current-language name for a
// canonical id key, or undefined for an out-of-vocabulary bucket (where the raw
// key — the saved name — stands in). A→Z by label.
export function presentGenres(items, byName = {}, labelOf = () => undefined) {
  const seen = new Map(); // key → label (first label seen wins)
  for (const it of items) for (const key of genreKeys(it, byName)) {
    if (!seen.has(key)) seen.set(key, labelOf(key) || key);
  }
  return [...seen]
    .map(([key, label]) => ({ key, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

// The saved titles carrying the genre identified by canonical `key` (so it matches
// across languages); the whole list unchanged when no genre is selected.
export function filterByGenre(items, key, byName = {}) {
  if (!key) return items;
  return items.filter((it) => genreKeys(it, byName).includes(key));
}
