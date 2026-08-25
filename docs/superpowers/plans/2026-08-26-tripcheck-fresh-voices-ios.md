# TripCheck iOS — Fresh Voices (`/fresh`) on the Stop place card — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the shipped iOS place-intelligence card (④) with an opt-in "最新の声" (recent voices) nested disclosure that fetches recent web findings for a Google-verified stop via the already-paid `POST /api/place-intelligence/fresh` and displays them text-only.

**Architecture:** A near-exact mirror of ④ (place-intelligence) and ⑥ (route-detour), re-keyed to "fresh voices". Four parts in `TripCheckAppCore`: worker models (`FreshVoicesModels.swift`), a `WorkerAuthenticating.freshVoices(_:)` method + one-shot 401 retry in `WorkerClient`, a provider/availability layer (`FreshVoicesProvider.swift`), and a generation-guarded `PlannerStore` pipeline (`PlannerStore+FreshVoices.swift`). The app target adds a nested `DisclosureCard` inside `PlaceIntelligenceDisclosure`'s `.loaded` branch (expand-to-fetch, second explicit tap), eight `AppCopy` strings, and one composition-root line. Display-only, reversible; `lib/**`, `worker/**`, and the frozen `TripCheckKit` engine are untouched.

**Tech Stack:** Swift 6 (strict concurrency), SwiftUI, `@Observable` `PlannerStore`, `swift test` (XCTest + swift-testing), XcodeGen + `xcodebuild`. Worker calls go through `URLSession` via the App Attest → session-token gate.

**Spec:** `docs/superpowers/specs/2026-08-26-tripcheck-fresh-voices-ios-design.md` (seam facts: `.superpowers/sdd/2026-08-26-tripcheck-fresh-voices-ios/investigation.md`).

## Global Constraints

- **web 不可侵**: `lib/**`, `app/api/**`, `worker/**` unchanged. `/api/place-intelligence/fresh` already exists and is paid/app-session-authorized/quota-metered server-side.
- **Kit engine 不可侵**: `apple/Packages/TripCheckKit/Sources/TripCheckKit/` (frozen engine) unchanged. New types live in `TripCheckAppCore` or the app target. `AppCopy.swift` (in `TripCheckAppCore`) is the only home for Japanese/English UI literals.
- **Swift 6 strict concurrency**: zero new warnings; cross-boundary types `Sendable`.
- **No emoji**; ratings/counts numeric. Text-only cards (no images).
- **Never `git push`** (user runs `! git push`).
- **Commit trailer (exact):**
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_012DRrRBiU96fLJmvfThaR4J
  ```
- **Verify**: `apple/tools/verify-kit.sh` (no args) all green; `apple/tools/verify-app.sh test` all green; zero new warnings.

---

## Task 1: Fresh-voices worker models + `WorkerClient` plumbing

**Files:**
- Create: `apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Worker/FreshVoicesModels.swift`
- Modify: `apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Worker/WorkerAuthState.swift` (add `freshVoices(_:)` to `WorkerAuthenticating`, after `routeRecommendations`, ~line 73)
- Modify: `apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Worker/WorkerClient.swift` (implement `freshVoices(_:)` + `FreshOnce` enum + `freshVoicesOnce(token:body:)`, inserted after `routeRecommendationsOnce`, ~line 358)
- Modify: `apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Worker/CannedWorkerClient.swift` (nil stub, after `routeRecommendations`, ~line 35)
- Modify (test stubs): `apple/Packages/TripCheckKit/Tests/TripCheckAppCoreTests/WorkerRouteProviderTests.swift` (`FakeRouteWorker`, ~line 31), `apple/Packages/TripCheckKit/Tests/TripCheckAppCoreTests/WorkerPlaceResolverTests.swift` (`StubWorker` ~line 16, `SlowStubWorker` ~line 32)
- Test (create): `apple/Packages/TripCheckKit/Tests/TripCheckAppCoreTests/FreshVoicesModelsTests.swift`
- Test (modify): `apple/Packages/TripCheckKit/Tests/TripCheckAppCoreTests/WorkerClientTests.swift` (extend `FakeGateway`, add 3 tests)

**Interfaces:**
- Produces:
  - `public struct FreshVoicesRequestPayload: Encodable, Sendable` — `init(name: String, area: String, languageCode: String, destination: String, intent: String, depth: String)`
  - `public struct FreshFinding: Decodable, Sendable, Equatable` — `init(title: String, url: String, note: String, age: String?, isRecent: Bool?, sourceKind: String)`
  - `public struct FreshVoicesResult: Decodable, Sendable, Equatable` — `init(provider: String, checkedAt: String, intent: String, depth: String, summary: String, findings: [FreshFinding])`
  - `WorkerAuthenticating.freshVoices(_ payload: FreshVoicesRequestPayload) async -> FreshVoicesResult?` (implemented by `WorkerClient`; nil in the 4 canned/test conformers)
- Consumes: `WorkerRequest(path:method:body:sessionToken:)`, `transport.send(_:baseURL:)`, `ensureSession()`, `authenticate(allowKeyReset:)`, `sessionToken`, `state` (all existing `WorkerClient` internals).

**Web contract mirrored** (`lib/fresh-voices.ts:11-53`): request `{name, area, languageCode, destination?, intent?, depth?}`; response `{provider:"anthropic_web_search", checkedAt, intent, depth, summary, findings:[{title,url,note,age:String?,isRecent:Bool?,sourceKind, evidenceLevel?, urlSignature?}], searchCount}`. Dropped on decode (omitted from the structs, matching how `PlaceIntelligenceModels`/`RouteDetourModels` drop rich fields): `searchCount` (result), `evidenceLevel`/`urlSignature` (finding).

---

- [ ] **Step 1.1: Write the failing models test**

Create `apple/Packages/TripCheckKit/Tests/TripCheckAppCoreTests/FreshVoicesModelsTests.swift`:

```swift
import XCTest
@testable import TripCheckAppCore

