# TripCheck iOS: `/api/route-recommendations` を「空き時間の寄り道」カードに効かせる — 設計

**日付:** 2026-08-26
**ブランチ:** `claude/route-detour-ios`(`claude/architecture-v2` @ 8efa191 起点)
**位置づけ:** 推薦ファミリーの最後(food ✅ / hotel ✅)。同じ Worker セッションを `/api/route-recommendations`(Google Search Along Route)に効かせ、**その日の空き時間に経路沿いで寄れる場所**を出す。

---

## 1. 範囲(正直な分解)

**やること:** **表示専用・base ルート(`/ai` は元々無い)・日ごとに開いた初回だけ lazy 取得・テキストのみ(写真なし)**。ビルド済みプランの `bundle.gaps[dayIndex]`(エンジンが既に算出済みの「その日のいちばん大きな空き」)を読み、`gaps[selectedDay] != nil` のとき Plan 画面に**新設の小さな「空き時間の寄り道」カード**を出し、タップで候補シートを開く。

**やらないこと(理由付き):**
- **タイムライン内への行挿入** — web は gap の `previousAnchorId` 位置にインライン行を挿すが、それは `TimelineRow` enum(closed)+ `timelineRows` + `TimelineList` の switch まで波及する侵襲的変更。**v1 は最も控えめな per-day カード**(hotel カードと同型、選択日の下)。タイムライン内挿入は v1.1。
- **写真**(`/api/place-photo` は iOS 到達不能、food/hotel と同じ)。**providerRef/座標**(表示に使わない)。**exclusion 以上の高度なフィルタ**。
- **eager 取得**(3 units/回)。日ごとに開いた初回だけ。

**Kit 凍結の帰結:** 候補は **AppCore 側 store(day index キーの dict)**に置く。読むのは `bundle.gaps`/`ItineraryGap`(public・既存・app 未読)だけ。

---

## 2. いま在るもの(実測済み)

- **エンジンは日ごとの空きを算出済み:** `BuiltPlanBundle.gaps: [Int: ItineraryGap]`(`BuiltPlanBundle.swift:19`、0 始まりの日→その日の最大の空き、空き無い日は欄ごと無い、`BuildRunner.swift:47-53` で毎ビルド算出、**app ターゲットは未読**)。`ItineraryGap{ id, dayIndex, kind, sizeBand, startAt:"HH:MM", endAt:"HH:MM", availableMinutes, previousAnchorId?, nextAnchorId?, routeSegment:{from:GeoPoint?, to:GeoPoint?}, suggestionKinds:[GapSuggestionKind] }`(Equatable/Sendable/Codable)。`GapSuggestionKind`(8種、String enum)。
- **`routeSegment.from/.to` は片方 nil あり:** `BETWEEN_ANCHORS` は両方非 nil、`BEFORE_FIRST_ANCHOR` は `from` が nil あり、`BEFORE_HOTEL_RETURN` は `to` が nil あり(`day.startBase`/`endBase` が Optional)。**必ず片方は非 nil**なので `[from, to].compactMap { $0 }` は常に ≥1 点。防御的に扱う。
- **UI:** `SpareLine` は `bundle.fit.days`(別パイプライン)由来で `bundle.gaps` と一致保証が無い → **UI ホームに使わない**。`PlanScreen.swift` は `selectedDay = store.view.selectedDay` を持ち、`ScrollView{ VStack{ …TimelineList → (SpareLine) → … IssueCard → (SuggestedHotelsCard) → BeforeYouGoCard } }`。**カードは `SuggestedHotelsCard` の隣**(itinerary の後の低優先ゾーン)に置く。
- **hotel が敷いた道(鏡写し):** `WorkerClient.hotelRecommendations` + `HotelRecommendationModels` + `HotelRecommending`/`WorkerHotelRecommender`/`HotelRecommendationAvailability` + `PlannerStore+HotelRecommendations`(lazy・世代ガード・単一 state) + 合成の根配線。寄り道は **day index キーの dict**(food の per-slot dict と同型)。
- **Worker ゲート開通済み:** `/api/route-recommendations` は paid・`strict_same_origin`・**featureFlag `ROUTE_RECOMMENDATIONS_ENABLED` は default-on**・quota=3・app セッション認可済み・`/ai` 無し。**web/Worker 追加実装ゼロ。**
- **web 契約(`app/api/route-recommendations/route.ts` / `lib/route-recommendations.ts`):**
  - 要求 `RouteRecommendationRequest{ routePoints:[{latitude,longitude}](1–12), excludedPlaceIds:[String], excludedNames:[String], languageCode:"en"|"ja", destination, suggestionKinds?:[GapSuggestionKind] }`。必須: routePoints(≥1)、languageCode、destination。excludedPlaceIds/Names は配列で送る(空可)。suggestionKinds は任意。
  - 応答 `{ provider:"google_maps", fetchedAt, candidates: RouteRecommendation[] }`。`RouteRecommendation{ id, providerRef, name, address, type, googleMapsUrl, latitude, longitude, rating?, userRatingCount?, routeDistanceMeters, photoName?, ... }`。**v1 は id/name/address/type/googleMapsUrl/rating?/userRatingCount?/routeDistanceMeters? だけデコード**(providerRef/座標/photo は無視)。
  - エラー `{code:"invalid_request"}`(400)/`{code:"not_configured"}`(503)/`{code:"unavailable"}`(502)/否認。

