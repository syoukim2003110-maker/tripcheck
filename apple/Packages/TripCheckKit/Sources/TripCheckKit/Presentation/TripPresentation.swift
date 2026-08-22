import Foundation

/*
 * 画面が共有する「領域 → 表示」の変換 —— 日付、所要時間、距離、時計、住所、支払い、空港の
 * 選択肢、ホテルの価格帯。
 *
 * 移植元:`lib/presentation/trip-presentation.ts:1-212`。関数名は TS のまま。
 */

/// TS `TripStatsTotals`(`lib/presentation/trip-presentation.ts:125-130`)。
public struct TripStatsTotals: Equatable, Sendable {
  public var placeCount: Int
  public var travelMinutes: Int
  public var bufferMinutes: Int
  /// 判定が結論を保留したとき(未解決の場所、または入り切らない旅)は `nil`。
  public var spareDays: Int?

  public init(placeCount: Int, travelMinutes: Int, bufferMinutes: Int, spareDays: Int? = nil) {
    self.placeCount = placeCount
    self.travelMinutes = travelMinutes
    self.bufferMinutes = bufferMinutes
    self.spareDays = spareDays
  }
}

/// TS `tripStatsParts` の戻り値(`:138-157`)。
public struct TripStatsParts: Equatable, Sendable {
  public var separator: String
  public var places: String
  public var travel: String
  public var spare: String

  public init(separator: String, places: String, travel: String, spare: String) {
    self.separator = separator
    self.places = places
    self.travel = travel
    self.spare = spare
  }
}

/// TS `weekdayInfo` の戻り値(`:22`)。
public struct WeekdayInfo: Equatable, Sendable {
  public var label: String
  public var isWeekend: Bool
  public var isSunday: Bool

  public init(label: String, isWeekend: Bool, isSunday: Bool) {
    self.label = label
    self.isWeekend = isWeekend
    self.isSunday = isSunday
  }
}

/// TS `HotelPriceLevel`(`lib/google-hotels.ts:48`)。並びは TS `priceLevelOrder`(`:64`)。
public enum HotelPriceLevel: String, Codable, Sendable, CaseIterable {
  case inexpensive, moderate, expensive, very_expensive
}

/// TS `AirportGroup`(`:73`)。
public struct AirportGroup: Equatable, Sendable {
  public struct Option: Equatable, Sendable {
    public var value: String
    public var label: String

    public init(value: String, label: String) {
      self.value = value
      self.label = label
    }
  }

  public var label: String?
  public var options: [Option]

  public init(label: String?, options: [Option]) {
    self.label = label
    self.options = options
  }
}

/// TS `PaymentObservation["method"]`(`lib/place-intelligence.ts:34`)。
public enum PaymentMethod: String, Codable, Sendable, CaseIterable {
  case cash, card, qr, transport_ic
}

/// TS `PaymentObservation`(`lib/place-intelligence.ts:33-40`)のうち、ラベルが読む 2 つ。
public struct PaymentObservation: Equatable, Sendable, Codable {
  public var method: PaymentMethod
  public var accepted: Bool

  public init(method: PaymentMethod, accepted: Bool) {
    self.method = method
    self.accepted = accepted
  }
}

/// TS `PlaceIntelligenceResult["place"]["payment"]`(`lib/place-intelligence.ts:71-77`)。
/// 提供元との通信は Kit の外なので、表示側が受け取る形だけを持つ。
public struct PlacePaymentFacts: Equatable, Sendable, Codable {
  public var cashOnly: Bool?
  public var creditCards: Bool?
  public var observations: [PaymentObservation]

  public init(cashOnly: Bool? = nil, creditCards: Bool? = nil, observations: [PaymentObservation] = []) {
    self.cashOnly = cashOnly
    self.creditCards = creditCards
    self.observations = observations
  }
}

public enum TripPresentation {

  /// TS `weekdayNames`(`:12-15`)。
  public static let weekdayNames: [PlannerLocale: [String]] = [
    .ja: ["日", "月", "火", "水", "木", "金", "土"],
    .en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  ]

  /// TS `weekdayInfo`(`:17-23`)—— 日付は UTC で読む(`new Date(\`${date}T00:00:00Z\`)`)。
  public static func weekdayInfo(_ date: String?, locale: PlannerLocale) -> WeekdayInfo? {
    guard let date, let parsed = CalendarDate(date) else { return nil }
    let day = parsed.weekday
    return WeekdayInfo(
      label: weekdayNames[locale]?[day] ?? "",
      isWeekend: day == 0 || day == 6,
      isSunday: day == 0
    )
  }

