import Foundation
import Testing
@testable import TripCheckKit

// `tests/trip-builder.test.ts`(全 56 件)の移植。1 件 1 件が TS の `test("…")` に対応し、
// 関数名の上のコメントに TS の行番号と原題を書いてある。期待値は TS のまま——食い違ったら
// Swift 側を直す。

// MARK: - 共有ヘルパー

/// TS `buildTripFromWishlist(raw, days, pace, locale, context)` と同じ並びの薄いラッパ。
private func plan(
  _ raw: String,
  _ days: Int,
  _ pace: Pace,
  _ locale: PlannerLocale = .en,
  _ context: PlannerContext = PlannerContext()
) -> BuiltTripPlan {
  TripBuilder.build(TripRequest(raw: raw, days: days, pace: pace, locale: locale, context: context))
}

/// TS のテストが手で書いている `ResolvedInputStop` リテラルの Swift 版。
private func resolvedStop(
  id: String,
  input: String,
  name: String? = nil,
  area: String = "Test",
  address: String? = nil,
  latitude: Double,
  longitude: Double,
  minutes: Int = 60,
  inputIndex: Int? = nil,
  sourceUrl: String? = nil,
  verifiedAt: String = "2026-08-09T00:00:00Z",
  confidence: Confidence = .medium,
  isAnchor: Bool = false,
  countryCode: String? = nil,
  providerRef: String? = nil,
  placeTypes: [String]? = nil,
  isUserEntered: Bool? = nil,
  userProvidedCoordinates: Bool? = nil
) -> ResolvedStop {
  ResolvedStop(
    id: id,
    providerRef: providerRef,
    name: name ?? input,
    area: area,
    latitude: latitude,
    longitude: longitude,
    sourceUrl: sourceUrl ?? "https://example.com/\(id)",
    verifiedAt: verifiedAt,
    confidence: confidence,
    planningDurationMinutes: minutes,
    isAnchor: isAnchor,
    placeTypes: placeTypes,
    isUserEntered: isUserEntered,
    userProvidedCoordinates: userProvidedCoordinates,
    input: input,
    inputIndex: inputIndex,
    address: address ?? "\(input) address",
    countryCode: countryCode
  )
}

/// TS `tests/trip-builder.test.ts:5-12` の共有ウィッシュリスト。
private let wishlist = """
Ghibli Museum
Shibuya Sky
Senso-ji
Tokyo Skytree
teamLab Planets
Tsukiji Outer Market
Meiji Jingu
Akihabara
"""

/// TS `unevenDurationFixture` (`:14-38`)
private func unevenDurationFixture() -> (raw: String, resolvedStops: [ResolvedStop]) {
  let definitions: [(id: String, name: String, latitude: Double, longitude: Double, minutes: Int)] = [
    ("long-a", "Long A", 35, 139, 420),
    ("long-b", "Long B", 35.0001, 139.0001, 420),
    ("short-c", "Short C", 35, 140, 30),
    ("short-d", "Short D", 35.0001, 140.0001, 30),
  ]
  return (
    raw: definitions.map(\.name).joined(separator: "\n"),
    resolvedStops: definitions.enumerated().map { inputIndex, definition in
      resolvedStop(
        id: definition.id,
        input: definition.name,
        latitude: definition.latitude,
        longitude: definition.longitude,
        minutes: definition.minutes,
        inputIndex: inputIndex
      )
    }
  )
}

private func stopIds(_ day: BuiltPlanDay) -> [String] { day.stops.map(\.stop.id) }

// MARK: - :41 turns an unordered wishlist into geographically grouped days

@Test func turnsAnUnorderedWishlistIntoGeographicallyGroupedDays() {
  let built = plan(wishlist, 2, .balanced)

  #expect(built.inputMode == .wishlist)
  #expect(built.recognizedStopCount == 8)
  #expect(built.days.count == 2)
  #expect(built.days.flatMap(\.stops).count == 8)
  #expect(built.days.allSatisfy { $0.stops.count == 4 })
  #expect(built.days.allSatisfy { ($0.googleMapsUrl ?? "").contains("travelmode=transit") })
}

// MARK: - :52 reassigns an uneven geographic seed before claiming the day count is impossible

