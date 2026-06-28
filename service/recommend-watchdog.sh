#!/bin/sh
# Health check for com.kinowo.recommend.
#
# The main job runs `node --watch src/server.js` under launchd KeepAlive.
# `node --watch` gives live reload on source edits, but on a CRASH it parks
# ("Completed running ... waiting for changes before restarting") without
# exiting -- so the watcher process stays alive, KeepAlive never sees a dead
# job, and the server is silently down until someone edits a file.
#
# This script (run periodically via com.kinowo.recommend-watchdog) detects
# that state by probing the port. If the server isn't accepting connections,
# it kickstarts (-k = kill + restart) the whole job, which respawns node
# fresh and rebinds the port. Two probes 2s apart avoid false positives
# during the brief window of a legitimate reload.

HOST=127.0.0.1
PORT="${PORT:-9002}"

check() { /usr/bin/nc -z -G 1 "$HOST" "$PORT" >/dev/null 2>&1; }

if check; then exit 0; fi
sleep 2
if check; then exit 0; fi

echo "$(date '+%Y-%m-%dT%H:%M:%S') ${HOST}:${PORT} down -> kickstart com.kinowo.recommend"
/bin/launchctl kickstart -k "gui/$(id -u)/com.kinowo.recommend"
