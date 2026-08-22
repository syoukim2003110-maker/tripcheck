import Foundation

/*
 * 旅行者が読む文の表 —— `lib/presentation/planner-copy.ts:18-617` の `ui = { ja, en }` を
 * そのまま 1 つの構造体にする。
 *
 * TS の 267 キーは **camelCase のまま** プロパティになる(`Object.keys(ui.ja)` と
 * `PlannerCopy.keys` が同じ列であることがテストの前提)。文字列値のキーは `let String`、
 * 関数値のキーは TS と同じ引数の形を持つクロージャ、入れ子のオブジェクト
 * (`buildSteps`/`move`/`freshSource`/`crowd`)は入れ子の構造体。
 *
 * 実際の値は `CopyJa.swift` / `CopyEn.swift` に逐語で置く。判定文のビルダ
 * (`feasibilityStateCopy` 以降)はこのファイルの後半、`VerdictCopy` に。
 */
public struct PlannerCopy: Sendable {

  /// TS `buildSteps`(`:75-79` / `:373-377`)。Copy Deck build.stage1-3。
  public struct BuildSteps: Sendable {
    public let grouping: String
    public let ordering: String
    public let enriching: String

    public init(grouping: String, ordering: String, enriching: String) {
      self.grouping = grouping
      self.ordering = ordering
      self.enriching = enriching
    }
  }

  /// TS `move`(`:142` / `:440`)—— `Record<TransportMode, string>`。
  public struct MoveLabels: Sendable {
    public let walk: String
    public let transit: String
    public let taxi: String

    public init(walk: String, transit: String, taxi: String) {
      self.walk = walk
      self.transit = transit
      self.taxi = taxi
    }

    /// TS `ui[locale].move[mode]`。
    public subscript(mode: TransportMode) -> String {
      switch mode {
      case .walk: return walk
      case .transit: return transit
      case .taxi: return taxi
      }
    }
  }

  /// TS `freshSource`(`:304` / `:604`)。
  public struct FreshSourceLabels: Sendable {
    public let social: String
    public let news: String
    public let blog: String
    public let web: String

    public init(social: String, news: String, blog: String, web: String) {
      self.social = social
      self.news = news
      self.blog = blog
      self.web = web
    }
  }

  /// TS `crowd`(`:312` / `:612`)—— `Record<CrowdLevel, string>`。
  public struct CrowdLabels: Sendable {
    public let quiet: String
    public let moderate: String
    public let busy: String
    public let veryBusy: String

    public init(quiet: String, moderate: String, busy: String, veryBusy: String) {
      self.quiet = quiet
      self.moderate = moderate
      self.busy = busy
      self.veryBusy = veryBusy
    }

    public subscript(level: CrowdLevel) -> String {
      switch level {
      case .quiet: return quiet
      case .moderate: return moderate
      case .busy: return busy
      case .veryBusy: return veryBusy
      }
    }
  }

  // MARK: - `ui.ja` / `ui.en` のキー(TS の並び順そのまま)