@Test func reassignsAnUnevenGeographicSeedBeforeClaimingTheDayCountIsImpossible() throws {
  let fixture = unevenDurationFixture()
  var context = PlannerContext()
  context.resolvedStops = fixture.resolvedStops
  context.defaultDayStart = "09:00"
  context.dayEndTarget = "22:00"
  context.transferBufferMinutes = 0

  let encoder = JSONEncoder()
  encoder.outputFormatting = [.sortedKeys]
  var signatures = Set<Data>()
  for _ in 0..<100 {
    let built = plan(fixture.raw, 2, .balanced, .en, context)
    signatures.insert(try encoder.encode(built.days.map { stopIds($0) }))
    #expect(built.scheduleConflictCount == 0)
    #expect(built.days.allSatisfy { $0.deadlineOverrunMinutes == 0 })
    #expect(
      built.days.flatMap { stopIds($0) }.sorted(by: jsStringLess) == ["long-a", "long-b", "short-c", "short-d"]
    )
  }
  #expect(signatures.count == 1, "the bounded local search must be deterministic across repeated solves")
}

// MARK: - :74 day-assignment search never moves a stop out of its locked day

@Test func dayAssignmentSearchNeverMovesAStopOutOfItsLockedDay() {
  let fixture = unevenDurationFixture()
  var context = PlannerContext()
  context.resolvedStops = fixture.resolvedStops
  context.defaultDayStart = "09:00"
  context.dayEndTarget = "22:00"
  context.transferBufferMinutes = 0
  context.lockedOrderByDay = [0: ["long-a", "long-b"]]
  let built = plan(fixture.raw, 2, .balanced, .en, context)

  #expect(stopIds(built.days[0]) == ["long-a", "long-b"])
  #expect(built.days[0].deadlineOverrunMinutes > 0, "a hard lock is retained even when relaxing it would fit")
}

// MARK: - :88 preserves the written day and visit order in existing-itinerary mode

@Test func preservesTheWrittenDayAndVisitOrderInExistingItineraryMode() {
  let built = plan("""
Day 1
Shibuya Sky
Senso-ji
Tokyo Skytree
""", 1, .balanced)

  #expect(built.inputMode == .existing_itinerary)
  #expect(stopIds(built.days[0]) == ["shibuya-sky", "sensoji", "tokyo-skytree"])
}

// MARK: - :101 keeps an explicit edited order while wishlist mode remains optimisable

@Test func keepsAnExplicitEditedOrderWhileWishlistModeRemainsOptimisable() {
  var context = PlannerContext()
  context.lockedOrderByDay = [0: ["sensoji", "shibuya-sky", "tokyo-skytree"]]
  let built = plan("Shibuya Sky\nSenso-ji\nTokyo Skytree", 1, .balanced, .en, context)

  #expect(stopIds(built.days[0]) == ["sensoji", "shibuya-sky", "tokyo-skytree"])
}

// MARK: - :112 compares walking, transit and taxi without claiming live routing

@Test func comparesWalkingTransitAndTaxiWithoutClaimingLiveRouting() {
  let built = plan("Senso-ji\nTokyo Skytree", 1, .balanced)
  let leg = built.days[0].legs[0]
  let comparison = leg.comparison

  #expect(comparison.options.map(\.mode) == [.walk, .transit, .taxi])
  #expect(comparison.recommended.mode == .walk)
  #expect(comparison.options.allSatisfy { $0.minutes > 0 })
  #expect((leg.googleMapsUrls["walk"] ?? "").contains("travelmode=walking"))
  #expect((leg.googleMapsUrls["transit"] ?? "").contains("travelmode=transit"))
  #expect((leg.googleMapsUrls["taxi"] ?? "").contains("travelmode=driving"))
}

// MARK: - :124 mountain access keeps the summit in the itinerary and route evidence conditional

