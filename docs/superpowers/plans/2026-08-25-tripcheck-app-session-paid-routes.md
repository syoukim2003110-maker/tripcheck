# app セッションで place-resolution を通す — 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Worker 認証で発行済みの短命 app セッションを使い、iOS から `POST /api/place-resolution` を通して「Google が検証した停留所」を得られるようにする(1 本の縦切り)。

**Architecture:** Worker の paid 認可(`handlePaidApi` の 1 箇所)に「有効な app セッション」の OR 分岐を足し、app 認証リクエストの quota を `keyId` でキーする。iOS は `WorkerClient` に認証付き `resolvePlaces` を足し、`ApplePlaceResolver` の兄弟 `WorkerPlaceResolver` を解決チェーンの先頭に置く(Google 優先・失敗時はローカルへ落ちる)。既存の `ResolutionPipeline`(Kit、不可侵)の rank マージ(`.confirmed` が最終・欠けは次リゾルバへ)にそのまま乗る。

**Tech Stack:** TypeScript(Cloudflare Worker + `node --test`)、Swift 6(iOS、XCTest)。

**Spec:** `docs/superpowers/specs/2026-08-25-tripcheck-app-session-paid-routes-design.md`

## Global Constraints

- web で触ってよいのは `worker/index.ts`(認可 OR + quota キー)と `tests/`(ケース追加)のみ。`lib/` と `app/api/**` のハンドラ本体は不変(`app/api/place-resolution/route.ts` と `lib/google-place-resolver.ts` は読み取り専用)。
- `TripCheckKit`(エンジン。`Sources/TripCheckKit/`)は不可侵。新規の型・リゾルバは `TripCheckAppCore`(`Sources/TripCheckAppCore/`)か app ターゲットに置く。
- iOS は Swift 6 strict concurrency で**新規警告ゼロ**。日本語リテラルは `AppCopy.swift` のみ。絵文字禁止。
- 表示・データとしての利用は可(検証済み座標はルート構築に使う)。ただし TripCheck 自身が Google の真偽を再判定しない。
- paid ゲートでは `verifySession` の `ok:true` で十分とし、keyStore による appId 再検査はしない(bypass セッションもローカルで通す)。
- ローカルのみ。`git push` はしない。
- コミット trailer(全コミット末尾):
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_012DRrRBiU96fLJmvfThaR4J
  ```

## ファイル構成

- **Modify** `worker/index.ts` — `appSessionIsAuthorized` ヘルパー追加、`handlePaidApi` の認可 OR、`quotaIdentity` に `forcedSessionId` を足して app 認証時 `app_<keyId>` でキー(Task 1)。
- **Modify** `tests/worker-durable-quota.test.ts` — 越境+有効/無効セッションのゲート、quota が keyId でキーされることのテスト(Task 1)。
- **Create** `apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Worker/PlaceResolutionModels.swift` — 送信 Encodable と受信 Decodable(Task 2)。
- **Modify** `apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Worker/WorkerAuthState.swift` — `WorkerAuthenticating` に `resolvePlaces` を追加(Task 2)。
- **Modify** `apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Worker/WorkerClient.swift` — `resolvePlaces` + `resolvePlacesOnce`(401 再試行)(Task 2)。
- **Modify** `apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Worker/CannedWorkerClient.swift` — `resolvePlaces` は `nil`(Task 2)。
- **Create** `apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Providers/WorkerPlaceResolver.swift` — `PlaceResolver` 準拠、Google 結果→検証済み `ResolvedStop` 写像、失敗は空辞書(Task 3)。
- **Create** `apple/Packages/TripCheckKit/Tests/TripCheckAppCoreTests/WorkerPlaceResolverTests.swift`(Task 3)、`.../PlaceResolutionModelsTests.swift`(Task 2)。
- **Modify** `apple/TripCheck/App/TripCheckApp.swift` — workerClient を store 構築前に作り、`resolvers` の先頭に `WorkerPlaceResolver(client:)`(Task 4)。
- **Create** `apple/docs/paid-route-check.md` — 手動 E2E 手順書(Task 4)。

参考インターフェース(既存、引用):
- `verifySession(env, token, nowSeconds)` → `Promise<{ok:true;keyId:string;expiresAt:number} | {ok:false;code:"session_invalid"|"session_expired"|"no_signing_secret"}>`(`lib/server/app-attest/app-session.ts:73`)。**async**。
- `APP_SESSION_HEADER = "X-TripCheck-App-Session"`(`lib/server/app-attest/gateway.ts:31`、再エクスポート済み)。
- `issueSession(env, keyId, nowSeconds)` → `Promise<{session:string;expiresAt:number}|null>`(テスト用、`app-session.ts:60`)。
- `PlaceResolver`(Kit): `func resolve(_ queries: [PlaceQuery], destination: DestinationChoice, locale: PlannerLocale) async -> [Int: PlaceResolution]`。
- `PlaceResolution`(Kit): `.confirmed(ResolvedStop)` / `.review([PlaceCandidate])` / `.unresolved(reason: String)`。
- `PlaceQuery`(Kit): `{ inputIndex: Int; input: String; pinnedProviderRef: String? }`。
- `ResolvedStop`(Kit)必須 init 引数: `id, name, area, latitude, longitude, sourceUrl, verifiedAt, confidence, planningDurationMinutes, isAnchor, input, address`。任意: `providerRef, placeTypes, inputIndex, countryCode, provider` ほか。`Confidence`=`.low|.medium`、`ResolvedStopProvider`=`.catalog|.user|.apple|.google`。
- `PlaceCandidate(stop: ResolvedStop, category: String? = nil)`(Kit)。
- `FNV1a.hash32(_ string: String) -> String`(Kit)。
- `PlannerLocale: String` = `ja|en`(`.rawValue`)。`DestinationChoice.rawValue`("auto" ほか)。
- `WorkerAuthenticating`(AppCore): `describe() async -> WorkerClientDescription` / `ensureSession() async -> WorkerAuthState` / `ping() async -> WorkerPingResult`。
- `WorkerRequest(path:method:body:sessionToken:)`、`WorkerResponse{status:Int, body:Data}`、`transport.send(_:baseURL:) async throws -> WorkerResponse`。ヘッダ付与は transport が `sessionToken` を `X-TripCheck-App-Session` に載せる。
- テスト用 fake: `FakeTransport{ handler }`、`FakeAttestor`、`InMemoryAttestKeyStore`(`Tests/.../Support/Fakes.swift`)。

---

### Task 1: Worker — app セッションの OR ゲート + keyId quota

**Files:**
- Modify: `worker/index.ts`(import 追加、`appSessionIsAuthorized` 追加、`handlePaidApi` の認可判定と `quotaIdentity` 呼び出し、`quotaIdentity` 定義)
- Test: `tests/worker-durable-quota.test.ts`

**Interfaces:**
- Consumes: `verifySession`, `APP_SESSION_HEADER`(app-attest)、`issueSession`(テスト)。
- Produces: 越境オリジンでも `X-TripCheck-App-Session` が有効なら paid ゲートを通る。quota は `app_<keyId>`。

- [ ] **Step 1: 失敗するテストを書く**（`tests/worker-durable-quota.test.ts` の末尾に追記）

ファイル冒頭の import 群に追加:
```ts
import { issueSession } from "../lib/server/app-attest/app-session.ts";
```
末尾にテストを追加:
```ts
test("a cross-origin paid request with a valid app session passes the auth gate", async () => {
  const db = new WorkerTestD1();
  const env = environment(db);
  const issued = await issueSession(env, "unit-test-key", Math.floor(Date.now() / 1000));
  assert.ok(issued, "issueSession must mint a token with the test signing secret");
  const request = paidPost("/api/place-resolution",
    { queries: ["Tokyo Tower"], languageCode: "en", destination: "auto" },
    { Origin: "https://native.app", "Sec-Fetch-Site": "cross-site", "X-TripCheck-App-Session": issued!.session });
  const response = await worker.fetch(request, env, context);
  assert.notEqual(response.status, 403, "a valid app session must not be forbidden cross-origin");
});

