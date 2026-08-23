import Foundation
import TripCheckKit
@testable import TripCheckAppCore

/*
 * 端末の地図の代わりに置く経路の相手。`swift test` は Apple を一度も呼ばない ——
 * `MKDirectionsAdapter` は `Directing` の裏に閉じているので、ここを通す限り検査できるのは
 * 「後ろに何を置いても変わらない部分」(分単位への丸め・失敗の読み替え・再試行・打ち切り)
 * だけになる。`Support/FakeSearch.swift` の `FakeSearch` と同じ形。
 */

/// 何回呼ばれたかを数える。再試行の回数は「答えが返った」だけでは言い当てられない ——
/// 3 回スロットルされて 4 回目に返る、と 1 回で返る、はどちらも同じ答えになる。
actor DirectingLog {
  private(set) var calls = 0
  func next() -> Int {
    calls += 1
    return calls
  }
}

/// 鍵 `"\(mode.rawValue)|\(legKey)"` ごとの回答。無い鍵は `notFound`。最初の `throttleFirst` 回は `throttled`。
struct FakeDirecting: Directing {
  var answers: [String: DirectionsAnswer] = [:]
  var throttleFirst = 0
  var delay: Duration = .zero
  let log = DirectingLog()

  func directions(_ request: RouteRequest) async throws -> DirectionsAnswer {
    if await log.next() <= throttleFirst { throw DirectionsFailure.throttled }
    try await Task.sleep(for: delay)
    guard let answer = answers["\(request.mode.rawValue)|\(request.legKey)"] else { throw DirectionsFailure.notFound }
    return answer
  }
}

/// 取り消されて畳まれた回数。**打ち切りが打ち切りであるためには、負けた側が本当に解ける
/// 必要がある** —— `withTaskGroup` は子が全部終わるまで返らないので、解けなければ `route` は
/// `.failed` を持ったまま 60 秒返らない。それを実時計で測らずに言い当てるための数え。
actor CancellationWitness {
  private(set) var unwound = 0
  func record() { unwound += 1 }
}

/// 答えない相手。60 秒黙る。取り消されたらそれを `witness` に残してから投げ直す。
struct HangingDirecting: Directing {
  let witness = CancellationWitness()

  func directions(_ request: RouteRequest) async throws -> DirectionsAnswer {
    do {
      try await Task.sleep(for: .seconds(60))
    } catch {
      await witness.record()
      throw error
    }
    return DirectionsAnswer(travelSeconds: 60, distanceMeters: nil, geometry: nil, expectedDeparture: nil)
  }
}
