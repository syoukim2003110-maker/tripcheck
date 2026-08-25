import Testing
@testable import TripCheckAppCore
import TripCheckKit

@MainActor private final class FakeIntel: PlaceIntelligenceProviding {
  var calls = 0
  var lastPayload: PlaceIntelligenceRequestPayload?
  var answer: PlaceIntelligenceResult?
  var sleep: Duration?
  init(answer: PlaceIntelligenceResult?, sleep: Duration? = nil) { self.answer = answer; self.sleep = sleep }
  func intelligence(_ payload: PlaceIntelligenceRequestPayload) async -> PlaceIntelligenceResult? {
    calls += 1; lastPayload = payload
    if let sleep { try? await Task.sleep(for: sleep) }
    return answer
  }
}

/// Google 停留所(providerRef 有り)を構築。RouteStop の実 init に合わせ、示していない任意 param は
/// 既定/nil で埋める(実装時に RouteStop.init を確認)。
private func googleStop(_ id: String = "google-0-abc", ref: String? = "places/ChIJ") -> RouteStop {
  RouteStop(id: id, providerRef: ref, name: "Kaffee", area: "Bern", latitude: 46.9, longitude: 7.4,
    sourceUrl: "https://maps.google/x", verifiedAt: "t", confidence: .medium,
    planningDurationMinutes: 30, isAnchor: false)
}

private func result() -> PlaceIntelligenceResult {
  PlaceIntelligenceResult(
    place: PlaceIntelligencePlace(name: "Kaffee", address: "a", googleMapsUrl: "u", businessStatus: "OPERATIONAL",
      rating: 4.6, userRatingCount: 10, openNow: true, hours: ["Mon 08-18"]),
    reviews: [], analysis: PlaceIntelligenceAnalysis(summary: "Popular.", confidence: "high"))
}

@MainActor private func store(_ provider: (any PlaceIntelligenceProviding)?) -> PlannerStore {
  PlannerStore(resolvers: [], store: nil, placeIntelligenceProvider: provider)
}


@Test @MainActor func fetchLoadsForProviderVerifiedStop() async throws {
  let fake = FakeIntel(answer: result())
  let s = store(fake)
  s.beginPlaceIntelligence(googleStop())
  #expect(s.placeIntelligenceByStop["google-0-abc"] == .loading)
  await s.placeIntelligenceTasks["google-0-abc"]?.value
  guard case .loaded(let r) = s.placeIntelligenceByStop["google-0-abc"] else { return #expect(Bool(false)) }
  #expect(r.place.rating == 4.6)
  #expect(fake.lastPayload?.name == "Kaffee")
  #expect(fake.lastPayload?.languageCode == "ja")
  #expect(fake.lastPayload?.destination == s.request.destination.rawValue)
}

@Test @MainActor func placeIntelligenceNilResultBecomesUnavailable() async throws {
  let s = store(FakeIntel(answer: nil))
  s.beginPlaceIntelligence(googleStop())
  await s.placeIntelligenceTasks["google-0-abc"]?.value
  #expect(s.placeIntelligenceByStop["google-0-abc"] == .unavailable)
}

@Test @MainActor func placeIntelligenceStaleResultDroppedByGenerationGuard() async throws {
  let fake = FakeIntel(answer: result(), sleep: .milliseconds(80))
  let s = store(fake)
  s.beginPlaceIntelligence(googleStop())
  let running = s.placeIntelligenceTasks["google-0-abc"]
  s.invalidatePlaceIntelligence()
  #expect(s.placeIntelligenceByStop.isEmpty)
  await running?.value
  #expect(s.placeIntelligenceByStop["google-0-abc"] == nil)
}

@Test @MainActor func placeIntelligenceNilProviderIsImmediatelyUnavailable() async {
  let s = store(nil)
  s.beginPlaceIntelligence(googleStop())
  #expect(s.placeIntelligenceByStop["google-0-abc"] == .unavailable)
}