@Test func mountainAccessKeepsTheSummitInTheItineraryAndRouteEvidenceConditional() {
  let stops = [
    resolvedStop(
      id: "zermatt", input: "Zermatt", area: "Zermatt", address: "Zermatt, Switzerland",
      latitude: 46.0207, longitude: 7.7491, minutes: 60, inputIndex: 0, countryCode: "CH"
    ),
    resolvedStop(
      id: "gornergrat", input: "Gornergrat", area: "Zermatt", address: "Gornergrat, Switzerland",
      latitude: 45.9834, longitude: 7.7847, minutes: 120, inputIndex: 1, countryCode: "CH"
    ),
  ]
  var context = PlannerContext()
  context.tripStartDate = "2026-09-14"
  context.resolvedStops = stops
  context.lockedOrderByDay = [0: ["zermatt", "gornergrat"]]
  context.transferBufferMinutes = 0

  let initial = plan("Zermatt\nGornergrat", 1, .balanced, .en, context)
  let leg = initial.days[0].legs[0]

  #expect(initial.days[0].stops.map(\.stop.id) == ["zermatt", "gornergrat"])
  #expect(initial.days[0].stops.map(\.stop.latitude) == [46.0207, 45.9834])
  #expect(initial.days[0].stops.map(\.stop.longitude) == [7.7491, 7.7847])
  #expect(leg.comparison.options.map(\.mode) == [.transit])
  #expect(leg.routeEvidenceScope == .access_node)
  #expect(leg.accessAssumptions?.first?.accessNodeId == "didok-8501690")
  #expect(leg.googleMapsUrls["walk"] == "")
  #expect(leg.googleMapsUrls["taxi"] == "")
  #expect((leg.googleMapsUrls["transit"] ?? "").contains("destination=46.023889%2C7.748889"))

  let key = routeLegKey("zermatt", "gornergrat")
  var partial = context
  partial.liveTransitMinutes = [key: 1]
  partial.liveTransitTransferCounts = [key: 3]
  let conditionalLeg = plan("Zermatt\nGornergrat", 1, .balanced, .en, partial).days[0].legs[0]
  #expect(
    conditionalLeg.comparison.recommended.minutes != 1,
    "access-node minutes are not claimed as the full summit journey"
  )
  #expect(conditionalLeg.comparison.recommended.source == .estimate)
  #expect(conditionalLeg.transferCount == nil, "partial access-node transfers do not prove the full leg burden")
}

// MARK: - :191 keeps unsupported entries visible for later map resolution

@Test func keepsUnsupportedEntriesVisibleForLaterMapResolution() {
  let built = plan("Senso-ji\nA tiny cafe my friend recommended\nShibuya", 2, .relaxed)

  #expect(built.recognizedStopCount == 2)
  #expect(built.unknownEntries == ["A tiny cafe my friend recommended"])
}

// MARK: - :198 resolves duplicate names by reviewed occurrence instead of conflating them

@Test func resolvesDuplicateNamesByReviewedOccurrenceInsteadOfConflatingThem() {
  var context = PlannerContext()
  context.resolvedStops = [
    resolvedStop(
      id: "manual-museum-0", input: "City Museum", name: "City Museum North", area: "North", address: "North",
      latitude: 35.7, longitude: 139.7, minutes: 60, inputIndex: 0, sourceUrl: "", verifiedAt: "",
      confidence: .low, isUserEntered: true, userProvidedCoordinates: true
    ),
    resolvedStop(
      id: "manual-museum-1", input: "City Museum", name: "City Museum South", area: "South", address: "South",
      latitude: 35.6, longitude: 139.8, minutes: 60, inputIndex: 1, sourceUrl: "", verifiedAt: "",
      confidence: .low, isUserEntered: true, userProvidedCoordinates: true
    ),
  ]
  let built = plan("City Museum\nCity Museum", 1, .balanced, .en, context)

  #expect(stopIds(built.days[0]).sorted(by: jsStringLess) == ["manual-museum-0", "manual-museum-1"])
  #expect(built.unknownEntries.isEmpty)
}

// MARK: - :209 does not prefix-match Tokyo's provider result onto Tokyo Tower

@Test func doesNotPrefixMatchTokyosProviderResultOntoTokyoTower() {
  var context = PlannerContext()
  context.resolvedStops = [
    resolvedStop(
      id: "provider-tokyo-city", input: "Tokyo", area: "Tokyo", address: "Tokyo, Japan",
      latitude: 35.6762, longitude: 139.6503, minutes: 60, sourceUrl: "https://example.com/tokyo"
    ),
  ]
  let built = plan("Tokyo\nTokyo Tower", 1, .balanced, .en, context)

  #expect(stopIds(built.days[0]).sorted(by: jsStringLess) == ["provider-tokyo-city", "tokyo-tower"])
}

// MARK: - :233 keeps repeated occurrences distinct when one exact provider result is reused

