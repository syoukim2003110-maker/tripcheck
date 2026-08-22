import Testing
@testable import TripCheckKit

// task-12-brief.md §Step 1 の 5 本 + TS `tests/trip-builder.test.ts` から
// ビルダ全体なしで動かせるケースの移植。

// MARK: - brief §Step 1

@Test func clustersSeedWestmostThenFarthestPointWithCapacityCeil() {
  let stops = TestStops.twoClusters()
  let c = Clustering.clusterStops(stops, requestedDays: 2)
  #expect(c.count == 2)
  #expect(c.map(\.count) == [4, 4])
  #expect(c[0].first?.id == stops.min { $0.longitude < $1.longitude }?.id)
  // 種は最西端(吉祥寺側)、2 つ目の種はそこから最も遠い点(東京駅側)。並びまで含めて
  // TS `lib/trip-builder.ts:949-984` を Python に写した参照実装と一致する。
  #expect(c[0].map(\.id) == ["kichijoji-3", "kichijoji-2", "kichijoji-1", "kichijoji-0"])
  #expect(c[1].map(\.id) == ["tokyo-2", "tokyo-3", "tokyo-1", "tokyo-0"])
}

@Test func fixedDaysMoveOnlyPinnedStops() {
  let stops = TestStops.line(ids: ["a", "b", "c", "d"])
  var cons: [String: WishlistStopConstraint] = [:]
  cons["d"] = WishlistStopConstraint(priority: .normal, fixedDay: 1, fixedTime: nil, fixedTimeMinutes: nil, timeOfDay: nil, isReservation: false, stayMinutes: nil)
  let c = Clustering.applyFixedDays(Clustering.clusterStops(stops, requestedDays: 2), constraints: cons)
  #expect(c[0].contains { $0.id == "d" })
  #expect(c.flatMap { $0 }.count == 4)
}

@Test func stopsClosedAllDaysBecomeUnavailableOptionalOnesDeferred() {
  let stops = TestStops.line(ids: ["a", "b"])
  let avail: [String: IntKeyedDictionary<[VisitWindow]>] = ["b": [0: [], 1: []]]   // 全日 closed_day
  let r = Clustering.applyOpeningDays([[stops[0]], [stops[1]]], constraints: [:], availability: avail, capacity: 4)
  #expect(r.unavailable.map(\.id) == ["b"])
  #expect(r.clusters.map { $0.map(\.id) } == [["a"], []])
}

@Test func dayBudgetTrimDropsUnpinnedOptionalsOnly() {
  let stops = TestStops.line(ids: ["a", "b", "c", "d"], stayMinutes: 200)   // 4×200 + 3×35 = 905 > 570
  var cons: [String: WishlistStopConstraint] = [:]
  cons["c"] = WishlistStopConstraint(priority: .optional, fixedDay: nil, fixedTime: nil, fixedTimeMinutes: nil, timeOfDay: nil, isReservation: false, stayMinutes: nil)
  cons["d"] = WishlistStopConstraint(priority: .optional, fixedDay: 1, fixedTime: nil, fixedTimeMinutes: nil, timeOfDay: nil, isReservation: false, stayMinutes: nil)
  let r = Clustering.trimToDayBudget([stops], constraints: cons, budget: 570)
  #expect(r.deferred.map(\.id) == ["c"])          // 日固定の任意 d は残して正直に超過表示
  #expect(r.clusters[0].map(\.id) == ["a", "b", "d"])
}

@Test func themeParkAnchorsStartTheDayAndPushNeighboursOut() {
  // brief の版は 1 クラスタ + `constraint.stayMinutes` だったが、TS `:2152` は
  // `clusters.length > 1` を要求し `:2147`/`:2153` が見るのは `stop.planningDurationMinutes` なので、
  // どちらも満たす形に直した(TS では滞在マーカーは前段でもう停留所に焼き込まれている)。
  var stops = TestStops.line(ids: ["disney", "a", "b", "z"], stayMinutes: 90)
  stops[0].planningDurationMinutes = 540
  let r = Clustering.spreadDayAnchors([[stops[0], stops[1], stops[2]], [stops[3]]], constraints: [:], capacity: 4)
  #expect(r.clusters[0].first?.id == "disney")
  #expect(r.clusters[0].map(\.id) == ["disney", "b"])
  #expect(r.clusters[1].map(\.id) == ["z", "a"])
  #expect(r.deferred.isEmpty)
}

