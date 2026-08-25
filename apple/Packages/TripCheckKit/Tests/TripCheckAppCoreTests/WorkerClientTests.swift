import XCTest
import Foundation
import TripCheckKit
@testable import TripCheckAppCore

/// テスト内で Worker の応答を組み立てる小さなゲートウェイ。challenge → session を返し、
/// 特定シナリオ(unknown_key を 1 回・ping 401 を 1 回)をスクリプトできる。
private actor FakeGateway {
  var unknownKeyOnce = false
  var pingUnauthorizedOnce = false
  var resolveUnauthorizedOnce = false
  var suggestUnauthorizedOnce = false
  var liveRoutesUnauthorizedOnce = false
  var foodUnauthorizedOnce = false
  var intelUnauthorizedOnce = false
  var hotelUnauthorizedOnce = false
  var routeUnauthorizedOnce = false
  var freshUnauthorizedOnce = false
  var freshServerError = false
  var lastAttestKeyId: String?
  private var sawUnknownKey = false
  private var sawPing401 = false
  private var sawResolve401 = false
  private var sawSuggest401 = false
  private var sawLiveRoutes401 = false
  private var sawFood401 = false
  private var sawIntel401 = false
  private var sawHotel401 = false
  private var sawRoute401 = false
  private var sawFresh401 = false

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
    case "/api/live-routes":
      if liveRoutesUnauthorizedOnce, !sawLiveRoutes401 {
        sawLiveRoutes401 = true
        return json(#"{"code":"session_expired"}"#, 401)
      }
      return json(#"{"provider":"google_maps","fetchedAt":"t","travelMode":"WALK","legs":[{"id":"L1","durationMinutes":12,"distanceMeters":900,"encodedPolyline":null,"transferCount":null,"transitSteps":null,"walkToStopMinutes":null,"walkFromStopMinutes":null,"status":"ok"}]}"#, 200)
    case "/api/food-recommendations":
      if foodUnauthorizedOnce, !sawFood401 {
        sawFood401 = true
        return json(#"{"code":"session_expired"}"#, 401)
      }
      return json(#"{"provider":"google_maps","ranking":"evidence_weighted","fetchedAt":"t","candidates":[{"id":"c1","name":"Trattoria","address":"1 Via Roma","type":"italian_restaurant","googleMapsUrl":"https://maps.google/x","distanceMeters":240,"rating":4.4,"userRatingCount":812,"openNow":true,"hours":[],"paymentEvidence":[],"reviewSnippets":[],"websiteUrl":null}]}"#, 200)
    case "/api/place-intelligence":
      if intelUnauthorizedOnce, !sawIntel401 {
        sawIntel401 = true
        return json(#"{"code":"session_expired"}"#, 401)
      }
      return json(#"{"provider":"google_places","checkedAt":"t","analyzedBy":"rules","place":{"name":"Kaffee","address":"a","googleMapsUrl":"u","businessStatus":"OPERATIONAL","rating":4.6,"userRatingCount":10,"openNow":true,"hours":[]},"reviews":[],"analysis":{"summary":"s","confidence":"high","signals":[],"nextCheck":"t"},"links":{"x":"u","instagram":"u"}}"#, 200)
    case "/api/hotel-recommendations":
      if hotelUnauthorizedOnce, !sawHotel401 {
        sawHotel401 = true
        return json(#"{"code":"session_expired"}"#, 401)
      }
      return json(#"{"provider":"google_maps","fetchedAt":"t","evidenceProviders":{"rakuten":false},"candidates":[{"id":"h1","name":"Hotel Bern","address":"a","googleMapsUrl":"u","websiteUrl":null,"rating":4.3,"userRatingCount":10,"distanceMeters":320,"routeBurdenMeters":800}]}"#, 200)
    case "/api/route-recommendations":
      if routeUnauthorizedOnce, !sawRoute401 {
        sawRoute401 = true
        return json(#"{"code":"session_expired"}"#, 401)
      }
      return json(#"{"provider":"google_maps","fetchedAt":"t","candidates":[{"id":"g1","providerRef":"ChIJ","name":"Cafe Alpen","address":"a","type":"cafe","googleMapsUrl":"u","latitude":46.9,"longitude":7.4,"rating":4.5,"userRatingCount":10,"routeDistanceMeters":180}]}"#, 200)
    case "/api/place-intelligence/fresh":
      if freshServerError {
        return json(#"{"code":"not_configured"}"#, 503)
      }
      if freshUnauthorizedOnce, !sawFresh401 {
        sawFresh401 = true
        return json(#"{"code":"session_expired"}"#, 401)
      }
      return json(#"{"provider":"anthropic_web_search","checkedAt":"t","intent":"place","depth":"quick","summary":"Buzzing.","searchCount":2,"findings":[{"title":"Night market reopens","url":"https://news.example/x","note":"Crowds returned.","age":"3 days ago","isRecent":true,"sourceKind":"news","evidenceLevel":"cited_claim","urlSignature":"sig"}]}"#, 200)
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

  func testPlaceIntelligenceRetriesOnceOn401() async {
    let gateway = FakeGateway()
    await gateway.configure(intelUnauthorizedOnce: true)
    let (client, _) = makeClient(gateway: gateway)
    let payload = PlaceIntelligenceRequestPayload(name: "Kaffee", area: "Bern", latitude: 46.9, longitude: 7.4, languageCode: "en", destination: "auto")
    let result = await client.placeIntelligence(payload)
    XCTAssertNotNil(result, "a 401 must be retried once and then succeed")
    XCTAssertEqual(result?.place.name, "Kaffee")
  }

  func testHotelRecommendationsRetriesOnceOn401() async {
    let gateway = FakeGateway()
    await gateway.configure(hotelUnauthorizedOnce: true)
    let (client, _) = makeClient(gateway: gateway)
    let payload = HotelRecommendationRequestPayload(latitude: 46.9, longitude: 7.4, area: "Bern",
      routePoints: [GeoPoint(latitude: 46.9, longitude: 7.4)], languageCode: "en", destination: "auto")
    let result = await client.hotelRecommendations(payload)
    XCTAssertNotNil(result, "a 401 must be retried once and then succeed")
    XCTAssertEqual(result?.candidates.first?.id, "h1")
  }

  func testRouteRecommendationsRetriesOnceOn401() async {
    let gateway = FakeGateway()
    await gateway.configure(routeUnauthorizedOnce: true)
    let (client, _) = makeClient(gateway: gateway)
    let payload = RouteRecommendationRequestPayload(
      routePoints: [GeoPoint(latitude: 46.9, longitude: 7.4)], excludedPlaceIds: [], excludedNames: [],
      languageCode: "en", destination: "auto", suggestionKinds: ["CAFE"])
    let result = await client.routeRecommendations(payload)
    XCTAssertNotNil(result, "a 401 must be retried once and then succeed")
    XCTAssertEqual(result?.candidates.first?.id, "g1")
  }

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
}
