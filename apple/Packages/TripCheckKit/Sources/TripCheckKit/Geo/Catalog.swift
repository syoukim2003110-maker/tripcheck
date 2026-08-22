import Foundation

/// lib/route-optimizer.ts:52-58 — `CatalogPoi`(`RouteStop` から `name`/`area`/`isAnchor` を除き、
/// ローカライズ名・別名リスト・予約要否を持つ内部データ型)。カタログは ja/en のみ保持する
/// (`name`/`area` の ko/zh は TS 側にもあるが東京カタログの現行用途では使わない)。
struct CatalogPoi {
  let id: String
  let name: [PlannerLocale: String]
  let area: [PlannerLocale: String]
  let latitude: Double
  let longitude: Double
  let sourceUrl: String
  let verifiedAt: String
  let confidence: Confidence
  let planningDurationMinutes: Int
  let reservationSensitive: Bool
  let aliases: [JSRegex]

  init(
    id: String,
    name: [PlannerLocale: String],
    area: [PlannerLocale: String],
    latitude: Double,
    longitude: Double,
    sourceUrl: String,
    verifiedAt: String,
    confidence: Confidence = .medium,
    planningDurationMinutes: Int,
    reservationSensitive: Bool = false,
    aliasSources: [String]
  ) {
    self.id = id
    self.name = name
    self.area = area
    self.latitude = latitude
    self.longitude = longitude
    self.sourceUrl = sourceUrl
    self.verifiedAt = verifiedAt
    self.confidence = confidence
    self.planningDurationMinutes = planningDurationMinutes
    self.reservationSensitive = reservationSensitive
    // TS の alias 正規表現は英字を含むものだけに `/i` が付く(例 /tsukiji.../i だが
    // /築地(?:場外市場)?/ には付かない)。CJK・ハングルのみの alias には大小文字の区別が
    // 存在しないため、全 alias に一律 `.caseInsensitive` を与えても TS と同じマッチ結果になる
    // (この 18 件の "/i" 無し alias は全て非 ASCII 文字だけで構成されていることを確認済み)。
    self.aliases = aliasSources.map { try! JSRegex($0, options: [.caseInsensitive]) }
  }
}

