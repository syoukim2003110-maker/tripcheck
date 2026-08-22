import Foundation
import Testing
@testable import TripCheckKit

/// tests/golden-feasibility.test.ts:15-58 — the golden corpus's shape. These tests only check that
/// `PlannerContext` and `EvidenceSnapshotOptions` decode the fixture without loss and round-trip
/// through JSON; running all 500 scenarios through
/// `buildTripFromWishlist`/`deriveFeasibilityResult` is a later task's.

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

/// Task 16 で `evidence` が `EvidenceSnapshotOptions` になった。フィクスチャが使う 10 キーが
/// すべて型どおりに読めること(整数キーの `dayStartTimes`/`dayEndTimes`、証拠オブジェクトの
/// 入れ子、`status` の列挙)を、実際にその値を持つ場面で確かめる。
@Test func goldenEvidenceDecodesIntoSnapshotOptions() throws {
  let corpus = try GoldenCorpus.load()
  let first = corpus.scenarios[0]
  #expect(first.id == "tokyo-001-day_end_conflict")
  #expect(first.evidence.dateWasProvided)
  #expect(first.evidence.baseWasProvided == false)
  #expect(first.evidence.dayEndWasProvided)
  #expect(first.evidence.capturedAt == "2026-08-09T00:00:00.000Z")
  #expect(first.evidence.dayStartTimes?[0] == "09:00")
  #expect(first.evidence.dayEndTimes?[0] == "09:30")
  #expect(first.evidence.userDurationStopIds == ["fixture-tokyo-001-day-end"])
  #expect(first.evidence.openingEvidenceByStop?["fixture-tokyo-001-day-end"]?.dateSpecific == true)
  #expect(first.evidence.openingEvidenceByStop?["fixture-tokyo-001-day-end"]?.dateSpecificDates == ["2026-10-13"])
  // 未設定のキーは nil のまま(TS の `undefined`)。
  #expect(first.evidence.solverTimedOut == nil)
  #expect(first.evidence.routeEvidenceByFactId == nil)
  #expect(first.evidence.transitConvergence == nil)

  let lastEntry = try #require(corpus.scenarios.first { $0.evidence.lastEntryEvidenceByStop != nil })
  #expect(lastEntry.evidence.lastEntryEvidenceByStop?["fixture-tokyo-001-last-entry"]?.time == "16:30")
  #expect(lastEntry.evidence.lastEntryEvidenceByStop?["fixture-tokyo-001-last-entry"]?.status == .user_provided)
  #expect(lastEntry.oracle.requiredConflictCodes.contains(.LAST_ENTRY_CONFLICT))

  let timedOut = try #require(corpus.scenarios.first { $0.evidence.solverTimedOut == true })
  #expect(timedOut.oracle.expectedStateOneOf == [.UNKNOWN])
  #expect(timedOut.oracle.solverTimedOut == true)

  let unknownKinds = try #require(corpus.scenarios.first { $0.oracle.expectedUnknownKinds?.isEmpty == false })
  #expect(unknownKinds.oracle.expectedUnknownKinds?.allSatisfy { $0 == .base || $0 == .opening_hours } == true)
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
