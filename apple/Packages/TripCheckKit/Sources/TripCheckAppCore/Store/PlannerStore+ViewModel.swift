import Foundation
import TripCheckKit

/*
 * 結果画面が読む導出値。**ビューはここから読むだけで、何も計算しない。**
 *
 * 理由は 2 つある。1 つは、同じ数を 2 か所で数えると必ず割れること —— 見出しが「8か所」と
 * 言い、統計行が「7か所」と言う画面は、どちらが正しくても信用を失う。もう 1 つは、旅行者に
 * 見せる文が全部 Kit(`VerdictCopy` / `TimelinePresentation` / `TripPresentation`)か
 * `AppCopy` から来ることを、この 1 ファイルを読めば確かめられること。
 *
 * 帯の数(訪問/移動/余裕)も Kit の `DayPresentationBuilder.numbers` が持ち主で、ここは
 * 分を割合に直してマーカーを置くだけである(Web の `lib/planner-day-time-bar.ts` のうち、
 * 数の部分は Kit へ移植済み・画面の部分がここ)。
 */

/// 日タブ 1 枚。
public struct DayTabModel: Identifiable, Equatable, Sendable {
  /// 0 始まりの日。
  public var index: Int
  /// 「1日目」/ "Day 1"。
  public var label: String
  /// 地図のピンと同じ 7 色(`DayPalette`)。
  public var colorHex: String
  /// 「4か所」「ゆったり」「予定なし」。読み上げの `accessibilityValue` になる。
  public var density: String
  /// 土日かどうか。**祝日は出さない** —— 鍵ゼロのアプリに祝日データ源が無いので、
  /// 「祝日ではない」と読める印を置かない。日曜の閉店注記など、これを読む表示は
  /// 日付の入った旅程を扱う課題(Task 7 以降)が足す。
  public var isWeekend: Bool

  public var id: Int { index }
}

/// 1 日の時間の帯。割合は**必ず合計 1**(ビューは `GeometryReader` の幅を配るので、
/// 足りない合計は黙って消えた時間になる)。
public struct DayTimeBarModel: Equatable, Sendable {

  /// 帯の上に置く印。予約は白丸、衝突は赤い菱形。
  public struct Marker: Identifiable, Equatable, Sendable {
    public enum Kind: String, Sendable { case reservation, conflict }

    public var id: String
    public var kind: Kind
    /// 印が指す場所の名前(読み上げは帯全体の 1 文が持つので、これは表示用の補助)。
    public var label: String
    /// 帯の左端からの位置。0...1。
    public var position: Double
  }

  public var visit: Double
  public var travel: Double
  public var slack: Double
  public var markers: [Marker]
  /// 帯は絵なので、内訳は全部この 1 文が運ぶ。
  public var a11y: String
  /// まだ何も入っていない日。ビューは区間の代わりに「この日はまだ予定がありません」を出す。
  public var isEmpty: Bool
  /// 予約に遅れる・営業時間に収まらない・締切を超える、のどれかがある日。
  public var hasConflict: Bool
}

extension PlannerStore {

  // MARK: - 1. 旅行は成立するか

  /// 結論の 1 文と、状態の絵の名前(`Icon` の rawValue)。
  ///
  /// `checkCount` に課題の件数を渡すのは Web と同じ約束(`useTripDomainModel.tsx:1307-1321`)
  /// —— 「条件付き」の見出しが数える件数と、下の課題カードが数える件数は**同じ数**でなければ
  /// ならない。別々に数えると「2か所だけ確認が必要です」の下に 3 行が並ぶ。
  public var hero: (text: String, icon: String) {
    guard let bundle else { return ("", Self.heroIcon(.UNKNOWN)) }
    return (
      VerdictCopy.hero(
        result: bundle.result,
        fit: bundle.fit,
        plan: bundle.plan,
        locale: request.locale,
        checkCount: issueCount
      ),
      Self.heroIcon(bundle.result.state)
    )
  }

