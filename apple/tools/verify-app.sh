#!/bin/zsh
# apple/tools/verify-app.sh — `project.yml` から Xcode プロジェクトを起こして iPhone の
# シミュレータ向けに組む。エンジン側は apple/tools/verify-kit.sh の担当。
#
#   apple/tools/verify-app.sh          # 既定: build
#   apple/tools/verify-app.sh test     # 単体テスト(TripCheckTests)と UI テストの両方
#
# DerivedData は `apple/build`(`apple/.gitignore` で無視)。出力はログの抜粋 +
# `exit=<code> log=<path>`。exit code は xcodebuild のもの。
set -u
cd "$(dirname "$0")/.." || exit 1

~/.local/xcodegen/bin/xcodegen generate > /dev/null || exit 1

DEST='platform=iOS Simulator,name=iPhone 17 Pro'
LOG=${TMPDIR:-/tmp}/tripcheck-app-build.log
ACTION=${1:-build}

# `test` のときは的を名指しする。scheme の testTargets と同じ 2 つだが、書いておけば
# 「片方が的から外れたまま緑になる」形にならない —— 名指した的が無ければ xcodebuild が落ちる。
typeset -a EXTRA
EXTRA=()
[[ $ACTION == test ]] && EXTRA=(-only-testing:TripCheckTests -only-testing:TripCheckUITests)

xcodebuild -project TripCheck.xcodeproj -scheme TripCheck -destination "$DEST" -derivedDataPath build "$ACTION" "${EXTRA[@]}" > "$LOG" 2>&1
CODE=$?

grep -E "error:|warning:|BUILD|TEST|Executed" "$LOG" | tail -20
echo "exit=$CODE log=$LOG"
exit $CODE
