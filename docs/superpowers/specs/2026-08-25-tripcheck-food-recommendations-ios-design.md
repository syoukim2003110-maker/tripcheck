# TripCheck iOS: `/api/food-recommendations` を食事枠に効かせる — 設計

**日付:** 2026-08-25
**ブランチ:** `claude/recommendations-ios`(`claude/architecture-v2` @ e329ca2 起点)
**位置づけ:** app セッション→paid ルートの **4 本目**。同じ Worker セッションを `/api/food-recommendations`(Google Places)に効かせ、旅程の**食事枠(`MealRow`)をタップすると近くの店の候補**を出す。

---

## 1. 範囲(正直な分解)

**やること(この spec):** **食事のみ・表示専用・base ルート(`/ai` なし)・タップ時 lazy 取得・テキストカード(写真なし)**。ビルド済みプランが公開する `FoodRecommendationSlot` を読み、タップされた枠のぶんだけ Worker に問い合わせて候補を出す。

**やらないこと(別スライスに後回し・理由付き):**
- **hotel / route(寄り道)推薦** — 構造的には可能(Kit は `Bases.hotelRouteContext(for:)` と `BuiltPlanBundle.gaps` を公開)だが、**食事の `MealRow` のような既存 UI seam が無い**(ホテルは per-trip、gap は UI 皆無)。別機能。
- **`/ai` 順位付け** — `ANTHROPIC_REQUESTS_ENABLED` の明示 on が要る(base は default-on)。base 候補だけで有用。v1.1。
- **写真** — `/api/place-photo`(signed_resource)を iOS はまだ消費していない。テキストカード + `googleMapsUrl` タップスルー。
- **eager 取得** — 食事推薦は **2 Google units/slot**。編集毎に再ビルドするので eager は浪費。**lazy(タップ時)**にする。
- **visitDate/visitTime** — web は「両方 or 両方無し」を要求(片方だけは 400)。v1 は**両方送らない**(現在営業 `openNow` は返る、来店時刻での `plannedOpen` は諦める)。

**Kit 凍結の帰結:** 孤立プロトコル `RecommendationSource` は**行き止まり**(呼び出し口が無く、準拠しても口はできない)。実 seam は `bundle.plan.foodRecommendationSlots` を直接読むこと。候補は **AppCore 側の store**(slot.id キー)に置き、エンジン型には入れない。

---

## 2. いま在るもの(実測済み)

- **ビルド済みプランが食事枠を公開(crux):** `BuiltTripPlan.foodRecommendationSlots: [FoodRecommendationSlot]`(Kit `BuiltPlan.swift`、Equatable/Sendable/Codable、**public memberwise init あり**)。`PlannerStore.bundle.plan.foodRecommendationSlots` 経由で読める。`FoodRecommendationSlot` フィールド: `id, dayIndex, dayLabel, date?, kind: MealKind(.lunch/.dinner), area, anchorStopId, latitude, longitude, window, displayTime, probeTime?, routePolyline?, rationale, queryIdeas: [String]`。radius は無い(下記 §4 で既定 1500m 相当を web が持つ)。
- **UI スタブが既にある:** `MealRow.swift`(app)doc に **「店の候補はここには出ない(次の spec)」**。`PlannerStore+Timeline.swift:151` が `plan.foodRecommendationSlots` を日で絞り `MealModel{slotId, kind, time, label}` を組む(座標等は落としているが slot 側に残っている、slot.id で引ける)。`MealRow` は `TimelineList.swift` の `.meal` case で描かれ、`plan.meal` の accessibility id 付き。
- **詳細シートの前例:** `Inspector` enum(`PlannerViewState.swift:27`、`Identifiable`、`case stop(String)/daySettings(Int)`)+ 唯一の入口 `openInspector(_:)`(`PlannerStore+ViewModel.swift`、`view.inspector` を書き detent を `.peek` に)+ `PlanScreen.swift` の `.sheet(item:$store.view.inspector)`(3 段 detent)。
- **weather パイプライン(テンプレート):** `weatherProvider: (any WeatherProviding)? = nil`(init 既定 nil=152 テスト非破壊)、`weatherGeneration`、`weatherTask`、`public internal(set) var weatherByDay`。`startWeatherEnrichment` が世代ガード付きでビルド後取得、`invalidateWeather` が世代 +1・読みかけ破棄・表示空。4 adopt 経路で呼ぶ。UI は `store.weatherByDay[i]` を直読み。**display-only なので食事の正しい鏡**(routes は再ビルドに戻すので別)。
- **Worker ゲート開通済み:** `/api/food-recommendations` は paid・`strict_same_origin`(=同一オリジン **または** app セッション)・featureFlag `FOOD_RECOMMENDATIONS_ENABLED` は **default-on**・quota=2 units。resolve/suggest/liveRoutes と同じ door。**web/Worker 追加実装ゼロ。**
- **web 契約(`app/api/food-recommendations/route.ts` / `lib/google-food.ts`):**
  - 要求 `FoodSearchRequest{ latitude, longitude, area(1–80), mealKind:"lunch"|"dinner", query(1–120、省略/null 可=server が既定語を補う), languageCode:"en"|"ja", destination, routePolyline?(10–10000), visitDate?/visitTime?(両方 or 両方無し) }`。
  - 応答 200 `{ provider:"google_maps", ranking:"evidence_weighted", fetchedAt, candidates:[FoodCandidate] }`。`FoodCandidate{ id, name, address, type, googleMapsUrl, latitude?, longitude?, distanceMeters:Int?, rating:Double?, userRatingCount:Int?, openNow:Bool?, hours:[String], websiteUrl:String?, ...(写真/評価片/決済は無視) }`。
  - エラー `{code:"invalid_request"}`(400)/`{code:"not_configured"}`(503)/`{code:"unavailable"}`(502)/ゲート否認(403/429/503)。

