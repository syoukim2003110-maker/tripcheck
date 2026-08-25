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
