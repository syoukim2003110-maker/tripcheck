import Testing
@testable import TripCheckKit

// task-8-brief.md §Step 1 tests (verbatim).

@Test func travelEstimatesRoundUpToFiveAndRespectFloors() {
  let c = TravelEstimates.estimate(distanceKm: 1.0, preference: .auto, mobility: .transit_first, live: .none, allowedModes: nil, override: nil)
  #expect(c.options.first { $0.mode == .walk }?.minutes == 20)      // 5 + 60/4.5 = 18.3 → 20
  #expect(c.options.first { $0.mode == .transit }?.minutes == 20)   // 12 + 5.5 = 17.5 → 20
  #expect(c.options.first { $0.mode == .taxi }?.minutes == 15)      // 8 + 3 = 11 → 15
  #expect(c.recommended.mode == .walk)                              // 徒歩 ≤25 分
}

@Test func transitFirstKeepsMeasuredTrainAgainstUnmeasuredTaxi() {
  // ラウターブルンネン→ツェルマット: 実測鉄道 150 分 vs 推定タクシー 105 分
  let c = TravelEstimates.estimate(distanceKm: 70, preference: .auto, mobility: .transit_first,
                                   live: LiveLegEvidence(transitMinutes: 150, transitAbsent: false, transferCount: 2, walkingMinutes: nil, drivingMinutes: nil), allowedModes: nil, override: nil)
  #expect(c.recommended.mode == .transit)
}

@Test func unroutableTransitIsNegativeEvidenceNotARecommendation() {
  let c = TravelEstimates.estimate(distanceKm: 12, preference: .auto, mobility: .transit_first,
                                   live: LiveLegEvidence(transitMinutes: nil, transitAbsent: true, transferCount: nil, walkingMinutes: nil, drivingMinutes: 25), allowedModes: nil, override: nil)
  #expect(c.recommended.mode == .taxi)
  #expect(c.options.first { $0.mode == .transit }?.unroutable == true)
}

// MARK: - Ported from tests/travel-logic.test.ts (the `estimateTravelOptions`/`applyLiveTransitMinutes`
// cases only; the `buildTripFromWishlist`/`buildPlanningRouteLegs`/`prefetchPlanningRouteDurations`
// cases — "a day-consuming park...", "a per-leg pick overrides...", "a day-end curfew...",
// "removing a stop...", "the hotel anchor...", "hotel departure and return legs...",
// "a one-tap day move...", "the day-rhythm default start...", "car-preference legs are measured..." —
// need `trip-builder.ts`/`planning-live-routes-client.ts`, which are out of this task's scope.)

@Test func anIntercityLegIsNeverA200MinuteTaxiCrawl() {
  // tests/travel-logic.test.ts:26-39 — ~90 km straight line (Osaka city → Tango peninsula class).
  let distanceKm = straightLineDistanceKm(GeoPoint(latitude: 34.69, longitude: 135.5), GeoPoint(latitude: 35.5, longitude: 135.19))
  let comparison = TravelEstimates.estimate(distanceKm: distanceKm)
  let taxi = comparison.options.first { $0.mode == .taxi }!
  let transit = comparison.options.first { $0.mode == .transit }!
  #expect(taxi.minutes < 160, "taxi should ride the expressway tier, got \(taxi.minutes)")
  #expect(transit.minutes < 180, "transit should ride the express tier, got \(transit.minutes)")
  #expect(comparison.recommended.mode != .walk)
  // On transit-first ground rail may be preferred over a somewhat faster taxi,
  // but never beyond the proportional allowance.
  let allowance = max(10, Int((Double(taxi.minutes) * 0.25).rounded(.toNearestOrAwayFromZero)))
  #expect(comparison.recommended.minutes <= comparison.fastest.minutes + allowance)
}