// MARK: - 種の選び方と定員

@Test func clusterStopsPadsToTheRequestedDayCountAndKeepsEveryStop() {
  let stops = TestStops.line(ids: ["a", "b"])
  let c = Clustering.clusterStops(stops, requestedDays: 5)
  #expect(c.count == 5)
  #expect(c.flatMap { $0 }.count == 2)
  #expect(c[2].isEmpty && c[3].isEmpty && c[4].isEmpty)
  // 1 日だけなら分割せずそのまま。
  #expect(Clustering.clusterStops(stops, requestedDays: 1).map { $0.map(\.id) } == [["a", "b"]])
}

// MARK: - TS `tests/trip-builder.test.ts:41` の「地理でまとまった日」の部分

@Test func eightTokyoWishesSplitIntoTwoGeographicDays() {
  let names = [
    "Ghibli Museum", "Shibuya Sky", "Senso-ji", "Tokyo Skytree",
    "teamLab Planets", "Tsukiji Outer Market", "Meiji Jingu", "Akihabara",
  ]
  let stops = names.flatMap { Catalog.resolveKnownStops($0) }
  #expect(stops.count == 8)
  let c = Clustering.clusterStops(stops, requestedDays: 2)
  // 定員 `ceil(8/2)` = 4 が両日を押さえるので、TS の「毎日 4 件」がここで決まる。
  #expect(c.map(\.count) == [4, 4])
  // 中身と並びは TS `:949-984` を Python に写した参照実装と同じ。種は最西端のジブリ美術館
  // (三鷹)と、そこから最も遠いスカイツリー。この 2 点だけで日が割れるので、1.3km しか
  // 離れていない浅草寺とスカイツリーは**別の日**になる(この偏りを直すのが Task 13 の局所探索)。
  #expect(c[0].map(\.id) == ["ghibli-museum", "tsukiji-market", "akihabara", "sensoji"])
  #expect(c[1].map(\.id) == ["tokyo-skytree", "shibuya-sky", "meiji-jingu", "teamlab-planets"])
}

// MARK: - TS `tests/trip-builder.test.ts:457` 「予約が満員の固定日に移った後の均し」

@Test func rebalancesOrdinaryVisitsAfterABookingMovesOntoAFullFixedDay() {
  let stops = [
    TestStops.point(id: "west-a", lat: 35, lng: 0, stayMinutes: 30),
    TestStops.point(id: "east-b", lat: 35, lng: 10, stayMinutes: 30),
    TestStops.point(id: "west-c", lat: 35, lng: 0.1, stayMinutes: 30),
    TestStops.point(id: "east-d", lat: 35, lng: 10.1, stayMinutes: 30),
  ]
  var cons: [String: WishlistStopConstraint] = [:]
  cons["east-b"] = WishlistStopConstraint(priority: .must, fixedDay: 1, fixedTimeMinutes: 600, isReservation: true)
  let fixed = Clustering.applyFixedDays(Clustering.clusterStops(stops, requestedDays: 2), constraints: cons)
  #expect(fixed[0].contains { $0.id == "east-b" })   // 予約は 1 日目に残る
  #expect(fixed.map(\.count) == [2, 2])
  // 動かされるのは固定でない訪問だけ。しかも移動先クラスタに近いほうが動く。
  #expect(fixed[1].contains { $0.id == "west-c" })
}

// MARK: - TS `tests/trip-builder.test.ts:704` 「開いている日へ移す / どこも駄目なら見送る」

@Test func movesAFlexibleStopToAnOpenTripDay() {
  let stops = TestStops.line(ids: ["sensoji"])
  let avail: [String: IntKeyedDictionary<[VisitWindow]>] = [
    "sensoji": [0: [], 1: [VisitWindow(openMinutes: 9 * 60, closeMinutes: 17 * 60)]],
  ]
  let r = Clustering.applyOpeningDays([[stops[0]], []], constraints: [:], availability: avail, capacity: 4)
  #expect(r.clusters.map { $0.map(\.id) } == [[], ["sensoji"]])
  #expect(r.unavailable.isEmpty)
}

