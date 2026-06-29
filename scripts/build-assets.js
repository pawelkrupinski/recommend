// Production asset build: bundle + minify the browser module graph and the
// stylesheet, fingerprint each output with a content hash, and emit an
// index.html that points at the hashed filenames.
//
// Why fingerprint: the raw assets are served with `max-age=0, must-revalidate`
// (a revalidation round-trip on every navigation) because a bare /app.js can go
// stale against a fresh index.html after a deploy. A content hash in the URL
// makes each build's assets a distinct, immutable URL, so they can be cached
// for a year — the URL itself changes when the bytes change. index.html stays
// revalidate-always (it's the one file that names the current hashes).
//
// Output goes to public/dist/ (served at /dist/...). Dev (`npm run dev`) skips
// the build and serves raw public/ — the server falls back to the un-hashed
// index.html when dist/ is absent (see serveStatic). Production runs this at
// image-build time (Dockerfile) so deploys ship minified, hashed, immutable
// assets.
import { build } from 'esbuild';
import { readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { basename } from 'node:path';

const PUBLIC = new URL('../public/', import.meta.url);
const DIST = new URL('../public/dist/', import.meta.url);

export async function buildAssets({ quiet = false } = {}) {
  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });

  // One build for both entrypoints: app.js is bundled (its ESM import graph —
  // i18n, service-match, watchlist-* , recs-queue — collapses into a single
  // module), styles.css is minified. `entryNames: [name].[hash]` fingerprints
  // each. The metafile tells us the exact hashed names to wire into the HTML.
  const result = await build({
    entryPoints: [
      fileURLToPath(new URL('app.js', PUBLIC)),
      fileURLToPath(new URL('styles.css', PUBLIC)),
    ],
    bundle: true,
    minify: true,
    format: 'esm',
    target: ['es2022'],
    entryNames: '[name].[hash]',
    outdir: fileURLToPath(DIST),
    metafile: true,
    logLevel: quiet ? 'silent' : 'info',
  });

  // Map each entrypoint to its hashed output basename via the metafile.
  let jsName, cssName;
  for (const [outPath, meta] of Object.entries(result.metafile.outputs)) {
    const entry = meta.entryPoint || '';
    if (entry.endsWith('app.js')) jsName = basename(outPath);
    else if (entry.endsWith('styles.css')) cssName = basename(outPath);
  }
  if (!jsName || !cssName) {
    throw new Error(`build did not produce both outputs (js=${jsName}, css=${cssName})`);
  }

  // Rewrite the HTML shell to point at the hashed assets. The template
  // references bare "/app.js" (modulepreload + <script>) and "/styles.css"
  // (<link>); swap each for its /dist/<name>.<hash>.<ext> equivalent.
  const html = await readFile(new URL('index.html', PUBLIC), 'utf8');
  const rewritten = html
    .replaceAll('"/app.js"', `"/dist/${jsName}"`)
    .replaceAll('"/styles.css"', `"/dist/${cssName}"`);
  if (rewritten === html) {
    throw new Error('index.html had no /app.js or /styles.css references to rewrite');
  }
  await writeFile(new URL('index.html', DIST), rewritten);

  return { jsName, cssName };
}

// Run as a script (`npm run build`).
if (import.meta.url === `file://${process.argv[1]}`) {
  const { jsName, cssName } = await buildAssets();
  console.log(`built public/dist/${jsName} + public/dist/${cssName} (+ index.html)`);
}
