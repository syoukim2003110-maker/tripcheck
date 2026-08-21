import Foundation

/*
 * The trip builder's output types — one built plan (`BuiltTripPlan`), its days, stops, legs, and
 * the small recommendation/constraint records that hang off them.
 *
 * lib/trip-builder.ts:39-291 (types only; the builder function itself is out of this task's scope).
 */

/// TS `BuiltPlanStop["kind"]` (`lib/trip-builder.ts:43`) — no named TS type; an inline literal
/// union at the field site.
public enum BuiltPlanStopKind: String, Codable, Sendable, CaseIterable {
  case place, meal
}

/// TS `BuiltPlanStop["openingStatus"]` (`lib/trip-builder.ts:49`)
public enum OpeningStatus: String, Codable, Sendable, CaseIterable {
  case verified_open, unknown, conflict, closed_day, last_entry_conflict
}

/// TS `CrowdLevel` (`lib/trip-builder.ts:126`)
public enum CrowdLevel: String, Codable, Sendable, CaseIterable {
  case quiet, moderate, busy, veryBusy
}

/// TS `CrowdOutlook["confidence"]` (`lib/trip-builder.ts:130`) — the literal `"low" | "medium"`,
/// kept as its own type rather than reusing `Confidence` (`lib/route-optimizer.ts`'s
/// `low`/`medium`/`high`) since the two enums do not share a value space.
public enum CrowdConfidence: String, Codable, Sendable, CaseIterable {
  case low, medium
}

/// TS `BuiltPlanDay["deadlineKind"]` (`lib/trip-builder.ts:109`)
public enum DeadlineKind: String, Codable, Sendable, CaseIterable {
  case airport, curfew
}

/// TS `BuiltTripPlan["inputMode"]` (`lib/trip-builder.ts:267`)
public enum InputMode: String, Codable, Sendable, CaseIterable {
  case wishlist, existing_itinerary
}

/// TS `AirportConstraint["direction"]` (`lib/trip-builder.ts:254`) — no named TS type; an inline
/// literal union at the field site.
public enum AirportConstraintDirection: String, Codable, Sendable, CaseIterable {
  case arrival, departure
}

/// TS `CrowdOutlook` (`lib/trip-builder.ts:128-134`)
public struct CrowdOutlook: Equatable, Sendable, Codable {
  public var level: CrowdLevel
  public var confidence: CrowdConfidence
  public var isWeekend: Bool
  /// TS `weekendUplift: 0 | 1` — kept as `Int` rather than `Bool`; it is added directly into a
  /// crowd score elsewhere, not branched on.
  public var weekendUplift: Int
  public var peakTime: Bool

  public init(level: CrowdLevel, confidence: CrowdConfidence, isWeekend: Bool, weekendUplift: Int, peakTime: Bool) {
    self.level = level
    self.confidence = confidence
    self.isWeekend = isWeekend
    self.weekendUplift = weekendUplift
    self.peakTime = peakTime
  }
}

/// TS `BuiltPlanStop` (`lib/trip-builder.ts:39-51`)
public struct BuiltPlanStop: Equatable, Sendable, Codable {
  public var stop: RouteStop
  public var arrival: String
  public var departure: String
  public var kind: BuiltPlanStopKind
  public var mealKind: MealKind?
  public var priority: StopPriority
  public var fixedTime: String?
  public var isReservation: Bool
  public var reservationLateMinutes: Int
  public var openingStatus: OpeningStatus
  public var crowd: CrowdOutlook?

  public init(
    stop: RouteStop,
    arrival: String,
    departure: String,
    kind: BuiltPlanStopKind,
    mealKind: MealKind? = nil,
    priority: StopPriority,
    fixedTime: String? = nil,
    isReservation: Bool,
    reservationLateMinutes: Int,
    openingStatus: OpeningStatus,
    crowd: CrowdOutlook? = nil
  ) {
    self.stop = stop
    self.arrival = arrival
    self.departure = departure
    self.kind = kind
    self.mealKind = mealKind
    self.priority = priority
    self.fixedTime = fixedTime
    self.isReservation = isReservation
    self.reservationLateMinutes = reservationLateMinutes
    self.openingStatus = openingStatus
    self.crowd = crowd
  }
}

