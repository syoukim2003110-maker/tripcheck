import Testing
@testable import TripCheckAppCore
import TripCheckKit

@MainActor private final class FakeHotel: HotelRecommending {
  var calls = 0; var lastPayload: HotelRecommendationRequestPayload?
  var answer: HotelRecommendationResult?; var sleep: Duration?
  init(answer: HotelRecommendationResult?, sleep: Duration? = nil) { self.answer = answer; self.sleep = sleep }
  func recommendations(_ payload: HotelRecommendationRequestPayload) async -> HotelRecommendationResult? {
    calls += 1; lastPayload = payload
    if let sleep { try? await Task.sleep(for: sleep) }
    return answer
  }
}
private func ctx() -> HotelRouteContext {
  HotelRouteContext(latitude: 46.9, longitude: 7.4, area: "Bern",
    routePoints: [GeoPoint(latitude: 46.9, longitude: 7.4)], spreadKm: 3)
}
private func result() -> HotelRecommendationResult {
  HotelRecommendationResult(candidates: [HotelCandidate(id: "h1", name: "Hotel Bern", address: "a",
    googleMapsUrl: "u", websiteUrl: nil, rating: 4.3, userRatingCount: 10, distanceMeters: 320, routeBurdenMeters: 800)])
}
@MainActor private func store(_ p: (any HotelRecommending)?) -> PlannerStore {
  PlannerStore(resolvers: [], store: nil, hotelRecommendationProvider: p)
}

@Test @MainActor func hotelFetchLoadsAndMapsPayload() async throws {
  let fake = FakeHotel(answer: result()); let s = store(fake)
  s.beginHotelFetch(ctx())
  #expect(s.hotelRecommendations == .loading)
  await s.hotelRecommendationTask?.value
  guard case .loaded(let cs) = s.hotelRecommendations else { return #expect(Bool(false)) }
  #expect(cs.first?.id == "h1")
  #expect(fake.lastPayload?.area == "Bern")
  #expect(fake.lastPayload?.routePoints.count == 1)
  #expect(fake.lastPayload?.languageCode == "ja")
  #expect(fake.lastPayload?.destination == s.request.destination.rawValue)
}
@Test @MainActor func hotelNilResultBecomesUnavailable() async throws {
  let s = store(FakeHotel(answer: nil)); s.beginHotelFetch(ctx())
  await s.hotelRecommendationTask?.value
  #expect(s.hotelRecommendations == .unavailable)
}
@Test @MainActor func hotelStaleResultDroppedByGenerationGuard() async throws {
  let fake = FakeHotel(answer: result(), sleep: .milliseconds(80)); let s = store(fake)
  s.beginHotelFetch(ctx())
  let running = s.hotelRecommendationTask
  s.invalidateHotelRecommendations()
  #expect(s.hotelRecommendations == nil)
  await running?.value
  #expect(s.hotelRecommendations == nil)
}
@Test @MainActor func hotelNilProviderIsUnavailable() async {
  let s = store(nil); s.beginHotelFetch(ctx())
  #expect(s.hotelRecommendations == .unavailable)
}

@Test @MainActor func hotelPayloadCapsRoutePointsAtTen() async throws {
  let many = (0..<14).map { GeoPoint(latitude: 46.0 + Double($0) * 0.1, longitude: 7.0) }
  let fake = FakeHotel(answer: result())
  let s = store(fake)
  s.beginHotelFetch(HotelRouteContext(latitude: 46.9, longitude: 7.4, area: "Bern", routePoints: many, spreadKm: 5))
  await s.hotelRecommendationTask?.value
  #expect(fake.lastPayload?.routePoints.count == 10)   // web の上限に丸める
}