@Test func keepsRepeatedOccurrencesDistinctWhenOneExactProviderResultIsReused() {
  var context = PlannerContext()
  context.resolvedStops = [
    resolvedStop(
      id: "provider-city-museum", input: "City Museum", area: "Central", address: "1 Museum Road",
      latitude: 35.68, longitude: 139.76, minutes: 60,
      sourceUrl: "https://example.com/city-museum", providerRef: "google-place-id"
    ),
  ]
  let built = plan("City Museum\nCity Museum", 1, .balanced, .en, context)

  #expect(stopIds(built.days[0]).sorted(by: jsStringLess) == [
    "provider-city-museum",
    "provider-city-museum--occurrence-2",
  ])
  #expect(built.days[0].stops.allSatisfy { $0.stop.providerRef == "google-place-id" })
}

// MARK: - :259 builds the day around a recognised hotel area and ranks alternative bases

@Test func buildsTheDayAroundARecognisedHotelAreaAndRanksAlternativeBases() {
  var context = PlannerContext()
  context.hotelQuery = "hotel near Shinjuku Station"
  let built = plan(wishlist, 2, .balanced, .en, context)

  #expect(built.selectedBase?.name == "Shinjuku area")
  #expect(built.hotelResolved == true)
  #expect(built.baseRecommendations.count == 3)
  #expect(built.days.allSatisfy { $0.hotelTravelMinutes != nil })
  #expect(built.days.allSatisfy { ($0.googleMapsUrl ?? "").contains("travelmode=transit") })
}

// MARK: - :269 can use a real recommended hotel even when the user left the hotel field blank

@Test func canUseARealRecommendedHotelEvenWhenTheUserLeftTheHotelFieldBlank() {
  var context = PlannerContext()
  context.hotelQuery = ""
  context.resolvedBase = resolvedStop(
    id: "hotel-real-1", input: "Real Hotel", area: "Asakusa", address: "1 Asakusa, Tokyo",
    latitude: 35.711, longitude: 139.797, minutes: 0,
    sourceUrl: "https://maps.google.com/real-hotel", verifiedAt: "2026-07-21T00:00:00Z"
  )
  let built = plan("Senso-ji", 1, .balanced, .en, context)

  #expect(built.selectedBase?.name == "Real Hotel")
  #expect(built.hotelResolved == true)
  #expect(built.days[0].hotelTravelMinutes != nil)
}

// MARK: - :293 protects airport processing, city transfer and international departure time

@Test func protectsAirportProcessingCityTransferAndInternationalDepartureTime() throws {
  var context = PlannerContext()
  context.hotelQuery = "Ueno hotel"
  context.arrivalAirport = "HND"
  context.arrivalTime = "10:00"
  context.departureAirport = "NRT"
  context.departureTime = "18:00"
  context.flightKind = .international
  let built = plan("Senso-ji\nTokyo Skytree", 1, .balanced, .en, context)

  let arrival = try #require(built.airportConstraints.first { $0.direction == .arrival })
  let departure = try #require(built.airportConstraints.first { $0.direction == .departure })

  #expect(arrival.cityTime == "12:30")
  #expect(arrival.airportMinutes == 90)
  #expect(departure.cityTime == "14:15")
  #expect(departure.airportMinutes == 120)
  #expect(built.days[0].deadline == "14:15")
}

// MARK: - :312 uses a measured airport-to-hotel route instead of the country-wide fallback

@Test func usesAMeasuredAirportToHotelRouteInsteadOfTheCountryWideFallback() throws {
  var context = PlannerContext()
  context.hotelQuery = "Ueno hotel"
  context.arrivalAirport = "HND"
  context.arrivalTime = "10:00"
  context.tripStartDate = "2026-09-14"
  let initial = plan("Senso-ji\nTokyo Skytree", 1, .balanced, .en, context)
  let selectedBase = try #require(initial.selectedBase)

  let key = routeLegKey("airport-hnd", selectedBase.id)
  var measuredContext = context
  measuredContext.liveTransitMinutes = [key: 37]
  measuredContext.liveTransitTransferCounts = [key: 2]
  let measured = plan("Senso-ji\nTokyo Skytree", 1, .balanced, .en, measuredContext)
  let arrival = try #require(measured.airportConstraints.first { $0.direction == .arrival })

  #expect(arrival.transferMinutes == 37)
  #expect(arrival.transferCount == 2)
  #expect(arrival.cityTime == "12:07")
}

