import Foundation

/*
 * The trip-scenario layer's output types — how a requested day count fits the wishlist
 * (`TripFitAssessment`), what could be cut, and the counterfactual alternatives a verdict may
 * carry.
 *
 * lib/trip-scenarios.ts:15-130 (types only; `assessTripFit`, `generateTripCounterfactuals` and the
 * rest of that file are Task 17's). They live here now because `deriveFeasibilityResult`
 * (`lib/feasibility-result.ts:777`) reads a `TripFitAssessment` and returns
 * `TripCounterfactualAlternative`s, so Task 16 cannot compile without them.
 */

/// TS `TripFitLimit` (`lib/trip-scenarios.ts:15`)
public enum TripFitLimit: String, Codable, Sendable, CaseIterable {
  case airport, curfew
}

/// TS `TripFitDay` (`lib/trip-scenarios.ts:17-31`)
public struct TripFitDay: Equatable, Sendable, Codable {
  public var dayIndex: Int
  public var label: String
  public var startTime: String
  public var usableUntil: String
  public var availableMinutes: Int
  public var plannedMinutes: Int
  public var slackMinutes: Int
  public var overrunMinutes: Int
  public var placeCount: Int
  public var placeCapacity: Int
  public var excessPlaceCount: Int
  public var hasScheduleConflict: Bool
  public var limitedBy: TripFitLimit

  public init(
    dayIndex: Int,
    label: String,
    startTime: String,
    usableUntil: String,
    availableMinutes: Int,
    plannedMinutes: Int,
    slackMinutes: Int,
    overrunMinutes: Int,
    placeCount: Int,
    placeCapacity: Int,
    excessPlaceCount: Int,
    hasScheduleConflict: Bool,
    limitedBy: TripFitLimit
  ) {
    self.dayIndex = dayIndex
    self.label = label
    self.startTime = startTime
    self.usableUntil = usableUntil
    self.availableMinutes = availableMinutes
    self.plannedMinutes = plannedMinutes
    self.slackMinutes = slackMinutes
    self.overrunMinutes = overrunMinutes
    self.placeCount = placeCount
    self.placeCapacity = placeCapacity
    self.excessPlaceCount = excessPlaceCount
    self.hasScheduleConflict = hasScheduleConflict
    self.limitedBy = limitedBy
  }
}

/// TS `TripCutCandidate` (`lib/trip-scenarios.ts:33-39`)
public struct TripCutCandidate: Equatable, Sendable, Codable {
  public var id: String
  public var name: String
  public var dayIndex: Int?
  public var priority: StopPriority
  public var stayMinutes: Int

  public init(id: String, name: String, dayIndex: Int? = nil, priority: StopPriority, stayMinutes: Int) {
    self.id = id
    self.name = name
    self.dayIndex = dayIndex
    self.priority = priority
    self.stayMinutes = stayMinutes
  }
}

/// TS `TripFitAssessment["status"]` (`lib/trip-scenarios.ts:42`) — no named TS type; an inline
/// literal union at the field site.
public enum TripFitStatus: String, Codable, Sendable, CaseIterable {
  case fits, tight, needs_change, incomplete, timed_out
}

/// TS `MinimumDaysAssumptions` (`lib/trip-scenarios.ts:70-81`). The inline TS object literals in
/// each array element get a named Swift type; the field names are TS's.
public struct MinimumDaysAssumptions: Equatable, Sendable, Codable {
  /// TS `dayWindows` element (`lib/trip-scenarios.ts:72`)
  public struct DayWindow: Equatable, Sendable, Codable {
    public var dayIndex: Int
    public var start: String
    public var end: String

    public init(dayIndex: Int, start: String, end: String) {
      self.dayIndex = dayIndex
      self.start = start
      self.end = end
    }
  }

  /// TS `base` (`lib/trip-scenarios.ts:73`)
  public struct BaseIdentity: Equatable, Sendable, Codable {
    public var id: String?
    public var name: String?

    public init(id: String? = nil, name: String? = nil) {
      self.id = id
      self.name = name
    }
  }

