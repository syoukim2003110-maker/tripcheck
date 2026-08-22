import Foundation
import Testing
@testable import TripCheckKit

/*
 * lib/feasibility-result.ts の移植テスト。ブリーフの 5 本 + `tests/feasibility-result.test.ts`
 * の 20 本。
 */

// MARK: - ブリーフの 5 本

@Test func stateDerivationFollowsThePriorityLadder() {
  let plan = TripBuilder.build(TestStops.swissRequest(days: 4))
  let fit = TestStops.fitStub(for: plan, requestedDays: 4)
  var opts = EvidenceSnapshotOptions(dateWasProvided: true, baseWasProvided: false, dayEndWasProvided: false)
  let r1 = Feasibility.derive(plan: plan, fit: fit, evidence: Feasibility.snapshot(plan: plan, options: opts))
  #expect(r1.state == .FEASIBLE_IF_ASSUMPTIONS || r1.state == .PROVISIONAL_FEASIBLE)
  opts.solverTimedOut = true
  let r2 = Feasibility.derive(plan: plan, fit: fit, evidence: Feasibility.snapshot(plan: plan, options: opts))
  #expect(r2.state == .UNKNOWN)
  #expect(r2.unknownCause == .COMPUTATION_LIMIT)
}

@Test func openingConflictsNeedVerifiedEvidenceToBeHard() {
  let (plan, fit) = TestStops.tokyoClosedOnFixedDay()
  let estimatedOnly = Feasibility.derive(
    plan: plan,
    fit: fit,
    evidence: Feasibility.snapshot(plan: plan, options: .init(dateWasProvided: true, baseWasProvided: false, dayEndWasProvided: true))
  )
  #expect(!estimatedOnly.conflicts.contains { $0.code == .CLOSED_ON_FIXED_DAY })
  var opts = EvidenceSnapshotOptions(dateWasProvided: true, baseWasProvided: false, dayEndWasProvided: true)
  opts.openingEvidenceByStop = [
    plan.days[0].stops[0].stop.id: .init(
      fetchedAt: "2026-08-09T00:00:00.000Z",
      providerRef: nil,
      dateSpecific: true,
      dateSpecificDates: ["2026-10-13"]
    )
  ]
  let verified = Feasibility.derive(plan: plan, fit: fit, evidence: Feasibility.snapshot(plan: plan, options: opts))
  #expect(verified.conflicts.contains { $0.code == .CLOSED_ON_FIXED_DAY })
  #expect(verified.state == .INFEASIBLE_HARD_CONFLICT)
}

@Test func conflictWeightsOrderThePrimaryConflict() {
  #expect(ConflictCode.AIRPORT_CUTOFF.weight == 7)
  #expect(ConflictCode.FIXED_BOOKING_LATE.weight == 6)
  #expect(ConflictCode.CLOSED_ON_FIXED_DAY.weight == 5)
  #expect(ConflictCode.LAST_ENTRY_CONFLICT.weight == 5)
  #expect(ConflictCode.OPENING_HOURS_CONFLICT.weight == 4)
  #expect(ConflictCode.PLACE_UNAVAILABLE.weight == 3)
  #expect(ConflictCode.DAY_END_OVERRUN.weight == 2)
  #expect(ConflictCode.DAY_CAPACITY.weight == 1)
  // TS `severity` (`:737-746`) covers all 8 codes, and `AssumptionCode` (`:92-106`) has 14.
  #expect(ConflictCode.allCases.count == 8)
  #expect(AssumptionCode.allCases.count == 14)
}

/// 判定と計画スナップショットは、どのエンジンが出した答えかを名乗る(TS `:5`, `:887`, `:901`)。
@Test func theVerdictStampsTheEngineVersionAndTheEvidenceItUsed() {
  let clean = cleanPlan()
  let evidence = syntheticSnapshot([.verified])
  let result = Feasibility.derive(plan: clean.plan, fit: clean.fit, evidence: evidence)
  #expect(ENGINE_VERSION == "tripcheck-feasibility-v0.1")
  #expect(result.engineVersion == ENGINE_VERSION)
  #expect(result.providerSnapshotHash == evidence.providerSnapshotHash)

  let snapshot = Feasibility.planSnapshot(id: "trip-1", plan: clean.plan, result: result, seed: 7, createdAt: "2026-08-09T00:00:00.000Z")
  #expect(snapshot.id == "trip-1")
  #expect(snapshot.engineVersion == ENGINE_VERSION)
  #expect(snapshot.providerSnapshotHash == evidence.providerSnapshotHash)
  #expect(snapshot.createdAt == "2026-08-09T00:00:00.000Z")
  #expect(snapshot.seed == 7)
  // `createdAt` を渡さなければ TS の `new Date().toISOString()` と同じ形。
  let now = Feasibility.planSnapshot(id: "trip-2", plan: clean.plan, result: result)
  #expect(now.seed == 0)
  #expect(now.createdAt.hasSuffix("Z"))
  #expect(now.createdAt.count == 24)
}

@Test func attentionsAreExclusiveAndOrderedAndSilentWhenConflicting() {
  let (plan, fit) = TestStops.tokyoLowBuffer()
  let r = Feasibility.derive(
    plan: plan,
    fit: fit,
    evidence: Feasibility.snapshot(plan: plan, options: .init(dateWasProvided: true, baseWasProvided: false, dayEndWasProvided: true))
  )
  #expect(r.primaryAttention?.code == .LOW_BUFFER || r.primaryAttention?.code == .UNVERIFIED_FACTS)
  #expect(r.conflicts.isEmpty || r.primaryAttention == nil)
}

