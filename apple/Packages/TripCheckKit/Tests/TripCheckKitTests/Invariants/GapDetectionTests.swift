import Foundation
import Testing
@testable import TripCheckKit

/*
 * lib/gap-detection.ts の移植テスト。ブリーフの Step 1 の 4 本 + `tests/gap-detection.test.ts`
 * (10 本)を移す。
 */

// MARK: - ブリーフの Step 1(4 本)

@Test func bandBoundariesAreExact() {
  #expect(GapDetection.classify(minutes: 29) == .BELOW_MINIMUM); #expect(GapDetection.classify(minutes: 30) == .SHORT_30_TO_59)
  #expect(GapDetection.classify(minutes: 59) == .SHORT_30_TO_59); #expect(GapDetection.classify(minutes: 60) == .MEDIUM_60_TO_119)
  #expect(GapDetection.classify(minutes: 119) == .MEDIUM_60_TO_119); #expect(GapDetection.classify(minutes: 120) == .LONG_120_PLUS)
}

@Test func onlyLongGapsOpenAttractions() {
  let day = TestStops.dayWithGap(minutes: 120)
  #expect(GapDetection.primaryGapForFixture(day: day, dayIndex: 0)?.suggestionKinds.contains(.ATTRACTION) == true)
  #expect(GapDetection.primaryGapForFixture(day: TestStops.dayWithGap(minutes: 119), dayIndex: 0)?.suggestionKinds.contains(.ATTRACTION) == false)
}

@Test func fillerAllowanceGrowsEveryTwoHoursUpToThree() {
  #expect(GapDetection.dayFillerAllowance(slackMinutes: 0) == 1)
  #expect(GapDetection.dayFillerAllowance(slackMinutes: 119) == 1)
  #expect(GapDetection.dayFillerAllowance(slackMinutes: 240) == 2)
  #expect(GapDetection.dayFillerAllowance(slackMinutes: 385) == 3)
  #expect(GapDetection.dayFillerAllowance(slackMinutes: 1000) == 3)
}

@Test func primaryGapIsTheLargestTiesGoToVisitOrder() {
  let day = TestStops.dayWithGaps(minutes: [60, 90, 90])
  #expect(GapDetection.primaryGapForFixture(day: day, dayIndex: 0)?.availableMinutes == 90)
  #expect(GapDetection.primaryGapForFixture(day: day, dayIndex: 0)?.kind == .BETWEEN_ANCHORS)
}

// MARK: - `tests/gap-detection.test.ts` の残り(10 本)

/// TS の `classifyGapMinutes(121)` 確認(`tests/gap-detection.test.ts:22`)。ブリーフの Step 1
/// (`bandBoundariesAreExact`)は 29–120 しか見ないので、その先の 1 点だけここで足す。
@Test func bandBoundaryAt121StillLong() {
  #expect(GapDetection.classify(minutes: 121) == .LONG_120_PLUS)
}

private func clockText(_ value: Int) -> String {
  String(format: "%02d:%02d", value / 60, value % 60)
}

/// TS `betweenGap` (`tests/gap-detection.test.ts:25-41`)。2 件目の到着を `minutes` 分だけ後ろへ
/// 動かして、その間に開く BETWEEN_ANCHORS ギャップを 1 本だけ取り出す。
private func betweenGap(_ minutes: Int) -> [ItineraryGap] {
  let secondStart = 10 * 60 + 10 + minutes
  let day = GapDetectionDay(
    dayIndex: 0,
    startAt: "09:00",
    usableUntil: clockText(secondStart + 30),
    availableMinutes: secondStart + 30 - 9 * 60,
    returnTravelMinutes: 0,
    anchors: [
      GapScheduledAnchor(id: "a", startAt: "09:00", endAt: "10:00", coordinate: GeoPoint(latitude: 35, longitude: 139), travelFromPreviousMinutes: 0),
      GapScheduledAnchor(
        id: "b", startAt: clockText(secondStart), endAt: clockText(secondStart + 30),
        coordinate: GeoPoint(latitude: 35.01, longitude: 139.01), travelFromPreviousMinutes: 10
      ),
    ]
  )
  return GapDetection.detect(day: day).filter { $0.kind == .BETWEEN_ANCHORS }
}

