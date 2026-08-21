import Testing
@testable import TripCheckKit

// task-10-brief.md §Step 1 tests (verbatim).

@Test func fitVisitDistinguishesClosedDayFromConflict() {
  #expect(fitVisitToWindow(cursor: 600, duration: 60, windows: nil).status == .unknown)
  #expect(fitVisitToWindow(cursor: 600, duration: 60, windows: []).status == .closed_day)
  #expect(fitVisitToWindow(cursor: 600, duration: 60, windows: [VisitWindow(openMinutes: 540, closeMinutes: 1080, lastEntryMinutes: nil)]).status == .verified_open)
  // brief の数値(cursor 1070 / duration 60 / close 1080)は TS では last_entry_conflict にならない:
  // `lib/trip-builder.ts:1270` の閉店判定が最終入場判定より先にあり、1070+60 > 1080 で先に落ちて
  // ただの conflict になる。tests/trip-builder.test.ts:926-940 の実データ(滞在 45 分、9:00-18:00、
  // 最終入場 16:30)に合わせて、最終入場だけが理由で入れない形にした。
  let late = fitVisitToWindow(cursor: 1000, duration: 45, windows: [VisitWindow(openMinutes: 540, closeMinutes: 1080, lastEntryMinutes: 990)])
  #expect(late.status == .last_entry_conflict)
  let onTime = fitVisitToWindow(cursor: 980, duration: 45, windows: [VisitWindow(openMinutes: 540, closeMinutes: 1080, lastEntryMinutes: 990)])
  #expect(onTime.status == .verified_open)
  #expect(fitVisitToWindow(cursor: 1200, duration: 60, windows: [VisitWindow(openMinutes: 540, closeMinutes: 1080, lastEntryMinutes: nil)]).status == .conflict)
  // 開店前に着いたら開店まで待つ
  #expect(fitVisitToWindow(cursor: 500, duration: 60, windows: [VisitWindow(openMinutes: 540, closeMinutes: 1080, lastEntryMinutes: nil)]).start == 540)
}

@Test func oneBookingViolationOutranksAnySoftPenalty() {
  let a = ScheduleOrderScore(hardViolationCount: 1, hardViolationMinutes: 5, softPenalty: 0, travelMinutes: 0, elapsedMinutes: 0, idKey: "a")
  let b = ScheduleOrderScore(hardViolationCount: 0, hardViolationMinutes: 0, softPenalty: 100_000, travelMinutes: 10_000, elapsedMinutes: 10_000, idKey: "b")
  #expect(b < a)
}

@Test func lockedOrderIsKeptVerbatimAndNewStopsAppendById() {
  let s = TestStops.line(ids: ["c", "a", "b", "d"])   // 東西に並ぶ 4 点
  let out = DayOrdering.orderForReservations(stops: s, base: nil, startMinutes: 540, constraints: [:], earlyVisitStopIds: [], foodStopIds: [], openingWindows: [:], meals: TestStops.japanMeals, travel: .default, lockedOrder: ["b", "a"])
  #expect(out.map(\.id) == ["b", "a", "c", "d"])
}

@Test func eveningStopsAreNotScheduledBeforeSixteen() {
  var c: [String: WishlistStopConstraint] = [:]
  c["tower"] = WishlistStopConstraint(priority: .normal, fixedDay: nil, fixedTime: nil, fixedTimeMinutes: nil, timeOfDay: .evening, isReservation: false, stayMinutes: nil)
  let s = TestStops.line(ids: ["tower", "park", "shrine"])
  let out = DayOrdering.orderForReservations(stops: s, base: nil, startMinutes: 540, constraints: c, earlyVisitStopIds: [], foodStopIds: [], openingWindows: [:], meals: TestStops.japanMeals, travel: .default, lockedOrder: [])
  #expect(out.last?.id == "tower")
}

// MARK: - Ported from tests/place-hours.test.ts
//
// `placeHasOpeningHoursEvidence` (lib/place-hours.ts:26-33) is not ported: it reads a
// `PlaceIntelligenceResult["place"]`, a provider-response type the kit has no port of.

@Test func geographicDestinationsDoNotCreateBusinessHoursTasks() {
  // tests/place-hours.test.ts:6-12
  #expect(PlaceHours.requiresOpeningHours(placeTypes: nil, openingHoursApplicable: false) == false)
  #expect(PlaceHours.requiresOpeningHours(placeTypes: ["locality", "political"], openingHoursApplicable: nil) == false)
  #expect(PlaceHours.requiresOpeningHours(placeTypes: ["natural_feature", "tourist_attraction"], openingHoursApplicable: nil) == false)
  #expect(PlaceHours.requiresOpeningHours(placeTypes: ["museum", "tourist_attraction"], openingHoursApplicable: nil) == true)
  #expect(PlaceHours.requiresOpeningHours(placeTypes: ["restaurant", "food"], openingHoursApplicable: nil) == true)
}