  /// 状態 5 つと絵 5 つの対応(統合仕様 §5.5)。`Icon` は App ターゲットの型なので、
  /// AppCore は rawValue の文字列だけを返す。
  nonisolated static func heroIcon(_ state: FeasibilityState) -> String {
    switch state {
    case .VERIFIED_FEASIBLE: "check"
    case .PROVISIONAL_FEASIBLE: "signal"
    case .FEASIBLE_IF_ASSUMPTIONS: "spark"
    case .INFEASIBLE_HARD_CONFLICT: "close"
    case .UNKNOWN: "search"
    }
  }

  // MARK: - 2. いちばん重い警告 1 件

  /// 出す警告は**常に 1 件だけ**。件数ではなく対象を名指しし、答える一手を 1 つだけ添える。
  ///
  /// 順位は、旅行者が今できることの順:まだ場所が決まっていない > 国が混ざっている >
  /// 同名の候補が残っている > エンジンの結論。前の 3 つは鍵ゼロのアプリが自分で出す ——
  /// Web ではこの 3 つを別の画面が受け持っていたので Kit の `primaryWarning` は知らない。
  public var primaryWarning: (text: String, action: PlanWarningAction?)? {
    guard let bundle else { return nil }
    let locale = request.locale
    let app = AppCopy.for(locale)

    let unresolved = unresolvedInputNames
    if !unresolved.isEmpty { return (app.planUnresolvedWarning(names: unresolved), .fixInput) }

    if !request.mixedCountryCodes.isEmpty {
      return (app.resolveCountryConflict(codes: request.mixedCountryCodes), .chooseCountry)
    }

    let ambiguous = ambiguousInputNames
    if !ambiguous.isEmpty { return (app.planAmbiguousWarning(names: ambiguous), .chooseCandidate) }

    guard let warning = VerdictCopy.primaryWarning(
      result: bundle.result,
      deferredAnchorStops: deferredAnchorStops,
      locale: locale
    ) else { return nil }

    let action = PlanWarningAction(kit: warning.action, stopId: warnedStopId)
    if let text = warning.text { return (text, action) }
    // Kit は「文は無いが行動はある」を返すことがある。計算上限には言うべき 1 文が
    // 別にあるので拾い、それ以外は**黙る** —— 行動だけのボタンは、何に答えるのか読めない。
    if bundle.result.state == .UNKNOWN, bundle.result.unknownCause == .COMPUTATION_LIMIT {
      return (VerdictCopy.minimumDaysCopy(bundle.result, locale: locale), action)
    }
    return nil
  }

  // MARK: - 3. どの日が選ばれ、どれだけ埋まっているか

  public var dayTabs: [DayTabModel] {
    guard let plan = bundle?.plan else { return [] }
    return plan.days.enumerated().map { index, day in
      DayTabModel(
        index: index,
        label: TimelinePresentation.dayTabTitle(index: index, locale: request.locale),
        colorHex: DayPalette.color(forDayIndex: index),
        density: TimelinePresentation.dayTabDensityLabel(stopCount: day.stops.count, locale: request.locale),
        isWeekend: TripPresentation.weekdayInfo(day.date, locale: request.locale)?.isWeekend ?? false
      )
    }
  }

  /// 選んだ日の見出し 1 行と、その下の帯。
  public func dayHeader(_ index: Int) -> (summary: String, bar: DayTimeBarModel) {
    guard let bundle, index >= 0, index < bundle.plan.days.count else {
      return ("", Self.emptyBar(locale: request.locale))
    }
    let day = bundle.plan.days[index]
    let fitDay = bundle.fit.days.first { $0.dayIndex == index }
    return (
      TimelinePresentation.dayHeaderSummary(day: day, fit: fitDay, locale: request.locale),
      dayTimeBar(day: day, fitDay: fitDay)
    )
  }

  /// 日の見出しの左に出す名前。日付を入れた旅なら「2026-08-24(月)」、入れていなければ
  /// 「1日目」のまま —— 決めていない日付を勝手に名乗らない
  /// (`TimelinePresentation.dayDateLabel`)。
  public func dayDateLabel(_ index: Int) -> String {
    let locale = request.locale
    let day = bundle?.plan.days.indices.contains(index) == true ? bundle?.plan.days[index] : nil
    return TimelinePresentation.dayDateLabel(
      date: day?.date,
      label: TimelinePresentation.dayTabTitle(index: index, locale: locale),
      weekdayLabel: TripPresentation.weekdayInfo(day?.date, locale: locale)?.label,
      tripDateTouched: request.tripStartDate != nil,
      locale: locale
    )
  }

