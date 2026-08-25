import Foundation
import TripCheckKit

public enum HotelRecommendationsState: Equatable, Sendable {
  case loading; case loaded([HotelCandidate]); case unavailable
}

extension PlannerStore {
  /// カードの表示可否。scheduled stops があれば経路アンカーが立つ。
  public var hotelRecommendationsAvailable: Bool {
    guard let bundle else { return false }
    return Bases.hotelRouteContext(for: bundle.plan) != nil
  }

  /// シートを開いたときの入口。プラン単位に一度だけ取りに行く。
  public func loadHotelRecommendations() {
    guard let bundle, let ctx = Bases.hotelRouteContext(for: bundle.plan) else { return }
    switch hotelRecommendations {
    case .loading, .loaded: return
    case .unavailable, .none: beginHotelFetch(ctx)
    }
  }

  /// 実取得。テストは HotelRouteContext を直接渡す。
  func beginHotelFetch(_ ctx: HotelRouteContext) {
    hotelRecommendationTask?.cancel()
    guard let provider = hotelRecommendationProvider else {
      hotelRecommendations = .unavailable
      return
    }
    hotelRecommendations = .loading
    let payload = HotelRecommendationRequestPayload(
      latitude: ctx.latitude, longitude: ctx.longitude, area: ctx.area, routePoints: ctx.routePoints,
      languageCode: request.locale.rawValue, destination: request.destination.rawValue)
    let generation = hotelRecommendationGeneration
    hotelRecommendationTask = Task { [weak self] in
      let result = await provider.recommendations(payload)
      guard let self, self.hotelRecommendationGeneration == generation, !Task.isCancelled else { return }
      self.hotelRecommendations = result.map { .loaded($0.candidates) } ?? .unavailable
      self.hotelRecommendationTask = nil
    }
  }

  func invalidateHotelRecommendations() {
    hotelRecommendationGeneration &+= 1
    hotelRecommendationTask?.cancel()
    hotelRecommendationTask = nil
    hotelRecommendations = nil
  }
}
