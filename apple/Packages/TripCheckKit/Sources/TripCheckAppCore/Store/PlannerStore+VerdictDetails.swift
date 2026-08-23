import Foundation
import TripCheckKit

/*
 * 「結論の詳細」が読む導出値 —— 旅程の**後ろ**に畳んである根拠(統合仕様 §5.5、
 * docs/product.md「Evidence … are not a dashboard placed before the itinerary」)。
 *
 * ここには 1 つだけ譲れない規則がある:**差分表は生の数で出す。**
 *
 * `TripPresentation.formatDuration` は旅程の時間を人が読む形に整える道具で、90 分を
 * 「1時間30分」にする。差分表に通すと 3 つのことが同時に壊れる —— 件数(重大な衝突 2)が
 * 時間に見え、負の余白(−20分)が 0 に丸められ、比べたい 2 つの数が別の単位で並ぶ。
 * 代替案を選ぶ旅行者が見たいのは「どれだけ変わるか」であって、読みやすい時間ではない
 * (Web `VerdictDetails.tsx:226-242` も同じ理由で生の分を出している)。
 */

/// 代替案 1 件。**採るのも編集**なので、`apply` はそのまま `PlannerStore.applyAlternative`
/// に渡す —— ビューが `TripCounterfactual` を組み立て直す口を持たない。
public struct AlternativeModel: Identifiable, Sendable {
  public var id: String
  /// `VerdictCopy.alternativeCopy(_:locale:).title`。
  public var title: String
  /// `TripScenarioMetrics` の 6 欄。並びは `AppCopy.diffLabels` と 1 対 1。
  public var diff: [(label: String, before: String, after: String)]
  /// 何を差し出すことになるか(`VerdictCopy.alternativeLossCopy`)。差し出すものが無ければ `nil`。
  public var lossLine: String?
  public var apply: TripCounterfactual
}

/// 貼り付けた旅程だけが出す比較カード 1 枚。
public struct VerdictComparisonCard: Identifiable, Sendable {
  public var id: String
  public var label: String
  /// この案が何をするか。案が無いときは「無い」と言う 1 行(空欄にしない)。
  public var detail: String
  public var rows: [(label: String, value: String)]
}

/// 「結論の詳細」1 枚ぶん。
public struct VerdictDetailsModel: Sendable {
  /// 日数のステッパー。範囲はエンジンが受け取る範囲そのもの(`EngineConstants.tripDaysRange`)。
  public var daysStepper: (value: Int, min: Int, max: Int)
  /// 重要情報の 3 つの数。**判定の `criticalFacts` そのまま**で、ここで数え直さない。
  public var factCounts: (verified: Int, estimated: Int, unknown: Int)
  /// この地域をどこまで確かめてあるか。
  public var coverage: (label: String, hasUnknown: Bool)
  /// 元の案・最小修正版・移動を減らす案。貼り付けた旅程のときだけ。
  public var comparison: (original: VerdictComparisonCard, minimalRepair: VerdictComparisonCard, shortest: VerdictComparisonCard)?
  /// 比較できる変更案。**3 件まで。**
  public var alternatives: [AlternativeModel]
  public var assumptions: [String]
  public var attentions: [String]
}

extension PlannerStore {

  /// 一度に見せる代替案の数。全部並べると、旅行者は「どれを選ぶか」を選ばされる
  /// (Web は一覧に全部出すが、iPhone の 1 画面では 3 枚が限度)。
  public static let alternativeLimit = 3

  public var verdictDetails: VerdictDetailsModel {
    let locale = request.locale
    let app = AppCopy.for(locale)
    let days = request.tripDays ?? edit.tripDays
    let profile = CoverageProfile.forLocation(destination: bundle?.plan.destination ?? planningDestinationId)
    let stepper = (
      value: days,
      min: EngineConstants.tripDaysRange.lowerBound,
      max: EngineConstants.tripDaysRange.upperBound
    )
    let coverage = (
      label: profile.label[locale] ?? profile.label[.en] ?? "",
      hasUnknown: CoverageProfile.hasUnknownRegionalCoverage(profile)
    )
    guard let bundle else {
      return VerdictDetailsModel(
        daysStepper: stepper,
        factCounts: (0, 0, 0),
        coverage: coverage,
        comparison: nil,
        alternatives: [],
        assumptions: [],
        attentions: []
      )
    }
    let facts = bundle.result.criticalFacts
    return VerdictDetailsModel(
      daysStepper: stepper,
      factCounts: (facts.verified, facts.estimated, facts.unknown),
      coverage: coverage,
      comparison: existingItineraryComparison(bundle, locale: locale),
      alternatives: bundle.result.alternatives.prefix(Self.alternativeLimit).map { alternative in
        AlternativeModel(
          id: alternative.id,
          title: VerdictCopy.alternativeCopy(alternative, locale: locale).title,
          diff: Self.diffRows(before: alternative.before, after: alternative.after, copy: app),
          lossLine: VerdictCopy.alternativeLossCopy(alternative, locale: locale),
          apply: alternative
        )
      },
      assumptions: bundle.result.assumptions.map { VerdictCopy.assumptionCopy($0, locale: locale) },
      attentions: Self.attentions(bundle.plan, text: Copy.for(locale))
    )
  }

  // MARK: - 差分表