/// TS `BuiltPlanLeg` (`lib/trip-builder.ts:53-66`)
public struct BuiltPlanLeg: Equatable, Sendable, Codable {
  public var from: RouteStop
  public var to: RouteStop
  public var comparison: ModeComparison
  /// TS `Record<TransportMode, string>` — a plain `[String: String]` keyed by `TransportMode.rawValue`
  /// (a custom-enum-keyed `Dictionary` does not encode as a JSON object without extra machinery
  /// this task has no other use for).
  public var googleMapsUrls: [String: String]
  public var isLocalMealPause: Bool
  public var walkingMinutes: Int
  public var walkingLimitExceededMinutes: Int
  /// Exact selected-route evidence; `nil` never means zero transfers.
  public var transferCount: Int?
  /// Provider route ends at a disclosed access node, or could not be resolved.
  public var routeEvidenceScope: RouteEvidenceScope?
  public var accessAssumptions: [PoiAccessAssumption]?

  public init(
    from: RouteStop,
    to: RouteStop,
    comparison: ModeComparison,
    googleMapsUrls: [String: String],
    isLocalMealPause: Bool,
    walkingMinutes: Int,
    walkingLimitExceededMinutes: Int,
    transferCount: Int?,
    routeEvidenceScope: RouteEvidenceScope? = nil,
    accessAssumptions: [PoiAccessAssumption]? = nil
  ) {
    self.from = from
    self.to = to
    self.comparison = comparison
    self.googleMapsUrls = googleMapsUrls
    self.isLocalMealPause = isLocalMealPause
    self.walkingMinutes = walkingMinutes
    self.walkingLimitExceededMinutes = walkingLimitExceededMinutes
    self.transferCount = transferCount
    self.routeEvidenceScope = routeEvidenceScope
    self.accessAssumptions = accessAssumptions
  }
}

/// TS `MobilityPolicy` (`lib/trip-builder.ts:68-73`)
public struct MobilityPolicy: Equatable, Sendable, Codable {
  public var maxWalkingMinutesPerLeg: Int
  public var maxTransfersPerLeg: Int
  public var walkingLimitWasProvided: Bool
  public var transferLimitWasProvided: Bool

  public init(maxWalkingMinutesPerLeg: Int, maxTransfersPerLeg: Int, walkingLimitWasProvided: Bool, transferLimitWasProvided: Bool) {
    self.maxWalkingMinutesPerLeg = maxWalkingMinutesPerLeg
    self.maxTransfersPerLeg = maxTransfersPerLeg
    self.walkingLimitWasProvided = walkingLimitWasProvided
    self.transferLimitWasProvided = transferLimitWasProvided
  }
}

/// TS `TripBase = RouteStop & { query: string }` (`lib/trip-builder.ts:246`). Swift cannot express
/// a structural intersection type, so — same approach as `ResolvedStop` in `Geo/RouteStop.swift` —
/// `RouteStop`'s fields are duplicated here rather than inherited, with `routeStop` folding back
/// down and a `RouteStop`-based initializer building back up.
public struct TripBase: Equatable, Sendable, Codable {
  public var id: String
  public var providerRef: String?
  public var name: String
  public var area: String
  public var latitude: Double
  public var longitude: Double
  public var sourceUrl: String
  public var verifiedAt: String
  public var confidence: Confidence
  public var planningDurationMinutes: Int
  public var isAnchor: Bool
  public var placeTypes: [String]?
  public var openingHoursApplicable: Bool?
  public var isUserEntered: Bool?
  public var userProvidedCoordinates: Bool?
  public var query: String

  public init(
    id: String,
    providerRef: String? = nil,
    name: String,
    area: String,
    latitude: Double,
    longitude: Double,
    sourceUrl: String,
    verifiedAt: String,
    confidence: Confidence,
    planningDurationMinutes: Int,
    isAnchor: Bool,
    placeTypes: [String]? = nil,
    openingHoursApplicable: Bool? = nil,
    isUserEntered: Bool? = nil,
    userProvidedCoordinates: Bool? = nil,
    query: String
  ) {
    self.id = id
    self.providerRef = providerRef
    self.name = name
    self.area = area
    self.latitude = latitude
    self.longitude = longitude
    self.sourceUrl = sourceUrl
    self.verifiedAt = verifiedAt
    self.confidence = confidence
    self.planningDurationMinutes = planningDurationMinutes
    self.isAnchor = isAnchor
    self.placeTypes = placeTypes
    self.openingHoursApplicable = openingHoursApplicable
    self.isUserEntered = isUserEntered
    self.userProvidedCoordinates = userProvidedCoordinates
    self.query = query
  }

