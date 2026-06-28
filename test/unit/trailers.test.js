// Unit tests for trailer selection (pickTrailers) and the detail request's video
// parameters (src/tmdb.js). pickTrailers is pure; the request test intercepts
// global.fetch like tmdb.test.js so we assert the exact query without a network.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshDbEnv } from '../helpers/env.js';

const env = freshDbEnv();
process.env.TMDB_STUB = '0';        // exercise the real request builder, not the stub
process.env.TMDB_API_KEY = 'test-key';
const { pickTrailers, details } = await import('../../src/tmdb.js');

after(() => env.cleanup());

// A YouTube official Trailer by default; override any field per case.
const v = (o = {}) => ({ site: 'YouTube', type: 'Trailer', official: true, iso_639_1: 'en', key: 'k', name: '', ...o });
const videos = (...results) => ({ results });
const keys = (trailers) => trailers.map((t) => t.key);

test('pickTrailers prefers the requested language, returning all of its distinct trailers', () => {
  const got = pickTrailers(videos(
    v({ key: 'pl1', iso_639_1: 'pl' }),
    v({ key: 'pl2', iso_639_1: 'pl' }),
    v({ key: 'en1', iso_639_1: 'en' }),
  ), 'pl-PL');
  assert.deepEqual(keys(got), ['pl1', 'pl2'], 'both Polish trailers, English left out');
});

test('pickTrailers falls back Polish→English when no Polish trailer exists', () => {
  const got = pickTrailers(videos(
    v({ key: 'en1', iso_639_1: 'en' }),
    v({ key: 'de1', iso_639_1: 'de' }),
  ), 'pl-PL');
  assert.deepEqual(keys(got), ['en1'], 'English is the fallback; an unrelated German one is not chosen');
});

test('pickTrailers does NOT fall English→Polish: an English user keeps the English trailer', () => {
  const got = pickTrailers(videos(
    v({ key: 'pl1', iso_639_1: 'pl' }),
    v({ key: 'en1', iso_639_1: 'en' }),
  ), 'en-US');
  assert.deepEqual(keys(got), ['en1'], 'the English tier wins; the Polish one is never preferred');
});

test('pickTrailers surfaces any trailer as a last resort so every film with one shows it', () => {
  // No requested-language and no English trailer — coverage beats an empty slot.
  const got = pickTrailers(videos(v({ key: 'fr1', iso_639_1: 'fr' })), 'en-US');
  assert.deepEqual(keys(got), ['fr1']);
});

test('pickTrailers keeps only YouTube Trailers/Teasers and dedupes by key', () => {
  const got = pickTrailers(videos(
    v({ key: 'yt', type: 'Trailer' }),
    v({ key: 'yt', type: 'Trailer' }),       // duplicate key → collapsed
    v({ key: 'teaser', type: 'Teaser' }),
    v({ key: 'feat', type: 'Featurette' }),  // not a trailer → dropped
    v({ key: 'vimeo', site: 'Vimeo' }),      // not YouTube → dropped
    { type: 'Trailer', site: 'YouTube' },    // no key → dropped
  ), 'en-US');
  assert.deepEqual(keys(got).sort(), ['teaser', 'yt'], 'only the two distinct YouTube trailers/teasers survive');
});

test('pickTrailers orders Trailers before Teasers and official before fan uploads', () => {
  const got = pickTrailers(videos(
    v({ key: 'fan', type: 'Trailer', official: false }),
    v({ key: 'teaser', type: 'Teaser', official: true }),
    v({ key: 'official', type: 'Trailer', official: true }),
  ), 'en-US');
  assert.deepEqual(keys(got), ['official', 'fan', 'teaser'],
    'official Trailer, then the fan Trailer, then the Teaser');
});

test('pickTrailers returns empty when there is no usable trailer', () => {
  assert.deepEqual(pickTrailers(videos(v({ site: 'Vimeo' })), 'en-US'), []);
  assert.deepEqual(pickTrailers({ results: [] }, 'en-US'), []);
  assert.deepEqual(pickTrailers(undefined, 'en-US'), []);
});

// --- the detail request asks TMDB for the videos block in the right languages ---

async function detailRequestUrl(language) {
  const realFetch = global.fetch;
  let captured;
  global.fetch = async (url) => {
    captured = url;
    return { ok: true, status: 200, json: async () => ({ id: 1, videos: { results: [] } }) };
  };
  // Distinct id per call so the per-URL cache never serves a prior capture.
  try { await details(detailRequestUrl.id = (detailRequestUrl.id || 0) + 1, 'movie', language); }
  finally { global.fetch = realFetch; }
  return new URL(captured);
}

test('details() appends the videos block', async () => {
  const url = await detailRequestUrl('en-US');
  assert.match(url.searchParams.get('append_to_response'), /(^|,)videos(,|$)/,
    'videos is appended so the trailer comes back in the same call');
});

test('details() widens include_video_language to the user language, English, and language-neutral', async () => {
  const pl = await detailRequestUrl('pl-PL');
  assert.equal(pl.searchParams.get('include_video_language'), 'pl,en,null',
    'a Polish user still gets the English fallback trailer');
  const en = await detailRequestUrl('en-US');
  assert.equal(en.searchParams.get('include_video_language'), 'en,null',
    'an English user sends en once (deduped), plus language-neutral');
});