---

## 3. Global Constraints
- **web 不可侵**(`lib/**`・`app/api/**`・`worker/**`)。本機能は web/Worker 変更を要しない。
- **Kit 不可侵**(`Sources/TripCheckKit/`)。`FoodRecommendationSlot` 等は**読むだけ**。新規型・部品は `TripCheckAppCore` かアプリターゲット。
- **Swift 6 strict concurrency 新規警告ゼロ**、越境型は `Sendable`。
- **絵文字禁止。** 日本語 UI リテラルは `AppCopy.swift` のみ。
- **`git push` しない。**
- **表示/データ利用のみ:** TripCheck は Google の真偽を再判定しない。候補は破線枠の「提案」として出す(`MealRow` の Anchor/Filler 則を保つ)。
- **コミット trailer 厳守:** `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` / `Claude-Session: https://claude.ai/code/session_012DRrRBiU96fLJmvfThaR4J`。

---

## 4. アーキテクチャ

### 4.1 クライアント越しの取得 — `WorkerClient.foodRecommendations`
`resolvePlaces`/`suggestPlaces`/`liveRoutes` を鏡写し。`WorkerAuthenticating` に追加要件:
```swift
func foodRecommendations(_ payload: FoodRecommendationRequestPayload) async -> FoodRecommendationResult?
```
- `WorkerClient`: `ensureSession()` → `POST /api/food-recommendations`(session 付与)→ 200 デコード。**401 一回再試行**。非200/デコード不能は nil。
- `CannedWorkerClient` + テストスタブ(`StubWorker`/`SlowStubWorker`/`FakeRouteWorker`)= nil(**5 conformer 全実装**)。

### 4.2 越境モデル — 新規 `TripCheckAppCore/Worker/FoodRecommendationModels.swift`
```swift
public struct FoodRecommendationRequestPayload: Encodable, Sendable {
  public let latitude: Double
  public let longitude: Double
  public let area: String
  public let mealKind: String        // "lunch" | "dinner"
  public let query: String?          // nil → server が既定語(JSON では null=queryMissing)
  public let languageCode: String    // "ja" | "en"
  public let destination: String     // DestinationChoice.rawValue
  public let routePolyline: String?  // slot.routePolyline（範囲内のみ、なければ nil）
}   // visitDate/visitTime は struct に持たない=常に未送信=hasNoVisitPair
public struct FoodCandidate: Decodable, Sendable, Identifiable, Equatable {
  public let id: String
  public let name: String
  public let address: String
  public let type: String
  public let googleMapsUrl: String
  public let distanceMeters: Int?
  public let rating: Double?
  public let userRatingCount: Int?
  public let openNow: Bool?
  public let websiteUrl: String?
}   // 写真/評価片/決済/hours 等はデコードで無視
public struct FoodRecommendationResult: Decodable, Sendable {
  public let candidates: [FoodCandidate]
}
```

### 4.3 狭い seam + アダプタ — 新規 `TripCheckAppCore/Providers/FoodRecommender.swift`
weather の `WeatherProviding` / ① の `WorkerSuggestionAdapter` に倣う:
```swift
public protocol FoodRecommending: Sendable {
  func recommendations(_ payload: FoodRecommendationRequestPayload) async -> FoodRecommendationResult?
}
public struct WorkerFoodRecommender: FoodRecommending {   // withTaskGroup タイムアウトレース（既定 .seconds(8)）
  init(client: any WorkerAuthenticating, timeout: Duration = .seconds(8))
}
public enum FoodRecommendationAvailability {              // composition root だけが判定
  public static func makeDefaultProvider(uiTesting: Bool, client: any WorkerAuthenticating) -> (any FoodRecommending)?
  // uiTesting → nil（UI テストは候補を出さない=決定的）、それ以外 → WorkerFoodRecommender(client:)
}
```

