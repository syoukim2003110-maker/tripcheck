# TripCheck 機能不全の根本原因と修正 (2026-08-10)

対象: v0.3仕様実装後に「機能が全くうまく動いていない」と報告された本番不具合一式。
本レポートは (1) 症状→根本原因、(2) 実施した修正、(3) 検証結果、(4) **本番反映に必要な作業(Codex/運用者向け)**、(5) 残課題 をまとめる。すべての変更は `claude/critique-fixes-1` に**未コミット**で置いてある(AGENTS.md の方針どおり)。

---

## 1. 症状 → 根本原因

スイスデモ(8か所・4日)で本番を再現し、6エージェント並列診断+実測で全症状の機構を特定した。

| # | 症状(スクショ) | 根本原因 |
|---|---|---|
| A | 昼食・夕食・ホテル・ルート候補が全部「取得できませんでした」 | **本番D1の quota テーブルが旧スキーマ**。`operation` の CHECK 制約が旧4オペレーション(live_routes / place_resolution / place_intelligence / fresh_voices)しか許さず、v0.3 で追加した food/hotel/route の予約が全て「check constraint failed」→ `budget_exhausted` に誤分類され **429 を永久に返す**(`CREATE TABLE IF NOT EXISTS` は移行しない)。ブラウザ実測で `429 {"code":"budget_exhausted"}` Retry-After 86400 を確認。 |
| B | live-routes も大半 429 | A と同じ誤分類に加え、**旧クォータが小さすぎた**: live_routes は「1トリップ20ユニット」= 初回ビルド1回でほぼ枯渇。以後のビルドは全部 429。 |
| C | スイス都市間が全部タクシー(80分/105分等) | 3重の機構: (1) 直線距離ベースの transit 推定が 40–70km 帯で車に不利+固定「+10分」許容 → 推定だけでタクシー化 (2) 「日付未定」だと収束処理が **プリフェッチ済みの transit 実測を消去**(driving は残る)→ live タクシー vs 推定電車の不公平比較 (3) 収束処理は「既に transit 推奨の区間」しか計測しない **catch-22** で電車が永遠に未計測。 |
| D | 2日目が空・別の日にベルン→ルツェルンを詰め込み(全解決後は 0/4/4/0) | `scoreDayAssignment` の travelMinutes に**非空日のホテル往復が含まれる**ため、日を空にするとその往復コストが丸ごと消え「詰め込み案」が勝つ。ペース上限(件数/時間)は最適化**前**にしか適用されず、最適化が上限超えの日を自由に作れた。 |
| E | 11:45の昼食枠が13:01到着の行の下に表示/9時台で終わる日に18:00夕食枠 | 昼食アンカーは「昼窓中点に最も近い到着」で選ばれ(13:01が勝つ)、表示時刻は**静的な窓開始(11:45)**。行の位置はアンカーID基準で時刻を見ない。日のゲートも「日の開始/締切」基準で実スケジュールを見ない。 |
| F | 「ベルン旧市街」→「ベルン大学」/ゴルナーグラートが「地図に出せなかった場所・1」 | ja入力に**英語サフィックス**を付けて検索(「ベルン旧市街 Switzerland」→ Google が大学を単独返答)+単独候補は無検証採用。ゴルナーグラートは「ゴルナーグラート鉄道」が部分一致するため曖昧扱い→ユーザーが選ぶまで **unknownEntries に消え**、判定も永久保留。 |
| G | 「判定保留・未確認13件」が動かない | 未解決1件で最短日数探索を**丸ごとスキップ**(部分判定の文言 `fitIncomplete` は実装済みだが未配線のデッドコード)。バナーは実際の原因(未解決の場所名)を言わず3択の定型文。 |

## 2. 実施した修正

### 2.1 クォータ/インフラ(症状A/B)
- `db/provider-quota-schema.ts`: operation CHECK を全8オペレーションに更新。オペレーション一覧を `PROVIDER_QUOTA_OPERATIONS` として輸出し、スキーマと突合可能に。**ランタイム移行**(`PROVIDER_QUOTA_MIGRATION_SQL`: RENAME→CREATE→INSERT SELECT→DROP を1つのD1バッチ=トランザクション)を追加。
- `lib/server/durable-provider-quota.ts`: `initializeDurableProviderQuotaSchema` が sqlite_master を検査し、旧CHECKのテーブルを自動移行(カウンタは保持)。**デプロイするだけで本番D1が自己修復**する。
- クォータ再設計(`durable-provider-quota.ts` + `provider-gateway.ts` を同期): live_routes trip 20→120 / sessionDay 60→360、place_resolution 12→36/36→108、place_intelligence 10→30/30→90、hotel 20→60/60→180、food 56→112/112→336、route 42→84/84→168・day 75→300・month 2250→9000。グローバル day/month はコスト防壁としてほぼ据え置き。デプロイ後は既存カウンタ行の hard_limit も次回予約時に自動更新される。
- `lib/{food,hotel,route}-recommendations-client.ts`: `X-TripCheck-Trip` ヘッダを送信(従来は4時間バケット共有で枯渇を加速)。
- 429 を UI で正直に表示: `PlaceResolutionError`/`FoodRecommendationsError`/`HotelRecommendationsError` に `quota_exhausted` コードを追加し、食事枠は「候補取得が本日の上限に達しました」、場所解決は「本日の場所検索の上限に達しました…」と表示。