@Test func aBookedOrDayPinnedStopIsNeverMovedByOpeningDays() {
  let stops = TestStops.line(ids: ["pinned", "booked"])
  let avail: [String: IntKeyedDictionary<[VisitWindow]>] = [
    "pinned": [0: [], 1: [VisitWindow(openMinutes: 9 * 60, closeMinutes: 17 * 60)]],
    "booked": [0: [], 1: [VisitWindow(openMinutes: 9 * 60, closeMinutes: 17 * 60)]],
  ]
  var cons: [String: WishlistStopConstraint] = [:]
  cons["pinned"] = WishlistStopConstraint(priority: .normal, fixedDay: 1, isReservation: false)
  cons["booked"] = WishlistStopConstraint(priority: .normal, isReservation: true)
  let r = Clustering.applyOpeningDays([[stops[0], stops[1]], []], constraints: cons, availability: avail, capacity: 4)
  #expect(r.clusters.map { $0.map(\.id) } == [["pinned", "booked"], []])
  #expect(r.unavailable.isEmpty)
}

@Test func aWindowTooShortForTheStayCountsAsClosed() {
  // 開 9:00 / 閉 10:00 に 90 分の滞在は入らない → `hasUsableOpeningWindow` は false。
  let stops = TestStops.line(ids: ["a"])
  let avail: [String: IntKeyedDictionary<[VisitWindow]>] = [
    "a": [0: [VisitWindow(openMinutes: 9 * 60, closeMinutes: 10 * 60)], 1: [VisitWindow(openMinutes: 9 * 60, closeMinutes: 17 * 60)]],
  ]
  let r = Clustering.applyOpeningDays([[stops[0]], []], constraints: [:], availability: avail, capacity: 4)
  #expect(r.clusters.map { $0.map(\.id) } == [[], ["a"]])
  // 最終入場が滞在の余地を消しても同じ扱い。
  let lastEntry: [String: IntKeyedDictionary<[VisitWindow]>] = [
    "a": [0: [VisitWindow(openMinutes: 9 * 60, closeMinutes: 17 * 60, lastEntryMinutes: 8 * 60)], 1: []],
  ]
  let blocked = Clustering.applyOpeningDays([[stops[0]], []], constraints: [:], availability: lastEntry, capacity: 4)
  #expect(blocked.unavailable.map(\.id) == ["a"])
}

// MARK: - 暦日 → 活動日の読み替え

@Test func activityDayWindowsShiftByTheArrivalDayOffset() {
  let day0 = VisitWindow(openMinutes: 0, closeMinutes: 1)
  let day1 = VisitWindow(openMinutes: 100, closeMinutes: 200)
  let day2 = VisitWindow(openMinutes: 300, closeMinutes: 400)
  let avail: [String: IntKeyedDictionary<[VisitWindow]>] = ["a": [0: [day0], 1: [day1], 2: [day2]]]
  #expect(Clustering.activityDayOpeningWindows(avail, calendarDayOffset: 0) == avail)
  let shifted = Clustering.activityDayOpeningWindows(avail, calendarDayOffset: 1)
  #expect(shifted["a"]?.values == [0: [day1], 1: [day2]])   // 暦日 0 は活動日の手前なので落ちる
}

// MARK: - 件数の間引き(TS `tests/trip-builder.test.ts:388`)

@Test func movesOptionalPlacesToABackupListBeforeBreakingThePace() {
  let stops = TestStops.line(ids: ["sensoji", "tokyo-skytree", "akihabara", "shibuya-sky"])
  var cons: [String: WishlistStopConstraint] = [:]
  cons["shibuya-sky"] = WishlistStopConstraint(priority: .optional, isReservation: false)
  let r = Clustering.trimToPaceCapacity([stops], constraints: cons, capacity: EngineConstants.paceStopsPerDay[.relaxed] ?? 3)
  #expect(r.clusters[0].map(\.id) == ["sensoji", "tokyo-skytree", "akihabara"])
  #expect(r.deferred.map(\.id) == ["shibuya-sky"])
}

@Test func paceTrimStopsWhenNoOptionalIsLeftAndTakesTheLastOneFirst() {
  let stops = TestStops.line(ids: ["a", "b", "c", "d", "e"])
  var cons: [String: WishlistStopConstraint] = [:]
  cons["b"] = WishlistStopConstraint(priority: .optional, isReservation: false)
  cons["d"] = WishlistStopConstraint(priority: .optional, isReservation: false)
  let r = Clustering.trimToPaceCapacity([stops], constraints: cons, capacity: 3)
  #expect(r.deferred.map(\.id) == ["d", "b"])      // 末尾から
  #expect(r.clusters[0].map(\.id) == ["a", "c", "e"])
  // 任意が尽きたら定員を破ったまま返す(黙って必須を落とさない)。
  let hard = Clustering.trimToPaceCapacity([stops], constraints: [:], capacity: 3)
  #expect(hard.deferred.isEmpty)
  #expect(hard.clusters[0].count == 5)
}

