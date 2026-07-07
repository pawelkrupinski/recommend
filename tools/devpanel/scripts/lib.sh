# Shared helpers for the DevPanel action scripts.
# Sourced (not executed) by each script; expects SCRIPT_DIR to be set first.

# A GUI-launched .app inherits a minimal PATH (no Homebrew, no Android SDK, maybe
# no node), so adb / gradle / npm aren't found the way they are in a terminal.
# Append the usual dev-tool locations (existing dirs not already on PATH).
_devpanel_extra_paths=(/opt/homebrew/bin /usr/local/bin "$HOME/Library/Android/sdk/platform-tools")
[[ -n "${ANDROID_HOME:-}" ]] && _devpanel_extra_paths+=("$ANDROID_HOME/platform-tools")
[[ -n "${ANDROID_SDK_ROOT:-}" ]] && _devpanel_extra_paths+=("$ANDROID_SDK_ROOT/platform-tools")
for _p in "${_devpanel_extra_paths[@]}"; do
  [[ -d "$_p" && ":$PATH:" != *":$_p:"* ]] && PATH="$PATH:$_p"
done
export PATH

# Repo root: a worktree path the panel passes via DEVPANEL_REPO_ROOT (the
# long-press "run on worktree" menu), else three levels up from this script.
REPO_ROOT="${DEVPANEL_REPO_ROOT:-$(cd "$SCRIPT_DIR/../../.." && pwd)}"

# step <cmd...> — announce and run one command. DEVPANEL_PRINT_ONLY=1 prints the
# command instead of running it (test.sh asserts on those lines).
step() {
  if [[ "${DEVPANEL_PRINT_ONLY:-}" == "1" ]]; then
    printf '%s\n' "$*"
    return 0
  fi
  printf '\n\033[1m▶ %s\033[0m\n' "$*"
  "$@"
}

# dispatch <workdir> <label> <cmd...> — cd into <workdir> and `exec` a
# long-running command (server/gradle) so it owns the console's subprocess.
# DEVPANEL_PRINT_ONLY=1 prints `cd <dir> && <cmd>` and returns.
dispatch() {
  local workdir="$1"; shift
  local label="$1"; shift
  if [[ "${DEVPANEL_PRINT_ONLY:-}" == "1" ]]; then
    printf 'cd %s && %s\n' "$workdir" "$*"
    return 0
  fi
  printf '\033[1m▶ %s\033[0m\n' "$label"
  printf '  dir: %s\n  cmd: %s\n\n' "$workdir" "$*"
  cd "$workdir"
  exec "$@"
}

# resolve_adb — echo a usable adb path, or nothing. Order: $DEVPANEL_ADB, an adb
# on PATH, the SDK from android/local.properties' sdk.dir, then default locations.
resolve_adb() {
  if [[ -n "${DEVPANEL_ADB:-}" ]]; then echo "$DEVPANEL_ADB"; return 0; fi
  command -v adb 2>/dev/null && return 0
  local sdk cand
  sdk="$(sed -n 's/^sdk\.dir=//p' "$REPO_ROOT/android/local.properties" 2>/dev/null | head -1)"
  for cand in "$sdk/platform-tools/adb" "${ANDROID_HOME:-}/platform-tools/adb" \
              "${ANDROID_SDK_ROOT:-}/platform-tools/adb" "$HOME/Library/Android/sdk/platform-tools/adb"; do
    [[ -n "$cand" && -x "$cand" ]] && { echo "$cand"; return 0; }
  done
  return 0
}

# android_serial — echo the device serial to target. $DEVPANEL_ANDROID_SERIAL
# wins; else the single attached device; else the first of several (noting so to
# stderr). Empty if adb missing / no device.
android_serial() {
  [[ -n "${DEVPANEL_ANDROID_SERIAL:-}" ]] && { echo "$DEVPANEL_ANDROID_SERIAL"; return 0; }
  local adb; adb="$(resolve_adb)"
  command -v "$adb" >/dev/null 2>&1 || return 0
  local serials n
  serials="$("$adb" devices 2>/dev/null | awk '$2=="device"{print $1}')"
  n="$(printf '%s\n' "$serials" | grep -c .)"
  if [[ "$n" -gt 1 ]]; then
    echo "  multiple devices attached: $(echo $serials) — using the first; set DEVPANEL_ANDROID_SERIAL to pick" >&2
    printf '%s\n' "$serials" | head -1
  elif [[ "$n" -eq 1 ]]; then
    printf '%s\n' "$serials"
  fi
}

# android_device_state [serial] — echo the adb connection state of the target:
# "device" (ready), "unauthorized", "offline", or empty when none is attached.
android_device_state() {
  local serial="${1:-}" adb; adb="$(resolve_adb)"
  { [[ -z "$adb" ]] || ! command -v "$adb" >/dev/null 2>&1; } && return 0
  "$adb" devices 2>/dev/null | awk -v s="$serial" '
    NR==1 { next }
    NF < 2 { next }
    s != "" { if ($1 == s) { print $2; exit } next }
    { print $2; exit }
  '
}

