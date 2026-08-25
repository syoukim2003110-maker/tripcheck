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
  let running = s.foodRecommendationTasks["food-1-lunch"]   // 走っている取得を掴んでおく
  s.invalidateFoodRecommendations()                        // 世代 +1・全消し(走っている取得も cancel)
  #expect(s.foodRecommendationsBySlot.isEmpty)
  await running?.value                                     // 取得が終わるまで待つ(固定 sleep より堅い)
  #expect(s.foodRecommendationsBySlot["food-1-lunch"] == nil)   // 古い取得は捨てられた
}

@Test @MainActor func nilProviderIsImmediatelyUnavailable() async {
  let s = store(nil)
  // bundle が無いので loadFoodRecommendations(slotId:) は slot を引けない → beginFoodFetch を直接。
  s.beginFoodFetch(slot())
  #expect(s.foodRecommendationsBySlot["food-1-lunch"] == .unavailable)
}

@Test @MainActor func payloadMapsFieldsAndClampsBounds() async throws {
  // 13 個 * 10 文字 + 12 空白 = 142 > 120 → query は nil、"short"=5 < 10 → routePolyline は nil。
  let longIdeas = Array(repeating: "aaaaaaaaaa", count: 13)
  let s1 = FoodRecommendationSlot(id: "food-2-dinner", dayIndex: 1, dayLabel: "Day 2", date: "2026-08-26",
    kind: .dinner, area: "Zurich", anchorStopId: "s9", latitude: 47.37, longitude: 8.54,
    window: "18:00-20:00", displayTime: "19:00", probeTime: nil,
    routePolyline: "short", rationale: "", queryIdeas: longIdeas)
  let fake = FakeFood(answer: FoodRecommendationResult(candidates: []))
  let s = store(fake)
  s.beginFoodFetch(s1)
  await s.foodRecommendationTasks["food-2-dinner"]?.value
  let p = fake.lastPayload
  #expect(p?.mealKind == "dinner")
  #expect(p?.area == "Zurich")
  #expect(p?.latitude == 47.37)
  #expect(p?.longitude == 8.54)
  #expect(p?.destination == s.request.destination.rawValue)   // request の行き先を素通し
  #expect(p?.languageCode == s.request.locale.rawValue)
  #expect(p?.query == nil)             // 142 文字 > 120 → nil(server が既定語)
  #expect(p?.routePolyline == nil)     // 5 文字 < 10 → nil
}

@Test @MainActor func payloadKeepsInRangePolylineAndJoinsQuery() async throws {
  let poly = String(repeating: "a", count: 50)   // 10...10000
  let s1 = FoodRecommendationSlot(id: "food-3-lunch", dayIndex: 0, dayLabel: "Day 1", date: nil,
    kind: .lunch, area: "Bern", anchorStopId: "s1", latitude: 46.9, longitude: 7.4,
    window: "12:00-14:00", displayTime: "12:30", probeTime: nil,
    routePolyline: poly, rationale: "", queryIdeas: ["ramen", "gyoza"])
  let fake = FakeFood(answer: FoodRecommendationResult(candidates: []))
  let s = store(fake)
  s.beginFoodFetch(s1)
  await s.foodRecommendationTasks["food-3-lunch"]?.value
  #expect(fake.lastPayload?.query == "ramen gyoza")
  #expect(fake.lastPayload?.routePolyline == poly)
}