  public init(routeStop: RouteStop, query: String) {
    self.init(
      id: routeStop.id,
      providerRef: routeStop.providerRef,
      name: routeStop.name,
      area: routeStop.area,
      latitude: routeStop.latitude,
      longitude: routeStop.longitude,
      sourceUrl: routeStop.sourceUrl,
      verifiedAt: routeStop.verifiedAt,
      confidence: routeStop.confidence,
      planningDurationMinutes: routeStop.planningDurationMinutes,
      isAnchor: routeStop.isAnchor,
      placeTypes: routeStop.placeTypes,
      openingHoursApplicable: routeStop.openingHoursApplicable,
      isUserEntered: routeStop.isUserEntered,
      userProvidedCoordinates: routeStop.userProvidedCoordinates,
      query: query
    )
  }

  public var routeStop: RouteStop {
    RouteStop(
      id: id,
      providerRef: providerRef,
      name: name,
      area: area,
      latitude: latitude,
      longitude: longitude,
      sourceUrl: sourceUrl,
      verifiedAt: verifiedAt,
      confidence: confidence,
      planningDurationMinutes: planningDurationMinutes,
      isAnchor: isAnchor,
      placeTypes: placeTypes,
      openingHoursApplicable: openingHoursApplicable,
      isUserEntered: isUserEntered,
      userProvidedCoordinates: userProvidedCoordinates
    )
  }
}

/// TS `BuiltPlanDay` (`lib/trip-builder.ts:75-114`)
public struct BuiltPlanDay: Equatable, Sendable, Codable {
  public var label: String
  public var date: String?
  public var theme: String
  public var stops: [BuiltPlanStop]
  public var legs: [BuiltPlanLeg]
  public var totalMinutes: Int
  public var startTime: String
  public var requestedStartTime: String
  public var startAdjustedByArrival: Bool
  public var finishTime: String
  public var hotelTravelMinutes: Int?
  public var hotelOutboundMinutes: Int?
  public var hotelInboundMinutes: Int?
  public var hotelOutboundMode: TransportMode?
  public var hotelInboundMode: TransportMode?
  public var hotelOutboundSource: ModeSource?
  public var hotelInboundSource: ModeSource?
  public var hotelOutboundTransferCount: Int?
  public var hotelInboundTransferCount: Int?
  public var hotelOutboundRouteEvidenceScope: RouteEvidenceScope?
  public var hotelInboundRouteEvidenceScope: RouteEvidenceScope?
  public var hotelOutboundAccessAssumptions: [PoiAccessAssumption]?
  public var hotelInboundAccessAssumptions: [PoiAccessAssumption]?
  /// Where this day begins (previous night's hotel) and ends (tonight's hotel).
  public var startBase: TripBase?
  public var endBase: TripBase?
  public var deadline: String?
  /// True when the airport boundary lands on the previous calendar day. The deadline string keeps
  /// the boundary's clock face, so readers need this flag to know the day has no usable window at
  /// all.
  public var deadlinePreviousDay: Bool?
  public var deadlineKind: DeadlineKind?
  public var deadlineOverrunMinutes: Int
  public var reservationConflictCount: Int
  public var openingConflictCount: Int
  public var googleMapsUrl: String?

