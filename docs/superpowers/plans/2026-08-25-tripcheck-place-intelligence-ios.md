# TripCheck iOS place-intelligence 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development でタスク単位に実装する。各ステップは `- [ ]`。

**Goal:** Google 検証済み停留所の詳細シート(`StopInspector`)に「この場所について」開示カードを足し、開いた初回だけ `/api/place-intelligence`(Google 詳細)を取って営業時間・評価・要約をテキストで出す。web/Kit 無改変。

**Architecture:** food-recommendations をほぼ鏡写し、キーを停留所 id に。`WorkerClient.placeIntelligence` → 狭い seam `PlaceIntelligenceProviding` + `WorkerPlaceIntelligenceProvider`(8s レース)→ 世代ガード lazy パイプライン `PlannerStore+PlaceIntelligence`(展開時取得、stopId キャッシュ)→ `StopInspector` の read 節に閉じた開示カード。リッチ tier のため request は providerRef/scope を送らない。

**Tech Stack:** Swift 6、SwiftUI、swift-testing + XCTest、XCUITest。

**Spec:** `docs/superpowers/specs/2026-08-25-tripcheck-place-intelligence-ios-design.md`

## Global Constraints
- **web 不可侵**(`lib/**`・`app/api/**`・`worker/**`)。`/api/place-intelligence` は既に paid・app セッション認可・featureFlag 無し・quota=1。
- **Kit 不可侵**(`Sources/TripCheckKit/`)。`RouteStop` は**読むだけ**。新規は `TripCheckAppCore` かアプリターゲット。
- **Swift 6 strict concurrency 新規警告ゼロ。** 越境型は `Sendable`。
- **絵文字禁止**(星も不可、評価は数値)。日本語 UI リテラルは `AppCopy.swift` のみ。
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
- Create: `.../Worker/PlaceIntelligenceModels.swift`
- Modify: `.../Worker/WorkerAuthState.swift`、`.../Worker/WorkerClient.swift`、`.../Worker/CannedWorkerClient.swift`
- Modify(nil スタブ): `.../Tests/TripCheckAppCoreTests/WorkerPlaceResolverTests.swift`（`StubWorker`・`SlowStubWorker`）、`.../Tests/TripCheckAppCoreTests/WorkerRouteProviderTests.swift`（`FakeRouteWorker`）
- Modify: `.../Tests/TripCheckAppCoreTests/WorkerClientTests.swift`
- Create: `.../Tests/TripCheckAppCoreTests/PlaceIntelligenceModelsTests.swift`

**Interfaces:**
- Produces: `PlaceIntelligenceRequestPayload`(Encodable)、`PlaceIntelligencePlace`/`PlaceIntelligenceReview`/`PlaceIntelligenceAnalysis`/`PlaceIntelligenceResult`(Decodable)、`WorkerAuthenticating.placeIntelligence(_:) async -> PlaceIntelligenceResult?`。

