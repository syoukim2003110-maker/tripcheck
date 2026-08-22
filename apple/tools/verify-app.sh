#!/bin/zsh
# apple/tools/verify-app.sh — `project.yml` から Xcode プロジェクトを起こして iPhone の
# シミュレータ向けに組む。エンジン側は apple/tools/verify-kit.sh の担当。
#
#   apple/tools/verify-app.sh          # 既定: build
#   apple/tools/verify-app.sh test     # UI テストまで走らせる
#
# DerivedData は `apple/build`(`apple/.gitignore` で無視)。出力はログの抜粋 +
# `exit=<code> log=<path>`。exit code は xcodebuild のもの。
set -u
cd "$(dirname "$0")/.." || exit 1

~/.local/xcodegen/bin/xcodegen generate > /dev/null || exit 1

DEST='platform=iOS Simulator,name=iPhone 17 Pro'
LOG=${TMPDIR:-/tmp}/tripcheck-app-build.log
ACTION=${1:-build}

xcodebuild -project TripCheck.xcodeproj -scheme TripCheck -destination "$DEST" -derivedDataPath build "$ACTION" > "$LOG" 2>&1
CODE=$?

grep -E "error:|warning:|BUILD|TEST" "$LOG" | tail -20
echo "exit=$CODE log=$LOG"
exit $CODE
