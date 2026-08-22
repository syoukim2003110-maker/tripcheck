# TripCheck Swift v1 — 設計書(エンジン + 鍵ゼロ iOS アプリ)

- 作成日: 2026-08-21
- 対象: `apple/` 配下に新設する Swift 実装の最初のサブプロジェクト
- 元資料: `docs/tripcheck-specification-2026-08-21.md`(統合仕様書、以下「統合仕様」)。統合仕様は**一例**であり正解ではない(2026-08-21 ユーザー決定)。本書は統合仕様から変えた点を §9 に全部列挙する。
- 状態: 設計確定(ユーザー承認済み §1〜§4 を本書に展開)

---

## 0. 決定の記録(ブレインストームの結論)

| 論点 | 決定 | 理由 |
| --- | --- | --- |
| 外部データの取り方 | **既存 Cloudflare Worker を再利用(アプリ用認証を次 spec で追加)+ 地図は MapKit** | 課金上限・署名写真・Anthropic・楽天をサーバ側に残せる。ネイティブは同一オリジン検査を通れないので認証経路だけ足す |
| 置き場所 | **このリポジトリの `apple/`** | golden 500・TS エンジンが隣にあり移植の照合テストが書ける。Worker 変更も同じブランチで揃う |
| 最初の spec の範囲 | **エンジン(TripCheckKit)+ 鍵ゼロで動く iOS アプリ** | 最初から触れるものが出る。通信は次 spec |
| アプローチ | **B. ハイブリッド** — アルゴリズム・定数・タイブレークは TS に忠実、型と UI は Swift ネイティブ | golden 500 を移植の合否基準にできる。React の hooks 構造は SwiftUI に写さない |
| 入力モデル | **A. 場所リスト + 貼り付け取込**(テキストエリアをやめる) | `<textarea role="combobox">` の負債(統合仕様 §21.4)を持ち込まない。取り違え防止が UI として自然になる |
| 鍵ゼロの場所解決 | **B. MapKit `MKLocalSearch` を解決器に追加** | 無料・キー不要・サーバ不要で任意の国が動く。Evidence は `estimated` 止まり(`verified` にしない) |

---

## 1. 目的と完了条件

### 1.1 目的

統合仕様の決定論エンジン(§6・§7・§11 の一部)を Swift Package **TripCheckKit** として移植し、その上に SwiftUI の iOS アプリ **TripCheck** を載せる。この spec の範囲では**鍵ゼロ**(Google API キー・サーバ・アカウントなし)で、Start → Resolve → Build → Plan → Detail → 編集/Undo → 保存 → 共有/PDF まで動く。

### 1.2 完了条件(これを満たしたら「できた」と言う)

1. `swift test`(`apple/Packages/TripCheckKit`)が緑:
   - G1 golden オラクル **500/500**、各アーキタイプ 100 回反復で決定的
   - G2 パーサ合成コーパス 500 件: F1 ≥0.97 / recall ≥0.99 / 見出し偽陽性 0 / p95 <200ms
   - (G3) TS スナップショット照合: 差分ゼロ、または差分ごとに「意図した差」の記録(Node が取得できた場合のみ)
   - §3.6 に挙げる不変条件テスト全件、共有コードの Web 往復、TripStore の禁止キー
2. iPhone シミュレータで、鍵ゼロのまま
   - 「スイス 4 日サンプル」
   - 「任意の国で Apple 検索した 5〜12 か所」
   の両方で Start → (Resolve) → Plan が出て、日タブ・地図・詳細・編集(外す/日を移動/滞在/最終入場/日の開始・終了/日数)・Undo/Redo・保存と再開・共有リンク生成・PDF 出力が動く。
3. 判定文・警告・数字が Tier A/B/C の語彙規則(統合仕様 §16.3)に従うことがテストで固定されている。
4. 統合仕様から変えた点が本書 §9 に全部書かれている。

### 1.3 範囲外(次以降の spec)

Worker のアプリ認証 / Google 候補検索・場所解決・実経路・営業時間・transit 収束 / 天気・祝日 / 食事・寄り道・ホテル推薦の取得 / AI ラベル・fresh voices / 計測 / TestFlight 配布 / iPad 最適化 / iCloud 同期。**ただし型とプロトコル(`PlaceResolver` / `RouteProvider` / `RecommendationSource`)は本 spec で切る**。

---

## 2. 全体構成

```
tripcheck/                                  既存リポジトリ(branch claude/architecture-v2)
└ apple/
   ├ project.yml                            XcodeGen が唯一の正(.xcodeproj はコミットしない)
   ├ TripCheck/                             iOS アプリ(SwiftUI、薄い UI 層)
   │   ├ App/          TripCheckApp.swift, PlannerStore.swift, BuildRunner.swift
   │   ├ Screens/      Start/ Resolve/ Build/ Plan/ Detail/ Share/ Print/
   │   ├ Components/   ActivityCard, MovementCard, DayTabs, DayTimeBar, IssueCard, VerdictDetails, BeforeYouGo…
   │   ├ Map/          TripMapView(MapKit), PinViews, RouteOverlays
   │   ├ Providers/    ApplePlaceResolver(MKLocalSearch)   ← UI 層ではなく App ターゲット内の adapter
   │   ├ Design/       Tokens.swift, Typography.swift, Icons/(24 種を Path で)
   │   └ Resources/    Assets.xcassets, Fonts/Anton-Regular.ttf, Localizable(ja/en は Kit の Copy を使うので最小)
   ├ Packages/TripCheckKit/                 Swift Package(Foundation のみ。UIKit/SwiftUI/MapKit を import しない)
   │   ├ Package.swift                      swift-tools 6.0、platforms: iOS 17 / macOS 14
   │   ├ Sources/TripCheckKit/
   │   │   ├ Core/          Minutes, ClockTime("HH:MM"), CalendarDate("YYYY-MM-DD"), GeoPoint, Locale(ja/en)
   │   │   ├ Parser/        WishlistParser, WishlistSerializer(§6.5 書式)
   │   │   ├ Destinations/  DestinationProfile ×25, Essentials, EntryAuthority, PassportRule
   │   │   ├ Geo/           Haversine, Weiszfeld, HeldKarp/NearestNeighbor2Opt, Catalog(東京 18 + スイス 8)
   │   │   ├ Builder/       Clustering, DayAssignment(+Score), DayOrdering(+Score), DayClock, StayEstimates,
   │   │   │                TravelEstimates(time-feasibility), MealSlots, Bases, Airports, PoiAccess, TripBuilder(入口)
   │   │   ├ Feasibility/   Evidence, CriticalFact, EvidenceSnapshot, FeasibilityResult, PlanSnapshot
   │   │   ├ Scenarios/     TripFit, MinimumDays, CutCandidates, Counterfactuals, ProvisionalTripLength
   │   │   ├ Edits/         PlannerEditState, GuardedEdit, HardEditEvaluator, PlannerHistory
   │   │   ├ Resolution/    PlaceResolver(protocol), CatalogResolver, ResolutionPipeline(国の投票・自動採用規則)
   │   │   ├ Share/         ShareCodec(encode/decode = lib/share-link.ts 互換), ShareScope
   │   │   ├ Presentation/  Copy(ja/en 44 キー + 追加分), TimelinePresentation(stayLine 等), BannedTerms
   │   │   └ Persistence/   TripStore(JSON ≤10 件), UserTripPayload
   │   └ Tests/TripCheckKitTests/
   │       ├ Fixtures/      golden-feasibility.v1.json(コピー)、parser 合成生成器、(G3)ts-snapshots.v1.json
   │       ├ Golden/        GoldenParityTests, ParserCorpusTests, (G3)SnapshotParityTests
   │       ├ Invariants/    §3.6 の契約テスト群
   │       └ Units/         モジュール単体
   └ (docs は docs/superpowers/ に置く)
```

