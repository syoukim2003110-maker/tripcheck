# TripCheck iOS route-detour 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development でタスク単位に実装する。各ステップは `- [ ]`。

**Goal:** 選択日に空きがあれば Plan 画面に「空き時間の寄り道」カードを出し、タップで開いた初回だけ `/api/route-recommendations` を取り、経路沿いで寄れる場所をテキストカードで出す。web/Kit 無改変。

**Architecture:** hotel-recommendations をほぼ鏡写し、**day index キーの dict**に。`WorkerClient.routeRecommendations` → `RouteDetourRecommending`+`WorkerRouteDetourRecommender`(8s レース)→ 世代ガード lazy パイプライン `PlannerStore+RouteDetour`(`bundle.gaps[dayIndex]` を読む)→ PlanScreen の新設カード+シート(選択日)。

**Spec:** `docs/superpowers/specs/2026-08-26-tripcheck-route-detour-ios-design.md`

## Global Constraints
- **web 不可侵**(`lib/**`・`app/api/**`・`worker/**`)。`/api/route-recommendations` は既に paid・app セッション認可・ROUTE default-on・quota=3。
- **Kit 不可侵**(`Sources/TripCheckKit/`)。`bundle.gaps`/`ItineraryGap`/`GapSuggestionKind`/`GeoPoint` は**読むだけ**。新規は `TripCheckAppCore` かアプリターゲット。
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

### Task 1: 取得の配管(モデル + クライアント + 7 スタブ + テスト)

**Files:** Create `.../Worker/RouteDetourModels.swift`; Modify `.../Worker/WorkerAuthState.swift`,`.../Worker/WorkerClient.swift`,`.../Worker/CannedWorkerClient.swift`; Modify(nil スタブ)`.../Tests/.../WorkerPlaceResolverTests.swift`(`StubWorker`・`SlowStubWorker`),`.../Tests/.../WorkerRouteProviderTests.swift`(`FakeRouteWorker`); Modify `.../Tests/.../WorkerClientTests.swift`; Create `.../Tests/.../RouteDetourModelsTests.swift`.

**Interfaces produces:** `RouteRecommendationRequestPayload`(Encodable)、`RouteRecommendation`/`RouteRecommendationResult`(Decodable/Equatable)、`WorkerAuthenticating.routeRecommendations(_:)`。

- [ ] **Step 1: 失敗テスト** — Create `RouteDetourModelsTests.swift`:
  ```swift
  import XCTest
  @testable import TripCheckAppCore
  import TripCheckKit

  final class RouteDetourModelsTests: XCTestCase {
    func testDecodesCandidatesIgnoringRichFields() throws {
      let json = #"""
      {"provider":"google_maps","fetchedAt":"t","candidates":[
        {"id":"g1","providerRef":"ChIJ","name":"Cafe Alpen","address":"1 Marktgasse","type":"cafe","googleMapsUrl":"https://maps.google/g",
         "latitude":46.9,"longitude":7.4,"rating":4.5,"userRatingCount":210,"routeDistanceMeters":180,"photoName":"places/x"}
      ]}
      """#
      let r = try JSONDecoder().decode(RouteRecommendationResult.self, from: Data(json.utf8))
      XCTAssertEqual(r.candidates.count, 1)
      let c = try XCTUnwrap(r.candidates.first)
      XCTAssertEqual(c.id, "g1"); XCTAssertEqual(c.name, "Cafe Alpen"); XCTAssertEqual(c.type, "cafe")
      XCTAssertEqual(c.rating, 4.5); XCTAssertEqual(c.userRatingCount, 210); XCTAssertEqual(c.routeDistanceMeters, 180)
    }
    func testDecodesNullNumerics() throws {
      let json = #"{"candidates":[{"id":"g2","name":"X","address":"","type":"park","googleMapsUrl":"u","rating":null,"userRatingCount":null,"routeDistanceMeters":0}]}"#
      let r = try JSONDecoder().decode(RouteRecommendationResult.self, from: Data(json.utf8))
      XCTAssertNil(r.candidates.first?.rating)
    }
    func testEncodesPayload() throws {
      let payload = RouteRecommendationRequestPayload(
        routePoints: [GeoPoint(latitude: 46.9, longitude: 7.4)], excludedPlaceIds: ["a"], excludedNames: ["N"],
        languageCode: "ja", destination: "auto", suggestionKinds: ["CAFE", "WALK"])
      let obj = try JSONSerialization.jsonObject(with: JSONEncoder().encode(payload)) as? [String: Any]
      XCTAssertEqual((obj?["routePoints"] as? [[String: Any]])?.count, 1)
      XCTAssertEqual(obj?["excludedPlaceIds"] as? [String], ["a"])
      XCTAssertEqual(obj?["suggestionKinds"] as? [String], ["CAFE", "WALK"])
      XCTAssertEqual(obj?["languageCode"] as? String, "ja")
    }
  }
  ```

