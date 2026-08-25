import Foundation
import TripCheckKit

public enum GapDetourState: Equatable, Sendable {
  case loading; case loaded([RouteRecommendation]); case unavailable
}

extension PlannerStore {
  /// カードの表示可否(その日に空きがあるか)。
  public func gapDetourAvailable(_ dayIndex: Int) -> Bool { bundle?.gaps[dayIndex] != nil }
  /// カードに出す時刻範囲。
  public func gapDetourTimeRange(_ dayIndex: Int) -> String? {
    bundle?.gaps[dayIndex].map { "\($0.startAt)\u{2013}\($0.endAt)" }
  }

  /// シートを開いたときの入口。excluded は全日の停留所から組む。
  public func loadGapDetour(dayIndex: Int) {
    guard let bundle, let gap = bundle.gaps[dayIndex] else { return }
    switch gapDetourByDay[dayIndex] {
    case .loading, .loaded: return
    case .unavailable, .none:
      let stops = bundle.plan.days.flatMap { $0.stops.map { $0.stop } }
      beginGapDetourFetch(dayIndex: dayIndex, gap: gap,
        excludedPlaceIds: stops.compactMap { $0.providerRef },
        excludedNames: stops.map { $0.name })
    }
  }

  /// 実取得。テストは gap と excluded を直接渡す(BuiltPlan は不要)。
  func beginGapDetourFetch(dayIndex: Int, gap: ItineraryGap, excludedPlaceIds: [String], excludedNames: [String]) {
    routeDetourTasks[dayIndex]?.cancel()
    guard let provider = routeDetourProvider else {
      gapDetourByDay[dayIndex] = .unavailable
      return
    }
    gapDetourByDay[dayIndex] = .loading
    let payload = RouteRecommendationRequestPayload(
      routePoints: [gap.routeSegment.from, gap.routeSegment.to].compactMap { $0 },
      excludedPlaceIds: excludedPlaceIds, excludedNames: excludedNames,
      languageCode: request.locale.rawValue, destination: request.destination.rawValue,
      suggestionKinds: gap.suggestionKinds.map { $0.rawValue })
    let generation = routeDetourGeneration
    routeDetourTasks[dayIndex] = Task { [weak self] in
      let result = await provider.recommendations(payload)
      guard let self, self.routeDetourGeneration == generation, !Task.isCancelled else { return }
      self.gapDetourByDay[dayIndex] = result.map { .loaded($0.candidates) } ?? .unavailable
      self.routeDetourTasks[dayIndex] = nil
    }
  }

  func invalidateRouteDetour() {
    routeDetourGeneration &+= 1
    for task in routeDetourTasks.values { task.cancel() }
    routeDetourTasks = [:]
    gapDetourByDay = [:]
  }
}
