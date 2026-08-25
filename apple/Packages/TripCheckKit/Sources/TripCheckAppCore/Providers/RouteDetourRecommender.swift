import Foundation
import TripCheckKit

public protocol RouteDetourRecommending: Sendable {
  func recommendations(_ payload: RouteRecommendationRequestPayload) async -> RouteRecommendationResult?
}

/// `any WorkerAuthenticating` を包み、シートを開いたときの取得に上限時間を切って
/// `routeRecommendations` を呼ぶ。`WorkerHotelRecommender` の withTaskGroup レースを鏡に。
public struct WorkerRouteDetourRecommender: RouteDetourRecommending {
  private let client: any WorkerAuthenticating
  private let timeout: Duration
  public init(client: any WorkerAuthenticating, timeout: Duration = .seconds(8)) {
    self.client = client; self.timeout = timeout
  }
  public func recommendations(_ payload: RouteRecommendationRequestPayload) async -> RouteRecommendationResult? {
    let client = self.client
    let limit = timeout
    return await withTaskGroup(of: RouteRecommendationResult?.self) { group in
      group.addTask { await client.routeRecommendations(payload) }
      group.addTask { try? await Task.sleep(for: limit); return nil }
      let first = await group.next() ?? nil
      group.cancelAll()
      return first
    }
  }
}

/// 可用性は合成の根にだけ閉じ込める(food/hotel/weather/intent と同じ)。
public enum RouteDetourAvailability {
  public static func makeDefaultProvider(uiTesting: Bool, client: any WorkerAuthenticating) -> (any RouteDetourRecommending)? {
    uiTesting ? nil : WorkerRouteDetourRecommender(client: client)
  }
}
