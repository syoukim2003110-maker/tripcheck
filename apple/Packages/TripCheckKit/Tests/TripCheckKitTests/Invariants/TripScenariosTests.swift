import Foundation
import Testing
@testable import TripCheckKit

/*
 * lib/trip-scenarios.ts / lib/provisional-trip-length.ts の移植テスト。
 * ブリーフの 8 本 + `tests/trip-scenarios.test.ts`(23)/
 * `tests/days-undecided-complete-context.test.ts`(8)/
 * `tests/mandatory-edge-cases.test.ts` のうち本モジュールが満たせるもの。
 */

// MARK: - ブリーフの 8 本

@Test func onlyTheClockCanMakeADayImpossible() {
  // ペース超過(件数)だけの日は needs_change にならず、時計が入らないときだけ needs_change
  let req = TestStops.ringRequest(count: 6, days: 1, pace: .relaxed, stayMinutes: 30)   // 件数 6 > relaxed 3 だが時間は入る
  let plan = TripBuilder.build(req)
  let fit = TripScenarios.assessTripFit(req, plan: plan, options: .init())
  #expect(fit.status == .fits || fit.status == .tight)
}

@Test func minimumDaysSearchStopsAtTheFirstFittingCount() {
  let req = TestStops.swissRequest(days: 2)
  let plan = TripBuilder.build(req)
  let fit = TripScenarios.assessTripFit(req, plan: plan, options: .init())
  #expect((fit.minimumDays ?? 0) >= 2)
  #expect(fit.spareDays == nil || fit.spareDays! >= 0)
  #expect(fit.additionalDaysNeeded == max(0, (fit.minimumDays ?? 2) - 2))
}

@Test func timeoutYieldsNullMinimumNotAPartialAnswer() {
  let req = TestStops.ringRequest(count: 12, days: 2)
  let plan = TripBuilder.build(req)
  let fit = TripScenarios.assessTripFit(req, plan: plan, options: .init(timeout: .zero))
  #expect(fit.status == .timed_out)
  #expect(fit.minimumDays == nil)
  #expect(fit.solverTimedOut)
}

@Test func unresolvedInputKeepsStateIncompleteButNamesPartialMinimum() {
  let req = TestStops.swissRequest(days: 4, extraUnresolvedLines: ["Somewhere Nobody Knows"])
  let plan = TripBuilder.build(req)
  let fit = TripScenarios.assessTripFit(req, plan: plan, options: .init())
  #expect(fit.status == .incomplete)
  #expect(fit.partialMinimumDays != nil)
  #expect(fit.minimumDays == nil)
}

@Test func cutCandidatesExcludeMustBookedAndFixedTime() {
  let (req, plan) = TestStops.overloadedDay()   // 1 日に 6 件、うち 1 件 must・1 件 予約・1 件 optional
  let fit = TripScenarios.assessTripFit(req, plan: plan, options: .init())
  #expect(!fit.cutCandidates.contains { $0.priority == .must })
  #expect(fit.cutCandidates.first?.priority == .optional)
  #expect(fit.cutCandidates.count <= EngineConstants.cutCandidateLimit)
}

@Test func counterfactualsAreRealRebuildsAndCappedAtThree() {
  let (req, plan) = TestStops.overloadedDay()
  let fit = TripScenarios.assessTripFit(req, plan: plan, options: .init())
  let alts = TripScenarios.counterfactuals(req, plan: plan, fit: fit)
  #expect(alts.count <= 3)
  #expect(alts.contains { $0.kind == .CHANGE_DAYS })
  for a in alts {
    #expect(
      a.improvement.hardConflictsRemoved > 0
        || a.improvement.overrunMinutesReduced > 0
        || (a.improvement.slackMinutesGained ?? 0) > 0
        || a.improvement.travelMinutesReduced > 0
    )
  }
}

@Test func hotelChangeQualifiesOnlyWithRealImprovement() {
  let base = TripScenarioMetrics(hardConflictCount: 0, overrunMinutes: 0, minimumSlackMinutes: 60, scheduledStopCount: 8, dayCount: 4, travelMinutes: 400)
  // 60 分ちょうどは絶対しきい値に入る。
  #expect(TripScenarios.qualifiesHotelBaseChange(before: base, after: .init(hardConflictCount: 0, overrunMinutes: 0, minimumSlackMinutes: 60, scheduledStopCount: 8, dayCount: 4, travelMinutes: 340)))
  // 30 分 = 7.5% は絶対にも相対にも足りない。
  #expect(TripScenarios.qualifiesHotelBaseChange(before: base, after: .init(hardConflictCount: 0, overrunMinutes: 0, minimumSlackMinutes: 60, scheduledStopCount: 8, dayCount: 4, travelMinutes: 370)) == false)
}

