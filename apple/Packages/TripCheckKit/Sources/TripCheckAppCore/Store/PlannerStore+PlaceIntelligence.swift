import Foundation
import TripCheckKit

public enum StopPlaceIntelligence: Equatable, Sendable {
  case loading
  case loaded(PlaceIntelligenceResult)
  case unavailable
}

extension PlannerStore {
  /// 停留所詳細カードを開いたときの入口。Google 検証済み(providerRef 有り)停留所だけ取りに行く。
  public func loadPlaceIntelligence(stopId: String) {
    guard let stop = builtStop(stopId), stop.providerRef != nil else { return }
    switch placeIntelligenceByStop[stopId] {
    case .loading, .loaded: return
    case .unavailable, .none: beginPlaceIntelligence(stop)
    }
  }

  /// 実取得。テストは `RouteStop` を直接渡す。
  func beginPlaceIntelligence(_ stop: RouteStop) {
    placeIntelligenceTasks[stop.id]?.cancel()
    guard let provider = placeIntelligenceProvider else {
      placeIntelligenceByStop[stop.id] = .unavailable
      return
    }
    placeIntelligenceByStop[stop.id] = .loading
    // providerRef と scope は送らない(リッチ tier)。
    let payload = PlaceIntelligenceRequestPayload(
      name: stop.name, area: stop.area, latitude: stop.latitude, longitude: stop.longitude,
      languageCode: request.locale.rawValue, destination: request.destination.rawValue)
    let generation = placeIntelligenceGeneration
    let stopId = stop.id
    placeIntelligenceTasks[stopId] = Task { [weak self] in
      let result = await provider.intelligence(payload)
      guard let self, self.placeIntelligenceGeneration == generation, !Task.isCancelled else { return }
      self.placeIntelligenceByStop[stopId] = result.map { .loaded($0) } ?? .unavailable
      self.placeIntelligenceTasks[stopId] = nil
    }
  }

  func invalidatePlaceIntelligence() {
    placeIntelligenceGeneration &+= 1
    for task in placeIntelligenceTasks.values { task.cancel() }
    placeIntelligenceTasks = [:]
    placeIntelligenceByStop = [:]
  }

  /// `bundle` の全日・全停留所から id 一致の `RouteStop` を引く(`inspector(for:)` と同じ読み方)。
  private func builtStop(_ stopId: String) -> RouteStop? {
    guard let bundle else { return nil }
    for day in bundle.plan.days {
      for built in day.stops where built.stop.id == stopId { return built.stop }
    }
    return nil
  }
}
