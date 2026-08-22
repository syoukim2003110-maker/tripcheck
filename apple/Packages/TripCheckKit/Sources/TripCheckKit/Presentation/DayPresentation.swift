import Foundation

/*
 * 組み上がった 1 日の「時間の見せ方」の唯一の出どころ(v1.1 仕様 §4.1 / TC-001)。
 *
 * 日の時計の範囲と、使った/空いている分の表示は、生の断片から数え直さずに全部このモデルを
 * 読む —— 見出し・要約・印刷・タイムラインが食い違えないようにするため。下の数が互いに
 * 矛盾しているときはモデルが `consistency: .invalid` と診断 id を返し、呼び出し側は矛盾した
 * 時刻を普通の旅程として見せる代わりに代替表示を出す。
 *
 * 移植元:`lib/day-presentation.ts:1-150` と `lib/planner-day-time-bar.ts:140-227` の
 * **数の部分だけ**。帯の割合(`segments`)・マーカー・読み上げラベルは画面の持ち物で、この課題
 * (提示の文言)の範囲外なので、UI モデルの課題に残してある。
 */

/// TS `PlannerDayTimeBarDay = Pick<BuiltPlanDay, …>`(`lib/planner-day-time-bar.ts:6-14`)。
/// Swift は構造的部分型を書けないので、その 6 つを持つ小さな型にする。
public struct DayTimeBarInput: Equatable, Sendable {
  /// TS `day.stops[number]` のうち、時間の計算が読む 2 つ。
  public struct Stop: Equatable, Sendable {
    public var arrival: String
    public var departure: String

    public init(arrival: String, departure: String) {
      self.arrival = arrival
      self.departure = departure
    }
  }

  public var startTime: String
  public var finishTime: String
  public var stops: [Stop]
  /// TS `day.legs[].comparison.recommended.minutes`。
  public var legMinutes: [Int]
  public var hotelTravelMinutes: Int?

  public init(
    startTime: String,
    finishTime: String,
    stops: [Stop],
    legMinutes: [Int] = [],
    hotelTravelMinutes: Int? = nil
  ) {
    self.startTime = startTime
    self.finishTime = finishTime
    self.stops = stops
    self.legMinutes = legMinutes
    self.hotelTravelMinutes = hotelTravelMinutes
  }

  public init(_ day: BuiltPlanDay) {
    self.init(
      startTime: day.startTime,
      finishTime: day.finishTime,
      stops: day.stops.map { Stop(arrival: $0.arrival, departure: $0.departure) },
      legMinutes: day.legs.map(\.comparison.recommended.minutes),
      hotelTravelMinutes: day.hotelTravelMinutes
    )
  }
}

/// TS `PlannerDayTimeBarFit = Pick<TripFitDay, "availableMinutes" | "slackMinutes">`
/// (`lib/planner-day-time-bar.ts:16-19`)。
public struct DayTimeBarFit: Equatable, Sendable {
  public var availableMinutes: Int
  public var slackMinutes: Int

  public init(availableMinutes: Int, slackMinutes: Int) {
    self.availableMinutes = availableMinutes
    self.slackMinutes = slackMinutes
  }

  public init(_ fitDay: TripFitDay) {
    self.init(availableMinutes: fitDay.availableMinutes, slackMinutes: fitDay.slackMinutes)
  }
}

/// TS `PlannerDayTimeBarModel`(`lib/planner-day-time-bar.ts:36-47`)の数の部分。
public struct DayTimeBarNumbers: Equatable, Sendable {
  public var availableMinutes: Int
  public var plannedMinutes: Int
  public var visitMinutes: Int
  public var travelMinutes: Int
  public var slackMinutes: Int
  public var overrunMinutes: Int
  public var isEmpty: Bool
}

/// TS `DayPresentationIssue`(`lib/day-presentation.ts:37-41`)。
public enum DayPresentationIssue: String, Sendable, CaseIterable {
  case zero_span_with_stops
  case used_exceeds_available_without_overrun
  case timeline_ends_after_header
  case invalid_clock
}

/// TS `DayPresentation`(`lib/day-presentation.ts:17-35`)。
public struct DayPresentation: Equatable, Sendable {
  public enum Consistency: String, Sendable {
    case valid, invalid
  }