@Test func snapshotHashIsStableAcrossKeyOrder() {
  let plan = TripBuilder.build(TestStops.swissRequest(days: 4))
  let a = Feasibility.snapshot(
    plan: plan,
    options: .init(dateWasProvided: true, baseWasProvided: false, dayEndWasProvided: false, capturedAt: "2026-08-09T00:00:00.000Z")
  )
  let b = Feasibility.snapshot(
    plan: plan,
    options: .init(dateWasProvided: true, baseWasProvided: false, dayEndWasProvided: false, capturedAt: "2026-08-09T00:00:00.000Z")
  )
  #expect(a.providerSnapshotHash == b.providerSnapshotHash)
  #expect(a.facts.count == b.facts.count)
}

// MARK: - ハッシュと直列化(TS `:207-223`)

/// TS `hashEvidenceFacts` (`lib/feasibility-result.ts:215-223`) の出力形式。期待値は TS の
/// アルゴリズム(0x811c9dc5 起点・UTF-16 コード単位・`Math.imul(_, 0x01000193)`・`>>> 0` の
/// 8 桁小文字 16 進)を Python に写して独立に計算したもので、Swift の実装から作ってはいない。
@Test func fnv1aMatchesTheTypeScriptOutputFormat() {
  #expect(FNV1a.hash32("") == "fnv1a-811c9dc5")
  #expect(FNV1a.hash32("a") == "fnv1a-e40c292c")
  #expect(FNV1a.hash32("[]") == "fnv1a-741638a5")
  // 空でない入力でも接頭辞 + ちょうど 8 桁。
  #expect(FNV1a.hash32("Senso-ji").hasPrefix("fnv1a-"))
  #expect(FNV1a.hash32("Senso-ji").count == 14)
}

/// TS `stableStringify` (`lib/feasibility-result.ts:207-212`) — キーをソートした JSON。
/// 期待文字列も同じ Python 転写から取った。
@Test func stableStringifySortsKeysAndWritesJavaScriptNumbers() {
  let fact = syntheticFact("fact-0", .verified)
  #expect(StableJSON.stringify([fact]) == #"[{"evidence":{"source":"google","status":"verified","value":1},"id":"fact-0","kind":"place_identity","label":"fact-0"}]"#)
  #expect(FNV1a.hashEvidenceFacts([fact]) == "fnv1a-98b29823")
  // 整数は JS と同じく `90`(`90.0` ではない)。
  #expect(StableJSON.stringify(JSONValue.number(90)) == "90")
  #expect(StableJSON.stringify(JSONValue.number(-0)) == "0")
  #expect(StableJSON.stringify(JSONValue.number(1.5)) == "1.5")
  #expect(StableJSON.stringify(nil) == "null")
  #expect(StableJSON.stringify(JSONValue.bool(true)) == "true")
  // 入れ子のオブジェクトもキー順に依存しない。
  let ordered = JSONValue.object(["b": .string("2"), "a": .string("1")])
  let reversed = JSONValue.object(["a": .string("1"), "b": .string("2")])
  #expect(StableJSON.stringify(ordered) == #"{"a":"1","b":"2"}"#)
  #expect(StableJSON.stringify(ordered) == StableJSON.stringify(reversed))
  // 文字列はエスケープされる。
  #expect(StableJSON.stringify(JSONValue.string("a\"b\nc")) == #""a\"b\nc""#)
}

/// 証拠のスナップショットは保存されるので、往復して同じものに戻らなければならない。
@Test func evidenceSnapshotRoundTripsThroughJSON() throws {
  let plan = TripBuilder.build(TestStops.tokyoRequest("Senso-ji\nTokyo Skytree", days: 1))
  let snapshot = Feasibility.snapshot(plan: plan, options: .init(
    dateWasProvided: true,
    baseWasProvided: false,
    dayEndWasProvided: false,
    capturedAt: "2026-08-09T00:00:00.000Z",
    solverTimedOut: true,
    transferBufferMinutes: 10
  ))
  let data = try JSONEncoder().encode(snapshot)
  let back = try JSONDecoder().decode(PlannerEvidenceSnapshot.self, from: data)
  #expect(back == snapshot)
  #expect(back.solverTimedOut == true)
  #expect(FNV1a.hashEvidenceFacts(back.facts) == snapshot.providerSnapshotHash)
}

// MARK: - tests/feasibility-result.test.ts の 20 本

/// TS `fact` (`tests/feasibility-result.test.ts:15-26`) — id から種類を決める合成の重要事実。
private func syntheticFact(_ id: String, _ status: EvidenceStatus) -> CriticalFact {
  CriticalFact(
    id: id,
    kind: id.hasPrefix("hours") ? .opening_hours : id.hasPrefix("route") ? .route_leg : .place_identity,
    label: id,
    evidence: Evidence(
      value: status == .unknown || status == .failed ? nil : .number(1),
      status: status,
      source: status == .user_provided ? .user : status == .verified ? .google : .derived
    )
  )
}

/// TS `snapshot` (`tests/feasibility-result.test.ts:28-36`)
private func syntheticSnapshot(_ statuses: [EvidenceStatus], solverTimedOut: Bool = false) -> PlannerEvidenceSnapshot {
  let facts = statuses.enumerated().map { index, status in syntheticFact("fact-\(index)", status) }
  return PlannerEvidenceSnapshot(
    facts: facts,
    capturedAt: "2026-08-09T00:00:00.000Z",
    providerSnapshotHash: FNV1a.hashEvidenceFacts(facts),
    solverTimedOut: solverTimedOut ? true : nil
  )
}

