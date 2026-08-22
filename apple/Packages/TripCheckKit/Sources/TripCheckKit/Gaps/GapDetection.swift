import Foundation

/*
 * ある日の予定表のどこに 30 分以上の穴があるか、その穴の大きさが何を提案してよいかを決め、
 * 半日以上空いた日にいくつまで TripCheck 発の提案を差し込んでよいかを決める。
 *
 * lib/gap-detection.ts 全 266 行(型 :1-50、候補集合 :52-58、`classifyGapMinutes` :59-64、
 * 時計ヘルパー :66-98、`buildGap` :99-127、`detectItineraryGaps` :134-184、
 * `FILLER_ALLOWANCE_MINUTES_EACH`/`FILLER_ALLOWANCE_MAX` :189-194、`dayFillerAllowance` :214-217、
 * `primaryItineraryGap` :229-235、`detectGapsFromBuiltDay` :238-266)の全訳。
 */

/// TS `GapKind` (`lib/gap-detection.ts:4`)
public enum GapKind: String, Codable, Sendable, CaseIterable {
  case BEFORE_FIRST_ANCHOR, BETWEEN_ANCHORS, BEFORE_HOTEL_RETURN
}

/// TS `GapSizeBand` (`lib/gap-detection.ts:5`)。`ItineraryGap.sizeBand` は TS では
/// `Extract<GapSizeBand, "SHORT_30_TO_59" | "MEDIUM_60_TO_119" | "LONG_120_PLUS">` に絞られている
/// (`:37`) —— Swift に構造的な絞り込み型はないので同じ `GapSizeBand` をそのまま使うが、
/// `buildGap` が `BELOW_MINIMUM` のときは常に `nil` を返す(`:111`)ので、`ItineraryGap.sizeBand` に
/// `BELOW_MINIMUM` が現れることはない。
public enum GapSizeBand: String, Codable, Sendable, CaseIterable {
  case BELOW_MINIMUM, SHORT_30_TO_59, MEDIUM_60_TO_119, LONG_120_PLUS
}

/// TS `GapSuggestionKind` (`lib/gap-detection.ts:7`)。ATTRACTION は普通の観光スポット向けの区分を
/// 開けるもので、仕様上 120 分以上の帯にしか渡らない。
public enum GapSuggestionKind: String, Codable, Sendable, CaseIterable {
  case CAFE, BAKERY, PARK, LOOKOUT, SMALL_FACILITY, WALK, CAFE_AND_WALK, ATTRACTION
}

/// TS `GapScheduledAnchor` (`lib/gap-detection.ts:11-18`)。TS の `GapCoordinate`
/// (`Readonly<{latitude,longitude}>`、`:9`)は独自型を起こさず既存の `GeoPoint` をそのまま使う。
public struct GapScheduledAnchor: Equatable, Sendable, Codable {
  public var id: String
  public var startAt: String
  public var endAt: String
  public var coordinate: GeoPoint
  /// この項目の直前に必ず要る移動・道探しの分数。
  public var travelFromPreviousMinutes: Int

  public init(id: String, startAt: String, endAt: String, coordinate: GeoPoint, travelFromPreviousMinutes: Int) {
    self.id = id
    self.startAt = startAt
    self.endAt = endAt
    self.coordinate = coordinate
    self.travelFromPreviousMinutes = travelFromPreviousMinutes
  }
}

/// TS `GapDetectionDay` (`lib/gap-detection.ts:20-31`) — `detectItineraryGaps` の入力。
public struct GapDetectionDay: Equatable, Sendable, Codable {
  public var dayIndex: Int
  public var startAt: String
  /// `availableMinutes` が無いとき、かつ日が日跨ぎしないときにだけ使われる。
  public var usableUntil: String
  /// 空港の締切や日跨ぎの日の曖昧さを消す。
  public var availableMinutes: Int?
  public var startCoordinate: GeoPoint?
  public var endCoordinate: GeoPoint?
  public var returnTravelMinutes: Int
  public var anchors: [GapScheduledAnchor]

  public init(
    dayIndex: Int,
    startAt: String,
    usableUntil: String,
    availableMinutes: Int? = nil,
    startCoordinate: GeoPoint? = nil,
    endCoordinate: GeoPoint? = nil,
    returnTravelMinutes: Int,
    anchors: [GapScheduledAnchor]
  ) {
    self.dayIndex = dayIndex
    self.startAt = startAt
    self.usableUntil = usableUntil
    self.availableMinutes = availableMinutes
    self.startCoordinate = startCoordinate
    self.endCoordinate = endCoordinate
    self.returnTravelMinutes = returnTravelMinutes
    self.anchors = anchors
  }
}

