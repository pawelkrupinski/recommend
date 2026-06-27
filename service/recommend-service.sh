#!/usr/bin/env bash
# Manage the `recommend` app as a macOS launchd service.
# Mirrors the resilience pattern from ~/projects/events: RunAtLoad + KeepAlive
# (launchd restarts on any exit), logs under ~/.recommend-logs.
#
#   ./service/recommend-service.sh install     # generate plist + bootstrap + start
#   ./service/recommend-service.sh uninstall   # stop + remove plist
#   ./service/recommend-service.sh restart     # kickstart a fresh process
#   ./service/recommend-service.sh status      # launchctl print
#   ./service/recommend-service.sh logs        # tail the log files
set -euo pipefail

LABEL="com.kinowo.recommend"
PORT="${PORT:-9002}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE="$(command -v node || echo /opt/homebrew/bin/node)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
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

case "${1:-}" in
  install)
    write_plist
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    launchctl bootstrap "$DOMAIN" "$PLIST"
    launchctl enable "$DOMAIN/$LABEL" 2>/dev/null || true
    echo "✓ installed & started '$LABEL' on port $PORT"
    echo "  → http://localhost:$PORT"
    echo "  logs: $LOGDIR/server.{out,err}.log"
    ;;
  uninstall)
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"
    echo "✓ uninstalled '$LABEL'"
    ;;
  restart)
    launchctl kickstart -k "$DOMAIN/$LABEL"
    echo "✓ restarted '$LABEL'"
    ;;
  status)
    launchctl print "$DOMAIN/$LABEL" 2>/dev/null | grep -E "state|pid|program|last exit" || echo "not loaded"
    ;;
  logs)
    tail -n 40 -f "$LOGDIR/server.out.log" "$LOGDIR/server.err.log"
    ;;
  *)
    echo "usage: $0 {install|uninstall|restart|status|logs}"; exit 1 ;;
esac