/// TS `cleanPlan` (`tests/feasibility-result.test.ts:38-42`)。`fit` は Task 17 が来るまで
/// `TestStops.fitStub` で代用する(`assessTripFit` はまだ無い)。
private func cleanPlan() -> (raw: String, plan: BuiltTripPlan, fit: TripFitAssessment) {
  let raw = "Senso-ji\nTokyo Skytree"
  let plan = TripBuilder.build(TestStops.tokyoRequest(raw, days: 1))
  return (raw, plan, TestStops.fitStub(for: plan, requestedDays: 1))
}

/// tests/feasibility-result.test.ts:44-68
@Test func mapsExplicitEvidenceToTheFiveFeasibilityStatesWithoutUpgradingUncertainty() {
  let clean = cleanPlan()
  #expect(Feasibility.derive(plan: clean.plan, fit: clean.fit, evidence: syntheticSnapshot([.verified, .user_provided])).state == .VERIFIED_FEASIBLE)
  #expect(Feasibility.derive(plan: clean.plan, fit: clean.fit, evidence: syntheticSnapshot([.verified, .estimated])).state == .PROVISIONAL_FEASIBLE)
  #expect(Feasibility.derive(plan: clean.plan, fit: clean.fit, evidence: syntheticSnapshot([.verified, .unknown])).state == .FEASIBLE_IF_ASSUMPTIONS)
  #expect(Feasibility.derive(plan: clean.plan, fit: clean.fit, evidence: syntheticSnapshot([.verified], solverTimedOut: true)).state == .UNKNOWN)

  var airportContext = PlannerContext()
  airportContext.arrivalAirport = "HND"
  airportContext.arrivalTime = "10:00"
  airportContext.flightKind = .international
  let conflictPlan = TripBuilder.build(TestStops.tokyoRequest("teamLab Planets — Day 1 12:00 booked", days: 1, context: airportContext))
  let conflictFit = TestStops.fitStub(for: conflictPlan, requestedDays: 1)
  #expect(Feasibility.derive(plan: conflictPlan, fit: conflictFit, evidence: syntheticSnapshot([.verified])).state == .INFEASIBLE_HARD_CONFLICT)

  let unknownPlan = TripBuilder.build(TestStops.tokyoRequest("Senso-ji\nA private cafe from my notes", days: 1))
  let unknownFit = TestStops.fitStub(for: unknownPlan, requestedDays: 1)
  #expect(Feasibility.derive(plan: unknownPlan, fit: unknownFit, evidence: syntheticSnapshot([.verified])).state == .UNKNOWN)
}

/// tests/feasibility-result.test.ts:70-88
@Test func countsVerifiedUserProvidedEstimatedAndUnknownCriticalFacts() {
  let clean = cleanPlan()
  let result = Feasibility.derive(
    plan: clean.plan,
    fit: clean.fit,
    evidence: syntheticSnapshot([.verified, .user_provided, .estimated, .unknown, .failed])
  )
  #expect(result.criticalFacts == CriticalFactCounts(total: 5, verified: 2, estimated: 1, unknown: 2, userProvided: 1))
  #expect(result.state != .VERIFIED_FEASIBLE)
}

/// tests/feasibility-result.test.ts:90-110
@Test func returnsStructuredBookingAndAirportConflictsWithAffectedItemsAndOverrun() {
  var context = PlannerContext()
  context.arrivalAirport = "HND"
  context.arrivalTime = "10:00"
  context.departureAirport = "HND"
  context.departureTime = "13:00"
  context.flightKind = .international
  let plan = TripBuilder.build(TestStops.tokyoRequest("teamLab Planets — Day 1 12:00 booked", days: 1, context: context))
  let fit = TestStops.fitStub(for: plan, requestedDays: 1)
  let result = Feasibility.derive(plan: plan, fit: fit, evidence: syntheticSnapshot([.verified]))

  #expect(result.state == .INFEASIBLE_HARD_CONFLICT)
  #expect(result.conflicts.contains { $0.code == .FIXED_BOOKING_LATE })
  #expect(result.conflicts.contains { $0.code == .AIRPORT_CUTOFF })
  #expect(result.primaryConflict != nil)
  // 重み順(空港 7 > 予約 6)が先頭を決める。
  #expect(result.primaryConflict?.code == .AIRPORT_CUTOFF)
}

/// tests/feasibility-result.test.ts:112-125
@Test func buildsAFactLevelSnapshotWithoutTreatingAResolvedPinAsVerifiedHours() {
  let clean = cleanPlan()
  let evidence = Feasibility.snapshot(
    plan: clean.plan,
    options: .init(dateWasProvided: false, baseWasProvided: false, dayEndWasProvided: false, capturedAt: "2026-08-09T00:00:00.000Z")
  )

  #expect(evidence.facts.filter { $0.kind == .place_identity && $0.evidence.status == .verified }.count == 2)
  // 取得されていない 2 件の営業時間だけが「行動できる unknown」。
  #expect(evidence.facts.filter { $0.kind == .opening_hours && $0.evidence.status == .unknown }.count == 2)
  // 日付なしの計画は明示されるが、プロバイダへの不可能な宿題にはならない。
  #expect(evidence.facts.first { $0.id == "assumption:date" }?.evidence.status == .estimated)
  #expect(evidence.facts.contains { $0.kind == .stay_duration && $0.evidence.status == .estimated })
  #expect(evidence.facts.contains { $0.id == "base" && $0.evidence.status == .unknown })
}

