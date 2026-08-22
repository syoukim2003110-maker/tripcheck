import Foundation

/*
 * 1 日のタイムラインが下す「言い方」の決定 —— ラベル、旗、枠の置き場所、乗車の行 ——
 * を全部、副作用のない関数にする(仕様 v2.1 §4/§6)。
 *
 * 移植元:`lib/presentation/timeline-presentation.ts:1-197`。関数名は TS のまま。
 */

/// TS `DurationEvidenceStatus = EvidenceStatus`(`lib/presentation/timeline-presentation.ts:62`)。
public typealias DurationEvidenceStatus = EvidenceStatus

/// TS `TimelineFillerKind`(`:114`)—— `undefined` は Swift の `nil`。
public enum TimelineFillerKind: String, Sendable, CaseIterable {
  case lunch, dinner, micro
}

/// TS `ActivityFlag["className"]`(`:123`)。CSS のクラス名そのものなので値は TS のまま。
public enum ActivityFlagClass: String, Sendable, CaseIterable {
  case isBooked = "is-booked"
  case isMust = "is-must"
}

/// TS `ActivityFlag`(`:123`)。
public struct ActivityFlag: Equatable, Sendable {
  public var className: ActivityFlagClass
  public var label: String

  public init(className: ActivityFlagClass, label: String) {
    self.className = className
    self.label = label
  }
}

/// TS `TransitStepSummary`(`lib/google-routes.ts:22-34`)のうち、乗車の行が読むフィールドだけ。
/// 提供元との通信は Kit の外にあるので、ここは表示側が受け取る形だけを持つ。
public struct TransitStepSummary: Equatable, Sendable, Codable {
  public var lineName: String
  public var headsign: String?
  public var departureStop: String?
  public var arrivalStop: String?
  public var departureTime: String?
  public var shortName: String?
  public var stopCount: Int?

  public init(
    lineName: String,
    headsign: String? = nil,
    departureStop: String? = nil,
    arrivalStop: String? = nil,
    departureTime: String? = nil,
    shortName: String? = nil,
    stopCount: Int? = nil
  ) {
    self.lineName = lineName
    self.headsign = headsign
    self.departureStop = departureStop
    self.arrivalStop = arrivalStop
    self.departureTime = departureTime
    self.shortName = shortName
    self.stopCount = stopCount
  }
}

/// TS `TransitLegBoarding`(`lib/planner-app-state.ts:27-31`)。
public struct TransitLegBoarding: Equatable, Sendable, Codable {
  public var steps: [TransitStepSummary]
  public var walkToStopMinutes: Int?
  public var walkFromStopMinutes: Int?

  public init(steps: [TransitStepSummary], walkToStopMinutes: Int?, walkFromStopMinutes: Int?) {
    self.steps = steps
    self.walkToStopMinutes = walkToStopMinutes
    self.walkFromStopMinutes = walkFromStopMinutes
  }
}

public enum TimelinePresentation {

  /// TS `transportModeLabel`(`:17-21`)—— 車志向のときはタクシーを「車」と呼ぶ。手段が
  /// 分からないときは、その志向の既定の乗り物に落とす。
  public static func transportModeLabel(
    _ mode: TransportMode?,
    travelPreference: TravelPreference,
    locale: PlannerLocale
  ) -> String {
    let text = Copy.for(locale)
    if mode == .taxi, travelPreference == .car { return text.moveCar }
    if let mode { return text.move[mode] }
    return travelPreference == .car ? text.moveCar : text.move.transit
  }

  /// 区間カードの見出し —— `app/components/planner/timeline/MovementCard.tsx:56-63` の組み立て。
  ///
  /// TS ではこの 1 行は JSX の中で組まれていて `lib/` に関数が無い。Swift 側は同じ画面を
  /// 別の言語で書くので、組み立てをここへ持ち上げる(TS のバイトはそのまま)。
  ///
  /// 「約」はここには**現れない** —— 推定でも実測でも同じ書き方をする。時間が推定である
  /// ことは `ui.estimated`(「所要時間は目安です」)が別の場所で言う。
  public static func legHeadline(
    mode: TransportMode,
    minutes: Int,
    transferCount: Int?,
    travelPreference: TravelPreference,
    locale: PlannerLocale
  ) -> String {
    let text = Copy.for(locale)
    let head = "\(transportModeLabel(mode, travelPreference: travelPreference, locale: locale)) \(text.minutes(minutes))"
    guard mode == .transit, let transferCount else { return head }
    return locale == .ja
      ? "\(head)・乗換\(transferCount)回"
      : "\(head) · \(transferCount) transfer\(transferCount == 1 ? "" : "s")"
  }

