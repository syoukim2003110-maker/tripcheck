import Foundation

/*
 * v1.1 TC-007 / §8.2:候補の計画が今の計画に比べて**新しく**壊す約束の検出器。守られた編集の
 * 経路(除去・移動・日数・レグの手段・滞在時間・最終入場・日の窓・ホテル交換)は全部この 1 つを通る。
 *
 * 移植元:`lib/planner-app-state.ts:228-419`(`PlannerHardEditConflict`、`HardConstraintKind`、
 * `HardConstraintFact`、`dayDeadlinePosition`、`hardConstraintSnapshot`、
 * `HARD_CONFLICT_SENTENCE_KIND`、`plannerHardEditConflicts`、`evaluatePlannerHardEdit`)と
 * `lib/presentation/planner-copy.ts:857-903`(6 種の文と、遅れの題)。
 *
 * かつては 3 つの約束を 2 つの累計で見ていて、そのために 2 つの本物の欠陥を抱えた(TS `:232-243`):
 *
 *   * 締切の超過が日と種類をまたいで足し合わされていたので、ある日の 90 分の門限超過を直して
 *     別の日に 30 分の空港超過を作る候補が「60 分の改善」に見え、黙って適用された。飛行機は
 *     算術平均を待たない。
 *   * 営業時間は一切見ていなかった。日の開始を検証済みの閉店時刻より後へ動かすと、衝突を抱えた
 *     計画が確認なしで出来上がった —— 起こり得ない予定を旅行者に見せていた。
 *
 * 事実はキーを持ち、比較はキーごとに起きる。何も他の何かと相殺せず、`unknown` の営業窓が
 * 検証済みの衝突へ昇格することもない。
 */

/// TS `HardEditConflictKind`(`lib/presentation/planner-copy.ts:859-865`)。
/// `case` 名は TS のユニオン文字列そのまま(Global Constraints の raw value 規則)。
public enum HardEditConflictKind: String, Codable, Sendable, CaseIterable {
  case booking_late
  case must_drop
  case airport_cutoff
  case day_end_missed
  case opening_closed
  case last_entry_missed
}

/// TS `PlannerHardEditConflict`(`lib/planner-app-state.ts:247-251`)。
public struct PlannerHardEditConflict: Equatable, Sendable {
  public var kind: HardEditConflictKind
  public var message: String
  public var minutes: Int

  public init(kind: HardEditConflictKind, message: String, minutes: Int) {
    self.kind = kind
    self.message = message
    self.minutes = minutes
  }
}

/// TS `PlannerHardEditEvaluation`(`lib/planner-app-state.ts:380-382`)。
///
/// TS は `apply` に `travelDeltaMinutes`(`builtPlanTravelMinutes` の差)を載せるが、Swift は
/// **余裕の差**を載せる:spec §5.1 のトーストは「昼食を追加しました 余裕 −45分 元に戻す」で、
/// これは TS `planImpactMetrics.bufferDeltaMinutes`(`lib/recommendation-impact.ts:149-161`、
/// `totalPlanBufferMinutes` の差)そのもの。移動の差が要る呼び出し側は
/// `PlannerEdits.builtPlanTravelMinutes` を 2 回引けばよい(TS も画面側ではその関数を直に使う)。
public enum HardEditDecision: Equatable, Sendable {
  case apply(bufferDeltaMinutes: Int)
  case confirm([PlannerHardEditConflict])
}

/// v1.1 TC-007 の確認文。守られた編集はどれもこの文を共有するので、変更がレグの手段から来ても
/// 滞在時間から来ても最終入場から来ても日の窓から来ても、ダイアログは同じ読み心地になる。
///
/// `lib/presentation/planner-copy.ts:867-903` の 2 関数だけをここに置く(判定文・UI コピーの
/// 本体は Task 24 の `Presentation/`)。**Task 24 はこれを再移植せず、ここから使うこと。**
public enum HardEditCopy {