/// TS `ItineraryGap` (`lib/gap-detection.ts:33-45`)。フィールド名は TS のまま
/// (`sizeBand`/`startAt`/`endAt`/`availableMinutes`/`previousAnchorId`/`nextAnchorId`/
/// `routeSegment`)——ブリーフの Interfaces 節にある簡略な呼び名(`band`/`startMinutes`/
/// `endMinutes`/`minutes`/`center`/`previousStopId`/`nextStopId`)とは食い違うが、タスクの指示
/// (「ItineraryGap fields per TS」「ブリーフと TS が食い違えば TS が勝つ」)により TS を採る。
public struct ItineraryGap: Equatable, Sendable, Codable {
  /// TS `routeSegment: Readonly<{from,to}>` (`:43`)
  public struct RouteSegment: Equatable, Sendable, Codable {
    public var from: GeoPoint?
    public var to: GeoPoint?

    public init(from: GeoPoint?, to: GeoPoint?) {
      self.from = from
      self.to = to
    }
  }

  public var id: String
  public var dayIndex: Int
  public var kind: GapKind
  public var sizeBand: GapSizeBand
  public var startAt: String
  public var endAt: String
  public var availableMinutes: Int
  public var previousAnchorId: String?
  public var nextAnchorId: String?
  public var routeSegment: RouteSegment
  public var suggestionKinds: [GapSuggestionKind]

  public init(
    id: String,
    dayIndex: Int,
    kind: GapKind,
    sizeBand: GapSizeBand,
    startAt: String,
    endAt: String,
    availableMinutes: Int,
    previousAnchorId: String? = nil,
    nextAnchorId: String? = nil,
    routeSegment: RouteSegment,
    suggestionKinds: [GapSuggestionKind]
  ) {
    self.id = id
    self.dayIndex = dayIndex
    self.kind = kind
    self.sizeBand = sizeBand
    self.startAt = startAt
    self.endAt = endAt
    self.availableMinutes = availableMinutes
    self.previousAnchorId = previousAnchorId
    self.nextAnchorId = nextAnchorId
    self.routeSegment = routeSegment
    self.suggestionKinds = suggestionKinds
  }
}

/// TS `BuiltDayGapOptions` (`lib/gap-detection.ts:47-50`)
public struct BuiltDayGapOptions: Equatable, Sendable {
  public var dayIndex: Int?
  public var transferBufferMinutes: Int?

  public init(dayIndex: Int? = nil, transferBufferMinutes: Int? = nil) {
    self.dayIndex = dayIndex
    self.transferBufferMinutes = transferBufferMinutes
  }
}

public enum GapDetection {

  // MARK: - Filler 上限の定数(`:189-194`)

  /// TS `FILLER_ALLOWANCE_MINUTES_EACH` (`lib/gap-detection.ts:189`)。1 件追加するのに要る分数
  /// (見学 + 行き帰り)。他の定数と同じく Swift の命名規約(lowerCamelCase)に寄せる —— この
  /// キットの他の定数(例: `jsMaxSafeInteger` = TS `Number.MAX_SAFE_INTEGER`)もそう揃えてある。
  public static let fillerAllowanceMinutesEach = 120

  /// TS `FILLER_ALLOWANCE_MAX` (`lib/gap-detection.ts:194`)。空いた日でも上限は 3 —— 旅行者自身の
  /// 行き先が主役であり続けるため。
  public static let fillerAllowanceMax = 3

  // MARK: - 帯の分類(`:59-64`)

  /// TS `classifyGapMinutes` (`lib/gap-detection.ts:59-64`)。TS は `!Number.isFinite(minutes)` も
  /// 見るが、`Int` は非有限値を表せないのでその枝は落ちる(呼び出し側もすべて既に丸めた `Int`
  /// しか渡さない)。
  public static func classify(minutes: Int) -> GapSizeBand {
    if minutes < 30 { return .BELOW_MINIMUM }
    if minutes < 60 { return .SHORT_30_TO_59 }
    if minutes < 120 { return .MEDIUM_60_TO_119 }
    return .LONG_120_PLUS
  }