  public init(
    label: String,
    date: String? = nil,
    theme: String,
    stops: [BuiltPlanStop],
    legs: [BuiltPlanLeg],
    totalMinutes: Int,
    startTime: String,
    requestedStartTime: String,
    startAdjustedByArrival: Bool,
    finishTime: String,
    hotelTravelMinutes: Int? = nil,
    hotelOutboundMinutes: Int? = nil,
    hotelInboundMinutes: Int? = nil,
    hotelOutboundMode: TransportMode? = nil,
    hotelInboundMode: TransportMode? = nil,
    hotelOutboundSource: ModeSource? = nil,
    hotelInboundSource: ModeSource? = nil,
    hotelOutboundTransferCount: Int? = nil,
    hotelInboundTransferCount: Int? = nil,
    hotelOutboundRouteEvidenceScope: RouteEvidenceScope? = nil,
    hotelInboundRouteEvidenceScope: RouteEvidenceScope? = nil,
    hotelOutboundAccessAssumptions: [PoiAccessAssumption]? = nil,
    hotelInboundAccessAssumptions: [PoiAccessAssumption]? = nil,
    startBase: TripBase? = nil,
    endBase: TripBase? = nil,
    deadline: String? = nil,
    deadlinePreviousDay: Bool? = nil,
    deadlineKind: DeadlineKind? = nil,
    deadlineOverrunMinutes: Int,
    reservationConflictCount: Int,
    openingConflictCount: Int,
    googleMapsUrl: String? = nil
  ) {
    self.label = label
    self.date = date
    self.theme = theme
    self.stops = stops
    self.legs = legs
    self.totalMinutes = totalMinutes
    self.startTime = startTime
    self.requestedStartTime = requestedStartTime
    self.startAdjustedByArrival = startAdjustedByArrival
    self.finishTime = finishTime
    self.hotelTravelMinutes = hotelTravelMinutes
    self.hotelOutboundMinutes = hotelOutboundMinutes
    self.hotelInboundMinutes = hotelInboundMinutes
    self.hotelOutboundMode = hotelOutboundMode
    self.hotelInboundMode = hotelInboundMode
    self.hotelOutboundSource = hotelOutboundSource
    self.hotelInboundSource = hotelInboundSource
    self.hotelOutboundTransferCount = hotelOutboundTransferCount
    self.hotelInboundTransferCount = hotelInboundTransferCount
    self.hotelOutboundRouteEvidenceScope = hotelOutboundRouteEvidenceScope
    self.hotelInboundRouteEvidenceScope = hotelInboundRouteEvidenceScope
    self.hotelOutboundAccessAssumptions = hotelOutboundAccessAssumptions
    self.hotelInboundAccessAssumptions = hotelInboundAccessAssumptions
    self.startBase = startBase
    self.endBase = endBase
    self.deadline = deadline
    self.deadlinePreviousDay = deadlinePreviousDay
    self.deadlineKind = deadlineKind
    self.deadlineOverrunMinutes = deadlineOverrunMinutes
    self.reservationConflictCount = reservationConflictCount
    self.openingConflictCount = openingConflictCount
    self.googleMapsUrl = googleMapsUrl
  }
}

/// TS `BaseRecommendation` (`lib/trip-builder.ts:248-251`)
public struct BaseRecommendation: Equatable, Sendable, Codable {
  public var base: TripBase
  public var routeDistanceKm: Double

  public init(base: TripBase, routeDistanceKm: Double) {
    self.base = base
    self.routeDistanceKm = routeDistanceKm
  }
}

/// TS `AirportConstraint` (`lib/trip-builder.ts:253-264`)
public struct AirportConstraint: Equatable, Sendable, Codable {
  public var direction: AirportConstraintDirection
  public var airport: String
  public var flightTime: String
  public var cityTime: String
  /// TS `cityTimeDayOffset: -1 | 0 | 1`
  public var cityTimeDayOffset: Int
  public var airportMinutes: Int
  public var transferMinutes: Int
  public var transferCount: Int?
  public var sourceUrl: String
  public var googleMapsUrl: String?

  public init(
    direction: AirportConstraintDirection,
    airport: String,
    flightTime: String,
    cityTime: String,
    cityTimeDayOffset: Int,
    airportMinutes: Int,
    transferMinutes: Int,
    transferCount: Int?,
    sourceUrl: String,
    googleMapsUrl: String? = nil
  ) {
    self.direction = direction
    self.airport = airport
    self.flightTime = flightTime
    self.cityTime = cityTime
    self.cityTimeDayOffset = cityTimeDayOffset
    self.airportMinutes = airportMinutes
    self.transferMinutes = transferMinutes
    self.transferCount = transferCount
    self.sourceUrl = sourceUrl
    self.googleMapsUrl = googleMapsUrl
  }
}

/// TS `FoodRecommendationSlot` (`lib/trip-builder.ts:136-162`)
public struct FoodRecommendationSlot: Equatable, Sendable, Codable {
  public var id: String
  public var dayIndex: Int
  public var dayLabel: String
  public var date: String?
  public var kind: MealKind
  public var area: String
  public var anchorStopId: String
  public var latitude: Double
  public var longitude: Double
  public var window: String
  /// Schedule-aware local clock for this meal: the destination meal window pulled toward when the
  /// route actually passes the anchor. This is what the timeline displays and sorts by; `window`
  /// remains the static range chip.
  public var displayTime: String
  /// Local clock used when probing "open at the planned meal time".
  public var probeTime: String?
  /// Encoded provider polyline of the leg being travelled at mealtime. Set by the app (never the
  /// builder) so the meal search can run along the route.
  public var routePolyline: String?
  public var rationale: String
  public var queryIdeas: [String]

