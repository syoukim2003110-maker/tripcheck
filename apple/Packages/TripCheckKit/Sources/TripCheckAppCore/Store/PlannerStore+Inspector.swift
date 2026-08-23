import Foundation
import TripCheckKit

/*
 * 停留所の詳細シートが読む 1 つの値。
 *
 * `PlannerStore+Edits.swift` の隣に別ファイルで置いてあるのは、あちらが**書く側**の 1 ファイル
 * (関所と 11 の編集)だから。こちらは同じシートの**読む側**で、文も数も全部 Kit から引いて
 * 並べ直すだけ —— 混ぜると、「この行はどこから来たのか」を追うのに 2 種類の話を同時に
 * 読むことになる。
 *
 * ここも文を作らない:滞在の 1 行・その根拠・物証の印は `TimelinePresentation` が持ち主で、
 * 地図の URL は `TripPresentation` が持ち主。この層が決めるのは「どの事実をどの順に見せるか」
 * だけである。
 */

/// 根拠の 1 行。Web の開閉部と同じ 3 つ組(何の事実か・その中身・誰が言っているか)。
public struct EvidenceLine: Identifiable, Equatable, Sendable {
  /// 物証の id そのもの(`place:<stop>` など)。一覧の中で一意。
  public var id: String
  public var label: String
  /// 中身。分からない事実は `AppCopy.evidenceNoValue`(「—」)—— 空欄にしない。
  public var value: String
  /// 「確認」「推定」「指定」(`TimelinePresentation.durationSourceLabel`)と、Kit が言い
  /// 分けない「未確認」(`AppCopy.evidenceStatusUnknown`)。
  public var status: String
}

/// 停留所の詳細シート 1 枚ぶん。
public struct StopInspectorModel: Equatable, Sendable {
  public var stopId: String
  /// その日の何番目か(1 始まり)。ヘッダーの色付きの丸に出る数。
  public var number: Int
  /// いま居る日(0 始まり)。「日を移動」の錠剤がどれを選択中にするか。
  public var dayIndex: Int
  public var name: String
  /// 「1日目 · 10:30 · ツェルマット」。
  public var meta: String
  /// 移動先に選べる日(0 始まり)。1 日しかない旅では錠剤を出さない。
  public var dayOptions: [Int]
  /// 滞在時間の選択肢。先頭の `nil` が「自動」。
  public var stayOptions: [Int?]
  /// いま旅程が使っている滞在時間。**旅行者の指定とは限らない**(自動なら見積もり)。
  public var currentStay: Int
  /// 旅行者自身が決めた滞在時間。決めていなければ `nil` = 自動。`Picker` が選ぶのはこちら。
  public var stayOverride: Int?
  /// 旅行者が決めた最終入場。決めていなければ `nil` —— シートは**時計を出さない**。
  /// 決めていない時刻を数字で見せると、それが決まった条件に読める。
  public var lastEntry: String?
  /// 「最終入場を決める」に倒した瞬間の値。この停留所を出る時刻そのものなので、倒しただけ
  /// では旅程が 1 分も動かない —— そこから前へずらして初めて、指定が効きはじめる。
  public var lastEntryDefault: String
  /// 滞在時間が誰の言い分か。**物証から取る**(`edit` から導かない)。
  public var stayStatus: EvidenceStatus
  /// 「滞在の目安 1時間30分」。
  public var stayHeadline: String
  /// 「滞在時間はTripCheckの目安です。…」。
  public var stayBasisLine: String
  public var evidenceLines: [EvidenceLine]
  public var mapsUrl: URL?
  public var appleMapsUrl: URL?
  /// もう外してある場所は外せない。
  public var canRemove: Bool
}

extension PlannerStore {

  /// 滞在時間として選べる長さ。先頭は「自動」(`nil`)。30 分から 4 時間までは、旅行者が
  /// 実際に言う刻み —— 15 分刻みの `Stepper` は、その場で決めたい人には細かすぎる。
  public static let inspectorStayOptions: [Int?] = [nil, 30, 45, 60, 90, 120, 150, 180, 240]

  /// 停留所 1 つぶんのシート。旅程に載っていない id(外した場所・入り切らなかった場所)は
  /// `nil` —— 開くものが無いシートを開かない。
  public func inspector(for stopId: String) -> StopInspectorModel? {
    guard let bundle,
          let dayIndex = plannedDayIndex(of: stopId),
          let index = bundle.plan.days[dayIndex].stops.firstIndex(where: { $0.stop.id == stopId })
    else { return nil }
    let locale = request.locale
    let built = bundle.plan.days[dayIndex].stops[index]
    let stop = built.stop

    // 滞在時間が誰の言い分かは物証の一覧が唯一の持ち主(Web `useTripDomainModel.tsx:533-539`)。
    // `edit.userStayMinutes` から導くと、指定を入れた直後の**まだ組み直していない**旅程に
    // 「滞在」と書いてしまう(数はまだ前の見積もりのまま)。
    let status = bundle.evidence.facts.first {
      $0.kind == .stay_duration && $0.id == "duration:\(stopId)"
    }?.evidence.status ?? .estimated

    let meta = [TimelinePresentation.dayTabTitle(index: dayIndex, locale: locale), built.arrival, stop.area]
      .filter { !$0.isEmpty }
      .joined(separator: " · ")

    return StopInspectorModel(
      stopId: stopId,
      number: index + 1,
      dayIndex: dayIndex,
      name: stop.name,
      meta: meta,
      dayOptions: Array(0..<bundle.plan.days.count),
      stayOptions: Self.inspectorStayOptions,
      currentStay: stop.planningDurationMinutes,
      stayOverride: edit.userStayMinutes[stopId],
      lastEntry: edit.lastEntryTimes[stopId],
      lastEntryDefault: built.departure,
      stayStatus: status,
      stayHeadline: TimelinePresentation.stayLine(minutes: stop.planningDurationMinutes, status: status, locale: locale),
      stayBasisLine: TimelinePresentation.stayBasisLine(status, locale: locale),
      evidenceLines: evidenceLines(for: stopId, locale: locale),
      // Kit は文字列を返す。組み立てに失敗したらリンクを出さない —— 押しても何も起きない
      // ボタンを置かない。
      mapsUrl: URL(string: TripPresentation.googleMapsSearchUrl(stop)),
      appleMapsUrl: Self.appleMapsUrl(for: stop),
      canRemove: !edit.removedStops.contains { $0.id == stopId }
    )
  }