// MARK: - Ported from tests/trip-builder.test.ts
//
// The TS ordering cases all run through `buildTripFromWishlist`, which needs `buildTripPlan`
// (Task 12). They are re-expressed here against `DayOrdering` directly — the same inputs the
// builder would hand it, and the same observable outcome.

@Test func explicitEditedOrderIsKeptWhileNewStopsAppend() {
  // tests/trip-builder.test.ts:101-110 — "keeps an explicit edited order while wishlist mode
  // remains optimisable". The full locked order pins every stop.
  let stops = TestStops.line(ids: ["shibuya-sky", "sensoji", "tokyo-skytree"])
  let out = DayOrdering.orderForReservations(
    stops: stops, base: nil, startMinutes: 540, constraints: [:], earlyVisitStopIds: [],
    foodStopIds: [], openingWindows: [:], meals: TestStops.japanMeals, travel: .default,
    lockedOrder: ["sensoji", "shibuya-sky", "tokyo-skytree"])
  #expect(out.map(\.id) == ["sensoji", "shibuya-sky", "tokyo-skytree"])
}

@Test func earlyCutoffEvidenceMovesAStopEarlierButNeverOverridesAReservation() {
  // tests/trip-builder.test.ts:523-533 — "softly moves a stop with explicit early-cutoff
  // evidence earlier without overriding reservations".
  let stops = TestStops.line(ids: ["sensoji", "tokyo-skytree"])
  let soft = DayOrdering.orderForReservations(
    stops: stops, base: nil, startMinutes: 540, constraints: [:],
    earlyVisitStopIds: ["tokyo-skytree"], foodStopIds: [], openingWindows: [:],
    meals: TestStops.japanMeals, travel: .default, lockedOrder: [])
  #expect(soft.first?.id == "tokyo-skytree")

  let reserved = DayOrdering.orderForReservations(
    stops: stops, base: nil, startMinutes: 540,
    constraints: ["sensoji": WishlistStopConstraint(priority: .must, fixedTime: "09:00", fixedTimeMinutes: 540, isReservation: true)],
    earlyVisitStopIds: ["tokyo-skytree"], foodStopIds: [], openingWindows: [:],
    meals: TestStops.japanMeals, travel: .default, lockedOrder: [])
  #expect(reserved.first?.id == "sensoji")
}

@Test func mealStopsDriftTowardMealWindowsInsteadOfOpeningTheDay() {
  // tests/trip-builder.test.ts:898-925 — "meal-typed stops drift toward meal windows instead of
  // opening the day". A 09:00 start puts the ramen stop 2 hours before lunch opens.
  let stops = TestStops.line(ids: ["ichiran-shibuya", "meiji-jingu", "yoyogi-park"], stayMinutes: 60)
  let out = DayOrdering.orderForReservations(
    stops: stops, base: nil, startMinutes: 540, constraints: [:], earlyVisitStopIds: [],
    foodStopIds: ["ichiran-shibuya"], openingWindows: [:], meals: TestStops.japanMeals,
    travel: .default, lockedOrder: [])
  #expect(out.first?.id != "ichiran-shibuya")
  let score = DayOrdering.score(
    stops: out, base: nil, startMinutes: 540, constraints: [:], earlyVisitStopIds: [],
    foodStopIds: ["ichiran-shibuya"], openingWindows: [:], meals: TestStops.japanMeals,
    travel: .default)
  #expect(score.softPenalty == 0)   // 昼の窓(11:00-14:30)の中に入った
}