  /// TS `dayTabDensityLabel`(`:24-28`)。
  public static func dayTabDensityLabel(stopCount: Int, locale: PlannerLocale) -> String {
    if stopCount == 0 { return locale == .ja ? "予定なし" : "empty" }
    if stopCount <= 2 { return locale == .ja ? "ゆったり" : "easy" }
    return locale == .ja ? "\(stopCount)か所" : "\(stopCount) stops"
  }

  /// TS `dayTabTitle`(`:30-32`)。
  public static func dayTabTitle(index: Int, locale: PlannerLocale) -> String {
    locale == .ja ? "\(index + 1)日目" : "Day \(index + 1)"
  }

  /// TS `dayHeaderSummary`(`:40-49`)。
  ///
  /// Copy Deck plan.day.summary / TC-032:日の見出しが持つ数字はちょうど 2 つ —— 場所の数と
  /// 余裕(ja 「4か所・余裕1時間30分」/ en "4 stops · 1h 30m buffer")。時計の範囲と残りの
  /// 合計は日の設定の開閉部にいる。場所が無い日と余裕が正でない日(判定不明、または満杯)は
  /// 数だけを出す —— 0 の余裕を主張しない。
  public static func dayHeaderSummary(stopCount: Int, slackMinutes: Int, locale: PlannerLocale) -> String {
    let stops = locale == .ja ? "\(stopCount)か所" : "\(stopCount) stop\(stopCount == 1 ? "" : "s")"
    if stopCount == 0 || slackMinutes <= 0 { return stops }
    let buffer = TripPresentation.formatDuration(minutes: slackMinutes, locale: locale)
    return locale == .ja ? "\(stops)・余裕\(buffer)" : "\(stops) · \(buffer) buffer"
  }

  /// 組み上がった日と、その日の適合結果から見出しを作る便利形。TS は呼び出し側が
  /// `DayPresentation`(`lib/day-presentation.ts`)からこの 2 つを取り出して渡す。
  public static func dayHeaderSummary(day: BuiltPlanDay, fit: TripFitDay?, locale: PlannerLocale) -> String {
    dayHeaderSummary(stopCount: day.stops.count, slackMinutes: fit?.slackMinutes ?? 0, locale: locale)
  }

  /// TS `dayDateLabel`(`:52-60`)—— 旅行者が日付を入れるまでは日のラベルのまま。
  public static func dayDateLabel(
    date: String?,
    label: String,
    weekdayLabel: String?,
    tripDateTouched: Bool,
    locale: PlannerLocale
  ) -> String {
    guard tripDateTouched, let date, !date.isEmpty else { return label }
    return locale == .ja ? "\(date)（\(weekdayLabel ?? "")）" : "\(date) (\(weekdayLabel ?? ""))"
  }

  /// TS `durationSourceLabel`(`:66-70`)。UI/UX v3.1 §2.1 はこの 1 つの印を、タイムラインでは
  /// なく停留所シートの根拠開閉部に置く。
  public static func durationSourceLabel(_ status: DurationEvidenceStatus, locale: PlannerLocale) -> String {
    if status == .user_provided { return locale == .ja ? "指定" : "set" }
    if status == .verified { return locale == .ja ? "確認" : "confirmed" }
    return locale == .ja ? "推定" : "estimated"
  }

  /// TS `stayLine`(`:86-92`)。
  ///
  /// UI/UX v3.1 §2.2:数字の横にいた 推定/確認/指定 のバッジを外す代わりに、不確かさを
  /// **名詞へ移す** —— 見積もりは「滞在の目安」、旅行者が決めた/提供元が確認した長さは
  /// ただの「滞在」。この 2 つは一緒に出荷されるか、どちらも出ないかのどちらかで、バッジだけ
  /// 落とすと推測が主張に化ける。それはこの製品が絶対にやってはいけないことの 1 つ。
  public static func stayLine(minutes: Int, status: DurationEvidenceStatus, locale: PlannerLocale) -> String {
    let duration = TripPresentation.formatDuration(minutes: minutes, locale: locale)
    if status == .user_provided || status == .verified {
      return locale == .ja ? "滞在 \(duration)" : "Stay \(duration)"
    }
    return locale == .ja ? "滞在の目安 \(duration)" : "Stay about \(duration)"
  }

  /// TS `stayBasisLine`(`:96-106`)—— タイムラインが数を言い、こちらが誰が決めたかを言う。
  public static func stayBasisLine(_ status: DurationEvidenceStatus, locale: PlannerLocale) -> String {
    if status == .user_provided {
      return locale == .ja ? "滞在時間はあなたが指定した値です。" : "You set this stay length."
    }
    if status == .verified {
      return locale == .ja ? "滞在時間は確認できた値です。" : "This stay length is confirmed."
    }
    return locale == .ja
      ? "滞在時間はTripCheckの目安です。過ごし方に合わせて変えられます。"
      : "This stay length is a TripCheck estimate. Change it to match how you will spend the visit."
  }