@Test func daysUndecidedFixedPointAgreesWithItself() {
  let req = TestStops.swissRequest(days: 1)   // 未定扱いで探索
  let r = ProvisionalTripLength.resolve(request: req, recommendBase: { plan in TestStops.asResolved(plan.baseRecommendations.first?.base) })
  #expect(r.rounds <= 3)
  var ctx = req.context
  ctx.resolvedBase = r.base
  let settled = TripRequest(raw: req.raw, days: r.days, pace: req.pace, locale: req.locale, context: ctx)
  let plan = TripBuilder.build(settled)
  let fit = TripScenarios.assessTripFit(settled, plan: plan, options: .init())
  #expect(fit.minimumDays == r.days)   // 提示日数 = 計画の日数
}

// MARK: - tests/trip-scenarios.test.ts の 23 本

/// TS のこのファイルが使い回す 8 件のウィッシュリスト(`tests/trip-scenarios.test.ts:11-18`)。
private let eightPlaces = """
Ghibli Museum
Shibuya Sky
Senso-ji
Tokyo Skytree
teamLab Planets
Tsukiji Outer Market
Meiji Jingu
Akihabara
"""

/// TS のローカル `scenarioMetrics`(`tests/trip-scenarios.test.ts:20-29`)。
private func metrics(
  hardConflictCount: Int = 0,
  overrunMinutes: Int = 0,
  minimumSlackMinutes: Int? = 60,
  scheduledStopCount: Int = 2,
  dayCount: Int = 1,
  travelMinutes: Int = 1_000
) -> TripScenarioMetrics {
  TripScenarioMetrics(
    hardConflictCount: hardConflictCount,
    overrunMinutes: overrunMinutes,
    minimumSlackMinutes: minimumSlackMinutes,
    scheduledStopCount: scheduledStopCount,
    dayCount: dayCount,
    travelMinutes: travelMinutes
  )
}

/// TS `test("hotel change thresholds are inclusive at 60 minutes and 15 percent")`
///
/// TS は相対しきい値の下側を `travelMinutes: 170.2`(= 14.9%)で押さえるが、Swift の
/// `TripScenarioMetrics.travelMinutes` は `Int`(Task 16。実体は分の整数和)なので、同じ側の
/// 直近の整数 171(= 14.5%)で置き換えている。
@Test func hotelChangeThresholdsAreInclusiveAtSixtyMinutesAndFifteenPercent() {
  let before = metrics()
  #expect(TripScenarios.qualifiesHotelBaseChange(before: before, after: metrics(travelMinutes: 941)) == false)   // 59 分は絶対しきい値の下
  #expect(TripScenarios.qualifiesHotelBaseChange(before: before, after: metrics(travelMinutes: 940)) == true)    // 60 分は入る
  let shortTrip = metrics(travelMinutes: 200)
  #expect(TripScenarios.qualifiesHotelBaseChange(before: shortTrip, after: metrics(travelMinutes: 171)) == false)  // 14.5% は相対しきい値の下
  #expect(TripScenarios.qualifiesHotelBaseChange(before: shortTrip, after: metrics(travelMinutes: 170)) == true)   // 15% は入る
}

/// TS `test("resolving a hard conflict qualifies even without a travel saving")`
@Test func resolvingAHardConflictQualifiesEvenWithoutATravelSaving() {
  let before = metrics(hardConflictCount: 1, travelMinutes: 100)
  let after = metrics(hardConflictCount: 0, travelMinutes: 120)
  #expect(TripScenarios.qualifiesHotelBaseChange(before: before, after: after) == true)
}