/// TS "detects 30-minute-plus gaps and assigns deterministic suggestion bands"
/// (`tests/gap-detection.test.ts:43-56`).
@Test func detectsThirtyMinutePlusGapsWithDeterministicSuggestionBands() {
  #expect(betweenGap(29).isEmpty)  // 0–29 分は提案しない
  #expect(betweenGap(30)[0].sizeBand == .SHORT_30_TO_59)
  #expect(betweenGap(30)[0].suggestionKinds == [.CAFE, .BAKERY, .PARK, .LOOKOUT])
  #expect(betweenGap(59)[0].sizeBand == .SHORT_30_TO_59)
  #expect(betweenGap(60)[0].sizeBand == .MEDIUM_60_TO_119)
  #expect(betweenGap(60)[0].suggestionKinds == [.SMALL_FACILITY, .WALK, .CAFE_AND_WALK])
  #expect(betweenGap(119)[0].sizeBand == .MEDIUM_60_TO_119)
  // 120 分以上は普通の観光スポットも候補に加わる。
  #expect(betweenGap(120)[0].sizeBand == .LONG_120_PLUS)
  #expect(betweenGap(120)[0].availableMinutes == 120)
  #expect(betweenGap(120)[0].suggestionKinds == [.ATTRACTION, .SMALL_FACILITY, .WALK, .CAFE_AND_WALK])
  #expect(betweenGap(121)[0].sizeBand == .LONG_120_PLUS)  // 長いギャップも提案を作る
}

/// TS "labels before-first, between-anchor and before-hotel-return gaps"
/// (`tests/gap-detection.test.ts:58-82`).
@Test func labelsBeforeFirstBetweenAnchorAndBeforeHotelReturnGaps() {
  let input = GapDetectionDay(
    dayIndex: 2,
    startAt: "09:00",
    usableUntil: "14:10",
    availableMinutes: 310,
    startCoordinate: GeoPoint(latitude: 35, longitude: 139),
    endCoordinate: GeoPoint(latitude: 35.03, longitude: 139.03),
    returnTravelMinutes: 20,
    anchors: [
      GapScheduledAnchor(id: "a", startAt: "09:40", endAt: "10:10", coordinate: GeoPoint(latitude: 35.01, longitude: 139.01), travelFromPreviousMinutes: 10),
      GapScheduledAnchor(id: "b", startAt: "11:20", endAt: "12:20", coordinate: GeoPoint(latitude: 35.02, longitude: 139.02), travelFromPreviousMinutes: 10),
    ]
  )
  let gaps = GapDetection.detect(day: input)
  #expect(gaps.map { ($0.kind, $0.availableMinutes) }.elementsEqual([
    (.BEFORE_FIRST_ANCHOR, 30), (.BETWEEN_ANCHORS, 60), (.BEFORE_HOTEL_RETURN, 90),
  ], by: ==))
  #expect(gaps[1].routeSegment == .init(
    from: GeoPoint(latitude: 35.01, longitude: 139.01),
    to: GeoPoint(latitude: 35.02, longitude: 139.02)
  ))
}

/// TS "produces the same gap ids and ordering across 100 runs"
/// (`tests/gap-detection.test.ts:84-100`).
@Test func producesTheSameGapIdsAndOrderingAcross100Runs() {
  let input = GapDetectionDay(
    dayIndex: 0,
    startAt: "09:00",
    usableUntil: "13:00",
    availableMinutes: 240,
    returnTravelMinutes: 0,
    anchors: [
      GapScheduledAnchor(id: "a", startAt: "09:30", endAt: "10:00", coordinate: GeoPoint(latitude: 35, longitude: 139), travelFromPreviousMinutes: 0),
      GapScheduledAnchor(id: "b", startAt: "11:10", endAt: "12:30", coordinate: GeoPoint(latitude: 35.01, longitude: 139.01), travelFromPreviousMinutes: 10),
    ]
  )
  let signatures = Set((0..<100).map { _ in GapDetection.detect(day: input).map(\.id).joined(separator: "|") })
  #expect(signatures.count == 1)
}

/// TS "preserves chronological insertion order across midnight"
/// (`tests/gap-detection.test.ts:102-118`).
@Test func preservesChronologicalInsertionOrderAcrossMidnight() {
  let gaps = GapDetection.detect(day: GapDetectionDay(
    dayIndex: 0,
    startAt: "23:00",
    usableUntil: "02:00",
    availableMinutes: 180,
    returnTravelMinutes: 0,
    anchors: [
      GapScheduledAnchor(id: "late", startAt: "23:30", endAt: "23:45", coordinate: GeoPoint(latitude: 35, longitude: 139), travelFromPreviousMinutes: 0),
      GapScheduledAnchor(id: "after-midnight", startAt: "00:15", endAt: "00:30", coordinate: GeoPoint(latitude: 35.01, longitude: 139.01), travelFromPreviousMinutes: 0),
    ]
  ))
  #expect(gaps.map(\.startAt) == ["23:00", "23:45", "00:30"])
}