  /// TS `evidenceDisclosureLabel`(`:110-112`)。
  public static func evidenceDisclosureLabel(_ locale: PlannerLocale) -> String {
    locale == .ja ? "営業時間・根拠を見る" : "Opening hours and evidence"
  }

  /// TS `fillerRowLabel`(`:117-121`)。
  public static func fillerRowLabel(_ fillerKind: TimelineFillerKind?, locale: PlannerLocale) -> String {
    if fillerKind == .lunch { return locale == .ja ? "昼食のおすすめ" : "Lunch recommendation" }
    if fillerKind == .dinner { return locale == .ja ? "夕食のおすすめ" : "Dinner recommendation" }
    return locale == .ja ? "おすすめ" : "Recommended"
  }

  /// TS `activityFlags`(`:127-140`)—— 停留所の行に出る状態の旗。遅れが固定時刻に勝ち、
  /// 固定時刻が必須バッジに勝つ。営業のトラブルは 2 本目の旗として別に立つ。
  ///
  /// TS は `BuiltPlanStop` の `Pick` を受けるが、Swift は構造的部分型を書けないので、その 4 つを
  /// そのまま引数にする(`BuiltPlanStop` を渡す形も下に置く)。
  public static func activityFlags(
    reservationLateMinutes: Int,
    fixedTime: String?,
    priority: StopPriority,
    openingStatus: OpeningStatus,
    locale: PlannerLocale
  ) -> [ActivityFlag] {
    let text = Copy.for(locale)
    var flags: [ActivityFlag] = []
    if reservationLateMinutes > 0 {
      flags.append(ActivityFlag(className: .isBooked, label: text.lateShort(reservationLateMinutes)))
    } else if let fixedTime, !fixedTime.isEmpty {
      flags.append(ActivityFlag(className: .isBooked, label: fixedTime))
    } else if priority == .must {
      flags.append(ActivityFlag(className: .isMust, label: text.must))
    }
    if openingStatus == .conflict {
      flags.append(ActivityFlag(className: .isBooked, label: text.openingConflict))
    } else if openingStatus == .closed_day {
      flags.append(ActivityFlag(className: .isBooked, label: text.openingClosedDay))
    } else if openingStatus == .last_entry_conflict {
      flags.append(ActivityFlag(className: .isBooked, label: locale == .ja ? "最終入場後" : "after last entry"))
    }
    return flags
  }

  public static func activityFlags(_ stop: BuiltPlanStop, locale: PlannerLocale) -> [ActivityFlag] {
    activityFlags(
      reservationLateMinutes: stop.reservationLateMinutes,
      fixedTime: stop.fixedTime,
      priority: stop.priority,
      openingStatus: stop.openingStatus,
      locale: locale
    )
  }

  /// TS `mealSlotsAfterStop`(`:145-165`)—— どの食事枠がどの停留所の後ろに出るか。枠の表示時刻を
  /// 過ぎていない最後の停留所がその行を持つ。時刻が読めない枠は最後の停留所につく。並びは
  /// 時刻順、同時刻なら昼が先。
  ///
  /// TS は停留所の `Pick<…, "arrival">` を受けるので、Swift は到着時刻の配列を受ける。
  public static func mealSlotsAfterStop(
    _ daySlots: [FoodRecommendationSlot],
    arrivals: [String],
    stopIndex: Int
  ) -> [FoodRecommendationSlot] {
    let filtered = daySlots.filter { slot in
      guard let slotMinutes = ClockTime(slot.displayTime)?.minutes else {
        return stopIndex == arrivals.count - 1
      }
      var insertAfter = 0
      for (index, candidate) in arrivals.enumerated() {
        if let arrival = ClockTime(candidate)?.minutes, arrival <= slotMinutes { insertAfter = index }
      }
      return insertAfter == stopIndex
    }
    // TS `Array.prototype.sort` は安定。`stableSorted` が同じ順を保つ。
    return stableSorted(filtered) { left, right in
      let leftMinutes = ClockTime(left.displayTime)?.minutes ?? 0
      let rightMinutes = ClockTime(right.displayTime)?.minutes ?? 0
      if leftMinutes != rightMinutes { return leftMinutes < rightMinutes }
      if left.kind == right.kind { return false }
      return left.kind == .lunch
    }
  }