  public init(
    id: String,
    dayIndex: Int,
    dayLabel: String,
    date: String? = nil,
    kind: MealKind,
    area: String,
    anchorStopId: String,
    latitude: Double,
    longitude: Double,
    window: String,
    displayTime: String,
    probeTime: String? = nil,
    routePolyline: String? = nil,
    rationale: String,
    queryIdeas: [String]
  ) {
    self.id = id
    self.dayIndex = dayIndex
    self.dayLabel = dayLabel
    self.date = date
    self.kind = kind
    self.area = area
    self.anchorStopId = anchorStopId
    self.latitude = latitude
    self.longitude = longitude
    self.window = window
    self.displayTime = displayTime
    self.probeTime = probeTime
    self.routePolyline = routePolyline
    self.rationale = rationale
    self.queryIdeas = queryIdeas
  }
}

/// TS `BuiltTripPlan` (`lib/trip-builder.ts:266-291`)
public struct BuiltTripPlan: Equatable, Sendable, Codable {
  public var inputMode: InputMode
  /// Country this plan was built for, after auto-detection.
  public var destination: DestinationId
  public var requestedDays: Int
  public var recognizedStopCount: Int
  public var scheduledStopCount: Int
  public var mealBreakCount: Int
  public var unknownEntries: [String]
  public var deferredOptionalStops: [RouteStop]
  public var deferredUnavailableStops: [RouteStop]
  public var constraintCount: Int
  /// Highest explicit day pin among stops that are still part of this plan.
  public var minimumPinnedDay: Int
  public var overCapacityCount: Int
  public var scheduleConflictCount: Int
  public var selectedBase: TripBase?
  public var hotelQuery: String
  public var hotelResolved: Bool
  public var travelPreference: TravelPreference
  public var mobilityPolicy: MobilityPolicy
  public var baseRecommendations: [BaseRecommendation]
  public var airportConstraints: [AirportConstraint]
  public var foodRecommendationSlots: [FoodRecommendationSlot]
  public var days: [BuiltPlanDay]

  public init(
    inputMode: InputMode,
    destination: DestinationId,
    requestedDays: Int,
    recognizedStopCount: Int,
    scheduledStopCount: Int,
    mealBreakCount: Int,
    unknownEntries: [String],
    deferredOptionalStops: [RouteStop],
    deferredUnavailableStops: [RouteStop],
    constraintCount: Int,
    minimumPinnedDay: Int,
    overCapacityCount: Int,
    scheduleConflictCount: Int,
    selectedBase: TripBase? = nil,
    hotelQuery: String,
    hotelResolved: Bool,
    travelPreference: TravelPreference,
    mobilityPolicy: MobilityPolicy,
    baseRecommendations: [BaseRecommendation],
    airportConstraints: [AirportConstraint],
    foodRecommendationSlots: [FoodRecommendationSlot],
    days: [BuiltPlanDay]
  ) {
    self.inputMode = inputMode
    self.destination = destination
    self.requestedDays = requestedDays
    self.recognizedStopCount = recognizedStopCount
    self.scheduledStopCount = scheduledStopCount
    self.mealBreakCount = mealBreakCount
    self.unknownEntries = unknownEntries
    self.deferredOptionalStops = deferredOptionalStops
    self.deferredUnavailableStops = deferredUnavailableStops
    self.constraintCount = constraintCount
    self.minimumPinnedDay = minimumPinnedDay
    self.overCapacityCount = overCapacityCount
    self.scheduleConflictCount = scheduleConflictCount
    self.selectedBase = selectedBase
    self.hotelQuery = hotelQuery
    self.hotelResolved = hotelResolved
    self.travelPreference = travelPreference
    self.mobilityPolicy = mobilityPolicy
    self.baseRecommendations = baseRecommendations
    self.airportConstraints = airportConstraints
    self.foodRecommendationSlots = foodRecommendationSlots
    self.days = days
  }
}
