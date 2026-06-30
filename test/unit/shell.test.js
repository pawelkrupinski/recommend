// localizeShell overlays the right language's social-preview tags onto the SPA
// shell; fbLocaleLang maps Facebook's ?fb_locale re-scrape to an app language.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { localizeShell, fbLocaleLang, SHELL_META } from '../../src/shell.js';

const SHELL = await readFile(new URL('../../public/index.html', import.meta.url), 'utf8');
const fakeUrl = (qs) => new URL(`http://x/${qs}`);

test('Polish shell carries the Filmowo brand and Polish preview copy', () => {
  const html = localizeShell(SHELL, 'pl');
  assert.match(html, /<html lang="pl"/);
  assert.match(html, /<title>Filmowo — co obejrzeć[^<]*<\/title>/);
  assert.match(html, /<meta property="og:site_name" content="Filmowo"/);
  assert.match(html, /<meta property="og:title" content="Filmowo — co obejrzeć[^"]*"/);
  assert.match(html, /<meta property="og:description" content="Spersonalizowane[^"]*"/);
  assert.match(html, /<meta name="twitter:title" content="Filmowo — co obejrzeć[^"]*"/);
  // og:image (+ twitter:image) point at the Polish artwork, origin preserved.
  assert.match(html, /<meta property="og:image" content="https:\/\/[^"]+\/og-home-pl\.png"/);
  assert.match(html, /<meta name="twitter:image" content="https:\/\/[^"]+\/og-home-pl\.png"/);
  // This locale + its English alternate, so Facebook can offer both.
  assert.match(html, /<meta property="og:locale" content="pl_PL"/);
  assert.match(html, /<meta property="og:locale:alternate" content="en_US"/);
});

test('English shell keeps the recommend brand and advertises the Polish alternate', () => {
  const html = localizeShell(SHELL, 'en');
  assert.match(html, /<html lang="en"/);
  assert.match(html, /<meta property="og:site_name" content="recommend"/);
  assert.match(html, /<meta property="og:title" content="recommend — what to watch[^"]*"/);
  assert.match(html, /<meta property="og:image" content="https:\/\/[^"]+\/og-home\.png"/);
  assert.match(html, /<meta property="og:locale" content="en_US"/);
  assert.match(html, /<meta property="og:locale:alternate" content="pl_PL"/);
  // English is the template's own language — no Polish copy leaks in.
  assert.doesNotMatch(html, /Filmowo|obejrzeć|og-home-pl/);
});

test('an unknown language falls back to the English default', () => {
  assert.equal(localizeShell(SHELL, 'zz'), localizeShell(SHELL, 'en'));
});

test('fbLocaleLang maps a supported fb_locale, else null', () => {
  assert.equal(fbLocaleLang(fakeUrl('?fb_locale=pl_PL')), 'pl');
  assert.equal(fbLocaleLang(fakeUrl('?fb_locale=en_GB')), 'en');
  assert.equal(fbLocaleLang(fakeUrl('?fb_locale=de_DE')), null); // not shipped
  assert.equal(fbLocaleLang(fakeUrl('')), null);
});

test('every supported language has a complete SHELL_META entry', () => {
  for (const code of ['en', 'pl']) {
    const m = SHELL_META[code];
    assert.ok(m && m.siteName && m.title && m.description && m.image && m.ogLocale, code);
  }
});