// MARK: - :335 flags a day that runs past the airport departure deadline

@Test func flagsADayThatRunsPastTheAirportDepartureDeadline() {
  var context = PlannerContext()
  context.hotelQuery = "Shinjuku hotel"
  context.departureAirport = "HND"
  context.departureTime = "14:00"
  context.flightKind = .international
  let built = plan("Ghibli Museum\nShibuya Sky\nSenso-ji\nTokyo Skytree", 1, .fast, .en, context)

  #expect(built.days[0].deadline == "10:00")
  #expect(built.days[0].deadlineOverrunMinutes > 0)
  #expect(built.scheduleConflictCount == 1)
}

// MARK: - :348 keeps the requested trip length even when some days remain open

@Test func keepsTheRequestedTripLengthEvenWhenSomeDaysRemainOpen() {
  var context = PlannerContext()
  context.departureAirport = "HND"
  context.departureTime = "18:00"
  let built = plan("Senso-ji\nTokyo Skytree", 5, .relaxed, .en, context)

  #expect(built.days.count == 5)
  #expect(built.days.filter { $0.stops.isEmpty }.count == 3)
  #expect(built.days[4].deadline == "14:00")
  #expect(built.days[4].theme == "Open day")
  #expect(built.days[4].googleMapsUrl == nil)
}

// MARK: - :361 locks a booked stop to its requested day and time

@Test func locksABookedStopToItsRequestedDayAndTime() throws {
  let built = plan("""
Senso-ji
Ghibli Museum — Day 2 10:00 booked · must
Shibuya Sky
""", 3, .balanced)
  let ghibli = try #require(built.days[1].stops.first { $0.stop.id == "ghibli-museum" })

  #expect(ghibli.arrival == "10:00")
  #expect(ghibli.fixedTime == "10:00")
  #expect(ghibli.priority == .must)
  #expect(ghibli.reservationLateMinutes == 0)
  #expect(built.constraintCount == 1)
}

// MARK: - :375 reports lateness when airport arrival makes a reservation impossible

@Test func reportsLatenessWhenAirportArrivalMakesAReservationImpossible() {
  var context = PlannerContext()
  context.arrivalAirport = "HND"
  context.arrivalTime = "10:00"
  context.flightKind = .international
  let built = plan("teamLab Planets — Day 1 12:00 booked", 1, .balanced, .en, context)

  #expect(built.days[0].stops[0].arrival == "12:30")
  #expect(built.days[0].stops[0].reservationLateMinutes == 30)
  #expect(built.days[0].reservationConflictCount == 1)
  #expect(built.scheduleConflictCount == 1)
}

// MARK: - :388 moves optional places to a backup list before breaking the selected pace

@Test func movesOptionalPlacesToABackupListBeforeBreakingTheSelectedPace() {
  let built = plan("""
Senso-ji
Tokyo Skytree
Akihabara
Shibuya Sky — optional
""", 1, .relaxed)

  #expect(built.recognizedStopCount == 4)
  #expect(built.scheduledStopCount == 3)
  #expect(built.deferredOptionalStops.map(\.id) == ["shibuya-sky"])
  #expect(built.overCapacityCount == 0)
}

// MARK: - :400 understands Japanese day, reservation and priority annotations

@Test func understandsJapaneseDayReservationAndPriorityAnnotations() {
  let built = plan("三鷹の森ジブリ美術館 — 2日目 10:00 予約 · 必須\n浅草寺", 2, .balanced, .ja)
  let ghibli = built.days[1].stops.first { $0.stop.id == "ghibli-museum" }

  #expect(ghibli?.arrival == "10:00")
  #expect(ghibli?.priority == .must)
}

// MARK: - :408 recalculates the day from a user start time and stay duration

@Test func recalculatesTheDayFromAUserStartTimeAndStayDuration() {
  var context = PlannerContext()
  context.dayStartTimes = [0: "10:30"]
  context.durationOverrides = ["sensoji": 180]
  let built = plan("Senso-ji", 1, .balanced, .en, context)
  let stop = built.days[0].stops[0]

  #expect(built.days[0].requestedStartTime == "10:30")
  #expect(built.days[0].startTime == "10:30")
  #expect(stop.arrival == "10:30")
  #expect(stop.departure == "13:30")
  #expect(stop.stop.planningDurationMinutes == 180)
}

