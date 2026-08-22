import Foundation
@testable import TripCheckKit

/*
 * 止まった時計。
 *
 * `assessTripFit` の既定は実時計(`ContinuousClock`)と 1 秒の予算(`EngineConstants.tripFitTimeout`)
 * で、予算を使い切ると `solverTimedOut` が立って `minimumDays` が消える —— つまり**出力が機械の
 * 忙しさで変わる**。G1(golden 500)と G3(TS スナップショット差分)はその出力をバイト単位で
 * 突き合わせるので、`swift test --parallel` の負荷(load average 7 台で再現)で 1 秒を跨いだ瞬間に
 * 差分が出る。落ちたのはエンジンではなく計測条件のほうなので、照合するテストからは時計を外す。
 *
 * `now` は何度読んでも同じ瞬間を返すため `TripScenarios.stopwatch` の経過時間は常に 0 で、
 * `elapsed() >= budget` は成立しない。探索の上限は `searchLimit`(`Scenarios/TripFit.swift:250`)
 * が持っているので、時計が止まっても走査は必ず終わる。
 *
 * 実際に予算切れを踏む道は `TestStops.timedOutTriple()`(1 回読むごとに 1ms 進む
 * `TestTickClock` + 1ms の予算)と `TripScenariosTests` の `.init(timeout: .zero)` が持ち続ける。
 */
struct FrozenInstant: InstantProtocol, Hashable {
  func advanced(by duration: Duration) -> FrozenInstant { self }
  func duration(to other: FrozenInstant) -> Duration { .zero }
  static func < (left: FrozenInstant, right: FrozenInstant) -> Bool { false }
}

struct FrozenClock: Clock {
  typealias Instant = FrozenInstant

  var now: FrozenInstant { FrozenInstant() }
  var minimumResolution: Duration { .zero }

  /// エンジンは同期のまま動くのでここへは来ない。来たなら、止まった時計で待とうとしている
  /// —— 黙って素通りさせるより、その場で止める。
  func sleep(until deadline: FrozenInstant, tolerance: Duration?) async throws {
    fatalError("FrozenClock never advances; sleeping on it would never return")
  }
}

/// 照合系(G1 / G3)が使う `TripFitSearchOptions`。予算は既定のまま、時計だけを止める。
extension TripFitSearchOptions {
  static var frozen: TripFitSearchOptions { TripFitSearchOptions(clock: FrozenClock()) }
}
