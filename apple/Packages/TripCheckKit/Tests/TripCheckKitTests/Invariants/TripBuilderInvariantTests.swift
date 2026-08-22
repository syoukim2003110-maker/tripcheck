import Foundation
import Testing
@testable import TripCheckKit

// task-15-brief.md §Step 1 — `buildTripFromWishlist`(`lib/trip-builder.ts:1938-2300`)の
// 名前付き不変条件。TS の `tests/trip-builder.test.ts` 全 56 件の移植は
// `Invariants/TripBuilderPortedTests.swift` にある。

@Test func swissSampleFillsFourDaysWithNoEmptyDay() {
  let plan = TripBuilder.build(TestStops.swissRequest(days: 4))
  #expect(plan.days.count == 4)
  #expect(plan.days.allSatisfy { !$0.stops.isEmpty })
  #expect(plan.destination == .switzerland)
  #expect(plan.scheduledStopCount == 8)
}

@Test func intercityLegsDoNotAllBecomeTaxis() {
  let plan = TripBuilder.build(TestStops.swissRequest(days: 4))
  let legs = plan.days.flatMap(\.legs)
  // brief は `$0.comparison.recommended == .transit` と書いていたが、`recommended` は
  // `ModeEstimate`(`TravelEstimates.swift:35`)であって `TransportMode` ではないので
  // `.mode` を読む。
  #expect(legs.contains { $0.comparison.recommended.mode == .transit })
}

@Test func mountainRailwayLegsNeverRecommendWalkOrTaxi() {
  let plan = TripBuilder.build(TestStops.swissRequest(days: 4))
  // brief は `leg.to.id.contains("jungfrau")` で絞っていたが、同じ brief が定める
  // `swissRequest` の id は `sample-0`…`sample-7`(`Geo/SwissSample.swift:15`)なので
  // その述語はどのレグにも当たらず、テストが空回りする。`PoiAccess.policy` が見るのは
  // **名前**(`Builder/PoiAccess.swift:253-263`)、そして制限は**どちらの端**に方針が
  // あっても掛かる(`allowedModes(from:to:)`)。実測ではこの 2 つの山頂は必ずその日の
  // 先頭に来る(= 常に `from` 側)ので、両端を見る。1 件も当たらなければ落とす。
  var checked = 0
  for leg in plan.days.flatMap(\.legs)
  where [leg.from.name, leg.to.name].contains(where: { $0.contains("Jungfraujoch") || $0.contains("Gornergrat") }) {
    checked += 1
    #expect(leg.comparison.recommended.mode == .transit)
  }
  #expect(checked > 0)
}

@Test func existingItineraryModeKeepsPastedOrderAsHardConstraint() {
  let raw = "Day 1\nUeno Park\nSenso-ji\nTokyo Skytree"
  var ctx = PlannerContext()
  ctx.resolvedStops = TestStops.tokyoResolved(["Ueno Park", "Senso-ji", "Tokyo Skytree"])
  let plan = TripBuilder.build(TripRequest(raw: raw, days: 1, pace: .balanced, locale: .en, context: ctx))
  #expect(plan.inputMode == .existing_itinerary)
  #expect(plan.days[0].stops.map(\.stop.name) == ["Ueno Park", "Senso-ji", "Tokyo Skytree"])
}

@Test func autoDestinationNeedsStrictMajorityElseWorldwide() {
  var ctx = PlannerContext()
  ctx.resolvedStops = TestStops.mixed(["JP", "JP", "CH", "CH"])
  let plan = TripBuilder.build(TripRequest(raw: TestStops.rawFor(ctx), days: 2, pace: .balanced, locale: .en, context: ctx))
  #expect(plan.destination == .worldwide)
  ctx.resolvedStops = TestStops.mixed(["JP", "JP", "JP", "CH"])
  #expect(TripBuilder.build(TripRequest(raw: TestStops.rawFor(ctx), days: 2, pace: .balanced, locale: .en, context: ctx)).destination == .japan)
}

@Test func tripDateDoesNotInheritDeviceTimeZone() {
  // Auckland の 2026-10-13 と LA の 2026-10-13 は同じ暦日として扱う(端末 TZ を見ない)
  let a = TripBuilder.build(TestStops.swissRequest(days: 2, startDate: "2026-10-13"))
  #expect(a.days[0].date == "2026-10-13")
  #expect(a.days[1].date == "2026-10-14")
}

@Test func thirteenthStopIsRefusedNotSilentlyDropped() {
  // ビルダー自身は 13 件を受け取らない前提(UI が止める)。受け取った場合は
  // `recognizedStopCount` に正直に出す(TS `:2274` は `activeStops.length` をそのまま返し、
  // `MAX_DAY_ASSIGNMENT_STOPS = 12`(`:1815`)は**日割り探索を諦める**だけで停留所は捨てない)。
  let plan = TripBuilder.build(TestStops.ringRequest(count: 13, days: 3))
  #expect(plan.recognizedStopCount == 13)
}

@Test func sameInputSameOutputAHundredTimes() throws {
  let enc = JSONEncoder()
  enc.outputFormatting = [.sortedKeys]
  let first = try enc.encode(TripBuilder.build(TestStops.swissRequest(days: 4)))
  for _ in 0..<100 { #expect(try enc.encode(TripBuilder.build(TestStops.swissRequest(days: 4))) == first) }
}
