import Foundation
import TripCheckKit

/*
 * 紙に落とす 1 枚 —— 全日程・全停留所・全時刻。
 *
 * 画面の導出値(`PlannerStore+ViewModel.swift` / `+Timeline.swift`)と**別のファイル**に
 * 置いてあるのは、紙と画面で読み手の事情が違うからである。画面は「いま見ている 1 日」を出し、
 * 続きは指で辿れる。紙にはその指が無い:1 枚に全部載っていなければ、電池の切れた端末の
 * 代わりにならない。だから日を選ぶ関数も、折り畳みも、地図もここには無く、`printModel` は
 * **旅程の全部**を 1 つの値で返す。
 *
 * それでも**文は 1 つも新しく作らない**。結論は `VerdictCopy.hero`、前提は
 * `VerdictCopy.assumptionCopy`、衝突は `VerdictCopy.conflictCopy`、滞在は
 * `TimelinePresentation.stayLine`、地域の対応は `CoverageProfile` —— 画面が読むのと同じ
 * 関数を同じ引数で呼ぶ。紙が自分で言い換えると、印刷した旅程と画面の旅程が違うことを言う
 * 1 枚ができ、それは手元に残るほうが正しく見えてしまう。
 */

/// 印刷・PDF の 1 枚ぶん。**ビューはこれだけを読む** —— `TripPrintSheet` は
/// `ImageRenderer` が画面の外で描くので、`PlannerStore` も環境も見えない(見えない場所で
/// 値を引こうとすると、白紙が刷れる)。
public struct PrintModel: Equatable, Sendable {

  /// 停留所 1 件。時刻は**到着と出発の両方**を出す —— 到着だけの表は、次の場所へ何時に
  /// 出ればよいのかを紙の上で答えられない。
  public struct Row: Equatable, Sendable {
    /// 「09:00–10:30」。紙は幅の 1 か所でこれを読む。
    public var time: String
    public var name: String
    /// 住所。決まっていなければ地区名(`TripPresentation.resolvedStopAddress`)。
    public var address: String
    /// 「滞在の目安 1時間30分」。**画面のタイムラインと同じ 1 文**。
    public var stay: String
    public var arrival: String
    public var departure: String

    public init(time: String, name: String, address: String, stay: String, arrival: String, departure: String) {
      self.time = time
      self.name = name
      self.address = address
      self.stay = stay
      self.arrival = arrival
      self.departure = departure
    }
  }

  /// 1 日ぶん。
  public struct Day: Equatable, Sendable {
    /// 「1日目」。
    public var label: String
    /// 「2026-08-24（月）」。日付を入れていない旅では**空** —— 決めていない日付を紙の上で
    /// 名乗らない。
    public var date: String
    public var rows: [Row]

    public init(label: String, date: String, rows: [Row]) {
      self.label = label
      self.date = date
      self.rows = rows
    }
  }

  /// 旅の題。端末に残る記録・共有の件名と**同じ 1 つ**(先頭 3 か所の名前)。
  public var title: String
  /// 結論の 1 文(`VerdictCopy.hero`)。画面の見出しと同じ文。
  public var verdict: String
  public var assumptions: [String]
  /// 「スイス — 経路・地点・…は別途確認してください。」
  public var coverage: String
  public var conflicts: [String]
  /// フライトの条件と、その分数が誰の見立てかの但し書き。空港を入れていない旅では**空**。
  public var airportNotes: [String]
  public var days: [Day]
  /// 祝日。鍵ゼロのアプリには祝日の出どころが無いので**常に空**(R10 と同じ理由:
  /// 「祝日ではない」と読める印を置かない)。欄そのものを残してあるのは、出どころが
  /// 入る日にこの 1 か所を埋めれば紙が変わるようにするため。
  public var holidays: [String]

  public init(
    title: String,
    verdict: String,
    assumptions: [String],
    coverage: String,
    conflicts: [String],
    airportNotes: [String],
    days: [Day],
    holidays: [String]
  ) {
    self.title = title
    self.verdict = verdict
    self.assumptions = assumptions
    self.coverage = coverage
    self.conflicts = conflicts
    self.airportNotes = airportNotes
    self.days = days
    self.holidays = holidays
  }
}

extension PlannerStore {

