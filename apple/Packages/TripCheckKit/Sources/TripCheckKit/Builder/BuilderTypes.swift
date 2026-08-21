// Task 2 は EngineConstants が参照する Pace のみを先取りした。
// 残りの Builder 型(StopPriority, MealPlan, MealKind, TransportMode, TravelPreference, VisitWindow,
// FlightKind)は Task 8 で追加する(StayEstimates/TravelEstimates/PoiAccess/AirportComparison の依存型)。
public enum Pace: String, Codable, Sendable, CaseIterable {
  case relaxed, balanced, fast
}

/// TS `StopPriority` (`lib/trip-builder.ts:123`)
public enum StopPriority: String, Codable, Sendable, CaseIterable {
  case must, normal, optional
}

/// TS `MealPlan` (`lib/trip-builder.ts:124`)
public enum MealPlan: String, Codable, Sendable, CaseIterable {
  case all, dinner, none
}

/// TS `MealKind` (`lib/trip-builder.ts:125`)
public enum MealKind: String, Codable, Sendable, CaseIterable {
  case lunch, dinner
}

/// TS `TransportMode` (`lib/time-feasibility.ts:4`)
public enum TransportMode: String, Codable, Sendable, CaseIterable {
  case walk, transit, taxi
}

/// TS `TravelPreference` (`lib/time-feasibility.ts:6`) — "auto" recommends the fastest sane mode;
/// "car" plans the trip around a rental car.
public enum TravelPreference: String, Codable, Sendable, CaseIterable {
  case auto, car
}

/// TS `VisitWindow` (`lib/trip-builder.ts:116-121`)
public struct VisitWindow: Hashable, Codable, Sendable {
  public var openMinutes: Int
  public var closeMinutes: Int
  /// Admission cutoff, distinct from the time the facility closes.
  public var lastEntryMinutes: Int?

  public init(openMinutes: Int, closeMinutes: Int, lastEntryMinutes: Int? = nil) {
    self.openMinutes = openMinutes
    self.closeMinutes = closeMinutes
    self.lastEntryMinutes = lastEntryMinutes
  }
}

/// TS `FlightKind` (`lib/airport-comparison.ts:3`)
public enum FlightKind: String, Codable, Sendable, CaseIterable {
  case international, domestic
}