  // MARK: - 提案候補の集合(`:52-58`)

  private static let shortSuggestions: [GapSuggestionKind] = [.CAFE, .BAKERY, .PARK, .LOOKOUT]
  private static let mediumSuggestions: [GapSuggestionKind] = [.SMALL_FACILITY, .WALK, .CAFE_AND_WALK]
  // 帯表 120 分以上では普通の観光スポットも候補に加わる(`:54-56`)。
  private static let longSuggestions: [GapSuggestionKind] = [.ATTRACTION, .SMALL_FACILITY, .WALK, .CAFE_AND_WALK]

  // MARK: - 時計ヘルパー(`:66-98`)

  /// TS `parseClock` (`:66-69`) — `/^(?:([01]\d|2[0-3])):([0-5]\d)$/`。`ClockTime.init?(_:)`
  /// (`lib/trip-builder.ts:349-360` の `clockMinutes` の移植)は 1 桁の時("9:00")も許す、より緩い
  /// 正規表現なので、ここでは流用せず gap-detection.ts 自身の厳密な 2 桁形式を別個に再現する。
  private static func parseClock(_ value: String) -> Int? {
    let chars = Array(value)
    guard chars.count == 5, chars[2] == ":" else { return nil }
    let digits = [chars[0], chars[1], chars[3], chars[4]]
    guard digits.allSatisfy({ $0.isASCII && $0.isNumber }),
          let h0 = chars[0].wholeNumberValue, let h1 = chars[1].wholeNumberValue,
          let m0 = chars[3].wholeNumberValue, let m1 = chars[4].wholeNumberValue
    else { return nil }
    let hour = h0 * 10 + h1
    let minute = m0 * 10 + m1
    guard (0...23).contains(hour), (0...59).contains(minute) else { return nil }
    return hour * 60 + minute
  }

  /// TS `clockAt` (`:71-74`)。`((Math.round(m) % 1440) + 1440) % 1440` を 2 桁ゼロ埋めで表示する
  /// のは `ClockTime(minutes:).description` そのものなので、それを使う(`Int` は既に丸めてある)。
  private static func clockAt(_ absoluteMinutes: Int) -> String {
    ClockTime(minutes: absoluteMinutes).description
  }

  /// TS `unwrapClock` (`:76-82`) — `notBefore` を下回る間 1440 を足し続けて日跨ぎを畳む。
  private static func unwrapClock(_ value: String, notBefore: Int) -> Int? {
    guard let parsed = parseClock(value) else { return nil }
    var result = parsed
    while result < notBefore { result += 1440 }
    return result
  }

  /// TS `boundedMinutes` (`:84-86`)。`Int` は非有限値を持てないので `Number.isFinite` の枝は落ち、
  /// `Math.max(0, Math.round(value))` は `max(0, value)` に畳まる。
  private static func boundedMinutes(_ value: Int) -> Int { max(0, value) }

  /// TS `gapId` (`:88-97`)
  private static func gapId(
    dayIndex: Int,
    kind: GapKind,
    previousAnchorId: String?,
    nextAnchorId: String?,
    start: Int,
    end: Int
  ) -> String {
    "gap:\(dayIndex):\(kind.rawValue):\(previousAnchorId ?? "start"):\(nextAnchorId ?? "end"):\(start):\(end)"
  }

  // MARK: - 1 件のギャップを組む(`:99-127`)

  /// TS `buildGap` (`:99-127`)。30 分未満(`BELOW_MINIMUM`)は `nil` を返す。
  private static func buildGap(
    dayIndex: Int,
    kind: GapKind,
    start: Int,
    end: Int,
    previousAnchorId: String?,
    nextAnchorId: String?,
    from: GeoPoint?,
    to: GeoPoint?
  ) -> ItineraryGap? {
    let availableMinutes = max(0, end - start)
    let sizeBand = classify(minutes: availableMinutes)
    guard sizeBand != .BELOW_MINIMUM else { return nil }
    return ItineraryGap(
      id: gapId(dayIndex: dayIndex, kind: kind, previousAnchorId: previousAnchorId, nextAnchorId: nextAnchorId, start: start, end: end),
      dayIndex: dayIndex,
      kind: kind,
      sizeBand: sizeBand,
      startAt: clockAt(start),
      endAt: clockAt(end),
      availableMinutes: availableMinutes,
      previousAnchorId: previousAnchorId,
      nextAnchorId: nextAnchorId,
      routeSegment: .init(from: from, to: to),
      suggestionKinds: sizeBand == .SHORT_30_TO_59 ? shortSuggestions
        : sizeBand == .MEDIUM_60_TO_119 ? mediumSuggestions : longSuggestions
    )
  }

