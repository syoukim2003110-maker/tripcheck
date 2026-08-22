import Foundation

/*
 * 反実仮想 —— 「こうしていたらどうなったか」を**実際に組み直して**測る層。
 *
 * lib/trip-scenarios.ts:430-706 —— `scenarioMetrics` `:430`、`improvementBetween` `:448`、
 * `qualifiesHotelBaseChange` `:464`、`improvesFeasibility` `:477`、`shiftClock` `:486`、
 * `generateTripCounterfactuals` `:498-706`。
 *
 * もっともらしく聞こえるという理由だけで札を「直し方」として出すことはしない。どの項目も
 * 自分の before/after と失うものを一緒に持ってくる。
 */
extension TripScenarios {

  // MARK: - 指標

  /// TS `scenarioMetrics` (`lib/trip-scenarios.ts:430-446`)
  static func scenarioMetrics(_ plan: BuiltTripPlan, fit: TripFitAssessment) -> TripScenarioMetrics {
    let populatedDays = fit.days.filter { $0.placeCount > 0 }
    return TripScenarioMetrics(
      hardConflictCount: plan.scheduleConflictCount + plan.deferredUnavailableStops.count,
      overrunMinutes: fit.days.reduce(0) { $0 + $1.overrunMinutes }
        + plan.days.reduce(0) { sum, day in sum + day.stops.reduce(0) { $0 + $1.reservationLateMinutes } },
      minimumSlackMinutes: populatedDays.isEmpty ? nil : populatedDays.map(\.slackMinutes).min(),
      scheduledStopCount: plan.scheduledStopCount,
      dayCount: plan.requestedDays,
      travelMinutes: plan.days.reduce(0) { total, day in
        total + day.legs.reduce(0) { $0 + $1.comparison.recommended.minutes } + (day.hotelTravelMinutes ?? 0)
      }
    )
  }

  /// TS `improvementBetween` (`lib/trip-scenarios.ts:448-462`)
  static func improvementBetween(_ before: TripScenarioMetrics, _ after: TripScenarioMetrics) -> TripCounterfactual.Improvement {
    TripCounterfactual.Improvement(
      hardConflictsRemoved: before.hardConflictCount - after.hardConflictCount,
      overrunMinutesReduced: before.overrunMinutes - after.overrunMinutes,
      slackMinutesGained: before.minimumSlackMinutes == nil || after.minimumSlackMinutes == nil
        ? nil
        : after.minimumSlackMinutes! - before.minimumSlackMinutes!,
      travelMinutesReduced: before.travelMinutes - after.travelMinutes
    )
  }

  /// TS `qualifiesHotelBaseChange` (`lib/trip-scenarios.ts:464-475`) — ホテル/拠点の変更を出してよいかの
  /// プロダクト側の門。候補の指標は必ず完全な決定的再構築から来ていなければならない。幾何学的な
  /// 距離だけでは旅行者に見せる主張の根拠にならない。
  ///
  /// TS の `Number.isFinite` 判定 2 つは、Swift の `Int` が常に有限なので落としてある
  /// (`TripScenarioMetrics.travelMinutes` は Task 16 が `Int` で定義済み。TS 側も実際に入るのは
  /// 分の整数和だけ)。
  public static func qualifiesHotelBaseChange(before: TripScenarioMetrics, after: TripScenarioMetrics) -> Bool {
    if after.hardConflictCount < before.hardConflictCount { return true }
    let minutesSaved = before.travelMinutes - after.travelMinutes
    if minutesSaved <= 0 { return false }
    if minutesSaved >= 60 { return true }
    return before.travelMinutes > 0 && minutesSaved * 100 >= before.travelMinutes * 15
  }