### 4.4 lazy パイプライン — 新規 `TripCheckAppCore/Store/PlannerStore+FoodRecommendations.swift` + `PlannerStore.swift` フィールド
```swift
public enum FoodSlotRecommendations: Equatable, Sendable { case loading; case loaded([FoodCandidate]); case unavailable }
// PlannerStore に:
@ObservationIgnored let foodRecommendationProvider: (any FoodRecommending)?     // init 既定 nil
@ObservationIgnored var foodRecommendationGeneration = 0
@ObservationIgnored var foodRecommendationTasks: [String: Task<Void, Never>] = [:]
public internal(set) var foodRecommendationsBySlot: [String: FoodSlotRecommendations] = [:]
```
- **`public func loadFoodRecommendations(slotId: String)`(@MainActor、非 async):** `bundle?.plan.foodRecommendationSlots.first { $0.id == slotId }` を引く。既に `.loading`/`.loaded` なら何もしない(再取得しない)。それ以外(未取得 or `.unavailable`)なら `beginFoodFetch(slot)`。provider が nil なら即 `.unavailable`。
- **`func beginFoodFetch(_ slot: FoodRecommendationSlot)`(internal、テストが slot を直接渡して駆動):** `foodRecommendationsBySlot[slot.id] = .loading`、payload を組む(query=`slot.queryIdeas.joined(separator:" ")` を 1–120 に収め、外れれば nil;destination=`request.destination.rawValue`;languageCode=`request.locale.rawValue`;routePolyline=`slot.routePolyline` を 10–10000 に収め外れれば nil)、`let gen = foodRecommendationGeneration`、Task で `provider.recommendations(payload)` を待ち、**`guard foodRecommendationGeneration == gen, !Task.isCancelled`**、`foodRecommendationsBySlot[slot.id] = result.map { .loaded($0.candidates) } ?? .unavailable`。
- **`func invalidateFoodRecommendations()`:** `foodRecommendationGeneration &+= 1`、全 task cancel、`foodRecommendationTasks = [:]`、`foodRecommendationsBySlot = [:]`。**weather と同じ 4 adopt 経路**(`startWeatherEnrichment()` を呼ぶ 4 箇所)で呼ぶ(再ビルドで古い候補を消す)。

### 4.5 UI — Inspector case + シート + MealRow タップ
- `Inspector`(`PlannerViewState.swift`)に `case mealRecommendations(String)` を追加、`id` に `case .mealRecommendations(let slotId): "meal:\(slotId)"`。
- `MealRow`(app)を**タップ可能**にする:`@Environment(PlannerStore.self)` を足し、`.contentShape(Rectangle())` + `.onTapGesture { store.openInspector(.mealRecommendations(model.slotId)); store.loadFoodRecommendations(slotId: model.slotId) }`。末尾に控えめな「候補を見る」ヒント(`AppCopy`)。破線の提案スタイルは維持。accessibility に action/hint を足す。
- `PlanScreen.swift` の `.sheet` switch に `case .mealRecommendations(let slotId): FoodRecommendationSheet(slotId: slotId).presentationDetents([.fraction(0.3), .medium, .large], selection: detent).presentationDragIndicator(.visible)`。
- 新規 `Screens/Plan/FoodRecommendationSheet.swift`(app):`@Environment(PlannerStore.self)`、`store.foodRecommendationsBySlot[slotId]` を読み、`.loading`→スピナー、`.loaded([])`/`.unavailable`→「候補なし」文(`AppCopy`)、`.loaded(cands)`→各候補を**テキストカード**(name・type・★rating(userRatingCount)・距離・営業中バッジ・住所、`Link(googleMapsUrl)` でタップスルー)。`.task { store.loadFoodRecommendations(slotId: slotId) }` でも取得を起動(タップ経路と二重でも冪等)。写真は出さない。
- `AppCopy.swift` に必要文言(sheet タイトル「近くの食事」、「候補を見る」、「候補が見つかりませんでした」、「営業中」、評価/距離の補助)を ja/en で追加。

---

## 5. データフロー
1. ビルド後、`bundle.plan.foodRecommendationSlots` に食事枠(lunch/dinner)。`MealRow` が枠を破線で描く(候補はまだ無い)。
2. 旅行者が `MealRow` をタップ → `openInspector(.mealRecommendations(slotId))` + `loadFoodRecommendations(slotId)`。
3. パイプラインが slot を引き `.loading`→payload→`WorkerFoodRecommender`(8s レース)→ `.loaded(candidates)` or `.unavailable`。世代ガードで再ビルド跨ぎの stale を捨てる。
4. `FoodRecommendationSheet` が state を verbatim 表示。再ビルド/日付変更/reset で `invalidateFoodRecommendations` が候補を消す(次タップで再取得)。

