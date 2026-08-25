# TripCheck iOS: `/api/hotel-recommendations` を「近くの宿」カードに効かせる — 設計

**日付:** 2026-08-26
**ブランチ:** `claude/hotel-recommendations-ios`(`claude/architecture-v2` @ 698dc6f 起点)
**位置づけ:** 推薦ファミリーの残り(食事は完了)。同じ Worker セッションを `/api/hotel-recommendations`(Google Places)に効かせ、**プランの経路に近い宿の候補**を出す。

---

## 1. 範囲(正直な分解)

**やること:** **表示専用・base ルート(`/ai` なし)・プラン単位で開いた初回だけ lazy 取得・テキストのみ(写真/Rakuten なし)**。ビルド済みプランから `Bases.hotelRouteContext` で経路アンカーを得て、`hotelRouteContext != nil` のとき Plan 画面に**新設の小さな「近くの宿」カード**を出し、タップで候補シートを開く。

**やらないこと(理由付き):**
- **宿の選択/経路影響の比較/再最適化** — web の本格ホテル機能(`HotelInspector`/`useHotels`)は選択して `selectedBase` を変え再最適化する 1000 行超のツール。**iOS v1 は意図的に薄い非対話スライス**(候補を眺めるだけ、選択も再最適化もしない)。パリティではない。
- **`/ai` 順位付け**(v1.1)。**写真**(`/api/place-photo` は iOS 到達不能=`Sec-Fetch-Site` ゲート、food と同じ)。**Rakuten**(日本限定・条件付き・デコード面倍増、v1.1 で `minCharge`/`url` を足せる)。
- **query(名前指定検索)** — iOS に検索テキスト UI が無く、宿未選択のときこそ有用なので **query 無し=自動探索(4 units)**。
- **eager 取得** — 4 units/回。開いた初回だけ。

**Kit 凍結の帰結:** 候補は **AppCore 側 store(プラン単位の単一 state)**に置く。読むのは `Bases.hotelRouteContext(for: bundle.plan)`(public・既存)だけ。

---

## 2. いま在るもの(実測済み)

- **エントリポイントは新設が要る(自然な UI ホーム無し):** `BeforeYouGoCard` は出発前チェックリスト(話題違い)。`HotelLegRow`/地図のホテルピンは **base 解決済みのときだけ**出て(`guard base != nil`、`PlannerStore+Timeline.swift:276`)ピンは非対話設計。→ **小さな独立カードを新設**(`MealRow` の破線「提案」スタイル)。
- **経路アンカーは即使える:** `Bases.hotelRouteContext(for plan: BuiltTripPlan) -> HotelRouteContext?`(`Bases.swift`、scheduled stops のみ・**base 非依存**、stops が無いときだけ nil)。`HotelRouteContext{ latitude, longitude, area, routePoints:[HotelRoutePoint], spreadKm }`(Hashable/Sendable/Codable)。`HotelRoutePoint = GeoPoint`(`typealias`、`{latitude,longitude}`)なので `routePoints:[GeoPoint]` は web の `routePoints:[{latitude,longitude}]` に直結。
- **Plan 画面の構造:** `PlanScreen.swift` は `ScrollView { VStack { … TimelineList → (SpareLine) → … IssueCard() → BeforeYouGoCard() } }`。**カードは `BeforeYouGoCard()` の直前**(itinerary の後の低優先ゾーン)に置く。
- **food が敷いた道(鏡写し):** `WorkerClient.foodRecommendations` + `FoodRecommendationModels` + `FoodRecommending`/`WorkerFoodRecommender`/`FoodRecommendationAvailability` + `PlannerStore+FoodRecommendations`(lazy・世代ガード) + 合成の根配線。ホテルは**プラン単位の単一 state**(per-slot dict でなく)にして同型。
- **Worker ゲート開通済み:** `/api/hotel-recommendations` は paid・`strict_same_origin`・**featureFlag `HOTEL_RECOMMENDATIONS_ENABLED` は default-on**・quota=`query ? 1 : 4`(v1 は query 無し=4)・app セッション認可済み。**web/Worker 追加実装ゼロ。**
- **web 契約(`app/api/hotel-recommendations/route.ts` / `lib/google-hotels.ts`):**
  - 要求 `HotelSearchRequest{ latitude, longitude, area, query?, routePoints?:[{latitude,longitude}], languageCode:"en"|"ja", destination }`。
  - 応答 `{ provider, fetchedAt, evidenceProviders:{rakuten}, candidates: HotelCandidate[] }`。`HotelCandidate{ id, name, address, googleMapsUrl, websiteUrl?, latitude, longitude, rating?, userRatingCount?, distanceMeters, routeBurdenMeters, score, priceLevel?, styles:[…], photo?, reviews?, payment?, rakuten? }`。**v1 は id/name/address/googleMapsUrl/rating?/userRatingCount?/distanceMeters?/routeBurdenMeters?/priceLevel?/websiteUrl? だけデコード**(photo/reviews/payment/rakuten/styles/score/座標は無視)。
  - エラー `{code:"invalid_request"}`(400)/`{code:"not_configured"}`(503)/`{code:"unavailable"}`(502)/否認。