  /// TS `improvesFeasibility` (`lib/trip-scenarios.ts:477-484`) — 衝突↓ → 超過↓ → 最小余裕↑ → 移動↓ の順。
  static func improvesFeasibility(_ before: TripScenarioMetrics, _ after: TripScenarioMetrics) -> Bool {
    if after.hardConflictCount != before.hardConflictCount { return after.hardConflictCount < before.hardConflictCount }
    if after.overrunMinutes != before.overrunMinutes { return after.overrunMinutes < before.overrunMinutes }
    // TS の `?? Number.NEGATIVE_INFINITY`。`Int.min` が同じ役目を果たす(実際の余裕は分なので届かない)。
    let beforeSlack = before.minimumSlackMinutes ?? Int.min
    let afterSlack = after.minimumSlackMinutes ?? Int.min
    if afterSlack != beforeSlack { return afterSlack > beforeSlack }
    return after.travelMinutes < before.travelMinutes
  }

  /// TS `shiftClock` (`lib/trip-scenarios.ts:486-491`)。`clockMinutes` が読めない文字列はそのまま返す。
  /// 0 と 23:59 で頭打ちにするので、`ClockTime(minutes:)` の 1440 折り返しは使えない。
  static func shiftClock(_ value: String, _ minutes: Int) -> String {
    guard let parsed = ClockTime(value)?.minutes else { return value }
    let shifted = max(0, min(23 * 60 + 59, parsed + minutes))
    return String(format: "%02d:%02d", shifted / 60, shifted % 60)
  }

  // MARK: - 反実仮想

  /// TS `kindRank` (`lib/trip-scenarios.ts:660-668`) — 同点になった候補をどの順で見せるか。
  ///
  /// TS は `Record<Kind, number>` なので全キーが揃っているかは型が保証する。Swift の辞書引きは
  /// `Int?` を返し、`?? 0` の既定値が「新しい種を足したのに順位を書き忘れた」を静かに
  /// CHANGE_DAYS と同順に落としてしまう。網羅 `switch` なら同じ書き忘れがコンパイルエラーになる。
  static func kindRank(_ kind: CounterfactualKind) -> Int {
    switch kind {
    case .CHANGE_DAYS: return 0
    case .START_EARLIER: return 1
    case .END_LATER: return 2
    case .REMOVE_OPTIONAL: return 3
    case .CHANGE_BASE: return 4
    case .CHANGE_MODE: return 5
    case .OPTIMIZE_ORDER: return 6
    }
  }