  public let brandNote: @Sendable (String) -> String
  public let destination: String
  public let destinationSearch: String
  public let airportSearch: String
  public let noMatchingOption: String
  public let optionCount: @Sendable (Int) -> String
  public let newTrip: String
  public let inputLabel: String
  public let sample: String
  public let swissDemo: String
  public let parseHint: String
  public let previewHeading: @Sendable (Int) -> String
  public let previewFormat: String
  public let previewDay: @Sendable (Int) -> String
  public let previewUnparsed: String
  public let previewStay: @Sendable (Int) -> String
  public let days: String
  public let date: String
  public let hotel: String
  public let hotelPlaceholder: String
  public let arrival: String
  public let arrivalTime: String
  public let departure: String
  public let departureTime: String
  public let pace: String
  public let travelHeading: String
  public let travelAuto: String
  public let travelCar: String
  public let moveCar: String
  public let timebandHeading: String
  public let timebandEarly: String
  public let timebandNormal: String
  public let timebandLate: String
  public let dayEndHeading: String
  public let dayEndNone: String
  public let curfewOver: @Sendable (String) -> String
  public let recentHeading: String
  public let recentNote: String
  public let recentDays: @Sendable (Int) -> String
  public let recentDelete: String
  public let moveDay: String
  public let mealChoose: String
  public let mealChosen: String
  public let toastAdded: String
  public let share: String
  public let shareCopied: String
  public let shareTitle: String
  public let relaxed: String
  public let balanced: String
  public let fast: String
  public let buildingTitle: String
  public let buildingBody: String
  public let buildingBodyNoSocial: String
  public let buildingCancel: String
  public let buildSteps: BuildSteps
  public let mapReady: String
  public let mapEmpty: String
  public let legendLabel: String
  public let legendMeasured: String
  public let legendEstimated: String
  public let legendAnchor: String
  public let legendSuggestion: String
  public let routeIdeasChip: String
  public let routeIdeasTitle: String
  public let routeIdeasSubtitle: String
  public let routeIdeasLoading: String
  public let routeIdeasUnavailable: String
  public let routeIdeasRateLimited: String
  public let routeIdeasEmpty: String
  public let routeIdeasDistance: @Sendable (Int) -> String
  public let routeIdeasAdd: String
  public let routeIdeasAdded: String
  public let routeIdeasNote: String
  public let edit: String
  public let openMaps: String
  public let removeStop: String
  public let removedHeading: String
  public let restoreStop: String
  public let backToPlan: String
  public let hotelDepartRow: @Sendable (String, Int) -> String
  public let hotelReturnRow: @Sendable (String, Int) -> String
  public let travelTotal: @Sendable (Int) -> String
  public let precipitation: @Sendable (Int) -> String
  public let forecastNote: String
  public let holidayBadge: String
  public let holidayNote: @Sendable (String) -> String
  public let holidayRegional: String
  public let sundayClosingNote: String
  public let flightKindHeading: String
  public let flightInternational: String
  public let flightDomestic: String
  public let essentialsPlug: String
  public let essentialsEmergency: String
  public let essentialsEntry: String
  public let essentialsPass: String
  public let essentialsOfficial: String
  public let beforeStrike: String
  public let beforeMedication: String
  public let beforeMedicationNote: String
  public let beforeHeading: String
  public let beforeOverdue: String
  public let beforeDueSoon: String
  public let beforePassportLabel: String
  public let beforePassportHint: String
  public let passportCountry: String
  public let passportUnset: String
  public let passportJapan: String
  public let passportOther: String
  public let passportUnsupported: String
  public let beforeBooked: String
  public let beforeBookedAt: @Sendable (String) -> String
  public let beforeWatch: String
  public let print: String
  public let printTitle: String
  public let printBooked: String
  public let printFooter: String
  public let legModes: String
  public let move: MoveLabels
  public let minutes: @Sendable (Int) -> String
  public let legLive: String
  public let unknown: String
  public let placeFallback: String
  public let noDays: String
  public let openDay: String
  public let selectHint: String
  public let mealIdeas: String
  public let gapRecoLabel: @Sendable (Int) -> String
  public let recoAccept: String
  public let recoAlternatives: String
  public let detourLine: @Sendable (Int) -> String
  public let lunchChip: String
  public let dinnerChip: String
  public let foodLoading: String
  public let foodUnavailable: String
  public let maps: String
  public let foodNote: String
  public let foodFresh: @Sendable (Int) -> String
  public let hotelChip: String
  public let hotelPending: String
  public let hotelCandidate: String
  public let hotelSavesTravel: @Sendable (Int) -> String
  public let hotelNoAvailability: String
  public let hotelUnavailable: String
  public let hotelSearch: String
  public let hotelRefresh: String
  public let hotelRefreshChanged: String
  public let hotelRefreshing: String
  public let hotelRefreshHint: String
  public let hotelRefreshFailed: String
  public let stayModeHeading: String
  public let staySame: String
  public let stayNightly: String
  public let nightLabel: @Sendable (Int) -> String
  public let nightlyLoading: String
  public let nightlyUnavailable: String
  public let nightlyNightMissing: String
  public let styleRecommended: String
  public let styleLuxury: String
  public let styleNote: String
  public let hotelRankNote: String
  public let hotelCompareHeading: String
  public let priceUnlisted: String
  public let rakutenTag: @Sendable (Double, Int) -> String
  public let hotelPriceNote: String
  public let hotelReasonTop: String
  public let hotelReasonNearest: String
  public let hotelReasonRated: String
  public let hotelReasonValue: String
  public let hotelReasonSpecified: String
  public let hotelReasonPicked: String
  public let hotelPurposeHeading: String
  public let hotelPurposeBalanced: String
  public let hotelPurposeNearest: String
  public let hotelPurposeRated: String
  public let hotelPurposeHelp: String
  public let axisOverall: String
  public let axisNearest: String
  public let axisTopRated: String
  public let distanceFrom: @Sendable (String) -> String
  public let hotelWideTrip: String
  public let useThisHotel: String
  public let tonightHotel: @Sendable (String) -> String
  public let publicSources: String
  public let reservation: String
  public let timePinned: String
  public let lateBy: @Sendable (Int) -> String
  public let lateShort: @Sendable (Int) -> String
  public let must: String
  public let optional: String
  public let stayLabel: String
  public let stayAuto: String
  public let dayStart: String
  public let dayEnd: String
  public let dayTabsLabel: String
  public let dayTimelineLabel: @Sendable (String) -> String
  public let dayBreakdownLabel: String
  public let dayWindowLabel: String
  public let dayPlannedLabel: String
  public let dayAvailableLabel: String
  public let dayTravelLabel: String
  public let estimated: String
  public let estimatedDetail: String
  public let checkHours: String
  public let betaRegion: String
  public let scopeBorder: String
  public let scopeTimezone: String
  public let scopeFerry: String
  public let shareWarning: String
  public let shareWarningDetail: String
  public let sheetExpand: String
  public let sheetShrink: String
  public let sheetMinimize: String
  public let sheetPeekOpen: String
  public let openingAdjusted: String
  public let openingConflict: String
  public let openingClosedDay: String
  public let excludedHeading: String
  public let excludedClosed: String
  public let excludedPace: String
  public let overCapacity: String
  public let fitSelectedDays: String
  public let fitDaysValue: @Sendable (Int) -> String
  public let fitDaysDecrease: String
  public let fitDaysIncrease: String
  public let walkingSafety: String
  public let deadlineOver: @Sendable (String) -> String
  public let language: String
  public let privacy: String
  public let privacyTitle: String
  public let resolveRemove: String
  public let resolveRemoveAria: @Sendable (String) -> String
  public let manualAddressResolving: String
  public let manualAddressNotFound: String
  public let fieldCheck: String
  public let fieldChecking: String
  public let fieldChecked: String
  public let fieldRetry: String
  public let fieldUnavailable: String
  public let fieldEvidence: String
  public let openNow: String
  public let plannedOpen: String
  public let closedNow: String
  public let hoursUnknown: String
  public let dayHours: @Sendable (String) -> String
  public let dayClosed: String
  public let cashOnly: String
  public let cardsAccepted: String
  public let noWebsite: String
  public let photoLabel: String
  public let recentVoices: String
  public let freshHeading: String
  public let freshLoading: String
  public let freshEmpty: String
  public let freshUnavailable: String
  public let freshPaused: String
  public let freshSource: FreshSourceLabels
  public let freshAgeUnknown: String
  public let freshAiRole: String
  public let official: String
  public let latestX: String
  public let instagram: String
  public let aiAudited: String
  public let rulesAudited: String
  public let crowd: CrowdLabels
  public let crowdWeekend: String
  public let crowdForecast: String
  public let close: String

  // MARK: - 反射(TS の `Object.keys` / `collectStrings` に対応)

  /// TS `Object.keys(ui[locale])` —— 宣言順のプロパティ名。`Mirror` は格納プロパティを
  /// 宣言順に返すので、TS の挿入順と同じ列になる。
  public var keys: [String] {
    Mirror(reflecting: self).children.compactMap(\.label)
  }

