# TripCheck iOS hotel-recommendations 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development でタスク単位に実装する。各ステップは `- [ ]`。

**Goal:** Plan 画面に新設の「近くの宿」カードを出し、タップで開いた初回だけ `/api/hotel-recommendations`(Google、query 無し=自動探索)を取り、経路に近い宿をテキストカードで出す。web/Kit 無改変。

**Architecture:** food-recommendations をほぼ鏡写し、**プラン単位の単一 state**に。`WorkerClient.hotelRecommendations` → `HotelRecommending`+`WorkerHotelRecommender`(8s レース)→ 世代ガード lazy パイプライン `PlannerStore+HotelRecommendations`(`Bases.hotelRouteContext` を読む)→ PlanScreen の新設カード+シート。

**Spec:** `docs/superpowers/specs/2026-08-26-tripcheck-hotel-recommendations-ios-design.md`

## Global Constraints
- **web 不可侵**(`lib/**`・`app/api/**`・`worker/**`)。`/api/hotel-recommendations` は既に paid・app セッション認可・HOTEL default-on・quota=4(query 無し)。
- **Kit 不可侵**(`Sources/TripCheckKit/`)。`Bases.hotelRouteContext`/`HotelRouteContext`/`GeoPoint` は**読むだけ**。新規は `TripCheckAppCore` かアプリターゲット。
- **Swift 6 strict concurrency 新規警告ゼロ。** 越境型は `Sendable`。
- **絵文字禁止**(星も数値)。日本語 UI リテラルは `AppCopy.swift` のみ。
- **`git push` しない。**
- **コミット trailer 厳守:**
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_012DRrRBiU96fLJmvfThaR4J
  ```
- **検証:** `apple/tools/verify-kit.sh`(**引数なし**)全緑、`apple/tools/verify-app.sh test` 全緑、新規警告ゼロ。

---

### Task 1: 取得の配管(モデル + クライアント + 6 スタブ + テスト)

**Files:** Create `.../Worker/HotelRecommendationModels.swift`; Modify `.../Worker/WorkerAuthState.swift`,`.../Worker/WorkerClient.swift`,`.../Worker/CannedWorkerClient.swift`; Modify(nil スタブ)`.../Tests/.../WorkerPlaceResolverTests.swift`(`StubWorker`・`SlowStubWorker`),`.../Tests/.../WorkerRouteProviderTests.swift`(`FakeRouteWorker`); Modify `.../Tests/.../WorkerClientTests.swift`; Create `.../Tests/.../HotelRecommendationModelsTests.swift`.

**Interfaces produces:** `HotelRecommendationRequestPayload`(Encodable)、`HotelCandidate`/`HotelRecommendationResult`(Decodable/Equatable)、`WorkerAuthenticating.hotelRecommendations(_:)`。

- [ ] **Step 1: 失敗テスト** — Create `HotelRecommendationModelsTests.swift`:
  ```swift
  import XCTest
  @testable import TripCheckAppCore
  import TripCheckKit

  final class HotelRecommendationModelsTests: XCTestCase {
    func testDecodesCandidatesIgnoringRichFields() throws {
      let json = #"""
      {"provider":"google_maps","fetchedAt":"t","evidenceProviders":{"rakuten":false},"candidates":[
        {"id":"h1","name":"Hotel Bern","address":"1 Bahnhofplatz","googleMapsUrl":"https://maps.google/h","websiteUrl":"https://hb.example",
         "latitude":46.9,"longitude":7.4,"rating":4.3,"userRatingCount":540,"distanceMeters":320,"routeBurdenMeters":800,"score":0.9,
         "priceLevel":"moderate","styles":["value"],"photo":null,"reviews":null,"payment":null,"rakuten":null}
      ]}
      """#
      let r = try JSONDecoder().decode(HotelRecommendationResult.self, from: Data(json.utf8))
      XCTAssertEqual(r.candidates.count, 1)
      let h = try XCTUnwrap(r.candidates.first)
      XCTAssertEqual(h.id, "h1"); XCTAssertEqual(h.name, "Hotel Bern")
      XCTAssertEqual(h.rating, 4.3); XCTAssertEqual(h.userRatingCount, 540)
      XCTAssertEqual(h.distanceMeters, 320); XCTAssertEqual(h.routeBurdenMeters, 800)
      XCTAssertEqual(h.websiteUrl, "https://hb.example")
    }
    func testDecodesNullNumerics() throws {
      let json = #"{"candidates":[{"id":"h2","name":"X","address":"","googleMapsUrl":"u","websiteUrl":null,"rating":null,"userRatingCount":null,"distanceMeters":0,"routeBurdenMeters":0}]}"#
      let r = try JSONDecoder().decode(HotelRecommendationResult.self, from: Data(json.utf8))
      XCTAssertNil(r.candidates.first?.rating); XCTAssertNil(r.candidates.first?.websiteUrl)
    }
    func testEncodesPayloadWithRoutePointsAndNoQuery() throws {
      let payload = HotelRecommendationRequestPayload(latitude: 46.9, longitude: 7.4, area: "Bern",
        routePoints: [GeoPoint(latitude: 46.9, longitude: 7.4), GeoPoint(latitude: 47.0, longitude: 7.5)],
        languageCode: "ja", destination: "auto")
      let obj = try JSONSerialization.jsonObject(with: JSONEncoder().encode(payload)) as? [String: Any]
      XCTAssertEqual(obj?["area"] as? String, "Bern")
      XCTAssertNil(obj?["query"])                                  // 送らない
      let rp = obj?["routePoints"] as? [[String: Any]]
      XCTAssertEqual(rp?.count, 2)
      XCTAssertEqual(rp?.first?["latitude"] as? Double, 46.9)
    }
  }
  ```

- [ ] **Step 2: 失敗確認** — `apple/tools/verify-kit.sh`。

- [ ] **Step 3: モデル実装** — Create `HotelRecommendationModels.swift`:
  ```swift
  import Foundation
  import TripCheckKit

  /// web `POST /api/hotel-recommendations` へ送る。query は送らない(自動探索=4 units)。
  /// routePoints は GeoPoint の合成 Codable で `{latitude,longitude}` に符号化される。
  public struct HotelRecommendationRequestPayload: Encodable, Sendable {
    public let latitude: Double
    public let longitude: Double
    public let area: String
    public let routePoints: [GeoPoint]
    public let languageCode: String   // "ja" | "en"
    public let destination: String    // DestinationChoice.rawValue
    public init(latitude: Double, longitude: Double, area: String, routePoints: [GeoPoint], languageCode: String, destination: String) {
      self.latitude = latitude; self.longitude = longitude; self.area = area
      self.routePoints = routePoints; self.languageCode = languageCode; self.destination = destination
    }
  }

  /// web `HotelCandidate` のテキスト部分。photo/reviews/payment/rakuten/styles/score/priceLevel/座標は無視。
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
  }
  public struct HotelRecommendationResult: Decodable, Sendable, Equatable {
    public let candidates: [HotelCandidate]
  }
  ```

- [ ] **Step 4: プロトコル要件** — `WorkerAuthState.swift` の `WorkerAuthenticating` に `placeIntelligence` の隣へ:
  ```swift
  /// 検証済みの宿候補。失敗・未認証・到達不能はすべて nil。
  func hotelRecommendations(_ payload: HotelRecommendationRequestPayload) async -> HotelRecommendationResult?
  ```

- [ ] **Step 5: WorkerClient 実装** — `WorkerClient.swift` の `placeIntelligence`/`placeIntelligenceOnce` の直後に、`foodRecommendations` を鏡写し（`enum HotelOnce`、POST `/api/hotel-recommendations`、401 一回再試行）。

- [ ] **Step 6: 6 conformer に nil スタブ** — `CannedWorkerClient`(`placeIntelligence` の次)+ `StubWorker`/`SlowStubWorker`/`FakeRouteWorker` に:
  ```swift
  func hotelRecommendations(_ payload: HotelRecommendationRequestPayload) async -> HotelRecommendationResult? { nil }
  ```

- [ ] **Step 7: FakeGateway + 401 テスト** — `WorkerClientTests.swift`:`FakeGateway` に `hotelUnauthorizedOnce`(`configure` にも)、`respond` に `case "/api/hotel-recommendations":`(401 一回 → 200 で `{"provider":"google_maps","fetchedAt":"t","evidenceProviders":{"rakuten":false},"candidates":[{"id":"h1","name":"Hotel Bern","address":"a","googleMapsUrl":"u","websiteUrl":null,"rating":4.3,"userRatingCount":10,"distanceMeters":320,"routeBurdenMeters":800}]}` を返す)、テスト `testHotelRecommendationsRetriesOnceOn401`(result?.candidates.first?.id == "h1")。

- [ ] **Step 8: 全緑確認** — `apple/tools/verify-kit.sh`。

- [ ] **Step 9: コミット** — trailer 付き。

---

### Task 2: lazy パイプライン(seam + アダプタ + availability + PlannerStore + テスト)

**Files:** Create `.../Providers/HotelRecommender.swift`,`.../Store/PlannerStore+HotelRecommendations.swift`; Modify `.../Store/PlannerStore.swift`(フィールド + init param); Modify 5 invalidate サイト(各 `invalidateFoodRecommendations()` の隣); Create `.../Tests/.../PlannerStoreHotelRecommendationsTests.swift`.

**Interfaces consumes:** Task 1 型/`hotelRecommendations`。Kit `Bases.hotelRouteContext`/`HotelRouteContext`(public init `latitude:longitude:area:routePoints:spreadKm:`)/`GeoPoint`。
**produces:** `HotelRecommending`/`WorkerHotelRecommender(client:timeout:)`/`HotelRecommendationAvailability.makeDefaultProvider(uiTesting:client:)`、`HotelRecommendationsState`、`PlannerStore.hotelRecommendations`、`.hotelRecommendationsAvailable`、`.loadHotelRecommendations()`、`.invalidateHotelRecommendations()`、`.init(... hotelRecommendationProvider:)`。

- [ ] **Step 1: 失敗テスト** — Create `PlannerStoreHotelRecommendationsTests.swift`(`PlannerStoreFoodRecommendationsTests` を鏡写し、**関数名は `hotel` 接頭辞で top-level 衝突回避**):
  ```swift
  import Testing
  @testable import TripCheckAppCore
  import TripCheckKit

  @MainActor private final class FakeHotel: HotelRecommending {
    var calls = 0; var lastPayload: HotelRecommendationRequestPayload?
    var answer: HotelRecommendationResult?; var sleep: Duration?
    init(answer: HotelRecommendationResult?, sleep: Duration? = nil) { self.answer = answer; self.sleep = sleep }
    func recommendations(_ payload: HotelRecommendationRequestPayload) async -> HotelRecommendationResult? {
      calls += 1; lastPayload = payload
      if let sleep { try? await Task.sleep(for: sleep) }
      return answer
    }
  }
  private func ctx() -> HotelRouteContext {
    HotelRouteContext(latitude: 46.9, longitude: 7.4, area: "Bern",
      routePoints: [GeoPoint(latitude: 46.9, longitude: 7.4)], spreadKm: 3)
  }
  private func result() -> HotelRecommendationResult {
    HotelRecommendationResult(candidates: [HotelCandidate(id: "h1", name: "Hotel Bern", address: "a",
      googleMapsUrl: "u", websiteUrl: nil, rating: 4.3, userRatingCount: 10, distanceMeters: 320, routeBurdenMeters: 800)])
  }
  @MainActor private func store(_ p: (any HotelRecommending)?) -> PlannerStore {
    PlannerStore(resolvers: [], store: nil, hotelRecommendationProvider: p)
  }

  @Test @MainActor func hotelFetchLoadsAndMapsPayload() async throws {
    let fake = FakeHotel(answer: result()); let s = store(fake)
    s.beginHotelFetch(ctx())
    #expect(s.hotelRecommendations == .loading)
    await s.hotelRecommendationTask?.value
    guard case .loaded(let cs) = s.hotelRecommendations else { return #expect(Bool(false)) }
    #expect(cs.first?.id == "h1")
    #expect(fake.lastPayload?.area == "Bern")
    #expect(fake.lastPayload?.routePoints.count == 1)
    #expect(fake.lastPayload?.languageCode == "ja")
    #expect(fake.lastPayload?.destination == s.request.destination.rawValue)
  }
  @Test @MainActor func hotelNilResultBecomesUnavailable() async throws {
    let s = store(FakeHotel(answer: nil)); s.beginHotelFetch(ctx())
    await s.hotelRecommendationTask?.value
    #expect(s.hotelRecommendations == .unavailable)
  }
  @Test @MainActor func hotelStaleResultDroppedByGenerationGuard() async throws {
    let fake = FakeHotel(answer: result(), sleep: .milliseconds(80)); let s = store(fake)
    s.beginHotelFetch(ctx())
    let running = s.hotelRecommendationTask
    s.invalidateHotelRecommendations()
    #expect(s.hotelRecommendations == nil)
    await running?.value
    #expect(s.hotelRecommendations == nil)
  }
  @Test @MainActor func hotelNilProviderIsUnavailable() async {
    let s = store(nil); s.beginHotelFetch(ctx())
    #expect(s.hotelRecommendations == .unavailable)
  }
  ```

- [ ] **Step 2: 失敗確認** — `apple/tools/verify-kit.sh`。

- [ ] **Step 3: seam・アダプタ・availability** — Create `HotelRecommender.swift`(`FoodRecommender.swift` を鏡写し、型名 `HotelRecommending`/`WorkerHotelRecommender`/`HotelRecommendationAvailability`、メソッド `recommendations(_:)`、8s レース、uiTesting→nil)。

- [ ] **Step 4: PlannerStore フィールド + init param** — `PlannerStore.swift`:食事フィールドの後に:
  ```swift
  // MARK: - 近くの宿(観測しない。hotelRecommendations だけが観測される。spec 2026-08-26)
  @ObservationIgnored let hotelRecommendationProvider: (any HotelRecommending)?
  @ObservationIgnored var hotelRecommendationGeneration = 0
  @ObservationIgnored var hotelRecommendationTask: Task<Void, Never>?
  public internal(set) var hotelRecommendations: HotelRecommendationsState?
  ```
  init に `hotelRecommendationProvider: (any HotelRecommending)? = nil`(`foodRecommendationProvider` の後、既定 nil)+ 代入。

- [ ] **Step 5: パイプライン実装** — Create `PlannerStore+HotelRecommendations.swift`:
  ```swift
  import Foundation
  import TripCheckKit

  public enum HotelRecommendationsState: Equatable, Sendable {
    case loading; case loaded([HotelCandidate]); case unavailable
  }

  extension PlannerStore {
    /// カードの表示可否。scheduled stops があれば経路アンカーが立つ。
    public var hotelRecommendationsAvailable: Bool {
      guard let bundle else { return false }
      return Bases.hotelRouteContext(for: bundle.plan) != nil
    }

    /// シートを開いたときの入口。プラン単位に一度だけ取りに行く。
    public func loadHotelRecommendations() {
      guard let bundle, let ctx = Bases.hotelRouteContext(for: bundle.plan) else { return }
      switch hotelRecommendations {
      case .loading, .loaded: return
      case .unavailable, .none: beginHotelFetch(ctx)
      }
    }

    /// 実取得。テストは HotelRouteContext を直接渡す。
    func beginHotelFetch(_ ctx: HotelRouteContext) {
      hotelRecommendationTask?.cancel()
      guard let provider = hotelRecommendationProvider else {
        hotelRecommendations = .unavailable
        return
      }
      hotelRecommendations = .loading
      let payload = HotelRecommendationRequestPayload(
        latitude: ctx.latitude, longitude: ctx.longitude, area: ctx.area, routePoints: ctx.routePoints,
        languageCode: request.locale.rawValue, destination: request.destination.rawValue)
      let generation = hotelRecommendationGeneration
      hotelRecommendationTask = Task { [weak self] in
        let result = await provider.recommendations(payload)
        guard let self, self.hotelRecommendationGeneration == generation, !Task.isCancelled else { return }
        self.hotelRecommendations = result.map { .loaded($0.candidates) } ?? .unavailable
        self.hotelRecommendationTask = nil
      }
    }

    func invalidateHotelRecommendations() {
      hotelRecommendationGeneration &+= 1
      hotelRecommendationTask?.cancel()
      hotelRecommendationTask = nil
      hotelRecommendations = nil
    }
  }
  ```

- [ ] **Step 6: invalidate を 5 経路に** — `grep -rn "invalidateFoodRecommendations()" apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Store/` の各行の直後に `invalidateHotelRecommendations()`。

- [ ] **Step 7: 全緑確認** — `apple/tools/verify-kit.sh`。

- [ ] **Step 8: コミット** — trailer 付き。

---

### Task 3: UI + 合成の根配線(カード + シート + PlanScreen + AppCopy + 検証)

**Files:** Modify `apple/TripCheck/App/TripCheckApp.swift`(**配線必須**); Modify `apple/TripCheck/Screens/Plan/PlanScreen.swift`; Create `apple/TripCheck/Screens/Plan/SuggestedHotelsCard.swift`; Create `apple/TripCheck/Screens/Plan/HotelRecommendationsSheet.swift`; Modify `.../Presentation/AppCopy.swift`; Modify `apple/TripCheckUITests/PlannerFlowTests.swift`(可能なら).

- [ ] **Step 1: 合成の根配線** — `TripCheckApp.swift` の `PlannerStore.init(...)` に、`foodRecommendationProvider:`/`placeIntelligenceProvider:` の隣へ:
  ```swift
  hotelRecommendationProvider: HotelRecommendationAvailability.makeDefaultProvider(uiTesting: isUITesting, client: workerClient),
  ```
  （同一 workerClient、UI テストは nil。**配線が無いと実アプリで no-op。**)

- [ ] **Step 2: AppCopy 文言** — `AppCopy.swift` に既存記法で ja/en:
  - `suggestedHotelsTitle`: ja "近くの宿" / en "Hotels nearby"
  - `hotelRecommendationsSheetTitle`: ja "経路に近い宿" / en "Hotels near your route"
  - `hotelRecommendationsEmpty`: ja "候補が見つかりませんでした" / en "No hotels found"
  - `hotelRouteBurden`: ja "経路から約" / en "off route by"(数値+"km" を後置; 実装で `"\(app.hotelRouteBurden) \(km) km"` の語順に注意、en は "off route by 1.2 km")

- [ ] **Step 3: カード** — Create `SuggestedHotelsCard.swift`:`@Environment(PlannerStore.self)` + `@State private var showing = false`。`MealRow` 風の破線カード(見出し `app.suggestedHotelsTitle`、`IconView` は**既存の実在 glyph を使うか省く**=bed は無い)。`.contentShape(Rectangle())` + `.onTapGesture { showing = true }` + `.accessibilityAddTraits(.isButton)` + `.accessibilityIdentifier("plan.suggestedHotels")`。`.sheet(isPresented: $showing) { HotelRecommendationsSheet().presentationDetents([.medium, .large]) }`。

- [ ] **Step 4: シート** — Create `HotelRecommendationsSheet.swift`(`FoodRecommendationSheet` を鏡写し):`@Environment(PlannerStore.self)`。`NavigationStack{ … .navigationTitle(app.hotelRecommendationsSheetTitle) }`。`.task { store.loadHotelRecommendations() }` + `.onChange(of: store.hotelRecommendations) { _, now in if now == nil { store.loadHotelRecommendations() } }`。state を表示:`.loading`/nil→スピナー、`.unavailable`/`.loaded([])`→`app.hotelRecommendationsEmpty`、`.loaded(cs)`→各 `HotelCandidate` をカード(name、`rating` を `String(format:"%.1f")`+`(count)`、`routeBurdenMeters` を km に丸めて `app.hotelRouteBurden` と併記、address、`Link(googleMapsUrl)`)。写真なし。各カードに `.accessibilityIdentifier("plan.hotelCandidate")`。`tcFont`/`Tokens` の実在シンボルに合わせる。

- [ ] **Step 5: PlanScreen にカード** — `PlanScreen.swift` の `BeforeYouGoCard()` の**直前**に:
  ```swift
  if store.hotelRecommendationsAvailable { SuggestedHotelsCard() }
  ```

- [ ] **Step 6: kit + app 緑** — `apple/tools/verify-kit.sh`(引数なし)+ `apple/tools/verify-app.sh test`。両緑・新規警告ゼロ。

- [ ] **Step 7: 非回帰 UI テスト(可能なら)** — `PlannerFlowTests.swift` に 1 本。サンプル/既存フローでビルド済みプラン画面に到達し、`plan.suggestedHotels` が出るなら開いて(provider nil=候補なし)シートが出て非回帰を確認。出ないなら報告しパイプライン単体+build に委ねる(flaky にしない)。

- [ ] **Step 8: 手順書追記 + コミット** — `apple/docs/paid-route-check.md` に「近くの宿」節、trailer 付きコミット。