test("a cross-origin paid request with an invalid app session is forbidden", async () => {
  const db = new WorkerTestD1();
  const request = paidPost("/api/place-resolution",
    { queries: ["x"], languageCode: "en", destination: "auto" },
    { Origin: "https://native.app", "Sec-Fetch-Site": "cross-site", "X-TripCheck-App-Session": "v1.badkey.1.2.deadbeef" });
  const response = await worker.fetch(request, environment(new WorkerTestD1()), context);
  assert.equal(response.status, 403);
});

test("an app-authed paid request is charged to its key, not a cookie session", async () => {
  const db = new WorkerTestD1();
  const env = environment(db);
  let seenSession: string | null = null;
  testGlobal.__tripCheckAppFetch = async (req) => {
    seenSession = (req as Request).headers.get("X-TripCheck-Session");
    return Response.json({ ok: true });
  };
  const issued = await issueSession(env, "charge-key", Math.floor(Date.now() / 1000));
  const request = paidPost("/api/place-resolution",
    { queries: ["x"], languageCode: "en", destination: "auto" },
    { Origin: "https://native.app", "Sec-Fetch-Site": "cross-site", "X-TripCheck-App-Session": issued!.session });
  await worker.fetch(request, env, context);
  assert.equal(seenSession, "app_charge-key");
});
```

- [ ] **Step 2: 失敗を確認**

Run: `node --experimental-strip-types --test tests/worker-durable-quota.test.ts`
Expected: 新規 3 件が FAIL(現状は越境で 403、`seenSession` は cookie 由来のランダム UUID)。

- [ ] **Step 3: `appSessionIsAuthorized` を実装**

`worker/index.ts` の import に追加(既存の app-attest からの import の隣):
```ts
import { verifySession } from "../lib/server/app-attest/app-session.ts";
import { APP_SESSION_HEADER } from "../lib/server/app-attest/gateway.ts";
```
（既存の `isAppGatewayPath` / `handleAppGateway` の import 行がある場合は同じ書式に合わせる。`APP_SESSION_HEADER` が gateway.ts から再エクスポートされている前提。）

`paidRequestIsSameOrigin` 関数の直後に追加:
```ts
type AppSessionVerdict = { ok: true; keyId: string } | { ok: false; code?: "no_signing_secret" };