/// tests/feasibility-result.test.ts:127-140
@Test func sameFactsAndEngineInputsProduceAnIdenticalResultAndSnapshot() throws {
  let clean = cleanPlan()
  let evidence = syntheticSnapshot([.verified, .estimated, .unknown])
  let encoder = JSONEncoder()
  encoder.outputFormatting = [.sortedKeys]
  var serialized = Set<Data>()
  for _ in 0..<100 {
    let result = Feasibility.derive(plan: clean.plan, fit: clean.fit, evidence: evidence)
    let snapshot = Feasibility.planSnapshot(
      id: "trip-1",
      plan: clean.plan,
      result: result,
      seed: 7,
      createdAt: "2026-08-09T00:00:00.000Z"
    )
    serialized.insert(try encoder.encode(snapshot))
  }
  #expect(serialized.count == 1)
}

/// tests/feasibility-result.test.ts:142-162 の **Task 16 側の半分**。反実仮想の生成
/// (`generateTripCounterfactuals`)は Task 17 のもので、ここでは `derive` が受け取った候補を
/// 入力順のまま 3 件に切り詰めることだけを見る(TS `:884` の `alternatives.slice(0, 3)`)。
@Test func alternativesAreCappedAtThreeInInputOrder() {
  let clean = cleanPlan()
  let metrics = TripScenarioMetrics(hardConflictCount: 1, overrunMinutes: 30, minimumSlackMinutes: 0, scheduledStopCount: 2, dayCount: 1, travelMinutes: 40)
  let alternatives = (0..<5).map { index in
    AlternativePlan(
      id: "alt-\(index)",
      kind: index == 0 ? .CHANGE_DAYS : .REMOVE_OPTIONAL,
      change: .init(days: 2, stopId: "stop-\(index)"),
      before: metrics,
      after: metrics,
      improvement: .init(hardConflictsRemoved: 1, overrunMinutesReduced: 30, slackMinutesGained: 15, travelMinutesReduced: 0),
      loss: index == 0 ? nil : .init(kind: .OPTIONAL_STOP, stopId: "stop-\(index)")
    )
  }
  let result = Feasibility.derive(plan: clean.plan, fit: clean.fit, evidence: syntheticSnapshot([.verified]), alternatives: alternatives)
  #expect(result.alternatives.count == 3)
  #expect(result.alternatives.map(\.id) == ["alt-0", "alt-1", "alt-2"])
  #expect(result.alternatives[0].kind == .CHANGE_DAYS)
  #expect(result.alternatives[1].loss?.kind == .OPTIONAL_STOP)
}

/// tests/feasibility-result.test.ts:164-212
@Test func everyStructuredConflictReferencesFactsThatExistInTheSameEvidenceSnapshot() {
  struct Scenario {
    var raw: String
    var days: Int
    var context: PlannerContext
    var evidence: [String: OpeningHoursFactEvidence]
    var dayEndWasProvided: Bool
  }
  var bookingContext = PlannerContext()
  bookingContext.openingWindowsByDay = ["sensoji": [0: [VisitWindow(openMinutes: 11 * 60, closeMinutes: 17 * 60)]]]
  var curfewContext = PlannerContext()
  curfewContext.defaultDayStart = "09:00"
  curfewContext.dayEndTarget = "09:15"
  var closedContext = PlannerContext()
  closedContext.openingWindowsByDay = ["sensoji": [0: [], 1: []]]

  let cases: [Scenario] = [
    Scenario(
      raw: "Senso-ji — Day 1 10:00 booked",
      days: 1,
      context: bookingContext,
      evidence: ["sensoji": .init(fetchedAt: "2026-08-09T00:00:00.000Z", dateSpecific: true)],
      dayEndWasProvided: false
    ),
    Scenario(raw: "Senso-ji", days: 1, context: curfewContext, evidence: [:], dayEndWasProvided: true),
    Scenario(
      raw: "Senso-ji",
      days: 2,
      context: closedContext,
      evidence: ["sensoji": .init(fetchedAt: "2026-08-09T00:00:00.000Z", dateSpecific: true)],
      dayEndWasProvided: false
    ),
  ]

  for scenario in cases {
    let plan = TripBuilder.build(TestStops.tokyoRequest(scenario.raw, days: scenario.days, context: scenario.context))
    let fit = TestStops.fitStub(for: plan, requestedDays: scenario.days)
    let evidence = Feasibility.snapshot(plan: plan, options: .init(
      dateWasProvided: true,
      baseWasProvided: false,
      dayEndWasProvided: scenario.dayEndWasProvided,
      capturedAt: "2026-08-09T00:00:00.000Z",
      openingEvidenceByStop: scenario.evidence
    ))
    let ids = Set(evidence.facts.map(\.id))
    let result = Feasibility.derive(plan: plan, fit: fit, evidence: evidence)
    #expect(!result.conflicts.isEmpty, "\(scenario.raw)")
    for conflict in result.conflicts {
      #expect(!conflict.evidenceIds.isEmpty, "\(conflict.code) must explain itself")
      #expect(conflict.evidenceIds.allSatisfy { ids.contains($0) }, "\(conflict.code) has a dangling evidence id")
    }
  }
}

