#!/bin/zsh
# apple/tools/screenshot.sh <name> — 起動中のシミュレータの画面を PNG に落とし、その道を出す。
#
#   apple/tools/screenshot.sh boot
set -u
OUT=${SCRATCHPAD:-/tmp}/tripcheck-$1.png
xcrun simctl io booted screenshot "$OUT" && echo "$OUT"
