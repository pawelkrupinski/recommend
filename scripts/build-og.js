// Builds the homepage social-preview images (public/og-home.png +
// og-home-pl.png) — the link cards Facebook/Slack/iMessage render. Each is a
// 1200×630 board: the app-icon mark + wordmark + tagline on the left, and three
// real in-app movie cards (live TMDB posters, titles, IMDb + taste badges) on
// the right, so the preview shows the product rather than abstract shapes.
//
// One-off generator, like the asset images it replaces — run locally when the
// look or the featured films change (needs a TMDB key + rsvg-convert, neither
// present in CI):
//   node --env-file=.env.local scripts/build-og.js
// Commit the regenerated PNGs.
import { readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
const run = promisify(execFile);

const ROOT = new URL('../', import.meta.url);
const WIDTH = 1200, HEIGHT = 630;

// Palette mirrors public/styles.css :root (bg/panel/line/fg/muted/accent + the
// score-high green and the rating-badge colors the card spec uses).
const C = { bg0: '#11151c', bg1: '#0b0e13', panel: '#171b22', panel2: '#1f242d',
  line: '#2a3038', fg: '#e6e9ef', muted: '#8b94a3', accent: '#f5c518', hi: '#4ade80' };

// The three featured films: TMDB id (for the live title + poster) plus the
// public IMDb score and an illustrative "your taste" affinity score the card
// badges display. IMDb numbers are the real ones, not TMDB's vote average.
const FILMS = [
  { id: 693134, imdb: '8.5', taste: 96 }, // Dune: Part Two
  { id: 872585, imdb: '8.3', taste: 94 }, // Oppenheimer
  { id: 496243, imdb: '8.5', taste: 95 }, // Parasite
];

// Per-language brand + marketing copy (the EN/PL split mirrors src/shell.js).
const COPY = {
  en: { lang: 'en-US', wordmark: 'recommend', tagline: 'what to watch tonight',
    body: ['Personalised film & TV picks', 'from the services you have.'] },
  pl: { lang: 'pl-PL', wordmark: 'Filmowo', tagline: 'co obejrzeć dziś wieczorem',
    body: ['Spersonalizowane filmy i seriale', 'z serwisów, które masz.'] },
};

const key = process.env.TMDB_API_KEY || '';
if (!key) throw new Error('TMDB_API_KEY not set — run with --env-file=.env.local');
const bearer = key.startsWith('eyJ');
const tmdbInit = bearer ? { headers: { Authorization: `Bearer ${key}` } } : {};
const tmdbAuth = bearer ? '' : `api_key=${key}`;

async function tmdb(path, params = '') {
  const url = `https://api.themoviedb.org/3${path}?${params}${tmdbAuth ? `&${tmdbAuth}` : ''}`;
  const res = await fetch(url, tmdbInit);
  if (!res.ok) throw new Error(`TMDB ${res.status} on ${path}`);
  return res.json();
}

// Fetch a film's localized title + its poster as a base64 data URI (w342 — sharp
// at the card's render size without bloating the SVG).
async function card(film, lang) {
  const detail = await tmdb(`/movie/${film.id}`, `language=${lang}`);
  const img = await fetch(`https://image.tmdb.org/t/p/w342${detail.poster_path}`);
  const poster = `data:image/jpeg;base64,${Buffer.from(await img.arrayBuffer()).toString('base64')}`;
  return { title: detail.title, poster, imdb: film.imdb, taste: film.taste };
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Wrap a title to at most 2 lines (the app clamps the same way), ellipsizing the
// overflow. `max` is the approximate per-line character budget at the font size.
function wrap(title, max) {
  const words = title.split(' ');
  const lines = [''];
  for (const w of words) {
    const tentative = lines[lines.length - 1] ? `${lines[lines.length - 1]} ${w}` : w;
    if (tentative.length <= max || !lines[lines.length - 1]) lines[lines.length - 1] = tentative;
    else if (lines.length < 2) lines.push(w);
    else { lines[1] = `${lines[1].slice(0, max - 1)}…`; break; }
  }
  return lines.map(esc);
}

// One in-app card at (x, y), width w — poster on top, then title + IMDb badge,
// with the green "taste" score over the poster's top-left (the app's .score.hi).
function cardSvg(c, x, y, w, i) {
  const posterH = Math.round(w * 1.5);
  const clip = `cardclip${i}`;
  const titleY = y + posterH + 26;
  const lines = wrap(c.title, Math.floor((w - 16) / 9));
  return `
  <clipPath id="${clip}"><rect x="${x}" y="${y}" width="${w}" height="${posterH + 84}" rx="10"/></clipPath>
  <g clip-path="url(#${clip})">
    <rect x="${x}" y="${y}" width="${w}" height="${posterH + 84}" fill="${C.panel}"/>
    <image x="${x}" y="${y}" width="${w}" height="${posterH}" preserveAspectRatio="xMidYMid slice" href="${c.poster}"/>
  </g>
  <rect x="${x}" y="${y}" width="${w}" height="${posterH + 84}" rx="10" fill="none" stroke="${C.line}"/>
  <g>
    <rect x="${x + 8}" y="${y + 8}" width="44" height="26" rx="13" fill="rgba(0,0,0,0.78)" stroke="${C.hi}"/>
    <text x="${x + 30}" y="${y + 26}" font-family="Helvetica, Arial, sans-serif" font-size="15" font-weight="700" fill="${C.hi}" text-anchor="middle">${c.taste}</text>
  </g>
  ${lines.map((l, n) => `<text x="${x + 11}" y="${titleY + n * 21}" font-family="Helvetica, Arial, sans-serif" font-size="16" font-weight="600" fill="${C.fg}">${l}</text>`).join('\n  ')}
  <g transform="translate(${x + 11}, ${y + posterH + (lines.length > 1 ? 56 : 40)})">
    <rect x="0" y="0" width="78" height="24" rx="5" fill="${C.accent}"/>
    <text x="39" y="17" font-family="Helvetica, Arial, sans-serif" font-size="13" font-weight="700" fill="#000" text-anchor="middle">IMDb ${c.imdb}</text>
  </g>`;
}

function svg(copy, cards, iconDataUri) {
  // Three cards on the right; left column holds the icon mark, wordmark, tagline
  // and a two-line strapline — kept clear of the cards' left edge.
  const w = 158, gap = 20, n = cards.length;
  const x0 = WIDTH - 40 - (w * n + gap * (n - 1));
  const posterH = Math.round(w * 1.5);
  const cardY = Math.round((HEIGHT - (posterH + 84)) / 2);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${C.bg0}"/>
      <stop offset="1" stop-color="${C.bg1}"/>
    </linearGradient>
    <clipPath id="iconclip"><rect x="96" y="120" width="104" height="104" rx="22"/></clipPath>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>

  <!-- App-icon mark + wordmark + tagline. -->
  <image x="96" y="120" width="104" height="104" href="${iconDataUri}" clip-path="url(#iconclip)"/>
  <text x="216" y="196" font-family="Helvetica, Arial, sans-serif" font-size="74" font-weight="700" fill="${C.fg}">${esc(copy.wordmark)}</text>
  <text x="98" y="288" font-family="Helvetica, Arial, sans-serif" font-size="36" font-weight="600" fill="${C.accent}">${esc(copy.tagline)}</text>
  ${copy.body.map((l, i) => `<text x="98" y="${360 + i * 40}" font-family="Helvetica, Arial, sans-serif" font-size="29" fill="${C.muted}">${esc(l)}</text>`).join('\n  ')}

  <!-- Live in-app movie cards. -->
  ${cards.map((c, i) => cardSvg(c, x0 + i * (w + gap), cardY, w, i)).join('\n')}
</svg>`;
}

const iconUri = `data:image/png;base64,${(await readFile(new URL('facebook-app-icon-1024.png', ROOT))).toString('base64')}`;

for (const [code, copy] of Object.entries(COPY)) {
  const cards = [];
  for (const f of FILMS) cards.push(await card(f, copy.lang));
  const out = svg(copy, cards, iconUri);
  // The SVG carries base64-embedded posters (~1 MB) and is purely intermediate —
  // this script is the source of truth, the PNG is the committed artifact — so
  // stage it in a temp dir rather than the repo.
  const svgPath = join(tmpdir(), `og-home${code === 'en' ? '' : '-pl'}.svg`);
  const pngPath = new URL(`public/og-home${code === 'en' ? '' : '-pl'}.png`, ROOT);
  await writeFile(svgPath, out);
  await run('rsvg-convert', ['-w', String(WIDTH), '-h', String(HEIGHT), '-o', pngPath.pathname, svgPath]);
  console.log(`built ${pngPath.pathname} (${cards.map((c) => c.title).join(', ')})`);
}