- [ ] **Step 1: 失敗テストを書く** — Create `PlaceIntelligenceModelsTests.swift`:
  ```swift
  import XCTest
  @testable import TripCheckAppCore

  final class PlaceIntelligenceModelsTests: XCTestCase {
    func testDecodesResultIgnoringExtraFields() throws {
      let json = #"""
      {"provider":"google_places","checkedAt":"t","analyzedBy":"rules",
       "place":{"name":"Kaffee","address":"1 Bahnhofstrasse","googleMapsUrl":"https://maps.google/x",
         "websiteUrl":"https://k.example","businessStatus":"OPERATIONAL","rating":4.6,"userRatingCount":1203,
         "openNow":true,"hours":["Mon 08-18","Tue 08-18"],"payment":{"cashOnly":false},"photoName":"places/x"},
       "reviews":[{"rating":5,"text":"Great coffee","authorName":"A","excerpt":"Great"}],
       "analysis":{"summary":"Popular cafe, open now.","confidence":"high","signals":[],"nextCheck":"t"},
       "links":{"x":"u","instagram":"u"}}
      """#
      let r = try JSONDecoder().decode(PlaceIntelligenceResult.self, from: Data(json.utf8))
      XCTAssertEqual(r.place.name, "Kaffee")
      XCTAssertEqual(r.place.rating, 4.6)
      XCTAssertEqual(r.place.userRatingCount, 1203)
      XCTAssertEqual(r.place.openNow, true)
      XCTAssertEqual(r.place.hours.count, 2)
      XCTAssertEqual(r.place.businessStatus, "OPERATIONAL")
      XCTAssertEqual(r.reviews.first?.text, "Great coffee")
      XCTAssertEqual(r.reviews.first?.rating, 5)
      XCTAssertEqual(r.analysis.summary, "Popular cafe, open now.")
      XCTAssertEqual(r.analysis.confidence, "high")
    }

    func testDecodesNullPlaceNumerics() throws {
      let json = #"{"place":{"name":"X","address":"","googleMapsUrl":"u","businessStatus":null,"rating":null,"userRatingCount":null,"openNow":null,"hours":[]},"reviews":[],"analysis":{"summary":"s","confidence":"low"}}"#
      let r = try JSONDecoder().decode(PlaceIntelligenceResult.self, from: Data(json.utf8))
      XCTAssertNil(r.place.rating); XCTAssertNil(r.place.openNow); XCTAssertNil(r.place.businessStatus)
      XCTAssertTrue(r.reviews.isEmpty)
    }

    func testEncodesRequestWithoutProviderRefOrScope() throws {
      let payload = PlaceIntelligenceRequestPayload(name: "Kaffee", area: "Bern", latitude: 46.9, longitude: 7.4,
        languageCode: "ja", destination: "auto")
      let obj = try JSONSerialization.jsonObject(with: JSONEncoder().encode(payload)) as? [String: Any]
      XCTAssertEqual(obj?["name"] as? String, "Kaffee")
      XCTAssertEqual(obj?["area"] as? String, "Bern")
      XCTAssertEqual(obj?["languageCode"] as? String, "ja")
      XCTAssertEqual(obj?["destination"] as? String, "auto")
      XCTAssertNil(obj?["providerRef"])   // リッチ tier のため送らない
      XCTAssertNil(obj?["scope"])
    }
  }
  ```

- [ ] **Step 2: 失敗確認** — `export PATH=/opt/homebrew/bin:$PATH && apple/tools/verify-kit.sh`。Expected: 型未定義で失敗。

- [ ] **Step 3: モデル実装** — Create `PlaceIntelligenceModels.swift`:
  ```swift
  import Foundation

  /// web `POST /api/place-intelligence` へ送る。providerRef と scope は **送らない**
  /// （両方省くと web はリッチな field mask=rating/reviews/analysis を返す。1.5km 検査で保護）。
  public struct PlaceIntelligenceRequestPayload: Encodable, Sendable {
    public let name: String
    public let area: String
    public let latitude: Double
    public let longitude: Double
    public let languageCode: String    // "ja" | "en"
    public let destination: String     // DestinationChoice.rawValue
    public init(name: String, area: String, latitude: Double, longitude: Double, languageCode: String, destination: String) {
      self.name = name; self.area = area; self.latitude = latitude; self.longitude = longitude
      self.languageCode = languageCode; self.destination = destination
    }
  }

  /// web `PlaceIntelligenceResult["place"]` の写し。payment/photo* はデコードで無視。
  public struct PlaceIntelligencePlace: Decodable, Sendable {
    public let name: String
    public let address: String
    public let googleMapsUrl: String
    public let businessStatus: String?
    public let rating: Double?
    public let userRatingCount: Int?
    public let openNow: Bool?
    public let hours: [String]
  }

  /// web `PlaceReviewEvidence` の抜粋(本文フィールドは web で `text`)。
  public struct PlaceIntelligenceReview: Decodable, Sendable, Identifiable {
    public let text: String?
    public let rating: Double?
    public var id: String { (text ?? "") + "|\(rating ?? 0)" }
  }

  public struct PlaceIntelligenceAnalysis: Decodable, Sendable {
    public let summary: String
    public let confidence: String
  }

  public struct PlaceIntelligenceResult: Decodable, Sendable {
    public let place: PlaceIntelligencePlace
    public let reviews: [PlaceIntelligenceReview]
    public let analysis: PlaceIntelligenceAnalysis
  }
  ```