  public var startClock: String
  public var endClock: String
  /// 最後の停留所の出発時刻。無ければ見出しの終了時刻。
  public var finalTimelineClock: String
  public var usedMinutes: Int
  public var availableMinutes: Int
  public var travelMinutes: Int
  public var visitMinutes: Int
  public var slackMinutes: Int
  public var overrunMinutes: Int
  public var stopCount: Int
  public var isEmpty: Bool
  public var consistency: Consistency
  /// 「無効」の裏にある、機械で読める安定した理由コード。
  public var issues: [DayPresentationIssue]
  /// ログと利用者向けの代替カードに出す短い id。
  public var diagnosticId: String?
}

/// TS `dayPresentationFallbackCopy` の戻り値(`lib/day-presentation.ts:141-149`)。
public struct DayPresentationFallbackCopy: Equatable, Sendable {
  public var title: String
  public var body: String
}

public enum DayPresentationBuilder {

  static let minutesPerDay = 24 * 60
  static let maxVisitMinutes = 12 * 60

  static func clamp(_ value: Int, _ minimum: Int, _ maximum: Int) -> Int {
    min(maximum, max(minimum, value))
  }

  /// TS `safeMinutes`(`lib/planner-day-time-bar.ts:61-64`)—— 0 以下は 0。
  static func safeMinutes(_ value: Int?, maximum: Int = minutesPerDay) -> Int {
    guard let value, value > 0 else { return 0 }
    return clamp(value, 0, maximum)
  }

  /// TS `safeSignedMinutes`(`:66-69`)。
  static func safeSignedMinutes(_ value: Int?) -> Int {
    guard let value else { return 0 }
    return clamp(value, -minutesPerDay, minutesPerDay)
  }

  /// TS `clockMinutes`(`lib/day-presentation.ts:46-54`)—— 時も分も 2 桁必須。
  static func clockMinutes(_ value: String?) -> Int? {
    guard let value, value.count == 5, Array(value)[2] == ":" else { return nil }
    return ClockTime(value)?.minutes
  }

  /// TS `clockSpan`(`lib/planner-day-time-bar.ts:82-90`)—— 日跨ぎを許し、12 時間で頭打ち。
  static func clockSpan(_ start: String?, _ end: String?) -> Int {
    guard let startMinutes = clockMinutes(start), let endMinutes = clockMinutes(end), startMinutes != endMinutes else {
      return 0
    }
    let difference = endMinutes >= startMinutes
      ? endMinutes - startMinutes
      : minutesPerDay - startMinutes + endMinutes
    return clamp(difference, 0, maxVisitMinutes)
  }

  /// TS `forwardSpan`(`lib/day-presentation.ts:56-58`)。
  static func forwardSpan(_ start: Int, _ end: Int) -> Int {
    end >= start ? end - start : minutesPerDay - start + end
  }

  /// TS `buildPlannerDayTimeBarModel`(`lib/planner-day-time-bar.ts:137-227`)の数の部分。
  ///
  /// 適合の窓が空き/超過の権威で、停留所の時計と区間が訪問/移動の持ち主。明示された区間と
  /// エンジンの計画時間の間に差が出るのは、エンジンが乗換の余白も含めるから。その残りは
  /// 移動に寄せる —— 訪問時間を勝手に増やさずに、使える窓全体を表すため。
  public static func numbers(_ day: DayTimeBarInput, fit: DayTimeBarFit?) -> DayTimeBarNumbers {
    let visitMinutes = clamp(
      day.stops.reduce(0) { $0 + clockSpan($1.arrival, $1.departure) },
      0,
      minutesPerDay
    )
    let explicitTravelMinutes = clamp(
      day.legMinutes.reduce(0) { $0 + safeMinutes($1) } + safeMinutes(day.hotelTravelMinutes),
      0,
      minutesPerDay
    )
    let availableMinutes = safeMinutes(fit?.availableMinutes)
    let signedSlackMinutes = safeSignedMinutes(fit?.slackMinutes)
    let slackMinutes = availableMinutes > 0
      ? clamp(max(0, signedSlackMinutes), 0, availableMinutes)
      : max(0, signedSlackMinutes)
    let overrunMinutes = max(0, -signedSlackMinutes)
    // available − slack がエンジンの計画時間。個々の区間に現れない経路の余白も含む。
    let fitPlannedMinutes = availableMinutes > 0 ? max(0, availableMinutes - signedSlackMinutes) : 0
    let travelMinutes = clamp(max(explicitTravelMinutes, fitPlannedMinutes - visitMinutes), 0, minutesPerDay)
    let plannedMinutes = clamp(visitMinutes + travelMinutes, 0, minutesPerDay)
    return DayTimeBarNumbers(
      availableMinutes: availableMinutes,
      plannedMinutes: plannedMinutes,
      visitMinutes: visitMinutes,
      travelMinutes: travelMinutes,
      slackMinutes: slackMinutes,
      overrunMinutes: overrunMinutes,
      isEmpty: visitMinutes + travelMinutes + slackMinutes == 0
    )
  }

