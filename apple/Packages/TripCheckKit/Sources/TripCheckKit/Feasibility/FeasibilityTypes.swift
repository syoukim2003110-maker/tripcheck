import Foundation

/*
 * The verdict's vocabulary: the five states, the conflicts that can refuse a plan, the soft
 * attentions and assumptions that qualify one, and the options an evidence snapshot is built from.
 *
 * lib/feasibility-result.ts:5, 56-206.
 */

/// TS `ENGINE_VERSION` (`lib/feasibility-result.ts:5`). A module-level export that stamps every
/// verdict and plan snapshot — not one of the tuning constants §7.2 collects in `EngineConstants`.
public let ENGINE_VERSION = "tripcheck-feasibility-v0.1"

/// TS `FeasibilityState` (`lib/feasibility-result.ts:56-61`)
public enum FeasibilityState: String, Codable, Sendable, CaseIterable {
  case VERIFIED_FEASIBLE, PROVISIONAL_FEASIBLE, FEASIBLE_IF_ASSUMPTIONS, INFEASIBLE_HARD_CONFLICT, UNKNOWN
}

/// TS `ConflictCode` (`lib/feasibility-result.ts:63-71`)
public enum ConflictCode: String, Codable, Sendable, CaseIterable {
  case AIRPORT_CUTOFF, DAY_END_OVERRUN, FIXED_BOOKING_LATE, OPENING_HOURS_CONFLICT
  case CLOSED_ON_FIXED_DAY, LAST_ENTRY_CONFLICT, PLACE_UNAVAILABLE, DAY_CAPACITY
}

extension ConflictCode {
  /// TS `severity` (`lib/feasibility-result.ts:737-746`) — the ordering weight `collectConflicts`
  /// sorts by, highest first.
  public var weight: Int {
    switch self {
    case .AIRPORT_CUTOFF: return 7
    case .FIXED_BOOKING_LATE: return 6
    case .CLOSED_ON_FIXED_DAY: return 5
    case .LAST_ENTRY_CONFLICT: return 5
    case .OPENING_HOURS_CONFLICT: return 4
    case .PLACE_UNAVAILABLE: return 3
    case .DAY_END_OVERRUN: return 2
    case .DAY_CAPACITY: return 1
    }
  }
}

/// TS `Conflict` (`lib/feasibility-result.ts:73-79`)
public struct Conflict: Equatable, Sendable, Codable {
  public var code: ConflictCode
  public var affectedItems: [String]
  public var dayIndex: Int?
  public var overrunMinutes: Int?
  public var evidenceIds: [String]

  public init(code: ConflictCode, affectedItems: [String], dayIndex: Int?, overrunMinutes: Int?, evidenceIds: [String]) {
    self.code = code
    self.affectedItems = affectedItems
    self.dayIndex = dayIndex
    self.overrunMinutes = overrunMinutes
    self.evidenceIds = evidenceIds
  }
}

/// TS `AttentionCode` (`lib/feasibility-result.ts:81`)
public enum AttentionCode: String, Codable, Sendable, CaseIterable {
  case LOW_BUFFER, UNVERIFIED_FACTS, WALKING_LIMIT_EXCEEDED, TRANSFER_LIMIT_EXCEEDED, TRANSIT_NON_CONVERGED
}

/// TS `Attention` (`lib/feasibility-result.ts:83-90`)
public struct Attention: Equatable, Sendable, Codable {
  public var code: AttentionCode
  public var dayIndex: Int?
  public var minutes: Int?
  public var affectedItems: [String]
  public var transferCount: Int?
  public var transferLimit: Int?

  public init(
    code: AttentionCode,
    dayIndex: Int?,
    minutes: Int?,
    affectedItems: [String],
    transferCount: Int? = nil,
    transferLimit: Int? = nil
  ) {
    self.code = code
    self.dayIndex = dayIndex
    self.minutes = minutes
    self.affectedItems = affectedItems
    self.transferCount = transferCount
    self.transferLimit = transferLimit
  }
}

/// TS `AssumptionCode` (`lib/feasibility-result.ts:92-106`)
public enum AssumptionCode: String, Codable, Sendable, CaseIterable {
  case DATE_PROVISIONAL, BASE_UNKNOWN, DAY_START_DEFAULT, DAY_END_DEFAULT, STAY_DURATION_ESTIMATED
  case ROUTE_ESTIMATED, OPENING_HOURS_UNKNOWN, LAST_ENTRY_ESTIMATED, AIRPORT_TRANSFER_ESTIMATED
  case TRANSFER_BUFFER, WALKING_LIMIT_DEFAULT, TRANSFER_LIMIT_DEFAULT, TRANSFER_COUNT_UNKNOWN, TRANSIT_NON_CONVERGED
}

