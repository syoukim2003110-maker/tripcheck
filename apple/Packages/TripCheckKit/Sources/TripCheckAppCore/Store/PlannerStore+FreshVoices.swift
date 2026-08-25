import Foundation
import TripCheckKit

public enum StopFreshVoices: Equatable, Sendable {
  case loading
  case loaded(FreshVoicesResult)
  case unavailable
}

extension PlannerStore {
  /// 基底の場所詳細が `.loaded` になった後、「最新の声を見る」を押したときの入口。
  /// name/area は呼び出し側(開示カードの `.loaded` 枝)が解決済み結果から組んで渡す
  /// —— テストは文字列だけで足りる。`.loading`/`.loaded` なら無視して戻る(二重取得しない)。
  public func loadFreshVoices(stopId: String, name: String, area: String) {
    switch freshVoicesByStop[stopId] {
    case .loading, .loaded: return
    case .unavailable, .none: beginFreshVoices(stopId: stopId, name: name, area: area)
    }
  }

  /// 実取得。intent は "place"、depth は "quick"(1 unit)で固定。destination/locale は今の旅のもの。
  func beginFreshVoices(stopId: String, name: String, area: String) {
    freshVoicesTasks[stopId]?.cancel()
    guard let provider = freshVoicesProvider else {
      freshVoicesByStop[stopId] = .unavailable
      return
    }
    freshVoicesByStop[stopId] = .loading
    let payload = FreshVoicesRequestPayload(
      name: name, area: area, languageCode: request.locale.rawValue,
      destination: request.destination.rawValue, intent: "place", depth: "quick")
    let generation = freshVoicesGeneration
    freshVoicesTasks[stopId] = Task { [weak self] in
      let result = await provider.freshVoices(payload)
      guard let self, self.freshVoicesGeneration == generation, !Task.isCancelled else { return }
      self.freshVoicesByStop[stopId] = result.map { .loaded($0) } ?? .unavailable
      self.freshVoicesTasks[stopId] = nil
    }
  }

  func invalidateFreshVoices() {
    freshVoicesGeneration &+= 1
    for task in freshVoicesTasks.values { task.cancel() }
    freshVoicesTasks = [:]
    freshVoicesByStop = [:]
  }
}