// MARK: - :422 uses a per-day end time ahead of the trip-wide cutoff

@Test func usesAPerDayEndTimeAheadOfTheTripWideCutoff() {
  var context = PlannerContext()
  context.dayEndTarget = "22:00"
  context.dayEndTimes = [0: "11:00", 1: "20:30"]
  context.dayStartTimes = [0: "09:00", 1: "10:00"]
  let built = plan("Senso-ji\nTokyo Skytree", 2, .balanced, .en, context)

  #expect(built.days[0].deadline == "11:00")
  #expect(built.days[1].deadline == "20:30")
}

// MARK: - :433 uses 22:00 as the deterministic day-end target when none is supplied

@Test func uses2200AsTheDeterministicDayEndTargetWhenNoneIsSupplied() {
  var context = PlannerContext()
  context.defaultDayStart = "09:00"
  context.resolvedStops = [
    resolvedStop(
      id: "long-visit", input: "Long Visit", area: "Central", address: "1 Long Road",
      latitude: 35.68, longitude: 139.76, minutes: 840, sourceUrl: "https://example.com/long-visit"
    ),
  ]
  let built = plan("Long Visit", 1, .balanced, .en, context)

  #expect(built.days[0].deadline == "22:00")
  #expect(built.days[0].deadlineKind == .curfew)
  #expect(built.days[0].deadlineOverrunMinutes == 60)
}

// MARK: - :457 rebalances ordinary visits after a booking moves onto a full fixed day

@Test func rebalancesOrdinaryVisitsAfterABookingMovesOntoAFullFixedDayEndToEnd() {
  let definitions: [(id: String, name: String, longitude: Double)] = [
    ("west-a", "West A", 0),
    ("east-b", "East B", 10),
    ("west-c", "West C", 0.1),
    ("east-d", "East D", 10.1),
  ]
  var context = PlannerContext()
  context.resolvedStops = definitions.map { definition in
    resolvedStop(
      id: definition.id, input: definition.name, address: "\(definition.name) Road",
      latitude: 35, longitude: definition.longitude, minutes: 30
    )
  }
  let built = plan("West A\nEast B — Day 1 10:00 booked\nWest C\nEast D", 2, .balanced, .en, context)

  #expect(built.days[0].stops.contains { $0.stop.id == "east-b" }, "the booked stop stays on Day 1")
  #expect(built.days.map { $0.stops.count } == [2, 2])
}

// MARK: - :483 the bounded large-day optimiser preserves feasible booking and opening constraints deterministically

