import Foundation
import TripCheckKit

/// 食事枠 1 つぶんの候補の状態。
public enum FoodSlotRecommendations: Equatable, Sendable {
  case loading
  case loaded([FoodCandidate])
  case unavailable
}

extension PlannerStore {
  /// `MealRow` タップの入口。枠を bundle から引き、まだ取っていなければ取りに行く。
  public func loadFoodRecommendations(slotId: String) {
    guard let slot = bundle?.plan.foodRecommendationSlots.first(where: { $0.id == slotId }) else { return }
    switch foodRecommendationsBySlot[slotId] {
    case .loading, .loaded: return          // 取得中/取得済みは触らない
    case .unavailable, .none: beginFoodFetch(slot)
    }
  }

  /// 実取得。テストは `FoodRecommendationSlot` を直接渡して駆動する。
  func beginFoodFetch(_ slot: FoodRecommendationSlot) {
    foodRecommendationTasks[slot.id]?.cancel()
    guard let provider = foodRecommendationProvider else {
      foodRecommendationsBySlot[slot.id] = .unavailable
      return
    }
    foodRecommendationsBySlot[slot.id] = .loading
    let payload = foodPayload(for: slot)
    let generation = foodRecommendationGeneration
    let slotId = slot.id
    foodRecommendationTasks[slotId] = Task { [weak self] in
      let result = await provider.recommendations(payload)
      guard let self, self.foodRecommendationGeneration == generation, !Task.isCancelled else { return }
      self.foodRecommendationsBySlot[slotId] = result.map { .loaded($0.candidates) } ?? .unavailable
      self.foodRecommendationTasks[slotId] = nil
    }
  }

  /// 再ビルド・日付変更・reset で。世代を上げ、読みかけを捨て、候補を空に。
  func invalidateFoodRecommendations() {
    foodRecommendationGeneration &+= 1
    for task in foodRecommendationTasks.values { task.cancel() }
    foodRecommendationTasks = [:]
    foodRecommendationsBySlot = [:]
  }

  private func foodPayload(for slot: FoodRecommendationSlot) -> FoodRecommendationRequestPayload {
    let joined = slot.queryIdeas.joined(separator: " ")
    let query = (joined.count >= 1 && joined.count <= 120) ? joined : nil
    let polyline = slot.routePolyline.flatMap { ($0.count >= 10 && $0.count <= 10_000) ? $0 : nil }
    return FoodRecommendationRequestPayload(
      latitude: slot.latitude, longitude: slot.longitude, area: slot.area,
      mealKind: slot.kind.rawValue, query: query,
      languageCode: request.locale.rawValue, destination: request.destination.rawValue,
      routePolyline: polyline)
  }
}
