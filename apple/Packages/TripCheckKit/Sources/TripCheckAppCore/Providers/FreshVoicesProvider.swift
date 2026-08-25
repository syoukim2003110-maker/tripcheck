import Foundation
import TripCheckKit

public protocol FreshVoicesProviding: Sendable {
  func freshVoices(_ payload: FreshVoicesRequestPayload) async -> FreshVoicesResult?
}

/// `any WorkerAuthenticating` を包み、2 度目の展開の取得に上限時間を切って `freshVoices` を呼ぶ。
/// `WorkerPlaceIntelligenceProvider` の withTaskGroup レースを鏡に。
public struct WorkerFreshVoicesProvider: FreshVoicesProviding {
  private let client: any WorkerAuthenticating
  private let timeout: Duration
  public init(client: any WorkerAuthenticating, timeout: Duration = .seconds(8)) {
    self.client = client; self.timeout = timeout
  }
  public func freshVoices(_ payload: FreshVoicesRequestPayload) async -> FreshVoicesResult? {
    let client = self.client
    let limit = timeout
    return await withTaskGroup(of: FreshVoicesResult?.self) { group in
      group.addTask { await client.freshVoices(payload) }
      group.addTask { try? await Task.sleep(for: limit); return nil }
      let first = await group.next() ?? nil
      group.cancelAll()
      return first
    }
  }
}

/// 可用性は合成の根にだけ閉じ込める(place-intelligence/food/hotel と同じ)。
public enum FreshVoicesAvailability {
  public static func makeDefaultProvider(uiTesting: Bool, client: any WorkerAuthenticating) -> (any FreshVoicesProviding)? {
    uiTesting ? nil : WorkerFreshVoicesProvider(client: client)
  }
}