---

## 6. エラー処理と劣化
| 事象 | 挙動 |
|---|---|
| provider nil(UI テスト/未構成) | 即 `.unavailable`(シートは「候補なし」)。 |
| Worker 未認証/オフライン/タイムアウト(>8s)/401 失敗/非200 | `.unavailable`。旅程・他の行は不変。 |
| 503 not_configured(鍵無し=ローカル) | `.unavailable`(ローカル `pnpm dev` で鍵未設定なら候補は出ない)。 |
| 再ビルド中に返ってきた古い取得 | 世代ガードで破棄。 |

**不変条件:** 食事枠の行そのもの(時刻・ラベル・破線)と旅程は、候補が出ようが出まいが不変。候補は純粋な追加表示。

---

## 7. テスト戦略
- **`FoodRecommendationModelsTests`(AppCore):** 応答 JSON をデコード(写真/評価片/hours 等の余剰を無視)、payload エンコード(`query: nil`→JSON `null`、visitDate/Time 不在、routePolyline nil→null)。
- **`WorkerClientTests`(AppCore):** FakeGateway に `/api/food-recommendations` ケース+`foodUnauthorizedOnce`、`foodRecommendations` が 401 一回再試行で成功、非200 で nil。
- **`PlannerStoreFoodRecommendationsTests`(AppCore):** `FoodRecommendationSlot` を**memberwise init で直接構築**し fake `FoodRecommending` を注入。①`beginFoodFetch` で `.loading`→`.loaded(cands)`。②nil 返し→`.unavailable`。③slow fake + 途中で `invalidateFoodRecommendations()`(世代 +1)→ 結果破棄・`foodRecommendationsBySlot` 空。④payload の写像(mealKind/languageCode/destination/query の 120 上限で nil/routePolyline 範囲)を fake が記録して検証。⑤provider nil の store で `loadFoodRecommendations`→ 即 `.unavailable`。
- **UI テスト(app):** サンプル旅程(seeExample)をビルドし、`plan.meal` が現れるなら 1 件タップ→シート id(`plan.mealRecommendations`)が出て、UI テストは provider nil ゆえ「候補なし」表示=**非回帰**。`plan.meal` が出ない構成なら、その旨を報告しパイプライン単体テスト+build に委ねる(flaky な必須タップにしない)。
- **回帰:** `apple/tools/verify-kit.sh`(**引数なし**)全緑、`apple/tools/verify-app.sh test` 全緑、新規警告ゼロ。web 無改変ゆえ web テスト対象外。

---

## 8. 決定(Rulings)
- **R1:** **食事のみ**を本スライスに。hotel/route は UI seam 不在ゆえ別機能に後回し(§1)。**コスト:** ユーザーが hotel/route も望めば追加スライスが要る(データは Kit に既にある)。
- **R2:** **lazy(タップ時)取得**、eager にしない。**コスト:** 初回タップに取得待ちが出る(スピナー)。quota 浪費を避ける(2 units/slot × 多枠 × 毎編集)。
- **R3:** タップした Google 候補は **provider-ref/place_id を web に通さない**(place-photo も含め signed 経路は範囲外)。候補は base ルートのテキストのみ + `googleMapsUrl` タップスルー。**コスト:** 写真無し。
- **R4:** `FoodRecommending` 狭い seam + `WorkerFoodRecommender` アダプタ(8s レース)+ `FoodRecommendationAvailability`(uiTesting→nil)。`foodRecommendations` を `WorkerAuthenticating` 要件に(5 conformer)。PlannerStore.init は既定 nil param(152 テスト非破壊)。**コスト:** なし(weather と同型)。
- **R5:** visitDate/visitTime を送らない(片方だけ 400 回避)。**コスト:** 来店時刻の `plannedOpen` は諦め、現在 `openNow` のみ。
- **R6:** 世代ガード全消し invalidate を weather と同じ 4 経路に。per-slot の座標変化(同 id・別座標)は二次リスク=フォローアップ。**コスト:** 稀に再ビルド直後の再タップで再取得。

## 9. Out of scope / 将来
- hotel 推薦(`Bases.hotelRouteContext`)/ route・寄り道推薦(`BuiltPlanBundle.gaps`)。
- `/ai` 順位付け(reason/tag)。写真(`/api/place-photo` signed)。visit 時刻での `plannedOpen`。app 側 feature-flag kill switch。