/// TS `Assumption` (`lib/feasibility-result.ts:108-112`)
public struct Assumption: Equatable, Sendable, Codable {
  public var code: AssumptionCode
  public var count: Int
  public var evidenceIds: [String]

  public init(code: AssumptionCode, count: Int, evidenceIds: [String]) {
    self.code = code
    self.count = count
    self.evidenceIds = evidenceIds
  }
}

/// TS `AlternativePlan = TripCounterfactualAlternative` (`lib/feasibility-result.ts:114`)
public typealias AlternativePlan = TripCounterfactual

/// TS `FeasibilityUnknownCause` (`lib/feasibility-result.ts:116-121`).
///
/// Why a verdict is UNKNOWN. The computation cap (LIMIT) is a distinct user-facing cause with its
/// own action (shrink the candidate list); it must never be blended into a generic "something is
/// unresolved" sentence.
public enum FeasibilityUnknownCause: String, Codable, Sendable, CaseIterable {
  case UNRESOLVED_PLACE, COMPUTATION_LIMIT
}

/// TS `CriticalFactCounts` (`lib/feasibility-result.ts:123-129`)
public struct CriticalFactCounts: Equatable, Sendable, Codable {
  public var total: Int
  public var verified: Int
  public var estimated: Int
  public var unknown: Int
  public var userProvided: Int

  public init(total: Int, verified: Int, estimated: Int, unknown: Int, userProvided: Int) {
    self.total = total
    self.verified = verified
    self.estimated = estimated
    self.unknown = unknown
    self.userProvided = userProvided
  }
}

/// TS `FeasibilityResult` (`lib/feasibility-result.ts:131-151`)
public struct FeasibilityResult: Equatable, Sendable, Codable {
  public var state: FeasibilityState
  /// Set only when state is UNKNOWN: which blocker withheld the verdict.
  public var unknownCause: FeasibilityUnknownCause?
  public var minimumDays: Int?
  /// Qualified subset answer while unresolved/unavailable entries block the verdict.
  public var partialMinimumDays: Int?
  /// Wishlist entries that never resolved to a place; they gate the verdict.
  public var unresolvedPlaceNames: [String]
  public var searchedThroughDays: Int
  public var minimumDaysAssumptions: MinimumDaysAssumptions
  public var scheduledDays: [BuiltPlanDay]
  public var conflicts: [Conflict]
  public var primaryConflict: Conflict?
  public var primaryAttention: Attention?
  public var alternatives: [AlternativePlan]
  public var criticalFacts: CriticalFactCounts
  public var assumptions: [Assumption]
  public var engineVersion: String
  public var providerSnapshotHash: String

  public init(
    state: FeasibilityState,
    unknownCause: FeasibilityUnknownCause?,
    minimumDays: Int?,
    partialMinimumDays: Int?,
    unresolvedPlaceNames: [String],
    searchedThroughDays: Int,
    minimumDaysAssumptions: MinimumDaysAssumptions,
    scheduledDays: [BuiltPlanDay],
    conflicts: [Conflict],
    primaryConflict: Conflict?,
    primaryAttention: Attention?,
    alternatives: [AlternativePlan],
    criticalFacts: CriticalFactCounts,
    assumptions: [Assumption],
    engineVersion: String,
    providerSnapshotHash: String
  ) {
    self.state = state
    self.unknownCause = unknownCause
    self.minimumDays = minimumDays
    self.partialMinimumDays = partialMinimumDays
    self.unresolvedPlaceNames = unresolvedPlaceNames
    self.searchedThroughDays = searchedThroughDays
    self.minimumDaysAssumptions = minimumDaysAssumptions
    self.scheduledDays = scheduledDays
    self.conflicts = conflicts
    self.primaryConflict = primaryConflict
    self.primaryAttention = primaryAttention
    self.alternatives = alternatives
    self.criticalFacts = criticalFacts
    self.assumptions = assumptions
    self.engineVersion = engineVersion
    self.providerSnapshotHash = providerSnapshotHash
  }
}