  // MARK: - 1 日ぶんのギャップを全部見つける(`:129-184`)

  /// TS `detectItineraryGaps` (`:134-184`)。30 分以上のギャップを全部見つける。帯(30-59/60-119/
  /// 120+)がどの提案区分を使ってよいかを決める(120+ は普通の観光スポットも開ける)。
  ///
  /// ビルダーが訪問順のまま `anchors` を渡してくる前提なので、挿入順=時系列順として返す
  /// (表示用の時計で並べ直さない —— 日跨ぎの日では 00:15 の時計面の数字は 23:45 より小さいが、
  /// 時系列では後に来る)。
  public static func detect(day: GapDetectionDay) -> [ItineraryGap] {
    guard let dayStart = parseClock(day.startAt), !day.anchors.isEmpty else { return [] }
    let parsedEnd = parseClock(day.usableUntil)
    let dayEnd: Int
    if let availableMinutes = day.availableMinutes {
      dayEnd = dayStart + boundedMinutes(availableMinutes)
    } else if let parsedEnd, parsedEnd >= dayStart {
      dayEnd = parsedEnd
    } else {
      dayEnd = dayStart
    }

    var gaps: [ItineraryGap] = []
    var previousEnd = dayStart
    var previousAnchor: GapScheduledAnchor?

    for anchor in day.anchors {
      guard let arrival = unwrapClock(anchor.startAt, notBefore: previousEnd) else { continue }
      let earliestArrival = previousEnd + boundedMinutes(anchor.travelFromPreviousMinutes)
      if let gap = buildGap(
        dayIndex: day.dayIndex,
        kind: previousAnchor != nil ? .BETWEEN_ANCHORS : .BEFORE_FIRST_ANCHOR,
        start: earliestArrival,
        end: arrival,
        previousAnchorId: previousAnchor?.id,
        nextAnchorId: anchor.id,
        from: previousAnchor?.coordinate ?? day.startCoordinate,
        to: anchor.coordinate
      ) {
        gaps.append(gap)
      }
      let departure = unwrapClock(anchor.endAt, notBefore: arrival)
      previousEnd = departure ?? arrival
      previousAnchor = anchor
    }

    if let previousAnchor {
      let latestReturnDeparture = dayEnd - boundedMinutes(day.returnTravelMinutes)
      if let gap = buildGap(
        dayIndex: day.dayIndex,
        kind: .BEFORE_HOTEL_RETURN,
        start: previousEnd,
        end: latestReturnDeparture,
        previousAnchorId: previousAnchor.id,
        nextAnchorId: nil,
        from: previousAnchor.coordinate,
        to: day.endCoordinate
      ) {
        gaps.append(gap)
      }
    }

    return gaps
  }

  // MARK: - 既存の BuiltPlanDay/TripFitDay への薄い橋渡し(`:236-266`)

  private static func gapAnchors(for day: BuiltPlanDay, transferBufferMinutes: Int) -> [GapScheduledAnchor] {
    day.stops.enumerated().map { index, builtStop in
      GapScheduledAnchor(
        id: builtStop.stop.id,
        startAt: builtStop.arrival,
        endAt: builtStop.departure,
        coordinate: GeoPoint(latitude: builtStop.stop.latitude, longitude: builtStop.stop.longitude),
        travelFromPreviousMinutes: index == 0
          ? (day.hotelOutboundMinutes ?? 0) + (day.startBase != nil ? transferBufferMinutes : 0)
          : day.legs[index - 1].comparison.recommended.minutes + transferBufferMinutes
      )
    }
  }