  /// TS `tests/banned-terms.test.ts` の `collectStrings` —— 文字列値と入れ子オブジェクトの
  /// 文字列値を全部集める(関数値は引数がないと文字列にならないので TS 同様に対象外)。
  /// キーは入れ子を `.` でつないだもの。
  public var allStaticStrings: [(String, String)] {
    var collected: [(String, String)] = []
    func walk(_ mirror: Mirror, prefix: String) {
      for child in mirror.children {
        guard let label = child.label else { continue }
        let key = prefix.isEmpty ? label : "\(prefix).\(label)"
        if let text = child.value as? String {
          collected.append((key, text))
        } else {
          let childMirror = Mirror(reflecting: child.value)
          if childMirror.displayStyle == .struct { walk(childMirror, prefix: key) }
        }
      }
    }
    walk(Mirror(reflecting: self), prefix: "")
    return collected
  }

  // MARK: - JS の数の書き方

  /// JS `Number.prototype.toFixed(1)`。`routeIdeasDistance` と `rakutenTag` が使う。
  ///
  static func fixed1(_ value: Double) -> String { jsToFixed(value, 1) }

  /// JS `Number.prototype.toLocaleString("ja-JP" | "en-US")` —— 整数はどちらのロケールでも
  /// 3 桁ごとのカンマ区切りになる(`rakutenTag` の口コミ件数だけが使う)。
  static func grouped(_ value: Int) -> String {
    let digits = String(abs(value))
    var out = ""
    for (offset, character) in digits.enumerated() {
      if offset > 0, (digits.count - offset) % 3 == 0 { out.append(",") }
      out.append(character)
    }
    return value < 0 ? "-\(out)" : out
  }
}

/// TS `ui`(`lib/presentation/planner-copy.ts:18`)。
public enum Copy {
  /// TS `ui[locale]`。
  public static func `for`(_ locale: PlannerLocale) -> PlannerCopy {
    locale == .ja ? ja : en
  }
}

/// TS `legModeLabel`(`lib/presentation/planner-copy.ts:619-621`)。
public func legModeLabel(_ mode: TransportMode, _ locale: PlannerLocale) -> String {
  Copy.for(locale).move[mode]
}

// MARK: - 判定文(`lib/presentation/planner-copy.ts:619-1006`)

/// TS `feasibilityStateCopy` の戻り値(`lib/presentation/planner-copy.ts:659`)。
public struct FeasibilityStateCopy: Equatable, Sendable {
  public var label: String
  public var headline: String

  public init(label: String, headline: String) {
    self.label = label
    self.headline = headline
  }
}

/// TS `alternativeCopy` の戻り値(`lib/presentation/planner-copy.ts:798`)。
public struct AlternativeCopy: Equatable, Sendable {
  public var title: String
  public var detail: String

  public init(title: String, detail: String) {
    self.title = title
    self.detail = detail
  }
}

/// 1 つだけ出す警告に添える行動 —— `app/components/planner/summary/TripSummaryCard.tsx:57-99`
/// のボタン。原因ごとに行き先が違う(TC-004):計算上限は「場所を確認する」では答えられない。
public enum WarningAction: String, Equatable, Sendable, CaseIterable {
  /// INFEASIBLE_HARD_CONFLICT —— 代替案の一覧へ。
  case seeAlternatives
  /// UNKNOWN かつ COMPUTATION_LIMIT —— 課題カード(減らす場所)へ。
  case seeWhatToRemove
  /// UNKNOWN / FEASIBLE_IF_ASSUMPTIONS —— 条件の確認へ。
  case reviewConditions

  /// TS のボタン文言(`TripSummaryCard.tsx:96-98`)。
  public func label(_ locale: PlannerLocale) -> String {
    switch self {
    case .seeAlternatives: return locale == .ja ? "直し方を見る" : "See how to fix it"
    case .seeWhatToRemove: return locale == .ja ? "減らし方を見る" : "See what to remove"
    case .reviewConditions: return locale == .ja ? "確認する" : "Review details"
    }
  }
}

/// 結論カードが surface に出す 1 行と 1 つの行動。
///
/// TS はこの 2 つを独立に出す(警告だけ・行動だけ・両方)ので、ブリーフの
/// `(text: String, action: WarningAction)?` ではなく両方を任意にした構造体を返す。
/// 両方無いとき(`!warning && !actionable`)は `nil` —— TS の `return null` と同じ。
public struct PrimaryWarning: Equatable, Sendable {
  public var text: String?
  public var action: WarningAction?

  public init(text: String?, action: WarningAction?) {
    self.text = text
    self.action = action
  }
}

/// TS `lib/presentation/planner-copy.ts` 後半の判定文ビルダ群。
public enum VerdictCopy {

  // MARK: 状態の文

  /// TS `feasibilityStateCopy`(`:644-690`)。
  ///
  /// v1.1 §5.4:内部の状態名ではなく、旅行者の言葉で結論を言う。TC-004 —— UNKNOWN には
  /// 原因が 2 つあり、それぞれ別の文と別の次の一手を持つ。既定の見出しは「場所を確認して」
  /// と言うが、全部の場所が解決していてソルバが予算切れしただけのときには役に立たない
  /// (そのときの一手はリストを短くすること)。
  public static func feasibilityStateCopy(
    _ state: FeasibilityState,
    locale: PlannerLocale,
    days: Int,
    stops: Int,
    unplacedCount: Int = 0,
    checkCount: Int = 0,
    unknownCause: FeasibilityUnknownCause? = nil
  ) -> FeasibilityStateCopy {
    if state == .UNKNOWN, unknownCause == .COMPUTATION_LIMIT {
      return locale == .ja
        ? FeasibilityStateCopy(label: "計算上限", headline: "場所が多く、計算しきれませんでした")
        : FeasibilityStateCopy(label: "Too many places", headline: "There were too many places to finish the calculation")
    }
    if locale == .ja {
      if state == .VERIFIED_FEASIBLE {
        return FeasibilityStateCopy(label: "全\(stops)か所", headline: "\(days)日なら、無理なく回れます")
      }
      if state == .PROVISIONAL_FEASIBLE {
        return FeasibilityStateCopy(label: "全\(stops)か所", headline: "\(days)日で回れそうです")
      }
      if state == .FEASIBLE_IF_ASSUMPTIONS {
        return checkCount > 0
          ? FeasibilityStateCopy(label: "条件付き", headline: "\(days)日で回れます。\(checkCount)か所だけ確認が必要です")
          : FeasibilityStateCopy(label: "条件付き", headline: "この条件なら\(days)日で回れます")
      }
      if state == .INFEASIBLE_HARD_CONFLICT {
        return unplacedCount > 0
          ? FeasibilityStateCopy(label: "要修正", headline: "\(days)日だと\(unplacedCount)か所外す必要があります")
          : FeasibilityStateCopy(label: "要修正", headline: "このままだと予約・時間に間に合いません")
      }
      return FeasibilityStateCopy(label: "確認待ち", headline: "場所を確認すると完成します")
    }
    if state == .VERIFIED_FEASIBLE {
      return FeasibilityStateCopy(label: "\(stops) places", headline: "This works comfortably in \(days) day\(days == 1 ? "" : "s")")
    }
    if state == .PROVISIONAL_FEASIBLE {
      return FeasibilityStateCopy(label: "\(stops) places", headline: "This should work in \(days) day\(days == 1 ? "" : "s")")
    }
    if state == .FEASIBLE_IF_ASSUMPTIONS {
      return checkCount > 0
        ? FeasibilityStateCopy(
          label: "Conditional",
          headline: "This works in \(days) day\(days == 1 ? "" : "s"), with \(checkCount) detail\(checkCount == 1 ? "" : "s") to check"
        )
        : FeasibilityStateCopy(label: "Conditional", headline: "This works in \(days) day\(days == 1 ? "" : "s") with these assumptions")
    }
    if state == .INFEASIBLE_HARD_CONFLICT {
      return unplacedCount > 0
        ? FeasibilityStateCopy(
          label: "Needs a change",
          headline: "In \(days) day\(days == 1 ? "" : "s"), \(unplacedCount == 1 ? "one stop needs" : "\(unplacedCount) stops need") to move or be removed"
        )
        : FeasibilityStateCopy(label: "Needs a change", headline: "A booking or time constraint cannot be met as planned")
    }
    return FeasibilityStateCopy(label: "Almost there", headline: "Confirm the places to finish the plan")
  }

