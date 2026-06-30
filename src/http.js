// Response compression, ETag / conditional-GET (304), and a small in-memory
// static cache — the recommend equivalent of what ../movies gets for free from
// Play's GzipFilter + GzippedResponseCache: text payloads go out brotli/gzip'd,
// unchanged responses cost a tiny 304 instead of a re-send, and each static file
// is read + compressed once per process (assets re-load on deploy / `node --watch`).
import { gzipSync, brotliCompressSync, constants as Z } from 'node:zlib';
import { createHash } from 'node:crypto';
import { readFile, access } from 'node:fs/promises';
import { extname } from 'node:path';
import { localizeShell } from './shell.js';

// Below this, compression framing overhead outweighs the saving — send raw.
const MIN_COMPRESS = 256;
// Only text-ish bodies benefit; binaries (images) are already compressed.
const COMPRESSIBLE = /^(?:text\/|image\/svg|application\/(?:json|javascript|xml|manifest\+json|.*\+json))/;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

// Short, stable content hash — same bytes always yield the same ETag, so a client
// revalidating after a deploy that didn't touch the file still gets a 304.
const etagOf = (buf) => `"${createHash('sha1').update(buf).digest('base64url').slice(0, 27)}"`;

// Does the client's If-None-Match cover our tag? Weak comparison per RFC 7232
// §2.3.2: ignore a `W/` prefix on either side. Render's proxy rewrites our strong
// ETag to a weak one for uncompressed responses, so a strict string match would
// miss the revalidation and re-send the whole body — weak compare keeps the 304.
const weak = (t) => (t || '').replace(/^W\//, '');
const matches = (inm, tag) => !!inm && weak(inm) === weak(tag);

// Best encoding the client accepts. Brotli beats gzip ~15-20% on text but costs
// more CPU — fine for static (compressed once) and acceptable for JSON at low q.
function pickEncoding(req) {
  const ae = req.headers['accept-encoding'] || '';
  if (/\bbr\b/.test(ae)) return 'br';
  if (/\bgzip\b/.test(ae)) return 'gzip';
  return null;
}

function compress(buf, encoding, quality) {
  if (encoding === 'br') {
    return brotliCompressSync(buf, { params: {
      [Z.BROTLI_PARAM_QUALITY]: quality.br,
      [Z.BROTLI_PARAM_SIZE_HINT]: buf.length,
    } });
  }
  return gzipSync(buf, { level: quality.gzip });
}

// Per-request bodies (JSON): re-compressed each time, so favour speed over ratio.
const DYNAMIC_Q = { br: 5, gzip: 6 };
// Static files: compressed once and reused, so spend the CPU for max ratio.
const STATIC_Q = { br: 11, gzip: 9 };

// Send a string/Buffer body with content negotiation. Handles HEAD, brotli/gzip,
// and — for 200 responses only — an ETag with conditional-GET. `status`,
// `cacheControl` and `etag` are optional. Error bodies keep their status code and
// skip revalidation (a 401/404 isn't something a client should cache as fresh).
export function send(req, res, body, { status = 200, type = 'application/octet-stream', cacheControl, etag } = {}) {
  const raw = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const headers = { 'content-type': type, vary: 'Accept-Encoding' };
  if (cacheControl) headers['cache-control'] = cacheControl;

  if (status === 200) {
    const tag = etag || etagOf(raw);
    headers.etag = tag;
    // Client's cached copy is current — skip the body entirely.
    if (matches(req.headers['if-none-match'], tag)) {
      res.writeHead(304, headers);
      return res.end();
    }
  }

  const encoding = raw.length >= MIN_COMPRESS && COMPRESSIBLE.test(type) ? pickEncoding(req) : null;
  const payload = encoding ? compress(raw, encoding, DYNAMIC_Q) : raw;
  if (encoding) headers['content-encoding'] = encoding;
  headers['content-length'] = payload.length;
  res.writeHead(status, headers);
  res.end(req.method === 'HEAD' ? undefined : payload);
}

// ---- request bodies ------------------------------------------------------
// JSON API bodies and Facebook's signed_request are all tiny; 1 MiB is generous
// headroom. The cap matters because the buffer grows with whatever the client
// sends — an unbounded body could balloon the heap on a 512 MB instance until it
// OOMs and the process is killed (→ 502). Past the limit we destroy the request
// and reject with a 413-flagged error the route handlers map to a response.
export const MAX_BODY_BYTES = 1 << 20; // 1 MiB

// Read a request stream into a UTF-8 string, capped at `limit` bytes. Buffers
// the raw chunks and decodes once at the end so a multi-byte character split
// across two TCP chunks isn't corrupted (the old `s += chunk` decoded each chunk
// in isolation and mangled the boundary byte).
export function readBody(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        const err = new Error('request body too large');
        err.status = 413;
        req.destroy(err);
        reject(err);
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// ---- static files --------------------------------------------------------
// One entry per file: raw bytes + pre-built gzip/br variants + ETag. Built lazily
// on first hit; the process is short-lived relative to deploys so it never goes
// stale within a run.
const cache = new Map();

async function load(absPath, ext) {
  const raw = await readFile(absPath);
  const type = MIME[ext] || 'application/octet-stream';
  const compressible = raw.length >= MIN_COMPRESS && COMPRESSIBLE.test(type);
  return {
    type,
    etag: etagOf(raw),
    raw,
    br: compressible ? compress(raw, 'br', STATIC_Q) : null,
    gzip: compressible ? compress(raw, 'gzip', STATIC_Q) : null,
  };
}

// Fingerprinted assets (the build's public/dist/app.<hash>.js & styles.<hash>.css)
// carry their content hash in the URL, so a changed file is a *new* URL — the old
// one can be cached forever. `immutable` tells the browser not to even revalidate
// within the freshness window. The dist/ shell (index.html) is the exception: it
// names the current hashes, so it must always revalidate to pick up a new deploy.
//
// Everything else is un-fingerprinted (raw public/, served in dev or as the
// fallback shell), so it must revalidate on each load — otherwise a returning user
// keeps a stale app.js for up to the max-age window while the fresh index.html
// loads against it, and the two disagree. max-age=0 + the ETag conditional-GET
// makes the common case a cheap 304, and a changed asset is served fresh
// immediately. Cloudflare passes these through (cf-cache-status: DYNAMIC).
const REVALIDATE = 'public, max-age=0, must-revalidate';
const IMMUTABLE = 'public, max-age=31536000, immutable';
const isFingerprinted = (rel) => rel.startsWith('dist/') && rel !== 'dist/index.html';
const cacheControlFor = (rel) => (isFingerprinted(rel) ? IMMUTABLE : REVALIDATE);

// The shell (index.html) is served from the build's public/dist/ when it exists —
// that copy references the hashed asset URLs. In dev (no build) we fall back to the
// raw public/index.html, which references bare /app.js & /styles.css. Resolved once
// per directory; the process is short-lived relative to deploys.
const shellRel = new Map();
async function resolveShell(dir) {
  if (!shellRel.has(dir)) {
    shellRel.set(dir, await access(dir + 'dist/index.html').then(() => 'dist/index.html', () => 'index.html'));
  }
  return shellRel.get(dir);
}

// Emit a built cache entry (raw + pre-built br/gzip + etag) with conditional-GET
// and the best encoding the client accepts. Shared by the static-file and
// localized-shell paths. `headers` already carries content-type, etag, vary and
// cache-control. Returns true (response sent).
function respondEntry(req, res, entry, headers) {
  if (matches(req.headers['if-none-match'], entry.etag)) {
    res.writeHead(304, headers);
    res.end();
    return true;
  }
  const encoding = pickEncoding(req);
  const body = (encoding === 'br' && entry.br) || (encoding === 'gzip' && entry.gzip) || null;
  if (body) headers['content-encoding'] = body === entry.br ? 'br' : 'gzip';
  const payload = body || entry.raw;
  headers['content-length'] = payload.length;
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : payload);
  return true;
}

// Serve one resolved file (rel) with negotiation + caching. Returns false when
// it can't be read, so the caller can fall through (404 or a fallback shell).
async function serveFile(req, res, dir, rel) {
  try {
    let entry = cache.get(rel);
    if (!entry) cache.set(rel, (entry = await load(dir + rel, extname(rel))));
    return respondEntry(req, res, entry, {
      'content-type': entry.type,
      etag: entry.etag,
      vary: 'Accept-Encoding',
      'cache-control': cacheControlFor(rel),
    });
  } catch {
    return false;
  }
}

// Serve a file from PUBLIC with negotiation + caching. Returns false (404) if the
// file is missing so the caller can fall through. `dir` must end in a slash.
export async function serveStatic(req, res, dir, pathname) {
  let rel = pathname === '/' ? 'index.html' : pathname.slice(1);
  if (rel === 'index.html') rel = await resolveShell(dir);
  if (await serveFile(req, res, dir, rel)) return true;
  // The dist/ shell can momentarily vanish during a rebuild (or be missing if a
  // memoized resolution went stale) — fall back to the raw template rather than
  // 404 the homepage.
  if (rel === 'dist/index.html' && !res.headersSent) return serveFile(req, res, dir, 'index.html');
  return false;
}

// ---- localized SPA shell -------------------------------------------------
// The shell's social-preview tags vary by interface language (localizeShell),
// so — unlike serveStatic — it can't be one shared static file. Each (rel, lang)
// variant is localized + compressed once and cached. It's marked `private` so
// Cloudflare never caches one language's HTML and serves it to everyone, and
// carries a per-language ETag for cheap 304s. `dir` must end in a slash.
const shellCache = new Map();

async function shellEntry(dir, lang) {
  let rel = await resolveShell(dir);
  // The dist/ shell can momentarily vanish during a rebuild — fall back to the
  // raw template rather than fail the homepage (mirrors serveStatic).
  let raw = await readFile(dir + rel, 'utf8').catch(() => null);
  if (raw == null && rel === 'dist/index.html') raw = await readFile(dir + 'index.html', 'utf8').catch(() => null);
  if (raw == null) return null;

  const buf = Buffer.from(localizeShell(raw, lang));
  return { type: MIME['.html'], etag: etagOf(buf), raw: buf, br: compress(buf, 'br', STATIC_Q), gzip: compress(buf, 'gzip', STATIC_Q) };
}

export async function serveShell(req, res, dir, lang) {
  const key = dir + '\0' + lang;
  let entry = shellCache.get(key);
  // Only cache a successful build — a momentarily-missing shell should retry,
  // not get pinned as a permanent 404.
  if (!entry && (entry = await shellEntry(dir, lang))) shellCache.set(key, entry);
  if (!entry) return false;
  return respondEntry(req, res, entry, {
    'content-type': entry.type,
    etag: entry.etag,
    vary: 'Accept-Encoding',
    'cache-control': 'private, max-age=0, must-revalidate',
  });
}