- [ ] **Step 2: 失敗確認** — `apple/tools/verify-kit.sh`。

- [ ] **Step 3: モデル実装** — Create `RouteDetourModels.swift`(spec §4.2 のとおり:`RouteRecommendationRequestPayload{routePoints:[GeoPoint], excludedPlaceIds:[String], excludedNames:[String], languageCode, destination, suggestionKinds:[String]}`、`RouteRecommendation{id,name,address,type,googleMapsUrl,rating?,userRatingCount?,routeDistanceMeters?}` Decodable/Equatable/Identifiable、`RouteRecommendationResult{candidates}` Decodable/Equatable。全 public init 付き)。

- [ ] **Step 4: プロトコル要件** — `WorkerAuthState.swift` の `WorkerAuthenticating` に `hotelRecommendations` の隣へ:
  ```swift
  /// 経路沿いの寄り道候補。失敗・未認証・到達不能はすべて nil。
  func routeRecommendations(_ payload: RouteRecommendationRequestPayload) async -> RouteRecommendationResult?
  ```

- [ ] **Step 5: WorkerClient 実装** — `WorkerClient.swift` の `hotelRecommendations`/`hotelRecommendationsOnce` の直後に、それを鏡写し(`enum RouteOnce`… ただし既存の `ResolveOnce` 等と名前衝突しないよう `RouteRecOnce` 等一意な名前、POST `/api/route-recommendations`、401 一回再試行)。

- [ ] **Step 6: 7 conformer に nil スタブ** — `CannedWorkerClient`(`hotelRecommendations` の次)+ `StubWorker`/`SlowStubWorker`/`FakeRouteWorker` に `func routeRecommendations(_:) async -> RouteRecommendationResult? { nil }`。

- [ ] **Step 7: FakeGateway + 401 テスト** — `WorkerClientTests.swift`:`FakeGateway` に `routeUnauthorizedOnce`(`configure` にも)、`respond` に `case "/api/route-recommendations":`(401 一回 → 200 で `{"provider":"google_maps","fetchedAt":"t","candidates":[{"id":"g1","providerRef":"ChIJ","name":"Cafe Alpen","address":"a","type":"cafe","googleMapsUrl":"u","latitude":46.9,"longitude":7.4,"rating":4.5,"userRatingCount":10,"routeDistanceMeters":180}]}` を返す)、テスト `testRouteRecommendationsRetriesOnceOn401`(result?.candidates.first?.id == "g1")。

- [ ] **Step 8: 全緑確認** — `apple/tools/verify-kit.sh`。

- [ ] **Step 9: コミット** — trailer 付き。

---

### Task 2: lazy パイプライン(seam + アダプタ + availability + PlannerStore + テスト)

**Files:** Create `.../Providers/RouteDetourRecommender.swift`,`.../Store/PlannerStore+RouteDetour.swift`; Modify `.../Store/PlannerStore.swift`(フィールド + init param); Modify 5 invalidate サイト(各 `invalidateHotelRecommendations()` の隣); Create `.../Tests/.../PlannerStoreRouteDetourTests.swift`.

**Interfaces consumes:** Task 1 型/`routeRecommendations`。Kit `ItineraryGap`(public init: `id:dayIndex:kind:sizeBand:startAt:endAt:availableMinutes:previousAnchorId:nextAnchorId:routeSegment:suggestionKinds:`)、`ItineraryGap.RouteSegment(from:to:)`、`GapKind.BETWEEN_ANCHORS`、`GapSizeBand.MEDIUM_60_TO_119`、`GapSuggestionKind.CAFE`/`.WALK`、`bundle.gaps`。
**produces:** `RouteDetourRecommending`/`WorkerRouteDetourRecommender(client:timeout:)`/`RouteDetourAvailability.makeDefaultProvider(uiTesting:client:)`、`GapDetourState`、`PlannerStore.gapDetourByDay`、`.gapDetourAvailable(_:)`、`.gapDetourTimeRange(_:)`、`.loadGapDetour(dayIndex:)`、`.invalidateRouteDetour()`、`.init(... routeDetourProvider:)`。