  /// 結論の見出しそのもの。TS では `useTripDomainModel.tsx:1310-1321` が
  /// `feasibilityStateCopy` に渡す引数を組み立てている —— その組み立てをここに寄せた。
  ///
  /// `checkCount` は課題チップが数える件数(アプリ側の持ち物)なので既定 0。
  public static func hero(
    result: FeasibilityResult,
    fit: TripFitAssessment,
    plan: BuiltTripPlan,
    locale: PlannerLocale,
    checkCount: Int = 0
  ) -> String {
    stateCopy(result: result, fit: fit, plan: plan, locale: locale, checkCount: checkCount).headline
  }

  /// `hero` と同じ組み立てで、ラベルも要るとき用。
  public static func stateCopy(
    result: FeasibilityResult,
    fit: TripFitAssessment,
    plan: BuiltTripPlan,
    locale: PlannerLocale,
    checkCount: Int = 0
  ) -> FeasibilityStateCopy {
    feasibilityStateCopy(
      result.state,
      locale: locale,
      // TS `plan?.requestedDays ?? tripDays` / `plan?.scheduledStopCount ?? 0`
      days: plan.requestedDays,
      stops: plan.scheduledStopCount,
      unplacedCount: plan.deferredUnavailableStops.count + plan.deferredOptionalStops.count,
      checkCount: checkCount,
      unknownCause: result.unknownCause
    )
  }

  /// TS `app/components/planner/summary/TripSummaryCard.tsx:57-99` —— 1 つだけの警告と、
  /// それに答える 1 つの行動。
  public static func primaryWarning(
    result: FeasibilityResult,
    deferredAnchorStops: [RouteStop] = [],
    locale: PlannerLocale
  ) -> PrimaryWarning? {
    let computationLimited = result.state == .UNKNOWN && result.unknownCause == .COMPUTATION_LIMIT
    let reviewable = !computationLimited && (result.state == .UNKNOWN || result.state == .FEASIBLE_IF_ASSUMPTIONS)
    let actionable = result.state == .INFEASIBLE_HARD_CONFLICT || computationLimited || reviewable

    let text: String?
    if let conflict = result.primaryConflict {
      text = conflictCopy(conflict, locale: locale)
    } else if !deferredAnchorStops.isEmpty {
      let names = deferredAnchorStops.prefix(2).map(\.name)
      let extra = deferredAnchorStops.count - 2
      text = locale == .ja
        ? "\(names.joined(separator: "、"))\(extra > 0 ? "ほか\(extra)件" : "")は、現在の条件では日程に入りません。"
        : "\(names.joined(separator: ", "))\(extra > 0 ? " and \(extra) more" : "") do not fit the current plan."
    } else if let attention = result.primaryAttention {
      text = attentionCopy(attention, locale: locale)
    } else {
      text = nil
    }

    if text == nil && !actionable { return nil }
    let action: WarningAction? = result.state == .INFEASIBLE_HARD_CONFLICT
      ? .seeAlternatives
      : computationLimited ? .seeWhatToRemove : reviewable ? .reviewConditions : nil
    return PrimaryWarning(text: text, action: action)
  }

  // MARK: 衝突・注意・前提

  /// TS `conflictCopy`(`:692-713`)。
  public static func conflictCopy(_ conflict: Conflict, locale: PlannerLocale) -> String {
    let item = conflict.affectedItems.first ?? (locale == .ja ? "この予定" : "This plan")
    let minutes = conflict.overrunMinutes ?? 0
    if locale == .ja {
      switch conflict.code {
      case .AIRPORT_CUTOFF: return "\(item)を含む日程が、空港へ向かう締切を\(minutes)分超えます。"
      case .FIXED_BOOKING_LATE: return "\(item)の予約時刻に約\(minutes)分遅れます。"
      case .CLOSED_ON_FIXED_DAY: return "\(item)は固定した日に営業していない可能性があります。"
      case .OPENING_HOURS_CONFLICT: return "\(item)の営業時間内に滞在を収められません。"
      case .LAST_ENTRY_CONFLICT: return "\(item)の到着が、指定した最終入場時刻を過ぎます。"
      case .PLACE_UNAVAILABLE: return "\(item)を現在の日付・営業時間では配置できません。"
      case .DAY_END_OVERRUN: return "\(item)の日程が終了時刻を\(minutes)分超えます。"
      case .DAY_CAPACITY: return "\(item)の日程が利用できる時間を\(minutes)分超えます。"
      }
    }
    switch conflict.code {
    case .AIRPORT_CUTOFF: return "The day containing \(item) runs \(minutes) minutes past the airport cutoff."
    case .FIXED_BOOKING_LATE: return "The plan reaches \(item) about \(minutes) minutes after its booking time."
    case .CLOSED_ON_FIXED_DAY: return "\(item) may be closed on its fixed day."
    case .OPENING_HOURS_CONFLICT: return "\(item) cannot fit inside its available opening window."
    case .LAST_ENTRY_CONFLICT: return "The plan reaches \(item) after its specified last-entry cutoff."
    case .PLACE_UNAVAILABLE: return "\(item) could not be placed on any available day."
    case .DAY_END_OVERRUN: return "The day containing \(item) runs \(minutes) minutes past its end time."
    case .DAY_CAPACITY: return "The day containing \(item) exceeds its usable time by \(minutes) minutes."
    }
  }

