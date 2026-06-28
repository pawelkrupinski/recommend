#!/bin/sh
# Boot sequence for the container:
#   1. If object storage isn't configured, just run the app (no replication).
#   2. Otherwise restore the DB from the replica if it's not on the local
#      (ephemeral) disk yet — first boot after a deploy, or a cold start on a
#      fresh instance.
#   3. Run node *under* Litestream so every write is streamed to object storage.
#      Litestream forwards signals and does a final sync when node exits, so
#      graceful restarts/redeploys/idle spin-downs lose nothing.
set -e

if [ -z "$LITESTREAM_BUCKET" ]; then
  echo "litestream: LITESTREAM_BUCKET unset — running without replication"
  exec node src/server.js
fi

if [ ! -f "$DB_PATH" ]; then
  echo "litestream: restoring $DB_PATH from replica (if any)…"
  # On the first deploy the bucket is empty. -if-replica-exists is meant to make
  # this a no-op, but against Cloudflare R2 it returns a NoSuchKey (404) that
  # litestream treats as fatal — so we tolerate a failed restore and start fresh.
  # litestream replicate (below) then creates the first generation in the bucket.
  litestream restore -if-replica-exists "$DB_PATH" \
    || echo "litestream: no replica to restore yet — starting with a fresh database"
fi

echo "litestream: replicating $DB_PATH → $LITESTREAM_BUCKET"
exec litestream replicate -exec "node src/server.js"