  /// TS `stayDurations` element (`lib/trip-scenarios.ts:74`)
  public struct StayDuration: Equatable, Sendable, Codable {
    public var stopId: String
    public var minutes: Int

    public init(stopId: String, minutes: Int) {
      self.stopId = stopId
      self.minutes = minutes
    }
  }

  /// TS `lockedModes` element (`lib/trip-scenarios.ts:75`)
  public struct LockedMode: Equatable, Sendable, Codable {
    public var legId: String
    /// TS types this `string`, not `TransportMode` — it is written straight from a context record.
    public var mode: String

    public init(legId: String, mode: String) {
      self.legId = legId
      self.mode = mode
    }
  }

  /// TS `airportBoundaries` element (`lib/trip-scenarios.ts:76`)
  public struct AirportBoundary: Equatable, Sendable, Codable {
    public var direction: AirportConstraintDirection
    public var airport: String
    public var flightTime: String
    public var cityTime: String

    public init(direction: AirportConstraintDirection, airport: String, flightTime: String, cityTime: String) {
      self.direction = direction
      self.airport = airport
      self.flightTime = flightTime
      self.cityTime = cityTime
    }
  }

  /// TS `fixedBookings` element (`lib/trip-scenarios.ts:77`)
  public struct FixedBooking: Equatable, Sendable, Codable {
    public var stopId: String
    public var dayIndex: Int
    public var time: String

    public init(stopId: String, dayIndex: Int, time: String) {
      self.stopId = stopId
      self.dayIndex = dayIndex
      self.time = time
    }
  }

  /// TS `openingStatuses` element (`lib/trip-scenarios.ts:78`). TS types `status` as `string`.
  public struct OpeningStatusEntry: Equatable, Sendable, Codable {
    public var stopId: String
    public var dayIndex: Int
    public var status: String

    public init(stopId: String, dayIndex: Int, status: String) {
      self.stopId = stopId
      self.dayIndex = dayIndex
      self.status = status
    }
  }

  /// TS `Array<string | null>` — one entry per planned day; `nil` where the day has no date.
  public var dates: [String?]
  public var dayWindows: [DayWindow]
  public var base: BaseIdentity
  public var stayDurations: [StayDuration]
  public var lockedModes: [LockedMode]
  public var airportBoundaries: [AirportBoundary]
  public var fixedBookings: [FixedBooking]
  public var openingStatuses: [OpeningStatusEntry]
  public var transferBufferMinutes: Int
  public var mobilityPolicy: MobilityPolicy

  public init(
    dates: [String?],
    dayWindows: [DayWindow],
    base: BaseIdentity,
    stayDurations: [StayDuration],
    lockedModes: [LockedMode],
    airportBoundaries: [AirportBoundary],
    fixedBookings: [FixedBooking],
    openingStatuses: [OpeningStatusEntry],
    transferBufferMinutes: Int,
    mobilityPolicy: MobilityPolicy
  ) {
    self.dates = dates
    self.dayWindows = dayWindows
    self.base = base
    self.stayDurations = stayDurations
    self.lockedModes = lockedModes
    self.airportBoundaries = airportBoundaries
    self.fixedBookings = fixedBookings
    self.openingStatuses = openingStatuses
    self.transferBufferMinutes = transferBufferMinutes
    self.mobilityPolicy = mobilityPolicy
  }
}

/// TS `TripFitAssessment` (`lib/trip-scenarios.ts:41-68`)
public struct TripFitAssessment: Equatable, Sendable, Codable {
  public var status: TripFitStatus
  public var requestedDays: Int
  public var minimumDays: Int?
  /// Minimum days for the places that DID resolve, computed while the full verdict is withheld by
  /// unresolved/unavailable entries. Clearly qualified in the UI; never a substitute for
  /// `minimumDays`.
  public var partialMinimumDays: Int?
  public var additionalDaysNeeded: Int?
  public var spareDays: Int?
  public var searchedThroughDays: Int
  public var dayEndAssumption: String
  public var solverTimedOut: Bool
  public var minimumDaysAssumptions: MinimumDaysAssumptions
  public var days: [TripFitDay]
  public var overloadedDayCount: Int
  public var scheduleConflictCount: Int
  public var deferredOptionalCount: Int
  public var unavailableCount: Int
  public var unresolvedCount: Int
  public var cutCandidates: [TripCutCandidate]
  public var suggestedCutCount: Int

