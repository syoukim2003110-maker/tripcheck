import Testing
@testable import TripCheckKit

// task-11-brief.md §Step 1 tests.

@Test func dayStartsAtRequestedTimeUnlessArrivalFlightIsLater() {
  let s = TestStops.line(ids: ["a", "b"])
  let jp = Destinations.byId(.japan)
  let d = DayClock.buildDay(stops: s, index: 0, dayCount: 1, locale: .en, startBase: nil, endBase: nil, airportConstraints: [], constraints: [:], earlyVisitStopIds: [], foodStopIds: [], openingWindows: [:], destination: jp, requestedStart: "08:00", startDate: nil, travel: .default, dayEndTarget: nil, lockedOrder: [])
  #expect(d.startTime == "08:00")
  #expect(d.startAdjustedByArrival == false)
  let arrival = AirportConstraint(direction: .arrival, airport: "HND", flightTime: "10:00", cityTime: "12:30", cityTimeDayOffset: 0, airportMinutes: 90, transferMinutes: 60, transferCount: nil, sourceUrl: "", googleMapsUrl: nil)
  let d2 = DayClock.buildDay(stops: s, index: 0, dayCount: 1, locale: .en, startBase: nil, endBase: nil, airportConstraints: [arrival], constraints: [:], earlyVisitStopIds: [], foodStopIds: [], openingWindows: [:], destination: jp, requestedStart: "09:00", startDate: nil, travel: .default, dayEndTarget: nil, lockedOrder: [])
  #expect(d2.startTime == "12:30")
  #expect(d2.startAdjustedByArrival)
}

@Test func deadlineIsMinOfAirportAndCurfewAndOverrunIsCounted() {
  let s = TestStops.line(ids: ["a", "b", "c"], stayMinutes: 180)
  let jp = Destinations.byId(.japan)
  let dep = AirportConstraint(direction: .departure, airport: "HND", flightTime: "20:00", cityTime: "16:00", cityTimeDayOffset: 0, airportMinutes: 180, transferMinutes: 60, transferCount: nil, sourceUrl: "", googleMapsUrl: nil)
  let d = DayClock.buildDay(stops: s, index: 0, dayCount: 1, locale: .en, startBase: nil, endBase: nil, airportConstraints: [dep], constraints: [:], earlyVisitStopIds: [], foodStopIds: [], openingWindows: [:], destination: jp, requestedStart: "09:00", startDate: nil, travel: .default, dayEndTarget: "21:30", lockedOrder: [])
  #expect(d.deadline == "16:00")
  #expect(d.deadlineKind == .airport)
  #expect(d.deadlineOverrunMinutes > 0)
}

@Test func hotelRoundTripClosesTheLoopAndReturnLegHasNoBuffer() {
  let s = TestStops.line(ids: ["a", "b"])
  let base = TripBase(routeStop: TestStops.point(id: "hotel", lat: 35.69, lng: 139.70), query: "Shinjuku")
  let d = DayClock.buildDay(stops: s, index: 0, dayCount: 1, locale: .ja, startBase: base, endBase: base, airportConstraints: [], constraints: [:], earlyVisitStopIds: [], foodStopIds: [], openingWindows: [:], destination: Destinations.byId(.japan), requestedStart: "09:00", startDate: nil, travel: .default, dayEndTarget: nil, lockedOrder: [])
  #expect(d.hotelOutboundMinutes != nil)
  #expect(d.hotelInboundMinutes != nil)
  // brief の式は `o.mode == $1.comparison.recommended`(TransportMode と ModeEstimate の比較)で
  // 型が合わないため、同じ意味の `comparison.recommended.minutes` に直した。時計の中身は TS
  // `lib/trip-builder.ts:1579-1650` のとおり: 往路レグだけがバッファを足し(`:1597`)、
  // 各停留所は滞在 + 区間 + バッファ(`:1619-1622`)、復路レグはバッファなし(`:1641`)。
  #expect(d.totalMinutes == (d.hotelOutboundMinutes! + 10)
    + d.stops.reduce(0) { $0 + $1.stop.planningDurationMinutes }
    + d.legs.reduce(0) { $0 + $1.comparison.recommended.minutes + 10 }
    + d.hotelInboundMinutes!)
}

@Test func themeJoinsUpToThreeAreasOrSaysFreeDay() {
  let d = DayClock.buildDay(stops: [], index: 0, dayCount: 1, locale: .ja, startBase: nil, endBase: nil, airportConstraints: [], constraints: [:], earlyVisitStopIds: [], foodStopIds: [], openingWindows: [:], destination: Destinations.byId(.japan), requestedStart: nil, startDate: nil, travel: .default, dayEndTarget: nil, lockedOrder: [])
  #expect(d.theme == "自由に使える日")
}

