import TripCheckKit
@testable import TripCheckAppCore

/// 名前を挙げた問い合わせだけ review / unresolved にし、**挙げなかった名前は confirmed にする**。
/// ResolutionPipeline は答えの無い index を `.unresolved(reason: notFoundReason)` にし、`attentionRanks` は
/// review と unresolved を同じ列に数えるので、この契約でないと Task 5 の「4 件目を抑止」が 2 件抑止になる。
struct FakeResolver: PlaceResolver {
  var review: [String] = []
  var unresolved: [String] = []
  func resolve(_ queries: [PlaceQuery], destination: DestinationChoice, locale: PlannerLocale) async -> [Int: PlaceResolution] {
    var out: [Int: PlaceResolution] = [:]
    for q in queries {
      func stop(_ suffix: String, name: String) -> ResolvedStop {
        ResolvedStop(id: "fake-\(q.inputIndex)\(suffix)", name: name, area: "", latitude: 46.9 + Double(q.inputIndex) * 0.01, longitude: 7.4,
                     sourceUrl: "", verifiedAt: "", confidence: .medium, planningDurationMinutes: 60, isAnchor: true,
                     input: q.input, inputIndex: q.inputIndex, address: "", countryCode: "CH", provider: .apple)
      }
      if unresolved.contains(q.input) { out[q.inputIndex] = .unresolved(reason: ResolutionPipeline.notFoundReason) }
      else if review.contains(q.input) { out[q.inputIndex] = .review([PlaceCandidate(stop: stop("-a", name: "\(q.input) Old Town")), PlaceCandidate(stop: stop("-b", name: "\(q.input) Museum"))]) }
      else { out[q.inputIndex] = .confirmed(stop("", name: q.input)) }
    }
    return out
  }
}

/// 返事に間の空く相手。**割り込みの競争を毎回同じ形で作る**ためだけに居る —— 解決が
/// 飛んでいる最中にリンクが開く、という順序は、答えが即座に返る `FakeResolver` では作れない。
///
/// 答えは必ず confirmed で、停留所の `input` に**問いの文字列をそのまま**入れる。どの旅の
/// 答えがどの行に着いたのかは、それを見れば後から言い当てられる。
struct SlowResolver: PlaceResolver {
  var delay: Duration = .milliseconds(200)

  func resolve(_ queries: [PlaceQuery], destination: DestinationChoice, locale: PlannerLocale) async -> [Int: PlaceResolution] {
    try? await Task.sleep(for: delay)
    var out: [Int: PlaceResolution] = [:]
    for q in queries {
      out[q.inputIndex] = .confirmed(ResolvedStop(
        id: "slow-\(q.inputIndex)", name: q.input, area: "",
        latitude: 46.9 + Double(q.inputIndex) * 0.01, longitude: 7.4,
        sourceUrl: "", verifiedAt: "", confidence: .medium, planningDurationMinutes: 60,
        isAnchor: true, input: q.input, inputIndex: q.inputIndex, address: "",
        countryCode: "CH", provider: .apple
      ))
    }
    return out
  }
}

/// 候補を返す端末の地図の代わり。既定は 0 件で、`titles` を挙げるとその見出しの候補を返す
/// —— 検索窓で選ぶ道(選んだ 1 件が行に固定される)をテストから通せるようにするため。
@MainActor final class FakeCompleter: SuggestionCompleting {
  var calls = 0
  var titles: [String] = []

  init(titles: [String] = []) { self.titles = titles }

  func complete(_ query: String, region: GeoBounds?) async throws -> [PlaceSuggestion] {
    calls += 1
    return titles.map { fakeSuggestion($0) }
  }
}
