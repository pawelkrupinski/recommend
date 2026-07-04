#!/usr/bin/env bash
# Start the local dev server (node --watch) with dev-login enabled so the Android
# app's sign-in / exchange work locally. Long-running — Stop in the panel to kill.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"
export ALLOW_DEV_LOGIN=1
dispatch "$REPO_ROOT" "Dev server (npm run dev)" npm run dev