### 2.2 移動手段(症状C)
- `lib/time-feasibility.ts`: transit_first の許容を比例式 `max(10, 25% of taxi)`(balanced は `max(5,10%)`)に。さらに**非対称証拠ガード**: transit_first で「liveタクシー vs 未計測の電車推定」の場合は電車を維持(計測されたら実数で決着)。
- `lib/planning-live-routes-client.ts`: 収束対象を「transit推奨」+「**タクシー推奨だが電車が有力な区間**(transit_first・4km以上)」に拡張 → catch-22 解消。プリフェッチは**バッチ単位で失敗を隔離**(1バッチの502が全計測を無駄にしない)。
- `app/TripPlannerApp.tsx`: プリフェッチ計測の transit を `prefetchTransit` として分離保持し、収束処理のリセットで消されないように(`liveTransitMinutes = {...prefetchTransit, ...liveTransit}`)。

### 2.3 日割り(症状D)
- `lib/trip-builder.ts`: `DayAssignmentScore` に **emptyDayCount**(件数≥日数のときの空日)と **overloadMinutes**(ペース件数超過×240分+時間予算超過)を travelMinutes より上位に挿入。移動系候補生成に**ペース件数の上限ガード**。最適化後にも時間予算トリム(`trimClustersToDayBudget`)を再適用。

### 2.4 食事枠(症状E)
- `lib/trip-builder.ts` `buildFoodRecommendationSlots`: 実スケジュール基準のゲート(昼=行程が昼窓に重なる時のみ/夕=終了が夕方に届く時のみ)。昼アンカー=「昼窓終了までに到着している最後の場所」。**スケジュール連動の `displayTime`** を追加(probeTime も同値)。
- `app/TripPlannerApp.tsx` `mealRowsAfter`: 枠の行を**時刻順で挿入**(その時刻までに到着済みの最後の行の直後)。取得失敗時は見出しも「〜を取得できませんでした」+「再試行」ボタンに(「確認中」のまま固まらない)。採用時の行時刻・検証も displayTime 基準に(開始が窓内ならOK)。空日のタブは「予定なし」表示。

### 2.5 場所解決(症状F)
- `lib/destinations.ts` `destinationPlaceQuery`: **jaクエリには日本語の国名サフィックス**(「ベルン旧市街 スイス」→ ベルン大聖堂が返る。実API検証済み)。resolver/place-intelligence/hotel検索の呼び出しも languageCode 連動に。
- `lib/google-place-resolver.ts`: **完全一致候補の自動採用**(「ゴルナーグラート」は自身の「〜鉄道」に邪魔されず山頂を自動選択)+**単独候補の妥当性ゲート**(名前の重なりが無く、university/school/hospital等の非観光タイプなら自動採用せずユーザー確認へ)。

### 2.6 判定(症状G)
- `lib/trip-scenarios.ts`: 未解決があっても解決済みサブセットで探索し `partialMinimumDays` として返す(確定判定 `minimumDays` とは別枠、状態は UNKNOWN のまま=不確実性を隠さない)。
- `lib/feasibility-result.ts`: `partialMinimumDays` と `unresolvedPlaceNames` を公開。
- `app/TripPlannerApp.tsx` `minimumDaysCopy`: 実際の原因を名指し(「『ゴルナーグラート』が未確定のため保留。確定済みの場所だけなら最短2日」)。結果画面の場所警告の**反転バグ修正**(未解決がある時こそ理由を表示)。

### 2.7 その他
- `app/PlannerGoogleMap.tsx`: fitBounds 後のズームを16にクランプ(ホテルと停留地が数十mの日に真っ白な超拡大になるのを防止)。
- `.env.example` のroute上限コメント更新、`.gitignore` に `.dev.vars` を追加。ローカル `.env` に `TRIPCHECK_QUOTA_HASH_SECRET`(必須だった未設定項目)と `TRIPCHECK_PUBLIC_ORIGIN=http://localhost:3000` を追記。

## 3. 検証

- **静的**: tsc クリーン / eslint クリーン / golden feasibility 500シナリオ一致。
- **テスト**: TS 490本 + mjs 11本 **全て成功**(レビュー修正込みの最終値)(新規テスト: スイス日割り不変条件、transit_firstの都市間+非対称ガード、resolver完全一致/非観光ゲート/jaサフィックス、D1スキーマ移行、収束対象の拡張)。
- **ローカルe2e**(`vinext dev` :8788 + 実Googleキー + **旧スキーマのローカルD1**): スキーマ移行が実際に走り、スイスデモ4日が
  - 判定「4日案は確認が必要・最短2日」(保留から前進)
  - 日割り 1/2/2/3(空日ゼロ、地理的にまとまった構成)
  - ツェルマット→ゴルナーグラート**電車35分**、ベルン方面の日は全区間電車(ルツェルン方面のタクシーは live 実測で車が速い正当な選択)
  - 昼食・夕食候補が**実データで時刻順に表示**(Glacier Alpine Kitchen 13:10 等)
  - 「ベルン旧市街」→**ベルン大聖堂**、ゴルナーグラートは自動確定
  - API: live-routes/food/hotel 全て 200、quota残数ヘッダも新上限
  で完走。

