#!/usr/bin/env bash
# Manage the `recommend` app as a macOS launchd service.
# Mirrors the resilience pattern from ~/projects/events: `node --watch` for
# live reload on source edits, RunAtLoad + KeepAlive (launchd restarts on any
# exit), plus a watchdog job that probes the port every 30s and kickstarts the
# server if it's down -- recovering the one case --watch + KeepAlive can't:
# when --watch parks after a crash, the process stays alive so KeepAlive never
# restarts it. Logs under ~/.recommend-logs.
#
#   ./service/recommend-service.sh install     # generate plists + bootstrap + start
#   ./service/recommend-service.sh uninstall   # stop + remove plists
#   ./service/recommend-service.sh restart     # kickstart a fresh process
#   ./service/recommend-service.sh status      # launchctl print
#   ./service/recommend-service.sh logs        # tail the log files
set -euo pipefail

LABEL="com.kinowo.recommend"
WATCHDOG_LABEL="com.kinowo.recommend-watchdog"
PORT="${PORT:-9002}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE="$(command -v node || echo /opt/homebrew/bin/node)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
WATCHDOG_PLIST="$HOME/Library/LaunchAgents/$WATCHDOG_LABEL.plist"
WATCHDOG_SH="$DIR/service/recommend-watchdog.sh"
LOGDIR="$HOME/.recommend-logs"
DOMAIN="gui/$(id -u)"

write_plist() {
  mkdir -p "$HOME/Library/LaunchAgents" "$LOGDIR"
  cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>

  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>--watch</string>
    <string>$DIR/src/server.js</string>
  </array>

  <key>WorkingDirectory</key>
  <string>$DIR</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PORT</key>
    <string>$PORT</string>
    <key>PATH</key>
    <string>$(dirname "$NODE"):/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <true/>

  <!-- Don't hammer-restart on a crash loop: wait 10s between respawns. -->
  <key>ThrottleInterval</key>
  <integer>10</integer>

  <key>StandardOutPath</key>
  <string>$LOGDIR/server.out.log</string>

  <key>StandardErrorPath</key>
  <string>$LOGDIR/server.err.log</string>
</dict>
</plist>
PLIST
}

write_watchdog_plist() {
  mkdir -p "$HOME/Library/LaunchAgents" "$LOGDIR"
  chmod +x "$WATCHDOG_SH"
  cat > "$WATCHDOG_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$WATCHDOG_LABEL</string>

  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string>
    <string>$WATCHDOG_SH</string>
  </array>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PORT</key>
    <string>$PORT</string>
  </dict>

  <key>StartInterval</key>
  <integer>30</integer>

  <key>RunAtLoad</key>
  <true/>

  <key>StandardOutPath</key>
  <string>$LOGDIR/watchdog.out.log</string>

  <key>StandardErrorPath</key>
  <string>$LOGDIR/watchdog.err.log</string>
</dict>
</plist>
PLIST
}

case "${1:-}" in
  install)
    write_plist
    write_watchdog_plist
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    launchctl bootout "$DOMAIN/$WATCHDOG_LABEL" 2>/dev/null || true
    launchctl bootstrap "$DOMAIN" "$PLIST"
    launchctl enable "$DOMAIN/$LABEL" 2>/dev/null || true
    launchctl bootstrap "$DOMAIN" "$WATCHDOG_PLIST"
    launchctl enable "$DOMAIN/$WATCHDOG_LABEL" 2>/dev/null || true
    echo "✓ installed & started '$LABEL' (--watch) + watchdog on port $PORT"
    echo "  → http://localhost:$PORT"
    echo "  logs: $LOGDIR/server.{out,err}.log, $LOGDIR/watchdog.{out,err}.log"
    ;;
  uninstall)
    launchctl bootout "$DOMAIN/$WATCHDOG_LABEL" 2>/dev/null || true
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    rm -f "$PLIST" "$WATCHDOG_PLIST"
    echo "✓ uninstalled '$LABEL' + watchdog"
    ;;
  restart)
    launchctl kickstart -k "$DOMAIN/$LABEL"
    echo "✓ restarted '$LABEL'"
    ;;
  status)
    echo "== $LABEL =="
    launchctl print "$DOMAIN/$LABEL" 2>/dev/null | grep -E "state|pid|program|last exit" || echo "not loaded"
    echo "== $WATCHDOG_LABEL =="
    launchctl print "$DOMAIN/$WATCHDOG_LABEL" 2>/dev/null | grep -E "state|pid|program|last exit" || echo "not loaded"
    ;;
  logs)
    tail -n 40 -f "$LOGDIR/server.out.log" "$LOGDIR/server.err.log" \
                  "$LOGDIR/watchdog.out.log" "$LOGDIR/watchdog.err.log"
    ;;
  *)
    echo "usage: $0 {install|uninstall|restart|status|logs}"; exit 1 ;;
esac
