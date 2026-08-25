# TripCheck iOS live-routes 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development でタスク単位に実装する。各ステップは `- [ ]`。

**Goal:** 経路 enrichment の第一情報源を Worker 経由の Google Routes(`/api/live-routes`)にし、Google が綺麗に答えれば Google の分数/距離/ポリラインを、答えられなければ端末内 Apple(MKDirections)へフォールバックする。web/Kit 無改変。

**Architecture:** `WorkerClient.liveRoutes`(resolvePlaces/suggestPlaces を鏡写し)→ `WorkerRouteProvider: RouteProvider`(`client` と `fallback: any RouteProvider` を持ち、Google と Apple を `async let` で並行、Google の綺麗な `.measured` を優先、無ければ Apple)→ 合成の根 1 行を差し替え。`encodedPolyline` は AppCore 新設の `GooglePolyline.decode` で復号し既存 `PolylineSimplifier.thinned` に通す。

**Tech Stack:** Swift 6、`RouteProvider`(Kit・凍結)、swift-testing。

**Spec:** `docs/superpowers/specs/2026-08-25-tripcheck-live-routes-ios-design.md`

## Global Constraints
- **web 不可侵**(`lib/**`・`app/api/**`・`worker/**`)。本機能は web/Worker 変更を要しない(`/api/live-routes` は既に paid・app セッション認可・quota=leg 数)。
- **Kit 不可侵**(`Sources/TripCheckKit/`)。新規型・部品は `TripCheckAppCore`。合成の根の 1 行だけ `apple/TripCheck/`。
- **Swift 6 strict concurrency 新規警告ゼロ。** 越境型は `Sendable`。
- **絵文字禁止。** 本機能は UI 文言を足さない(`AppCopy` 変更なし)。
- **`git push` しない。**
- **コミット trailer 厳守:**
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_012DRrRBiU96fLJmvfThaR4J
  ```
- **検証:** `apple/tools/verify-kit.sh`(**引数なし**)全緑、`apple/tools/verify-app.sh test`(app unit/UI)全緑、新規警告ゼロ。

---

### Task 1: 取得の配管(モデル + polyline デコーダ + クライアント + スタブ + テスト)

**Files:**
- Create: `apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Worker/LiveRouteModels.swift`
- Create: `apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Map/GooglePolyline.swift`
- Modify: `apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Worker/WorkerAuthState.swift`
- Modify: `apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Worker/WorkerClient.swift`
- Modify: `apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Worker/CannedWorkerClient.swift`
- Modify: `apple/Packages/TripCheckKit/Tests/TripCheckAppCoreTests/WorkerPlaceResolverTests.swift`（`StubWorker`・`SlowStubWorker` に nil スタブ）
- Modify: `apple/Packages/TripCheckKit/Tests/TripCheckAppCoreTests/WorkerClientTests.swift`
- Create: `apple/Packages/TripCheckKit/Tests/TripCheckAppCoreTests/LiveRouteModelsTests.swift`
- Create: `apple/Packages/TripCheckKit/Tests/TripCheckAppCoreTests/GooglePolylineTests.swift`

**Interfaces:**
- Produces: `LiveRouteLegPayload`/`LiveRoutesRequestPayload`(Encodable/Sendable)、`LiveRouteLegResult`/`LiveRoutesResult`(Decodable/Sendable)、`GooglePolyline.decode(_:) -> [GeoPoint]`、`WorkerAuthenticating.liveRoutes(_:) async -> LiveRoutesResult?`。
- Consumes: Kit `GeoPoint`(Codable)、既存 `WorkerRequest`/`transport.send`/`ensureSession`/`authenticate`。

- [ ] **Step 1: 失敗テストを書く**
  - Create `GooglePolylineTests.swift`:
    ```swift
    import Testing
    @testable import TripCheckAppCore
    import TripCheckKit

    @Test func decodesGoogleReferenceExample() {
      // Google 公式の canonical 例(1e-5 デルタ符号化)。
      let points = GooglePolyline.decode("_p~iF~ps|U_ulLnnqC_mqNvxq`@")
      #expect(points.count == 3)
      let expected = [
        GeoPoint(latitude: 38.5, longitude: -120.2),
        GeoPoint(latitude: 40.7, longitude: -120.95),
        GeoPoint(latitude: 43.252, longitude: -126.453),
      ]
      for (p, e) in zip(points, expected) {
        #expect(abs(p.latitude - e.latitude) < 1e-9)
        #expect(abs(p.longitude - e.longitude) < 1e-9)
      }
    }

    @Test func emptyOrPartialDecodesToEmpty() {
      #expect(GooglePolyline.decode("").isEmpty)
      #expect(GooglePolyline.decode("_p~iF").isEmpty)   // 緯度デルタだけで経度が無い → 空
      #expect(GooglePolyline.decode("_").isEmpty)        // 1 チャンクだけ → 空
    }
    ```
  - Create `LiveRouteModelsTests.swift`:
    ```swift
    import XCTest
    @testable import TripCheckAppCore
    import TripCheckKit

    final class LiveRouteModelsTests: XCTestCase {
      func testDecodesResponseAndIgnoresRichTransitFields() throws {
        let json = #"""
        {"provider":"google_maps","fetchedAt":"t","travelMode":"TRANSIT","legs":[
          {"id":"L1","durationMinutes":34,"distanceMeters":12000,"encodedPolyline":"abc",
           "transferCount":1,"transitSteps":[{"lineName":"IC 61"}],"walkToStopMinutes":4,"walkFromStopMinutes":3,"status":"ok"}
        ]}
        """#
        let result = try JSONDecoder().decode(LiveRoutesResult.self, from: Data(json.utf8))
        XCTAssertEqual(result.legs.count, 1)
        let leg = try XCTUnwrap(result.legs.first)
        XCTAssertEqual(leg.id, "L1")
        XCTAssertEqual(leg.durationMinutes, 34)
        XCTAssertEqual(leg.distanceMeters, 12000)
        XCTAssertEqual(leg.encodedPolyline, "abc")
        XCTAssertEqual(leg.status, "ok")
      }

      func testEncodesRequestWithGeoPointCoordinates() throws {
        let payload = LiveRoutesRequestPayload(
          legs: [LiveRouteLegPayload(id: "L1", origin: GeoPoint(latitude: 1.5, longitude: 2.5),
                                     destination: GeoPoint(latitude: 3.5, longitude: 4.5), departureTime: "2026-08-25T00:00:00Z")],
          languageCode: "ja", travelMode: "WALK")
        let obj = try JSONSerialization.jsonObject(with: JSONEncoder().encode(payload)) as? [String: Any]
        XCTAssertEqual(obj?["languageCode"] as? String, "ja")
        XCTAssertEqual(obj?["travelMode"] as? String, "WALK")
        let legs = obj?["legs"] as? [[String: Any]]
        let origin = legs?.first?["origin"] as? [String: Any]
        XCTAssertEqual(origin?["latitude"] as? Double, 1.5)
        XCTAssertEqual(origin?["longitude"] as? Double, 2.5)
      }
    }
    ```

- [ ] **Step 2: 失敗を確認** — `export PATH=/opt/homebrew/bin:$PATH && apple/tools/verify-kit.sh`。Expected: 型未定義でコンパイル失敗。

- [ ] **Step 3: モデルを実装** — Create `LiveRouteModels.swift`:
  ```swift
  import Foundation
  import TripCheckKit

  /// web `POST /api/live-routes` の 1 レグ。origin/destination は GeoPoint の合成 Codable が
  /// そのまま `{latitude,longitude}` に符号化される(web `LiveRouteCoordinate` と同形)。
  public struct LiveRouteLegPayload: Encodable, Sendable {
    public let id: String
    public let origin: GeoPoint
    public let destination: GeoPoint
    public let departureTime: String   // ISO8601（web は全レグ必須）
    public init(id: String, origin: GeoPoint, destination: GeoPoint, departureTime: String) {
      self.id = id; self.origin = origin; self.destination = destination; self.departureTime = departureTime
    }
  }

  public struct LiveRoutesRequestPayload: Encodable, Sendable {
    public let legs: [LiveRouteLegPayload]
    public let languageCode: String    // "ja" | "en"
    public let travelMode: String      // "WALK" | "DRIVE" | "TRANSIT"（バッチ全体で 1 つ）
    public init(legs: [LiveRouteLegPayload], languageCode: String, travelMode: String) {
      self.legs = legs; self.languageCode = languageCode; self.travelMode = travelMode
    }
  }

  /// web `LiveRouteResult` の写し。表現できない付随フィールド（transferCount / transitSteps /
  /// walkToStopMinutes / walkFromStopMinutes）はデコードで無視される。
  public struct LiveRouteLegResult: Decodable, Sendable {
    public let id: String
    public let durationMinutes: Int?
    public let distanceMeters: Int?
    public let encodedPolyline: String?
    public let status: String          // "ok" | "unavailable"
  }

  public struct LiveRoutesResult: Decodable, Sendable {
    public let legs: [LiveRouteLegResult]
  }
  ```

- [ ] **Step 4: polyline デコーダを実装** — Create `GooglePolyline.swift`(`lib/google-polyline.ts` の忠実な移植。JS の 32bit 演算に合わせ `Int32`):
  ```swift
  import Foundation
  import TripCheckKit

  /// Google 1e-5 デルタ符号化文字列を [GeoPoint] に復号する。部分入力は受け取らない
  /// （緯度経度が揃わない/不正チャンクは空配列）。web `lib/google-polyline.ts` の移植。
  public enum GooglePolyline {
    public static func decode(_ value: String) -> [GeoPoint] {
      if value.isEmpty { return [] }
      let scalars = Array(value.unicodeScalars)
      var points: [GeoPoint] = []
      var cursor = 0
      var latitude = 0
      var longitude = 0

      func readDelta() -> Int? {
        var result: Int32 = 0
        var shift: Int32 = 0
        while cursor < scalars.count && shift <= 30 {
          let chunk = Int32(scalars[cursor].value) - 63
          cursor += 1
          if chunk < 0 || chunk > 63 { return nil }
          result |= (chunk & 0x1f) << shift
          if chunk < 0x20 { return Int((result & 1) != 0 ? ~(result >> 1) : (result >> 1)) }
          shift += 5
        }
        return nil
      }

      while cursor < scalars.count {
        guard let dLat = readDelta(), let dLng = readDelta() else { return [] }
        latitude += dLat
        longitude += dLng
        points.append(GeoPoint(latitude: Double(latitude) / 1e5, longitude: Double(longitude) / 1e5))
      }
      return points
    }
  }
  ```

- [ ] **Step 5: プロトコルに要件追加** — `WorkerAuthState.swift` の `WorkerAuthenticating` に、`resolvePlaces`/`suggestPlaces` の隣へ:
  ```swift
  /// 検証済みの実経路。失敗・未認証・到達不能はすべて nil（=呼び出し側は Apple へ代替）。
  func liveRoutes(_ payload: LiveRoutesRequestPayload) async -> LiveRoutesResult?
  ```

- [ ] **Step 6: WorkerClient に実装** — `WorkerClient.swift` の `suggestPlaces`/`suggestPlacesOnce` ブロックの直後に、`resolvePlaces` を鏡写しした:
  ```swift
  public func liveRoutes(_ payload: LiveRoutesRequestPayload) async -> LiveRoutesResult? {
    let auth = await ensureSession()
    guard case .authenticated = auth, let token = sessionToken else { return nil }
    guard let body = try? JSONEncoder().encode(payload) else { return nil }
    switch await liveRoutesOnce(token: token, body: body) {
    case .resolved(let result): return result
    case .failed: return nil
    case .unauthorized:
      sessionToken = nil
      state = .idle
      let reauth = await authenticate(allowKeyReset: true)
      guard case .authenticated = reauth, let fresh = sessionToken else { return nil }
      if case .resolved(let result) = await liveRoutesOnce(token: fresh, body: body) { return result }
      return nil
    }
  }

  private enum LiveRoutesOnce {
    case resolved(LiveRoutesResult)
    case unauthorized
    case failed
  }

  private func liveRoutesOnce(token: String, body: Data) async -> LiveRoutesOnce {
    do {
      let response = try await transport.send(
        WorkerRequest(path: "/api/live-routes", method: "POST", body: body, sessionToken: token),
        baseURL: baseURL
      )
      if response.status == 200 {
        guard let decoded = try? JSONDecoder().decode(LiveRoutesResult.self, from: response.body) else { return .failed }
        return .resolved(decoded)
      }
      if response.status == 401 { return .unauthorized }
      return .failed
    } catch {
      return .failed
    }
  }
  ```

- [ ] **Step 7: Canned とテストスタブ**
  - `CannedWorkerClient.swift` の `suggestPlaces` の次に:
    ```swift
    public func liveRoutes(_ payload: LiveRoutesRequestPayload) async -> LiveRoutesResult? { nil }
    ```
  - `WorkerPlaceResolverTests.swift`：`StubWorker` と `SlowStubWorker` の**両方**に、その型の既存 `suggestPlaces` 実装の隣へ:
    ```swift
    func liveRoutes(_ payload: LiveRoutesRequestPayload) async -> LiveRoutesResult? { nil }
    ```

- [ ] **Step 8: FakeGateway に live-routes ケース + 401 テスト** — `WorkerClientTests.swift`:
  - `FakeGateway` に `var liveRoutesUnauthorizedOnce = false` と `private var sawLiveRoutes401 = false` を追加。
  - `configure(...)` に `liveRoutesUnauthorizedOnce: Bool = false` を足し `self.liveRoutesUnauthorizedOnce = liveRoutesUnauthorizedOnce` を代入。
  - `respond(to:)` の `switch` に `case "/api/place-suggestions"` の隣へ:
    ```swift
    case "/api/live-routes":
      if liveRoutesUnauthorizedOnce, !sawLiveRoutes401 {
        sawLiveRoutes401 = true
        return json(#"{"code":"session_expired"}"#, 401)
      }
      return json(#"{"provider":"google_maps","fetchedAt":"t","travelMode":"WALK","legs":[{"id":"L1","durationMinutes":12,"distanceMeters":900,"encodedPolyline":null,"transferCount":null,"transitSteps":null,"walkToStopMinutes":null,"walkFromStopMinutes":null,"status":"ok"}]}"#, 200)
    ```
  - テスト（`testSuggestPlacesRetriesOnceOn401` の隣）:
    ```swift
    func testLiveRoutesRetriesOnceOn401() async {
      let gateway = FakeGateway()
      await gateway.configure(liveRoutesUnauthorizedOnce: true)
      let (client, _) = makeClient(gateway: gateway)
      let payload = LiveRoutesRequestPayload(
        legs: [LiveRouteLegPayload(id: "L1", origin: GeoPoint(latitude: 1, longitude: 1),
                                   destination: GeoPoint(latitude: 2, longitude: 2), departureTime: "2026-08-25T00:00:00Z")],
        languageCode: "en", travelMode: "WALK")
      let result = await client.liveRoutes(payload)
      XCTAssertNotNil(result, "a 401 must be retried once and then succeed")
      XCTAssertEqual(result?.legs.first?.durationMinutes, 12)
    }
    ```
    （`WorkerClientTests.swift` が `import TripCheckKit` していなければ `GeoPoint` のため追加する。)

- [ ] **Step 9: 全緑を確認** — `apple/tools/verify-kit.sh`（引数なし）。Expected: 既存 + 新規テスト全緑、新規警告ゼロ。

- [ ] **Step 10: コミット** — trailer 付き。

---

### Task 2: Google 優先の `WorkerRouteProvider`（プロバイダ + テスト）

**Files:**
- Create: `apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Providers/WorkerRouteProvider.swift`
- Create: `apple/Packages/TripCheckKit/Tests/TripCheckAppCoreTests/WorkerRouteProviderTests.swift`

**Interfaces:**
- Consumes: Task 1 の `LiveRoutesRequestPayload`/`LiveRouteLegPayload`/`LiveRoutesResult`/`GooglePolyline`/`WorkerAuthenticating.liveRoutes`。Kit `RouteProvider`/`RouteRequest`/`RouteOutcome`/`TransportMode`/`GeoPoint`/`PlannerLocale`、既存 `PolylineSimplifier.thinned`。
- Produces: `struct WorkerRouteProvider: RouteProvider`（`init(client:fallback:timeout:now:)`）。

- [ ] **Step 1: 失敗テストを書く** — Create `WorkerRouteProviderTests.swift`（`AppleRouteProviderTests` の swift-testing 作法）:
  ```swift
  import Foundation
  import Testing
  @testable import TripCheckAppCore
  import TripCheckKit

  private let a = GeoPoint(latitude: 46.948, longitude: 7.447)
  private let b = GeoPoint(latitude: 46.96, longitude: 7.46)
  private func req(_ mode: TransportMode, departure: Date? = nil) -> RouteRequest {
    RouteRequest(legKey: "x::y", from: a, to: b, mode: mode, departure: departure)
  }

  /// liveRoutes だけ意味を持ち、他は既定を返す fake worker。payload を記録する。
  private actor FakeRouteWorker: WorkerAuthenticating {
    let answer: LiveRoutesResult?
    let sleep: Duration?
    private(set) var lastPayload: LiveRoutesRequestPayload?
    init(answer: LiveRoutesResult?, sleep: Duration? = nil) { self.answer = answer; self.sleep = sleep }
    func describe() async -> WorkerClientDescription { WorkerClientDescription(baseURL: "fake", attestSupported: true, state: .idle) }
    func ensureSession() async -> WorkerAuthState { .idle }
    func ping() async -> WorkerPingResult { WorkerPingResult(ok: false, expiresAt: nil) }
    func resolvePlaces(_ payload: PlaceResolutionRequestPayload) async -> PlaceResolutionResult? { nil }
    func suggestPlaces(_ payload: PlaceSuggestionRequestPayload) async -> PlaceSuggestionResult? { nil }
    func liveRoutes(_ payload: LiveRoutesRequestPayload) async -> LiveRoutesResult? {
      lastPayload = payload
      if let sleep { try? await Task.sleep(for: sleep) }
      return answer
    }
  }

  /// 呼ばれたら決まった結果を返す fallback。Google と区別できる値にする。
  private struct StubFallback: RouteProvider {
    let outcome: RouteOutcome
    func route(_ request: RouteRequest, locale: PlannerLocale) async -> RouteOutcome { outcome }
  }

  private func okLeg(minutes: Int, meters: Int? = 900, polyline: String? = nil) -> LiveRoutesResult {
    LiveRoutesResult(legs: [LiveRouteLegResult(id: "L1", durationMinutes: minutes, distanceMeters: meters, encodedPolyline: polyline, status: "ok")])
  }

  @Test func googleOkWins() async {
    let worker = FakeRouteWorker(answer: okLeg(minutes: 20, meters: 1234))
    let provider = WorkerRouteProvider(client: worker, fallback: StubFallback(outcome: .measured(minutes: 99, distanceMeters: nil, geometry: nil, expectedDeparture: nil)))
    let outcome = await provider.route(req(.walk), locale: .en)
    #expect(outcome == .measured(minutes: 20, distanceMeters: 1234, geometry: nil, expectedDeparture: nil))
  }

  @Test func googleUnavailableFallsBackToApple() async {
    let worker = FakeRouteWorker(answer: LiveRoutesResult(legs: [LiveRouteLegResult(id: "L1", durationMinutes: nil, distanceMeters: nil, encodedPolyline: nil, status: "unavailable")]))
    let fallback = StubFallback(outcome: .measured(minutes: 42, distanceMeters: 500, geometry: nil, expectedDeparture: nil))
    let provider = WorkerRouteProvider(client: worker, fallback: fallback)
    #expect(await provider.route(req(.walk), locale: .en) == .measured(minutes: 42, distanceMeters: 500, geometry: nil, expectedDeparture: nil))
  }

  @Test func googleNilResultFallsBack() async {
    let worker = FakeRouteWorker(answer: nil)
    let provider = WorkerRouteProvider(client: worker, fallback: StubFallback(outcome: .unroutable))
    #expect(await provider.route(req(.transit, departure: Date(timeIntervalSince1970: 1_800_000_000)), locale: .en) == .unroutable)
  }

  @Test func googleTimeoutFallsBack() async {
    let worker = FakeRouteWorker(answer: okLeg(minutes: 5), sleep: .milliseconds(200))
    let provider = WorkerRouteProvider(client: worker, fallback: StubFallback(outcome: .measured(minutes: 7, distanceMeters: nil, geometry: nil, expectedDeparture: nil)), timeout: .milliseconds(20))
    #expect(await provider.route(req(.walk), locale: .en) == .measured(minutes: 7, distanceMeters: nil, geometry: nil, expectedDeparture: nil))
  }

  @Test func googleZeroMinutesFallsBack() async {
    let worker = FakeRouteWorker(answer: okLeg(minutes: 0))
    let provider = WorkerRouteProvider(client: worker, fallback: StubFallback(outcome: .failed))
    #expect(await provider.route(req(.walk), locale: .en) == .failed)
  }

  @Test func modeAndDepartureMapIntoPayload() async {
    let worker = FakeRouteWorker(answer: okLeg(minutes: 10))
    let fixed = Date(timeIntervalSince1970: 1_700_000_000)
    let provider = WorkerRouteProvider(client: worker, fallback: StubFallback(outcome: .failed), now: { fixed })
    _ = await provider.route(req(.taxi), locale: .ja)   // taxi → DRIVE、departure nil → now()
    let payload = await worker.lastPayload
    #expect(payload?.travelMode == "DRIVE")
    #expect(payload?.languageCode == "ja")
    #expect(payload?.legs.first?.departureTime.isEmpty == false)
  }

  @Test func transitPolylineDecodesIntoGeometry() async {
    let encoded = "_p~iF~ps|U_ulLnnqC_mqNvxq`@"
    let worker = FakeRouteWorker(answer: okLeg(minutes: 30, meters: 12000, polyline: encoded))
    let provider = WorkerRouteProvider(client: worker, fallback: StubFallback(outcome: .failed))
    let outcome = await provider.route(req(.transit, departure: Date(timeIntervalSince1970: 1_800_000_000)), locale: .en)
    #expect(outcome == .measured(minutes: 30, distanceMeters: 12000,
      geometry: PolylineSimplifier.thinned(GooglePolyline.decode(encoded)),
      expectedDeparture: Date(timeIntervalSince1970: 1_800_000_000)))
  }
  ```

- [ ] **Step 2: 失敗を確認** — `apple/tools/verify-kit.sh`（引数なし）。Expected: `WorkerRouteProvider` 未定義でコンパイル失敗。

- [ ] **Step 3: プロバイダを実装** — Create `WorkerRouteProvider.swift`:
  ```swift
  import Foundation
  import TripCheckKit

  /// 経路の Google 優先リゾルバ。`RouteFetcher` は 1 レグ×モードごとに `route()` を呼ぶので、
  /// 1 レグ payload を `/api/live-routes` へ送る。Google が綺麗に答えれば Google、答えられなければ
  /// 端末内 Apple（`fallback`）。両者を並行に走らせるので、フォールバックは待ち時間を増やさない
  /// （Google が勝てば未 await の Apple は scope 退出で cancel される）。
  public struct WorkerRouteProvider: RouteProvider {
    private let client: any WorkerAuthenticating
    private let fallback: any RouteProvider
    private let timeout: Duration
    private let now: @Sendable () -> Date

    public init(
      client: any WorkerAuthenticating,
      fallback: any RouteProvider,
      timeout: Duration = .seconds(10),
      now: @escaping @Sendable () -> Date = Date.init
    ) {
      self.client = client
      self.fallback = fallback
      self.timeout = timeout
      self.now = now
    }

    public func route(_ request: RouteRequest, locale: PlannerLocale) async -> RouteOutcome {
      async let google = askGoogle(request, locale)
      async let apple = fallback.route(request, locale: locale)
      if let g = await google { return g }
      return await apple
    }

    /// Google の綺麗な `.measured` のみ non-nil。未認証/タイムアウト/非成功/minutes<1 は nil。
    private func askGoogle(_ request: RouteRequest, _ locale: PlannerLocale) async -> RouteOutcome? {
      let payload = LiveRoutesRequestPayload(
        legs: [LiveRouteLegPayload(
          id: request.legKey,
          origin: request.from,
          destination: request.to,
          departureTime: Self.iso8601(request.departure ?? now())
        )],
        languageCode: locale.rawValue,
        travelMode: Self.travelMode(request.mode)
      )
      guard let result = await withinTimeout(payload),
            let leg = result.legs.first,
            leg.status == "ok",
            let minutes = leg.durationMinutes, minutes >= 1
      else { return nil }
      return .measured(
        minutes: minutes,
        distanceMeters: leg.distanceMeters,
        geometry: leg.encodedPolyline.map { PolylineSimplifier.thinned(GooglePolyline.decode($0)) },
        expectedDeparture: request.departure
      )
    }

    private func withinTimeout(_ payload: LiveRoutesRequestPayload) async -> LiveRoutesResult? {
      let client = self.client
      let limit = timeout
      return await withTaskGroup(of: LiveRoutesResult?.self) { group in
        group.addTask { await client.liveRoutes(payload) }
        group.addTask {
          try? await Task.sleep(for: limit)
          return nil
        }
        let first = await group.next() ?? nil
        group.cancelAll()
        return first
      }
    }

    private static func travelMode(_ mode: TransportMode) -> String {
      switch mode {
      case .walk: return "WALK"
      case .taxi: return "DRIVE"
      case .transit: return "TRANSIT"
      }
    }

    private static func iso8601(_ date: Date) -> String {
      ISO8601DateFormatter().string(from: date)
    }
  }
  ```

- [ ] **Step 4: 全緑を確認** — `apple/tools/verify-kit.sh`（引数なし）。Expected: 新規 7 テスト含め全緑、新規警告ゼロ。特に `googleOkWins`（Google 採用）・`*FallsBack*`（Apple 採用）・`transitPolylineDecodesIntoGeometry`（geometry 反映）を確認。

- [ ] **Step 5: コミット** — trailer 付き。

---

### Task 3: 合成の根で差し替え + 検証 + 手順書

**Files:**
- Modify: `apple/TripCheck/App/TripCheckApp.swift`（77 行目の `routeProvider:` 引数）
- Modify: `apple/docs/paid-route-check.md`（live-routes の手動 E2E 節）

**Interfaces:**
- Consumes: Task 2 の `WorkerRouteProvider(client:fallback:)`、既存 `workerClient`/`AppleRouteProvider()`/`CannedRouteProvider()`。

- [ ] **Step 1: 合成の根を差し替え** — `TripCheckApp.swift` の
  ```swift
  routeProvider: isUITesting ? CannedRouteProvider() as any RouteProvider : AppleRouteProvider(),
  ```
  を
  ```swift
  routeProvider: isUITesting
    ? CannedRouteProvider() as any RouteProvider
    : WorkerRouteProvider(client: workerClient, fallback: AppleRouteProvider()),
  ```
  に変更。（`workerClient` は同 init 内のローカルで、既に `WorkerPlaceResolver`/`WorkerSuggestions` が使う同一インスタンス。UI テストは `CannedRouteProvider` のまま=Worker 非経由。）

- [ ] **Step 2: kit 緑を確認** — `apple/tools/verify-kit.sh`（引数なし）。Expected: 変わらず全緑。

- [ ] **Step 3: app 緑を確認（非回帰）** — `apple/tools/verify-app.sh test`。Expected: `** TEST SUCCEEDED **`、app unit/UI 既存本数が全緑、新規警告ゼロ。UI テストは `CannedRouteProvider` を使うので Worker 経路は踏まず**非回帰**。新プロバイダが実利用ブランチでコンパイル・配線されることを app ビルドが担保。

- [ ] **Step 4: 手動 E2E 手順を追記** — `apple/docs/paid-route-check.md` に「Google 実経路」の節を足す：`.dev.vars` に実 `GOOGLE_PLACES_API_KEY`（Routes 有効）+ bypass、`pnpm dev`、Simulator（`TRIPCHECK_WORKER_BYPASS_TOKEN`）で旅程を組み、地図の**交通機関レグに線が引かれる**こと（Apple のみだと transit は線無し）と分数が Google 値になることを確認。Worker を止める/鍵を外すと Apple(MKDirections)へ戻る。

- [ ] **Step 5: コミット** — trailer 付き。