  /// TS `transitBoardingText`(`:169-197`)—— 公共交通の区間に付く「これに乗る」の 1 行。
  /// 使える経路情報が無ければ `nil`。取得済みの証拠から文字を組むだけで、判断はしない。
  public static func transitBoardingText(_ boarding: TransitLegBoarding?, locale: PlannerLocale) -> String? {
    guard let boarding, let first = boarding.steps.first, let last = boarding.steps.last else { return nil }
    let lineLabel = [
      first.shortName ?? first.lineName,
      presentValue(first.headsign).map { locale == .ja ? "\($0)行き" : "toward \($0)" },
    ].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: locale == .ja ? "・" : " ")
    let extra = boarding.steps.count - 1
    let walkTo = boarding.walkToStopMinutes
    let walkFrom = boarding.walkFromStopMinutes
    var parts: [String] = []
    if locale == .ja {
      if let walkTo, walkTo > 0, isPresent(first.departureStop) { parts.append("徒歩約\(walkTo)分 →") }
      if let departureStop = presentValue(first.departureStop) {
        let time = presentValue(first.departureTime).map { "\($0)発" } ?? ""
        parts.append("\(departureStop) \(time)".trimmingCharacters(in: .whitespaces))
      }
      parts.append(isPresent(first.departureStop)
        ? lineLabel
        : "\(lineLabel)\(presentValue(first.departureTime).map { " · \($0)発" } ?? "")")
      if extra > 0 { parts.append("乗継ぎ\(extra)本") }
      if let arrivalStop = presentValue(last.arrivalStop) {
        let stops = extra == 0 ? (first.stopCount.flatMap { $0 == 0 ? nil : "(\($0)駅)" } ?? "") : ""
        parts.append("→ \(arrivalStop)\(stops)")
      }
      if let walkFrom, walkFrom > 0, isPresent(last.arrivalStop) { parts.append("→ 徒歩約\(walkFrom)分") }
    } else {
      if let walkTo, walkTo > 0, isPresent(first.departureStop) { parts.append("~\(walkTo) min walk →") }
      if let departureStop = presentValue(first.departureStop) {
        parts.append("\(departureStop)\(presentValue(first.departureTime).map { " dep \($0)" } ?? "")")
      }
      parts.append(isPresent(first.departureStop)
        ? lineLabel
        : "\(lineLabel)\(presentValue(first.departureTime).map { " · dep \($0)" } ?? "")")
      if extra > 0 { parts.append("+\(extra) connection\(extra == 1 ? "" : "s")") }
      if let arrivalStop = presentValue(last.arrivalStop) {
        let stops = extra == 0 ? (first.stopCount.flatMap { $0 == 0 ? nil : " (\($0) stops)" } ?? "") : ""
        parts.append("→ \(arrivalStop)\(stops)")
      }
      if let walkFrom, walkFrom > 0, isPresent(last.arrivalStop) { parts.append("→ ~\(walkFrom) min walk") }
    }
    return parts.joined(separator: " ")
  }

  /// TS `spareCapacityLine`(`lib/presentation/recommendation-presentation.ts:256-271`)。
  ///
  /// 適合の判定はずっと「この願いは 4 日ではなく 3 日で足りる」と言えていた。これまではそこで
  /// 文が終わっていて、製品の返事はカフェ 1 軒だった。これはもう半分 —— その日がどれだけ空いて
  /// いて、あと何か所まで入るかを日の側が言う。`remaining` は許容量から採用済みを引いた数なので、
  /// 日が埋まるにつれ数が減り、満杯になったら誘うのをやめる。
  ///
  /// `recommendation-presentation.ts` 本体は次の課題の担当。この 1 本だけブリーフの Interfaces に
  /// あるので先に移す。
  public static func spareCapacityLine(slackMinutes: Int, remaining: Int, locale: PlannerLocale) -> String {
    let free = TripPresentation.formatDuration(minutes: max(0, slackMinutes), locale: locale)
    if remaining <= 0 {
      return locale == .ja
        ? "この日に足せるおすすめは埋まりました。"
        : "This day has taken all the suggestions it has room for."
    }
    if locale == .ja { return "この日は\(free)空いています。あと\(remaining)か所まで足せます。" }
    return "\(free) of this day is free — room for \(remaining) more \(remaining == 1 ? "stop" : "stops")."
  }

  /// JS の真偽 —— 空文字は falsy。TS の `transitBoardingText` は `departureStop`・`shortName`
  /// だけでなく `headsign`・`departureTime` も `?` で見ている(`:174-175`、`:183-184`、
  /// `:190-191`)ので、4 つとも同じ規則で「空文字は無い」と扱う —— そうしないと `headsign: ""`
  /// が `JC・行き`、`departureTime: ""` が `新宿 発` になる。
  private static func isPresent(_ value: String?) -> Bool { !(value ?? "").isEmpty }

  private static func presentValue(_ value: String?) -> String? {
    guard let value, !value.isEmpty else { return nil }
    return value
  }
}
