import Foundation

/*
 * 地域ごとの対応の深さは、事実ごとの証拠とは **わざと** 別物にしてある。
 *
 * 等級は「TripCheck がその地域のその提供元/領域をどこまで検証したか」を言う。いま作っている旅の
 * ある経路・ある施設・ある営業時間を取得したとは **言わない**。それらの主張は引き続き
 * `Evidence<T>` と重要事実の集計の持ち物。
 *
 * 移植元:`lib/coverage-profile.ts:1-269`。
 */

/// TS `CoverageGrade`(`lib/coverage-profile.ts:11`)。
public enum CoverageGrade: String, Codable, Sendable, CaseIterable {
  case A, B, C, unknown
}

/// TS `CoverageDimension`(`:13`)。
public enum CoverageDimension: String, Codable, Sendable, CaseIterable {
  case routes, poi, hours, transit
}

/// TS `CoverageProfileId`(`:15-21`)。
public enum CoverageProfileId: String, Codable, Sendable, CaseIterable {
  case tokyo, japan_other, switzerland, europe, usa, unsupported
}

/// TS `CoverageGrades`(`:23`)。
public struct CoverageGrades: Equatable, Sendable, Codable {
  public var routes: CoverageGrade
  public var poi: CoverageGrade
  public var hours: CoverageGrade
  public var transit: CoverageGrade

  public init(routes: CoverageGrade, poi: CoverageGrade, hours: CoverageGrade, transit: CoverageGrade) {
    self.routes = routes
    self.poi = poi
    self.hours = hours
    self.transit = transit
  }

  public subscript(dimension: CoverageDimension) -> CoverageGrade {
    switch dimension {
    case .routes: return routes
    case .poi: return poi
    case .hours: return hours
    case .transit: return transit
    }
  }
}

/// TS `RegionalCoverageProfile`(`:25-34`)。TS の `kind: "regional_capability"` は、この
/// オブジェクトが事実の集計と取り違えられないための札。Swift では型が別なので値は持たないが、
/// 名前は残す。
public struct RegionalCoverageProfile: Equatable, Sendable {
  public var id: CoverageProfileId
  public var label: [PlannerLocale: String]
  public var grades: CoverageGrades
  /// この地域の評価を最後に見直した日。提供元からの取得日ではない。
  public var lastValidatedAt: String?
  public var publicCopy: [PlannerLocale: String]

  public init(
    id: CoverageProfileId,
    label: [PlannerLocale: String],
    grades: CoverageGrades,
    lastValidatedAt: String?,
    publicCopy: [PlannerLocale: String]
  ) {
    self.id = id
    self.label = label
    self.grades = grades
    self.lastValidatedAt = lastValidatedAt
    self.publicCopy = publicCopy
  }
}

/// TS `CoverageLookup`(`:36-43`)。
public struct CoverageLookup: Equatable, Sendable {
  /// TS は `DestinationId | "auto" | string | null` —— 生の文字列。
  public var destination: String?
  public var countryCode: String?
  public var latitude: Double?
  public var longitude: Double?
  /// 製品側が持つ地域ラベル(例:選択された東京のエリア)。
  public var regionHint: String?

  public init(
    destination: String? = nil,
    countryCode: String? = nil,
    latitude: Double? = nil,
    longitude: Double? = nil,
    regionHint: String? = nil
  ) {
    self.destination = destination
    self.countryCode = countryCode
    self.latitude = latitude
    self.longitude = longitude
    self.regionHint = regionHint
  }
}

public enum CoverageProfile {

  /// TS `VALIDATED_AT`(`:45`)。
  public static let validatedAt = "2026-08-09"

  static let tokyo = RegionalCoverageProfile(
    id: .tokyo,
    label: [.en: "Tokyo", .ja: "東京"],
    grades: CoverageGrades(routes: .A, poi: .A, hours: .B, transit: .A),
    lastValidatedAt: validatedAt,
    publicCopy: [
      .en: "TripCheck's best-covered beta region. Routes, places, and transit have the deepest validation; date-specific opening hours still need confirmation.",
      .ja: "TripCheckで最も検証が進んだベータ地域です。経路・地点・公共交通は重点検証済みですが、日付ごとの営業時間は引き続き確認が必要です。",
    ]
  )

  static let japanOther = RegionalCoverageProfile(
    id: .japan_other,
    label: [.en: "Japan outside Tokyo", .ja: "東京以外の日本"],
    grades: CoverageGrades(routes: .A, poi: .A, hours: .B, transit: .B),
    lastValidatedAt: validatedAt,
    publicCopy: [
      .en: "Japan-wide planning is available, but validation outside Tokyo is less deep. Confirm local transit details and date-specific opening hours before relying on the plan.",
      .ja: "日本全国で計画できますが、東京以外は検証の深さが異なります。現地の公共交通と日付ごとの営業時間を確認してから旅程を確定してください。",
    ]
  )

