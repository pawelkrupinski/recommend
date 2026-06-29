// A bounded async task runner: never more than `limit` keyed jobs run at once;
// the rest queue and start as slots free. Re-submitting a key that's already
// queued or running collapses (dedup), so repeated triggers don't pile up.
//
// Why: background recommendation prebuilds fan out to TMDB/Trakt/scrapers. At
// boot, warmRecommendations() wants to refresh *every* onboarded user, and
// without a cap they'd all start at once and stampede the upstreams (observed as
// cold-start "fetch failed" on the discover sources). This bounds that fan-out
// to a handful of users in flight at a time; the rest wait their turn.
// Run `fn(item, i)` over every item with at most `limit` in flight, resolving once
// all settle (results discarded — collect inside `fn` if needed). A throwing item
// is isolated so one bad job can't reject the batch. Used for the per-title tone
// resolution that fans out to scrapers during a build, kept to a small pool so it
// stays well under the upstreams' limits.
export async function mapPool(items, limit, fn) {
  const queue = [...items.entries()];
  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      try { await fn(next[1], next[0]); } catch { /* isolate: one failure never stalls the pool */ }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
}

export function boundedRunner(limit, run) {
  const active = new Set(); // keys currently running
  const queue = [];         // keys waiting for a slot (FIFO)

  function pump() {
    while (active.size < limit && queue.length) {
      const key = queue.shift();
      active.add(key);
      // Isolate each job: a throw never rejects the pump or stalls the queue;
      // the slot is always freed and the next job started.
      Promise.resolve()
        .then(() => run(key))
        .catch(() => {})
        .finally(() => { active.delete(key); pump(); });
    }
  }

  return {
    // Queue a job for `key`. No-op (returns false) if it's already running or
    // queued — that dedup is what makes a burst of triggers collapse to one run.
    submit(key) {
      if (active.has(key) || queue.includes(key)) return false;
      queue.push(key);
      pump();
      return true;
    },
    // Is this key running or waiting?
    has(key) { return active.has(key) || queue.includes(key); },
    // Is this key currently running (vs merely queued)?
    isActive(key) { return active.has(key); },
    get activeCount() { return active.size; },
    get queuedCount() { return queue.length; },
  };
}
