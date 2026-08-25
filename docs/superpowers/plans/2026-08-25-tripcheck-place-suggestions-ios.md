# TripCheck iOS place-suggestions 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development でタスク単位に実装する。各ステップは `- [ ]`。

**Goal:** 検索窓で文字を打つ間、端末内 Apple サジェストに加えて Google Places Autocomplete(Worker 経由)候補を出し、選べば既存 Google 優先チェーンが CTA で解決する。

**Architecture:** `WorkerClient.suggestPlaces`(resolvePlaces を鏡写し)→ 狭い seam `PlaceSuggesting` を後ろに置く `WorkerSuggestions`(AppleSuggestions と同型の query 駆動 observable)→ `PlaceSearchField` が Apple 区画の下に Google 区画を描画・タップは `fullText` を通常入力として `addEntry(text:, suggestion: nil)` へ。web/Kit は無改変。

**Tech Stack:** Swift 6(strict concurrency)、SwiftUI、`@Observable`/`@MainActor`、swift-testing + XCTest、XCUITest。

**Spec:** `docs/superpowers/specs/2026-08-25-tripcheck-place-suggestions-ios-design.md`

## Global Constraints

- **web 不可侵:** `lib/**`・`app/api/**` を変更しない。本機能は web/Worker 変更を要しない(`/api/place-suggestions` は既に paid 登録・app セッション認可・quota 課金済み)。
- **Kit 不可侵:** `Sources/TripCheckKit/` を変更しない。新規型・部品は `TripCheckAppCore` かアプリターゲット(`apple/TripCheck/`)。
- **Swift 6 strict concurrency 新規警告ゼロ。** 越境型は `Sendable`、UI は `@MainActor`。
- **絵文字禁止。** 日本語リテラルは `AppCopy.swift` のみ(日本語 doc コメント可)。ブランド文字列は `Text(verbatim:)`。
- **`git push` しない。**
- **コミット trailer(厳守):**
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_012DRrRBiU96fLJmvfThaR4J
  ```
- **属性表示:** Google 予測を出す区画に `Text(verbatim: "Powered by Google")` を添える(WeatherKit の Apple Weather 帰属バッジと同じ方針。データ源の明示)。
- **検証:** `apple/tools/verify-kit.sh`(**引数なし**)全緑、`apple/tools/verify-app.sh test`(app unit + UI)全緑、新規警告ゼロ。web テストは対象外(web 無改変)。

---

### Task 1: Worker 越しの取得(モデル + プロトコル + クライアント + スタブ + テスト)

**Files:**
- Create: `apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Worker/PlaceSuggestionModels.swift`
- Modify: `apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Worker/WorkerAuthState.swift`(protocol に 1 要件追加)
- Modify: `apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Worker/WorkerClient.swift`(実装追加)
- Modify: `apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Worker/CannedWorkerClient.swift`(nil スタブ)
- Modify: `apple/Packages/TripCheckKit/Tests/TripCheckAppCoreTests/WorkerPlaceResolverTests.swift`(`StubWorker` と `SlowStubWorker` に nil スタブ)
- Modify: `apple/Packages/TripCheckKit/Tests/TripCheckAppCoreTests/WorkerClientTests.swift`(FakeGateway に 1 ケース + 401 再試行テスト)
- Create: `apple/Packages/TripCheckKit/Tests/TripCheckAppCoreTests/PlaceSuggestionModelsTests.swift`

**Interfaces:**
- Produces: `PlaceSuggestionRequestPayload(query:languageCode:destination:)`(Encodable/Sendable)、`WorkerPlaceSuggestion(providerRef:primaryText:secondaryText:fullText:)`(Decodable/Sendable/Identifiable、`id == providerRef`)、`PlaceSuggestionResult(provider:suggestions:)`(Decodable/Sendable)、`WorkerAuthenticating.suggestPlaces(_:) async -> PlaceSuggestionResult?`。
- Consumes: 既存 `WorkerRequest`/`transport.send`/`authenticate(allowKeyReset:)`/`ensureSession()`。

- [ ] **Step 1: モデルの失敗テストを書く** — Create `PlaceSuggestionModelsTests.swift`:

```swift
import XCTest
@testable import TripCheckAppCore

