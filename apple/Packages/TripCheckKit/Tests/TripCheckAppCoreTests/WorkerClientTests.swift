import XCTest
import Foundation
@testable import TripCheckAppCore

/// テスト内で Worker の応答を組み立てる小さなゲートウェイ。challenge → session を返し、
/// 特定シナリオ(unknown_key を 1 回・ping 401 を 1 回)をスクリプトできる。
private actor FakeGateway {
  var unknownKeyOnce = false
  var pingUnauthorizedOnce = false
  var resolveUnauthorizedOnce = false
  var suggestUnauthorizedOnce = false
  var lastAttestKeyId: String?
  private var sawUnknownKey = false
  private var sawPing401 = false
  private var sawResolve401 = false
  private var sawSuggest401 = false

  func configure(unknownKeyOnce: Bool = false, pingUnauthorizedOnce: Bool = false, resolveUnauthorizedOnce: Bool = false, suggestUnauthorizedOnce: Bool = false) {
    self.unknownKeyOnce = unknownKeyOnce
    self.pingUnauthorizedOnce = pingUnauthorizedOnce
    self.resolveUnauthorizedOnce = resolveUnauthorizedOnce
    self.suggestUnauthorizedOnce = suggestUnauthorizedOnce
  }

  func respond(to request: WorkerRequest) -> WorkerResponse {
    func json(_ text: String, _ status: Int) -> WorkerResponse {
      WorkerResponse(status: status, body: Data(text.utf8))
    }
    switch request.path {
    case "/api/app/challenge":
      return json(#"{"challenge":"v1.100.0000000000000000000000000000abcd.sig"}"#, 200)
    case "/api/app/attest":
      return json(#"{"session":"session-attest","expiresAt":4102444800}"#, 200)
    case "/api/app/assert":
      if unknownKeyOnce, !sawUnknownKey {
        sawUnknownKey = true
        return json(#"{"code":"unknown_key"}"#, 401)
      }
      return json(#"{"session":"session-assert","expiresAt":4102444800}"#, 200)
    case "/api/app/ping":
      if pingUnauthorizedOnce, !sawPing401 {
        sawPing401 = true
        return json(#"{"code":"session_expired"}"#, 401)
      }
      return json(#"{"ok":true,"expiresAt":4102444800}"#, 200)
    case "/api/place-resolution":
      if resolveUnauthorizedOnce, !sawResolve401 {
        sawResolve401 = true
        return json(#"{"code":"session_expired"}"#, 401)
      }
      return json(#"{"provider":"google_maps","fetchedAt":"t","places":[],"hotel":null,"ambiguous":[]}"#, 200)
    case "/api/place-suggestions":
      if suggestUnauthorizedOnce, !sawSuggest401 {
        sawSuggest401 = true
        return json(#"{"code":"session_expired"}"#, 401)
      }
      return json(#"{"provider":"google_maps","suggestions":[{"providerRef":"abc","primaryText":"Tokyo Tower","secondaryText":"Minato","fullText":"Tokyo Tower, Minato"}]}"#, 200)
    default:
      return json(#"{"code":"not_found"}"#, 404)
    }
  }
}

final class WorkerClientTests: XCTestCase {
  private let baseURL = URL(string: "https://worker.example")!

  private func makeClient(
    attestor: FakeAttestor = FakeAttestor(),
    keyStore: InMemoryAttestKeyStore = InMemoryAttestKeyStore(),
    bypassToken: String? = nil,
    gateway: FakeGateway = FakeGateway()
  ) -> (WorkerClient, InMemoryAttestKeyStore) {
    let transport = FakeTransport { request in await gateway.respond(to: request) }
    let client = WorkerClient(baseURL: baseURL, attestor: attestor, transport: transport, keyStore: keyStore, bypassToken: bypassToken)
    return (client, keyStore)
  }

  func testFreshDeviceAttestsAndAuthenticates() async {
    let (client, keyStore) = makeClient()
    let state = await client.ensureSession()
    guard case .authenticated = state else { return XCTFail("expected authenticated, got \(state)") }
    XCTAssertEqual(keyStore.storedKeyId, "fake-key-id")
  }

  func testReturningDeviceAssertsWithStoredKey() async {
    let keyStore = InMemoryAttestKeyStore(keyId: "existing-key")
    let (client, _) = makeClient(keyStore: keyStore)
    let state = await client.ensureSession()
    guard case .authenticated = state else { return XCTFail("expected authenticated, got \(state)") }
    XCTAssertEqual(keyStore.storedKeyId, "existing-key", "returning device must assert with its stored key, not re-attest a fresh one")
  }

  func testUnknownKeyResetsAndReattests() async {
    let gateway = FakeGateway()
    await gateway.configure(unknownKeyOnce: true)
    let keyStore = InMemoryAttestKeyStore(keyId: "stale-key")
    let (client, _) = makeClient(keyStore: keyStore, gateway: gateway)
    let state = await client.ensureSession()
    guard case .authenticated = state else { return XCTFail("expected authenticated, got \(state)") }
    XCTAssertEqual(keyStore.storedKeyId, "fake-key-id", "stale key replaced by a fresh attest")
  }

  func testInvalidKeySelfHeals() async {
    let attestor = FakeAttestor(assertInvalidates: true)
    let keyStore = InMemoryAttestKeyStore(keyId: "invalid-key")
    let (client, _) = makeClient(attestor: attestor, keyStore: keyStore)
    let state = await client.ensureSession()
    guard case .authenticated = state else { return XCTFail("expected authenticated, got \(state)") }
    XCTAssertEqual(keyStore.storedKeyId, "fake-key-id")
  }

  func testUnsupportedWithoutBypassFails() async {
    let (client, _) = makeClient(attestor: FakeAttestor(supported: false))
    let state = await client.ensureSession()
    XCTAssertEqual(state, .failed(.attestUnsupported))
  }

  func testBypassAuthenticatesWhenAttestUnsupported() async {
    let (client, _) = makeClient(attestor: FakeAttestor(supported: false), bypassToken: "local-token")
    let state = await client.ensureSession()
    guard case .authenticated = state else { return XCTFail("expected authenticated, got \(state)") }
  }

  func testOfflineFailsAsNetwork() async {
    let transport = FakeTransport { _ in throw URLError(.notConnectedToInternet) }
    let client = WorkerClient(baseURL: baseURL, attestor: FakeAttestor(), transport: transport, keyStore: InMemoryAttestKeyStore())
    let state = await client.ensureSession()
    XCTAssertEqual(state, .failed(.network))
  }

  func testPingSucceedsAfterAuth() async {
    let (client, _) = makeClient()
    let result = await client.ping()
    XCTAssertTrue(result.ok)
  }

  func testPingReauthenticatesOnUnauthorized() async {
    let gateway = FakeGateway()
    await gateway.configure(pingUnauthorizedOnce: true)
    let (client, _) = makeClient(gateway: gateway)
    let result = await client.ping()
    XCTAssertTrue(result.ok, "a 401 ping should drop the token, re-auth, and succeed")
  }

  func testResolvePlacesRetriesOnceOn401() async {
    let gateway = FakeGateway()
    await gateway.configure(resolveUnauthorizedOnce: true)
    let (client, _) = makeClient(gateway: gateway)
    let payload = PlaceResolutionRequestPayload(queries: ["x"], languageCode: "en", destination: "auto")
    let result = await client.resolvePlaces(payload)
    XCTAssertNotNil(result, "a 401 must be retried once and then succeed")
    XCTAssertEqual(result?.provider, "google_maps")
  }

  func testSuggestPlacesRetriesOnceOn401() async {
    let gateway = FakeGateway()
    await gateway.configure(suggestUnauthorizedOnce: true)
    let (client, _) = makeClient(gateway: gateway)
    let payload = PlaceSuggestionRequestPayload(query: "tok", languageCode: "en", destination: "auto")
    let result = await client.suggestPlaces(payload)
    XCTAssertNotNil(result, "a 401 must be retried once and then succeed")
    XCTAssertEqual(result?.suggestions.first?.providerRef, "abc")
  }
}