  /// TS `buildDayPresentation`(`lib/day-presentation.ts:60-134`)。
  public static func build(_ day: DayTimeBarInput, fit: DayTimeBarFit?, dayIndex: Int = 0) -> DayPresentation {
    let model = numbers(day, fit: fit)
    var issues: [DayPresentationIssue] = []

    let startClock = day.startTime
    let endClock = day.finishTime
    let finalTimelineClock = day.stops.last?.departure ?? endClock

    let startMinutes = clockMinutes(startClock)
    let endMinutes = clockMinutes(endClock)
    let finalMinutes = clockMinutes(finalTimelineClock)

    if startMinutes == nil || endMinutes == nil { issues.append(.invalid_clock) }

    // SHOT-P0-01:訪問を並べておきながら 09:00–09:00 と言う日。
    if !day.stops.isEmpty, let startMinutes, let endMinutes, forwardSpan(startMinutes, endMinutes) == 0 {
      issues.append(.zero_span_with_stops)
    }

    // 窓より使った時間が大きいのに、まだ余りがあると言っている。
    if model.availableMinutes > 0, model.plannedMinutes > model.availableMinutes, model.overrunMinutes == 0 {
      issues.append(.used_exceeds_available_without_overrun)
    }

    // 見えているタイムラインが、掲げた終了時刻を過ぎて続いてはいけない —— 日がまだ「収まって
    // いる」と言っている間は。宣言された超過は矛盾ではない(長引くと認めている)ので、黙った
    // 食い違いだけを拾う。
    if let startMinutes, let endMinutes, let finalMinutes,
       !day.stops.isEmpty,
       model.overrunMinutes == 0,
       forwardSpan(startMinutes, finalMinutes) > forwardSpan(startMinutes, endMinutes) {
      issues.append(.timeline_ends_after_header)
    }

    let consistency: DayPresentation.Consistency = issues.isEmpty ? .valid : .invalid
    let dayNumber = dayIndex + 1
    let diagnosticId = consistency == .valid
      ? nil
      : "TC-TIME-D\(dayNumber)-" + issues
        .map { issue in issue.rawValue.split(separator: "_").compactMap { $0.first }.map(String.init).joined().uppercased() }
        .joined(separator: ".")

    return DayPresentation(
      startClock: startClock,
      endClock: endClock,
      finalTimelineClock: finalTimelineClock,
      usedMinutes: model.plannedMinutes,
      availableMinutes: model.availableMinutes,
      travelMinutes: model.travelMinutes,
      visitMinutes: model.visitMinutes,
      slackMinutes: model.slackMinutes,
      overrunMinutes: model.overrunMinutes,
      stopCount: day.stops.count,
      isEmpty: model.isEmpty,
      consistency: consistency,
      issues: issues,
      diagnosticId: diagnosticId
    )
  }

  /// TS `dayPresentationFallbackCopy`(`lib/day-presentation.ts:136-150`)。
  public static func fallbackCopy(_ presentation: DayPresentation, locale: PlannerLocale) -> DayPresentationFallbackCopy {
    let id = presentation.diagnosticId ?? "TC-TIME"
    return locale == .ja
      ? DayPresentationFallbackCopy(
        title: "この日の時刻表示に内部矛盾があります",
        body: "矛盾した時刻をそのまま表示しないため、この日の時間表示を止めています。予定の内容と地図は引き続き使えます。診断ID: \(id)"
      )
      : DayPresentationFallbackCopy(
        title: "This day's times are internally inconsistent",
        body: "The time display for this day is withheld instead of showing contradictory numbers. The stops and map remain usable. Diagnostic id: \(id)"
      )
  }
}

extension TimelinePresentation {
  /// TS `dayHeaderSummary(presentation, locale)`(`lib/presentation/timeline-presentation.ts:40-49`)——
  /// 日の見出しは `DayPresentation` の 2 つの数だけを読む。
  public static func dayHeaderSummary(_ presentation: DayPresentation, locale: PlannerLocale) -> String {
    dayHeaderSummary(stopCount: presentation.stopCount, slackMinutes: presentation.slackMinutes, locale: locale)
  }
}
