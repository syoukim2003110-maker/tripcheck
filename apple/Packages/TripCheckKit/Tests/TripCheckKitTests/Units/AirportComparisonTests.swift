import Testing
@testable import TripCheckKit

// task-8-brief.md §Step 1 test (verbatim, adapted: `AirportComparison.compare` returns
// `[AirportOptionResult]` directly rather than TS's `{ options, timeWinnerId }` envelope, so
// `r[0]` indexes the array in place of `result.options[0]`).

@Test func airportBoundariesCrossMidnight() {
  let jp = Destinations.byId(.japan)
  let r = AirportComparison.compare(options: [.init(code: "HND", flightTime: "23:30")], direction: .arrival, flightKind: .international, destination: jp)
  #expect(r[0].cityTime == "02:00")          // 23:30 + 90 + 60
  #expect(r[0].cityTimeDayOffset == 1)
  #expect(r[0].airportMinutes == 90)
}

// MARK: - Ported from tests/airport-comparison.test.ts (the `compareAirportOptions` cases only;
// "returns only airports serving the same metropolitan base", "does not substitute an airport in
// another city for an unpaired gateway" and "uses the destination's first metro group only when no
// airport is selected" exercise `destinationAirportComparisonGroup` = `Destinations.
// airportComparisonGroup`, not `AirportComparison` — that function belongs to Task 6's Destinations
// and already has coverage in DestinationsTests.swift's `hasTwentyFiveProfilesAndJapanFacts`.)

@Test func comparesInternationalArrivalsByTheTimeTheTravellerReachesTheCity() {
  // tests/airport-comparison.test.ts:43-59
  let jp = Destinations.byId(.japan)
  let result = AirportComparison.compare(
    options: [.init(code: "HND", flightTime: "10:00"), .init(code: "NRT", flightTime: "09:30")],
    direction: .arrival, flightKind: .international, destination: jp
  )
  #expect(result.first { $0.isTimeWinner }?.code == "HND")
  #expect(result.map { ($0.code, $0.cityTime, $0.timeDisadvantageMinutes) }.map { "\($0.0) \($0.1) \($0.2)" } == ["HND 12:30 0", "NRT 12:45 15"])
}

@Test func comparesInternationalDeparturesByTheTimeTheTravellerLeavesTheCity() {
  // tests/airport-comparison.test.ts:61-77
  let jp = Destinations.byId(.japan)
  let result = AirportComparison.compare(
    options: [.init(code: "HND", flightTime: "18:00"), .init(code: "NRT", flightTime: "19:00")],
    direction: .departure, flightKind: .international, destination: jp
  )
  #expect(result.first { $0.isTimeWinner }?.code == "NRT")
  #expect(result.map { ($0.code, $0.cityTime, $0.timeDisadvantageMinutes) }.map { "\($0.0) \($0.1) \($0.2)" } == ["HND 14:00 75", "NRT 15:15 0"])
}

@Test func usesTheDomesticProcessingAssumptions() {
  // tests/airport-comparison.test.ts:79-97
  let jp = Destinations.byId(.japan)
  let arrival = AirportComparison.compare(options: [.init(code: "HND", flightTime: "10:00")], direction: .arrival, flightKind: .domestic, destination: jp)[0]
  let departure = AirportComparison.compare(options: [.init(code: "HND", flightTime: "18:00")], direction: .departure, flightKind: .domestic, destination: jp)[0]

  #expect(arrival.airportMinutes == 45)
  #expect(arrival.cityTime == "11:45")
  #expect(departure.airportMinutes == 90)
  #expect(departure.cityTime == "15:30")
}

@Test func keepsCalendarRolloverVisible() {
  // tests/airport-comparison.test.ts:99-117
  let jp = Destinations.byId(.japan)
  let arrival = AirportComparison.compare(options: [.init(code: "HND", flightTime: "23:30")], direction: .arrival, flightKind: .international, destination: jp)[0]
  let departure = AirportComparison.compare(options: [.init(code: "NRT", flightTime: "02:00")], direction: .departure, flightKind: .international, destination: jp)[0]

  #expect(arrival.cityTime == "02:00")
  #expect(arrival.cityTimeDayOffset == 1)
  #expect(departure.cityTime == "22:15")
  #expect(departure.cityTimeDayOffset == -1)
}

@Test func dropsInvalidAirportsAndTimesWithoutInventingAResult() {
  // tests/airport-comparison.test.ts:119-132
  let jp = Destinations.byId(.japan)
  let result = AirportComparison.compare(
    options: [.init(code: "ZRH", flightTime: "10:00"), .init(code: "HND", flightTime: "25:00")],
    direction: .arrival, flightKind: .international, destination: jp
  )
  #expect(result.isEmpty)
}

@Test func preservesInputOrderAndMarksEveryTiedOption() {
  // tests/airport-comparison.test.ts:134-148
  let jp = Destinations.byId(.japan)
  let result = AirportComparison.compare(
    options: [.init(code: "HND", flightTime: "10:00"), .init(code: "NRT", flightTime: "09:15")],
    direction: .arrival, flightKind: .international, destination: jp
  )
  #expect(result.map(\.code) == ["HND", "NRT"])
  #expect(result.map(\.isTimeWinner) == [true, true])
}
