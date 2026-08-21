import Foundation

/*
 * Where the trip happens. Everything that used to be a hardcoded "Japan" —
 * the Google region bias, the disambiguating query suffix, the timezone used
 * for "today", the currency shown on a price band, the map's overview zoom,
 * the airport list, the mode the planner reaches for first, and the hours
 * people actually eat — lives here as one profile per destination.
 *
 * lib/destinations.ts:19-130 (types), :1473-1640 (functions).
 */

/// TS `DestinationId` union (`lib/destinations.ts:19-41`) — one profile per supported
/// country plus the `worldwide` fallback. `worldwide` is itself a case, not a special value.
public enum DestinationId: String, Codable, Sendable, Hashable, CaseIterable {
  case worldwide, japan, switzerland, korea, taiwan, hongkong, singapore, thailand, vietnam,
       indonesia, uae, france, italy, spain, portugal, uk, germany, austria, netherlands,
       iceland, norway, usa, canada, australia, newzealand
}

/// TS `DestinationChoice = DestinationId | "auto"` (`lib/destinations.ts:44`) — "auto" lets
/// the first resolved place decide; anything else pins the country.
public enum DestinationChoice: Hashable, Sendable {
  case auto
  case destination(DestinationId)

  /// TS `isDestinationChoice` — an unrecognised raw value yields `nil`, not a case.
  public init?(rawValue: String) {
    if rawValue == "auto" {
      self = .auto
    } else if let id = DestinationId(rawValue: rawValue) {
      self = .destination(id)
    } else {
      return nil
    }
  }

  public var rawValue: String {
    switch self {
    case .auto: return "auto"
    case .destination(let id): return id.rawValue
    }
  }
}

extension DestinationChoice: Codable {
  public init(from decoder: Decoder) throws {
    let raw = try decoder.singleValueContainer().decode(String.self)
    guard let value = DestinationChoice(rawValue: raw) else {
      throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "bad destination choice \(raw)"))
    }
    self = value
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.singleValueContainer()
    try container.encode(rawValue)
  }
}

/// TS `MobilityProfile` (`lib/destinations.ts:47-52`) — which mode the planner reaches for
/// when nothing else decides. `transit_first`: dense rail, waiting and parking make a car
/// slower. `car_first`: intercity distances where transit is a fallback, not a plan.
/// `balanced`: neither wins by default; the shortest sane option decides.
public enum MobilityProfile: String, Codable, Sendable, Hashable {
  case transit_first, balanced, car_first
}

/// TS `GeoBounds` (`lib/destinations.ts:54`)
public struct GeoBounds: Hashable, Sendable, Codable {
  public var south: Double
  public var west: Double
  public var north: Double
  public var east: Double

  public init(south: Double, west: Double, north: Double, east: Double) {
    self.south = south
    self.west = west
    self.north = north
    self.east = east
  }
}

/// TS `MealWindow` (`lib/destinations.ts:57`) — minutes from local midnight.
public struct MealWindow: Hashable, Sendable, Codable {
  public var start: Int
  public var end: Int

  public init(start: Int, end: Int) {
    self.start = start
    self.end = end
  }
}

/// TS `Destination.currency` (`lib/destinations.ts:87-91`)
public struct DestinationCurrency: Hashable, Sendable, Codable {
  public var code: String
  /// One glyph repeated for Google's four price levels; "•" when no single glyph fits.
  public var bandGlyph: String

  public init(code: String, bandGlyph: String) {
    self.code = code
    self.bandGlyph = bandGlyph
  }
}

/// TS `Destination.meals` (`lib/destinations.ts:99`)
public struct DestinationMeals: Hashable, Sendable, Codable {
  public var lunch: MealWindow
  public var dinner: MealWindow

  public init(lunch: MealWindow, dinner: MealWindow) {
    self.lunch = lunch
    self.dinner = dinner
  }
}

/// TS `Destination.hotelFacts: "rakuten" | null` (`lib/destinations.ts:97`) — extra listing
/// evidence that only exists in this country.
public enum DestinationHotelFacts: String, Hashable, Sendable, Codable {
  case rakuten
}

/// TS `DestinationAirport` (`lib/destinations.ts:62-70`) — a main international gateway.
/// Transfer and check-in minutes are planning estimates, labelled as such in the UI and
/// carrying a source link so a traveller can verify the real number.
public struct DestinationAirport: Hashable, Sendable, Codable {
  public var code: String
  public var names: [PlannerLocale: String]
  public var latitude: Double
  public var longitude: Double
  /// Airport ⇄ main city centre door to door on the usual public route. Estimate.
  public var transferMinutes: Int
  /// Time to be at the airport before an international departure. Estimate.
  public var internationalDepartureMinutes: Int
  public var sourceUrl: String

  public init(
    code: String,
    names: [PlannerLocale: String],
    latitude: Double,
    longitude: Double,
    transferMinutes: Int,
    internationalDepartureMinutes: Int,
    sourceUrl: String
  ) {
    self.code = code
    self.names = names
    self.latitude = latitude
    self.longitude = longitude
    self.transferMinutes = transferMinutes
    self.internationalDepartureMinutes = internationalDepartureMinutes
    self.sourceUrl = sourceUrl
  }
}