final class PlaceSuggestionModelsTests: XCTestCase {
  func testDecodesWebResponseAndIgnoresExtraFields() throws {
    let json = #"""
    {"provider":"google_maps","extra":"ignored","suggestions":[
      {"providerRef":"pid-1","primaryText":"Tokyo Tower","secondaryText":"Minato, Tokyo","fullText":"Tokyo Tower, Minato, Tokyo","note":"unused"}
    ]}
    """#
    let result = try JSONDecoder().decode(PlaceSuggestionResult.self, from: Data(json.utf8))
    XCTAssertEqual(result.provider, "google_maps")
    XCTAssertEqual(result.suggestions.count, 1)
    let s = try XCTUnwrap(result.suggestions.first)
    XCTAssertEqual(s.providerRef, "pid-1")
    XCTAssertEqual(s.id, "pid-1")
    XCTAssertEqual(s.primaryText, "Tokyo Tower")
    XCTAssertEqual(s.secondaryText, "Minato, Tokyo")
    XCTAssertEqual(s.fullText, "Tokyo Tower, Minato, Tokyo")
  }

  func testEncodesRequestPayload() throws {
    let payload = PlaceSuggestionRequestPayload(query: "tok", languageCode: "ja", destination: "auto")
    let data = try JSONEncoder().encode(payload)
    let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any]
    XCTAssertEqual(obj?["query"] as? String, "tok")
    XCTAssertEqual(obj?["languageCode"] as? String, "ja")
    XCTAssertEqual(obj?["destination"] as? String, "auto")
  }
}
```

- [ ] **Step 2: テストが失敗することを確認**（型が無い） — `apple/tools/verify-kit.sh`（引数なし）。Expected: コンパイル失敗（`PlaceSuggestionResult` 未定義）。

- [ ] **Step 3: モデルを実装** — Create `PlaceSuggestionModels.swift`:

```swift
import Foundation

/// web `POST /api/place-suggestions` へ送るペイロード。単数 `query`（解決の複数 `queries` と違う）。
public struct PlaceSuggestionRequestPayload: Encodable, Sendable {
  public let query: String        // 2–120 文字
  public let languageCode: String // "ja" | "en"
  public let destination: String  // "auto" or 目的地 id（DestinationChoice.rawValue）
  public init(query: String, languageCode: String, destination: String) {
    self.query = query
    self.languageCode = languageCode
    self.destination = destination
  }
}

/// web の autocomplete 予測 1 行の写し。使わない付随フィールドはデコードで無視される。
public struct WorkerPlaceSuggestion: Decodable, Sendable, Identifiable, Equatable {
  public let providerRef: String   // Google Place ID（一覧内の一意鍵）
  public let primaryText: String
  public let secondaryText: String
  public let fullText: String      // タップ時に入力欄へ入れるテキスト
  public var id: String { providerRef }
  public init(providerRef: String, primaryText: String, secondaryText: String, fullText: String) {
    self.providerRef = providerRef
    self.primaryText = primaryText
    self.secondaryText = secondaryText
    self.fullText = fullText
  }
}

/// web `{ provider, suggestions }` の写し。
public struct PlaceSuggestionResult: Decodable, Sendable {
  public let provider: String
  public let suggestions: [WorkerPlaceSuggestion]
  public init(provider: String, suggestions: [WorkerPlaceSuggestion]) {
    self.provider = provider
    self.suggestions = suggestions
  }
}
```

- [ ] **Step 4: プロトコルに要件を追加** — `WorkerAuthState.swift` の `protocol WorkerAuthenticating` 末尾（`resolvePlaces` の次）に:

```swift
  /// 検証済みの場所サジェスト。失敗・未認証・到達不能はすべて nil（=呼び出し側は Apple のみ）。
  func suggestPlaces(_ payload: PlaceSuggestionRequestPayload) async -> PlaceSuggestionResult?
```

- [ ] **Step 5: WorkerClient に実装** — `WorkerClient.swift` の `resolvePlaces`/`resolvePlacesOnce` ブロックの直後（`authenticate(allowKeyReset:)` の前）に、`resolvePlaces` を正確に鏡写しした:

```swift
  public func suggestPlaces(_ payload: PlaceSuggestionRequestPayload) async -> PlaceSuggestionResult? {
    let auth = await ensureSession()
    guard case .authenticated = auth, let token = sessionToken else { return nil }
    guard let body = try? JSONEncoder().encode(payload) else { return nil }
    switch await suggestPlacesOnce(token: token, body: body) {
    case .resolved(let result): return result
    case .failed: return nil
    case .unauthorized:
      // 401 のときは 1 度だけ取り直して再送。
      sessionToken = nil
      state = .idle
      let reauth = await authenticate(allowKeyReset: true)
      guard case .authenticated = reauth, let fresh = sessionToken else { return nil }
      if case .resolved(let result) = await suggestPlacesOnce(token: fresh, body: body) { return result }
      return nil
    }
  }

  private enum SuggestOnce {
    case resolved(PlaceSuggestionResult)
    case unauthorized
    case failed
  }

  /// 200→結果、401→取り直しの合図、その他/例外→failed（Apple のみへ代替）。
  private func suggestPlacesOnce(token: String, body: Data) async -> SuggestOnce {
    do {
      let response = try await transport.send(
        WorkerRequest(path: "/api/place-suggestions", method: "POST", body: body, sessionToken: token),
        baseURL: baseURL
      )
      if response.status == 200 {
        guard let decoded = try? JSONDecoder().decode(PlaceSuggestionResult.self, from: response.body) else { return .failed }
        return .resolved(decoded)
      }
      if response.status == 401 { return .unauthorized }
      return .failed
    } catch {
      return .failed
    }
  }
```

- [ ] **Step 6: Canned とテストスタブを更新**
  - `CannedWorkerClient.swift` の `resolvePlaces` の次に:
    ```swift
    public func suggestPlaces(_ payload: PlaceSuggestionRequestPayload) async -> PlaceSuggestionResult? { nil }
    ```
  - `WorkerPlaceResolverTests.swift`：`StubWorker` と `SlowStubWorker` の**両方**に、その型の `resolvePlaces` 実装と同じ場所へ:
    ```swift
    func suggestPlaces(_ payload: PlaceSuggestionRequestPayload) async -> PlaceSuggestionResult? { nil }
    ```
    （両スタブは `WorkerAuthenticating` 準拠。プロトコル要件追加で必須になる。既存の各スタブの記法・アクセス修飾に合わせる。）

- [ ] **Step 7: FakeGateway に place-suggestions ケース + 401 再試行テスト** — `WorkerClientTests.swift`:
  - `FakeGateway` に格納 `var suggestUnauthorizedOnce = false` と `private var sawSuggest401 = false` を追加。
  - `func configure(...)` のシグネチャに `suggestUnauthorizedOnce: Bool = false` を足し、本体で `self.suggestUnauthorizedOnce = suggestUnauthorizedOnce` を代入。
  - `respond(to:)` の `switch` に、`case "/api/place-resolution":` の隣へ:
    ```swift
    case "/api/place-suggestions":
      if suggestUnauthorizedOnce, !sawSuggest401 {
        sawSuggest401 = true
        return json(#"{"code":"session_expired"}"#, 401)
      }
      return json(#"{"provider":"google_maps","suggestions":[{"providerRef":"abc","primaryText":"Tokyo Tower","secondaryText":"Minato","fullText":"Tokyo Tower, Minato"}]}"#, 200)
    ```
  - 末尾のテスト（`testResolvePlacesRetriesOnceOn401` の隣）に:
    ```swift
    func testSuggestPlacesRetriesOnceOn401() async {
      let gateway = FakeGateway()
      await gateway.configure(suggestUnauthorizedOnce: true)
      let (client, _) = makeClient(gateway: gateway)
      let payload = PlaceSuggestionRequestPayload(query: "tok", languageCode: "en", destination: "auto")
      let result = await client.suggestPlaces(payload)
      XCTAssertNotNil(result, "a 401 must be retried once and then succeed")
      XCTAssertEqual(result?.suggestions.first?.providerRef, "abc")
    }
    ```

- [ ] **Step 8: 全テスト緑を確認** — `apple/tools/verify-kit.sh`（引数なし）。Expected: 既存 + 新規テスト全緑、新規警告ゼロ。

- [ ] **Step 9: コミット** — `git add` 上記ファイル、trailer 付きでコミット。

---

### Task 2: 2 本目のサジェスト源 `WorkerSuggestions`（seam + アダプタ + observable + テスト）

**Files:**
- Create: `apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Providers/WorkerSuggestions.swift`
- Create: `apple/Packages/TripCheckKit/Tests/TripCheckAppCoreTests/WorkerSuggestionsTests.swift`

**Interfaces:**
- Consumes: Task 1 の `WorkerPlaceSuggestion`/`PlaceSuggestionRequestPayload`/`PlaceSuggestionResult`/`WorkerAuthenticating.suggestPlaces`。Kit の `DestinationChoice`/`PlannerLocale`。
- Produces: `protocol PlaceSuggesting`（`suggest(query:destination:languageCode:) async -> [WorkerPlaceSuggestion]?`）、`struct WorkerSuggestionAdapter(client:timeout:)`、`@MainActor @Observable final class WorkerSuggestions`（`var query`、`private(set) var results: [WorkerPlaceSuggestion]`、`init(debounce:source:)`、`convenience init(client:)`、`configure(destination:locale:)`、`reset()`）。

- [ ] **Step 1: 失敗テストを書く** — Create `WorkerSuggestionsTests.swift`（`AppleSuggestionsTests` の待ち方を踏襲）:

```swift
import Testing
@testable import TripCheckAppCore
import TripCheckKit

/// 1 メソッドだけのフェイク。`nil` は失敗/タイムアウト（覚えない）、`[]`/中身は確定答（覚える）。
@MainActor private final class FakeSuggesting: PlaceSuggesting {
  var calls = 0
  var lastQuery: String?
  var lastDestination: String?
  var lastLanguage: String?
  var answer: [WorkerPlaceSuggestion]?
  init(answer: [WorkerPlaceSuggestion]? = []) { self.answer = answer }
  func suggest(query: String, destination: String, languageCode: String) async -> [WorkerPlaceSuggestion]? {
    calls += 1
    lastQuery = query; lastDestination = destination; lastLanguage = languageCode
    return answer
  }
}

@MainActor private func waitUntil(_ condition: () -> Bool) async throws {
  var spins = 0
  while !condition(), spins < 2_000 {
    try await Task.sleep(for: .milliseconds(1))
    spins += 1
  }
}

private func row(_ id: String) -> WorkerPlaceSuggestion {
  WorkerPlaceSuggestion(providerRef: id, primaryText: id, secondaryText: "", fullText: id)
}

@Test @MainActor func belowThreeCharsNeverAsks() async {
  let fake = FakeSuggesting(answer: [row("p")])
  let s = WorkerSuggestions(debounce: .milliseconds(10), source: fake)
  s.query = "to"            // 2 文字 < 3：予定すら立てない（同期で片付く）
  #expect(fake.calls == 0)
  #expect(s.results.isEmpty)
}

@Test @MainActor func asksOnceAtThreeCharsAndCachesHit() async throws {
  let fake = FakeSuggesting(answer: [row("p")])
  let s = WorkerSuggestions(debounce: .milliseconds(10), source: fake)
  s.configure(destination: .auto, locale: .en)
  s.query = "tok"
  try await waitUntil { s.results.count == 1 }
  #expect(fake.calls == 1)
  #expect(fake.lastQuery == "tok")
  #expect(fake.lastLanguage == "en")
  s.query = "tokyo"
  try await waitUntil { fake.calls == 2 }
  s.query = "tok"                 // キャッシュ命中は同期で戻る
  #expect(s.results.count == 1)
  #expect(fake.calls == 2)        // 再問い合わせ無し
}

@Test @MainActor func failureIsNotCachedAndLeavesResultsEmpty() async throws {
  let fake = FakeSuggesting(answer: nil)   // 失敗/タイムアウトを模す
  let s = WorkerSuggestions(debounce: .milliseconds(10), source: fake)
  s.query = "tok"
  try await waitUntil { fake.calls == 1 }
  #expect(s.results.isEmpty)
  s.query = ""
  s.query = "tok"
  try await waitUntil { fake.calls == 2 }  // 覚えないので同じ文字列でも尋ね直す
  #expect(fake.calls == 2)
}

@Test @MainActor func changingLocaleReasks() async throws {
  let fake = FakeSuggesting(answer: [row("p")])
  let s = WorkerSuggestions(debounce: .milliseconds(10), source: fake)
  s.configure(destination: .auto, locale: .en)
  s.query = "tok"
  try await waitUntil { fake.calls == 1 }
  s.configure(destination: .auto, locale: .ja)
  try await waitUntil { fake.calls == 2 }
  #expect(fake.calls == 2)
  #expect(fake.lastLanguage == "ja")
}

@Test @MainActor func resetClearsQueryAndResults() async throws {
  let fake = FakeSuggesting(answer: [row("p")])
  let s = WorkerSuggestions(debounce: .milliseconds(10), source: fake)
  s.query = "tok"
  try await waitUntil { s.results.count == 1 }
  s.reset()
  #expect(s.query.isEmpty)
  #expect(s.results.isEmpty)
}
```

- [ ] **Step 2: テスト失敗を確認** — `apple/tools/verify-kit.sh`（引数なし）。Expected: `PlaceSuggesting`/`WorkerSuggestions` 未定義でコンパイル失敗。

- [ ] **Step 3: seam・アダプタ・observable を実装** — Create `WorkerSuggestions.swift`:

```swift
import Foundation
import TripCheckKit

/// 「この文字列で Worker にサジェストを尋ねて」に答えられるもの。実物は WorkerClient を包む
/// アダプタ、テストはフェイク。失敗・未認証・タイムアウトは nil（=呼び手は Apple のみ）。
public protocol PlaceSuggesting: Sendable {
  func suggest(query: String, destination: String, languageCode: String) async -> [WorkerPlaceSuggestion]?
}

/// 実物。`any WorkerAuthenticating`（= WorkerClient）を包み、タイプアヘッド用に上限時間を切って
/// `suggestPlaces` を呼ぶ。`WorkerPlaceResolver` の withTaskGroup レースを鏡に、負けは打ち切る。
public struct WorkerSuggestionAdapter: PlaceSuggesting {
  private let client: any WorkerAuthenticating
  private let timeout: Duration
  public init(client: any WorkerAuthenticating, timeout: Duration = .seconds(3)) {
    self.client = client
    self.timeout = timeout
  }
  public func suggest(query: String, destination: String, languageCode: String) async -> [WorkerPlaceSuggestion]? {
    let payload = PlaceSuggestionRequestPayload(query: query, languageCode: languageCode, destination: destination)
    let client = self.client
    let limit = timeout
    return await withTaskGroup(of: PlaceSuggestionResult?.self) { group in
      group.addTask { await client.suggestPlaces(payload) }
      group.addTask {
        try? await Task.sleep(for: limit)
        return nil
      }
      let first = await group.next() ?? nil
      group.cancelAll()
      return first?.suggestions
    }
  }
}

/// 検索窓 1 つぶんの Google サジェスト状態。画面は `query` を書き、`results` を読む。
/// `AppleSuggestions` と同じ規律だが、paid・ネットワーク源なので **3 文字最小・より長い
/// デバウンス**。未認証・失敗・タイムアウトは静かに空（Apple 行はそのまま出る）。
@Observable
@MainActor
public final class WorkerSuggestions {
  /// これ未満の長さでは尋ねない（Apple の 2 より 1 段厳しく）。
  public static let minimumQueryLength = 3
  /// 覚えておく問いの数。超えたら古いものから捨てる。
  public static let cacheLimit = 40

  public var query: String = "" {
    didSet {
      guard query != oldValue else { return }
      schedule()
    }
  }
  public private(set) var results: [WorkerPlaceSuggestion] = []

  @ObservationIgnored private let debounce: Duration
  @ObservationIgnored private let source: any PlaceSuggesting
  @ObservationIgnored private var destination: String = DestinationChoice.auto.rawValue
  @ObservationIgnored private var languageCode: String = PlannerLocale.ja.rawValue
  @ObservationIgnored private var cache: [CacheKey: [WorkerPlaceSuggestion]] = [:]
  @ObservationIgnored private var cacheOrder: [CacheKey] = []
  @ObservationIgnored private var pending: Task<Void, Never>?

  public init(debounce: Duration = .milliseconds(700), source: any PlaceSuggesting) {
    self.debounce = debounce
    self.source = source
  }

  /// 合成の根が WorkerClient から作る既定。UI テストは Canned（`suggestPlaces` が常に nil）。
  public convenience init(client: any WorkerAuthenticating) {
    self.init(source: WorkerSuggestionAdapter(client: client))
  }

  /// 行き先・言語を反映する。どちらかが変われば、同じ文字列でも尋ね直す。
  public func configure(destination: DestinationChoice, locale: PlannerLocale) {
    let d = destination.rawValue
    let l = locale.rawValue
    guard d != self.destination || l != self.languageCode else { return }
    self.destination = d
    self.languageCode = l
    schedule()
  }

  /// 画面が出直したときに前の答えを消す（この源は root 常駐で画面と同い年ではない）。
  public func reset() {
    pending?.cancel()
    pending = nil
    results = []
    query = ""
  }

  // MARK: - 内部

  private struct CacheKey: Hashable {
    var query: String
    var destination: String
    var languageCode: String
  }

  private var currentKey: CacheKey? {
    let text = query.trimmingCharacters(in: .whitespacesAndNewlines)
    guard text.count >= Self.minimumQueryLength else { return nil }
    return CacheKey(query: text, destination: destination, languageCode: languageCode)
  }

  private func schedule() {
    pending?.cancel()
    pending = nil
    guard let key = currentKey else {
      // 3 文字未満。前の候補は残さない。
      results = []
      return
    }
    if let remembered = cache[key] {
      results = remembered
      return
    }
    pending = Task { [weak self] in
      guard let self else { return }
      try? await Task.sleep(for: self.debounce)
      guard !Task.isCancelled else { return }
      await self.ask(key)
    }
  }

  private func ask(_ key: CacheKey) async {
    let found = await source.suggest(query: key.query, destination: key.destination, languageCode: key.languageCode)
    guard !Task.isCancelled, key == currentKey else { return }   // 待つ間に打ち替えられた
    guard let found else {
      // 失敗・未認証・タイムアウトは覚えない。Apple は別途出ているので可視の劣化なし。
      results = []
      return
    }
    remember(key, found)
    results = found
  }

  private func remember(_ key: CacheKey, _ found: [WorkerPlaceSuggestion]) {
    if cache[key] == nil { cacheOrder.append(key) }
    cache[key] = found
    while cacheOrder.count > Self.cacheLimit {
      cache[cacheOrder.removeFirst()] = nil
    }
  }
}
```

- [ ] **Step 4: 全テスト緑を確認** — `apple/tools/verify-kit.sh`（引数なし）。Expected: 新規 5 テスト含め全緑、新規警告ゼロ。

- [ ] **Step 5: コミット** — trailer 付き。

---

### Task 3: 画面配線（PlaceSearchField + StartScreen + 合成の根 + プレビュー + UI テスト）

**Files:**
- Modify: `apple/TripCheck/Screens/Start/PlaceSearchField.swift`
- Modify: `apple/TripCheck/Screens/Start/StartScreen.swift`（`#Preview` 含む）
- Modify: `apple/TripCheck/App/TripCheckApp.swift`（合成の根で生成・注入）
- Modify: `apple/TripCheck/App/RootView.swift`（`#Preview` に注入）
- Modify: `apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Presentation/AppCopy.swift`（区画見出し 1 本）
- Modify: `apple/TripCheckUITests/PlannerFlowTests.swift`（非回帰 UI テスト 1 本）

**Interfaces:**
- Consumes: Task 2 の `WorkerSuggestions`（`query`/`results`/`configure`/`reset`/`init(client:)`）、Task 1 の `WorkerPlaceSuggestion`。既存 `store.addEntry(text:suggestion:)`（`suggestion == nil` パス）・`store.request.destination`/`.locale`・`CannedWorkerClient`。

- [ ] **Step 1: AppCopy に見出しを追加** — `AppCopy.swift` の既存 `suggestionsUnavailable` プロパティの隣に、同じ ja/en 分岐の書式で `webSuggestionsHeader` を足す。値は ja `"ウェブの検索候補"`、en `"From web search"`。（`suggestionsUnavailable` の定義を読み、その記法を正確に踏襲する。）

- [ ] **Step 2: PlaceSearchField を 2 源対応にする**
  - プロパティ追加（`suggestions` の隣）: `let webSuggestions: WorkerSuggestions`
  - 定数追加（`visibleSuggestions` の隣）: `private static let visibleWebSuggestions = 3`
  - `TextField` の `.onChange(of: suggestions.query) { store.intentQueryChanged() }` の直後に、query を 2 源へ橋渡し:
    ```swift
    .onChange(of: suggestions.query) { _, newValue in webSuggestions.query = newValue }
    ```
  - パネル表示条件を web 行も含める。`if store.intentRowVisible(for: suggestions.query) || !suggestions.results.isEmpty {` を
    `if store.intentRowVisible(for: suggestions.query) || !suggestions.results.isEmpty || !webRows.isEmpty {` に変更。
  - Apple 行の `ForEach(suggestions.results.prefix(...))` ブロックの**直後（同じ内側 VStack 内）**に Google 区画を追加:
    ```swift
    if !webRows.isEmpty {
      if !suggestions.results.isEmpty {
        Rectangle().fill(Tokens.Color.line).frame(height: 1).padding(.leading, 14)
      }
      Text(app.webSuggestionsHeader)
        .tcFont(.meta)
        .foregroundStyle(Tokens.Color.muted)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 14)
        .padding(.top, 8)
      ForEach(webRows) { row in
        Button { chooseWeb(row) } label: {
          VStack(alignment: .leading, spacing: 2) {
            Text(row.primaryText)
              .tcFont(.stopName)
              .foregroundStyle(Tokens.Color.ink)
            if !row.secondaryText.isEmpty {
              Text(row.secondaryText)
                .tcFont(.meta)
                .foregroundStyle(Tokens.Color.muted)
            }
          }
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(.horizontal, 14)
          .padding(.vertical, 8)
          .frame(minHeight: Tokens.Hit.primary)
          .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("start.webSuggestion")
        .accessibilityLabel(row.secondaryText.isEmpty ? row.primaryText : "\(row.primaryText) \(row.secondaryText)")
        if row.id != webRows.last?.id {
          Rectangle().fill(Tokens.Color.line).frame(height: 1).padding(.leading, 14)
        }
      }
      HStack(spacing: 0) {
        Spacer(minLength: 0)
        Text(verbatim: "Powered by Google")
          .tcFont(.meta)
          .foregroundStyle(Tokens.Color.muted)
      }
      .padding(.horizontal, 14)
      .padding(.vertical, 6)
    }
    ```
  - 算出プロパティとタップ処理を（`choose(_:)` の隣に）追加:
    ```swift
    /// Apple 行と正規化名で重ならない Google 行を、上限まで。
    private var webRows: [WorkerPlaceSuggestion] {
      let taken = Set(suggestions.results.prefix(Self.visibleSuggestions).map { Self.normalize($0.title) })
      var seen = Set<String>()
      var out: [WorkerPlaceSuggestion] = []
      for row in webSuggestions.results {
        let key = Self.normalize(row.primaryText)
        if taken.contains(key) || seen.contains(key) { continue }
        seen.insert(key)
        out.append(row)
        if out.count == Self.visibleWebSuggestions { break }
      }
      return out
    }

    private static func normalize(_ s: String) -> String {
      s.lowercased().split(whereSeparator: { $0.isWhitespace }).joined()
    }

    /// Google 予測は `CompletionToken` を持たない。`fullText` を通常入力として渡し、
    /// CTA 時に既存チェーン（Google 優先）が解決する（`suggestion == nil` パス）。
    private func chooseWeb(_ row: WorkerPlaceSuggestion) {
      onSubmit(row.fullText, nil)
      suggestions.query = ""     // onChange 経由で webSuggestions.query も空になる
      isFocused = false
    }
    ```

- [ ] **Step 3: StartScreen を配線**
  - プロパティ追加（`@State private var suggestions` の隣）: `@Environment(WorkerSuggestions.self) private var webSuggestions`
  - `PlaceSearchField(suggestions: suggestions) { ... }` を `PlaceSearchField(suggestions: suggestions, webSuggestions: webSuggestions) { ... }` に変更。
  - `DestinationPicker` の `set:` 内、`suggestions.setRegion(store.destinationBounds)` の直後に:
    ```swift
    webSuggestions.configure(destination: choice, locale: store.request.locale)
    ```
  - `.task { suggestions.setRegion(store.destinationBounds) }` を:
    ```swift
    .task {
      suggestions.setRegion(store.destinationBounds)
      webSuggestions.reset()
      webSuggestions.configure(destination: store.request.destination, locale: store.request.locale)
    }
    ```
  - ファイル末尾 `#Preview` を、`WorkerSuggestions` を注入する形へ:
    ```swift
    #Preview {
      RootView()
        .environment(PlannerStore(resolvers: [CatalogResolver()], store: nil))
        .environment(WorkerSuggestions(client: CannedWorkerClient()))
    }
    ```

- [ ] **Step 4: 合成の根で生成・注入** — `TripCheckApp.swift`:
  - 格納プロパティを追加（`store` の宣言の隣、記法を合わせる）: `@State private var webSuggestions: WorkerSuggestions`
  - `init` 内、`_store = State(initialValue: ...)` の直後に:
    ```swift
    _webSuggestions = State(initialValue: WorkerSuggestions(client: workerClient))
    ```
    （`workerClient` は同 init 内のローカル。UI テストでは `CannedWorkerClient` が入る＝Google 区画は出ない。）
  - `body` の `RootView()` ブランチに `.environment(webSuggestions)` を鎖する:
    ```swift
    RootView()
      .environment(store)
      .environment(webSuggestions)
      .preferredColorScheme(.light)
    ```
    （`WorkerDiagnosticsScreen` ブランチは変更しない。）

- [ ] **Step 5: RootView の #Preview に注入** — `RootView.swift` の `#Preview`（`RootView().environment(PlannerStore(resolvers: [], store: nil))`）を:
  ```swift
  RootView()
    .environment(PlannerStore(resolvers: [], store: nil))
    .environment(WorkerSuggestions(client: CannedWorkerClient()))
  ```
  （`TripCheckAppCore` が import 済みであることを確認。未 import なら足す。）

- [ ] **Step 6: 非回帰 UI テストを書く** — `PlannerFlowTests.swift` に 1 本追加。Canned では `suggestPlaces` が nil を返すので Google 区画は出ない＝既存の検索窓が非回帰であることを固定する:
  ```swift
  func testWebSuggestionSectionAbsentUnderCannedWorker() {
    let app = XCUIApplication()
    app.launchArguments += ["-uiTesting"]   // 既存テストが使う起動フラグに合わせる（要確認）
    app.launch()
    let field = app.textFields["start.placeField"]
    XCTAssertTrue(field.waitForExistence(timeout: 10))
    field.tap()
    field.typeText("Tokyo")
    // Canned は nil を返すので Google 区画（Powered by Google 行/セル）は現れない。
    XCTAssertFalse(app.buttons["start.webSuggestion"].waitForExistence(timeout: 2),
                   "Canned worker returns nil suggestions; the web section must not appear")
    // 主 CTA は従来通り生きている（検索窓フロー非回帰）。
    XCTAssertTrue(app.buttons["start.build"].exists)
  }
  ```
  （既存 UI テストの起動フラグ・ヘルパ（`XCUIApplication` の作り方、`-uiTesting` 等）を読み、それに正確に合わせること。`typeText` 前に `field.tap()` でフォーカスを取る。断定は `waitForExistence(timeout: 2)==false` で「出ない」を確かめる。）

- [ ] **Step 7: 検証** — `apple/tools/verify-app.sh test`（app unit + UI 全緑）と `apple/tools/verify-kit.sh`（引数なし、AppCore 全緑）。新規警告ゼロ。

- [ ] **Step 8: 手動 E2E 手順を追記** — `apple/docs/paid-route-check.md` に「Google サジェスト」の節を足す：`.dev.vars` に実 `GOOGLE_PLACES_API_KEY` + bypass、`pnpm dev`、Simulator（`TRIPCHECK_WORKER_BYPASS_TOKEN`）で 3 文字以上打つと下区画に Google 候補＋`Powered by Google` が出て、選ぶと CTA で `google-` 検証停留所になることを確認。鍵を外すと区画は出ず Apple のみ。

- [ ] **Step 9: コミット** — trailer 付き。