/// TS "adapts BuiltPlanDay and TripFitDay without owning planner logic"
/// (`tests/gap-detection.test.ts:120-150`).
@Test func adaptsBuiltPlanDayAndTripFitDayWithoutOwningPlannerLogic() {
  func stop(id: String, latitude: Double) -> RouteStop {
    RouteStop(
      id: id, name: id, area: "test", latitude: latitude, longitude: 139,
      sourceUrl: "https://example.com", verifiedAt: "2026-08-09",
      confidence: .medium, planningDurationMinutes: 30, isAnchor: false
    )
  }
  let first = stop(id: "a", latitude: 35)
  let second = stop(id: "b", latitude: 35.01)
  let leg = BuiltPlanLeg(
    from: first, to: second,
    comparison: ModeComparison(
      options: [],
      fastest: ModeEstimate(mode: .transit, minutes: 20),
      recommended: ModeEstimate(mode: .transit, minutes: 20)
    ),
    googleMapsUrls: [:], isLocalMealPause: false, walkingMinutes: 0, walkingLimitExceededMinutes: 0, transferCount: nil
  )
  let day = BuiltPlanDay(
    label: "Day 1", theme: "",
    stops: [
      BuiltPlanStop(stop: first, arrival: "09:00", departure: "10:00", kind: .place, priority: .normal, isReservation: false, reservationLateMinutes: 0, openingStatus: .unknown),
      BuiltPlanStop(stop: second, arrival: "11:00", departure: "12:00", kind: .place, priority: .normal, isReservation: false, reservationLateMinutes: 0, openingStatus: .unknown),
    ],
    legs: [leg],
    totalMinutes: 0,
    startTime: "09:00",
    requestedStartTime: "09:00",
    startAdjustedByArrival: false,
    finishTime: "12:00",
    hotelOutboundMinutes: nil,
    hotelInboundMinutes: 0,
    startBase: nil,
    endBase: nil,
    deadlineOverrunMinutes: 0,
    reservationConflictCount: 0,
    openingConflictCount: 0
  )
  let fit = TripFitDay(
    dayIndex: 0, label: "", startTime: "09:00", usableUntil: "12:00", availableMinutes: 180,
    plannedMinutes: 0, slackMinutes: 0, overrunMinutes: 0, placeCount: 0, placeCapacity: 0,
    excessPlaceCount: 0, hasScheduleConflict: false, limitedBy: .curfew
  )
  let gaps = GapDetection.detect(day: day, fitDay: fit, options: BuiltDayGapOptions(transferBufferMinutes: 10))
  #expect(gaps.map { ($0.kind, $0.availableMinutes) }.elementsEqual([(.BETWEEN_ANCHORS, 30)], by: ==))
}

/// TS "the day surfaces the gap worth filling, not the first one in visit order"
/// (`tests/gap-detection.test.ts:152-177`).
@Test func theDaySurfacesTheGapWorthFillingNotTheFirstOneInVisitOrder() {
  // 最初の停留所前の 35 分の待ちと、最後の停留所のあとの 6 時間の穴。位置で選ぶと 35 分に
  // カフェを勧めて午後には何も言わなくなる。
  let gaps = GapDetection.detect(day: GapDetectionDay(
    dayIndex: 0,
    startAt: "09:00",
    usableUntil: "21:30",
    availableMinutes: 750,
    startCoordinate: GeoPoint(latitude: 35.68, longitude: 139.7),
    endCoordinate: GeoPoint(latitude: 35.68, longitude: 139.7),
    returnTravelMinutes: 20,
    anchors: [
      GapScheduledAnchor(id: "a", startAt: "09:35", endAt: "11:00", coordinate: GeoPoint(latitude: 35.7, longitude: 139.8), travelFromPreviousMinutes: 0),
      GapScheduledAnchor(id: "b", startAt: "11:30", endAt: "14:40", coordinate: GeoPoint(latitude: 35.71, longitude: 139.81), travelFromPreviousMinutes: 20),
    ]
  ))

  #expect(gaps.map { ($0.kind, $0.availableMinutes) }.elementsEqual([
    (.BEFORE_FIRST_ANCHOR, 35), (.BEFORE_HOTEL_RETURN, 390),
  ], by: ==))
  #expect(gaps[0].availableMinutes == 35)  // 訪問順で最初のギャップは小さいほう
  #expect(GapDetection.primaryGap(gaps)?.availableMinutes == 390)
  #expect(GapDetection.primaryGap(gaps)?.kind == .BEFORE_HOTEL_RETURN)
}

