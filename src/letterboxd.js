// Letterboxd candidate feed.
//
// Letterboxd's "popular this week" / list pages sit behind a Cloudflare JS
// challenge that a residential proxy can't solve (verified: 403 "Just a moment"
// even through Decodo). But public-account *activity* RSS isn't challenged, and
// each item carries a <tmdb:movieId> — a direct TMDB id, no title resolution
// needed. So we aggregate a small set of high-activity public reviewer accounts
// as a "what cinephiles are watching right now" signal. Routed through the
// residential proxy so a datacenter IP doesn't get challenged in production.
import { proxiedText } from './fetch.js';

// Active public accounts whose feeds log film watches (each ~50 recent films
// with TMDB ids). Curated reviewers, not random users — a quality signal. Extend
// by adding usernames; a dead/empty feed just contributes nothing.
const ACCOUNTS = ['dave', 'davidehrlich', 'silentdawn', 'kurstboy', 'ghibli'];

// Parse a Letterboxd activity RSS feed into [{ id, title, year }] (TMDB id from
// <tmdb:movieId>). Items without a TMDB id (lists, non-film activity) are skipped.
export function parseLetterboxdRss(xml) {
  const out = [];
  for (const item of String(xml).split('<item>').slice(1)) {
    const id = Number(item.match(/<tmdb:movieId>(\d+)<\/tmdb:movieId>/)?.[1]);
    if (!id) continue;
    const title = item.match(/<letterboxd:filmTitle>([^<]*)<\/letterboxd:filmTitle>/)?.[1] || null;
    const year = Number(item.match(/<letterboxd:filmYear>(\d+)<\/letterboxd:filmYear>/)?.[1]) || null;
    out.push({ id, title, year });
  }
  return out;
}

async function fetchAccount(account) {
  // A single dead/blocked feed yields null → [], never sinking the source.
  const xml = await proxiedText(`https://letterboxd.com/${account}/rss/`);
  return xml ? parseLetterboxdRss(xml) : [];
}

// All accounts' recent watches, flattened. gatherCandidates de-dupes across
// accounts (and against every other source) by TMDB id.
export async function letterboxdCandidates() {
  const lists = await Promise.all(ACCOUNTS.map(fetchAccount));
  return lists.flat();
}