- 依存の向き: `TripCheck(App) → TripCheckKit`。Kit は Foundation のみ。
- Swift 6 言語モード、strict concurrency。エンジンは純関数と値型(`Sendable`)。
- iOS 17+、iPhone 優先(`TARGETED_DEVICE_FAMILY 1`)。Bundle ID `com.muraoshoki.tripcheck`、Team `T8L5BPC2XJ`。
- Web 版(`app/ lib/ worker/`)のコードには触らない。フィクスチャはコピーして Kit 内に置く(SwiftPM リソースは Package 内必須)。

---

## 3. TripCheckKit — エンジン

### 3.1 公開 API(TS の 4 段と同じ)

```swift
public struct TripRequest: Sendable, Codable {
  public var raw: String            // 共有・保存・パーサ用の正本テキスト(§5.2 参照)
  public var days: Int              // 1...14(clampTripDays)
  public var pace: Pace             // relaxed | balanced | fast
  public var locale: PlannerLocale  // ja | en
  public var context: PlannerContext
}

public func buildTrip(_ request: TripRequest) -> BuiltTripPlan
public func assessTripFit(_ request: TripRequest, plan: BuiltTripPlan,
                          options: TripFitSearchOptions = .init()) -> TripFitAssessment
public func makeEvidenceSnapshot(plan: BuiltTripPlan, options: EvidenceSnapshotOptions) -> PlannerEvidenceSnapshot
public func deriveFeasibility(plan: BuiltTripPlan, fit: TripFitAssessment,
                              evidence: PlannerEvidenceSnapshot) -> FeasibilityResult
public func generateCounterfactuals(_ request: TripRequest, plan: BuiltTripPlan,
                                    fit: TripFitAssessment) -> [TripCounterfactual]   // ≤3
public func evaluateHardEdit(current: PlannerEditState, candidate: PlannerEditState,
                             build: (PlannerEditState) -> BuiltTripPlan) -> HardEditDecision
```

- 全て同期・決定論・I/O なし。`now` が要る関数は引数で受ける(`at: Date`)。
- `assessTripFit` の 1 秒タイムアウトは `ContinuousClock` で測り、超過は `solverTimedOut`(部分探索を最小と呼ばない)。

### 3.2 型の対応(TS → Swift)

| TS | Swift | 備考 |
| --- | --- | --- |
| `string` の `"HH:MM"` | `ClockTime`(`minutes: Int`、`Codable` は文字列) | 翌日跨ぎは日付側に持つ(TS と同じ。1440 を足さない) |
| `string` の `"YYYY-MM-DD"` | `CalendarDate`(年月日 Int、`Codable` は文字列) | 曜日・加算は自前算術(TS の `addCalendarDays` と同じ) |
| `Pace`, `StopPriority`, `MealPlan`, `TransportMode`, `TravelPreference` | `enum: String` | raw value は TS の文字列と同一 |
| `EvidenceStatus`, `EvidenceSource`, `FeasibilityState`, `ConflictCode`, `AttentionCode`, `AssumptionCode`, `CriticalFactKind`, `FeasibilityUnknownCause` | `enum: String, Codable` | **golden が文字列で照合する**ため raw value を TS と同一にする |
| `Evidence<T>` | `struct Evidence<T: Codable & Sendable>` | `status / source / fetchedAt / expiresAt / providerRef / explanation` |
| `RouteStop`, `ResolvedInputStop` | `RouteStop`, `ResolvedStop` | `ResolvedStop.provider: enum { catalog, user, apple, google }`(§4.3 のため追加) |
| `TripPlannerContext` | `PlannerContext: Codable` | **golden の `trip.context` JSON をそのままデコードできる**ことをテストで固定 |
| `BuiltTripPlan / BuiltPlanDay / BuiltPlanStop / BuiltPlanLeg` | 同名 struct | フィールドは TS と同じ名前(G3 の diff を機械的にするため) |
| `DayAssignmentScore`(11 項) / `ScheduleOrderScore`(6 項) | `Comparable` struct | 比較順を `<` の実装で固定し、テストで「大きな soft が hard 1 件を上回れない」を確認 |
| `TripFitAssessment`, `TripCutCandidate`, `MinimumDaysAssumptions`, `TripCounterfactualAlternative` | 同名 | |
| `PlannerEvidenceSnapshot`, `CriticalFact`, `FeasibilityResult`, `PlanSnapshot` | 同名 | `providerSnapshotHash` は FNV-1a を移植 |
| `PlannerHistory<T>` | `PlannerHistory<State: Equatable>` | 上限 10(UI)/ 台帳 20 |
| `ShareableTripInput`, `ShareScope`, `ShareWarningCode` | 同名 | コード形式は Web と**バイト互換** |
| `StoredTripRecord`, `UserTripPayload` | 同名 | 保存禁止キーの検証を移植 |
| `Destination` ほか | `DestinationProfile` | 25 件を Swift の静的配列に(§4.1) |

### 3.3 算術の方針(差が出やすい箇所)

- 距離: Haversine(TS の `straightLineDistanceKm` と同じ定数 6371)。
- 丸め: TS の `Math.ceil/round` に対応する箇所は明示的に同じ関数を使う(`Int((x).rounded(.up))`)。負数の `%` は TS と Swift で符号が違うので、デイカラー `% 7` などは `((x % 7) + 7) % 7` を使う。
- 並び替え: TS の `Array.prototype.sort` は安定ソート。Swift の `sort` も安定だが、**全ての比較関数を TS と同じタイブレーク(最後は id の辞書順)で書く**。
- DST/TZ: 目的地の `timeZone` での UTC オフセット計算(`utcOffsetMinutesAt`)だけ `TimeZone` を使う。旅行日は端末 TZ を継承しない(不変条件テスト「Auckland vs LA」「NY 2026-03-07/08」)。
- 探索上限: `MAX_DAY_ASSIGNMENT_STOPS 12`、`MAX_DAY_ASSIGNMENT_EVALUATIONS 600`、厳密順序 ≤7、Held-Karp ≤10、TripFit 1,000ms、収束 3 回/20 イベント — 定数は `EngineConstants` に一箇所で置き、統合仕様 §7.2 の表をコメントで併記。

### 3.4 移植する TS モジュール(行数は 2026-08-21 実測)