- [ ] **Step 1: 失敗テスト** — Create `PlannerStoreRouteDetourTests.swift`(`hotel` 群に倣い**関数名は `detour` 接頭辞**で top-level 衝突回避):
  ```swift
  import Testing
  @testable import TripCheckAppCore
  import TripCheckKit

  @MainActor private final class FakeDetour: RouteDetourRecommending {
    var calls = 0; var lastPayload: RouteRecommendationRequestPayload?
    var answer: RouteRecommendationResult?; var sleep: Duration?
    init(answer: RouteRecommendationResult?, sleep: Duration? = nil) { self.answer = answer; self.sleep = sleep }
    func recommendations(_ payload: RouteRecommendationRequestPayload) async -> RouteRecommendationResult? {
      calls += 1; lastPayload = payload
      if let sleep { try? await Task.sleep(for: sleep) }
      return answer
    }
  }
  private func gap(from: GeoPoint? = GeoPoint(latitude: 46.9, longitude: 7.4),
                   to: GeoPoint? = GeoPoint(latitude: 47.0, longitude: 7.5)) -> ItineraryGap {
    ItineraryGap(id: "gap-0", dayIndex: 0, kind: .BETWEEN_ANCHORS, sizeBand: .MEDIUM_60_TO_119,
      startAt: "13:00", endAt: "15:00", availableMinutes: 120, previousAnchorId: "s1", nextAnchorId: "s2",
      routeSegment: ItineraryGap.RouteSegment(from: from, to: to), suggestionKinds: [.CAFE, .WALK])
  }
  private func result() -> RouteRecommendationResult {
    RouteRecommendationResult(candidates: [RouteRecommendation(id: "g1", name: "Cafe", address: "a",
      type: "cafe", googleMapsUrl: "u", rating: 4.5, userRatingCount: 10, routeDistanceMeters: 180)])
  }
  @MainActor private func store(_ p: (any RouteDetourRecommending)?) -> PlannerStore {
    PlannerStore(resolvers: [], store: nil, routeDetourProvider: p)
  }

  @Test @MainActor func detourFetchLoadsAndMapsPayload() async throws {
    let fake = FakeDetour(answer: result()); let s = store(fake)
    s.beginGapDetourFetch(dayIndex: 0, gap: gap(), excludedPlaceIds: ["x"], excludedNames: ["N"])
    #expect(s.gapDetourByDay[0] == .loading)
    await s.routeDetourTasks[0]?.value
    guard case .loaded(let cs) = s.gapDetourByDay[0] else { return #expect(Bool(false)) }
    #expect(cs.first?.id == "g1")
    #expect(fake.lastPayload?.routePoints.count == 2)              // from + to
    #expect(fake.lastPayload?.suggestionKinds == ["CAFE", "WALK"])
    #expect(fake.lastPayload?.excludedPlaceIds == ["x"])
    #expect(fake.lastPayload?.languageCode == "ja")
  }
  @Test @MainActor func detourOneNilEndpointYieldsOnePoint() async throws {
    let fake = FakeDetour(answer: result()); let s = store(fake)
    s.beginGapDetourFetch(dayIndex: 0, gap: gap(from: nil), excludedPlaceIds: [], excludedNames: [])
    await s.routeDetourTasks[0]?.value
    #expect(fake.lastPayload?.routePoints.count == 1)              // to のみ
  }
  @Test @MainActor func detourNilResultBecomesUnavailable() async throws {
    let s = store(FakeDetour(answer: nil))
    s.beginGapDetourFetch(dayIndex: 0, gap: gap(), excludedPlaceIds: [], excludedNames: [])
    await s.routeDetourTasks[0]?.value
    #expect(s.gapDetourByDay[0] == .unavailable)
  }
  @Test @MainActor func detourStaleResultDroppedByGenerationGuard() async throws {
    let fake = FakeDetour(answer: result(), sleep: .milliseconds(80)); let s = store(fake)
    s.beginGapDetourFetch(dayIndex: 0, gap: gap(), excludedPlaceIds: [], excludedNames: [])
    let running = s.routeDetourTasks[0]
    s.invalidateRouteDetour()
    #expect(s.gapDetourByDay.isEmpty)
    await running?.value
    #expect(s.gapDetourByDay[0] == nil)
  }
  @Test @MainActor func detourNilProviderIsUnavailable() async {
    let s = store(nil)
    s.beginGapDetourFetch(dayIndex: 0, gap: gap(), excludedPlaceIds: [], excludedNames: [])
    #expect(s.gapDetourByDay[0] == .unavailable)
  }
  ```