/// TS `test("CHANGE_BASE uses re-solved metrics, stays bounded and excludes sub-threshold bases")`
@Test func changeBaseUsesResolvedMetricsStaysBoundedAndExcludesSubThresholdBases() throws {
  var context = PlannerContext()
  context.hotelQuery = "Shinjuku hotel"
  let qualifying = TripRequest(raw: "Senso-ji\nTokyo Skytree", days: 2, pace: .balanced, locale: .en, context: context)
  let qualifyingPlan = TripBuilder.build(qualifying)
  let qualifyingFit = TripScenarios.assessTripFit(qualifying, plan: qualifyingPlan)
  let alternatives = TripScenarios.counterfactuals(qualifying, plan: qualifyingPlan, fit: qualifyingFit)
  let baseChanges = alternatives.filter { $0.kind == .CHANGE_BASE }
  #expect(!baseChanges.isEmpty)
  #expect(baseChanges.allSatisfy { TripScenarios.qualifiesHotelBaseChange(before: $0.before, after: $0.after) })
  #expect(alternatives.count <= 3)

  // TS の `JSON.stringify` を 25 回。`.sortedKeys` で辞書の並びも固定する。
  let encoder = JSONEncoder()
  encoder.outputFormatting = [.sortedKeys]
  let signatures = try Set((0..<25).map { _ in
    try String(decoding: encoder.encode(TripScenarios.counterfactuals(qualifying, plan: qualifyingPlan, fit: qualifyingFit)), as: UTF8.self)
  })
  #expect(signatures.count == 1)

  let subThreshold = TripRequest(
    raw: "Meiji Jingu\nShibuya Sky\nSenso-ji\nTokyo Skytree",
    days: 2, pace: .balanced, locale: .en, context: context
  )
  let subThresholdPlan = TripBuilder.build(subThreshold)
  let subThresholdFit = TripScenarios.assessTripFit(subThreshold, plan: subThresholdPlan)
  let subThresholdAlternatives = TripScenarios.counterfactuals(subThreshold, plan: subThresholdPlan, fit: subThresholdFit)
  #expect(subThresholdAlternatives.contains { $0.kind == .CHANGE_BASE } == false)
}

/// TS `unevenDurationFixture`(`tests/trip-scenarios.test.ts:88-118`)
private func unevenDurationRequest(days: Int) -> TripRequest {
  let definitions: [(id: String, name: String, latitude: Double, longitude: Double, minutes: Int)] = [
    ("long-a", "Long A", 35, 139, 420),
    ("long-b", "Long B", 35.0001, 139.0001, 420),
    ("short-c", "Short C", 35, 140, 30),
    ("short-d", "Short D", 35.0001, 140.0001, 30),
  ]
  var context = PlannerContext()
  context.tripStartDate = "2026-09-01"
  context.defaultDayStart = "09:00"
  context.dayEndTarget = "22:00"
  context.transferBufferMinutes = 0
  context.resolvedStops = definitions.enumerated().map { inputIndex, definition in
    ResolvedStop(
      id: definition.id,
      name: definition.name,
      area: "Test",
      latitude: definition.latitude,
      longitude: definition.longitude,
      sourceUrl: "https://example.com/\(definition.id)",
      verifiedAt: "2026-08-09T00:00:00Z",
      confidence: .medium,
      planningDurationMinutes: definition.minutes,
      isAnchor: false,
      input: definition.name,
      inputIndex: inputIndex,
      address: "\(definition.name) address"
    )
  }
  return TripRequest(
    raw: definitions.map(\.name).joined(separator: "\n"),
    days: days, pace: .balanced, locale: .en, context: context
  )
}

/// TS `test("minimum-days search reassigns uneven stays and binds assumptions to the feasible candidate")`
@Test func minimumDaysSearchReassignsUnevenStaysAndBindsAssumptionsToTheFeasibleCandidate() {
  let selected = unevenDurationRequest(days: 2)
  let selectedFit = TripScenarios.assessTripFit(selected, plan: TripBuilder.build(selected))
  #expect(selectedFit.minimumDays == 2)   // 長い/長いで種を撒く幾何が偽の 3 日最短を作ってはいけない
  #expect(selectedFit.status == .fits)

  let oneDay = unevenDurationRequest(days: 1)
  let fromOneDay = TripScenarios.assessTripFit(oneDay, plan: TripBuilder.build(oneDay))
  #expect(fromOneDay.minimumDays == 2)
  #expect(fromOneDay.additionalDaysNeeded == 1)
  #expect(fromOneDay.minimumDaysAssumptions.dates == ["2026-09-01", "2026-09-02"])
  #expect(fromOneDay.minimumDaysAssumptions.dayWindows == [
    .init(dayIndex: 0, start: "09:00", end: "22:00"),
    .init(dayIndex: 1, start: "09:00", end: "22:00"),
  ])
}

/// TS `test("finds the minimum trip length with the deterministic planner")`
@Test func findsTheMinimumTripLengthWithTheDeterministicPlanner() {
  let request = TestStops.tokyoRequest(eightPlaces, days: 1)
  let fit = TripScenarios.assessTripFit(request, plan: TripBuilder.build(request))
  #expect(fit.minimumDays == 2)
  #expect(fit.additionalDaysNeeded == 1)
  #expect(fit.status == .needs_change)
}

/// TS `test("reports spare days when the wishlist needs less time than selected")`
@Test func reportsSpareDaysWhenTheWishlistNeedsLessTimeThanSelected() {
  let request = TestStops.tokyoRequest("Senso-ji\nTokyo Skytree", days: 3)
  let fit = TripScenarios.assessTripFit(request, plan: TripBuilder.build(request))
  #expect(fit.minimumDays == 1)
  #expect(fit.spareDays == 2)
  #expect(fit.additionalDaysNeeded == 0)
}