/// TS `Destination.sampleStops` element (`lib/destinations.ts:121-129`) — deterministic
/// coordinates for the starter wishlist so the "see a finished example" promise holds with
/// zero provider keys.
public struct DestinationSampleStop: Hashable, Sendable, Codable {
  public var names: [PlannerLocale: String]
  public var area: [PlannerLocale: String]
  public var latitude: Double
  public var longitude: Double
  public var stayMinutes: Int
  /// TS `openingHoursApplicable?: boolean` — omitted means true (a normal business with
  /// hours); explicit `false` marks a public area/landmark with no opening-hours question.
  public var openingHoursApplicable: Bool

  public init(
    names: [PlannerLocale: String],
    area: [PlannerLocale: String],
    latitude: Double,
    longitude: Double,
    stayMinutes: Int,
    openingHoursApplicable: Bool = true
  ) {
    self.names = names
    self.area = area
    self.latitude = latitude
    self.longitude = longitude
    self.stayMinutes = stayMinutes
    self.openingHoursApplicable = openingHoursApplicable
  }
}

/// TS `Destination` (`lib/destinations.ts:76-130`) — a country, because that is the
/// granularity every provider this product calls already speaks (ISO 3166-1 alpha-2).
/// "worldwide" is the honest fallback: no bias, no coordinate box, no invented local
/// knowledge.
public struct Destination: Hashable, Sendable, Codable {
  public var id: DestinationId
  public var names: [PlannerLocale: String]
  /// ISO 3166-1 alpha-2 codes this profile covers. Empty for worldwide.
  public var countryCodes: [String]
  /// Region bias handed to Google Places, Routes and Maps.
  public var regionCode: String?
  /// Appended to a bare place name so "Old Town" lands in the right country.
  public var querySuffix: String?
  /// IANA zone used for "today" and for reading a local calendar day.
  public var timeZone: String
  public var currency: DestinationCurrency
  public var center: GeoPoint
  public var overviewZoom: Double
  /// Generous sanity box. A resolution outside it is a wrong-country match.
  public var bounds: GeoBounds?
  public var mobility: MobilityProfile
  public var meals: DestinationMeals
  /// Extra listing evidence that only exists in this country.
  public var hotelFacts: DestinationHotelFacts?
  /// TS `sundayClosing?: boolean` (`lib/destinations.ts:102-106`) — non-optional here;
  /// omitted in the TS literal means false. True where a shop-closing law shutters most
  /// retail on Sundays (DACH countries).
  public var sundayClosing: Bool
  public var airports: [DestinationAirport]
  /// Cuisine words for a meal slot when no area profile matches.
  public var cuisine: [PlannerLocale: [String]]
  /// Structural local realities that change a plan — closing days, meal hours,
  /// timetable-bound transport.
  public var notes: [PlannerLocale: [String]]
  /// Starter wishlist offered by the example button.
  public var sample: [PlannerLocale: String]?
  /// Deterministic coordinates for the starter wishlist, in the same order as its lines.
  public var sampleStops: [DestinationSampleStop]?

  public init(
    id: DestinationId,
    names: [PlannerLocale: String],
    countryCodes: [String],
    regionCode: String?,
    querySuffix: String?,
    timeZone: String,
    currency: DestinationCurrency,
    center: GeoPoint,
    overviewZoom: Double,
    bounds: GeoBounds?,
    mobility: MobilityProfile,
    meals: DestinationMeals,
    hotelFacts: DestinationHotelFacts? = nil,
    sundayClosing: Bool = false,
    airports: [DestinationAirport],
    cuisine: [PlannerLocale: [String]],
    notes: [PlannerLocale: [String]],
    sample: [PlannerLocale: String]? = nil,
    sampleStops: [DestinationSampleStop]? = nil
  ) {
    self.id = id
    self.names = names
    self.countryCodes = countryCodes
    self.regionCode = regionCode
    self.querySuffix = querySuffix
    self.timeZone = timeZone
    self.currency = currency
    self.center = center
    self.overviewZoom = overviewZoom
    self.bounds = bounds
    self.mobility = mobility
    self.meals = meals
    self.hotelFacts = hotelFacts
    self.sundayClosing = sundayClosing
    self.airports = airports
    self.cuisine = cuisine
    self.notes = notes
    self.sample = sample
    self.sampleStops = sampleStops
  }
}

/// TS module-level lookups over `destinationList` (`lib/destinations.ts:1473-1640`).
/// `Destinations.all` and `Destinations.worldwide` live in DestinationData.swift;
/// essentials/entry-authority/passport-rule accessors live in DestinationEssentials.swift;
/// timezone functions live in DestinationTime.swift.
public enum Destinations {}

extension Destinations {
  /// TS `destinationById` — never throws: an unknown or absent id means "no local
  /// knowledge yet", so it degrades to `worldwide`. `DestinationId` is a closed set, so the
  /// only way to reach an "unknown" id from Swift is via `nil` (missing) or a raw value that
  /// fails to parse into `DestinationId` before calling this.
  public static func byId(_ id: DestinationId?) -> Destination {
    guard let id, let match = all.first(where: { $0.id == id }) else { return worldwide }
    return match
  }

