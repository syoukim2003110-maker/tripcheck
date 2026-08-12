# TripCheck Live UX Handoff v1.1 — 完了報告 (2026-08-12)

対象: `TripCheck_Live_UX_Handoff_v1.1_2026-08-11.zip`
ブランチ: `claude/architecture-v2` (P0 アーキテクチャ改修 `1f6b5ac` の続き)
範囲: `1f6b5ac..HEAD` = 13 コミット / 113 ファイル / +4,848 −877 行

仕様の優先順位は指示どおり **コード構造・責務分離・データフロー = Code Level
Refactor Spec v2.1**、**画面・情報設計・コピー・地図表現・推薦表示・モバイル・
アクセシビリティ = Live UX Handoff v1.1** として扱った。

---

## 1. なぜ「再実装」ではなく「再監査 → ギャップ埋め」になったか

v1.1 の実装は 2026-08-11 のコミット `1fd3eda` / `39634e5` で一度完了扱いに
なっており、その後 P0 のアーキテクチャ改修 (14 コミット) でファイルが全面的に
移動している。まず `git merge-base --is-ancestor` で両コミットが HEAD の祖先で
あることを確認したうえで、**「完了」という記憶を信用せず**、6 エージェントの
敵対的監査を Backlog 68 件 + DoD 22 件 + QA Matrix 54 件 + Copy Deck 44 キーに
対して実施した。

結果、**57 件が PARTIAL / MISSING**。単なるコピー差ではなく、P0 の分割中に
壊れた実挙動も含まれていた:

- 推薦を採用すると **Undo 履歴が丸ごと消えていた**(採用が履歴操作になっていなかった)
- 一部の編集経路が **hard-constraint ガードを迂回**していた
- 推薦の **ランキング権限が AI 側**にあった(コードは AI の並びをそのまま採用)
- gap 推薦の検索が **実ルート形状を見ておらず**、遠回り上限も無かった

## 2. Phase ごとのコミット

| Phase | コミット | 内容 |
| --- | --- | --- |
| Phase 0 (矛盾・不正・欠損・原因分離) | `632a9e2` | 全編集に hard-constraint ガード / 計算上限 (`COMPUTATION_LIMIT`) を「原因1つ・行動1つ」で分離 |
| Phase 2 (Plan / Timeline / Map, 旧P1地図再設計を吸収) | `6204f8e` | timeline ↔ map の hover チャネル (ref 購読・再レンダゼロ)、凡例が線種・ピン種まで説明 |
| Phase 1 (Start / Resolve) | `5f4e64e` | 初回描画前のロケール確定、en のラベル幅、Resolve 行の削除 |
| Phase 1 (Build) | `725207b` | ビルド 3 ステージを Copy Deck 逐語で表示、ホテルを待たない |
| Phase 2 (Plan) | `7d20b0a` | 2 数字の日ヘッダー、旅程統計行、実タブ化した day rail |
| Phase 3 (推薦) | `be2e255` | 推薦採用を Undo 可能な一級の履歴操作へ |
| Phase 3 (推薦) | `eeea551` | 決定論コードが base/lead を選び、AI はラベル生成のみ |
| Phase 3 / コピー | `47cbe20` | パネルの情報密度、専門語の禁止 (banned-terms テスト) |
| Phase 3 / 法域 | `4803543` | プライバシーページを実態に合わせて 4 行で要約、越境・時差・フェリー警告 |
| Phase 4 (a11y / QA) | `e641940` | QA ハーネス 16 → 32 項目 (320px リフロー・キーボードのみ・44px) |
| 検証 | `972e6e8` | 凡例クリップ修正、privacy チップを Copy Deck 逐語へ、VR ベースライン整理 |
| Phase 4 (モバイル, 旧P1モバイル改善を吸収) | `fcca1b2` | モバイルで 2 地点目が折り返し上に収まる、DoD 初見・200% ズーム検査 (38 項目) |
| 検証 | `04c6a2b` | stale レスポンス防止 (build generation) の契約テスト |

## 3. 全テスト結果 (2026-08-12 最終)