/// TS `test("subtracts arrival and airport departure constraints from usable time")`
@Test func subtractsArrivalAndAirportDepartureConstraintsFromUsableTime() {
  var context = PlannerContext()
  context.hotelQuery = "Ueno hotel"
  context.arrivalAirport = "HND"
  context.arrivalTime = "16:00"
  context.departureAirport = "NRT"
  context.departureTime = "14:00"
  context.flightKind = .international
  let request = TestStops.tokyoRequest("Senso-ji\nTokyo Skytree", days: 2, context: context)
  let fit = TripScenarios.assessTripFit(request, plan: TripBuilder.build(request))

  #expect(fit.days[0].startTime == "18:30")
  #expect(fit.days[0].usableUntil == "22:00")
  #expect(fit.days[0].availableMinutes == 210)
  #expect(fit.days[1].limitedBy == .airport)
  #expect(fit.days[1].usableUntil == "10:15")
  #expect(fit.days[1].availableMinutes == 75)
}

/// TS `test("evaluates each day against its own end time")`
@Test func evaluatesEachDayAgainstItsOwnEndTime() {
  var context = PlannerContext()
  context.dayStartTimes = [0: "09:00", 1: "10:00"]
  context.dayEndTarget = "22:00"
  context.dayEndTimes = [0: "12:00", 1: "23:00"]
  let request = TestStops.tokyoRequest("Senso-ji — Day 1\nTokyo Skytree — Day 2", days: 2, context: context)
  let fit = TripScenarios.assessTripFit(request, plan: TripBuilder.build(request))

  #expect(fit.days[0].usableUntil == "12:00")
  #expect(fit.days[0].availableMinutes == 180)
  #expect(fit.days[1].usableUntil == "23:00")
  #expect(fit.days[1].availableMinutes == 780)   // 隠れたペース上限ではなく利用者の時計の窓
}

/// TS `test("never suggests dropping a must-do or booked stop")`
@Test func neverSuggestsDroppingAMustDoOrBookedStop() {
  let raw = """
  Ghibli Museum — must
  Shibuya Sky — 10:00 booked
  Senso-ji
  Tokyo Skytree
  teamLab Planets
  """
  let request = TestStops.tokyoRequest(raw, days: 1)
  let fit = TripScenarios.assessTripFit(request, plan: TripBuilder.build(request))
  let ids = Set(fit.cutCandidates.map(\.id))

  #expect(ids.contains("ghibli-museum") == false)
  #expect(ids.contains("shibuya-sky") == false)
  #expect(!fit.cutCandidates.isEmpty)
}

/// TS `test("does not shorten below an explicitly pinned day")`
@Test func doesNotShortenBelowAnExplicitlyPinnedDay() {
  let request = TestStops.tokyoRequest("Senso-ji\nTokyo Skytree — Day 3", days: 4)
  let fit = TripScenarios.assessTripFit(request, plan: TripBuilder.build(request))
  #expect(fit.minimumDays == 3)
  #expect(fit.spareDays == 1)
}

/// TS `test("never calls a plan with an impossible fixed reservation a fit")`
@Test func neverCallsAPlanWithAnImpossibleFixedReservationAFit() {
  var context = PlannerContext()
  context.arrivalAirport = "HND"
  context.arrivalTime = "10:00"
  context.flightKind = .international
  let request = TestStops.tokyoRequest("teamLab Planets — Day 1 12:00 booked", days: 1, context: context)
  let plan = TripBuilder.build(request)
  let fit = TripScenarios.assessTripFit(request, plan: plan)

  #expect(plan.scheduleConflictCount == 1)
  #expect(fit.status == .needs_change)
  #expect(fit.minimumDays == nil)
  #expect(fit.scheduleConflictCount == 1)
  #expect(fit.days[0].hasScheduleConflict == true)
}

/// TS `test("does not report spare days while the selected plan still has a conflict")`
@Test func doesNotReportSpareDaysWhileTheSelectedPlanStillHasAConflict() {
  let request = TestStops.tokyoRequest("Senso-ji", days: 3)
  var conflicted = TripBuilder.build(request)
  // TS はスプレッドで衝突を 1 件挿した計画を作る(`tests/trip-scenarios.test.ts`)。
  conflicted.scheduleConflictCount = 1
  conflicted.days[0].reservationConflictCount = 1
  let fit = TripScenarios.assessTripFit(request, plan: conflicted)

  #expect(fit.minimumDays == 1)
  #expect(fit.status == .needs_change)
  #expect(fit.spareDays == nil)
}

