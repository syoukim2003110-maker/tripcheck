import Foundation

/// TS `WishlistStopConstraint` (`lib/trip-builder.ts:164-172`) — the per-stop constraint derived
/// from a parsed wishlist line (or an existing-itinerary entry) before scheduling.
public struct WishlistStopConstraint: Equatable, Sendable, Codable {
  public var priority: StopPriority
  public var fixedDay: Int?
  public var fixedTime: String?
  public var fixedTimeMinutes: Int?
  public var timeOfDay: WishlistTimeOfDay?
  public var isReservation: Bool
  public var stayMinutes: Int?

  public init(
    priority: StopPriority,
    fixedDay: Int? = nil,
    fixedTime: String? = nil,
    fixedTimeMinutes: Int? = nil,
    timeOfDay: WishlistTimeOfDay? = nil,
    isReservation: Bool,
    stayMinutes: Int? = nil
  ) {
    self.priority = priority
    self.fixedDay = fixedDay
    self.fixedTime = fixedTime
    self.fixedTimeMinutes = fixedTimeMinutes
    self.timeOfDay = timeOfDay
    self.isReservation = isReservation
    self.stayMinutes = stayMinutes
  }

  /// TS `defaultConstraint` (`lib/trip-builder.ts:986-994`) — 何も書かれなかった停留所が背負う
  /// 制約。TS の `constraints.get(id) ?? defaultConstraint` の右辺そのもの。
  public static let `default` = WishlistStopConstraint(priority: .normal, isReservation: false)
}

/// TS `TripPlannerContext` (`lib/trip-builder.ts:176-244`) — every field optional, exactly as the
/// TS type declares (a fresh trip has none of them set yet). `Codable`/`Equatable` are the
/// compiler-synthesized conformances: every stored property already conforms on its own, so no
/// `init(from:)`/`encode(to:)` is hand-written here. The one wrinkle is TS's `Record<number, X>`
/// fields (`dayStartTimes`, `dayEndTimes`, `lockedOrderByDay`, `nightBases`, and the inner
/// dictionary of `openingWindowsByDay`) — those serialize as JSON objects with string keys, so they
/// are typed as `IntKeyedDictionary<X>` rather than `[Int: X]` (see `Core/IntKeyed.swift`).
public struct PlannerContext: Equatable, Sendable, Codable {
  /// Country the trip happens in; supplies airports, meal hours and cuisine words.
  public var destination: DestinationChoice?
  public var tripStartDate: String?
  public var hotelQuery: String?
  public var arrivalAirport: String?
  public var arrivalTime: String?
  public var departureAirport: String?
  public var departureTime: String?
  public var flightKind: FlightKind?
  public var dayStartTimes: IntKeyedDictionary<String>?
  /// Per-day sightseeing cutoff. A day-specific value wins over `dayEndTarget`.
  public var dayEndTimes: IntKeyedDictionary<String>?
  public var durationOverrides: [String: Int]?
  public var earlyVisitStopIds: [String]?
  public var liveTransitMinutes: [String: Int]?
  /// Legs (routeLegKey) where the provider explicitly answered that no transit route exists for
  /// the requested departure. Negative live evidence: it lets the recommendation fall back to a
  /// measured drive instead of pinning an invented train forever.
  public var liveTransitAbsentLegs: [String: Bool]?
  /// Google transit ride changes keyed by routeLegKey. Callers must derive this from the bounded
  /// convergence result, not a pair-only first-write cache; exact request provenance is retained
  /// separately in the evidence snapshot.
  public var liveTransitTransferCounts: [String: Int]?
  public var liveWalkingMinutes: [String: Int]?
  public var liveDrivingMinutes: [String: Int]?
  /// "car" plans every leg around a rental car; "auto" recommends the fastest sane mode.
  public var travelPreference: TravelPreference?
  /// The user's per-leg picks ("this hop by taxi"), keyed by routeLegKey.
  public var legModeOverrides: [String: TransportMode]?
  /// The user's per-stop day picks (1-based), keyed by stop id.
  public var dayOverrides: [String: Int]?
  /// Explicit visit order for an existing itinerary, keyed by zero-based day. Wishlist mode leaves
  /// this empty so the deterministic optimiser is free to improve the route. Existing-itinerary
  /// mode treats the listed relative order as a hard user constraint.
  public var lockedOrderByDay: IntKeyedDictionary<[String]>?
  /// Counterfactual-only switch: keep Day assignments but release pasted line order.
  public var optimizeExistingOrder: Bool?
  /// Default day start clock used when a day has no explicit start time.
  public var defaultDayStart: String?
  /// Soft end-of-day target ("21:30"); overruns are flagged, never hidden.
  public var dayEndTarget: String?
  /// Explicit connection/wayfinding margin added after every travelled leg. TS narrows this to
  /// `0 | 10 | 20 | 30`; kept as a plain `Int` here (the golden fixtures never carry an
  /// out-of-range value, and validation belongs to the caller that sets it, not this passive DTO).
  public var transferBufferMinutes: Int?
  /// Stops the user removed from the plan ("not realistic after all").
  public var excludedStopIds: [String]?
  /// Soft mobility preferences. Exceeding them is explained, never hidden.
  public var maxWalkingMinutesPerLeg: Int?
  public var maxTransfersPerLeg: Int?
  public var openingWindowsByDay: [String: IntKeyedDictionary<[VisitWindow]>]?
  /// Product-owned/user-confirmed admission cutoffs, keyed by stop id.
  public var lastEntryTimes: [String: String]?
  public var mealPlan: MealPlan?
  public var resolvedStops: [ResolvedStop]?
  /// TS `resolvedBase?: ResolvedInputStop | null` — TS itself collapses "missing" and "explicit
  /// null" with `?? null` at every read site, so a single-level `ResolvedStop?` (where Decodable's
  /// default `decodeIfPresent` already treats a missing key and a JSON `null` the same way) is a
  /// faithful port; no `ResolvedStop??` needed.
  public var resolvedBase: ResolvedStop?
  /// Optional hotel per night (night N = where you sleep after day N). Missing nights fall back to
  /// the trip-wide base. `null` values inside the object (a night explicitly reset to "no base") are
  /// legal, hence `ResolvedStop?` as the dictionary's value type.
  public var nightBases: IntKeyedDictionary<ResolvedStop?>?

