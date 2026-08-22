import Foundation

/*
 * 泊まる場所。書かれたホテル名からどのエリアを拠点として計画するかを決め(`resolveTripBase`)、
 * 決まっていないときは経路の閉路距離で候補を並べ(`recommendBases`)、下書きの旅程全体から
 * 「どのあたりに泊まると全日が近いか」を 1 点にまとめる(`hotelRouteContextForDraft`)。
 *
 * lib/trip-builder.ts:293 (`foodVenuePattern`)、:296-308 (`baseDefinitions`)、
 * :640-650 (`buildBase`)、:652-666 (`resolveTripBase`)、:668-675 (`stableEntryId`)、
 * :677-698 (`resolveUserFoodReservation`)、:700-721 (`recommendBases`)、
 * :724-733 (`HotelRoutePoint`/`HotelRouteContext`)、:734-740 (`meanPoint`)、
 * :742-744 (`geoDistanceKm`)、:746-774 (`balancedGeoCenter`)、:776-785 (`maximumPairDistanceKm`)、
 * :787-806 (`hotelRouteContextForDraft`)、:808-811 (`hotelAnchorForDraft`)。
 *
 * `routeDistanceFromBase` (`:584-589`) と `optimizeFromBase` (`:591-638`) は Task 10 で
 * `Geo/RouteOrdering.swift` に移植済みなのでそちらを使う。
 */

/// TS `baseDefinitions` の要素 (`lib/trip-builder.ts:296-301`)。`aliases` はライブラリ内部の
/// 判定にしか使わないので `internal`(`JSRegex` を公開 API に出さない)。
public struct BaseDefinition: Sendable {
  public let id: String
  /// `Catalog.resolveKnownStops` に渡す地名。座標・URL・確度はカタログの 1 件目から借りる。
  public let lookup: String
  public let names: [PlannerLocale: String]
  let aliases: [JSRegex]

  init(id: String, lookup: String, aliasSources: [String], names: [PlannerLocale: String]) {
    self.id = id
    self.lookup = lookup
    self.names = names
    self.aliases = aliasSources.map { try! JSRegex($0, options: [.caseInsensitive]) }
  }
}

/// TS `HotelRoutePoint` (`lib/trip-builder.ts:724`) — 1 日ぶんの経路を代表する 1 点。
public typealias HotelRoutePoint = GeoPoint

/// TS `HotelRouteContext` (`lib/trip-builder.ts:726-732`)。
public struct HotelRouteContext: Hashable, Sendable, Codable {
  public var latitude: Double
  public var longitude: Double
  public var area: String
  public var routePoints: [HotelRoutePoint]
  /// 経路点どうしの最大距離。1 ホテルで通す旅がどれだけ広いかを隠さず出すための値。
  public var spreadKm: Double

  public init(latitude: Double, longitude: Double, area: String, routePoints: [HotelRoutePoint], spreadKm: Double) {
    self.latitude = latitude
    self.longitude = longitude
    self.area = area
    self.routePoints = routePoints
    self.spreadKm = spreadKm
  }
}

public enum Bases {
  /// TS `baseDefinitions` (`lib/trip-builder.ts:296-308`) — 東京の 5 拠点。
  /// TS は ko/zh の名前も持つが、このキットの `PlannerLocale` は en/ja だけなので
  /// `Geo/Catalog.swift` と同じく 2 言語ぶんを写す。
  public static let tokyoDefinitions: [BaseDefinition] = [
    BaseDefinition(
      id: "base-shinjuku", lookup: "Shinjuku",
      aliasSources: ["shinjuku|新宿|신주쿠"],
      names: [.en: "Shinjuku area", .ja: "新宿エリア"]
    ),
    BaseDefinition(
      id: "base-shibuya", lookup: "Shibuya",
      aliasSources: ["shibuya|渋谷|시부야|涩谷"],
      names: [.en: "Shibuya area", .ja: "渋谷エリア"]
    ),
    BaseDefinition(
      id: "base-tokyo-station", lookup: "Tokyo Station",
      aliasSources: ["tokyo\\s*station|東京駅|도쿄역|东京站"],
      names: [.en: "Tokyo Station area", .ja: "東京駅エリア"]
    ),
    BaseDefinition(
      id: "base-ueno", lookup: "Ueno Park",
      aliasSources: ["ueno|上野|우에노"],
      names: [.en: "Ueno area", .ja: "上野エリア"]
    ),
    BaseDefinition(
      id: "base-asakusa", lookup: "Asakusa",
      aliasSources: ["asakusa|浅草|아사쿠사"],
      names: [.en: "Asakusa area", .ja: "浅草エリア"]
    ),
  ]