| TS | 行 | Swift の置き場所 | 注 |
| --- | ---: | --- | --- |
| `wishlist-parser.ts` | 615 | Parser/ | EN/JA/KO/ZH マーカー、日見出し、時刻、滞在、行編集(他行バイト同一) |
| `destinations.ts` | 1,643 | Destinations/ | 25 プロファイル、essentials、入国認証、旅券規則、TZ 関数。**データは忠実に転記**し内容は変えない |
| `route-optimizer.ts` | 499 | Geo/, Resolution/CatalogResolver | 東京 18 カタログ、Held-Karp、2-opt、Google Maps URL |
| `stay-estimates.ts` | 67 | Builder/StayEstimates | 名前パターン → タイプ表 → 既定 90 |
| `time-feasibility.ts` | 145 | Builder/TravelEstimates | 徒歩/公共交通/車の推定式、`pickRecommended`、非対称証拠ガード |
| `poi-access.ts` | — | Builder/PoiAccess | 山岳鉄道アクセスノード 2 ポリシー |
| `airport-comparison.ts` | 128 | Builder/Airports | 処理バッファ、同一都市圏、`cityDayOffset` |
| `trip-builder.ts` | 2,300 | Builder/* | クラスタ・日割り・順序・時計・食事枠・拠点・空港・ビルド入口。**最大の移植単位、4〜5 ファイルに分ける** |
| `feasibility-result.ts` | 907 | Feasibility/ | Evidence、9 種の重要事実、5 状態、衝突 8 コード、注意 5、仮定 14、FNV-1a |
| `trip-scenarios.ts` | 706 | Scenarios/ | TripFit、最短日数探索、見直し候補 6、反実仮想 7 種 ≤3 |
| `provisional-trip-length.ts` | — | Scenarios/ProvisionalTripLength | (日数, 拠点)の不動点 ≤3 ラウンド |
| `gap-detection.ts` | 266 | Builder/Gaps | 帯 30/60/120、`dayFillerAllowance` — **計算のみ**(推薦取得は次 spec) |
| `planner-app-state.ts`(一部) | 639 | Edits/ | `PlannerHardEditConflict` 6 種、`clampTripDays`、`addCalendarDays`、`builtPlanTravelMinutes` |
| `planner-history.ts` | — | Edits/PlannerHistory | |
| `share-link.ts`, `share-scope.ts` | — | Share/ | Web とバイト互換 |
| `trip-store.ts`(検証部) | — | Persistence/ | `validateUserTripPayload` |
| `planner-copy.ts`, `timeline-presentation.ts`, `trip-presentation.ts` | — | Presentation/ | Copy Deck 44 キー、`stayLine`、`spareCapacityLine`、判定文 |
| `coverage-profile.ts`, `planning-evidence.ts`, `trip-scope.ts` | — | Feasibility/ | 地域カバレッジ、ソフト証拠バッファ(0/15/30)、領域外警告(border/timezone/ferry) |

移植しない: `trip-analysis.ts`(死コード)、`i18n.ts` のランディング文、為替/money/transitTraps(削除済み)、`lib/server/**`、React hooks。

### 3.5 移植の正しさ = 3 層の照合

| 層 | 内容 | 合格条件 |
| --- | --- | --- |
| **G1 golden オラクル** | `tests/fixtures/golden-feasibility.v1.json`(500)をコピーし、各シナリオで `buildTrip → assessTripFit → makeEvidenceSnapshot → deriveFeasibility` を回して `oracle` を照合: `expectedStateOneOf` / `requiredConflictCodes` / `forbiddenConflictCodes` / `hardConflictExpected` / `mustScheduledIds`(Must が全て配置)/ `expectedUnknownKinds` / `solverTimedOut` | 500/500。各アーキタイプ代表 1 件を 100 回反復し `canonical JSON` が同一 |
| **G2 パーサ合成コーパス** | `tests/fixtures/wishlist-parser-synthetic-fixtures.ts` と `tests/wishlist-parser-corpus.test.ts` の生成規則を Swift に移植(同じ seed・同じ 10 カテゴリ・500 件) | F1 ≥0.97、recall ≥0.99、明示マーカー/見出し/日割り recall ≥0.99、見出し偽陽性 0、p95 <200ms(4 回ウォームアップ後) |
| **G3 TS スナップショット** | TS エンジン(`scripts/` に小さな `.mjs` を追加: 500 シナリオの `{plan, fit, evidence, result}` を JSON 出力。TS コードは変更しない)→ `ts-snapshots.v1.json` として Kit に同梱 → Swift の出力と**フィールド単位で diff**(日割り・順序・到着/出発・`minimumDays`・仮定・衝突) | 差分ゼロ。差分があれば 1 件ごとに「意図した差」を `docs/superpowers/specs/` の付録に記録。**前提: Node ≥22.15 を scratchpad に取得できること**(この環境には現在 Node が無い。取得不可なら G1+G2 で完了とし、G3 未実施を記録) |

G1 は「成立/不成立と理由」しか見ないので、日割りや時刻が TS と違っても通る。**G3 が移植の本当の証拠**。

### 3.6 TS 単体テストから持ち込む不変条件(契約として名前があるもの)

計画書で全列挙するが、最低限:

- 日割り: スイス 4 日で空日ゼロ / 空日・不足を travel より上に置く / 固定日・ロック日は不動 / 日予算トリムが任意だけを外す / 最終日の空港超過で末尾の任意を外す
- 順序: 大きな soft が 1 件の予約/営業違反を上回れない / ロック順は逐語維持 / evening ≥16:00・night ≥18:00
- 時計: `start = max(要求, 到着準備完了)` / `fitVisitToWindow` の 5 状態(`[]` は `closed_day`) / 締切 `min(空港, 門限)` / `deadlinePreviousDay`
- 移動手段: 都市間の非タクシー化(比例許容)/ 非対称証拠ガード / `unroutable` は推奨しない / 徒歩上限→非徒歩、乗換上限(既知のみ)→非 transit / 山岳鉄道の直行禁止
- 食事枠: 夕食は `day.deadline` 基準 / 昼は窓と到着の関係 / 食事枠は日の算術を変えない
- 成立判定: 状態導出の順(UNKNOWN > INFEASIBLE > IF_ASSUMPTIONS > PROVISIONAL > VERIFIED)/ 営業時間系は `verified` でなければ hard にならない / 注意は排他・順 / 経路事実が `verified` になる 6 条件
- 最短日数: 時計だけが日を不可能にする / タイムアウトで `minimumDays = null` / `partialMinimumDays` は状態を UNKNOWN に保つ / `spareDays` の null 条件 / (日数, 拠点)不動点 ≤3 ラウンド
- 反実仮想: 全て実再構築 / `improvesFeasibility` の順 / ホテル閾値 60 分・15% の包含 / `incomplete`/`timed_out` では空
- 編集ガード: 空港超過は門限改善で相殺されない / 別日・別種は相殺しない / `unknown` 営業窓は衝突に昇格しない / 推薦採用は 1 履歴操作 / 拠点ハンドオーバーは履歴を増やさない
- gap: 帯の境界 29/30/59/60/119/120、1 日 1 gap=最大、`dayFillerAllowance` 1/2/3
- 時間・TZ: 旅行日は端末 TZ を継承しない(Auckland vs LA)/ DST(NY 2026-03-07/08)/ 深夜到着は活動日を翌日へ
- 表示: `stayLine` の estimated/verified が同一文にならない / spare 行が置換前より長くならない / `COMPUTATION_LIMIT` の独立文 / 時間バーが 100% に合計 / 7 色パレット
- 共有: 往復、墨消し、`LINK_TOO_LONG` のブロック、`RESERVATION_DETAILS_INCLUDED` 警告
- 保存: 禁止キー(Google 表示名・営業時間・口コミ・写真・経路・ビルド済みプラン)を含むペイロードを拒否

---

## 4. 目的地・場所解決(鍵ゼロ)

### 4.1 DestinationProfile

統合仕様 §11 の 25 プロファイルを**データとして忠実に転記**(国依存はここに集約、ロジックに "Japan" を書かない)。`essentials` / `EntryAuthority` / `PassportRule` / `airports` / `meals` / `mobility` / `sundayClosing` / `notes` / `sample`(スイス 8 地点)を含む。

### 4.2 `PlaceResolver` プロトコル(Kit)

```swift
public protocol PlaceResolver: Sendable {
  func resolve(_ queries: [PlaceQuery], destination: DestinationChoice, locale: PlannerLocale) async -> [PlaceResolution]
}
public enum PlaceResolution { case confirmed(ResolvedStop), review([PlaceCandidate]), unresolved(reason) }
```

- `ResolutionPipeline`(Kit、純粋)が occurrence ベースの入力(`inputIndex`)・**完全一致の自動採用**・**非観光タイプは自動採用しない**・国の投票(明示 > 国コード投票 > 最小外接箱、未対応コードがあれば `worldwide`、同数は `worldwide`)・混在国の検出を担う。
- 解決器は順に束ねる: `CatalogResolver`(東京 18 + スイス 8、Kit 内)→ `ApplePlaceResolver`(App 内、MapKit)→ (次 spec)`GooglePlaceResolver`(Worker)。先に `confirmed` を返した解決器で止まる。
- `ResolvedStop.provider` と Evidence: `catalog → tripcheck_catalog / estimated(verifiedAt 付き)`、`user → user_provided`、`apple → other / estimated`(営業時間は `unknown`)、`google → google / verified`。**Apple 由来を `verified` にしない**(統合仕様 §3.5 の二値厳守)。

### 4.3 `ApplePlaceResolver`(App ターゲット)

- `MKLocalSearch` に `naturalLanguageQuery = 場所名(+ 目的地の接尾辞は付けない。Apple は `region` でバイアスする)`、`region = DestinationProfile.bounds`(auto のときは全世界)、`resultTypes = [.pointOfInterest, .address]`。タイムアウト 6 秒、同時 4 件。
- 候補は上位 3 を `PlaceCandidate`(名前・住所・座標・`countryCode` = `placemark.isoCountryCode`・`category` = `pointOfInterestCategory`)へ。非観光カテゴリ(`.school`, `.hospital`, `.university`, 企業名パターン)は単独候補でも `review`。
- 送るものは**1 行の場所名と地域バイアス**のみ(統合仕様 §13.2 の表に「Apple Maps 検索」行を追加する)。
- `locale` に応じて `MKLocalSearch.Request` の言語を合わせる(ja 入力は日本語の結果を優先)。

---

## 5. iOS アプリ

### 5.1 状態

```swift
@Observable @MainActor final class PlannerStore {
  var request: TripRequestState      // 入力・解決・国・日数・条件(Web の 22)
  var edit:    PlanEditState         // 滞在/最終入場/日窓/手段/日移動/除外/日数/拠点(Web の 12)= Undo の単位
  var view:    PlannerViewState      // 画面・選択日・シート・ダイアログ・トースト(Web の 19)
  private(set) var plan: BuiltPlanBundle?   // plan + fit + evidence + result + counterfactuals
  private var buildGeneration = 0
}
```

- **エンジンに渡せるのは `request` + `edit` から作る `TripRequest` だけ**。`PlannerViewState` を受け取る Kit API は存在しない(型で境界)。
- ビルド: `buildGeneration += 1` → `Task.detached(priority: .userInitiated)` で Kit を呼ぶ → 戻りで世代一致のときだけ反映。`changeLocale` / `reset` / `cancel` / `build` が世代を進める。
- 編集は全て `applyGuardedEdit(_:)`: 候補 `edit` → 実ビルド → `evaluateHardEdit` → `.apply(delta)`(トースト「昼食を追加しました 余裕 −45分 元に戻す」6 秒)/ `.confirm(conflicts)`(`.alert` で「外さない/外す」)。Undo 10、台帳 20。シェイク Undo と `⌘Z` / `⇧⌘Z`(iPad キーボード)に結線。
- 子ビューは**イベント発火のみ**(`onTap: () -> Void` 等)。Store 以外は状態を持たない(ローカルな開閉フラグを除く)。

### 5.2 入力モデル(変更 A)

- 正本は `TripRequestState.entries: [WishlistEntry]`(`id`・`text`・`priority`・`fixedDay`・`fixedTime`・`isReservation`・`stayMinutes`・`timeOfDay`・`pinnedResolution?`)。順序は入力順(並べ替え UI は無し。順不同が前提)。
- **検索フィールド**で 1 件ずつ追加(2 文字以上・550ms デバウンスで Apple 候補、選ぶと `pinnedResolution` に固定。候補を選ばず Return でも追加でき、解決は Build 時に走る)。
- **「テキストを貼り付け」**: `WishlistParser` に通し、`heading` があれば `existing_itinerary` モード(各日の相対順序は hard、`lockedOrderByDay`)。未解析行は「確認が必要な行」として別リストに残す(捨てない)。
- 共有・保存・印刷では `WishlistSerializer` で §6.5 の書式(ja `予約/必須/時間があれば/滞在N分/N日目`、en `booked/must/optional/stay N min/Day N`)に直列化して `TripRequest.raw` にする。**Web 版とテキスト互換**。
- 件数 1〜12。13 件目を追加しようとしたら拒否し、「12 か所までです。別の旅行に分けてください」(黙って切り捨てない)。

### 5.3 画面

`NavigationStack` 1 本 + `.sheet` / `.alert`。

| 画面 | 内容 |
| --- | --- |
| **Start** | 見出し「行きたい場所を、実際に回れる旅行へ。」/ 検索フィールド + 場所リスト(行: 名前・✓(固定済)・優先度セグメント・時刻/予約/滞在のチップ、スワイプで削除、タップで行編集シート)/ 「テキストを貼り付け」/ 「何日くらい?」タイル 3・4・5・未定 + 「他の日数」`Picker` 1〜14 / 日付 `DisclosureGroup`(DatePicker + 未定)/ 国 `Picker`(常時表示、既定 自動判定、auto + 25 + worldwide)/ 主 CTA「旅程をつくる」(赤、下部固定、`disabled` 条件と 3 ラベル)/ 詳細 `DisclosureGroup`(ホテル・ペース・移動・一日の開始)/ 「30秒で完成例を見る」(スイス 4 日)/ 最近の旅程(開く/削除、非永続警告) |
| **Resolve** | 見出し「場所を確認してください」/ 行ごとの状態アイコン(confirmed ✓ / review ! / parsed … / unresolved ×)/ 候補 ≤3 のインライン選択 + 「候補にない」/ **3 件ずつ**(4 件目以降は抑止文)/ 未発見: 「もう一度探す」「入力を直す」「地図で場所を指定する」(住所・地図タップ・緯度経度、`user_provided`)/ 行の外す(Must/予約は確認)/ 混在国の警告(国セレクタを上に)/ 折り畳み条件(日数・日付・ホテル・ペース・移動・一日の開始・**一日の終了** なし/19:30/21:30・乗換バッファ 0/10/20/30・徒歩上限 5–180・乗換上限 0–8)/ フライト `DisclosureGroup`(到着/出発空港 `Picker`・時刻・便種別・`AirportOptionComparison`)/ CTA「N か所で続ける」。曖昧・未解決がゼロなら Start から直接 Build へ |
| **Build** | 3 ステージ(grouping → ordering → enriching。鍵ゼロでは 2 段)+ キャンセル。`reduceMotion` 尊重。鍵ゼロでは一瞬 |
| **Plan** | 順序固定のファーストビュー: (1) ヒーロー一文 + 状態アイコン(check/signal/spark/close/search) (2) 最重要の警告 1 件 + 行動 1 つ (3) 日タブ(7 色・`←/→`・VoiceOver は tab)+ 日ヘッダー 2 数字 + `DayTimeBar`(visit/travel/slack、予約●・衝突◆)+ 祝日/日曜閉店注記(データがある場合) (4) タイムライン: ホテル出発レグ → `MovementCard` → `ActivityCard` → 食事枠行(時刻のみ。推薦は次 spec)→ … → 帰着レグ (5) `spareCapacityLine`「この日は N 時間空いています。あと M か所まで足せます」(採用 UI は次 spec)。統計行「8か所・移動14時間55分・余裕…/1日分の空き」。日ヘッダーのタップで**その日の設定シート**(一日の開始・終了の変更 = `setDayStartTime` / `setDayEndTime`、ガード経由)。下に `IssueCard`(種類ごと 1 行 + 行動)、`VerdictDetails`(日数ステッパー 1–14・確認済み/推定/不明の 3 数・地域カバレッジ・代替案 ≤3 の diff と「この変更を適用」・仮定・注意)、`BeforeYouGo`(旅券国 unset/JP/other、JP のみ期限、入国認証・旅券・薬の固定行・公式リンク)。ツールバー: 編集 / `•••`(結論の詳細・Undo・Redo・印刷・共有)/ 言語 日本語・EN。**画面下に「旅程 \| 地図」セグメント** |
| **Detail** | `.sheet` + `presentationDetents([.fraction(0.3), .medium, .large])`。`StopInspector`: 番号・名前・メタ・日を移動(複数日のみ)・「営業時間・根拠を見る」`DisclosureGroup`(`stayBasisLine`・Evidence の出典)・「この場所の条件を変える」(滞在 `Picker` 自動/30/45/60/90/120/150/180/240、最終入場 `DatePicker`)・Apple Maps / Google Maps で開く・**最後に「予定から外す」**。`MovementCard` 展開: 手段ピッカー(徒歩は ≤90 分のみ)・推定/実測の別 |
| **Share** | スコープ 4 つ(日付/ホテル/空港/予約、既定は日付のみ)・墨消し件数・警告・`LINK_TOO_LONG` ブロック → `ShareLink`。URL は `https://tripcheck-japan-tokyo.syoki.chatgpt.site/{ja|}#t=<code>`(Web で開ける)+ `tripcheck://t/<code>`(アプリで開く。`onOpenURL` で取込) |
| **Print** | `TripPrintSheet` を `ImageRenderer` で PDF 化 → 共有シート。全日程 1 枚: 判定・仮定・衝突・空港メモ・住所・時刻・祝日注意。地図なし |
| **Error** | plan が作れなかったとき: 原因 1 行 + 「入力を直す」「再試行」 |

### 5.4 地図(MapKit)

- `Map` + `Annotation`。ピン: Anchor = デイカラー塗り + 番号、Filler = ✦ 輪郭(次 spec)、食事 = フォーク、ホテル = H、警告 = `!` バッジ、手動 = `+`。`accessibilityLabel = "{name}, {種別}"`。
- ルート線: 選択日 5pt(不透明 .95、白縁)、非選択 2pt(.28)。**実測ジオメトリが無いレグは破線の直線のみ**(統合仕様 §9「欠損ジオメトリは描かない」。実線は次 spec でプロバイダのポリラインが来てから)。
- 凡例(日ボタン・実線=実測/破線=推定・番号=予定地点/✦=おすすめ)、スコープ all/day、縮尺バー(`MapScaleView`)。
- `fitBounds` 相当: 選択日の外接に `MapCameraPosition.region`、退化(span < 0.006°)時は最小 span にクランプ(1 回限り)。
- タイムライン行のタップ/フォーカス → 地図のピン強調、ピンのタップ → タイムラインへスクロール(双方向)。
- 「地図」タブでは全画面、「旅程」タブに地図帯は無い(統合仕様のモバイル二択と同じ)。

### 5.5 保存・ロケール

- `TripStore`(Kit): Application Support/`trips/` に JSON、最近 10 件、FIFO。保存するのは **入力・編集・明示選択の Place ID・手動ピン** のみ(`validateUserTripPayload` で禁止キーを拒否)。550ms デバウンス自動保存。開くときは以前のプロバイダ状態を全て捨てて再解決。
- 保存不可(ディスク不可)はメモリに退避し Start に「この端末には保存されていません」。
- 旅券期限は `UserDefaults`(`tripcheck.passportExpiry`)。送信しない。
- ロケール: 初回は **システム言語が ja なら ja、それ以外 en**(iOS 流儀。Web の「推定しない」から変更)。切替はプランを捨てない(実行中ビルドは中断し世代を進める)。

### 5.6 デザイン

- トークン: `#F7F7F4` 地 / `#FFFFFF` パネル / `#171717` ink / `#3F3F3C` ink-2 / `#616161` muted / `#E3E3DE` line / `#D63F35` accent / `#AE2E27` accent-deep / `#FBE9E6` accent-soft / `#157A46` good / `#E8F5EC` good-soft / `#FFF8E8` `#E9DFC2` `#765700` warn / `#B42318` danger / `#2563EB` focus。
- デイパレット 7 色(単一ソース `DayPalette`、Kit の `Presentation` に置く): `#2563EB #7C3AED #C2410C #15803D #BE185D #0F766E #A16207`。日の識別は常に番号と併用。
- タイポ: ヒーロー 24pt/900、見出し 32pt、統計行 14pt/700、日ヘッダー 14pt/800、停留所名 16pt/750、説明 13pt/450、メタ 12.5pt、ラベル 11pt/800。**Dynamic Type 対応**(`relativeTo:` で拡縮、`accessibility5` で破綻しない)。本文は 12pt 未満にしない。`tabular-nums`。見出しの Anton は同梱(OFL)。
- 角丸: 10(コントロール)/ 14(カード)/ 999(ピル)。カードは 1pt `line` 枠・影なし。
- アイコン: 自作 24 種を `Shape`/`Path` で移植(`arrow bed calendar car check close cloud external fog fork mark moon rain pin plus search signal snow spark storm sun taxi train walk`)、stroke 1.8。**SF Symbols・絵文字は使わない**。
- ダークモード: v1 はライトのみ(統合仕様にも無い)。`preferredColorScheme(.light)`。
- 三層開示(Tier A/B/C)と語彙規則(「目安」「約」は estimated にだけ)は `Presentation` の関数で生成し、ビューに直書きしない。

### 5.7 アクセシビリティ

- 日タブ: `accessibilityRepresentation` で tab セマンティクス、`accessibilityValue` に「N か所・余裕 M」。
- `DayTimeBar`: 1 要素として `accessibilityLabel` に全内訳。
- ライブ領域: ビルド完了・Undo/Redo は `AccessibilityNotification.Announcement`、予約遅延・空港締切・最終入場は assertive 相当(`.screenChanged` ではなく `.announcement` を即時)。
- タップ標的 ≥44×44(主要)、≥24 (シート内)。`reduceMotion` で全アニメーション停止。

---

## 6. エラー処理

- 解決失敗・Apple 検索タイムアウト(6 秒)・ネットワーク無しは**行の状態**(`unresolved` / `review`)として Resolve に出す。例外で画面を落とさない。
- 解決できない行があっても**ビルドは止めない**: 解決済み部分集合で `partialMinimumDays`(状態は UNKNOWN のまま、「確定済みの場所だけなら最短 N 日」と名指し)。
- `assessTripFit` の 1 秒超過は `COMPUTATION_LIMIT` として `IssueCard` に「任意の場所を外す」行動付き。
- 保存失敗はメモリ退避 + 非永続表示。
- 共有コードが長すぎる/完全に墨消しできない → ブロック(黙って弱めない)。
- ビルドの例外(あってはならない)は `ErrorState` に落とし、`name` 相当だけをログ(旅程テキストを出さない)。

---

## 7. テスト

| 層 | 手段 | 固定するもの |
| --- | --- | --- |
| Kit 単体 | Swift Testing、`swift test`(Xcode 不要) | G1 / G2 / (G3) / §3.6 の不変条件 / 共有コードの Web 往復(Web の `share-link` テストベクタをコピー)/ TripStore 禁止キー / Copy Deck 44 キー ja/en の存在 / banned terms が UI 文字列に出ない / 「目安」「約」が estimated にだけ付く(両方向) |
| Kit 境界 | コンパイル時 + テスト | `PlannerViewState` を受ける Kit API が無い(型)/ Kit のソースに `import UIKit|SwiftUI|MapKit` が無い(ファイル走査テスト) |
| App | XCTest UI テスト最小 + シミュレータ実機確認(`xcrun simctl` + スクリーンショット) | サンプル → Build → Plan → 日タブ → 詳細 → 外す → Undo の主要フロー / Apple 検索で 5 か所 → Resolve → Plan / Dynamic Type 最大で破綻しない / VoiceOver ラベル |
| 回帰 | `apple/tools/verify.sh` | `swift test` → `xcodegen` → `xcodebuild -scheme TripCheck -destination 'iPhone 17 Pro' build test` を 1 コマンドに |

TDD: 各モジュールは**まず golden/不変条件のテストを赤にしてから**移植する。既存テストの削除・緩和はゼロ(統合仕様 §19.1 を継承)。

---

## 8. 実装の順番(計画書で詳細化)

**Kit**: Core → Parser(+G2) → Destinations → Geo/Catalog → Builder(StayEstimates → TravelEstimates → Clustering → DayAssignment → DayOrdering → DayClock → MealSlots → Bases/Airports/PoiAccess → TripBuilder 入口)→ Feasibility → Scenarios(+G1 緑)→ (G3)→ Gaps → Edits/History → Share → Presentation → Persistence
**App**: project.yml + Design tokens/Icons → PlannerStore/BuildRunner → Start(リスト入力・貼り付け)→ ApplePlaceResolver + Resolve → Build/Plan(タイムライン)→ Map → Detail → 編集/Undo → 保存/最近の旅程 → 共有/PDF → BeforeYouGo → 仕上げ(a11y・Dynamic Type・verify.sh)

---

## 9. 統合仕様(Web 版)から変えた点

| # | 変更 | 理由 |
| --- | --- | --- |
| 1 | 入力をテキストエリアから**場所リスト + 貼り付け取込**へ。正本は構造化リスト、テキストは直列化で互換 | `<textarea role="combobox">` の負債を持ち込まない。取り違え防止が UI として自然 |
| 2 | 鍵ゼロの場所解決に **Apple `MKLocalSearch`** を追加(`estimated` 止まり) | 無料・キー不要・サーバ不要で任意の国が動く。Google は次 spec |
| 3 | 地図を **MapKit** に(Google Maps JS → MapKit) | ネイティブ・鍵不要。実線は実測ジオメトリが来るまで出さない原則は維持 |
| 4 | ロケール初期値を**システム言語**から決める | iOS 流儀。切替で保存は同じ |
| 5 | **Dynamic Type** 対応、シェイク Undo | iOS 側の追加 |
| 6 | Detail は `.sheet` の 3 detent(peek/half/full) | Web のボトムシート相当をネイティブで |
| 7 | 結果画面は常に「旅程 \| 地図」の二択(デスクトップ 48/52 分割は持たない) | iPhone 優先 |
| 8 | 食事枠・寄り道・ホテルは**計算と枠の表示まで**(候補取得は次 spec) | 範囲 |
| 9 | 計測(19 イベント)は入れない | サーバ無し。次以降 |
| 10 | 共有は Web 互換の `#t=` に加えて `tripcheck://` スキーム | アプリ間で開ける |
| 11 | 統合仕様 §13.2 の表に「Apple Maps 検索: 1 行の場所名と地域バイアス」を追加する(プライバシー開示の更新は配布 spec で) | 新しい送信先 |
| 12 | golden オラクル(G1)に加えて **TS スナップショット照合(G3)** を追加 | オラクルは日割り・時刻の差を見ないため |

---

## 10. リスク

| リスク | 対処 |
| --- | --- |
| `trip-builder.ts` 2,300 行の移植で挙動差が出る | G1→G3 の順で赤から始める。差分はフィールド単位で出す。定数は一箇所 |
| Node が取れず G3 ができない | G1+G2 で完了と定義し、G3 未実施を記録。後で Node が入れば追加 |
| `MKLocalSearch` の結果が地域・言語で揺れる | Evidence は `estimated`、候補 ≤3 を旅行者が選ぶ(Resolve)。テストは Apple を呼ばない(`PlaceResolver` をフェイク) |
| Swift 6 strict concurrency で MapKit/`MKLocalSearch` の非 Sendable 型 | adapter 内で `@MainActor` に閉じ、Kit には値型だけ渡す |
| Dynamic Type 最大でファーストビューが崩れる | iOS 版のファーストビュー契約: **既定の Dynamic Type・iPhone 17 Pro(402×874pt)で、ヒーロー 1 文 + 警告 1 件 + 日タブ + 最初の停留所 1 件**がスクロールなしで見える(UI テストで固定)。最大サイズでは「ヒーロー + 警告 + 日タブ」まででよい(Web の Gate E「2 停留所 + Filler」より緩い) |
| 12 か所 × 14 日の探索が端末で遅い | TS と同じ上限(600 評価・1 秒)。バックグラウンドで計算し UI を止めない |

---

## 付録 A: G3 の差分記録

G3(TS スナップショット照合)は、同じシナリオを TypeScript エンジン(`node --experimental-strip-types scripts/export-golden-snapshots.mjs`)と Swift エンジンに通し、`plan` / `fit` / `evidence` / `result` を**フィールド単位**で突き合わせる。

| | 母集団 | 結果 |
| --- | --- | --- |
| golden | `tests/fixtures/golden-feasibility.v1.json` の 500 件(1 日・1 停留所・balanced・en) | A.1 の除外パスを除き **差分 0** |
| builder | `Tests/TripCheckKitTests/Fixtures/builder-scenarios.v1.json` の 23 件(2〜5 日・4〜12 停留所・ja/en・switzerland・worldwide を含む) | 同じく **差分 0** |

再生成:

```
node --experimental-strip-types scripts/export-golden-snapshots.mjs \
  --out apple/Packages/TripCheckKit/Tests/TripCheckKitTests/Fixtures/ts-snapshots.v1.json \
  tests/fixtures/golden-feasibility.v1.json
node --experimental-strip-types scripts/export-golden-snapshots.mjs \
  --out apple/Packages/TripCheckKit/Tests/TripCheckKitTests/Fixtures/ts-builder-snapshots.v1.json \
  apple/Packages/TripCheckKit/Tests/TripCheckKitTests/Fixtures/builder-scenarios.v1.json
node --experimental-strip-types scripts/export-js-math-vectors.mjs \
  --out apple/Packages/TripCheckKit/Tests/TripCheckKitTests/Fixtures/js-math-vectors.v1.json \
  apple/Packages/TripCheckKit/Tests/TripCheckKitTests/Fixtures/builder-scenarios.v1.json
```

### A.1 除外パス(`SnapshotParityTests.swift` の `snapshotParityIgnoredPaths`)

配列の添字は `[]` に畳んである。1 行が 1 フィールドを指し、部分木ごと黙らせている行は無い。**`everyIgnoredPathStillEarnsItsPlace` が、どの行も 2 つの母集団のどこかで実際に差分を 1 件以上飲み込んでいることを検査する。** 何も飲み込まない行は「もう直った差」か「誰もシナリオを書かなかった場合」のどちらかで、置いたままにすると照合が見逃せる範囲が黙って広がる。

| # | シナリオ | パス | TS 値 | Swift 値 | 理由 |
| --- | --- | --- | --- | --- | --- |
| A-1 | `builder-23-closed-every-day-and-unpinned-capture`(`options.capturedAt` を渡さない唯一のシナリオ) | `evidence.capturedAt` | `2026-08-22T09:13:11.309Z` | 別の時刻 | `capturedAt` が無ければ実行時刻(`new Date().toISOString()`)。時計そのものなので一致しえない |
| A-2 | 全件 | `evidence.providerSnapshotHash` / `result.providerSnapshotHash` | `fnv1a-e1e3c4ba` | `fnv1a-ee880a7c` | Task 16 の決定。Swift の安定文字列化は `undefined` のキーと A-4 の漏れキーを含めないので、同じ FNV-1a でも原文が違う。verdict の入力ではなくキャッシュの合鍵 |
| A-3 | 全件(`RouteStop` 型の全 14 位置) | `…input` / `…inputIndex` / `…address` / `…countryCode` を `plan.days[].stops[].stop`、`plan.days[].legs[].from`/`.to`、`plan.days[].startBase`/`.endBase`、`plan.selectedBase`、`plan.baseRecommendations[].base`、`plan.deferredOptionalStops[]`、`plan.deferredUnavailableStops[]`、および `result.scheduledDays[]` の対応する 5 位置 | `"Tokyo Skytree"` / `1` / `"Synthetic fixture address, Sumida"` / `"JP"` | 不在 | TS は構造的型付けなので、`RouteStop` を宣言した場所に `ResolvedInputStop` が入ると余分な 4 キーが実行時オブジェクトに付いたまま出力される。Swift は `RouteStop` と `ResolvedStop` が別の型なので入口で落ちる。ビルダーはこの 4 キーを `RouteStop` から読まない(純粋な入力の反響) |
| A-4 | `openingEvidenceByStop` を渡すシナリオ | `evidence.facts[].evidence.dateSpecific` / `evidence.facts[].evidence.dateSpecificDates` | `true` / `["2026-10-13",…]` | 不在 | `createPlannerEvidenceSnapshot` が `{ ...hoursEvidence }` を `Evidence` へ展開する(`lib/feasibility-result.ts:440`、`:556`)ため、`Evidence` 型が宣言していない 2 キーが同乗する。A-3 と同じ「構造的型付けの漏れ」で、エンジンはこの値を読み返さない。Swift の `Evidence` は宣言したフィールドだけを持つ(Task 16 の決定のまま) |

除外行は 61 行あるが、**種類は 4 つ**で、うち 56 行は A-3 の同じ 4 フィールド × 14 か所である。

### A.2 修正した差分

| # | 症状 | 原因 | 直した場所 |
| --- | --- | --- | --- |
| A-5 | builder-04 / 05 / 14 で 1 日ぶんの訪問順が TS と**逆順**になり、その日の到着・出発・脚・Maps URL・evidence の並びまで連鎖して食い違った | Haversine が TS と**式の書き方**まで一致していなかった。(a) `asin(√h)` を `atan2(√h, √(1−h))` で書いていた、(b) `度 × π ÷ 180` を `度 × (π ÷ 180)` に畳んでいた、(c) `**` は `*` より強く結合するので TS は `cos(A)·cos(B)·sin²` だが Swift は `cos(A)·cos(B)·sin·sin` と書いていた。いずれも実数では同値だが最後の 1 ulp が動く | `Sources/TripCheckKit/Core/GeoPoint.swift` を `lib/route-optimizer.ts:318-328` の式の形どおりに書き直した |
| A-6 | 上を直しても差分は消えず**増えた**(494 → 887)。式の形ではなく `cos` / `sin` / `asin` そのものが V8 と食い違っていた | Foundation(Apple の libm)を呼んでいた。A.3 参照 | `Sources/TripCheckKit/Core/JSMath.swift` を新設し、`straightLineDistanceKm` から呼ぶようにした |

**なぜ 1 ulp が効くのか。** 訪問順の最適化(`RouteOrdering.optimize` / `optimizeFromBase`)は、開路も閉路も**逆順が厳密に同じ辺集合**なので距離が完全に同点になる。勝敗は「同じ辺を別の順で足した 2 つの和」の厳密な `<` だけで決まる。辺 1 本の最後の 1 ビットで向きが倒れ、その日の stops・legs・到着/出発時刻・Maps URL・theme・evidence の並び・assumptions まで連鎖して食い違う。

### A.3 V8 と Apple libm の 1 ulp 差 — 測定と解消

**測定。** 緯度 35.5〜38.5° と 45.9〜47.4° を 0.0001° 刻みにした 45,002 点、および haversine が実際に評価する範囲の掃引で、V8(Node 22.18.0 / V8 12.4.254.21)と Apple libm の戻り値のビット列を突き合わせた。

| 関数 | 標本 | 不一致 | 率 |
| --- | --- | --- | --- |
| `cos(緯度 × π ÷ 180)` | 45,002 | 3,089 | 6.86 % |
| `sin(緯度 × π ÷ 180)` | 45,002 | 4,489 | 9.97 % |
| `sin(x)`(0〜0.035 rad = haversine の半差分) | 100,001 | 7 | 0.007 % |
| `asin(x)`(定義域 `[0, 1]` 全体) | 200,001 | 17,319 | 8.66 % |
| `asin(√h)`(2 点間 0.9〜400 km に対応) | 200,001 | 4,217 | 2.11 % |

V8 は自前の fdlibm 由来 `base::ieee754::cos` / `sin` / `asin` を積んでおり(`V8_USE_LIBM_TRIG_FUNCTIONS` はこのビルドで未定義)、Apple の libm はそれより正確に丸める。**正確なほうが「正しい」が、parity にとっては正しくない。**

**解消。** `Core/JSMath.swift` に V8 `src/base/ieee754.cc`(tag 12.4.254.21 = Node 22.18.0 が積む版)の `cos` / `sin` / `asin` を移植し、`straightLineDistanceKm` はそちらを呼ぶ。移植したのは Sun の fdlibm 5.3 ではなく **V8 のファイル**である(V8 版は本家から乖離している)。中身は `__kernel_cos`、`__kernel_sin`、`__ieee754_rem_pio2`(π/4 以下の素通し・|x| < 3π/4 の n = ±1・2^19×(π/2) までの中規模、およびそれ以上のための `__kernel_rem_pio2` 全体)、`asin` の有理近似。

**移植で最初に外した点 — 融合積和。** V8 はこのファイルを Clang の既定(`-ffp-contract=on`)でビルドするので、arm64 では 1 つの式の中の `a + b * c` がすべて `fmadd` 1 命令になり、積は丸められずに全幅のまま加算される。ふつうの `*` と `+` で書き写した最初の版は、アルゴリズムは同じでも算術が違い、**cos 507 / 45,002、sin 1,023 / 45,002、asin 2,618 / 200,001** が V8 と食い違ったままだった。どこが融合するかは推測せず、V8 のソースを `clang++ -O2` に通した LLVM IR の `llvm.fmuladd.f64` を読んで決めた。`JSMath.swift` の `fma(...)` はその位置を、素の `*`/`+`/`-` はそうでない位置を表している。

**検証。** V8 のソースから `cos`/`sin`/`asin` だけを抜き出して `clang++ -O2` でビルドしたものは、標本 590,007 点すべてで V8 と一致した(= 差の原因は融合積和だけだと確認できた)。`JSMath` も同じ 590,007 点で V8 と一致する。恒久的な回帰テストは Node が書き出す `Tests/TripCheckKitTests/Fixtures/js-math-vectors.v1.json`(緯度 45,002 点の cos と sin、小引数 sin 20,001 点、asin 20,001 点、builder コーパスが取りうる**全 702 順序対**の距離)で、`Tests/TripCheckKitTests/Units/JSMathTests.swift` が 1 ビットも違わないことを確認する。

**結果。** builder コーパスの全順序対 702 辺のうち、Swift と TS で食い違う辺は **0**。緯度をずらして差を避ける必要は無くなったので、以前この付録に載っていた「5 点を 0.0001° 動かした」表と「新しい緯度は選別すること」という運用は**撤回**した。フィクスチャの座標は元に戻してある。

**残る限界 —— 一致しているのは arm64 の V8 との間だけ。** ここで作った一致は「V8 のソースを、arm64 の Clang が融合積和に畳んだときの丸めで」実行することに依存している。そして**その丸めは V8 自身がホストの CPU で変える**。

`llvm.fmuladd` は「融合してよい」であって「融合しろ」ではない。arm64 には `fmadd` があるので Clang は必ず畳む(V8 のソースを `clang++ -O2 -arch arm64` に通すと融合命令が 114 個出る)。x86-64 の既定ベースラインには FMA3 が無いので、**同じ IR が別々の `mulsd` と `addsd` に落ちる**(`-arch x86_64` で融合命令 0 個、`mulsd` 177 + `addsd` 152)。`ieee754.cc` は静的にコンパイルされ実行時ディスパッチを持たないから、x64 の V8 —— Windows や Intel Mac の Chrome、x64 の Node —— は**融合しない値**を返す。

x64 の Node が手元に無いので V8 バイナリそのものは測れていないが、代わりに V8 のソースを `-ffp-contract=off` でビルドして arm64 の V8 と突き合わせた。これは x86-64 ベースラインが計算するのと同じ値であり、食い違いは:

| 掃引 | 融合しない版 ≠ arm64 V8 | 率 |
| --- | --- | --- |
| `cos(緯度 × π ÷ 180)` | 507 / 45,002 | 1.13 % |
| `sin(同上)` | 1,023 / 45,002 | 2.27 % |
| `asin(x)`(`[0, 1]` 全体) | 2,618 / 200,001 | 1.31 % |
| `sin(x)`(0〜0.035 rad) | 5 / 100,001 | 0.005 % |
| `asin(√h)`(0.9〜400 km) | 7 / 200,001 | 0.003 % |

つまり **Web 版自身が arm64 ホストと x64 ホストで違う旅程を出しうる**。この Kit が合わせているのは arm64 側で、A.2 の「日程が逆順になる」問題が解消したのは **arm64 ホスト同士の間**である。x64 の Web と突き合わせるなら、その差はここに戻ってくる。

なお **Swift 側の実行環境は関係しない**。`fma()` は IEEE 754 の `fusedMultiplyAdd` で、専用命令があってもなくても(無ければソフトウェアで)正しく丸めた融合結果を返す。`JSMath` は Intel Mac でも Apple Silicon でも同じ値を出す。

このほか、V8 が `ieee754.cc` を差し替えるか、`V8_USE_LIBM_TRIG_FUNCTIONS` を有効にしたビルドが出回れば、また 1 ulp で向きが倒れうる。`js-math-vectors.v1.json` は `v8Version` を記録しており、`JSMathTests` は移植が名乗る 12.4.254.21 と食い違えば落ちる。
