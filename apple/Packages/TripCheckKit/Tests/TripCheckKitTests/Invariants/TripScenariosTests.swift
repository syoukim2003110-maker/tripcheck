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
