// Builds the homepage social-preview images (public/og-home.png +
// og-home-pl.png) — the link cards Facebook/Slack/iMessage render. Each is a
// 1200×630 board layered like the app's Discover grid: a full-bleed wall of
// movie posters faded behind the text (a left→right scrim, mirroring ../movies'
// OgCardRenderer), the app-icon mark + wordmark + tagline on the dark left, and
// three crisp in-app cards (live TMDB posters, localized titles, taste score +
// IMDb + Metacritic badges, a watch button) standing in the foreground.
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
  line: '#2a3038', fg: '#e6e9ef', muted: '#8b94a3', accent: '#f5c518', hi: '#4ade80', mc: '#00a868' };

// The three foreground films: TMDB id (for the live localized title + poster)
// plus real public IMDb + Metacritic scores and an illustrative "your taste"
// affinity score — the badges a real card shows.
const FEATURED = [
  { id: 693134, imdb: '8.5', mc: '79', taste: 96 }, // Dune: Part Two
  { id: 872585, imdb: '8.3', mc: '90', taste: 94 }, // Oppenheimer
  { id: 496243, imdb: '8.5', mc: '96', taste: 95 }, // Parasite
];

// Popular films whose posters tile the faded backdrop wall (language-neutral —
// the scrim dims them, so artwork variation doesn't matter).
const BACKDROP_IDS = [157336, 155, 27205, 680, 603, 550, 13, 98, 335984, 475557, 244786, 324857];

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

// A poster (w342 — sharp at render size without bloating the SVG) as a base64
// data URI, or null when the film has none.
async function poster(path) {
  if (!path) return null;
  const img = await fetch(`https://image.tmdb.org/t/p/w342${path}`);
  return `data:image/jpeg;base64,${Buffer.from(await img.arrayBuffer()).toString('base64')}`;
}

