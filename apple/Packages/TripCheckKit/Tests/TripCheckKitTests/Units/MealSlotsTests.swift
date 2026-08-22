import Testing
@testable import TripCheckKit

// task-14-brief.md §Step 1 tests + tests/trip-builder.test.ts の食事枠のケースのうち、
// `buildTripFromWishlist` を通さずに書けるもの。
//
// brief の `#expect(lunch.id == "food-0-lunch")` だけは移植元と食い違う: TS の id は
// `food-${dayIndex + 1}-${kind}`(`lib/trip-builder.ts:565`)で 1 始まりなので、
// 1 日目の昼は `food-1-lunch`。移植元を正とした。

private let japan = Destinations.byId(.japan)

// MARK: - task-14-brief.md §Step 1

@Test func dinnerSlotDisappearsWhenDeadlineIsBeforeDinnerStart() {
  let day = TestStops.buildPlainDay(TestStops.line(ids: ["a", "b"]), index: 0, deadline: "16:00")
  let slots = MealSlots.build(days: [day], destination: japan, mealPlan: .all, locale: .ja)
  #expect(slots.contains { $0.kind == .lunch })
  #expect(!slots.contains { $0.kind == .dinner })
}

@Test func lunchSlotAnchorsOnLastStopReachedBeforeLunchEnd() {
  let day = TestStops.buildPlainDay(TestStops.line(ids: ["a", "b", "c"], stayMinutes: 90), index: 0)   // 09:00 開始
  let lunch = MealSlots.build(days: [day], destination: japan, mealPlan: .all, locale: .ja).first { $0.kind == .lunch }!
  #expect(lunch.displayTime >= "11:00" && lunch.displayTime <= "14:30")
  #expect(lunch.id == "food-1-lunch")
  #expect(lunch.dayIndex == 0)
  #expect(lunch.window == "11:00–14:30")
  #expect(lunch.probeTime == lunch.displayTime)
}

// 昼の錨は、昼の窓の終わりまでに着いている最後の停留所。窓が閉じたあとにしか着かない
// 停留所には決して寄りかからない(`lib/trip-builder.ts:513-517`)。
@Test func lunchNeverAnchorsOnAStopReachedAfterTheWindowCloses() {
  let day = dayFrom(windows: [("09:00", "11:00"), ("11:30", "13:30"), ("15:00", "17:00")], deadline: "22:00")
  let lunch = MealSlots.build(days: [day], destination: japan, mealPlan: .all, locale: .en).first { $0.kind == .lunch }!
  #expect(lunch.anchorStopId == "stop-1")
  #expect(lunch.displayTime == "12:45")
}

// MARK: - tests/trip-builder.test.ts

// 「can show dinner ideas without suggesting lunch」/「…keeps its lunch and dinner slots」の
// 食事枠についての主張。目的地のエリアプロファイルに当たらない停留所は、その国の料理語 3 つ。
@Test func mealPlanChoosesWhichSlotsAppear() {
  let day = TestStops.buildPlainDay(TestStops.line(ids: ["a", "b", "c", "d"], stayMinutes: 120), index: 0)
  #expect(MealSlots.build(days: [day], destination: japan, mealPlan: .all, locale: .en).map(\.kind) == [.lunch, .dinner])
  #expect(MealSlots.build(days: [day], destination: japan, mealPlan: .dinner, locale: .en).map(\.kind) == [.dinner])
  #expect(MealSlots.build(days: [day], destination: japan, mealPlan: .none, locale: .en).isEmpty)
  #expect(MealSlots.build(days: [day], destination: japan, mealPlan: .all, locale: .en).allSatisfy { $0.queryIdeas.count == 3 })
}

// 「a day that is still running at dinner time keeps its dinner slot」(2026-08-13 の規則)。
@Test func aDayStillRunningAtDinnerTimeKeepsItsDinnerSlot() {
  let day = dayFrom(windows: [("09:00", "11:00"), ("11:30", "13:30"), ("14:00", "15:00")], deadline: "22:00")
  let slots = MealSlots.build(days: [day], destination: japan, mealPlan: .all, locale: .en)
  #expect(slots.map(\.kind) == [.lunch, .dinner])
  #expect(slots.first { $0.kind == .dinner }?.displayTime == "17:30")
}

// 締切が無いときだけ残る旧規則: 15:30 より前に終わる日には夕食枠を出さない(`:500`)。
@Test func withoutADeadlineAMorningOnlyDayGetsNoDinnerSlot() {
  let day = dayFrom(windows: [("09:00", "10:00"), ("10:20", "11:00")], deadline: nil)
  #expect(MealSlots.build(days: [day], destination: japan, mealPlan: .all, locale: .en).map(\.kind) == [.lunch])
}