---

## 3. Global Constraints
- **web 不可侵**(`lib/**`・`app/api/**`・`worker/**`)。本機能は web/Worker 変更を要しない。
- **Kit 不可侵**(`Sources/TripCheckKit/`)。`bundle.gaps`/`ItineraryGap`/`GapSuggestionKind`/`GeoPoint` は**読むだけ**。新規は `TripCheckAppCore` かアプリターゲット。
- **Swift 6 strict concurrency 新規警告ゼロ**、越境型は `Sendable`。
- **絵文字禁止**(星も数値)。日本語 UI リテラルは `AppCopy.swift` のみ。
- **`git push` しない。**
- **表示/データ利用のみ:** 候補は破線の「提案」カード。
- **コミット trailer 厳守:** `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` / `Claude-Session: https://claude.ai/code/session_012DRrRBiU96fLJmvfThaR4J`。

---

## 4. アーキテクチャ(hotel を鏡写し、day index キー)

### 4.1 クライアント — `WorkerClient.routeRecommendations`
`WorkerAuthenticating` に `func routeRecommendations(_ payload: RouteRecommendationRequestPayload) async -> RouteRecommendationResult?`。`hotelRecommendations` を鏡写し(POST `/api/route-recommendations`、401 一回再試行)。Canned + テストスタブ 3 つ = nil(**7 conformer 全実装**)。

### 4.2 越境モデル — 新規 `TripCheckAppCore/Worker/RouteDetourModels.swift`
```swift
import Foundation
import TripCheckKit   // GeoPoint

public struct RouteRecommendationRequestPayload: Encodable, Sendable {
  public let routePoints: [GeoPoint]        // {latitude,longitude} に符号化。≥1、≤12(実際は 1–2)
  public let excludedPlaceIds: [String]     // 既に旅程にある場所を避ける
  public let excludedNames: [String]
  public let languageCode: String           // "ja" | "en"
  public let destination: String            // DestinationChoice.rawValue
  public let suggestionKinds: [String]      // gap.suggestionKinds.map(\.rawValue)
}
public struct RouteRecommendation: Decodable, Sendable, Identifiable, Equatable {
  public let id: String
  public let name: String
  public let address: String
  public let type: String
  public let googleMapsUrl: String
  public let rating: Double?
  public let userRatingCount: Int?
  public let routeDistanceMeters: Double?
}   // providerRef/latitude/longitude/photo* は無視
public struct RouteRecommendationResult: Decodable, Sendable, Equatable {
  public let candidates: [RouteRecommendation]
}
```

### 4.3 狭い seam + アダプタ — 新規 `TripCheckAppCore/Providers/RouteDetourRecommender.swift`
`HotelRecommender.swift` に倣う:`protocol RouteDetourRecommending{ func recommendations(_:) async -> RouteRecommendationResult? }`、`struct WorkerRouteDetourRecommender(client:timeout: .seconds(8))`(withTaskGroup レース)、`enum RouteDetourAvailability{ makeDefaultProvider(uiTesting:client:) }`(uiTesting→nil)。

