import Foundation
import TripCheckKit

public protocol PlaceIntelligenceProviding: Sendable {
  func intelligence(_ payload: PlaceIntelligenceRequestPayload) async -> PlaceIntelligenceResult?
}

/// `any WorkerAuthenticating` を包み、タップ時取得に上限時間を切って `placeIntelligence` を呼ぶ。
/// `WorkerFoodRecommender`/`WorkerRouteProvider` の withTaskGroup レースを鏡に。
public struct WorkerPlaceIntelligenceProvider: PlaceIntelligenceProviding {
  private let client: any WorkerAuthenticating
  private let timeout: Duration
  public init(client: any WorkerAuthenticating, timeout: Duration = .seconds(8)) {
    self.client = client; self.timeout = timeout
  }
  public func intelligence(_ payload: PlaceIntelligenceRequestPayload) async -> PlaceIntelligenceResult? {
    let client = self.client
    let limit = timeout
    return await withTaskGroup(of: PlaceIntelligenceResult?.self) { group in
      group.addTask { await client.placeIntelligence(payload) }
      group.addTask { try? await Task.sleep(for: limit); return nil }
      let first = await group.next() ?? nil
      group.cancelAll()
      return first
    }
  }
}

/// 可用性は合成の根にだけ閉じ込める(weather/food と同じ)。
public enum PlaceIntelligenceAvailability {
  public static func makeDefaultProvider(uiTesting: Bool, client: any WorkerAuthenticating) -> (any PlaceIntelligenceProviding)? {
    uiTesting ? nil : WorkerPlaceIntelligenceProvider(client: client)
  }
}