  /// TS `detectGapsFromBuiltDay` (`:238-266`) —— 既に決定的に組み上がった `BuiltPlanDay`/
  /// `TripFitDay` の出力を読むだけの薄い橋渡し。計画のロジックはここでは持たない。
  public static func detect(day: BuiltPlanDay, fitDay: TripFitDay, options: BuiltDayGapOptions = BuiltDayGapOptions()) -> [ItineraryGap] {
    let transferBufferMinutes = boundedMinutes(options.transferBufferMinutes ?? 10)
    return detect(day: GapDetectionDay(
      dayIndex: options.dayIndex ?? fitDay.dayIndex,
      startAt: day.startTime,
      usableUntil: fitDay.usableUntil,
      availableMinutes: fitDay.availableMinutes,
      startCoordinate: day.startBase.map { GeoPoint(latitude: $0.latitude, longitude: $0.longitude) },
      endCoordinate: day.endBase.map { GeoPoint(latitude: $0.latitude, longitude: $0.longitude) },
      returnTravelMinutes: day.hotelInboundMinutes ?? 0,
      anchors: gapAnchors(for: day, transferBufferMinutes: transferBufferMinutes)
    ))
  }

  /// フィクスチャ専用の簡便版(TS に対応物なし、本番の入口ではない)——ブリーフの Interfaces 節が
  /// 求める「`BuiltPlanDay` と `dayIndex` だけからギャップを出す」形そのもの。本番の入口は常に
  /// **`detect(day:fitDay:options:)` を使うこと**——`detectGapsFromBuiltDay` は常に外部から渡された
  /// `TripFitDay`(= その日に本当に残っている時間の窓)を読むが、こちらは `day.finishTime` を
  /// そのまま窓の終わりとして使う —— まだ一度も日程探索を通していない `BuiltPlanDay`(テストの
  /// `TestStops.dayWithGap`/`dayWithGaps` が組むような)に「日の終わりまで何時間も残っている」と
  /// いう作り話のホテル復路ギャップを持ち込まないため。名前と `internal` 可視性のどちらも、本番の
  /// `detect(day:fitDay:options:)` と取り違えられないようにするためのもの
  /// (`@testable import` 経由でテストからは見える)。
  static func detectForFixture(day: BuiltPlanDay, dayIndex: Int) -> [ItineraryGap] {
    let transferBufferMinutes = 10
    return detect(day: GapDetectionDay(
      dayIndex: dayIndex,
      startAt: day.startTime,
      usableUntil: day.finishTime,
      availableMinutes: nil,
      startCoordinate: day.startBase.map { GeoPoint(latitude: $0.latitude, longitude: $0.longitude) },
      endCoordinate: day.endBase.map { GeoPoint(latitude: $0.latitude, longitude: $0.longitude) },
      returnTravelMinutes: day.hotelInboundMinutes ?? 0,
      anchors: gapAnchors(for: day, transferBufferMinutes: transferBufferMinutes)
    ))
  }

  // MARK: - 一番埋める価値のあるギャップ(`:219-235`)

  /// TS `primaryItineraryGap` (`:229-235`)。訪問順の並びのまま最大を探すので、同値は先に見つかった
  /// ほう(=訪問順で早いほう)が勝つ。日をまたいで組み直しても同じ答えになるための決定性。
  public static func primaryGap(_ gaps: [ItineraryGap]) -> ItineraryGap? {
    var best: ItineraryGap?
    for gap in gaps {
      if let current = best {
        if gap.availableMinutes > current.availableMinutes { best = gap }
      } else {
        best = gap
      }
    }
    return best
  }

  /// フィクスチャ専用の簡便版(TS に対応物なし、本番の入口ではない)。`detectForFixture(day:dayIndex:)`
  /// の上に乗るだけの `primaryGap(_:)` 呼び出しで、本番の入口は変わらず `primaryGap(_:)`
  /// (`detect(day:fitDay:options:)` の結果を渡す)である。
  static func primaryGapForFixture(day: BuiltPlanDay, dayIndex: Int) -> ItineraryGap? {
    primaryGap(detectForFixture(day: day, dayIndex: dayIndex))
  }

  // MARK: - 日の余裕から決まる Filler 上限(`:196-217`)

  /// TS `dayFillerAllowance` (`:214-217`)。TS のテストが `Number.NaN`/`Number.POSITIVE_INFINITY` を
  /// 直に渡すので、`Int` ではなく `Double` を取る(`classify(minutes:)` は逆に呼び出し側が既に
  /// 丸めた `Int` しか渡さないので `Int` のまま——この 2 つで型の選び方が割れるのはそのため)。
  public static func dayFillerAllowance(slackMinutes: Double) -> Int {
    guard slackMinutes.isFinite, slackMinutes >= Double(fillerAllowanceMinutesEach) else { return 1 }
    return min(fillerAllowanceMax, Int((slackMinutes / Double(fillerAllowanceMinutesEach)).rounded(.down)))
  }
}