  // MARK: - 内部

  /// この場所についての事実だけ。4 種のキー(場所そのもの・滞在時間・営業時間・最終入場)を
  /// **物証の一覧の順**のまま拾う —— 並べ直すと、同じシートを 2 回開いて順が違うことがある。
  private func evidenceLines(for stopId: String, locale: PlannerLocale) -> [EvidenceLine] {
    guard let bundle else { return [] }
    return bundle.evidence.facts.filter {
      $0.id == "place:\(stopId)"
        || $0.id == "duration:\(stopId)"
        || $0.id.hasPrefix("hours:\(stopId):")
        || $0.id.hasPrefix("last-entry:\(stopId):")
    }.map { fact in
      EvidenceLine(
        id: fact.id,
        label: Self.evidenceLabel(fact.kind, locale: locale),
        value: Self.evidenceValue(fact, locale: locale),
        status: Self.evidenceStatus(fact.evidence.status, locale: locale)
      )
    }
  }

  /// 行の見出し。**`CriticalFact.label` は使わない** —— 4 種のどれでも場所の名前なので、
  /// そのまま出すと「ツェルマット / ツェルマット」が並び、どちらが何の事実か読めない
  /// (シミュレータで実際にそう出た)。名前はシートの見出しが既に言っている。
  nonisolated static func evidenceLabel(_ kind: CriticalFactKind, locale: PlannerLocale) -> String {
    switch kind {
    case .stay_duration: Copy.for(locale).stayLabel
    case .last_entry: AppCopy.for(locale).lastEntryLabel
    case .opening_hours: AppCopy.for(locale).evidenceHoursLabel
    default: AppCopy.for(locale).evidencePlaceLabel
    }
  }

  /// 行の中身。機械が読む値(分数・`OpeningStatus` の raw value・停留所 id)は、そのまま
  /// 出さずに旅行者の言葉へ直す。
  nonisolated static func evidenceValue(_ fact: CriticalFact, locale: PlannerLocale) -> String {
    let text = Copy.for(locale)
    let app = AppCopy.for(locale)
    switch fact.kind {
    case .stay_duration:
      guard case .number(let minutes)? = fact.evidence.value else { return app.evidenceNoValue }
      return TripPresentation.formatDuration(minutes: Int(minutes), locale: locale)
    case .opening_hours:
      guard case .string(let raw)? = fact.evidence.value, let status = OpeningStatus(rawValue: raw) else {
        return text.hoursUnknown
      }
      switch status {
      case .verified_open: return app.evidenceHoursOpen
      case .closed_day: return text.openingClosedDay
      case .conflict, .last_entry_conflict: return text.openingConflict
      case .unknown: return text.hoursUnknown
      }
    case .last_entry:
      guard case .string(let time)? = fact.evidence.value, !time.isEmpty else { return app.evidenceNoValue }
      return time
    default:
      // 場所そのものの事実。値は内部 id なので出さず、**引き当てた名前**を出す ——
      // 「この名前をこの場所だと読み取った」が、この行の言っていること。
      return fact.label.isEmpty ? app.evidenceNoValue : fact.label
    }
  }

  /// 確かさの 1 語。`unknown` / `failed` を Kit の `durationSourceLabel` に渡すと「推定」に
  /// 落ちる —— 調べていない場所を見積もったことにしてしまうので、そこだけ言い分ける。
  nonisolated static func evidenceStatus(_ status: EvidenceStatus, locale: PlannerLocale) -> String {
    switch status {
    case .unknown, .failed: AppCopy.for(locale).evidenceStatusUnknown
    default: TimelinePresentation.durationSourceLabel(status, locale: locale)
    }
  }

  /// Apple 地図の入口。Kit は Google の URL しか持たない(Web に Apple 地図が無いので)ので、
  /// ここだけはアプリ側が組む。`ll` に座標、`q` に名前 —— 座標だけだと地図が名前を出さず、
  /// 名前だけだと同名の別の場所に飛ぶ。
  nonisolated static func appleMapsUrl(for stop: RouteStop) -> URL? {
    var components = URLComponents()
    components.scheme = "https"
    components.host = "maps.apple.com"
    components.path = "/"
    components.queryItems = [
      URLQueryItem(name: "ll", value: "\(stop.latitude),\(stop.longitude)"),
      URLQueryItem(name: "q", value: stop.name),
    ]
    return components.url
  }
}
