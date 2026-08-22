import Foundation
import TripCheckKit
@testable import TripCheckAppCore

/*
 * 端末の地図の代わり。`swift test` は macOS で走り、`MKLocalSearch` が答える道はテストから
 * 一度も呼ばれない —— `ApplePlaceResolver` について検査できるのは、`LocalSearching` の後ろに
 * 何を置いても変わらない部分(候補の組み立て・自動採用・打ち切り・同時数)だけである。
 */

/// 問いの文字列で引ける決め打ちの答え。挙げていない文字列は 0 件(= 見つからない)。
struct FakeSearch: LocalSearching {
  var hits: [String: [LocalSearchHit]]
  func search(query: String, region: GeoBounds?, locale: PlannerLocale) async throws -> [LocalSearchHit] { hits[query] ?? [] }
}

/// 永久に答えない相手。打ち切りが**本当の競争**であること —— 待つ側が待ち続けても `resolve` は
/// 返ってくること —— を確かめるためだけに居る。
struct HangingSearch: LocalSearching {
  func search(query: String, region: GeoBounds?, locale: PlannerLocale) async throws -> [LocalSearchHit] {
    try await Task.sleep(for: .seconds(60))
    return []
  }
}

/// 1 件ずつ `dwell` のあいだ手元に留めて、同時に何件が立っていたかを数える相手。
/// `concurrency` が飾りでないことを確かめる。
///
/// `actor` なのは、数える側が並列に呼ばれるから —— 数え上げ自体が競争していると、見えた
/// 最大値が機械の忙しさで変わる。`Task.sleep` は actor を手放すので、留めている間もほかの
/// 問い合わせは入って来られる(入って来られなければ、そもそも数える意味がない)。
actor CountingSearch: LocalSearching {
  private(set) var peak = 0
  private var inFlight = 0
  private let dwell: Duration

  init(dwell: Duration = .milliseconds(40)) { self.dwell = dwell }

  func search(query: String, region: GeoBounds?, locale: PlannerLocale) async throws -> [LocalSearchHit] {
    inFlight += 1
    peak = max(peak, inFlight)
    try? await Task.sleep(for: dwell)
    inFlight -= 1
    return []
  }
}