/// TS `test("ignores the day pin of a stop the traveller removed")`
@Test func ignoresTheDayPinOfAStopTheTravellerRemoved() {
  var context = PlannerContext()
  context.excludedStopIds = ["tokyo-skytree"]
  let request = TestStops.tokyoRequest("Senso-ji\nTokyo Skytree — Day 3", days: 4, context: context)
  let plan = TripBuilder.build(request)
  let fit = TripScenarios.assessTripFit(request, plan: plan)

  #expect(plan.minimumPinnedDay == 1)
  #expect(fit.minimumDays == 1)
  #expect(fit.spareDays == 3)
}

/// TS `test("never proposes a scenario beyond the supported fourteen-day horizon")`
@Test func neverProposesAScenarioBeyondTheSupportedFourteenDayHorizon() {
  let request = TestStops.tokyoRequest("Senso-ji — Day 20", days: 1)
  let plan = TripBuilder.build(request)
  let fit = TripScenarios.assessTripFit(request, plan: plan)

  #expect(plan.minimumPinnedDay == 20)
  #expect(fit.minimumDays == nil)
  // Day 20 の固定は対応範囲の外。偽の探索を報告しない。
  #expect(fit.searchedThroughDays == 0)
}

/// TS `test("labels unresolved places as incomplete instead of claiming a clean fit")`
@Test func labelsUnresolvedPlacesAsIncompleteInsteadOfClaimingACleanFit() {
  let request = TestStops.tokyoRequest("Senso-ji\nA private cafe from my notes", days: 1)
  let fit = TripScenarios.assessTripFit(request, plan: TripBuilder.build(request))

  #expect(fit.status == .incomplete)
  #expect(fit.unresolvedCount == 1)
  #expect(fit.minimumDays == nil)
  #expect(fit.additionalDaysNeeded == nil)
  #expect(fit.spareDays == nil)
  #expect(fit.cutCandidates.isEmpty)
  #expect(fit.suggestedCutCount == 0)
}

/// TS `test("keeps place-count load as a soft diagnostic while resolution is incomplete")`
@Test func keepsPlaceCountLoadAsASoftDiagnosticWhileResolutionIsIncomplete() {
  let request = TestStops.tokyoRequest("\(eightPlaces)\nA private cafe from my notes", days: 1)
  let fit = TripScenarios.assessTripFit(request, plan: TripBuilder.build(request))

  #expect(fit.status == .incomplete)
  #expect(fit.days.contains { $0.excessPlaceCount > 0 })
  #expect(fit.minimumDays == nil)
  #expect(fit.additionalDaysNeeded == nil)
  #expect(fit.spareDays == nil)
  #expect(fit.cutCandidates.isEmpty)
  #expect(fit.suggestedCutCount == 0)
}

/// TS `test("treats an unavailable optional stop as a declared trade-off, not a hard conflict")`
@Test func treatsAnUnavailableOptionalStopAsADeclaredTradeOffNotAHardConflict() {
  var context = PlannerContext()
  context.openingWindowsByDay = ["tokyo-skytree": [0: []]]
  let request = TestStops.tokyoRequest("Senso-ji\nTokyo Skytree — optional", days: 1, context: context)
  let plan = TripBuilder.build(request)
  let fit = TripScenarios.assessTripFit(request, plan: plan)

  #expect(plan.deferredUnavailableStops.isEmpty)
  #expect(plan.deferredOptionalStops.map(\.id) == ["tokyo-skytree"])
  #expect(fit.unavailableCount == 0)
  #expect(fit.status != .incomplete)
}

/// TS `test("withholds fit and cut conclusions when a known place is unavailable")`
@Test func withholdsFitAndCutConclusionsWhenAKnownPlaceIsUnavailable() {
  var context = PlannerContext()
  context.openingWindowsByDay = ["sensoji": [0: [], 1: []]]
  let request = TestStops.tokyoRequest("Senso-ji\nTokyo Skytree", days: 2, context: context)
  let fit = TripScenarios.assessTripFit(request, plan: TripBuilder.build(request))

  #expect(fit.status == .incomplete)
  #expect(fit.unavailableCount == 1)
  #expect(fit.days.reduce(0) { $0 + $1.placeCount } == 1)
  #expect(fit.minimumDays == nil)
  #expect(fit.additionalDaysNeeded == nil)
  #expect(fit.spareDays == nil)
  #expect(fit.cutCandidates.isEmpty)
  #expect(fit.suggestedCutCount == 0)
}

