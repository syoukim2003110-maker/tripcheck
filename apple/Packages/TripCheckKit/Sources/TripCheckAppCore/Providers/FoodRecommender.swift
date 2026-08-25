import Foundation
import TripCheckKit

public protocol FoodRecommending: Sendable {
  func recommendations(_ payload: FoodRecommendationRequestPayload) async -> FoodRecommendationResult?
}

/// `any WorkerAuthenticating` を包み、タップ時取得に上限時間を切って `foodRecommendations` を呼ぶ。
/// `WorkerSuggestionAdapter`/`WorkerRouteProvider` の withTaskGroup レースを鏡に。
public struct WorkerFoodRecommender: FoodRecommending {
  private let client: any WorkerAuthenticating
  private let timeout: Duration
  public init(client: any WorkerAuthenticating, timeout: Duration = .seconds(8)) {
    self.client = client; self.timeout = timeout
  }
  public func recommendations(_ payload: FoodRecommendationRequestPayload) async -> FoodRecommendationResult? {
    let client = self.client
    let limit = timeout
    return await withTaskGroup(of: FoodRecommendationResult?.self) { group in
      group.addTask { await client.foodRecommendations(payload) }
      group.addTask { try? await Task.sleep(for: limit); return nil }
      let first = await group.next() ?? nil
      group.cancelAll()
      return first
    }
  }
}

/// 可用性は合成の根にだけ閉じ込める(weather/intent と同じ)。
public enum FoodRecommendationAvailability {
  public static func makeDefaultProvider(uiTesting: Bool, client: any WorkerAuthenticating) -> (any FoodRecommending)? {
    uiTesting ? nil : WorkerFoodRecommender(client: client)
  }
}