/// lib/route-optimizer.ts:60-284 — 東京の 18 地点。座標・URL・別名は逐語転記。
public enum Catalog {
  static let pois: [CatalogPoi] = [
    CatalogPoi(
      id: "tsukiji-market",
      name: [.en: "Tsukiji Outer Market", .ja: "築地場外市場"],
      area: [.en: "Tsukiji", .ja: "築地"],
      latitude: 35.6655, longitude: 139.7708,
      sourceUrl: "https://www.tsukiji.or.jp/english/",
      verifiedAt: "2026-07-17",
      planningDurationMinutes: 90,
      aliasSources: [
        "tsukiji(?:\\s+outer)?\\s+market", "築地(?:場外市場)?",
        "쓰키지(?:\\s*장외시장)?", "筑地(?:场外市场)?",
      ]
    ),
    CatalogPoi(
      id: "teamlab-planets",
      name: [.en: "teamLab Planets", .ja: "チームラボプラネッツ"],
      area: [.en: "Toyosu", .ja: "豊洲"],
      latitude: 35.6491, longitude: 139.7898,
      sourceUrl: "https://www.teamlab.art/e/planets/",
      verifiedAt: "2026-07-17",
      planningDurationMinutes: 120,
      reservationSensitive: true,
      aliasSources: [
        "teamlab\\s+planets", "チームラボプラネッツ", "팀랩\\s*플래닛", "teamlab\\s*无界",
      ]
    ),
    CatalogPoi(
      id: "sensoji",
      name: [.en: "Senso-ji", .ja: "浅草寺"],
      area: [.en: "Asakusa", .ja: "浅草"],
      latitude: 35.7148, longitude: 139.7967,
      sourceUrl: "https://www.senso-ji.jp/english/",
      verifiedAt: "2026-07-17",
      planningDurationMinutes: 75,
      aliasSources: ["senso-?ji", "浅草寺", "센소지"]
    ),
    CatalogPoi(
      id: "asakusa",
      name: [.en: "Asakusa", .ja: "浅草"],
      area: [.en: "Asakusa", .ja: "浅草"],
      latitude: 35.7119, longitude: 139.7983,
      sourceUrl: "https://e-asakusa.jp/en/",
      verifiedAt: "2026-07-17",
      planningDurationMinutes: 90,
      aliasSources: ["asakusa", "浅草(?!寺)", "아사쿠사"]
    ),
    CatalogPoi(
      id: "tokyo-skytree",
      name: [.en: "Tokyo Skytree", .ja: "東京スカイツリー"],
      area: [.en: "Oshiage", .ja: "押上"],
      latitude: 35.7101, longitude: 139.8107,
      sourceUrl: "https://www.tokyo-skytree.jp/en/",
      verifiedAt: "2026-07-17",
      planningDurationMinutes: 120,
      aliasSources: [
        "tokyo\\s+skytree", "(?:東京)?スカイツリー", "(?:도쿄\\s*)?스카이트리", "(?:东京)?晴空塔",
      ]
    ),
    CatalogPoi(
      id: "akihabara",
      name: [.en: "Akihabara", .ja: "秋葉原"],
      area: [.en: "Akihabara", .ja: "秋葉原"],
      latitude: 35.6984, longitude: 139.7731,
      sourceUrl: "https://www.gotokyo.org/en/story/walks-and-tours/akihabara/index.html",
      verifiedAt: "2026-07-17",
      planningDurationMinutes: 120,
      aliasSources: ["akihabara", "秋葉原", "아키하바라", "秋叶原"]
    ),
    CatalogPoi(
      id: "ueno-park",
      name: [.en: "Ueno Park", .ja: "上野公園"],
      area: [.en: "Ueno", .ja: "上野"],
      latitude: 35.7148, longitude: 139.7732,
      sourceUrl: "https://www.kensetsu.metro.tokyo.lg.jp/jimusho/toubuk/ueno/en_index.html",
      verifiedAt: "2026-07-17",
      planningDurationMinutes: 120,
      aliasSources: ["ueno\\s+park", "上野公園", "우에노\\s*공원", "上野公园"]
    ),
    CatalogPoi(
      id: "tokyo-station",
      name: [.en: "Tokyo Station", .ja: "東京駅"],
      area: [.en: "Marunouchi", .ja: "丸の内"],
      latitude: 35.6812, longitude: 139.7671,
      sourceUrl: "https://www.jreast.co.jp/e/stations/e1039.html",
      verifiedAt: "2026-07-17",
      planningDurationMinutes: 60,
      aliasSources: ["tokyo\\s+station", "東京駅", "도쿄역", "东京站"]
    ),
    CatalogPoi(
      id: "imperial-palace",
      name: [.en: "Imperial Palace", .ja: "皇居"],
      area: [.en: "Chiyoda", .ja: "千代田"],
      latitude: 35.6852, longitude: 139.7528,
      sourceUrl: "https://sankan.kunaicho.go.jp/english/guide/koukyo.html",
      verifiedAt: "2026-07-17",
      planningDurationMinutes: 90,
      aliasSources: ["imperial\\s+palace", "皇居", "고쿄"]
    ),
    CatalogPoi(
      id: "tokyo-tower",
      name: [.en: "Tokyo Tower", .ja: "東京タワー"],
      area: [.en: "Shibakoen", .ja: "芝公園"],
      latitude: 35.6586, longitude: 139.7454,
      sourceUrl: "https://www.gotokyo.org/en/spot/4/index.html",
      verifiedAt: "2026-07-17",
      planningDurationMinutes: 90,
      aliasSources: ["tokyo\\s+tower", "東京タワー", "도쿄\\s*타워", "东京塔"]
    ),
    CatalogPoi(
      id: "roppongi-hills",
      name: [.en: "Roppongi Hills", .ja: "六本木ヒルズ"],
      area: [.en: "Roppongi", .ja: "六本木"],
      latitude: 35.6605, longitude: 139.7292,
      sourceUrl: "https://www.gotokyo.org/en/destinations/southern-tokyo/roppongi/index.html",
      verifiedAt: "2026-07-17",
      planningDurationMinutes: 120,
      aliasSources: ["roppongi\\s+hills", "六本木ヒルズ", "롯폰기\\s*힐즈", "六本木新城"]
    ),
    CatalogPoi(
      id: "meiji-jingu",
      name: [.en: "Meiji Jingu", .ja: "明治神宮"],
      area: [.en: "Harajuku", .ja: "原宿"],
      latitude: 35.6764, longitude: 139.6993,
      sourceUrl: "https://www.meijijingu.or.jp/en/",
      verifiedAt: "2026-07-17",
      planningDurationMinutes: 90,
      aliasSources: ["meiji\\s+(?:jingu|shrine)", "明治神宮", "메이지\\s*신궁", "明治神宫"]
    ),
    CatalogPoi(
      id: "harajuku",
      name: [.en: "Harajuku", .ja: "原宿"],
      area: [.en: "Harajuku", .ja: "原宿"],
      latitude: 35.6702, longitude: 139.7027,
      sourceUrl: "https://www.gotokyo.org/en/destinations/western-tokyo/harajuku/index.html",
      verifiedAt: "2026-07-17",
      planningDurationMinutes: 120,
      aliasSources: ["harajuku", "原宿", "하라주쿠"]
    ),
    CatalogPoi(
      id: "shibuya-sky",
      name: [.en: "Shibuya Sky", .ja: "渋谷スカイ"],
      area: [.en: "Shibuya", .ja: "渋谷"],
      latitude: 35.6584, longitude: 139.7016,
      sourceUrl: "https://www.shibuya-scramble-square.com/sky/",
      verifiedAt: "2026-07-17",
      planningDurationMinutes: 90,
      reservationSensitive: true,
      aliasSources: ["shibuya\\s+sky", "渋谷スカイ", "시부야\\s*스카이", "涩谷\\s*sky"]
    ),
    CatalogPoi(
      id: "shibuya",
      name: [.en: "Shibuya", .ja: "渋谷"],
      area: [.en: "Shibuya", .ja: "渋谷"],
      latitude: 35.6595, longitude: 139.7005,
      sourceUrl: "https://www.gotokyo.org/en/destinations/western-tokyo/shibuya/index.html",
      verifiedAt: "2026-07-17",
      planningDurationMinutes: 120,
      aliasSources: [
        "shibuya(?!\\s+sky)", "渋谷(?!スカイ)", "시부야(?!\\s*스카이)", "涩谷(?!\\s*sky)",
      ]
    ),
    CatalogPoi(
      id: "shinjuku",
      name: [.en: "Shinjuku", .ja: "新宿"],
      area: [.en: "Shinjuku", .ja: "新宿"],
      latitude: 35.6909, longitude: 139.7003,
      sourceUrl: "https://www.gotokyo.org/en/destinations/western-tokyo/shinjuku/index.html",
      verifiedAt: "2026-07-17",
      planningDurationMinutes: 120,
      aliasSources: ["shinjuku", "新宿", "신주쿠"]
    ),
    CatalogPoi(
      id: "golden-gai",
      name: [.en: "Golden Gai", .ja: "ゴールデン街"],
      area: [.en: "Shinjuku", .ja: "新宿"],
      latitude: 35.6941, longitude: 139.7047,
      sourceUrl: "https://www.gotokyo.org/en/spot/62/index.html",
      verifiedAt: "2026-07-17",
      planningDurationMinutes: 90,
      aliasSources: ["golden\\s+gai", "ゴールデン街", "골든가이", "黄金街"]
    ),
    CatalogPoi(
      id: "ghibli-museum",
      name: [.en: "Ghibli Museum", .ja: "三鷹の森ジブリ美術館"],
      area: [.en: "Mitaka", .ja: "三鷹"],
      latitude: 35.6962, longitude: 139.5704,
      sourceUrl: "https://www.ghibli-museum.jp/en/",
      verifiedAt: "2026-07-17",
      planningDurationMinutes: 120,
      reservationSensitive: true,
      aliasSources: [
        "ghibli\\s+museum", "(?:三鷹の森)?ジブリ美術館", "지브리\\s*미술관", "吉卜力美术馆",
      ]
    ),
  ]