/// tests/feasibility-result.test.ts:214-234
@Test func coverageRetainsDeferredOptionalAndUnavailableRequestedPlaces() {
  var optionalContext = PlannerContext()
  optionalContext.openingWindowsByDay = ["tokyo-skytree": [0: []]]
  let optionalPlan = TripBuilder.build(TestStops.tokyoRequest("Senso-ji\nTokyo Skytree — optional", days: 1, context: optionalContext))
  let optionalEvidence = Feasibility.snapshot(
    plan: optionalPlan,
    options: .init(dateWasProvided: true, baseWasProvided: false, dayEndWasProvided: false)
  )
  #expect(optionalEvidence.facts.contains { $0.id == "place:tokyo-skytree" })
  #expect(optionalEvidence.facts.contains { $0.id == "hours:tokyo-skytree:deferred" })

  var unavailableContext = PlannerContext()
  unavailableContext.openingWindowsByDay = ["sensoji": [0: [], 1: []]]
  let unavailablePlan = TripBuilder.build(TestStops.tokyoRequest("Senso-ji", days: 2, context: unavailableContext))
  let unavailableEvidence = Feasibility.snapshot(plan: unavailablePlan, options: .init(
    dateWasProvided: true,
    baseWasProvided: false,
    dayEndWasProvided: false,
    openingEvidenceByStop: ["sensoji": .init(fetchedAt: "2026-08-09T00:00:00.000Z", dateSpecific: true)]
  ))
  #expect(unavailableEvidence.facts.contains { $0.id == "place:sensoji" })
  #expect(unavailableEvidence.facts.contains { $0.id == "hours:sensoji:unavailable" })
}

/// tests/feasibility-result.test.ts:236-259
@Test func failedAndTypicalWeekOpeningHoursCannotCreateAVerifiedHardConflict() {
  let clean = cleanPlan()
  var failed = syntheticSnapshot([.verified])
  failed.facts.append(syntheticFact("hours:provider-failed", .failed))
  failed.providerSnapshotHash = FNV1a.hashEvidenceFacts(failed.facts)
  let failedResult = Feasibility.derive(plan: clean.plan, fit: clean.fit, evidence: failed)
  #expect(failedResult.state == .FEASIBLE_IF_ASSUMPTIONS)
  #expect(failedResult.assumptions.contains { $0.code == .OPENING_HOURS_UNKNOWN && $0.evidenceIds.contains("hours:provider-failed") })

  var context = PlannerContext()
  context.openingWindowsByDay = ["sensoji": [0: []]]
  let closedPlan = TripBuilder.build(TestStops.tokyoRequest("Senso-ji — Day 1", days: 1, context: context))
  let closedFit = TestStops.fitStub(for: closedPlan, requestedDays: 1)
  let weeklyEvidence = Feasibility.snapshot(plan: closedPlan, options: .init(
    dateWasProvided: true,
    baseWasProvided: false,
    dayEndWasProvided: false,
    openingEvidenceByStop: ["sensoji": .init(fetchedAt: "2026-08-09T00:00:00.000Z", dateSpecific: false)]
  ))
  let result = Feasibility.derive(plan: closedPlan, fit: closedFit, evidence: weeklyEvidence)
  #expect(weeklyEvidence.facts.first { $0.id.hasPrefix("hours:sensoji:") }?.evidence.status == .estimated)
  #expect(!result.conflicts.contains { $0.code == .CLOSED_ON_FIXED_DAY })
  #expect(result.state != .INFEASIBLE_HARD_CONFLICT)
}

/// tests/feasibility-result.test.ts:261-277
@Test func perDayWindowProvenanceDoesNotUpgradeUntouchedDays() {
  var context = PlannerContext()
  context.dayStartTimes = [0: "08:30"]
  context.dayEndTimes = [0: "20:00"]
  let plan = TripBuilder.build(TestStops.tokyoRequest("Senso-ji\nTokyo Skytree", days: 2, context: context))
  let evidence = Feasibility.snapshot(plan: plan, options: .init(
    dateWasProvided: true,
    baseWasProvided: false,
    dayEndWasProvided: false,
    dayStartTimes: context.dayStartTimes,
    dayEndTimes: context.dayEndTimes
  ))

  #expect(evidence.facts.first { $0.id == "day-start:Day 1" }?.evidence.status == .user_provided)
  #expect(evidence.facts.first { $0.id == "day-end:Day 1" }?.evidence.status == .user_provided)
  #expect(evidence.facts.first { $0.id == "day-start:Day 2" }?.evidence.status == .estimated)
  #expect(evidence.facts.first { $0.id == "day-end:Day 2" }?.evidence.status == .estimated)
}

/// tests/feasibility-result.test.ts:279-290
@Test func aUserEnteredReservationSearchLinkIsNotProviderVerification() {
  let plan = TripBuilder.build(TestStops.tokyoRequest("Sushi Dai Ginza — 12:00 booked", days: 1))
  let evidence = Feasibility.snapshot(
    plan: plan,
    options: .init(dateWasProvided: true, baseWasProvided: false, dayEndWasProvided: false)
  )
  let identity = evidence.facts.first { $0.kind == .place_identity && $0.label.contains("Sushi Dai") }
  #expect(identity?.evidence.status == .unknown)
}

