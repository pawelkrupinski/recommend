// Response compression, ETag / conditional-GET (304), and a small in-memory
// static cache — the recommend equivalent of what ../movies gets for free from
// Play's GzipFilter + GzippedResponseCache: text payloads go out brotli/gzip'd,
// unchanged responses cost a tiny 304 instead of a re-send, and each static file
// is read + compressed once per process (assets re-load on deploy / `node --watch`).
import { gzipSync, brotliCompressSync, constants as Z } from 'node:zlib';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

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

// Nothing here is fingerprinted (index.html references a bare /app.js, /styles.css),
// so every asset must revalidate on each load — otherwise a returning user keeps a
// stale app.js for up to the max-age window while the fresh index.html loads against
// it, and the two disagree (e.g. a new tab the old JS doesn't know how to render).
// max-age=0 + the ETag conditional-GET makes the common case a cheap 304, and a
// changed asset is served fresh immediately. Cloudflare passes these through
// (cf-cache-status: DYNAMIC), so this is the only cache layer that matters.
const cacheControlFor = () => 'public, max-age=0, must-revalidate';

// Serve a file from PUBLIC with negotiation + caching. Returns false (404) if the
// file is missing so the caller can fall through. `dir` must end in a slash.
export async function serveStatic(req, res, dir, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
  const ext = extname(rel);
  try {
    let entry = cache.get(rel);
    if (!entry) cache.set(rel, (entry = await load(dir + rel, ext)));

    const headers = {
      'content-type': entry.type,
      etag: entry.etag,
      vary: 'Accept-Encoding',
      'cache-control': cacheControlFor(),
    };
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
  } catch {
    return false;
  }
}
