import Foundation
import TripCheckKit

public protocol HotelRecommending: Sendable {
  func recommendations(_ payload: HotelRecommendationRequestPayload) async -> HotelRecommendationResult?
}

/// `any WorkerAuthenticating` を包み、シートを開いたときの取得に上限時間を切って
/// `hotelRecommendations` を呼ぶ。`WorkerFoodRecommender` の withTaskGroup レースを鏡に。
public struct WorkerHotelRecommender: HotelRecommending {
  private let client: any WorkerAuthenticating
  private let timeout: Duration
  public init(client: any WorkerAuthenticating, timeout: Duration = .seconds(8)) {
    self.client = client; self.timeout = timeout
  }
  public func recommendations(_ payload: HotelRecommendationRequestPayload) async -> HotelRecommendationResult? {
    let client = self.client
    let limit = timeout
    return await withTaskGroup(of: HotelRecommendationResult?.self) { group in
      group.addTask { await client.hotelRecommendations(payload) }
      group.addTask { try? await Task.sleep(for: limit); return nil }
      let first = await group.next() ?? nil
      group.cancelAll()
      return first
    }
  }
}

/// 可用性は合成の根にだけ閉じ込める(food/weather/intent と同じ)。
public enum HotelRecommendationAvailability {
  public static func makeDefaultProvider(uiTesting: Bool, client: any WorkerAuthenticating) -> (any HotelRecommending)? {
    uiTesting ? nil : WorkerHotelRecommender(client: client)
  }
}
