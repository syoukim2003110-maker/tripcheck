import Foundation

/*
 * TC-062:対応範囲の外へ出る旅程を、決まった手順で見つける。
 *
 * 用語が対応外だと名指ししているのは 3 つ —— 国境をまたぐ移動、複数の時間帯、フェリー。
 * この module は、計画側が既に持っている証拠(解決済み停留所の国コード、目的地の時間帯、
 * Google の乗車ステップ)を、1 件につき最大 1 本の短い警告に変える。データを入れて警告が出る
 * だけ:通信もしないし、計画を止めることも決してない。
 *
 * 移植元:`lib/trip-scope.ts:1-65`。
 */

/// TS `TripScopeStop`(`lib/trip-scope.ts:9`)。
public struct TripScopeStop: Equatable, Sendable {
  public var countryCode: String?

  public init(countryCode: String? = nil) {
    self.countryCode = countryCode
  }
}

/// TS `TripScopeTransitStep`(`lib/trip-scope.ts:10`)。
public struct TripScopeTransitStep: Equatable, Sendable {
  public var vehicleType: String?

  public init(vehicleType: String? = nil) {
    self.vehicleType = vehicleType
  }
}

/// TS `TripScopeWarning["kind"]`(`lib/trip-scope.ts:12-15`)。
public enum TripScopeWarningKind: String, Sendable, CaseIterable {
  case border, timezone, ferry
}

/// TS `TripScopeWarning`(`lib/trip-scope.ts:12-15`)。TS は判別共用体なので、種類ごとに
/// 付随データが違う —— Swift も同じ形にして、`kind` で読めるようにする。
public struct TripScopeWarning: Equatable, Sendable {
  public var kind: TripScopeWarningKind
  /// `border` のときだけ。
  public var countryCodes: [String]
  /// `timezone` のときだけ。
  public var timeZones: [String]

  public init(kind: TripScopeWarningKind, countryCodes: [String] = [], timeZones: [String] = []) {
    self.kind = kind
    self.countryCodes = countryCodes
    self.timeZones = timeZones
  }

  /// 旅行者に見せる 1 行(`ui.scopeBorder` / `scopeTimezone` / `scopeFerry`)。
  public func copy(_ locale: PlannerLocale) -> String {
    let text = Copy.for(locale)
    switch kind {
    case .border: return text.scopeBorder
    case .timezone: return text.scopeTimezone
    case .ferry: return text.scopeFerry
    }
  }
}

public enum TripScope {

  /// TS `tripScopeWarnings`(`lib/trip-scope.ts:25-65`)。
  ///
  /// よくある場合 —— 1 か国(または 1 つの目的地プロファイル)、1 つの時計、フェリーの証拠なし
  /// —— では黙る。`reference` は時計を比べる瞬間(夏時間)を固定する:呼び出し側は既定で「いま」、
  /// テストは固定の日付を渡す。
  public static func warnings(
    stops: [TripScopeStop],
    transitSteps: [TripScopeTransitStep]? = nil,
    reference: Date = Date()
  ) -> [TripScopeWarning] {
    var warnings: [TripScopeWarning] = []
    let pattern = try! JSRegex("^[A-Z]{2}$")
    var seenCodes = Set<String>()
    var codes: [String] = []
    for stop in stops {
      let code = (stop.countryCode ?? "").trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
      guard pattern.test(code), seenCodes.insert(code).inserted else { continue }
      codes.append(code)
    }
    let countryCodes = codes.sorted(by: jsStringLess)

    // 目的地モデルが 1 つの対応プロファイルだと宣言している国の組(IT+VA+SM、FR+MC、CH+LI、
    // ES+AD、NL+BE+LU)は 1 つの領域として数える:バチカンを含むローマの旅が国境越えと読まれては
    // ならない。プロファイルを持たない国は、それぞれ独立した領域のまま。
    let territories = Set(countryCodes.map { Destinations.forCountryCode($0)?.id.rawValue ?? "country:\($0)" })
    if territories.count >= 2 {
      warnings.append(TripScopeWarning(kind: .border, countryCodes: countryCodes))
    }

    // 「複数の時間帯」は、その瞬間に時計が **実際に** 違うこと —— パリとローマは別の IANA ゾーン
    // だが同じ時計なので黙る。ゾーンは目的地プロファイルから来るので、プロファイルの無い国は
    // ここには何も足さない(国境の警告が既にその分を見ている)。
    var seenZones = Set<String>()
    var zones: [String] = []
    for code in countryCodes {
      guard let zone = Destinations.forCountryCode(code)?.timeZone, seenZones.insert(zone).inserted else { continue }
      zones.append(zone)
    }
    let timeZones = zones.sorted(by: jsStringLess)
    let offsets = Set(timeZones.map { Destinations.utcOffsetMinutes(at: reference, timeZone: $0) })
    if offsets.count >= 2 {
      warnings.append(TripScopeWarning(kind: .timezone, timeZones: timeZones))
    }

    // フェリーは取得できた経路の証拠にしか現れない:乗車ステップの vehicleType が FERRY のとき。
    // 計測した公共交通の区間が無ければ、地理から推測せずに黙る。
    if (transitSteps ?? []).contains(where: { ($0.vehicleType ?? "").uppercased() == "FERRY" }) {
      warnings.append(TripScopeWarning(kind: .ferry))
    }
    return warnings
  }

  /// 解決済み停留所をそのまま渡す形(`TripPlannerShell.tsx:962-964` の呼び出し方)。
  public static func warnings(
    resolvedStops: [ResolvedStop],
    transitSteps: [TripScopeTransitStep]? = nil,
    reference: Date = Date()
  ) -> [TripScopeWarning] {
    warnings(
      stops: resolvedStops.map { TripScopeStop(countryCode: $0.countryCode) },
      transitSteps: transitSteps,
      reference: reference
    )
  }
}