  /// TS `hardEditConflictSentence`(`lib/presentation/planner-copy.ts:867-895`)。
  public static func conflictSentence(
    _ kind: HardEditConflictKind,
    name: String,
    minutes: Int,
    locale: PlannerLocale
  ) -> String {
    switch kind {
    case .booking_late:
      return locale == .ja ? "「\(name)」の予約に\(minutes)分遅れます" : "You would be \(minutes) minutes late for “\(name)”"
    case .must_drop:
      return locale == .ja ? "必須の「\(name)」が日程に入らなくなります" : "Must-visit “\(name)” would no longer fit the plan"
    // 日の終了時刻と空港の締切は別の約束。かつては 1 つの文と 1 つの累計を共有していたので、
    // 空港超過が無関係な門限の改善に隠れ、門限の超過が「乗り遅れ」として告げられていた。
    case .day_end_missed:
      return locale == .ja ? "その日の終了時刻を\(minutes)分超えます" : "That day would run \(minutes) minutes past its end time"
    case .opening_closed:
      return locale == .ja ? "「\(name)」の営業時間から外れます" : "“\(name)” would fall outside its opening hours"
    case .last_entry_missed:
      return locale == .ja ? "「\(name)」の最終入場に間に合わなくなります" : "You would arrive after the last entry for “\(name)”"
    case .airport_cutoff:
      return locale == .ja ? "空港へ向かう締切を\(minutes)分超えます" : "The airport cutoff would be missed by \(minutes) minutes"
    }
  }

  /// TS `hardEditBookingDelayTitle`(`lib/presentation/planner-copy.ts:899-903`)。
  /// Copy Deck confirm.delay.title:新しい損傷が 1 件の予約遅れだけなら、題は遅れそのものを述べる。
  public static func bookingDelayTitle(_ minutes: Int, locale: PlannerLocale) -> String {
    locale == .ja ? "この変更で予約に\(minutes)分遅れます" : "This change makes you \(minutes) minutes late"
  }
}

// MARK: - 事実のキー付け

/// TS `HardConstraintKind`(`lib/planner-app-state.ts:253`)。
private enum HardConstraintKind: String {
  case booking, must, opening, last_entry, airport, day_deadline
}

/// TS `HardConstraintFact`(`lib/planner-app-state.ts:255-262`)。
private struct HardConstraintFact {
  enum Status: String {
    case ok, conflict, unknown
  }

  var key: String
  var kind: HardConstraintKind
  var status: Status
  var minutes: Int
  var stopId: String
  var label: String
}

/// TS の `Map<string, HardConstraintFact>` は**挿入順**で回る。Swift の `Dictionary` は順序を
/// 持たないので、順番を持つ薄い箱にする —— 衝突の並びが実行ごとに変わってはならない(決定性)。
/// JS の `Map.set` は既にあるキーの位置を動かさないので、上書きも同じ振る舞いにしてある。
private struct HardConstraintSnapshot {
  private var order: [String] = []
  private var facts: [String: HardConstraintFact] = [:]

  /// TS `record`(`lib/planner-app-state.ts:279-286`)。1 つの停留所は 1 度しか現れないはずだが、
  /// もし 2 度現れたら、比較の相手として正直なのは悪いほうの読み。
  mutating func record(_ fact: HardConstraintFact) {
    if let existing = facts[fact.key] {
      if existing.status == .conflict && fact.status != .conflict { return }
      if existing.status == fact.status && existing.minutes >= fact.minutes { return }
      facts[fact.key] = fact
      return
    }
    order.append(fact.key)
    facts[fact.key] = fact
  }

  var values: [HardConstraintFact] { order.compactMap { facts[$0] } }

  subscript(key: String) -> HardConstraintFact? { facts[key] }

  func has(_ key: String) -> Bool { facts[key] != nil }
}

/// TS `dayDeadlinePosition`(`lib/planner-app-state.ts:271-275`)。
///
/// キーは停留所に紐づくものから意図的に日の添字を外している:日数の変更は停留所を日から日へ
/// 動かすし、既にある衝突を抱えた停留所が新しい日へ移ることは新しい損傷ではない。日の締切が
/// 数ではなく位置なのも同じ理由 —— 出発の日は、旅が 2 日でも 4 日でも「最後の日」。
private func dayDeadlinePosition(_ index: Int, _ dayCount: Int) -> String {
  if index == 0 { return "first" }
  if index == dayCount - 1 { return "last" }
  return String(index)
}