@Test func theBoundedLargeDayOptimiserIsFeasibleAndDeterministic() {
  // tests/trip-builder.test.ts:483-521 — "the bounded large-day optimiser preserves feasible
  // booking and opening constraints deterministically". 8 stops (> exactOrderingLimit) forces
  // the heuristic branch. Coordinates are the TS fixture's: 35 / 139 + index * 0.0001.
  let stops = (0..<8).map { index in
    TestStops.point(id: "large-\(index)", lat: 35, lng: 139 + Double(index) * 0.0001, stayMinutes: 15)
  }
  var windows: [String: [VisitWindow]] = [:]
  for (index, stop) in stops.enumerated() {
    windows[stop.id] = [VisitWindow(openMinutes: 9 * 60, closeMinutes: index == 0 ? 9 * 60 + 20 : 18 * 60)]
  }
  let constraints = ["large-7": WishlistStopConstraint(priority: .must, fixedTime: "09:45", fixedTimeMinutes: 9 * 60 + 45, isReservation: true)]
  func order() -> [RouteStop] {
    DayOrdering.orderForReservations(
      stops: stops, base: nil, startMinutes: 9 * 60, constraints: constraints,
      earlyVisitStopIds: [], foodStopIds: [], openingWindows: windows,
      meals: TestStops.japanMeals, travel: .default, lockedOrder: [])
  }

  let first = order()
  #expect(first.first?.id == "large-0")   // 09:00-09:20 の窓は先頭でしか成立しない
  let score = DayOrdering.score(
    stops: first, base: nil, startMinutes: 9 * 60, constraints: constraints,
    earlyVisitStopIds: [], foodStopIds: [], openingWindows: windows,
    meals: TestStops.japanMeals, travel: .default)
  #expect(score.hardViolationCount == 0)
  #expect(score.hardViolationMinutes == 0)
  for _ in 0..<20 { #expect(order().map(\.id) == first.map(\.id)) }
}

@Test func noConstraintsAtAllKeepsThePurelyGeographicOrder() {
  // lib/trip-builder.ts:1417 — the scoring search only runs when something time-shaped exists.
  let stops = TestStops.line(ids: ["c", "a", "b"])
  let out = DayOrdering.orderForReservations(
    stops: stops, base: nil, startMinutes: 540, constraints: [:], earlyVisitStopIds: [],
    foodStopIds: [], openingWindows: [:], meals: TestStops.japanMeals, travel: .default,
    lockedOrder: [])
  #expect(out.map(\.id) == RouteOrdering.optimize(stops, preserveFirst: false).stops.map(\.id))
}

// MARK: - Legs (lib/trip-builder.ts:1126-1257)

@Test func routeLegKeyJoinsTheTwoStopIds() {
  // lib/trip-builder.ts:363-365
  #expect(routeLegKey("sensoji", "tokyo-skytree") == "sensoji::tokyo-skytree")
}

@Test func walkingAndTransferLimitsAreVisibleSoftMobilityPolicy() {
  // tests/trip-builder.test.ts:636-680 — "treats walking and transfer limits as visible soft
  // mobility policy". Senso-ji → Tokyo Skytree is a ~1.3 km walk the estimator would recommend.
  let sensoji = TestStops.point(id: "sensoji", lat: 35.714765, lng: 139.796655)
  let skytree = TestStops.point(id: "tokyo-skytree", lat: 35.710063, lng: 139.8107)
  let key = routeLegKey(sensoji.id, skytree.id)

  let unlimited = Legs.routeComparison(from: sensoji, to: skytree, travel: .default)
  #expect(unlimited.recommended.mode == .walk)

  var limited = TravelInputs.default
  limited.maxWalkingMinutesPerLeg = 5
  limited.maxTransfersPerLeg = 1
  #expect(Legs.routeComparison(from: sensoji, to: skytree, travel: limited).recommended.mode != .walk)

  // 明示的なモード指定は、上限に触れても静かに書き換えられない。
  var lockedWalk = limited
  lockedWalk.overrides = [key: .walk]
  #expect(Legs.routeComparison(from: sensoji, to: skytree, travel: lockedWalk).recommended.mode == .walk)

  // 乗換上限を超える実測トランジットは自動選択から外れるが、指定されれば残る。
  var manyTransfers = TravelInputs.default
  manyTransfers.maxTransfersPerLeg = 1
  manyTransfers.transit = [key: 8]
  manyTransfers.transfers = [key: 3]
  #expect(Legs.routeComparison(from: sensoji, to: skytree, travel: manyTransfers).recommended.mode != .transit)
  #expect(Legs.knownTransferCount(from: sensoji, to: skytree, travel: manyTransfers) == 3)

  var lockedTransit = manyTransfers
  lockedTransit.overrides = [key: .transit]
  #expect(Legs.routeComparison(from: sensoji, to: skytree, travel: lockedTransit).recommended.mode == .transit)
}

@Test func mountainAccessKeepsGoogleUrlsHonestAndTransferCountsUnknown() {
  // tests/trip-builder.test.ts:124-190 / lib/trip-builder.ts:1225-1247. A summit leg routes from
  // the disclosed access node, so only the transit URL exists and no walk/taxi link is offered.
  let zermatt = TestStops.point(id: "zermatt", lat: 46.0207, lng: 7.7491)
  let gornergrat = TestStops.point(id: "gornergrat", lat: 45.9836, lng: 7.7847)
  var travel = TravelInputs.default
  travel.transfers = [routeLegKey(zermatt.id, gornergrat.id): 1]

  let urls = Legs.googleMapsUrlsForLeg(from: zermatt, to: gornergrat)
  #expect(urls[TransportMode.walk.rawValue] == "")
  #expect(urls[TransportMode.taxi.rawValue] == "")
  #expect(urls[TransportMode.transit.rawValue]?.contains("travelmode=transit") == true)

  let metadata = Legs.accessMetadataForLeg(from: zermatt, to: gornergrat)
  #expect(metadata.routeEvidenceScope == .access_node)
  #expect(metadata.accessAssumptions?.isEmpty == false)
  // 山頂までの全区間を測れていないので、提供者の乗換数は採用しない。
  #expect(Legs.knownTransferCount(from: zermatt, to: gornergrat, travel: travel) == nil)
  #expect(Legs.routeComparison(from: zermatt, to: gornergrat, travel: travel).options.allSatisfy { $0.source == .estimate })
}

@Test func aDirectLegGetsAllThreeGoogleUrlsAndItsMetadataIsEmpty() {
  // lib/trip-builder.ts:1215-1247 — the "direct" branch of both helpers.
  let stops = TestStops.line(ids: ["a", "b"])
  let urls = Legs.googleMapsUrlsForLeg(from: stops[0], to: stops[1])
  #expect(urls[TransportMode.walk.rawValue]?.contains("travelmode=walking") == true)
  #expect(urls[TransportMode.transit.rawValue]?.contains("travelmode=transit") == true)
  #expect(urls[TransportMode.taxi.rawValue]?.contains("travelmode=driving") == true)

  let metadata = Legs.accessMetadataForLeg(from: stops[0], to: stops[1])
  #expect(metadata.routeEvidenceScope == nil)
  #expect(metadata.accessAssumptions == nil)
}

@Test func travelMinutesAddTheTransferBufferAndClusterDistanceUsesTheCentroid() {
  // lib/trip-builder.ts:1249-1257
  let stops = TestStops.line(ids: ["a", "b", "c"])
  let comparison = Legs.routeComparison(from: stops[0], to: stops[1], travel: .default)
  #expect(Legs.routeTravelMinutes(from: stops[0], to: stops[1], travel: .default) == comparison.recommended.minutes + EngineConstants.defaultTransferBuffer)

  #expect(Legs.clusterDistanceKm(stop: stops[0], cluster: []) == 9_007_199_254_740_991)
  // b と c の重心は b から約 0.5km、a からは約 1.5km。
  let fromA = Legs.clusterDistanceKm(stop: stops[0], cluster: [stops[1], stops[2]])
  #expect(fromA > 1.4 && fromA < 1.6)
}

@Test func aHotelBaseIsCountedOutboundWithBufferAndInboundWithout() {
  // lib/trip-builder.ts:1310-1315 と :1375-1380 — 出発レグはバッファ込み、帰着レグはバッファ無し。
  let stops = TestStops.line(ids: ["a", "b"])
  let base = TripBase(routeStop: TestStops.point(id: "hotel", lat: 35.681236, lng: 139.767125 - 0.02), query: "Tokyo")
  let withBase = DayOrdering.score(
    stops: stops, base: base, startMinutes: 540, constraints: [:], earlyVisitStopIds: [],
    foodStopIds: [], openingWindows: [:], meals: TestStops.japanMeals, travel: .default)
  let withoutBase = DayOrdering.score(
    stops: stops, base: nil, startMinutes: 540, constraints: [:], earlyVisitStopIds: [],
    foodStopIds: [], openingWindows: [:], meals: TestStops.japanMeals, travel: .default)

  let outbound = Legs.routeTravelMinutes(from: base.routeStop, to: stops[0], travel: .default)
  let inbound = Legs.routeComparison(from: stops[1], to: base.routeStop, travel: .default).recommended.minutes
  #expect(withBase.travelMinutes == withoutBase.travelMinutes + outbound + inbound)
  #expect(withBase.elapsedMinutes == withoutBase.elapsedMinutes + outbound + inbound)

  // base があると地理順の種は optimizeFromBase から来る。
  let ordered = DayOrdering.orderForReservations(
    stops: stops, base: base, startMinutes: 540, constraints: [:], earlyVisitStopIds: [],
    foodStopIds: [], openingWindows: [:], meals: TestStops.japanMeals, travel: .default,
    lockedOrder: [])
  #expect(ordered.map(\.id) == RouteOrdering.optimizeFromBase(stops, base: base.routeStop).map(\.id))
}
