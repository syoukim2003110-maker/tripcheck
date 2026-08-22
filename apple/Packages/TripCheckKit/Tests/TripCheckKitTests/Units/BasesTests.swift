import Testing
@testable import TripCheckKit

// task-14-brief.md §Step 1 tests + tests/travel-logic.test.ts / tests/trip-builder.test.ts の
// 拠点まわりのケースのうち、`buildTripFromWishlist` を通さずに書けるもの。

// MARK: - task-14-brief.md §Step 1

@Test func weiszfeldIsNotDraggedByOneFarTrip() {
  let near = (0..<5).map { GeoPoint(latitude: 35.68 + Double($0) * 0.001, longitude: 139.76) }
  let far = GeoPoint(latitude: 36.5, longitude: 140.5)
  let c = Bases.balancedGeoCenter(near + [far])!
  #expect(abs(c.latitude - 35.682) < 0.01)
}

@Test func tokyoBaseDefinitionsAreFive() { #expect(Bases.tokyoDefinitions.count == 5) }

/// 5 定義が数だけでなく**実際にカタログで解決できる**ことを固定する。`buildBase` は
/// `Catalog.resolveKnownStops(lookup)` が空なら `nil` を返すので、カタログ側の別名が壊れると
/// 拠点が黙って消え、`recommendBases` が 3 件ではなく 2 件を返すだけになってしまう。
/// `area` は借りてきたカタログ点のものなので、座標が本当に付いたことの証拠にもなる。
@Test func allFiveTokyoBasesResolveThroughTheCatalog() {
  let expected: [(query: String, id: String, name: String, area: String)] = [
    (query: "Shinjuku", id: "base-shinjuku", name: "Shinjuku area", area: "Shinjuku"),
    (query: "Shibuya", id: "base-shibuya", name: "Shibuya area", area: "Shibuya"),
    (query: "Tokyo Station", id: "base-tokyo-station", name: "Tokyo Station area", area: "Marunouchi"),
    (query: "Ueno", id: "base-ueno", name: "Ueno area", area: "Ueno"),
    (query: "Asakusa", id: "base-asakusa", name: "Asakusa area", area: "Asakusa"),
  ]
  #expect(expected.map(\.id) == Bases.tokyoDefinitions.map(\.id))
  for row in expected {
    let base = Bases.resolveTripBase(query: row.query, resolved: nil, locale: .en)
    #expect(base?.id == row.id)
    #expect(base?.name == row.name)
    #expect(base?.area == row.area)
    #expect(base?.latitude != 0)
    #expect(base?.longitude != 0)
  }
}

// MARK: - tests/travel-logic.test.ts
// 「one distant excursion does not drag the hotel away…」の末尾 2 行(`balancedGeoCenter` を
// 直接呼ぶ部分)。前半の `hotelAnchorForDraft`/`hotelRouteContextForDraft` の主張は
// `buildTripFromWishlist` が組んだ 5 日ぶんの plan を要求するので Task 15 へ回す。

@Test func balancedGeoCenterStaysInKyotoDespiteOneMiyazuDay() {
  let stops = [
    GeoPoint(latitude: 35.0116, longitude: 135.7681),
    GeoPoint(latitude: 35.0210, longitude: 135.7550),
    GeoPoint(latitude: 34.9950, longitude: 135.7750),
    GeoPoint(latitude: 35.0300, longitude: 135.7400),
    GeoPoint(latitude: 35.5350, longitude: 135.1950),
  ]
  let balanced = Bases.balancedGeoCenter(stops)
  #expect(balanced != nil)
  #expect(balanced!.latitude < 35.10)
  #expect(balanced!.longitude > 135.68)
}

@Test func balancedGeoCenterIsTheMeanForTwoOrFewerPoints() {
  #expect(Bases.balancedGeoCenter([]) == nil)
  let two = Bases.balancedGeoCenter([
    GeoPoint(latitude: 35.0, longitude: 139.0),
    GeoPoint(latitude: 36.0, longitude: 140.0),
  ])!
  #expect(abs(two.latitude - 35.5) < 1e-12)
  #expect(abs(two.longitude - 139.5) < 1e-12)
}

// MARK: - hotelRouteContextForDraft / hotelAnchorForDraft (lib/trip-builder.ts:791-811)

@Test func hotelRouteContextGivesEveryDayOneVoteAndDisclosesTheSpread() {
  let tokyoDay = TestStops.buildPlainDay(TestStops.line(ids: ["a", "b", "c"], areas: ["Ueno", "Ueno", "Ueno"]), index: 0)
  let farDay = TestStops.buildPlainDay(
    [
      TestStops.point(id: "far-1", lat: 35.53, lng: 135.19, area: "Miyazu"),
      TestStops.point(id: "far-2", lat: 35.54, lng: 135.20, area: "Miyazu"),
    ],
    index: 1
  )
  let plan = planWith(days: [tokyoDay, farDay])
  let context = Bases.hotelRouteContext(for: plan)!
  #expect(context.routePoints.count == 2)
  #expect(context.spreadKm > 300)
  #expect(context.area == "Ueno" || context.area == "Miyazu")

  let anchor = Bases.hotelAnchor(for: plan)!
  #expect(anchor.0.latitude == context.latitude)
  #expect(anchor.0.longitude == context.longitude)
  #expect(anchor.area == context.area)
}

@Test func hotelRouteContextIsNilWhenNoDayHasStops() {
  #expect(Bases.hotelRouteContext(for: planWith(days: [])) == nil)
  #expect(Bases.hotelAnchor(for: planWith(days: [])) == nil)
}

// MARK: - resolveTripBase (lib/trip-builder.ts:652-667)
// tests/trip-builder.test.ts「builds the day around a recognised hotel area…」と
// 「can use a real recommended hotel even when the user left the hotel field blank」の
// `selectedBase` に関する主張。

@Test func aRecognisedHotelAreaBecomesTheBase() {
  let base = Bases.resolveTripBase(query: "hotel near Shinjuku Station", resolved: nil, locale: .en)!
  #expect(base.name == "Shinjuku area")
  #expect(base.id == "base-shinjuku")
  #expect(base.planningDurationMinutes == 0)
  #expect(base.isAnchor == false)
  #expect(base.query == "hotel near Shinjuku Station")
  #expect(Bases.resolveTripBase(query: "新宿のホテル", resolved: nil, locale: .ja)!.name == "新宿エリア")
  #expect(Bases.resolveTripBase(query: "a hotel somewhere", resolved: nil, locale: .en) == nil)
  #expect(Bases.resolveTripBase(query: "   ", resolved: nil, locale: .en) == nil)
}

@Test func aResolvedHotelWinsOverTheAreaAliases() {
  let resolved = ResolvedStop(
    id: "hotel-real-1",
    name: "Real Hotel",
    area: "Asakusa",
    latitude: 35.711,
    longitude: 139.797,
    sourceUrl: "https://maps.google.com/real-hotel",
    verifiedAt: "2026-07-21T00:00:00Z",
    confidence: .medium,
    planningDurationMinutes: 0,
    isAnchor: false,
    input: "Real Hotel",
    address: "1 Asakusa, Tokyo"
  )
  let base = Bases.resolveTripBase(query: "", resolved: resolved, locale: .en)!
  #expect(base.name == "Real Hotel")
  #expect(base.id == "base-hotel-real-1")
  #expect(base.planningDurationMinutes == 0)
  // 空の入力欄では、query は解決された場所の名前で埋まる(`:659`)。
  #expect(base.query == "Real Hotel")
}

// MARK: - recommendBases (lib/trip-builder.ts:700-721)

@Test func recommendBasesRanksThreeTokyoAreasByClosedLoopDistance() {
  let cluster = TestStops.line(ids: ["a", "b", "c"])
  let recommendations = Bases.recommendBases(stops: cluster, clusters: [cluster], locale: .en, nationwide: false)
  #expect(recommendations.count == 3)
  #expect(recommendations.map(\.routeDistanceKm) == recommendations.map(\.routeDistanceKm).sorted())
  #expect(recommendations.allSatisfy { $0.base.id.hasPrefix("base-") })
  #expect(Bases.recommendBases(stops: [], clusters: [], locale: .en, nationwide: false).isEmpty)
}

@Test func nationwideModeInventsOneBasePerArea() {
  let stops = TestStops.twoClusters()
  let recommendations = Bases.recommendBases(stops: stops, clusters: [stops], locale: .en, nationwide: true)
  // 2 エリアしかないので上位 3 件を取っても 2 件。
  #expect(recommendations.count == 2)
  #expect(Set(recommendations.map(\.base.name)) == ["Tokyo Station area", "Kichijoji area"])
  #expect(recommendations.allSatisfy { $0.base.id.hasPrefix("base-dynamic-") })
}

// MARK: - resolveUserFoodReservation (lib/trip-builder.ts:677-698)
// tests/trip-builder.test.ts「keeps a user-entered restaurant reservation when its area is known」の
// 停留所そのものについての主張。

@Test func aBookedRestaurantInAKnownAreaBecomesAUserStop() {
  let constraint = WishlistStopConstraint(priority: .must, isReservation: true)
  let stop = resolveUserFoodReservation(entry: "Sushi Kaze in Shibuya", constraint: constraint, locale: .en)!
  #expect(stop.name == "Sushi Kaze in Shibuya")
  #expect(stop.isUserEntered == true)
  #expect(stop.confidence == .low)
  #expect(stop.planningDurationMinutes == 75)
  #expect(stop.isAnchor)
  #expect(stop.verifiedAt == "user-entered")
  #expect(stop.id.hasPrefix("user-food-"))
  #expect(stop.area == "Shibuya")
  #expect(stop.sourceUrl == "https://www.google.com/maps/search/?api=1&query=Sushi%20Kaze%20in%20Shibuya")
  // 同じ名前は同じ id(`stableEntryId` は大小文字を畳む)。
  let again = resolveUserFoodReservation(entry: "SUSHI KAZE IN SHIBUYA", constraint: constraint, locale: .en)!
  #expect(again.id == stop.id)
}

@Test func anUnbookedOrUnknownAreaFoodLineIsNotAUserStop() {
  let booked = WishlistStopConstraint(priority: .normal, isReservation: true)
  let unbooked = WishlistStopConstraint(priority: .normal, isReservation: false)
  #expect(resolveUserFoodReservation(entry: "Sushi Kaze in Shibuya", constraint: unbooked, locale: .en) == nil)
  #expect(resolveUserFoodReservation(entry: "Sushi Kaze in Sapporo", constraint: booked, locale: .en) == nil)
  #expect(resolveUserFoodReservation(entry: "Shibuya Sky", constraint: booked, locale: .en) == nil)
}

@Test func theNameStopsAtTheFirstDashSeparatedNote() {
  let constraint = WishlistStopConstraint(priority: .must, isReservation: true)
  let stop = resolveUserFoodReservation(entry: "Ramen Ueno — the good one", constraint: constraint, locale: .en)!
  #expect(stop.name == "Ramen Ueno")
}

// MARK: - helpers

/// `hotelRouteContextForDraft` が読むのは `plan.days` だけなので、残りは最小の詰め物。
private func planWith(days: [BuiltPlanDay]) -> BuiltTripPlan {
  BuiltTripPlan(
    inputMode: .wishlist,
    destination: .japan,
    requestedDays: days.count,
    recognizedStopCount: 0,
    scheduledStopCount: 0,
    mealBreakCount: 0,
    unknownEntries: [],
    deferredOptionalStops: [],
    deferredUnavailableStops: [],
    constraintCount: 0,
    minimumPinnedDay: 0,
    overCapacityCount: 0,
    scheduleConflictCount: 0,
    hotelQuery: "",
    hotelResolved: false,
    travelPreference: .auto,
    mobilityPolicy: MobilityPolicy(
      maxWalkingMinutesPerLeg: 30,
      maxTransfersPerLeg: 2,
      walkingLimitWasProvided: false,
      transferLimitWasProvided: false
    ),
    baseRecommendations: [],
    airportConstraints: [],
    foodRecommendationSlots: [],
    days: days
  )
}