### 4.4 lazy パイプライン(day index キー) — 新規 `TripCheckAppCore/Store/PlannerStore+RouteDetour.swift` + `PlannerStore.swift`
```swift
public enum GapDetourState: Equatable, Sendable { case loading; case loaded([RouteRecommendation]); case unavailable }
// PlannerStore に:
@ObservationIgnored let routeDetourProvider: (any RouteDetourRecommending)?   // init 既定 nil
@ObservationIgnored var routeDetourGeneration = 0
@ObservationIgnored var routeDetourTasks: [Int: Task<Void, Never>] = [:]
public internal(set) var gapDetourByDay: [Int: GapDetourState] = [:]
```
- **`public func gapDetourAvailable(_ dayIndex: Int) -> Bool`:** `bundle?.gaps[dayIndex] != nil`。カード表示可否。
- **`public func gapDetourTimeRange(_ dayIndex: Int) -> String?`:** `bundle?.gaps[dayIndex].map { "\($0.startAt)–\($0.endAt)" }`。カードの時刻表示(view は verbatim)。
- **`public func loadGapDetour(dayIndex: Int)`:** `guard let bundle, let gap = bundle.gaps[dayIndex]` else return。既に `.loading`/`.loaded` なら return。それ以外 `beginGapDetourFetch(dayIndex: dayIndex, gap: gap, plan: bundle.plan)`。provider nil なら `.unavailable`。
- **`func beginGapDetourFetch(dayIndex: Int, gap: ItineraryGap, plan: BuiltTripPlan)`(internal、テストが直接呼ぶ):** `.loading` を置き、payload を組む:
  - `routePoints = [gap.routeSegment.from, gap.routeSegment.to].compactMap { $0 }`(≥1)。
  - `excludedPlaceIds = plan.days.flatMap { $0.stops }.compactMap { $0.stop.providerRef }`、`excludedNames = plan.days.flatMap { $0.stops }.map { $0.stop.name }`(全日の停留所)。
  - `suggestionKinds = gap.suggestionKinds.map { $0.rawValue }`、`languageCode = request.locale.rawValue`、`destination = request.destination.rawValue`。
  世代を捕まえ、`routeDetourTasks[dayIndex]` に `[weak self]` Task。**`guard routeDetourGeneration == gen, !Task.isCancelled`**、`gapDetourByDay[dayIndex] = .loaded/.unavailable`。
- **`func invalidateRouteDetour()`:** 世代 +1・全 task cancel・両 dict クリア。**food/hotel と同じ 5 経路**で呼ぶ。

### 4.5 合成の根での配線 — `apple/TripCheck/App/TripCheckApp.swift`(**配線必須**)
`PlannerStore.init` に `routeDetourProvider: RouteDetourAvailability.makeDefaultProvider(uiTesting: isUITesting, client: workerClient)`(既存 provider 群の隣、宣言順に合わせる)。UI テストは nil。

### 4.6 UI — 新設カード + シート
- 新規 `apple/TripCheck/Screens/Plan/GapDetourCard.swift`:`let dayIndex: Int`、`@Environment(PlannerStore.self)`、`@State private var showing = false`。`SuggestedHotelsCard` 風の破線カード(見出し `app.gapDetourTitle` + `store.gapDetourTimeRange(dayIndex)`、既存 `IconView` の実在 glyph か省く)。`.onTapGesture { showing = true }` + `.accessibilityAddTraits(.isButton)` + `.accessibilityIdentifier("plan.gapDetour")`。`.sheet(isPresented: $showing) { RouteDetourSheet(dayIndex: dayIndex).presentationDetents([.medium, .large]) }`。
- `PlanScreen.swift`:`SuggestedHotelsCard` の隣に `if store.gapDetourAvailable(selectedDay) { GapDetourCard(dayIndex: selectedDay) }`。
- 新規 `apple/TripCheck/Screens/Plan/RouteDetourSheet.swift`(`HotelRecommendationsSheet` を鏡写し):`let dayIndex: Int`。`.task { store.loadGapDetour(dayIndex: dayIndex) }` + `.onChange(of: store.gapDetourByDay[dayIndex]){ if $0 == nil { store.loadGapDetour(dayIndex: dayIndex) } }`。state を表示:`.loading`/nil→スピナー、`.unavailable`/`.loaded([])`→「候補なし」、`.loaded(cs)`→各 `RouteRecommendation` をカード(name、type、★数値 rating(count)、`routeDistanceMeters` を「経路から約 N m」、address、`Link(googleMapsUrl)`)。写真なし。各カードに `.accessibilityIdentifier("plan.detourCandidate")`。
- `AppCopy.swift` に文言(カード見出し「空き時間の寄り道」、シート題「経路沿いの寄り道」、「候補が見つかりませんでした」、距離補助)を ja/en 追加。

