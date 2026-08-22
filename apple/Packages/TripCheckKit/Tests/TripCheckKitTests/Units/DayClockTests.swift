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