# wait_for_android_unlock [serial] — block until the cabled device is authorized
# AND its keyguard is dismissed. A plugged-in phone that hasn't accepted the
# "Allow USB debugging" prompt sits in "unauthorized" (and `adb wait-for-device`
# would hang silently), so we poll the state ourselves and tell the user what to
# do. If no lock flag is exposed, we degrade to "assume unlocked" rather than
# hang. No-op under DEVPANEL_PRINT_ONLY.
wait_for_android_unlock() {
  [[ "${DEVPANEL_PRINT_ONLY:-}" == "1" ]] && { echo "wait_for_android_unlock"; return 0; }
  local serial="${1:-}" adb
  adb="$(resolve_adb)"
  if [[ -z "$adb" ]] || ! command -v "$adb" >/dev/null 2>&1; then
    echo "  (adb not found — skipping unlock wait; set DEVPANEL_ADB or ANDROID_HOME)"
    return 0
  fi

  local state announced_state=
  while :; do
    state="$(android_device_state "$serial")"
    [[ "$state" == device ]] && { [[ -n "$announced_state" ]] && echo "  device ready."; break; }
    case "$state" in
      unauthorized) [[ "$announced_state" != unauthorized ]] && \
        echo "🔒 Android device is unauthorized — accept the “Allow USB debugging” prompt on the device…" ;;
      offline)      [[ "$announced_state" != offline ]] && \
        echo "⏳ Android device is offline — reconnecting…" ;;
      *)            [[ "$announced_state" != absent ]] && \
        echo "🔌 waiting for an Android device to be attached…" ;;
    esac
    announced_state="${state:-absent}"
    sleep 2
  done

  local s=""; [[ -n "$serial" ]] && s="-s $serial"
  local announced= win lock
  while :; do
    win="$("$adb" $s shell dumpsys window 2>/dev/null)"
    lock="$(printf '%s' "$win" | grep -oE 'mDreamingLockscreen=(true|false)' | head -1)"
    [[ -z "$lock" ]] && lock="$(printf '%s' "$win" | grep -oE 'mKeyguardShowing=(true|false)' | head -1)"
    case "$lock" in
      *=false|"") [[ -n "$announced" ]] && echo "  unlocked."; return 0 ;;
    esac
    if [[ -z "$announced" ]]; then echo "🔒 waiting for Android unlock…"; announced=1; fi
    sleep 2
  done
}

# ---- iOS (cabled iPhone/iPad) helpers ------------------------------------

# ios_team — echo the DEVELOPMENT_TEAM id to sign device builds with.
# $FILMOWO_DEV_TEAM wins; else the team (cert OU) of the first "Apple
# Development" codesigning identity in the login keychain. Empty if none.
ios_team() {
  [[ -n "${FILMOWO_DEV_TEAM:-}" ]] && { echo "$FILMOWO_DEV_TEAM"; return 0; }
  local name
  name="$(security find-identity -v -p codesigning 2>/dev/null \
          | grep -m1 'Apple Development' | sed -E 's/.*"([^"]+)".*/\1/')"
  [[ -z "$name" ]] && return 0
  security find-certificate -c "$name" -p 2>/dev/null \
    | openssl x509 -noout -subject -nameopt multiline 2>/dev/null \
    | sed -n 's/^ *organizationalUnitName *= *//p' | head -1
}

# ios_devices — print "udid<TAB>type<TAB>transport<TAB>name" for every available
# iOS device (iPhone or iPad) paired via `xcrun devicectl`. transport is "wired"
# (USB cable) or "localNetwork" (wireless).
ios_devices() {
  local tmp; tmp="$(mktemp)"
  if ! xcrun devicectl list devices --json-output "$tmp" >/dev/null 2>&1; then
    rm -f "$tmp"; return 0
  fi
  /usr/bin/python3 - "$tmp" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
for d in data.get("result", {}).get("devices", []):
    hw = d.get("hardwareProperties", {})
    if hw.get("platform") == "iOS" and hw.get("udid"):
        cp = d.get("connectionProperties", {})
        name = d.get("deviceProperties", {}).get("name", "?")
        print("\t".join([hw["udid"], hw.get("deviceType", "?"),
                         cp.get("transportType", "?"), name]))
PY
  rm -f "$tmp"
}

# _ios_pick — read "udid<TAB>type<TAB>transport<TAB>name" lines on stdin and echo
# the UDID to target: prefer a wired (cabled) device over a wireless one — you
# plug a device in to deploy to it — then the first of whichever set. Pure (no
# devicectl, no stderr); the messaging lives in ios_udid.
_ios_pick() {
  local all wired; all="$(cat)"; [[ -z "$all" ]] && return 0
  wired="$(printf '%s\n' "$all" | awk -F'\t' '$3 == "wired"')"
  printf '%s\n' "${wired:-$all}" | head -1 | cut -f1
}

# ios_udid — echo the UDID of the iOS device to deploy to. $FILMOWO_IOS_UDID
# wins; else prefer a cabled device over a wireless one (via _ios_pick), taking
# the first of several and listing the rest (with transport) to stderr. Empty
# when none is attached.
ios_udid() {
  [[ -n "${FILMOWO_IOS_UDID:-}" ]] && { echo "$FILMOWO_IOS_UDID"; return 0; }
  local all wired chosen; all="$(ios_devices)"; [[ -z "$all" ]] && return 0
  wired="$(printf '%s\n' "$all" | awk -F'\t' '$3 == "wired"')"
  chosen="${wired:-$all}"
  [[ -z "$wired" ]] && \
    echo "  no cabled iOS device — using a wireless one (deploying over the network)." >&2
  if [[ "$(printf '%s\n' "$chosen" | grep -c .)" -gt 1 ]]; then
    { echo "  multiple iOS devices attached:"
      printf '%s\n' "$chosen" | awk -F'\t' '{print "    · "$4" ("$2", "$3")"}'
      echo "    using the first — set FILMOWO_IOS_UDID to pick a specific one."; } >&2
  fi
  printf '%s\n' "$all" | _ios_pick
}

# ios_device_name <udid> — a friendly "name (type, transport)" for logging.
ios_device_name() {
  ios_devices | awk -F'\t' -v u="$1" '$1==u{print $4" ("$2", "$3")"; f=1} END{if(!f)print u}'
}
