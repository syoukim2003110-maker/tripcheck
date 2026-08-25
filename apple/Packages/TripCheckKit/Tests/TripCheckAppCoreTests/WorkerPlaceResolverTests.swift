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

private struct SlowStubWorker: WorkerAuthenticating {
  func describe() async -> WorkerClientDescription { .init(baseURL: "slow", attestSupported: true, state: .idle) }
  func ensureSession() async -> WorkerAuthState { .idle }
  func ping() async -> WorkerPingResult { .init(ok: false, expiresAt: nil) }
  func resolvePlaces(_ payload: PlaceResolutionRequestPayload) async -> PlaceResolutionResult? {
    try? await Task.sleep(for: .seconds(2))
    return PlaceResolutionResult(provider: "google_maps", fetchedAt: "t", places: [], hotel: nil, ambiguous: [])
  }
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

  func testASlowWorkerTimesOutAndTheChainFallsThrough() async {
    let resolver = WorkerPlaceResolver(client: SlowStubWorker(), timeout: .milliseconds(20))
    let answers = await resolver.resolve([PlaceQuery(inputIndex: 0, input: "x")], destination: .auto, locale: .ja)
    XCTAssertTrue(answers.isEmpty, "a stalled worker must time out and yield no entries so Apple/Catalog run")
  }
}