@Test func transitFirstIntercityLegsPreferRailEvenAgainstALiveMeasuredTaxiWithUnmeasuredTransit() {
  // tests/travel-logic.test.ts:41-61 — Interlaken → Bern, ~44 km straight line: Swiss rail territory.
  let distanceKm = straightLineDistanceKm(GeoPoint(latitude: 46.6863, longitude: 7.8632), GeoPoint(latitude: 46.948, longitude: 7.4474))
  let estimate = TravelEstimates.estimate(distanceKm: distanceKm, preference: .auto, mobility: .transit_first)
  #expect(estimate.recommended.mode == .transit)
  // Asymmetric evidence: a live 47-minute drive with only an estimated train
  // must not flip the leg to taxi — the train simply has not been measured.
  let driveOnly = TravelEstimates.applyLiveTransit(estimate, minutes: nil, drivingMinutes: 47, preference: .auto, mobility: .transit_first)
  #expect(driveOnly.recommended.mode == .transit)
  // Once transit is measured, real numbers decide (52 vs 47 + allowance).
  let measured = TravelEstimates.applyLiveTransit(estimate, minutes: 52, drivingMinutes: 47, preference: .auto, mobility: .transit_first)
  #expect(measured.recommended.mode == .transit)
  #expect(measured.recommended.minutes == 52)
  // A provider-answered "no transit route" is negative live evidence: the
  // fabricated train estimate may no longer outrank the measured drive.
  let unroutable = TravelEstimates.applyLiveTransit(estimate, minutes: nil, drivingMinutes: 47, preference: .auto, mobility: .transit_first, transitUnroutable: true)
  #expect(unroutable.recommended.mode == .taxi)
  #expect(unroutable.recommended.minutes == 47)
  #expect(unroutable.options.first { $0.mode == .transit }?.unroutable == true)
}

@Test func shortHopsRecommendWalkingCityLegsRecommendTheFastestSaneMode() {
  // tests/travel-logic.test.ts:63-73
  let sensoToSkytree = straightLineDistanceKm(GeoPoint(latitude: 35.7148, longitude: 139.7967), GeoPoint(latitude: 35.7101, longitude: 139.8107))
  #expect(TravelEstimates.estimate(distanceKm: sensoToSkytree).recommended.mode == .walk)

  let shinjukuToAsakusa = straightLineDistanceKm(GeoPoint(latitude: 35.6896, longitude: 139.7006), GeoPoint(latitude: 35.7148, longitude: 139.7967))
  let city = TravelEstimates.estimate(distanceKm: shinjukuToAsakusa)
  #expect(city.recommended.mode == .transit)
  #expect(city.recommended.minutes <= city.fastest.minutes + 10)
}

@Test func theRentalCarPreferenceDrivesEveryLegExceptTinyWalks() {
  // tests/travel-logic.test.ts:75-83
  let shinjukuToAsakusa = straightLineDistanceKm(GeoPoint(latitude: 35.6896, longitude: 139.7006), GeoPoint(latitude: 35.7148, longitude: 139.7967))
  #expect(TravelEstimates.estimate(distanceKm: shinjukuToAsakusa, preference: .car).recommended.mode == .taxi)

  let nearToNearby = straightLineDistanceKm(GeoPoint(latitude: 35.6896, longitude: 139.7006), GeoPoint(latitude: 35.6916, longitude: 139.7026))
  #expect(TravelEstimates.estimate(distanceKm: nearToNearby, preference: .car).recommended.mode == .walk)
}

@Test func measuredGoogleMinutesCanFlipTheRecommendedModeLikeGoogleMaps() {
  // tests/travel-logic.test.ts:85-100
  let distanceKm = straightLineDistanceKm(GeoPoint(latitude: 35.6896, longitude: 139.7006), GeoPoint(latitude: 35.7148, longitude: 139.7967))
  let estimated = TravelEstimates.estimate(distanceKm: distanceKm)
  #expect(estimated.recommended.mode == .transit)

  // Google reports an unusually quick walk (event closure, straight promenade).
  let walkWins = TravelEstimates.applyLiveTransit(estimated, minutes: 40, walkingMinutes: 18)
  #expect(walkWins.recommended.mode == .walk)
  #expect(walkWins.recommended.source == .live)

  // Google reports the car clearly beating the measured train.
  let carWins = TravelEstimates.applyLiveTransit(estimated, minutes: 38, drivingMinutes: 20)
  #expect(carWins.recommended.mode == .taxi)
  #expect(carWins.recommended.minutes == 20)
}