  static let switzerland = RegionalCoverageProfile(
    id: .switzerland,
    label: [.en: "Switzerland", .ja: "スイス"],
    grades: CoverageGrades(routes: .A, poi: .A, hours: .B, transit: .A),
    lastValidatedAt: validatedAt,
    publicCopy: [
      .en: "Routes, places, and timetable-based transit are well covered in beta. Confirm date-specific opening hours and attraction reservation rules separately.",
      .ja: "経路・地点・時刻表ベースの公共交通はベータで重点検証しています。日付ごとの営業時間と施設固有の予約条件は別途確認してください。",
    ]
  )

  static let europe = RegionalCoverageProfile(
    id: .europe,
    label: [.en: "Europe (limited beta)", .ja: "ヨーロッパ（限定ベータ）"],
    grades: CoverageGrades(routes: .B, poi: .B, hours: .C, transit: .C),
    lastValidatedAt: validatedAt,
    publicCopy: [
      .en: "Limited beta coverage. The plan can use provider data and estimates, but local opening-hour and transit validation is not yet as deep as Tokyo or Switzerland.",
      .ja: "限定ベータの対応範囲です。提供元データと推定で計画できますが、営業時間と公共交通の地域検証は東京・スイスほど深くありません。",
    ]
  )

  static let usa = RegionalCoverageProfile(
    id: .usa,
    label: [.en: "United States (limited beta)", .ja: "米国（限定ベータ）"],
    grades: CoverageGrades(routes: .B, poi: .B, hours: .C, transit: .C),
    lastValidatedAt: validatedAt,
    publicCopy: [
      .en: "Limited beta coverage. Driving and place estimates may be useful, but opening hours and public-transit quality vary by city and require local confirmation.",
      .ja: "限定ベータの対応範囲です。車移動と地点情報は参考になりますが、営業時間と公共交通の品質は都市差が大きいため現地確認が必要です。",
    ]
  )

  static let unsupported = RegionalCoverageProfile(
    id: .unsupported,
    label: [.en: "Unvalidated region", .ja: "未検証地域"],
    grades: CoverageGrades(routes: .unknown, poi: .unknown, hours: .unknown, transit: .unknown),
    lastValidatedAt: nil,
    publicCopy: [
      .en: "TripCheck has not validated regional route, place, opening-hour, or transit coverage here. Any plan is provisional and every consequential fact should be checked.",
      .ja: "この地域では経路・地点・営業時間・公共交通の対応を検証していません。旅程は暫定として扱い、重要な事実を個別に確認してください。",
    ]
  )

  /// TS `COVERAGE_PROFILES`(`:126-133`)。
  public static let profiles: [CoverageProfileId: RegionalCoverageProfile] = [
    .tokyo: tokyo,
    .japan_other: japanOther,
    .switzerland: switzerland,
    .europe: europe,
    .usa: usa,
    .unsupported: unsupported,
  ]

  /// TS `europeanDestinations`(`:137-148`)。
  static let europeanDestinations: Set<String> = [
    "france", "italy", "spain", "portugal", "uk", "germany", "austria", "netherlands", "iceland", "norway",
  ]

  /// TS `europeanCountryCodes`(`:150-154`)。
  static let europeanCountryCodes: Set<String> = [
    "AD", "AL", "AT", "BA", "BE", "BG", "BY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GB", "GR",
    "HR", "HU", "IE", "IS", "IT", "LI", "LT", "LU", "LV", "MC", "MD", "ME", "MK", "MT", "NL", "NO",
    "PL", "PT", "RO", "RS", "SE", "SI", "SK", "SM", "UA", "VA",
  ]

  static let alpha2Pattern = try! JSRegex("^[A-Z]{2}$")
  static let hintSeparatorPattern = try! JSRegex("[\\s_-]+")

  /// TS `normalizedCountryCode`(`:156-159`)。
  static func normalizedCountryCode(_ value: String?) -> String? {
    let normalized = (value ?? "").trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
    return alpha2Pattern.test(normalized) ? normalized : nil
  }