---

## 5. データフロー
1. ビルド後、選択日に `gaps[selectedDay] != nil` なら「空き時間の寄り道」カード(時刻範囲付き、まだ取得しない)。
2. タップ→シート→`.task` で `loadGapDetour(selectedDay)`→gap を引き `.loading`→payload(routePoints=segment の非 nil 端点、excluded=全停留所、suggestionKinds=gap)→`WorkerRouteDetourRecommender`(8s レース)→`.loaded`/`.unavailable`。世代ガードで stale 破棄。
3. シートが state を verbatim 表示。再ビルド/日付変更/reset で `invalidateRouteDetour` が消す。

---

## 6. エラー処理と劣化
| 事象 | 挙動 |
|---|---|
| その日に空き無し(gaps[day] nil) | カード自体が出ない。 |
| provider nil / 未認証 / タイムアウト(>8s) / 401 失敗 / 非200 / Search Along Route が同一端点で空 | `.unavailable`。旅程は不変。 |
| 503 not_configured(鍵無し) | `.unavailable`。 |
| 再ビルド中の古い取得 | 世代ガードで破棄。 |

**不変条件:** カードは純粋な追加表示。旅程・タイムライン・feasibility は不変。

---

## 7. テスト戦略
- **`RouteDetourModelsTests`(AppCore):** 応答 JSON デコード(providerRef/座標/photo の余剰無視)、payload エンコード(routePoints/excluded 配列/suggestionKinds が入る)。
- **`WorkerClientTests`(AppCore):** FakeGateway に `/api/route-recommendations` ケース+`routeUnauthorizedOnce`、401 一回再試行で成功、非200 で nil。
- **`PlannerStoreRouteDetourTests`(AppCore):** `ItineraryGap` を memberwise init で構築し fake `RouteDetourRecommending` 注入。①`beginGapDetourFetch`→`.loading`→`.loaded`(payload の routePoints が segment の非 nil 端点、suggestionKinds=gap、excluded が渡る)。②`routeSegment.from` のみ非 nil の gap→routePoints が 1 点。③nil→`.unavailable`。④slow fake + `invalidateRouteDetour()`→世代ガード破棄・dict 空。⑤provider nil→`.unavailable`。⑥`loadGapDetour` は bundle が無ければ何もしない(state 作らない)。
- **UI テスト(app):** provider nil ゆえ、カードが出る旅程に到達できれば開いて「候補なし」表示=非回帰。到達可否を実測し決定的なら assert(flaky にしない)。
- **回帰:** `apple/tools/verify-kit.sh`(引数なし)全緑、`apple/tools/verify-app.sh test` 全緑、新規警告ゼロ。

---

## 8. 決定(Rulings)
- **R1:** **per-day カード**(タイムライン内挿入でなく)。`TimelineRow` enum を触らず低リスク。**コスト:** gap の正確な位置には出ない(カードは日の下)。v1.1 でインライン化可。
- **R2:** routePoints は `[from, to].compactMap`(片 nil 防御、常に ≥1)。**コスト:** 端点 1 つの日は始点=終点に近い探索(web は同一端点で空を返しうる→`.unavailable`)。
- **R3:** excluded は**全日の停留所**の providerRef/name(web の実挙動どおり、既に旅程にある場所を避ける)。**コスト:** なし。
- **R4:** **day index キーの dict**(food と同型)。**コスト:** なし。
- **R5:** hotel と同じ seam+アダプタ+availability+世代ガード lazy+init 既定 nil+**合成の根配線必須**。`routeRecommendations` を `WorkerAuthenticating` に(7 conformer)。
- **R6:** テキストのみ、写真/providerRef/座標は落とす。**コスト:** 簡素。

## 9. Out of scope / 将来
- タイムライン内インライン行(gap 位置)。写真。suggestionKinds の UI 選択。1 日複数 gap(今は最大 1 つ)。