/// TS `PlanSnapshot` (`lib/feasibility-result.ts:153-161`)
public struct PlanSnapshot: Equatable, Sendable, Codable {
  public var id: String
  public var plan: BuiltTripPlan
  public var engineVersion: String
  public var providerSnapshotHash: String
  public var createdAt: String
  public var seed: Int
  public var result: FeasibilityResult

  public init(
    id: String,
    plan: BuiltTripPlan,
    engineVersion: String,
    providerSnapshotHash: String,
    createdAt: String,
    seed: Int,
    result: FeasibilityResult
  ) {
    self.id = id
    self.plan = plan
    self.engineVersion = engineVersion
    self.providerSnapshotHash = providerSnapshotHash
    self.createdAt = createdAt
    self.seed = seed
    self.result = result
  }
}

/// TS `RouteFactEvidence["mode"]` (`lib/feasibility-result.ts:165`) — the single literal
/// `"transit"`. Route evidence only ever binds a transit departure; a walk or a drive has no
/// timetable to be bound to.
public enum RouteFactMode: String, Codable, Sendable, CaseIterable {
  case transit
}

/// TS `RouteFactEvidence["status"]` (`lib/feasibility-result.ts:168`) — a subset of
/// `EvidenceStatus`, mapped through `evidenceStatus` below.
public enum RouteFactStatus: String, Codable, Sendable, CaseIterable {
  case verified, failed, unknown

  var evidenceStatus: EvidenceStatus {
    switch self {
    case .verified: return .verified
    case .failed: return .failed
    case .unknown: return .unknown
    }
  }
}

/// TS `RouteFactEvidence["routeGeometry"]` (`lib/feasibility-result.ts:174-177`)
public struct RouteFactGeometry: Equatable, Sendable, Codable {
  public var points: [GeoPoint]
  public var distanceMeters: Double?

  public init(points: [GeoPoint], distanceMeters: Double? = nil) {
    self.points = points
    self.distanceMeters = distanceMeters
  }
}

/// TS `RouteFactEvidence` (`lib/feasibility-result.ts:163-178`) — the exact provider answer for one
/// leg at one departure bucket. Pair-only evidence (no request key, no bucket) can never verify a
/// leg, which is why the request provenance is part of the record.
public struct RouteFactEvidence: Equatable, Sendable, Codable {
  public var legId: String
  public var mode: RouteFactMode
  public var departureBucket: String
  public var requestKey: String
  public var status: RouteFactStatus
  public var fetchedAt: String?
  public var providerRef: String?
  public var minutes: Int?
  /// TS `transferCount?: number | null` — the two empty cases are indistinguishable at every read
  /// site (`:383` compares against a non-null count), so one level of optionality is faithful.
  public var transferCount: Int?
  public var reason: String?
  public var routeGeometry: RouteFactGeometry?

  public init(
    legId: String,
    mode: RouteFactMode = .transit,
    departureBucket: String,
    requestKey: String,
    status: RouteFactStatus,
    fetchedAt: String? = nil,
    providerRef: String? = nil,
    minutes: Int? = nil,
    transferCount: Int? = nil,
    reason: String? = nil,
    routeGeometry: RouteFactGeometry? = nil
  ) {
    self.legId = legId
    self.mode = mode
    self.departureBucket = departureBucket
    self.requestKey = requestKey
    self.status = status
    self.fetchedAt = fetchedAt
    self.providerRef = providerRef
    self.minutes = minutes
    self.transferCount = transferCount
    self.reason = reason
    self.routeGeometry = routeGeometry
  }
}

/// TS `EvidenceSnapshotOptions["transitConvergence"]` (`lib/feasibility-result.ts:192-197`)
public struct TransitConvergenceEvidence: Equatable, Sendable, Codable {
  public var nonConverged: Bool
  public var stopReason: String
  public var iterations: Int
  public var eventCount: Int

  public init(nonConverged: Bool, stopReason: String, iterations: Int, eventCount: Int) {
    self.nonConverged = nonConverged
    self.stopReason = stopReason
    self.iterations = iterations
    self.eventCount = eventCount
  }
}

/// TS `EvidenceSnapshotOptions["openingEvidenceByStop"]` value (`lib/feasibility-result.ts:198`)
public struct OpeningHoursFactEvidence: Equatable, Sendable, Codable {
  public var fetchedAt: String
  public var providerRef: String?
  /// The fetched hours are already bound to the specific date being planned.
  public var dateSpecific: Bool?
  /// The dates the fetch covered; a planned day listed here is date-qualified.
  public var dateSpecificDates: [String]?

