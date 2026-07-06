// Country/language detection + mapping. Pure logic over request-shaped objects.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE, COUNTRY_TO_LANGUAGE,
  isSupportedLanguage, tmdbLang, detectCountry, detectLanguage,
} from '../../src/locale.js';

// A request is just { headers } as far as detection cares.
const req = (headers = {}) => ({ headers });

test('detectCountry reads and normalises the Cloudflare CF-IPCountry header', () => {
  assert.equal(detectCountry(req({ 'cf-ipcountry': 'PL' })), 'PL');
  assert.equal(detectCountry(req({ 'cf-ipcountry': 'pl' })), 'PL', 'lowercased codes are accepted');
  assert.equal(detectCountry(req({ 'cf-ipcountry': 'US' })), 'US');
});

test('detectCountry rejects non-geographic placeholders and missing headers', () => {
  assert.equal(detectCountry(req({ 'cf-ipcountry': 'XX' })), null, 'XX = unknown');
  assert.equal(detectCountry(req({ 'cf-ipcountry': 'T1' })), null, 'T1 = Tor');
  assert.equal(detectCountry(req({ 'cf-ipcountry': 'EUROPE' })), null, 'not a 2-letter code');
  assert.equal(detectCountry(req()), null, 'no header → no signal');
});

test('detectCountry falls back to the native app X-Device-Country hint', () => {
  // The app hits the origin directly (no Cloudflare edge), so it sends its
  // device-locale country instead.
  assert.equal(detectCountry(req({ 'x-device-country': 'GB' })), 'GB');
  assert.equal(detectCountry(req({ 'x-device-country': 'gb' })), 'GB', 'lowercased codes are accepted');
  assert.equal(detectCountry(req({ 'x-device-country': 'ZZ' })), 'ZZ',
    'any well-formed 2-letter code passes; only XX/T1 are treated as no-signal');
  assert.equal(detectCountry(req({ 'x-device-country': 'XX' })), null, 'placeholders are rejected here too');
  assert.equal(detectCountry(req({ 'x-device-country': 'GBR' })), null, 'not a 2-letter code');
  // Cloudflare's edge signal wins over the device hint when both are present.
  assert.equal(detectCountry(req({ 'cf-ipcountry': 'PL', 'x-device-country': 'GB' })), 'PL',
    'CF edge country takes precedence');
});

test('COUNTRY_TO_LANGUAGE maps Poland to Polish; others fall back to English', () => {
  assert.equal(COUNTRY_TO_LANGUAGE.PL, 'pl');
  assert.equal(COUNTRY_TO_LANGUAGE.US, undefined, 'unmapped countries default to English via detectLanguage');
});

test('detectLanguage prefers the country language when we localize for it', () => {
  assert.equal(detectLanguage(req({ 'cf-ipcountry': 'PL' })), 'pl');
  assert.equal(detectLanguage(req({ 'cf-ipcountry': 'US' })), 'en', 'unmapped country → default');
});

test('detectLanguage falls back to Accept-Language, then to the default', () => {
  // No (or unmapped) country: honour the browser's first supported language.
  assert.equal(detectLanguage(req({ 'accept-language': 'pl-PL,pl;q=0.9,en;q=0.8' })), 'pl');
  assert.equal(detectLanguage(req({ 'accept-language': 'fr-FR,fr;q=0.9' })), DEFAULT_LANGUAGE,
    'unsupported language → default');
  assert.equal(detectLanguage(req()), DEFAULT_LANGUAGE, 'no hints → default');
  // A mapped country wins over Accept-Language.
  assert.equal(detectLanguage(req({ 'cf-ipcountry': 'PL', 'accept-language': 'en-US' })), 'pl');
});

test('a Poland region defaults the language to Polish, from either signal', () => {
  // Whether Poland comes from the web edge or the app's device-region header, the
  // default UI language is Polish — a default the visitor can still switch.
  assert.equal(detectLanguage(req({ 'x-device-country': 'PL', 'accept-language': 'en-CA,en;q=0.9' })), 'pl',
    'the app device-region PL defaults to Polish');
  assert.equal(detectLanguage(req({ 'cf-ipcountry': 'PL', 'accept-language': 'en-CA' })), 'pl',
    'the web edge PL defaults to Polish');
});

test('tmdbLang maps app codes to TMDB language params', () => {
  assert.equal(tmdbLang('en'), 'en-US');
  assert.equal(tmdbLang('pl'), 'pl-PL');
  assert.equal(tmdbLang('zz'), 'en-US', 'unknown code falls back to the default language');
});

test('isSupportedLanguage gates the saved-language setter', () => {
  assert.ok(isSupportedLanguage('en'));
  assert.ok(isSupportedLanguage('pl'));
  assert.ok(!isSupportedLanguage('fr'));
  assert.ok(SUPPORTED_LANGUAGES.every((l) => l.code && l.name), 'each language has a code + native name');
});