  /// TS `buildBase` (`lib/trip-builder.ts:640-650`)。
  ///
  /// TS は `resolveKnownStops(definition.lookup, locale)[0]` を無条件に展開する。カタログに
  /// 一致が無ければ `{...undefined}` = `{}` となり、座標が `undefined` の拠点が出来てしまう
  /// (距離計算が NaN になる)ので、Swift では「作れない」を `nil` で返す。5 定義はいずれも
  /// 東京カタログに一致するため、この差は現行データでは観測できない。
  static func buildBase(_ definition: BaseDefinition, locale: PlannerLocale, query: String) -> TripBase? {
    guard let source = Catalog.resolveKnownStops(definition.lookup, locale: locale).first else { return nil }
    var base = TripBase(routeStop: source, query: query)
    base.id = definition.id
    base.name = definition.names[locale] ?? definition.names[.en] ?? ""
    base.planningDurationMinutes = 0
    base.isAnchor = false
    return base
  }

  /// TS `resolveTripBase` (`lib/trip-builder.ts:652-666`)。解決済みの実在ホテルが最優先、
  /// 次にホテル欄の文字列がどのエリア別名に当たるか。どちらでもなければ拠点なしで計画する。
  ///
  /// 引数の並びは task-14-brief.md の Interfaces に合わせた(TS は `(query, locale, resolvedBase)`)。
  public static func resolveTripBase(query: String, resolved: ResolvedStop?, locale: PlannerLocale) -> TripBase? {
    let normalized = query.trimmingCharacters(in: .whitespacesAndNewlines)
    if let resolved {
      var base = TripBase(routeStop: resolved.routeStop, query: normalized.isEmpty ? resolved.name : normalized)
      base.id = "base-\(resolved.id)"
      base.planningDurationMinutes = 0
      base.isAnchor = false
      return base
    }
    if normalized.isEmpty { return nil }
    guard let match = tokyoDefinitions.first(where: { definition in
      definition.aliases.contains { $0.test(normalized) }
    }) else { return nil }
    return buildBase(match, locale: locale, query: normalized)
  }

  /// TS `recommendBases` (`lib/trip-builder.ts:700-721`) — どの候補に泊まると各日の閉路
  /// (拠点 → その日の停留所を最短順で → 拠点)の合計が短いか。上位 3 件。
  ///
  /// task-14-brief.md の Interfaces は `(clusters:, destination:, locale:)` だが、移植元は
  /// `stops` と `nationwide` を読み、`destination` は一切読まない。TS を正とした。
  /// `nationwide` が真(= 利用者が解決済みの場所を入れている全国モード)のときは、
  /// 東京 5 拠点ではなく停留所の `area` ごとに動的な拠点を作る。
  public static func recommendBases(
    stops: [RouteStop],
    clusters: [[RouteStop]],
    locale: PlannerLocale,
    nationwide: Bool
  ) -> [BaseRecommendation] {
    if stops.isEmpty { return [] }
    let bases: [TripBase] = nationwide ? dynamicBases(stops: stops, locale: locale)
      : tokyoDefinitions.compactMap { buildBase($0, locale: locale, query: "") }
    let scored = bases.map { base -> BaseRecommendation in
      let routeStop = base.routeStop
      let routeDistanceKm = clusters.reduce(0.0) { sum, cluster in
        sum + RouteOrdering.routeDistanceFromBase(
          RouteOrdering.optimizeFromBase(cluster, base: routeStop),
          base: routeStop
        )
      }
      return BaseRecommendation(base: base, routeDistanceKm: routeDistanceKm)
    }
    return Array(stableSorted(scored) { $0.routeDistanceKm < $1.routeDistanceKm }.prefix(3))
  }

  /// TS `:702-709` の `dynamicBases`。JS の `new Map(...)` は「最初に現れた位置」で並び、
  /// 値は「最後に書いた停留所」になるので、その両方を再現する。
  private static func dynamicBases(stops: [RouteStop], locale: PlannerLocale) -> [TripBase] {
    var order: [String] = []
    var lastByArea: [String: RouteStop] = [:]
    for stop in stops {
      if lastByArea[stop.area] == nil { order.append(stop.area) }
      lastByArea[stop.area] = stop
    }
    return order.map { area in
      let stop = lastByArea[area]!
      var base = TripBase(routeStop: stop, query: stop.name)
      base.id = "base-dynamic-\(stop.id)"
      base.name = locale == .ja ? "\(stop.area)周辺" : "\(stop.area) area"
      base.planningDurationMinutes = 0
      base.isAnchor = false
      return base
    }
  }

