import Testing
@testable import TripCheckKit

// task-14-brief.md §Step 1 test + tests/trip-builder.test.ts の空港境界のケースのうち、
// `buildTripFromWishlist` を通さずに書けるもの。

// MARK: - task-14-brief.md §Step 1

@Test func midnightArrivalPushesActivityDayToNextDate() {
  var ctx = PlannerContext()
  ctx.arrivalAirport = "HND"
  ctx.arrivalTime = "23:30"
  ctx.flightKind = .international
  ctx.tripStartDate = "2026-10-13"
  let c = Airports.buildAirportConstraints(context: ctx, destination: Destinations.byId(.japan), base: nil, travel: .default)
  #expect(c[0].cityTimeDayOffset == 1)
  #expect(c[0].cityTime == "02:00")
}

// MARK: - tests/trip-builder.test.ts
// 「protects airport processing, city transfer and international departure time」の
// `airportConstraints` についての主張(`plan.days[0].deadline` は Task 15)。

@Test func airportProcessingAndTransferBracketTheCityDay() {
  var ctx = PlannerContext()
  ctx.arrivalAirport = "HND"
  ctx.arrivalTime = "10:00"
  ctx.departureAirport = "NRT"
  ctx.departureTime = "18:00"
  ctx.flightKind = .international
  let constraints = Airports.buildAirportConstraints(context: ctx, destination: Destinations.byId(.japan), base: nil, travel: .default)
  let arrival = constraints.first { $0.direction == .arrival }!
  let departure = constraints.first { $0.direction == .departure }!

  #expect(arrival.cityTime == "12:30")
  #expect(arrival.airportMinutes == 90)
  #expect(arrival.flightTime == "10:00")
  #expect(arrival.airport == "HND")
  #expect(arrival.transferMinutes == 60)
  #expect(arrival.transferCount == nil)
  #expect(arrival.sourceUrl == "https://www.tokyo-haneda.com/en/flight/detail/int_departure.html")
  #expect(arrival.googleMapsUrl == nil)
  #expect(departure.cityTime == "14:15")
  #expect(departure.airportMinutes == 120)
  #expect(departure.transferMinutes == 105)
}

// 「uses a measured airport-to-hotel route instead of the country-wide fallback」。

@Test func aMeasuredAirportTransferBeatsTheCountryWideEstimate() {
  let base = TripBase(routeStop: TestStops.point(id: "base-ueno", lat: 35.7148, lng: 139.7732, stayMinutes: 0), query: "Ueno hotel")
  let key = routeLegKey("airport-hnd", base.id)
  var ctx = PlannerContext()
  ctx.arrivalAirport = "HND"
  ctx.arrivalTime = "10:00"
  let travel = TravelInputs(preference: .auto, transit: [key: 37], transfers: [key: 2])
  let arrival = Airports.buildAirportConstraints(
    context: ctx, destination: Destinations.byId(.japan), base: base, travel: travel
  ).first { $0.direction == .arrival }!

  #expect(arrival.transferMinutes == 37)
  #expect(arrival.transferCount == 2)
  #expect(arrival.cityTime == "12:07")
  #expect(arrival.googleMapsUrl?.contains("travelmode=transit") == true)
}

// 「keeps an early departure cutoff on the previous calendar day」の `airportConstraints` 部分。

@Test func anEarlyDepartureCutoffLandsOnThePreviousCalendarDay() {
  var ctx = PlannerContext()
  ctx.departureAirport = "HND"
  ctx.departureTime = "02:00"
  ctx.flightKind = .international
  let departure = Airports.buildAirportConstraints(
    context: ctx, destination: Destinations.byId(.japan), base: nil, travel: .default
  ).first { $0.direction == .departure }!

  #expect(departure.cityTime == "22:00")
  #expect(departure.cityTimeDayOffset == -1)
}

// MARK: - 空港が選ばれていない/この目的地のものでない場合 (lib/trip-builder.ts:874-876)

@Test func anAirportThatIsNotOnThisDestinationsListConstrainsNothing() {
  var ctx = PlannerContext()
  ctx.arrivalAirport = "HND"
  ctx.arrivalTime = "10:00"
  #expect(Airports.buildAirportConstraints(context: ctx, destination: Destinations.byId(.switzerland), base: nil, travel: .default).isEmpty)

  var noTime = PlannerContext()
  noTime.arrivalAirport = "HND"
  #expect(Airports.buildAirportConstraints(context: noTime, destination: Destinations.byId(.japan), base: nil, travel: .default).isEmpty)

  var none = PlannerContext()
  none.arrivalAirport = "none"
  none.arrivalTime = "10:00"
  #expect(Airports.buildAirportConstraints(context: none, destination: Destinations.byId(.japan), base: nil, travel: .default).isEmpty)
}

// MARK: - 実測の乗換数はトランジットのときだけ (lib/trip-builder.ts:855-870)

@Test func aCarFirstTripKeepsNoMeasuredTransferCount() {
  let base = TripBase(routeStop: TestStops.point(id: "base-zermatt", lat: 46.0207, lng: 7.7491, stayMinutes: 0), query: "Zermatt hotel")
  let key = routeLegKey("airport-zrh", base.id)
  var ctx = PlannerContext()
  ctx.arrivalAirport = "ZRH"
  ctx.arrivalTime = "10:00"
  let travel = TravelInputs(preference: .car, transit: [key: 180], transfers: [key: 3], driving: [key: 200])
  let arrival = Airports.buildAirportConstraints(
    context: ctx, destination: Destinations.byId(.switzerland), base: base, travel: travel
  ).first { $0.direction == .arrival }!

  // 車の旅ではドライブの実測が先に見られ、乗換数は残らない(`:836`, `:856`)。
  #expect(arrival.transferMinutes == 200)
  #expect(arrival.transferCount == nil)
}