| 検査 | 結果 |
| --- | --- |
| `tsc --noEmit` | 0 エラー |
| `vinext build` | 成功 (`npm run build` は scratchpad の npm が壊れているため `./node_modules/.bin/vinext build` を使用) |
| `node --experimental-strip-types --test tests/*.test.ts` | 569 / 569 |
| `node --test tests/*.mjs` | 10 / 10 |
| E2E (`tools/qa/run-e2e.mjs`) | 38 / 38 |
| axe WCAG 2.2 AA (`run-axe.mjs`) | 違反 0 (`.planner-route-status` の contrast 1 件は半透明背景による "incomplete"。最悪条件 = 地図が真っ黒でも実効背景 #E6E6E6 に対し **8.5:1** で手動合格) |
| VR (`run-vr.mjs`) | 24 / 24 一致 |
| eslint (`--ignore-pattern dist`) | 12 error / 2 warning — **`b1eee1e` 時点と同一**。今回の作業で増減なし (React Compiler の setState-in-effect 系、既存の負債) |
| privacy 契約テスト | 8 / 8 (面全体スキャン方式を弱体化していない) |
| hard constraint 回帰 | `planner-guarded-edits` + E2E QA-036 で緑 |

## 4. VR ベースラインの扱い

一括更新はしていない。手順は以下のとおり。

1. 変更前の 24 枚を `tests/vr/archive/2026-08-11-pre-gapfix/` へ退避 (README 付き)。
   `run-vr.mjs` は `tests/vr/baselines/` しか読まないので、退避分は回帰資料として
   純粋に保管される。
2. pixelmatch で **旧 → 新の差分を画面ごとに数値化**し、変更行バンドと
   バウンディングボックスを出して「意図した変更」と「偶発差分」を切り分けた。
3. 差分領域を旧・新で並べて目視し、仕様 / プロトタイプ HTML / 同梱 PNG と一致した
   画面だけ承認した。Desktop (1440) と Mobile (390) の両方、ja / en 双方を確認。

| 画面 | 変更 | 判定 |
| --- | --- | --- |
| `start-{ja,en}-{768,390}` | 差分 0px | 変更なし |
| `start-{ja,en}-1440` | privacy チップが Copy Deck の文へ | 意図した変更 |
| `resolve-*` (6枚) | 行ごとの「外す」、ロケール別ラベル、断定を避けたコピー | 意図した変更 |
| `plan-*` (6枚) | 旅程統計行 / 「確認したいこと N」/ 1 行 day rail / 2 数字の日ヘッダー / timeline 内推薦行 | 意図した変更 |
| `detail-*` (6枚) | 最終入場・日を移動、正直な失敗表示、モバイル sheet の 3 状態 | 意図した変更 |
| `plan-*-1440`, `detail-*-1440` | 地図凡例が最後のキーまで表示 (430px → 560px) | 意図した変更 (バグ修正) |
| `plan-*-{768,390}`, `detail-*-{768,390}` | 地図プレビュー帯 20dvh → 15dvh | 意図した変更 (DoD 対応) |

## 5. Definition of Done 監査 (22 項目)

### Start

| 項目 | 判定 | 根拠 |
| --- | --- | --- |
| 必須判断は場所と日数だけ | ✅ | `PlacesStep.tsx` — textarea + 日数のみが必須 |
| 国・日付・モードは既定で隠れている | ✅ | `PlacesStep.tsx:257,282` いずれも既定で閉じた `<details>` |
| 空の地図を表示しない | ✅ | `is-places` は sheet 100dvh で地図面を出さない (`planner.css:1723`) |
| CTA が 1280×800 と 390×844 で見える | ✅ | E2E `DoD-START-4` ×2 (新規) |
| サンプル・モード・CTA がキーボード操作可能 | ✅ | E2E `QA-042` 6 項目 |

### Plan

| 項目 | 判定 | 根拠 |
| --- | --- | --- |
| 最初の 2 地点がファーストビューに見える | ✅ | E2E `DoD-PLAN-1` ×2 (新規)。モバイルは `fcca1b2` で 21px 不足を解消 |
| route line が全日表示される | ✅ | `planner-map-model.test.ts`「multi-day layers…」 |
| route 欠損時に破線が表示される | ✅ | 同テスト「no route evidence → dashed spans」 |
| 時刻表示の単一 source of truth | ✅ | コンポーネント側に時刻整形コードなし (`toLocaleTimeString` 等 0 件) |
| 予約・Must・空港違反 0 件 | ✅ | `evaluatePlannerHardEdit` + `planner-guarded-edits.test.ts` + E2E `QA-036` |
| hotel / meal / gap が Timeline へ統合 | ✅ | VR の timeline に食事枠・ホテル行が出ている |
| 推薦がユーザー入力と見た目で区別される | ✅ | 破線 + 紫の推薦枠 (VR) |
| Undo が直近 10 操作で動く | ✅ | `PLANNER_UNDO_LIMIT = 10` + 単体テスト |

### Accessibility

| 項目 | 判定 | 根拠 |
| --- | --- | --- |
| WCAG 2.2 AA automated scan で重大 0 件 | ✅ | axe クリーン (上記 contrast 1 件は手動合格) |
| keyboard-only で主要フロー完了 | ✅ | E2E `QA-042` (Start → build → day tabs → 推薦採用 → 共有ダイアログ) |
| 200% zoom で機能欠損なし | ✅ | E2E `DoD-A11Y-3` ×2 (新規、640×400@dPR2 でモデル化) |
| 320px 幅で横スクロールなし | ✅ | E2E `DoD-A11Y-4` ×3 |
| screen reader で Day / stop / recommendation の関係が分かる | ✅ | `role="tablist"` + `aria-selected` + `aria-controls` → `<ol class="planner-timeline">`、`aria-live` polite/assertive |

### Reliability

| 項目 | 判定 | 根拠 |
| --- | --- | --- |
| API 失敗でも provisional plan 利用可能 | ✅ | VR の食事枠が「取得できませんでした・再試行」で旅程は使用可 |
| provider timeout で画面全体をブロックしない | ✅ | ビルド 3 ステージがプロバイダを待たない (`725207b`) |
| stale result を通常結果に見せない | ✅ | `buildRunRef` 世代ガード + `stale-response-guard.test.ts` (`04c6a2b`) |
| error ID をログに出し、旅程本文はログに出さない | ✅ | `privacy-contract.test.mjs` 8/8 |

## 6. 未実装 / 実装しない項目 (正直ベース)

| ID | 状態 | 理由 |
| --- | --- | --- |
| TC-064 週次プロダクトダッシュボード | 未実装 | `app/api/product-events/route.ts` は `console.info` のみでイベントストアがリポジトリ内に存在しない。保存先の決定はインフラ側の判断が要る |
| TC-067 実機ブラウザマトリクス | 実施不可 | 実機 6 ブラウザが必要。ヘッドレス Chrome の VR / axe / E2E で代替している |
| TC-041 ホテルの価格バランス軸 | 意図的に除外 | 楽天の参考最低価格は日付なしのため、「価格バランスが最良」と順位付けすると事実と異なる表示になる |
| QA-021 の `aria-current` | 意図的に非採用 | 仕様 §12.3「Day 切替は Tab semantics」に従い `role="tab"` + `aria-selected` を使用。tab パターンでは `aria-current` は重複になる |

## 7. 既知の制約

- **地図キャンバスの直 fetch**: `app/PlannerGoogleMap.tsx` は `/api/live-routes` を
  直接呼ぶ (P0 時点からの状態)。`app/components/planner/**` 側に直呼びは 0 件で、
  `trip-request-identity.test.ts` がこの 1 箇所を明示的にピン留めしている。
  hooks への移設は P0 境界の再設計になるため今回は行っていない。
- **地図が空白に見える**: `GOOGLE_MAPS_BROWSER_API_KEY` の HTTP リファラ制限に
  `*.trycloudflare.com` が無いため、トンネル経由では地図タイルが出ない。コード側の
  問題ではない (Google Cloud Console でリファラ追加が必要)。
- **cloudflared quick tunnel は半日〜1日で切れる**。張り替え時は `.dev.vars` の
  `TRIPCHECK_PUBLIC_ORIGIN` と `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS` を同時に
  更新しないと、有料エンドポイントが 403 になる。
- **eslint 12 error は既存**。React Compiler 系の指摘で、今回の作業では増えていない。

## 8. 旧 P1 の吸収先

| 旧 P1 項目 | 吸収先 |
| --- | --- |
| UI Component Library 化 | 各画面の実装時に部品化。`app/components/planner/{start,timeline,summary,recommendation,map,inspector,states,dialogs}/` として実体化済み。コピーは `lib/presentation/planner-copy.ts` の ja/en 表に一元化 |
| Map 再設計 | Phase 2 (`6204f8e`, `972e6e8`) — hover チャネル、凡例、線種、モバイルのプレビュー帯 |
| Mobile 改善 | Phase 4 (`e641940`, `fcca1b2`) — 320px リフロー、44px、bottom sheet 3 状態、ファーストビュー |

旧 P1 を独立した作業として先に実施しておらず、完了後に再実施もしていない。

## 9. 旧 P2

**未着手**。Animation / 高度なパーソナライズは明示指示があるまで着手しない方針の
とおり、コード・仕様のいずれにも手を入れていない。
