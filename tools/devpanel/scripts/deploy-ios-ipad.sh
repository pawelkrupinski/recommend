#!/usr/bin/env bash
# Thin wrapper: build/sign/install/launch Filmowo on a cabled iPad.
# See deploy-ios.sh (the shared implementation).
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/deploy-ios.sh" ipad