  /// TS `generateTripCounterfactuals` (`lib/trip-scenarios.ts:498-706`)。
  ///
  /// 実際に組み直して現在の計画と比べたものだけを返す。
  ///
  /// `options` は中で回す `assessTripFit` にそのまま渡る。既定のままだと実時計と 1 秒の予算で
  /// 測ることになり、機械が忙しいだけで候補が消える(予算切れの `fit` は比較対象から外れる)
  /// —— spec §3.1 の「同期・決定論」に反するので、時計を差し替える口をここにも開けておく。
  public static func counterfactuals(
    _ request: TripRequest,
    plan currentPlan: BuiltTripPlan? = nil,
    fit currentFit: TripFitAssessment? = nil,
    options: TripFitSearchOptions = TripFitSearchOptions()
  ) -> [TripCounterfactual] {
    let raw = request.raw
    let requestedDays = request.days
    let pace = request.pace
    let locale = request.locale
    let context = request.context

    func build(_ days: Int, _ context: PlannerContext) -> BuiltTripPlan {
      TripBuilder.build(TripRequest(raw: raw, days: days, pace: pace, locale: locale, context: context))
    }

    let plan = currentPlan ?? build(requestedDays, context)
    let fit = currentFit ?? assessTripFit(request, plan: plan, options: options)
    if fit.status == .incomplete || fit.status == .timed_out { return [] }
    let before = scenarioMetrics(plan, fit: fit)
    var candidates: [TripCounterfactual] = []

    /// TS `compare` (`lib/trip-scenarios.ts:508-527`)
    func compare(
      _ id: String,
      _ kind: CounterfactualKind,
      nextDays: Int,
      nextContext: PlannerContext,
      change: TripCounterfactual.Change,
      loss: TripCounterfactual.Loss? = nil,
      alwaysComparable: Bool = false,
      eligibility: ((TripScenarioMetrics, TripScenarioMetrics) -> Bool)? = nil
    ) {
      let nextPlan = build(nextDays, nextContext)
      let nextFit = assessTripFit(
        TripRequest(raw: raw, days: nextDays, pace: pace, locale: locale, context: nextContext),
        plan: nextPlan,
        options: options
      )
      if nextFit.status == .incomplete || nextFit.status == .timed_out { return }
      let after = scenarioMetrics(nextPlan, fit: nextFit)
      if let eligibility, !eligibility(before, after) { return }
      if !alwaysComparable && !improvesFeasibility(before, after) { return }
      candidates.append(TripCounterfactual(
        id: id,
        kind: kind,
        change: change,
        before: before,
        after: after,
        improvement: improvementBetween(before, after),
        loss: loss
      ))
    }

    // TS `:529-539` — 最短日数がいまの日数と違うなら、必ず比較として出す。
    if let minimumDays = fit.minimumDays, minimumDays != fit.requestedDays {
      compare(
        "use-minimum-days",
        .CHANGE_DAYS,
        nextDays: minimumDays,
        nextContext: context,
        change: .init(days: minimumDays, dayDelta: minimumDays - fit.requestedDays),
        alwaysComparable: true
      )
    }

    // TS `:541-568` — 圧が掛かっているときだけ、朝を 1 時間早める / 夜を 1 時間延ばす。
    let hasPressure = before.hardConflictCount > 0 || before.overrunMinutes > 0
    if hasPressure {
      let earlierDefault = shiftClock(context.defaultDayStart ?? EngineConstants.defaultDayStart.description, -60)
      var earlierContext = context
      earlierContext.defaultDayStart = earlierDefault
      earlierContext.dayStartTimes = IntKeyedDictionary(Dictionary(uniqueKeysWithValues: (0..<max(0, requestedDays)).map { dayIndex in
        (dayIndex, shiftClock(context.dayStartTimes?[dayIndex] ?? context.defaultDayStart ?? EngineConstants.defaultDayStart.description, -60))
      }))
      compare("start-60-min-earlier", .START_EARLIER, nextDays: requestedDays, nextContext: earlierContext, change: .init(minutes: 60))

      var laterContext = context
      laterContext.dayEndTimes = IntKeyedDictionary(Dictionary(uniqueKeysWithValues: (0..<max(0, requestedDays)).map { dayIndex in
        (dayIndex, shiftClock(dayEnd(context, dayIndex), 60))
      }))
      compare("end-60-min-later", .END_LATER, nextDays: requestedDays, nextContext: laterContext, change: .init(minutes: 60))
    }

    // TS `:570-583` — まだ外れていない optional を 1 つ外してみる。
    let alreadyDeferred = Set(plan.deferredOptionalStops.map(\.id))
    if let optional = fit.cutCandidates.first(where: { $0.priority == .optional && !alreadyDeferred.contains($0.id) }) {
      var excludedContext = context
      // TS `[...new Set([...(context.excludedStopIds ?? []), optional.id])]` — 既存の並びに 1 件足して
      // から**配列全体**を初出順で重複排除する。`optional.id` の追加だけを見るのでは足りない:
      // 呼び出し側が同じ id を 2 度入れた `excludedStopIds` を渡してきたとき、TS はそれも畳む。
      var seen: Set<String> = []
      excludedContext.excludedStopIds = ((context.excludedStopIds ?? []) + [optional.id]).filter { seen.insert($0).inserted }
      compare(
        "remove-\(optional.id)",
        .REMOVE_OPTIONAL,
        nextDays: requestedDays,
        nextContext: excludedContext,
        change: .init(stopId: optional.id, stopName: optional.name),
        loss: .init(kind: .OPTIONAL_STOP, stopId: optional.id, stopName: optional.name, stayMinutes: optional.stayMinutes)
      )
    }

    // TS `:585-606` — 上位いくつの推薦拠点を試すか。TS は `slice(0, 3)` の直書きで、これは
    // 「候補として組み直してみる拠点の数」。**返す反実仮想の上限
    // (`EngineConstants.counterfactualLimit`、TS `:694` の `slice(0, 3)`)とは別の 3** で、
    // 片方を動かしてももう片方は動かない。
    let baseCandidateLimit = 3
    for recommendation in plan.baseRecommendations.prefix(baseCandidateLimit) {
      if recommendation.base.id == plan.selectedBase?.id { continue }
      let base = recommendation.base
      var baseContext = context
      baseContext.hotelQuery = base.query
      // TS `{ ...base, input: base.query, address: base.area }` — `query` は `ResolvedInputStop` に
      // 無い余分なフィールドで、TS でも読まれない。`inputIndex`/`countryCode` は undefined のまま。
      baseContext.resolvedBase = ResolvedStop(routeStop: base.routeStop, input: base.query, address: base.area)
      compare(
        "base-\(base.id)",
        .CHANGE_BASE,
        nextDays: requestedDays,
        nextContext: baseContext,
        change: .init(baseId: base.id, baseName: base.name),
        eligibility: qualifiesHotelBaseChange
      )
    }

    // TS `:608-635` — 貼られた既存旅程だけ、日割りを固定したまま日内順序を解き直して比べる。
    if plan.inputMode == .existing_itinerary {
      var optimizedContext = context
      optimizedContext.optimizeExistingOrder = true
      let optimizedPlan = build(requestedDays, optimizedContext)
      let optimizedFit = assessTripFit(
        TripRequest(raw: raw, days: requestedDays, pace: pace, locale: locale, context: optimizedContext),
        plan: optimizedPlan,
        options: options
      )
      if optimizedFit.status != .incomplete && optimizedFit.status != .timed_out {
        let after = scenarioMetrics(optimizedPlan, fit: optimizedFit)
        let orderByDay = IntKeyedDictionary(Dictionary(uniqueKeysWithValues: optimizedPlan.days.enumerated().map { dayIndex, day in
          (dayIndex, day.stops.map(\.stop.id))
        }))
        let currentOrder = plan.days.map { $0.stops.map(\.stop.id).joined(separator: "|") }.joined(separator: "::")
        let optimizedOrder = optimizedPlan.days.map { $0.stops.map(\.stop.id).joined(separator: "|") }.joined(separator: "::")
        let saved = before.travelMinutes - after.travelMinutes
        if optimizedOrder != currentOrder && saved > 0 {
          candidates.append(TripCounterfactual(
            id: "optimize-existing-order",
            kind: .OPTIMIZE_ORDER,
            change: .init(orderByDay: orderByDay, travelMinutesSaved: saved),
            before: before,
            after: after,
            improvement: improvementBetween(before, after),
            loss: .init(kind: .ORIGINAL_ORDER)
          ))
        }
      }
    }

    // TS `:637-658` — モードの提案は本物の反実仮想であって「タクシーを使え」という一般論ではない。
    // その日の現在の順序を固定して選んだレグだけを切り分け、組み直して、実測で予定が良くなった
    // ときだけ残す。速さと費用対効果は別の目的なので、交通手段の取引は明示する。
    for (dayIndex, day) in plan.days.enumerated() {
      for leg in day.legs {
        let currentMode = leg.comparison.recommended.mode
        let faster = leg.comparison.options.filter { $0.mode != currentMode && $0.minutes < leg.comparison.recommended.minutes }
        guard let quicker = stableSorted(faster, by: { left, right in
          if left.minutes != right.minutes { return left.minutes < right.minutes }
          return jsLocaleCompare(left.mode.rawValue, right.mode.rawValue) < 0
        }).first else { continue }
        let legId = routeLegKey(leg.from.id, leg.to.id)
        var modeContext = context
        var overrides = context.legModeOverrides ?? [:]
        overrides[legId] = quicker.mode
        modeContext.legModeOverrides = overrides
        var lockedOrder = context.lockedOrderByDay ?? IntKeyedDictionary()
        lockedOrder[dayIndex] = day.stops.map(\.stop.id)
        modeContext.lockedOrderByDay = lockedOrder
        compare(
          "mode-\(legId)-\(quicker.mode.rawValue)",
          .CHANGE_MODE,
          nextDays: requestedDays,
          nextContext: modeContext,
          change: .init(legId: legId, fromName: leg.from.name, toName: leg.to.name, mode: quicker.mode),
          loss: .init(kind: .TRANSPORT_TRADEOFF, legId: legId, mode: quicker.mode)
        )
      }
    }

    return shortlist(candidates)
  }