  public init(fetchedAt: String, providerRef: String? = nil, dateSpecific: Bool? = nil, dateSpecificDates: [String]? = nil) {
    self.fetchedAt = fetchedAt
    self.providerRef = providerRef
    self.dateSpecific = dateSpecific
    self.dateSpecificDates = dateSpecificDates
  }
}

/// TS `EvidenceSnapshotOptions["lastEntryEvidenceByStop"]` value's `status`
/// (`lib/feasibility-result.ts:201`) — a subset of `EvidenceStatus`: an admission cutoff is never
/// "unknown" or "failed" here, because the record only exists when one was found.
public enum LastEntryEvidenceStatus: String, Codable, Sendable, CaseIterable {
  case user_provided, verified, estimated

  var evidenceStatus: EvidenceStatus {
    switch self {
    case .user_provided: return .user_provided
    case .verified: return .verified
    case .estimated: return .estimated
    }
  }
}

/// TS `EvidenceSnapshotOptions["lastEntryEvidenceByStop"]` value (`lib/feasibility-result.ts:199-204`)
public struct LastEntryFactEvidence: Equatable, Sendable, Codable {
  public var time: String
  public var status: LastEntryEvidenceStatus
  public var fetchedAt: String?
  public var providerRef: String?

  public init(time: String, status: LastEntryEvidenceStatus, fetchedAt: String? = nil, providerRef: String? = nil) {
    self.time = time
    self.status = status
    self.fetchedAt = fetchedAt
    self.providerRef = providerRef
  }
}

/// TS `EvidenceSnapshotOptions` (`lib/feasibility-result.ts:180-205`) — everything the snapshot
/// builder needs that the built plan itself cannot say: what the traveller supplied, and what a
/// provider actually answered.
public struct EvidenceSnapshotOptions: Equatable, Sendable, Codable {
  public var dateWasProvided: Bool
  public var baseWasProvided: Bool
  public var dayEndWasProvided: Bool
  /// TS `Iterable<string>` — read once into a set (`:261`), so an array is the faithful shape.
  public var userDurationStopIds: [String]?
  public var capturedAt: String?
  public var solverTimedOut: Bool?
  public var transferBufferMinutes: Int?
  public var dayStartTimes: IntKeyedDictionary<String>?
  public var dayEndTimes: IntKeyedDictionary<String>?
  /// Exact fact -> mode/time/request evidence. Pair-only evidence is unsafe.
  public var routeEvidenceByFactId: [String: RouteFactEvidence]?
  public var transitConvergence: TransitConvergenceEvidence?
  public var openingEvidenceByStop: [String: OpeningHoursFactEvidence]?
  public var lastEntryEvidenceByStop: [String: LastEntryFactEvidence]?

  public init(
    dateWasProvided: Bool,
    baseWasProvided: Bool,
    dayEndWasProvided: Bool,
    userDurationStopIds: [String]? = nil,
    capturedAt: String? = nil,
    solverTimedOut: Bool? = nil,
    transferBufferMinutes: Int? = nil,
    dayStartTimes: IntKeyedDictionary<String>? = nil,
    dayEndTimes: IntKeyedDictionary<String>? = nil,
    routeEvidenceByFactId: [String: RouteFactEvidence]? = nil,
    transitConvergence: TransitConvergenceEvidence? = nil,
    openingEvidenceByStop: [String: OpeningHoursFactEvidence]? = nil,
    lastEntryEvidenceByStop: [String: LastEntryFactEvidence]? = nil
  ) {
    self.dateWasProvided = dateWasProvided
    self.baseWasProvided = baseWasProvided
    self.dayEndWasProvided = dayEndWasProvided
    self.userDurationStopIds = userDurationStopIds
    self.capturedAt = capturedAt
    self.solverTimedOut = solverTimedOut
    self.transferBufferMinutes = transferBufferMinutes
    self.dayStartTimes = dayStartTimes
    self.dayEndTimes = dayEndTimes
    self.routeEvidenceByFactId = routeEvidenceByFactId
    self.transitConvergence = transitConvergence
    self.openingEvidenceByStop = openingEvidenceByStop
    self.lastEntryEvidenceByStop = lastEntryEvidenceByStop
  }
}

/// `lib/feasibility-result.ts` の関数群の置き場所。TS はモジュール直下の関数なので Swift でも
/// 名前空間 1 つに収める。
public enum Feasibility {}