  /// TS `attentionCopy`(`:715-742`)。
  ///
  /// UI/UX v3.1 §2.1 Tier C:ここはかつて件数だった —— 「未確認の重要情報が10件」が、
  /// 同じ心配を 2 件と数える確認カードの上に乗っていた。事実を数えるものと行動を数える
  /// ものが並び、どちらも旅行者にできることではなかった。いまは最初の場所の名前を言う。
  public static func attentionCopy(_ attention: Attention, locale: PlannerLocale) -> String {
    // TS は空配列で `undefined` を文字列化するが、エンジンは必ず 1 件以上入れる。
    let first = attention.affectedItems.first ?? ""
    switch attention.code {
    case .TRANSIT_NON_CONVERGED:
      return locale == .ja
        ? "公共交通の時刻を反映した再計算が上限内に安定しませんでした。観測した最長時間を使った条件付き日程です。"
        : "The transit-timed replan did not stabilize within the safety limit. This conditional schedule uses the longest observed durations."
    case .WALKING_LIMIT_EXCEEDED:
      return locale == .ja
        ? "\(attention.affectedItems.joined(separator: " → "))の徒歩が設定上限を\(attention.minutes ?? 0)分超えます。移動手段を変更してください。"
        : "Walking \(attention.affectedItems.joined(separator: " → ")) exceeds your per-leg limit by \(attention.minutes ?? 0) minutes. Choose another mode."
    case .TRANSFER_LIMIT_EXCEEDED:
      let count = attention.transferCount.map(String.init) ?? "?"
      let limit = attention.transferLimit.map(String.init) ?? "?"
      return locale == .ja
        ? "\(attention.affectedItems.joined(separator: " → "))は乗換\(count)回で、設定上限\(limit)回を超えます。固定条件を守ったまま、別の移動手段も比較してください。"
        : "\(attention.affectedItems.joined(separator: " → ")) needs \(count) transfers, above your limit of \(limit). Compare another mode without silently changing a locked choice."
    case .LOW_BUFFER:
      return locale == .ja
        ? "\(first)の余白は\(attention.minutes ?? 0)分です。遅れが出ると次の予定へ影響します。"
        : "\(first) has \(attention.minutes ?? 0) minutes of buffer. A delay can affect the next stop."
    case .UNVERIFIED_FACTS:
      let andOthers = attention.affectedItems.count > 1
      return locale == .ja
        ? "\(first)\(andOthers ? "ほか" : "")は出発前の確認が必要です。"
        : "\(first)\(andOthers ? " and others" : "") need a check before you go."
    }
  }

  /// TS `assumptionCopy`(`:744-777`)。
  public static func assumptionCopy(_ assumption: Assumption, locale: PlannerLocale) -> String {
    if locale == .ja {
      switch assumption.code {
      case .DATE_PROVISIONAL: return "旅行日は仮の日付"
      case .BASE_UNKNOWN: return "ホテル・拠点は未指定"
      case .DAY_START_DEFAULT: return "各日の開始時刻は初期値を使用"
      case .DAY_END_DEFAULT: return "1日の終了は22:00と仮定"
      case .STAY_DURATION_ESTIMATED: return "滞在時間\(assumption.count)件は推定"
      case .ROUTE_ESTIMATED: return "移動\(assumption.count)区間は推定"
      case .OPENING_HOURS_UNKNOWN: return "営業時間\(assumption.count)件は未確認"
      case .LAST_ENTRY_ESTIMATED: return "最終入場\(assumption.count)件は推定"
      case .AIRPORT_TRANSFER_ESTIMATED: return "空港の手続き・市内移動\(assumption.count)件は推定"
      case .TRANSFER_BUFFER: return "各移動後に選択した乗換・道迷い余白を加算"
      case .WALKING_LIMIT_DEFAULT: return "1区間の徒歩上限は標準30分を使用"
      case .TRANSFER_LIMIT_DEFAULT: return "1区間の乗換上限は標準2回を使用"
      case .TRANSFER_COUNT_UNKNOWN: return "乗換回数\(assumption.count)区間は提供元から未取得"
      case .TRANSIT_NON_CONVERGED: return "時刻別の公共交通経路データを反映した日程が反復上限内に安定せず、取得できた最長時間を使用"
      }
    }
    switch assumption.code {
    case .DATE_PROVISIONAL: return "The trip date is provisional"
    case .BASE_UNKNOWN: return "No hotel or base is confirmed"
    case .DAY_START_DEFAULT: return "Day start times use the current default"
    case .DAY_END_DEFAULT: return "Days are assumed to end at 22:00"
    case .STAY_DURATION_ESTIMATED: return "\(assumption.count) stay durations are estimated"
    case .ROUTE_ESTIMATED: return "\(assumption.count) route legs are estimated"
    case .OPENING_HOURS_UNKNOWN: return "\(assumption.count) opening-hour facts are unverified"
    case .LAST_ENTRY_ESTIMATED: return "\(assumption.count) last-entry cutoffs are estimated"
    case .AIRPORT_TRANSFER_ESTIMATED: return "\(assumption.count) airport processing or transfer times are estimated"
    case .TRANSFER_BUFFER: return "The selected wayfinding buffer is added after every travelled leg"
    case .WALKING_LIMIT_DEFAULT: return "The standard 30-minute per-leg walking limit is used"
    case .TRANSFER_LIMIT_DEFAULT: return "The standard limit of 2 transfers per leg is used"
    case .TRANSFER_COUNT_UNKNOWN: return "Transfer counts are unavailable for \(assumption.count) route legs"
    case .TRANSIT_NON_CONVERGED: return "The transit-timed itinerary did not stabilize within the bounded loop, so it uses the longest observed durations"
    }
  }