  /// TS `formatDistanceMeters`(`:25-27`)。
  public static func formatDistanceMeters(_ meters: Double) -> String {
    meters < 950
      ? "\(Int(max(10, (meters / 10).rounded(.toNearestOrAwayFromZero) * 10)))m"
      : "\(jsToFixed(meters / 1000, 1))km"
  }

  public static func formatDistanceMeters(_ meters: Int) -> String {
    formatDistanceMeters(Double(meters))
  }

  /// TS `placeCandidateLabel`(`:29-44`)—— 確認画面の候補 1 件を 1 行で。
  public static func placeCandidateLabel(
    candidate: ResolvedStop,
    anchors: [ResolvedStop],
    locale: PlannerLocale
  ) -> String {
    let nearest = anchors
      .filter { $0.id != candidate.id }
      .map { straightLineDistanceKm(
        GeoPoint(latitude: candidate.latitude, longitude: candidate.longitude),
        GeoPoint(latitude: $0.latitude, longitude: $0.longitude)
      ) }
      .sorted()
      .first
    let type = candidate.placeTypes?.first?.replacingOccurrences(of: "_", with: " ")
    let parts: [String?] = [
      candidate.address.isEmpty ? candidate.area : candidate.address,
      candidate.countryCode,
      type,
      nearest.flatMap { value -> String? in
        guard value.isFinite else { return nil }
        let rounded = jsToFixed(value, value < 10 ? 1 : 0)
        return locale == .ja ? "他の場所から約\(rounded)km" : "about \(rounded) km from another stop"
      },
    ]
    let joined = parts.compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
    return "\(candidate.name) — \(joined)"
  }

  /// TS `resolvedStopAddress`(`:46-49`)—— 住所があればそれ、無ければ地区名。
  public static func resolvedStopAddress(_ stop: ResolvedStop?) -> String {
    guard let stop else { return "" }
    return stop.address.isEmpty ? stop.area : stop.address
  }

  /// `RouteStop` には住所のフィールドが無いので、TS の `"address" in stop` は常に偽。
  public static func resolvedStopAddress(_ stop: RouteStop?) -> String {
    stop?.area ?? ""
  }

  /// TS `safeRemovedStopLabels`(`:51-62`)—— 旅行者が自分で書いた名前だけを見せる。書いた覚えの
  /// 無い名前(推薦や解決で付いた名前)は伏せ字にする。
  public static func safeRemovedStopLabels(
    removed: [(id: String, name: String)],
    raw: String,
    locale: PlannerLocale
  ) -> [(id: String, name: String)] {
    let authoredNames = Set(WishlistParser.places(raw).map(\.name))
    let fallback = locale == .ja ? "除外した場所" : "Removed place"
    return removed.map { entry in
      (id: entry.id, name: authoredNames.contains(entry.name) ? entry.name : fallback)
    }
  }

  /// TS `priceLevelOrder`(`:64`)。
  public static let priceLevelOrder: [HotelPriceLevel] = [.inexpensive, .moderate, .expensive, .very_expensive]

  /// TS `priceBand`(`:68-71`)—— Google の価格帯は相対値なので、円記号固定ではなく現地通貨の
  /// 記号で描く。
  public static func priceBand(_ level: HotelPriceLevel?, destination: Destination) -> String? {
    guard let level, let index = priceLevelOrder.firstIndex(of: level) else { return nil }
    let symbols = Destinations.priceBandSymbols(destination)
    return index < symbols.count ? symbols[index] : nil
  }

  /// TS `airportOptionsFor`(`:75-91`)。国が決まる前は、全部の玄関口を国ごとにまとめて出す ——
  /// 最初のビルドの前にフライトを入れられなければならない。
  public static func airportOptionsFor(locale: PlannerLocale, destination: Destination) -> [AirportGroup] {
    func gateways(_ candidate: Destination) -> [AirportGroup.Option] {
      candidate.airports.map { airport in
        AirportGroup.Option(
          value: airport.code,
          label: "\(airport.code) · \(locale == .ja ? (airport.names[.ja] ?? "") : (airport.names[.en] ?? ""))"
        )
      }
    }
    let empty = AirportGroup(
      label: nil,
      options: [AirportGroup.Option(value: "none", label: locale == .ja ? "未指定" : "Not specified")]
    )
    if destination.id != .worldwide {
      return [empty, AirportGroup(label: nil, options: gateways(destination))]
    }
    let collationLocale = Locale(identifier: locale == .ja ? "ja" : "en")
    let grouped = Destinations.all
      .filter { !$0.airports.isEmpty }
      .map { AirportGroup(label: Destinations.name($0, locale: locale), options: gateways($0)) }
      .sorted { ($0.label ?? "").compare($1.label ?? "", options: [], range: nil, locale: collationLocale) == .orderedAscending }
    return [empty] + grouped
  }

