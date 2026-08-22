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
  // 到着リンクは空港(HND 35.5494,139.7798)発・ホテル着。
  #expect(arrival.googleMapsUrl == hndToUenoTransit)
}

// 出発側の実測は `routeLegKey(base, airport)` で引く(`:839`、到着の逆向き)。到着だけを
// 覆っていると、この鍵を取り違えても気づけない。
@Test func aMeasuredHotelToAirportRouteBeatsTheCountryWideEstimate() {
  let base = TripBase(routeStop: TestStops.point(id: "base-ueno", lat: 35.7148, lng: 139.7732, stayMinutes: 0), query: "Ueno hotel")
  var ctx = PlannerContext()
  ctx.departureAirport = "NRT"
  ctx.departureTime = "18:00"
  ctx.flightKind = .international
  let travel = TravelInputs(
    preference: .auto,
    // 到着向きの鍵しか持たないなら、出発の制約は全国推定(105 分)のまま。
    transit: [routeLegKey(base.id, "airport-nrt"): 45, routeLegKey("airport-nrt", base.id): 999],
    transfers: [routeLegKey(base.id, "airport-nrt"): 1, routeLegKey("airport-nrt", base.id): 9]
  )
  let departure = Airports.buildAirportConstraints(
    context: ctx, destination: Destinations.byId(.japan), base: base, travel: travel
  ).first { $0.direction == .departure }!

  #expect(departure.transferMinutes == 45)
  #expect(departure.transferCount == 1)
  #expect(departure.cityTime == "15:15")   // 18:00 − 120 − 45
}

// MARK: - 地図リンクの向き (lib/trip-builder.ts:917 / :944)

@Test func theMapLinkLeavesFromTheAirportOnArrivalAndFromTheHotelOnDeparture() {
  let base = TripBase(routeStop: TestStops.point(id: "base-ueno", lat: 35.7148, lng: 139.7732, stayMinutes: 0), query: "Ueno hotel")
  var ctx = PlannerContext()
  ctx.arrivalAirport = "HND"
  ctx.arrivalTime = "10:00"
  ctx.departureAirport = "NRT"
  ctx.departureTime = "18:00"
  ctx.flightKind = .international
  let constraints = Airports.buildAirportConstraints(
    context: ctx, destination: Destinations.byId(.japan), base: base, travel: .default
  )
  let arrival = constraints.first { $0.direction == .arrival }!
  let departure = constraints.first { $0.direction == .departure }!

  // 到着は空港 → ホテル(`:917` の `[airport, base]`)。
  #expect(arrival.googleMapsUrl == hndToUenoTransit)
  // 出発はホテル → 空港(`:944` の `[base, airport]`)。両者を同じ順で組むと、出発リンクが
  // 空港を出発地にした逆走の経路を開いてしまう。
  #expect(departure.googleMapsUrl == "https://www.google.com/maps/dir/?api=1&origin=35.7148%2C139.7732&destination=35.772%2C140.3929&travelmode=transit")
  // 端点の順以外は同じ経路なので、片方をもう片方の入れ替えとしても読めることを固定する。
  #expect(arrival.googleMapsUrl != departure.googleMapsUrl)
}

/// HND(35.5494,139.7798) → 上野のホテル(35.7148,139.7732)、`travelmode=transit`。
/// 座標は `Destinations` と `TestStops.point` の決定的な値なので完全一致で固定できる。
private let hndToUenoTransit =
  "https://www.google.com/maps/dir/?api=1&origin=35.5494%2C139.7798&destination=35.7148%2C139.7732&travelmode=transit"

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