  // MARK: 代替案

  /// TS `alternativeCopy`(`:779-835`)。
  public static func alternativeCopy(_ alternative: AlternativePlan, locale: PlannerLocale) -> AlternativeCopy {
    let improvement = [
      alternative.improvement.hardConflictsRemoved > 0
        ? (locale == .ja
          ? "固定衝突-\(alternative.improvement.hardConflictsRemoved)"
          : "\(alternative.improvement.hardConflictsRemoved) hard conflict\(alternative.improvement.hardConflictsRemoved == 1 ? "" : "s") removed")
        : nil,
      alternative.improvement.overrunMinutesReduced > 0
        ? (locale == .ja
          ? "超過-\(alternative.improvement.overrunMinutesReduced)分"
          : "\(alternative.improvement.overrunMinutesReduced) min less overrun")
        : nil,
      (alternative.improvement.slackMinutesGained ?? 0) > 0
        ? (locale == .ja
          ? "最小余白+\(alternative.improvement.slackMinutesGained ?? 0)分"
          : "+\(alternative.improvement.slackMinutesGained ?? 0) min minimum slack")
        : nil,
      alternative.improvement.travelMinutesReduced > 0
        ? (locale == .ja
          ? "移動-\(alternative.improvement.travelMinutesReduced)分"
          : "\(alternative.improvement.travelMinutesReduced) min less travel")
        : nil,
    ].compactMap { $0 }.joined(separator: " · ")

    switch alternative.kind {
    case .CHANGE_DAYS:
      let days = alternative.change.days ?? alternative.after.dayCount
      let dayDelta = alternative.change.dayDelta ?? (days - alternative.before.dayCount)
      if locale == .ja {
        let head = dayDelta > 0 ? "\(dayDelta)日追加" : "\(abs(dayDelta))日短縮"
        return AlternativeCopy(title: "\(days)日案を比較", detail: "\(head)\(improvement.isEmpty ? "" : " · \(improvement)")")
      }
      let head = dayDelta > 0
        ? "Add \(dayDelta) day\(dayDelta == 1 ? "" : "s")"
        : "Use \(abs(dayDelta)) fewer day\(abs(dayDelta) == 1 ? "" : "s")"
      return AlternativeCopy(title: "Compare a \(days)-day plan", detail: "\(head)\(improvement.isEmpty ? "" : " · \(improvement)")")

    case .START_EARLIER:
      let minutes = alternative.change.minutes ?? 60
      return locale == .ja
        ? AlternativeCopy(title: "\(minutes)分早く始める", detail: improvement)
        : AlternativeCopy(title: "Start \(minutes) minutes earlier", detail: improvement)

    case .END_LATER:
      let minutes = alternative.change.minutes ?? 60
      return locale == .ja
        ? AlternativeCopy(title: "\(minutes)分遅く終える", detail: improvement)
        : AlternativeCopy(title: "Finish \(minutes) minutes later", detail: improvement)

    case .CHANGE_BASE:
      return locale == .ja
        ? AlternativeCopy(title: "拠点を\(alternative.change.baseName ?? "候補")に変更", detail: improvement)
        : AlternativeCopy(title: "Use \(alternative.change.baseName ?? "the suggested base")", detail: improvement)

    case .CHANGE_MODE:
      let from = alternative.change.fromName ?? (locale == .ja ? "出発地" : "the first stop")
      let to = alternative.change.toName ?? (locale == .ja ? "到着地" : "the next stop")
      let mode: String
      if let changed = alternative.change.mode {
        mode = locale == .ja ? japaneseModeName(changed) : englishModeName(changed)
      } else {
        mode = locale == .ja ? "別の移動手段" : "another mode"
      }
      let tradeoff: String
      if alternative.change.mode == .taxi {
        tradeoff = locale == .ja ? "所要時間を短縮できますが、運賃が増えます" : "Saves time but adds a fare"
      } else if alternative.change.mode == .walk {
        tradeoff = locale == .ja ? "運賃を抑えられますが、歩行負荷が増えます" : "Avoids a fare but adds walking effort"
      } else {
        tradeoff = locale == .ja ? "乗換や待ち時間が発生する場合があります" : "May add transfers or waiting time"
      }
      return locale == .ja
        ? AlternativeCopy(title: "\(from) → \(to)を\(mode)に変更", detail: "\(tradeoff)\(improvement.isEmpty ? "" : " · \(improvement)")")
        : AlternativeCopy(title: "Use \(mode) from \(from) to \(to)", detail: "\(tradeoff)\(improvement.isEmpty ? "" : " · \(improvement)")")

    case .OPTIMIZE_ORDER:
      return locale == .ja
        ? AlternativeCopy(
          title: "日ごとの移動を減らす順番にする",
          detail: "元の日別割当と固定条件を守り、行順だけを解放\(improvement.isEmpty ? "" : " · \(improvement)")"
        )
        : AlternativeCopy(
          title: "Use a lower-travel order",
          detail: "Keeps day assignments and fixed constraints, while releasing pasted line order\(improvement.isEmpty ? "" : " · \(improvement)")"
        )

    case .REMOVE_OPTIONAL:
      let stopName = alternative.change.stopName ?? alternative.loss?.stopName ?? "Optional"
      let stayMinutes = alternative.loss?.stayMinutes ?? 0
      return locale == .ja
        ? AlternativeCopy(
          title: "\(stopName)を外して比較",
          detail: "失うもの: \(stopName)（滞在\(stayMinutes)分）\(improvement.isEmpty ? "" : " · \(improvement)")"
        )
        : AlternativeCopy(
          title: "Compare without \(stopName)",
          detail: "Trade-off: lose \(stopName) (\(stayMinutes) min)\(improvement.isEmpty ? "" : " · \(improvement)")"
        )
    }
  }