  /// 印刷・PDF が読む 1 つの値。
  ///
  /// **まだ組んでいない旅は題だけを返す。** 空の日付表を刷ると、旅程が空だという意味に
  /// 読める —— 何も無いことと、まだ組んでいないことは別の話である。
  public var printModel: PrintModel {
    let locale = request.locale
    guard let bundle else {
      return PrintModel(
        title: persistedTitle,
        verdict: "",
        assumptions: [],
        coverage: "",
        conflicts: [],
        airportNotes: [],
        days: [],
        holidays: []
      )
    }
    let plan = bundle.plan
    let result = bundle.result
    // 物証は 1 度だけ引く(タイムラインと同じ表)—— 行ごとに全件を舐めると、停留所が
    // 増えるほど二乗で遅くなる。
    let stayStatus = durationEvidenceByStopId()
    let addresses = resolvedAddressesByStopId()

    return PrintModel(
      title: persistedTitle,
      verdict: hero.text,
      assumptions: result.assumptions.map { VerdictCopy.assumptionCopy($0, locale: locale) },
      coverage: Self.coverageLine(destination: plan.destination, locale: locale),
      conflicts: result.conflicts.map { VerdictCopy.conflictCopy($0, locale: locale) },
      airportNotes: airportNotes(plan, locale: locale),
      days: plan.days.enumerated().map { index, day in
        PrintModel.Day(
          label: TimelinePresentation.dayTabTitle(index: index, locale: locale),
          // `label:` に空を渡すのは、日付が無い日の**日付欄を空にする**ため。日の名前は
          // 見出し(`label`)が別に名乗るので、ここで「1日目」に落ちると同じ語が 2 度並ぶ。
          date: TimelinePresentation.dayDateLabel(
            date: day.date,
            label: "",
            weekdayLabel: TripPresentation.weekdayInfo(day.date, locale: locale)?.label,
            tripDateTouched: request.tripStartDate != nil,
            locale: locale
          ),
          rows: day.stops.map { built in
            PrintModel.Row(
              time: "\(built.arrival)–\(built.departure)",
              name: built.stop.name,
              address: addresses[built.stop.id] ?? TripPresentation.resolvedStopAddress(built.stop),
              stay: TimelinePresentation.stayLine(
                minutes: built.stop.planningDurationMinutes,
                status: stayStatus[built.stop.id] ?? .estimated,
                locale: locale
              ),
              arrival: built.arrival,
              departure: built.departure
            )
          }
        )
      },
      // 祝日の出どころがまだ無い(`PrintModel.holidays` の注記)。
      holidays: []
    )
  }

  // MARK: - 内部

  /// 地域の対応を 1 行に。名前だけでは紙の上で何も言っていないので、`CoverageProfile` が
  /// 持つ公開文(何が確かめてあって何が確かめていないか)まで出す。
  private static func coverageLine(destination: DestinationId, locale: PlannerLocale) -> String {
    let profile = CoverageProfile.forLocation(destination: destination)
    let label = profile.label[locale] ?? profile.label[.en] ?? ""
    let copy = CoverageProfile.publicCopy(profile, locale: locale)
    return label.isEmpty ? copy : "\(label) — \(copy)"
  }

  /// フライトの条件。**組み上がった旅程が実際に使った制約**(`plan.airportConstraints`)から
  /// 出すので、入力欄に残っているだけで効いていない空港は紙に出ない。
  ///
  /// 最後の 1 行は但し書き。空港内と市街地移動の分数は TripCheck の見立てであって空港が
  /// 示した事実ではない —— 画面ではその但し書きが比較の下にあるが、紙は画面より長く
  /// 残るので、数字と同じ紙面に無ければ意味が無い。
  private func airportNotes(_ plan: BuiltTripPlan, locale: PlannerLocale) -> [String] {
    guard !plan.airportConstraints.isEmpty else { return [] }
    let text = Copy.for(locale)
    let app = AppCopy.for(locale)
    let notes = plan.airportConstraints.map { constraint -> String in
      let isArrival = constraint.direction == .arrival
      let heading = isArrival ? text.arrival : text.departure
      let boundary = isArrival ? app.airportArrivalBoundary : app.airportDepartureBoundary
      let breakdown = isArrival
        ? app.airportArrivalBreakdown(
          airportMinutes: constraint.airportMinutes,
          transferMinutes: constraint.transferMinutes
        )
        : app.airportDepartureBreakdown(
          airportMinutes: constraint.airportMinutes,
          transferMinutes: constraint.transferMinutes
        )
      // 境界が別の日に落ちる便は、その日ずれを言う —— 言わないと 23:40 が同じ日の夜に見える。
      let offset = constraint.cityTimeDayOffset > 0
        ? "（\(app.airportNextDay)）"
        : constraint.cityTimeDayOffset < 0 ? "（\(app.airportPreviousDay)）" : ""
      return "\(heading) \(constraint.airport) \(constraint.flightTime) · \(boundary) \(constraint.cityTime)\(offset) · \(breakdown)"
    }
    return notes + [app.airportDisclaimer]
  }

  /// 停留所 id → 住所。旅行者が決めた場所(`entry.pinned`)と、拠点などの追加解決
  /// (`edit.resolvedStops`)が持っている住所を引く。`RouteStop` には住所の欄が無いので、
  /// ここを通らない停留所は地区名で出る(`TripPresentation.resolvedStopAddress`)。
  private func resolvedAddressesByStopId() -> [String: String] {
    var out: [String: String] = [:]
    for stop in request.entries.compactMap({ $0.pinned?.stop }) + edit.resolvedStops {
      let address = TripPresentation.resolvedStopAddress(stop)
      guard !address.isEmpty else { continue }
      out[stop.id] = address
    }
    return out
  }
}