// 「a route that brackets the whole dinner window gets no dinner slot」。
@Test func aRouteThatBracketsTheWholeDinnerWindowGetsNoDinnerSlot() {
  let day = dayFrom(windows: [("16:00", "18:00"), ("18:30", "21:55")], deadline: "22:00")
  let slots = MealSlots.build(days: [day], destination: japan, mealPlan: .all, locale: .en)
  #expect(slots.filter { $0.kind == .dinner }.isEmpty)
  // 昼の窓にも一切かからないので昼も出ない(`:497`)。
  #expect(slots.isEmpty)
}

// MARK: - 出さない日 (lib/trip-builder.ts:480-481)

@Test func anEmptyDayAndAPreviousDayDeadlineGetNoSlots() {
  let empty = dayFrom(windows: [], deadline: nil)
  #expect(MealSlots.build(days: [empty], destination: japan, mealPlan: .all, locale: .en).isEmpty)

  var rolled = dayFrom(windows: [("09:00", "11:00"), ("11:30", "13:30")], deadline: "22:00")
  rolled.deadlinePreviousDay = true
  #expect(MealSlots.build(days: [rolled], destination: japan, mealPlan: .all, locale: .en).isEmpty)
}

// MARK: - エリアプロファイル (lib/trip-builder.ts:396-467)

@Test func aTokyoAreaProfileReplacesTheCountryWideCuisineWords() {
  let day = dayFrom(windows: [("09:00", "11:00"), ("11:30", "13:30")], deadline: "22:00", areas: ["Shinjuku", "Shinjuku"])
  let lunch = MealSlots.build(days: [day], destination: japan, mealPlan: .all, locale: .en).first { $0.kind == .lunch }!
  #expect(lunch.area == "Shinjuku")
  #expect(lunch.queryIdeas == ["yakitori & izakaya", "ramen", "late-night Japanese"])

  // 同じエリア名でも日本以外ではその国の料理語のまま(`:460-466` のコメント)。
  let swiss = MealSlots.build(days: [day], destination: Destinations.byId(.switzerland), mealPlan: .all, locale: .en)
  #expect(swiss.first { $0.kind == .lunch }!.queryIdeas == ["Swiss classics", "a mountain restaurant", "a café or bakery"])
}

// MARK: - 検索の中心は食事時刻の居場所 (lib/trip-builder.ts:525-547)

@Test func theSearchCentreFollowsWhereTheTravellerActuallyIs() {
  // 12:45(昼の窓の中点)には 2 つ目の停留所に滞在中なので、その座標そのもの。
  let staying = dayFrom(windows: [("09:00", "11:00"), ("11:30", "13:30")], deadline: "22:00")
  let lunch = MealSlots.build(days: [staying], destination: japan, mealPlan: .all, locale: .en).first { $0.kind == .lunch }!
  #expect(lunch.latitude == 35.681236)
  #expect(abs(lunch.longitude - 139.778197) < 0.0001)

  // 最終地点を出たあとに夕食なら、ホテルへの帰路の中間点。
  var withHotel = dayFrom(windows: [("09:00", "11:00"), ("11:30", "15:00")], deadline: "22:00")
  let hotel = TripBase(routeStop: TestStops.point(id: "hotel", lat: 35.7, lng: 139.9, stayMinutes: 0), query: "hotel")
  withHotel.endBase = hotel
  let dinner = MealSlots.build(days: [withHotel], destination: japan, mealPlan: .all, locale: .en).first { $0.kind == .dinner }!
  #expect(abs(dinner.latitude - (35.681236 + 35.7) / 2) < 1e-9)
  #expect(abs(dinner.longitude - (139.778197 + 139.9) / 2) < 0.0001)
}

// MARK: - helpers

/// `MealSlots.build` が読むのは各停留所の到着・出発時刻と座標、日のラベル/日付/締切だけなので、
/// 時計を組み直さずに「その形の 1 日」を直接置ける。座標は `TestStops.line` と同じ直線。
private func dayFrom(windows: [(String, String)], deadline: String?, areas: [String] = []) -> BuiltPlanDay {
  let stops = TestStops.line(ids: (0..<windows.count).map { "stop-\($0)" }, areas: areas)
  return BuiltPlanDay(
    label: "Day 1",
    date: "2026-09-12",
    theme: "",
    stops: windows.enumerated().map { index, window in
      BuiltPlanStop(
        stop: stops[index],
        arrival: window.0,
        departure: window.1,
        kind: .place,
        priority: .normal,
        isReservation: false,
        reservationLateMinutes: 0,
        openingStatus: .unknown
      )
    },
    legs: [],
    totalMinutes: 0,
    startTime: windows.first?.0 ?? "09:00",
    requestedStartTime: "09:00",
    startAdjustedByArrival: false,
    finishTime: windows.last?.1 ?? "09:00",
    deadline: deadline,
    deadlineOverrunMinutes: 0,
    reservationConflictCount: 0,
    openingConflictCount: 0
  )
}