final class FreshVoicesModelsTests: XCTestCase {
  func testDecodesResultIgnoringDroppedFields() throws {
    let json = #"""
    {"provider":"anthropic_web_search","checkedAt":"2026-08-26T00:00:00Z","intent":"place","depth":"quick",
     "summary":"Buzzing after a recent festival.","searchCount":3,
     "findings":[
       {"title":"Night market reopens","url":"https://news.example/x","note":"Crowds returned this week.",
        "age":"3 days ago","isRecent":true,"sourceKind":"news","evidenceLevel":"cited_claim","urlSignature":"sig123"}
     ]}
    """#
    let r = try JSONDecoder().decode(FreshVoicesResult.self, from: Data(json.utf8))
    XCTAssertEqual(r.provider, "anthropic_web_search")
    XCTAssertEqual(r.intent, "place")
    XCTAssertEqual(r.depth, "quick")
    XCTAssertEqual(r.summary, "Buzzing after a recent festival.")
    XCTAssertEqual(r.findings.count, 1)
    let f = try XCTUnwrap(r.findings.first)
    XCTAssertEqual(f.title, "Night market reopens")
    XCTAssertEqual(f.url, "https://news.example/x")
    XCTAssertEqual(f.note, "Crowds returned this week.")
    XCTAssertEqual(f.age, "3 days ago")
    XCTAssertEqual(f.isRecent, true)
    XCTAssertEqual(f.sourceKind, "news")
  }

  func testDecodesNullAgeAndRecencyAndMissingOptionals() throws {
    let json = #"""
    {"provider":"anthropic_web_search","checkedAt":"t","intent":"place","depth":"quick","summary":"",
     "findings":[
       {"title":"A blog post","url":"https://blog.example/y","note":"","age":null,"isRecent":null,"sourceKind":"blog"}
     ]}
    """#
    let r = try JSONDecoder().decode(FreshVoicesResult.self, from: Data(json.utf8))
    XCTAssertTrue(r.summary.isEmpty)
    let f = try XCTUnwrap(r.findings.first)
    XCTAssertNil(f.age)
    XCTAssertNil(f.isRecent)
    XCTAssertEqual(f.sourceKind, "blog")
  }

  func testDecodesEmptyFindings() throws {
    let json = #"{"provider":"anthropic_web_search","checkedAt":"t","intent":"place","depth":"quick","summary":"","findings":[]}"#
    let r = try JSONDecoder().decode(FreshVoicesResult.self, from: Data(json.utf8))
    XCTAssertTrue(r.findings.isEmpty)
  }

  func testEncodesPayload() throws {
    let payload = FreshVoicesRequestPayload(name: "Kaffee", area: "1 Bahnhofstrasse, Bern", languageCode: "ja",
      destination: "auto", intent: "place", depth: "quick")
    let obj = try JSONSerialization.jsonObject(with: JSONEncoder().encode(payload)) as? [String: Any]
    XCTAssertEqual(obj?["name"] as? String, "Kaffee")
    XCTAssertEqual(obj?["area"] as? String, "1 Bahnhofstrasse, Bern")
    XCTAssertEqual(obj?["languageCode"] as? String, "ja")
    XCTAssertEqual(obj?["destination"] as? String, "auto")
    XCTAssertEqual(obj?["intent"] as? String, "place")
    XCTAssertEqual(obj?["depth"] as? String, "quick")
  }
}
```

- [ ] **Step 1.2: Run the models test — verify it fails**

Run: `cd apple/Packages/TripCheckKit && swift test --filter FreshVoicesModelsTests`
Expected: FAIL — compile error `cannot find 'FreshVoicesResult' in scope` (and `FreshVoicesRequestPayload`).

- [ ] **Step 1.3: Create the models file**

Create `apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Worker/FreshVoicesModels.swift`:

```swift
import Foundation

/// web `POST /api/place-intelligence/fresh` へ送る。基底の場所詳細が `.loaded` になった後の
/// 2 度目の展開でだけ投げる —— name/area は解決済みの `place.name`/`place.address` から組む。
/// depth は "quick"(1 unit)で固定、intent は "place"(StopInspector の場所カード限定)。
public struct FreshVoicesRequestPayload: Encodable, Sendable {
  public let name: String
  public let area: String
  public let languageCode: String   // "ja" | "en"
  public let destination: String    // DestinationChoice.rawValue
  public let intent: String         // "place" | "food" | "hotel" —— このスライスは "place" 固定
  public let depth: String          // "quick" | "deep" —— このスライスは "quick" 固定(1 unit)
  public init(name: String, area: String, languageCode: String, destination: String, intent: String, depth: String) {
    self.name = name; self.area = area; self.languageCode = languageCode
    self.destination = destination; self.intent = intent; self.depth = depth
  }
}

/// web `FreshFinding`(`lib/fresh-voices.ts:29-43`)のテキスト部分。`evidenceLevel`/`urlSignature`
/// はデコードで無視(前者はバッジ非対象、後者は画像プロキシ用の署名で iOS の `URLSession` からは
/// 構造的に届かない —— 基底カードが写真を落としたのと同じ理由)。
public struct FreshFinding: Decodable, Sendable, Equatable {
  public let title: String
  public let url: String
  public let note: String
  public let age: String?         // 例 "3 days ago"、web の page_age 素通し
  public let isRecent: Bool?
  public let sourceKind: String   // "social" | "news" | "blog" | "web"
  public init(title: String, url: String, note: String, age: String?, isRecent: Bool?, sourceKind: String) {
    self.title = title; self.url = url; self.note = note
    self.age = age; self.isRecent = isRecent; self.sourceKind = sourceKind
  }
}

/// web `FreshVoicesResult`(`lib/fresh-voices.ts:45-53`)の写し。`searchCount` はデコードで無視
/// (表示しない —— out of scope)。表示に使うのは `summary` と `findings` だけ。
public struct FreshVoicesResult: Decodable, Sendable, Equatable {
  public let provider: String       // "anthropic_web_search"
  public let checkedAt: String      // ISO 8601、サーバが刻む
  public let intent: String         // "place" | "food" | "hotel"
  public let depth: String          // "quick" | "deep"
  public let summary: String        // 候補ゼロなら ""
  public let findings: [FreshFinding]
  public init(provider: String, checkedAt: String, intent: String, depth: String, summary: String, findings: [FreshFinding]) {
    self.provider = provider; self.checkedAt = checkedAt; self.intent = intent
    self.depth = depth; self.summary = summary; self.findings = findings
  }
}
```

- [ ] **Step 1.4: Run the models test — verify it passes**

Run: `cd apple/Packages/TripCheckKit && swift test --filter FreshVoicesModelsTests`
Expected: PASS (4 tests).

- [ ] **Step 1.5: Commit**

```bash
git add apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Worker/FreshVoicesModels.swift \
        apple/Packages/TripCheckKit/Tests/TripCheckAppCoreTests/FreshVoicesModelsTests.swift
git commit -m "Add fresh-voices worker models mirroring the /fresh contract" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012DRrRBiU96fLJmvfThaR4J"
```

- [ ] **Step 1.6: Write the failing `WorkerClient` tests**

In `apple/Packages/TripCheckKit/Tests/TripCheckAppCoreTests/WorkerClientTests.swift`, extend `FakeGateway`:

Add two stored properties beside the other `*UnauthorizedOnce` flags (after `var routeUnauthorizedOnce = false`, ~line 17):

```swift
  var freshUnauthorizedOnce = false
  var freshServerError = false
```

Add the seen-flag beside `private var sawRoute401 = false` (~line 27):

```swift
  private var sawFresh401 = false
```

Change the `configure(...)` signature to add the two params (append before the closing paren, ~line 29) and their assignments (append at the end of the body, ~line 38):

```swift
  func configure(unknownKeyOnce: Bool = false, pingUnauthorizedOnce: Bool = false, resolveUnauthorizedOnce: Bool = false, suggestUnauthorizedOnce: Bool = false, liveRoutesUnauthorizedOnce: Bool = false, foodUnauthorizedOnce: Bool = false, intelUnauthorizedOnce: Bool = false, hotelUnauthorizedOnce: Bool = false, routeUnauthorizedOnce: Bool = false, freshUnauthorizedOnce: Bool = false, freshServerError: Bool = false) {
    self.unknownKeyOnce = unknownKeyOnce
    self.pingUnauthorizedOnce = pingUnauthorizedOnce
    self.resolveUnauthorizedOnce = resolveUnauthorizedOnce
    self.suggestUnauthorizedOnce = suggestUnauthorizedOnce
    self.liveRoutesUnauthorizedOnce = liveRoutesUnauthorizedOnce
    self.foodUnauthorizedOnce = foodUnauthorizedOnce
    self.intelUnauthorizedOnce = intelUnauthorizedOnce
    self.hotelUnauthorizedOnce = hotelUnauthorizedOnce
    self.routeUnauthorizedOnce = routeUnauthorizedOnce
    self.freshUnauthorizedOnce = freshUnauthorizedOnce
    self.freshServerError = freshServerError
  }
```

Add a `case` inside `respond(to:)`'s `switch`, immediately before `default:` (~line 104):

```swift
    case "/api/place-intelligence/fresh":
      if freshServerError {
        return json(#"{"code":"not_configured"}"#, 503)
      }
      if freshUnauthorizedOnce, !sawFresh401 {
        sawFresh401 = true
        return json(#"{"code":"session_expired"}"#, 401)
      }
      return json(#"{"provider":"anthropic_web_search","checkedAt":"t","intent":"place","depth":"quick","summary":"Buzzing.","searchCount":2,"findings":[{"title":"Night market reopens","url":"https://news.example/x","note":"Crowds returned.","age":"3 days ago","isRecent":true,"sourceKind":"news","evidenceLevel":"cited_claim","urlSignature":"sig"}]}"#, 200)
```

Add three tests to `final class WorkerClientTests`, after `testRouteRecommendationsRetriesOnceOn401` (~line 266, before the closing brace):

```swift
  func testFreshVoicesDecodesOn200() async {
    let (client, _) = makeClient()
    let payload = FreshVoicesRequestPayload(name: "Kaffee", area: "Bern", languageCode: "en", destination: "auto", intent: "place", depth: "quick")
    let result = await client.freshVoices(payload)
    XCTAssertEqual(result?.summary, "Buzzing.")
    XCTAssertEqual(result?.findings.first?.title, "Night market reopens")
    XCTAssertEqual(result?.findings.first?.sourceKind, "news")
  }

  func testFreshVoicesRetriesOnceOn401() async {
    let gateway = FakeGateway()
    await gateway.configure(freshUnauthorizedOnce: true)
    let (client, _) = makeClient(gateway: gateway)
    let payload = FreshVoicesRequestPayload(name: "Kaffee", area: "Bern", languageCode: "en", destination: "auto", intent: "place", depth: "quick")
    let result = await client.freshVoices(payload)
    XCTAssertNotNil(result, "a 401 must be retried once and then succeed")
    XCTAssertEqual(result?.findings.first?.title, "Night market reopens")
  }

  func testFreshVoicesReturnsNilOnServerError() async {
    let gateway = FakeGateway()
    await gateway.configure(freshServerError: true)
    let (client, _) = makeClient(gateway: gateway)
    let payload = FreshVoicesRequestPayload(name: "Kaffee", area: "Bern", languageCode: "en", destination: "auto", intent: "place", depth: "quick")
    let result = await client.freshVoices(payload)
    XCTAssertNil(result, "a 503 not_configured must fail closed to nil")
  }
```

- [ ] **Step 1.7: Run the client tests — verify they fail**

Run: `cd apple/Packages/TripCheckKit && swift test --filter WorkerClientTests`
Expected: FAIL — compile error `value of type 'WorkerClient' has no member 'freshVoices'`.

- [ ] **Step 1.8: Add `freshVoices` to the protocol, implement it, and stub the 4 canned/test conformers**

(a) In `apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Worker/WorkerAuthState.swift`, add the method to `WorkerAuthenticating` after `routeRecommendations` (~line 73, before the closing `}`):

```swift
  /// 検証済み場所の「最新の声」(web/SNS/ニュースの最近の話題)。失敗・未認証・到達不能はすべて nil。
  func freshVoices(_ payload: FreshVoicesRequestPayload) async -> FreshVoicesResult?
```

(b) In `apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Worker/WorkerClient.swift`, insert after `routeRecommendationsOnce(token:body:)`'s closing brace (~line 358) and before `private func authenticate`:

```swift
  public func freshVoices(_ payload: FreshVoicesRequestPayload) async -> FreshVoicesResult? {
    let auth = await ensureSession()
    guard case .authenticated = auth, let token = sessionToken else { return nil }
    guard let body = try? JSONEncoder().encode(payload) else { return nil }
    switch await freshVoicesOnce(token: token, body: body) {
    case .resolved(let result): return result
    case .failed: return nil
    case .unauthorized:
      sessionToken = nil
      state = .idle
      let reauth = await authenticate(allowKeyReset: true)
      guard case .authenticated = reauth, let fresh = sessionToken else { return nil }
      if case .resolved(let result) = await freshVoicesOnce(token: fresh, body: body) { return result }
      return nil
    }
  }

  private enum FreshOnce {
    case resolved(FreshVoicesResult)
    case unauthorized
    case failed
  }

  private func freshVoicesOnce(token: String, body: Data) async -> FreshOnce {
    do {
      let response = try await transport.send(
        WorkerRequest(path: "/api/place-intelligence/fresh", method: "POST", body: body, sessionToken: token),
        baseURL: baseURL
      )
      if response.status == 200 {
        guard let decoded = try? JSONDecoder().decode(FreshVoicesResult.self, from: response.body) else { return .failed }
        return .resolved(decoded)
      }
      if response.status == 401 { return .unauthorized }
      return .failed
    } catch {
      return .failed
    }
  }
```

(c) In `apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Worker/CannedWorkerClient.swift`, add after `routeRecommendations` (~line 35, before the closing `}`):

```swift

  public func freshVoices(_ payload: FreshVoicesRequestPayload) async -> FreshVoicesResult? { nil }
```

(d) In `apple/Packages/TripCheckKit/Tests/TripCheckAppCoreTests/WorkerRouteProviderTests.swift`, add to `FakeRouteWorker` after its `routeRecommendations` line (~line 31):

```swift
  func freshVoices(_ payload: FreshVoicesRequestPayload) async -> FreshVoicesResult? { nil }
```

(e) In `apple/Packages/TripCheckKit/Tests/TripCheckAppCoreTests/WorkerPlaceResolverTests.swift`, add the same line to `StubWorker` (after its `routeRecommendations`, ~line 16) and to `SlowStubWorker` (after its `routeRecommendations`, ~line 32):

```swift
  func freshVoices(_ payload: FreshVoicesRequestPayload) async -> FreshVoicesResult? { nil }
```

- [ ] **Step 1.9: Run the client tests — verify they pass**

Run: `cd apple/Packages/TripCheckKit && swift test --filter WorkerClientTests`
Expected: PASS (all existing tests + the 3 new fresh-voices tests).

- [ ] **Step 1.10: Commit**

```bash
git add apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Worker/WorkerAuthState.swift \
        apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Worker/WorkerClient.swift \
        apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Worker/CannedWorkerClient.swift \
        apple/Packages/TripCheckKit/Tests/TripCheckAppCoreTests/WorkerRouteProviderTests.swift \
        apple/Packages/TripCheckKit/Tests/TripCheckAppCoreTests/WorkerPlaceResolverTests.swift \
        apple/Packages/TripCheckKit/Tests/TripCheckAppCoreTests/WorkerClientTests.swift
git commit -m "Wire freshVoices through WorkerAuthenticating with a one-shot 401 retry" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012DRrRBiU96fLJmvfThaR4J"
```

---

## Task 2: Fresh-voices provider + `PlannerStore` pipeline

**Files:**
- Create: `apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Providers/FreshVoicesProvider.swift`
- Create: `apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Store/PlannerStore+FreshVoices.swift`
- Modify: `apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Store/PlannerStore.swift` (backing members after the place-intelligence block ~line 199; init param as the LAST param after `routeDetourProvider` ~line 226; assignment after `self.routeDetourProvider` ~line 236)
- Modify (5 invalidate sites): `apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Store/PlannerStore+Routes.swift:170`, `apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Store/PlannerStore+Edits.swift:209` and `:289`, `apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Store/PlannerStore.swift:408` and `:498` — each already ends with `invalidatePlaceIntelligence()`; add `invalidateFreshVoices()` on the next line.
- Test (create): `apple/Packages/TripCheckKit/Tests/TripCheckAppCoreTests/PlannerStoreFreshVoicesTests.swift`

**Interfaces:**
- Consumes (from Task 1): `FreshVoicesRequestPayload`, `FreshVoicesResult`, `WorkerAuthenticating.freshVoices(_:)`.
- Consumes (existing `PlannerStore`): `request.locale.rawValue`, `request.destination.rawValue` (both `String`).
- Produces:
  - `public protocol FreshVoicesProviding: Sendable { func freshVoices(_ payload: FreshVoicesRequestPayload) async -> FreshVoicesResult? }`
  - `public struct WorkerFreshVoicesProvider: FreshVoicesProviding` — `init(client: any WorkerAuthenticating, timeout: Duration = .seconds(8))`
  - `public enum FreshVoicesAvailability { public static func makeDefaultProvider(uiTesting: Bool, client: any WorkerAuthenticating) -> (any FreshVoicesProviding)? }`
  - `public enum StopFreshVoices: Equatable, Sendable { case loading; case loaded(FreshVoicesResult); case unavailable }`
  - `PlannerStore.loadFreshVoices(stopId: String, name: String, area: String)` (public), `PlannerStore.beginFreshVoices(stopId:name:area:)` (internal), `PlannerStore.invalidateFreshVoices()` (internal)
  - `PlannerStore.freshVoicesByStop: [String: StopFreshVoices]` (`public internal(set)`), `freshVoicesTasks: [String: Task<Void, Never>]` (`@testable`-visible)
  - New init param (LAST): `freshVoicesProvider: (any FreshVoicesProviding)? = nil`

---

- [ ] **Step 2.1: Write the failing pipeline test**

Create `apple/Packages/TripCheckKit/Tests/TripCheckAppCoreTests/PlannerStoreFreshVoicesTests.swift`:

```swift
import Testing
@testable import TripCheckAppCore
import TripCheckKit

@MainActor private final class FakeFresh: FreshVoicesProviding {
  var calls = 0
  var lastPayload: FreshVoicesRequestPayload?
  var answer: FreshVoicesResult?
  var sleep: Duration?
  init(answer: FreshVoicesResult?, sleep: Duration? = nil) { self.answer = answer; self.sleep = sleep }
  func freshVoices(_ payload: FreshVoicesRequestPayload) async -> FreshVoicesResult? {
    calls += 1; lastPayload = payload
    if let sleep { try? await Task.sleep(for: sleep) }
    return answer
  }
}

private func result() -> FreshVoicesResult {
  FreshVoicesResult(provider: "anthropic_web_search", checkedAt: "t", intent: "place", depth: "quick",
    summary: "Buzzing.", findings: [FreshFinding(title: "T", url: "https://x.example", note: "n",
      age: "2 days ago", isRecent: true, sourceKind: "news")])
}

@MainActor private func store(_ provider: (any FreshVoicesProviding)?) -> PlannerStore {
  PlannerStore(resolvers: [], store: nil, freshVoicesProvider: provider)
}

@Test @MainActor func freshLoadsAndMapsPayload() async throws {
  let fake = FakeFresh(answer: result())
  let s = store(fake)
  s.beginFreshVoices(stopId: "s1", name: "Kaffee", area: "Bern")
  #expect(s.freshVoicesByStop["s1"] == .loading)
  await s.freshVoicesTasks["s1"]?.value
  guard case .loaded(let r) = s.freshVoicesByStop["s1"] else { return #expect(Bool(false)) }
  #expect(r.summary == "Buzzing.")
  #expect(r.findings.first?.sourceKind == "news")
  #expect(fake.lastPayload?.name == "Kaffee")
  #expect(fake.lastPayload?.area == "Bern")
  #expect(fake.lastPayload?.intent == "place")
  #expect(fake.lastPayload?.depth == "quick")
  #expect(fake.lastPayload?.languageCode == "ja")
  #expect(fake.lastPayload?.destination == s.request.destination.rawValue)
}

@Test @MainActor func freshNilResultBecomesUnavailable() async throws {
  let s = store(FakeFresh(answer: nil))
  s.beginFreshVoices(stopId: "s1", name: "K", area: "B")
  await s.freshVoicesTasks["s1"]?.value
  #expect(s.freshVoicesByStop["s1"] == .unavailable)
}

@Test @MainActor func freshIsIdempotentWhileLoadingOrLoaded() async throws {
  let fake = FakeFresh(answer: result())
  let s = store(fake)
  s.loadFreshVoices(stopId: "s1", name: "K", area: "B")   // sets .loading, launches the task
  s.loadFreshVoices(stopId: "s1", name: "K", area: "B")   // .loading → no-op (no second task)
  await s.freshVoicesTasks["s1"]?.value
  s.loadFreshVoices(stopId: "s1", name: "K", area: "B")   // .loaded → no-op
  #expect(fake.calls == 1)
}

@Test @MainActor func freshStaleResultDroppedByGenerationGuard() async throws {
  let fake = FakeFresh(answer: result(), sleep: .milliseconds(80))
  let s = store(fake)
  s.beginFreshVoices(stopId: "s1", name: "K", area: "B")
  let running = s.freshVoicesTasks["s1"]
  s.invalidateFreshVoices()
  #expect(s.freshVoicesByStop.isEmpty)
  await running?.value
  #expect(s.freshVoicesByStop["s1"] == nil)
}

@Test @MainActor func freshNilProviderIsImmediatelyUnavailable() async {
  let s = store(nil)
  s.beginFreshVoices(stopId: "s1", name: "K", area: "B")
  #expect(s.freshVoicesByStop["s1"] == .unavailable)
}
```

- [ ] **Step 2.2: Run the pipeline test — verify it fails**

Run: `cd apple/Packages/TripCheckKit && swift test --filter PlannerStoreFreshVoicesTests`
Expected: FAIL — compile error `cannot find type 'FreshVoicesProviding' in scope` (and no `freshVoicesProvider:` init param / no `beginFreshVoices`).

- [ ] **Step 2.3: Create the provider file**

Create `apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Providers/FreshVoicesProvider.swift`:

```swift
import Foundation
import TripCheckKit

public protocol FreshVoicesProviding: Sendable {
  func freshVoices(_ payload: FreshVoicesRequestPayload) async -> FreshVoicesResult?
}

/// `any WorkerAuthenticating` を包み、2 度目の展開の取得に上限時間を切って `freshVoices` を呼ぶ。
/// `WorkerPlaceIntelligenceProvider` の withTaskGroup レースを鏡に。
public struct WorkerFreshVoicesProvider: FreshVoicesProviding {
  private let client: any WorkerAuthenticating
  private let timeout: Duration
  public init(client: any WorkerAuthenticating, timeout: Duration = .seconds(8)) {
    self.client = client; self.timeout = timeout
  }
  public func freshVoices(_ payload: FreshVoicesRequestPayload) async -> FreshVoicesResult? {
    let client = self.client
    let limit = timeout
    return await withTaskGroup(of: FreshVoicesResult?.self) { group in
      group.addTask { await client.freshVoices(payload) }
      group.addTask { try? await Task.sleep(for: limit); return nil }
      let first = await group.next() ?? nil
      group.cancelAll()
      return first
    }
  }
}

/// 可用性は合成の根にだけ閉じ込める(place-intelligence/food/hotel と同じ)。
public enum FreshVoicesAvailability {
  public static func makeDefaultProvider(uiTesting: Bool, client: any WorkerAuthenticating) -> (any FreshVoicesProviding)? {
    uiTesting ? nil : WorkerFreshVoicesProvider(client: client)
  }
}
```

- [ ] **Step 2.4: Add the backing members, init param, and assignment to `PlannerStore.swift`**

(a) After the place-intelligence block (right after `public internal(set) var placeIntelligenceByStop: [String: StopPlaceIntelligence] = [:]`, ~line 199), insert:

```swift

  // MARK: - 最新の声(観測しない。freshVoicesByStop だけが観測される。spec 2026-08-26)
  @ObservationIgnored let freshVoicesProvider: (any FreshVoicesProviding)?
  @ObservationIgnored var freshVoicesGeneration = 0
  @ObservationIgnored var freshVoicesTasks: [String: Task<Void, Never>] = [:]
  /// 停留所 id → 最新の声の状態(表示専用)。
  public internal(set) var freshVoicesByStop: [String: StopFreshVoices] = [:]
```

(b) In the `public init(...)` signature, change the last provider param line (`routeDetourProvider: (any RouteDetourRecommending)? = nil`, ~line 226) so `freshVoicesProvider` follows it as the LAST param:

```swift
    routeDetourProvider: (any RouteDetourRecommending)? = nil,
    freshVoicesProvider: (any FreshVoicesProviding)? = nil
```

(c) In the init body, after `self.routeDetourProvider = routeDetourProvider` (~line 236), insert:

```swift
    self.freshVoicesProvider = freshVoicesProvider
```

- [ ] **Step 2.5: Create the pipeline extension**

Create `apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Store/PlannerStore+FreshVoices.swift`:

```swift
import Foundation
import TripCheckKit

public enum StopFreshVoices: Equatable, Sendable {
  case loading
  case loaded(FreshVoicesResult)
  case unavailable
}

extension PlannerStore {
  /// 基底の場所詳細が `.loaded` になった後、「最新の声を見る」を押したときの入口。
  /// name/area は呼び出し側(開示カードの `.loaded` 枝)が解決済み結果から組んで渡す
  /// —— テストは文字列だけで足りる。`.loading`/`.loaded` なら無視して戻る(二重取得しない)。
  public func loadFreshVoices(stopId: String, name: String, area: String) {
    switch freshVoicesByStop[stopId] {
    case .loading, .loaded: return
    case .unavailable, .none: beginFreshVoices(stopId: stopId, name: name, area: area)
    }
  }

  /// 実取得。intent は "place"、depth は "quick"(1 unit)で固定。destination/locale は今の旅のもの。
  func beginFreshVoices(stopId: String, name: String, area: String) {
    freshVoicesTasks[stopId]?.cancel()
    guard let provider = freshVoicesProvider else {
      freshVoicesByStop[stopId] = .unavailable
      return
    }
    freshVoicesByStop[stopId] = .loading
    let payload = FreshVoicesRequestPayload(
      name: name, area: area, languageCode: request.locale.rawValue,
      destination: request.destination.rawValue, intent: "place", depth: "quick")
    let generation = freshVoicesGeneration
    freshVoicesTasks[stopId] = Task { [weak self] in
      let result = await provider.freshVoices(payload)
      guard let self, self.freshVoicesGeneration == generation, !Task.isCancelled else { return }
      self.freshVoicesByStop[stopId] = result.map { .loaded($0) } ?? .unavailable
      self.freshVoicesTasks[stopId] = nil
    }
  }

  func invalidateFreshVoices() {
    freshVoicesGeneration &+= 1
    for task in freshVoicesTasks.values { task.cancel() }
    freshVoicesTasks = [:]
    freshVoicesByStop = [:]
  }
}
```

- [ ] **Step 2.6: Run the pipeline test — verify it passes**

Run: `cd apple/Packages/TripCheckKit && swift test --filter PlannerStoreFreshVoicesTests`
Expected: PASS (6 tests).

- [ ] **Step 2.7: Commit**

```bash
git add apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Providers/FreshVoicesProvider.swift \
        apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Store/PlannerStore+FreshVoices.swift \
        apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Store/PlannerStore.swift \
        apple/Packages/TripCheckKit/Tests/TripCheckAppCoreTests/PlannerStoreFreshVoicesTests.swift
git commit -m "Add the generation-guarded fresh-voices PlannerStore pipeline" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012DRrRBiU96fLJmvfThaR4J"
```

- [ ] **Step 2.8: Call `invalidateFreshVoices()` at the same 5 sites as `invalidatePlaceIntelligence()`**

At each of these five locations the line `invalidatePlaceIntelligence()` currently sits directly below `invalidateRouteDetour()`. Add `invalidateFreshVoices()` on the line immediately after `invalidatePlaceIntelligence()`, at the same indentation, so each becomes:

```swift
    invalidateRouteDetour()
    invalidatePlaceIntelligence()
    invalidateFreshVoices()
```

The five sites:
- `apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Store/PlannerStore+Routes.swift:170`
- `apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Store/PlannerStore+Edits.swift:209`
- `apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Store/PlannerStore+Edits.swift:289`
- `apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Store/PlannerStore.swift:408`
- `apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Store/PlannerStore.swift:498`

(Line numbers shift by +1 after the first edit in a file; `PlannerStore.swift` gets two edits and `PlannerStore+Edits.swift` gets two — apply the lower line first, or re-grep `invalidatePlaceIntelligence()` after each edit. There must be exactly 5 `invalidateFreshVoices()` call sites plus the definition.)

- [ ] **Step 2.9: Run the whole Kit suite — verify green**

Run: `apple/tools/verify-kit.sh`
Expected: `exit=0` — all TripCheckKit tests pass in parallel, zero new warnings. (This is the evidence that the 5 invalidate call sites compile and that no existing rebuild/reset test regressed.)

- [ ] **Step 2.10: Commit**

```bash
git add apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Store/PlannerStore+Routes.swift \
        apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Store/PlannerStore+Edits.swift \
        apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Store/PlannerStore.swift
git commit -m "Clear fresh voices at the five stop-lifecycle invalidation sites" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012DRrRBiU96fLJmvfThaR4J"
```

---

## Task 3: UI (nested disclosure) + AppCopy + composition root + verify + docs

**Files:**
- Modify: `apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Presentation/AppCopy.swift` (8 new strings in all 5 spots)
- Modify: `apple/TripCheck/App/TripCheckApp.swift` (add `freshVoicesProvider:` as the LAST arg of the `PlannerStore(...)` call, ~line 100)
- Modify: `apple/TripCheck/Screens/Detail/PlaceIntelligenceDisclosure.swift` (nested fresh disclosure in the `.loaded` branch + `freshContent`/`freshSourceLabel` helpers)
- Modify (docs): `apple/docs/paid-route-check.md` (append "最新の声 (fresh voices)" section)

**Interfaces:**
- Consumes (from Task 2): `store.loadFreshVoices(stopId:name:area:)`, `store.freshVoicesByStop[stopId]: StopFreshVoices?`, `FreshVoicesAvailability.makeDefaultProvider(uiTesting:client:)`, `FreshVoicesResult`/`FreshFinding` (fields `summary`, `findings`, `title`, `url`, `note`, `age`, `isRecent`, `sourceKind`).
- Consumes (existing UI): `DisclosureCard(title:content:)`, `AppCopy.for(_:)`, `Tokens.Color.*`, `.tcFont(_:)`, `PlannerStore.request.locale`, `store.placeIntelligenceByStop[stopId]` → `.loaded(PlaceIntelligenceResult)` with `result.place.name` / `result.place.address`.
- Produces (AppCopy properties, all `String`): `freshVoicesTitle`, `freshVoicesExpand`, `freshVoicesEmpty`, `freshSourceSocial`, `freshSourceNews`, `freshSourceBlog`, `freshSourceWeb`, `freshVoicesRecent`.

**Note on the optional UI test (skipped, per the ⑥ ruling):** under `-uiTesting` the `freshVoicesProvider` and the `placeIntelligenceProvider` are both `nil`. With `placeIntelligenceProvider == nil` the base card resolves to `.unavailable`, so the `.loaded` branch — the only place the fresh disclosure is mounted — never renders. The fresh sub-section is therefore **structurally unreachable** in UI tests, exactly as the ⑥ gap-detour card was. Do not add a `PlannerFlowTests` assertion; rely on the Task-1/Task-2 unit tests plus the `verify-app.sh test` build. (Existing UI tests must still pass — they are unaffected because the fresh disclosure never mounts.)

---

- [ ] **Step 3.1: Add the 8 AppCopy strings in all 5 spots**

In `apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Presentation/AppCopy.swift`, each edit goes immediately after the `placeIntelligenceClosed` entry of that spot, keeping the fresh-voices strings grouped after the place-intelligence group.

(a) Properties — after `public let placeIntelligenceClosed: String` (~line 403):

```swift
  /// 「最新の声」入れ子節の折り畳み時 CTA(押すと展開して取得 = opt-in の 2 度目のタップ)。
  public let freshVoicesExpand: String
  /// 展開後、中身の先頭に置く小さな節見出し。
  public let freshVoicesTitle: String
  /// 話題ゼロ/取得できなかったときの 1 行。
  public let freshVoicesEmpty: String
  /// 出典ラベル(SNS / ニュース / ブログ / ウェブ)。
  public let freshSourceSocial: String
  public let freshSourceNews: String
  public let freshSourceBlog: String
  public let freshSourceWeb: String
  /// 新しい話題であることを示す小さな札。
  public let freshVoicesRecent: String
```

(b) Init params — after `placeIntelligenceClosed: String,` (~line 646):

```swift
    freshVoicesExpand: String,
    freshVoicesTitle: String,
    freshVoicesEmpty: String,
    freshSourceSocial: String,
    freshSourceNews: String,
    freshSourceBlog: String,
    freshSourceWeb: String,
    freshVoicesRecent: String,
```

(c) Assignments — after `self.placeIntelligenceClosed = placeIntelligenceClosed` (~line 881):

```swift
    self.freshVoicesExpand = freshVoicesExpand
    self.freshVoicesTitle = freshVoicesTitle
    self.freshVoicesEmpty = freshVoicesEmpty
    self.freshSourceSocial = freshSourceSocial
    self.freshSourceNews = freshSourceNews
    self.freshSourceBlog = freshSourceBlog
    self.freshSourceWeb = freshSourceWeb
    self.freshVoicesRecent = freshVoicesRecent
```

(d) `static let ja` — after `placeIntelligenceClosed: "現在営業していません",` (~line 1296):

```swift
    freshVoicesExpand: "最新の声を見る",
    freshVoicesTitle: "最新の声",
    freshVoicesEmpty: "最近の話題は見つかりませんでした",
    freshSourceSocial: "SNS",
    freshSourceNews: "ニュース",
    freshSourceBlog: "ブログ",
    freshSourceWeb: "ウェブ",
    freshVoicesRecent: "最近",
```

(e) `static let en` — after `placeIntelligenceClosed: "Currently closed",` (~line 1554):

```swift
    freshVoicesExpand: "See recent voices",
    freshVoicesTitle: "Recent voices",
    freshVoicesEmpty: "No recent buzz found",
    freshSourceSocial: "Social",
    freshSourceNews: "News",
    freshSourceBlog: "Blog",
    freshSourceWeb: "Web",
    freshVoicesRecent: "Recent",
```

- [ ] **Step 3.2: Run the Kit suite — verify the AppCopy change is green**

Run: `apple/tools/verify-kit.sh`
Expected: `exit=0`. (The memberwise `AppCopy.init` requires all 5 spots to agree; a green build proves the property / init-param / assignment / `ja` / `en` sets are consistent.)

- [ ] **Step 3.3: Commit**

```bash
git add apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Presentation/AppCopy.swift
git commit -m "Add fresh-voices UI strings for both locales" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012DRrRBiU96fLJmvfThaR4J"
```

- [ ] **Step 3.4: Add `freshVoicesProvider` to the composition root**

In `apple/TripCheck/App/TripCheckApp.swift`, the `PlannerStore(...)` call currently ends (~line 100):

```swift
      routeDetourProvider: RouteDetourAvailability.makeDefaultProvider(uiTesting: isUITesting, client: workerClient)
    ))
```

Add a trailing comma to that line and insert the new last arg before `))`:

```swift
      routeDetourProvider: RouteDetourAvailability.makeDefaultProvider(uiTesting: isUITesting, client: workerClient),
      // 最新の声も同じ理由で composition root にだけ判定を閉じ込める(`FreshVoicesAvailability`)。
      // UI テストは nil のまま —— 入れ子の「最新の声」節を展開しても決定的に空表示になる
      // (`PlaceIntelligenceDisclosure` の非回帰)。
      freshVoicesProvider: FreshVoicesAvailability.makeDefaultProvider(uiTesting: isUITesting, client: workerClient)
    ))
```

- [ ] **Step 3.5: Add the nested fresh disclosure to `PlaceIntelligenceDisclosure.swift`**

Replace the entire contents of `apple/TripCheck/Screens/Detail/PlaceIntelligenceDisclosure.swift` with:

```swift
import SwiftUI
import TripCheckAppCore

/// 停留所シートの「この場所について」。Google 検証済み(`StopInspectorModel.isProviderVerified`)
/// の停留所だけに出る、既定で閉じた開示カード。写真は出さない。
///
/// **開いた初回だけ Worker に尋ねる**(inspector を開く度には取らない = 1 unit/展開)。
/// `DisclosureCard` は開いている間しか中身を描かない(`if open { content() }`)ので、その中身に
/// 付けた `.task` が「初めて開いたとき」の入口になる —— `expanded` の `@State` をもう一組
/// ここに持つ必要はない。閉じて開き直すたびに `.task` はもう一度走るが、`loadPlaceIntelligence`
/// は `.loading`/`.loaded` なら無視して戻るので、二重に取りに行くことはない。
///
/// 基底が `.loaded` になった後にだけ、入れ子の「最新の声」節(`/api/place-intelligence/fresh`)を
/// 出す —— これも展開でだけ取りに行く 2 度目のタップ(opt-in、depth "quick" = 1 unit)。
struct PlaceIntelligenceDisclosure: View {
  let stopId: String
  @Environment(PlannerStore.self) private var store

  var body: some View {
    let app = AppCopy.for(store.request.locale)
    DisclosureCard(title: app.placeIntelligenceTitle) {
      content(app)
        .task { store.loadPlaceIntelligence(stopId: stopId) }
        // 開いている最中に再ビルド(背景の経路差し替え等)で候補が消えたら、閉じ開きを
        // 待たずに取り直す(食事シートと同じ自己回復)。
        .onChange(of: store.placeIntelligenceByStop[stopId]) { _, now in
          if now == nil { store.loadPlaceIntelligence(stopId: stopId) }
        }
    }
    .accessibilityIdentifier("plan.placeIntelligence")
  }

  @ViewBuilder private func content(_ app: AppCopy) -> some View {
    switch store.placeIntelligenceByStop[stopId] {
    case .some(.loading), .none:
      ProgressView()
        .frame(maxWidth: .infinity, alignment: .leading)
    case .some(.unavailable):
      Text(app.placeIntelligenceUnavailable)
        .tcFont(.meta)
        .foregroundStyle(Tokens.Color.muted)
        .accessibilityIdentifier("plan.placeIntelligence.unavailable")
    case .some(.loaded(let result)):
      // 「最新の声」の題材は解決済みの基底結果から組む(web の checkPlace と同じ)。検証済み
      // 停留所は name/address が必ず埋まるので、空ガードは防御的な保険。
      let freshName = result.place.name.isEmpty ? result.place.address : result.place.name
      let freshArea = result.place.address.isEmpty ? result.place.name : String(result.place.address.prefix(100))
      VStack(alignment: .leading, spacing: 6) {
        HStack(spacing: 8) {
          if let rating = result.place.rating {
            Text(String(format: "%.1f", rating) + (result.place.userRatingCount.map { " (\($0))" } ?? ""))
              .tcFont(.meta)
              .foregroundStyle(Tokens.Color.ink2)
          }
          if result.place.openNow == true {
            Text(app.placeIntelligenceOpenNow)
              .tcFont(.meta)
              .foregroundStyle(Tokens.Color.recommendation)
          }
          if let status = result.place.businessStatus, status != "OPERATIONAL" {
            Text(app.placeIntelligenceClosed)
              .tcFont(.meta)
              .foregroundStyle(Tokens.Color.accent)
          }
        }
        if !result.analysis.summary.isEmpty {
          Text(result.analysis.summary)
            .tcFont(.body)
            .foregroundStyle(Tokens.Color.ink2)
            .fixedSize(horizontal: false, vertical: true)
        }
        ForEach(result.place.hours, id: \.self) { line in
          Text(line)
            .tcFont(.meta)
            .foregroundStyle(Tokens.Color.muted)
        }
        ForEach(result.reviews.prefix(2)) { review in
          if let text = review.text, !text.isEmpty {
            Text(text)
              .tcFont(.meta)
              .foregroundStyle(Tokens.Color.muted)
              .lineLimit(3)
          }
        }
        if let url = URL(string: result.place.googleMapsUrl) {
          Link(destination: url) {
            Text(result.place.address)
              .tcFont(.meta)
              .foregroundStyle(Tokens.Color.ink2)
          }
        }
        // 入れ子の「最新の声」。折り畳んだ札のラベルが「見る」CTA を兼ね、開いた初回だけ取りに行く。
        DisclosureCard(title: app.freshVoicesExpand) {
          freshContent(app)
            .task { store.loadFreshVoices(stopId: stopId, name: freshName, area: freshArea) }
            .onChange(of: store.freshVoicesByStop[stopId]) { _, now in
              if now == nil { store.loadFreshVoices(stopId: stopId, name: freshName, area: freshArea) }
            }
        }
        .accessibilityIdentifier("plan.placeIntelligence.fresh")
      }
      .accessibilityIdentifier("plan.placeIntelligence.loaded")
    }
  }

  /// 入れ子の「最新の声」節の中身。基底カードと同じ状態機械(読取中→スピナー、取得不可/空→
  /// 1 行、取得済み→節見出し + 要約 + 出典行)。写真・絵文字は出さない。
  @ViewBuilder private func freshContent(_ app: AppCopy) -> some View {
    switch store.freshVoicesByStop[stopId] {
    case .some(.loading), .none:
      ProgressView()
        .frame(maxWidth: .infinity, alignment: .leading)
    case .some(.unavailable):
      Text(app.freshVoicesEmpty)
        .tcFont(.meta)
        .foregroundStyle(Tokens.Color.muted)
        .accessibilityIdentifier("plan.placeIntelligence.fresh.unavailable")
    case .some(.loaded(let fresh)):
      if fresh.summary.isEmpty, fresh.findings.isEmpty {
        Text(app.freshVoicesEmpty)
          .tcFont(.meta)
          .foregroundStyle(Tokens.Color.muted)
          .accessibilityIdentifier("plan.placeIntelligence.fresh.unavailable")
      } else {
        VStack(alignment: .leading, spacing: 8) {
          Text(app.freshVoicesTitle)
            .tcFont(.meta)
            .foregroundStyle(Tokens.Color.muted)
          if !fresh.summary.isEmpty {
            Text(fresh.summary)
              .tcFont(.body)
              .foregroundStyle(Tokens.Color.ink2)
              .fixedSize(horizontal: false, vertical: true)
          }
          ForEach(Array(fresh.findings.enumerated()), id: \.offset) { _, finding in
            VStack(alignment: .leading, spacing: 2) {
              if let url = URL(string: finding.url) {
                Link(destination: url) {
                  Text(finding.title)
                    .tcFont(.meta)
                    .foregroundStyle(Tokens.Color.ink2)
                }
              } else {
                Text(finding.title)
                  .tcFont(.meta)
                  .foregroundStyle(Tokens.Color.ink2)
              }
              if !finding.note.isEmpty {
                Text(finding.note)
                  .tcFont(.meta)
                  .foregroundStyle(Tokens.Color.muted)
                  .fixedSize(horizontal: false, vertical: true)
              }
              HStack(spacing: 8) {
                Text(freshSourceLabel(app, finding.sourceKind))
                  .tcFont(.meta)
                  .foregroundStyle(Tokens.Color.muted)
                if finding.isRecent == true || finding.age != nil {
                  Text(app.freshVoicesRecent)
                    .tcFont(.meta)
                    .foregroundStyle(Tokens.Color.recommendation)
                }
              }
            }
            .accessibilityIdentifier("plan.placeIntelligence.fresh.finding")
          }
        }
        .accessibilityIdentifier("plan.placeIntelligence.fresh.loaded")
      }
    }
  }

  /// web の `sourceKind` を UI ラベルへ。未知値は「ウェブ」に寄せる(web の既定と同じ)。
  private func freshSourceLabel(_ app: AppCopy, _ kind: String) -> String {
    switch kind {
    case "social": return app.freshSourceSocial
    case "news": return app.freshSourceNews
    case "blog": return app.freshSourceBlog
    default: return app.freshSourceWeb
    }
  }
}
```

- [ ] **Step 3.6: Build the app and run app + UI tests — verify green with zero new warnings**

Run: `apple/tools/verify-app.sh test`
Expected: `exit=0` — `TripCheckTests` and `TripCheckUITests` both pass; the `grep` line shows no new `error:` / `warning:`. (Confirms the composition-root wiring, the nested disclosure, and the 8 AppCopy strings all compile in the app target and no existing UI flow regressed.)

- [ ] **Step 3.7: Commit**

```bash
git add apple/TripCheck/App/TripCheckApp.swift \
        apple/TripCheck/Screens/Detail/PlaceIntelligenceDisclosure.swift
git commit -m "Show the nested fresh-voices disclosure on the loaded place card" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012DRrRBiU96fLJmvfThaR4J"
```

- [ ] **Step 3.8: Append the manual E2E section to `apple/docs/paid-route-check.md`**

Append to the end of `apple/docs/paid-route-check.md`:

```markdown

## 11. 最新の声(place-intelligence/fresh)

合成の根(`TripCheckApp.init`)は非 UI テストのとき常に
`FreshVoicesAvailability.makeDefaultProvider(uiTesting:client:)` が返す
`WorkerFreshVoicesProvider` を `PlannerStore` に渡す(`-uiTesting` は nil のまま ——
「最新の声」節は決定的に空表示になり、そもそも基底カードが `.unavailable` になる UI テストでは
入れ子の節自体が描かれない)。この節は基底の場所詳細(この場所について)が `.loaded` に
なって初めて出る入れ子の開示で、展開でだけ 1 度取りに行く(`depth:"quick"` = 1 unit)。

1. 上の 1〜3 と同じく `.dev.vars` に実 `GOOGLE_PLACES_API_KEY` を置き、さらに
   `ANTHROPIC_REQUESTS_ENABLED="true"` と非空の `ANTHROPIC_API_KEY` を置いて `pnpm dev` を
   起動。Simulator は `TRIPCHECK_WORKER_BYPASS_TOKEN` を `.dev.vars` と同じ値にして走らせる
   (`-uiTesting` は付けない)。
2. Google 検証済み(ピンに Google の裏取りがある)停留所のシートを開き、「この場所について」
   (`plan.placeIntelligence`)を開く。詳細が出たら、その中の「最新の声を見る」
   (`plan.placeIntelligence.fresh`)を開く。初回だけ `/api/place-intelligence/fresh` の取得が
   走り、要約(あれば)と、題名(タップで元記事へ遷移)・ひとこと・出典ラベル(SNS/ニュース/
   ブログ/ウェブ)・新しければ「最近」の札を持つ行が並ぶこと(`plan.placeIntelligence.fresh.loaded`
   / 各行 `plan.placeIntelligence.fresh.finding`)を確認する。写真・絵文字は出ないこと。
3. `ANTHROPIC_REQUESTS_ENABLED` を外す(または鍵を空にする)と、同じ節を開いても
   `{code:"not_configured"}` / 503 でフェイルクローズし、「最近の話題は見つかりませんでした」
   だけが出ること(`plan.placeIntelligence.fresh.unavailable`)を確認する。Worker を止めた場合・
   8 秒でタイムアウトした場合・非 200 が返った場合も同じ空表示になる
   (`beginFreshVoices` が nil を `.unavailable` として扱う道と同じ結果)。
```

- [ ] **Step 3.9: Commit**

```bash
git add apple/docs/paid-route-check.md
git commit -m "Document the fresh-voices manual paid-route check" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012DRrRBiU96fLJmvfThaR4J"
```

---

## Self-Review

**1. Spec coverage** — every spec section maps to a task:
- Web contract (request/response/finding) → Task 1 (`FreshVoicesModels.swift`, models tests). Dropped fields `searchCount`/`evidenceLevel`/`urlSignature` omitted from decode (Step 1.3 comments; Step 1.1 decodes payloads that carry them and asserts they are ignored). ✓
- Design ruling 1 (3-case enum, no `paused`; `Equatable`) → `StopFreshVoices` in Step 2.5; `FreshVoicesResult`/`FreshFinding` are `Equatable` (Step 1.3). ✓
- Design ruling 2 (opt-in second expand, `depth:"quick"`) → nested `DisclosureCard` in Step 3.5 (`.task` on the DisclosureCard's content, which only renders while open); payload `depth:"quick"` in Step 2.5. ✓
- Design ruling 3 (subject = `result.place.name` / `result.place.address.prefix(100)`, `intent:"place"`, planner destination) → Step 3.5 (`freshName`/`freshArea`) + Step 2.5 (`intent:"place"`, `request.destination.rawValue`). ✓
- Design ruling 4 (pipeline takes subject as args; no-op on `.loading`/`.loaded`) → `loadFreshVoices(stopId:name:area:)` in Step 2.5; idempotence test in Step 2.1. ✓
- Design ruling 5 (text-only: summary lead, finding rows with `Link` title, note, localized `sourceKind`, "最近" badge) → Step 3.5 `freshContent`. ✓
- Design ruling 6 (invalidation co-located, same 5 sites) → Step 2.8. ✓
- Architecture new files (3) + edited files (8) → Tasks 1–3 files lists. ✓
- Data flow / error handling / fail-closed (nil provider, 8s timeout, 401-retry fail, non-200, decode failure all → `.unavailable`) → 8s race in Step 2.3; nil→`.unavailable` in Step 2.5; 401/non-200/decode in Step 1.8; tests in Steps 1.6 & 2.1. ✓
- Testing plan (models, WorkerClient 200/401/non-200, pipeline; UI best-effort skipped) → Steps 1.1, 1.6, 2.1, and the Task-3 skip note. ✓
- Verify (`verify-kit.sh`, `verify-app.sh test`) → Steps 2.9, 3.2, 3.6. Manual E2E doc → Step 3.8. ✓

**2. Placeholder scan** — no `TBD`/`TODO`/"similar to above"/"add appropriate…"; every code step shows real Swift, and Step 3.5 shows the complete file. ✓

**3. Type consistency** — names identical across tasks: `FreshVoicesRequestPayload`, `FreshVoicesResult`, `FreshFinding`, `FreshVoicesProviding`, `WorkerFreshVoicesProvider`, `FreshVoicesAvailability`, `StopFreshVoices`, `freshVoicesByStop`, `freshVoicesTasks`, `freshVoicesGeneration`, `freshVoicesProvider`, `loadFreshVoices(stopId:name:area:)`, `beginFreshVoices(stopId:name:area:)`, `invalidateFreshVoices()`, `freshVoices(_:)`, `FreshOnce`/`freshVoicesOnce`. The pipeline calls `provider.freshVoices(payload)` (Step 2.5), matching `FreshVoicesProviding.freshVoices` (Step 2.3) and `WorkerAuthenticating.freshVoices` (Step 1.8) — both protocols expose the same method name; `WorkerFreshVoicesProvider` bridges them. `PlannerStore(resolvers:store:freshVoicesProvider:)` (Steps 2.1/2.4) uses the LAST init param. AppCopy properties consumed in Step 3.5 (`freshVoicesExpand`, `freshVoicesTitle`, `freshVoicesEmpty`, `freshSource{Social,News,Blog,Web}`, `freshVoicesRecent`) exactly match the 8 declared in Step 3.1. ✓

**Resolved during self-review:** the fresh subject `area` fallback is computed inside the disclosure's `.loaded` branch from the base result (ruling 4 keeps tests string-only), because `StopInspectorModel` exposes `name` but not `area`; for Google-verified stops (the only stops with this card) `place.name`/`place.address` are always populated, so the empty-guard is defensive. Both `freshVoicesExpand` and `freshVoicesTitle` are used (collapsed CTA vs. opened section heading). Accessibility ids follow the base card's own `.unavailable`/`.loaded` convention plus per-finding `.fresh.finding`.