/**
 * The second gate. A native client sends no browser Origin, so it proves itself
 * with the short-lived session this Worker minted after App Attest (or the
 * dev-only bypass). A valid signature is sufficient here: the session was only
 * issued after the app-id allowlist was checked at attest/assert time.
 */
async function appSessionIsAuthorized(request: Request, env: Env, nowSeconds: number): Promise<AppSessionVerdict> {
  if (env.TRIPCHECK_APP_API_DISABLED?.trim()) return { ok: false };
  const token = request.headers.get(APP_SESSION_HEADER);
  if (!token || token.length > 512) return { ok: false };
  const verdict = await verifySession(env, token, nowSeconds);
  if (verdict.ok) return { ok: true, keyId: verdict.keyId };
  if (verdict.code === "no_signing_secret") return { ok: false, code: "no_signing_secret" };
  return { ok: false };
}
```
（`Env` 型に `TRIPCHECK_APP_API_DISABLED?: string` が無ければ、既存の Env 型定義に 1 行足す。`verifySession` に渡す `env` は `SigningEnvironment` 互換で、既存の Env はそれを満たす。）

- [ ] **Step 4: `quotaIdentity` に forcedSessionId を追加**

`worker/index.ts` の `quotaIdentity` シグネチャを変更:
```ts
function quotaIdentity(request: Request, forcedSessionId?: string | null) {
  const existingSession = forcedSessionId ?? boundedOpaqueId(cookieValue(request, SESSION_COOKIE));
  const sessionId = existingSession ?? globalThis.crypto.randomUUID().replaceAll("-", "");
  const suppliedTrip = boundedOpaqueId(request.headers.get("X-TripCheck-Trip"));
  const tripScope = suppliedTrip ?? `time_bucket_${Math.floor(Date.now() / (4 * 60 * 60 * 1000))}`;
  const tripId = `${sessionId.slice(0, 16)}_${tripScope}`.slice(0, 128);
  if (existingSession) return { sessionId, tripId, setCookie: null };
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return {
    sessionId,
    tripId,
    setCookie: `${SESSION_COOKIE}=${sessionId}; Path=/; Max-Age=86400; HttpOnly; SameSite=Lax${secure}`,
  };
}
```
（`forcedSessionId` を渡すと `existingSession` が truthy になり、cookie を発行せず `setCookie:null` を返す — app リクエストに Set-Cookie を返さない、が自然に満たされる。）

- [ ] **Step 5: `handlePaidApi` の認可判定を差し替え**

`worker/index.ts` の `handlePaidApi` 冒頭の `const authorized = …` ブロックを置き換え:
```ts
  const nowSeconds = Math.floor(Date.now() / 1000);
  const appVerdict: AppSessionVerdict = route.origin === "signed_resource"
    ? { ok: false }
    : await appSessionIsAuthorized(request, env, nowSeconds);
  const authorized = route.origin === "signed_resource"
    ? await signedResourceIsAuthorized(request, url, env)
    : (paidRequestIsSameOrigin(request, env) || appVerdict.ok);
  if (!authorized) {
    const noSecret = appVerdict.ok === false && appVerdict.code === "no_signing_secret";
    return secureResponse(edgeJson(noSecret ? "no_signing_secret" : "forbidden", noSecret ? 503 : 403), url);
  }
```
同関数内の `identity = quotaIdentity(request);` を置き換え:
```ts
    identity = quotaIdentity(request, appVerdict.ok ? `app_${appVerdict.keyId}`.slice(0, 128) : null);