  /// TS `airportComparisonDestination`(`:93-96`)。
  public static func airportComparisonDestination(active: Destination, airportCode: String) -> Destination {
    guard active.id == .worldwide, airportCode != "none" else { return active }
    return Destinations.all.first { $0.airports.contains { $0.code == airportCode } } ?? active
  }

  /// TS `formatDuration`(`:98-104`)。
  public static func formatDuration(minutes: Int, locale: PlannerLocale) -> String {
    let safe = max(0, minutes)
    let hours = safe / 60
    let remainder = safe % 60
    if locale == .ja { return hours > 0 ? "\(hours)時間\(remainder > 0 ? "\(remainder)分" : "")" : "\(remainder)分" }
    return hours > 0 ? "\(hours)h\(remainder > 0 ? " \(remainder)m" : "")" : "\(remainder)m"
  }

  /// TS `Math.max(0, Math.round(minutes))` —— 端数を持つ分をそのまま渡す呼び出し向け。
  public static func formatDuration(minutes: Double, locale: PlannerLocale) -> String {
    guard minutes.isFinite else { return formatDuration(minutes: 0, locale: locale) }
    return formatDuration(minutes: max(0, Int(minutes.rounded(.toNearestOrAwayFromZero))), locale: locale)
  }

  /// TS `tripStatsParts`(`:138-157`)。
  ///
  /// Copy Deck plan.stats:見出しの下の 1 行 —— 場所・移動の合計・余裕の合計。TC-029:これは
  /// 1 行であって監査の塊ではない。呼び出し側は計画が既に持っている合計(折り畳んだ詳細が使うのと
  /// 同じ数)を渡す。新しく計算し直さない。
  ///
  /// `spareDays` は余裕の節を **置き換える**(足さない)。エンジンはこの数をずっと計算していて、
  /// 誰も読んでいなかった —— 4 日の旅の中身が 3 日で足りるとき、画面は「余裕22時間」と言い、
  /// 「この旅の 1 日はまるまる空いている」という意味を読者に推測させていた。同じ空き時間の
  /// 解像度違いで、それが丸ごとの日になるなら日数のほうが正直。節を足さず入れ替えるので、
  /// 最初の 1 画面に収まるという約束が保たれる。
  ///
  /// 判定が結論を保留しているとき(`spareDays == nil`)は黙る —— 薄い証拠で「空いている」と
  /// 言わない。
  public static func tripStatsParts(_ totals: TripStatsTotals, locale: PlannerLocale) -> TripStatsParts {
    let travel = formatDuration(minutes: totals.travelMinutes, locale: locale)
    let spareDays = totals.spareDays
    let hasSpareDays = (spareDays ?? 0) > 0
    if locale == .ja {
      return TripStatsParts(
        separator: "・",
        places: "\(totals.placeCount)か所",
        travel: "移動\(travel)",
        spare: hasSpareDays
          ? "\(spareDays ?? 0)日分の空き"
          : "余裕\(formatDuration(minutes: totals.bufferMinutes, locale: locale))"
      )
    }
    return TripStatsParts(
      separator: " · ",
      places: "\(totals.placeCount) place\(totals.placeCount == 1 ? "" : "s")",
      travel: "\(travel) travel",
      spare: hasSpareDays
        ? "\(spareDays ?? 0) day\((spareDays ?? 0) == 1 ? "" : "s") spare"
        : "\(formatDuration(minutes: totals.bufferMinutes, locale: locale)) buffer"
    )
  }

  /// TS `tripStatsLine`(`:159-162`)。
  public static func tripStatsLine(_ totals: TripStatsTotals, locale: PlannerLocale) -> String {
    let parts = tripStatsParts(totals, locale: locale)
    return [parts.places, parts.travel, parts.spare].joined(separator: parts.separator)
  }

  /// TS `builtPlanTravelMinutes`(`lib/planner-app-state.ts:219-226`)。ホテル往復と各区間の
  /// 推奨手段の分を足す。
  public static func builtPlanTravelMinutes(_ plan: BuiltTripPlan) -> Int {
    plan.days.reduce(0) { sum, day in
      sum
        + (day.hotelOutboundMinutes ?? 0)
        + (day.hotelInboundMinutes ?? 0)
        + day.legs.reduce(0) { $0 + $1.comparison.recommended.minutes }
    }
  }

  /// `app/components/planner/hooks/useTripDomainModel.tsx:1297-1305` の組み立て —— 折り畳んだ
  /// 詳細が見せるのと同じ数(共有の移動時間の計算と、適合エンジンの日ごとの余裕)を使う。
  /// 別の集計を second source として作らない。
  public static func tripStatsTotals(plan: BuiltTripPlan, fit: TripFitAssessment) -> TripStatsTotals {
    TripStatsTotals(
      placeCount: plan.scheduledStopCount,
      travelMinutes: builtPlanTravelMinutes(plan),
      bufferMinutes: fit.days.reduce(0) { $0 + max(0, $1.slackMinutes) },
      spareDays: fit.spareDays
    )
  }