  /// 日を選ぶ唯一の入口。範囲の外は端に寄せる —— 無い日を選んだ画面を作らない。
  public func selectDay(_ index: Int) {
    let lastDay = max(0, (bundle?.plan.days.count ?? 1) - 1)
    view.selectedDay = min(max(0, index), lastDay)
  }

  // MARK: - 4. 詳細を開く

  /// 停留所の詳細・日の設定を開く唯一の入口。開いた高さは**毎回いちばん低いところに戻す**
  /// —— 前に全画面まで引き上げたことが、次に軽く覗きたいときの邪魔にならないように。
  ///
  /// タイムラインの行(Task 7)も、地図のピン(Task 8)も、警告の一手(Task 6)もここを
  /// 通る。`view.inspector` を直に書く場所を増やすと、開き方ごとに高さの規則が割れる。
  public func openInspector(_ target: Inspector) {
    view.inspector = target
    view.sheetDetent = .peek
  }

  public func closeInspector() {
    view.inspector = nil
  }

  // MARK: - 5. 空き

  /// その日がどれだけ空いていて、あと何か所入るか。**空いている日にだけ**出す ——
  /// 余裕の無い日に「あと何か所」と誘わない。
  public func spareCapacityLine(_ index: Int) -> String? {
    guard let fitDay = bundle?.fit.days.first(where: { $0.dayIndex == index }), fitDay.slackMinutes > 0 else {
      return nil
    }
    return TimelinePresentation.spareCapacityLine(
      slackMinutes: fitDay.slackMinutes,
      remaining: max(0, fitDay.placeCapacity - fitDay.placeCount),
      locale: request.locale
    )
  }

  // MARK: - 統計行

  /// 「8か所・移動14時間55分・1日分の空き」。数は折り畳んだ詳細が見せるのと同じ合計で、
  /// 別の集計を作らない(`TripPresentation.tripStatsTotals`)。
  public var statsLine: String {
    guard let bundle else { return "" }
    return TripPresentation.tripStatsLine(
      TripPresentation.tripStatsTotals(plan: bundle.plan, fit: bundle.fit),
      locale: request.locale
    )
  }

  // MARK: - 確認したいこと

  /// 種類ごとに 1 行。統合仕様 §5.5 の 8 種のうち、鍵ゼロのアプリで起こる 6 種。
  public var issues: [PlanIssue] {
    guard let bundle else { return [] }
    let locale = request.locale
    let app = AppCopy.for(locale)
    var rows: [PlanIssue] = []

    let unresolved = unresolvedInputNames
    if !unresolved.isEmpty {
      rows.append(PlanIssue(kind: .unresolvedInput, text: app.planUnresolvedWarning(names: unresolved), action: .fixInput))
    }
    if !request.mixedCountryCodes.isEmpty {
      rows.append(PlanIssue(
        kind: .countryConflict,
        text: app.resolveCountryConflict(codes: request.mixedCountryCodes),
        action: .chooseCountry
      ))
    }
    let ambiguous = ambiguousInputNames
    if !ambiguous.isEmpty {
      rows.append(PlanIssue(kind: .ambiguousPlace, text: app.planAmbiguousWarning(names: ambiguous), action: .chooseCandidate))
    }
    let deferred = deferredAnchorStops
    if !deferred.isEmpty {
      rows.append(PlanIssue(
        kind: .deferredAnchor,
        text: app.planDeferredAnchors(names: deferred.map(\.name)),
        action: .openAlternatives
      ))
    }
    let unknownHours = unknownHoursStops
    if let assumption = bundle.result.assumptions.first(where: { $0.code == .OPENING_HOURS_UNKNOWN }), !unknownHours.isEmpty {
      rows.append(PlanIssue(
        kind: .openingHoursUnknown,
        text: VerdictCopy.assumptionCopy(assumption, locale: locale),
        action: PlanWarningAction(kit: .reviewConditions, stopId: unknownHours[0].id)
      ))
    }
    if bundle.result.state == .UNKNOWN, bundle.result.unknownCause == .COMPUTATION_LIMIT {
      rows.append(PlanIssue(
        kind: .computationLimit,
        text: VerdictCopy.minimumDaysCopy(bundle.result, locale: locale),
        action: .removeOptional
      ))
    }
    return rows
  }