// レビュー指摘(Task 11 fix round 1)の追加分。上の 4 本では 1 行も実行されていなかった 3 つの
// 契約 — 混雑の見立て・前日に落ちた締切・エリア名の見出し — をここで踏む。

@Test func crowdOutlookReadsTheWeekendAndThePeakHoursOfTheVisit() {
  let s = TestStops.line(ids: ["a"])
  let jp = Destinations.byId(.japan)
  // 2026-10-17 は土曜(`CalendarDate.weekday == 6`、TS `lib/trip-builder.ts:379-380` の
  // `getUTCDay()`)。12:00 着は TS `:382` のピーク帯 11:00–16:00 の中。
  // score = 1(非アンカー `:383`)+ 1(ピーク `:384`)+ 1(週末 `:385`)= 3 →
  // `levels[min(3, 3)]` = veryBusy(`:386-388`)。
  let weekend = DayClock.buildDay(stops: s, index: 0, dayCount: 1, locale: .en, startBase: nil, endBase: nil, airportConstraints: [], constraints: [:], earlyVisitStopIds: [], foodStopIds: [], openingWindows: [:], destination: jp, requestedStart: "12:00", startDate: "2026-10-17", travel: .default, dayEndTarget: nil, lockedOrder: [])
  #expect(weekend.date == "2026-10-17")
  #expect(weekend.label == "Day 1")
  let busy = weekend.stops[0].crowd
  #expect(busy?.level == .veryBusy)
  #expect(busy?.isWeekend == true)
  #expect(busy?.weekendUplift == 1)
  #expect(busy?.peakTime == true)
  // `TestStops.point` の confidence は medium。TS `:389` は "low" 以外をすべて medium に畳む。
  #expect(busy?.confidence == .medium)

  // 2026-10-15 は木曜、09:00 着(540 分)はピーク帯 660–960 の外。score = 1 → `levels[1]` = moderate。
  let weekday = DayClock.buildDay(stops: s, index: 0, dayCount: 1, locale: .en, startBase: nil, endBase: nil, airportConstraints: [], constraints: [:], earlyVisitStopIds: [], foodStopIds: [], openingWindows: [:], destination: jp, requestedStart: "09:00", startDate: "2026-10-15", travel: .default, dayEndTarget: nil, lockedOrder: [])
  let calm = weekday.stops[0].crowd
  #expect(calm?.level == .moderate)
  #expect(calm?.isWeekend == false)
  #expect(calm?.weekendUplift == 0)
  #expect(calm?.peakTime == false)

  // アンカー(`:383` で 2 点)+ ピーク + 週末 = 4。`levels` は 4 要素しかないので
  // `min(levels.count - 1, score)` が 3 に丸める(`:388`)。丸めを落とすと配列外参照になる。
  let anchor = [TestStops.point(id: "anchor", lat: 35.681236, lng: 139.767125, isAnchor: true)]
  let crowded = DayClock.buildDay(stops: anchor, index: 0, dayCount: 1, locale: .en, startBase: nil, endBase: nil, airportConstraints: [], constraints: [:], earlyVisitStopIds: [], foodStopIds: [], openingWindows: [:], destination: jp, requestedStart: "12:00", startDate: "2026-10-17", travel: .default, dayEndTarget: nil, lockedOrder: [])
  #expect(crowded.stops[0].crowd?.level == .veryBusy)

  // `date` は開始日 + index(`:1559` の `addDaysToIsoDate`)。2026-10-18 は日曜なので週末が続く。
  let second = DayClock.buildDay(stops: s, index: 1, dayCount: 2, locale: .ja, startBase: nil, endBase: nil, airportConstraints: [], constraints: [:], earlyVisitStopIds: [], foodStopIds: [], openingWindows: [:], destination: jp, requestedStart: "12:00", startDate: "2026-10-17", travel: .default, dayEndTarget: nil, lockedOrder: [])
  #expect(second.date == "2026-10-18")
  #expect(second.label == "2日目")
  #expect(second.stops[0].crowd?.isWeekend == true)

  // 日付を持たない日は見立てを出さない(`:376`)。
  let undated = DayClock.buildDay(stops: s, index: 0, dayCount: 1, locale: .en, startBase: nil, endBase: nil, airportConstraints: [], constraints: [:], earlyVisitStopIds: [], foodStopIds: [], openingWindows: [:], destination: jp, requestedStart: "12:00", startDate: nil, travel: .default, dayEndTarget: nil, lockedOrder: [])
  #expect(undated.date == nil)
  #expect(undated.stops[0].crowd == nil)
}