  public init(
    status: TripFitStatus,
    requestedDays: Int,
    minimumDays: Int? = nil,
    partialMinimumDays: Int? = nil,
    additionalDaysNeeded: Int? = nil,
    spareDays: Int? = nil,
    searchedThroughDays: Int,
    dayEndAssumption: String,
    solverTimedOut: Bool,
    minimumDaysAssumptions: MinimumDaysAssumptions,
    days: [TripFitDay],
    overloadedDayCount: Int,
    scheduleConflictCount: Int,
    deferredOptionalCount: Int,
    unavailableCount: Int,
    unresolvedCount: Int,
    cutCandidates: [TripCutCandidate],
    suggestedCutCount: Int
  ) {
    self.status = status
    self.requestedDays = requestedDays
    self.minimumDays = minimumDays
    self.partialMinimumDays = partialMinimumDays
    self.additionalDaysNeeded = additionalDaysNeeded
    self.spareDays = spareDays
    self.searchedThroughDays = searchedThroughDays
    self.dayEndAssumption = dayEndAssumption
    self.solverTimedOut = solverTimedOut
    self.minimumDaysAssumptions = minimumDaysAssumptions
    self.days = days
    self.overloadedDayCount = overloadedDayCount
    self.scheduleConflictCount = scheduleConflictCount
    self.deferredOptionalCount = deferredOptionalCount
    self.unavailableCount = unavailableCount
    self.unresolvedCount = unresolvedCount
    self.cutCandidates = cutCandidates
    self.suggestedCutCount = suggestedCutCount
  }
}

/// TS `TripFitSearchOptions` (`lib/trip-scenarios.ts:83-88`). TS's `timeoutMs?: number` becomes a
/// `Duration`, and its `now?: () => number` test seam becomes a `Clock`; Task 17 owns the search
/// that reads them, and may refine this type when it lands.
public struct TripFitSearchOptions: Sendable {
  /// Wall-clock guard. A timeout never falls through to a minimum-day claim.
  public var timeout: Duration
  /// Test seam for deterministic timeout coverage.
  public var clock: any Clock<Duration>

  public init(timeout: Duration = EngineConstants.tripFitTimeout, clock: any Clock<Duration> = ContinuousClock()) {
    self.timeout = timeout
    self.clock = clock
  }
}

/// TS `TripScenarioMetrics` (`lib/trip-scenarios.ts:90-97`)
public struct TripScenarioMetrics: Equatable, Sendable, Codable {
  public var hardConflictCount: Int
  public var overrunMinutes: Int
  public var minimumSlackMinutes: Int?
  public var scheduledStopCount: Int
  public var dayCount: Int
  public var travelMinutes: Int

  public init(
    hardConflictCount: Int,
    overrunMinutes: Int,
    minimumSlackMinutes: Int? = nil,
    scheduledStopCount: Int,
    dayCount: Int,
    travelMinutes: Int
  ) {
    self.hardConflictCount = hardConflictCount
    self.overrunMinutes = overrunMinutes
    self.minimumSlackMinutes = minimumSlackMinutes
    self.scheduledStopCount = scheduledStopCount
    self.dayCount = dayCount
    self.travelMinutes = travelMinutes
  }
}

/// TS `TripCounterfactualAlternative["kind"]` (`lib/trip-scenarios.ts:101`)
public enum CounterfactualKind: String, Codable, Sendable, CaseIterable {
  case CHANGE_DAYS, START_EARLIER, END_LATER, REMOVE_OPTIONAL, CHANGE_BASE, CHANGE_MODE, OPTIMIZE_ORDER
}