```

- [ ] **Step 6: テストが通ることを確認**

Run: `node --experimental-strip-types --test tests/worker-durable-quota.test.ts`
Expected: 全 PASS(新規 3 件含む)。

- [ ] **Step 7: 回帰確認(既存 web テスト)**

Run: `node --experimental-strip-types --test tests/api-route-policy-exhaustive.test.ts tests/app-attest-session.test.ts tests/app-attest-gateway.test.ts`
Expected: 全 PASS(ルート分類・セッション検証は不変)。

- [ ] **Step 8: コミット**

```bash
git add worker/index.ts tests/worker-durable-quota.test.ts
git commit -m "A paid route opens for a valid app session, charged to its key"
```

---

### Task 2: iOS — place-resolution の型と `WorkerClient.resolvePlaces`

**Files:**
- Create: `apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Worker/PlaceResolutionModels.swift`
- Modify: `apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Worker/WorkerAuthState.swift`(protocol)
- Modify: `apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Worker/WorkerClient.swift`
- Modify: `apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Worker/CannedWorkerClient.swift`
- Test: `apple/Packages/TripCheckKit/Tests/TripCheckAppCoreTests/PlaceResolutionModelsTests.swift`

**Interfaces:**
- Consumes: `WorkerRequest`, `WorkerResponse`, `transport.send`, `ensureSession`, `authenticate(allowKeyReset:)`, `sessionToken`, `state`。
- Produces: `PlaceResolutionRequestPayload`（Encodable）、`PlaceResolutionResult`/`WorkerResolvedStop`/`WorkerAmbiguousResolution`（Decodable）、`resolvePlaces(_:) async -> PlaceResolutionResult?`。

- [ ] **Step 1: 型を作る**（`PlaceResolutionModels.swift` を新規作成）

```swift
import Foundation

/// web `POST /api/place-resolution` へ送るペイロード。MVP は queries と言語・行き先のみ。
public struct PlaceResolutionRequestPayload: Encodable, Sendable {
  public let queries: [String]
  public let languageCode: String   // "ja" | "en"
  public let destination: String    // "auto" or a pinned destination id
  public init(queries: [String], languageCode: String, destination: String) {
    self.queries = queries
    self.languageCode = languageCode
    self.destination = destination
  }
}

/// web `ResolvedInputStop` の写し。使わない付随フィールド(openingHoursApplicable 等)は
/// デコードで無視される。confidence は文字列で受けて後段で Confidence に写す(境界で緩く)。
public struct WorkerResolvedStop: Decodable, Sendable {
  public let id: String
  public let providerRef: String?
  public let name: String
  public let area: String
  public let latitude: Double
  public let longitude: Double
  public let sourceUrl: String
  public let verifiedAt: String
  public let confidence: String
  public let planningDurationMinutes: Int
  public let isAnchor: Bool
  public let placeTypes: [String]?
  public let address: String
  public let countryCode: String?
  public let input: String
  public let inputIndex: Int?
}

public struct WorkerAmbiguousResolution: Decodable, Sendable {
  public let input: String
  public let candidates: [WorkerResolvedStop]
}

public struct PlaceResolutionResult: Decodable, Sendable {
  public let provider: String
  public let fetchedAt: String
  public let places: [WorkerResolvedStop]
  public let hotel: WorkerResolvedStop?
  public let ambiguous: [WorkerAmbiguousResolution]
}
```

- [ ] **Step 2: デコードの失敗テストを書く**（`PlaceResolutionModelsTests.swift` を新規作成）

```swift
import XCTest
@testable import TripCheckAppCore