  public static let poiCount = pois.count

  /// lib/route-optimizer.ts:299 — `explicitAnchorPattern`
  private static let explicitAnchorPattern = try! JSRegex(
    "\\b(?:booked|booking|reserved|reservation|ticket|fixed|must[- ]?do)\\b|予約|確定|チケット|예매|예약|티켓|预订|预约|门票",
    options: [.caseInsensitive]
  )

  /// lib/route-optimizer.ts:285-287 — `dayHeading`。Task 7 では `resolveKnownStops` から使われない
  /// (TS でも呼ばれるのは行分割を行う `optimizeItineraryRoute` 側で、このタスクの移植範囲外)。
  /// 行範囲 :285-317 を逐語転記する一環として保持し、Builder の日区切りが後続タスクで再利用する。
  private static let dayHeadingPattern = try! JSRegex(
    "^(?:day\\s*\\d+|\\d+\\s*日目|\\d+\\s*일차|第?\\s*\\d+\\s*天)(?:\\s*[-–—:].*)?$",
    options: [.caseInsensitive]
  )

  static func isDayHeading(_ line: String) -> Bool {
    dayHeadingPattern.test(line)
  }

  /// lib/route-optimizer.ts:303-317 — `resolveKnownStops`。行内で各 POI が最初にマッチした
  /// 位置(UTF-16 コード単位。JS の `RegExp#exec().index` と同じ単位)の昇順で返す。
  public static func resolveKnownStops(_ line: String, locale: PlannerLocale = .en) -> [RouteStop] {
    var matches: [(index: Int, stop: RouteStop)] = []
    for poi in pois {
      var minIndex: Int?
      for alias in poi.aliases {
        guard let match = alias.firstMatch(in: line) else { continue }
        let index = match.range.lowerBound.utf16Offset(in: line)
        if minIndex == nil || index < minIndex! { minIndex = index }
      }
      if let index = minIndex {
        matches.append((index: index, stop: toStop(poi, locale: locale, line: line)))
      }
    }
    matches.sort { $0.index < $1.index }
    return matches.map { $0.stop }
  }

  /// カタログの `reservationSensitive` フラグ。未知の id には `false` を返す。
  public static func isReservationSensitive(id: String) -> Bool {
    pois.first { $0.id == id }?.reservationSensitive ?? false
  }

  /// lib/route-optimizer.ts:289-298 — `toStop`。Task 21 の `CatalogResolver` が名前の完全一致で
  /// 引いた POI を同じ形に畳むので internal(モジュール内)まで開けてある。
  static func toStop(_ poi: CatalogPoi, locale: PlannerLocale, line: String) -> RouteStop {
    RouteStop(
      id: poi.id,
      name: poi.name[locale] ?? poi.name[.en] ?? "",
      area: poi.area[locale] ?? poi.area[.en] ?? "",
      latitude: poi.latitude,
      longitude: poi.longitude,
      sourceUrl: poi.sourceUrl,
      verifiedAt: poi.verifiedAt,
      confidence: poi.confidence,
      planningDurationMinutes: poi.planningDurationMinutes,
      isAnchor: poi.reservationSensitive || explicitAnchorPattern.test(line)
    )
  }
}
