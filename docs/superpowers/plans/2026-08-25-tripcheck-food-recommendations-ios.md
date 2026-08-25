# TripCheck iOS food-recommendations 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development でタスク単位に実装する。各ステップは `- [ ]`。

**Goal:** 旅程の食事枠(`MealRow`)をタップすると、Worker 経由で `/api/food-recommendations`(Google Places)から近くの店の候補を取り、既存の詳細シートに**テキストカード**で出す。表示専用・base ルート・lazy 取得。web/Kit 無改変。

**Architecture:** `WorkerClient.foodRecommendations`(resolve/suggest/liveRoutes を鏡写し)→ 狭い seam `FoodRecommending` + `WorkerFoodRecommender`(8s レース)→ weather 型の世代ガード付き lazy パイプライン `PlannerStore+FoodRecommendations`(タップ時取得、slot.id キャッシュ)→ `Inspector.mealRecommendations` シート + `MealRow` タップ。

**Tech Stack:** Swift 6、SwiftUI、`@Observable`/`@MainActor`、swift-testing + XCTest、XCUITest。

**Spec:** `docs/superpowers/specs/2026-08-25-tripcheck-food-recommendations-ios-design.md`

## Global Constraints
- **web 不可侵**(`lib/**`・`app/api/**`・`worker/**`)。本機能は web/Worker 変更を要しない(`/api/food-recommendations` は既に paid・app セッション認可・FOOD default-on・quota=2)。
- **Kit 不可侵**(`Sources/TripCheckKit/`)。`FoodRecommendationSlot`/`BuiltTripPlan` は**読むだけ**。新規は `TripCheckAppCore` かアプリターゲット。
- **Swift 6 strict concurrency 新規警告ゼロ。** 越境型は `Sendable`。
- **絵文字禁止。** 日本語 UI リテラルは `AppCopy.swift` のみ。星などは絵文字を使わず `IconView` か文字。
- **`git push` しない。**
- **コミット trailer 厳守:**
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_012DRrRBiU96fLJmvfThaR4J
  ```
- **検証:** `apple/tools/verify-kit.sh`(**引数なし**)全緑、`apple/tools/verify-app.sh test`(app unit/UI)全緑、新規警告ゼロ。

---

### Task 1: 取得の配管(モデル + クライアント + 5 スタブ + テスト)

**Files:**
- Create: `apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Worker/FoodRecommendationModels.swift`
- Modify: `.../Worker/WorkerAuthState.swift`、`.../Worker/WorkerClient.swift`、`.../Worker/CannedWorkerClient.swift`
- Modify(nil スタブ): `.../Tests/TripCheckAppCoreTests/WorkerPlaceResolverTests.swift`（`StubWorker`・`SlowStubWorker`）、`.../Tests/TripCheckAppCoreTests/WorkerRouteProviderTests.swift`（`FakeRouteWorker`）
- Modify: `.../Tests/TripCheckAppCoreTests/WorkerClientTests.swift`
- Create: `.../Tests/TripCheckAppCoreTests/FoodRecommendationModelsTests.swift`

**Interfaces:**
- Produces: `FoodRecommendationRequestPayload`(Encodable/Sendable)、`FoodCandidate`(Decodable/Sendable/Identifiable)、`FoodRecommendationResult`(Decodable/Sendable)、`WorkerAuthenticating.foodRecommendations(_:) async -> FoodRecommendationResult?`。

- [ ] **Step 1: 失敗テストを書く** — Create `FoodRecommendationModelsTests.swift`:
  ```swift
  import XCTest
  @testable import TripCheckAppCore

  final class FoodRecommendationModelsTests: XCTestCase {
    func testDecodesCandidatesIgnoringRichFields() throws {
      let json = #"""
      {"provider":"google_maps","ranking":"evidence_weighted","fetchedAt":"t","candidates":[
        {"id":"c1","name":"Trattoria","address":"1 Via Roma","type":"italian_restaurant","googleMapsUrl":"https://maps.google/x",
         "latitude":1.0,"longitude":2.0,"distanceMeters":240,"rating":4.4,"userRatingCount":812,"openNow":true,
         "hours":["Mon 11-22"],"businessStatus":"OPERATIONAL","paymentEvidence":[],"reviewSnippets":[],
         "websiteUrl":"https://t.example","photoName":"places/x/photos/y","photoSignature":"sig"}
      ]}
      """#
      let result = try JSONDecoder().decode(FoodRecommendationResult.self, from: Data(json.utf8))
      XCTAssertEqual(result.candidates.count, 1)
      let c = try XCTUnwrap(result.candidates.first)
      XCTAssertEqual(c.id, "c1")
      XCTAssertEqual(c.name, "Trattoria")
      XCTAssertEqual(c.type, "italian_restaurant")
      XCTAssertEqual(c.distanceMeters, 240)
      XCTAssertEqual(c.rating, 4.4)
      XCTAssertEqual(c.userRatingCount, 812)
      XCTAssertEqual(c.openNow, true)
      XCTAssertEqual(c.websiteUrl, "https://t.example")
    }

    func testDecodesNullNumericFields() throws {
      let json = #"{"candidates":[{"id":"c2","name":"X","address":"","type":"cafe","googleMapsUrl":"u","distanceMeters":null,"rating":null,"userRatingCount":null,"openNow":null,"websiteUrl":null}]}"#
      let result = try JSONDecoder().decode(FoodRecommendationResult.self, from: Data(json.utf8))
      let c = try XCTUnwrap(result.candidates.first)
      XCTAssertNil(c.distanceMeters); XCTAssertNil(c.rating); XCTAssertNil(c.openNow); XCTAssertNil(c.websiteUrl)
    }

    func testEncodesPayloadWithNullQueryAndNoVisitPair() throws {
      let payload = FoodRecommendationRequestPayload(latitude: 1.5, longitude: 2.5, area: "Bern", mealKind: "lunch",
        query: nil, languageCode: "ja", destination: "auto", routePolyline: nil)
      let obj = try JSONSerialization.jsonObject(with: JSONEncoder().encode(payload)) as? [String: Any]
      XCTAssertEqual(obj?["mealKind"] as? String, "lunch")
      XCTAssertEqual(obj?["area"] as? String, "Bern")
      XCTAssertTrue(obj?["query"] is NSNull)              // nil → JSON null（server は queryMissing で既定語）
      XCTAssertTrue(obj?["routePolyline"] is NSNull)
      XCTAssertNil(obj?["visitDate"]); XCTAssertNil(obj?["visitTime"])   // フィールド自体が無い
    }
  }
  ```

- [ ] **Step 2: 失敗確認** — `export PATH=/opt/homebrew/bin:$PATH && apple/tools/verify-kit.sh`。Expected: 型未定義で失敗。

- [ ] **Step 3: モデル実装** — Create `FoodRecommendationModels.swift`:
  ```swift
  import Foundation

  /// web `POST /api/food-recommendations` へ送る。visitDate/visitTime は持たない
  /// （= 常に未送信 = web の hasNoVisitPair を満たす）。query が nil のとき JSON は null になり、
  /// server 側は queryMissing と見て既定の探索語を補う。
  public struct FoodRecommendationRequestPayload: Encodable, Sendable {
    public let latitude: Double
    public let longitude: Double
    public let area: String
    public let mealKind: String        // "lunch" | "dinner"
    public let query: String?          // 1–120 or nil
    public let languageCode: String    // "ja" | "en"
    public let destination: String     // DestinationChoice.rawValue
    public let routePolyline: String?  // 10–10000 or nil
    public init(latitude: Double, longitude: Double, area: String, mealKind: String, query: String?, languageCode: String, destination: String, routePolyline: String?) {
      self.latitude = latitude; self.longitude = longitude; self.area = area; self.mealKind = mealKind
      self.query = query; self.languageCode = languageCode; self.destination = destination; self.routePolyline = routePolyline
    }
  }

  /// web `FoodCandidate` の写し。写真・評価片・決済・hours 等はデコードで無視。
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
  }

  public struct FoodRecommendationResult: Decodable, Sendable {
    public let candidates: [FoodCandidate]
  }
  ```

- [ ] **Step 4: プロトコル要件** — `WorkerAuthState.swift` の `WorkerAuthenticating` に `liveRoutes` の隣へ:
  ```swift
  /// 検証済みの食事候補。失敗・未認証・到達不能はすべて nil（=呼び出し側は候補なし）。
  func foodRecommendations(_ payload: FoodRecommendationRequestPayload) async -> FoodRecommendationResult?
  ```

- [ ] **Step 5: WorkerClient 実装** — `WorkerClient.swift` の `liveRoutes`/`liveRoutesOnce` の直後に、`resolvePlaces` を鏡写し:
  ```swift
  public func foodRecommendations(_ payload: FoodRecommendationRequestPayload) async -> FoodRecommendationResult? {
    let auth = await ensureSession()
    guard case .authenticated = auth, let token = sessionToken else { return nil }
    guard let body = try? JSONEncoder().encode(payload) else { return nil }
    switch await foodRecommendationsOnce(token: token, body: body) {
    case .resolved(let result): return result
    case .failed: return nil
    case .unauthorized:
      sessionToken = nil
      state = .idle
      let reauth = await authenticate(allowKeyReset: true)
      guard case .authenticated = reauth, let fresh = sessionToken else { return nil }
      if case .resolved(let result) = await foodRecommendationsOnce(token: fresh, body: body) { return result }
      return nil
    }
  }

  private enum FoodOnce {
    case resolved(FoodRecommendationResult)
    case unauthorized
    case failed
  }

  private func foodRecommendationsOnce(token: String, body: Data) async -> FoodOnce {
    do {
      let response = try await transport.send(
        WorkerRequest(path: "/api/food-recommendations", method: "POST", body: body, sessionToken: token),
        baseURL: baseURL
      )
      if response.status == 200 {
        guard let decoded = try? JSONDecoder().decode(FoodRecommendationResult.self, from: response.body) else { return .failed }
        return .resolved(decoded)
      }
      if response.status == 401 { return .unauthorized }
      return .failed
    } catch {
      return .failed
    }
  }
  ```

- [ ] **Step 6: 5 conformer に nil スタブ**
  - `CannedWorkerClient.swift`（`liveRoutes` の次): `public func foodRecommendations(_ payload: FoodRecommendationRequestPayload) async -> FoodRecommendationResult? { nil }`
  - `WorkerPlaceResolverTests.swift` の `StubWorker` と `SlowStubWorker`、`WorkerRouteProviderTests.swift` の `FakeRouteWorker` の**3 スタブ**に、各型の既存 `liveRoutes` スタブの隣へ:
    ```swift
    func foodRecommendations(_ payload: FoodRecommendationRequestPayload) async -> FoodRecommendationResult? { nil }
    ```

- [ ] **Step 7: FakeGateway + 401 テスト** — `WorkerClientTests.swift`:
  - `FakeGateway` に `var foodUnauthorizedOnce = false` と `private var sawFood401 = false`。`configure(...)` に `foodUnauthorizedOnce: Bool = false` を足し代入。
  - `respond(to:)` の switch に `case "/api/live-routes"` の隣へ:
    ```swift
    case "/api/food-recommendations":
      if foodUnauthorizedOnce, !sawFood401 {
        sawFood401 = true
        return json(#"{"code":"session_expired"}"#, 401)
      }
      return json(#"{"provider":"google_maps","ranking":"evidence_weighted","fetchedAt":"t","candidates":[{"id":"c1","name":"Trattoria","address":"1 Via Roma","type":"italian_restaurant","googleMapsUrl":"https://maps.google/x","distanceMeters":240,"rating":4.4,"userRatingCount":812,"openNow":true,"hours":[],"paymentEvidence":[],"reviewSnippets":[],"websiteUrl":null}]}"#, 200)
    ```
  - テスト:
    ```swift
    func testFoodRecommendationsRetriesOnceOn401() async {
      let gateway = FakeGateway()
      await gateway.configure(foodUnauthorizedOnce: true)
      let (client, _) = makeClient(gateway: gateway)
      let payload = FoodRecommendationRequestPayload(latitude: 1, longitude: 1, area: "A", mealKind: "lunch",
        query: nil, languageCode: "en", destination: "auto", routePolyline: nil)
      let result = await client.foodRecommendations(payload)
      XCTAssertNotNil(result, "a 401 must be retried once and then succeed")
      XCTAssertEqual(result?.candidates.first?.id, "c1")
    }
    ```

- [ ] **Step 8: 全緑確認** — `apple/tools/verify-kit.sh`（引数なし）。Expected: 全緑、新規警告ゼロ。

- [ ] **Step 9: コミット** — trailer 付き。

---

### Task 2: lazy パイプライン(seam + アダプタ + availability + PlannerStore 拡張 + テスト)

**Files:**
- Create: `.../Providers/FoodRecommender.swift`（`FoodRecommending` protocol + `WorkerFoodRecommender` + `FoodRecommendationAvailability`）
- Create: `.../Store/PlannerStore+FoodRecommendations.swift`
- Modify: `.../Store/PlannerStore.swift`（フィールド + init param）
- Modify: `.../Store/PlannerStore.swift`（`startWeatherEnrichment()` 直後 1 箇所）、`.../Store/PlannerStore+Edits.swift`（2 箇所）、`.../Store/PlannerStore+Routes.swift`（1 箇所）で `invalidateFoodRecommendations()` を呼ぶ
- Create: `.../Tests/TripCheckAppCoreTests/PlannerStoreFoodRecommendationsTests.swift`

**Interfaces:**
- Consumes: Task 1 の型/`WorkerAuthenticating.foodRecommendations`。Kit `FoodRecommendationSlot`（public memberwise init）/`BuiltTripPlan.foodRecommendationSlots`/`MealKind`。
- Produces: `FoodRecommending`、`WorkerFoodRecommender(client:timeout:)`、`FoodRecommendationAvailability.makeDefaultProvider(uiTesting:client:)`、`FoodSlotRecommendations`、`PlannerStore.foodRecommendationsBySlot`、`PlannerStore.loadFoodRecommendations(slotId:)`、`PlannerStore.invalidateFoodRecommendations()`、`PlannerStore.init(... foodRecommendationProvider:)`。

- [ ] **Step 1: 失敗テストを書く** — Create `PlannerStoreFoodRecommendationsTests.swift`:
  ```swift
  import Testing
  @testable import TripCheckAppCore
  import TripCheckKit

  @MainActor private final class FakeFood: FoodRecommending {
    var calls = 0
    var lastPayload: FoodRecommendationRequestPayload?
    var answer: FoodRecommendationResult?
    var sleep: Duration?
    init(answer: FoodRecommendationResult?, sleep: Duration? = nil) { self.answer = answer; self.sleep = sleep }
    func recommendations(_ payload: FoodRecommendationRequestPayload) async -> FoodRecommendationResult? {
      calls += 1; lastPayload = payload
      if let sleep { try? await Task.sleep(for: sleep) }
      return answer
    }
  }

  private func slot(_ id: String = "food-1-lunch", kind: MealKind = .lunch) -> FoodRecommendationSlot {
    FoodRecommendationSlot(id: id, dayIndex: 0, dayLabel: "Day 1", date: nil, kind: kind, area: "Bern",
      anchorStopId: "s1", latitude: 46.9, longitude: 7.4, window: "12:00-14:00", displayTime: "12:30",
      probeTime: nil, routePolyline: nil, rationale: "", queryIdeas: ["ramen", "noodles"])
  }

  private func store(_ provider: (any FoodRecommending)?) -> PlannerStore {
    PlannerStore(resolvers: [], store: nil, foodRecommendationProvider: provider)
  }

  @MainActor private func waitUntil(_ c: () -> Bool) async throws {
    var n = 0; while !c(), n < 2000 { try await Task.sleep(for: .milliseconds(1)); n += 1 }
  }

  @Test @MainActor func fetchTransitionsLoadingToLoaded() async throws {
    let fake = FakeFood(answer: FoodRecommendationResult(candidates: [FoodCandidate(id: "c1", name: "T", address: "a", type: "italian_restaurant", googleMapsUrl: "u", distanceMeters: 100, rating: 4.2, userRatingCount: 9, openNow: true, websiteUrl: nil)]))
    let s = store(fake)
    s.beginFoodFetch(slot())
    #expect(s.foodRecommendationsBySlot["food-1-lunch"] == .loading)
    try await waitUntil { if case .loaded = s.foodRecommendationsBySlot["food-1-lunch"] { return true }; return false }
    guard case .loaded(let cands) = s.foodRecommendationsBySlot["food-1-lunch"] else { return #expect(Bool(false)) }
    #expect(cands.first?.id == "c1")
    #expect(fake.lastPayload?.mealKind == "lunch")
    #expect(fake.lastPayload?.query == "ramen noodles")   // queryIdeas 連結
    #expect(fake.lastPayload?.languageCode == "ja")        // 既定ロケール
  }

  @Test @MainActor func nilResultBecomesUnavailable() async throws {
    let s = store(FakeFood(answer: nil))
    s.beginFoodFetch(slot())
    try await waitUntil { s.foodRecommendationsBySlot["food-1-lunch"] == .unavailable }
    #expect(s.foodRecommendationsBySlot["food-1-lunch"] == .unavailable)
  }

  @Test @MainActor func staleResultDroppedByGenerationGuard() async throws {
    let fake = FakeFood(answer: FoodRecommendationResult(candidates: []), sleep: .milliseconds(80))
    let s = store(fake)
    s.beginFoodFetch(slot())
    #expect(s.foodRecommendationsBySlot["food-1-lunch"] == .loading)
    s.invalidateFoodRecommendations()                      // 世代 +1・全消し
    #expect(s.foodRecommendationsBySlot.isEmpty)
    try await waitUntil { fake.calls == 1 }
    try await Task.sleep(for: .milliseconds(40))
    #expect(s.foodRecommendationsBySlot["food-1-lunch"] == nil)   // 古い取得は捨てられた
  }

  @Test @MainActor func nilProviderIsImmediatelyUnavailable() async {
    let s = store(nil)
    // bundle が無いので loadFoodRecommendations(slotId:) は slot を引けない → beginFoodFetch を直接。
    s.beginFoodFetch(slot())
    #expect(s.foodRecommendationsBySlot["food-1-lunch"] == .unavailable)
  }
  ```

- [ ] **Step 2: 失敗確認** — `apple/tools/verify-kit.sh`。Expected: 型/メソッド未定義で失敗。

- [ ] **Step 3: seam・アダプタ・availability 実装** — Create `FoodRecommender.swift`:
  ```swift
  import Foundation
  import TripCheckKit

  public protocol FoodRecommending: Sendable {
    func recommendations(_ payload: FoodRecommendationRequestPayload) async -> FoodRecommendationResult?
  }

  /// `any WorkerAuthenticating` を包み、タップ時取得に上限時間を切って `foodRecommendations` を呼ぶ。
  /// `WorkerSuggestionAdapter`/`WorkerRouteProvider` の withTaskGroup レースを鏡に。
  public struct WorkerFoodRecommender: FoodRecommending {
    private let client: any WorkerAuthenticating
    private let timeout: Duration
    public init(client: any WorkerAuthenticating, timeout: Duration = .seconds(8)) {
      self.client = client; self.timeout = timeout
    }
    public func recommendations(_ payload: FoodRecommendationRequestPayload) async -> FoodRecommendationResult? {
      let client = self.client
      let limit = timeout
      return await withTaskGroup(of: FoodRecommendationResult?.self) { group in
        group.addTask { await client.foodRecommendations(payload) }
        group.addTask { try? await Task.sleep(for: limit); return nil }
        let first = await group.next() ?? nil
        group.cancelAll()
        return first
      }
    }
  }

  /// 可用性は合成の根にだけ閉じ込める(weather/intent と同じ)。
  public enum FoodRecommendationAvailability {
    public static func makeDefaultProvider(uiTesting: Bool, client: any WorkerAuthenticating) -> (any FoodRecommending)? {
      uiTesting ? nil : WorkerFoodRecommender(client: client)
    }
  }
  ```

- [ ] **Step 4: PlannerStore にフィールド + init param** — `PlannerStore.swift`:
  - weather フィールドブロック（`weatherAttribution` の後）に:
    ```swift
    // MARK: - 食事の候補(観測しない。foodRecommendationsBySlot だけが観測される。spec 2026-08-25)
    /// 候補の提供元。nil = 出さない(UI テスト・未構成)。
    @ObservationIgnored let foodRecommendationProvider: (any FoodRecommending)?
    @ObservationIgnored var foodRecommendationGeneration = 0
    @ObservationIgnored var foodRecommendationTasks: [String: Task<Void, Never>] = [:]
    /// 食事枠 id → 候補の状態(表示専用)。
    public internal(set) var foodRecommendationsBySlot: [String: FoodSlotRecommendations] = [:]
    ```
  - `init` の param に `weatherProvider:` の後へ `foodRecommendationProvider: (any FoodRecommending)? = nil` を足し、本体 `self.weatherProvider = weatherProvider` の後へ `self.foodRecommendationProvider = foodRecommendationProvider`。

- [ ] **Step 5: パイプライン実装** — Create `PlannerStore+FoodRecommendations.swift`:
  ```swift
  import Foundation
  import TripCheckKit

  /// 食事枠 1 つぶんの候補の状態。
  public enum FoodSlotRecommendations: Equatable, Sendable {
    case loading
    case loaded([FoodCandidate])
    case unavailable
  }

  extension PlannerStore {
    /// `MealRow` タップの入口。枠を bundle から引き、まだ取っていなければ取りに行く。
    public func loadFoodRecommendations(slotId: String) {
      guard let slot = bundle?.plan.foodRecommendationSlots.first(where: { $0.id == slotId }) else { return }
      switch foodRecommendationsBySlot[slotId] {
      case .loading, .loaded: return          // 取得中/取得済みは触らない
      case .unavailable, .none: beginFoodFetch(slot)
      }
    }

    /// 実取得。テストは `FoodRecommendationSlot` を直接渡して駆動する。
    func beginFoodFetch(_ slot: FoodRecommendationSlot) {
      foodRecommendationTasks[slot.id]?.cancel()
      guard let provider = foodRecommendationProvider else {
        foodRecommendationsBySlot[slot.id] = .unavailable
        return
      }
      foodRecommendationsBySlot[slot.id] = .loading
      let payload = foodPayload(for: slot)
      let generation = foodRecommendationGeneration
      let slotId = slot.id
      foodRecommendationTasks[slotId] = Task { [weak self] in
        let result = await provider.recommendations(payload)
        guard let self, self.foodRecommendationGeneration == generation, !Task.isCancelled else { return }
        self.foodRecommendationsBySlot[slotId] = result.map { .loaded($0.candidates) } ?? .unavailable
        self.foodRecommendationTasks[slotId] = nil
      }
    }

    /// 再ビルド・日付変更・reset で。世代を上げ、読みかけを捨て、候補を空に。
    func invalidateFoodRecommendations() {
      foodRecommendationGeneration &+= 1
      for task in foodRecommendationTasks.values { task.cancel() }
      foodRecommendationTasks = [:]
      foodRecommendationsBySlot = [:]
    }

    private func foodPayload(for slot: FoodRecommendationSlot) -> FoodRecommendationRequestPayload {
      let joined = slot.queryIdeas.joined(separator: " ")
      let query = (joined.count >= 1 && joined.count <= 120) ? joined : nil
      let polyline = slot.routePolyline.flatMap { ($0.count >= 10 && $0.count <= 10_000) ? $0 : nil }
      return FoodRecommendationRequestPayload(
        latitude: slot.latitude, longitude: slot.longitude, area: slot.area,
        mealKind: slot.kind.rawValue, query: query,
        languageCode: request.locale.rawValue, destination: request.destination.rawValue,
        routePolyline: polyline)
    }
  }
  ```

- [ ] **Step 6: invalidate を 4 経路に配線** — 各 `startWeatherEnrichment()` 呼び出しの**直後**に `invalidateFoodRecommendations()` を足す:
  - `PlannerStore.swift`(`startWeatherEnrichment()` の行、約 451)
  - `PlannerStore+Edits.swift`(2 箇所、約 204 と 279)
  - `PlannerStore+Routes.swift`(1 箇所、約 165)

- [ ] **Step 7: 全緑確認** — `apple/tools/verify-kit.sh`（引数なし）。Expected: 新規テスト含め全緑、新規警告ゼロ。

- [ ] **Step 8: コミット** — trailer 付き。

---

### Task 3: UI(Inspector case + シート + MealRow タップ + AppCopy + 検証)

**Files:**
- Modify: `.../State/PlannerViewState.swift`（`Inspector` に case + id）
- Modify: `apple/TripCheck/Screens/Plan/PlanScreen.swift`（`.sheet` switch）
- Modify: `apple/TripCheck/Screens/Plan/MealRow.swift`（タップ + ヒント）
- Create: `apple/TripCheck/Screens/Plan/FoodRecommendationSheet.swift`
- Modify: `.../Presentation/AppCopy.swift`（文言）
- Modify: `apple/TripCheckUITests/PlannerFlowTests.swift`（非回帰 UI テスト、可能なら）

**Interfaces:**
- Consumes: Task 2 の `PlannerStore.foodRecommendationsBySlot`/`loadFoodRecommendations(slotId:)`/`openInspector(_:)`、`FoodCandidate`、`MealModel.slotId`。

- [ ] **Step 1: Inspector に case** — `PlannerViewState.swift` の `enum Inspector` に:
  ```swift
  case mealRecommendations(String)
  ```
  `id` の switch に: `case .mealRecommendations(let slotId): "meal:\(slotId)"`。（`openInspector(_:)` の `if case .stop` 分岐は他 case を無視するのでそのまま動く。)

- [ ] **Step 2: AppCopy 文言** — `AppCopy.swift` の既存文言(例 `webSuggestionsHeader`/`suggestionsUnavailable`)の記法に合わせ ja/en で足す:
  - `mealRecommendationsTitle`: ja "近くの食事" / en "Places to eat nearby"
  - `mealRecommendationsHint`: ja "候補を見る" / en "See suggestions"
  - `mealRecommendationsEmpty`: ja "候補が見つかりませんでした" / en "No suggestions found"
  - `openNowLabel`: ja "営業中" / en "Open now"

- [ ] **Step 3: MealRow をタップ可能に** — `MealRow.swift`:
  - `@Environment(PlannerStore.self) private var store` を足す。
  - `Spacer(minLength: 0)` の前に控えめなヒント:
    ```swift
    Text(AppCopy.for(store.request.locale).mealRecommendationsHint)
      .tcFont(.meta)
      .foregroundStyle(Tokens.Color.recommendation)
    ```
    （`Spacer` は残す。）
  - `.overlay(...)` の後、`.accessibilityElement`/`.accessibilityIdentifier` の前に:
    ```swift
    .contentShape(Rectangle())
    .onTapGesture {
      store.openInspector(.mealRecommendations(model.slotId))
      store.loadFoodRecommendations(slotId: model.slotId)
    }
    ```
  - `.accessibilityAddTraits(.isButton)` と `.accessibilityHint(AppCopy.for(store.request.locale).mealRecommendationsHint)` を足す。

- [ ] **Step 4: シート** — Create `FoodRecommendationSheet.swift`:
  ```swift
  import SwiftUI
  import TripCheckAppCore

  /// 食事枠 1 つの候補。破線の「提案」を、タップで開く一覧に広げる。写真は出さない
  /// （テキストのみ + Google マップへのタップスルー)。
  struct FoodRecommendationSheet: View {
    let slotId: String
    @Environment(PlannerStore.self) private var store

    var body: some View {
      let app = AppCopy.for(store.request.locale)
      let state = store.foodRecommendationsBySlot[slotId] ?? .loading
      NavigationStack {
        Group {
          switch state {
          case .loading:
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
          case .loaded(let candidates) where candidates.isEmpty:
            emptyView(app)
          case .unavailable:
            emptyView(app)
          case .loaded(let candidates):
            ScrollView {
              VStack(spacing: 10) {
                ForEach(candidates) { candidate in card(candidate, app) }
              }
              .padding(16)
            }
          }
        }
        .navigationTitle(app.mealRecommendationsTitle)
        .navigationBarTitleDisplayMode(.inline)
      }
      .task { store.loadFoodRecommendations(slotId: slotId) }
      .onChange(of: store.foodRecommendationsBySlot[slotId]) { _, new in
        if new == nil { store.loadFoodRecommendations(slotId: slotId) }
      }
    }

    private func emptyView(_ app: AppCopy) -> some View {
      Text(app.mealRecommendationsEmpty)
        .tcFont(.body).foregroundStyle(Tokens.Color.muted)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(24)
    }

    private func card(_ c: FoodCandidate, _ app: AppCopy) -> some View {
      Link(destination: URL(string: c.googleMapsUrl) ?? URL(string: "https://maps.google.com")!) {
        VStack(alignment: .leading, spacing: 4) {
          Text(c.name).tcFont(.stopName).foregroundStyle(Tokens.Color.ink)
          Text(c.type.replacingOccurrences(of: "_", with: " "))
            .tcFont(.meta).foregroundStyle(Tokens.Color.muted)
          HStack(spacing: 8) {
            if let r = c.rating { Text(String(format: "%.1f", r) + (c.userRatingCount.map { " (\($0))" } ?? "")).tcFont(.meta).foregroundStyle(Tokens.Color.ink2) }
            if let d = c.distanceMeters { Text("\(d) m").tcFont(.meta).foregroundStyle(Tokens.Color.muted) }
            if c.openNow == true { Text(app.openNowLabel).tcFont(.meta).foregroundStyle(Tokens.Color.recommendation) }
          }
          if !c.address.isEmpty { Text(c.address).tcFont(.meta).foregroundStyle(Tokens.Color.muted).lineLimit(2) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(RoundedRectangle(cornerRadius: Tokens.Radius.card).fill(Tokens.Color.panel))
        .overlay(RoundedRectangle(cornerRadius: Tokens.Radius.card).stroke(Tokens.Color.line, lineWidth: 1))
      }
      .buttonStyle(.plain)
      .accessibilityIdentifier("plan.foodCandidate")
    }
  }
  ```
  （`tcFont`/`Tokens`/`IconView` の実在シンボルに合わせる。`Tokens.Color.ink2` 等が無ければ既存の近い token に。星記号は使わず数値表記。）

- [ ] **Step 5: PlanScreen にシートを繋ぐ** — `PlanScreen.swift` の `.sheet(item: $store.view.inspector)` の switch に、`case .daySettings` の隣へ:
  ```swift
  case .mealRecommendations(let slotId):
    FoodRecommendationSheet(slotId: slotId)
      .presentationDetents([.fraction(0.3), .medium, .large], selection: detent)
      .presentationDragIndicator(.visible)
  ```

- [ ] **Step 6: 非回帰 UI テスト(可能なら)** — `PlannerFlowTests.swift` に 1 本。既存テストの起動作法(`-uiTesting` 等)に合わせ、サンプル/既存フローで**ビルド済みプラン画面**に到達 →
  ```swift
  func testMealRowOpensRecommendationSheetUnderCannedProvider() {
    // 既存ヘルパでビルド済みプラン画面まで進める（既存 UI テストの手順を踏襲）。
    // provider は UI テストで nil ゆえ候補は「候補なし」= 非回帰。
    // plan.meal が現れる構成なら 1 件タップし plan.mealRecommendations 系の要素が出ることを確認。
    // 現れない構成なら本テストは省略しその旨を report に書く（flaky な必須タップにしない）。
  }
  ```
  実装時に `plan.meal` の到達可否を実測し、**決定的に到達できる場合のみ**タップ→シート表示(`plan.foodCandidate` が無い=候補なし、でもシートは開く)を assert する。到達できなければ UI テストは足さず、パイプライン単体テスト + build 緑に委ねる旨を report に明記。

- [ ] **Step 7: 検証** — `apple/tools/verify-kit.sh`(引数なし)全緑、`apple/tools/verify-app.sh test` 全緑(既存 UI 非回帰 + 追加分)、新規警告ゼロ。

- [ ] **Step 8: 手動 E2E 追記 + コミット** — `apple/docs/paid-route-check.md` に「食事候補」節(`.dev.vars` に実 `GOOGLE_PLACES_API_KEY`、`pnpm dev`、Simulator でビルド後に食事枠タップ→候補が出る/鍵無しは候補なし)を足し、trailer 付きでコミット。