final class PlaceResolutionModelsTests: XCTestCase {
  func testDecodesAGooglePlaceResolutionResponse() throws {
    let json = #"""
    {"provider":"google_maps","fetchedAt":"2026-08-25T00:00:00Z",
     "places":[{"id":"g1","providerRef":"ChIJ_123","name":"Tokyo Tower","area":"Minato",
       "latitude":35.6586,"longitude":139.7454,"sourceUrl":"https://maps.google/x",
       "verifiedAt":"2026-08-25T00:00:00Z","confidence":"medium","planningDurationMinutes":60,
       "isAnchor":true,"placeTypes":["tourist_attraction"],"address":"4-2-8 Shibakoen",
       "countryCode":"JP","input":"Tokyo Tower","inputIndex":0}],
     "hotel":null,"ambiguous":[]}
    """#
    let result = try JSONDecoder().decode(PlaceResolutionResult.self, from: Data(json.utf8))
    XCTAssertEqual(result.places.count, 1)
    XCTAssertEqual(result.places[0].providerRef, "ChIJ_123")
    XCTAssertEqual(result.places[0].confidence, "medium")
    XCTAssertNil(result.hotel)
  }
}
```

- [ ] **Step 3: 失敗を確認**

Run: `cd apple && ~/.local/xcodegen/bin/xcodegen generate >/dev/null && xcodebuild -scheme TripCheckKit -destination 'platform=iOS Simulator,name=iPhone 17 Pro' test -only-testing:TripCheckAppCoreTests/PlaceResolutionModelsTests 2>&1 | tail -5`
Expected: コンパイルエラーか FAIL（型未定義）。実装後に緑化。
（プロジェクトの標準は `apple/tools/verify-kit.sh test`。以下このコマンドで代替可。）

- [ ] **Step 4: プロトコルにメソッドを足す**（`WorkerAuthState.swift` の `WorkerAuthenticating`)

```swift
public protocol WorkerAuthenticating: Sendable {
  func describe() async -> WorkerClientDescription
  /// 有効なセッションを確かめる(無ければ attest / assert で取り直す)。
  func ensureSession() async -> WorkerAuthState
  func ping() async -> WorkerPingResult
  /// 検証済みの場所解決。失敗・未認証・到達不能はすべて nil(=呼び出し側はローカルへ代替)。
  func resolvePlaces(_ payload: PlaceResolutionRequestPayload) async -> PlaceResolutionResult?
}
```

- [ ] **Step 5: `WorkerClient` に実装**（`WorkerClient.swift`。`pingOnce` の近くに追加）

```swift
  public func resolvePlaces(_ payload: PlaceResolutionRequestPayload) async -> PlaceResolutionResult? {
    let auth = await ensureSession()
    guard case .authenticated = auth, let token = sessionToken else { return nil }
    guard let body = try? JSONEncoder().encode(payload) else { return nil }
    switch await resolvePlacesOnce(token: token, body: body) {
    case .resolved(let result): return result
    case .failed: return nil
    case .unauthorized:
      // 401 のときは 1 度だけ取り直して再送。
      sessionToken = nil
      state = .idle
      let reauth = await authenticate(allowKeyReset: true)
      guard case .authenticated = reauth, let fresh = sessionToken else { return nil }
      if case .resolved(let result) = await resolvePlacesOnce(token: fresh, body: body) { return result }
      return nil
    }
  }

  private enum ResolveOnce {
    case resolved(PlaceResolutionResult)
    case unauthorized
    case failed
  }

  /// 200→結果、401→取り直しの合図、その他/例外→failed(ローカル代替)。
  private func resolvePlacesOnce(token: String, body: Data) async -> ResolveOnce {
    do {
      let response = try await transport.send(
        WorkerRequest(path: "/api/place-resolution", method: "POST", body: body, sessionToken: token),
        baseURL: baseURL
      )
      if response.status == 200 {
        guard let decoded = try? JSONDecoder().decode(PlaceResolutionResult.self, from: response.body) else { return .failed }
        return .resolved(decoded)
      }
      if response.status == 401 { return .unauthorized }
      return .failed
    } catch {
      return .failed
    }
  }
```

- [ ] **Step 6: `CannedWorkerClient` に実装**（`CannedWorkerClient.swift`)

```swift
  public func resolvePlaces(_ payload: PlaceResolutionRequestPayload) async -> PlaceResolutionResult? { nil }
```
（UI テストはローカル解決のまま — Canned は解決を返さないので既存挙動を保つ。)

- [ ] **Step 7: `WorkerClient` の 401 再試行テストを追加**（`WorkerClientTests.swift` の `FakeGateway.respond` に place-resolution を足し、テストを追加)

`FakeGateway` に状態とケースを追加:
```swift
  var resolveUnauthorizedOnce = false
  private var sawResolve401 = false
```
`respond(to:)` の `switch` に追加:
```swift
    case "/api/place-resolution":
      if resolveUnauthorizedOnce, !sawResolve401 {
        sawResolve401 = true
        return json(#"{"code":"session_expired"}"#, 401)
      }
      return json(#"{"provider":"google_maps","fetchedAt":"t","places":[],"hotel":null,"ambiguous":[]}"#, 200)
```
`configure` にも引数を増設:
```swift
  func configure(unknownKeyOnce: Bool = false, pingUnauthorizedOnce: Bool = false, resolveUnauthorizedOnce: Bool = false) {
    self.unknownKeyOnce = unknownKeyOnce
    self.pingUnauthorizedOnce = pingUnauthorizedOnce
    self.resolveUnauthorizedOnce = resolveUnauthorizedOnce
  }
```
テスト追加:
```swift
  func testResolvePlacesRetriesOnceOn401() async {
    let gateway = FakeGateway()
    await gateway.configure(resolveUnauthorizedOnce: true)
    let (client, _) = makeClient(gateway: gateway)
    let payload = PlaceResolutionRequestPayload(queries: ["x"], languageCode: "en", destination: "auto")
    let result = await client.resolvePlaces(payload)
    XCTAssertNotNil(result, "a 401 must be retried once and then succeed")
    XCTAssertEqual(result?.provider, "google_maps")
  }
```

- [ ] **Step 8: 緑を確認**

Run: `apple/tools/verify-kit.sh test`
Expected: `** TEST SUCCEEDED **`、新規警告ゼロ。

- [ ] **Step 9: コミット**

```bash
git add apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Worker/ apple/Packages/TripCheckKit/Tests/TripCheckAppCoreTests/PlaceResolutionModelsTests.swift apple/Packages/TripCheckKit/Tests/TripCheckAppCoreTests/WorkerClientTests.swift
git commit -m "The app can ask the Worker to resolve places, retrying once when the session lapses"
```

---

### Task 3: iOS — `WorkerPlaceResolver`(Google 優先・ローカル代替)

**Files:**
- Create: `apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Providers/WorkerPlaceResolver.swift`
- Test: `apple/Packages/TripCheckKit/Tests/TripCheckAppCoreTests/WorkerPlaceResolverTests.swift`

**Interfaces:**
- Consumes: `any WorkerAuthenticating`（`resolvePlaces`）、`PlaceResolver`/`PlaceQuery`/`PlaceResolution`/`ResolvedStop`/`PlaceCandidate`/`Confidence`/`FNV1a`（Kit）。
- Produces: `WorkerPlaceResolver(client:)` が `PlaceResolver` に準拠。成功→`.confirmed`(google- 検証済み)/`.review`、失敗→空辞書(次リゾルバへ)。

- [ ] **Step 1: 失敗テストを書く**（`WorkerPlaceResolverTests.swift` を新規作成）

```swift
import XCTest
import TripCheckKit
@testable import TripCheckAppCore

private struct StubWorker: WorkerAuthenticating {
  let result: PlaceResolutionResult?
  func describe() async -> WorkerClientDescription { .init(baseURL: "stub", attestSupported: true, state: .idle) }
  func ensureSession() async -> WorkerAuthState { .idle }
  func ping() async -> WorkerPingResult { .init(ok: false, expiresAt: nil) }
  func resolvePlaces(_ payload: PlaceResolutionRequestPayload) async -> PlaceResolutionResult? { result }
}

private func rawStop(input: String, name: String) -> WorkerResolvedStop {
  WorkerResolvedStop(id: "g", providerRef: "ChIJ_x", name: name, area: "Minato",
    latitude: 35.6586, longitude: 139.7454, sourceUrl: "https://maps.google/x",
    verifiedAt: "2026-08-25T00:00:00Z", confidence: "medium", planningDurationMinutes: 60,
    isAnchor: true, placeTypes: ["tourist_attraction"], address: "addr", countryCode: "JP",
    input: input, inputIndex: 0)
}

final class WorkerPlaceResolverTests: XCTestCase {
  func testGoogleResultBecomesConfirmedVerifiedStop() async {
    let result = PlaceResolutionResult(provider: "google_maps", fetchedAt: "t",
      places: [rawStop(input: "Tokyo Tower", name: "Tokyo Tower")], hotel: nil, ambiguous: [])
    let resolver = WorkerPlaceResolver(client: StubWorker(result: result))
    let answers = await resolver.resolve([PlaceQuery(inputIndex: 0, input: "Tokyo Tower")], destination: .auto, locale: .ja)
    guard case .confirmed(let stop) = answers[0] else { return XCTFail("expected .confirmed") }
    XCTAssertTrue(stop.id.hasPrefix("google-"))
    XCTAssertEqual(stop.provider, .google)
    XCTAssertEqual(stop.providerRef, "ChIJ_x")
    XCTAssertFalse(stop.sourceUrl.isEmpty)
    XCTAssertFalse(stop.verifiedAt.isEmpty)
    XCTAssertEqual(stop.inputIndex, 0)
  }

  func testAmbiguousBecomesReview() async {
    let result = PlaceResolutionResult(provider: "google_maps", fetchedAt: "t", places: [],
      hotel: nil, ambiguous: [WorkerAmbiguousResolution(input: "Bahnhof",
        candidates: [rawStop(input: "Bahnhof", name: "Bern"), rawStop(input: "Bahnhof", name: "Zürich")])])
    let resolver = WorkerPlaceResolver(client: StubWorker(result: result))
    let answers = await resolver.resolve([PlaceQuery(inputIndex: 0, input: "Bahnhof")], destination: .auto, locale: .en)
    guard case .review(let candidates) = answers[0] else { return XCTFail("expected .review") }
    XCTAssertEqual(candidates.count, 2)
  }

  func testNilResultYieldsNoEntriesSoTheChainFallsThrough() async {
    let resolver = WorkerPlaceResolver(client: StubWorker(result: nil))
    let answers = await resolver.resolve([PlaceQuery(inputIndex: 0, input: "x")], destination: .auto, locale: .ja)
    XCTAssertTrue(answers.isEmpty)
  }
}
```

- [ ] **Step 2: 失敗を確認**

Run: `apple/tools/verify-kit.sh test` （または Step 3 の後まとめて）
Expected: `WorkerPlaceResolver` 未定義でコンパイル失敗。

- [ ] **Step 3: 実装**（`WorkerPlaceResolver.swift` を新規作成）

```swift
import Foundation
import TripCheckKit

/// 解決チェーンの先頭に立つ Google 優先リゾルバ。Worker が検証した場所を `google-` 接頭辞・
/// `provider:.google`・非空の `sourceUrl`/`verifiedAt` を持つ **検証済み** 停留所に写す。
/// 未認証・オフライン・失敗・タイムアウトは空辞書を返し、`ResolutionPipeline` が次の
/// リゾルバ(Apple → Catalog)に委ねる — オンデバイス解決が下限なので壊れない。
public struct WorkerPlaceResolver: PlaceResolver {
  private let client: any WorkerAuthenticating
  public init(client: any WorkerAuthenticating) { self.client = client }

  public func resolve(_ queries: [PlaceQuery], destination: DestinationChoice, locale: PlannerLocale) async -> [Int: PlaceResolution] {
    guard !queries.isEmpty else { return [:] }
    let payload = PlaceResolutionRequestPayload(
      queries: queries.map(\.input),
      languageCode: locale.rawValue,
      destination: destination.rawValue
    )
    guard let result = await client.resolvePlaces(payload) else { return [:] }

    var out: [Int: PlaceResolution] = [:]
    for place in result.places {
      for query in queries where query.input == place.input {
        out[query.inputIndex] = .confirmed(mapStop(place, query: query))
      }
    }
    for group in result.ambiguous {
      for query in queries where query.input == group.input && out[query.inputIndex] == nil {
        out[query.inputIndex] = .review(group.candidates.map { PlaceCandidate(stop: mapStop($0, query: query)) })
      }
    }
    return out
  }

  /// web の `ResolvedInputStop` を iOS の検証済み `ResolvedStop` に写す。id は Apple と同じ
  /// 決定的スキームだが `google-` 接頭辞(Kit ではこれが「検証済み」を意味する)。
  private func mapStop(_ raw: WorkerResolvedStop, query: PlaceQuery) -> ResolvedStop {
    ResolvedStop(
      id: "google-\(query.inputIndex)-\(FNV1a.hash32("\(raw.name)|\(raw.latitude)|\(raw.longitude)"))",
      providerRef: raw.providerRef,
      name: raw.name,
      area: raw.area,
      latitude: raw.latitude,
      longitude: raw.longitude,
      sourceUrl: raw.sourceUrl,
      verifiedAt: raw.verifiedAt,
      confidence: Confidence(rawValue: raw.confidence) ?? .medium,
      planningDurationMinutes: raw.planningDurationMinutes,
      isAnchor: raw.isAnchor,
      placeTypes: raw.placeTypes,
      input: query.input,
      inputIndex: query.inputIndex,
      address: raw.address,
      countryCode: raw.countryCode,
      provider: .google
    )
  }
}
```

- [ ] **Step 4: 緑を確認**

Run: `apple/tools/verify-kit.sh test`
Expected: `** TEST SUCCEEDED **`、新規警告ゼロ。

- [ ] **Step 5: コミット**

```bash
git add apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Providers/WorkerPlaceResolver.swift apple/Packages/TripCheckKit/Tests/TripCheckAppCoreTests/WorkerPlaceResolverTests.swift
git commit -m "A Google-verified place wins the chain; its absence falls back to on-device"
```

---

### Task 4: iOS 合成ルートへの配線 + E2E 手順書

**Files:**
- Modify: `apple/TripCheck/App/TripCheckApp.swift`
- Create: `apple/docs/paid-route-check.md`

**Interfaces:**
- Consumes: `WorkerPlaceResolver(client:)`、`WorkerAvailability.makeDefaultClient`。
- Produces: 本番合成で `resolvers` の先頭に `WorkerPlaceResolver`。

- [ ] **Step 1: workerClient を store 構築前に作り、resolvers 先頭に挿す**

`TripCheckApp.swift` の init 内で、現在 `_store = State(initialValue: PlannerStore(...))`(51-67 付近)の**前**に workerClient 構築(現状 69-79 にあるブロック)を移動する。移動後の順序:

```swift
    let isWorkerDiagnostics = ProcessInfo.processInfo.arguments.contains("-workerDiagnostics")
    self.isWorkerDiagnostics = isWorkerDiagnostics
    let baseURLString = ProcessInfo.processInfo.environment["TRIPCHECK_WORKER_BASE_URL"]
      ?? (Bundle.main.object(forInfoDictionaryKey: "TripCheckWorkerBaseURL") as? String)
      ?? "http://127.0.0.1:3000"
    let baseURL = URL(string: baseURLString) ?? URL(string: "http://127.0.0.1:3000")!
    let workerClient = WorkerAvailability.makeDefaultClient(
      uiTesting: isUITesting,
      baseURL: baseURL,
      bypassToken: ProcessInfo.processInfo.environment["TRIPCHECK_WORKER_BYPASS_TOKEN"]
    )
    self.workerClient = workerClient

    _store = State(initialValue: PlannerStore(
      resolvers: [WorkerPlaceResolver(client: workerClient), ApplePlaceResolver(), CatalogResolver()],
      store: TripStore(directory: directory),
      storageDirectory: directory,
      defaults: defaults,
      initialLocale: PlannerStore.systemLocale,
      routeProvider: isUITesting ? CannedRouteProvider() as any RouteProvider : AppleRouteProvider(),
      intentParser: IntentAvailability.makeDefaultParser(uiTesting: isUITesting),
      weatherProvider: WeatherAvailability.makeDefaultProvider(uiTesting: isUITesting)
    ))
```
（`self.workerClient` は `let workerClient` に一度受けてから代入する — `WorkerPlaceResolver` と `WorkerDiagnosticsScreen` の両方が同じインスタンスを使う。診断画面の `WorkerDiagnosticsScreen(client: workerClient)` は不変。UI テスト時は Canned が入り `resolvePlaces` が nil を返すので、既存 UI テストのローカル解決挙動は保たれる。）

- [ ] **Step 2: アプリがビルドでき、既存テストが緑であることを確認**

Run: `apple/tools/verify-app.sh test`
Expected: `** TEST SUCCEEDED **`（既存 unit + UI テスト全緑、新規警告ゼロ）。

- [ ] **Step 3: E2E 手順書を書く**（`apple/docs/paid-route-check.md` を新規作成）

内容(実 Google を叩く唯一の確認。自動テストは全て hermetic):
```markdown
# paid ルート(place-resolution)実地チェック

Simulator でも bypass セッションで通せる。実 Google キーが要る。

## 1. Worker をローカル起動
`.dev.vars` に置く:

    GOOGLE_PLACES_API_KEY=<本物のキー>
    TRIPCHECK_APP_ATTEST_BYPASS_TOKEN=<任意の開発用トークン>
    TRIPCHECK_QUOTA_HASH_SECRET=<32 文字以上>

起動: `pnpm dev`(Worker が 127.0.0.1:3000)。

## 2. Simulator を bypass で走らせる
環境変数 `TRIPCHECK_WORKER_BYPASS_TOKEN` を .dev.vars と同じ値にして起動:

    TRIPCHECK_WORKER_BYPASS_TOKEN=<同じトークン> でアプリを実行

## 3. 確認
地名(例「Tokyo Tower」)を入力して解決させる。停留所が **Google 検証済み**
(内部 id が `google-` 始まり、`sourceUrl`/`verifiedAt` が非空、`provider = .google`)
になっていること。Worker を止める / トークンを外すと、同じ入力が Apple(未検証、
`apple-` id)にフォールバックすること。

## 4. 実機
実機は bypass 不要 — 実 App Attest でセッションが出る(`worker-auth-device-checklist.md`
の手順で attest 済みなら、そのまま place-resolution も通る)。
```

- [ ] **Step 4: コミット**

```bash
git add apple/TripCheck/App/TripCheckApp.swift apple/docs/paid-route-check.md
git commit -m "The trip planner asks Google first, and a checklist proves it on a device"
```

---

## Self-Review

- **Spec coverage:** §4.1 OR ゲート→Task 1。§4.2 quota keyId→Task 1。§4.3 resolvePlaces+型→Task 2。§4.4 WorkerPlaceResolver+配線→Task 3+4。§4.5 写像・ambiguous→Task 3。§6 テスト→各タスクのテスト + Task 4 手順書。全節にタスクが対応。
- **Placeholder scan:** 各コード片は実物。TBD/TODO 無し。
- **Type consistency:** `PlaceResolutionRequestPayload`/`PlaceResolutionResult`/`WorkerResolvedStop` は Task 2 で定義し Task 3 で消費、フィールド名一致。`resolvePlaces(_:) async -> PlaceResolutionResult?` は protocol/WorkerClient/CannedWorkerClient/StubWorker で同一シグネチャ。`appVerdict`/`AppSessionVerdict` は Task 1 内で一貫。
- **Kit 不可侵の確認:** `ResolutionPipeline` の rank マージに乗るだけで Kit は変更しない。新規 Swift は AppCore/app のみ。