## 4. 本番反映(Codex / 運用者がやること)

1. **この差分をデプロイする(必須)** — D1スキーマ移行は初回リクエスト時に自動実行され、food/hotel/route の永久429が解消する。カウンタは保持され、新しい hard_limit も自動反映。手動のD1操作は不要。
2. **本番の環境変数を確認**(プラットフォーム側の設定UI):
   - `TRIPCHECK_QUOTA_HASH_SECRET`(≥32文字)— 本番は現在有効(durable動作をヘッダで確認済み)。ローテーションすると全サブジェクトハッシュが変わり実質リセットになる点に注意。
   - `GOOGLE_PLACES_API_KEY` — 設定済み(live-routesはPLACESキーへのフォールバックで動作)。`GOOGLE_ROUTES_API_KEY` は空でも可。
   - `TRIPCHECK_PUBLIC_ORIGIN=https://tripcheck-japan-tokyo.syoki.chatgpt.site` を明示設定推奨(プロキシ配下でのOrigin照合を安定させる)。
   - **`ANTHROPIC_BASE_URL` が `http://127.0.0.1:8791` のままなら本番では無効**。本番でAI補助(fresh voices / food ranking)を使うなら実APIキー+`ANTHROPIC_REQUESTS_ENABLED=true`、使わないなら未設定でよい(UIは自動で落ちる設計)。
3. デプロイ直後に本番でスイスデモを1回流し、Network タブで `/api/food-recommendations` が **200** かつ `x-tripcheck-quota-remaining-trip` が新上限(110前後)で返ることを確認。
4. 注意: 既存トリップの「trip」スコープカウンタ(bucket=all)は永続するが、新上限が大きいため実害なし。

## 4.5 敵対的レビューでの追加修正(同日)

修正一式に対し3レンズ(正しさ/quota・プライバシー/UI・仕様)の敵対的レビュー+反証検証を実施し、**確定した回帰2件**を修正済み:

1. **移動ガードの過剰制約**: 最適化の「移動先が定員に達していたら移動禁止」ガードが、日固定ストップ絡みで「定員+1に載せれば時間超過が消える」正解手を封じ、旧コードで成立していた2日プランを衝突ありに退化させ得た → ガードを撤去(スコアの overloadMinutes がハード違反より下位で正しく裁定する)。
2. **「transit経路なし」の無視**: Googleが「その区間にtransit経路は無い」と回答したのに、live計測ガードが架空の電車推定を推し続ける穴 → 収束・プリフェッチ双方から**負の証拠(unroutable)**を配管し、その場合は実測タクシーへフォールバック。

あわせてマイナー修正: D1移行失敗を budget_exhausted(429)ではなく 503 に分類/クラッシュ残骸の legacy テーブルを DROP してから移行/スキーマ検査が空応答ならフェイルクローズ/結果画面の通知も quota枯渇を区別/「毎日リセット」と断定しない文言へ/地図ズームクランプは縮退バウンズ限定(故意の深いズームを巻き戻さない)/深夜跨ぎの日の食事枠が消えるのを防止/日固定した任意ストップを時間予算トリムが黙って外さないように。

未対応のレビュー指摘(軽微・設計判断): タクシー区間のtransit測定が収束の20イベント予算を分け合う(優先順は仕様どおり)/夕食枠が「窓より遅い最終ストップ」の前に時刻順で並ぶケース(時刻整合を優先する設計)/ja・en文体の微差。

## 5. 残課題(バックログ)

- **町名(locality)の扱い**: インターラーケン等の町名が「滞在90分のスポット」として日程に入る。仕様 §2.1 的には「エリアヒント」(クラスタリング/ホテルエリアのシード)へ変換するのが正だが、町名だけのウィッシュリストが空になる等の影響が大きく今回は見送り。設計メモ: locality タイプは訪問リストから外し、日テーマ・ホテル推薦の重みに使う。
- **確認するボタンのUX**: 現在も入力ステップ(場所確認画面)へ戻る挙動。バナーが場所名を名指しするようになったので迷いは減ったが、結果画面から曖昧候補を直接選べるインライン UI が望ましい。
- ローカル `vinext start`(:3000)は Node サーバで worker `env` が `undefined` のため**有料APIは常に403**。有料APIを含む動作確認は `vinext dev`(miniflare)で行うこと(`.dev.vars` に `.env` 相当+`TRIPCHECK_PUBLIC_ORIGIN=http://localhost:8788` を置く。gitignore 済み)。
- AI food ranking はローカルプロキシ(:8791)未起動だと 502(設計どおりの degrade)。