/// TS `test("binds a minimum-day answer to the exact planning assumptions")`
@Test func bindsAMinimumDayAnswerToTheExactPlanningAssumptions() {
  var context = PlannerContext()
  context.tripStartDate = "2026-09-14"
  context.hotelQuery = "Ueno hotel"
  context.dayStartTimes = [0: "08:30"]
  context.dayEndTimes = [0: "20:30"]
  context.transferBufferMinutes = 20
  context.legModeOverrides = ["sensoji::tokyo-skytree": .walk]
  let request = TestStops.tokyoRequest("Senso-ji — Day 1 10:00 booked\nTokyo Skytree", days: 2, context: context)
  let fit = TripScenarios.assessTripFit(request, plan: TripBuilder.build(request))

  #expect(fit.minimumDaysAssumptions.dates[0] == "2026-09-14")
  #expect(fit.minimumDaysAssumptions.dayWindows[0] == .init(dayIndex: 0, start: "08:30", end: "20:30"))
  #expect(fit.minimumDaysAssumptions.transferBufferMinutes == 20)
  #expect(fit.minimumDaysAssumptions.lockedModes == [.init(legId: "sensoji::tokyo-skytree", mode: "walk")])
  #expect(fit.minimumDaysAssumptions.fixedBookings.contains { $0.stopId == "sensoji" && $0.time == "10:00" })
  #expect(fit.minimumDaysAssumptions.stayDurations.contains { $0.stopId == "tokyo-skytree" })
}

/// TS `now: () => tick++`(`tests/trip-scenarios.test.ts` の timeout 節)の Swift 版 —— 1 回読むごとに
/// 1ms 進む決定的な時計。`TripFitSearchOptions.clock` は `any Clock<Duration>` なので、`Instant` も
/// 自前で用意する。
private struct TickInstant: InstantProtocol {
  var milliseconds: Int
  func advanced(by duration: Duration) -> TickInstant {
    TickInstant(milliseconds: milliseconds + TripScenarios.wholeMilliseconds(duration))
  }
  func duration(to other: TickInstant) -> Duration { .milliseconds(other.milliseconds - milliseconds) }
  static func < (left: TickInstant, right: TickInstant) -> Bool { left.milliseconds < right.milliseconds }
}

private final class TickClock: Clock, @unchecked Sendable {
  typealias Instant = TickInstant
  private let lock = NSLock()
  private var tick = 0

  var now: TickInstant {
    lock.lock()
    defer { lock.unlock() }
    let value = tick
    tick += 1
    return TickInstant(milliseconds: value)
  }
  var minimumResolution: Duration { .milliseconds(1) }
  func sleep(until deadline: TickInstant, tolerance: Duration?) async throws {}
}

/// TS `test("returns an explicit timeout instead of a minimum-day claim")`
@Test func returnsAnExplicitTimeoutInsteadOfAMinimumDayClaim() {
  let request = TestStops.tokyoRequest(eightPlaces, days: 1)
  let fit = TripScenarios.assessTripFit(
    request,
    plan: TripBuilder.build(request),
    options: .init(timeout: .milliseconds(1), clock: TickClock())
  )
  #expect(fit.solverTimedOut == true)
  #expect(fit.status == .timed_out)
  #expect(fit.minimumDays == nil)
}

/// TS `test("the three-option shortlist retains a complete one-change repair when one exists")`
@Test func theThreeOptionShortlistRetainsACompleteOneChangeRepairWhenOneExists() {
  var context = PlannerContext()
  context.dayEndTarget = "18:00"
  let request = TestStops.tokyoRequest(eightPlaces, days: 1, context: context)
  let plan = TripBuilder.build(request)
  let fit = TripScenarios.assessTripFit(request, plan: plan)
  let alternatives = TripScenarios.counterfactuals(request, plan: plan, fit: fit)

  #expect(alternatives.count <= 3)
  // 実現可能な修復が「見栄えは良いがまだ衝突している比較」に押し出されてはいけない。
  #expect(alternatives.contains {
    $0.kind != .OPTIMIZE_ORDER && $0.after.hardConflictCount == 0 && $0.after.overrunMinutes == 0
  })
}

/// TS `test("a transport alternative is re-solved with the compared day's order locked")`
@Test func aTransportAlternativeIsResolvedWithTheComparedDaysOrderLocked() throws {
  let request = TestStops.tokyoRequest("Senso-ji\nTokyo Skytree", days: 1)
  let plan = TripBuilder.build(request)
  let fit = TripScenarios.assessTripFit(request, plan: plan)
  let alternatives = TripScenarios.counterfactuals(request, plan: plan, fit: fit)
  // AI の提案なしに、より速い決定的なモードを比較できる。
  let mode = try #require(alternatives.first { $0.kind == .CHANGE_MODE })

  #expect(mode.change.legId == "sensoji::tokyo-skytree")
  #expect(mode.change.mode == .taxi)
  #expect(mode.loss?.kind == .TRANSPORT_TRADEOFF)
  #expect((mode.improvement.slackMinutesGained ?? 0) > 0)
  // いま選ばれている計画には手を触れない。
  #expect(plan.days[0].stops.map(\.stop.id) == ["sensoji", "tokyo-skytree"])
}