  /// `TripScenarioMetrics` の 6 欄を、そのままの数で 2 列に並べる。
  ///
  /// 「—」は最小余白が**測れていない**ときの印で、0 分ではない —— 場所の入っていない日
  /// しかない案には最小余白という数が存在しない。0 と書くと「余裕がぴったり無い」に読める。
  static func diffRows(
    before: TripScenarioMetrics,
    after: TripScenarioMetrics,
    copy: AppCopy
  ) -> [(label: String, before: String, after: String)] {
    let labels = copy.diffLabels
    guard labels.count == 6 else { return [] }
    func minutes(_ value: Int) -> String { copy.minutesShort(value) }
    func slack(_ value: Int?) -> String { value.map { minutes($0) } ?? "—" }
    return [
      (labels[0], String(before.hardConflictCount), String(after.hardConflictCount)),
      (labels[1], minutes(before.overrunMinutes), minutes(after.overrunMinutes)),
      (labels[2], minutes(before.travelMinutes), minutes(after.travelMinutes)),
      (labels[3], slack(before.minimumSlackMinutes), slack(after.minimumSlackMinutes)),
      (labels[4], String(before.scheduledStopCount), String(after.scheduledStopCount)),
      (labels[5], String(before.dayCount), String(after.dayCount)),
    ]
  }

  // MARK: - 3 つの見方(貼り付けた旅程だけ)

  /// Web `VerdictDetails.tsx:130-206` と同じ 3 枚。順位表も、「完全に直る案」を先に探して
  /// 無ければ最も軽い案に落ちるところも同じ —— 直りきらない案を「最小修正版」と名乗らせない
  /// ために、題は結果で変える。
  private func existingItineraryComparison(
    _ bundle: BuiltPlanBundle,
    locale: PlannerLocale
  ) -> (original: VerdictComparisonCard, minimalRepair: VerdictComparisonCard, shortest: VerdictComparisonCard)? {
    guard bundle.plan.inputMode == .existing_itinerary else { return nil }
    let app = AppCopy.for(locale)
    let alternatives = bundle.result.alternatives
    let shortest = alternatives.first { $0.kind == .OPTIMIZE_ORDER }
    let corrective = alternatives
      .filter { $0.kind != .OPTIMIZE_ORDER }
      .sorted { left, right in
        let leftRank = Self.repairRank(left.kind)
        let rightRank = Self.repairRank(right.kind)
        return leftRank == rightRank ? left.id < right.id : leftRank < rightRank
      }
    let completeRepair = corrective.first { $0.after.hardConflictCount == 0 && $0.after.overrunMinutes == 0 }
    let minimal = completeRepair ?? corrective.first

    // 「元の案」の数は旅程そのものから測る。代替案の `before` を借りると、代替案が 1 件も
    // 無い旅程で 3 枚目の列が空になる。
    let populated = bundle.fit.days.filter { $0.placeCount > 0 }
    let current = (
      conflicts: bundle.plan.scheduleConflictCount + bundle.plan.deferredUnavailableStops.count,
      travel: TripPresentation.builtPlanTravelMinutes(bundle.plan),
      slack: populated.isEmpty ? nil : populated.map(\.slackMinutes).min()
    )

    func card(id: String, label: String, detail: String, alternative: TripCounterfactual?) -> VerdictComparisonCard {
      let metrics = alternative.map {
        (conflicts: $0.after.hardConflictCount, travel: $0.after.travelMinutes, slack: $0.after.minimumSlackMinutes)
      } ?? current
      return VerdictComparisonCard(
        id: id,
        label: label,
        detail: detail,
        rows: [
          (app.diffLabels[0], String(metrics.conflicts)),
          (app.diffLabels[2], app.minutesShort(metrics.travel)),
          (app.diffLabels[3], metrics.slack.map { app.minutesShort($0) } ?? "—"),
        ]
      )
    }

    return (
      original: card(id: "original", label: app.comparisonOriginal, detail: app.comparisonOriginalDetail, alternative: nil),
      minimalRepair: card(
        id: "minimal",
        label: completeRepair != nil ? app.comparisonMinimalRepair : app.comparisonMinimalImprovement,
        detail: minimal.map { VerdictCopy.alternativeCopy($0, locale: locale).title }
          ?? (current.conflicts == 0 ? app.comparisonNoRepairNeeded : app.comparisonNoRepair),
        alternative: minimal
      ),
      shortest: card(
        id: "shortest",
        label: app.comparisonShortest,
        detail: shortest.map { VerdictCopy.alternativeCopy($0, locale: locale).title } ?? app.comparisonNoShortest,
        alternative: shortest
      )
    )
  }

  /// Web `VerdictDetails.tsx:132-140`。「軽い変更ほど先」——旅行者に頼むことが少ない順。
  private static func repairRank(_ kind: CounterfactualKind) -> Int {
    switch kind {
    case .START_EARLIER: 0
    case .END_LATER: 1
    case .CHANGE_MODE: 2
    case .CHANGE_DAYS: 3
    case .CHANGE_BASE: 4
    case .REMOVE_OPTIONAL: 5
    case .OPTIMIZE_ORDER: 6
    }
  }

  // MARK: - その他の注意

  /// 旅程には出てこないが言っておくべきこと。鍵ゼロのアプリでは 3 種だけ ——
  /// 提供元の失敗もホテルの取得失敗も、提供元を呼ばない経路には現れない。
  private static func attentions(_ plan: BuiltTripPlan, text: PlannerCopy) -> [String] {
    var lines: [String] = []
    if plan.overCapacityCount > 0 { lines.append(text.overCapacity) }
    // 落ちた理由は 2 つある。休業で入れなかったのか、ペースに収まらなかったのか —— 一緒に
    // すると、営業していれば入れた場所を「詰め込みすぎ」と読み違える。
    lines += plan.deferredUnavailableStops.map { "\($0.name) — \(text.excludedClosed)" }
    lines += plan.deferredOptionalStops.map { "\($0.name) — \(text.excludedPace)" }
    return lines
  }

  /// 旅程が組み上がる前に地域の対応を引くための行き先。
  private var planningDestinationId: DestinationId? {
    guard case .destination(let id) = request.destination else { return nil }
    return id
  }
}
