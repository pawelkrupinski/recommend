// The client message catalog: parity across languages, interpolation + fallback,
// and that its language list stays in sync with the server's. Imports the browser
// module directly — it touches no DOM at module load, so node can load it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MESSAGES, LANGUAGES, t, setLanguage, getLanguage, COUNTRY_TO_LANGUAGE as CLIENT_COUNTRY_LANG } from '../../public/i18n.js';
import { SUPPORTED_LANGUAGES, COUNTRY_TO_LANGUAGE as SERVER_COUNTRY_LANG } from '../../src/locale.js';

test('every language defines exactly the same set of keys', () => {
  const en = Object.keys(MESSAGES.en).sort();
  for (const code of Object.keys(MESSAGES)) {
    if (code === 'en') continue;
    assert.deepEqual(Object.keys(MESSAGES[code]).sort(), en,
      `language "${code}" must define the same keys as English`);
  }
});

test('client COUNTRY_TO_LANGUAGE matches the server map (no drift)', () => {
  // Onboarding defaults the UI language from the resolved country using the client
  // copy; it must stay identical to the server's so both agree Poland → Polish.
  assert.deepEqual(CLIENT_COUNTRY_LANG, SERVER_COUNTRY_LANG);
});

test('client LANGUAGES match the server SUPPORTED_LANGUAGES (no drift)', () => {
  const client = LANGUAGES.map((l) => l.code).sort();
  const server = SUPPORTED_LANGUAGES.map((l) => l.code).sort();
  assert.deepEqual(client, server);
  // Every shipped language must actually have a catalog.
  for (const { code } of LANGUAGES) assert.ok(MESSAGES[code], `catalog missing for "${code}"`);
});

test('t() interpolates {placeholders}', () => {
  setLanguage('en');
  assert.equal(t('watchlist.count', { n: 3 }), '3 saved titles');
  assert.equal(t('discover.onboardCountdown', { left: 2 }),
    "Rate films you've seen so we can learn your taste — 2 more to go.");
  assert.equal(t('discover.picksSummaryGenre', { count: 5, genre: 'Action', profile: 12 }),
    '5 picks in Action from a taste profile of 12 rated films.');
});

test('t() resolves in the active language and falls back to English then the key', () => {
  setLanguage('pl');
  assert.equal(getLanguage(), 'pl');
  assert.equal(t('tab.discover'), 'Odkrywaj', 'returns the Polish string');
  assert.equal(t('totally.unknown.key'), 'totally.unknown.key', 'unknown key surfaces itself');
  setLanguage('en');
});