- [ ] **Step 4: プロトコル要件** — `WorkerAuthState.swift` の `WorkerAuthenticating` に `foodRecommendations` の隣へ:
  ```swift
  /// 検証済み場所の詳細。失敗・未認証・到達不能はすべて nil（=呼び出し側は詳細なし）。
  func placeIntelligence(_ payload: PlaceIntelligenceRequestPayload) async -> PlaceIntelligenceResult?
  ```

- [ ] **Step 5: WorkerClient 実装** — `WorkerClient.swift` の `foodRecommendations`/`foodRecommendationsOnce` の直後に、それを鏡写し:
  ```swift
  public func placeIntelligence(_ payload: PlaceIntelligenceRequestPayload) async -> PlaceIntelligenceResult? {
    let auth = await ensureSession()
    guard case .authenticated = auth, let token = sessionToken else { return nil }
    guard let body = try? JSONEncoder().encode(payload) else { return nil }
    switch await placeIntelligenceOnce(token: token, body: body) {
    case .resolved(let result): return result
    case .failed: return nil
    case .unauthorized:
      sessionToken = nil
      state = .idle
      let reauth = await authenticate(allowKeyReset: true)
      guard case .authenticated = reauth, let fresh = sessionToken else { return nil }
      if case .resolved(let result) = await placeIntelligenceOnce(token: fresh, body: body) { return result }
      return nil
    }
  }

  private enum IntelOnce {
    case resolved(PlaceIntelligenceResult)
    case unauthorized
    case failed
  }

  private func placeIntelligenceOnce(token: String, body: Data) async -> IntelOnce {
    do {
      let response = try await transport.send(
        WorkerRequest(path: "/api/place-intelligence", method: "POST", body: body, sessionToken: token),
        baseURL: baseURL
      )
      if response.status == 200 {
        guard let decoded = try? JSONDecoder().decode(PlaceIntelligenceResult.self, from: response.body) else { return .failed }
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
  - `CannedWorkerClient.swift`（`foodRecommendations` の次）: `public func placeIntelligence(_ payload: PlaceIntelligenceRequestPayload) async -> PlaceIntelligenceResult? { nil }`
  - `WorkerPlaceResolverTests.swift` の `StubWorker`・`SlowStubWorker`、`WorkerRouteProviderTests.swift` の `FakeRouteWorker` に、各型の既存 `foodRecommendations` スタブの隣へ:
    ```swift
    func placeIntelligence(_ payload: PlaceIntelligenceRequestPayload) async -> PlaceIntelligenceResult? { nil }
    ```

- [ ] **Step 7: FakeGateway + 401 テスト** — `WorkerClientTests.swift`:
  - `FakeGateway` に `var intelUnauthorizedOnce = false` と `private var sawIntel401 = false`。`configure(...)` に `intelUnauthorizedOnce: Bool = false` を足し代入。
  - `respond(to:)` の switch に `case "/api/food-recommendations"` の隣へ:
    ```swift
    case "/api/place-intelligence":
      if intelUnauthorizedOnce, !sawIntel401 {
        sawIntel401 = true
        return json(#"{"code":"session_expired"}"#, 401)
      }
      return json(#"{"provider":"google_places","checkedAt":"t","analyzedBy":"rules","place":{"name":"Kaffee","address":"a","googleMapsUrl":"u","businessStatus":"OPERATIONAL","rating":4.6,"userRatingCount":10,"openNow":true,"hours":[]},"reviews":[],"analysis":{"summary":"s","confidence":"high","signals":[],"nextCheck":"t"},"links":{"x":"u","instagram":"u"}}"#, 200)
    ```
  - テスト:
    ```swift
    func testPlaceIntelligenceRetriesOnceOn401() async {
      let gateway = FakeGateway()
      await gateway.configure(intelUnauthorizedOnce: true)
      let (client, _) = makeClient(gateway: gateway)
      let payload = PlaceIntelligenceRequestPayload(name: "Kaffee", area: "Bern", latitude: 46.9, longitude: 7.4, languageCode: "en", destination: "auto")
      let result = await client.placeIntelligence(payload)
      XCTAssertNotNil(result, "a 401 must be retried once and then succeed")
      XCTAssertEqual(result?.place.name, "Kaffee")
    }
    ```

- [ ] **Step 8: 全緑確認** — `apple/tools/verify-kit.sh`（引数なし）。Expected: 全緑・新規警告ゼロ。

- [ ] **Step 9: コミット** — trailer 付き。

---

### Task 2: lazy パイプライン(seam + アダプタ + availability + PlannerStore + model フィールド + テスト)

**Files:**
- Create: `.../Providers/PlaceIntelligenceProvider.swift`
- Create: `.../Store/PlannerStore+PlaceIntelligence.swift`
- Modify: `.../Store/PlannerStore.swift`（フィールド + init param）
- Modify: `.../Store/PlannerStore.swift`（reset の `invalidateFoodRecommendations()` 隣 1 箇所）、`.../Store/PlannerStore+Edits.swift`（2 箇所）、`.../Store/PlannerStore+Routes.swift`（1 箇所）で `invalidatePlaceIntelligence()` を呼ぶ
- Modify: `.../Store/PlannerStore+Inspector.swift`（`StopInspectorModel` に `isProviderVerified` + `inspector(for:)` で設定）
- Create: `.../Tests/TripCheckAppCoreTests/PlannerStorePlaceIntelligenceTests.swift`

**Interfaces:**
- Consumes: Task 1 の型/`WorkerAuthenticating.placeIntelligence`。Kit `RouteStop`(public memberwise init: `id, providerRef, name, area, latitude, longitude, sourceUrl, verifiedAt, confidence, planningDurationMinutes, isAnchor` + optional 群)、`bundle.plan.days[].stops[].stop`。
- Produces: `PlaceIntelligenceProviding`、`WorkerPlaceIntelligenceProvider(client:timeout:)`、`PlaceIntelligenceAvailability.makeDefaultProvider(uiTesting:client:)`、`StopPlaceIntelligence`、`PlannerStore.placeIntelligenceByStop`、`PlannerStore.loadPlaceIntelligence(stopId:)`、`PlannerStore.invalidatePlaceIntelligence()`、`PlannerStore.init(... placeIntelligenceProvider:)`、`StopInspectorModel.isProviderVerified`。

- [ ] **Step 1: 失敗テストを書く** — Create `PlannerStorePlaceIntelligenceTests.swift`（`PlannerStoreFoodRecommendationsTests` を鏡写し）:
  ```swift
  import Testing
  @testable import TripCheckAppCore
  import TripCheckKit

  @MainActor private final class FakeIntel: PlaceIntelligenceProviding {
    var calls = 0
    var lastPayload: PlaceIntelligenceRequestPayload?
    var answer: PlaceIntelligenceResult?
    var sleep: Duration?
    init(answer: PlaceIntelligenceResult?, sleep: Duration? = nil) { self.answer = answer; self.sleep = sleep }
    func intelligence(_ payload: PlaceIntelligenceRequestPayload) async -> PlaceIntelligenceResult? {
      calls += 1; lastPayload = payload
      if let sleep { try? await Task.sleep(for: sleep) }
      return answer
    }
  }

  /// Google 停留所(providerRef 有り)を構築。RouteStop の実 init に合わせ、示していない任意 param は
  /// 既定/nil で埋める(実装時に RouteStop.init を確認)。
  private func googleStop(_ id: String = "google-0-abc", ref: String? = "places/ChIJ") -> RouteStop {
    RouteStop(id: id, providerRef: ref, name: "Kaffee", area: "Bern", latitude: 46.9, longitude: 7.4,
      sourceUrl: "https://maps.google/x", verifiedAt: "t", confidence: .medium,
      planningDurationMinutes: 30, isAnchor: false)
  }

  private func result() -> PlaceIntelligenceResult {
    PlaceIntelligenceResult(
      place: PlaceIntelligencePlace(name: "Kaffee", address: "a", googleMapsUrl: "u", businessStatus: "OPERATIONAL",
        rating: 4.6, userRatingCount: 10, openNow: true, hours: ["Mon 08-18"]),
      reviews: [], analysis: PlaceIntelligenceAnalysis(summary: "Popular.", confidence: "high"))
  }

  @MainActor private func store(_ provider: (any PlaceIntelligenceProviding)?) -> PlannerStore {
    PlannerStore(resolvers: [], store: nil, placeIntelligenceProvider: provider)
  }

  @MainActor private func waitUntil(_ c: () -> Bool) async throws {
    var n = 0; while !c(), n < 2000 { try await Task.sleep(for: .milliseconds(1)); n += 1 }
  }

  @Test @MainActor func fetchLoadsForProviderVerifiedStop() async throws {
    let fake = FakeIntel(answer: result())
    let s = store(fake)
    s.beginPlaceIntelligence(googleStop())
    #expect(s.placeIntelligenceByStop["google-0-abc"] == .loading)
    await s.placeIntelligenceTasks["google-0-abc"]?.value
    guard case .loaded(let r) = s.placeIntelligenceByStop["google-0-abc"] else { return #expect(Bool(false)) }
    #expect(r.place.rating == 4.6)
    #expect(fake.lastPayload?.name == "Kaffee")
    #expect(fake.lastPayload?.languageCode == "ja")
    #expect(fake.lastPayload?.destination == s.request.destination.rawValue)
  }

  @Test @MainActor func nilResultBecomesUnavailable() async throws {
    let s = store(FakeIntel(answer: nil))
    s.beginPlaceIntelligence(googleStop())
    await s.placeIntelligenceTasks["google-0-abc"]?.value
    #expect(s.placeIntelligenceByStop["google-0-abc"] == .unavailable)
  }

  @Test @MainActor func staleResultDroppedByGenerationGuard() async throws {
    let fake = FakeIntel(answer: result(), sleep: .milliseconds(80))
    let s = store(fake)
    s.beginPlaceIntelligence(googleStop())
    let running = s.placeIntelligenceTasks["google-0-abc"]
    s.invalidatePlaceIntelligence()
    #expect(s.placeIntelligenceByStop.isEmpty)
    await running?.value
    #expect(s.placeIntelligenceByStop["google-0-abc"] == nil)
  }

  @Test @MainActor func nilProviderIsImmediatelyUnavailable() async {
    let s = store(nil)
    s.beginPlaceIntelligence(googleStop())
    #expect(s.placeIntelligenceByStop["google-0-abc"] == .unavailable)
  }
  ```

- [ ] **Step 2: 失敗確認** — `apple/tools/verify-kit.sh`。Expected: 型/メソッド未定義で失敗。

- [ ] **Step 3: seam・アダプタ・availability** — Create `PlaceIntelligenceProvider.swift`(`FoodRecommender.swift` を鏡写し):
  ```swift
  import Foundation
  import TripCheckKit

  public protocol PlaceIntelligenceProviding: Sendable {
    func intelligence(_ payload: PlaceIntelligenceRequestPayload) async -> PlaceIntelligenceResult?
  }

  public struct WorkerPlaceIntelligenceProvider: PlaceIntelligenceProviding {
    private let client: any WorkerAuthenticating
    private let timeout: Duration
    public init(client: any WorkerAuthenticating, timeout: Duration = .seconds(8)) {
      self.client = client; self.timeout = timeout
    }
    public func intelligence(_ payload: PlaceIntelligenceRequestPayload) async -> PlaceIntelligenceResult? {
      let client = self.client
      let limit = timeout
      return await withTaskGroup(of: PlaceIntelligenceResult?.self) { group in
        group.addTask { await client.placeIntelligence(payload) }
        group.addTask { try? await Task.sleep(for: limit); return nil }
        let first = await group.next() ?? nil
        group.cancelAll()
        return first
      }
    }
  }

  public enum PlaceIntelligenceAvailability {
    public static func makeDefaultProvider(uiTesting: Bool, client: any WorkerAuthenticating) -> (any PlaceIntelligenceProviding)? {
      uiTesting ? nil : WorkerPlaceIntelligenceProvider(client: client)
    }
  }
  ```

- [ ] **Step 4: PlannerStore フィールド + init param** — `PlannerStore.swift`:
  - 食事フィールドブロック(`foodRecommendationsBySlot` の後)に:
    ```swift
    // MARK: - 場所の詳細(観測しない。placeIntelligenceByStop だけが観測される。spec 2026-08-25)
    @ObservationIgnored let placeIntelligenceProvider: (any PlaceIntelligenceProviding)?
    @ObservationIgnored var placeIntelligenceGeneration = 0
    @ObservationIgnored var placeIntelligenceTasks: [String: Task<Void, Never>] = [:]
    /// 停留所 id → 詳細の状態(表示専用)。
    public internal(set) var placeIntelligenceByStop: [String: StopPlaceIntelligence] = [:]
    ```
  - `init` の param に `foodRecommendationProvider:` の後へ `placeIntelligenceProvider: (any PlaceIntelligenceProviding)? = nil` を足し、本体で `self.placeIntelligenceProvider = placeIntelligenceProvider`。

- [ ] **Step 5: パイプライン実装** — Create `PlannerStore+PlaceIntelligence.swift`:
  ```swift
  import Foundation
  import TripCheckKit

  public enum StopPlaceIntelligence: Equatable, Sendable {
    case loading
    case loaded(PlaceIntelligenceResult)
    case unavailable
  }

  extension PlannerStore {
    /// 停留所詳細カードを開いたときの入口。Google 検証済み(providerRef 有り)停留所だけ取りに行く。
    public func loadPlaceIntelligence(stopId: String) {
      guard let stop = builtStop(stopId), stop.providerRef != nil else { return }
      switch placeIntelligenceByStop[stopId] {
      case .loading, .loaded: return
      case .unavailable, .none: beginPlaceIntelligence(stop)
      }
    }

    /// 実取得。テストは `RouteStop` を直接渡す。
    func beginPlaceIntelligence(_ stop: RouteStop) {
      placeIntelligenceTasks[stop.id]?.cancel()
      guard let provider = placeIntelligenceProvider else {
        placeIntelligenceByStop[stop.id] = .unavailable
        return
      }
      placeIntelligenceByStop[stop.id] = .loading
      // providerRef と scope は送らない(リッチ tier)。
      let payload = PlaceIntelligenceRequestPayload(
        name: stop.name, area: stop.area, latitude: stop.latitude, longitude: stop.longitude,
        languageCode: request.locale.rawValue, destination: request.destination.rawValue)
      let generation = placeIntelligenceGeneration
      let stopId = stop.id
      placeIntelligenceTasks[stopId] = Task { [weak self] in
        let result = await provider.intelligence(payload)
        guard let self, self.placeIntelligenceGeneration == generation, !Task.isCancelled else { return }
        self.placeIntelligenceByStop[stopId] = result.map { .loaded($0) } ?? .unavailable
        self.placeIntelligenceTasks[stopId] = nil
      }
    }

    func invalidatePlaceIntelligence() {
      placeIntelligenceGeneration &+= 1
      for task in placeIntelligenceTasks.values { task.cancel() }
      placeIntelligenceTasks = [:]
      placeIntelligenceByStop = [:]
    }

    /// `bundle` の全日・全停留所から id 一致の `RouteStop` を引く(`inspector(for:)` と同じ読み方)。
    private func builtStop(_ stopId: String) -> RouteStop? {
      guard let bundle else { return nil }
      for day in bundle.plan.days {
        for built in day.stops where built.stop.id == stopId { return built.stop }
      }
      return nil
    }
  }
  ```

- [ ] **Step 6: invalidate を 4 経路に配線** — 各 `invalidateFoodRecommendations()` の**直後**に `invalidatePlaceIntelligence()` を足す:
  - `PlannerStore.swift`（commit 経路と reset() の 2 箇所とも `invalidateFoodRecommendations()` があるはず。両方の隣に。=合計、commit 側 1 + reset 側 1）
  - `PlannerStore+Edits.swift`(2 箇所)
  - `PlannerStore+Routes.swift`(1 箇所)
  （food の invalidate 呼び出し箇所すべての隣に置く。grep で `invalidateFoodRecommendations()` を全部見つけ、その各行の直後に `invalidatePlaceIntelligence()` を入れる。)

- [ ] **Step 7: StopInspectorModel に isProviderVerified** — `PlannerStore+Inspector.swift`:
  - `StopInspectorModel` に `public var isProviderVerified: Bool` を足す(memberwise init もあるなら合わせる)。
  - `inspector(for:)` が model を組む箇所で `isProviderVerified: built.stop.providerRef != nil`（`built` は `bundle...stops[index]`、`built.stop` が `RouteStop`)を設定。他の全 `StopInspectorModel(...)` 生成箇所(プレビュー/テスト含む)もコンパイルを通す。

- [ ] **Step 8: 全緑確認** — `apple/tools/verify-kit.sh`（引数なし）。Expected: 新規テスト含め全緑・新規警告ゼロ。

- [ ] **Step 9: コミット** — trailer 付き。

---

### Task 3: UI + 合成の根配線(StopInspector カード + TripCheckApp + AppCopy + 検証)

**Files:**
- Modify: `apple/TripCheck/App/TripCheckApp.swift`（**composition-root 配線 — 必須**）
- Modify: `apple/TripCheck/Screens/Detail/StopInspector.swift`（カード挿入)
- Create: `apple/TripCheck/Screens/Detail/PlaceIntelligenceDisclosure.swift`
- Modify: `.../Presentation/AppCopy.swift`（文言）
- Modify: `apple/TripCheckUITests/PlannerFlowTests.swift`（非回帰 UI テスト、可能なら）

**Interfaces:**
- Consumes: Task 2 の `placeIntelligenceByStop`/`loadPlaceIntelligence(stopId:)`/`StopPlaceIntelligence`/`StopInspectorModel.isProviderVerified`、`PlaceIntelligenceAvailability`、既存 `EvidenceDisclosure`/`DisclosureCard`。

- [ ] **Step 1: 合成の根配線** — `TripCheckApp.swift` の `PlannerStore.init(...)` に、`foodRecommendationProvider:` 引数の隣へ:
  ```swift
  placeIntelligenceProvider: PlaceIntelligenceAvailability.makeDefaultProvider(uiTesting: isUITesting, client: workerClient),
  ```
  （`workerClient` は同一インスタンス。UI テストは nil。**この配線が無いと実アプリで機能が黙って no-op する** — 前スライスで漏れた教訓。）

- [ ] **Step 2: kit 緑を確認** — `apple/tools/verify-kit.sh`。Expected: 変わらず緑（AppCopy はまだ足していないので、この時点では TripCheckApp のみ・app ビルドは Step 6 で）。

- [ ] **Step 3: AppCopy 文言** — `AppCopy.swift` の既存文言(例 `mealRecommendationsTitle`)の記法に合わせ ja/en:
  - `placeIntelligenceTitle`: ja "この場所について" / en "About this place"
  - `placeIntelligenceUnavailable`: ja "詳細を取得できませんでした" / en "Details unavailable"
  - `placeIntelligenceOpenNow`: ja "営業中" / en "Open now"

- [ ] **Step 4: 開示カード** — Create `PlaceIntelligenceDisclosure.swift`（既存 `EvidenceDisclosure.swift` の `DisclosureCard` 作法を読んで鏡写し。**既定で閉じ、開いた初回だけ取得**):
  ```swift
  import SwiftUI
  import TripCheckAppCore

  /// Google 検証済み停留所の詳細。閉じた開示カードで、開いた初回だけ Worker に尋ねる
  /// （inspector を開く度には取らない=1 unit/展開）。写真は出さない。
  struct PlaceIntelligenceDisclosure: View {
    let stopId: String
    @Environment(PlannerStore.self) private var store
    @State private var expanded = false

    var body: some View {
      let app = AppCopy.for(store.request.locale)
      // 既存 EvidenceDisclosure と同じ DisclosureCard/見出しの作法に合わせること。
      DisclosureCard(title: app.placeIntelligenceTitle, isExpanded: $expanded) {
        content(app)
      }
      .onChange(of: expanded) { _, now in
        if now { store.loadPlaceIntelligence(stopId: stopId) }
      }
      .accessibilityIdentifier("plan.placeIntelligence")
    }

    @ViewBuilder private func content(_ app: AppCopy) -> some View {
      switch store.placeIntelligenceByStop[stopId] {
      case .some(.loading), .none:
        ProgressView()
      case .some(.unavailable):
        Text(app.placeIntelligenceUnavailable).tcFont(.meta).foregroundStyle(Tokens.Color.muted)
      case .some(.loaded(let r)):
        VStack(alignment: .leading, spacing: 6) {
          HStack(spacing: 8) {
            if let rating = r.place.rating {
              Text(String(format: "%.1f", rating) + (r.place.userRatingCount.map { " (\($0))" } ?? ""))
                .tcFont(.meta).foregroundStyle(Tokens.Color.ink)
            }
            if r.place.openNow == true {
              Text(app.placeIntelligenceOpenNow).tcFont(.meta).foregroundStyle(Tokens.Color.recommendation)
            }
          }
          if !r.analysis.summary.isEmpty {
            Text(r.analysis.summary).tcFont(.body).foregroundStyle(Tokens.Color.ink2)
          }
          ForEach(r.place.hours, id: \.self) { line in
            Text(line).tcFont(.meta).foregroundStyle(Tokens.Color.muted)
          }
          ForEach(r.reviews.prefix(2)) { review in
            if let text = review.text, !text.isEmpty {
              Text(text).tcFont(.meta).foregroundStyle(Tokens.Color.muted).lineLimit(3)
            }
          }
          if let url = URL(string: r.place.googleMapsUrl) {
            Link(destination: url) { Text(r.place.address).tcFont(.meta).foregroundStyle(Tokens.Color.accent) }
          }
        }
      }
    }
  }
  ```
  （`DisclosureCard` の実 API(`title`/`isExpanded` の引数名・content クロージャ)・`tcFont`/`Tokens` の実在シンボルに**必ず合わせる**。`Tokens.Color.ink2` 等が無ければ既存の近い token に。星は使わず数値。）

- [ ] **Step 5: StopInspector にカード挿入** — `StopInspector.swift` の body、`EvidenceDisclosure(model: model)` の**直後**に:
  ```swift
  if model.isProviderVerified {
    PlaceIntelligenceDisclosure(stopId: model.stopId)
  }
  ```

- [ ] **Step 6: app 緑を確認** — `apple/tools/verify-app.sh test`。Expected: `** TEST SUCCEEDED **`、既存 UI 非回帰、新規警告ゼロ。

- [ ] **Step 7: 非回帰 UI テスト(可能なら)** — `PlannerFlowTests.swift` に 1 本。既存フローで**ビルド済みプランの Google 停留所詳細**に到達できるなら、`plan.placeIntelligence` カードを開き(provider nil=`.unavailable`)カードが出て非回帰を確認。到達可否を実測し、決定的に到達できる場合のみ assert。到達不能なら report に明記しパイプライン単体+build に委ねる(flaky にしない)。

- [ ] **Step 8: 手動 E2E 追記 + コミット** — `apple/docs/paid-route-check.md` に「場所の詳細」節(`.dev.vars` に実 `GOOGLE_PLACES_API_KEY`、`pnpm dev`、Simulator で Google 停留所の詳細カードを開くと営業時間/評価/要約が出る/鍵無しは「詳細を取得できませんでした」)を足し、trailer 付きでコミット。