/// TS `hardConstraintSnapshot`(`lib/planner-app-state.ts:277-335`)。
private func hardConstraintSnapshot(_ plan: BuiltTripPlan) -> HardConstraintSnapshot {
  var facts = HardConstraintSnapshot()
  for (dayIndex, planDay) in plan.days.enumerated() {
    for built in planDay.stops {
      let stopId = built.stop.id
      let label = built.stop.name
      if built.isReservation || built.fixedTime != nil {
        facts.record(HardConstraintFact(
          key: "booking:\(stopId)",
          kind: .booking,
          status: built.reservationLateMinutes > 0 ? .conflict : .ok,
          minutes: built.reservationLateMinutes,
          stopId: stopId,
          label: label
        ))
      }
      if built.priority == .must {
        facts.record(HardConstraintFact(key: "must:\(stopId)", kind: .must, status: .ok, minutes: 0, stopId: stopId, label: label))
      }
      if built.openingStatus == .last_entry_conflict {
        facts.record(HardConstraintFact(
          key: "last_entry:\(stopId)",
          kind: .last_entry,
          status: .conflict,
          minutes: 0,
          stopId: stopId,
          label: label
        ))
      } else {
        facts.record(HardConstraintFact(
          key: "opening:\(stopId)",
          kind: .opening,
          // `unknown` は「検証済みの窓が存在しない」の意味。そのまま `unknown` に留まる:
          // 未検証の場所が「営業時間を破ろうとしている」と主張する確認ダイアログを立ててはならない。
          status: {
            switch built.openingStatus {
            case .conflict, .closed_day: .conflict
            case .unknown: .unknown
            default: .ok
            }
          }(),
          minutes: 0,
          stopId: stopId,
          label: label
        ))
      }
    }
    let overrun = max(0, planDay.deadlineOverrunMinutes)
    guard let deadlineKind = planDay.deadlineKind else { continue }
    let airport = deadlineKind == .airport
    facts.record(HardConstraintFact(
      key: "\(airport ? "airport" : "day_deadline"):\(dayDeadlinePosition(dayIndex, plan.days.count))",
      kind: airport ? .airport : .day_deadline,
      status: overrun > 0 ? .conflict : .ok,
      minutes: overrun,
      stopId: "",
      label: ""
    ))
  }
  return facts
}

/// TS `HARD_CONFLICT_SENTENCE_KIND`(`lib/planner-app-state.ts:337-343`)。
private func sentenceKind(for kind: HardConstraintKind) -> HardEditConflictKind? {
  switch kind {
  case .booking: .booking_late
  case .opening: .opening_closed
  case .last_entry: .last_entry_missed
  case .airport: .airport_cutoff
  case .day_deadline: .day_end_missed
  case .must: nil   // TS は `Exclude<HardConstraintKind, "must">` で型から外している
  }
}

// MARK: - 判定

extension PlannerEdits {

  /// TS `plannerHardEditConflicts`(`lib/planner-app-state.ts:345-378`)。
  ///
  /// `locale` の既定は `.ja`(TS には既定が無く、呼び出し側が必ず旅の言語を渡す)。Plan 2 の
  /// 呼び出し側は必ず明示すること —— 既定に頼ると英語の旅に日本語の文が出る。
  public static func hardEditConflicts(
    before plan: BuiltTripPlan,
    after candidatePlan: BuiltTripPlan,
    locale: PlannerLocale = .ja,
    allowDropStopId: String? = nil
  ) -> [PlannerHardEditConflict] {
    var conflicts: [PlannerHardEditConflict] = []
    let before = hardConstraintSnapshot(plan)
    let after = hardConstraintSnapshot(candidatePlan)

    for fact in before.values {
      guard fact.kind == .must, fact.stopId != allowDropStopId, !after.has(fact.key) else { continue }
      conflicts.append(PlannerHardEditConflict(
        kind: .must_drop,
        message: HardEditCopy.conflictSentence(.must_drop, name: fact.label, minutes: 0, locale: locale),
        minutes: 0
      ))
    }

    for fact in after.values {
      guard fact.kind != .must, fact.status == .conflict, let kind = sentenceKind(for: fact.kind) else { continue }
      // 既にあって悪化もしていない衝突は新しい損傷ではない。旅行者にはもう伝えてある。
      if let baseline = before[fact.key], baseline.status == .conflict, fact.minutes <= baseline.minutes { continue }
      conflicts.append(PlannerHardEditConflict(
        kind: kind,
        message: HardEditCopy.conflictSentence(kind, name: fact.label, minutes: fact.minutes, locale: locale),
        minutes: fact.minutes
      ))
    }
    return conflicts
  }