  /// TS `meanPoint` (`lib/trip-builder.ts:734-740`)
  static func meanPoint(_ points: [GeoPoint]) -> GeoPoint? {
    if points.isEmpty { return nil }
    return GeoPoint(
      latitude: points.reduce(0.0) { $0 + $1.latitude } / Double(points.count),
      longitude: points.reduce(0.0) { $0 + $1.longitude } / Double(points.count)
    )
  }

  /// TS `geoDistanceKm` (`lib/trip-builder.ts:742-744`) — `straightLineDistanceKm` そのもの。
  static func geoDistanceKm(_ from: GeoPoint, _ to: GeoPoint) -> Double {
    straightLineDistanceKm(from, to)
  }

  /// TS `balancedGeoCenter` (`lib/trip-builder.ts:746-774`)。
  ///
  /// 幾何中央値(全点への距離の総和を最小にする点)を Weiszfeld 法で求める。平均や
  /// 「いちばん遠い停留所へ半分寄せる」旧ヒューリスティックと違い、遠出 1 回では
  /// 旅の大半を過ごす場所からホテルを引き剥がせない。
  public static func balancedGeoCenter(_ points: [GeoPoint]) -> GeoPoint? {
    guard var current = meanPoint(points) else { return nil }
    if points.count <= 2 { return current }

    for _ in 0..<48 {
      if let coincident = points.first(where: { geoDistanceKm(current, $0) < 0.001 }) {
        return GeoPoint(latitude: coincident.latitude, longitude: coincident.longitude)
      }
      var latitude = 0.0
      var longitude = 0.0
      var weightTotal = 0.0
      for point in points {
        let weight = 1 / max(0.001, geoDistanceKm(current, point))
        latitude += point.latitude * weight
        longitude += point.longitude * weight
        weightTotal += weight
      }
      let next = GeoPoint(latitude: latitude / weightTotal, longitude: longitude / weightTotal)
      if geoDistanceKm(current, next) < 0.001 { return next }
      current = next
    }
    return current
  }

  /// TS `maximumPairDistanceKm` (`lib/trip-builder.ts:776-785`)
  static func maximumPairDistanceKm(_ points: [GeoPoint]) -> Double {
    var maximum = 0.0
    guard points.count > 1 else { return maximum }
    for left in 0..<points.count {
      for right in (left + 1)..<points.count {
        maximum = max(maximum, geoDistanceKm(points[left], points[right]))
      }
    }
    return maximum
  }

  /// TS `hotelRouteContextForDraft` (`lib/trip-builder.ts:787-806`)。
  ///
  /// 1 日 1 点にすることで、その日に何箇所書いたかに関係なく全ての移動日が同じ 1 票を持つ。
  /// 候補ホテルを「合成した 1 座標」ではなく旅程全体と突き合わせられるようになる。
  public static func hotelRouteContext(for plan: BuiltTripPlan) -> HotelRouteContext? {
    let routePoints = plan.days.compactMap { day in
      balancedGeoCenter(day.stops.map { GeoPoint(latitude: $0.stop.latitude, longitude: $0.stop.longitude) })
    }
    guard let center = balancedGeoCenter(routePoints) else { return nil }
    let scheduled = plan.days.flatMap { $0.stops.map(\.stop) }
    let nearest = stableSorted(scheduled) { left, right in
      geoDistanceKm(center, GeoPoint(latitude: left.latitude, longitude: left.longitude))
        < geoDistanceKm(center, GeoPoint(latitude: right.latitude, longitude: right.longitude))
    }.first
    return HotelRouteContext(
      latitude: center.latitude,
      longitude: center.longitude,
      area: nearest?.area ?? "",
      routePoints: routePoints,
      spreadKm: maximumPairDistanceKm(routePoints)
    )
  }

  /// TS `hotelAnchorForDraft` (`lib/trip-builder.ts:808-811`)
  public static func hotelAnchor(for plan: BuiltTripPlan) -> (GeoPoint, area: String)? {
    guard let context = hotelRouteContext(for: plan) else { return nil }
    return (GeoPoint(latitude: context.latitude, longitude: context.longitude), area: context.area)
  }