@Test func theBoundedLargeDayOptimiserPreservesFeasibleBookingAndOpeningConstraints() throws {
  let stops = (0..<8).map { index in
    resolvedStop(
      id: "large-\(index)", input: "Large Place \(index)", address: "\(index) Test Road",
      latitude: 35, longitude: 139 + Double(index) * 0.0001, minutes: 15
    )
  }
  var openingWindowsByDay: [String: IntKeyedDictionary<[VisitWindow]>] = [:]
  for (index, stop) in stops.enumerated() {
    openingWindowsByDay[stop.id] = [
      0: [VisitWindow(openMinutes: 9 * 60, closeMinutes: index == 0 ? 9 * 60 + 20 : 18 * 60)],
    ]
  }
  var context = PlannerContext()
  context.defaultDayStart = "09:00"
  context.resolvedStops = stops
  context.openingWindowsByDay = openingWindowsByDay
  context.transferBufferMinutes = 10

  let raw = (["Large Place 0"] + (1...6).map { "Large Place \($0)" } + ["Large Place 7 — 09:45 booked"])
    .joined(separator: "\n")
  func build() -> BuiltPlanDay { plan(raw, 1, .fast, .en, context).days[0] }

  let encoder = JSONEncoder()
  encoder.outputFormatting = [.sortedKeys]
  func signature(_ day: BuiltPlanDay) throws -> Data {
    try encoder.encode(day.stops.map { [$0.stop.id, $0.arrival, $0.departure] })
  }

  let first = build()
  let expected = try signature(first)

  #expect(first.openingConflictCount == 0)
  #expect(first.reservationConflictCount == 0)
  #expect(first.stops[0].stop.id == "large-0")
  for _ in 0..<100 { #expect(try signature(build()) == expected) }
}

// MARK: - :523 softly moves a stop with explicit early-cutoff evidence earlier without overriding reservations

@Test func softlyMovesAStopWithExplicitEarlyCutoffEvidenceEarlier() {
  var context = PlannerContext()
  context.earlyVisitStopIds = ["tokyo-skytree"]
  let built = plan("Senso-ji\nTokyo Skytree", 1, .balanced, .en, context)
  let reserved = plan("Senso-ji — 09:00 booked\nTokyo Skytree", 1, .balanced, .en, context)

  #expect(built.days[0].stops[0].stop.id == "tokyo-skytree")
  #expect(reserved.days[0].stops[0].stop.id == "sensoji")
}

// MARK: - :535 keeps airport arrival as a hard lower bound when a user selects an earlier start

@Test func keepsAirportArrivalAsAHardLowerBoundWhenAUserSelectsAnEarlierStart() {
  var context = PlannerContext()
  context.arrivalAirport = "HND"
  context.arrivalTime = "10:00"
  context.flightKind = .international
  context.dayStartTimes = [0: "08:00"]
  let built = plan("Senso-ji", 1, .balanced, .en, context)

  #expect(built.days[0].requestedStartTime == "08:00")
  #expect(built.days[0].startTime == "12:30")
  #expect(built.days[0].startAdjustedByArrival == true)
}

// MARK: - :548 attaches real calendar dates to each planned day

@Test func attachesRealCalendarDatesToEachPlannedDay() {
  var context = PlannerContext()
  context.tripStartDate = "2026-09-14"
  let built = plan("Senso-ji\nTokyo Skytree", 3, .balanced, .en, context)

  #expect(built.days.map(\.date) == ["2026-09-14", "2026-09-15", "2026-09-16"])
}

// MARK: - :556 keeps a missing calendar date as an empty itinerary day

@Test func keepsAMissingCalendarDateAsAnEmptyItineraryDay() {
  var context = PlannerContext()
  context.tripStartDate = "2026-09-14"
  let built = plan("""
2026-09-14
Senso-ji
2026-09-16
Tokyo Skytree
""", 3, .balanced, .en, context)

  #expect(built.inputMode == .existing_itinerary)
  #expect(built.minimumPinnedDay == 3)
  #expect(built.days.map { stopIds($0) } == [["sensoji"], [], ["tokyo-skytree"]])
}

// MARK: - :571 rolls a late arrival onto the next activity date and its opening hours

@Test func rollsALateArrivalOntoTheNextActivityDateAndItsOpeningHours() throws {
  var context = PlannerContext()
  context.tripStartDate = "2026-09-14"
  context.arrivalAirport = "HND"
  context.arrivalTime = "23:30"
  context.flightKind = .international
  context.openingWindowsByDay = [
    "sensoji": [
      0: [],
      1: [VisitWindow(openMinutes: 10 * 60, closeMinutes: 17 * 60)],
    ],
  ]
  let built = plan("Senso-ji", 1, .balanced, .en, context)
  let arrival = try #require(built.airportConstraints.first { $0.direction == .arrival })

  #expect(arrival.cityTime == "02:00")
  #expect(arrival.cityTimeDayOffset == 1)
  #expect(built.days[0].date == "2026-09-15")
  #expect(built.days[0].startTime == "09:00")
  #expect(built.days[0].stops[0].arrival == "10:00")
  #expect(built.days[0].stops[0].openingStatus == .verified_open)
  #expect(built.deferredUnavailableStops.isEmpty)
}

// MARK: - :595 keeps an early departure cutoff on the previous calendar day

@Test func keepsAnEarlyDepartureCutoffOnThePreviousCalendarDay() throws {
  var context = PlannerContext()
  context.tripStartDate = "2026-09-14"
  context.departureAirport = "HND"
  context.departureTime = "02:00"
  context.flightKind = .international
  let built = plan("Senso-ji", 1, .balanced, .en, context)
  let departure = try #require(built.airportConstraints.first { $0.direction == .departure })

  #expect(departure.cityTime == "22:00")
  #expect(departure.cityTimeDayOffset == -1)
  #expect(built.days[0].date == "2026-09-14")
  #expect(built.days[0].deadline == "22:00")
  #expect(built.days[0].deadlinePreviousDay == true)
  #expect(built.days[0].deadlineOverrunMinutes > 0)
}

// MARK: - :612 uses fresh transit minutes when supplied while preserving estimated alternatives

@Test func usesFreshTransitMinutesWhilePreservingEstimatedAlternatives() throws {
  var context = PlannerContext()
  context.liveTransitMinutes = [
    routeLegKey("sensoji", "tokyo-skytree"): 41,
    routeLegKey("tokyo-skytree", "sensoji"): 41,
  ]
  let built = plan("Senso-ji\nTokyo Skytree", 1, .balanced, .en, context)
  let options = built.days[0].legs[0].comparison.options
  let transit = try #require(options.first { $0.mode == .transit })

  #expect(transit.minutes == 41)
  #expect(transit.source == .live)
  #expect(options.filter { $0.mode != .transit }.allSatisfy { $0.source == .estimate })
}

// MARK: - :626 uses live walking minutes when Google returns them

@Test func usesLiveWalkingMinutesWhenGoogleReturnsThem() throws {
  var context = PlannerContext()
  context.liveWalkingMinutes = [routeLegKey("sensoji", "tokyo-skytree"): 7]
  let built = plan("Senso-ji\nTokyo Skytree", 1, .balanced, .en, context)
  let walking = try #require(built.days[0].legs[0].comparison.options.first { $0.mode == .walk })

  #expect(walking.minutes == 7)
  #expect(walking.source == .live)
}

// MARK: - :636 treats walking and transfer limits as visible soft mobility policy

@Test func treatsWalkingAndTransferLimitsAsVisibleSoftMobilityPolicy() {
  var limits = PlannerContext()
  limits.maxWalkingMinutesPerLeg = 5
  limits.maxTransfersPerLeg = 1
  let baseline = plan("Senso-ji\nTokyo Skytree", 1, .balanced, .en, limits)
  let firstLeg = baseline.days[0].legs[0]
  let key = routeLegKey(firstLeg.from.id, firstLeg.to.id)

  var lockedWalkContext = limits
  lockedWalkContext.legModeOverrides = [key: .walk]
  let lockedWalk = plan("Senso-ji\nTokyo Skytree", 1, .balanced, .en, lockedWalkContext)

  #expect(baseline.days[0].legs[0].comparison.recommended.mode != .walk)
  #expect(
    lockedWalk.days[0].legs[0].comparison.recommended.mode == .walk,
    "an explicit mode is never silently changed"
  )
  #expect(lockedWalk.days[0].legs[0].walkingLimitExceededMinutes > 0)
  #expect(lockedWalk.mobilityPolicy == MobilityPolicy(
    maxWalkingMinutesPerLeg: 5,
    maxTransfersPerLeg: 1,
    walkingLimitWasProvided: true,
    transferLimitWasProvided: true
  ))

  let reverseKey = routeLegKey(firstLeg.to.id, firstLeg.from.id)
  var transfersContext = PlannerContext()
  transfersContext.maxTransfersPerLeg = 1
  transfersContext.liveTransitMinutes = [key: 8, reverseKey: 8]
  transfersContext.liveTransitTransferCounts = [key: 3, reverseKey: 3]
  let avoidsTransfers = plan("Senso-ji\nTokyo Skytree", 1, .balanced, .en, transfersContext)

  var lockedTransitContext = transfersContext
  lockedTransitContext.lockedOrderByDay = [0: [firstLeg.from.id, firstLeg.to.id]]
  lockedTransitContext.legModeOverrides = [key: .transit]
  let lockedTransit = plan("Senso-ji\nTokyo Skytree", 1, .balanced, .en, lockedTransitContext)

  #expect(
    avoidsTransfers.days[0].legs[0].comparison.recommended.mode != .transit,
    "an automatic choice may avoid a known transfer-limit violation"
  )
  #expect(
    avoidsTransfers.days[0].legs[0].transferCount == nil,
    "a non-transit selection does not inherit transit burden"
  )
  #expect(lockedTransit.days[0].legs[0].comparison.recommended.mode == .transit, "the user's fixed mode remains hard")
  #expect(lockedTransit.days[0].legs[0].transferCount == 3)
}
