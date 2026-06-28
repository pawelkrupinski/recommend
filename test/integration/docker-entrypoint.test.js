// Boot-sequence tests for docker-entrypoint.sh.
//
// The entrypoint restores the SQLite DB from the Litestream replica before
// starting node. The data-loss bug we are guarding against: a *transient*
// restore failure (R2 occasionally 404s) must NEVER cause us to boot with a
// blank DB, because litestream then publishes that blank DB as the newest
// generation and the next boot restores it — wiping every user.
//
// We exercise the real script with a stub `litestream` on PATH so no network or
// real binary is involved. The stub records whether `replicate` (i.e. "node is
// about to start") was reached; a correct boot must abort instead of reaching
// replicate when an existing replica cannot be restored.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, chmodSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ENTRYPOINT = fileURLToPath(new URL('../../docker-entrypoint.sh', import.meta.url));

// Write a stub `litestream` whose behaviour the test controls via env vars.
function makeStub(dir) {
  const path = join(dir, 'litestream');
  writeFileSync(path, `#!/bin/sh
case "$1" in
  snapshots)
    case "$STUB_SNAPSHOTS" in
      found) printf 'replica generation index size created\\n'
             printf 's3 ea100af39afe0fa1 0 19000000 2026-06-28T11:00:00Z\\n'; exit 0;;
      error) exit 1;;
      *)     printf 'replica generation index size created\\n'; exit 0;;
    esac ;;
  restore)
    n=$(cat "$STUB_COUNTER" 2>/dev/null || echo 0); n=$((n + 1)); echo "$n" > "$STUB_COUNTER"
    [ "$STUB_RESTORE" = "fail" ] && exit 1
    exit 0 ;;
  replicate)
    echo reached > "$STUB_REPLICATE_MARKER"; exit 0 ;;
esac
`, { mode: 0o755 });
  chmodSync(path, 0o755);
  return path;
}

function runEntrypoint(env) {
  const dir = mkdtempSync(join(tmpdir(), 'entrypoint-'));
  makeStub(dir);
  const marker = join(dir, 'replicate-marker');
  const counter = join(dir, 'restore-counter');
  return new Promise((resolve) => {
    execFile('/bin/sh', [ENTRYPOINT], {
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH}`,
        DB_PATH: join(dir, 'does-not-exist.db'),
        LITESTREAM_BUCKET: 'recommend',
        RESTORE_MAX_ATTEMPTS: '2',
        RESTORE_RETRY_SLEEP: '0',
        STUB_REPLICATE_MARKER: marker,
        STUB_COUNTER: counter,
        ...env,
      },
    }, (err) => {
      resolve({ code: err ? err.code : 0, reachedReplicate: existsSync(marker), dir });
    });
  });
}

test('aborts instead of booting blank when an existing replica cannot be restored', async () => {
  // A replica exists but every restore attempt fails (transient R2 error).
  const r = await runEntrypoint({ STUB_SNAPSHOTS: 'found', STUB_RESTORE: 'fail' });
  assert.notEqual(r.code, 0, 'should exit non-zero rather than start with a blank DB');
  assert.equal(r.reachedReplicate, false, 'must NOT reach replicate (would publish a blank DB and wipe users)');
  rmSync(r.dir, { recursive: true, force: true });
});

test('starts fresh and replicates when the bucket is genuinely empty (first deploy)', async () => {
  const r = await runEntrypoint({ STUB_SNAPSHOTS: 'empty' });
  assert.equal(r.code, 0);
  assert.equal(r.reachedReplicate, true, 'an empty bucket is a legitimate fresh start');
  rmSync(r.dir, { recursive: true, force: true });
});

test('restores and replicates when a replica exists and restore succeeds', async () => {
  const r = await runEntrypoint({ STUB_SNAPSHOTS: 'found', STUB_RESTORE: 'ok' });
  assert.equal(r.code, 0);
  assert.equal(r.reachedReplicate, true);
  rmSync(r.dir, { recursive: true, force: true });
});

test('refuses to boot blank when storage cannot be reached (snapshots errors)', async () => {
  // If we cannot even confirm the bucket is empty, treat it as "replica may
  // exist" and refuse to wipe — restore is attempted and, failing, aborts.
  const r = await runEntrypoint({ STUB_SNAPSHOTS: 'error', STUB_RESTORE: 'fail' });
  assert.notEqual(r.code, 0);
  assert.equal(r.reachedReplicate, false);
  rmSync(r.dir, { recursive: true, force: true });
});
