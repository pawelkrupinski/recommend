// Central configuration + local-dev secret loading.
//
// Locally we reuse the sibling movies app's secrets so credentials live in one
// place: if ../movies/.env.local exists, its values are loaded into process.env
// (without overriding anything already set). In production (e.g. Render) that
// file isn't present and everything comes from the host environment.
import { readFileSync, existsSync } from 'node:fs';

const SIBLING_ENV = new URL('../../movies/.env.local', import.meta.url).pathname;

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  let text;
  try { text = readFileSync(path, 'utf8'); } catch { return; }
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = val; // real env wins
  }
}

loadEnvFile(SIBLING_ENV);

const list = (s) => (s || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);

// Read after the file load so host env always takes precedence over the file.
export const config = {
  port: Number(process.env.PORT) || 9002,
  // Public origin used to build OAuth callback URLs. Empty → derive per-request
  // from forwarded headers (fine for local dev and single-domain hosting).
  baseUrl: (process.env.BASE_URL || '').replace(/\/$/, ''),
  appSecret: process.env.APPLICATION_SECRET || 'dev-insecure-secret-change-me',
  google: { id: process.env.GOOGLE_CLIENT_ID || '', secret: process.env.GOOGLE_CLIENT_SECRET || '' },
  facebook: { id: process.env.FACEBOOK_APP_ID || '', secret: process.env.FACEBOOK_APP_SECRET || '' },
  adminAllowlist: list(process.env.ADMIN_ALLOWLIST),
  // API keys (global). Movies stores TMDB under TMDB_API_KEY; accept TMDB_KEY too.
  tmdbKey: process.env.TMDB_API_KEY || process.env.TMDB_KEY || '',
  rapidApiKey: process.env.RAPIDAPI_KEY || '',
  traktKey: process.env.TRAKT_KEY || '',
};

export const isAdminEmail = (email) =>
  !!email && config.adminAllowlist.includes(String(email).toLowerCase());
