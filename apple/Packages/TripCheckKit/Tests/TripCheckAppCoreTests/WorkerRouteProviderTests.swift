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
  func foodRecommendations(_ payload: FoodRecommendationRequestPayload) async -> FoodRecommendationResult? { nil }
  func placeIntelligence(_ payload: PlaceIntelligenceRequestPayload) async -> PlaceIntelligenceResult? { nil }
  func hotelRecommendations(_ payload: HotelRecommendationRequestPayload) async -> HotelRecommendationResult? { nil }
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