  /// 課題の**件数**。行の数ではなく、確かめる対象の数(Web `planIssueCount`
  /// `useTripDomainModel.tsx:1280-1292`)—— 見つからない場所が 3 件なら 3 と数える。
  /// 結論の見出しとこの数は同じ 1 か所から出る。
  public var issueCount: Int {
    guard let bundle else { return 0 }
    return unresolvedInputNames.count
      + deferredAnchorStops.count
      + ambiguousInputNames.count
      + (request.mixedCountryCodes.isEmpty ? 0 : 1)
      + (unknownHoursStops.isEmpty ? 0 : 1)
      + (bundle.result.unknownCause == .COMPUTATION_LIMIT ? 1 : 0)
  }

  // MARK: - 内部

  /// 場所が決まらなかった入力。ビルダーが読めなかった行(`plan.unknownEntries`)と、
  /// 判定が名指しした行(`result.unresolvedPlaceNames`)は普通は同じだが、片方だけに
  /// 残る場合に備えて出現順のまま重複を落とす。
  private var unresolvedInputNames: [String] {
    guard let bundle else { return [] }
    var seen = Set<String>()
    return (bundle.plan.unknownEntries + bundle.result.unresolvedPlaceNames).filter { seen.insert($0).inserted }
  }

  /// 同名の候補が残っている入力。**行の順**(旅行者が書いた順)で並べる。
  private var ambiguousInputNames: [String] {
    request.entries.compactMap { entry in
      if case .review = request.resolutions[entry.id] { return entry.text }
      return nil
    }
  }

  /// 日程に入り切らなかった場所のうち、旅行者が名前で書いたもの。
  private var deferredAnchorStops: [RouteStop] {
    guard let plan = bundle?.plan else { return [] }
    return (plan.deferredUnavailableStops + plan.deferredOptionalStops).filter(\.isAnchor)
  }

  /// 営業時間が分からないまま置かれた場所。営業時間を持たない場所(橋・山・地区)は
  /// 数えない(`PlaceHours.requiresOpeningHours`)。
  private var unknownHoursStops: [RouteStop] {
    guard let plan = bundle?.plan else { return [] }
    var seen = Set<String>()
    return plan.days.flatMap(\.stops).compactMap { built in
      guard built.openingStatus == .unknown,
            PlaceHours.requiresOpeningHours(built.stop),
            seen.insert(built.stop.id).inserted
      else { return nil }
      return built.stop
    }
  }

  /// 警告が名指ししている場所の id。判定は**名前**で対象を挙げるので、旅程の中から
  /// 同じ名前の停留所を引き当てる —— 引き当てられなければ、行き先の無い「確認する」を
  /// 出す代わりに入力へ戻す(`PlanWarningAction(kit:stopId:)`)。
  private var warnedStopId: String? {
    guard let bundle else { return nil }
    let named = bundle.result.primaryConflict?.affectedItems.first
      ?? bundle.result.primaryAttention?.affectedItems.first
    guard let named else { return nil }
    return bundle.plan.days.flatMap(\.stops).first { $0.stop.name == named }?.stop.id
  }

  /// 1 日を帯に直す。数は Kit の `DayPresentationBuilder.numbers`(Web と同じ計算)、
  /// ここがやるのは割合とマーカーだけ。
  private func dayTimeBar(day: BuiltPlanDay, fitDay: TripFitDay?) -> DayTimeBarModel {
    let numbers = DayPresentationBuilder.numbers(DayTimeBarInput(day), fit: fitDay.map(DayTimeBarFit.init))
    let total = Double(numbers.visitMinutes + numbers.travelMinutes + numbers.slackMinutes)
    guard total > 0 else { return Self.emptyBar(locale: request.locale, numbers: numbers) }

    // 最後の 1 つは引き算で出す。3 つを別々に割ると、丸めた合計が 1 に届かない年が来る。
    let visit = Double(numbers.visitMinutes) / total
    let travel = Double(numbers.travelMinutes) / total
    let markers = dayMarkers(day: day, span: total)
    let conflicts = markers.filter { $0.kind == .conflict }.count
    return DayTimeBarModel(
      visit: visit,
      travel: travel,
      slack: 1 - visit - travel,
      markers: markers,
      a11y: Self.barLabel(numbers, markers: markers, locale: request.locale),
      isEmpty: false,
      hasConflict: conflicts > 0 || numbers.overrunMinutes > 0
    )
  }