  /// TS `alternativeLossCopy`(`:837-854`)。
  public static func alternativeLossCopy(_ alternative: AlternativePlan, locale: PlannerLocale) -> String? {
    guard let loss = alternative.loss else { return nil }
    if loss.kind == .ORIGINAL_ORDER {
      return locale == .ja
        ? "失うもの: 入力した行順。日別割当、予約、固定時刻、固定した移動手段は維持します。"
        : "Trade-off: release the pasted line order. Day assignments, bookings, fixed times and locked modes stay protected."
    }
    if loss.kind == .TRANSPORT_TRADEOFF {
      let mode: String
      if let locked = loss.mode {
        mode = locale == .ja ? japaneseModeName(locked) : englishModeName(locked)
      } else {
        mode = locale == .ja ? "別の移動手段" : "another mode"
      }
      return locale == .ja
        ? "交換条件: \(mode)に固定すると、費用・歩行・乗換の負担が変わります。"
        : "Trade-off: locking \(mode) changes fare, walking effort, or transfer load."
    }
    let stopName = loss.stopName ?? alternative.change.stopName ?? "Optional"
    return locale == .ja ? "失うもの: \(stopName)" : "Trade-off: remove \(stopName)"
  }

  /// TS の `{ walk: "徒歩", transit: "公共交通", taxi: "タクシー" }`(`:815`/`:845`)——
  /// `ui.ja.move`(電車)とは別の語彙。
  static func japaneseModeName(_ mode: TransportMode) -> String {
    switch mode {
    case .walk: return "徒歩"
    case .transit: return "公共交通"
    case .taxi: return "タクシー"
    }
  }

  /// TS の `{ walk: "walking", transit: "transit", taxi: "taxi" }`(`:816`/`:846`)。
  static func englishModeName(_ mode: TransportMode) -> String {
    switch mode {
    case .walk: return "walking"
    case .transit: return "transit"
    case .taxi: return "taxi"
    }
  }

  // MARK: 固定条件を壊す編集(`HardEditCopy` の再輸出)

  /// TS `hardEditConflictSentence`(`:867-895`)—— 実体は `Edits/HardEdits.swift` の
  /// `HardEditCopy.conflictSentence`。
  public static func hardEditConflictSentence(
    _ kind: HardEditConflictKind,
    name: String,
    minutes: Int,
    locale: PlannerLocale
  ) -> String {
    HardEditCopy.conflictSentence(kind, name: name, minutes: minutes, locale: locale)
  }

  /// TS `hardEditBookingDelayTitle`(`:899-903`)—— 実体は `HardEditCopy.bookingDelayTitle`。
  public static func hardEditBookingDelayTitle(_ minutes: Int, locale: PlannerLocale) -> String {
    HardEditCopy.bookingDelayTitle(minutes, locale: locale)
  }

  /// TS `hardEditTitles`(`:905-938`)—— 確認ダイアログの題。編集の出どころ(区間の移動手段・
  /// 滞在時間・最終入場・日の窓)が違っても、同じ文型で読める。
  public enum HardEditTitles {
    public static func legMode(_ mode: String, locale: PlannerLocale) -> String {
      locale == .ja ? "この区間の移動を\(mode)に変更しますか？" : "Change this leg to \(mode)?"
    }
    public static func legModeAuto(locale: PlannerLocale) -> String {
      locale == .ja ? "この区間の移動手段を自動に戻しますか？" : "Return this leg to automatic mode?"
    }
    public static func stayMinutes(_ name: String, _ minutes: Int, locale: PlannerLocale) -> String {
      locale == .ja ? "「\(name)」の滞在時間を\(minutes)分にしますか？" : "Set the stay at “\(name)” to \(minutes) minutes?"
    }
    public static func stayMinutesAuto(_ name: String, locale: PlannerLocale) -> String {
      locale == .ja ? "「\(name)」の滞在時間を自動に戻しますか？" : "Return the stay at “\(name)” to automatic?"
    }
    public static func lastEntry(_ name: String, _ time: String, locale: PlannerLocale) -> String {
      locale == .ja ? "「\(name)」の最終入場を\(time)にしますか？" : "Set the last entry for “\(name)” to \(time)?"
    }
    public static func lastEntryClear(_ name: String, locale: PlannerLocale) -> String {
      locale == .ja ? "「\(name)」の最終入場指定を外しますか？" : "Clear the last-entry time for “\(name)”?"
    }
    public static func dayStart(_ day: Int, _ time: String, locale: PlannerLocale) -> String {
      locale == .ja ? "\(day)日目の開始を\(time)にしますか？" : "Start day \(day) at \(time)?"
    }
    public static func dayStartAuto(_ day: Int, locale: PlannerLocale) -> String {
      locale == .ja ? "\(day)日目の開始時刻を標準に戻しますか？" : "Return day \(day) to the standard start time?"
    }
    public static func dayEnd(_ day: Int, _ time: String, locale: PlannerLocale) -> String {
      locale == .ja ? "\(day)日目の終了を\(time)にしますか？" : "End day \(day) at \(time)?"
    }
    public static func dayEndAuto(_ day: Int, locale: PlannerLocale) -> String {
      locale == .ja ? "\(day)日目の終了時刻を標準に戻しますか？" : "Return day \(day) to the standard end time?"
    }
    public static func restoreStop(_ name: String, locale: PlannerLocale) -> String {
      locale == .ja ? "「\(name)」を予定に戻しますか？" : "Put “\(name)” back into the plan?"
    }
    public static func startEarlier(_ minutes: Int, locale: PlannerLocale) -> String {
      locale == .ja ? "全日程の開始を\(minutes)分早めますか？" : "Start every day \(minutes) minutes earlier?"
    }
    public static func endLater(_ minutes: Int, locale: PlannerLocale) -> String {
      locale == .ja ? "全日程の終了を\(minutes)分遅らせますか？" : "End every day \(minutes) minutes later?"
    }
    public static func optimizeOrder(locale: PlannerLocale) -> String {
      locale == .ja ? "各日の回る順番を並べ替えますか？" : "Reorder the stops on each day?"
    }
  }

  // MARK: 差分の 1 行