- [ ] **Step 2: 失敗確認** — `apple/tools/verify-kit.sh`。

- [ ] **Step 3: seam・アダプタ・availability** — Create `RouteDetourRecommender.swift`(`HotelRecommender.swift` を鏡写し、型名 `RouteDetourRecommending`/`WorkerRouteDetourRecommender`/`RouteDetourAvailability`、メソッド `recommendations(_:)`、8s レース、uiTesting→nil)。

- [ ] **Step 4: PlannerStore フィールド + init param** — `PlannerStore.swift`:hotel フィールドの後に:
  ```swift
  // MARK: - 空き時間の寄り道(観測しない。gapDetourByDay だけが観測される。spec 2026-08-26)
  @ObservationIgnored let routeDetourProvider: (any RouteDetourRecommending)?
  @ObservationIgnored var routeDetourGeneration = 0
  @ObservationIgnored var routeDetourTasks: [Int: Task<Void, Never>] = [:]
  public internal(set) var gapDetourByDay: [Int: GapDetourState] = [:]
  ```
  init に `routeDetourProvider: (any RouteDetourRecommending)? = nil`(既存 provider 群の後、既定 nil)+ 代入。

- [ ] **Step 5: パイプライン実装** — Create `PlannerStore+RouteDetour.swift`:
  ```swift
  import Foundation
  import TripCheckKit

  public enum GapDetourState: Equatable, Sendable {
    case loading; case loaded([RouteRecommendation]); case unavailable
  }

  extension PlannerStore {
    /// カードの表示可否(その日に空きがあるか)。
    public func gapDetourAvailable(_ dayIndex: Int) -> Bool { bundle?.gaps[dayIndex] != nil }
    /// カードに出す時刻範囲。
    public func gapDetourTimeRange(_ dayIndex: Int) -> String? {
      bundle?.gaps[dayIndex].map { "\($0.startAt)\u{2013}\($0.endAt)" }
    }

    /// シートを開いたときの入口。excluded は全日の停留所から組む。
    public func loadGapDetour(dayIndex: Int) {
      guard let bundle, let gap = bundle.gaps[dayIndex] else { return }
      switch gapDetourByDay[dayIndex] {
      case .loading, .loaded: return
      case .unavailable, .none:
        let stops = bundle.plan.days.flatMap { $0.stops.map { $0.stop } }
        beginGapDetourFetch(dayIndex: dayIndex, gap: gap,
          excludedPlaceIds: stops.compactMap { $0.providerRef },
          excludedNames: stops.map { $0.name })
      }
    }

    /// 実取得。テストは gap と excluded を直接渡す(BuiltPlan は不要)。
    func beginGapDetourFetch(dayIndex: Int, gap: ItineraryGap, excludedPlaceIds: [String], excludedNames: [String]) {
      routeDetourTasks[dayIndex]?.cancel()
      guard let provider = routeDetourProvider else {
        gapDetourByDay[dayIndex] = .unavailable
        return
      }
      gapDetourByDay[dayIndex] = .loading
      let payload = RouteRecommendationRequestPayload(
        routePoints: [gap.routeSegment.from, gap.routeSegment.to].compactMap { $0 },
        excludedPlaceIds: excludedPlaceIds, excludedNames: excludedNames,
        languageCode: request.locale.rawValue, destination: request.destination.rawValue,
        suggestionKinds: gap.suggestionKinds.map { $0.rawValue })
      let generation = routeDetourGeneration
      routeDetourTasks[dayIndex] = Task { [weak self] in
        let result = await provider.recommendations(payload)
        guard let self, self.routeDetourGeneration == generation, !Task.isCancelled else { return }
        self.gapDetourByDay[dayIndex] = result.map { .loaded($0.candidates) } ?? .unavailable
        self.routeDetourTasks[dayIndex] = nil
      }
    }

    func invalidateRouteDetour() {
      routeDetourGeneration &+= 1
      for task in routeDetourTasks.values { task.cancel() }
      routeDetourTasks = [:]
      gapDetourByDay = [:]
    }
  }
  ```

- [ ] **Step 6: invalidate を 5 経路に** — `grep -rn "invalidateHotelRecommendations()" apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Store/` の各行の直後に `invalidateRouteDetour()`。