/// TS `TripCounterfactualAlternative["loss"]["kind"]` (`lib/trip-scenarios.ts:124`)
public enum LossKind: String, Codable, Sendable, CaseIterable {
  case OPTIONAL_STOP, TRANSPORT_TRADEOFF, ORIGINAL_ORDER
}

/// TS `TripCounterfactualAlternative` (`lib/trip-scenarios.ts:99-130`)
public struct TripCounterfactual: Equatable, Sendable, Codable {
  /// TS `change` (`lib/trip-scenarios.ts:102-115`) — every field optional; which ones are set
  /// depends on `kind`.
  public struct Change: Equatable, Sendable, Codable {
    public var days: Int?
    public var dayDelta: Int?
    public var minutes: Int?
    public var stopId: String?
    public var stopName: String?
    public var baseId: String?
    public var baseName: String?
    public var legId: String?
    public var fromName: String?
    public var toName: String?
    public var mode: TransportMode?
    /// TS `Record<number, string[]>` — see `Core/IntKeyed.swift`.
    public var orderByDay: IntKeyedDictionary<[String]>?
    public var travelMinutesSaved: Int?

    public init(
      days: Int? = nil,
      dayDelta: Int? = nil,
      minutes: Int? = nil,
      stopId: String? = nil,
      stopName: String? = nil,
      baseId: String? = nil,
      baseName: String? = nil,
      legId: String? = nil,
      fromName: String? = nil,
      toName: String? = nil,
      mode: TransportMode? = nil,
      orderByDay: IntKeyedDictionary<[String]>? = nil,
      travelMinutesSaved: Int? = nil
    ) {
      self.days = days
      self.dayDelta = dayDelta
      self.minutes = minutes
      self.stopId = stopId
      self.stopName = stopName
      self.baseId = baseId
      self.baseName = baseName
      self.legId = legId
      self.fromName = fromName
      self.toName = toName
      self.mode = mode
      self.orderByDay = orderByDay
      self.travelMinutesSaved = travelMinutesSaved
    }
  }

  /// TS `improvement` (`lib/trip-scenarios.ts:118-123`)
  public struct Improvement: Equatable, Sendable, Codable {
    public var hardConflictsRemoved: Int
    public var overrunMinutesReduced: Int
    public var slackMinutesGained: Int?
    public var travelMinutesReduced: Int

    public init(
      hardConflictsRemoved: Int,
      overrunMinutesReduced: Int,
      slackMinutesGained: Int? = nil,
      travelMinutesReduced: Int
    ) {
      self.hardConflictsRemoved = hardConflictsRemoved
      self.overrunMinutesReduced = overrunMinutesReduced
      self.slackMinutesGained = slackMinutesGained
      self.travelMinutesReduced = travelMinutesReduced
    }
  }

  /// TS `loss` (`lib/trip-scenarios.ts:124-130`) — `null` when the alternative gives nothing up.
  public struct Loss: Equatable, Sendable, Codable {
    public var kind: LossKind
    public var stopId: String?
    public var stopName: String?
    public var stayMinutes: Int?
    public var legId: String?
    public var mode: TransportMode?

    public init(
      kind: LossKind,
      stopId: String? = nil,
      stopName: String? = nil,
      stayMinutes: Int? = nil,
      legId: String? = nil,
      mode: TransportMode? = nil
    ) {
      self.kind = kind
      self.stopId = stopId
      self.stopName = stopName
      self.stayMinutes = stayMinutes
      self.legId = legId
      self.mode = mode
    }
  }

  public var id: String
  public var kind: CounterfactualKind
  public var change: Change
  public var before: TripScenarioMetrics
  public var after: TripScenarioMetrics
  public var improvement: Improvement
  public var loss: Loss?

  public init(
    id: String,
    kind: CounterfactualKind,
    change: Change,
    before: TripScenarioMetrics,
    after: TripScenarioMetrics,
    improvement: Improvement,
    loss: Loss? = nil
  ) {
    self.id = id
    self.kind = kind
    self.change = change
    self.before = before
    self.after = after
    self.improvement = improvement
    self.loss = loss
  }
}