  /// TS `travelDeltaLine`(`:944-948`)。符号は `+` / `−`(U+2212) / `±`。
  public static func travelDeltaLine(_ deltaMinutes: Int, locale: PlannerLocale) -> String {
    let sign = deltaMinutes > 0 ? "+" : deltaMinutes < 0 ? "−" : "±"
    let minutes = abs(deltaMinutes)
    return locale == .ja ? "移動 \(sign)\(minutes)分" : "travel \(sign)\(minutes) min"
  }

  /// TS `bufferDeltaLine`(`:950-954`)。
  public static func bufferDeltaLine(_ deltaMinutes: Int, locale: PlannerLocale) -> String {
    let sign = deltaMinutes > 0 ? "+" : deltaMinutes < 0 ? "−" : "±"
    let minutes = abs(deltaMinutes)
    return locale == .ja ? "余裕 \(sign)\(minutes)分" : "\(sign)\(minutes)m buffer"
  }

  /// TS `bufferToastDetail`(`:957-959`)—— 差が 0 のときは指標を出さない(「±0」を作らない)。
  public static func bufferToastDetail(_ deltaMinutes: Int, locale: PlannerLocale) -> String? {
    deltaMinutes == 0 ? nil : bufferDeltaLine(deltaMinutes, locale: locale)
  }

  // MARK: 最短日数

  /// TS `minimumDaysCopy`(`:961-1006`)。
  ///
  /// 判定を出せないときは、理屈の上で考えられる原因を並べず、**実際にある** 1 つの原因と
  /// その 1 つの次の一手だけを言う(v1.1 TC-004)。
  public static func minimumDaysCopy(_ result: FeasibilityResult, locale: PlannerLocale) -> String {
    guard let minimumDays = result.minimumDays else {
      let unresolved = result.unresolvedPlaceNames
      if !unresolved.isEmpty {
        let names = unresolved.prefix(2).joined(separator: locale == .ja ? "・" : ", ")
          + (unresolved.count > 2 ? (locale == .ja ? " 他\(unresolved.count - 2)件" : " +\(unresolved.count - 2) more") : "")
        if let partial = result.partialMinimumDays {
          return locale == .ja
            ? "「\(names)」が未確定のため、確認が終わるまで結論を出しません。確定済みの場所だけなら最短\(partial)日です。上の「確認する」から場所を確定してください。"
            : "On hold because “\(names)” is not settled yet. The confirmed places alone need at least \(partial) day\(partial == 1 ? "" : "s"). Use “Confirm” above to settle the place."
        }
        return locale == .ja
          ? "「\(names)」が未確定のため、最短日数はまだ判定できません。上の「確認する」から場所を確定するか、入力を直してください。"
          : "Minimum days are withheld because “\(names)” is not settled. Use “Confirm” above to pick the place, or edit the input."
      }
      // 計算上限は独立した原因で、独立した一手(候補を減らす)を持つ。
      if result.unknownCause == .COMPUTATION_LIMIT {
        return locale == .ja
          ? "計算の上限に達したため、最短日数を判定できませんでした。場所を15件以下にしてください。"
          : "The computation limit was reached before minimum days could be settled. Remove optional places to bring the list to 15 or fewer."
      }
      if result.searchedThroughDays > 0 {
        return locale == .ja
          ? "\(result.searchedThroughDays)日まで探索しましたが、固定条件が競合して収まりませんでした。予約・時間指定の固定条件を1つ見直してください。"
          : "Searched through \(result.searchedThroughDays) days, but a fixed constraint still conflicts. Revisit one booked or fixed-time constraint."
      }
      if result.partialMinimumDays != nil || result.conflicts.contains(where: { $0.code == .PLACE_UNAVAILABLE }) {
        let partialJa = result.partialMinimumDays.map { "配置できる場所だけなら最短\($0)日です。" } ?? ""
        let partialEn = result.partialMinimumDays.map { "The placeable stops alone need at least \($0) day\($0 == 1 ? "" : "s"). " } ?? ""
        return locale == .ja
          ? "選んだ日程では営業しない場所があるため、確認が終わるまで結論を出しません。\(partialJa)「予定から外した場所」を確認してください。"
          : "On hold because some places cannot open on the chosen days. \(partialEn)Review the places left out of this plan."
      }
      return locale == .ja
        ? "14日を超える日指定があるため、最短日数はまだ判定していません。日指定を14日以内へ直してください。"
        : "Minimum days are withheld because a day pin is beyond the supported range. Move day pins within 14 days."
    }

    let assumptions = result.minimumDaysAssumptions
    let windows = assumptions.dayWindows.map { "\($0.start)–\($0.end)" }
    // TS `[...new Set(windows)]` —— 挿入順の重複除去。
    var seen = Set<String>()
    let uniqueWindows = windows.filter { seen.insert($0).inserted }
    let windowCopy = uniqueWindows.count == 1
      ? uniqueWindows[0]
      : (locale == .ja ? "\(windows.count)日それぞれの時間枠" : "the \(windows.count) per-day time windows")
    let base = assumptions.base.name ?? (locale == .ja ? "仮の拠点" : "the provisional base")
    let stayCount = assumptions.stayDurations.count
    return locale == .ja
      ? "\(windowCopy)・拠点「\(base)」・\(stayCount)件の滞在時間・移動ごと\(assumptions.transferBufferMinutes)分の余白では、最短\(minimumDays)日です。"
      : "With \(windowCopy), base “\(base)”, \(stayCount) stay durations and \(assumptions.transferBufferMinutes)-minute leg buffers, the minimum is \(minimumDays) day\(minimumDays == 1 ? "" : "s")."
  }

  // MARK: 印刷

  /// TS `printTransferCopy`(`:623-636`)。
  public static func printTransferCopy(
    _ leg: BuiltPlanLeg,
    maxTransfers: Int,
    locale: PlannerLocale
  ) -> String {
    guard leg.comparison.recommended.mode == .transit else { return "" }
    guard let transferCount = leg.transferCount else {
      return locale == .ja ? " · 乗換回数 未確認" : " · transfers unverified"
    }
    let count = locale == .ja
      ? "乗換\(transferCount)回"
      : "\(transferCount) transfer\(transferCount == 1 ? "" : "s")"
    let excess = max(0, transferCount - maxTransfers)
    if excess == 0 { return " · \(count)" }
    return locale == .ja ? " · \(count)（上限+\(excess)回）" : " · \(count) (limit +\(excess))"
  }
}