  public init(
    destination: DestinationChoice? = nil,
    tripStartDate: String? = nil,
    hotelQuery: String? = nil,
    arrivalAirport: String? = nil,
    arrivalTime: String? = nil,
    departureAirport: String? = nil,
    departureTime: String? = nil,
    flightKind: FlightKind? = nil,
    dayStartTimes: IntKeyedDictionary<String>? = nil,
    dayEndTimes: IntKeyedDictionary<String>? = nil,
    durationOverrides: [String: Int]? = nil,
    earlyVisitStopIds: [String]? = nil,
    liveTransitMinutes: [String: Int]? = nil,
    liveTransitAbsentLegs: [String: Bool]? = nil,
    liveTransitTransferCounts: [String: Int]? = nil,
    liveWalkingMinutes: [String: Int]? = nil,
    liveDrivingMinutes: [String: Int]? = nil,
    travelPreference: TravelPreference? = nil,
    legModeOverrides: [String: TransportMode]? = nil,
    dayOverrides: [String: Int]? = nil,
    lockedOrderByDay: IntKeyedDictionary<[String]>? = nil,
    optimizeExistingOrder: Bool? = nil,
    defaultDayStart: String? = nil,
    dayEndTarget: String? = nil,
    transferBufferMinutes: Int? = nil,
    excludedStopIds: [String]? = nil,
    maxWalkingMinutesPerLeg: Int? = nil,
    maxTransfersPerLeg: Int? = nil,
    openingWindowsByDay: [String: IntKeyedDictionary<[VisitWindow]>]? = nil,
    lastEntryTimes: [String: String]? = nil,
    mealPlan: MealPlan? = nil,
    resolvedStops: [ResolvedStop]? = nil,
    resolvedBase: ResolvedStop? = nil,
    nightBases: IntKeyedDictionary<ResolvedStop?>? = nil
  ) {
    self.destination = destination
    self.tripStartDate = tripStartDate
    self.hotelQuery = hotelQuery
    self.arrivalAirport = arrivalAirport
    self.arrivalTime = arrivalTime
    self.departureAirport = departureAirport
    self.departureTime = departureTime
    self.flightKind = flightKind
    self.dayStartTimes = dayStartTimes
    self.dayEndTimes = dayEndTimes
    self.durationOverrides = durationOverrides
    self.earlyVisitStopIds = earlyVisitStopIds
    self.liveTransitMinutes = liveTransitMinutes
    self.liveTransitAbsentLegs = liveTransitAbsentLegs
    self.liveTransitTransferCounts = liveTransitTransferCounts
    self.liveWalkingMinutes = liveWalkingMinutes
    self.liveDrivingMinutes = liveDrivingMinutes
    self.travelPreference = travelPreference
    self.legModeOverrides = legModeOverrides
    self.dayOverrides = dayOverrides
    self.lockedOrderByDay = lockedOrderByDay
    self.optimizeExistingOrder = optimizeExistingOrder
    self.defaultDayStart = defaultDayStart
    self.dayEndTarget = dayEndTarget
    self.transferBufferMinutes = transferBufferMinutes
    self.excludedStopIds = excludedStopIds
    self.maxWalkingMinutesPerLeg = maxWalkingMinutesPerLeg
    self.maxTransfersPerLeg = maxTransfersPerLeg
    self.openingWindowsByDay = openingWindowsByDay
    self.lastEntryTimes = lastEntryTimes
    self.mealPlan = mealPlan
    self.resolvedStops = resolvedStops
    self.resolvedBase = resolvedBase
    self.nightBases = nightBases
  }
}
