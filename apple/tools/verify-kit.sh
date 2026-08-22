#!/bin/zsh
# apple/tools/verify-kit.sh — TripCheckKit の全テストをログに落として exit code を素通しする。
#
#   apple/tools/verify-kit.sh                 # 既定: --parallel(550 本超を並列で回す)
#   apple/tools/verify-kit.sh --serial        # 1 本ずつ。失敗の出力を落ち着いて読みたいとき
#   apple/tools/verify-kit.sh --filter Golden # そのほかの引数は swift test にそのまま渡る
#
# 並列を既定にするのは、この suite が並列で緑であること自体が検査対象だから —— 実時計に触る
# テストが混ざると機械の忙しさで答えが変わる(`Tests/…/Support/FrozenClock.swift` を参照)。
# `--parallel` / `--no-parallel` を自分で書いたときはその指定を尊重し、こちらからは足さない。
# `--serial` はこのスクリプトの語で、swift test へは渡さない(並列指定を外すだけ = 既定の逐次)。
#
# 出力: ログの末尾 40 行 + `exit=<code> log=<path>`。exit code は swift test のもの。
set -u
cd "$(dirname "$0")/../Packages/TripCheckKit"

typeset -a PARALLEL FORWARDED
PARALLEL=(--parallel)
FORWARDED=()
for arg in "$@"; do
  case "$arg" in
    --serial)                 PARALLEL=() ;;
    --parallel|--no-parallel) PARALLEL=(); FORWARDED+=("$arg") ;;
    *)                        FORWARDED+=("$arg") ;;
  esac
done

LOG=${TMPDIR:-/tmp}/tripcheck-kit-test.log
swift test "${PARALLEL[@]}" "${FORWARDED[@]}" > "$LOG" 2>&1; CODE=$?
tail -40 "$LOG"; echo "exit=$CODE log=$LOG"; exit $CODE