  /// TS `stableEntryId` (`lib/trip-builder.ts:668-675`) — FNV-1a。JS の `^=` / `Math.imul` は
  /// 32 bit で回るので `UInt32` の巻き上げ演算がそのまま同じビット列になり、`hash >>> 0` 後の
  /// `Math.abs` は恒等なので基数 36 に落とすだけでよい。`for...of` は符号位置(コードポイント)
  /// 単位で回るので `unicodeScalars` を使う。
  ///
  /// 呼び出し側の `name.toLocaleLowerCase()` (`:690`) は `lowercased()` に写した。両者が食い違うのは
  /// ホストのロケールが tr/az(`I` → `ı`)や lt のときだけで、`lowercased()` はロケール非依存に
  /// 畳む。id は端末をまたいで同じでなければならないので、ここではロケール非依存のほうが正しい。
  static func stableEntryId(_ value: String) -> String {
    var hash: UInt32 = 2166136261
    for scalar in value.unicodeScalars {
      hash ^= UInt32(scalar.value)
      hash = hash &* 16777619
    }
    return String(hash, radix: 36)
  }
}

/// TS `foodVenuePattern` (`lib/trip-builder.ts:293`)
private let foodVenuePattern = try! JSRegex(
  "\\b(?:restaurant|cafe|café|lunch|dinner|sushi|ramen|izakaya|bar)\\b"
    + "|レストラン|食堂|寿司|すし|鮨|ラーメン|居酒屋|カフェ|ランチ|ディナー|昼食|夕食"
    + "|식당|레스토랑|카페|점심|저녁|스시|라멘|餐厅|餐館|咖啡|午餐|晚餐|寿司|拉面",
  options: [.caseInsensitive]
)

/// TS `:687` の `entry.split(/\s+[—–-]\s+/)` — 最初の区切りより前だけを名前として使う。
private let entryNoteSeparator = try! JSRegex("\\s+[—–-]\\s+")

/// TS `resolveUserFoodReservation` (`lib/trip-builder.ts:677-698`)。
///
/// 予約済みと書かれた飲食店の行で、しかもエリアが東京 5 拠点のどれかとして分かるときだけ、
/// 利用者入力の停留所(75 分・`isAnchor`)にする。座標はそのエリアのカタログ点を借りるので
/// 確度は `low`、`verifiedAt` は `"user-entered"`。
///
/// task-14-brief.md の Interfaces は `(_ place: ParsedWishlistPlace, ...)` だが、移植元は
/// 文字列 1 本(呼び出し側の `entry` = `place.name`、`:1978`/`:1983`)を受ける。TS を正とした。
///
/// TS は `{...area}` (`:691`) で `TripBase` を展開するので、戻り値の `RouteStop` に `query` キーが
/// 実行時だけ紛れ込む。型としては `RouteStop` なので誰も読まない余剰フィールドで、Swift では
/// 表現しない(`area.routeStop` が `query` を落とす)。
public func resolveUserFoodReservation(
  entry: String,
  constraint: WishlistStopConstraint,
  locale: PlannerLocale
) -> RouteStop? {
  guard constraint.isReservation, foodVenuePattern.test(entry) else { return nil }
  guard let areaDefinition = Bases.tokyoDefinitions.first(where: { definition in
    definition.aliases.contains { $0.test(entry) }
  }) else { return nil }
  guard let area = Bases.buildBase(areaDefinition, locale: locale, query: entry) else { return nil }

  let head = entryNoteSeparator.firstMatch(in: entry).map { String(entry[..<$0.range.lowerBound]) } ?? entry
  let name = head.trimmingCharacters(in: .whitespacesAndNewlines)

  var stop = area.routeStop
  stop.id = "user-food-\(Bases.stableEntryId(name.lowercased()))"
  stop.name = name
  stop.sourceUrl = "https://www.google.com/maps/search/?api=1&query=\(encodeURIComponent(name))"
  stop.verifiedAt = "user-entered"
  stop.confidence = .low
  stop.planningDurationMinutes = 75
  stop.isAnchor = true
  stop.isUserEntered = true
  return stop
}

/// JS の `encodeURIComponent`(`A-Za-z0-9` と `-_.!~*'()` 以外を UTF-8 の大文字 `%XX` に)。
/// `Geo/GoogleMapsUrl.swift` の form エンコード(空白が `+`)とは別物なので共有しない。
///
/// `Presentation/TripPresentation.swift` の `googleMapsSearchUrl`(TS
/// `lib/presentation/trip-presentation.ts:178-180`)も同じ 1 行を組むので、ここから使う
/// —— Task 24 で `private` を外した。
func encodeURIComponent(_ value: String) -> String {
  var result = ""
  for byte in value.utf8 {
    switch byte {
    case 0x41...0x5A, 0x61...0x7A, 0x30...0x39,
         0x2D, 0x5F, 0x2E, 0x21, 0x7E, 0x2A, 0x27, 0x28, 0x29:
      result.unicodeScalars.append(Unicode.Scalar(byte))
    default:
      result += String(format: "%%%02X", byte)
    }
  }
  return result
}