  /// ISO 3166-1 alpha-2, as returned in a Google address component. TS `destinationForCountryCode`.
  public static func forCountryCode(_ code: String) -> Destination? {
    let normalized = code.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
    return all.first { $0.countryCodes.contains(normalized) }
  }

  public static func withinBounds(_ bounds: GeoBounds?, latitude: Double, longitude: Double) -> Bool {
    guard let bounds else { return true }
    return latitude >= bounds.south && latitude <= bounds.north
      && longitude >= bounds.west && longitude <= bounds.east
  }

  private static func boundsArea(_ bounds: GeoBounds) -> Double {
    (bounds.north - bounds.south) * (bounds.east - bounds.west)
  }

  /// Last-resort inference when a resolution carried no country component (TS
  /// `destinationForCoordinate`, `lib/destinations.ts:1517`). Country boxes overlap heavily
  /// in Europe, so the tightest box that contains the point wins. This is a fallback —
  /// Google's own country component is the primary answer and always outranks it.
  public static func forCoordinate(_ latitude: Double, _ longitude: Double) -> Destination? {
    guard latitude.isFinite, longitude.isFinite else { return nil }
    var best: (destination: Destination, area: Double)?
    for destination in all {
      guard let bounds = destination.bounds, withinBounds(bounds, latitude: latitude, longitude: longitude) else { continue }
      let area = boundsArea(bounds)
      if best == nil || area < best!.area { best = (destination, area) }
    }
    return best?.destination
  }

  /// The disambiguating text query Google receives for a bare place name (TS
  /// `destinationPlaceQuery`, `lib/destinations.ts:1529`). A Japanese query with an English
  /// country word degrades Google's ranking ("ベルン旧市街 Switzerland" returns the
  /// university, not the Old Town), so the disambiguating suffix follows the query's language.
  public static func placeQuery(_ input: String, destination: Destination, languageCode: PlannerLocale = .en) -> String {
    guard let querySuffix = destination.querySuffix else { return input }
    let suffix = languageCode == .ja ? destination.names[.ja] : querySuffix
    guard let suffix, !suffix.isEmpty else { return input }
    return "\(input) \(suffix)"
  }

  /// Google's four relative price levels rendered in the local currency glyph.
  public static func priceBandSymbols(_ destination: Destination) -> [String] {
    let glyph = destination.currency.bandGlyph.first.map(String.init) ?? "•"
    return [glyph, String(repeating: glyph, count: 2), String(repeating: glyph, count: 3), String(repeating: glyph, count: 4)]
  }

  /// TS `destinationAirport` — `nil` or the sentinel "none" both mean "no airport chosen".
  public static func airport(_ destination: Destination, code: String?) -> DestinationAirport? {
    guard let code, code != "none" else { return nil }
    return destination.airports.first { $0.code == code }
  }

  /// Only airports that serve the same metropolitan base as `anchorCode` (TS
  /// `destinationAirportComparisonGroup`). With no anchor, the destination's first supported
  /// comparison group is used. An unpaired selected airport deliberately returns no
  /// alternatives rather than suggesting an airport in a different city.
  public static func airportComparisonGroup(_ destination: Destination, code anchorCode: String?) -> [DestinationAirport] {
    let trimmed = anchorCode?.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
    let normalized = (trimmed?.isEmpty == false) ? trimmed : nil
    let normalizedAnchor = normalized == "NONE" ? nil : normalized

    let group: [String]?
    if let normalizedAnchor {
      group = airportMetroGroups.first { $0.contains(normalizedAnchor) }
    } else {
      group = airportMetroGroups.first { $0.allSatisfy { airport(destination, code: $0) != nil } }
    }
    guard let group else { return [] }
    if let normalizedAnchor, airport(destination, code: normalizedAnchor) == nil { return [] }
    let airports = group.compactMap { airport(destination, code: $0) }
    return airports.count >= 2 ? airports : []
  }

  public static func name(_ destination: Destination, locale: PlannerLocale) -> String {
    destination.names[locale] ?? destination.names[.en] ?? ""
  }

  /// Options for the destination picker: auto first, then curated countries A→Z in the
  /// picker's own locale, worldwide last (TS `destinationOptions`).
  public static func options(locale: PlannerLocale) -> [(choice: DestinationChoice, label: String)] {
    let collationLocale = Locale(identifier: locale == .ja ? "ja" : "en")
    let named = all
      .filter { $0.id != .worldwide }
      .map { (choice: DestinationChoice.destination($0.id), label: name($0, locale: locale)) }
      .sorted { $0.label.compare($1.label, options: [], range: nil, locale: collationLocale) == .orderedAscending }
    return [(choice: DestinationChoice.auto, label: locale == .ja ? "自動判定" : "Detect automatically")]
      + named
      + [(choice: DestinationChoice.destination(.worldwide), label: name(worldwide, locale: locale))]
  }
}