// MARK: - 日アンカーの分散で行き先がないとき

@Test func anAnchorDayDefersAnOptionalCompanionWhenNoDayHasRoom() {
  var stops = TestStops.line(ids: ["usj", "keep", "spare", "full-1", "full-2"], stayMinutes: 90)
  stops[0].planningDurationMinutes = 510
  stops[1].planningDurationMinutes = 120
  stops[2].planningDurationMinutes = 60   // 最短なので TS `:2156` が最初に選ぶ
  var cons: [String: WishlistStopConstraint] = [:]
  cons["spare"] = WishlistStopConstraint(priority: .optional, isReservation: false)
  // 2 日目は定員 2 で満杯なので行き先がない。任意の "spare" だけが見送りに回る。
  let r = Clustering.spreadDayAnchors(
    [[stops[0], stops[1], stops[2]], [stops[3], stops[4]]],
    constraints: cons,
    capacity: 2
  )
  #expect(r.clusters[0].map(\.id) == ["usj", "keep"])
  #expect(r.clusters[1].map(\.id) == ["full-1", "full-2"])
  #expect(r.deferred.map(\.id) == ["spare"])
}

@Test func anAnchorDayKeepsACompanionItCanNeitherMoveNorDefer() {
  // TS `:2173` の break — 動かせる先がなく、任意でもないなら 3 件のまま残す。黙って落とさない。
  var stops = TestStops.line(ids: ["usj", "keep", "also-keep", "full-1", "full-2"], stayMinutes: 90)
  stops[0].planningDurationMinutes = 510
  let r = Clustering.spreadDayAnchors(
    [[stops[0], stops[1], stops[2]], [stops[3], stops[4]]],
    constraints: [:],
    capacity: 2
  )
  #expect(r.clusters[0].map(\.id) == ["usj", "keep", "also-keep"])
  #expect(r.deferred.isEmpty)
}

@Test func aSingleDayTripNeverSpreadsItsAnchor() {
  var stops = TestStops.line(ids: ["disney", "a", "b"], stayMinutes: 90)
  stops[0].planningDurationMinutes = 540
  let r = Clustering.spreadDayAnchors([stops], constraints: [:], capacity: 4)
  #expect(r.clusters[0].map(\.id) == ["disney", "a", "b"])
  #expect(r.deferred.isEmpty)
}

// MARK: - 最終日の締切超過(TS `lib/trip-builder.ts:2252-2261`)

@Test func theLastDayShedsOptionalsUntilTheDepartureDeadlineIsMet() {
  let stops = TestStops.line(ids: ["a", "b", "c"], stayMinutes: 180)
  var cons: [String: WishlistStopConstraint] = [:]
  cons["b"] = WishlistStopConstraint(priority: .optional, isReservation: false)
  cons["c"] = WishlistStopConstraint(priority: .optional, isReservation: false)
  let departure = AirportConstraint(
    direction: .departure, airport: "HND", flightTime: "20:00", cityTime: "16:00", cityTimeDayOffset: 0,
    airportMinutes: 180, transferMinutes: 60, transferCount: nil, sourceUrl: "", googleMapsUrl: nil
  )
  let build: ([RouteStop], Int) -> BuiltPlanDay = { cluster, index in
    DayClock.buildDay(
      stops: cluster, index: index, dayCount: 1, locale: .en, startBase: nil, endBase: nil,
      airportConstraints: [departure], constraints: cons, earlyVisitStopIds: [], foodStopIds: [],
      openingWindows: [:], destination: Destinations.byId(.japan), requestedStart: "09:00",
      startDate: nil, travel: .default, dayEndTarget: "21:30", lockedOrder: []
    )
  }
  #expect(build(stops, 0).deadlineOverrunMinutes > 0)
  let r = Clustering.trimLastDayToDeadline(clusters: [stops], days: [build(stops, 0)], constraints: cons, build: build)
  #expect(r.days.last?.deadlineOverrunMinutes == 0)
  #expect(r.deferred.map(\.id) == ["c"])
  #expect(r.clusters[0].map(\.id) == ["a", "b"])
}