  /// TS `normalizedHint`(`:161-163`)。
  static func normalizedHint(_ value: String?) -> String {
    let trimmed = (value ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased(with: Locale(identifier: "en_US"))
    return hintSeparatorPattern.replacingAll(in: trimmed, with: " ")
  }

  /// TS `hasCoordinate`(`:165-174`)。
  static func hasCoordinate(_ input: CoverageLookup) -> Bool {
    guard let latitude = input.latitude, let longitude = input.longitude else { return false }
    return latitude.isFinite && latitude >= -90 && latitude <= 90
      && longitude.isFinite && longitude >= -180 && longitude <= 180
  }

  /// TS `isTokyoCoverageCoordinate`(`:177-184`)—— 検証範囲の控えめな箱であって、行政区画ではない。
  public static func isTokyo(lat latitude: Double, lng longitude: Double) -> Bool {
    latitude.isFinite && longitude.isFinite
      && latitude >= 35.45 && latitude <= 35.90
      && longitude >= 139.45 && longitude <= 140.05
  }

  /// TS `coarseProfileForDestination`(`:186-192`)。
  static func coarseProfileForDestination(_ destination: String) -> CoverageProfileId? {
    if destination == "japan" { return .japan_other }
    if destination == "switzerland" { return .switzerland }
    if destination == "usa" { return .usa }
    if europeanDestinations.contains(destination) { return .europe }
    return nil
  }

  /// TS `coarseProfileForCountry`(`:194-200`)。
  static func coarseProfileForCountry(_ countryCode: String?) -> CoverageProfileId? {
    if countryCode == "JP" { return .japan_other }
    if countryCode == "CH" { return .switzerland }
    if countryCode == "US" { return .usa }
    if let countryCode, europeanCountryCodes.contains(countryCode) { return .europe }
    return nil
  }

  /// TS `coverageProfileForLocation`(`:206-226`)。
  ///
  /// 全域を覆う「閉じるほうへ倒す」照会:食い違う入力・知らない入力は、近くの地域の自信を
  /// 引き継がない —— 全部 unknown のプロファイルを返す。
  public static func forLocation(_ input: CoverageLookup = CoverageLookup()) -> RegionalCoverageProfile {
    let destination = (input.destination ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    let byDestination = coarseProfileForDestination(destination)
    let byCountry = coarseProfileForCountry(normalizedCountryCode(input.countryCode))
    if let byDestination, let byCountry, byDestination != byCountry { return unsupported }

    let coarse = byCountry ?? byDestination
    let hint = normalizedHint(input.regionHint)
    let tokyoHint = hint == "tokyo" || hint == "東京"
    let coordinateIsTokyo = hasCoordinate(input) && isTokyo(lat: input.latitude!, lng: input.longitude!)

    // 明示された「日本ではない」場所と食い違う座標やヒントは、あいまいな証拠であって、
    // 東京の対応を名乗ってよい許可ではない。
    if tokyoHint || coordinateIsTokyo, let coarse, coarse != .japan_other { return unsupported }
    if coarse == .japan_other { return tokyoHint || coordinateIsTokyo ? tokyo : japanOther }
    if coarse == nil, tokyoHint || coordinateIsTokyo { return tokyo }
    if coarse == .switzerland { return switzerland }
    if coarse == .europe { return europe }
    if coarse == .usa { return usa }
    return unsupported
  }

  /// ブリーフの `forLocation(destination:countryCode:coordinate:)`。
  public static func forLocation(
    destination: DestinationId?,
    countryCode: String? = nil,
    coordinate: GeoPoint? = nil,
    regionHint: String? = nil
  ) -> RegionalCoverageProfile {
    forLocation(CoverageLookup(
      destination: destination?.rawValue,
      countryCode: countryCode,
      latitude: coordinate?.latitude,
      longitude: coordinate?.longitude,
      regionHint: regionHint
    ))
  }

  /// TS `coverageProfileById`(`:229-232`)—— 知らない id でも落ちない。全部 unknown になる。
  public static func byId(_ id: String?) -> RegionalCoverageProfile {
    guard let id, let parsed = CoverageProfileId(rawValue: id), let profile = profiles[parsed] else { return unsupported }
    return profile
  }

  /// TS `coverageGrade`(`:235-242`)—— プロファイルが無い/将来の領域が、間違って A/B/C になれない。
  public static func grade(_ profile: RegionalCoverageProfile?, _ dimension: CoverageDimension) -> CoverageGrade {
    profile?.grades[dimension] ?? .unknown
  }

  /// 領域名が文字列で来る呼び出し(TS は `CoverageDimension | string` を受ける)。
  public static func grade(_ profile: RegionalCoverageProfile?, _ dimension: String) -> CoverageGrade {
    guard let parsed = CoverageDimension(rawValue: dimension) else { return .unknown }
    return grade(profile, parsed)
  }

  /// TS `coveragePublicCopy`(`:244-250`)—— 知らないロケールは英語に落ちる。
  public static func publicCopy(_ profile: RegionalCoverageProfile?, locale: PlannerLocale = .en) -> String {
    let safeProfile = profile ?? unsupported
    return locale == .ja ? (safeProfile.publicCopy[.ja] ?? "") : (safeProfile.publicCopy[.en] ?? "")
  }

  /// TS `hasUnknownRegionalCoverage`(`:252-255`)。
  public static func hasUnknownRegionalCoverage(_ profile: RegionalCoverageProfile?) -> Bool {
    CoverageDimension.allCases.contains { grade(profile, $0) == .unknown }
  }

  /// TS `isDeepCoverageProfile`(`:263-269`)。
  ///
  /// 深い対応 = 4 つの領域が全部 A か B。C か unknown が 1 つでもあれば、常に見える
  /// Copy Deck scope.beta の 1 行を出さなければならない。深い地域では何も出さない
  /// (領域ごとの詳細は、どちらにせよ対応の開閉部の中にいる)。
  public static func isDeep(_ profile: RegionalCoverageProfile?) -> Bool {
    guard profile != nil else { return false }
    return CoverageDimension.allCases.allSatisfy {
      let value = grade(profile, $0)
      return value == .A || value == .B
    }
  }
}