/// TS `test("an existing itinerary compares its pasted order with a shorter in-day order")`
@Test func anExistingItineraryComparesItsPastedOrderWithAShorterInDayOrder() throws {
  let raw = "Day 1\nSenso-ji\nShibuya Sky\nTokyo Skytree"
  let request = TestStops.tokyoRequest(raw, days: 1)
  let plan = TripBuilder.build(request)
  let fit = TripScenarios.assessTripFit(request, plan: plan)
  let alternatives = TripScenarios.counterfactuals(request, plan: plan, fit: fit)

  // 貼られた順序が元の判定。
  #expect(plan.days[0].stops.map(\.stop.id) == ["sensoji", "shibuya-sky", "tokyo-skytree"])
  // Flow B は本当に短い順序があるとき必ずそれを見せる。
  let optimized = try #require(alternatives.first { $0.kind == .OPTIMIZE_ORDER })
  #expect((optimized.change.travelMinutesSaved ?? 0) > 0)
  #expect(optimized.loss?.kind == .ORIGINAL_ORDER)
  #expect(optimized.change.orderByDay?[0] != plan.days[0].stops.map(\.stop.id))

  var appliedContext = request.context
  appliedContext.lockedOrderByDay = optimized.change.orderByDay
  let applied = TripBuilder.build(TestStops.tokyoRequest(raw, days: 1, context: appliedContext))
  #expect(applied.days[0].stops.map(\.stop.id) == optimized.change.orderByDay?[0])
  // 順序が変わっても日割りは固定のまま。
  #expect(applied.days[0].label == plan.days[0].label)
}

// MARK: - tests/days-undecided-complete-context.test.ts の 8 本

/// TS `TOKYO_THREE`
private let tokyoThree = "Ghibli Museum\nShibuya Sky\nSenso-ji"

/// TS `contextFor`(`DAY_WINDOW = { defaultDayStart: "09:00", dayEndTarget: "16:00" }`)
private func tokyoThreeContext(_ base: ResolvedStop?) -> PlannerContext {
  var context = PlannerContext()
  context.defaultDayStart = "09:00"
  context.dayEndTarget = "16:00"
  context.resolvedBase = base
  return context
}

/// TS `resolve(...)`
private func resolveTokyoThree(
  _ itinerary: String = tokyoThree,
  requestedDays: Int = 3,
  daysUndecided: Bool = true,
  resolvedHotel: ResolvedStop? = nil
) -> ProvisionalTripLength.Resolution {
  ProvisionalTripLength.resolve(
    request: TripRequest(raw: itinerary, days: requestedDays, pace: .balanced, locale: .en, context: tokyoThreeContext(nil)),
    daysUndecided: daysUndecided,
    resolvedHotel: resolvedHotel,
    contextFor: tokyoThreeContext
  )
}

private func tokyoThreeFit(days: Int, base: ResolvedStop?) -> TripFitAssessment {
  TripScenarios.assessTripFit(
    TripRequest(raw: tokyoThree, days: days, pace: .balanced, locale: .en, context: tokyoThreeContext(base))
  )
}

/// TS `test("the day count the traveller is offered is the one their own plan reports")`
@Test func theDayCountTheTravellerIsOfferedIsTheOneTheirOwnPlanReports() {
  let provisional = resolveTokyoThree()
  let fitOfTheBuiltPlan = tokyoThreeFit(days: provisional.days, base: provisional.base)
  let reported = fitOfTheBuiltPlan.minimumDays ?? fitOfTheBuiltPlan.partialMinimumDays
  // 届いた計画を測り直したら、提案された数が返ってこなければならない。
  #expect(reported == provisional.days)
}

/// TS `test("probe and plan are measured against the same base")`
@Test func probeAndPlanAreMeasuredAgainstTheSameBase() {
  let provisional = resolveTokyoThree()
  // 計画が組まれた拠点は、提案が測られた拠点そのもの —— その同一性が修正の全部。
  let rebuilt = TripBuilder.build(
    TripRequest(raw: tokyoThree, days: provisional.days, pace: .balanced, locale: .en, context: tokyoThreeContext(provisional.base))
  )
  #expect(
    rebuilt.days.map { [$0.hotelOutboundMinutes, $0.hotelInboundMinutes, $0.deadlineOverrunMinutes] }
      == provisional.plan.days.map { [$0.hotelOutboundMinutes, $0.hotelInboundMinutes, $0.deadlineOverrunMinutes] }
  )
}