/// tests/feasibility-result.test.ts:292-302 の **Task 16 側の半分**。「日程の外にある Optional を
/// 消す提案はしない」の判定は `generateTripCounterfactuals`(Task 17)にあるので、ここでは
/// 先送りされた Optional が実際に日程の外にいることと、候補を渡さなければ提案が空であることを見る。
@Test func doesNotOfferRemovingAnOptionalStopThatIsAlreadyOutsideTheSchedule() {
  var context = PlannerContext()
  context.openingWindowsByDay = ["tokyo-skytree": [0: []]]
  let plan = TripBuilder.build(TestStops.tokyoRequest("Senso-ji\nTokyo Skytree — optional", days: 1, context: context))
  let fit = TestStops.fitStub(for: plan, requestedDays: 1)
  let result = Feasibility.derive(plan: plan, fit: fit, evidence: syntheticSnapshot([.verified]))

  #expect(plan.deferredOptionalStops.map(\.id) == ["tokyo-skytree"])
  #expect(!result.alternatives.contains { $0.kind == .REMOVE_OPTIONAL && $0.change.stopId == "tokyo-skytree" })
}

/// tests/feasibility-result.test.ts:304-340
@Test func routeProvenanceVerifiesOnlyTheExactDurationConsumedByTheSolver() {
  let raw = "Senso-ji\nteamLab Planets"
  let baseline = TripBuilder.build(TestStops.tokyoRequest(raw, days: 1))
  let baselineLeg = baseline.days[0].legs[0]
  let key = routeLegKey(baselineLeg.from.id, baselineLeg.to.id)
  var context = PlannerContext()
  context.liveTransitMinutes = [key: 17]
  let plan = TripBuilder.build(TestStops.tokyoRequest(raw, days: 1, context: context))
  let factId = "route:\(plan.days[0].label):\(baselineLeg.from.id):\(baselineLeg.to.id)"
  func routeEvidence(_ minutes: Int) -> RouteFactEvidence {
    RouteFactEvidence(
      legId: key,
      departureBucket: "2026-08-09T00:00:00.000Z",
      requestKey: "transit|\(key)|2026-08-09T00:00:00.000Z",
      status: .verified,
      fetchedAt: "2026-08-09T00:00:00.000Z",
      providerRef: "google_maps",
      minutes: minutes
    )
  }
  let mismatched = Feasibility.snapshot(plan: plan, options: .init(
    dateWasProvided: true,
    baseWasProvided: false,
    dayEndWasProvided: false,
    routeEvidenceByFactId: [factId: routeEvidence(31)]
  ))
  let matched = Feasibility.snapshot(plan: plan, options: .init(
    dateWasProvided: true,
    baseWasProvided: false,
    dayEndWasProvided: false,
    routeEvidenceByFactId: [factId: routeEvidence(17)]
  ))

  let suffix = ":\(baselineLeg.from.id):\(baselineLeg.to.id)"
  #expect(mismatched.facts.first { $0.id.contains(suffix) }?.evidence.status == .estimated)
  #expect(matched.facts.first { $0.id.contains(suffix) }?.evidence.status == .verified)
}

/// tests/feasibility-result.test.ts:342-364
@Test func undatedTransitDurationsStayHonestEstimatesInsteadOfImpossibleUnknownTasks() {
  let raw = "Senso-ji\nTokyo Skytree"
  let seed = TripBuilder.build(TestStops.tokyoRequest(raw, days: 1))
  let seedLeg = seed.days[0].legs[0]
  let legId = routeLegKey(seedLeg.from.id, seedLeg.to.id)
  var context = PlannerContext()
  context.legModeOverrides = [legId: .transit]
  let plan = TripBuilder.build(TestStops.tokyoRequest(raw, days: 1, context: context))
  let evidence = Feasibility.snapshot(
    plan: plan,
    options: .init(dateWasProvided: false, baseWasProvided: false, dayEndWasProvided: false)
  )
  let routeFact = evidence.facts.first { $0.id == "route:\(plan.days[0].label):\(seedLeg.from.id):\(seedLeg.to.id)" }
  let dateFact = evidence.facts.first { $0.id == "assumption:date" }

  #expect(routeFact?.evidence.status == .estimated)
  #expect(routeFact?.evidence.value == .number(Double(plan.days[0].legs[0].comparison.recommended.minutes)))
  #expect(routeFact?.evidence.explanation?.contains("undated planning estimate") == true)
  #expect(dateFact?.evidence.status == .estimated)
  #expect(dateFact?.evidence.value == .string("undated"))
}

/// tests/feasibility-result.test.ts:366-416
@Test func theReviewedUndatedGeographicPlaceFlowHasZeroUnconfirmedCriticalFacts() {
  let names = ["Zurich", "Interlaken", "Matterhorn", "Mont Blanc", "Linz"]
  let coordinates: [(Double, Double)] = [
    (47.3769, 8.5417),
    (46.6863, 7.8632),
    (45.9763, 7.6586),
    (45.8326, 6.8652),
    (48.3069, 14.286),
  ]
  let resolvedStops = names.enumerated().map { inputIndex, name in
    ResolvedStop(
      id: "google-reviewed-\(inputIndex)",
      providerRef: "ChIJ_reviewed_\(inputIndex)",
      name: name,
      area: name,
      latitude: coordinates[inputIndex].0,
      longitude: coordinates[inputIndex].1,
      sourceUrl: "https://maps.google.com/?cid=\(inputIndex + 1)",
      verifiedAt: "2026-08-13T00:00:00.000Z",
      confidence: .medium,
      planningDurationMinutes: 90,
      isAnchor: false,
      placeTypes: name == "Matterhorn" || name == "Mont Blanc" ? ["natural_feature"] : ["locality"],
      input: name,
      inputIndex: inputIndex,
      address: name
    )
  }
  var resolvedBase = resolvedStops[1]
  resolvedBase.id = "google-reviewed-base"
  resolvedBase.providerRef = "ChIJ_reviewed_base"
  resolvedBase.input = "Interlaken hotel"
  resolvedBase.name = "Reviewed Interlaken hotel"
  resolvedBase.placeTypes = ["lodging"]

  var context = PlannerContext()
  context.resolvedStops = resolvedStops
  context.resolvedBase = resolvedBase
  context.transferBufferMinutes = 10
  let plan = TripBuilder.build(TestStops.tokyoRequest(names.joined(separator: "\n"), days: 3, context: context))
  let fit = TestStops.fitStub(for: plan, requestedDays: 3)
  let evidence = Feasibility.snapshot(plan: plan, options: .init(
    dateWasProvided: false,
    baseWasProvided: true,
    dayEndWasProvided: false,
    transferBufferMinutes: 10
  ))
  let result = Feasibility.derive(plan: plan, fit: fit, evidence: evidence)

  #expect(result.criticalFacts.unknown == 0)
  #expect(result.primaryAttention?.code != .UNVERIFIED_FACTS)
  #expect(evidence.facts.filter { $0.kind == .opening_hours }.allSatisfy { $0.id == "assumption:date" })
  #expect(evidence.facts.filter { $0.kind == .route_leg && $0.id.hasPrefix("route:") }.allSatisfy { $0.evidence.status == .estimated })
}