async function featured(film, lang) {
  const detail = await tmdb(`/movie/${film.id}`, `language=${lang}`);
  return { title: detail.title, poster: await poster(detail.poster_path), ...film };
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

const badge = (x, y, w, fill, label, fg) =>
  `<rect x="${x}" y="${y}" width="${w}" height="24" rx="5" fill="${fill}"/>` +
  `<text x="${x + w / 2}" y="${y + 17}" font-family="Helvetica, Arial, sans-serif" font-size="13" font-weight="700" fill="${fg}" text-anchor="middle">${label}</text>`;

// One in-app card at (x, y), width w — poster, the green "taste" score + a watch
// button over it, then the title and the IMDb + Metacritic rating badges below.
function cardSvg(c, x, y, w, i) {
  const posterH = Math.round(w * 1.5);
  const h = posterH + 92, clip = `cardclip${i}`;
  const lines = wrap(c.title, Math.floor((w - 16) / 9));
  const badgeY = y + posterH + (lines.length > 1 ? 70 : 52);
  return `
  <g filter="url(#cardshadow)">
    <clipPath id="${clip}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10"/></clipPath>
    <g clip-path="url(#${clip})">
      <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${C.panel}"/>
      <image x="${x}" y="${y}" width="${w}" height="${posterH}" preserveAspectRatio="xMidYMid slice" href="${c.poster}"/>
    </g>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="none" stroke="${C.line}"/>
  </g>
  <rect x="${x + 8}" y="${y + 8}" width="44" height="26" rx="13" fill="rgba(0,0,0,0.78)" stroke="${C.hi}"/>
  <text x="${x + 30}" y="${y + 26}" font-family="Helvetica, Arial, sans-serif" font-size="15" font-weight="700" fill="${C.hi}" text-anchor="middle">${c.taste}</text>
  <circle cx="${x + w - 23}" cy="${y + 23}" r="15" fill="rgba(0,0,0,0.78)" stroke="${C.line}"/>
  <text x="${x + w - 23}" y="${y + 29}" font-family="Helvetica, Arial, sans-serif" font-size="22" font-weight="700" fill="#fff" text-anchor="middle">+</text>
  ${lines.map((l, n) => `<text x="${x + 11}" y="${y + posterH + 26 + n * 21}" font-family="Helvetica, Arial, sans-serif" font-size="16" font-weight="600" fill="${C.fg}">${l}</text>`).join('\n  ')}
  ${badge(x + 11, badgeY, 70, C.accent, `IMDb ${c.imdb}`, '#000')}
  ${badge(x + 87, badgeY, 56, C.mc, `MC ${c.mc}`, '#fff')}`;
}

// A faded poster tile for the backdrop wall — poster + the app's green score pill.
function tileSvg(p, x, y, w, i) {
  const h = Math.round(w * 1.5), clip = `tileclip${i}`;
  const score = 88 + (i * 7) % 12; // deterministic illustrative taste score
  return `
  <clipPath id="${clip}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12"/></clipPath>
  <g clip-path="url(#${clip})">
    <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${C.panel2}"/>
    ${p ? `<image x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice" href="${p}"/>` : ''}
  </g>
  <rect x="${x + 8}" y="${y + 8}" width="40" height="24" rx="12" fill="rgba(0,0,0,0.78)" stroke="${C.hi}"/>
  <text x="${x + 28}" y="${y + 25}" font-family="Helvetica, Arial, sans-serif" font-size="13" font-weight="700" fill="${C.hi}" text-anchor="middle">${score}</text>`;
}

function svg(copy, cards, tiles, iconDataUri) {
  // Backdrop: a 6×2 poster wall bleeding off every edge (the app's grid scrolled
  // behind the card). A left→right scrim (../movies' OgCardRenderer values)
  // darkens it under the text on the left and lets it stay visible on the right.
  const tw = 220, tgap = 16, cols = 6;
  const tx0 = Math.round((WIDTH - (tw * cols + tgap * (cols - 1))) / 2);
  const th = Math.round(tw * 1.5);
  const rows = [-70, -70 + th + tgap];
  const wall = tiles.map((p, i) =>
    tileSvg(p, tx0 + (i % cols) * (tw + tgap), rows[Math.floor(i / cols)], tw, i)).join('\n');

  // Foreground: three crisp cards on the right where the scrim has faded out.
  const w = 164, gap = 20, n = cards.length;
  const x0 = WIDTH - 40 - (w * n + gap * (n - 1));
  const cardY = Math.round((HEIGHT - (Math.round(w * 1.5) + 92)) / 2);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${C.bg0}"/>
      <stop offset="1" stop-color="${C.bg1}"/>
    </linearGradient>
    <linearGradient id="scrim" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${C.bg1}" stop-opacity="0.97"/>
      <stop offset="0.34" stop-color="${C.bg1}" stop-opacity="0.92"/>
      <stop offset="0.66" stop-color="${C.bg1}" stop-opacity="0.55"/>
      <stop offset="1" stop-color="${C.bg1}" stop-opacity="0.42"/>
    </linearGradient>
    <clipPath id="iconclip"><rect x="96" y="120" width="104" height="104" rx="22"/></clipPath>
    <filter id="cardshadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="9" stdDeviation="11" flood-color="#000" flood-opacity="0.5"/>
    </filter>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>

  <!-- Faded poster wall behind everything. -->
  <g opacity="0.6">
  ${wall}
  </g>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#scrim)"/>

  <!-- App-icon mark + wordmark + tagline, on the dark left. -->
  <image x="96" y="120" width="104" height="104" href="${iconDataUri}" clip-path="url(#iconclip)"/>
  <text x="216" y="196" font-family="Helvetica, Arial, sans-serif" font-size="74" font-weight="700" fill="${C.fg}">${esc(copy.wordmark)}</text>
  <text x="98" y="288" font-family="Helvetica, Arial, sans-serif" font-size="36" font-weight="600" fill="${C.accent}">${esc(copy.tagline)}</text>
  ${copy.body.map((l, i) => `<text x="98" y="${360 + i * 40}" font-family="Helvetica, Arial, sans-serif" font-size="29" fill="${C.muted}">${esc(l)}</text>`).join('\n  ')}

  <!-- Crisp foreground in-app cards. -->
  ${cards.map((c, i) => cardSvg(c, x0 + i * (w + gap), cardY, w, i)).join('\n')}
</svg>`;
}

const iconUri = `data:image/png;base64,${(await readFile(new URL('facebook-app-icon-1024.png', ROOT))).toString('base64')}`;
// Backdrop posters are language-neutral; fetch them once and reuse for both images.
const tiles = [];
for (const id of BACKDROP_IDS) tiles.push(await poster((await tmdb(`/movie/${id}`)).poster_path));

for (const [code, copy] of Object.entries(COPY)) {
  const cards = [];
  for (const f of FEATURED) cards.push(await featured(f, copy.lang));
  const out = svg(copy, cards, tiles, iconUri);
  // The SVG carries base64-embedded posters (~megabytes) and is purely
  // intermediate — this script is the source of truth, the PNG is the committed
  // artifact — so stage it in a temp dir rather than the repo.
  const svgPath = join(tmpdir(), `og-home${code === 'en' ? '' : '-pl'}.svg`);
  const pngPath = new URL(`public/og-home${code === 'en' ? '' : '-pl'}.png`, ROOT);
  await writeFile(svgPath, out);
  await run('rsvg-convert', ['-w', String(WIDTH), '-h', String(HEIGHT), '-o', pngPath.pathname, svgPath]);
  console.log(`built ${pngPath.pathname} (${cards.map((c) => c.title).join(', ')})`);
}