- [ ] **Step 7: 全緑確認** — `apple/tools/verify-kit.sh`。

- [ ] **Step 8: コミット** — trailer 付き。

---

### Task 3: UI + 合成の根配線(カード + シート + PlanScreen + AppCopy + 検証)

**Files:** Modify `apple/TripCheck/App/TripCheckApp.swift`(**配線必須**); Modify `apple/TripCheck/Screens/Plan/PlanScreen.swift`; Create `apple/TripCheck/Screens/Plan/GapDetourCard.swift`,`apple/TripCheck/Screens/Plan/RouteDetourSheet.swift`; Modify `.../Presentation/AppCopy.swift`; Modify `apple/TripCheckUITests/PlannerFlowTests.swift`(可能なら).

- [ ] **Step 1: 合成の根配線** — `TripCheckApp.swift` の `PlannerStore.init(...)` に、既存 provider 群(food/hotel/placeIntel)の隣へ、**宣言順に合わせて**:
  ```swift
  routeDetourProvider: RouteDetourAvailability.makeDefaultProvider(uiTesting: isUITesting, client: workerClient),
  ```
  （Swift は呼び出し側の引数順=宣言順を要求。宣言で routeDetourProvider をどこに置いたかに合わせる。同一 workerClient、UI テストは nil。**配線が無いと no-op。**)

- [ ] **Step 2: AppCopy 文言** — `AppCopy.swift` に ja/en:
  - `gapDetourTitle`: ja "空き時間の寄り道" / en "Fill your spare time"
  - `routeDetourSheetTitle`: ja "経路沿いの寄り道" / en "Detours along your route"
  - `routeDetourEmpty`: ja "候補が見つかりませんでした" / en "No suggestions found"
  - `routeDetourDistance`: ja "経路から約" / en "off route by"(数値+"m" を後置)

- [ ] **Step 3: カード** — Create `GapDetourCard.swift`:`let dayIndex: Int`、`@Environment(PlannerStore.self)` + `@State private var showing = false`。`SuggestedHotelsCard` 風の破線カード(見出し `app.gapDetourTitle`、副題に `store.gapDetourTimeRange(dayIndex) ?? ""`、`IconView` は既存 glyph か省く)。`.onTapGesture { showing = true }` + `.accessibilityAddTraits(.isButton)` + `.accessibilityIdentifier("plan.gapDetour")`。`.sheet(isPresented: $showing) { RouteDetourSheet(dayIndex: dayIndex).presentationDetents([.medium, .large]) }`。

- [ ] **Step 4: シート** — Create `RouteDetourSheet.swift`(`HotelRecommendationsSheet` を鏡写し):`let dayIndex: Int`。`.task { store.loadGapDetour(dayIndex: dayIndex) }` + `.onChange(of: store.gapDetourByDay[dayIndex]) { _, now in if now == nil { store.loadGapDetour(dayIndex: dayIndex) } }`。state 表示:`.loading`/nil→スピナー、`.unavailable`/`.loaded([])`→`app.routeDetourEmpty`、`.loaded(cs)`→各 `RouteRecommendation` をカード(name、type、rating 数値(count)、`routeDistanceMeters` を m 表示で `app.routeDetourDistance` 併記、address、`Link(googleMapsUrl)`)。各カードに `.accessibilityIdentifier("plan.detourCandidate")`。`tcFont`/`Tokens` 実在シンボルに合わせる。

- [ ] **Step 5: PlanScreen にカード** — `PlanScreen.swift` の `SuggestedHotelsCard` を出す箇所の隣に:
  ```swift
  if store.gapDetourAvailable(selectedDay) { GapDetourCard(dayIndex: selectedDay) }
  ```

- [ ] **Step 6: kit + app 緑** — `apple/tools/verify-kit.sh`(引数なし)+ `apple/tools/verify-app.sh test`。両緑・新規警告ゼロ。

- [ ] **Step 7: 非回帰 UI テスト(可能なら)** — `PlannerFlowTests.swift` に 1 本。サンプル/既存フローでビルド済みプラン画面に到達し、`plan.gapDetour` が出るなら開いて(provider nil=候補なし)シートが出て非回帰。出ないなら報告しパイプライン単体+build に委ねる(flaky にしない)。

- [ ] **Step 8: 手順書追記 + コミット** — `apple/docs/paid-route-check.md` に「空き時間の寄り道」節、trailer 付きコミット。
