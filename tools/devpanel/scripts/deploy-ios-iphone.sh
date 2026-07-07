#!/usr/bin/env bash
# Thin wrapper: build/sign/install/launch Filmowo on a cabled iPhone.
# All logic lives in deploy-ios.sh; this just fixes the target kind so the
# DevPanel (which runs a single bare script per button) can offer it as a button.
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/deploy-ios.sh" iphone