  /// 帯の上の印。予約(●)と衝突(◆)は同じ停留所に両方付くことがある —— 予約に遅れる
  /// 予約は、予約であることと遅れることの両方を言う。
  private func dayMarkers(day: BuiltPlanDay, span: Double) -> [DayTimeBarModel.Marker] {
    var markers: [DayTimeBarModel.Marker] = []
    let start = ClockTime(day.startTime)?.minutes ?? day.stops.first.flatMap { ClockTime($0.arrival)?.minutes }
    for (index, built) in day.stops.enumerated() {
      let clock = ClockTime(built.fixedTime ?? built.arrival)?.minutes
      let position: Double
      if let start, let clock, span > 0 {
        let elapsed = clock >= start ? clock - start : 1440 - start + clock
        position = min(1, max(0, Double(elapsed) / span))
      } else {
        // 読めない時計で結果の重い印を消さない。等間隔の控えは有限で、訪問の順を保つ。
        position = Double(index + 1) / Double(day.stops.count + 1)
      }
      if built.isReservation {
        markers.append(.init(id: "reservation-\(index)", kind: .reservation, label: built.stop.name, position: position))
      }
      if built.reservationLateMinutes > 0 || Self.conflictStatuses.contains(built.openingStatus) {
        markers.append(.init(id: "conflict-\(index)", kind: .conflict, label: built.stop.name, position: position))
      }
    }
    if day.deadlineOverrunMinutes > 0 {
      markers.append(.init(id: "deadline-conflict", kind: .conflict, label: day.label, position: 1))
    }
    return markers
  }

  /// 「その場所で何かが噛み合っていない」と旅程が言っている状態。帯の赤い菱形
  /// (`dayMarkers`)と地図の注意ピン(`PlannerStore+Map.swift`)は**同じ 3 つ**を見る ——
  /// 別々に数えると、帯に印が立っている日の地図に注意のピンが 1 つも無い、が起こる。
  nonisolated static let conflictStatuses: Set<OpeningStatus> = [.conflict, .closed_day, .last_entry_conflict]

  /// 中身の無い日の帯。合計は 1 のまま(ビューが幅を配れる形)で、`isEmpty` が中身の
  /// 無さを言う。
  private static func emptyBar(locale: PlannerLocale, numbers: DayTimeBarNumbers? = nil) -> DayTimeBarModel {
    let zero = numbers ?? DayPresentationBuilder.numbers(
      DayTimeBarInput(startTime: "00:00", finishTime: "00:00", stops: []),
      fit: nil
    )
    return DayTimeBarModel(
      visit: 0,
      travel: 0,
      slack: 1,
      markers: [],
      a11y: barLabel(zero, markers: [], locale: locale),
      isEmpty: true,
      hasConflict: zero.overrunMinutes > 0
    )
  }

  /// 帯の読み上げ 1 文。分数は画面の他の分数と同じ `TripPresentation.formatDuration` で
  /// 整える —— 同じ 90 分が、目で読むと「1時間30分」、耳で聞くと別の言い方になるのを避ける。
  private static func barLabel(
    _ numbers: DayTimeBarNumbers,
    markers: [DayTimeBarModel.Marker],
    locale: PlannerLocale
  ) -> String {
    func duration(_ minutes: Int) -> String { TripPresentation.formatDuration(minutes: minutes, locale: locale) }
    let reservations = markers.filter { $0.kind == .reservation }.count
    let conflicts = max(markers.filter { $0.kind == .conflict }.count, numbers.overrunMinutes > 0 ? 1 : 0)
    return AppCopy.for(locale).dayTimeBarLabel(
      visit: duration(numbers.visitMinutes),
      travel: duration(numbers.travelMinutes),
      slack: duration(numbers.slackMinutes),
      available: duration(numbers.availableMinutes),
      reservations: reservations,
      conflicts: conflicts
    )
  }
}