/// TS `test("a base-less probe really would have disagreed — this is the defect, stated")`
@Test func aBaseLessProbeReallyWouldHaveDisagreed() {
  let baseless = tokyoThreeFit(days: 3, base: nil)
  let provisional = resolveTokyoThree()
  let withBase = tokyoThreeFit(days: provisional.days, base: provisional.base)
  let baselessMinimum = baseless.minimumDays ?? baseless.partialMinimumDays
  let settledMinimum = withBase.minimumDays ?? withBase.partialMinimumDays
  #expect(settledMinimum == provisional.days)
  if provisional.base != nil {
    // 届いた計画は本当に拠点の代金を払っている。
    #expect(provisional.plan.days.contains { ($0.hotelOutboundMinutes ?? 0) > 0 || ($0.hotelInboundMinutes ?? 0) > 0 })
    // 拠点を無視すると長さを過小に言うことしかできない。過大には決してならない。
    #expect(baselessMinimum == nil || settledMinimum == nil || baselessMinimum! <= settledMinimum!)
  }
}

/// TS `test("the same input settles on the same day count and base every time")`
@Test func theSameInputSettlesOnTheSameDayCountAndBaseEveryTime() {
  let first = resolveTokyoThree()
  for _ in 0..<100 {
    let again = resolveTokyoThree()
    #expect(again.days == first.days)
    #expect(again.base?.id == first.base?.id)
    #expect(again.plan.days.count == first.plan.days.count)
  }
}

/// TS `test("the search is bounded and reports whether it settled")`
@Test func theSearchIsBoundedAndReportsWhetherItSettled() {
  let provisional = resolveTokyoThree()
  #expect(provisional.rounds >= 1 && provisional.rounds <= ProvisionalTripLength.maxRounds)
  // 東京 3 件は自己整合な組に届かなければならない。
  #expect(provisional.settled == true)
}

/// TS `test("a traveller who names a length keeps it, and still gets a base-aware plan")`
@Test func aTravellerWhoNamesALengthKeepsItAndStillGetsABaseAwarePlan() {
  let chosen = resolveTokyoThree(requestedDays: 2, daysUndecided: false)
  #expect(chosen.days == 2)   // 名乗られた長さは決して上書きしない
  #expect(chosen.plan.days.count == 2)
  let rebuilt = TripBuilder.build(
    TripRequest(raw: tokyoThree, days: 2, pace: .balanced, locale: .en, context: tokyoThreeContext(chosen.base))
  )
  #expect(chosen.plan.days.map { $0.startBase?.id } == rebuilt.days.map { $0.startBase?.id })
}

/// TS `test("a traveller's own hotel is never replaced by a provisional area")`
@Test func aTravellersOwnHotelIsNeverReplacedByAProvisionalArea() {
  let hotel = ResolvedStop(
    id: "traveller-hotel",
    name: "Hotel Gajoen",
    area: "Meguro",
    latitude: 35.6339,
    longitude: 139.7157,
    sourceUrl: "",
    verifiedAt: "",
    confidence: .medium,
    planningDurationMinutes: 0,
    isAnchor: false,
    input: "Hotel Gajoen",
    address: "Meguro"
  )
  let provisional = resolveTokyoThree(resolvedHotel: hotel)
  #expect(provisional.base?.id == "traveller-hotel")
}

// MARK: - tests/mandatory-edge-cases.test.ts

/// TS `test("mandatory case: a hotel/base change is returned only after a measured counterfactual improvement")`
@Test func aHotelBaseChangeIsReturnedOnlyAfterAMeasuredCounterfactualImprovement() throws {
  var context = PlannerContext()
  context.hotelQuery = "hotel near Shinjuku Station"
  context.tripStartDate = "2026-09-14"
  context.dayEndTarget = "22:00"
  let request = TestStops.tokyoRequest("Senso-ji\nTokyo Skytree", days: 1, context: context)
  let plan = TripBuilder.build(request)
  let fit = TripScenarios.assessTripFit(request, plan: plan)
  let alternatives = TripScenarios.counterfactuals(request, plan: plan, fit: fit)
  // 決定的な拠点候補が、より近い拠点を見せるはず。
  let baseChange = try #require(alternatives.first { $0.kind == .CHANGE_BASE })

  #expect((baseChange.improvement.slackMinutesGained ?? 0) > 0)
  #expect(baseChange.after.hardConflictCount <= baseChange.before.hardConflictCount)
  #expect(baseChange.change.baseId != plan.selectedBase?.id)
}