---

## 3. Global Constraints
- **web 不可侵**(`lib/**`・`app/api/**`・`worker/**`)。本機能は web/Worker 変更を要しない。
- **Kit 不可侵**(`Sources/TripCheckKit/`)。`Bases.hotelRouteContext`/`HotelRouteContext` は**読むだけ**。新規は `TripCheckAppCore` かアプリターゲット。
- **Swift 6 strict concurrency 新規警告ゼロ**、越境型は `Sendable`。
- **絵文字禁止**(星も数値表記)。日本語 UI リテラルは `AppCopy.swift` のみ。
- **`git push` しない。**
- **表示/データ利用のみ:** Google の真偽を再判定しない。宿は破線の「提案」カード。
- **コミット trailer 厳守:** `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` / `Claude-Session: https://claude.ai/code/session_012DRrRBiU96fLJmvfThaR4J`。

---

## 4. アーキテクチャ(food を鏡写し、プラン単位)

### 4.1 クライアント — `WorkerClient.hotelRecommendations`
`WorkerAuthenticating` に追加要件 `func hotelRecommendations(_ payload: HotelRecommendationRequestPayload) async -> HotelRecommendationResult?`。`foodRecommendations` を鏡写し(ensureSession・POST `/api/hotel-recommendations`・401 一回再試行・非200/デコード不能は nil)。Canned + テストスタブ(`StubWorker`/`SlowStubWorker`/`FakeRouteWorker`)= nil(**6 conformer 全実装**)。

### 4.2 越境モデル — 新規 `TripCheckAppCore/Worker/HotelRecommendationModels.swift`
```swift
import Foundation
import TripCheckKit   // GeoPoint

public struct HotelRecommendationRequestPayload: Encodable, Sendable {
  public let latitude: Double
  public let longitude: Double
  public let area: String
  public let routePoints: [GeoPoint]   // {latitude,longitude} に符号化。query は送らない(自動探索)
  public let languageCode: String      // "ja" | "en"
  public let destination: String       // DestinationChoice.rawValue
}
public struct HotelCandidate: Decodable, Sendable, Identifiable, Equatable {
  public let id: String
  public let name: String
  public let address: String
  public let googleMapsUrl: String
  public let websiteUrl: String?
  public let rating: Double?
  public let userRatingCount: Int?
  public let distanceMeters: Double?
  public let routeBurdenMeters: Double?
  public let priceLevel: String?       // HotelPriceLevel は文字列 enum。実型を確認し合わせる。無ければ String? のまま(不一致は nil)
}   // photo/reviews/payment/rakuten/styles/score/latitude/longitude は無視
public struct HotelRecommendationResult: Decodable, Sendable, Equatable {
  public let candidates: [HotelCandidate]
}
```

### 4.3 狭い seam + アダプタ — 新規 `TripCheckAppCore/Providers/HotelRecommender.swift`
`FoodRecommender.swift` に倣う:`protocol HotelRecommending{ func recommendations(_:) async -> HotelRecommendationResult? }`、`struct WorkerHotelRecommender(client:timeout: .seconds(8))`(withTaskGroup レース)、`enum HotelRecommendationAvailability{ makeDefaultProvider(uiTesting:client:) }`(uiTesting→nil)。

