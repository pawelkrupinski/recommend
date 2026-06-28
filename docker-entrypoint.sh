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
  echo "litestream: checking object storage for an existing replica…"
  # The dangerous case: a replica EXISTS but restore fails transiently (R2 can
  # return a NoSuchKey/404 mid-flight). If we boot blank there, litestream
  # replicate publishes that empty DB as the newest generation and the next boot
  # restores it — silently wiping every user (logout + lost ratings). So we only
  # start fresh when we can positively confirm the bucket is empty; otherwise we
  # restore, and abort the boot if restore keeps failing rather than wipe data.
  if snaps=$(litestream snapshots "$DB_PATH" 2>/dev/null) \
       && ! printf '%s\n' "$snaps" | grep -qE '[0-9a-f]{16}'; then
    echo "litestream: no replica yet — starting with a fresh database"
  else
    echo "litestream: replica present — restoring $DB_PATH (will not start blank)"
    attempt=1
    until litestream restore "$DB_PATH"; do
      if [ "$attempt" -ge "${RESTORE_MAX_ATTEMPTS:-5}" ]; then
        echo "litestream: FATAL — could not restore an existing replica after ${attempt} attempts;" \
             "aborting so the host restarts us instead of booting with a blank database"
        exit 1
      fi
      echo "litestream: restore attempt ${attempt} failed; retrying…"
      attempt=$((attempt + 1))
      sleep "${RESTORE_RETRY_SLEEP:-2}"
    done
  fi
fi

echo "litestream: replicating $DB_PATH → $LITESTREAM_BUCKET"
exec litestream replicate -exec "node src/server.js"
