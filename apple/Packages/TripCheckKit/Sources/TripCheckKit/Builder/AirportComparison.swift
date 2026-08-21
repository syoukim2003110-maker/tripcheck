import Foundation

/*
 * Compares traveller-supplied flight candidates by usable trip time only. It
 * deliberately performs no provider, price or AI call.
 *
 * lib/airport-comparison.ts (whole file, 128 lines).
 */

/// TS `AirportDirection` (`lib/airport-comparison.ts:4`)
public enum AirportDirection: String, Codable, Sendable, CaseIterable {
  case arrival, departure
}

/// TS `AirportOptionInput` (`lib/airport-comparison.ts:6-13`), reduced to the two fields
/// task-8-brief.md names (`code`, `flightTime`) plus an optional `transferMinutes` override kept
/// for TS parity ("a selected hotel's live route may replace the destination estimate",
/// `:11-12`) — no ported test exercises it, but dropping it would silently lose that TS behaviour.
public struct AirportOptionInput: Sendable {
  public var code: String
  /// Scheduled local airport time, HH:mm.
  public var flightTime: String
  public var transferMinutes: Int?

  public init(code: String, flightTime: String, transferMinutes: Int? = nil) {
    self.code = code
    self.flightTime = flightTime
    self.transferMinutes = transferMinutes
  }
}

/// TS `AirportOptionResult` (`lib/airport-comparison.ts:23-40`), field names adapted per
/// task-8-brief.md (`cityBoundaryTime`→`cityTime`, `cityDayOffset`→`cityTimeDayOffset`,
/// `processingMinutes`→`airportMinutes`); `id`/`airportCode` collapse into `code` (identity is the
/// input's `code`, matching every input/output pairing in the ported test suite); `evidence` is
/// dropped (no ported test reads it).
public struct AirportOptionResult: Hashable, Sendable {
  public var code: String
  public var airportName: String
  public var flightTime: String
  /// Arrival: ready in the main city. Departure: leave the main city.
  public var cityTime: String
  public var cityTimeDayOffset: Int
  public var airportMinutes: Int
  public var transferMinutes: Int
  public var timeDisadvantageMinutes: Int
  public var isTimeWinner: Bool
  public var sourceUrl: String

  public init(
    code: String,
    airportName: String,
    flightTime: String,
    cityTime: String,
    cityTimeDayOffset: Int,
    airportMinutes: Int,
    transferMinutes: Int,
    timeDisadvantageMinutes: Int,
    isTimeWinner: Bool,
    sourceUrl: String
  ) {
    self.code = code
    self.airportName = airportName
    self.flightTime = flightTime
    self.cityTime = cityTime
    self.cityTimeDayOffset = cityTimeDayOffset
    self.airportMinutes = airportMinutes
    self.transferMinutes = transferMinutes
    self.timeDisadvantageMinutes = timeDisadvantageMinutes
    self.isTimeWinner = isTimeWinner
    self.sourceUrl = sourceUrl
  }
}

public enum AirportComparison {
  private struct Interim {
    var code: String
    var airportName: String
    var flightTime: String
    var boundary: Int
    var processingMinutes: Int
    var transferMinutes: Int
    var sourceUrl: String
  }

  /// TS `compareAirportOptions` (`lib/airport-comparison.ts:71-128`), returning the flat
  /// `[AirportOptionResult]` the brief's interface specifies in place of TS's
  /// `{ direction, options, timeWinnerId }` envelope — `timeWinnerId` is recoverable as
  /// `options.first { $0.isTimeWinner }?.code`.
  public static func compare(
    options: [AirportOptionInput],
    direction: AirportDirection,
    flightKind: FlightKind,
    destination: Destination,
    locale: PlannerLocale = .en
  ) -> [AirportOptionResult] {
    let interim: [Interim] = options.compactMap { option in
      guard let airport = Destinations.airport(destination, code: option.code) else { return nil }
      guard let scheduled = ClockTime(option.flightTime)?.minutes else { return nil }

      let hasLiveTransfer = (option.transferMinutes ?? 0) > 0
      let transferMinutes = hasLiveTransfer ? option.transferMinutes! : airport.transferMinutes
      // lib/airport-comparison.ts:83-85
      let processingMinutes = direction == .arrival
        ? (flightKind == .international ? 90 : 45)
        : (flightKind == .international ? airport.internationalDepartureMinutes : 90)
      // lib/airport-comparison.ts:86-88
      let boundary = direction == .arrival
        ? scheduled + processingMinutes + transferMinutes
        : scheduled - processingMinutes - transferMinutes

      return Interim(
        code: airport.code,
        airportName: (locale == .ja ? airport.names[.ja] : airport.names[.en]) ?? airport.names[.en] ?? "",
        flightTime: ClockTime(minutes: scheduled).description,
        boundary: boundary,
        processingMinutes: processingMinutes,
        transferMinutes: transferMinutes,
        sourceUrl: airport.sourceUrl
      )
    }

    guard !interim.isEmpty else { return [] }
    // lib/airport-comparison.ts:113-115
    let winningBoundary = direction == .arrival
      ? interim.map(\.boundary).min()!
      : interim.map(\.boundary).max()!

    return interim.map { item in
      let disadvantage = direction == .arrival ? item.boundary - winningBoundary : winningBoundary - item.boundary
      return AirportOptionResult(
        code: item.code,
        airportName: item.airportName,
        flightTime: item.flightTime,
        cityTime: ClockTime(minutes: item.boundary).description,
        cityTimeDayOffset: item.boundary < 0 ? -1 : item.boundary >= 1440 ? 1 : 0,
        airportMinutes: item.processingMinutes,
        transferMinutes: item.transferMinutes,
        timeDisadvantageMinutes: disadvantage,
        isTimeWinner: item.boundary == winningBoundary,
        sourceUrl: item.sourceUrl
      )
    }
  }
}
