import Testing
@testable import TripCheckAppCore
import TripCheckKit

@MainActor private final class FakeFood: FoodRecommending {
  var calls = 0
  var lastPayload: FoodRecommendationRequestPayload?
  var answer: FoodRecommendationResult?
  var sleep: Duration?
  init(answer: FoodRecommendationResult?, sleep: Duration? = nil) { self.answer = answer; self.sleep = sleep }
  func recommendations(_ payload: FoodRecommendationRequestPayload) async -> FoodRecommendationResult? {
    calls += 1; lastPayload = payload
    if let sleep { try? await Task.sleep(for: sleep) }
    return answer
  }
}

private func slot(_ id: String = "food-1-lunch", kind: MealKind = .lunch) -> FoodRecommendationSlot {
  FoodRecommendationSlot(id: id, dayIndex: 0, dayLabel: "Day 1", date: nil, kind: kind, area: "Bern",
    anchorStopId: "s1", latitude: 46.9, longitude: 7.4, window: "12:00-14:00", displayTime: "12:30",
    probeTime: nil, routePolyline: nil, rationale: "", queryIdeas: ["ramen", "noodles"])
}

@MainActor private func store(_ provider: (any FoodRecommending)?) -> PlannerStore {
  PlannerStore(resolvers: [], store: nil, foodRecommendationProvider: provider)
}

@MainActor private func waitUntil(_ c: () -> Bool) async throws {
  var n = 0; while !c(), n < 2000 { try await Task.sleep(for: .milliseconds(1)); n += 1 }
}

@Test @MainActor func fetchTransitionsLoadingToLoaded() async throws {
  let fake = FakeFood(answer: FoodRecommendationResult(candidates: [FoodCandidate(id: "c1", name: "T", address: "a", type: "italian_restaurant", googleMapsUrl: "u", distanceMeters: 100, rating: 4.2, userRatingCount: 9, openNow: true, websiteUrl: nil)]))
  let s = store(fake)
  s.beginFoodFetch(slot())
  #expect(s.foodRecommendationsBySlot["food-1-lunch"] == .loading)
  try await waitUntil { if case .loaded = s.foodRecommendationsBySlot["food-1-lunch"] { return true }; return false }
  guard case .loaded(let cands) = s.foodRecommendationsBySlot["food-1-lunch"] else { return #expect(Bool(false)) }
  #expect(cands.first?.id == "c1")
  #expect(fake.lastPayload?.mealKind == "lunch")
  #expect(fake.lastPayload?.query == "ramen noodles")   // queryIdeas 連結
  #expect(fake.lastPayload?.languageCode == "ja")        // 既定ロケール
}

@Test @MainActor func nilResultBecomesUnavailable() async throws {
  let s = store(FakeFood(answer: nil))
  s.beginFoodFetch(slot())
  try await waitUntil { s.foodRecommendationsBySlot["food-1-lunch"] == .unavailable }
  #expect(s.foodRecommendationsBySlot["food-1-lunch"] == .unavailable)
}

@Test @MainActor func staleResultDroppedByGenerationGuard() async throws {
  let fake = FakeFood(answer: FoodRecommendationResult(candidates: []), sleep: .milliseconds(80))
  let s = store(fake)
  s.beginFoodFetch(slot())
  #expect(s.foodRecommendationsBySlot["food-1-lunch"] == .loading)
  s.invalidateFoodRecommendations()                      // 世代 +1・全消し
  #expect(s.foodRecommendationsBySlot.isEmpty)
  try await waitUntil { fake.calls == 1 }
  try await Task.sleep(for: .milliseconds(40))
  #expect(s.foodRecommendationsBySlot["food-1-lunch"] == nil)   // 古い取得は捨てられた
}

@Test @MainActor func nilProviderIsImmediatelyUnavailable() async {
  let s = store(nil)
  // bundle が無いので loadFoodRecommendations(slotId:) は slot を引けない → beginFoodFetch を直接。
  s.beginFoodFetch(slot())
  #expect(s.foodRecommendationsBySlot["food-1-lunch"] == .unavailable)
}