/// TS "the primary gap is stable: equal sizes keep visit order, no gaps means none"
/// (`tests/gap-detection.test.ts:179-186`)。TS は `{id, availableMinutes}` だけの部分オブジェクトを
/// `as` でキャストして渡すが、Swift には構造的部分型がないので他フィールドはプレースホルダで
/// 埋めた完全な `ItineraryGap` を組む。
@Test func thePrimaryGapIsStableTiesKeepVisitOrderNoGapsMeansNone() {
  func gap(id: String, availableMinutes: Int) -> ItineraryGap {
    ItineraryGap(
      id: id, dayIndex: 0, kind: .BETWEEN_ANCHORS, sizeBand: .SHORT_30_TO_59,
      startAt: "00:00", endAt: "00:00", availableMinutes: availableMinutes,
      routeSegment: .init(from: nil, to: nil), suggestionKinds: []
    )
  }
  #expect(GapDetection.primaryGap([]) == nil)
  // 同値は入力順で決まらなければならない: 同じ日を組み直しても同じギャップが出る。
  #expect(GapDetection.primaryGap([gap(id: "early", availableMinutes: 60), gap(id: "late", availableMinutes: 60)])?.id == "early")
  #expect(GapDetection.primaryGap([gap(id: "only", availableMinutes: 45)])?.id == "only")
}

/// TS "a day's suggestion allowance comes from its own slack, not a constant"
/// (`tests/gap-detection.test.ts:188-203`).
@Test func aDaysSuggestionAllowanceComesFromItsOwnSlackNotAConstant() {
  #expect(GapDetection.dayFillerAllowance(slackMinutes: 0) == 1)
  #expect(GapDetection.dayFillerAllowance(slackMinutes: 45) == 1)
  #expect(GapDetection.dayFillerAllowance(slackMinutes: 119) == 1)
  #expect(GapDetection.dayFillerAllowance(slackMinutes: 120) == 1)
  #expect(GapDetection.dayFillerAllowance(slackMinutes: 239) == 1)
  #expect(GapDetection.dayFillerAllowance(slackMinutes: 240) == 2)
  #expect(GapDetection.dayFillerAllowance(slackMinutes: 385) == 3)
  // どれだけ空いていても上限は保たれる: 旅行者自身の行き先が主役であり続ける。
  #expect(GapDetection.dayFillerAllowance(slackMinutes: 600) == 3)
  #expect(GapDetection.dayFillerAllowance(slackMinutes: 24 * 60) == 3)
}

/// TS "the allowance never drops below one and never runs away on bad input"
/// (`tests/gap-detection.test.ts:205-216`).
@Test func theAllowanceNeverDropsBelowOneAndNeverRunsAwayOnBadInput() {
  #expect(GapDetection.dayFillerAllowance(slackMinutes: -120) == 1)
  #expect(GapDetection.dayFillerAllowance(slackMinutes: .nan) == 1)
  #expect(GapDetection.dayFillerAllowance(slackMinutes: .infinity) == 1)
  // 単調性: 空き時間が増えて提案件数が減ることはない。
  var previous = 0
  var minutes = 0
  while minutes <= 900 {
    let allowance = GapDetection.dayFillerAllowance(slackMinutes: Double(minutes))
    #expect(allowance >= previous || minutes == 0)
    previous = allowance
    minutes += 15
  }
}

// MARK: - TS の自分のテストが触れていない分岐(`:59-266` 逐語のうち)

/// `availableMinutes` を省いたときに `usableUntil` へ落ちる分岐(TS `:138-140`)。
/// `tests/gap-detection.test.ts` の `GapDetectionDay` リテラルはどれも `availableMinutes` を
/// 明示しており、この分岐を一度も踏まない。
@Test func fallsBackToUsableUntilWhenAvailableMinutesIsOmitted() {
  let gaps = GapDetection.detect(day: GapDetectionDay(
    dayIndex: 0,
    startAt: "09:00",
    usableUntil: "10:00",
    availableMinutes: nil,
    returnTravelMinutes: 0,
    anchors: [
      GapScheduledAnchor(id: "a", startAt: "09:00", endAt: "09:15", coordinate: GeoPoint(latitude: 35, longitude: 139), travelFromPreviousMinutes: 0),
    ]
  ))
  // dayEnd は usableUntil(10:00)から、09:15 の出発から 10:00 までの 45 分が
  // BEFORE_HOTEL_RETURN ギャップとして出る。
  #expect(gaps.map { ($0.kind, $0.availableMinutes) }.elementsEqual([(.BEFORE_HOTEL_RETURN, 45)], by: ==))

  // usableUntil が dayStart を下回るときは dayStart へ畳む(TS `:139`)ので、復路の余りは残らない。
  let noWindow = GapDetection.detect(day: GapDetectionDay(
    dayIndex: 0,
    startAt: "09:00",
    usableUntil: "08:00",
    availableMinutes: nil,
    returnTravelMinutes: 0,
    anchors: [
      GapScheduledAnchor(id: "a", startAt: "09:00", endAt: "09:15", coordinate: GeoPoint(latitude: 35, longitude: 139), travelFromPreviousMinutes: 0),
    ]
  ))
  #expect(noWindow.isEmpty)
}