/// tests/feasibility-result.test.ts:418-459
@Test func failedTransitEvidenceStaysFailedAndNonConvergenceIsAnExplicitCondition() throws {
  let raw = "Senso-ji\nteamLab Planets"
  let plan = TripBuilder.build(TestStops.tokyoRequest(raw, days: 1))
  let fit = TestStops.fitStub(for: plan, requestedDays: 1)
  let leg = try #require(plan.days[0].legs.first { $0.comparison.recommended.mode == .transit })
  let factId = "route:\(plan.days[0].label):\(leg.from.id):\(leg.to.id)"
  let legId = routeLegKey(leg.from.id, leg.to.id)
  let evidence = Feasibility.snapshot(plan: plan, options: .init(
    dateWasProvided: true,
    baseWasProvided: false,
    dayEndWasProvided: false,
    routeEvidenceByFactId: [factId: RouteFactEvidence(
      legId: legId,
      departureBucket: "2026-08-09T00:00:00.000Z",
      requestKey: "transit|\(legId)|2026-08-09T00:00:00.000Z",
      status: .failed,
      providerRef: "google_maps",
      minutes: nil
    )],
    transitConvergence: .init(nonConverged: true, stopReason: "max_iterations", iterations: 3, eventCount: 8)
  ))
  let result = Feasibility.derive(plan: plan, fit: fit, evidence: evidence)

  #expect(evidence.facts.first { $0.id == factId }?.evidence.status == .failed)
  #expect(evidence.facts.contains { $0.id == "assumption:transit-convergence" && $0.evidence.status == .unknown })
  #expect(result.state == .FEASIBLE_IF_ASSUMPTIONS)
  #expect(result.primaryAttention?.code == .TRANSIT_NON_CONVERGED)
  #expect(result.assumptions.contains { $0.code == .TRANSIT_NON_CONVERGED })
}

/// tests/feasibility-result.test.ts:461-484
@Test func aUserConfirmedLastEntryCutoffProducesAnExplainableHardConflict() {
  var context = PlannerContext()
  context.defaultDayStart = "16:40"
  context.durationOverrides = ["sensoji": 45]
  context.openingWindowsByDay = ["sensoji": [0: [VisitWindow(openMinutes: 9 * 60, closeMinutes: 18 * 60)]]]
  context.lastEntryTimes = ["sensoji": "16:30"]
  let plan = TripBuilder.build(TestStops.tokyoRequest("Senso-ji — Day 1", days: 1, context: context))
  let fit = TestStops.fitStub(for: plan, requestedDays: 1)
  let evidence = Feasibility.snapshot(plan: plan, options: .init(
    dateWasProvided: true,
    baseWasProvided: false,
    dayEndWasProvided: false,
    lastEntryEvidenceByStop: ["sensoji": .init(time: "16:30", status: .user_provided)]
  ))
  let result = Feasibility.derive(plan: plan, fit: fit, evidence: evidence)
  let conflict = result.conflicts.first { $0.code == .LAST_ENTRY_CONFLICT }

  #expect(result.state == .INFEASIBLE_HARD_CONFLICT)
  #expect(conflict != nil)
  #expect(conflict?.evidenceIds == ["last-entry:sensoji:Day 1"])
  #expect(evidence.facts.first { $0.id == "last-entry:sensoji:Day 1" }?.evidence.status == .user_provided)
}

/// tests/feasibility-result.test.ts:486-513
@Test func travellerSuppliedCoordinatesRemainUserProvidedRatherThanProviderVerified() {
  var context = PlannerContext()
  context.resolvedStops = [ResolvedStop(
    id: "manual-lookout",
    name: "My saved lookout",
    area: "Pinned on map",
    latitude: 35.7,
    longitude: 139.7,
    sourceUrl: "",
    verifiedAt: "",
    confidence: .low,
    planningDurationMinutes: 60,
    isAnchor: false,
    isUserEntered: true,
    userProvidedCoordinates: true,
    input: "My saved lookout",
    inputIndex: 0,
    address: "Pinned on map"
  )]
  let plan = TripBuilder.build(TestStops.tokyoRequest("My saved lookout", days: 1, context: context))
  let evidence = Feasibility.snapshot(
    plan: plan,
    options: .init(dateWasProvided: false, baseWasProvided: false, dayEndWasProvided: false)
  )

  let identity = evidence.facts.first { $0.id == "place:manual-lookout" }
  #expect(identity?.evidence.status == .user_provided)
  #expect(identity?.evidence.source == .user)
}