@Test func aDepartureThatFallsOnThePreviousDayKeepsItsClockFaceAndFlagsTheRollback() {
  let s = TestStops.line(ids: ["a", "b"])
  let jp = Destinations.byId(.japan)
  // 深夜 01:30 発の便で、市内を出る刻限が前日 23:30 に落ちている形(`cityTimeDayOffset == -1`)。
  // TS `:1653` は 1410 + (-1440) = -30 分、つまり「その日の 0:00 の 30 分前」を締切として持つ。
  let dep = AirportConstraint(direction: .departure, airport: "HND", flightTime: "01:30", cityTime: "23:30", cityTimeDayOffset: -1, airportMinutes: 120, transferMinutes: 60, transferCount: nil, sourceUrl: "", googleMapsUrl: nil)
  let d = DayClock.buildDay(stops: s, index: 1, dayCount: 2, locale: .en, startBase: nil, endBase: nil, airportConstraints: [dep], constraints: [:], earlyVisitStopIds: [], foodStopIds: [], openingWindows: [:], destination: jp, requestedStart: "09:00", startDate: nil, travel: .default, dayEndTarget: "22:00", lockedOrder: [])
  // 門限 22:00(1320 分)より空港の -30 分のほうが早い。飛行機は待たない(`:1658-1663`)。
  #expect(d.deadlineKind == .airport)
  // `clock(-30)` = ((-30 % 1440) + 1440) % 1440 = 1410 → 文字盤は 23:30 のまま(`:1692`、`:349-352`)。
  #expect(d.deadline == "23:30")
  // 文字盤だけでは「前日の」23:30 だと分からないので、この旗が要る(`:1693`)。
  #expect(d.deadlinePreviousDay == true)
  // `max(0, cursor - (-30))` = cursor + 30。cursor は `totalMinutes + startMinutes`(`:1672`)なので
  // 区間の分を手計算しなくても TS の算術をそのまま突き合わせられる。
  #expect(d.deadlineOverrunMinutes == d.totalMinutes + 9 * 60 + 30)
  #expect(d.deadlineOverrunMinutes > 0)

  // 出発便が縛るのは最終日だけ(`:1526`)。同じ制約でも初日には締切が立たず、旗も立たない。
  let notLast = DayClock.buildDay(stops: s, index: 0, dayCount: 2, locale: .en, startBase: nil, endBase: nil, airportConstraints: [dep], constraints: [:], earlyVisitStopIds: [], foodStopIds: [], openingWindows: [:], destination: jp, requestedStart: "09:00", startDate: nil, travel: .default, dayEndTarget: nil, lockedOrder: [])
  #expect(notLast.deadline == nil)
  #expect(notLast.deadlineKind == nil)
  #expect(notLast.deadlinePreviousDay == nil)
  #expect(notLast.deadlineOverrunMinutes == 0)
}

@Test func themeNamesTheFirstThreeDistinctAreasInVisitOrder() {
  let jp = Destinations.byId(.japan)
  // 訪問順を `lockedOrder` で固定して、`theme` が幾何最適化の結果ではなく「訪問順のエリア」
  // から作られること(`:1664`)だけを見る。3 番目は 1 番目と同じエリアなので重複が落ちる。
  let five = TestStops.line(ids: ["a", "b", "c", "d", "e"], areas: ["Shinjuku", "Shibuya", "Shinjuku", "Asakusa", "Ueno"])
  let d = DayClock.buildDay(stops: five, index: 0, dayCount: 1, locale: .en, startBase: nil, endBase: nil, airportConstraints: [], constraints: [:], earlyVisitStopIds: [], foodStopIds: [], openingWindows: [:], destination: jp, requestedStart: "09:00", startDate: nil, travel: .default, dayEndTarget: nil, lockedOrder: ["a", "b", "c", "d", "e"])
  #expect(d.stops.map(\.stop.id) == ["a", "b", "c", "d", "e"])
  // 重複を落とすと Shinjuku / Shibuya / Asakusa / Ueno の 4 件。見出しになるのは先頭 3 件だけで、
  // 区切りは中黒の前後に空白を置いた " · "(`:1669`)。
  #expect(d.theme == "Shinjuku · Shibuya · Asakusa")

  // 3 件に満たない日は切り詰めが起きない。
  let three = TestStops.line(ids: ["a", "b", "c"], areas: ["Ueno", "Asakusa", "Ueno"])
  let d2 = DayClock.buildDay(stops: three, index: 0, dayCount: 1, locale: .en, startBase: nil, endBase: nil, airportConstraints: [], constraints: [:], earlyVisitStopIds: [], foodStopIds: [], openingWindows: [:], destination: jp, requestedStart: "09:00", startDate: nil, travel: .default, dayEndTarget: nil, lockedOrder: ["a", "b", "c"])
  #expect(d2.theme == "Ueno · Asakusa")
}
