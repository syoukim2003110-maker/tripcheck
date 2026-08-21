#!/bin/zsh
# apple/tools/verify-kit.sh — swift test をログに落として exit code を素通しする
set -u
cd "$(dirname "$0")/../Packages/TripCheckKit"
LOG=${TMPDIR:-/tmp}/tripcheck-kit-test.log
swift test "$@" > "$LOG" 2>&1; CODE=$?
tail -40 "$LOG"; echo "exit=$CODE log=$LOG"; exit $CODE