/// tests/feasibility-result.test.ts:515-539
@Test func mobilityLimitsAreEvidenceBackedAndALockedOverLimitWalkIsExplicit() {
  let raw = "Senso-ji\nTokyo Skytree"
  var initialContext = PlannerContext()
  initialContext.maxWalkingMinutesPerLeg = 5
  initialContext.maxTransfersPerLeg = 1
  let initial = TripBuilder.build(TestStops.tokyoRequest(raw, days: 1, context: initialContext))
  let firstLeg = initial.days[0].legs[0]
  var context = initialContext
  context.legModeOverrides = [routeLegKey(firstLeg.from.id, firstLeg.to.id): .walk]
  let plan = TripBuilder.build(TestStops.tokyoRequest(raw, days: 1, context: context))
  let fit = TestStops.fitStub(for: plan, requestedDays: 1)
  let evidence = Feasibility.snapshot(
    plan: plan,
    options: .init(dateWasProvided: false, baseWasProvided: false, dayEndWasProvided: false)
  )
  let result = Feasibility.derive(plan: plan, fit: fit, evidence: evidence)

  #expect(evidence.facts.first { $0.id == "mobility:walking-limit" }?.evidence.status == .user_provided)
  #expect(evidence.facts.first { $0.id == "mobility:transfer-limit" }?.evidence.status == .user_provided)
  #expect(result.primaryAttention?.code == .WALKING_LIMIT_EXCEEDED)
  #expect((result.primaryAttention?.minutes ?? 0) > 0)
}

/// tests/feasibility-result.test.ts:541-600
@Test func anExactOverLimitTransferCountIsSoftAttentionWhileMissingStepDataStaysUnknown() {
  let raw = "Senso-ji\nTokyo Skytree"
  let seed = TripBuilder.build(TestStops.tokyoRequest(raw, days: 1))
  let seedLeg = seed.days[0].legs[0]
  let legId = routeLegKey(seedLeg.from.id, seedLeg.to.id)
  var context = PlannerContext()
  context.tripStartDate = "2026-09-14"
  context.maxTransfersPerLeg = 1
  context.liveTransitMinutes = [legId: 12]
  context.liveTransitTransferCounts = [legId: 3]
  context.lockedOrderByDay = [0: [seedLeg.from.id, seedLeg.to.id]]
  context.legModeOverrides = [legId: .transit]
  let plan = TripBuilder.build(TestStops.tokyoRequest(raw, days: 1, context: context))
  let fit = TestStops.fitStub(for: plan, requestedDays: 1)
  let leg = plan.days[0].legs[0]
  let routeFactId = "route:\(plan.days[0].label):\(leg.from.id):\(leg.to.id)"
  let transferFactId = "transfers:\(plan.days[0].label):\(leg.from.id):\(leg.to.id)"
  let exactRouteEvidence = RouteFactEvidence(
    legId: legId,
    departureBucket: "2026-09-14T00:00:00.000Z",
    requestKey: "transit|\(legId)|2026-09-14T00:00:00.000Z",
    status: .verified,
    fetchedAt: "2026-08-09T00:00:00.000Z",
    providerRef: "google_maps",
    minutes: 12,
    transferCount: 3
  )
  let exactSnapshot = Feasibility.snapshot(plan: plan, options: .init(
    dateWasProvided: true,
    baseWasProvided: false,
    dayEndWasProvided: false,
    routeEvidenceByFactId: [routeFactId: exactRouteEvidence]
  ))
  let result = Feasibility.derive(plan: plan, fit: fit, evidence: exactSnapshot)
  let transferFact = exactSnapshot.facts.first { $0.id == transferFactId }

  #expect(leg.transferCount == 3)
  #expect(transferFact?.evidence.status == .verified)
  #expect(transferFact?.evidence.value == .number(3))
  // 乗換の好みを超えることは決して hard な衝突にならない。
  #expect(result.conflicts.isEmpty)
  #expect(result.primaryAttention?.code == .TRANSFER_LIMIT_EXCEEDED)
  #expect(result.primaryAttention?.transferCount == 3)
  #expect(result.primaryAttention?.transferLimit == 1)

  var noCount = exactRouteEvidence
  noCount.transferCount = nil
  let unknownSnapshot = Feasibility.snapshot(plan: plan, options: .init(
    dateWasProvided: true,
    baseWasProvided: false,
    dayEndWasProvided: false,
    routeEvidenceByFactId: [routeFactId: noCount]
  ))
  let unknownTransfer = unknownSnapshot.facts.first { $0.id == transferFactId }
  #expect(unknownTransfer?.evidence.status == .unknown)
  // 段数が返らなかったことを黙って「守れている」と読み替えない。
  #expect(unknownTransfer?.evidence.value == nil)

  var wrongBucket = exactRouteEvidence
  wrongBucket.minutes = 13
  let wrongBucketSnapshot = Feasibility.snapshot(plan: plan, options: .init(
    dateWasProvided: true,
    baseWasProvided: false,
    dayEndWasProvided: false,
    routeEvidenceByFactId: [routeFactId: wrongBucket]
  ))
  // 採用されなかった所要時間の証拠から来た段数は、選ばれたレグを裏づけられない。
  #expect(wrongBucketSnapshot.facts.first { $0.id == transferFactId }?.evidence.status == .unknown)
}