  /// TS `evaluatePlannerHardEdit`(`lib/planner-app-state.ts:390-419`)。守られた編集の全部が
  /// 通る「まず試し、それから訊く」の 1 つの判断:綺麗な候補は即座に適用し、**新しい**損傷だけが
  /// 確認ダイアログを立てる。
  ///
  /// TS との差:
  ///   * TS は `plan`/`candidatePlan` が `null` の場合を持つ(`:399-402`)。Swift は非オプショナル
  ///     なので、その分岐は呼び出し側の `if let` に置き換わる。
  ///   * TS の `title` / `extraConflicts` は画面側の文字列合成。ここでは決定そのものだけを返し、
  ///     題の規則(`:411-417`)は `confirmTitle` に分けた。
  ///   * `apply` に載るのは移動時間ではなく余裕の差(`HardEditDecision` の但し書き)。
  ///
  /// `candidateContext` は日の窓を動かす編集のためにある(`dayEndTimes` が変わると同じ計画でも
  /// 余裕が変わる)。省略時は `context` と同じ = 文脈を変えない編集。
  public static func evaluate(
    before plan: BuiltTripPlan,
    after candidatePlan: BuiltTripPlan,
    context: PlannerContext,
    candidateContext: PlannerContext? = nil,
    locale: PlannerLocale = .ja,
    allowDropStopId: String? = nil
  ) -> HardEditDecision {
    let conflicts = hardEditConflicts(
      before: plan,
      after: candidatePlan,
      locale: locale,
      allowDropStopId: allowDropStopId
    )
    if conflicts.isEmpty {
      return .apply(bufferDeltaMinutes:
        TripScenarios.totalPlanBufferMinutes(plan: candidatePlan, context: candidateContext ?? context)
          - TripScenarios.totalPlanBufferMinutes(plan: plan, context: context))
    }
    // TS `:404` の `new Set` — 同じ文を 2 度読ませない。最初の 1 件の位置を保つ。
    var seen = Set<String>()
    return .confirm(conflicts.filter { seen.insert($0.message).inserted })
  }

  /// TS `evaluatePlannerHardEdit` の題の規則(`lib/planner-app-state.ts:411-417`)。新しい損傷が
  /// ちょうど 1 件の予約遅れのときだけ、ダイアログの題は Copy Deck の遅れの文になる。他の衝突が
  /// 1 つでも(呼び出し側が足した `extraConflicts` を含めて)あれば、呼び出し側の疑問形が残る。
  ///
  /// TS は `hardConflicts`(**重複排除前**)を数えるので、`hardEditConflicts` の戻りをそのまま
  /// 渡すのが TS と同じ入力。`evaluate` の `.confirm` は文の重複を除いた列を運ぶため、そちらを
  /// 渡すと「同じ文の 2 件」が 1 件に見える —— 予約遅れの文は分数を含んで一意なので実際に差は
  /// 出ないが、TS と厳密に同じ数を数えたい呼び出し側は `hardEditConflicts` の戻りを使うこと。
  public static func confirmTitle(
    conflicts: [PlannerHardEditConflict],
    extraConflicts: [String] = [],
    fallback: String,
    locale: PlannerLocale = .ja
  ) -> String {
    guard extraConflicts.isEmpty, conflicts.count == 1, let only = conflicts.first, only.kind == .booking_late else {
      return fallback
    }
    return HardEditCopy.bookingDelayTitle(only.minutes, locale: locale)
  }
}
