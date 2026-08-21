import Foundation
import Testing
@testable import TripCheckKit

/// tests/golden-feasibility.test.ts:15-58 — the golden corpus's shape. These tests only check that
/// `PlannerContext` decodes the fixture without loss and round-trips through JSON; they do not run
/// `buildTripFromWishlist`/`deriveFeasibilityResult` (Task 16's job).

@Test func goldenContextsDecodeWithoutLoss() throws {
  let corpus = try GoldenCorpus.load()
  #expect(corpus.scenarios.count == 500)
  for s in corpus.scenarios {
    #expect(s.trip.context.resolvedStops?.isEmpty == false, "\(s.id)")
    #expect(s.trip.context.tripStartDate == "2026-10-13", "\(s.id)")
  }
  // JSON の整数キー(dayStartTimes の "0")が Int キーの辞書に入ること
  let one = corpus.scenarios[0].trip.context
  #expect(one.openingWindowsByDay?["fixture-tokyo-001-day-end"]?[0]?.first?.openMinutes == 480)
  #expect(one.durationOverrides?["fixture-tokyo-001-day-end"] == 120)
}

@Test func contextRoundTripsThroughJSON() throws {
  let corpus = try GoldenCorpus.load()
  let enc = JSONEncoder(); enc.outputFormatting = [.sortedKeys]
  for s in corpus.scenarios.prefix(50) {
    let data = try enc.encode(s.trip.context)
    let back = try JSONDecoder().decode(PlannerContext.self, from: data)
    // brief の `s.id` は非リテラル `String` を `Comment` 引数に直接渡していてコンパイルできない
    // (`ExpressibleByStringLiteral`/`ExpressibleByStringInterpolation` はリテラル構文にのみ効く)。
    // 同ファイル内の他の呼び出しと同じ文字列補間リテラルに直す。
    #expect(back == s.trip.context, "\(s.id)")
  }
}