### 4.4 lazy パイプライン(プラン単位) — 新規 `TripCheckAppCore/Store/PlannerStore+HotelRecommendations.swift` + `PlannerStore.swift`
```swift
public enum HotelRecommendationsState: Equatable, Sendable { case loading; case loaded([HotelCandidate]); case unavailable }
// PlannerStore に:
@ObservationIgnored let hotelRecommendationProvider: (any HotelRecommending)?   // init 既定 nil
@ObservationIgnored var hotelRecommendationGeneration = 0
@ObservationIgnored var hotelRecommendationTask: Task<Void, Never>?
public internal(set) var hotelRecommendations: HotelRecommendationsState?       // プラン単位の単一 state
```
- **`public var hotelRecommendationsAvailable: Bool`**(computed):`bundle.map { Bases.hotelRouteContext(for: $0.plan) != nil } ?? false`。カードの表示可否。
- **`public func loadHotelRecommendations()`:** `guard let bundle, let ctx = Bases.hotelRouteContext(for: bundle.plan)` else return。既に `.loading`/`.loaded` なら return。それ以外 `beginHotelFetch(ctx)`。provider nil なら `.unavailable`。
- **`func beginHotelFetch(_ ctx: HotelRouteContext)`(internal、テストが ctx を直接渡す):** `.loading` を置き、payload(`latitude/longitude/area/routePoints = ctx.*`、`languageCode = request.locale.rawValue`、`destination = request.destination.rawValue`)を組み、世代を捕まえ、`[weak self]` Task で `provider.recommendations` を待ち、**`guard hotelRecommendationGeneration == gen, !Task.isCancelled`**、`.loaded`/`.unavailable`。
- **`func invalidateHotelRecommendations()`:** 世代 +1・task cancel・`hotelRecommendations = nil`。**food と同じ 5 経路**(各 `invalidateFoodRecommendations()` の隣)で呼ぶ。

### 4.5 合成の根での配線 — `apple/TripCheck/App/TripCheckApp.swift`(**配線必須**)
`PlannerStore.init` に `hotelRecommendationProvider: HotelRecommendationAvailability.makeDefaultProvider(uiTesting: isUITesting, client: workerClient)`(`foodRecommendationProvider` の隣、同一 workerClient)。UI テストは nil。

### 4.6 UI — 新設カード + シート
- 新規 `apple/TripCheck/Screens/Plan/SuggestedHotelsCard.swift`:`@Environment(PlannerStore.self)`。`MealRow` 風の破線カード(`Tokens.Color.recommendation`、既存 `IconView` の実在 glyph を使うか省く=**bed アイコンは無いので既存の近い glyph か無し**)。見出しは `AppCopy`。`.contentShape(Rectangle())` + `.onTapGesture { showing = true }`(`@State private var showing = false`)。`.sheet(isPresented: $showing) { HotelRecommendationsSheet() }`。
- `PlanScreen.swift`:`BeforeYouGoCard()` の直前に `if store.hotelRecommendationsAvailable { SuggestedHotelsCard() }`。
- 新規 `apple/TripCheck/Screens/Plan/HotelRecommendationsSheet.swift`(`FoodRecommendationSheet` を鏡写し):`.task { store.loadHotelRecommendations() }` + `.onChange(of: store.hotelRecommendations){ if $0 == nil { store.loadHotelRecommendations() } }`(背景 invalidate 中の自己回復、④/食事と同じ)。state を verbatim 表示:`.loading`→スピナー、`.loaded([])`/`.unavailable`→「候補なし」、`.loaded`→テキストカード(name、★数値 rating(count)、`routeBurdenMeters` を「経路から約 N km」、priceLevel、address、`Link(googleMapsUrl)`)。写真なし。
- `AppCopy.swift` に文言(カード見出し「近くの宿」、シート題「経路に近い宿」、「候補が見つかりませんでした」、priceLevel/距離の補助)を ja/en 追加。