  /// TS `:670-706` — 並べ替え、上位 3 件、そして「最小の完全修復」と `OPTIMIZE_ORDER` の強制挿入。
  static func shortlist(_ candidates: [TripCounterfactual]) -> [TripCounterfactual] {
    let sorted = stableSorted(candidates) { left, right in
      if left.improvement.hardConflictsRemoved != right.improvement.hardConflictsRemoved {
        return right.improvement.hardConflictsRemoved < left.improvement.hardConflictsRemoved
      }
      if left.improvement.overrunMinutesReduced != right.improvement.overrunMinutesReduced {
        return right.improvement.overrunMinutesReduced < left.improvement.overrunMinutesReduced
      }
      // TS `(right ?? -Inf) - (left ?? -Inf)`: 両方 null なら NaN(= 偽)で次の段へ落ちる。
      // 片方だけ null なら null でないほうが先。
      if !(left.improvement.slackMinutesGained == nil && right.improvement.slackMinutesGained == nil) {
        let l = left.improvement.slackMinutesGained ?? Int.min
        let r = right.improvement.slackMinutesGained ?? Int.min
        if l != r { return r < l }
      }
      let leftRank = kindRank(left.kind)
      let rightRank = kindRank(right.kind)
      if leftRank != rightRank { return leftRank < rightRank }
      return jsLocaleCompare(left.id, right.id) < 0
    }
    var shortlist = Array(sorted.prefix(EngineConstants.counterfactualLimit))
    let minimalCompleteRepair = stableSorted(
      sorted.filter { $0.kind != .OPTIMIZE_ORDER && $0.after.hardConflictCount == 0 && $0.after.overrunMinutes == 0 },
      by: { left, right in
        let leftRank = kindRank(left.kind)
        let rightRank = kindRank(right.kind)
        if leftRank != rightRank { return leftRank < rightRank }
        return jsLocaleCompare(left.id, right.id) < 0
      }
    ).first
    let optimized = sorted.first { $0.kind == .OPTIMIZE_ORDER }
    // TS は参照同一性で `includes`/`indexOf` する。Swift の `TripCounterfactual` は値型なので
    // `==` は全フィールド比較になり、同じ指標を持つ別候補を取り違えうる。代わりに id で照合する:
    // 1 つの計画の中で id は一意である —— `use-minimum-days` / `start-60-min-earlier` /
    // `end-60-min-later` / `optimize-existing-order` は各 1 件、`remove-<停留所 id>` は
    // `cutCandidates` から 1 件だけ、`base-<拠点 id>` は `baseRecommendations` の相異なる拠点、
    // `mode-<legId>-<mode>` は (レグ, モード) の組ごとに 1 件。
    let required = [minimalCompleteRepair, optimized].compactMap { $0 }
    let requiredIds = Set(required.map(\.id))
    for candidate in required {
      if shortlist.contains(where: { $0.id == candidate.id }) { continue }
      // TS `:697-699` — 後ろから見て「必須でない」最初の枠を明け渡す。見つからなければ末尾。
      let fromEnd = Array(shortlist.reversed()).firstIndex { !requiredIds.contains($0.id) }
      let actualIndex = fromEnd.map { shortlist.count - 1 - $0 } ?? (shortlist.count - 1)
      if actualIndex >= 0 { shortlist[actualIndex] = candidate }
    }
    // TS `:705` の `sorted.indexOf(...)`。ここも id 照合(上と同じ理由・同じ一意性の根拠)。
    return stableSorted(shortlist) { left, right in
      let leftIndex = sorted.firstIndex { $0.id == left.id } ?? -1
      let rightIndex = sorted.firstIndex { $0.id == right.id } ?? -1
      return leftIndex < rightIndex
    }
  }
}