  /// TS `formatWindowClock`(`:164-167`)。
  public static func formatWindowClock(minutes: Int) -> String {
    let normalized = ((minutes % 1440) + 1440) % 1440
    return "\(normalized / 60):\(String(format: "%02d", normalized % 60))"
  }

  /// TS `/^(\d{1,2}):(\d{2})$/`(`:170`)。JS の `\d` は ASCII だけなので `[0-9]` と書く
  /// —— ICU の `\d` は Unicode の数字全部を拾ってしまう。
  static let plannerClockPattern = try! JSRegex("^([0-9]{1,2}):([0-9]{2})$")

  /// TS `shiftPlannerClock`(`:169-176`)—— 読めない値はそのまま返す。
  public static func shiftPlannerClock(_ value: String, minutes: Int) -> String {
    guard let match = plannerClockPattern.firstMatch(in: value), match.groups.count >= 2,
          let hours = match.groups[0].flatMap({ Int($0) }),
          let mins = match.groups[1].flatMap({ Int($0) })
    else { return value }
    let total = hours * 60 + mins
    let shifted = max(0, min(23 * 60 + 59, total + minutes))
    return "\(String(format: "%02d", shifted / 60)):\(String(format: "%02d", shifted % 60))"
  }

  /// TS `googleMapsSearchUrl`(`:178-180`)。
  public static func googleMapsSearchUrl(_ stop: RouteStop) -> String {
    "https://www.google.com/maps/search/?api=1&query=\(encodeURIComponent("\(stop.name) \(stop.area)"))"
  }

  /// TS `formatCheckedAt`(`:182-191`)—— `Intl.DateTimeFormat(locale, { month: "short",
  /// day: "numeric", hour: "2-digit", minute: "2-digit" })`。ICU/CLDR の同じ骨格を
  /// `DateFormatter.dateFormat(fromTemplate:)` で組み直す(表示専用で、TS 側にもテストは無い)。
  public static func formatCheckedAt(_ value: String, locale: PlannerLocale) -> String {
    let parser = ISO8601DateFormatter()
    parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let date = parser.date(from: value) ?? {
      let plain = ISO8601DateFormatter()
      plain.formatOptions = [.withInternetDateTime]
      return plain.date(from: value)
    }()
    guard let date else { return "" }
    let identifier = locale == .ja ? "ja_JP" : "en_US"
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: identifier)
    formatter.dateFormat = DateFormatter.dateFormat(
      fromTemplate: "MMMdhhmm",
      options: 0,
      locale: Locale(identifier: identifier)
    ) ?? "MMM d, hh:mm"
    return formatter.string(from: date)
  }

  /// TS `paymentLabel`(`:193-212`)—— Google の掲載を先に、無ければ口コミの報告を 1 つだけ。
  public static func paymentLabel(_ payment: PlacePaymentFacts, locale: PlannerLocale) -> String? {
    if payment.cashOnly == true { return locale == .ja ? "現金のみ（Google掲載）" : "Cash only · Google listing" }
    if payment.creditCards == true { return locale == .ja ? "カード可（Google掲載）" : "Cards accepted · Google listing" }
    let observations = payment.observations
    guard let observation = observations.first else { return nil }
    let hasConflict = observations.contains { $0.method == .card && $0.accepted }
      && observations.contains { $0.method == .card && !$0.accepted }
    if hasConflict { return locale == .ja ? "支払いの口コミが分かれています" : "Payment reports conflict" }
    if observation.method == .cash { return locale == .ja ? "口コミ: 現金のみとの報告" : "Review: cash only reported" }
    if observation.method == .card, !observation.accepted {
      return locale == .ja ? "口コミ: カード不可との報告" : "Review: cards not accepted"
    }
    if observation.method == .qr {
      return observation.accepted
        ? (locale == .ja ? "口コミ: コード決済の利用報告" : "Review: code payment reported")
        : (locale == .ja ? "口コミ: コード決済不可との報告" : "Review: code payment not accepted")
    }
    if observation.method == .transport_ic {
      return observation.accepted
        ? (locale == .ja ? "口コミ: 交通系ICの利用報告" : "Review: transit IC reported")
        : (locale == .ja ? "口コミ: 交通系IC不可との報告" : "Review: transit IC not accepted")
    }
    return locale == .ja ? "口コミ: カード利用の報告" : "Review: card payment reported"
  }
}