---

## 5. データフロー
1. ビルド後 `hotelRouteContext != nil` なら Plan 画面に「近くの宿」カード(まだ取得しない)。
2. タップ→シート→`.task` で `loadHotelRecommendations()`→`ctx` を引き `.loading`→payload(query 無し=自動探索)→`WorkerHotelRecommender`(8s レース)→`.loaded`/`.unavailable`。世代ガードで stale 破棄。
3. シートが state を verbatim 表示。再ビルド/日付変更/reset で `invalidateHotelRecommendations` が消す。

---

## 6. エラー処理と劣化
| 事象 | 挙動 |
|---|---|
| stops 無し(hotelRouteContext nil) | カード自体が出ない。 |
| provider nil(UI テスト/未構成) | シート開くと `.unavailable`。 |
| 未認証/オフライン/タイムアウト(>8s)/401 失敗/非200 | `.unavailable`。旅程は不変。 |
| 503 not_configured(鍵無し) | `.unavailable`。 |
| 再ビルド中の古い取得 | 世代ガードで破棄。 |

**不変条件:** カードは純粋な追加表示。旅程・feasibility・停留所は不変。

---

## 7. テスト戦略
- **`HotelRecommendationModelsTests`(AppCore):** 応答 JSON デコード(photo/reviews/payment/rakuten/styles の余剰無視)、payload エンコード(`routePoints` が `[{latitude,longitude}]`、query キーが**無い**)。
- **`WorkerClientTests`(AppCore):** FakeGateway に `/api/hotel-recommendations` ケース+`hotelUnauthorizedOnce`、`hotelRecommendations` が 401 一回再試行で成功、非200 で nil。
- **`PlannerStoreHotelRecommendationsTests`(AppCore):** `HotelRouteContext` を memberwise init で構築し fake `HotelRecommending` 注入。①`beginHotelFetch`→`.loading`→`.loaded`(payload の routePoints/area/destination/languageCode 検証、query 無し)。②nil→`.unavailable`。③slow fake + `invalidateHotelRecommendations()`→世代ガード破棄・`hotelRecommendations == nil`。④provider nil→`.unavailable`。
- **UI テスト(app):** UI テストは provider nil ゆえ、カードが出る旅程に到達できれば開いて「候補なし」表示=非回帰。`hotelRouteContext` が UI テストのサンプルで非 nil になるか実測し、決定的に出せる場合のみ assert(flaky にしない)。
- **回帰:** `apple/tools/verify-kit.sh`(引数なし)全緑、`apple/tools/verify-app.sh test` 全緑、新規警告ゼロ。

---

## 8. 決定(Rulings)
- **R1:** **query 無し=自動探索(4 units)**。iOS に検索テキスト UI が無く、宿未選択時に最有用。**コスト:** 4 units/取得(maxPerTrip 60 ≈ 15 回)。
- **R2:** アンカーは常に `Bases.hotelRouteContext`(base 非依存)。`selectedBase` の座標に差し替える配線は Kit に無いので入れない。**コスト:** 宿選択済みでも経路中心で探す(概ね妥当)。
- **R3:** **カードは新設**、`BeforeYouGoCard` の前、`hotelRouteContext != nil` でのみ。**HotelLegRow/地図ピンは再利用しない**(base 解決時のみ+非対話で、宿未選択の最有用ケースで消える)。**コスト:** 新 UI 面 1 つ。
- **R4:** **プラン単位の単一 state**(food の per-slot dict でなく)。**コスト:** なし。
- **R5:** food と同じ seam+アダプタ+availability+世代ガード lazy+init 既定 nil+**合成の根配線必須**。`hotelRecommendations` を `WorkerAuthenticating` に(6 conformer)。
- **R6:** テキストのみ、写真/Rakuten/reviews/payment/styles/score は落とす。**コスト:** 簡素(v1.1 で Rakuten `minCharge`/`url` 追加可)。

## 9. Out of scope / 将来
- 宿の選択→`selectedBase` 変更→再最適化(web パリティ)。`/ai`。写真。Rakuten 価格。非対話ピンの対話化。
