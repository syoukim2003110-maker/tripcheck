import Foundation

/// lib/route-optimizer.ts:12 — `confidence: "low" | "medium"`
public enum Confidence: String, Codable, Sendable {
  case low, medium
}

/// Swift 専用の由来タグ(TS には存在しない、spec §4.3 のため追加)。
/// `catalog` = `Catalog.resolveKnownStops`/`SwissSample` で解決、`user` = 利用者の手入力、
/// `apple` = MapKit ローカル検索、`google` = Google Places API。
public enum ResolvedStopProvider: String, Codable, Sendable {
  case catalog, user, apple, google
}

/// lib/route-optimizer.ts:3-22 — `RouteStop`
public struct RouteStop: Hashable, Codable, Sendable {
  public var id: String
  /// Provider identity kept separately from TripCheck's stable local id.
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
  /// Google place types, when available, also tell the hours UI what is not a business.
  public var placeTypes: [String]?
  /// Deterministic catalog/demo override for public areas that have no business schedule.
  public var openingHoursApplicable: Bool?
  public var isUserEntered: Bool?
  /// Coordinates explicitly confirmed by the traveller, not provider-verified.
  public var userProvidedCoordinates: Bool?

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
    userProvidedCoordinates: Bool? = nil
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
  }
}

/// lib/route-optimizer.ts:24-32 — `ResolvedInputStop`。`RouteStop` を継承できないのでフィールドを
/// 複製する。`routeStop` で Builder 向けに `RouteStop` へ畳める。
public struct ResolvedStop: Hashable, Codable, Sendable {
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
  public var input: String
  /// Stable within the currently reviewed paste; lets duplicate names be corrected independently.
  public var inputIndex: Int?
  public var address: String
  /// ISO 3166-1 alpha-2 from Google's address components; drives destination auto-detection.
  public var countryCode: String?
  public var provider: ResolvedStopProvider?

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
    input: String,
    inputIndex: Int? = nil,
    address: String,
    countryCode: String? = nil,
    provider: ResolvedStopProvider? = nil
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
    self.input = input
    self.inputIndex = inputIndex
    self.address = address
    self.countryCode = countryCode
    self.provider = provider
  }

  /// Builder はこれで `RouteStop` に畳む。
  public init(
    routeStop: RouteStop,
    input: String,
    inputIndex: Int? = nil,
    address: String,
    countryCode: String? = nil,
    provider: ResolvedStopProvider? = nil
  ) {
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
      input: input,
      inputIndex: inputIndex,
      address: address,
      countryCode: countryCode,
      provider: provider
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
